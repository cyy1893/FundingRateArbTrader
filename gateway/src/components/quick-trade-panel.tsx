import { useRef, useState, useEffect, useMemo } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TrendingUp, ArrowUpRight, ArrowDownRight, Info, Search, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrderBookSubscription } from "@/hooks/use-order-book-websocket";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type SymbolOption = { symbol: string; displayName: string };

type QuickTradePanelProps = {
  onExecuteArbitrage: () => void;
  onConfigChange: (subscription: OrderBookSubscription | null) => void;
  onNotionalReady: (ready: boolean) => void;
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
  max,
  accentColor,
}: {
  value: number;
  onChange: (val: number) => void;
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
    setDraftValue(String(clamped));
    setIsEditing(false);
  };

  const percentage = ((value - LEVERAGE_MIN) / (max - LEVERAGE_MIN)) * 100;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 h-10 flex items-center justify-center rounded-lg border-2 border-slate-100 bg-slate-50/50 shadow-sm transition-all focus-within:border-primary/30 focus-within:bg-white">
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
              className="w-full bg-transparent text-center font-bold text-slate-900 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="w-full text-center font-bold text-slate-900 hover:text-primary transition-colors"
            >
              {value}x
            </button>
          )}
        </div>
      </div>

      <div className="px-2 relative">
        <div
          className="absolute h-1.5 rounded-full bg-slate-200 top-1/2 -translate-y-1/2 left-2 right-2 overflow-hidden"
        >
          <div
            className="h-full transition-all duration-300 ease-out"
            style={{
              width: `${percentage}%`,
              backgroundColor: accentColor
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
          style={{ ["--thumb-color" as never]: accentColor }}
          className={cn(
            "relative w-full cursor-pointer appearance-none bg-transparent block",
            "[-webkit-appearance:none] h-6",
            "[&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:w-5",
            "[&::-webkit-slider-thumb]:appearance-none",
            "[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--thumb-color)]",
            "[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white",
            "[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:transition-all",
            "[&::-webkit-slider-thumb]:hover:scale-110",
            "active:[&::-webkit-slider-thumb]:scale-95",
            "[&::-moz-range-thumb]:h-5 [&::-moz-range-thumb]:w-5 [&::-moz-range-thumb]:rounded-full",
            "[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-white",
            "[&::-moz-range-thumb]:bg-[var(--thumb-color)] [&::-moz-range-thumb]:shadow-md",
            "[&::-moz-range-thumb]:hover:scale-110"
          )}
        />

        <div className="mt-1 flex justify-between px-0.5">
          {ticks.map((tick) => {
            const tickPos = ((tick - LEVERAGE_MIN) / (max - LEVERAGE_MIN)) * 100;
            return (
              <button
                key={tick}
                type="button"
                onClick={() => onChange(tick)}
                className="flex flex-col items-center group transition-colors"
                style={{
                  position: 'absolute',
                  left: `calc(10px + (100% - 20px) * ${tickPos / 100})`,
                  transform: 'translateX(-50%)'
                }}
              >
                <div className={cn(
                  "h-1 w-1 rounded-full mb-1 transition-all",
                  tick === value ? "scale-150 bg-slate-600" : "bg-slate-300 group-hover:bg-slate-400"
                )} />
                <span className={cn(
                  "text-[10px] font-bold tracking-tight",
                  tick === value ? "text-slate-900" : "text-slate-400 group-hover:text-slate-600"
                )}>
                  {tick}x
                </span>
              </button>
            );
          })}
        </div>
        <div className="h-6" /> {/* Spacer for ticks */}
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

  const notionalAmount = Number(notionalValue);
  const safeNotional = Number.isFinite(notionalAmount) && notionalAmount > 0 ? notionalAmount : null;
  const lighterMargin = safeNotional ? safeNotional / Math.max(lighterLeverage, LEVERAGE_MIN) : null;
  const grvtMargin = safeNotional ? safeNotional / Math.max(grvtLeverage, LEVERAGE_MIN) : null;
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
    onConfigChange,
    onNotionalReady,
  ]);

  return (
    <div className="bg-white border-x border-slate-200 h-full flex flex-col shadow-sm">
      {/* Header */}
      <div className="p-4 pb-3 border-b border-slate-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900 tracking-tight">
            套利交易配置
          </h3>
          <p className="text-[10px] font-medium text-slate-500 uppercase flex items-center gap-1 mt-0.5">
            <span className="text-primary font-bold">{primaryLabel}</span>
            <span className="text-slate-300">/</span>
            <span className="text-indigo-600 font-bold">{secondaryLabel}</span>
          </p>
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="text-slate-400 hover:text-slate-600 transition-colors">
                <Info className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="max-w-[200px] text-xs">
              在这里配置您的套利参数。系统将自动监听深度并计算最佳入场时机。
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-hidden p-3">
        <div className="space-y-4">
          {/* Symbol Selection */}
          <div className="space-y-1.5">
            <Label htmlFor="symbol" className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-2">
              <Search className="h-3 w-3" />
              币种
            </Label>
            <div className="relative">
              <div className="relative">
                <Input
                  id="symbol"
                  name="symbol-search"
                  value={symbolQuery}
                  disabled={!hasSymbols}
                  placeholder="搜索币种 (如 BTC, ETH)"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  onChange={(event) => {
                    if (lockSymbol) {
                      return;
                    }
                  if (symbolBlurTimeout.current) {
                    clearTimeout(symbolBlurTimeout.current);
                  }
                  const next = event.target.value;
                  setSymbolQuery(next);
                  setIsSymbolMenuOpen(true);
                  const exact = availableSymbols.find(
                    (option) =>
                      option.symbol.toLowerCase() === next.trim().toLowerCase() ||
                      option.displayName.toLowerCase() === next.trim().toLowerCase(),
                  );
                  if (exact) {
                    setSymbol(exact.symbol);
                  } else {
                    setSymbol("");
                  }
                }}
                onFocus={() => {
                  if (!lockSymbol) {
                    setIsSymbolMenuOpen(true);
                  }
                }}
                onBlur={() => {
                  symbolBlurTimeout.current = setTimeout(() => {
                    setIsSymbolMenuOpen(false);
                  }, 150);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && suggestedSymbols[0]) {
                    event.preventDefault();
                    handleSymbolSelect(suggestedSymbols[0]);
                  }
                }}
                  className={cn(
                    "h-9 border-slate-200 bg-slate-50/50 text-slate-900 font-bold focus:bg-white focus:ring-primary/20 transition-all placeholder:font-normal placeholder:text-slate-400",
                    lockSymbol && "pr-9"
                  )}
                />
                {lockSymbol ? (
                  <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400">
                    <Lock className="h-3.5 w-3.5" />
                  </div>
                ) : null}
              </div>
              {isSymbolMenuOpen && hasSymbols && !lockSymbol ? (
                <div className="absolute left-0 right-0 top-full z-30 mt-2 max-h-64 overflow-y-auto rounded-md border border-gray-200 bg-white text-gray-900 shadow-xl">
                  {suggestedSymbols.length > 0 ? (
                    <div className="py-1">
                      {suggestedSymbols.map((option) => (
                        <button
                          key={option.symbol}
                          type="button"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => handleSymbolSelect(option)}
                          className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-gray-100"
                        >
                          <span className="font-medium">{option.displayName}</span>
                          <span className="text-xs text-gray-500">{option.symbol}</span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="px-3 py-2 text-xs text-gray-500">
                      没有匹配的币种
                    </div>
                  )}
                </div>
              ) : null}
            </div>
            {!hasSymbols && (
              <p className="text-[10px] text-amber-600">
                暂无可用币种，请稍后再试
              </p>
            )}
          </div>

          {/* Lighter Section */}
          <div className="pt-1">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-[1px] flex-1 bg-slate-100" />
              <span className="text-[10px] font-bold text-primary/60 uppercase tracking-[0.2em]">Lighter 配置</span>
              <div className="h-[1px] flex-1 bg-slate-100" />
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">杠杆倍数</Label>
                <LeverageSlider
                  value={lighterLeverage}
                  onChange={handleLeverageChange}
                  max={sharedMax}
                  accentColor="#3b82f6"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">变动方向</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      if (lockDirections) {
                        return;
                      }
                      setLighterDirection("long");
                      setGrvtDirection("short");
                    }}
                    disabled={lockDirections}
                    className={cn(
                      "relative overflow-hidden h-11 px-3 text-xs font-bold rounded-lg border transition-all flex items-center justify-center gap-2",
                      lighterDirection === "long"
                        ? "bg-green-500 text-white border-green-600 shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-green-200 hover:bg-green-50/30"
                    )}
                  >
                    {lockDirections ? (
                      <Lock className="h-3 w-3 text-slate-400" />
                    ) : (
                    <ArrowUpRight className={cn("h-4 w-4", lighterDirection === "long" ? "text-white" : "text-green-500")} />
                    )}
                    做多
                    {lighterDirection === "long" && (
                      <div className="absolute right-[-4px] top-[-4px] h-4 w-4 bg-white/20 rotate-45" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (lockDirections) {
                        return;
                      }
                      setLighterDirection("short");
                      setGrvtDirection("long");
                    }}
                    disabled={lockDirections}
                    className={cn(
                      "relative overflow-hidden h-11 px-3 text-xs font-bold rounded-lg border transition-all flex items-center justify-center gap-2",
                      lighterDirection === "short"
                        ? "bg-red-500 text-white border-red-600 shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-red-200 hover:bg-red-50/30"
                    )}
                  >
                    {lockDirections ? (
                      <Lock className="h-3 w-3 text-slate-400" />
                    ) : (
                    <ArrowDownRight className={cn("h-4 w-4", lighterDirection === "short" ? "text-white" : "text-red-500")} />
                    )}
                    做空
                    {lighterDirection === "short" && (
                      <div className="absolute right-[-4px] top-[-4px] h-4 w-4 bg-white/20 rotate-45" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* GRVT Section */}
          <div className="pt-3">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-[1px] flex-1 bg-slate-100" />
              <span className="text-[10px] font-bold text-indigo-500/60 uppercase tracking-[0.2em]">GRVT 配置</span>
              <div className="h-[1px] flex-1 bg-slate-100" />
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">杠杆倍数</Label>
                <LeverageSlider
                  value={grvtLeverage}
                  onChange={handleLeverageChange}
                  max={sharedMax}
                  accentColor="#6366f1"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[11px] font-bold text-slate-600 uppercase tracking-wide">变动方向</Label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      if (lockDirections) {
                        return;
                      }
                      setGrvtDirection("long");
                      setLighterDirection("short");
                    }}
                    disabled={lockDirections}
                    className={cn(
                      "relative overflow-hidden h-11 px-3 text-xs font-bold rounded-lg border transition-all flex items-center justify-center gap-2",
                      grvtDirection === "long"
                        ? "bg-emerald-500 text-white border-emerald-600 shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/30"
                    )}
                  >
                    {lockDirections ? (
                      <Lock className="h-3 w-3 text-slate-400" />
                    ) : (
                    <ArrowUpRight className={cn("h-4 w-4", grvtDirection === "long" ? "text-white" : "text-emerald-500")} />
                    )}
                    做多
                    {grvtDirection === "long" && (
                      <div className="absolute right-[-4px] top-[-4px] h-4 w-4 bg-white/20 rotate-45" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      if (lockDirections) {
                        return;
                      }
                      setGrvtDirection("short");
                      setLighterDirection("long");
                    }}
                    disabled={lockDirections}
                    className={cn(
                      "relative overflow-hidden h-11 px-3 text-xs font-bold rounded-lg border transition-all flex items-center justify-center gap-2",
                      grvtDirection === "short"
                        ? "bg-rose-500 text-white border-rose-600 shadow-sm"
                        : "bg-white text-slate-600 border-slate-200 hover:border-rose-200 hover:bg-rose-50/30"
                    )}
                  >
                    {lockDirections ? (
                      <Lock className="h-3 w-3 text-slate-400" />
                    ) : (
                    <ArrowDownRight className={cn("h-4 w-4", grvtDirection === "short" ? "text-white" : "text-rose-500")} />
                    )}
                    做空
                    {grvtDirection === "short" && (
                      <div className="absolute right-[-4px] top-[-4px] h-4 w-4 bg-white/20 rotate-45" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Notional Value Section */}
          <div className="space-y-2.5 pt-3 border-t border-slate-100">
            <Label htmlFor="notional" className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
              合约名义价值 (USD)
            </Label>
            <div className="relative">
              <Input
                id="notional"
                type="number"
                min="1"
                value={notionalValue}
                onChange={(e) => setNotionalValue(e.target.value)}
                className="h-10 bg-slate-50/50 border-slate-200 text-slate-900 font-bold focus:bg-white focus:ring-primary/20 transition-all pr-12"
                placeholder="0.00"
              />
              <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-slate-400">USD</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action Button */}
      <div className="p-3 bg-slate-50/50 border-t border-slate-100 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="relative flex flex-col items-center justify-center py-2 rounded-lg border border-blue-100 bg-blue-50/30">
            <span className="text-[9px] uppercase tracking-[0.15em] font-black text-blue-500/60 mb-0.5">
              Lighter 保证金
            </span>
            <span className="font-mono text-xs font-black text-blue-700">
              {lighterMargin != null
                ? `${lighterMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "--"}
            </span>
            <div className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-blue-400/30" />
          </div>

          <div className="relative flex flex-col items-center justify-center py-2 rounded-lg border border-indigo-100 bg-indigo-50/30">
            <span className="text-[9px] uppercase tracking-[0.15em] font-black text-indigo-500/60 mb-0.5">
              GRVT 保证金
            </span>
            <span className="font-mono text-xs font-black text-indigo-700">
              {grvtMargin != null
                ? `${grvtMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : "--"}
            </span>
            <div className="absolute left-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-indigo-400/30" />
          </div>
        </div>
        <Button
          onClick={onExecuteArbitrage}
          disabled={!hasSymbols || executeDisabled}
          className="w-full h-11 bg-primary hover:bg-primary/90 text-white font-black text-sm uppercase tracking-[0.15em] transition-all transform active:scale-[0.98] shadow-md shadow-primary/20 disabled:opacity-50 disabled:grayscale"
        >
          <TrendingUp className="h-4 w-4 mr-2" />
          {executeLabel}
        </Button>
      </div>
    </div>
  );
}
