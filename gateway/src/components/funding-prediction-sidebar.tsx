"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Loader2, RefreshCw, SquareArrowOutUpRight } from "lucide-react";
import { toast } from "sonner";

import type { FundingPredictionEntry } from "@/lib/funding-prediction";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type SidebarRequest = {
  sourceA: string;
  sourceB: string;
  volumeThreshold: number;
  forceRefresh?: boolean;
};

type PredictionSidebarPayload = {
  metadata: {
    primarySourceLabel: string;
    secondarySourceLabel: string;
    volumeLabel: string;
    fetchedAt: string | null;
  };
  entries: FundingPredictionEntry[];
  failures: Array<{ symbol: string; reason: string }>;
};

type SidebarState = {
  isOpen: boolean;
  loading: boolean;
  progress: number;
  stage: string;
  error: string | null;
  data: PredictionSidebarPayload | null;
  lastRequest: SidebarRequest | null;
  open: (request: SidebarRequest) => void;
  refresh: () => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarState | null>(null);

export function FundingPredictionSidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("准备请求…");
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PredictionSidebarPayload | null>(null);
  const [lastRequest, setLastRequest] = useState<SidebarRequest | null>(null);

  const open = useCallback(async (request: SidebarRequest) => {
    const sameRequest =
      lastRequest &&
      lastRequest.sourceA === request.sourceA &&
      lastRequest.sourceB === request.sourceB &&
      lastRequest.volumeThreshold === request.volumeThreshold;

    setIsOpen(true);

    // Reuse in-flight run and existing result for the same request unless force refresh is required.
    if (!request.forceRefresh && sameRequest) {
      if (loading) {
        return;
      }
      if (data || error || progress > 0) {
        return;
      }
    }

    // Prevent accidental duplicate run creation while a task is already executing.
    if (loading && !request.forceRefresh) {
      return;
    }

    setLastRequest(request);
    const params = new URLSearchParams({
      sourceA: request.sourceA,
      sourceB: request.sourceB,
      volumeThreshold: String(request.volumeThreshold),
    });
    if (request.forceRefresh) {
      params.set("refresh", "1");
    }

    setLoading(true);
    setProgress(1);
    setStage("创建任务…");
    setError(null);
    setData(null);

    try {
      const createResponse = await fetch("/api/funding/prediction/jobs", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sourceA: request.sourceA,
          sourceB: request.sourceB,
          volumeThreshold: request.volumeThreshold,
          forceRefresh: Boolean(request.forceRefresh),
        }),
      });
      if (!createResponse.ok) {
        const createPayload = await createResponse.json().catch(() => null);
        throw new Error(createPayload?.error ?? "无法创建推荐任务");
      }
      const createPayload = (await createResponse.json()) as { jobId: string };
      if (!createPayload.jobId) {
        throw new Error("推荐任务创建失败");
      }

      while (true) {
        const statusResponse = await fetch(
          `/api/funding/prediction/jobs/${createPayload.jobId}`,
          { cache: "no-store" },
        );
        if (!statusResponse.ok) {
          const statusPayload = await statusResponse.json().catch(() => null);
          throw new Error(statusPayload?.error ?? "查询推荐任务失败");
        }
        const statusPayload = (await statusResponse.json()) as {
          status: "pending" | "running" | "completed" | "failed";
          progress: number;
          stage: string;
          error?: string | null;
          result?: PredictionSidebarPayload | null;
        };
        setProgress(Number(statusPayload.progress ?? 0));
        setStage(statusPayload.stage || "计算中…");

        if (statusPayload.status === "completed") {
          if (!statusPayload.result) {
            throw new Error("推荐任务已完成但返回为空");
          }
          setData(statusPayload.result);
          setProgress(100);
          setStage("完成");
          break;
        }
        if (statusPayload.status === "failed") {
          throw new Error(statusPayload.error || "推荐任务失败");
        }

        await new Promise((resolve) => setTimeout(resolve, 700));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "无法加载推荐套利结果";
      setError(msg);
      toast.error(msg, { className: "bg-destructive text-destructive-foreground" });
    } finally {
      setLoading(false);
    }
  }, [data, error, lastRequest, loading, progress]);

  const refresh = useCallback(() => {
    if (!lastRequest) {
      return;
    }
    open({ ...lastRequest, forceRefresh: true });
  }, [lastRequest, open]);

  const close = useCallback(() => {
    setIsOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      loading,
      progress,
      stage,
      error,
      data,
      lastRequest,
      open,
      refresh,
      close,
    }),
    [isOpen, loading, progress, stage, error, data, lastRequest, open, refresh, close],
  );

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useFundingPredictionSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useFundingPredictionSidebar must be used within provider");
  }
  return ctx;
}

