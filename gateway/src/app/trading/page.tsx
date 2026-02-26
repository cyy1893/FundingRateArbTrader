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
type ArbOpenResponse = { arb_position_id?: string; status?: string; error?: string };

type RetryFetchOptions = {
  attempts?: number;
  baseDelayMs?: number;
  retryStatusCodes?: number[];
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithShortRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: RetryFetchOptions = {},
): Promise<Response> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 300);
  const retryStatusCodes = options.retryStatusCodes ?? [502, 503, 504];

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!retryStatusCodes.includes(response.status) || attempt === attempts - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) {
        throw error;
      }
    }
    await sleep(baseDelayMs * (attempt + 1));
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  return fetch(input, init);
}

async function fetchBalances(): Promise<BalancesResponse> {
  const response = await fetchWithShortRetry(
    "/api/balances",
    {
      cache: "no-store",
    },
    { attempts: 3, baseDelayMs: 300, retryStatusCodes: [502, 503, 504] },
  );

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
  const lastLeverageCommitRef = useRef<{ symbol: string; leverage: number } | null>(null);
  const liquidationGuardTriggeredRef = useRef(false);

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
  const [balancesSnapshot, setBalancesSnapshot] = useState<BalancesResponse | null>(null);
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
  const [, setArbPositionId] = useState<string | null>(null);
  const balancesRef = useRef<BalancesResponse | null>(null);
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
        balancesRef.current = data;
        setBalancesSnapshot(data);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect
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

        const snapshot = await (async () => {
          let lastError: unknown;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              return await getAvailableSymbols(
                comparisonSelection.primarySource,
                comparisonSelection.secondarySource,
              );
            } catch (error) {
              lastError = error;
              if (attempt < 2) {
                await sleep(300 * (attempt + 1));
              }
            }
          }
          throw lastError;
        })();
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
        const snapshot = await (async () => {
          let lastError: unknown;
          for (let attempt = 0; attempt < 3; attempt += 1) {
            try {
              return await getPerpetualSnapshot(
                comparisonSelection.primarySource,
                comparisonSelection.secondarySource,
              );
            } catch (error) {
              lastError = error;
              if (attempt < 2) {
                await sleep(300 * (attempt + 1));
              }
            }
          }
          throw lastError;
        })();
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
          const leftMaxLeverage = row.maxLeverage;
          if (row.leftProvider === "lighter" && typeof leftMaxLeverage === "number" && Number.isFinite(leftMaxLeverage)) {
            entry.lighter = leftMaxLeverage;
          } else if (row.leftProvider === "grvt" && typeof leftMaxLeverage === "number" && Number.isFinite(leftMaxLeverage)) {
            entry.grvt = leftMaxLeverage;
          }
          const rightMaxLeverage = row.right?.maxLeverage;
          if (row.right?.source === "lighter" && typeof rightMaxLeverage === "number" && Number.isFinite(rightMaxLeverage)) {
            entry.lighter = rightMaxLeverage;
          } else if (row.right?.source === "grvt" && typeof rightMaxLeverage === "number" && Number.isFinite(rightMaxLeverage)) {
            entry.grvt = rightMaxLeverage;
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

  const getMakerPrice = (
    venue: "lighter" | "grvt",
    side: "buy" | "sell",
    expectedSymbol: string,
  ) => {
    const book = venue === "lighter" ? orderBook?.lighter : orderBook?.grvt;
    if (!book) return null;
    if (book.symbol?.toUpperCase() !== expectedSymbol.toUpperCase()) {
      return null;
    }
    const bids = book.bids?.levels ?? [];
    const asks = book.asks?.levels ?? [];
    const bestBid = bids[0]?.price ?? null;
    const bestAsk = asks[0]?.price ?? null;
    if (!bestBid || !bestAsk) {
      return null;
    }
    return side === "buy" ? bestBid : bestAsk;
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


  const submitCloseOrders = useCallback(
    async ({
      subscription: activeSubscription,
      lighterPosition,
      grvtPosition,
      reason,
    }: {
      subscription: OrderBookSubscription;
      lighterPosition?: LighterBalanceSnapshot["positions"][number];
      grvtPosition?: GrvtBalanceSnapshot["positions"][number];
      reason: string;
    }) => {
      const symbol = activeSubscription.symbol;
      const orders: Array<{
        venue: "lighter" | "grvt";
        payload: Record<string, unknown>;
      }> = [];
      const errors: string[] = [];
      const clientBase = Date.now() % 2_147_483_647;

      const buildPayload = (
        venue: "lighter" | "grvt",
        side: "buy" | "sell",
        size: number,
        price: number,
        clientId: number,
      ) => {
        if (venue === "lighter") {
          return {
            symbol,
            client_order_index: clientId,
            side,
            base_amount: size,
            price,
            reduce_only: true,
            time_in_force: "post_only",
          };
        }
        return {
          symbol,
          side,
          amount: size,
          price,
          post_only: true,
          reduce_only: true,
          client_order_id: clientId,
        };
      };

      const addOrder = (
        venue: "lighter" | "grvt",
        side: "buy" | "sell",
        size: number,
        clientId: number,
      ) => {
        const price = getMakerPrice(venue, side, symbol);
        if (!price) {
          errors.push(`${venue === "lighter" ? "Lighter" : "GRVT"}: 订单簿数据不足`);
          return;
        }
        orders.push({
          venue,
          payload: buildPayload(venue, side, size, price, clientId),
        });
      };

      if (lighterPosition && Math.abs(lighterPosition.position) > 0) {
        const side = lighterPosition.position >= 0 ? "sell" : "buy";
        addOrder("lighter", side, Math.abs(lighterPosition.position), clientBase);
      }
      if (grvtPosition && Math.abs(grvtPosition.size) > 0) {
        const side = grvtPosition.size >= 0 ? "sell" : "buy";
        addOrder("grvt", side, Math.abs(grvtPosition.size), clientBase + 1);
      }

      if (orders.length === 0) {
        toast.error(`${reason}失败：没有可平仓的仓位。`, {
          className: "bg-destructive text-destructive-foreground",
        });
        return "no-position";
      }

      if (errors.length > 0) {
        toast.error(`${reason}失败：${errors.join(" | ")}`, {
          className: "bg-destructive text-destructive-foreground",
        });
        return "error";
      }

      const makerResults = await Promise.all(
        orders.map((order) => placeOrder(order.venue, order.payload)),
      );
      const failedVenues = makerResults
        .map((result, index) => (result.ok ? null : orders[index]?.venue))
        .filter(Boolean) as Array<"lighter" | "grvt">;
      if (failedVenues.length === 0) {
        toast.success(`${reason}挂单已提交。`);
        return "ok";
      }

      const message = failedVenues
        .map((venue) => (venue === "lighter" ? "Lighter" : "GRVT"))
        .join(" | ");
      toast.error(`${reason}失败：${message} 挂单未被接受。`, {
        className: "bg-destructive text-destructive-foreground",
      });
      return "error";
    },
    [getMakerPrice, placeOrder],
  );

  const triggerLiquidationGuard = useCallback(
    async ({
      subscription: activeSubscription,
      lighterPosition,
      grvtPosition,
    }: {
      subscription: OrderBookSubscription;
      lighterPosition?: LighterBalanceSnapshot["positions"][number];
      grvtPosition?: GrvtBalanceSnapshot["positions"][number];
    }) => {
      if (liquidationGuardTriggeredRef.current) {
        return;
      }
      liquidationGuardTriggeredRef.current = true;
      const result = await submitCloseOrders({
        subscription: activeSubscription,
        lighterPosition,
        grvtPosition,
        reason: "避免爆仓",
      });
      if (result === "no-position") {
        liquidationGuardTriggeredRef.current = false;
      }
    },
    [submitCloseOrders],
  );

  useEffect(() => {
    liquidationGuardTriggeredRef.current = false;
  }, [
    subscription?.symbol,
    subscription?.liquidation_guard_enabled,
    subscription?.liquidation_guard_threshold_pct,
  ]);

  useEffect(() => {
    if (!draftSubscription || !subscription) {
      return;
    }
    if (draftSubscription.symbol !== subscription.symbol) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSubscription(draftSubscription);
    }
  }, [draftSubscription, subscription]);

  useEffect(() => {
    if (!subscription?.liquidation_guard_enabled || !balancesSnapshot) {
      return;
    }
    if (liquidationGuardTriggeredRef.current) {
      return;
    }
    const threshold = subscription.liquidation_guard_threshold_pct ?? 50;
    if (!Number.isFinite(threshold) || threshold <= 0) {
      return;
    }
    const symbol = subscription.symbol.toUpperCase();
    const lighterPosition = balancesSnapshot.lighter.positions.find(
      (position) => position.symbol.toUpperCase() === symbol,
    );
    const grvtPosition = balancesSnapshot.grvt.positions.find(
      (position) => position.instrument.toUpperCase() === symbol,
    );

    const lighterPct =
      lighterPosition && Math.abs(lighterPosition.position_value) > 0
        ? (Math.abs(lighterPosition.unrealized_pnl) / Math.abs(lighterPosition.position_value)) * 100
        : null;
    const grvtPct =
      grvtPosition && Math.abs(grvtPosition.notional) > 0
        ? (Math.abs(grvtPosition.unrealized_pnl) / Math.abs(grvtPosition.notional)) * 100
        : null;

    if ((lighterPct != null && lighterPct >= threshold) || (grvtPct != null && grvtPct >= threshold)) {
      triggerLiquidationGuard({ subscription, lighterPosition, grvtPosition });
    }
  }, [balancesSnapshot, subscription, triggerLiquidationGuard]);


  const updateLighterLeverage = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/orders/lighter/leverage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const contentType = response.headers.get("content-type") ?? ""
    const data = contentType.includes("application/json") ? await response.json() : await response.text()
    if (!response.ok) {
      const detail =
        typeof data === "string"
          ? data
          : typeof data?.detail === "string"
            ? data.detail
            : typeof data?.error === "string"
              ? data.error
              : `HTTP ${response.status}`
      return { ok: false, data, error: detail }
    }
    return { ok: true, data, error: null }
  }

  const openArbPosition = async (payload: Record<string, unknown>) => {
    const response = await fetch("/api/arb/open", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const contentType = response.headers.get("content-type") ?? ""
    const data = contentType.includes("application/json") ? await response.json() : await response.text()
    if (!response.ok) {
      const detail =
        typeof data === "string"
          ? data
          : typeof data?.detail === "string"
            ? data.detail
            : typeof data?.error === "string"
              ? data.error
              : `HTTP ${response.status}`
      return { ok: false, data, error: detail }
    }
    return { ok: true, data, error: null }
  }

  const handleLeverageCommit = async (payload: { symbol: string; leverage: number }) => {
    const symbol = payload.symbol.trim();
    if (!symbol) {
      return;
    }
    const leverage = Math.max(1, Math.round(payload.leverage));
    const lastCommit = lastLeverageCommitRef.current;
    if (lastCommit && lastCommit.symbol === symbol && lastCommit.leverage === leverage) {
      return;
    }
    lastLeverageCommitRef.current = { symbol, leverage };

    const result = await updateLighterLeverage({
      symbol,
      leverage,
      margin_mode: "cross",
    });
    if (!result.ok) {
      toast.error(`设置 Lighter 杠杆失败：${result.error}`, {
        className: "bg-destructive text-destructive-foreground",
      });
    }
  };

  const executeArbitrage = async () => {
    if (!subscription || arbStatus === "placing") {
      return;
    }
    setArbStatus("placing");
    setArbMessage(null);

    const activeSubscription =
      draftSubscription && draftSubscription.symbol === subscription.symbol
        ? draftSubscription
        : subscription;

    const lighterSide = activeSubscription.lighter_direction === "long" ? "buy" : "sell";
    const grvtDirection =
      activeSubscription.grvt_direction ?? (activeSubscription.lighter_direction === "long" ? "short" : "long");
    const grvtSide = grvtDirection === "long" ? "buy" : "sell";

    const lighterPrice = getMakerPrice("lighter", lighterSide, activeSubscription.symbol);
    const grvtPrice = getMakerPrice("grvt", grvtSide, activeSubscription.symbol);
    if (!lighterPrice || !grvtPrice) {
      setArbStatus("error");
      setArbMessage("订单簿数据不足，无法下单。");
      return;
    }

    const longPrice = lighterSide === "buy" ? lighterPrice : grvtPrice;
    const shortPrice = lighterSide === "sell" ? lighterPrice : grvtPrice;
    if (activeSubscription.avoid_adverse_spread && longPrice > shortPrice) {
      setArbStatus("error");
      setArbMessage("当前价差对多头不利，已阻止下单。");
      return;
    }

    const notional = activeSubscription.notional_value;
    const lighterSize = Number((notional / lighterPrice).toFixed(6));
    const grvtSize = Number((notional / grvtPrice).toFixed(6));
    if (lighterSize <= 0 || grvtSize <= 0) {
      setArbStatus("error");
      setArbMessage("名义价值或价格异常，无法计算下单数量。");
      return;
    }

    const openResult = await openArbPosition({
      symbol: activeSubscription.symbol,
      left_venue: "lighter",
      right_venue: "grvt",
      left_side: lighterSide,
      right_side: grvtSide,
      left_price: lighterPrice,
      right_price: grvtPrice,
      left_size: lighterSize,
      right_size: grvtSize,
      notional,
      leverage_left: activeSubscription.lighter_leverage,
      leverage_right: activeSubscription.grvt_leverage ?? 1,
      avoid_adverse_spread: activeSubscription.avoid_adverse_spread ?? false,
      liquidation_guard_enabled: activeSubscription.liquidation_guard_enabled ?? false,
      liquidation_guard_threshold_pct: activeSubscription.liquidation_guard_threshold_pct ?? null,
      drawdown_guard_enabled: activeSubscription.drawdown_guard_enabled ?? false,
      drawdown_guard_threshold_pct: activeSubscription.drawdown_guard_threshold_pct ?? null,
    });
    if (!openResult.ok) {
      setArbStatus("error");
      setArbMessage(`套利记录创建失败：${openResult.error}`);
      return;
    }
    const openPayload = openResult.data as ArbOpenResponse;
    if (openPayload?.arb_position_id) {
      setArbPositionId(openPayload.arb_position_id);
    }

    if (openPayload?.status === "failed") {
      setArbStatus("error");
      setArbMessage("套利下单失败，记录已创建。");
      return;
    }

    if (openPayload?.status === "partially_filled") {
      setArbStatus("success");
      setArbMessage("一端已提交挂单，等待另一端补齐。");
      return;
    }

    setArbStatus("success");
    setArbMessage("套利下单已提交，挂单有效期 10 秒。");
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
        <div className="w-72 border-r border-gray-200 p-3 bg-white flex flex-col min-h-0 overflow-hidden">
          <QuickTradePanel
            onExecuteArbitrage={executeArbitrage}
            onConfigChange={setDraftSubscription}
            onNotionalReady={setNotionalReady}
            onLeverageCommit={(payload) =>
              handleLeverageCommit({ symbol: payload.symbol, leverage: payload.lighterLeverage })
            }
            executeDisabled={!canExecute}
            executeLabel={arbStatus === "placing" ? "下单中..." : "执行套利/下单"}
            availableSymbols={quickTradeSymbols}
            leverageCapsBySymbol={maxLeverageBySymbol}
            primaryLabel={comparisonSelection.primarySource.label}
            secondaryLabel={comparisonSelection.secondarySource.label}
            defaultSymbol={searchParams.get("symbol") ?? undefined}
            defaultLighterDirection={(searchParams.get("lighterDir") as "long" | "short" | null) ?? undefined}
            defaultGrvtDirection={(searchParams.get("grvtDir") as "long" | "short" | null) ?? undefined}
            lockSymbol={true}
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
                  <p className="text-gray-600 text-sm mb-2">请从首页推荐套利币种进入并开始监控查看订单簿</p>
                  <p className="text-gray-500 text-xs">
                    在左侧面板配置参数后点击&quot;开始监控&quot;
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
  const lighterSymbol = orderBook?.lighter?.symbol ?? lighterTrades[0]?.symbol ?? null;
  const grvtSymbol = orderBook?.grvt?.symbol ?? grvtTrades[0]?.symbol ?? null;

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
          symbol={lighterSymbol}
          bids={lighterBids}
          asks={lighterAsks}
          trades={lighterTrades}
          status={mappedStatus}
          displayMode={displayMode}
        />
        <TerminalOrderBook
          exchange="GRVT"
          symbol={grvtSymbol}
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
