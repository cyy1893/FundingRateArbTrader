import { NextResponse } from "next/server";

import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
} from "@/lib/external";
import { getPerpetualSnapshot } from "@/lib/perp-snapshot";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      sourceA?: string;
      sourceB?: string;
    };
    const primarySource = normalizeSource(body.sourceA, DEFAULT_LEFT_SOURCE);
    const secondarySource = normalizeSource(body.sourceB, DEFAULT_RIGHT_SOURCE);
    const snapshot = await getPerpetualSnapshot(primarySource, secondarySource);
    return NextResponse.json({
      rows: snapshot.rows,
      fetchedAt: snapshot.fetchedAt.toISOString(),
      errors: snapshot.errors,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "无法加载费率比较数据",
      },
      { status: 500 },
    );
  }
}
