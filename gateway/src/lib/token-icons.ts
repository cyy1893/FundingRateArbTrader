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
  if (existingIconUrl) {
    candidates.push(existingIconUrl);
  }

  for (const alias of symbolAliases(symbol)) {
    const lower = alias.toLowerCase();
    candidates.push(`https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${lower}.png`);
    candidates.push(`https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${lower}.png`);
    candidates.push(`https://assets.coincap.io/assets/icons/${lower}@2x.png`);
    candidates.push(`https://coinicons-api.vercel.app/api/icon/${lower}`);
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
