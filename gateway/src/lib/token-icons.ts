function normalizeSymbol(symbol: string): string {
  return symbol
    .toUpperCase()
    .replace(/[-_/]?PERP$/i, "")
    .replace(/[-_/].*$/, "")
    .trim();
}

function symbolAliases(symbol: string): string[] {
  const base = normalizeSymbol(symbol);
  const aliases = new Set<string>([base]);
  if (base === "XBT") aliases.add("BTC");
  if (base === "WETH") aliases.add("ETH");
  if (base === "WBTC") aliases.add("BTC");
  return Array.from(aliases);
}

// ── Client-side icon URL cache ──────────────────────────────────────────────
// Avoids re-walking the full fallback chain on every render.  Once an icon
// loads successfully the winning URL is cached in sessionStorage so subsequent
// renders (including page reloads) serve it instantly.

const ICON_CACHE_PREFIX = "icon:";
const ICON_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCachedIconUrl(symbol: string): string | null {
  try {
    const raw = sessionStorage.getItem(ICON_CACHE_PREFIX + symbol);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { u: string; t: number };
    if (Date.now() - entry.t > ICON_CACHE_MAX_AGE_MS) {
      sessionStorage.removeItem(ICON_CACHE_PREFIX + symbol);
      return null;
    }
    return entry.u;
  } catch {
    return null;
  }
}

export function recordIconLoad(symbol: string, url: string): void {
  if (!url || url.startsWith("data:")) return;
  try {
    sessionStorage.setItem(
      ICON_CACHE_PREFIX + symbol,
      JSON.stringify({ u: url, t: Date.now() }),
    );
  } catch {
    // sessionStorage full or unavailable — silently ignore
  }
}

// Maps GRVT commodity symbols to TradingView instrument names for icon discovery.
const COMMODITY_ICON_NAMES: Record<string, string> = {
  NATGAS: "natural-gas",
  XAUUSD: "gold",
  XAGUSD: "silver",
  USOIL: "crude-oil",
  WHEAT: "wheat",
  CORN: "corn",
  SOYBEAN: "soybean",
  SUGAR: "sugar",
};

export function makeFallbackSvgDataUrl(symbol: string): string {
  const short = symbol.slice(0, 3).toUpperCase();
  const seed = Array.from(short).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue = seed % 360;
  const bg = `hsl(${hue} 55% 45%)`;
  const fg = "white";
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='64' height='64' viewBox='0 0 64 64'><circle cx='32' cy='32' r='32' fill='${bg}'/><text x='50%' y='53%' text-anchor='middle' dominant-baseline='middle' fill='${fg}' font-family='ui-sans-serif,system-ui,-apple-system' font-size='22' font-weight='700'>${short}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function buildTokenIconCandidates(
  symbol: string,
  existingIconUrl: string | null,
): string[] {
  const candidates: string[] = [];

  // Fast path: previously resolved URL from sessionStorage cache
  const cached = getCachedIconUrl(normalizeSymbol(symbol));
  if (cached) {
    candidates.push(cached);
  }

  if (existingIconUrl) {
    candidates.push(existingIconUrl);
  }

  for (const alias of symbolAliases(symbol)) {
    const lower = alias.toLowerCase();
    candidates.push(`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${lower}.png`);
    candidates.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${lower}.png`);
    candidates.push(`https://assets.coincap.io/assets/icons/${lower}@2x.png`);
    candidates.push(`https://coinicons-api.vercel.app/api/icon/${lower}`);
    // Stock/equity logo sources (for GRVT stock perpetuals like SPY, NVDA, etc.)
    candidates.push(`https://storage.googleapis.com/iex/api/logos/${alias}.png`);
    candidates.push(`https://companiesmarketcap.com/img/company-logos/256/${alias}.png`);
    // Commodity TradingView SVG icons (for GRVT commodity perpetuals like NATGAS)
    const commodityName = COMMODITY_ICON_NAMES[alias];
    if (commodityName) {
      candidates.push(`https://s3-symbol-logo.tradingview.com/${commodityName}.svg`);
    }
    // Backend proxy: resolves CDN icons via cache + CoinGecko bulk discovery
    candidates.push(`/token-icon/${lower}`);
  }

  const deduped = new Set<string>();
  for (const url of candidates) {
    if (url && !deduped.has(url)) {
      deduped.add(url);
    }
  }
  return Array.from(deduped);
}

export function resolveTokenIcon(symbol: string, existingIconUrl: string | null): string {
  const candidates = buildTokenIconCandidates(symbol, existingIconUrl);
  if (candidates.length > 0) {
    return candidates[0];
  }
  return makeFallbackSvgDataUrl(normalizeSymbol(symbol));
}
