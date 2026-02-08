import { NextResponse } from "next/server";

import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
} from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

type CreateJobPayload = {
  sourceA?: string;
  sourceB?: string;
  volumeThreshold?: number;
  forceRefresh?: boolean;
};

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as CreateJobPayload;
  const primarySource = normalizeSource(body.sourceA, DEFAULT_LEFT_SOURCE);
  const secondarySource = normalizeSource(body.sourceB, DEFAULT_RIGHT_SOURCE);
  const volumeThresholdRaw = Number(body.volumeThreshold ?? DEFAULT_VOLUME_THRESHOLD);
  const volumeThreshold =
    Number.isFinite(volumeThresholdRaw) && volumeThresholdRaw >= 0
      ? volumeThresholdRaw
      : DEFAULT_VOLUME_THRESHOLD;

  const response = await fetch(
    `${TRADER_API_BASE_URL.replace(/\/$/, "")}/funding-prediction/jobs`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        primary_source: primarySource.provider,
        secondary_source: secondarySource.provider,
        volume_threshold: volumeThreshold,
        force_refresh: Boolean(body.forceRefresh),
      }),
    },
  );

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return NextResponse.json(
      { error: payload?.detail ?? payload?.error ?? "创建推荐任务失败" },
      { status: response.status },
    );
  }

  return NextResponse.json({
    jobId: payload.job_id,
  });
}

