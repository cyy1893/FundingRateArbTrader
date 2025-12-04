import { NextResponse } from "next/server";
import { getCoinGeckoMapping } from "@/lib/coingecko";

type CoinGeckoSnapshot = {
  id: string;
  name: string;
  image: string | null;
  symbol: string;
  currentPrice: number | null;
  volumeUsd: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
};

type CoinGeckoCacheEntry = {
  snapshot: Map<string, CoinGeckoSnapshot>;
  expiresAt: number;
  errors: Array<{ source: string; message: string }>;
};

const COINGECKO_CACHE_TTL_MS = 60 * 1000;
const COINGECKO_MARKETS_URL =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&sparkline=false&price_change_percentage=1h,24h,7d";
const cachedByKey: Map<string, CoinGeckoCacheEntry> = new Map();

async function describeResponseFailure(response: Response, label: string): Promise<string> {
  const statusText = response.statusText?.trim();
  const base = `${label} ${response.status}${statusText ? ` ${statusText}` : ""}`;
  try {
    const bodyText = (await response.text()).trim();
    if (bodyText) {
      return `${base} - ${bodyText}`;
    }
  } catch {
    // ignore
  }
  return base;
}

async function fetchByIds(symbolsUpper: string[], idLookup: Map<string, string>): Promise<CoinGeckoCacheEntry> {
  const markets = new Map<string, CoinGeckoSnapshot>();
  const errors: Array<{ source: string; message: string }> = [];
  const ids: string[] = [];
  const idToSymbol = new Map<string, string>();
  symbolsUpper.forEach((sym) => {
    const id = idLookup.get(sym);
    if (id) {
      ids.push(id);
      idToSymbol.set(id, sym);
    }
  });
  if (ids.length === 0) {
    const missing = symbolsUpper.filter((s) => !idLookup.has(s));
    if (missing.length) {
      errors.push({
        source: "CoinGecko Mapping",
        message: `未找到映射：${missing.join(", ")}`,
      });
    }
    return {
      snapshot: markets,
      expiresAt: Date.now() + COINGECKO_CACHE_TTL_MS,
      errors,
    };
  }
  const chunkSize = 250;
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    const url = `${COINGECKO_MARKETS_URL}&ids=${chunk.join(",")}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      errors.push({
        source: "CoinGecko API",
        message: await describeResponseFailure(response, "markets by ids"),
      });
      continue;
    }
    const data = (await response.json()) as Array<{
      id?: string;
      name?: string;
      image?: string | null;
      symbol?: string;
      current_price?: number | null;
      total_volume?: number;
      price_change_percentage_1h_in_currency?: number | null;
      price_change_percentage_24h_in_currency?: number | null;
      price_change_percentage_7d_in_currency?: number | null;
    }>;
    data.forEach((item) => {
      const id = item.id ?? "";
      const hyperSymbolUpper = idToSymbol.get(id);
      if (!hyperSymbolUpper) {
        return;
      }
      const volume = Number(item.total_volume);
      const currentPrice =
        typeof item.current_price === "number" && Number.isFinite(item.current_price)
          ? item.current_price
          : null;
      const snapshot: CoinGeckoSnapshot = {
        id: item.id ?? hyperSymbolUpper.toLowerCase(),
        name: item.name ?? hyperSymbolUpper,
        image: item.image ?? null,
        symbol: hyperSymbolUpper,
        currentPrice,
        volumeUsd: Number.isFinite(volume) ? volume : null,
        priceChange1h:
          typeof item.price_change_percentage_1h_in_currency === "number" &&
          Number.isFinite(item.price_change_percentage_1h_in_currency)
            ? item.price_change_percentage_1h_in_currency
            : null,
        priceChange24h:
          typeof item.price_change_percentage_24h_in_currency === "number" &&
          Number.isFinite(item.price_change_percentage_24h_in_currency)
            ? item.price_change_percentage_24h_in_currency
            : null,
        priceChange7d:
          typeof item.price_change_percentage_7d_in_currency === "number" &&
          Number.isFinite(item.price_change_percentage_7d_in_currency)
            ? item.price_change_percentage_7d_in_currency
            : null,
      };
      markets.set(hyperSymbolUpper, snapshot);
    });
  }
  const requestedSet = new Set(ids);
  const returnedSet = new Set(Array.from(markets.values()).map((m) => m.id));
  const missingIds = Array.from(requestedSet).filter((id) => !returnedSet.has(id));
  if (missingIds.length) {
    const missingSymbols = missingIds
      .map((id) => idToSymbol.get(id))
      .filter((v): v is string => Boolean(v));
    errors.push({
      source: "CoinGecko API",
      message: `未返回请求的资产：${missingSymbols.join(", ")}`,
    });
  }
  return {
    snapshot: markets,
    expiresAt: Date.now() + COINGECKO_CACHE_TTL_MS,
    errors,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as
    | { symbols?: string[] }
    | null;

  const symbols = Array.isArray(body?.symbols) ? body!.symbols : [];
  const symbolsUpper = symbols.map((s) => s.toUpperCase());
  const cacheKey = symbolsUpper.slice().sort().join(",");
  const now = Date.now();
  const cached = cachedByKey.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(
      {
        markets: Array.from(cached.snapshot.values()),
        errors: cached.errors,
      },
      { headers: { "cache-control": `max-age=${COINGECKO_CACHE_TTL_MS / 1000}` } },
    );
  }
  try {
    const mapping = await getCoinGeckoMapping();
    const result = await fetchByIds(symbolsUpper, mapping);
    cachedByKey.set(cacheKey, result);
    return NextResponse.json(
      {
        markets: Array.from(result.snapshot.values()),
        errors: result.errors,
      },
      { headers: { "cache-control": `max-age=${COINGECKO_CACHE_TTL_MS / 1000}` } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "无法获取 CoinGecko 数据。";
    return NextResponse.json(
      { markets: [], errors: [{ source: "CoinGecko API", message }] },
      { status: 500 },
    );
  }
}
