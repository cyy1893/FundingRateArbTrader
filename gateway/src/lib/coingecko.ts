const HYPER_API = "https://api.hyperliquid.xyz/info";
const COINGECKO_LIST_API =
  "https://api.coingecko.com/api/v3/coins/list?include_platform=false";
const COINGECKO_MARKETS_API =
  "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&per_page=250&sparkline=false&price_change_percentage=1h,24h,7d";

const COINGECKO_API_KEY = "CG-Bk4Hk2fWnGqa372fums79HvT";
const COINGECKO_MAPPING_TTL_MS = 10 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;

const MANUAL_OVERRIDES: Record<string, string> = {
  FXS: "frax-share",
  PUMP: "pump-fun",
  HYPE: "hyperliquid",
  KPEPE: "pepe",
  KSHIB: "shiba-inu",
  KBONK: "bonk",
  PNUT: "peanut-the-squirrel"
};

type CoinGeckoListItem = {
  id: string;
  symbol: string;
  name: string;
};

type CoinGeckoMarketMeta = Map<
  string,
  {
    market_cap_rank: number;
  }
>;

type MappingCache = {
  map: Map<string, string>;
  expiresAt: number;
};

const cachedMappingByKey: Map<string, MappingCache> = new Map();
const inflightMappingByKey: Map<string, Promise<Map<string, string>>> = new Map();

