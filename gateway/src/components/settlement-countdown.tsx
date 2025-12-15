"use client";

import { useEffect, useMemo, useState } from "react";

import { MS_PER_HOUR, MS_PER_MINUTE } from "@/lib/funding";
import { cn } from "@/lib/utils";

type SettlementCountdownProps = {
  targetIso: string;
  periodHours?: number;
  className?: string;
};

function rollForward(
  currentMs: number,
  initialTargetMs: number,
  periodMs: number,
): number {
  if (!Number.isFinite(initialTargetMs)) {
    return currentMs + periodMs;
  }

  if (currentMs < initialTargetMs) {
    return initialTargetMs;
  }

  const elapsed = currentMs - initialTargetMs;
  const periodsToAdd = Math.floor(elapsed / periodMs) + 1;
  return initialTargetMs + periodsToAdd * periodMs;
}

export function SettlementCountdown({
  targetIso,
  periodHours = 1,
  className,
}: SettlementCountdownProps) {
  const baseTargetMs = useMemo(() => {
    const parsed = new Date(targetIso).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }, [targetIso]);

  const [nowMs, setNowMs] = useState<number | null>(null);
  const periodMs = Math.max(1, Math.round(periodHours * MS_PER_HOUR));

  useEffect(() => {
    const update = () => setNowMs(Date.now());
    update();
    const intervalId = window.setInterval(update, 1000);
    return () => window.clearInterval(intervalId);
  }, []);

  if (nowMs === null) {
    return (
      <span className={cn("tabular-nums font-semibold text-foreground", className)}>
        --时 --分 --秒
      </span>
    );
  }

  const targetMs = rollForward(nowMs, baseTargetMs, periodMs);
  const diffMs = Math.max(0, targetMs - nowMs);
  const hours = Math.floor(diffMs / MS_PER_HOUR);
  const minutes = Math.floor((diffMs % MS_PER_HOUR) / MS_PER_MINUTE);
  const seconds = Math.floor((diffMs % MS_PER_MINUTE) / 1000);

  const format = (value: number, suffix: string, pad: boolean = false) =>
    `${pad ? value.toString().padStart(2, "0") : value}${suffix}`;

  return (
    <span className={cn("tabular-nums font-semibold text-foreground", className)}>
      {`${format(hours, "小时")} ${format(minutes, "分", true)} ${format(
        seconds,
        "秒",
        true,
      )}`}
    </span>
  );
}
