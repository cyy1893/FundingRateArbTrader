"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { X, Loader2 } from "lucide-react";

import type { ArbitrageAnnualizedEntry } from "@/lib/arbitrage";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";

type SidebarRequest = {
  sourceA: string;
  sourceB: string;
  volumeThreshold: number;
};

type ArbitrageSidebarPayload = {
  metadata: {
    primarySourceLabel: string;
    secondarySourceLabel: string;
    volumeLabel: string;
    fetchedAt: string | null;
  };
  entries: ArbitrageAnnualizedEntry[];
  failures: Array<{ symbol: string; reason: string }>;
};

type SidebarState = {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  data: ArbitrageSidebarPayload | null;
  lastRequest: SidebarRequest | null;
  open: (request: SidebarRequest) => void;
  close: () => void;
};

const SidebarContext = createContext<SidebarState | null>(null);

export function ArbitrageSidebarProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ArbitrageSidebarPayload | null>(null);
  const [lastRequest, setLastRequest] = useState<SidebarRequest | null>(null);

  const open = useCallback(async (request: SidebarRequest) => {
    const sameRequest =
      lastRequest &&
      lastRequest.sourceA === request.sourceA &&
      lastRequest.sourceB === request.sourceB &&
      lastRequest.volumeThreshold === request.volumeThreshold;

    if (sameRequest && data) {
      setIsOpen((prev) => !prev);
      return;
    }

    setLastRequest(request);
    const params = new URLSearchParams({
      sourceA: request.sourceA,
      sourceB: request.sourceB,
      volumeThreshold: String(request.volumeThreshold),
    });

    setIsOpen(true);
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const response = await fetch(`/api/arbitrage?${params.toString()}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "无法加载套利数据");
      }
      const payload = (await response.json()) as ArbitrageSidebarPayload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "无法加载套利数据");
    } finally {
      setLoading(false);
    }
  }, [data, lastRequest]);

  const close = useCallback(() => {
    setIsOpen(false);
    setLoading(false);
    setError(null);
    setData(null);
  }, []);

  const value = useMemo(
    () => ({
      isOpen,
      loading,
      error,
      data,
      lastRequest,
      open,
      close,
    }),
    [isOpen, loading, error, data, lastRequest, open, close],
  );

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useArbitrageSidebar() {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useArbitrageSidebar must be used within provider");
  }
  return ctx;
}

export function ArbitrageSidebar() {
  const { isOpen, loading, error, data, close } = useArbitrageSidebar();
  const hasContent = Boolean(data && data.entries.length > 0);

  return (
    <aside
      className={cn(
        "pointer-events-none flex h-full flex-shrink-0 transition-all duration-300",
        isOpen ? "w-[460px] opacity-100" : "w-0 opacity-0",
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex h-full w-full flex-col rounded-xl border bg-card shadow-lg",
          !isOpen && "hidden",
        )}
      >
        <div className="flex items-start justify-between border-b p-4">
          <div>
            <p className="text-sm font-semibold">24 小时套利 APR</p>
            <p className="text-xs text-muted-foreground">
              {data
                ? `${data.metadata.primarySourceLabel} vs ${data.metadata.secondarySourceLabel}`
                : "请选择交易对"}
            </p>
            {data?.metadata.fetchedAt ? (
              <p className="mt-1 text-[11px] text-muted-foreground">
                数据更新：{" "}
                {new Date(data.metadata.fetchedAt).toLocaleString("zh-CN")}
              </p>
            ) : null}
          </div>
          <Button variant="ghost" size="icon" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                计算套利收益…
              </div>
            </div>
          ) : error ? (
            <Alert variant="destructive">
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : hasContent ? (
            <ArbitrageResults payload={data!} />
          ) : (
            <p className="text-sm text-muted-foreground">
              选择交易所并点击“查看 24 小时套利 APR”以查看结果。
            </p>
          )}
        </div>
      </div>
    </aside>
  );
}

function ArbitrageResults({ payload }: { payload: ArbitrageSidebarPayload }) {
  const topEntries = payload.entries.slice(0, 20);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
        <div>
          注：仅显示 {payload.metadata.volumeLabel} 且双方均有合约的币种。
        </div>
        {payload.failures.length > 0 ? (
          <div className="mt-2">
            {payload.failures.length} 个币种因数据缺失暂不可用。
          </div>
        ) : null}
      </div>
      <Table>
        <TableHeader>
          <TableRow className="text-[11px] uppercase tracking-wide text-muted-foreground">
            <TableHead>币种</TableHead>
            <TableHead>方向</TableHead>
            <TableHead className="text-right">24 小时收益</TableHead>
            <TableHead className="text-right">平均每小时</TableHead>
            <TableHead className="text-right">预计年化</TableHead>
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
              <TableCell className="text-right text-sm font-medium">
                {formatDecimalPercent(entry.totalDecimal)}
              </TableCell>
              <TableCell className="text-right text-xs text-muted-foreground">
                {formatDecimalPercent(entry.averageHourlyDecimal)}
              </TableCell>
              <TableCell className="text-right font-semibold text-primary">
                {formatDecimalPercent(entry.annualizedDecimal)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function renderDirection(
  entry: ArbitrageAnnualizedEntry,
  metadata: ArbitrageSidebarPayload["metadata"],
) {
  if (entry.direction === "leftLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="font-medium text-emerald-500">
          {metadata.primarySourceLabel} 开多
        </p>
        <p className="font-medium text-rose-500">
          {metadata.secondarySourceLabel} 开空
        </p>
      </div>
    );
  }
  if (entry.direction === "rightLong") {
    return (
      <div className="space-y-1 leading-tight">
        <p className="font-medium text-emerald-500">
          {metadata.secondarySourceLabel} 开多
        </p>
        <p className="font-medium text-rose-500">
          {metadata.primarySourceLabel} 开空
        </p>
      </div>
    );
  }
  return (
    <p className="text-xs text-muted-foreground">方向不明</p>
  );
}

function formatDecimalPercent(value: number): string {
  if (!Number.isFinite(value)) {
    return "—";
  }
  const percent = value * 100;
  if (Math.abs(percent) >= 0.01) {
    return `${percent.toFixed(2)}%`;
  }
  return `${percent.toFixed(4)}%`;
}
