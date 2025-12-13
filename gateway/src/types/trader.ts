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
  lighter: LighterBalanceSnapshot;
};
