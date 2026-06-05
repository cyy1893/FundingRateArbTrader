"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SquareArrowOutUpRight } from "lucide-react";

import type { FundingPredictionEntry, FundingPredictionSnapshot } from "@/lib/funding-prediction";
import { buildTokenIconCandidates, makeFallbackSvgDataUrl, recordIconLoad } from "@/lib/token-icons";
import type { SourceConfig } from "@/lib/external";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

// ── helpers (mirror funding-prediction-sidebar.tsx) ──────────────────────

function formatDecimalPercent(value: number): string { return `${(value * 100).toFixed(2)}%`; }
function formatSignedPercent(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}%`;
}
function formatPercent(value: number): string { return `${value.toFixed(1)}%`; }
function formatBps(bps: number): string { return `${bps.toFixed(1)} bps`; }

// ── component ───────────────────────────────────────────────────────────

type Props = {
  sourceA: SourceConfig;
  sourceB: SourceConfig;
  volumeThreshold: number;
  onTrade: (entry: FundingPredictionEntry) => void;
};

const POLL_INTERVAL_MS = 30_000;
const JOB_POLL_MS = 700;

export function TradingRecommendationTable({ sourceA, sourceB, volumeThreshold, onTrade }: Props) {
  const [data, setData] = useState<FundingPredictionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async (force: boolean) => {
    try {
      const createResp = await fetch("/api/funding/prediction/jobs", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceA: sourceA.provider, sourceB: sourceB.provider,
          volumeThreshold, forceRefresh: force,
        }),
      });
      if (!createResp.ok) throw new Error("Failed to create prediction job");
      const { jobId } = (await createResp.json()) as { jobId: string };

      while (true) {
        const statusResp = await fetch(`/api/funding/prediction/jobs/${jobId}`, { cache: "no-store" });
        if (!statusResp.ok) throw new Error("Failed to poll job");
        const status = (await statusResp.json()) as {
          status: string; result?: FundingPredictionSnapshot; metadata?: { volumeLabel: string; primarySourceLabel: string; secondarySourceLabel: string }; error?: string;
        };
        if (status.status === "completed" && status.result) {
          setData(status.result); setLoading(false); setError(null); return;
        }
        if (status.status === "failed") throw new Error(status.error || "Prediction failed");
        await new Promise((r) => setTimeout(r, JOB_POLL_MS));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recommendations");
      setLoading(false);
    }
  }, [sourceA.provider, sourceB.provider, volumeThreshold]);

  useEffect(() => { void fetchRecommendations(false); }, [fetchRecommendations]);
  useEffect(() => {
    const interval = setInterval(() => { void fetchRecommendations(false); }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchRecommendations]);

  const entries = useMemo(() => (data?.entries ?? []).slice(0, 20), [data]);
  const volumeLabel = `两端合计 ≥ US$${((volumeThreshold || 1_000_000) / 1_000_000).toFixed(2)}M`;

  const sourceALabel = sourceA.label;
  const sourceBLabel = sourceB.label;

  return (
    <div className="flex flex-col h-full">
      <div className="space-y-4 p-4">
        <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
          <div>
            注：预测年化 APR 采用"沿当前有利方向持有，直到不再盈利"为口径；评分偏好高 APR、低价格波动、低点差。"建议建仓时机"仅用于提示，不参与综合分。仅显示 {volumeLabel} 的币种。
          </div>
          {data && data.failures.length > 0 ? (
            <div className="mt-2">
              {data.failures.length} 个币种因数据缺失暂不可用。
            </div>
          ) : null}
        </div>

        {error && <div className="text-sm text-destructive bg-destructive/5 rounded p-2">{error}</div>}

        <div className="overflow-x-auto">
          <Table className="w-auto whitespace-nowrap [&_th]:text-left [&_td]:text-left">
            <TableHeader>
              <TableRow className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <TableHead>币种</TableHead>
                <TableHead>方向</TableHead>
                <TableHead>预测年化 APR</TableHead>
                <TableHead>当前方向年化 APR</TableHead>
                <TableHead>价格波动率(24h估算)</TableHead>
                <TableHead>点差(Lighter)</TableHead>
                <TableHead>点差(GRVT)</TableHead>
                <TableHead>综合分</TableHead>
                <TableHead>去交易</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.symbol}>
                  <TableCell className="min-w-[190px] py-3">
                    <RecommendationSymbolCell
                      symbol={entry.symbol}
                      displayName={entry.displayName}
                      iconUrl={entry.iconUrl}
                    />
                  </TableCell>
                  <TableCell className="text-xs">{renderDirection(entry, sourceALabel, sourceBLabel)}</TableCell>
                  <TableCell className="font-semibold text-primary">{formatDecimalPercent(entry.annualizedDecimal)}</TableCell>
                  <TableCell className="font-semibold">{formatSignedPercent(entry.currentDirectionalAnnualizedPct)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatPercent(entry.priceVolatility24hPct)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatBps(entry.leftBidAskSpreadBps)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{formatBps(entry.rightBidAskSpreadBps)}</TableCell>
                  <TableCell className="text-sm font-semibold">{entry.recommendationScore.toFixed(2)}</TableCell>
                  <TableCell>
                    <button
                      onClick={() => onTrade(entry)}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      title="建仓"
                    >
                      <SquareArrowOutUpRight className="h-4 w-4" />
                    </button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {loading && entries.length === 0 && (
          <div className="py-8 text-center text-sm text-muted-foreground">加载推荐数据中...</div>
        )}
        {!loading && entries.length === 0 && !error && (
          <div className="py-8 text-center text-sm text-muted-foreground">暂无推荐数据</div>
        )}
      </div>
    </div>
  );
}

// ── sub-components (mirror funding-prediction-sidebar.tsx) ────────────

function RecommendationSymbolCell({
  symbol, displayName, iconUrl,
}: { symbol: string; displayName: string; iconUrl: string | null }) {
  const iconCandidates = useMemo(() => buildTokenIconCandidates(symbol, iconUrl), [symbol, iconUrl]);
  const [iconCandidateIndex, setIconCandidateIndex] = useState(0);
  const iconSrc = iconCandidates[iconCandidateIndex] ?? makeFallbackSvgDataUrl(symbol);

  return (
    <div className="flex items-center gap-2.5">
      <img
        src={iconSrc}
        alt={`${displayName} 图标`}
        className="h-7 w-7 flex-shrink-0 rounded-full border border-border/30 bg-background object-contain"
        loading="lazy"
        onLoad={() => { if (symbol) recordIconLoad(symbol, iconSrc); }}
        onError={() => { setIconCandidateIndex((current) => current + 1); }}
      />
      <div className="flex flex-col overflow-hidden">
        <span className="truncate text-sm font-semibold text-foreground">{displayName}</span>
        <span className="truncate text-[11px] uppercase text-muted-foreground">{symbol}</span>
      </div>
    </div>
  );
}

function renderDirection(entry: FundingPredictionEntry, primaryLabel: string, secondaryLabel: string) {
  if (entry.direction === "leftLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
          <span className="inline-block rounded-[2px] bg-emerald-100 px-1 py-0.5 text-[10px] leading-none text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">多</span>
          {primaryLabel}
        </p>
        <p className="flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-block rounded-[2px] bg-rose-100 px-1 py-0.5 text-[10px] leading-none text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">空</span>
          {secondaryLabel}
        </p>
      </div>
    );
  }
  if (entry.direction === "rightLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-block rounded-[2px] bg-rose-100 px-1 py-0.5 text-[10px] leading-none text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">空</span>
          {primaryLabel}
        </p>
        <p className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
          <span className="inline-block rounded-[2px] bg-emerald-100 px-1 py-0.5 text-[10px] leading-none text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">多</span>
          {secondaryLabel}
        </p>
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">未知</span>;
}
