"use client";

import { useEffect, useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ErrorNotification } from "@/components/error-notification";
import { PerpTable } from "@/components/perp-table";
import { SettlementCountdown } from "@/components/settlement-countdown";
import { SourceControls } from "@/components/source-controls";
import { computeNextSettlementTimestamp } from "@/lib/funding";
import type { SourceConfig } from "@/lib/external";
import type { PerpSnapshot } from "@/lib/perp-snapshot";
import type { MarketRow } from "@/types/market";
import type { ApiError } from "@/types/api";

const SNAPSHOT_CACHE_TTL_MS = 5 * 60 * 1000;

type SnapshotPayload = {
  rows: MarketRow[];
  fetchedAt: string;
  errors: ApiError[];
};

function buildSnapshotCacheKey(primarySourceId: string, secondarySourceId: string): string {
  return `perp-snapshot:${primarySourceId}:${secondarySourceId}`;
}

export function DashboardContentClient({
  primarySource,
  secondarySource,
  volumeThreshold,
}: {
  primarySource: SourceConfig;
  secondarySource: SourceConfig;
  volumeThreshold: number;
}) {
  const [snapshot, setSnapshot] = useState<PerpSnapshot | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const snapshotCacheKey = useMemo(
    () => buildSnapshotCacheKey(primarySource.id, secondarySource.id),
    [primarySource.id, secondarySource.id],
  );

  useEffect(() => {
    let cancelled = false;

    const loadSnapshot = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
        const rawCache = window.sessionStorage.getItem(snapshotCacheKey);
        if (rawCache) {
          const parsed = JSON.parse(rawCache) as {
            ts?: number;
            payload?: SnapshotPayload;
          };
          const ts = Number(parsed?.ts ?? 0);
          if (
            parsed?.payload &&
            Number.isFinite(ts) &&
            Date.now() - ts < SNAPSHOT_CACHE_TTL_MS
          ) {
            if (!cancelled) {
              setSnapshot({
                rows: parsed.payload.rows ?? [],
                fetchedAt: new Date(parsed.payload.fetchedAt),
                errors: parsed.payload.errors ?? [],
              });
              setLoading(false);
            }
            return;
          }
        }
      } catch {
        // ignore cache read errors
      }

      try {
        const response = await fetch("/api/perp-snapshot", {
          method: "POST",
          cache: "no-store",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sourceA: primarySource.id,
            sourceB: secondarySource.id,
          }),
        });

        const payload = (await response.json().catch(() => ({}))) as {
          rows?: MarketRow[];
          fetchedAt?: string;
          errors?: ApiError[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(payload.error ?? "无法加载费率比较数据");
        }

        if (!cancelled) {
          const normalizedSnapshot: PerpSnapshot = {
            rows: payload.rows ?? [],
            fetchedAt: payload.fetchedAt ? new Date(payload.fetchedAt) : new Date(),
            errors: payload.errors ?? [],
          };
          setSnapshot(normalizedSnapshot);
          try {
            window.sessionStorage.setItem(
              snapshotCacheKey,
              JSON.stringify({
                ts: Date.now(),
                payload: {
                  rows: normalizedSnapshot.rows,
                  fetchedAt: normalizedSnapshot.fetchedAt.toISOString(),
                  errors: normalizedSnapshot.errors,
                } satisfies SnapshotPayload,
              }),
            );
          } catch {
            // ignore cache write errors
          }
        }
      } catch (error) {
        if (!cancelled) {
          setErrorMessage(
            error instanceof Error
              ? error.message
              : `无法加载 ${primarySource.label} 市场数据。`,
          );
          setSnapshot(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [primarySource.id, primarySource.label, secondarySource.id, snapshotCacheKey]);

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

  const settlementPeriods = [1, 4, 8];
  const settlementTargets = settlementPeriods.map((hours) => ({
    periodHours: hours,
    targetIso: computeNextSettlementTimestamp(fetchedAt, hours),
  }));

  if (loading) {
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

  return (
    <>
      <ErrorNotification message={errorMessage} />
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
              <div className="flex flex-wrap items-start gap-4">
                {settlementTargets.map((target) => (
                  <div
                    key={`settlement-${target.periodHours}`}
                    className="flex flex-col items-end gap-1"
                  >
                    <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      {target.periodHours}h 下次结算
                    </span>
                    <SettlementCountdown
                      targetIso={target.targetIso}
                      periodHours={target.periodHours}
                      className="text-base font-semibold tabular-nums"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {errorMessage ? (
            <Alert variant="destructive" className="border-destructive/50">
              <AlertTitle className="font-semibold">数据获取失败</AlertTitle>
              <AlertDescription>{errorMessage}</AlertDescription>
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
    </>
  );
}
