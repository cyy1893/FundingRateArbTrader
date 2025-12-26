"use client";

import { toast } from "sonner";
import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { TradingStatusBar } from "@/components/trading-status-bar";
import { QuickTradePanel } from "@/components/quick-trade-panel";
import { TerminalOrderBook } from "@/components/terminal-order-book";
import { BottomPanel } from "@/components/bottom-panel";
import type {
  BalancesResponse,
  LighterBalanceSnapshot,
  GrvtBalanceSnapshot,
} from "@/types/trader";
import type { OrderBookSubscription } from "@/hooks/use-order-book-websocket";
import { useOrderBookWebSocket } from "@/hooks/use-order-book-websocket";
import { getClientAuthToken } from "@/lib/auth";
import { readComparisonSelection, type ResolvedComparisonSelection } from "@/lib/comparison-selection";
import { DEFAULT_LEFT_SOURCE, DEFAULT_RIGHT_SOURCE, normalizeSource } from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";
import { getPerpetualSnapshot } from "@/lib/perp-snapshot";
import { getAvailableSymbols } from "@/lib/available-symbols";

type ErrorPayload = { detail?: string; error?: string };

async function fetchBalances(): Promise<BalancesResponse> {
  const response = await fetch("/api/balances", {
    cache: "no-store",
  });

  if (!response.ok) {
    let payload: ErrorPayload | null = null;
    if (response.headers.get("content-type")?.includes("application/json")) {
      try {
        payload = (await response.json()) as ErrorPayload;
      } catch {
        payload = null;
      }
    }
    const detail =
      typeof payload?.detail === "string"
        ? payload.detail
        : typeof payload?.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;
    throw new Error(`获取余额失败：${detail}`);
  }

  return response.json();
}

type UnifiedVenue = {
  id: "lighter" | "grvt";
  name: string;
  totalUsd: number;
  balances: {
    headers: string[];
    rows: { key: string; cells: string[] }[];
  };
  positionGroups: {
    headers: string[];
    rows: { key: string; cells: string[] }[];
  }[];
};

type UnifiedWalletData = {
  totalUsd: number;
  totalPnl: number;
  venues: UnifiedVenue[];
};

function normalizeBalances(balances: BalancesResponse): UnifiedWalletData {
  const lighterInfo = summarizeLighter(balances.lighter);
  const grvtInfo = summarizeGrvt(balances.grvt);
  const venues = [lighterInfo, grvtInfo];

  const totalUsd = venues.reduce((sum, venue) => sum + venue.totalUsd, 0);

  // Calculate total PnL from all positions
  const totalPnl = venues.reduce((sum, venue) => {
    const venuePnl = venue.positionGroups.reduce((pnlSum, group) => {
      return pnlSum + group.rows.reduce((rowSum, row) => {
        const pnl = parseFloat((row.cells[3] ?? "").replace(/[$,]/g, ""));
        return rowSum + (Number.isFinite(pnl) ? pnl : 0);
      }, 0);
    }, 0);
    return sum + venuePnl;
  }, 0);

  return { totalUsd, totalPnl, venues };
}

function summarizeLighter(lighter: LighterBalanceSnapshot): UnifiedVenue {
  const filteredPositions = lighter.positions.filter(
    (position) => Math.abs(position.position_value) >= 1,
  );
  const perpUsd = filteredPositions.reduce(
    (sum, position) => sum + position.position_value,
    0,
  );

  const positionRows = filteredPositions.map((position) => ({
    key: `${position.market_id}`,
    cells: [
      position.symbol,
      position.position.toFixed(4),
      `$${position.position_value.toFixed(2)}`,
      `$${position.unrealized_pnl.toFixed(2)}`,
    ],
  }));

  return {
    id: "lighter",
    name: "Lighter",
    totalUsd: lighter.available_balance + perpUsd,
    balances: {
      headers: ["货币", "数额"],
      rows: [
        {
          key: "lighter-available",
          cells: ["USDC", lighter.available_balance.toFixed(2)],
        },
      ],
    },
    positionGroups: [
      {
        headers: ["市场", "仓位", "持仓价值", "未实现盈亏"],
        rows: positionRows,
      },
    ],
  };
}

