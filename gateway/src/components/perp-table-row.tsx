"use client";

/* eslint-disable @next/next/no-img-element */

import { memo, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  LineChart as LineChartIcon,
  Minus,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  describeFundingDirection,
  formatAnnualizedFunding,
  formatFundingRate,
  formatPercentChange,
  formatPrice,
  formatVolume,
  computeAnnualizedPercent,
} from "@/lib/formatters";
import { buildTokenIconCandidates, makeFallbackSvgDataUrl } from "@/lib/token-icons";
import type { MarketRow } from "@/types/market";
import type { SourceProvider } from "@/lib/external";
import { cn } from "@/lib/utils";

type LiveFundingMap = {
  left: Record<string, number>;
  right: Record<string, number>;
};

type PerpTableRowProps = {
  row: MarketRow;
  liveFunding: LiveFundingMap;
  displayPeriodHours: number;
  onHistoryClick: (row: MarketRow) => void;
  leftSourceLabel: string;
  rightSourceLabel: string;
  loadingPrices?: boolean;
};

const ARBITRAGE_COLOR_WINDOW_HOURS = 8;

const RATE_THRESHOLDS = {
  negative: 0,
  neutralUpperBound: 0.0001,
} as const;

function getFundingBadgeClass(rate: number): string {
  if (rate < RATE_THRESHOLDS.negative) {
    return "border-[#fb7185]/60 bg-[#f87171]/10 text-[#b91c1c]";
  }

  if (rate <= RATE_THRESHOLDS.neutralUpperBound) {
    return "border-[#cbd5f5] bg-[#cbd5f51a] text-[#475569]";
  }

  return "border-[#6ee7b7] bg-[#6ee7b71a] text-[#047857]";
}

function PriceSkeleton({ width = "w-16" }: { width?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-4 animate-pulse rounded bg-muted",
        width,
      )}
      aria-hidden="true"
    />
  );
}

function renderPriceChange(value: number | null, isLoading?: boolean) {
  if (isLoading || value === null || typeof value === "undefined") {
    return <PriceSkeleton width="w-14" />;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-500">
          <ArrowUpRight className="h-3 w-3" />
          {formatPercentChange(value)}
        </span>
      );
    }

    if (value < 0) {
      return (
        <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-500">
          <ArrowDownRight className="h-3 w-3" />
          {formatPercentChange(value)}
        </span>
      );
    }
  }

  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums">
      <Minus className="h-3 w-3" />
      {formatPercentChange(value)}
    </span>
  );
}

function buildMarketUrl(provider: SourceProvider, symbol: string | null | undefined): string | null {
  if (!symbol) {
    return null;
  }
  if (provider === "lighter") {
    return `https://app.lighter.xyz/trade/${encodeURIComponent(symbol)}`;
  }
  if (provider === "grvt") {
    const base = symbol
      .replace(/[-_/]?PERP$/i, "")
      .replace(/[_/]/g, "-")
      .trim()
      .toUpperCase();
    if (!base) {
      return null;
    }
    const pair = base.includes("-") ? base : `${base}-USDT`;
    return `https://grvt.io/exchange/perpetual/${encodeURIComponent(pair)}`;
  }
  if (provider === "hyperliquid") {
    return `https://app.hyperliquid.xyz/trade/${encodeURIComponent(symbol)}`;
  }
  return null;
}

function formatFundingPeriodHours(
  provider: SourceProvider,
  value: number | null | undefined,
): string {
  if (provider === "lighter") {
    return "1h";
  }

  const normalized =
    Number.isFinite(value) && value !== null ? Number(value) : null;
  if (!normalized || !Number.isFinite(normalized)) {
    return "—";
  }
  const display =
    Number.isInteger(normalized) || normalized >= 10
      ? normalized.toString()
      : normalized.toFixed(2).replace(/\.?0+$/, "");
  return `${display}h`;
}

