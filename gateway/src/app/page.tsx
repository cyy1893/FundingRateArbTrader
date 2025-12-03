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
    <div className="min-h-screen bg-muted/20 py-10">
      <div className="container mx-auto flex max-w-[1900px] flex-col gap-6 px-4">
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
    secondarySource.provider === "drift"
      ? "Drift Data API"
      : secondarySource.provider === "lighter"
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
    <>
      <Card className="border-border/60">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="space-y-2">
            <CardTitle className="text-2xl font-semibold tracking-tight">
              资金费率比较
            </CardTitle>
            <CardDescription className="max-w-2xl text-sm text-muted-foreground">
              各交易所资金费率的差异。
            </CardDescription>
            <SourceControls
              leftSourceId={primarySource.id}
              rightSourceId={secondarySource.id}
            />
          </div>
        <div className="rounded-lg border border-border/70 bg-muted/40 px-4 py-3 text-sm">
          <div className="flex flex-col gap-3 text-muted-foreground">
            <div className="flex items-center justify-between gap-8">
              <div className="flex flex-col gap-1">
                <span className="uppercase tracking-wide text-xs">
                  资金结算（整点）
                </span>
                <SettlementCountdown
                  targetIso={nextSettlementIso}
                  className="text-lg"
                />
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {truncatedErrorMessage ? (
          <Alert variant="destructive">
            <AlertTitle>数据获取失败</AlertTitle>
            <AlertDescription>{truncatedErrorMessage}</AlertDescription>
          </Alert>
        ) : null}
        {displayedApiErrors.length > 0 ? (
          <Alert variant="default">
            <AlertTitle>部分数据来源不可用</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
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
        />
      </CardContent>
    </Card>
    </>
  );
}

function DashboardSkeleton() {
  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="w-full space-y-2 animate-pulse">
          <div className="h-6 w-48 rounded bg-muted" />
          <div className="h-4 w-64 rounded bg-muted/80" />
        </div>
        <div className="rounded-lg border border-border/70 bg-muted/40 px-4 py-3 text-sm">
          <div className="flex flex-col gap-3 text-muted-foreground">
            <div className="flex items-center justify-between gap-8">
              <div className="flex flex-col gap-2">
                <span className="h-3 w-24 rounded bg-muted/80" />
                <span className="h-6 w-32 rounded bg-muted" />
              </div>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="h-4 w-40 rounded bg-muted/70" />
          <div className="h-11 rounded-lg bg-muted/60" />
          <div className="h-8 rounded bg-muted/40" />
        </div>
        <div className="rounded-xl border border-dashed border-border/70">
          <div className="h-[520px] w-full animate-pulse rounded-xl bg-muted/40" />
        </div>
      </CardContent>
    </Card>
  );
}
