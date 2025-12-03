import { getDriftLeverageMap } from "@/lib/drift-margin";
import {
  LIGHTER_API_BASE_URL,
  LIGHTER_FUNDING_INTERVAL_HOURS,
  normalizeLighterSymbol,
  parseLighterNumber,
  type LighterExchangeStatsResponse,
  type LighterFundingRatesResponse,
  type LighterOrderBooksResponse,
} from "@/lib/lighter";
import { getLighterLeverageMap } from "@/lib/lighter-leverage";
import { DEFAULT_FUNDING_PERIOD_HOURS } from "@/lib/funding";
import type { SourceConfig } from "@/lib/external";
import type { ApiError } from "@/types/api";

const HYPER_API = "https://api.hyperliquid.xyz/info";
const SYMBOL_RENAMES: Record<string, string> = {
  "1000PEPE": "kPEPE",
  "1000SHIB": "kSHIB",
  "1000BONK": "kBONK",
};

type UniverseAsset = {
  name: string;
  maxLeverage: number;
  isDelisted?: boolean;
};

type MetaPayload = {
  universe: UniverseAsset[];
};

type AssetContext = {
  markPx: string;
  dayNtlVlm: string;
  funding: string;
  openInterest: string;
};

type MetaAndAssetCtxsResponse = [MetaPayload, AssetContext[]];

export type ExchangeMarketMetrics = {
  baseSymbol: string;
  symbol: string;
  displayName: string;
  markPrice: number | null;
  priceChange1h: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  maxLeverage: number | null;
  fundingRateHourly: number | null;
  fundingPeriodHours: number | null;
  dayNotionalVolume: number | null;
  openInterest: number | null;
  volumeUsd: number | null;
};

export type ExchangeSnapshot = {
  markets: ExchangeMarketMetrics[];
  errors: ApiError[];
};

export async function fetchExchangeSnapshot(
  source: SourceConfig,
): Promise<ExchangeSnapshot> {
  switch (source.provider) {
    case "hyperliquid":
      return fetchHyperliquidMarkets();
    case "drift":
      return fetchDriftMarkets();
    case "lighter":
      return fetchLighterMarkets();
    default:
      return { markets: [], errors: [] };
  }
}

async function fetchHyperliquidMarkets(): Promise<ExchangeSnapshot> {
  const response = await fetch(HYPER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(await describeResponseFailure(response, "Hyperliquid API"));
  }

  const raw = (await response.json()) as MetaAndAssetCtxsResponse | unknown;

  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    typeof raw[0] !== "object" ||
    raw[0] === null ||
    !Array.isArray(raw[1])
  ) {
    throw new Error("Unexpected data shape received from Hyperliquid API");
  }

  const [meta, contexts] = raw as MetaAndAssetCtxsResponse;
  const markets: ExchangeMarketMetrics[] = [];

  meta.universe.forEach((asset, index) => {
    if (!asset || asset.isDelisted) {
      return;
    }

    const ctx = contexts[index];
    if (!ctx) {
      return;
    }

    const markPrice = Number.parseFloat(ctx.markPx);
    const dayNotionalVolumeRaw = Number.parseFloat(ctx.dayNtlVlm);
    const fundingRate = Number.parseFloat(ctx.funding);
    const openInterest = Number.parseFloat(ctx.openInterest);

    const baseSymbol = normalizeBaseSymbol(asset.name);

    markets.push({
      baseSymbol,
      symbol: asset.name,
      displayName: baseSymbol || asset.name,
      markPrice: Number.isFinite(markPrice) ? markPrice : null,
      priceChange1h: null,
      priceChange24h: null,
      priceChange7d: null,
      maxLeverage: Number.isFinite(asset.maxLeverage) ? asset.maxLeverage : null,
      fundingRateHourly: Number.isFinite(fundingRate) ? fundingRate : null,
      fundingPeriodHours: DEFAULT_FUNDING_PERIOD_HOURS,
      dayNotionalVolume: Number.isFinite(dayNotionalVolumeRaw)
        ? dayNotionalVolumeRaw
        : null,
      openInterest: Number.isFinite(openInterest) ? openInterest : null,
      volumeUsd: Number.isFinite(dayNotionalVolumeRaw)
        ? dayNotionalVolumeRaw
        : null,
    });
  });

  return { markets, errors: [] };
}

