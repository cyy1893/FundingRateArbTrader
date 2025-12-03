export const LIGHTER_API_BASE_URL = "https://mainnet.zklighter.elliot.ai";
export const LIGHTER_FUNDING_INTERVAL_HOURS = 8;

export type LighterFundingRateEntry = {
  market_id?: number;
  exchange?: string;
  symbol?: string;
  rate?: number | string;
};

export type LighterFundingRatesResponse = {
  code?: number;
  funding_rates?: LighterFundingRateEntry[];
};

export type LighterOrderBook = {
  symbol?: string;
  market_id?: number;
  status?: string;
  taker_fee?: string | number;
  maker_fee?: string | number;
  liquidation_fee?: string | number;
  min_base_amount?: string | number;
  min_quote_amount?: string | number;
  order_quote_limit?: string | number;
  supported_size_decimals?: number;
  supported_price_decimals?: number;
  supported_quote_decimals?: number;
};

export type LighterOrderBooksResponse = {
  code?: number;
  order_books?: LighterOrderBook[];
};

export type LighterExchangeStat = {
  symbol?: string;
  daily_quote_token_volume?: number | string;
};

export type LighterExchangeStatsResponse = {
  code?: number;
  daily_usd_volume?: number | string;
  daily_trades_count?: number | string;
  order_book_stats?: LighterExchangeStat[];
};

export type LighterFundingPoint = {
  timestamp?: number | string;
  value?: number | string;
  rate?: number | string;
  direction?: string;
};

export type LighterFundingsResponse = {
  code?: number;
  resolution?: string;
  fundings?: LighterFundingPoint[];
};

export function parseLighterNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

export function normalizeLighterSymbol(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}
