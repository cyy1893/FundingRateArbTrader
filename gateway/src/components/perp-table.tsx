"use client";

import {
  WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronUp, Loader2, Search, RefreshCw } from "lucide-react";

import { PerpTableRow } from "@/components/perp-table-row";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatVolume } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { useFundingPredictionSidebar } from "@/components/funding-prediction-sidebar";
import { persistComparisonSelection } from "@/lib/comparison-selection";
import type { MarketRow } from "@/types/market";
import type { FundingHistoryPoint, LiveFundingResponse } from "@/types/funding";
import type { SourceConfig } from "@/lib/external";
import {
  DEFAULT_VOLUME_THRESHOLD,
  VOLUME_THRESHOLD_OPTIONS,
} from "@/lib/volume-filter";
import {
  Brush,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

type PerpTableProps = {
  rows: MarketRow[];
  pageSize?: number;
  leftSource: SourceConfig;
  rightSource: SourceConfig;
  volumeThreshold: number;
  headerControls?: React.ReactNode;
};

const DEFAULT_PAGE_SIZE = 15;
const FETCH_INTERVAL_MS = 15000;
const SORT_REFRESH_CACHE_MS = 5000;
const DISPLAY_FUNDING_PERIOD_HOURS = 1;
const MIN_EXCHANGE_VOLUME_USD = 100_000;

type SortColumn =
  | "markPrice"
  | "funding"
  | "rightFunding"
  | "arbitrage"
  | "volumeLeft"
  | "volumeRight";

const HISTORY_OPTIONS = [
  { label: "1 天", value: 1 },
  { label: "1 周", value: 7 },
  { label: "1 月", value: 30 },
] as const;

type BrushRange = {
  startIndex?: number;
  endIndex?: number;
};
type HistoryOptionValue = (typeof HISTORY_OPTIONS)[number]["value"];

const DEFAULT_HISTORY_RANGE_DAYS: HistoryOptionValue = 7;
const MS_PER_HOUR = 60 * 60 * 1000;
const HOURS_PER_YEAR = 24 * 365;
const MIN_HISTORY_WINDOW_MS = 3 * MS_PER_HOUR;
const HISTORY_PAN_SENSITIVITY = 900;
const HISTORY_WHEEL_ZOOM_STEP = 0.18;

const historyTickFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});

const historyTooltipFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const historyPercentFormatter = new Intl.NumberFormat("en-US", {
  minimumSignificantDigits: 2,
  maximumSignificantDigits: 5,
  useGrouping: false,
});

function formatHistoryPercentValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return historyPercentFormatter.format(value);
}

function formatAnnualizedPercentFromHourly(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const annualized = Math.abs(value) * HOURS_PER_YEAR;
  return formatHistoryPercentValue(annualized);
}

function formatHistoryTooltipValue(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const hourly = formatHistoryPercentValue(value);
  const annualized = formatAnnualizedPercentFromHourly(value);
  return `${hourly}% · 年化 ${annualized}%`;
}

function clampHistoryDomain(
  domain: [number, number],
  bounds: [number, number],
): [number, number] {
  const [minBound, maxBound] = bounds;
  if (!Number.isFinite(minBound) || !Number.isFinite(maxBound)) {
    return domain;
  }

  const totalSpan = Math.max(maxBound - minBound, 0);
  if (totalSpan === 0) {
    return [minBound, maxBound];
  }

  const [start, end] = domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
  const minWindow = Math.min(MIN_HISTORY_WINDOW_MS, totalSpan);
  const requestedSpan = Math.max(end - start, minWindow);

  if (requestedSpan >= totalSpan) {
    return [minBound, maxBound];
  }

  let clampedStart = Math.min(
    Math.max(start, minBound),
    maxBound - requestedSpan,
  );
  let clampedEnd = clampedStart + requestedSpan;

  if (clampedEnd > maxBound) {
    clampedEnd = maxBound;
    clampedStart = clampedEnd - requestedSpan;
  }

  return [clampedStart, clampedEnd];
}

function findNearestIndexByTime(
  data: FundingHistoryPoint[],
  target: number,
  mode: "floor" | "ceil",
): number {
  if (data.length === 0) {
    return 0;
  }

  if (mode === "floor" && target <= data[0].time) {
    return 0;
  }
  if (mode === "ceil" && target <= data[0].time) {
    return 0;
  }
  if (mode === "ceil" && target >= data[data.length - 1].time) {
    return data.length - 1;
  }
  if (mode === "floor" && target >= data[data.length - 1].time) {
    return data.length - 1;
  }

  let low = 0;
  let high = data.length - 1;
  let result = mode === "floor" ? 0 : data.length - 1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const midTime = data[mid].time;

    if (midTime === target) {
      return mid;
    }

    if (midTime < target) {
      low = mid + 1;
      if (mode === "floor") {
        result = mid;
      }
    } else {
      high = mid - 1;
      if (mode === "ceil") {
        result = mid;
      }
    }
  }

  return result;
}

