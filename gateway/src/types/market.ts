import type { SourceProvider } from "@/lib/external";

export type MarketSideMetrics = {
  source: SourceProvider;
  symbol: string;
  maxLeverage: number | null;
  fundingRate: number | null;
  volumeUsd: number | null;
  fundingPeriodHours: number | null;
};

export type MarketRow = {
  leftProvider: SourceProvider;
  rightProvider: SourceProvider;
  leftSymbol: string;
  leftFundingPeriodHours: number | null;
  symbol: string;
  displayName: string;
  iconUrl: string | null;
  markPrice: number;
  priceChange1h: number | null;
  priceChange24h: number | null;
  priceChange7d: number | null;
  maxLeverage: number | null;
  fundingRate: number;
  dayNotionalVolume: number | null;
  openInterest: number;
  volumeUsd: number | null;
  right: MarketSideMetrics | null;
};
