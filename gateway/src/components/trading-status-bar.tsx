"use client";

import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";

type TradingStatusBarProps = {
  totalUsd: number;
  connectionStatus: "connected" | "connecting" | "disconnected";
  lighterBalance: number;
  grvtBalance: number;
};

const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export function TradingStatusBar({
  totalUsd,
  connectionStatus,
  lighterBalance,
  grvtBalance,
}: TradingStatusBarProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-6 py-2 shadow-sm">
      <div className="flex items-center justify-between">
        {/* Left: Total Assets */}
        <div className="flex items-center gap-8">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              总资产
            </p>
            <p className="text-xl font-bold text-gray-900 font-mono">
              {usdFormatter.format(totalUsd)}
            </p>
          </div>
        </div>

        {/* Center: Exchange Balances */}
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              Lighter
            </p>
            <p className="text-sm font-semibold text-gray-700 font-mono">
              {usdFormatter.format(lighterBalance)}
            </p>
          </div>
          <div className="h-8 w-px bg-gray-300" />
          <div className="text-right">
            <p className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
              GRVT
            </p>
            <p className="text-sm font-semibold text-gray-700 font-mono">
              {usdFormatter.format(grvtBalance)}
            </p>
          </div>
        </div>

        {/* Right: Connection Status */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "h-2 w-2 rounded-full",
              connectionStatus === "connected" && "bg-green-500 animate-pulse",
              connectionStatus === "connecting" && "bg-yellow-500 animate-pulse",
              connectionStatus === "disconnected" && "bg-red-500"
            )}
          />
          <Activity className="h-4 w-4 text-gray-600" />
          <span className="text-xs font-medium text-gray-600 uppercase tracking-wide">
            {connectionStatus === "connected"
              ? "已连接"
              : connectionStatus === "connecting"
              ? "连接中"
              : "未连接"}
          </span>
        </div>
      </div>
    </div>
  );
}