async function fetchLiveFundingSnapshot(
  leftSymbols: string[],
  rightSymbols: string[],
  leftSource: SourceConfig,
  rightSource: SourceConfig,
): Promise<LiveFundingResponse> {
  if (leftSymbols.length === 0 && rightSymbols.length === 0) {
    return { left: {}, right: {} };
  }

  const response = await fetch("/api/funding/live", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leftSymbols,
      rightSymbols,
      leftSourceId: leftSource.id,
      rightSourceId: rightSource.id,
    }),
  });

  if (!response.ok) {
    let message = "获取资金费率失败，请稍后重试。";
    try {
      const errorBody = (await response.json()) as { error?: string };
      if (typeof errorBody?.error === "string") {
        message = errorBody.error;
      }
    } catch {
      // ignore parse errors
    }
    throw new Error(message);
  }

  const data = (await response.json()) as Partial<LiveFundingResponse>;
  return {
    left: data.left ?? {},
    right: data.right ?? {},
  };
}

type HistoryRequestPayload = {
  leftSymbol: string;
  rightSymbol: string | null;
  days: number;
  leftFundingPeriodHours: number | null;
  rightFundingPeriodHours: number | null;
  leftSourceId: SourceConfig["id"];
  rightSourceId: SourceConfig["id"];
};

async function fetchFundingHistoryDataset({
  leftSymbol,
  rightSymbol,
  days,
  leftFundingPeriodHours,
  rightFundingPeriodHours,
  leftSourceId,
  rightSourceId,
}: HistoryRequestPayload): Promise<FundingHistoryPoint[]> {
  const fallbackMessage = "获取资金费率历史失败，请稍后重试。";
  const response = await fetch("/api/funding/history", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      leftSymbol,
      rightSymbol,
      days,
      leftFundingPeriodHours,
      rightFundingPeriodHours,
      leftSourceId,
      rightSourceId,
    }),
  });

  if (!response.ok) {
    let message = fallbackMessage;
    try {
      const errorBody = (await response.json()) as { error?: string };
      if (typeof errorBody?.error === "string" && errorBody.error.length > 0) {
        message = errorBody.error;
      }
    } catch {
      // ignore parse errors and fall back to default message
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    dataset?: FundingHistoryPoint[];
    error?: string;
  };

  if (!data.dataset) {
    throw new Error(data.error ?? fallbackMessage);
  }

  return data.dataset;
}

function getHistoryCacheKey(
  leftSourceId: SourceConfig["id"],
  leftSymbol: string,
  rightSourceId: SourceConfig["id"],
  rightSymbol: string | null,
  leftFundingPeriodHours: number | null,
  rightFundingPeriodHours: number | null,
) {
  return `${leftSourceId}:${leftSymbol}__${rightSourceId}:${rightSymbol ?? "none"}__${
    leftFundingPeriodHours ?? "default"
  }__${rightFundingPeriodHours ?? "default"}`;
}

