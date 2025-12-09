"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderBookSnapshot, VenueOrderBook, OrderBookLevel } from "@/hooks/use-order-book-websocket";

type Props = {
  orderBook: OrderBookSnapshot | null;
};

const formatPrice = (price: number) => price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
const formatShort = (val: number) => {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(2);
};

const askColors = {
  bar: "bg-[#f9caca]",
  pill: "bg-[#f9dede]",
  text: "text-[#e55353]",
};

const bidColors = {
  bar: "bg-[#bfe8c7]",
  pill: "bg-[#d7f4dc]",
  text: "text-[#159947]",
};

function DepthRow({
  level,
  maxTotal,
  tone,
  align,
}: {
  level: OrderBookLevel;
  maxTotal: number;
  tone: "ask" | "bid";
  align: "left" | "right";
}) {
  const widthPct = maxTotal > 0 ? Math.min(100, (level.total / maxTotal) * 100) : 0;
  const palette = tone === "ask" ? askColors : bidColors;
  const justify = align === "right" ? "justify-end" : "justify-start";
  const barPos = align === "right" ? "right-0" : "left-0";

  return (
    <div className="relative overflow-hidden rounded-sm">
      <div
        className={`${palette.bar} absolute inset-y-1 ${barPos} rounded ${tone === "ask" ? "rounded-l" : "rounded-r"}`}
        style={{ width: `${widthPct}%` }}
      />
      <div className={`relative z-10 flex ${justify} items-center gap-4 px-2 py-1.5 text-sm font-semibold`}>
        <span className={`${palette.text} min-w-[80px] text-right font-semibold`}>
          {formatPrice(level.price)}
        </span>
        <span className={`${palette.pill} text-foreground/90 min-w-[70px] rounded px-2 py-1 text-center font-semibold`}>
          {formatShort(level.size)}
        </span>
        <span className="text-foreground/80 min-w-[70px] text-right font-semibold">
          {formatShort(level.total)}
        </span>
      </div>
    </div>
  );
}

function VenueOrderBookTable({ venue }: { venue: VenueOrderBook | undefined }) {
  if (!venue) {
    return (
      <div className="h-96 flex items-center justify-center text-muted-foreground">
        <p>暂无数据</p>
      </div>
    );
  }

  const asks = [...venue.asks.levels].reverse().slice(0, 14);
  const bids = venue.bids.levels.slice(0, 14);
  const maxAskTotal = asks.reduce((m, l) => Math.max(m, l.total), 0);
  const maxBidTotal = bids.reduce((m, l) => Math.max(m, l.total), 0);

  const bestBid = bids[0]?.price;
  const bestAsk = asks[asks.length - 1]?.price ?? asks[0]?.price;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : null;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : null;
  const spreadPct = spread && mid ? (spread / mid) * 100 : null;

  return (
    <div className="rounded-xl border border-[#e5dcff] bg-[#f8f5ff] shadow-sm">
      <div className="border-b border-[#e5dcff] px-3 py-3">
        <div className="flex items-center justify-between text-sm font-semibold text-[#2f2a5a]">
          <span>Orderbook</span>
          <span className="text-xs text-[#8c82c1]">USD</span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <div className="grid grid-cols-3 gap-4 py-2 text-xs font-semibold text-[#8c82c1] uppercase tracking-wide">
          <span className="text-left">Price</span>
          <span className="text-center">Size (USD)</span>
          <span className="text-right">Total (USD)</span>
        </div>

        <div className="space-y-1">
          {asks.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm border rounded-md bg-white/70">
              暂无卖单
            </div>
          ) : (
            asks.map((level, idx) => (
              <DepthRow
                key={`ask-${idx}`}
                level={level}
                maxTotal={maxAskTotal}
                tone="ask"
                align="right"
              />
            ))
          )}
        </div>

        <div className="my-3 border-t border-[#e5dcff] pt-3 pb-2 text-center text-2xl font-bold text-[#159947]">
          {bestBid ? formatPrice(bestBid) : "--"}
        </div>

        <div className="space-y-1">
          {bids.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm border rounded-md bg-white/70">
              暂无买单
            </div>
          ) : (
            bids.map((level, idx) => (
              <DepthRow
                key={`bid-${idx}`}
                level={level}
                maxTotal={maxBidTotal}
                tone="bid"
                align="left"
              />
            ))
          )}
        </div>

        <div className="mt-3 rounded-md border border-[#e5dcff] bg-white/80 px-3 py-2 text-xs font-semibold text-[#6f669f]">
          {spread ? (
            <span>
              Spread: ${spread.toFixed(0)} ({spreadPct ? spreadPct.toFixed(3) : "0.000"}%)
            </span>
          ) : (
            <span>Spread: --</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function OrderBookDisplay({ orderBook }: Props) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-[#2f2a5a]">Drift 订单簿</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <VenueOrderBookTable venue={orderBook?.drift} />
        </CardContent>
      </Card>

      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-[#2f2a5a]">Lighter 订单簿</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <VenueOrderBookTable venue={orderBook?.lighter} />
        </CardContent>
      </Card>
    </div>
  );
}
