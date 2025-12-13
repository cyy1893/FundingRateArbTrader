import type { FundingHistoryPoint } from "@/types/funding";
import type { SourceConfig } from "@/lib/external";
import {
  LIGHTER_API_BASE_URL,
  normalizeLighterSymbol,
  parseLighterNumber,
  type LighterFundingsResponse,
  type LighterOrderBooksResponse,
} from "@/lib/lighter";

export const MS_PER_HOUR = 60 * 60 * 1000;
const MAX_HYPER_FUNDING_POINTS = 500;
const MAX_HYPER_LOOKBACK_MS = MAX_HYPER_FUNDING_POINTS * MS_PER_HOUR;

function normalizeTimestampToHour(value: number): number {
  return Math.floor(value / MS_PER_HOUR) * MS_PER_HOUR;
}

async function fetchHyperliquidFundingHistorySeries(
  symbol: string,
  startTime: number,
): Promise<Array<{ time: number; rate: number }>> {
  const response = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "fundingHistory",
      coin: symbol,
      startTime,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Hyperliquid funding history request failed.");
  }

  const data = (await response.json()) as Array<{
    time: number;
    fundingRate: string;
  }>;

  return data
    .map((entry) => {
      const time = normalizeTimestampToHour(entry.time);
      const rate = Number.parseFloat(entry.fundingRate);
      return Number.isFinite(rate) ? { time, rate } : null;
    })
    .filter((point): point is { time: number; rate: number } => point !== null);
}

async function fetchLighterFundingHistorySeries(
  symbol: string,
  startTime: number,
): Promise<Array<{ time: number; rate: number }>> {
  const normalizedSymbol = normalizeLighterSymbol(symbol);
  const baseSymbol = normalizedSymbol.endsWith("-PERP")
    ? normalizedSymbol.slice(0, -5)
    : normalizedSymbol;
  if (!baseSymbol) {
    throw new Error("Invalid Lighter symbol requested.");
  }

  const orderBooksResponse = await fetch(`${LIGHTER_API_BASE_URL}/api/v1/orderBooks`, {
    cache: "no-store",
  });

  if (!orderBooksResponse.ok) {
    throw new Error("Failed to load Lighter market metadata.");
  }

  const orderBooksPayload =
    (await orderBooksResponse.json()) as LighterOrderBooksResponse;
  const marketIdRaw = orderBooksPayload.order_books?.find(
    (market) => normalizeLighterSymbol(market.symbol) === baseSymbol,
  )?.market_id;
  const marketId = Number(marketIdRaw);

  if (marketId == null || !Number.isFinite(marketId)) {
    throw new Error("Unknown Lighter market.");
  }

  const endTimestampSeconds = Math.floor(Date.now() / 1000);
  const startTimestampSeconds = Math.max(Math.floor(startTime / 1000), 0);
  const durationHours = Math.max(
    1,
    Math.ceil((endTimestampSeconds - startTimestampSeconds) / 3600),
  );
  const params = new URLSearchParams({
    market_id: `${marketId}`,
    resolution: "1h",
    start_timestamp: `${startTimestampSeconds}`,
    end_timestamp: `${endTimestampSeconds}`,
    count_back: `${Math.min(durationHours, 1000)}`,
  });

  const response = await fetch(
    `${LIGHTER_API_BASE_URL}/api/v1/fundings?${params.toString()}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error("Lighter funding history request failed.");
  }

  const payload = (await response.json()) as LighterFundingsResponse;
  return (payload.fundings ?? [])
    .map((entry) => {
      const timestampSeconds = Number(entry.timestamp);
      const rateValue =
        parseLighterNumber(entry.rate) ?? parseLighterNumber(entry.value);
      if (!Number.isFinite(timestampSeconds) || rateValue == null) {
        return null;
      }
      const direction =
        typeof entry.direction === "string" ? entry.direction.toLowerCase() : null;
      const signedRate = direction === "short" ? -rateValue : rateValue;
      const timestampMs = timestampSeconds * 1000;
      return {
        time: normalizeTimestampToHour(timestampMs),
        rate: signedRate,
      };
    })
    .filter(
      (point): point is { time: number; rate: number } =>
        point !== null && point.time >= startTime,
    );
}

async function fetchHistorySeriesForSource(
  source: SourceConfig,
  symbol: string | null,
  startTime: number,
  fundingPeriodHours?: number | null,
): Promise<Array<{ time: number; rate: number }>> {
  void fundingPeriodHours;
  if (!symbol) {
    return [];
  }
  if (source.provider === "hyperliquid") {
    const series = await fetchHyperliquidFundingHistorySeries(symbol, startTime);
    return series.map(({ time, rate }) => ({ time, rate: rate * 100 }));
  }
  if (source.provider === "lighter") {
    return fetchLighterFundingHistorySeries(symbol, startTime);
  }
  if (source.provider === "grvt") {
    return [];
  }
  return [];
}

export async function buildFundingHistoryDataset(
  leftSource: SourceConfig,
  rightSource: SourceConfig,
  leftSymbol: string,
  rightSymbol: string | null,
  days: number,
  leftFundingPeriodHours: number | null,
  rightFundingPeriodHours: number | null,
): Promise<FundingHistoryPoint[]> {
  const now = Date.now();
  const desiredStart = now - Math.max(days, 1) * 24 * MS_PER_HOUR;
  const latestAllowedStart = now - MAX_HYPER_LOOKBACK_MS;
  const startTime = Math.max(desiredStart, latestAllowedStart);

  const [leftHistory, rightHistory] = await Promise.all([
    fetchHistorySeriesForSource(
      leftSource,
      leftSymbol,
      startTime,
      leftFundingPeriodHours,
    ).catch(() => []),
    fetchHistorySeriesForSource(
      rightSource,
      rightSymbol,
      startTime,
      rightFundingPeriodHours,
    ).catch(() => []),
  ]);

  if (leftHistory.length === 0 && rightHistory.length === 0) {
    throw new Error("暂无可用的资金费率历史数据");
  }

  const sortedLeft = [...leftHistory].sort((a, b) => a.time - b.time);
  const sortedRight = [...rightHistory].sort((a, b) => a.time - b.time);

  if (sortedLeft.length === 0) {
    return sortedRight
      .map(({ time, rate }) => ({
        time,
        left: null,
        right: rate,
        spread: null,
      }))
      .sort((a, b) => a.time - b.time);
  }

  const dataset: FundingHistoryPoint[] = [];
  let rightIndex = 0;
  let currentRight: number | null = null;

  sortedLeft.forEach(({ time, rate }) => {
    while (
      rightIndex < sortedRight.length &&
      sortedRight[rightIndex].time <= time
    ) {
      const nextRate = sortedRight[rightIndex].rate;
      if (Number.isFinite(nextRate)) {
        currentRight = nextRate;
      }
      rightIndex += 1;
    }

    dataset.push({
      time,
      left: rate,
      right: currentRight,
      spread: typeof currentRight === "number" ? currentRight - rate : null,
    });
  });

  return dataset;
}
