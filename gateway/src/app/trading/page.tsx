"use client";

import { Suspense, useState, useEffect, useCallback } from "react";
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [normalized, setNormalized] = useState<UnifiedWalletData | null>(null);
  const [subscription, setSubscription] = useState<OrderBookSubscription | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [comparisonSelection, setComparisonSelection] = useState<ResolvedComparisonSelection>({
    primarySource: DEFAULT_LEFT_SOURCE,
    secondarySource: DEFAULT_RIGHT_SOURCE,
    volumeThreshold: DEFAULT_VOLUME_THRESHOLD,
    symbols: [],
    updatedAt: null,
  });

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
      volumeThreshold: stored?.volumeThreshold ?? DEFAULT_VOLUME_THRESHOLD,
      symbols,
      updatedAt: symbols.length > 0 ? stored?.updatedAt ?? null : null,
    });
  }, [searchParams]);

  const handleStartMonitoring = useCallback((sub: OrderBookSubscription) => {
    setSubscription(sub);
  }, []);

  const availableSymbols = comparisonSelection.symbols;

  // Get connection status from WebSocket
  const connectionStatus: "connected" | "connecting" | "disconnected" = subscription
    ? "connected"
    : "disconnected";

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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Status Bar */}
      <TradingStatusBar
        totalUsd={normalized.totalUsd}
        connectionStatus={connectionStatus}
        lighterBalance={normalized.venues[0].totalUsd}
        grvtBalance={normalized.venues[1].totalUsd}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left Panel - Quick Trade */}
        <div className="w-72 border-r border-gray-200 p-4 bg-white">
          <QuickTradePanel
            onStartMonitoring={handleStartMonitoring}
            availableSymbols={availableSymbols}
            primaryLabel={comparisonSelection.primarySource.label}
            secondaryLabel={comparisonSelection.secondarySource.label}
            isMonitoring={subscription !== null}
          />
        </div>

        {/* Center - Order Books */}
        <div className="flex-1 flex">
          {subscription ? (
            <OrderBookDisplay subscription={subscription} />
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

      {/* Bottom Panel - Positions & Balances */}
      <BottomPanel venues={normalized.venues} />
    </div>
  );
}

function OrderBookDisplay({ subscription }: { subscription: OrderBookSubscription }) {
  const { orderBook, trades, status, hasLighter, hasGrvt } = useOrderBookWebSocket(subscription);
  const [displayMode, setDisplayMode] = useState<"base" | "usd">("usd");

  const lighterBids = hasLighter && orderBook?.lighter?.bids?.levels ? orderBook.lighter.bids.levels : [];
  const lighterAsks = hasLighter && orderBook?.lighter?.asks?.levels ? orderBook.lighter.asks.levels : [];
  const grvtBids = hasGrvt && orderBook?.grvt?.bids?.levels ? orderBook.grvt.bids.levels : [];
  const grvtAsks = hasGrvt && orderBook?.grvt?.asks?.levels ? orderBook.grvt.asks.levels : [];
  
  const lighterTrades = trades?.lighter || [];
  const grvtTrades = trades?.grvt || [];

  // Map error status to disconnected for the terminal component
  const mappedStatus: "connected" | "connecting" | "disconnected" = 
    status === "error" ? "disconnected" : status;

  return (
    <div className="flex-1 flex flex-col p-4 gap-3">
      <div className="flex items-center justify-end">
        <button
          onClick={() => setDisplayMode((mode) => (mode === "usd" ? "base" : "usd"))}
          className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
        >
          显示：{displayMode === "usd" ? "USD" : "原始数量"}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-4">
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
