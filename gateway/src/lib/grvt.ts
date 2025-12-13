type GrvtTickerResponse = {
  result?: {
    funding_rate_8h_curr?: string | number | null;
    funding_rate?: string | number | null;
    buy_volume_24h_q?: string | number | null;
    sell_volume_24h_q?: string | number | null;
  };
};

type GrvtInstrument = {
  instrument: string;
  base: string;
  funding_interval_hours?: number | string | null;
};

const GRVT_MARKET_DATA_BASE =
  process.env.GRVT_MARKET_DATA_URL ??
  process.env.NEXT_PUBLIC_GRVT_MARKET_DATA_URL ??
  "https://market-data.grvt.io";

const GRVT_DEFAULT_FUNDING_HOURS = 8;

function normalizeInstrument(symbol: string): string {
  const base = symbol
    .toUpperCase()
    .replace(/[_-]?PERP$/, "")
    .replace(/[^A-Z0-9]/g, "");
  return `${base}_USDT_Perp`;
}

async function fetchAllGrvtInstruments(): Promise<Map<string, GrvtInstrument>> {
  const response = await fetch(`${GRVT_MARKET_DATA_BASE}/full/v1/all_instruments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ is_active: true }),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`GRVT all_instruments failed: ${response.status}`);
  }
  const payload = (await response.json()) as { result?: GrvtInstrument[] };
  const map = new Map<string, GrvtInstrument>();
  (payload.result ?? []).forEach((instrument) => {
    if (
      instrument &&
      instrument.instrument &&
      instrument.base &&
      instrument.instrument.toUpperCase().includes("PERP")
    ) {
      map.set(instrument.instrument.toUpperCase(), instrument);
    }
  });
  return map;
}

function parseNumber(value: unknown): number | null {
  const num = typeof value === "string" ? Number.parseFloat(value) : Number(value);
  return Number.isFinite(num) ? num : null;
}

export async function fetchGrvtFundingRates(
  symbols: string[],
): Promise<Record<string, number>> {
  if (symbols.length === 0) {
    return {};
  }

  const instrumentMap = await fetchAllGrvtInstruments().catch(() => new Map());
  const result: Record<string, number> = {};

  await Promise.all(
    symbols.map(async (symbol) => {
      const instrumentName = normalizeInstrument(symbol);
      const instrument = instrumentMap.get(instrumentName.toUpperCase());
      const intervalHours =
        parseNumber(instrument?.funding_interval_hours) ?? GRVT_DEFAULT_FUNDING_HOURS;
      try {
        const response = await fetch(`${GRVT_MARKET_DATA_BASE}/full/v1/ticker`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrument: instrumentName }),
          cache: "no-store",
        });
        if (!response.ok) {
          return;
        }
        const payload = (await response.json()) as GrvtTickerResponse;
        const fundingPct =
          parseNumber(payload.result?.funding_rate_8h_curr) ??
          parseNumber(payload.result?.funding_rate);
        if (fundingPct == null) {
          return;
        }
        const hourly = (fundingPct / 100) / Math.max(intervalHours, 1);
        result[symbol] = hourly;
      } catch {
        // ignore per-symbol failures
      }
    }),
  );

  return result;
}