function PerpTableRowComponent({
  row,
  liveFunding,
  displayPeriodHours,
  onHistoryClick,
  leftSourceLabel,
  rightSourceLabel,
  loadingPrices = false,
}: PerpTableRowProps) {
  const iconCandidates = useMemo(
    () => buildTokenIconCandidates(row.symbol, row.iconUrl),
    [row.symbol, row.iconUrl],
  );
  const [iconCandidateIndex, setIconCandidateIndex] = useState(0);
  const iconSrc =
    iconCandidates[iconCandidateIndex] ?? makeFallbackSvgDataUrl(row.symbol);

  const leftHourly =
    liveFunding.left[row.leftSymbol] ?? row.fundingRate;
  const aggregatedFunding = leftHourly * displayPeriodHours;
  const leftEightHourFunding =
    leftHourly * ARBITRAGE_COLOR_WINDOW_HOURS;
  const marketUrl = buildMarketUrl(row.leftProvider, row.leftSymbol);
  const externalHourly =
    row.right?.symbol != null
      ? liveFunding.right[row.right.symbol] ??
        row.right.fundingRate ??
        null
      : null;
  const externalMaxLeverage = row.right?.maxLeverage ?? null;
  const externalFundingAggregated =
    externalHourly !== null ? externalHourly * displayPeriodHours : null;
  const externalEightHourFunding =
    externalHourly !== null
      ? externalHourly * ARBITRAGE_COLOR_WINDOW_HOURS
      : null;
  const externalVolume = row.right?.volumeUsd ?? null;
  const hourlyArbDelta =
    externalHourly !== null ? externalHourly - leftHourly : null;
  const externalHref = row.right
    ? buildMarketUrl(row.right.source, row.right.symbol)
    : null;
  const absArbDelta =
    hourlyArbDelta !== null ? Math.abs(hourlyArbDelta) : null;
  const colorArbDelta =
    hourlyArbDelta !== null
      ? hourlyArbDelta * ARBITRAGE_COLOR_WINDOW_HOURS
      : null;
  const colorAbsArbDelta =
    colorArbDelta !== null ? Math.abs(colorArbDelta) : null;
  const leftFundingPeriodLabel = formatFundingPeriodHours(
    row.leftProvider,
    row.leftFundingPeriodHours,
  );
  const rightFundingPeriodLabel = formatFundingPeriodHours(
    row.right?.source ?? row.rightProvider,
    row.right?.fundingPeriodHours ?? null,
  );

  let arbitrageBadgeClass =
    "border-border bg-muted/80 text-muted-foreground";
  let leftDirClass = "text-muted-foreground";
  let externalDirClass = "text-muted-foreground";
  let leftDirLabel = "—";
  let externalDirLabel = "—";
  const isSmallArbitrage =
    colorAbsArbDelta !== null && colorAbsArbDelta < 0.0001;

  if (colorArbDelta !== null) {
    if (colorArbDelta > 0) {
      leftDirLabel = "做多";
      leftDirClass = "text-emerald-500";
      externalDirLabel = "做空";
      externalDirClass = "text-red-500";
    } else if (colorArbDelta < 0) {
      leftDirLabel = "做空";
      leftDirClass = "text-red-500";
      externalDirLabel = "做多";
      externalDirClass = "text-emerald-500";
    }

    if (isSmallArbitrage) {
      arbitrageBadgeClass =
        "border-border bg-muted/80 text-muted-foreground";
    } else if (colorArbDelta > 0) {
      arbitrageBadgeClass =
        "border-emerald-200 bg-emerald-50 text-emerald-600";
    } else if (colorArbDelta < 0) {
      arbitrageBadgeClass = "border-red-200 bg-red-50 text-red-600";
    }
  }

  return (
    <TableRow key={row.symbol} className="hover:bg-muted/40">
      <TableCell className="py-3 text-sm font-semibold text-foreground min-w-[190px]">
        <div className="flex items-center gap-2.5">
          {loadingPrices ? (
            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-border/30 bg-muted/60">
              <span className="sr-only">加载中</span>
            </div>
          ) : (
            <img
              src={iconSrc}
              alt={`${row.displayName} 图标`}
              className="h-7 w-7 flex-shrink-0 rounded-full border border-border/30 bg-background object-contain"
              loading="lazy"
              onError={() => {
                setIconCandidateIndex((prev) =>
                  prev + 1 < iconCandidates.length ? prev + 1 : prev,
                );
              }}
            />
          )}
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-semibold text-foreground">
              {row.displayName}
            </span>
            <span className="truncate text-[11px] uppercase text-muted-foreground">
              {row.symbol}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="font-medium tabular-nums text-sm">
        {loadingPrices ? <PriceSkeleton width="w-20" /> : formatPrice(row.markPrice)}
      </TableCell>
      <TableCell className="text-xs font-medium">
        {renderPriceChange(row.priceChange24h, loadingPrices)}
      </TableCell>
      <TableCell className="font-medium tabular-nums text-sm">
        {row.maxLeverage ?? "—"}
      </TableCell>
      <TableCell className="font-medium tabular-nums text-sm">
        {externalMaxLeverage != null ? externalMaxLeverage : "—"}
      </TableCell>
      <TableCell>
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            {marketUrl ? (
              <a
                href={marketUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex"
              >
                <Badge
                  variant="secondary"
                  className={cn(
                    "font-medium text-xs",
                    leftEightHourFunding != null
                      ? getFundingBadgeClass(leftEightHourFunding)
                      : "border border-border/80 bg-muted/40 text-muted-foreground",
                  )}
                >
                  {formatFundingRate(aggregatedFunding)}
                </Badge>
              </a>
            ) : (
              <span className="inline-flex">
                <Badge
                  variant="secondary"
                  className={cn(
                    "font-medium text-xs",
                    leftEightHourFunding != null
                      ? getFundingBadgeClass(leftEightHourFunding)
                      : "border border-border/80 bg-muted/40 text-muted-foreground",
                  )}
                >
                  {formatFundingRate(aggregatedFunding)}
                </Badge>
              </span>
            )}
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{describeFundingDirection(aggregatedFunding)}</p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              {formatAnnualizedFunding(leftHourly)}
            </p>
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        {externalFundingAggregated !== null && row.right?.symbol ? (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              {externalHref ? (
                <a
                  href={externalHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex"
                >
                  <Badge
                    variant="secondary"
                    className={cn(
                      "font-medium text-xs",
                      getFundingBadgeClass(externalEightHourFunding ?? 0),
                    )}
                  >
                    {formatFundingRate(externalFundingAggregated)}
                  </Badge>
                </a>
              ) : (
                <Badge
                  variant="secondary"
                  className={cn(
                    "font-medium text-xs",
                    getFundingBadgeClass(externalEightHourFunding ?? 0),
                  )}
                >
                  {formatFundingRate(externalFundingAggregated)}
                </Badge>
              )}
            </TooltipTrigger>
            <TooltipContent side="top">
              <p>{describeFundingDirection(externalFundingAggregated)}</p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {formatAnnualizedFunding(externalHourly ?? 0)}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Badge
            variant="secondary"
            className="font-medium text-xs border-border bg-muted/80 text-muted-foreground"
          >
            —
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-xs font-medium tabular-nums text-muted-foreground">
        {leftFundingPeriodLabel}
      </TableCell>
      <TableCell className="text-xs font-medium tabular-nums text-muted-foreground">
        {row.right ? rightFundingPeriodLabel : "—"}
      </TableCell>
      <TableCell>
        {absArbDelta !== null ? (
          <Tooltip delayDuration={100}>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className={cn("font-medium text-xs", arbitrageBadgeClass)}
              >
                {formatFundingRate(absArbDelta)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top">
              <p className="text-[10px] text-muted-foreground">
                {isSmallArbitrage ? "套利空间（8h） < 0.01% · " : ""}
                {leftSourceLabel}{" "}
                <span className={leftDirClass}>{leftDirLabel}</span> ·
                {rightSourceLabel}{" "}
                <span className={externalDirClass}>{externalDirLabel}</span>
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">
                年化 {computeAnnualizedPercent(absArbDelta)}
              </p>
            </TooltipContent>
          </Tooltip>
        ) : (
          <Badge
            variant="secondary"
            className="font-medium text-xs border-border bg-muted/80 text-muted-foreground"
          >
            —
          </Badge>
        )}
      </TableCell>
      <TableCell className="font-medium tabular-nums text-sm">
        {formatVolume(row.dayNotionalVolume)}
      </TableCell>
      <TableCell className="font-medium tabular-nums text-sm">
        {formatVolume(externalVolume)}
      </TableCell>
      <TableCell className="text-xs">
        <Tooltip delayDuration={100}>
          <TooltipTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => onHistoryClick(row)}
              aria-label="查看资金费率历史"
            >
              <LineChartIcon className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">查看资金费率历史</TooltipContent>
        </Tooltip>
      </TableCell>
    </TableRow>
  );
}

export const PerpTableRow = memo(PerpTableRowComponent);
