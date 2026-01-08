import { useRef, useState, useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowUpRight, ArrowDownRight, Info, Search, Lock, Shield, Settings2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderBookSubscription } from "@/hooks/use-order-book-websocket";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";

type SymbolOption = { symbol: string; displayName: string };

type QuickTradePanelProps = {
  onExecuteArbitrage: () => void;
  onConfigChange: (subscription: OrderBookSubscription | null) => void;
  onNotionalReady: (ready: boolean) => void;
  onLeverageCommit?: (payload: { symbol: string; lighterLeverage: number; grvtLeverage: number }) => void;
  executeDisabled: boolean;
  executeLabel: string;
  availableSymbols: SymbolOption[];
  leverageCapsBySymbol?: Record<string, { lighter?: number; grvt?: number }>;
  primaryLabel: string;
  secondaryLabel: string;
  defaultSymbol?: string;
  defaultLighterDirection?: "long" | "short";
  defaultGrvtDirection?: "long" | "short";
  lockSymbol?: boolean;
  lockDirections?: boolean;
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
  onCommit,
  max,
  accentColor,
}: {
  value: number;
  onChange: (val: number) => void;
  onCommit?: (val: number) => void;
  max: number;
  accentColor: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(String(value));
  const ticks = useMemo(() => buildLeverageTicks(max), [max]);

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
    onCommit?.(clamped);
    setDraftValue(String(clamped));
    setIsEditing(false);
  };

  const percentage = ((value - LEVERAGE_MIN) / (max - LEVERAGE_MIN)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div 
          className="h-7 w-16 flex items-center justify-center rounded border border-slate-200 bg-slate-50 transition-all focus-within:border-primary/50 focus-within:bg-white"
        >
          {isEditing ? (
            <input
              type="number"
              min={LEVERAGE_MIN}
              max={max}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitDraft();
                if (e.key === "Escape") {
                  setDraftValue(String(value));
                  setIsEditing(false);
                }
              }}
              autoFocus
              className="w-full bg-transparent text-center text-xs font-bold text-slate-900 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="w-full text-center text-xs font-bold text-slate-900"
            >
              {value}x
            </button>
          )}
        </div>
        <div className="text-[10px] font-bold text-slate-400 tabular-nums">
          Max: {max}x
        </div>
      </div>

      <div className="relative h-4 flex items-center px-0.5">
        <div className="absolute left-0.5 right-0.5 h-1 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="h-full transition-all duration-300 ease-out"
            style={{
              width: `${percentage}%`,
              backgroundColor: accentColor,
            }}
          />
        </div>

        <input
          type="range"
          min={LEVERAGE_MIN}
          max={max}
          step={1}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onMouseUp={() => onCommit?.(value)}
          onTouchEnd={() => onCommit?.(value)}
          style={{ ["--thumb-color" as never]: accentColor }}
          className={cn(
            "relative w-full cursor-pointer appearance-none bg-transparent block z-10",
            "[-webkit-appearance:none] h-4",
            "[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--thumb-color)]",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
            "[&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform",
            "[&::-webkit-slider-thumb]:hover:scale-110",
            "active:[&::-webkit-slider-thumb]:scale-95",
            "[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:bg-[var(--thumb-color)] [&::-moz-range-thumb]:border-2",
            "[&::-moz-range-thumb]:border-white"
          )}
        />
      </div>

      <div className="flex justify-between px-0.5">
        {ticks.map((tick) => (
          <button
            key={tick}
            type="button"
            onClick={() => {
              onChange(tick);
              onCommit?.(tick);
            }}
            className={cn(
              "text-[9px] font-bold transition-colors tabular-nums",
              tick === value ? "text-slate-900 underline underline-offset-2" : "text-slate-400 hover:text-slate-600"
            )}
          >
            {tick}x
          </button>
        ))}
      </div>
    </div>
  );
}

const formatSymbolLabel = (option: SymbolOption) =>
  `${option.displayName} (${option.symbol})`;

