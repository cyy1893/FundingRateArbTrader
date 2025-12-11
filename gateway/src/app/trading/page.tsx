"use client";

import Link from "next/link";
import { Suspense, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  BalancesResponse,
  DriftBalanceSnapshot,
  LighterBalanceSnapshot,
} from "@/types/trader";
import { MonitoringConfigCard, OrderBookCard } from "@/components/order-depth-cards";
import type { OrderBookSubscription } from "@/hooks/use-order-book-websocket";
import { getClientAuthToken } from "@/lib/auth";
import { readComparisonSelection, type ResolvedComparisonSelection } from "@/lib/comparison-selection";
import { DEFAULT_LEFT_SOURCE, DEFAULT_RIGHT_SOURCE, normalizeSource } from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";

const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 4,
});
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

function formatNumber(value: number) {
  return numberFormatter.format(value);
}

function formatUsd(value: number) {
  return usdFormatter.format(value);
}

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

function TradingPageContent() {
  const searchParams = useSearchParams();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [normalized, setNormalized] = useState<UnifiedWalletData | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [subscription, setSubscription] = useState<OrderBookSubscription | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [comparisonSelection, setComparisonSelection] = useState<ResolvedComparisonSelection>({
    primarySource: DEFAULT_LEFT_SOURCE,
    secondarySource: DEFAULT_RIGHT_SOURCE,
    volumeThreshold: DEFAULT_VOLUME_THRESHOLD,
    symbols: [],
    updatedAt: null,
  });
  const showMonitoringArea = showConfig || subscription !== null;

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
    const interval = setInterval(loadAndTrack, 10000); // Refresh every 10s
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

  const handleReset = () => {
    setSubscription(null);
    setShowConfig(true);
  };

  const availableSymbols = comparisonSelection.symbols;
  const selectedExchangesLabel = `${comparisonSelection.primarySource.label} / ${comparisonSelection.secondarySource.label}`;
  const hasComparisonSymbols = availableSymbols.length > 0;

  return (
    <div className="min-h-screen bg-muted/20 py-6">
      <div className="container mx-auto max-w-[1900px] px-4">
        {!isAuthenticated ? (
          <AuthRequiredCard />
        ) : (
          <div className={cn("grid gap-6", subscription ? "lg:grid-cols-2" : "lg:grid-cols-1")}>
          {/* Main Trading Column */}
          <Card className="border-border/60">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-semibold tracking-tight">
                    交易
                  </CardTitle>
                  <CardDescription className="text-xs">
                    查看账户资产，并基于 {selectedExchangesLabel} 的费率比较准备套利。
                  </CardDescription>
                </div>
                <button
                  onClick={() => setShowConfig((v) => !v)}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <TrendingUp className="h-4 w-4" />
                  {showConfig ? "隐藏套利设置" : "开始套利交易"}
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {errorMessage ? (
                <Alert variant="destructive">
                  <AlertTitle>无法加载余额</AlertTitle>
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              ) : normalized ? (
                <>
                  <CompactWalletSummary totalUsd={normalized.totalUsd} venues={normalized.venues} />

                  {/* Monitoring area sits between summary and positions */}
                  {showMonitoringArea && (
                    <div className="rounded-xl border bg-card/40 p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold">套利交易设置</h3>
                          <p className="text-xs text-muted-foreground">
                            配置套利参数并实时查看 {selectedExchangesLabel} 订单簿。
                          </p>
                          <p className="mt-1 text-[11px] text-muted-foreground">
                            币种来源：{hasComparisonSymbols
                              ? `费率比较筛选的 ${availableSymbols.length} 个币种`
                              : "请先在费率比较页筛选可用币种"}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setShowConfig((v) => !v)}
                            className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted"
                          >
                            {showConfig ? "收起配置" : "展开配置"}
                          </button>
                          {subscription && (
                            <button
                              onClick={handleReset}
                              className="rounded-md border px-3 py-2 text-xs font-medium hover:bg-muted"
                            >
                              停止套利
                            </button>
                          )}
                        </div>
                      </div>

                      {showConfig && (
                        <MonitoringConfigCard
                          onClose={() => setShowConfig(false)}
                          onStartMonitoring={handleStartMonitoring}
                          availableSymbols={availableSymbols}
                          primaryLabel={comparisonSelection.primarySource.label}
                          secondaryLabel={comparisonSelection.secondarySource.label}
                        />
                      )}
                    </div>
                  )}

                  <UnifiedPositionsTable venues={normalized.venues} />
                  <TransactionHistoryTable />
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  正在等待余额数据……
                </p>
              )}
            </CardContent>
          </Card>

          {/* Order Book Column */}
          {subscription && (
            <OrderBookCard
              subscription={subscription}
              onReset={handleReset}
            />
          )}
          </div>
        )}
      </div>
    </div>
  );
}

