import { Suspense } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PerpTable } from "@/components/perp-table";
import { SettlementCountdown } from "@/components/settlement-countdown";
import { SourceControls } from "@/components/source-controls";
import {
  ArbitrageSidebar,
  ArbitrageSidebarProvider,
} from "@/components/arbitrage-sidebar";
import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
  type SourceConfig,
} from "@/lib/external";
import { computeNextSettlementTimestamp } from "@/lib/funding";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";
import { getPerpetualSnapshot, type PerpSnapshot } from "@/lib/perp-snapshot";

export const revalidate = 0;

type HomePageSearchParams = {
  sourceA?: string | string[];
  sourceB?: string | string[];
  externalSource?: string | string[];
  hyperSource?: string | string[];
  volumeThreshold?: string | string[];
};
type HomePageProps = {
  searchParams?: HomePageSearchParams | Promise<HomePageSearchParams>;
};

export default async function Home({
  searchParams,
}: HomePageProps = {}) {
  const resolvedSearchParams = (await searchParams) ?? {};
  const extractFirst = (value?: string | string[]): string | undefined => {
    if (!value) {
      return undefined;
    }
    return Array.isArray(value) ? value[0] : value;
  };
  const requestedPrimarySource =
    extractFirst(resolvedSearchParams.sourceA) ??
    extractFirst(resolvedSearchParams.hyperSource);
  const requestedSecondarySource =
    extractFirst(resolvedSearchParams.sourceB) ??
    extractFirst(resolvedSearchParams.externalSource);
  const volumeThresholdParam = extractFirst(resolvedSearchParams.volumeThreshold);
  const parsedVolumeThreshold =
    volumeThresholdParam != null
      ? Number.parseInt(volumeThresholdParam, 10)
      : DEFAULT_VOLUME_THRESHOLD;
  const volumeThreshold =
    Number.isFinite(parsedVolumeThreshold) && parsedVolumeThreshold >= 0
      ? parsedVolumeThreshold
      : DEFAULT_VOLUME_THRESHOLD;
  const primarySource = normalizeSource(
    requestedPrimarySource,
    DEFAULT_LEFT_SOURCE,
  );
  const secondarySource = normalizeSource(
    requestedSecondarySource,
    DEFAULT_RIGHT_SOURCE,
  );

  return (
    <div className="min-h-screen py-8">
      <div className="mx-auto max-w-[1800px] px-8">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContent
            primarySource={primarySource}
            secondarySource={secondarySource}
            volumeThreshold={volumeThreshold}
          />
        </Suspense>
      </div>
    </div>
  );
}

async function DashboardContent({
  primarySource,
  secondarySource,
  volumeThreshold,
}: {
  primarySource: SourceConfig;
  secondarySource: SourceConfig;
  volumeThreshold: number;
}) {
  let snapshot: PerpSnapshot | null = null;
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
  const fetchedAt = snapshot?.fetchedAt ?? new Date();
  const apiErrors = snapshot?.errors ?? [];
  const hasExternalMarketData = rows.some((row) => row.right != null);
  const secondaryErrorSource =
    secondarySource.provider === "lighter"
      ? "Lighter API"
      : secondarySource.label;
  const hasExplicitExternalError = apiErrors.some(
    (apiError) => apiError.source === secondaryErrorSource,
  );
  const truncatedErrorMessage = errorMessage ?? null;
  const displayedApiErrors = apiErrors.map((apiError, index) => ({
    key: `${apiError.source}-${index}`,
    source: apiError.source,
    message: apiError.message,
  }));

  if (
    !errorMessage &&
    rows.length > 0 &&
    !hasExternalMarketData &&
    !hasExplicitExternalError
  ) {
    displayedApiErrors.push({
      key: `${secondaryErrorSource}-missing-data`,
      source: secondaryErrorSource,
      message: `当前无法获取 ${secondarySource.label} 数据，请稍后再试。`,
    });
  }

  const settlementPeriodHours = 1;
  const nextSettlementIso = computeNextSettlementTimestamp(
    fetchedAt,
    settlementPeriodHours,
  );
  return (
    <ArbitrageSidebarProvider>
      <div className="flex gap-6">
        <div className="flex-1">
          <Card className="shadow-sm">
        <CardHeader className="space-y-6 pb-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="space-y-1.5">
              <CardTitle className="text-2xl font-semibold tracking-tight">
                资金费率比较
              </CardTitle>
              <CardDescription className="text-sm text-muted-foreground">
                跨交易所资金费率实时监控与套利机会分析
              </CardDescription>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  下次结算
                </span>
                <SettlementCountdown
                  targetIso={nextSettlementIso}
                  className="text-base font-semibold tabular-nums"
                />
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {truncatedErrorMessage ? (
            <Alert variant="destructive" className="border-destructive/50">
              <AlertTitle className="font-semibold">数据获取失败</AlertTitle>
              <AlertDescription>{truncatedErrorMessage}</AlertDescription>
            </Alert>
          ) : null}
          {displayedApiErrors.length > 0 ? (
            <Alert variant="default" className="border-border bg-muted/30">
              <AlertTitle className="font-semibold">部分数据来源不可用</AlertTitle>
              <AlertDescription>
                <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
                  {displayedApiErrors.map((apiError) => (
                    <li key={apiError.key}>
                      <span className="font-semibold">{apiError.source}:</span>{" "}
                      <span>{apiError.message}</span>
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          ) : null}
          <PerpTable
            rows={errorMessage ? [] : rows}
            leftSource={primarySource}
            rightSource={secondarySource}
            volumeThreshold={volumeThreshold}
            headerControls={
              <SourceControls
                leftSourceId={primarySource.id}
                rightSourceId={secondarySource.id}
              />
            }
          />
        </CardContent>
      </Card>
        </div>
        <ArbitrageSidebar />
      </div>
    </ArbitrageSidebarProvider>
  );
}

function DashboardSkeleton() {
  return (
    <Card className="shadow-sm">
      <CardHeader className="space-y-6 pb-6">
        <div className="w-full space-y-3 animate-pulse">
          <div className="h-8 w-56 rounded-lg bg-muted" />
          <div className="h-5 w-96 rounded-lg bg-muted/80" />
        </div>
        <div className="flex items-center justify-between">
          <div className="h-10 w-64 rounded-lg bg-muted/70" />
          <div className="h-20 w-48 rounded-xl bg-muted/60" />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="h-4 w-48 rounded bg-muted/70" />
          <div className="h-12 rounded-lg bg-muted/60" />
        </div>
        <div className="rounded-xl border border-dashed border-border">
          <div className="h-[520px] w-full animate-pulse rounded-xl bg-muted/40" />
        </div>
      </CardContent>
    </Card>
  );
}