async function fetchDriftMarkets(): Promise<ExchangeSnapshot> {
  const apiErrors: ApiError[] = [];
  try {
    const response = await fetch("https://data.api.drift.trade/contracts", {
      cache: "no-store",
    });

    if (!response.ok) {
      apiErrors.push({
        source: "Drift Data API",
        message: await describeResponseFailure(response, "contracts"),
      });
      return { markets: [], errors: apiErrors };
    }

    const payload = (await response.json()) as {
      contracts?: Array<{
        ticker_id?: string;
        funding_rate?: string | number;
        next_funding_rate?: string | number;
        quote_volume?: string | number;
        product_type?: string;
      }>;
    };

    const leverageMap = await getDriftLeverageMap();

    const markets: ExchangeMarketMetrics[] = [];

    payload.contracts
      ?.filter(
        (contract) =>
          contract.ticker_id && contract.product_type === "PERP",
      )
      .forEach((contract) => {
        const symbol = String(contract.ticker_id);
        const baseSymbol = normalizeDerivativesBase(symbol);
        if (!baseSymbol) {
          return;
        }

        const nextFundingRaw = Number.parseFloat(
          String(contract.next_funding_rate ?? ""),
        );
        const fallbackFundingRaw = Number.parseFloat(
          String(contract.funding_rate ?? ""),
        );
        const fundingSource = Number.isFinite(nextFundingRaw)
          ? nextFundingRaw
          : fallbackFundingRaw;
        const fundingRateHourly = Number.isFinite(fundingSource)
          ? fundingSource / 100
          : null;
        const volumeRaw = Number.parseFloat(String(contract.quote_volume ?? ""));

        markets.push({
          baseSymbol,
          symbol,
          displayName: baseSymbol,
          markPrice: null,
          priceChange1h: null,
          priceChange24h: null,
          priceChange7d: null,
          maxLeverage: leverageMap.get(symbol) ?? null,
          fundingRateHourly,
          fundingPeriodHours: DEFAULT_FUNDING_PERIOD_HOURS,
          dayNotionalVolume: Number.isFinite(volumeRaw) ? volumeRaw : null,
          openInterest: null,
          volumeUsd: Number.isFinite(volumeRaw) ? volumeRaw : null,
        });
      });

    return { markets, errors: apiErrors };
  } catch (error) {
    apiErrors.push({
      source: "Drift Data API",
      message: error instanceof Error ? error.message : "无法获取 Drift 数据。",
    });
    return { markets: [], errors: apiErrors };
  }
}