function TradingPageFallback() {
  return (
    <div className="min-h-screen bg-muted/20 py-6">
      <div className="container mx-auto max-w-[1900px] px-4">
        <div className="rounded-lg border bg-card/60 p-6 text-sm text-muted-foreground">
          正在加载交易页面…
        </div>
      </div>
    </div>
  );
}

export default function TradingPage() {
  return (
    <Suspense fallback={<TradingPageFallback />}>
      <TradingPageContent />
    </Suspense>
  );
}

type UnifiedVenue = {
  id: "drift" | "lighter";
  name: string;
  subtitle: string | null;
  totalUsd: number;
  balances: {
    title: string;
    headers: string[];
    rows: { key: string; cells: string[] }[];
    emptyMessage: string;
  };
  positionGroups: {
    title: string;
    headers: string[];
    rows: { key: string; cells: string[] }[];
    emptyMessage: string;
  }[];
};

type UnifiedWalletData = {
  totalUsd: number;
  venues: UnifiedVenue[];
};

function normalizeBalances(balances: BalancesResponse): UnifiedWalletData {
  const driftInfo = summarizeDrift(balances.drift);
  const lighterInfo = summarizeLighter(balances.lighter);
  const venues = [lighterInfo, driftInfo];

  const totalUsd = venues.reduce((sum, venue) => sum + venue.totalUsd, 0);

  return { totalUsd, venues };
}

function summarizeDrift(drift: DriftBalanceSnapshot): UnifiedVenue {
  const spotUsd = drift.spot_positions.reduce((sum, spot) => {
    const direction = spot.balance_type === "deposit" ? 1 : -1;
    if (spot.market_name.toLowerCase().includes("usdc")) {
      return sum + direction * spot.amount;
    }
    return sum;
  }, 0);

  const filteredPerps = drift.perp_positions.filter(
    (perp) => Math.abs(perp.quote_break_even_amount) >= 1,
  );
  const perpUsd = filteredPerps.reduce(
    (sum, perp) => sum + perp.quote_break_even_amount,
    0,
  );

  const totalUsd = spotUsd + perpUsd;

  const spotRows = drift.spot_positions.map((spot) => {
    const directionMultiplier = spot.balance_type === "deposit" ? 1 : -1;
    return {
      key: `spot-${spot.market_index}`,
      cells: [
        spot.market_name,
        formatNumber(directionMultiplier * spot.amount),
      ],
    };
  });

  const perpRows = filteredPerps.map((perp) => ({
    key: `perp-${perp.market_index}`,
    cells: [
      perp.market_name,
      formatNumber(perp.base_asset_amount),
      formatUsd(perp.quote_break_even_amount),
    ],
  }));

  return {
    id: "drift",
    name: "Drift 账户",
    subtitle: null,
    totalUsd,
    balances: {
      title: "余额",
      headers: ["货币", "数额"],
      rows: spotRows,
      emptyMessage: "暂无现货仓位",
    },
    positionGroups: [
      {
        title: "持仓",
        headers: ["市场", "仓位", "盈亏（USD）"],
        rows: perpRows,
        emptyMessage: "暂无持仓",
      },
    ],
  };
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
      formatNumber(position.position),
      formatUsd(position.position_value),
      formatUsd(position.unrealized_pnl),
    ],
  }));

  return {
    id: "lighter",
    name: "Lighter 账户",
    subtitle: null,
    totalUsd: lighter.available_balance + perpUsd,
    balances: {
      title: "余额",
      headers: ["货币", "数额"],
      rows: [
        {
          key: "lighter-available",
          cells: [
            "USDC",
            formatNumber(lighter.available_balance),
          ],
        },
      ],
      emptyMessage: "暂无可用余额",
    },
    positionGroups: [
      {
        title: "持仓",
        headers: ["市场", "仓位", "持仓价值", "未实现盈亏"],
        rows: positionRows,
        emptyMessage: "暂无持仓",
      },
    ],
  };
}

