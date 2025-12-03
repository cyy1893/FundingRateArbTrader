export type FundingHistoryPoint = {
  time: number;
  left: number | null;
  right: number | null;
  spread: number | null;
};

export type LiveFundingResponse = {
  left: Record<string, number>;
  right: Record<string, number>;
};
