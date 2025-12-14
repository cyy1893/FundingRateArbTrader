import type { FundingHistoryPoint } from "@/types/funding";
import type { SourceConfig } from "@/lib/external";

export const MS_PER_HOUR = 60 * 60 * 1000;

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export async function buildFundingHistoryDataset(
  leftSource: SourceConfig,
  rightSource: SourceConfig,
  leftSymbol: string,
  rightSymbol: string | null,
  days: number,
  leftFundingPeriodHours: number | null,
  rightFundingPeriodHours: number | null,
): Promise<FundingHistoryPoint[]> {
  const upstream = `${TRADER_API_BASE_URL.replace(/\/$/, "")}/funding-history`;
  const response = await fetch(upstream, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      leftSymbol,
      rightSymbol,
      days,
      leftFundingPeriodHours,
      rightFundingPeriodHours,
      leftSourceId: leftSource.id,
      rightSourceId: rightSource.id,
    }),
  });

  const payload = (await response.json().catch(() => ({}))) as {
    dataset?: FundingHistoryPoint[];
    error?: string;
  };

  if (!response.ok || !payload.dataset) {
    const message = payload.error || "无法获取资金费率历史数据";
    throw new Error(message);
  }

  return payload.dataset;
}
