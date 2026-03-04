"use client";

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

import {
  FundingPredictionContent,
  FundingPredictionSidebarProvider,
  useFundingPredictionSidebar,
} from "@/components/funding-prediction-sidebar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
} from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";

function RecommendationsAutoLoad() {
  const searchParams = useSearchParams();
  const prediction = useFundingPredictionSidebar();

  const request = useMemo(() => {
    const requestedPrimarySource = searchParams.get("sourceA");
    const requestedSecondarySource = searchParams.get("sourceB");
    const volumeThresholdRaw = searchParams.get("volumeThreshold");
    const parsedVolumeThreshold =
      volumeThresholdRaw != null
        ? Number.parseInt(volumeThresholdRaw, 10)
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
    return {
      sourceA: primarySource.id,
      sourceB: secondarySource.id,
      volumeThreshold,
    };
  }, [searchParams]);

  useEffect(() => {
    prediction.open(request);
  }, [prediction, request]);

  return <FundingPredictionContent />;
}

export default function RecommendationsPage() {
  return (
    <div className="min-h-screen py-8">
      <div className="w-full px-4 md:px-8">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              推荐套利币种
            </CardTitle>
          </CardHeader>
          <CardContent className="px-0 pb-0">
            <FundingPredictionSidebarProvider>
              <Suspense
                fallback={
                  <div className="p-6 text-sm text-muted-foreground">加载推荐参数中…</div>
                }
              >
                <RecommendationsAutoLoad />
              </Suspense>
            </FundingPredictionSidebarProvider>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
