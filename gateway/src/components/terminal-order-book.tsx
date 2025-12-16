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
};

const priceFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const sizeFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour12: false,
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

export function TerminalOrderBook({
  exchange,
  bids,
  asks,
  trades = [],
  lastPrice,
  priceChangePercent = 0,
  status,
}: TerminalOrderBookProps) {
  const maxTotal = Math.max(
    ...bids.map((b) => b.total),
    ...asks.map((a) => a.total),
    1
  );

  // Calculate spread
  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : null;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : null;
  const spreadPct = spread && mid ? (spread / mid) * 100 : null;

  const isPricePositive = priceChangePercent >= 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg flex flex-col shadow-sm overflow-hidden">
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

      {/* Main Content: Split into OrderBook (Top) and Trades (Bottom) */}
      <div className="flex flex-col text-[11px]">
        {/* Order Book Section */}
        <div className="flex flex-col">
            {/* Column Headers */}
            <div className="grid grid-cols-3 gap-2 px-2 py-1.5 border-b border-gray-100 text-[10px] uppercase tracking-wider text-gray-500 font-semibold bg-gray-50/50 shrink-0">
              <div className="text-left">价格</div>
              <div className="text-right">数量</div>
              <div className="text-right">累计</div>
            </div>

            {/* Asks (Sell Orders) */}
            <div className="overflow-auto max-h-80 scrollbar-thin scrollbar-thumb-gray-100">
              {[...asks].reverse().map((ask, idx) => {
                const widthPercent = (ask.total / maxTotal) * 100;

                return (
                  <div
                    key={`ask-${ask.price}`}
                    className={cn(
                      "relative grid grid-cols-3 gap-2 px-2 py-0.5 hover:bg-red-50/50 transition-colors"
                    )}
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-red-100/50"
                      style={{ width: `${widthPercent}%` }}
                    />
                    <div className="relative text-red-600 font-medium">
                      {priceFormatter.format(ask.price)}
                    </div>
                    <div className="relative text-right text-gray-700">
                      {sizeFormatter.format(ask.size)}
                    </div>
                    <div className="relative text-right text-gray-400">
                      {sizeFormatter.format(ask.total)}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Spread Display - Compact */}
            <div className="px-2 py-1 border-y border-gray-100 bg-gray-50/80 shrink-0 backdrop-blur-sm">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-gray-500 font-medium">
                  Spread {spread ? spread.toFixed(2) : "--"}
                </span>
                <span className="text-gray-500 font-medium">
                  {spreadPct ? `${spreadPct.toFixed(3)}%` : "--"}
                </span>
              </div>
            </div>

            {/* Bids (Buy Orders) */}
            <div className="overflow-auto max-h-80 scrollbar-thin scrollbar-thumb-gray-100">
              {bids.map((bid, idx) => {
                const widthPercent = (bid.total / maxTotal) * 100;

                return (
                  <div
                    key={`bid-${bid.price}`}
                    className={cn(
                      "relative grid grid-cols-3 gap-2 px-2 py-0.5 hover:bg-green-50/50 transition-colors"
                    )}
                  >
                    <div
                      className="absolute right-0 top-0 bottom-0 bg-green-100/50"
                      style={{ width: `${widthPercent}%` }}
                    />
                    <div className="relative text-green-700 font-medium">
                      {priceFormatter.format(bid.price)}
                    </div>
                    <div className="relative text-right text-gray-700">
                      {sizeFormatter.format(bid.size)}
                    </div>
                    <div className="relative text-right text-gray-400">
                      {sizeFormatter.format(bid.total)}
                    </div>
                  </div>
                );
              })}
            </div>
        </div>

        {/* Recent Trades Section - Integrated with Header */}
        <div className="flex flex-col bg-white border-t border-gray-100">
          <div className="px-2 py-1 bg-gray-50/50 border-b border-gray-100 shrink-0">
             <span className="text-[10px] font-semibold text-gray-500">逐笔成交</span>
          </div>
          <div className="overflow-auto p-0 scrollbar-thin scrollbar-thumb-gray-100 max-h-64">
            <table className="w-full text-[10px]">
              <tbody className="divide-y divide-gray-50">
                {trades.slice(0, 30).map((trade, idx) => {
                  const time = timeFormatter.format(new Date(trade.timestamp * 1000));
                  return (
                    <tr key={`trade-${trade.timestamp}-${idx}`} className="hover:bg-gray-50/80 transition-colors">
                      <td className={cn(
                        "px-2 py-0.5 font-medium w-1/3",
                        trade.is_buy ? "text-green-700" : "text-red-600"
                      )}>
                        {priceFormatter.format(trade.price)}
                      </td>
                      <td className="px-2 py-0.5 text-right text-gray-700 w-1/3">
                        {sizeFormatter.format(trade.size)}
                      </td>
                      <td className="px-2 py-0.5 text-right text-gray-400 w-1/3 font-mono">
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
