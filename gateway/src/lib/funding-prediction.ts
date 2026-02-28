import type { SourceConfig } from "@/lib/external";
import type { ApiError } from "@/types/api";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export type FundingPredictionDirection = "leftLong" | "rightLong" | "unknown";

export type FundingPredictionEntry = {
  symbol: string;
  displayName: string;
  leftSymbol: string;
  rightSymbol: string;
  leftVolume24h: number | null;
  rightVolume24h: number | null;
  predictedLeft24h: number | null;
  predictedRight24h: number | null;
  predictedSpread24h: number;
  averageLeftHourly: number | null;
  averageRightHourly: number | null;
  averageSpreadHourly: number;
  totalDecimal: number;
  annualizedDecimal: number;
  spreadVolatility24hPct: number;
  priceVolatility24hPct: number;
  leftBidAskSpreadBps: number;
  rightBidAskSpreadBps: number;
  combinedBidAskSpreadBps: number;
  leftSpreadSamplesBps: number[];
  rightSpreadSamplesBps: number[];
  combinedSpreadSamplesBps: number[];
  recommendationScore: number;
  sampleCount: number;
  direction: FundingPredictionDirection;
  entryTimingWaitHours: number;
  entryTimingAdvice: string;
};

export type FundingPredictionSnapshot = {
  entries: FundingPredictionEntry[];
  failures: Array<{ symbol: string; reason: string }>;
  fetchedAt: Date | null;
  errors: ApiError[];
};

export async function fetchFundingPredictionSnapshot(
  primarySource: SourceConfig,
  secondarySource: SourceConfig,
  volumeThreshold: number,
  forceRefresh: boolean = false,
): Promise<FundingPredictionSnapshot> {
  const upstream = `${TRADER_API_BASE_URL.replace(/\/$/, "")}/funding-prediction`;
  const response = await fetch(upstream, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      primary_source: primarySource.provider,
      secondary_source: secondarySource.provider,
      volume_threshold: volumeThreshold,
      force_refresh: forceRefresh,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    entries?: Array<Record<string, unknown>>;
    failures?: Array<{ symbol: string; reason: string }>;
    fetched_at?: string | null;
    errors?: ApiError[];
    error?: string;
  };

  if (!response.ok || !payload.entries) {
    const message = payload.error || "无法获取推荐套利数据";
    throw new Error(message);
  }

  const fetchedAt = payload.fetched_at ? new Date(payload.fetched_at) : null;
  const entries: FundingPredictionEntry[] = (payload.entries ?? []).map(
    (entry) => ({
      symbol: String(entry.symbol ?? ""),
      displayName: String(entry.display_name ?? entry.symbol ?? ""),
      leftSymbol: String(entry.left_symbol ?? ""),
      rightSymbol: String(entry.right_symbol ?? ""),
      leftVolume24h:
        entry.left_volume_24h != null ? Number(entry.left_volume_24h) : null,
      rightVolume24h:
        entry.right_volume_24h != null ? Number(entry.right_volume_24h) : null,
      predictedLeft24h:
        entry.predicted_left_24h != null
          ? Number(entry.predicted_left_24h)
          : null,
      predictedRight24h:
        entry.predicted_right_24h != null
          ? Number(entry.predicted_right_24h)
          : null,
      predictedSpread24h: Number(entry.predicted_spread_24h ?? 0),
      averageLeftHourly:
        entry.average_left_hourly != null
          ? Number(entry.average_left_hourly)
          : null,
      averageRightHourly:
        entry.average_right_hourly != null
          ? Number(entry.average_right_hourly)
          : null,
      averageSpreadHourly: Number(entry.average_spread_hourly ?? 0),
      totalDecimal: Number(entry.total_decimal ?? 0),
      annualizedDecimal: Number(entry.annualized_decimal ?? 0),
      spreadVolatility24hPct: Number(entry.spread_volatility_24h_pct ?? 0),
      priceVolatility24hPct: Number(entry.price_volatility_24h_pct ?? 0),
      leftBidAskSpreadBps: Number(entry.left_bid_ask_spread_bps ?? 0),
      rightBidAskSpreadBps: Number(entry.right_bid_ask_spread_bps ?? 0),
      combinedBidAskSpreadBps: Number(entry.combined_bid_ask_spread_bps ?? 0),
      leftSpreadSamplesBps: Array.isArray(entry.left_spread_samples_bps)
        ? entry.left_spread_samples_bps.map((value) => Number(value))
        : [],
      rightSpreadSamplesBps: Array.isArray(entry.right_spread_samples_bps)
        ? entry.right_spread_samples_bps.map((value) => Number(value))
        : [],
      combinedSpreadSamplesBps: Array.isArray(entry.combined_spread_samples_bps)
        ? entry.combined_spread_samples_bps.map((value) => Number(value))
        : [],
      recommendationScore: Number(entry.recommendation_score ?? 0),
      sampleCount: Number(entry.sample_count ?? 0),
      direction: (entry.direction as FundingPredictionDirection) ?? "unknown",
      entryTimingWaitHours: Number(entry.entry_timing_wait_hours ?? 0),
      entryTimingAdvice: String(entry.entry_timing_advice ?? "当前小时"),
    }),
  );

  return {
    entries,
    failures: payload.failures ?? [],
    fetchedAt,
    errors: payload.errors ?? [],
  };
}
