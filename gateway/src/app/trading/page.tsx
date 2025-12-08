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
import type {
  BalancesResponse,
  DriftBalanceSnapshot,
  LighterBalanceSnapshot,
} from "@/types/trader";

const API_BASE_URL =
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export const dynamic = "force-dynamic";
export const revalidate = 0;

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

async function fetchBalances(): Promise<BalancesResponse> {
  const response = await fetch(`${API_BASE_URL}/balances`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`获取余额失败（HTTP ${response.status}）`);
  }

  return response.json();
}

export default async function TradingPage() {
  let balances: BalancesResponse | null = null;
  let errorMessage: string | null = null;
  let normalized: UnifiedWalletData | null = null;

  try {
    balances = await fetchBalances();
    normalized = normalizeBalances(balances);
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : "无法获取账户余额，请确认后端服务是否正在运行。";
  }

  return (
    <div className="min-h-screen bg-muted/20 py-6">
      <div className="container mx-auto flex max-w-[1900px] flex-col gap-4 px-4">
        <Card className="border-border/60">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl font-semibold tracking-tight">
              交易
            </CardTitle>
            <CardDescription className="text-xs">
              查看 Drift / Lighter 账户的最新余额和持仓。
            </CardDescription>
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
      </div>
    </div>
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
  const venues = [driftInfo, lighterInfo];

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
                    className={`text-right ${
                      pos.unrealizedPnl !== null
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

function EmptyState({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-sm font-semibold tracking-tight text-foreground">
      {children}
    </h3>
  );
}
