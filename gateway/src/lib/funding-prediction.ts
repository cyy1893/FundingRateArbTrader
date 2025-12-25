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
  sampleCount: number;
  direction: FundingPredictionDirection;
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
    const message = payload.error || "无法获取资金费率预测数据";
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
      sampleCount: Number(entry.sample_count ?? 0),
      direction: (entry.direction as FundingPredictionDirection) ?? "unknown",
    }),
  );

  return {
    entries,
    failures: payload.failures ?? [],
    fetchedAt,
    errors: payload.errors ?? [],
  };
}
