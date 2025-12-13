"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OrderBookSnapshot, VenueOrderBook, OrderBookLevel, WebSocketStatus } from "@/hooks/use-order-book-websocket";

type Props = {
  orderBook: OrderBookSnapshot | null;
  status: WebSocketStatus;
  hasSnapshot: boolean;
  hasDrift: boolean;
  hasLighter: boolean;
};

const formatPrice = (price: number) => price.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const formatShort = (val: number) => {
  if (Math.abs(val) >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
  if (Math.abs(val) >= 1_000) return `${(val / 1_000).toFixed(1)}K`;
  return val.toFixed(2);
};
type DisplayMode = "base" | "usd";
const formatValue = (val: number, mode: DisplayMode) => {
  const formatted = formatShort(val);
  return mode === "usd" ? `$${formatted}` : formatted;
};

const askColors = {
  // Total is lighter, size is stronger
  totalBg: "rgba(209, 58, 58, 0.12)",
  sizeBg: "rgba(209, 58, 58, 0.35)",
  text: "text-[#d13a3a]",
};

const bidColors = {
  totalBg: "rgba(15, 140, 68, 0.12)",
  sizeBg: "rgba(15, 140, 68, 0.35)",
  text: "text-[#0f8c44]",
};

function LoadingState({ message }: { message: string }) {
  return (
    <div className="h-72 flex flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
      <p className="text-sm text-foreground/80">{message}</p>
    </div>
  );
}

function DepthRow({
  level,
  maxTotal,
  maxSize,
  tone,
  displayMode,
}: {
  level: OrderBookLevel;
  maxTotal: number;
  maxSize: number;
  tone: "ask" | "bid";
  displayMode: DisplayMode;
}) {
  const safeVal = (val: unknown) => {
    const num = Number(val);
    return Number.isFinite(num) && num > 0 ? num : 0;
  };

  const totalVal = safeVal(level.total);
  const sizeVal = safeVal(level.size);

  const totalWidthPct = Math.min(100, (totalVal / maxTotal) * 100);
  // Size bar scales both within the row (size vs total) and against the global max size, and never exceeds the total bar.
  const sizeWidthPct = Math.min(
    totalWidthPct,
    (sizeVal / maxSize) * 100,
    totalVal > 0 ? totalWidthPct * Math.min(1, sizeVal / totalVal) : 0,
  );
  const palette = tone === "ask" ? askColors : bidColors;

  return (
    <div className="relative overflow-hidden bg-white">
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: `${totalWidthPct}%`, backgroundColor: palette.totalBg }}
      />
      <div
        className="absolute inset-y-0 left-0"
        style={{ width: `${sizeWidthPct}%`, backgroundColor: palette.sizeBg }}
      />
      <div className="relative z-10 flex items-center gap-3 px-2 py-2 text-sm font-semibold">
        <span className={`${palette.text} min-w-[80px] text-right font-semibold`}>
          {formatPrice(level.price)}
        </span>
        <span className="text-foreground/80 min-w-[70px] text-right font-semibold">
          {formatValue(level.size, displayMode)}
        </span>
        <span className="text-foreground/80 min-w-[70px] text-right font-semibold">
          {formatValue(level.total, displayMode)}
        </span>
      </div>
    </div>
  );
}

