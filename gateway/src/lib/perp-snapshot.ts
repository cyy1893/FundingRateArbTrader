import type { ApiError } from "@/types/api";
import type { MarketRow } from "@/types/market";
import type { SourceConfig, SourceProvider } from "@/lib/external";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export type PerpSnapshot = {
  rows: MarketRow[];
  fetchedAt: Date;
  errors: ApiError[];
};

export async function getPerpetualSnapshot(
  primarySource: SourceConfig,
  secondarySource: SourceConfig,
): Promise<PerpSnapshot> {
  const upstream = `${TRADER_API_BASE_URL.replace(/\/$/, "")}/perp-snapshot`;
  const response = await fetch(upstream, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      primary_source: primarySource.provider,
      secondary_source: secondarySource.provider,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `无法从后端获取聚合盘口数据（${response.status}）：${message || "未知错误"}`,
    );
  }

  const payload = (await response.json()) as {
    rows?: Array<Record<string, unknown>>;
    fetched_at?: string;
    errors?: ApiError[];
  };

  const normalizeRow = (row: Record<string, unknown>): MarketRow => {
    const rightRaw = (row.right as Record<string, unknown> | null) ?? null;
    const right = rightRaw
      ? {
          source: (rightRaw.source as SourceProvider) ?? secondarySource.provider,
          symbol: String(rightRaw.symbol ?? ""),
          maxLeverage:
            typeof rightRaw.max_leverage === "number"
              ? rightRaw.max_leverage
              : null,
          fundingRate:
            typeof rightRaw.funding_rate === "number"
              ? rightRaw.funding_rate
              : null,
          volumeUsd:
            typeof rightRaw.volume_usd === "number"
              ? rightRaw.volume_usd
              : null,
          fundingPeriodHours:
            typeof rightRaw.funding_period_hours === "number"
              ? rightRaw.funding_period_hours
              : null,
        }
      : null;

    return {
      leftProvider:
        (row.left_provider as SourceProvider) ?? primarySource.provider,
      rightProvider:
        (row.right_provider as SourceProvider) ?? secondarySource.provider,
      leftSymbol: String(row.left_symbol ?? ""),
      leftFundingPeriodHours:
        typeof row.left_funding_period_hours === "number"
          ? row.left_funding_period_hours
          : null,
      symbol: String(row.symbol ?? ""),
      displayName: String(row.display_name ?? row.symbol ?? ""),
      iconUrl: (row.icon_url as string | null) ?? null,
      coingeckoId: (row.coingecko_id as string | null) ?? null,
      markPrice:
        typeof row.mark_price === "number" ? row.mark_price : Number(row.mark_price ?? 0),
      priceChange1h:
        typeof row.price_change_1h === "number"
          ? row.price_change_1h
          : null,
      priceChange24h:
        typeof row.price_change_24h === "number"
          ? row.price_change_24h
          : null,
      priceChange7d:
        typeof row.price_change_7d === "number"
          ? row.price_change_7d
          : null,
      maxLeverage:
        typeof row.max_leverage === "number" ? row.max_leverage : 0,
      fundingRate:
        typeof row.funding_rate === "number" ? row.funding_rate : 0,
      dayNotionalVolume:
        typeof row.day_notional_volume === "number"
          ? row.day_notional_volume
          : null,
      openInterest:
        typeof row.open_interest === "number"
          ? row.open_interest
          : Number(row.open_interest ?? 0),
      volumeUsd:
        typeof row.volume_usd === "number" ? row.volume_usd : null,
      right,
    };
  };

  const rows = (payload.rows ?? []).map((row) => normalizeRow(row ?? {}));

  return {
    rows,
    fetchedAt: payload.fetched_at ? new Date(payload.fetched_at) : new Date(),
    errors: payload.errors ?? [],
  };
}
