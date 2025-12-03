const LIGHTER_CONTRACT_SPECS_URL =
  "https://docs.lighter.xyz/perpetual-futures/contract-specifications.md"
const LIGHTER_LEVERAGE_TTL_MS = 60 * 60 * 1000

let cachedLeverageMap:
  | {
      map: Map<string, number>
      expiresAt: number
    }
  | null = null
let inflightLeverageMap: Promise<Map<string, number>> | null = null

function normalizeSymbol(value: string): string {
  return value ? value.trim().toUpperCase() : ""
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function parseLeverage(value: string): number | null {
  const text = value.trim()
  const match = text.match(/([\d.]+)\s*x/i)
  if (!match) {
    return null
  }
  const parsed = Number.parseFloat(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function buildLeverageMap(markdown: string): Map<string, number> {
  const map = new Map<string, number>()
  const overrides = new Map<string, number>([
    ["MON", 5],
    ["WLFI", 5],
    ["SKY", 3],
    ["MEGA", 3],
    ["kPEPE", 10],
    ["kSHIB", 10],
    ["kBONK", 10],
  ])
  overrides.forEach((value, key) => {
    map.set(key, value)
    map.set(`${key}-PERP`, value)
  })
  const rowRegex = /<tr>([\s\S]*?)<\/tr>/g
  let rowMatch: RegExpExecArray | null
  while ((rowMatch = rowRegex.exec(markdown)) !== null) {
    const rowContent = rowMatch[1]
    const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/g
    const cells: string[] = []
    let cellMatch: RegExpExecArray | null
    while ((cellMatch = cellRegex.exec(rowContent)) !== null) {
      cells.push(stripHtml(cellMatch[1]))
    }
    if (cells.length < 4) {
      continue
    }
    const symbol = normalizeSymbol(cells[0])
    const leverageRaw = cells[3]
    if (!symbol || symbol === "SYMBOL" || leverageRaw.toUpperCase() === "LEVERAGE") {
      continue
    }
    const leverage = parseLeverage(leverageRaw)
    if (leverage == null) {
      continue
    }
    map.set(symbol, leverage)
    map.set(`${symbol}-PERP`, leverage)
  }
  return map
}

async function fetchContractSpecsMarkdown(): Promise<string> {
  const response = await fetch(LIGHTER_CONTRACT_SPECS_URL, { cache: "no-store" })
  if (!response.ok) {
    throw new Error(
      `Failed to load Lighter contract specs ${response.status} ${response.statusText}`,
    )
  }
  return response.text()
}

export async function getLighterLeverageMap(): Promise<Map<string, number>> {
  const now = Date.now()
  if (cachedLeverageMap && cachedLeverageMap.expiresAt > now) {
    return cachedLeverageMap.map
  }
  if (inflightLeverageMap) {
    return inflightLeverageMap
  }
  inflightLeverageMap = fetchContractSpecsMarkdown()
    .then((markdown) => {
      const map = buildLeverageMap(markdown)
      cachedLeverageMap = {
        map,
        expiresAt: Date.now() + LIGHTER_LEVERAGE_TTL_MS,
      }
      inflightLeverageMap = null
      return map
    })
    .catch((error) => {
      inflightLeverageMap = null
      throw error
    })
  return inflightLeverageMap
}
