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
    <div className="min-h-screen bg-muted/20 py-10">
      <div className="container mx-auto flex max-w-[1900px] flex-col gap-6 px-4">
        <Card className="border-border/60">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              交易
            </CardTitle>
            <CardDescription>
              查看 Drift / Lighter 账户的最新余额和持仓。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {errorMessage ? (
              <Alert variant="destructive">
                <AlertTitle>无法加载余额</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : normalized ? (
              <>
                <WalletSummary
                  totalUsd={normalized.totalUsd}
                  venues={normalized.venues}
                />
                <div className="grid gap-6 lg:grid-cols-2">
                  {normalized.venues.map((venue) => (
                    <VenueWalletCard key={venue.id} venue={venue} />
                  ))}
                </div>
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

function WalletSummary({
  totalUsd,
  venues,
}: {
  totalUsd: number;
  venues: UnifiedVenue[];
}) {
  const venueLinks: Record<UnifiedVenue["id"], string> = {
    drift: "https://app.drift.trade",
    lighter: "https://app.lighter.xyz/trade/BTC?locale=zh",
  };

  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            总资产
          </p>
          <p className="text-3xl font-semibold">{formatUsd(totalUsd)}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {venues.map((venue) => (
            <a
              key={venue.id}
              href={venueLinks[venue.id]}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-border/50 bg-background/60 px-4 py-3 text-sm transition-colors hover:text-primary hover:scale-105"
            >
              <p className="text-muted-foreground text-xs uppercase transition-colors hover:text-primary">
                {venue.name}
              </p>
              <p className="text-lg font-semibold transition-transform hover:scale-110">
                {formatUsd(venue.totalUsd)}
              </p>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function VenueWalletCard({ venue }: { venue: UnifiedVenue }) {
  return (
    <Card className="border-border/60">
      <CardHeader>
        <CardTitle className="text-xl font-semibold">{venue.name}</CardTitle>
        {venue.subtitle ? (
          <CardDescription>{venue.subtitle}</CardDescription>
        ) : null}
        <div className="text-sm text-muted-foreground">
          合计 {formatUsd(venue.totalUsd)}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-2">
          <SectionTitle>{venue.balances.title}</SectionTitle>
          {venue.balances.rows.length === 0 ? (
            <EmptyState message={venue.balances.emptyMessage} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  {venue.balances.headers.map((header) => (
                    <TableHead key={header}>{header}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {venue.balances.rows.map((row) => (
                  <TableRow key={row.key}>
                    {row.cells.map((cell, index) => (
                      <TableCell key={`${row.key}-${index}`}>{cell}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
        {venue.positionGroups.map((group) => (
          <section key={group.title} className="space-y-2">
            <SectionTitle>{group.title}</SectionTitle>
            {group.rows.length === 0 ? (
              <EmptyState message={group.emptyMessage} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    {group.headers.map((header) => (
                      <TableHead key={header}>{header}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.rows.map((row) => (
                    <TableRow key={row.key}>
                      {row.cells.map((cell, index) => (
                        <TableCell key={`${row.key}-${index}`}>{cell}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>
        ))}
      </CardContent>
    </Card>
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
