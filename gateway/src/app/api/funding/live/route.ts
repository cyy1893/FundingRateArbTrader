import { NextResponse } from "next/server";

import {
  LIGHTER_API_BASE_URL,
  LIGHTER_FUNDING_INTERVAL_HOURS,
  normalizeLighterSymbol,
  parseLighterNumber,
  type LighterFundingRatesResponse,
} from "@/lib/lighter";
import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
  type SourceConfig,
} from "@/lib/external";
import { fetchGrvtFundingRates } from "@/lib/grvt";

type HyperliquidFundingResponse = [
  {
    universe: Array<{
      name: string;
    }>;
  },
  Array<{
    funding: string;
  }>,
];

type Payload = {
  leftSymbols?: string[];
  rightSymbols?: string[];
  leftSourceId?: string;
  rightSourceId?: string;
};

async function fetchHyperliquidFundingRates(
  symbols: string[],
): Promise<Record<string, number>> {
  if (symbols.length === 0) {
    return {};
  }

  const response = await fetch("https://api.hyperliquid.xyz/info", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    cache: "no-store",
  });

  if (!response.ok) {
    return {};
  }

  const data = (await response.json()) as unknown;
  if (!Array.isArray(data) || data.length < 2) {
    return {};
  }

  const [meta, contexts] = data as HyperliquidFundingResponse;
  const targetSymbols = new Set(symbols.map((symbol) => symbol.toUpperCase()));

  const funding: Record<string, number> = {};
  meta.universe.forEach((asset, index) => {
    if (!targetSymbols.has(asset.name)) {
      return;
    }

    const rawFunding = contexts[index]?.funding;
    const parsed = Number.parseFloat(rawFunding ?? "");
    if (Number.isFinite(parsed)) {
      funding[asset.name] = parsed;
    }
  });

  return funding;
}

async function fetchLighterFundingRates(
  symbols: string[],
): Promise<Record<string, number>> {
  if (symbols.length === 0) {
    return {};
  }

  const normalizedRequests = symbols
    .map((symbol) => {
      const normalized = normalizeLighterSymbol(symbol);
      const base = normalized.endsWith("-PERP")
        ? normalized.slice(0, -5)
        : normalized;
      return { normalized, base };
    })
    .filter((entry) => entry.base.length > 0);

  if (normalizedRequests.length === 0) {
    return {};
  }

  try {
    const response = await fetch(`${LIGHTER_API_BASE_URL}/api/v1/funding-rates`, {
      cache: "no-store",
    });

    if (!response.ok) {
      return {};
    }

    const payload = (await response.json()) as LighterFundingRatesResponse;
    const baseSymbolRates = new Map<string, number>();
    payload.funding_rates?.forEach((entry) => {
      if ((entry.exchange ?? "").toLowerCase() !== "lighter") {
        return;
      }
      const symbol = normalizeLighterSymbol(entry.symbol);
      if (!symbol) {
        return;
      }
      const base = symbol.endsWith("-PERP") ? symbol.slice(0, -5) : symbol;
      const parsedRate = parseLighterNumber(entry.rate);
      if (parsedRate == null) {
        return;
      }
      baseSymbolRates.set(base, parsedRate);
    });

    const funding: Record<string, number> = {};
    normalizedRequests.forEach((request) => {
      const matchedRate = baseSymbolRates.get(request.base);
      if (matchedRate != null) {
        funding[request.normalized] =
          matchedRate / Math.max(LIGHTER_FUNDING_INTERVAL_HOURS, 1);
      }
    });

    return funding;
  } catch {
    return {};
  }
}

async function fetchFundingRatesForSource(
  source: SourceConfig,
  symbols: string[],
): Promise<Record<string, number>> {
  if (symbols.length === 0) {
    return {};
  }
  if (source.provider === "hyperliquid") {
    return fetchHyperliquidFundingRates(symbols);
  }
  if (source.provider === "lighter") {
    return fetchLighterFundingRates(symbols);
  }
  if (source.provider === "grvt") {
    return fetchGrvtFundingRates(symbols);
  }
  return {};
}

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

  const leftSymbols = Array.isArray(payload.leftSymbols)
    ? payload.leftSymbols.filter((symbol): symbol is string => typeof symbol === "string")
    : [];
  const rightSymbols = Array.isArray(payload.rightSymbols)
    ? payload.rightSymbols.filter((symbol): symbol is string => typeof symbol === "string")
    : [];
  const leftSource = normalizeSource(
    payload.leftSourceId,
    DEFAULT_LEFT_SOURCE,
  );
  const rightSource = normalizeSource(
    payload.rightSourceId,
    DEFAULT_RIGHT_SOURCE,
  );

  try {
    const [left, right] = await Promise.all([
      fetchFundingRatesForSource(leftSource, leftSymbols),
      fetchFundingRatesForSource(rightSource, rightSymbols),
    ]);

    return NextResponse.json({
      left,
      right,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to proxy funding rates.",
      },
      { status: 500 },
    );
  }
}
