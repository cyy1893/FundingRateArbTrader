import Link from "next/link";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatFundingRate, formatVolume } from "@/lib/formatters";
import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
  type SourceConfig,
} from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";
import {
  computeArbitrageAnnualizedSnapshot,
  type ArbitrageAnnualizedEntry,
} from "@/lib/arbitrage";
import { getPerpetualSnapshot } from "@/lib/perp-snapshot";
import type { MarketRow } from "@/types/market";

type ArbitrageSearchParams = {
  sourceA?: string | string[];
  sourceB?: string | string[];
  externalSource?: string | string[];
  hyperSource?: string | string[];
  volumeThreshold?: string | string[];
};

type ArbitragePageProps = {
  searchParams?: ArbitrageSearchParams | Promise<ArbitrageSearchParams>;
};

export const revalidate = 0;

function extractFirst(value?: string | string[]): string | undefined {
  if (!value) {
    return undefined;
  }
  return Array.isArray(value) ? value[0] : value;
}

function resolveSources(
  searchParams: ArbitrageSearchParams | undefined,
): { primarySource: SourceConfig; secondarySource: SourceConfig } {
  const requestedPrimarySource =
    extractFirst(searchParams?.sourceA) ??
    extractFirst(searchParams?.hyperSource);
  const requestedSecondarySource =
    extractFirst(searchParams?.sourceB) ??
    extractFirst(searchParams?.externalSource);

  return {
    primarySource: normalizeSource(
      requestedPrimarySource,
      DEFAULT_LEFT_SOURCE,
    ),
    secondarySource: normalizeSource(
      requestedSecondarySource,
      DEFAULT_RIGHT_SOURCE,
    ),
  };
}

