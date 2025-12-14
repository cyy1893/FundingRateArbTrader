import { NextResponse } from "next/server";

import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
  type SourceConfig,
} from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";
import { fetchArbitrageSnapshot } from "@/lib/arbitrage";
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const { primarySource, secondarySource } = resolveSources(searchParams);
  const volumeThreshold = resolveVolumeThreshold(searchParams);

  try {
    const arbitrageSnapshot = await fetchArbitrageSnapshot(
      primarySource,
      secondarySource,
      volumeThreshold,
    );

    const volumeLabel =
      volumeThreshold <= 0
        ? "两端不限"
        : `两端 ≥ ${formatVolume(volumeThreshold)}`;
    const fetchedAt = arbitrageSnapshot.fetchedAt
      ? arbitrageSnapshot.fetchedAt.toISOString()
      : null;

    return NextResponse.json({
      metadata: {
        primarySourceLabel: primarySource.label,
        secondarySourceLabel: secondarySource.label,
        volumeLabel,
        fetchedAt,
      },
      entries: arbitrageSnapshot.entries,
      failures: arbitrageSnapshot.failures,
      errors: arbitrageSnapshot.errors,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "无法计算套利年化收益。";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
