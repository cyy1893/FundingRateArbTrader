import { Suspense } from "react";

import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { DashboardContentClient } from "@/components/dashboard-content-client";
import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
} from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";

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
  let volumeThreshold =
    Number.isFinite(parsedVolumeThreshold) && parsedVolumeThreshold >= 0
      ? parsedVolumeThreshold
      : DEFAULT_VOLUME_THRESHOLD;
  if (volumeThreshold > 0 && volumeThreshold < DEFAULT_VOLUME_THRESHOLD) {
    volumeThreshold = DEFAULT_VOLUME_THRESHOLD;
  }
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
      <div className="w-full px-4 md:px-8">
        <Suspense fallback={<DashboardSkeleton />}>
          <DashboardContentClient
            primarySource={primarySource}
            secondarySource={secondarySource}
            volumeThreshold={volumeThreshold}
          />
        </Suspense>
      </div>
    </div>
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