function CompactWalletSummary({ totalUsd, venues }: { totalUsd: number; venues: UnifiedVenue[] }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            总资产
          </p>
          <p className="text-2xl font-semibold">{formatUsd(totalUsd)}</p>
        </div>
        {venues.map((venue) => (
          <div key={venue.id}>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {venue.name}
            </p>
            <p className="text-lg font-semibold">{formatUsd(venue.totalUsd)}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

type UnifiedPosition = {
  venue: string;
  market: string;
  position: number;
  positionValue: number;
  unrealizedPnl: number | null;
};

function UnifiedPositionsTable({ venues }: { venues: UnifiedVenue[] }) {
  const allPositions: UnifiedPosition[] = [];

  venues.forEach((venue) => {
    venue.positionGroups.forEach((group) => {
      group.rows.forEach((row) => {
        if (venue.id === "drift") {
          // Drift 格式: [市场, 仓位, 盈亏（USD）]
          allPositions.push({
            venue: venue.name,
            market: row.cells[0],
            position: parseFloat(row.cells[1].replace(/,/g, "")),
            positionValue: parseFloat(
              row.cells[2].replace(/[$,]/g, ""),
            ),
            unrealizedPnl: parseFloat(
              row.cells[2].replace(/[$,]/g, ""),
            ),
          });
        } else if (venue.id === "lighter") {
          // Lighter 格式: [市场, 仓位, 持仓价值, 未实现盈亏]
          allPositions.push({
            venue: venue.name,
            market: row.cells[0],
            position: parseFloat(row.cells[1].replace(/,/g, "")),
            positionValue: parseFloat(
              row.cells[2].replace(/[$,]/g, ""),
            ),
            unrealizedPnl: parseFloat(
              row.cells[3].replace(/[$,]/g, ""),
            ),
          });
        }
      });
    });
  });

  return (
    <section className="space-y-2">
      <SectionTitle>当前持仓</SectionTitle>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>交易所</TableHead>
              <TableHead>市场</TableHead>
              <TableHead className="text-right">仓位</TableHead>
              <TableHead className="text-right">持仓价值</TableHead>
              <TableHead className="text-right">未实现盈亏</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {allPositions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-sm text-muted-foreground">
                  暂无持仓
                </TableCell>
              </TableRow>
            ) : (
              allPositions.map((pos, index) => (
                <TableRow key={`${pos.venue}-${pos.market}-${index}`}>
                  <TableCell className="font-medium">{pos.venue}</TableCell>
                  <TableCell>{pos.market}</TableCell>
                  <TableCell className="text-right">
                    {formatNumber(pos.position)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatUsd(pos.positionValue)}
                  </TableCell>
                  <TableCell
                    className={`text-right ${pos.unrealizedPnl !== null
                        ? pos.unrealizedPnl >= 0
                          ? "text-green-600"
                          : "text-red-600"
                        : ""
                      }`}
                  >
                    {pos.unrealizedPnl !== null
                      ? formatUsd(pos.unrealizedPnl)
                      : "-"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function TransactionHistoryTable() {
  // 暂时为空，等待后端API
  const transactions: never[] = [];

  return (
    <section className="space-y-2">
      <SectionTitle>交易历史</SectionTitle>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>时间</TableHead>
              <TableHead>交易所</TableHead>
              <TableHead>市场</TableHead>
              <TableHead>类型</TableHead>
              <TableHead className="text-right">数量</TableHead>
              <TableHead className="text-right">价格</TableHead>
              <TableHead className="text-right">手续费</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-24 text-center text-sm text-muted-foreground">
                  暂无交易历史数据
                </TableCell>
              </TableRow>
            ) : (
              transactions.map(() => null)
            )}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold tracking-tight text-foreground">
      {children}
    </h3>
  );
}

function AuthRequiredCard() {
  return (
    <div className="mx-auto max-w-3xl">
      <Card className="border-dashed border-primary/30 bg-card/70 shadow-md">
        <CardHeader className="space-y-2">
          <CardTitle className="text-2xl font-semibold">需要登录</CardTitle>
          <CardDescription className="text-sm text-muted-foreground">
            请先登录以查看 Drift / Lighter 账户余额并开启订单簿监控。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
          >
            前往登录
          </Link>
          <p className="text-xs text-muted-foreground">
            登录后将自动刷新本页面。
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
