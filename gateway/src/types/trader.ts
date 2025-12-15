export type LighterPositionBalance = {
  market_id: number;
  symbol: string;
  sign: number;
  position: number;
  avg_entry_price: number;
  position_value: number;
  unrealized_pnl: number;
  realized_pnl: number;
  allocated_margin: number;
};

export type LighterBalanceSnapshot = {
  account_index: number;
  available_balance: number;
  collateral: number;
  total_asset_value: number;
  cross_asset_value: number;
  positions: LighterPositionBalance[];
};

export type GrvtAssetBalance = {
  currency: string;
  total: number;
  free: number;
  used: number;
  usd_value: number | null;
};

export type GrvtPositionBalance = {
  instrument: string;
  size: number;
  notional: number;
  entry_price: number;
  mark_price: number;
  unrealized_pnl: number;
  realized_pnl: number;
  total_pnl: number;
  leverage: number | null;
};

export type GrvtBalanceSnapshot = {
  sub_account_id: string;
  settle_currency: string;
  available_balance: number;
  total_equity: number;
  unrealized_pnl: number;
  timestamp: string | null;
  balances: GrvtAssetBalance[];
  positions: GrvtPositionBalance[];
};

export type BalancesResponse = {
  lighter: LighterBalanceSnapshot;
  grvt: GrvtBalanceSnapshot;
};
