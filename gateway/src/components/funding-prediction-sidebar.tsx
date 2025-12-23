"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Loader2 } from "lucide-react";

import type { FundingPredictionEntry } from "@/lib/funding-prediction";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SidebarRequest = {
  sourceA: string;
  sourceB: string;
  volumeThreshold: number;
};

type PredictionSidebarPayload = {
  metadata: {
    primarySourceLabel: string;
    secondarySourceLabel: string;
    volumeLabel: string;
    fetchedAt: string | null;
  };
  entries: FundingPredictionEntry[];
  failures: Array<{ symbol: string; reason: string }>;
};

type SidebarState = {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  data: PredictionSidebarPayload | null;
  lastRequest: SidebarRequest | null;
  lastFetchedAt: number | null;
  open: (request: SidebarRequest) => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarState | null>(null);
const CACHE_TTL_MS = 10 * 60 * 1000;

export function FundingPredictionSidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PredictionSidebarPayload | null>(null);
  const [lastRequest, setLastRequest] = useState<SidebarRequest | null>(null);
  const [lastFetchedAt, setLastFetchedAt] = useState<number | null>(null);

  const open = useCallback(async (request: SidebarRequest) => {
    const sameRequest =
      lastRequest &&
      lastRequest.sourceA === request.sourceA &&
      lastRequest.sourceB === request.sourceB &&
      lastRequest.volumeThreshold === request.volumeThreshold;

    const cacheFresh =
      lastFetchedAt != null && Date.now() - lastFetchedAt < CACHE_TTL_MS;

    if (sameRequest && data && cacheFresh) {
      setIsOpen((prev) => !prev);
      return;
    }

    setLastRequest(request);
    const params = new URLSearchParams({
      sourceA: request.sourceA,
      sourceB: request.sourceB,
      volumeThreshold: String(request.volumeThreshold),
    });

    setIsOpen(true);
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch(
        `/api/funding/prediction?${params.toString()}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "无法加载资金费率预测");
      }
      const payload = (await response.json()) as PredictionSidebarPayload;
      setData(payload);
      setLastFetchedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载资金费率预测");
    } finally {
      setLoading(false);
    }
  }, [data, lastRequest, lastFetchedAt]);

  const close = useCallback(() => {
    setIsOpen(false);
    setLoading(false);
    setError(null);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      loading,
      error,
      data,
      lastRequest,
      lastFetchedAt,
      open,
      close,
    }),
    [isOpen, loading, error, data, lastRequest, lastFetchedAt, open, close],
  );

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useFundingPredictionSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useFundingPredictionSidebar must be used within provider");
  }
  return ctx;
}

export function FundingPredictionContent() {
  const { loading, error, data } = useFundingPredictionSidebar();
  const hasContent = Boolean(data && data.entries.length > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b p-6">
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            预测 24 小时套利 APR
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {data
              ? `${data.metadata.primarySourceLabel} vs ${data.metadata.secondarySourceLabel}`
              : "请选择交易对"}
          </p>
          {data?.metadata.fetchedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              数据更新：{" "}
              {new Date(data.metadata.fetchedAt).toLocaleString("zh-CN")}
            </p>
          ) : null}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              预测生成中…
            </div>
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : hasContent ? (
          <PredictionResults payload={data!} />
        ) : (
          <p className="text-sm text-muted-foreground">
            选择交易所并点击“预测 24 小时套利 APR”以查看结果。
          </p>
        )}
      </div>
    </div>
  );
}

export function FundingPredictionSidebar() {
  const { isOpen } = useFundingPredictionSidebar();
  return null;
}

function PredictionResults({ payload }: { payload: PredictionSidebarPayload }) {
  const topEntries = payload.entries.slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <div>
          注：预测使用 16 小时半衰期的 EWMA，窗口为最近 72 小时，且仅显示 {payload.metadata.volumeLabel} 的币种。
        </div>
        {payload.failures.length > 0 ? (
          <div className="mt-2">
            {payload.failures.length} 个币种因数据缺失暂不可用。
          </div>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <TableHead>币种</TableHead>
            <TableHead>方向</TableHead>
            <TableHead className="text-right">
              {payload.metadata.primarySourceLabel} 24h
            </TableHead>
            <TableHead className="text-right">
              {payload.metadata.secondarySourceLabel} 24h
            </TableHead>
            <TableHead className="text-right">预测 24 小时收益</TableHead>
            <TableHead className="text-right">预测年化 APR</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {topEntries.map((entry) => (
            <TableRow key={entry.symbol}>
              <TableCell className="font-semibold">
                {entry.displayName}
              </TableCell>
              <TableCell className="text-xs">
                {renderDirection(entry, payload.metadata)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {formatPercent(entry.predictedLeft24h)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {formatPercent(entry.predictedRight24h)}
              </TableCell>
              <TableCell className="text-right text-sm font-medium">
                {formatDecimalPercent(entry.totalDecimal)}
              </TableCell>
              <TableCell className="text-right font-semibold text-primary">
                {formatDecimalPercent(entry.annualizedDecimal)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function renderDirection(
  entry: FundingPredictionEntry,
  metadata: PredictionSidebarPayload["metadata"],
) {
  if (entry.direction === "leftLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
          <span className="inline-block rounded-[2px] bg-emerald-100 px-1 py-0.5 text-[10px] leading-none text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            多
          </span>
          {metadata.primarySourceLabel}
        </p>
        <p className="flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-block rounded-[2px] bg-rose-100 px-1 py-0.5 text-[10px] leading-none text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            空
          </span>
          {metadata.secondarySourceLabel}
        </p>
      </div>
    );
  }
  if (entry.direction === "rightLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-block rounded-[2px] bg-rose-100 px-1 py-0.5 text-[10px] leading-none text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            空
          </span>
          {metadata.primarySourceLabel}
        </p>
        <p className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
          <span className="inline-block rounded-[2px] bg-emerald-100 px-1 py-0.5 text-[10px] leading-none text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            多
          </span>
          {metadata.secondarySourceLabel}
        </p>
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground">方向不明</p>;
}

function formatPercent(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  if (Math.abs(value) >= 0.01) {
    return `${value.toFixed(2)}%`;
  }
  return `${value.toFixed(4)}%`;
}

function formatDecimalPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const percent = value * 100;
  if (Math.abs(percent) >= 0.01) {
    return `${percent.toFixed(2)}%`;
  }
  return `${percent.toFixed(4)}%`;
}
