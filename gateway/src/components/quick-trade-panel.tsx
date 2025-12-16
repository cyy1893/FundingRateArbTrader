"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderBookSubscription } from "@/hooks/use-order-book-websocket";

type SymbolOption = { symbol: string; displayName: string };

type QuickTradePanelProps = {
  onStartMonitoring: (subscription: OrderBookSubscription) => void;
  availableSymbols: SymbolOption[];
  primaryLabel: string;
  secondaryLabel: string;
  isMonitoring: boolean;
};

const LEVERAGE_OPTIONS = [1, 2, 5, 10, 20];

export function QuickTradePanel({
  onStartMonitoring,
  availableSymbols,
  primaryLabel,
  secondaryLabel,
  isMonitoring,
}: QuickTradePanelProps) {
  const [symbol, setSymbol] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [direction, setDirection] = useState<"long" | "short">("long");
  const [notionalValue, setNotionalValue] = useState("1000");

  const hasSymbols = availableSymbols.length > 0;

  useEffect(() => {
    if (!hasSymbols) {
      setSymbol("");
      return;
    }
    const exists = availableSymbols.some((option) => option.symbol === symbol);
    if (!exists) {
      setSymbol(availableSymbols[0].symbol);
    }
  }, [availableSymbols, hasSymbols, symbol]);

  const handleStart = () => {
    if (!symbol) return;

    const sub: OrderBookSubscription = {
      symbol,
      lighter_leverage: leverage,
      lighter_direction: direction,
      notional_value: parseFloat(notionalValue) || 1000,
      depth: 10,
      throttle_ms: 100,
    };

    onStartMonitoring(sub);
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 h-full flex flex-col shadow-sm">
      {/* Header */}
      <div className="mb-4 pb-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wide">
          快速交易
        </h3>
        <p className="text-xs text-gray-600 mt-1">
          {primaryLabel} / {secondaryLabel}
        </p>
      </div>

      {/* Form */}
      <div className="space-y-4 flex-1">
        {/* Symbol Selection */}
        <div className="space-y-2">
          <Label htmlFor="symbol" className="text-xs text-gray-700 uppercase tracking-wide">
            币种
          </Label>
          <Select value={symbol} onValueChange={setSymbol} disabled={!hasSymbols}>
            <SelectTrigger 
              id="symbol"
              className="bg-white border-gray-300 text-gray-900 focus:border-blue-500"
            >
              <SelectValue placeholder="选择币种" />
            </SelectTrigger>
            <SelectContent className="bg-white border-gray-200 text-gray-900 max-h-64">
              {availableSymbols.map((option) => (
                <SelectItem 
                  key={option.symbol} 
                  value={option.symbol}
                  className="focus:bg-gray-100 focus:text-gray-900"
                >
                  {option.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!hasSymbols && (
            <p className="text-[10px] text-amber-600">
              请先在费率比较页筛选币种
            </p>
          )}
        </div>

        {/* Leverage Quick Select */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 uppercase tracking-wide">
            Lighter 杠杆
          </Label>
          <div className="grid grid-cols-5 gap-1">
            {LEVERAGE_OPTIONS.map((lev) => (
              <button
                key={lev}
                onClick={() => setLeverage(lev)}
                className={cn(
                  "px-2 py-1.5 text-xs font-semibold rounded transition-all border",
                  leverage === lev
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:border-gray-400"
                )}
              >
                {lev}x
              </button>
            ))}
          </div>
        </div>

        {/* Direction Toggle */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 uppercase tracking-wide">
            Lighter 方向
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setDirection("long")}
              className={cn(
                "px-3 py-2 text-sm font-semibold rounded transition-all flex items-center justify-center gap-1.5 border",
                direction === "long"
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-green-50 hover:text-green-700 hover:border-green-400"
              )}
            >
              <span className="text-lg">🟢</span>
              做多
            </button>
            <button
              onClick={() => setDirection("short")}
              className={cn(
                "px-3 py-2 text-sm font-semibold rounded transition-all flex items-center justify-center gap-1.5 border",
                direction === "short"
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-red-50 hover:text-red-700 hover:border-red-400"
              )}
            >
              <span className="text-lg">🔴</span>
              做空
            </button>
          </div>
        </div>

        {/* Notional Value */}
        <div className="space-y-2">
          <Label htmlFor="notional" className="text-xs text-gray-700 uppercase tracking-wide">
            名义价值 (USD)
          </Label>
          <Input
            id="notional"
            type="number"
            min="1"
            value={notionalValue}
            onChange={(e) => setNotionalValue(e.target.value)}
            className="bg-white border-gray-300 text-gray-900 font-mono focus:border-blue-500"
            placeholder="1000"
          />
        </div>
      </div>

      {/* Action Button */}
      <div className="mt-4 pt-4 border-t border-gray-200">
        <Button
          onClick={handleStart}
          disabled={!hasSymbols || isMonitoring}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 text-sm uppercase tracking-wide transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <TrendingUp className="h-4 w-4 mr-2" />
          {isMonitoring ? "监控中..." : "开始监控"}
        </Button>
      </div>
    </div>
  );
}
