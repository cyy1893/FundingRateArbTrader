"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import type { FundingPredictionEntry, FundingPredictionSnapshot } from "@/lib/funding-prediction";
import { buildTokenIconCandidates, makeFallbackSvgDataUrl } from "@/lib/token-icons";
import type { SourceConfig } from "@/lib/external";

type Props = {
  sourceA: SourceConfig;
  sourceB: SourceConfig;
  volumeThreshold: number;
  onTrade: (entry: FundingPredictionEntry) => void;
};

const POLL_INTERVAL_MS = 30_000; // refresh every 30s
const JOB_POLL_MS = 700;

export function TradingRecommendationTable({ sourceA, sourceB, volumeThreshold, onTrade }: Props) {
  const [data, setData] = useState<FundingPredictionSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRecommendations = useCallback(async (force: boolean) => {
    try {
      // Create job
      const createResp = await fetch("/api/funding/prediction/jobs", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceA: sourceA.provider,
          sourceB: sourceB.provider,
          volumeThreshold,
          forceRefresh: force,
        }),
      });
      if (!createResp.ok) throw new Error("Failed to create prediction job");
      const { jobId } = (await createResp.json()) as { jobId: string };

      // Poll until done
      while (true) {
        const statusResp = await fetch(`/api/funding/prediction/jobs/${jobId}`, {
          cache: "no-store",
        });
        if (!statusResp.ok) throw new Error("Failed to poll job");
        const status = (await statusResp.json()) as {
          status: string;
          result?: FundingPredictionSnapshot;
          error?: string;
        };
        if (status.status === "completed" && status.result) {
          setData(status.result);
          setLoading(false);
          setError(null);
          return;
        }
        if (status.status === "failed") {
          throw new Error(status.error || "Prediction failed");
        }
        await new Promise((r) => setTimeout(r, JOB_POLL_MS));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load recommendations");
      setLoading(false);
    }
  }, [sourceA.provider, sourceB.provider, volumeThreshold]);

  // Initial load
  useEffect(() => {
    void fetchRecommendations(false);
  }, [fetchRecommendations]);

  // Auto-refresh
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchRecommendations(false);
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchRecommendations]);

  const entries = useMemo(() => (data?.entries ?? []).slice(0, 20), [data]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <h2 className="text-sm font-semibold">
          套利推荐
          {data && <span className="ml-2 text-xs text-muted-foreground">({data.entries.length} 个币种)</span>}
        </h2>
        <button
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => { setLoading(true); void fetchRecommendations(true); }}
          disabled={loading}
        >
          {loading ? "刷新中..." : "强制刷新"}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {error && (
          <div className="px-4 py-3 text-sm text-destructive bg-destructive/5">{error}</div>
        )}

        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/50">
            <tr className="border-b border-border text-left text-muted-foreground">
              <th className="px-3 py-2 font-medium">币种</th>
              <th className="px-3 py-2 font-medium">方向</th>
              <th className="px-3 py-2 font-medium text-right">年化APR</th>
              <th className="px-3 py-2 font-medium text-right">波动率</th>
              <th className="px-3 py-2 font-medium text-right">持仓天数</th>
              <th className="px-3 py-2 font-medium text-right">评分</th>
              <th className="px-3 py-2 font-medium text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <RecommendationRow key={entry.symbol} entry={entry} onTrade={onTrade} />
            ))}
            {!loading && entries.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-muted-foreground">
                  暂无推荐数据
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {loading && entries.length === 0 && (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            加载推荐数据中...
          </div>
        )}
      </div>
    </div>
  );
}

function RecommendationRow({
  entry,
  onTrade,
}: {
  entry: FundingPredictionEntry;
  onTrade: (entry: FundingPredictionEntry) => void;
}) {
  const [iconSrc, setIconSrc] = useState<string | null>(null);
  const [iconIdx, setIconIdx] = useState(0);

  const iconCandidates = useMemo(
    () => buildTokenIconCandidates(entry.symbol, entry.iconUrl),
    [entry.symbol, entry.iconUrl],
  );

  useEffect(() => {
    setIconSrc(iconCandidates[iconIdx] ?? makeFallbackSvgDataUrl(entry.symbol));
  }, [iconCandidates, iconIdx, entry.symbol]);

  const dirLabel = entry.direction === "leftLong" ? "做多 Lighter" : entry.direction === "rightLong" ? "做多 GRVT" : "未知";
  const scoreColor =
    entry.recommendationScore >= 60 ? "text-green-600" : entry.recommendationScore >= 30 ? "text-yellow-600" : "text-red-600";

  return (
    <tr className="border-b border-border hover:bg-muted/30 transition-colors">
      <td className="px-3 py-2">
        <div className="flex items-center gap-2">
          <img
            src={iconSrc ?? makeFallbackSvgDataUrl(entry.symbol)}
            alt={entry.displayName}
            className="h-5 w-5 rounded-full"
            onError={() => setIconIdx((i) => i + 1)}
          />
          <span className="font-medium">{entry.displayName}</span>
        </div>
      </td>
      <td className="px-3 py-2">
        <span className={entry.direction === "leftLong" ? "text-blue-600" : "text-orange-600"}>
          {dirLabel}
        </span>
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {(entry.annualizedDecimal * 100).toFixed(2)}%
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {entry.priceVolatility24hPct.toFixed(1)}%
      </td>
      <td className="px-3 py-2 text-right font-mono">
        {entry.holdingDays.toFixed(1)}d
      </td>
      <td className={`px-3 py-2 text-right font-mono font-semibold ${scoreColor}`}>
        {entry.recommendationScore.toFixed(0)}
      </td>
      <td className="px-3 py-2 text-center">
        <button
          className="rounded-md bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
          onClick={() => onTrade(entry)}
        >
          建仓
        </button>
      </td>
    </tr>
  );
}
