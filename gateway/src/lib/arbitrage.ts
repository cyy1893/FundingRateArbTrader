import { buildFundingHistoryDataset, MS_PER_HOUR } from "@/lib/funding-history";
import type { SourceConfig } from "@/lib/external";
import type { MarketRow } from "@/types/market";

const LOOKBACK_DAYS = 1;
const LOOKBACK_HOURS = 24;
const HOURS_PER_YEAR = 24 * 365;
const MAX_WORKERS = 4;

export type ArbitrageDirection = "leftLong" | "rightLong" | "unknown";

export type ArbitrageAnnualizedEntry = {
  symbol: string;
  displayName: string;
  leftSymbol: string;
  rightSymbol: string;
  totalDecimal: number;
  averageHourlyDecimal: number;
  annualizedDecimal: number;
  sampleCount: number;
  direction: ArbitrageDirection;
};

export type ArbitrageAnnualizedSnapshot = {
  entries: ArbitrageAnnualizedEntry[];
  failures: Array<{ symbol: string; reason: string }>;
};

async function computeAnnualizedForRow(
  row: MarketRow,
  leftSource: SourceConfig,
  rightSource: SourceConfig,
): Promise<ArbitrageAnnualizedEntry | null> {
  if (!row.right?.symbol) {
    return null;
  }

  const dataset = await buildFundingHistoryDataset(
    leftSource,
    rightSource,
    row.leftSymbol,
    row.right.symbol,
    LOOKBACK_DAYS,
    row.leftFundingPeriodHours ?? null,
    row.right.fundingPeriodHours ?? null,
  );

  if (!dataset.length) {
    return null;
  }

  const latestTime = dataset[dataset.length - 1]?.time;
  if (!Number.isFinite(latestTime)) {
    return null;
  }

  const lookbackStart = Number(latestTime) - LOOKBACK_HOURS * MS_PER_HOUR;
  let sampleCount = 0;
  let totalDecimal = 0;
  let directionalSum = 0;

  dataset.forEach((point) => {
    if (
      point.time >= lookbackStart &&
      typeof point.spread === "number" &&
      Number.isFinite(point.spread)
    ) {
      const decimalSpread = Math.abs(point.spread) / 100;
      totalDecimal += decimalSpread;
      directionalSum += point.spread;
      sampleCount += 1;
    }
  });

  if (sampleCount === 0 || totalDecimal === 0) {
    return null;
  }

  const averageHourlyDecimal = totalDecimal / sampleCount;
  const annualizedDecimal = averageHourlyDecimal * HOURS_PER_YEAR;
  let direction: ArbitrageDirection = "unknown";
  if (directionalSum > 0) {
    direction = "leftLong";
  } else if (directionalSum < 0) {
    direction = "rightLong";
  }

  return {
    symbol: row.symbol,
    displayName: row.displayName,
    leftSymbol: row.leftSymbol,
    rightSymbol: row.right.symbol,
    totalDecimal,
    averageHourlyDecimal,
    annualizedDecimal,
    sampleCount,
    direction,
  };
}

export async function computeArbitrageAnnualizedSnapshot(
  rows: MarketRow[],
  leftSource: SourceConfig,
  rightSource: SourceConfig,
): Promise<ArbitrageAnnualizedSnapshot> {
  const eligible = rows.filter((row) => row.right?.symbol);
  const queue = [...eligible];
  const entries: ArbitrageAnnualizedEntry[] = [];
  const failures: Array<{ symbol: string; reason: string }> = [];

  async function worker() {
    while (queue.length) {
      const next = queue.shift();
      if (!next) {
        return;
      }
      try {
        const entry = await computeAnnualizedForRow(next, leftSource, rightSource);
        if (entry) {
          entries.push(entry);
        }
      } catch (error) {
        failures.push({
          symbol: next.symbol,
          reason:
            error instanceof Error
              ? error.message
              : "无法计算该市场的套利年化收益。",
        });
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(MAX_WORKERS, queue.length) || 1 },
    () => worker(),
  );
  await Promise.all(workers);

  entries.sort((a, b) => b.annualizedDecimal - a.annualizedDecimal);

  return { entries, failures };
}