function summarizeGrvt(grvt: GrvtBalanceSnapshot): UnifiedVenue {
  const availableUsd = grvt.total_equity || grvt.available_balance;

  const balanceRows = grvt.balances.map((asset) => ({
    key: `${asset.currency}`,
    cells: [
      asset.currency,
      asset.total.toFixed(4),
      asset.free.toFixed(4),
    ],
  }));

  const filteredPositions = grvt.positions.filter(
    (position) => Math.abs(position.notional) >= 1,
  );
  const positionRows = filteredPositions.map((position) => ({
    key: position.instrument,
    cells: [
      position.instrument,
      position.size.toFixed(4),
      `$${position.notional.toFixed(2)}`,
      `$${position.unrealized_pnl.toFixed(2)}`,
    ],
  }));

  return {
    id: "grvt",
    name: "GRVT",
    totalUsd: availableUsd,
    balances: {
      headers: ["货币", "总额", "可用"],
      rows: balanceRows,
    },
    positionGroups: [
      {
        headers: ["市场", "仓位", "持仓价值", "未实现盈亏"],
        rows: positionRows,
      },
    ],
  };
}

function TradingPageContent() {
  const searchParams = useSearchParams();
  const didShowToastRef = useRef(false);

  useEffect(() => {
    const symbol = searchParams.get("symbol");
    const lighterDir = searchParams.get("lighterDir");
    const grvtDir = searchParams.get("grvtDir");

    if (symbol && lighterDir && grvtDir && !didShowToastRef.current) {
      toast.success(`已自动应用配置：${symbol}`, {
        description: `Lighter: ${lighterDir === "long" ? "做多" : "做空"} / GRVT: ${grvtDir === "short" ? "做空" : "做多"}`,
        duration: 5000,
      });
      didShowToastRef.current = true;
    }
  }, [searchParams]);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [normalized, setNormalized] = useState<UnifiedWalletData | null>(null);
  const [subscription, setSubscription] = useState<OrderBookSubscription | null>(null);
  const [draftSubscription, setDraftSubscription] = useState<OrderBookSubscription | null>(null);
  const [notionalReady, setNotionalReady] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [maxLeverageBySymbol, setMaxLeverageBySymbol] = useState<Record<string, { lighter?: number; grvt?: number }>>(
    {},
  );
  const [availableSymbols, setAvailableSymbols] = useState<Array<{ symbol: string; displayName: string }>>([]);
  const [comparisonSelection, setComparisonSelection] = useState<ResolvedComparisonSelection>({
    primarySource: DEFAULT_LEFT_SOURCE,
    secondarySource: DEFAULT_RIGHT_SOURCE,
    volumeThreshold: DEFAULT_VOLUME_THRESHOLD,
    symbols: [],
    updatedAt: null,
  });
  const { orderBook, trades, status, hasLighter, hasGrvt } = useOrderBookWebSocket(subscription);
  const [arbStatus, setArbStatus] = useState<"idle" | "placing" | "success" | "error">("idle");
  const [arbMessage, setArbMessage] = useState<string | null>(null);
  const symbolsCacheKey = `fra:trade-symbols:${comparisonSelection.primarySource.id}:${comparisonSelection.secondarySource.id}`;
  const SYMBOLS_CACHE_TTL_MS = 10 * 60 * 1000;

  useEffect(() => {
    const syncAuth = () => {
      setIsAuthenticated(Boolean(getClientAuthToken()));
    };

    syncAuth();
    const handleStorage = () => syncAuth();
    window.addEventListener("storage", handleStorage);
    const interval = setInterval(syncAuth, 5000);

    return () => {
      window.removeEventListener("storage", handleStorage);
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    async function loadBalances() {
      try {
        const data = await fetchBalances();
        setNormalized(normalizeBalances(data));
        setErrorMessage(null);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "无法获取账户余额，请确认后端服务是否正在运行。",
        );
      }
    }

    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    const loadAndTrack = async () => {
      await loadBalances();
      if (cancelled) {
        return;
      }
    };

    loadAndTrack();
    const interval = setInterval(loadAndTrack, 10000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  useEffect(() => {
    const stored = readComparisonSelection();
    const primarySource = normalizeSource(
      searchParams?.get("sourceA"),
      stored?.primarySource ?? DEFAULT_LEFT_SOURCE,
    );
    const secondarySource = normalizeSource(
      searchParams?.get("sourceB"),
      stored?.secondarySource ?? DEFAULT_RIGHT_SOURCE,
    );
    const symbols =
      stored &&
        stored.primarySource.id === primarySource.id &&
        stored.secondarySource.id === secondarySource.id
        ? stored.symbols
        : [];
    setComparisonSelection({
      primarySource,
      secondarySource,
      volumeThreshold:
        stored?.volumeThreshold && stored.volumeThreshold > 0 && stored.volumeThreshold < DEFAULT_VOLUME_THRESHOLD
          ? DEFAULT_VOLUME_THRESHOLD
          : stored?.volumeThreshold ?? DEFAULT_VOLUME_THRESHOLD,
      symbols,
      updatedAt: symbols.length > 0 ? stored?.updatedAt ?? null : null,
    });
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;

    const loadSymbols = async () => {
      try {
        if (typeof window !== "undefined") {
          try {
            const cachedRaw = window.sessionStorage.getItem(symbolsCacheKey);
            if (cachedRaw) {
              const cached = JSON.parse(cachedRaw) as {
                ts: number;
                symbols: Array<{ symbol: string; displayName: string }>;
              };
              if (cached.ts && Date.now() - cached.ts < SYMBOLS_CACHE_TTL_MS) {
                setAvailableSymbols(cached.symbols ?? []);
                return;
              }
            }
          } catch {
            // ignore cache parse errors
          }
        }

        const snapshot = await getAvailableSymbols(
          comparisonSelection.primarySource,
          comparisonSelection.secondarySource,
        );
        if (cancelled) {
          return;
        }
        setAvailableSymbols(snapshot.symbols);
        if (typeof window !== "undefined") {
          try {
            window.sessionStorage.setItem(
              symbolsCacheKey,
              JSON.stringify({ ts: Date.now(), symbols: snapshot.symbols }),
            );
          } catch {
            // ignore cache write errors
          }
        }
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : "获取币种数据失败";
          toast.error(msg, { className: "bg-destructive text-destructive-foreground" });
          setAvailableSymbols([]);
        }
      }
    };

    loadSymbols();
    return () => {
      cancelled = true;
    };
  }, [comparisonSelection.primarySource, comparisonSelection.secondarySource, symbolsCacheKey]);

  useEffect(() => {
    let cancelled = false;

    const loadLeverageCaps = async () => {
      try {
        const snapshot = await getPerpetualSnapshot(
          comparisonSelection.primarySource,
          comparisonSelection.secondarySource,
        );
        if (cancelled) {
          return;
        }
        const caps: Record<string, { lighter?: number; grvt?: number }> = {};
        for (const row of snapshot.rows) {
          const symbol = row.symbol?.toUpperCase();
          if (!symbol) {
            continue;
          }
          const entry = caps[symbol] ?? {};
          if (row.leftProvider === "lighter" && Number.isFinite(row.maxLeverage)) {
            entry.lighter = row.maxLeverage;
          } else if (row.leftProvider === "grvt" && Number.isFinite(row.maxLeverage)) {
            entry.grvt = row.maxLeverage;
          }
          if (row.right?.source === "lighter" && Number.isFinite(row.right.maxLeverage)) {
            entry.lighter = row.right.maxLeverage ?? entry.lighter;
          } else if (row.right?.source === "grvt" && Number.isFinite(row.right.maxLeverage)) {
            entry.grvt = row.right.maxLeverage ?? entry.grvt;
          }
          caps[symbol] = entry;
        }
        setMaxLeverageBySymbol(caps);
      } catch (error) {
        if (!cancelled) {
          const msg = error instanceof Error ? error.message : "获取杠杆数据失败";
          toast.error(msg, { className: "bg-destructive text-destructive-foreground" });
          setMaxLeverageBySymbol({});
        }
      }
    };

    loadLeverageCaps();
    return () => {
      cancelled = true;
    };
  }, [comparisonSelection.primarySource, comparisonSelection.secondarySource]);

  const handleStartMonitoring = useCallback(() => {
    if (draftSubscription) {
      setSubscription(draftSubscription);
    }
  }, [draftSubscription]);

  const quickTradeSymbols = availableSymbols;

  const connectionStatus: "connected" | "connecting" | "disconnected" =
    status === "error" ? "disconnected" : status;

  const getTickSize = (levels: Array<{ price: number }> = []): number | null => {
    const prices = levels
      .map((level) => Number(level.price))
      .filter((price) => Number.isFinite(price) && price > 0);
    const unique = Array.from(new Set(prices)).sort((a, b) => a - b);
    let minDiff: number | null = null;
    for (let i = 1; i < unique.length; i += 1) {
      const diff = unique[i] - unique[i - 1];
      if (diff > 0 && (minDiff === null || diff < minDiff)) {
        minDiff = diff;
      }
    }
    return minDiff;
  };

  const getMakerPrice = (venue: "lighter" | "grvt", side: "buy" | "sell") => {
    const book = venue === "lighter" ? orderBook?.lighter : orderBook?.grvt;
    if (!book) return null;
    const bids = book.bids?.levels ?? [];
    const asks = book.asks?.levels ?? [];
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    if (!bestBid || !bestAsk) {
      return null;
    }
    const tick = getTickSize([...bids.slice(0, 20), ...asks.slice(0, 20)]);
    if (!tick || bestAsk - bestBid <= tick) {
      return side === "buy" ? bestBid : bestAsk;
    }
    if (side === "buy") {
      const price = bestAsk - tick;
      return price > bestBid ? price : bestBid;
    }
    const price = bestBid + tick;
    return price < bestAsk ? price : bestAsk;
  };

  const placeOrder = async (
    venue: "lighter" | "grvt",
    payload: Record<string, unknown>,
  ) => {
    const response = await fetch(`/api/orders/${venue}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const contentType = response.headers.get("content-type") ?? "";
    const data = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const detail =
        typeof data === "string"
          ? data
          : typeof data?.detail === "string"
            ? data.detail
            : typeof data?.error === "string"
              ? data.error
              : `HTTP ${response.status}`;
      return { ok: false, data, error: detail };
    }
    return { ok: true, data, error: null };
  };

  const executeArbitrage = async () => {
    if (!subscription || arbStatus === "placing") {
      return;
    }
    setArbStatus("placing");
    setArbMessage(null);

    const lighterSide = subscription.lighter_direction === "long" ? "buy" : "sell";
    const grvtDirection = subscription.grvt_direction ?? (subscription.lighter_direction === "long" ? "short" : "long");
    const grvtSide = grvtDirection === "long" ? "buy" : "sell";

    const lighterPrice = getMakerPrice("lighter", lighterSide);
    const grvtPrice = getMakerPrice("grvt", grvtSide);
    if (!lighterPrice || !grvtPrice) {
      setArbStatus("error");
      setArbMessage("订单簿数据不足，无法下单。");
      return;
    }

    const longPrice = lighterSide === "buy" ? lighterPrice : grvtPrice;
    const shortPrice = lighterSide === "sell" ? lighterPrice : grvtPrice;
    if (longPrice > shortPrice) {
      setArbStatus("error");
      setArbMessage("当前价差对多头不利，已阻止下单。");
      return;
    }

    const notional = subscription.notional_value;
    const lighterSize = Number((notional / lighterPrice).toFixed(6));
    const grvtSize = Number((notional / grvtPrice).toFixed(6));
    if (lighterSize <= 0 || grvtSize <= 0) {
      setArbStatus("error");
      setArbMessage("名义价值或价格异常，无法计算下单数量。");
      return;
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const clientBase = Date.now() % 2_147_483_647;

    const lighterPayload = {
      symbol: subscription.symbol,
      client_order_index: clientBase,
      side: lighterSide,
      base_amount: lighterSize,
      price: lighterPrice,
      reduce_only: false,
      time_in_force: "post_only",
      order_expiry_secs: nowSec + 10,
    };
    const grvtPayload = {
      symbol: subscription.symbol,
      side: grvtSide,
      amount: grvtSize,
      price: grvtPrice,
      post_only: true,
      reduce_only: false,
      order_duration_secs: 10,
      client_order_id: clientBase + 1,
    };

    const [lighterResult, grvtResult] = await Promise.all([
      placeOrder("lighter", lighterPayload),
      placeOrder("grvt", grvtPayload),
    ]);

    if (lighterResult.ok && grvtResult.ok) {
      setArbStatus("success");
      setArbMessage("套利下单已提交，挂单有效期 10 秒。");
      return;
    }

    if (lighterResult.ok !== grvtResult.ok) {
      const retryVenue = lighterResult.ok ? "grvt" : "lighter";
      const retrySide = retryVenue === "lighter" ? lighterSide : grvtSide;
      const retryPrice = getMakerPrice(retryVenue, retrySide);
      const otherPrice = retryVenue === "lighter" ? grvtPrice : lighterPrice;
      if (retryPrice) {
        const retryLongPrice = retrySide === "buy" ? retryPrice : otherPrice;
        const retryShortPrice = retrySide === "sell" ? retryPrice : otherPrice;
        if (retryLongPrice <= retryShortPrice) {
          const retryPayload =
            retryVenue === "lighter"
              ? { ...lighterPayload, price: retryPrice }
              : { ...grvtPayload, price: retryPrice };
          const retry = await placeOrder(retryVenue, retryPayload);
          if (retry.ok) {
            setArbStatus("success");
            setArbMessage("套利下单已提交，挂单有效期 10 秒。");
            return;
          }
        }
      }
    }

    const errors = [
      lighterResult.ok ? null : `Lighter: ${lighterResult.error}`,
      grvtResult.ok ? null : `GRVT: ${grvtResult.error}`,
    ].filter(Boolean);
    setArbStatus("error");
    setArbMessage(errors.join(" | "));
  };

  const canExecute =
    Boolean(subscription) &&
    notionalReady &&
    connectionStatus === "connected" &&
    hasLighter &&
    hasGrvt &&
    arbStatus !== "placing";
  const canStartMonitoring = Boolean(draftSubscription) && !subscription;

  if (!isAuthenticated) {
    return <AuthRequiredPage />;
  }

  if (errorMessage) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg border border-red-200 shadow-md p-8 max-w-md">
          <h2 className="text-xl font-bold text-red-600 mb-3">无法加载数据</h2>
          <p className="text-gray-700 text-sm">{errorMessage}</p>
        </div>
      </div>
    );
  }

  if (!normalized) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-600 text-sm">正在加载交易数据...</div>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-4rem)] bg-gray-50 flex flex-col overflow-hidden">
      {/* Top Status Bar */}
      <TradingStatusBar
        totalUsd={normalized.totalUsd}
        connectionStatus={connectionStatus}
        lighterBalance={normalized.venues[0].totalUsd}
        grvtBalance={normalized.venues[1].totalUsd}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Left Panel - Quick Trade */}
        <div className="w-72 border-r border-gray-200 p-3 bg-white">
          <QuickTradePanel
            onExecuteArbitrage={executeArbitrage}
            onConfigChange={setDraftSubscription}
            onNotionalReady={setNotionalReady}
            executeDisabled={!canExecute}
            executeLabel={arbStatus === "placing" ? "下单中..." : "执行套利/下单"}
            availableSymbols={quickTradeSymbols}
            leverageCapsBySymbol={maxLeverageBySymbol}
            primaryLabel={comparisonSelection.primarySource.label}
            secondaryLabel={comparisonSelection.secondarySource.label}
            defaultSymbol={searchParams.get("symbol") ?? undefined}
            defaultLighterDirection={(searchParams.get("lighterDir") as "long" | "short" | null) ?? undefined}
            defaultGrvtDirection={(searchParams.get("grvtDir") as "long" | "short" | null) ?? undefined}
            lockSymbol={Boolean(searchParams.get("symbol"))}
            lockDirections={Boolean(searchParams.get("lighterDir")) && Boolean(searchParams.get("grvtDir"))}
          />
        </div>

        {/* Center - Order Books */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-1.5">
            <div className="text-xs text-gray-500">
              {arbMessage ? arbMessage : " "}
            </div>
            <button
              onClick={handleStartMonitoring}
              disabled={!canStartMonitoring}
              className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-500"
            >
              {subscription ? "监控中..." : "开始监控"}
            </button>
          </div>
          <div className="flex-1 flex min-h-0">
            {subscription ? (
              <OrderBookDisplay
                orderBook={orderBook}
                trades={trades}
                status={status}
                hasLighter={hasLighter}
                hasGrvt={hasGrvt}
              />
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-gray-600 text-sm mb-2">选择币种并开始监控查看订单簿</p>
                  <p className="text-gray-500 text-xs">
                    在左侧面板配置参数后点击"开始监控"
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom Panel - Positions & Balances */}
      <BottomPanel venues={normalized.venues} />
    </div>
  );
}

function OrderBookDisplay({
  orderBook,
  trades,
  status,
  hasLighter,
  hasGrvt,
}: {
  orderBook: ReturnType<typeof useOrderBookWebSocket>["orderBook"];
  trades: ReturnType<typeof useOrderBookWebSocket>["trades"];
  status: ReturnType<typeof useOrderBookWebSocket>["status"];
  hasLighter: boolean;
  hasGrvt: boolean;
}) {
  const [displayMode, setDisplayMode] = useState<"base" | "usd">("usd");

  const lighterBids = hasLighter && orderBook?.lighter?.bids?.levels ? orderBook.lighter.bids.levels : [];
  const lighterAsks = hasLighter && orderBook?.lighter?.asks?.levels ? orderBook.lighter.asks.levels : [];
  const grvtBids = hasGrvt && orderBook?.grvt?.bids?.levels ? orderBook.grvt.bids.levels : [];
  const grvtAsks = hasGrvt && orderBook?.grvt?.asks?.levels ? orderBook.grvt.asks.levels : [];

  const lighterTrades = trades?.lighter || [];
  const grvtTrades = trades?.grvt || [];

  const mappedStatus: "connected" | "connecting" | "disconnected" =
    status === "error" ? "disconnected" : status;

  return (
    <div className="flex-1 flex flex-col p-3 gap-2">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setDisplayMode((mode) => (mode === "usd" ? "base" : "usd"))}
          className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          显示：{displayMode === "usd" ? "USD" : "原始数量"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <TerminalOrderBook
          exchange="Lighter"
          bids={lighterBids}
          asks={lighterAsks}
          trades={lighterTrades}
          status={mappedStatus}
          displayMode={displayMode}
        />
        <TerminalOrderBook
          exchange="GRVT"
          bids={grvtBids}
          asks={grvtAsks}
          trades={grvtTrades}
          status={mappedStatus}
          displayMode={displayMode}
        />
      </div>
    </div>
  );
}

function AuthRequiredPage() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-white rounded-lg border border-blue-200 shadow-md p-8 max-w-md">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">需要登录</h2>
        <p className="text-gray-600 text-sm mb-6">
          请先登录以查看账户余额并开启订单簿监控。
        </p>
        <Link
          href="/login"
          className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-3 rounded-lg transition-colors"
        >
          前往登录
        </Link>
      </div>
    </div>
  );
}

export default function TradingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50 flex items-center justify-center">
          <div className="text-gray-600 text-sm">正在加载交易页面...</div>
        </div>
      }
    >
      <TradingPageContent />
    </Suspense>
  );
}
