"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Loader2,
  Milestone,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type ArbExecutionStepView = {
  key: string;
  label: string;
  description: string;
  status: "complete" | "current" | "upcoming" | "failed";
};

export type ArbExecutionLegView = {
  venue: "lighter" | "grvt";
  label: string;
  side: "buy" | "sell";
  targetPrice: number | null;
  targetSize: number | null;
  bestBid: number | null;
  bestAsk: number | null;
  filledSize: number;
  remainingSize: number | null;
  fillProgressPct: number;
  status: "waiting" | "submitting" | "posted" | "filling" | "filled" | "failed";
  statusLabel: string;
  orderStatus: string | null;
  orderReference: string | null;
  detail: string | null;
};

export type ArbExecutionDialogModel = {
  symbol: string;
  notional: number | null;
  statusLabel: string;
  statusTone: "default" | "secondary" | "destructive" | "outline";
  message: string | null;
  positionStatus: string | null;
  riskSummary: string | null;
  steps: ArbExecutionStepView[];
  leftLeg: ArbExecutionLegView;
  rightLeg: ArbExecutionLegView;
};

function formatPrice(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  if (Math.abs(value) >= 1000) {
    return value.toFixed(2);
  }
  if (Math.abs(value) >= 1) {
    return value.toFixed(4);
  }
  return value.toFixed(6);
}

function formatSize(value: number | null): string {
  if (value == null || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(6);
}

function StepIcon({ status }: { status: ArbExecutionStepView["status"] }) {
  if (status === "complete") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  if (status === "failed") {
    return <AlertTriangle className="h-4 w-4 text-rose-600" />;
  }
  if (status === "current") {
    return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  }
  return <Circle className="h-4 w-4 text-slate-300" />;
}

function LegStatusBadge({
  status,
  label,
}: {
  status: ArbExecutionLegView["status"];
  label: string;
}) {
  const className =
    status === "filled"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : status === "filling"
        ? "border-blue-200 bg-blue-50 text-blue-700"
        : status === "posted"
          ? "border-amber-200 bg-amber-50 text-amber-700"
      : status === "failed"
        ? "border-rose-200 bg-rose-50 text-rose-700"
      : status === "submitting"
          ? "border-amber-200 bg-amber-50 text-amber-700"
          : "border-slate-200 bg-slate-50 text-slate-600";
  return (
    <div className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", className)}>
      {label}
    </div>
  );
}

function ExecutionLegCard({ leg }: { leg: ArbExecutionLegView }) {
  const sideLabel = leg.side === "buy" ? "买入" : "卖出";
  const sideClass = leg.side === "buy" ? "text-emerald-600" : "text-rose-600";

  return (
    <Card className="h-full rounded-2xl border-slate-200 shadow-none">
      <CardHeader className="space-y-3 p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{leg.label}</CardTitle>
            <div className={cn("mt-1 text-sm font-semibold", sideClass)}>{sideLabel}</div>
          </div>
          <LegStatusBadge status={leg.status} label={leg.statusLabel} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        <div className="grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">当前买一</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatPrice(leg.bestBid)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">当前卖一</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatPrice(leg.bestAsk)}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">目标挂单价</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatPrice(leg.targetPrice)}</div>
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">目标数量</div>
            <div className="mt-1 text-sm font-semibold text-slate-900">{formatSize(leg.targetSize)}</div>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500">已成交数量</span>
            <span className="text-sm font-semibold text-slate-900">{formatSize(leg.filledSize)}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500">剩余数量</span>
            <span className="text-sm font-semibold text-slate-900">{formatSize(leg.remainingSize)}</span>
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-slate-500">
              <span>吃单进度</span>
              <span>{leg.fillProgressPct.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={cn(
                  "h-full transition-all",
                  leg.status === "filled"
                    ? "bg-emerald-500"
                    : leg.status === "filling"
                      ? "bg-blue-500"
                      : leg.status === "failed"
                        ? "bg-rose-500"
                        : "bg-amber-400",
                )}
                style={{ width: `${Math.max(0, Math.min(100, leg.fillProgressPct))}%` }}
              />
            </div>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-slate-200 p-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500">挂单状态</span>
            <span className="text-sm font-semibold text-slate-900">{leg.orderStatus ?? "未开始"}</span>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-xs text-slate-500">订单引用</span>
            <span className="max-w-[220px] truncate text-right font-mono text-[11px] text-slate-700">
              {leg.orderReference ?? "—"}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {leg.detail ?? "等待交易所返回挂单结果。"}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function ArbExecutionDialog({
  open,
  onOpenChange,
  model,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  model: ArbExecutionDialogModel | null;
}) {
  if (!model) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-6xl overflow-y-auto rounded-2xl border-slate-200 p-0">
        <div className="border-b border-slate-200 px-6 py-5">
          <DialogHeader className="space-y-3 text-left">
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-2 text-xl">
                  <Milestone className="h-5 w-5 text-primary" />
                  对冲建仓进度
                </DialogTitle>
                <DialogDescription className="mt-2 text-sm text-slate-500">
                  {model.symbol} · 名义价值 {model.notional != null ? `$${model.notional.toFixed(2)}` : "—"}
                </DialogDescription>
              </div>
              <Badge variant={model.statusTone}>{model.statusLabel}</Badge>
            </div>
            <div className="text-sm text-slate-600">
              {model.message ?? "系统正在执行双腿对冲挂单，请勿重复提交。"}
            </div>
            {model.riskSummary ? (
              <div className="text-xs text-slate-500">风控任务：{model.riskSummary}</div>
            ) : null}
          </DialogHeader>
        </div>

        <div className="space-y-6 px-6 py-5">
          <div className="overflow-x-auto">
            <div className="flex min-w-[760px] items-start">
              {model.steps.map((step, index) => (
                <div key={step.key} className="flex min-w-0 flex-1 items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <StepIcon status={step.status} />
                      <div className="truncate text-sm font-semibold text-slate-900">{step.label}</div>
                    </div>
                    <div className="mt-1 pl-6 text-xs leading-5 text-slate-500">{step.description}</div>
                  </div>
                  {index < model.steps.length - 1 ? (
                    <div className="mx-3 mt-2 h-[2px] flex-1 bg-slate-200" />
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ExecutionLegCard leg={model.leftLeg} />
            <ExecutionLegCard leg={model.rightLeg} />
          </div>

          {model.positionStatus ? (
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              当前建仓状态：<span className="font-semibold text-slate-900">{model.positionStatus}</span>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
