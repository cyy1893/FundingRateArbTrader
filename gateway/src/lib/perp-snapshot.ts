import type { ApiError } from "@/types/api";
import type { MarketRow } from "@/types/market";
import type { SourceConfig } from "@/lib/external";
import {
  fetchExchangeSnapshot,
  type ExchangeMarketMetrics,
} from "@/lib/markets";

export type PerpSnapshot = {
  rows: MarketRow[];
  fetchedAt: Date;
  errors: ApiError[];
};

export async function getPerpetualSnapshot(
  primarySource: SourceConfig,
  secondarySource: SourceConfig,
): Promise<PerpSnapshot> {
  const [primarySnapshot, secondarySnapshot] = await Promise.all([
    fetchExchangeSnapshot(primarySource),
    fetchExchangeSnapshot(secondarySource),
  ]);
  const apiErrors = [...primarySnapshot.errors, ...secondarySnapshot.errors];
  const secondaryByBase = new Map<string, ExchangeMarketMetrics>();
  secondarySnapshot.markets.forEach((market) => {
    if (market.baseSymbol) {
      secondaryByBase.set(market.baseSymbol, market);
    }
  });
  const rows: MarketRow[] = primarySnapshot.markets.map((primaryMarket) => {
    const baseSymbol = primaryMarket.baseSymbol || primaryMarket.symbol;
    const matchingRight = baseSymbol ? secondaryByBase.get(baseSymbol) : null;
    const combinedVolumeUsd =
      primaryMarket.dayNotionalVolume != null ||
      matchingRight?.volumeUsd != null
        ? (primaryMarket.dayNotionalVolume ?? 0) +
          (matchingRight?.volumeUsd ?? 0)
        : null;

    return {
      leftProvider: primarySource.provider,
      rightProvider: secondarySource.provider,
      leftSymbol: primaryMarket.symbol,
      leftFundingPeriodHours: primaryMarket.fundingPeriodHours ?? null,
      symbol: baseSymbol,
      displayName: primaryMarket.displayName ?? baseSymbol,
      iconUrl: null,
      coingeckoId: null,
      markPrice: Number(primaryMarket.markPrice ?? 0),
      priceChange1h: primaryMarket.priceChange1h,
      priceChange24h: primaryMarket.priceChange24h,
      priceChange7d: primaryMarket.priceChange7d,
      maxLeverage: primaryMarket.maxLeverage ?? 0,
      fundingRate: primaryMarket.fundingRateHourly ?? 0,
      dayNotionalVolume: primaryMarket.dayNotionalVolume,
      openInterest: Number(primaryMarket.openInterest ?? 0),
      volumeUsd: combinedVolumeUsd,
      right: matchingRight
        ? {
            source: secondarySource.provider,
            symbol: matchingRight.symbol,
            maxLeverage: matchingRight.maxLeverage,
            fundingRate: matchingRight.fundingRateHourly,
            volumeUsd: matchingRight.volumeUsd,
            fundingPeriodHours: matchingRight.fundingPeriodHours,
          }
        : null,
    };
  });

  rows.sort((a, b) => {
    const volumeA = a.volumeUsd ?? a.dayNotionalVolume ?? 0;
    const volumeB = b.volumeUsd ?? b.dayNotionalVolume ?? 0;
    return volumeB - volumeA;
  });

  return {
    rows,
    fetchedAt: new Date(),
    errors: apiErrors,
  };
}
