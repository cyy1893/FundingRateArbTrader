import { NextResponse } from "next/server";

import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
} from "@/lib/external";
import { getAvailableSymbols } from "@/lib/available-symbols";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sourceA?: string;
      sourceB?: string;
    };
    const primarySource = normalizeSource(body.sourceA, DEFAULT_LEFT_SOURCE);
    const secondarySource = normalizeSource(body.sourceB, DEFAULT_RIGHT_SOURCE);
    const snapshot = await getAvailableSymbols(primarySource, secondarySource);
    return NextResponse.json({
      symbols: snapshot.symbols,
      fetchedAt: snapshot.fetchedAt?.toISOString() ?? null,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "无法加载可用币种",
      },
      { status: 500 },
    );
  }
}