function resolveVolumeThreshold(
  searchParams: ArbitrageSearchParams | undefined,
): number {
  const volumeParam = extractFirst(searchParams?.volumeThreshold);
  const parsed =
    volumeParam != null ? Number.parseInt(volumeParam, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_VOLUME_THRESHOLD;
}

function filterRowsByVolume(
  rows: MarketRow[],
  volumeThreshold: number,
): MarketRow[] {
  return rows.filter((row) => {
    if (!row.right?.symbol) {
      return false;
    }
    if (volumeThreshold <= 0) {
      return true;
    }
    const leftVolume =
      Number.isFinite(row.dayNotionalVolume ?? NaN) && row.dayNotionalVolume != null
        ? row.dayNotionalVolume
        : 0;
    const rightVolume =
      Number.isFinite(row.right.volumeUsd ?? NaN) && row.right.volumeUsd != null
        ? row.right.volumeUsd
        : 0;
    return leftVolume >= volumeThreshold && rightVolume >= volumeThreshold;
  });
}

function describeDirection(
  entry: ArbitrageAnnualizedEntry,
  leftLabel: string,
  rightLabel: string,
): string {
  if (entry.direction === "leftLong") {
    return `${leftLabel} 开多 / ${rightLabel} 开空`;
  }
  if (entry.direction === "rightLong") {
    return `${rightLabel} 开多 / ${leftLabel} 开空`;
  }
  return "方向不明";
}

export default async function ArbitragePage({
  searchParams,
}: ArbitragePageProps = {}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const { primarySource, secondarySource } = resolveSources(
    resolvedSearchParams,
  );
  const volumeThreshold = resolveVolumeThreshold(resolvedSearchParams);

  let snapshot = null;
  let errorMessage: string | null = null;

  try {
    snapshot = await getPerpetualSnapshot(primarySource, secondarySource);
  } catch (error) {
    errorMessage =
      error instanceof Error
        ? error.message
        : `无法加载 ${primarySource.label} 市场数据。`;
  }

  const rows = snapshot?.rows ?? [];
  const filteredRows = filterRowsByVolume(rows, volumeThreshold);
  let arbitrageSnapshot = null;

  if (!errorMessage) {
    try {
      arbitrageSnapshot = await computeArbitrageAnnualizedSnapshot(
        filteredRows,
        primarySource,
        secondarySource,
      );
    } catch (error) {
      errorMessage =
        error instanceof Error
          ? error.message
          : "无法计算套利年化收益。";
    }
  }

  const entries = arbitrageSnapshot?.entries ?? [];
  const failures = arbitrageSnapshot?.failures ?? [];
  const searchParamsForLinks = new URLSearchParams({
    sourceA: primarySource.id,
    sourceB: secondarySource.id,
    volumeThreshold: String(volumeThreshold),
  }).toString();
  const volumeLabel =
    volumeThreshold <= 0
      ? "两端不限"
      : `两端 ≥ ${formatVolume(volumeThreshold)}`;

  return (
    <div className="min-h-screen bg-muted/20 py-10">
      <div className="container mx-auto flex max-w-[1200px] flex-col gap-6 px-4">
        <Card className="border-border/60">
          <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-2">
              <CardTitle className="text-2xl font-semibold tracking-tight">
                24 小时套利收益榜
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                基于 {primarySource.label} 与 {secondarySource.label} 最近 24 小时的资金费率历史，
                仅显示 {volumeLabel} 且双方均有合约的币种，估算对冲套利的预计年化收益。
              </CardDescription>
            </div>
            <div className="flex flex-col gap-2 text-sm text-muted-foreground">
              <div>
                数据来源更新时间：{" "}
                <span className="font-medium text-foreground">
                  {snapshot?.fetchedAt
                    ? snapshot.fetchedAt.toLocaleString("zh-CN")
                    : "—"}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <Link href={`/?${searchParamsForLinks}`}>返回资金费率比较</Link>
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {errorMessage ? (
              <Alert variant="destructive">
                <AlertTitle>计算失败</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            {!errorMessage && failures.length > 0 ? (
              <Alert variant="default">
                <AlertTitle>部分币种无法计算</AlertTitle>
                <AlertDescription>
                  {failures.length > 3 ? (
                    <span>
                      {failures.length} 个币种因数据缺失暂不可用。
                    </span>
                  ) : (
                    <ul className="list-disc space-y-1 pl-4 text-xs">
                      {failures.map((failure) => (
                        <li key={failure.symbol}>
                          <span className="font-semibold">{failure.symbol}:</span>{" "}
                          {failure.reason}
                        </li>
                      ))}
                    </ul>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            {!errorMessage ? (
              <div className="rounded-xl border bg-card">
                {entries.length === 0 ? (
                  <div className="py-10 text-center text-sm text-muted-foreground">
                    暂无可用的套利收益数据。
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                        <TableHead className="w-12 text-center">排名</TableHead>
                        <TableHead className="text-left">币种</TableHead>
                        <TableHead className="text-left">建仓方向</TableHead>
                        <TableHead className="text-right">
                          24 小时套利收益
                        </TableHead>
                        <TableHead className="text-right">
                          平均每小时
                        </TableHead>
                        <TableHead className="text-right">
                          预计年化收益
                        </TableHead>
                        <TableHead className="text-right">
                          有效小时
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {entries.map((entry, index) => (
                        <TableRow key={entry.symbol}>
                          <TableCell className="text-center text-sm font-semibold">
                            {index + 1}
                          </TableCell>
                          <TableCell className="text-sm font-medium text-foreground">
                            {entry.displayName}
                            <span className="ml-2 text-xs uppercase text-muted-foreground">
                              {entry.symbol}
                            </span>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {describeDirection(
                              entry,
                              primarySource.label,
                              secondarySource.label,
                            )}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium tabular-nums">
                            {formatFundingRate(entry.totalDecimal)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-medium tabular-nums">
                            {formatFundingRate(entry.averageHourlyDecimal)}
                          </TableCell>
                          <TableCell className="text-right text-sm font-semibold text-emerald-500 tabular-nums">
                            {formatFundingRate(entry.annualizedDecimal)}
                          </TableCell>
                          <TableCell className="text-right text-sm text-muted-foreground tabular-nums">
                            {entry.sampleCount}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