function VenueOrderBookTable({
  venue,
  status,
  hasSnapshot,
  venueReady,
  displayMode,
}: {
  venue: VenueOrderBook | undefined;
  status: WebSocketStatus;
  hasSnapshot: boolean;
  venueReady: boolean;
  displayMode: DisplayMode;
}) {
  const showLoading = (!hasSnapshot || !venueReady) && status !== "error";
  if (showLoading) {
    const message = status === "connected" ? "等待订单簿数据..." : "建立连接中...";
    return <LoadingState message={message} />;
  }

  if (!venue) {
    return <div className="h-72" />;
  }

  const asks = [...venue.asks.levels].reverse().slice(0, 10);
  const bids = venue.bids.levels.slice(0, 10);

  const toUsdLevels = (levels: OrderBookLevel[]): OrderBookLevel[] => {
    let cumulativeUsd = 0;
    return levels.map((lvl) => {
      const price = Number(lvl.price);
      const baseSize = Number(lvl.size);
      const sizeUsd = price * baseSize;
      cumulativeUsd += sizeUsd;
      return {
        price,
        size: sizeUsd,
        total: cumulativeUsd,
      };
    });
  };

  const askUsdLevels = toUsdLevels(asks);
  const bidUsdLevels = toUsdLevels(bids);
  const askLevels = displayMode === "usd" ? askUsdLevels : asks;
  const bidLevels = displayMode === "usd" ? bidUsdLevels : bids;

  const safeMax = (levels: OrderBookLevel[], key: "total" | "size") => {
    const maxVal = levels.reduce((m, l) => {
      const val = Number(l[key]);
      return Number.isFinite(val) ? Math.max(m, val) : m;
    }, 0);
    return maxVal > 0 ? maxVal : 1;
  };

  const maxAskTotal = safeMax(askLevels, "total");
  const maxBidTotal = safeMax(bidLevels, "total");
  const maxAskSize = safeMax(askLevels, "size");
  const maxBidSize = safeMax(bidLevels, "size");

  const crossMaxTotal = Math.max(maxAskTotal, maxBidTotal, 1);
  const crossMaxSize = Math.max(maxAskSize, maxBidSize, 1);

  const bestBid = bids[0]?.price;
  const bestAsk = askLevels[askLevels.length - 1]?.price ?? asks[0]?.price;
  const spread = bestAsk && bestBid ? bestAsk - bestBid : null;
  const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : null;
  const spreadPct = spread && mid ? (spread / mid) * 100 : null;
  const sizeHeader = displayMode === "usd" ? "数量 (USD)" : "数量";
  const totalHeader = displayMode === "usd" ? "总计 (USD)" : "总计";

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 px-3 py-3">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-800">
          <span>Orderbook</span>
          <span className="text-xs text-slate-500">{displayMode === "usd" ? "USD" : "Base"}</span>
        </div>
      </div>

      <div className="px-3 pb-3 pt-2">
        <div className="grid grid-cols-3 gap-4 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">
          <span className="text-left">价格</span>
          <span className="text-center">{sizeHeader}</span>
          <span className="text-right">{totalHeader}</span>
        </div>

        <div className="overflow-hidden border border-slate-200">
          {asks.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm bg-slate-50">
              暂无卖单
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {askLevels.map((level, idx) => (
              <DepthRow
                key={`ask-${idx}`}
                level={level}
                maxTotal={crossMaxTotal}
                maxSize={crossMaxSize}
                tone="ask"
                displayMode={displayMode}
              />
            ))}
          </div>
          )}

          <div className="flex items-center justify-between bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
            <span>{spread ? `点差 ${spread.toFixed(1)}` : "点差 --"}</span>
            <span>{spreadPct ? `${spreadPct.toFixed(3)}%` : "--"}</span>
          </div>

          {bids.length === 0 ? (
            <div className="h-24 flex items-center justify-center text-muted-foreground text-sm bg-slate-50">
              暂无买单
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {bidLevels.map((level, idx) => (
              <DepthRow
                key={`bid-${idx}`}
                level={level}
                maxTotal={crossMaxTotal}
                maxSize={crossMaxSize}
                tone="bid"
                displayMode={displayMode}
              />
            ))}
          </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function OrderBookDisplay({ orderBook, status, hasSnapshot, hasDrift, hasLighter }: Props) {
  const [displayMode, setDisplayMode] = useState<DisplayMode>("usd");
  const toggleMode = () => setDisplayMode((m) => (m === "usd" ? "base" : "usd"));

  return (
    <>
      <div className="flex items-center justify-end mb-2">
        <button
          onClick={toggleMode}
          className="rounded-md border px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100"
        >
          显示：{displayMode === "usd" ? "USD" : "原始数量"}
        </button>
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-[#2f2a5a]">Drift 订单簿</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <VenueOrderBookTable
            venue={orderBook?.drift}
            status={status}
            hasSnapshot={hasSnapshot}
            venueReady={hasDrift}
            displayMode={displayMode}
          />
        </CardContent>
      </Card>

      <Card className="border-none shadow-none bg-transparent">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg text-[#2f2a5a]">Lighter 订单簿</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <VenueOrderBookTable
            venue={orderBook?.lighter}
            status={status}
            hasSnapshot={hasSnapshot}
            venueReady={hasLighter}
            displayMode={displayMode}
          />
        </CardContent>
      </Card>
      </div>
    </>
  );
}
