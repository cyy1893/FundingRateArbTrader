import { NextResponse } from "next/server";

import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
} from "@/lib/external";
import { formatVolume } from "@/lib/formatters";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

type RouteParams = {
  params: Promise<{ jobId: string }>;
};

function mapEntry(entry: Record<string, unknown>) {
  return {
    symbol: String(entry.symbol ?? ""),
    displayName: String(entry.display_name ?? entry.symbol ?? ""),
    leftSymbol: String(entry.left_symbol ?? ""),
    rightSymbol: String(entry.right_symbol ?? ""),
    leftVolume24h:
      entry.left_volume_24h != null ? Number(entry.left_volume_24h) : null,
    rightVolume24h:
      entry.right_volume_24h != null ? Number(entry.right_volume_24h) : null,
    predictedLeft24h:
      entry.predicted_left_24h != null ? Number(entry.predicted_left_24h) : null,
    predictedRight24h:
      entry.predicted_right_24h != null ? Number(entry.predicted_right_24h) : null,
    predictedSpread24h: Number(entry.predicted_spread_24h ?? 0),
    averageLeftHourly:
      entry.average_left_hourly != null ? Number(entry.average_left_hourly) : null,
    averageRightHourly:
      entry.average_right_hourly != null ? Number(entry.average_right_hourly) : null,
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
    direction: String(entry.direction ?? "unknown"),
  };
}

export async function GET(_: Request, { params }: RouteParams) {
  const { jobId } = await params;
  const response = await fetch(
    `${TRADER_API_BASE_URL.replace(/\/$/, "")}/funding-prediction/jobs/${jobId}`,
    {
      method: "GET",
      cache: "no-store",
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.detail ?? payload?.error ?? "查询推荐任务失败" },
      { status: response.status },
    );
  }

  const context = payload.context ?? {};
  const primarySource = normalizeSource(context.primary_source, DEFAULT_LEFT_SOURCE);
  const secondarySource = normalizeSource(context.secondary_source, DEFAULT_RIGHT_SOURCE);
  const volumeThreshold = Number(context.volume_threshold ?? 0);
  const volumeLabel =
    volumeThreshold <= 0
      ? "两端不限"
      : `两端合计 ≥ ${formatVolume(volumeThreshold)}`;

  const result = payload.result
    ? {
        metadata: {
          primarySourceLabel: primarySource.label,
          secondarySourceLabel: secondarySource.label,
          volumeLabel,
          fetchedAt: payload.result.fetched_at ?? null,
        },
        entries: Array.isArray(payload.result.entries)
          ? payload.result.entries.map((entry: Record<string, unknown>) => mapEntry(entry))
          : [],
        failures: payload.result.failures ?? [],
        errors: payload.result.errors ?? [],
      }
    : null;

  return NextResponse.json({
    jobId: payload.job_id,
    status: payload.status,
    progress: Number(payload.progress ?? 0),
    stage: payload.stage ?? "",
    error: payload.error ?? null,
    result,
  });
}
