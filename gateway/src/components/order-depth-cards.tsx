"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { OrderBookSubscription, useOrderBookWebSocket } from "@/hooks/use-order-book-websocket";
import { OrderBookDisplay } from "@/components/order-book-display";

type SymbolOption = { symbol: string; displayName: string };

type MonitoringConfigCardProps = {
    onClose: () => void;
    onStartMonitoring: (subscription: OrderBookSubscription) => void;
    availableSymbols: SymbolOption[];
    primaryLabel: string;
    secondaryLabel: string;
};

type OrderBookCardProps = {
    subscription: OrderBookSubscription;
    onReset: () => void;
};

const DEFAULT_DEPTH = 10;
const DEFAULT_THROTTLE_MS = 100;

export function MonitoringConfigCard({
    onClose,
    onStartMonitoring,
    availableSymbols,
    primaryLabel,
    secondaryLabel,
}: MonitoringConfigCardProps) {
    const [symbol, setSymbol] = useState("");
    const [lighterLeverage, setLighterLeverage] = useState("1");
    const [lighterDirection, setLighterDirection] = useState<"long" | "short">("long");
    const [notionalValue, setNotionalValue] = useState("");
    const hasSymbols = availableSymbols.length > 0;

    useEffect(() => {
        if (!hasSymbols) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSymbol("");
            return;
        }
        const exists = availableSymbols.some((option) => option.symbol === symbol);
        if (!exists) {
            setSymbol(availableSymbols[0].symbol);
        }
    }, [availableSymbols, hasSymbols, symbol]);

    // Auto-start monitoring when configuration changes
    useEffect(() => {
        if (!symbol) return;

        const sub: OrderBookSubscription = {
            symbol,
            lighter_leverage: parseFloat(lighterLeverage) || 1,
            lighter_direction: lighterDirection,
            notional_value: parseFloat(notionalValue) || 1000,
            depth: DEFAULT_DEPTH,
            throttle_ms: DEFAULT_THROTTLE_MS,
        };

        onStartMonitoring(sub);
    }, [symbol, lighterLeverage, lighterDirection, notionalValue, onStartMonitoring]);

    return (
        <div className="rounded-xl border border-dashed bg-background/60 p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4 pb-3">
                <div>
                    <p className="text-sm font-semibold">套利交易设置</p>
                    <p className="text-xs text-muted-foreground">
                        配置 {primaryLabel} 和 {secondaryLabel} 的套利参数
                    </p>
                </div>
                <Button variant="ghost" size="icon" onClick={onClose}>
                    <X className="h-5 w-5" />
                </Button>
            </div>
            <div className="space-y-4">
                {/* Step 1: Symbol Selection */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold">步骤 1: 选择币种</h3>
                    <Label htmlFor="symbol">币种</Label>
                    <Select value={symbol} onValueChange={setSymbol} disabled={!hasSymbols}>
                        <SelectTrigger id="symbol">
                            <SelectValue placeholder="选择币种" />
                        </SelectTrigger>
                        <SelectContent className="max-h-64 overflow-y-auto">
                            {availableSymbols.map((option) => (
                                <SelectItem key={option.symbol} value={option.symbol}>
                                    {option.displayName} ({option.symbol})
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    {!hasSymbols ? (
                        <p className="text-xs text-muted-foreground">
                            请先在费率比较页选择交易所并筛选币种后再开始套利。
                        </p>
                    ) : null}
                </div>

                {/* Step 2: Leverage and Direction */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold">步骤 2: 配置杠杆和方向</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="lighter-leverage">Lighter 杠杆</Label>
                            <Input
                                id="lighter-leverage"
                                type="number"
                                min="1"
                                max="20"
                                value={lighterLeverage}
                                onChange={(e) => setLighterLeverage(e.target.value)}
                                placeholder="1-20"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="lighter-direction">Lighter 方向</Label>
                            <Select value={lighterDirection} onValueChange={(v) => setLighterDirection(v as "long" | "short")}>
                                <SelectTrigger id="lighter-direction">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="long">做多 (Long)</SelectItem>
                                    <SelectItem value="short">做空 (Short)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </div>

                {/* Step 3: Notional Value */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold">步骤 3: 合约名义价值</h3>
                    <Label htmlFor="notional">名义价值 (USD)</Label>
                    <Input
                        id="notional"
                        type="number"
                        min="1"
                        value={notionalValue}
                        onChange={(e) => setNotionalValue(e.target.value)}
                        placeholder="1000"
                    />
                </div>

                {/* Action Buttons */}
                <div className="flex justify-end pt-2">
                    <Button variant="outline" onClick={onClose}>
                        关闭
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function OrderBookCard({ subscription, onReset }: OrderBookCardProps) {
    const { orderBook, trades, status, error, hasSnapshot, hasLighter, hasGrvt } = useOrderBookWebSocket(subscription);

    return (
        <Card className="border-border/60">
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl font-semibold tracking-tight">
                            {subscription.symbol} 订单簿
                        </CardTitle>
                        <CardDescription className="text-xs">
                            名义价值: ${subscription.notional_value.toFixed(2)}
                        </CardDescription>
                    </div>
                    <Button variant="outline" size="sm" onClick={onReset}>
                        重新配置
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Connection Status */}
                <div className="flex items-center gap-2 text-sm">
                    <div
                        className={`h-2 w-2 rounded-full ${status === "connected"
                                ? "bg-green-500"
                                : status === "connecting"
                                    ? "bg-yellow-500"
                                    : "bg-red-500"
                            }`}
                    />
                    <span className="text-muted-foreground">
                        {status === "connected"
                            ? "已连接"
                            : status === "connecting"
                                ? "连接中..."
                                : "未连接"}
                    </span>
                </div>

                {/* Error Message */}
                {error && (
                    <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                        <p className="text-sm text-red-800">{error}</p>
                    </div>
                )}

                {/* Order Book Display */}
                <OrderBookDisplay
                    orderBook={orderBook}
                    trades={trades}
                    status={status}
                    hasSnapshot={hasSnapshot}
                    hasLighter={hasLighter}
                    hasGrvt={hasGrvt}
                />
            </CardContent>
        </Card>
    );
}