export function QuickTradePanel({
  onExecuteArbitrage,
  onConfigChange,
  onNotionalReady,
  onLeverageCommit,
  executeDisabled,
  executeLabel,
  availableSymbols,
  leverageCapsBySymbol,
  primaryLabel,
  secondaryLabel,
  defaultSymbol,
  defaultLighterDirection,
  defaultGrvtDirection,
  lockSymbol = false,
  lockDirections = false,
}: QuickTradePanelProps) {
  const [symbol, setSymbol] = useState(defaultSymbol ?? "");
  const [symbolQuery, setSymbolQuery] = useState("");
  const [isSymbolMenuOpen, setIsSymbolMenuOpen] = useState(false);
  const symbolBlurTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lighterLeverage, setLighterLeverage] = useState(1);
  const [lighterDirection, setLighterDirection] = useState<"long" | "short">(defaultLighterDirection ?? "long");
  const [grvtLeverage, setGrvtLeverage] = useState(1);
  const [grvtDirection, setGrvtDirection] = useState<"long" | "short">(defaultGrvtDirection ?? "short");
  const [notionalValue, setNotionalValue] = useState("");
  const [avoidAdverseSpread, setAvoidAdverseSpread] = useState(true);
  const [customDays, setCustomDays] = useState("1");
  const [customHours, setCustomHours] = useState("0");
  const [liquidationGuardEnabled, setLiquidationGuardEnabled] = useState(true);
  const [liquidationGuardPct, setLiquidationGuardPct] = useState("50");

  const hasSymbols = availableSymbols.length > 0;
  const symbolKey = symbol.trim().toUpperCase();
  const caps = leverageCapsBySymbol?.[symbolKey];
  const lighterMax =
    Number.isFinite(caps?.lighter) && (caps?.lighter ?? 0) > 0 ? Number(caps?.lighter) : LEVERAGE_MAX;
  const grvtMax =
    Number.isFinite(caps?.grvt) && (caps?.grvt ?? 0) > 0 ? Number(caps?.grvt) : LEVERAGE_MAX;
  const sharedMax = Math.min(lighterMax, grvtMax);

  useEffect(() => {
    if (!hasSymbols) {
      if (!defaultSymbol) {
        setSymbol("");
        setSymbolQuery("");
      }
      return;
    }

    const currentSymbol = symbol || defaultSymbol;
    if (currentSymbol) {
      const exists = availableSymbols.some((option) => option.symbol === currentSymbol);
      if (exists) {
        // If we haven't set the query yet (initial load with default), do it now
        if (symbolQuery === "") {
          const selected = availableSymbols.find((option) => option.symbol === currentSymbol);
          if (selected) {
            setSymbol(selected.symbol);
            setSymbolQuery(formatSymbolLabel(selected));
          }
        }
      } else {
        // Symbol from URL or current state not found in available symbols 
        if (symbol && !exists) {
          setSymbol("");
        }
      }
    }
  }, [availableSymbols, hasSymbols, symbol, symbolQuery, defaultSymbol]);

  useEffect(() => {
    return () => {
      if (symbolBlurTimeout.current) {
        clearTimeout(symbolBlurTimeout.current);
      }
    };
  }, []);

  useEffect(() => {
    if (lighterLeverage > sharedMax) {
      const clamped = Math.max(LEVERAGE_MIN, Math.floor(sharedMax));
      setLighterLeverage(clamped);
      setGrvtLeverage(clamped);
    }
    if (lighterLeverage < LEVERAGE_MIN) {
      setLighterLeverage(LEVERAGE_MIN);
    }
  }, [lighterLeverage, sharedMax]);

  useEffect(() => {
    if (grvtLeverage > sharedMax) {
      const clamped = Math.max(LEVERAGE_MIN, Math.floor(sharedMax));
      setGrvtLeverage(clamped);
      setLighterLeverage(clamped);
    }
    if (grvtLeverage < LEVERAGE_MIN) {
      setGrvtLeverage(LEVERAGE_MIN);
    }
  }, [grvtLeverage, sharedMax]);

  const handleLeverageChange = (value: number) => {
    const clamped = Math.min(sharedMax, Math.max(LEVERAGE_MIN, Math.round(value)));
    setLighterLeverage(clamped);
    setGrvtLeverage(clamped);
  };

  const handleLeverageCommit = (value: number) => {
    if (!symbol) {
      return;
    }
    onLeverageCommit?.({ symbol, lighterLeverage: value, grvtLeverage: value });
  };

  const notionalAmount = Number(notionalValue);
  const safeNotional = Number.isFinite(notionalAmount) && notionalAmount > 0 ? notionalAmount : null;
  const lighterMargin = safeNotional ? safeNotional / Math.max(lighterLeverage, LEVERAGE_MIN) : null;
  const grvtMargin = safeNotional ? safeNotional / Math.max(grvtLeverage, LEVERAGE_MIN) : null;
  const autoCloseAfterMs = useMemo(() => {
    const d = parseInt(customDays, 10) || 0;
    const h = parseInt(customHours, 10) || 0;
    if (d === 0 && h === 0) return undefined;
    return (d * 24 + h) * 60 * 60 * 1000;
  }, [customDays, customHours]);
  const parsedLiquidationPct = Number(liquidationGuardPct);
  const liquidationGuardThresholdPct = Number.isFinite(parsedLiquidationPct)
    ? Math.min(100, Math.max(1, parsedLiquidationPct))
    : 50;
  const sortedSymbols = [...availableSymbols].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  );
  const normalizedQuery = symbolQuery.trim().toLowerCase();
  const filteredSymbols = normalizedQuery
    ? sortedSymbols.filter(
      (option) =>
        option.symbol.toLowerCase().includes(normalizedQuery) ||
        option.displayName.toLowerCase().includes(normalizedQuery),
    )
    : sortedSymbols;
  const suggestedSymbols = filteredSymbols.slice(0, 12);

  const handleSymbolSelect = (option: SymbolOption) => {
    setSymbol(option.symbol);
    setSymbolQuery(formatSymbolLabel(option));
    setIsSymbolMenuOpen(false);
  };

  useEffect(() => {
    if (!symbol || !safeNotional) {
      onConfigChange(symbol ? {
        symbol,
        lighter_leverage: lighterLeverage,
        lighter_direction: lighterDirection,
        grvt_leverage: grvtLeverage,
        grvt_direction: grvtDirection,
        notional_value: 1,
        depth: 10,
        throttle_ms: 100,
        avoid_adverse_spread: avoidAdverseSpread,
        auto_close_after_ms: autoCloseAfterMs,
        liquidation_guard_enabled: liquidationGuardEnabled,
        liquidation_guard_threshold_pct: liquidationGuardThresholdPct,
      } : null);
      onNotionalReady(false);
      return;
    }

    const sub: OrderBookSubscription = {
      symbol,
      lighter_leverage: lighterLeverage,
      lighter_direction: lighterDirection,
      grvt_leverage: grvtLeverage,
      grvt_direction: grvtDirection,
      notional_value: safeNotional,
      depth: 10,
      throttle_ms: 100,
      avoid_adverse_spread: avoidAdverseSpread,
      auto_close_after_ms: autoCloseAfterMs,
      liquidation_guard_enabled: liquidationGuardEnabled,
      liquidation_guard_threshold_pct: liquidationGuardThresholdPct,
    };

    onConfigChange(sub);
    onNotionalReady(true);
  }, [
    symbol,
    lighterLeverage,
    lighterDirection,
    grvtLeverage,
    grvtDirection,
    safeNotional,
    avoidAdverseSpread,
    autoCloseAfterMs,
    liquidationGuardEnabled,
    liquidationGuardThresholdPct,
    onConfigChange,
    onNotionalReady,
  ]);

  return (
    <div className="h-full flex flex-col bg-white min-h-0 overflow-hidden text-slate-900 border-x border-slate-200">
      {/* Header - Fixed & Compact */}
      <div className="shrink-0 px-3 py-2 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
            <Settings2 className="h-3 w-3" />
            套利配置
          </h3>
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-bold text-slate-400 tabular-nums">
              <span className="text-primary">{primaryLabel}</span>
              <span className="mx-1 opacity-30">|</span>
              <span className="text-indigo-600">{secondaryLabel}</span>
            </p>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-slate-300 hover:text-slate-500 transition-colors">
                    <Info className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-[10px] bg-slate-900 text-white border-0">
                  配置套利参数
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>
      </div>

      {/* Main Content - Scrollable & Dense */}
      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-4">
        {/* Symbol Selection - Integrated */}
        <div className="space-y-1.5">
          <Label htmlFor="symbol" className="text-[10px] font-bold text-slate-400 uppercase tracking-tight ml-0.5">
            交易币种
          </Label>
          <div className="relative group">
            <div className="relative">
              <Input
                id="symbol"
                name="symbol-search"
                value={symbolQuery}
                disabled={!hasSymbols || lockSymbol}
                placeholder="搜索币种 (如 BTC, ETH)"
                autoComplete="off"
                onChange={(event) => {
                  if (lockSymbol) return;
                  if (symbolBlurTimeout.current) clearTimeout(symbolBlurTimeout.current);
                  const next = event.target.value;
                  setSymbolQuery(next);
                  setIsSymbolMenuOpen(true);
                  const exact = availableSymbols.find(
                    (option) =>
                      option.symbol.toLowerCase() === next.trim().toLowerCase() ||
                      option.displayName.toLowerCase() === next.trim().toLowerCase(),
                  );
                  if (exact) setSymbol(exact.symbol);
                  else setSymbol("");
                }}
                onFocus={() => {
                  if (!lockSymbol) setIsSymbolMenuOpen(true);
                }}
                onBlur={() => {
                  symbolBlurTimeout.current = setTimeout(() => setIsSymbolMenuOpen(false), 150);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && suggestedSymbols[0]) {
                    event.preventDefault();
                    handleSymbolSelect(suggestedSymbols[0]);
                  }
                }}
                className={cn(
                  "h-8 border-slate-200 bg-slate-50 font-bold text-xs focus:bg-white focus:ring-0 transition-all",
                  lockSymbol && "opacity-60 cursor-not-allowed bg-slate-100 pr-8"
                )}
              />
              <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-300 pointer-events-none" />
              {lockSymbol && (
                <Lock className="absolute right-8 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-300" />
              )}
            </div>
            {isSymbolMenuOpen && hasSymbols && !lockSymbol && (
              <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded border border-slate-200 bg-white shadow-lg animate-in fade-in duration-75">
                <div className="py-0.5">
                  {suggestedSymbols.length > 0 ? (
                    suggestedSymbols.map((option) => (
                      <button
                        key={option.symbol}
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSymbolSelect(option)}
                        className="flex w-full items-center justify-between px-2.5 py-1.5 text-left hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-[11px] font-bold text-slate-700">{option.displayName}</span>
                        <span className="text-[9px] font-mono text-slate-400">{option.symbol}</span>
                      </button>
                    ))
                  ) : (
                    <div className="px-2 py-2 text-[10px] text-slate-400 text-center">未找到</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Venue A Section (Lighter) */}
        <div className="space-y-2.5 pt-0.5">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1 rounded-full bg-primary" />
            <span className="text-[10px] font-black text-primary uppercase tracking-widest">Lighter</span>
            <div className="flex-1 h-[1px] bg-slate-100" />
          </div>
          
          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-slate-400 ml-0.5">杠杆参数</Label>
            <LeverageSlider
              value={lighterLeverage}
              onChange={handleLeverageChange}
              onCommit={handleLeverageCommit}
              max={sharedMax}
              accentColor="hsl(var(--primary))"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={lockDirections}
              onClick={() => {
                if (lockDirections) return;
                setLighterDirection("long");
                setGrvtDirection("short");
              }}
              className={cn(
                "h-7 font-black text-[10px] px-0 uppercase transition-all",
                lighterDirection === "long" 
                  ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                  : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
              )}
            >
              Long
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={lockDirections}
              onClick={() => {
                if (lockDirections) return;
                setLighterDirection("short");
                setGrvtDirection("long");
              }}
              className={cn(
                "h-7 font-black text-[10px] px-0 uppercase transition-all",
                lighterDirection === "short" 
                  ? "bg-rose-50 text-rose-600 border-rose-200" 
                  : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
              )}
            >
              Short
            </Button>
          </div>
        </div>

        {/* Venue B Section (GRVT) */}
        <div className="space-y-2.5 pt-1">
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-1 rounded-full bg-indigo-500" />
            <span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">GRVT</span>
            <div className="flex-1 h-[1px] bg-slate-100" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-bold text-slate-400 ml-0.5">杠杆参数</Label>
            <LeverageSlider
              value={grvtLeverage}
              onChange={handleLeverageChange}
              onCommit={handleLeverageCommit}
              max={sharedMax}
              accentColor="#6366f1"
            />
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={lockDirections}
              onClick={() => {
                if (lockDirections) return;
                setGrvtDirection("long");
                setLighterDirection("short");
              }}
              className={cn(
                "h-7 font-black text-[10px] px-0 uppercase transition-all",
                grvtDirection === "long" 
                  ? "bg-emerald-50 text-emerald-600 border-emerald-200" 
                  : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
              )}
            >
              Long
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={lockDirections}
              onClick={() => {
                if (lockDirections) return;
                setGrvtDirection("short");
                setLighterDirection("long");
              }}
              className={cn(
                "h-7 font-black text-[10px] px-0 uppercase transition-all",
                grvtDirection === "short" 
                  ? "bg-rose-50 text-rose-600 border-rose-200" 
                  : "bg-slate-50 text-slate-400 border-slate-200 hover:bg-slate-100"
              )}
            >
              Short
            </Button>
          </div>
        </div>

        {/* Risk Management - Flatter Group */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center justify-between py-1 group cursor-pointer" onClick={() => setAvoidAdverseSpread(!avoidAdverseSpread)}>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold text-slate-700">避免不利价差</span>
              <span className="text-[9px] text-slate-400">阻止偏差超过阈值的成交</span>
            </div>
            <div className={cn("h-4 w-7 rounded-full transition-colors relative", avoidAdverseSpread ? "bg-primary" : "bg-slate-200")}>
              <div className={cn("absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform", avoidAdverseSpread && "translate-x-3")} />
            </div>
          </div>

          <div className="space-y-1.5 py-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-700">自动平仓</span>
              <span className="text-[10px] font-black text-slate-400 uppercase">Custom</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5 bg-slate-50 px-2 py-1.5 rounded border border-slate-100 animate-in slide-in-from-top-1">
              <div className="flex items-center gap-1 flex-1">
                <Input
                  type="number"
                  min="0"
                  placeholder="D"
                  value={customDays}
                  onChange={(e) => setCustomDays(e.target.value)}
                  className="h-6 w-full border-slate-200 text-[10px] font-black p-1 text-center"
                />
                <span className="text-[9px] font-bold text-slate-400">D</span>
              </div>
              <div className="flex items-center gap-1 flex-1">
                <Input
                  type="number"
                  min="0"
                  max="23"
                  placeholder="H"
                  value={customHours}
                  onChange={(e) => setCustomHours(e.target.value)}
                  className="h-6 w-full border-slate-200 text-[10px] font-black p-1 text-center"
                />
                <span className="text-[9px] font-bold text-slate-400">H</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5 py-1">
            <div className="flex items-center justify-between cursor-pointer" onClick={() => setLiquidationGuardEnabled(!liquidationGuardEnabled)}>
              <span className="text-[11px] font-bold text-slate-700">风控保护 (L/G)</span>
              <div className={cn("h-4 w-7 rounded-full transition-colors relative", liquidationGuardEnabled ? "bg-primary" : "bg-slate-200")}>
                <div className={cn("absolute top-0.5 left-0.5 h-3 w-3 rounded-full bg-white transition-transform", liquidationGuardEnabled && "translate-x-3")} />
              </div>
            </div>
            {liquidationGuardEnabled && (
              <div className="flex items-center gap-2 bg-slate-50 px-2 py-1.5 rounded border border-slate-100 animate-in slide-in-from-top-1">
                <span className="text-[9px] font-bold text-slate-400 uppercase">阈值</span>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  value={liquidationGuardPct}
                  onChange={(e) => setLiquidationGuardPct(e.target.value)}
                  className="h-6 w-12 border-slate-200 text-[10px] font-black p-1 text-center"
                />
                <span className="text-[9px] font-bold text-slate-400">%</span>
              </div>
            )}
          </div>
        </div>

        {/* Notional Value - Dense Input */}
        <div className="space-y-1.5 pt-1">
          <Label htmlFor="notional" className="text-[10px] font-bold text-slate-400 uppercase tracking-tight ml-0.5">
            合约面值 (USD)
          </Label>
          <div className="relative">
            <Input
              id="notional"
              type="number"
              min="1"
              value={notionalValue}
              onChange={(e) => setNotionalValue(e.target.value)}
              className="h-8 bg-slate-50 border-slate-200 text-slate-900 font-bold text-xs focus:bg-white focus:ring-0 transition-all pr-10"
              placeholder="0.00"
            />
            <div className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-black text-slate-300">USD</div>
          </div>
        </div>
      </div>

      {/* Footer - Integrated Action Area */}
      <div className="shrink-0 p-3 bg-white border-t border-slate-100 space-y-2.5">
        {/* Margin Summary - Compact Table Style */}
        <div className="grid grid-cols-2 bg-slate-50/50 border border-slate-100 rounded">
          <div className="p-2 border-r border-slate-100 flex flex-col items-center gap-0.5">
            <span className="text-[7px] uppercase font-black text-slate-400 tracking-tighter">Lighter Margin</span>
            <span className="font-mono text-[10px] font-black text-primary">
              {lighterMargin != null ? `$${lighterMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"}
            </span>
          </div>
          <div className="p-2 flex flex-col items-center gap-0.5">
            <span className="text-[7px] uppercase font-black text-slate-400 tracking-tighter">GRVT Margin</span>
            <span className="font-mono text-[10px] font-black text-indigo-600">
              {grvtMargin != null ? `$${grvtMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"}
            </span>
          </div>
        </div>

        {/* Execute Button - Professional Gradient Style */}
        <Button
          onClick={onExecuteArbitrage}
          disabled={!hasSymbols || executeDisabled || !safeNotional}
          className={cn(
            "w-full h-10 text-[11px] font-black uppercase tracking-[0.1em] transition-all active:scale-[0.99]",
            "bg-primary hover:bg-primary/90 text-white shadow-sm",
            "disabled:opacity-30 disabled:grayscale disabled:shadow-none"
          )}
        >
          {executeLabel}
        </Button>
      </div>
    </div>
  );
}