export function FundingPredictionContent() {
  const { loading, stage, error, data, refresh, lastRequest } = useFundingPredictionSidebar();
  const hasContent = Boolean(data && data.entries.length > 0);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-start justify-between border-b p-6">
        <div>
          <h2 className="text-lg font-semibold leading-none tracking-tight">
            推荐套利币种
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {data
              ? `${data.metadata.primarySourceLabel} vs ${data.metadata.secondarySourceLabel}`
              : "请选择交易对"}
          </p>
          {data?.metadata.fetchedAt ? (
            <p className="mt-1 text-xs text-muted-foreground">
              数据更新：{" "}
              {new Date(data.metadata.fetchedAt).toLocaleString("zh-CN")}
            </p>
          ) : null}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={loading || !lastRequest}
          className="h-8"
        >
          <RefreshCw className={cn("mr-2 h-3.5 w-3.5", loading && "animate-spin")} />
          刷新
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <div className="w-full max-w-md space-y-3 text-center text-sm">
              <div className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>正在计算推荐结果…</span>
              </div>
              <p className="text-xs text-muted-foreground">
                当前阶段：{stage || "处理中"}
              </p>
            </div>
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>加载失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : hasContent ? (
          <PredictionResults payload={data!} />
        ) : (
          <p className="text-sm text-muted-foreground">
            选择交易所并点击“推荐套利币种”以查看结果。
          </p>
        )}
      </div>
    </div>
  );
}

export function FundingPredictionSidebar() {
  useFundingPredictionSidebar();
  return null;
}

function PredictionResults({ payload }: { payload: PredictionSidebarPayload }) {
  const topEntries = payload.entries.slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <div>
          注：预测年化 APR 采用“沿当前有利方向持有，直到不再盈利”为口径；评分偏好高 APR、低价格波动、低点差。“建议建仓时机”仅用于提示，不参与综合分。仅显示 {payload.metadata.volumeLabel} 的币种。
        </div>
        {payload.failures.length > 0 ? (
          <div className="mt-2">
            {payload.failures.length} 个币种因数据缺失暂不可用。
          </div>
        ) : null}
      </div>
      <div className="overflow-x-auto">
      <Table className="whitespace-nowrap">
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <TableHead>币种</TableHead>
            <TableHead>方向</TableHead>
            <TableHead className="text-right">建议建仓时机</TableHead>
            <TableHead className="text-right">预测年化 APR</TableHead>
            <TableHead className="text-right">价格波动率(24h估算)</TableHead>
            <TableHead className="text-right">点差(Lighter)</TableHead>
            <TableHead className="text-right">点差(GRVT)</TableHead>
            <TableHead className="text-right">综合分</TableHead>
            <TableHead className="text-right">去交易</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {topEntries.map((entry) => (
            <TableRow key={entry.symbol}>
              <TableCell className="font-semibold">
                {entry.displayName}
              </TableCell>
              <TableCell className="text-xs">
                {renderDirection(entry, payload.metadata)}
              </TableCell>
              <TableCell className="text-right text-xs font-medium text-foreground">
                {entry.entryTimingAdvice}
              </TableCell>
              <TableCell className="text-right font-semibold text-primary">
                {formatDecimalPercent(entry.annualizedDecimal)}
              </TableCell>
              <TableCell className="text-right text-sm font-medium">
                {formatPercent(entry.priceVolatility24hPct)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {formatBps(entry.leftBidAskSpreadBps)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {formatBps(entry.rightBidAskSpreadBps)}
              </TableCell>
              <TableCell className="text-right text-sm font-semibold">
                {entry.recommendationScore.toFixed(2)}
              </TableCell>
              <TableCell className="text-right">
                <a
                  href={`/trading?symbol=${entry.symbol}&lighterDir=${entry.direction === "leftLong" ? "long" : "short"
                    }&grvtDir=${entry.direction === "leftLong" ? "short" : "long"
                    }`}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-muted-foreground hover:border-border hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  title="前往交易"
                >
                  <SquareArrowOutUpRight className="h-4 w-4" />
                </a>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}

function renderDirection(
  entry: FundingPredictionEntry,
  metadata: PredictionSidebarPayload["metadata"],
) {
  if (entry.direction === "leftLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
          <span className="inline-block rounded-[2px] bg-emerald-100 px-1 py-0.5 text-[10px] leading-none text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            多
          </span>
          {metadata.primarySourceLabel}
        </p>
        <p className="flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-block rounded-[2px] bg-rose-100 px-1 py-0.5 text-[10px] leading-none text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            空
          </span>
          {metadata.secondarySourceLabel}
        </p>
      </div>
    );
  }
  if (entry.direction === "rightLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="flex items-center gap-1 font-medium text-rose-600 dark:text-rose-400">
          <span className="inline-block rounded-[2px] bg-rose-100 px-1 py-0.5 text-[10px] leading-none text-rose-700 dark:bg-rose-900/30 dark:text-rose-300">
            空
          </span>
          {metadata.primarySourceLabel}
        </p>
        <p className="flex items-center gap-1 font-medium text-emerald-600 dark:text-emerald-400">
          <span className="inline-block rounded-[2px] bg-emerald-100 px-1 py-0.5 text-[10px] leading-none text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
            多
          </span>
          {metadata.secondarySourceLabel}
        </p>
      </div>
    );
  }
  return <p className="text-xs text-muted-foreground">方向不明</p>;
}

function formatDecimalPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const percent = value * 100;
  return `${percent.toFixed(4)}%`;
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(4)}%`;
}

function formatBps(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  return `${value.toFixed(2)} bps`;
}
