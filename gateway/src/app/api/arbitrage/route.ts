import { NextResponse } from "next/server";

import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
  type SourceConfig,
} from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";
import { computeArbitrageAnnualizedSnapshot } from "@/lib/arbitrage";
import { getPerpetualSnapshot } from "@/lib/perp-snapshot";
import type { MarketRow } from "@/types/market";
import { formatVolume } from "@/lib/formatters";

function extractFirst(value?: string | string[] | null): string | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function resolveSources(searchParams: URLSearchParams): {
  primarySource: SourceConfig;
  secondarySource: SourceConfig;
} {
  const requestedPrimarySource =
    extractFirst(searchParams.getAll("sourceA")) ??
    extractFirst(searchParams.getAll("hyperSource"));
  const requestedSecondarySource =
    extractFirst(searchParams.getAll("sourceB")) ??
    extractFirst(searchParams.getAll("externalSource"));

  return {
    primarySource: normalizeSource(
      requestedPrimarySource,
      DEFAULT_LEFT_SOURCE,
    ),
    secondarySource: normalizeSource(
      requestedSecondarySource,
      DEFAULT_RIGHT_SOURCE,
    ),
  };
}

function resolveVolumeThreshold(searchParams: URLSearchParams): number {
  const volumeParam = extractFirst(searchParams.getAll("volumeThreshold"));
  const parsed =
    volumeParam != null ? Number.parseInt(volumeParam, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_VOLUME_THRESHOLD;
}

function filterRowsByVolume(
  rows: MarketRow[],
  volumeThreshold: number,
): MarketRow[] {
  if (volumeThreshold <= 0) {
    return rows.filter((row) => row.right?.symbol);
  }
  return rows.filter((row) => {
    if (!row.right?.symbol) {
      return false;
    }
    const leftVolume =
      Number.isFinite(row.dayNotionalVolume ?? NaN) &&
      row.dayNotionalVolume != null
        ? row.dayNotionalVolume
        : 0;
    const rightVolume =
      Number.isFinite(row.right.volumeUsd ?? NaN) &&
      row.right.volumeUsd != null
        ? row.right.volumeUsd
        : 0;
    return leftVolume >= volumeThreshold && rightVolume >= volumeThreshold;
  });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const { primarySource, secondarySource } = resolveSources(searchParams);
  const volumeThreshold = resolveVolumeThreshold(searchParams);

  try {
    const snapshot = await getPerpetualSnapshot(
      primarySource,
      secondarySource,
    );
    const rows = snapshot?.rows ?? [];
    const filteredRows = filterRowsByVolume(rows, volumeThreshold);

    const arbitrageSnapshot = await computeArbitrageAnnualizedSnapshot(
      filteredRows,
      primarySource,
      secondarySource,
    );

    const volumeLabel =
      volumeThreshold <= 0
        ? "两端不限"
        : `两端 ≥ ${formatVolume(volumeThreshold)}`;

    return NextResponse.json({
      metadata: {
        primarySourceLabel: primarySource.label,
        secondarySourceLabel: secondarySource.label,
        volumeLabel,
        fetchedAt: snapshot?.fetchedAt?.toISOString() ?? null,
      },
      entries: arbitrageSnapshot.entries,
      failures: arbitrageSnapshot.failures,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "无法计算套利年化收益。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
