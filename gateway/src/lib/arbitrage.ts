import type { SourceConfig } from "@/lib/external";
import type { ApiError } from "@/types/api";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export type ArbitrageDirection = "leftLong" | "rightLong" | "unknown";

export type ArbitrageAnnualizedEntry = {
  symbol: string;
  displayName: string;
  leftSymbol: string;
  rightSymbol: string;
  leftVolume24h: number | null;
  rightVolume24h: number | null;
  totalDecimal: number;
  averageHourlyDecimal: number;
  annualizedDecimal: number;
  sampleCount: number;
  direction: ArbitrageDirection;
};

export type ArbitrageAnnualizedSnapshot = {
  entries: ArbitrageAnnualizedEntry[];
  failures: Array<{ symbol: string; reason: string }>;
  fetchedAt: Date | null;
  errors: ApiError[];
};

export async function fetchArbitrageSnapshot(
  primarySource: SourceConfig,
  secondarySource: SourceConfig,
  volumeThreshold: number,
  forceRefresh: boolean = false,
): Promise<ArbitrageAnnualizedSnapshot> {
  const upstream = `${TRADER_API_BASE_URL.replace(/\/$/, "")}/arbitrage`;
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
    const message = payload.error || "无法获取套利年化数据";
    throw new Error(message);
  }

  const fetchedAt = payload.fetched_at ? new Date(payload.fetched_at) : null;
  const entries: ArbitrageAnnualizedEntry[] = (payload.entries ?? []).map(
    (entry) => ({
      symbol: String(entry.symbol ?? ""),
      displayName: String(entry.display_name ?? entry.symbol ?? ""),
      leftSymbol: String(entry.left_symbol ?? ""),
      rightSymbol: String(entry.right_symbol ?? ""),
      leftVolume24h:
        entry.left_volume_24h != null ? Number(entry.left_volume_24h) : null,
      rightVolume24h:
        entry.right_volume_24h != null ? Number(entry.right_volume_24h) : null,
      totalDecimal: Number(entry.total_decimal ?? 0),
      averageHourlyDecimal: Number(entry.average_hourly_decimal ?? 0),
      annualizedDecimal: Number(entry.annualized_decimal ?? 0),
      sampleCount: Number(entry.sample_count ?? 0),
      direction: (entry.direction as ArbitrageDirection) ?? "unknown",
    }),
  );

  return {
    entries,
    failures: payload.failures ?? [],
    fetchedAt,
    errors: payload.errors ?? [],
  };
}
