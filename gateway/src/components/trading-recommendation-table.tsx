"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SquareArrowOutUpRight } from "lucide-react";

import type { FundingPredictionEntry, FundingPredictionSnapshot } from "@/lib/funding-prediction";
import { buildTokenIconCandidates, makeFallbackSvgDataUrl } from "@/lib/token-icons";
import type { SourceConfig } from "@/lib/external";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";

type Props = {
  sourceA: SourceConfig;
  sourceB: SourceConfig;
  volumeThreshold: number;
  onTrade: (entry: FundingPredictionEntry) => void;
};

const POLL_INTERVAL_MS = 30_000;
const JOB_POLL_MS = 700;

function formatDecimalPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
function formatPercent(value: number): string { return `${value.toFixed(1)}%`; }
function formatBps(bps: number): string { return `${bps.toFixed(1)} bps`; }

export function TradingRecommendationTable({ sourceA, sourceB, volumeThreshold, onTrade }: Props) {
  const [data, setData] = useState<FundingPredictionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async (force: boolean) => {
    try {
      const createResp = await fetch("/api/funding/prediction/jobs", {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceA: sourceA.provider, sourceB: sourceB.provider, volumeThreshold, forceRefresh: force }),
      });
      if (!createResp.ok) throw new Error("Failed to create prediction job");
      const { jobId } = (await createResp.json()) as { jobId: string };

      while (true) {
        const statusResp = await fetch(`/api/funding/prediction/jobs/${jobId}`, { cache: "no-store" });
        if (!statusResp.ok) throw new Error("Failed to poll job");
        const status = (await statusResp.json()) as { status: string; result?: FundingPredictionSnapshot; error?: string };
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
  const failuresText = data?.failures?.length ? `，${data.failures.length} 个币种因数据缺失暂不可用` : "";

  return (
    <div className="flex flex-col h-full bg-card">
      <div className="flex items-center justify-between px-6 py-3 border-b border-border">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">套利推荐</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            基于预测年化 APR 评分{loading ? "，刷新中…" : failuresText}
          </p>
        </div>
        <button
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded"
          onClick={() => { setLoading(true); void fetchRecommendations(true); }}
          disabled={loading}
        >
          {loading ? "刷新中..." : "强制刷新"}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {error && <div className="px-6 py-3 text-sm text-destructive bg-destructive/5">{error}</div>}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[140px]">币种</TableHead>
              <TableHead>方向</TableHead>
              <TableHead>年化APR</TableHead>
              <TableHead>当前费率差</TableHead>
              <TableHead>波动率</TableHead>
              <TableHead>点差(L)</TableHead>
              <TableHead>点差(G)</TableHead>
              <TableHead>持仓天</TableHead>
              <TableHead>综合分</TableHead>
              <TableHead>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((entry) => (
              <RecommendationRow key={entry.symbol} entry={entry} onTrade={onTrade} />
            ))}
            {!loading && entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-8 text-center text-muted-foreground">
                  暂无推荐数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {loading && entries.length === 0 && (
          <div className="px-6 py-8 text-center text-sm text-muted-foreground">加载推荐数据中...</div>
        )}
      </div>
    </div>
  );
}

function RecommendationRow({ entry, onTrade }: { entry: FundingPredictionEntry; onTrade: (e: FundingPredictionEntry) => void }) {
  const [iconIdx, setIconIdx] = useState(0);
  const iconCandidates = useMemo(() => buildTokenIconCandidates(entry.symbol, entry.iconUrl), [entry.symbol, entry.iconUrl]);
  const iconSrc = iconCandidates[iconIdx] ?? makeFallbackSvgDataUrl(entry.symbol);

  const dirLabel = entry.direction === "leftLong" ? "做多 Lighter" : entry.direction === "rightLong" ? "做多 GRVT" : "未知";
  const scoreColor = entry.recommendationScore >= 60 ? "text-green-600" : entry.recommendationScore >= 30 ? "text-yellow-600" : "text-red-600";
  const currentPctColor = entry.currentDirectionalAnnualizedPct >= 0 ? "text-emerald-600" : "text-rose-600";

  return (
    <TableRow className="hover:bg-muted/30 transition-colors">
      <TableCell className="py-3 text-sm font-semibold text-foreground">
        <div className="flex items-center gap-2">
          <img src={iconSrc} alt={entry.displayName} className="h-6 w-6 rounded-full" onError={() => setIconIdx((i) => i + 1)} />
          <span>{entry.displayName}</span>
        </div>
      </TableCell>
      <TableCell className="text-xs">
        <span className={entry.direction === "leftLong" ? "text-blue-600" : "text-orange-600"}>{dirLabel}</span>
      </TableCell>
      <TableCell className="font-semibold text-primary">{formatDecimalPercent(entry.annualizedDecimal)}</TableCell>
      <TableCell className={`font-semibold ${currentPctColor}`}>
        {entry.currentDirectionalAnnualizedPct >= 0 ? "+" : ""}{entry.currentDirectionalAnnualizedPct.toFixed(2)}%
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatPercent(entry.priceVolatility24hPct)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatBps(entry.leftBidAskSpreadBps)}</TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatBps(entry.rightBidAskSpreadBps)}</TableCell>
      <TableCell className="text-xs font-mono text-muted-foreground">{entry.holdingDays.toFixed(1)}d</TableCell>
      <TableCell className={`text-sm font-semibold ${scoreColor}`}>{entry.recommendationScore.toFixed(0)}</TableCell>
      <TableCell>
        <button
          className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={() => onTrade(entry)}
        >
          建仓
        </button>
      </TableCell>
    </TableRow>
  );
}
