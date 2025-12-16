"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type OrderBookEntry = {
  price: number;
  size: number;
  total: number;
};

type TerminalOrderBookProps = {
  exchange: "Lighter" | "GRVT";
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
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

export function TerminalOrderBook({
  exchange,
  bids,
  asks,
  lastPrice,
  priceChangePercent = 0,
  status,
}: TerminalOrderBookProps) {
  const [flashingPrices, setFlashingPrices] = useState<Set<number>>(new Set());
  const prevBidsRef = useRef<OrderBookEntry[]>([]);
  const prevAsksRef = useRef<OrderBookEntry[]>([]);

  // Flash animation when prices change
  useEffect(() => {
    const newFlashing = new Set<number>();

    bids.forEach((bid, idx) => {
      if (prevBidsRef.current[idx]?.price !== bid.price) {
        newFlashing.add(bid.price);
      }
    });

    asks.forEach((ask, idx) => {
      if (prevAsksRef.current[idx]?.price !== ask.price) {
        newFlashing.add(ask.price);
      }
    });

    if (newFlashing.size > 0) {
      setFlashingPrices(newFlashing);
      const timer = setTimeout(() => setFlashingPrices(new Set()), 300);
      return () => clearTimeout(timer);
    }

    prevBidsRef.current = bids;
    prevAsksRef.current = asks;
  }, [bids, asks]);

  const maxTotal = Math.max(
    ...bids.map((b) => b.total),
    ...asks.map((a) => a.total),
    1
  );

  const isPricePositive = priceChangePercent >= 0;

  return (
    <div className="bg-white border border-gray-200 rounded-lg flex flex-col h-full shadow-sm">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 bg-gray-50">
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

      {/* Order Book */}
      <div className="flex-1 flex flex-col text-xs font-mono">
        {/* Column Headers */}
        <div className="grid grid-cols-3 gap-2 px-4 py-2 border-b border-gray-200 text-[10px] uppercase tracking-wider text-gray-600 font-semibold bg-gray-50">
          <div className="text-left">价格</div>
          <div className="text-right">数量</div>
          <div className="text-right">累计</div>
        </div>

        {/* Asks (Sell Orders) - Reversed to show lowest at bottom */}
        <div className="flex-1 overflow-auto">
          {[...asks].reverse().map((ask, idx) => {
            const isFlashing = flashingPrices.has(ask.price);
            const widthPercent = (ask.total / maxTotal) * 100;

            return (
              <div
                key={`ask-${idx}-${ask.price}`}
                className={cn(
                  "relative grid grid-cols-3 gap-2 px-4 py-1 hover:bg-red-50/50 transition-colors",
                  isFlashing && "animate-flash-red"
                )}
              >
                {/* Background bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-red-100"
                  style={{ width: `${widthPercent}%` }}
                />
                
                {/* Content */}
                <div className="relative text-red-600 font-semibold">
                  {priceFormatter.format(ask.price)}
                </div>
                <div className="relative text-right text-gray-700">
                  {sizeFormatter.format(ask.size)}
                </div>
                <div className="relative text-right text-gray-500">
                  {sizeFormatter.format(ask.total)}
                </div>
              </div>
            );
          })}
        </div>

        {/* Last Price Ticker */}
        {lastPrice && (
          <div className="px-4 py-3 border-y border-gray-200 bg-gray-100">
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  "text-lg font-bold",
                  isPricePositive ? "text-green-700" : "text-red-700"
                )}
              >
                {priceFormatter.format(lastPrice)}
              </div>
              <div
                className={cn(
                  "text-sm font-semibold",
                  isPricePositive ? "text-green-700" : "text-red-700"
                )}
              >
                {isPricePositive ? "+" : ""}
                {priceChangePercent.toFixed(2)}%
              </div>
            </div>
          </div>
        )}

        {/* Bids (Buy Orders) */}
        <div className="flex-1 overflow-auto">
          {bids.map((bid, idx) => {
            const isFlashing = flashingPrices.has(bid.price);
            const widthPercent = (bid.total / maxTotal) * 100;

            return (
              <div
                key={`bid-${idx}-${bid.price}`}
                className={cn(
                  "relative grid grid-cols-3 gap-2 px-4 py-1 hover:bg-green-50/50 transition-colors",
                  isFlashing && "animate-flash-green"
                )}
              >
                {/* Background bar */}
                <div
                  className="absolute right-0 top-0 bottom-0 bg-green-100"
                  style={{ width: `${widthPercent}%` }}
                />
                
                {/* Content */}
                <div className="relative text-green-700 font-semibold">
                  {priceFormatter.format(bid.price)}
                </div>
                <div className="relative text-right text-gray-700">
                  {sizeFormatter.format(bid.size)}
                </div>
                <div className="relative text-right text-gray-500">
                  {sizeFormatter.format(bid.total)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
