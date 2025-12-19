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
  leverageCapsBySymbol?: Record<string, { lighter?: number; grvt?: number }>;
  primaryLabel: string;
  secondaryLabel: string;
  isMonitoring: boolean;
};

const LEVERAGE_MIN = 1;
const LEVERAGE_MAX = 20;
const buildLeverageTicks = (max: number) => {
  const clamped = Math.max(LEVERAGE_MIN, Math.round(max));
  let ticks: number[] = [];
  if (clamped <= 10) {
    ticks = [1, Math.round(clamped / 2), clamped];
  } else if (clamped <= 20) {
    ticks = [1, 5, 10, 15, clamped];
  } else if (clamped <= 50) {
    ticks = [1, 10, 20, 30, 40, clamped];
  } else {
    ticks = [
      1,
      Math.round(clamped * 0.2),
      Math.round(clamped * 0.4),
      Math.round(clamped * 0.6),
      Math.round(clamped * 0.8),
      clamped,
    ];
  }
  return Array.from(new Set(ticks.filter((tick) => tick >= LEVERAGE_MIN))).sort((a, b) => a - b);
};

function LeverageSlider({
  value,
  onChange,
  max,
  accentClass,
}: {
  value: number;
  onChange: (val: number) => void;
  max: number;
  accentClass: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(String(value));
  const ticks = buildLeverageTicks(max);

  useEffect(() => {
    if (!isEditing) {
      setDraftValue(String(value));
    }
  }, [value, isEditing]);

  const commitDraft = () => {
    const parsed = Number(draftValue);
    if (!Number.isFinite(parsed)) {
      setDraftValue(String(value));
      setIsEditing(false);
      return;
    }
    const clamped = Math.min(max, Math.max(LEVERAGE_MIN, Math.round(parsed)));
    onChange(clamped);
    setDraftValue(String(clamped));
    setIsEditing(false);
  };

  return (
    <div className="space-y-2">
      <div className="rounded-md border border-gray-200 bg-gradient-to-b from-gray-900 to-gray-800 px-3 py-2 text-center text-sm font-semibold text-white shadow-inner">
        {isEditing ? (
          <input
            type="number"
            min={LEVERAGE_MIN}
            max={max}
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitDraft();
              }
              if (e.key === "Escape") {
                setDraftValue(String(value));
                setIsEditing(false);
              }
            }}
            className="w-20 rounded-sm bg-transparent text-center text-sm font-semibold text-white outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            className="w-full text-center hover:text-white/90"
          >
            {value}x
          </button>
        )}
      </div>
      <div className="relative pb-8">
        <input
          type="range"
          min={LEVERAGE_MIN}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={cn(
            "w-full cursor-pointer appearance-none bg-transparent transition-all",
            "[-webkit-appearance:none] [&::-webkit-slider-runnable-track]:h-1.5",
            "[&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-gray-200",
            "[&::-moz-range-track]:h-1.5 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-gray-200",
            "[-webkit-appearance:none] [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5",
            "[&::-webkit-slider-thumb]:-mt-[7px] [&::-webkit-slider-thumb]:rounded-full",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
            "[&::-webkit-slider-thumb]:bg-gray-900 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:transition-transform active:[&::-webkit-slider-thumb]:scale-110",
            "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white",
            "[&::-moz-range-thumb]:bg-gray-900 [&::-moz-range-thumb]:shadow-lg",
            accentClass
          )}
        />
        <div className="absolute left-0 right-0 top-6 flex justify-between text-[10px] text-gray-400">
          {ticks.map((tick) => (
            <div key={tick} className="flex flex-col items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-gray-200" />
              <span className="font-medium">{tick}x</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function QuickTradePanel({
  onStartMonitoring,
  availableSymbols,
  leverageCapsBySymbol,
  primaryLabel,
  secondaryLabel,
  isMonitoring,
}: QuickTradePanelProps) {
  const [symbol, setSymbol] = useState("");
  const [lighterLeverage, setLighterLeverage] = useState(1);
  const [lighterDirection, setLighterDirection] = useState<"long" | "short">("long");
  const [grvtLeverage, setGrvtLeverage] = useState(1);
  const [grvtDirection, setGrvtDirection] = useState<"long" | "short">("short");
  const [notionalValue, setNotionalValue] = useState("1000");

  const hasSymbols = availableSymbols.length > 0;
  const symbolKey = symbol.trim().toUpperCase();
  const caps = leverageCapsBySymbol?.[symbolKey];
  const lighterMax =
    Number.isFinite(caps?.lighter) && (caps?.lighter ?? 0) > 0 ? Number(caps?.lighter) : LEVERAGE_MAX;
  const grvtMax =
    Number.isFinite(caps?.grvt) && (caps?.grvt ?? 0) > 0 ? Number(caps?.grvt) : LEVERAGE_MAX;

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


  useEffect(() => {
    if (lighterLeverage > lighterMax) {
      setLighterLeverage(Math.max(LEVERAGE_MIN, Math.floor(lighterMax)));
    }
    if (lighterLeverage < LEVERAGE_MIN) {
      setLighterLeverage(LEVERAGE_MIN);
    }
  }, [lighterLeverage, lighterMax]);

  useEffect(() => {
    if (grvtLeverage > grvtMax) {
      setGrvtLeverage(Math.max(LEVERAGE_MIN, Math.floor(grvtMax)));
    }
    if (grvtLeverage < LEVERAGE_MIN) {
      setGrvtLeverage(LEVERAGE_MIN);
    }
  }, [grvtLeverage, grvtMax]);

  const notionalAmount = Number(notionalValue);
  const safeNotional = Number.isFinite(notionalAmount) && notionalAmount > 0 ? notionalAmount : 0;
  const lighterMargin = safeNotional > 0 ? safeNotional / Math.max(lighterLeverage, LEVERAGE_MIN) : 0;
  const grvtMargin = safeNotional > 0 ? safeNotional / Math.max(grvtLeverage, LEVERAGE_MIN) : 0;

  const handleStart = () => {
    if (!symbol) return;

    const sub: OrderBookSubscription = {
      symbol,
      lighter_leverage: lighterLeverage,
      lighter_direction: lighterDirection,
      grvt_leverage: grvtLeverage,
      grvt_direction: grvtDirection,
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
            <SelectContent 
              className="bg-white border-gray-200 text-gray-900 max-h-64 shadow-xl overflow-y-auto"
              viewportClassName="p-0"
            >
              <div className="px-1 pb-1">
                {[...availableSymbols]
                  .sort((a, b) => a.symbol.localeCompare(b.symbol))
                  .map((option) => (
                    <SelectItem
                      key={option.symbol}
                      value={option.symbol}
                      className="focus:bg-gray-100 focus:text-gray-900"
                    >
                      {option.displayName}
                    </SelectItem>
                  ))}
              </div>
            </SelectContent>
          </Select>
          {!hasSymbols && (
            <p className="text-[10px] text-amber-600">
              请先在费率比较页筛选币种
            </p>
          )}
        </div>

        {/* Lighter Leverage */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 uppercase tracking-wide">
            Lighter 杠杆
          </Label>
          <LeverageSlider
            value={lighterLeverage}
            onChange={setLighterLeverage}
            max={lighterMax}
            accentClass="accent-blue-600"
          />
        </div>

        {/* Lighter Direction */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 uppercase tracking-wide">
            Lighter 方向
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setLighterDirection("long");
                setGrvtDirection("short");
              }}
              className={cn(
                "px-3 py-2 text-sm font-semibold rounded transition-all flex items-center justify-center gap-1.5 border",
                lighterDirection === "long"
                  ? "bg-green-600 text-white border-green-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-green-50 hover:text-green-700 hover:border-green-400"
              )}
            >
              <span className="text-lg">🟢</span>
              做多
            </button>
            <button
              onClick={() => {
                setLighterDirection("short");
                setGrvtDirection("long");
              }}
              className={cn(
                "px-3 py-2 text-sm font-semibold rounded transition-all flex items-center justify-center gap-1.5 border",
                lighterDirection === "short"
                  ? "bg-red-600 text-white border-red-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-red-50 hover:text-red-700 hover:border-red-400"
              )}
            >
              <span className="text-lg">🔴</span>
              做空
            </button>
          </div>
        </div>

        {/* GRVT Leverage */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 uppercase tracking-wide">
            GRVT 杠杆
          </Label>
          <LeverageSlider
            value={grvtLeverage}
            onChange={setGrvtLeverage}
            max={grvtMax}
            accentClass="accent-indigo-600"
          />
        </div>

        {/* GRVT Direction */}
        <div className="space-y-2">
          <Label className="text-xs text-gray-700 uppercase tracking-wide">
            GRVT 方向
          </Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => {
                setGrvtDirection("long");
                setLighterDirection("short");
              }}
              className={cn(
                "px-3 py-2 text-sm font-semibold rounded transition-all flex items-center justify-center gap-1.5 border",
                grvtDirection === "long"
                  ? "bg-emerald-600 text-white border-emerald-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-400"
              )}
            >
              <span className="text-lg">🟢</span>
              做多
            </button>
            <button
              onClick={() => {
                setGrvtDirection("short");
                setLighterDirection("long");
              }}
              className={cn(
                "px-3 py-2 text-sm font-semibold rounded transition-all flex items-center justify-center gap-1.5 border",
                grvtDirection === "short"
                  ? "bg-rose-600 text-white border-rose-600"
                  : "bg-white text-gray-700 border-gray-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-400"
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
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="group flex flex-col items-center justify-center space-y-1 rounded-lg border border-blue-100 bg-blue-50/30 p-2.5 transition-all hover:bg-blue-50 hover:border-blue-200">
              <span className="text-[10px] uppercase tracking-wider font-bold text-blue-600/70 group-hover:text-blue-600">
                Lighter 保证金
              </span>
              <span className="font-mono text-xs font-bold text-blue-900">
                ${lighterMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="group flex flex-col items-center justify-center space-y-1 rounded-lg border border-indigo-100 bg-indigo-50/30 p-2.5 transition-all hover:bg-indigo-50 hover:border-indigo-200">
              <span className="text-[10px] uppercase tracking-wider font-bold text-indigo-600/70 group-hover:text-indigo-600">
                GRVT 保证金
              </span>
              <span className="font-mono text-xs font-bold text-indigo-900">
                ${grvtMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
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
