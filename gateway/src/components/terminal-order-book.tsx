"use client";

import { cn } from "@/lib/utils";
import type { TradeEntry } from "@/hooks/use-order-book-websocket";

type OrderBookEntry = {
  price: number;
  size: number;
  total: number;
};

type TerminalOrderBookProps = {
  exchange: "Lighter" | "GRVT";
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  trades?: TradeEntry[];
  lastPrice?: number;
  priceChangePercent?: number;
  status: "connected" | "connecting" | "disconnected";
  displayMode: "base" | "usd";
};

const formatPrice = (price: number) => {
  if (!Number.isFinite(price)) {
    return "—";
  }
  if (price >= 1000) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (price >= 1) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  }
  if (price >= 0.01) {
    return price.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
  }
  return price.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
};

const sizeFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const usdFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  fractionalSecondDigits: 3,
});

export function TerminalOrderBook({
  exchange,
  bids,
  asks,
  trades = [],
  lastPrice,
  priceChangePercent = 0,
  status,
  displayMode,
}: TerminalOrderBookProps) {
  const MAX_LEVELS = 12;
  const MAX_TRADES = 30;
  const normalizeLevels = (levels: OrderBookEntry[]) => {
    if (displayMode === "base") {
      return levels;
    }
    let cumulativeUsd = 0;
    return levels.map((level) => {
      const sizeUsd = level.price * level.size;
      cumulativeUsd += sizeUsd;
      return {
        price: level.price,
        size: sizeUsd,
        total: cumulativeUsd,
      };
    });
  };

  const bidsDisplay = normalizeLevels(bids).slice(0, MAX_LEVELS);
  const asksDisplay = normalizeLevels(asks).slice(0, MAX_LEVELS);
  const displayTrades = trades.slice(0, MAX_TRADES);

  const maxTotal = Math.max(
    ...bidsDisplay.map((b) => b.total),
    ...asksDisplay.map((a) => a.total),
    1
  );

  // Calculate spread
  const bestBid = bidsDisplay[0]?.price;
  const bestAsk = asksDisplay[0]?.price;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : null;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : null;
  const spreadPct = spread && mid ? (spread / mid) * 100 : null;

  const isPricePositive = priceChangePercent >= 0;
  void isPricePositive;

  const formatSize = (val: number) =>
    displayMode === "usd" ? `$${usdFormatter.format(val)}` : sizeFormatter.format(val);

  const sizeHeader = displayMode === "usd" ? "数量 (USD)" : "数量";
  const totalHeader = displayMode === "usd" ? "累计 (USD)" : "累计";
  const formatSpread = (value: number) => {
    const abs = Math.abs(value);
    if (abs >= 1000) {
      return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    if (abs >= 1) {
      return value.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
    }
    if (abs >= 0.01) {
      return value.toLocaleString("en-US", { minimumFractionDigits: 5, maximumFractionDigits: 5 });
    }
    return value.toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-none flex flex-col shadow-sm overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 shrink-0">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
            {exchange}
          </h3>
          <div
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              status === "connected" && "bg-green-500 animate-pulse",
              status === "connecting" && "bg-yellow-500 animate-pulse",
              status === "disconnected" && "bg-red-500"
            )}
          />
        </div>
      </div>

      {/* Main Content: Split into OrderBook (Left) and Trades (Right) */}
      <div className="grid grid-cols-2 gap-3 text-sm h-full">
        {/* Order Book Section */}
        <div className="flex flex-col">
            {/* Column Headers */}
            <div className="grid grid-cols-3 gap-2 px-2 py-2 border-b border-gray-100 text-[11px] uppercase tracking-wider text-gray-500 font-semibold bg-gray-50/50 shrink-0">
              <div className="text-left">价格</div>
              <div className="text-right">{sizeHeader}</div>
              <div className="text-right">{totalHeader}</div>
            </div>

            {/* Asks (Sell Orders) */}
            <div className="overflow-hidden">
              {[...asksDisplay].reverse().map((ask, idx) => {
                const widthPercent = (ask.total / maxTotal) * 100;

                return (
                  <div
                    key={`ask-${ask.price}`}
                    className={cn(
                      "relative grid grid-cols-3 gap-2 px-2 py-1 hover:bg-red-50/50 transition-colors"
                    )}
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-red-100/50"
                      style={{ width: `${widthPercent}%` }}
                    />
                    <div className="relative text-red-600 font-semibold">
                      {formatPrice(ask.price)}
                    </div>
                    <div className="relative text-right text-gray-700">
                      {formatSize(ask.size)}
                    </div>
                    <div className="relative text-right text-gray-400">
                      {formatSize(ask.total)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Spread Display - Compact */}
            <div className="px-2 py-2 border-y border-gray-100 bg-gray-50/80 shrink-0 backdrop-blur-sm">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500 font-medium">
                  Spread {Number.isFinite(spread) ? formatSpread(spread as number) : "--"}
                </span>
                <span className="text-gray-500 font-medium">
                  {Number.isFinite(spreadPct) ? `${(spreadPct as number).toFixed(4)}%` : "--"}
                </span>
              </div>
            </div>

            {/* Bids (Buy Orders) */}
            <div className="overflow-hidden">
              {bidsDisplay.map((bid, idx) => {
                const widthPercent = (bid.total / maxTotal) * 100;

                return (
                  <div
                    key={`bid-${bid.price}`}
                    className={cn(
                      "relative grid grid-cols-3 gap-2 px-2 py-1 hover:bg-green-50/50 transition-colors"
                    )}
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-green-100/50"
                      style={{ width: `${widthPercent}%` }}
                    />
                    <div className="relative text-green-700 font-semibold">
                      {formatPrice(bid.price)}
                    </div>
                    <div className="relative text-right text-gray-700">
                      {formatSize(bid.size)}
                    </div>
                    <div className="relative text-right text-gray-400">
                      {formatSize(bid.total)}
                    </div>
                  </div>
                );
              })}
            </div>
        </div>

        {/* Recent Trades Section */}
        <div className="flex flex-col bg-white border border-gray-100">
          <div className="px-2 py-2 bg-gray-50/50 border-b border-gray-100 shrink-0">
             <span className="text-xs font-semibold text-gray-500">逐笔成交</span>
          </div>
          <div className="flex-1 overflow-auto p-0 scrollbar-thin scrollbar-thumb-gray-100">
            <table className="w-full text-xs">
              <tbody className="divide-y divide-gray-50">
                {displayTrades.map((trade, idx) => {
                  const time = timeFormatter.format(new Date(trade.timestamp * 1000));
                  return (
                    <tr key={`trade-${trade.timestamp}-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                      <td className={cn(
                        "px-2 py-1 font-semibold w-1/3",
                        trade.is_buy ? "text-green-700" : "text-red-600"
                      )}>
                        {formatPrice(trade.price)}
                      </td>
                      <td className="px-2 py-1 text-right text-gray-700 w-1/3">
                        {formatSize(displayMode === "usd" ? trade.size * trade.price : trade.size)}
                      </td>
                      <td className="px-2 py-1 text-right text-gray-400 w-1/3 font-mono">
                        {time}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