export function PerpTable({
  rows: initialRows,
  pageSize = DEFAULT_PAGE_SIZE,
  leftSource,
  rightSource,
  volumeThreshold,
  headerControls,
}: PerpTableProps) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [sortColumn, setSortColumn] = useState<SortColumn | null>(null);
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [liveFunding, setLiveFunding] = useState<{
    left: Record<string, number>;
    right: Record<string, number>;
  }>({
    left: {},
    right: {},
  });
  const [isBlockingRefresh, setIsBlockingRefresh] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<{
    symbol: string;
    displayName: string;
    leftSymbol: string;
    leftFundingPeriodHours: number | null;
    rightSymbol: string | null;
    rightFundingPeriodHours: number | null;
  } | null>(null);
  const [historyData, setHistoryData] = useState<FundingHistoryPoint[] | null>(
    null,
  );
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const historyCacheRef = useRef<
    Record<string, Record<number, FundingHistoryPoint[]>>
  >({});
  const historyChartWrapperRef = useRef<HTMLDivElement | null>(null);
  const displayPeriodHours = DISPLAY_FUNDING_PERIOD_HOURS;
  const [historyRangeDays, setHistoryRangeDays] =
    useState<HistoryOptionValue>(DEFAULT_HISTORY_RANGE_DAYS);
  const historyRangeMeta =
    HISTORY_OPTIONS.find((option) => option.value === historyRangeDays) ??
    HISTORY_OPTIONS[1];
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const predictionSidebar = useFundingPredictionSidebar();

  const handleVolumeThresholdChange = useCallback(
    (value: string) => {
      const numeric = Number.parseInt(value, 10);
      const params = new URLSearchParams(searchParams.toString());
      if (numeric === DEFAULT_VOLUME_THRESHOLD) {
        params.delete("volumeThreshold");
      } else {
        params.set("volumeThreshold", numeric.toString());
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );
  const historyRangeDurationMs = historyRangeDays * 24 * MS_PER_HOUR;
  const rows = useMemo(() => initialRows, [initialRows]);
  const isPriceDataLoading = false;
  const [historyViewport, setHistoryViewport] = useState<[number, number] | null>(
    null,
  );
  const historyDataSignature = useMemo(() => {
    if (!historyData?.length) {
      return "empty";
    }
    const first = historyData[0]?.time ?? 0;
    const last = historyData[historyData.length - 1]?.time ?? 0;
    return `${historyData.length}-${first}-${last}`;
  }, [historyData]);
  useEffect(() => {
    setHistoryViewport(null);
  }, [historyDataSignature, historyRangeDays]);
  const historyTimeBounds = useMemo<[number, number] | null>(() => {
    if (!historyData?.length) {
      return null;
    }
    const first = historyData[0].time;
    const last = historyData[historyData.length - 1].time;
    if (!Number.isFinite(first) || !Number.isFinite(last)) {
      return null;
    }
    return [first, last];
  }, [historyData]);
  const historyDefaultDomain = useMemo<[number, number] | null>(() => {
    if (!historyTimeBounds) {
      return null;
    }
    const [minTime, maxTime] = historyTimeBounds;
    const availableSpan = Math.max(maxTime - minTime, 0);
    if (availableSpan === 0) {
      return [minTime, maxTime];
    }
    const desiredSpan = Math.min(historyRangeDurationMs, availableSpan);
    const span = desiredSpan > 0 ? desiredSpan : availableSpan;
    const start = Math.max(minTime, maxTime - span);
    return [start, maxTime];
  }, [historyTimeBounds, historyRangeDurationMs]);
  const historyXAxisDomain = historyViewport ?? historyDefaultDomain ?? null;
  const historyBrushState = useMemo(() => {
    if (!historyData?.length) {
      return null;
    }
    if (!historyXAxisDomain) {
      return { startIndex: 0, endIndex: historyData.length - 1 };
    }
    const [domainStart, domainEnd] = historyXAxisDomain;
    return {
      startIndex: findNearestIndexByTime(historyData, domainStart, "floor"),
      endIndex: findNearestIndexByTime(historyData, domainEnd, "ceil"),
    };
  }, [historyData, historyXAxisDomain]);

  const normalizedSearch = search.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    const matchesSearch = (row: MarketRow) =>
      row.symbol.toLowerCase().includes(normalizedSearch);

    return rows.filter(
      (row) => {
        if (!matchesSearch(row) || !row.right) {
          return false;
        }

        const leftVolume =
          Number.isFinite(row.dayNotionalVolume ?? NaN) &&
          row.dayNotionalVolume != null
            ? row.dayNotionalVolume
            : 0;
        const externalVolume =
          Number.isFinite(row.right?.volumeUsd ?? NaN) &&
          row.right?.volumeUsd != null
            ? row.right.volumeUsd
            : 0;
        const meetsVolume =
          volumeThreshold <= 0 ||
          (leftVolume + externalVolume >= volumeThreshold);
        const meetsPerExchangeMinimum =
          leftVolume >= MIN_EXCHANGE_VOLUME_USD &&
          externalVolume >= MIN_EXCHANGE_VOLUME_USD;

        return meetsVolume && meetsPerExchangeMinimum;
      },
    );
  }, [normalizedSearch, rows, volumeThreshold]);

  const fundingColumnLabel = `${leftSource.label} 1 小时资金费率`;
  const externalFundingColumnLabel = `${rightSource.label} 1 小时资金费率`;
  const externalVolumeColumnLabel = `${rightSource.label} 24 小时成交量`;
  const volumeThresholdLabel =
    volumeThreshold <= 0
      ? "不限"
      : `${formatVolume(volumeThreshold)}（两端合计）`;
  const externalFilterDescription = `显示资产：仅列出 ${leftSource.label} 与 ${rightSource.label} 均有的市场，且两端 24 小时成交量合计 ${volumeThresholdLabel}`;
  const handlePageChange = (nextPage: number) => {
    if (nextPage >= 1 && nextPage <= pageCount) {
      setPage(nextPage);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(1);
  };

  useEffect(() => {
    persistComparisonSelection({
      primarySourceId: leftSource.id,
      secondarySourceId: rightSource.id,
      volumeThreshold,
      symbols: filteredRows.map((row) => ({
        symbol: row.symbol,
        displayName: row.displayName ?? row.symbol,
      })),
    });
  }, [filteredRows, leftSource.id, rightSource.id, volumeThreshold]);

  const handleHistoryClick = useCallback(
    (row: MarketRow) => {
      const target = {
        symbol: row.symbol,
        displayName: row.displayName ?? row.symbol,
        leftSymbol: row.leftSymbol,
        leftFundingPeriodHours: row.leftFundingPeriodHours ?? null,
        rightSymbol: row.right?.symbol ?? null,
        rightFundingPeriodHours: row.right?.fundingPeriodHours ?? null,
      };
      setHistoryTarget(target);
      setHistoryError(null);
      const cacheKey = getHistoryCacheKey(
        leftSource.id,
        target.leftSymbol,
        rightSource.id,
        target.rightSymbol,
        target.leftFundingPeriodHours,
        target.rightFundingPeriodHours,
      );
      const cached =
        historyCacheRef.current[cacheKey]?.[historyRangeDays] ?? null;
      setHistoryData(cached);
      setHistoryLoading(!cached);
      setHistoryDialogOpen(true);
    },
    [historyRangeDays, leftSource.id, rightSource.id],
  );

  const handleHistoryRangeChange = useCallback(
    (value: HistoryOptionValue) => {
      if (value === historyRangeDays) {
        return;
      }
      setHistoryRangeDays(value);
      if (!historyTarget) {
        return;
      }
      const cacheKey = getHistoryCacheKey(
        leftSource.id,
        historyTarget.leftSymbol,
        rightSource.id,
        historyTarget.rightSymbol,
        historyTarget.leftFundingPeriodHours,
        historyTarget.rightFundingPeriodHours,
      );
      const cached = historyCacheRef.current[cacheKey]?.[value] ?? null;
      setHistoryData(cached ?? null);
      if (historyDialogOpen) {
        setHistoryError(null);
        setHistoryLoading(!cached);
      }
    },
    [historyRangeDays, historyTarget, historyDialogOpen, leftSource.id, rightSource.id],
  );
  const historyInteractionsDisabled = !historyData?.length || !historyTimeBounds;
  const updateHistoryViewport = useCallback(
    (nextDomain: [number, number]) => {
      if (!historyTimeBounds) {
        setHistoryViewport(nextDomain);
        return;
      }
      setHistoryViewport(clampHistoryDomain(nextDomain, historyTimeBounds));
    },
    [historyTimeBounds],
  );
  const handleHistoryBrushChange = useCallback(
    (range?: BrushRange) => {
      if (!historyData?.length || !historyTimeBounds || !range) {
        return;
      }
      const startIndex = Math.max(
        0,
        Math.min(range.startIndex ?? 0, historyData.length - 1),
      );
      const endIndex = Math.max(
        0,
        Math.min(range.endIndex ?? historyData.length - 1, historyData.length - 1),
      );
      if (startIndex === endIndex) {
        return;
      }
      const low = Math.min(startIndex, endIndex);
      const high = Math.max(startIndex, endIndex);
      const nextDomain: [number, number] = [
        historyData[low].time,
        historyData[high].time,
      ];
      updateHistoryViewport(nextDomain);
    },
    [historyData, historyTimeBounds, updateHistoryViewport],
  );
  const handleHistoryResetViewport = useCallback(() => {
    setHistoryViewport(null);
  }, []);
  const handleHistoryZoom = useCallback(
    (direction: "in" | "out") => {
      if (!historyTimeBounds) {
        return;
      }
      const activeDomain = historyViewport ?? historyDefaultDomain;
      if (!activeDomain) {
        return;
      }
      const [start, end] = activeDomain;
      const currentSpan = Math.max(end - start, MIN_HISTORY_WINDOW_MS);
      const totalSpan = Math.max(
        historyTimeBounds[1] - historyTimeBounds[0],
        MIN_HISTORY_WINDOW_MS,
      );
      if (totalSpan === 0) {
        return;
      }
      const zoomFactor = direction === "in" ? 0.75 : 1.25;
      const nextSpan = Math.min(
        Math.max(currentSpan * zoomFactor, MIN_HISTORY_WINDOW_MS),
        totalSpan,
      );
      const center = start + currentSpan / 2;
      const nextDomain: [number, number] = [
        center - nextSpan / 2,
        center + nextSpan / 2,
      ];
      updateHistoryViewport(nextDomain);
    },
    [historyDefaultDomain, historyTimeBounds, historyViewport, updateHistoryViewport],
  );
  const handleHistoryWheel = useCallback(
    (event: WheelEvent<HTMLDivElement>) => {
      if (!historyData?.length || !historyTimeBounds) {
        return;
      }
      const activeDomain = historyViewport ?? historyDefaultDomain;
      if (!activeDomain) {
        return;
      }
      const totalSpan = Math.max(
        historyTimeBounds[1] - historyTimeBounds[0],
        MIN_HISTORY_WINDOW_MS,
      );
      if (totalSpan === 0) {
        return;
      }

      event.preventDefault();
      const [start, end] = activeDomain;
      const currentSpan = Math.max(end - start, MIN_HISTORY_WINDOW_MS);
      const shouldPan =
        event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY);

      if (shouldPan) {
        const rawDelta = event.deltaX || event.deltaY;
        if (rawDelta === 0) {
          return;
        }
        const shiftRatio = rawDelta / HISTORY_PAN_SENSITIVITY;
        if (shiftRatio === 0) {
          return;
        }
        const shift = currentSpan * shiftRatio;
        updateHistoryViewport([start + shift, end + shift]);
        return;
      }

      if (event.deltaY === 0) {
        return;
      }

      const zoomDirection = Math.sign(event.deltaY);
      const nextSpan = Math.min(
        Math.max(
          currentSpan * (1 + HISTORY_WHEEL_ZOOM_STEP * zoomDirection),
          MIN_HISTORY_WINDOW_MS,
        ),
        totalSpan,
      );
      const container = historyChartWrapperRef.current;
      let focusRatio = 0.5;
      if (container) {
        const rect = container.getBoundingClientRect();
        if (rect.width > 0) {
          const relativeX = Math.min(
            Math.max(event.clientX - rect.left, 0),
            rect.width,
          );
          focusRatio = relativeX / rect.width;
        }
      }
      const focusPoint = start + currentSpan * focusRatio;
      const nextDomain: [number, number] = [
        focusPoint - nextSpan * focusRatio,
        focusPoint + nextSpan * (1 - focusRatio),
      ];
      updateHistoryViewport(nextDomain);
    },
    [
      historyData,
      historyDefaultDomain,
      historyTimeBounds,
      historyViewport,
      updateHistoryViewport,
    ],
  );

  const sortedRows = useMemo(() => {
    if (!sortColumn) {
      return filteredRows;
    }

    const rowsWithIndex = filteredRows.map((row, index) => ({
      row,
      index,
    }));

    const getValue = (row: MarketRow) => {
      switch (sortColumn) {
        case "markPrice":
          return row.markPrice;
        case "funding":
        {
          const live = liveFunding.left[row.leftSymbol];
          const funding = Number.isFinite(live) ? live : row.fundingRate;
          return funding * displayPeriodHours;
        }
        case "rightFunding":
        {
          if (!row.right?.symbol) {
            return Number.NEGATIVE_INFINITY;
          }

          const live = liveFunding.right[row.right.symbol];
          const funding =
            Number.isFinite(live) && live !== undefined
              ? live
              : row.right.fundingRate ?? null;
          if (funding === null) {
            return Number.NEGATIVE_INFINITY;
          }

          return funding;
        }
        case "arbitrage": {
          const liveLeft =
            liveFunding.left[row.leftSymbol] ?? row.fundingRate;

          const externalHourly =
            row.right?.symbol != null
              ? liveFunding.right[row.right.symbol] ??
                row.right.fundingRate ??
                null
              : null;

          if (externalHourly === null || !Number.isFinite(liveLeft)) {
            return Number.NEGATIVE_INFINITY;
          }

          return Math.abs(liveLeft - externalHourly);
        }
        case "volumeLeft":
          return row.dayNotionalVolume ?? Number.NEGATIVE_INFINITY;
        case "volumeRight":
          return row.right?.volumeUsd ?? Number.NEGATIVE_INFINITY;
        default:
          return 0;
      }
    };

    rowsWithIndex.sort((a, b) => {
      const valueA = getValue(a.row);
      const valueB = getValue(b.row);

      const safeA = Number.isFinite(valueA) ? valueA : Number.NEGATIVE_INFINITY;
      const safeB = Number.isFinite(valueB) ? valueB : Number.NEGATIVE_INFINITY;

      if (safeA === safeB) {
        return a.index - b.index;
      }

      return sortDirection === "desc" ? safeB - safeA : safeA - safeB;
    });

    return rowsWithIndex.map(({ row }) => row);
  }, [filteredRows, sortColumn, sortDirection, displayPeriodHours, liveFunding]);

  const getSortState = (column: SortColumn): "asc" | "desc" | null => {
    if (sortColumn !== column) {
      return null;
    }

    return sortDirection;
  };

  const renderSortIcon = (column: SortColumn) => {
    const state = getSortState(column);
    const baseIconClasses =
      "h-3.5 w-3.5 text-muted-foreground transition-opacity duration-150";

    if (state === "desc") {
      return <ChevronDown className={baseIconClasses} />;
    }

    if (state === "asc") {
      return <ChevronUp className={baseIconClasses} />;
    }

    return <ChevronDown className={`${baseIconClasses} opacity-0`} />;
  };

  const sortedLength = sortedRows.length;
  const pageCount = Math.max(1, Math.ceil(sortedLength / pageSize));
  const currentPage = Math.min(page, pageCount);
  const startIndex = (currentPage - 1) * pageSize;
  const currentRows = useMemo(
    () => sortedRows.slice(startIndex, startIndex + pageSize),
    [sortedRows, startIndex, pageSize],
  );
  const leftSymbolsRef = useRef<string[]>([]);
  const rightSymbolsRef = useRef<string[]>([]);
  const lastFetchRef = useRef<number>(0);
  const isFetchingRef = useRef<boolean>(false);

  useEffect(() => {
    leftSymbolsRef.current = currentRows.map((row) => row.leftSymbol);
    rightSymbolsRef.current = currentRows
      .map((row) => row.right?.symbol)
      .filter((symbol): symbol is string => Boolean(symbol));
  }, [currentRows]);

  useEffect(() => {
    if (!historyDialogOpen || !historyTarget) {
      return;
    }

    const cacheKey = getHistoryCacheKey(
      leftSource.id,
      historyTarget.leftSymbol,
      rightSource.id,
      historyTarget.rightSymbol,
      historyTarget.leftFundingPeriodHours,
      historyTarget.rightFundingPeriodHours,
    );
    const cached =
      historyCacheRef.current[cacheKey]?.[historyRangeDays] ?? null;
    if (cached) {
      setHistoryData(cached);
      setHistoryLoading(false);
      setHistoryError(null);
      return;
    }

    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError(null);

    fetchFundingHistoryDataset({
      leftSymbol: historyTarget.leftSymbol,
      rightSymbol: historyTarget.rightSymbol,
      days: historyRangeDays,
      leftFundingPeriodHours: historyTarget.leftFundingPeriodHours,
      rightFundingPeriodHours: historyTarget.rightFundingPeriodHours,
      leftSourceId: leftSource.id,
      rightSourceId: rightSource.id,
    })
      .then((dataset) => {
        if (cancelled) {
          return;
        }
        historyCacheRef.current[cacheKey] = {
          ...(historyCacheRef.current[cacheKey] ?? {}),
          [historyRangeDays]: dataset,
        };
        setHistoryData(dataset);
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }
        setHistoryError(
          error instanceof Error
            ? error.message
            : "获取资金费率历史失败，请稍后重试。",
        );
      })
      .finally(() => {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [historyDialogOpen, historyTarget, historyRangeDays, leftSource.id, rightSource.id]);

  const showingFrom = sortedLength === 0 ? 0 : startIndex + 1;
  const showingTo = startIndex + currentRows.length;
  const paginationRange = useMemo(() => {
    const totalNumbers = 5;
    if (pageCount <= totalNumbers) {
      return Array.from({ length: pageCount }, (_, index) => index + 1);
    }

    const current = currentPage;
    const neighbours = 1;
    const showLeftEllipsis = current - neighbours > 2;
    const showRightEllipsis = current + neighbours < pageCount - 1;

    const range: Array<number | "ellipsis-left" | "ellipsis-right"> = [1];

    if (showLeftEllipsis) {
      range.push("ellipsis-left");
    }

    const start = Math.max(2, current - neighbours);
    const end = Math.min(pageCount - 1, current + neighbours);
    for (let i = start; i <= end; i += 1) {
      range.push(i);
    }

    if (showRightEllipsis) {
      range.push("ellipsis-right");
    }

    range.push(pageCount);

    return range;
  }, [currentPage, pageCount]);

  const fetchLatestFunding = useCallback(
    async (force = false) => {
      const leftSymbols = leftSymbolsRef.current;
      const rightSymbols = rightSymbolsRef.current;

      if (leftSymbols.length === 0 && rightSymbols.length === 0) {
        return;
      }

      const now = Date.now();
      if (!force && now - lastFetchRef.current < FETCH_INTERVAL_MS) {
        return;
      }

      if (isFetchingRef.current) {
        if (force) {
          await new Promise<void>((resolve) => {
            const check = () => {
              if (!isFetchingRef.current) {
                resolve();
              } else {
                window.setTimeout(check, 50);
              }
            };
            check();
          });
        }
        return;
      }

      isFetchingRef.current = true;
      try {
        const snapshot = await fetchLiveFundingSnapshot(
          leftSymbols,
          rightSymbols,
          leftSource,
          rightSource,
        );

        setLiveFunding({
          left: snapshot.left,
          right: snapshot.right,
        });
        lastFetchRef.current = Date.now();
      } catch {
        // ignore network errors; keep last values
      } finally {
        isFetchingRef.current = false;
      }
    },
    [leftSource, rightSource],
  );

  const triggerBlockingRefresh = useCallback(() => {
    setIsBlockingRefresh(true);
    fetchLatestFunding(true).finally(() => setIsBlockingRefresh(false));
  }, [fetchLatestFunding]);

  const triggerCachedSortRefresh = useCallback(() => {
    if (Date.now() - lastFetchRef.current < SORT_REFRESH_CACHE_MS) {
      return;
    }
    triggerBlockingRefresh();
  }, [triggerBlockingRefresh]);

  const cycleSort = (column: SortColumn) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("desc");
      setPage(1);
      triggerCachedSortRefresh();
      return;
    }

    if (sortDirection === "desc") {
      setSortDirection("asc");
      setPage(1);
      triggerCachedSortRefresh();
      return;
    }

    setSortColumn(null);
    setSortDirection("desc");
    setPage(1);
    triggerCachedSortRefresh();
  };

  const handleHistoryDialogChange = (open: boolean) => {
    setHistoryDialogOpen(open);
    if (!open) {
      setHistoryTarget(null);
      setHistoryError(null);
      setHistoryLoading(false);
    }
  };

  return (
    <>
      <TooltipProvider delayDuration={150}>
      <div className="space-y-4">
        <div className="flex flex-col gap-4 rounded-xl border bg-card p-4 shadow-sm md:flex-row md:items-center">
          <div className="relative w-full max-w-xs">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="搜索资产..."
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              className="pl-9"
            />
          </div>
          {headerControls}

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                24H交易量 &ge;
              </span>
              <Select
                value={String(volumeThreshold)}
                onValueChange={handleVolumeThresholdChange}
              >
                <SelectTrigger className="h-7 w-[90px] border-0 bg-transparent p-0 text-xs focus:ring-0">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {VOLUME_THRESHOLD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              variant="outline"
              className="whitespace-nowrap"
              onClick={() =>
                predictionSidebar.open({
                  sourceA: leftSource.id,
                  sourceB: rightSource.id,
                  volumeThreshold,
                })
              }
            >
              推荐套利币种
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={triggerBlockingRefresh}
              disabled={isBlockingRefresh}
              className="h-9"
            >
              <RefreshCw
                className={cn(
                  "mr-2 h-3.5 w-3.5",
                  isBlockingRefresh && "animate-spin",
                )}
              />
              {isBlockingRefresh ? "刷新中" : "刷新"}
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          {externalFilterDescription}
        </div>

        <div className="relative rounded-xl border">
          {isBlockingRefresh ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/80 backdrop-blur-sm">
              <div className="flex flex-col items-center gap-2 text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-xs font-medium">刷新…</span>
              </div>
            </div>
          ) : null}
          <Table className={cn("text-sm", isBlockingRefresh && "pointer-events-none opacity-50")}>
            <TableHeader>
              <TableRow className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  货币
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => cycleSort("markPrice")}
                    className="inline-flex w-full items-center justify-between gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-primary focus:outline-none"
                  >
                    <span>价格</span>
                    {renderSortIcon("markPrice")}
                  </button>
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  24小时价格变动
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  {leftSource.label} 最大杠杆
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  {rightSource.label} 最大杠杆
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => cycleSort("funding")}
                    className="inline-flex w-full items-center justify-between gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-primary focus:outline-none"
                  >
                    <span>{fundingColumnLabel}</span>
                    {renderSortIcon("funding")}
                  </button>
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => cycleSort("rightFunding")}
                    className="inline-flex w-full items-center justify-between gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-primary focus:outline-none"
                  >
                    <span>{externalFundingColumnLabel}</span>
                    {renderSortIcon("rightFunding")}
                  </button>
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  {leftSource.label} 资金费率周期
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  {rightSource.label} 资金费率周期
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => cycleSort("arbitrage")}
                    className="inline-flex w-full items-center justify-between gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-primary focus:outline-none"
                  >
                    <span>套利空间（1 小时）</span>
                    {renderSortIcon("arbitrage")}
                  </button>
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => cycleSort("volumeLeft")}
                    className="inline-flex w-full items-center justify-between gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-primary focus:outline-none"
                  >
                    <span>{leftSource.label} 24 小时成交量</span>
                    {renderSortIcon("volumeLeft")}
                  </button>
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  <button
                    type="button"
                    onClick={() => cycleSort("volumeRight")}
                    className="inline-flex w-full items-center justify-between gap-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted-foreground transition hover:text-primary focus:outline-none"
                  >
                    <span>{externalVolumeColumnLabel}</span>
                    {renderSortIcon("volumeRight")}
                  </button>
                </TableHead>
                <TableHead className="text-left font-semibold text-[11px] text-muted-foreground">
                  资金费率历史
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {currentRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={13}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    未找到匹配的资产。
                  </TableCell>
                </TableRow>
              ) : (
                currentRows.map((row) => (
                  <PerpTableRow
                    key={row.symbol}
                    row={row}
                    liveFunding={liveFunding}
                    displayPeriodHours={displayPeriodHours}
                    leftSourceLabel={leftSource.label}
                    rightSourceLabel={rightSource.label}
                    onHistoryClick={handleHistoryClick}
                    loadingPrices={isPriceDataLoading}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-muted-foreground">
            当前显示{" "}
            <span className="font-medium text-foreground">
              {showingFrom === 0 && showingTo === 0
                ? "0"
                : `${showingFrom}-${showingTo}`}
            </span>{" "}
            ，共{" "}
            <span className="font-medium text-foreground">{sortedLength}</span>{" "}
            个资产
          </div>
          <Pagination>
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => handlePageChange(currentPage - 1)}
                  aria-disabled={currentPage === 1}
                  className={cn(
                    currentPage === 1 && "pointer-events-none opacity-40",
                  )}
                />
              </PaginationItem>
              {paginationRange.map((value) => {
                if (value === "ellipsis-left" || value === "ellipsis-right") {
                  return (
                    <PaginationItem key={value}>
                      <PaginationEllipsis />
                    </PaginationItem>
                  );
                }

                return (
                  <PaginationItem key={value}>
                    <PaginationLink
                      isActive={currentPage === value}
                      onClick={() => handlePageChange(value)}
                    >
                      {value}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  onClick={() => handlePageChange(currentPage + 1)}
                  aria-disabled={currentPage === pageCount}
                  className={cn(
                    currentPage === pageCount && "pointer-events-none opacity-40",
                  )}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      </div>
      <Dialog open={historyDialogOpen} onOpenChange={handleHistoryDialogChange}>
        <DialogContent className="w-[96vw] max-w-6xl">
          <DialogHeader>
            <DialogTitle>
              {historyTarget
                ? `${historyTarget.displayName} 资金费率历史`
                : "资金费率历史"}
            </DialogTitle>
            <DialogDescription>
              最近 {historyRangeMeta?.label ?? ""} {leftSource.label} 与 {rightSource.label}
              （若有）的资金费率对比（单位：%）。点击下方时间范围可切换。
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            {HISTORY_OPTIONS.map((option) => {
              const isActive = option.value === historyRangeDays;
              return (
                <Button
                  key={option.value}
                  size="sm"
                  variant={isActive ? "default" : "outline"}
                  onClick={() => handleHistoryRangeChange(option.value)}
                  className={isActive ? "px-3" : "px-3"}
                >
                  {option.label}
                </Button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleHistoryZoom("in")}
              disabled={historyInteractionsDisabled}
            >
              放大
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleHistoryZoom("out")}
              disabled={historyInteractionsDisabled}
            >
              缩小
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleHistoryResetViewport}
              disabled={historyInteractionsDisabled || historyViewport === null}
            >
              重置视图
            </Button>
            <span className="text-xs text-muted-foreground">
              鼠标滚轮缩放，按住 Shift 或横向滚动可平移
            </span>
          </div>
          {historyLoading ? (
            <div className="flex h-72 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              加载历史数据…
            </div>
          ) : historyError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {historyError}
            </div>
          ) : historyData?.length ? (
            <div
              className="h-[480px] w-full"
              ref={historyChartWrapperRef}
              onWheel={
                historyInteractionsDisabled ? undefined : handleHistoryWheel
              }
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={historyData} margin={{ top: 12, right: 16, left: 0, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="text-muted-foreground/20" />
                  <XAxis
                    dataKey="time"
                    type="number"
                    scale="time"
                    allowDataOverflow
                    tickFormatter={(value) => historyTickFormatter.format(value)}
                    domain={
                      historyXAxisDomain
                        ? [historyXAxisDomain[0], historyXAxisDomain[1]]
                        : ["dataMin", "dataMax"]
                    }
                    padding={{ left: 0, right: 0 }}
                    tickMargin={8}
                    fontSize={12}
                  />
                  <YAxis
                    tickFormatter={(value) => `${formatHistoryPercentValue(value)}%`}
                    fontSize={12}
                    width={60}
                  />
                  <ReferenceLine
                    y={0}
                    stroke="#334155"
                    strokeDasharray="6 4"
                    strokeWidth={2}
                    strokeOpacity={0.9}
                  />
                  <RechartsTooltip
                    formatter={(value, name) => {
                      const numericValue =
                        typeof value === "number"
                          ? value
                          : Number.parseFloat(String(value));
                      return [
                        formatHistoryTooltipValue(numericValue),
                        typeof name === "string" ? name : String(name ?? ""),
                      ];
                    }}
                    labelFormatter={(value) =>
                      historyTooltipFormatter.format(value as number)
                    }
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="left"
                    name={leftSource.label}
                    stroke="#06b6d4"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="right"
                    name={rightSource.label}
                    stroke="#f97316"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="spread"
                    name={`套利空间（${leftSource.label} 多 / ${rightSource.label} 空）`}
                    stroke="#ef4444"
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                  />
                  {historyBrushState && historyData && historyData.length > 1 ? (
                    <Brush
                      dataKey="time"
                      height={28}
                      stroke="#94a3b8"
                      travellerWidth={10}
                      tickFormatter={() => ""}
                      startIndex={historyBrushState.startIndex}
                      endIndex={historyBrushState.endIndex}
                      onChange={handleHistoryBrushChange}
                    />
                  ) : null}
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="rounded-md border border-border/60 bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
              暂无历史数据
            </div>
          )}
        </DialogContent>
      </Dialog>
    </TooltipProvider>
    </>
  );
}
