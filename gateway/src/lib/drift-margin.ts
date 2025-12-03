const DRIFT_MARGIN_PAGE_URL = "https://docs.drift.trade/trading/margin";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type DriftMarginRow = {
  name?: string;
  initial?: string;
};

let cachedLeverage:
  | {
      map: Map<string, number>;
      expiresAt: number;
    }
  | null = null;
let inflight: Promise<Map<string, number>> | null = null;

function parseInitialLeverage(initial: string | undefined): number | null {
  if (!initial) {
    return null;
  }

  const leverageMatch = initial.match(/\/\s*([\d.]+)x/i);
  if (leverageMatch) {
    const value = Number.parseFloat(leverageMatch[1]);
    if (Number.isFinite(value) && value > 0) {
      return value;
    }
  }

  const ratioMatch = initial.match(/([\d.]+)%/);
  if (ratioMatch) {
    const ratio = Number.parseFloat(ratioMatch[1]);
    if (Number.isFinite(ratio) && ratio > 0) {
      return 100 / ratio;
    }
  }

  return null;
}

async function fetchDriftMarginMap(): Promise<Map<string, number>> {
  if (cachedLeverage && cachedLeverage.expiresAt > Date.now()) {
    return cachedLeverage.map;
  }

  if (inflight) {
    return inflight;
  }

  inflight = (async () => {
    const response = await fetch(DRIFT_MARGIN_PAGE_URL, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(
        `Unable to load Drift margin data (${response.status} ${response.statusText})`,
      );
    }
    const html = await response.text();
    const match = html.match(
      /<script id="__NEXT_DATA__" type="application\/json">(.*?)<\/script>/s,
    );
    if (!match) {
      throw new Error("Drift margin payload missing __NEXT_DATA__ script");
    }
    const payload = JSON.parse(match[1]) as {
      props?: {
        pageProps?: {
          ssg?: { perpMarginData?: DriftMarginRow[] };
        };
      };
    };
    const rows = payload?.props?.pageProps?.ssg?.perpMarginData ?? [];
    const map = new Map<string, number>();
    rows.forEach((row) => {
      if (!row?.name) {
        return;
      }
      const leverage = parseInitialLeverage(row.initial);
      if (leverage != null && Number.isFinite(leverage)) {
        map.set(row.name.trim().toUpperCase(), leverage);
      }
    });

    cachedLeverage = {
      map,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    inflight = null;
    return map;
  })().catch((error) => {
    inflight = null;
    throw error;
  });

  return inflight;
}

export async function getDriftLeverageMap(): Promise<Map<string, number>> {
  return fetchDriftMarginMap().catch(() => {
    // fall back to empty map so downstream logic still runs
    return new Map();
  });
}

export async function getDriftMaxLeverage(
  symbol: string,
): Promise<number | undefined> {
  const map = await getDriftLeverageMap();
  return map.get(symbol.toUpperCase());
}