function normalizeAlphaNumeric(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function buildSymbolVariants(symbol: string): string[] {
  const normalized = normalizeAlphaNumeric(symbol);
  const variants = new Set<string>([normalized]);
  if (normalized.startsWith("k") && normalized.length > 1) {
    variants.add(normalized.slice(1));
  }
  if (normalized.endsWith("perp") && normalized.length > 4) {
    variants.add(normalized.slice(0, -4));
  }
  if (normalized.startsWith("perp") && normalized.length > 4) {
    variants.add(normalized.slice(4));
  }
  return Array.from(variants).filter(Boolean);
}

function buildNameVariants(name: string): string[] {
  const normalized = normalizeAlphaNumeric(name);
  return normalized ? [normalized] : [];
}

function bucketCoinsByKey(
  coins: CoinGeckoListItem[],
  extractor: (coin: CoinGeckoListItem) => string[],
): Map<string, CoinGeckoListItem[]> {
  const map = new Map<string, CoinGeckoListItem[]>();
  coins.forEach((coin) => {
    const keys = extractor(coin);
    keys.forEach((key) => {
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(coin);
    });
  });
  return map;
}

function maybeAttachCoingeckoHeaders(url: string, init?: RequestInit): RequestInit | undefined {
  if (!url.includes("api.coingecko.com")) {
    return init;
  }
  const existingHeaders = init?.headers;
  const headers =
    existingHeaders instanceof Headers
      ? new Headers(existingHeaders)
      : new Headers(existingHeaders ?? {});
  headers.set("x-cg-demo-api-key", COINGECKO_API_KEY);
  return {
    ...init,
    headers,
  };
}

async function fetchJson<T>(url: string, init?: RequestInit, attempt = 0): Promise<T> {
  const response = await fetch(url, maybeAttachCoingeckoHeaders(url, init));
  if (response.status === 429 && attempt < MAX_RETRY_ATTEMPTS) {
    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = Number.isFinite(Number(retryAfterHeader))
      ? Number(retryAfterHeader) * 1000
      : 800 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
    return fetchJson<T>(url, init, attempt + 1);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Request failed ${url} (${response.status}): ${text}`);
  }
  return response.json() as Promise<T>;
}

async function fetchHyperSymbols(): Promise<string[]> {
  const payload = { type: "metaAndAssetCtxs" };
  const response = await fetchJson<unknown>(HYPER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!Array.isArray(response) || response.length < 1) {
    throw new Error("Unexpected Hyperliquid meta response");
  }
  const meta = response[0] as {
    universe?: Array<{ name: string; isDelisted?: boolean }>;
  };
  if (!meta?.universe) {
    throw new Error("Hyperliquid universe missing");
  }
  return meta.universe
    .filter((asset) => asset && !asset.isDelisted)
    .map((asset) => asset.name);
}

async function fetchCoinGeckoCoins(): Promise<CoinGeckoListItem[]> {
  const response = await fetchJson<unknown>(COINGECKO_LIST_API);
  if (!Array.isArray(response)) {
    throw new Error("Unexpected CoinGecko list response");
  }
  return response.filter(
    (coin): coin is CoinGeckoListItem =>
      typeof coin?.id === "string" &&
      typeof coin?.symbol === "string" &&
      typeof coin?.name === "string",
  );
}

function pickCoinCandidate(
  candidates: CoinGeckoListItem[],
  assetName: string,
  marketMeta: CoinGeckoMarketMeta,
): CoinGeckoListItem | null {
  if (!candidates?.length) {
    return null;
  }
  if (candidates.length === 1) {
    return candidates[0];
  }
  const normalizedAssetName = normalizeAlphaNumeric(assetName);
  let best: CoinGeckoListItem | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  candidates.forEach((coin) => {
    const rank = marketMeta.get(coin.id)?.market_cap_rank ?? Number.POSITIVE_INFINITY;
    const isExactNameMatch =
      normalizeAlphaNumeric(coin.name) === normalizedAssetName;
    const nameBonus = isExactNameMatch ? 1_000_000 : 0;
    const score = (Number.isFinite(rank) ? rank : Number.POSITIVE_INFINITY) - nameBonus;
    if (score < bestScore) {
      best = coin;
      bestScore = score;
    }
  });

  return best ?? candidates[0];
}

function chunkArray<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function fetchCoinGeckoMarketMeta(ids: string[]): Promise<CoinGeckoMarketMeta> {
  if (!ids.length) {
    return new Map();
  }
  const meta: CoinGeckoMarketMeta = new Map();
  const chunks = chunkArray(ids, 250);
  for (const chunk of chunks) {
    const url = `${COINGECKO_MARKETS_API}&ids=${chunk.join(",")}`;
    const data = await fetchJson<unknown>(url);
    if (Array.isArray(data)) {
      data.forEach((item) => {
        if (typeof item?.id === "string") {
          meta.set(item.id, {
            market_cap_rank:
              typeof item.market_cap_rank === "number"
                ? item.market_cap_rank
                : Number.POSITIVE_INFINITY,
          });
        }
      });
    }
  }
  return meta;
}

async function buildCoinGeckoMapping(
  symbolsUpper: string[],
): Promise<Map<string, string>> {
  const coinGeckoCoins = await fetchCoinGeckoCoins();
  const universeSymbols =
    symbolsUpper.length > 0
      ? symbolsUpper.map((s) => s.toUpperCase())
      : [];
  if (universeSymbols.length === 0) {
    try {
      const hyperSymbols = await fetchHyperSymbols();
      hyperSymbols.forEach((sym) => universeSymbols.push(sym.toUpperCase()));
    } catch {
      // ignore; mapping will be empty if nothing is provided
    }
  }

  const coinsBySymbol = bucketCoinsByKey(coinGeckoCoins, (coin) =>
    coin?.symbol ? [normalizeAlphaNumeric(coin.symbol)] : [],
  );
  const coinsByName = bucketCoinsByKey(coinGeckoCoins, (coin) =>
    coin?.name ? buildNameVariants(coin.name) : [],
  );

  const candidateMap = new Map<string, CoinGeckoListItem[]>();

  universeSymbols.forEach((symbol) => {
    const variants = buildSymbolVariants(symbol);
    const candidateSet = new Map<string, CoinGeckoListItem>();
    for (const variant of variants) {
      const candidates = coinsBySymbol.get(variant);
      candidates?.forEach((coin) => candidateSet.set(coin.id, coin));
    }
    if (candidateSet.size === 0) {
      const nameVariants = buildNameVariants(symbol);
      for (const variant of nameVariants) {
        const candidates = coinsByName.get(variant);
        candidates?.forEach((coin) => candidateSet.set(coin.id, coin));
      }
    }
    candidateMap.set(symbol, Array.from(candidateSet.values()));
  });

  const allCandidateIds = new Set(
    Array.from(candidateMap.values()).flat().map((coin) => coin.id),
  );
  Object.values(MANUAL_OVERRIDES).forEach((id) => {
    if (id) {
      allCandidateIds.add(id);
    }
  });

  const marketMeta = await fetchCoinGeckoMarketMeta(Array.from(allCandidateIds));
  const mapping = new Map<string, string>();

  universeSymbols.forEach((symbol) => {
    if (MANUAL_OVERRIDES[symbol]) {
      mapping.set(symbol.toUpperCase(), MANUAL_OVERRIDES[symbol]);
      return;
    }
    const candidates = candidateMap.get(symbol) ?? [];
    const match = pickCoinCandidate(candidates, symbol, marketMeta);
    if (match?.id) {
      mapping.set(symbol.toUpperCase(), match.id);
    }
  });

  return mapping;
}

export async function getCoinGeckoMapping(
  symbols?: string[],
): Promise<Map<string, string>> {
  const normalizedSymbols = Array.isArray(symbols)
    ? Array.from(new Set(symbols.map((s) => s.toUpperCase()))).sort()
    : [];
  const cacheKey =
    normalizedSymbols.length > 0 ? normalizedSymbols.join(",") : "__all__";

  const now = Date.now();
  const cached = cachedMappingByKey.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.map;
  }

  const inflight = inflightMappingByKey.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = buildCoinGeckoMapping(normalizedSymbols)
    .then((map) => {
      cachedMappingByKey.set(cacheKey, {
        map,
        expiresAt: Date.now() + COINGECKO_MAPPING_TTL_MS,
      });
      inflightMappingByKey.delete(cacheKey);
      return map;
    })
    .catch((error) => {
      inflightMappingByKey.delete(cacheKey);
      throw error;
    });

  inflightMappingByKey.set(cacheKey, promise);
  return promise;
}
