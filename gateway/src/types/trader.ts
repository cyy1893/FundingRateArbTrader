export type DriftSpotBalance = {
  market_index: number;
  market_name: string;
  balance_type: "deposit" | "borrow";
  amount: number;
  raw_amount: number;
  decimals: number;
};

export type DriftPerpBalance = {
  market_index: number;
  market_name: string;
  base_asset_amount: number;
  raw_base_asset_amount: number;
  quote_break_even_amount: number;
  raw_quote_break_even_amount: number;
};

export type DriftBalanceSnapshot = {
  sub_account_id: number;
  spot_positions: DriftSpotBalance[];
  perp_positions: DriftPerpBalance[];
};

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

export type BalancesResponse = {
  drift: DriftBalanceSnapshot;
  lighter: LighterBalanceSnapshot;
};
