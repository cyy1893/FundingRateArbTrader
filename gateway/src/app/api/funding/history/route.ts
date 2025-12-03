import { NextResponse } from "next/server";

import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
} from "@/lib/external";
import { buildFundingHistoryDataset } from "@/lib/funding-history";
type Payload = {
  leftSymbol?: string;
  rightSymbol?: string | null;
  days?: number;
  leftFundingPeriodHours?: number | null;
  rightFundingPeriodHours?: number | null;
  leftSourceId?: string;
  rightSourceId?: string;
};

export async function POST(request: Request) {
  let payload: Payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 },
    );
  }

  const leftSymbol = typeof payload.leftSymbol === "string" ? payload.leftSymbol : "";
  if (!leftSymbol) {
    return NextResponse.json(
      { error: "Symbol is required" },
      { status: 400 },
    );
  }

  const days =
    typeof payload.days === "number" && Number.isFinite(payload.days)
      ? payload.days
      : 7;

  const rightSymbol =
    typeof payload.rightSymbol === "string" ? payload.rightSymbol : null;
  const leftFundingPeriodHours =
    typeof payload.leftFundingPeriodHours === "number"
      ? payload.leftFundingPeriodHours
      : null;
  const rightFundingPeriodHours =
    typeof payload.rightFundingPeriodHours === "number"
      ? payload.rightFundingPeriodHours
      : null;
  const leftSource = normalizeSource(
    payload.leftSourceId,
    DEFAULT_LEFT_SOURCE,
  );
  const rightSource = normalizeSource(
    payload.rightSourceId,
    DEFAULT_RIGHT_SOURCE,
  );

  try {
    const dataset = await buildFundingHistoryDataset(
      leftSource,
      rightSource,
      leftSymbol,
      rightSymbol,
      days,
      leftFundingPeriodHours,
      rightFundingPeriodHours,
    );

    return NextResponse.json({ dataset });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to load funding history.",
      },
      { status: 500 },
    );
  }
}