async function fetchLighterMarkets(): Promise<ExchangeSnapshot> {
  const apiErrors: ApiError[] = [];
  try {
    const [orderBooksRes, fundingRatesRes, exchangeStatsRes] = await Promise.all([
      fetch(`${LIGHTER_API_BASE_URL}/api/v1/orderBooks`, {
        cache: "no-store",
      }),
      fetch(`${LIGHTER_API_BASE_URL}/api/v1/funding-rates`, {
        cache: "no-store",
      }),
      fetch(`${LIGHTER_API_BASE_URL}/api/v1/exchangeStats`, {
        cache: "no-store",
      }),
    ]);

    if (!orderBooksRes.ok) {
      apiErrors.push({
        source: "Lighter API",
        message: await describeResponseFailure(orderBooksRes, "orderBooks"),
      });
      return { markets: [], errors: apiErrors };
    }

    const orderBooksPayload =
      (await orderBooksRes.json()) as LighterOrderBooksResponse;
    const fundingRatesPayload = fundingRatesRes.ok
      ? ((await fundingRatesRes.json()) as LighterFundingRatesResponse)
      : null;
    if (!fundingRatesRes.ok) {
      apiErrors.push({
        source: "Lighter API",
        message: await describeResponseFailure(fundingRatesRes, "funding-rates"),
      });
    }
    const exchangeStatsPayload = exchangeStatsRes.ok
      ? ((await exchangeStatsRes.json()) as LighterExchangeStatsResponse)
      : null;
    if (!exchangeStatsRes.ok) {
      apiErrors.push({
        source: "Lighter API",
        message: await describeResponseFailure(exchangeStatsRes, "exchangeStats"),
      });
    }

    let leverageMap = new Map<string, number>()
    try {
      leverageMap = await getLighterLeverageMap()
    } catch (error) {
      apiErrors.push({
        source: "Lighter Docs",
        message:
          error instanceof Error
            ? error.message
            : "无法获取 Lighter 杠杆配置。",
      })
    }

    const fundingRateMap = new Map<string, number>();
    fundingRatesPayload?.funding_rates?.forEach((entry) => {
      if ((entry.exchange ?? "").toLowerCase() !== "lighter") {
        return;
      }
      const symbol = normalizeLighterSymbol(entry.symbol);
      if (!symbol) {
        return;
      }
      const baseSymbol = normalizeDerivativesBase(symbol);
      const parsedRate = parseLighterNumber(entry.rate);
      if (baseSymbol && parsedRate != null) {
        fundingRateMap.set(baseSymbol, parsedRate);
      }
    });

    const volumeMap = new Map<string, number | null>();
    exchangeStatsPayload?.order_book_stats?.forEach((stat) => {
      const symbol = normalizeLighterSymbol(stat.symbol);
      if (!symbol) {
        return;
      }
      const baseSymbol = normalizeDerivativesBase(symbol);
      const volume = parseLighterNumber(stat.daily_quote_token_volume);
      const lookupKeys = new Set([symbol, baseSymbol]);
      lookupKeys.forEach((key) => {
        if (key) {
          volumeMap.set(key, volume);
        }
      });
    });

    const markets: ExchangeMarketMetrics[] = [];

    orderBooksPayload.order_books?.forEach((market) => {
      const baseSymbol = normalizeDerivativesBase(
        normalizeLighterSymbol(market.symbol),
      );
      if (!baseSymbol || market.status?.toLowerCase() === "inactive") {
        return;
      }

      const fundingPeriodHours = LIGHTER_FUNDING_INTERVAL_HOURS;
      const fundingRateRaw = fundingRateMap.get(baseSymbol) ?? null;
      const fundingRateHourly =
        fundingRateRaw != null && Number.isFinite(fundingRateRaw)
          ? fundingRateRaw / Math.max(fundingPeriodHours, 1)
          : null;
      const volumeUsd =
        volumeMap.get(baseSymbol) ??
        volumeMap.get(`${baseSymbol}-PERP`) ??
        null;

      markets.push({
        baseSymbol,
        symbol: baseSymbol,
        displayName: baseSymbol,
        markPrice: null,
        priceChange1h: null,
        priceChange24h: null,
        priceChange7d: null,
        maxLeverage:
          leverageMap.get(baseSymbol) ??
          leverageMap.get(`${baseSymbol}-PERP`) ??
          null,
        fundingRateHourly,
        fundingPeriodHours,
        dayNotionalVolume: volumeUsd ?? null,
        openInterest: null,
        volumeUsd: volumeUsd ?? null,
      });
    });

    return { markets, errors: apiErrors };
  } catch (error) {
    apiErrors.push({
      source: "Lighter API",
      message: error instanceof Error ? error.message : "无法获取 Lighter 数据。",
    });
    return { markets: [], errors: apiErrors };
  }
}

function applySymbolRename(symbol: string): string {
  return SYMBOL_RENAMES[symbol] ?? symbol;
}

function normalizeBaseSymbol(symbol: string | null | undefined): string {
  const normalized = symbol ? symbol.trim().toUpperCase() : "";
  return normalized ? applySymbolRename(normalized) : "";
}

function normalizeDerivativesBase(symbol: string | null | undefined): string {
  const normalized = symbol ? symbol.trim().toUpperCase() : "";
  if (!normalized) {
    return "";
  }
  const base = normalized.endsWith("-PERP") ? normalized.slice(0, -5) : normalized;
  return applySymbolRename(base);
}

async function describeResponseFailure(
  response: Response,
  label: string,
): Promise<string> {
  const statusText = response.statusText?.trim();
  const base = `${label} ${response.status}${
    statusText ? ` ${statusText}` : ""
  }`;
  try {
    const bodyText = (await response.text()).trim();
    if (bodyText) {
      const snippet =
        bodyText.length > 200 ? `${bodyText.slice(0, 197)}...` : bodyText;
      return `${base} - ${snippet}`;
    }
  } catch {
    // ignore body read errors
  }
  return base;
}
