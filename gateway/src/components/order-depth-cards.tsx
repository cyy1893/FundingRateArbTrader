"use client";

import { useState } from "react";
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

type MonitoringConfigCardProps = {
    onClose: () => void;
    onStartMonitoring: (subscription: OrderBookSubscription) => void;
};

type OrderBookCardProps = {
    subscription: OrderBookSubscription;
    onReset: () => void;
};

const SYMBOLS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "FARTCOIN", "SUI", "WIF", "APT", "PUMP"];

export function MonitoringConfigCard({ onClose, onStartMonitoring }: MonitoringConfigCardProps) {
    const [symbol, setSymbol] = useState("");
    const [driftLeverage, setDriftLeverage] = useState("1");
    const [lighterLeverage, setLighterLeverage] = useState("1");
    const [driftDirection, setDriftDirection] = useState<"long" | "short">("long");
    const [lighterDirection, setLighterDirection] = useState<"long" | "short">("long");
    const [notionalValue, setNotionalValue] = useState("");

    const handleStart = () => {
        if (!symbol || !notionalValue) return;

        const sub: OrderBookSubscription = {
            symbol,
            drift_leverage: parseFloat(driftLeverage) || 1,
            lighter_leverage: parseFloat(lighterLeverage) || 1,
            drift_direction: driftDirection,
            lighter_direction: lighterDirection,
            notional_value: parseFloat(notionalValue) || 1000,
            depth: 10,
        };

        onStartMonitoring(sub);
    };

    return (
        <Card className="border-border/60">
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle className="text-xl font-semibold tracking-tight">
                            订单深度监控
                        </CardTitle>
                        <CardDescription className="text-xs">
                            配置 Drift 和 Lighter 的订单簿监控参数
                        </CardDescription>
                    </div>
                    <Button variant="ghost" size="icon" onClick={onClose}>
                        <X className="h-5 w-5" />
                    </Button>
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Step 1: Symbol Selection */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold">步骤 1: 选择币种</h3>
                    <Label htmlFor="symbol">币种</Label>
                    <Select value={symbol} onValueChange={setSymbol}>
                        <SelectTrigger id="symbol">
                            <SelectValue placeholder="选择币种" />
                        </SelectTrigger>
                        <SelectContent>
                            {SYMBOLS.map((sym) => (
                                <SelectItem key={sym} value={sym}>
                                    {sym}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Step 2: Leverage and Direction */}
                <div className="space-y-2">
                    <h3 className="text-sm font-semibold">步骤 2: 配置杠杆和方向</h3>
                    <div className="grid grid-cols-2 gap-3">
                        <div className="space-y-2">
                            <Label htmlFor="drift-leverage">Drift 杠杆</Label>
                            <Input
                                id="drift-leverage"
                                type="number"
                                min="1"
                                max="20"
                                value={driftLeverage}
                                onChange={(e) => setDriftLeverage(e.target.value)}
                                placeholder="1-20"
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="drift-direction">Drift 方向</Label>
                            <Select value={driftDirection} onValueChange={(v) => setDriftDirection(v as "long" | "short")}>
                                <SelectTrigger id="drift-direction">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="long">做多 (Long)</SelectItem>
                                    <SelectItem value="short">做空 (Short)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
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
                <div className="flex gap-3 pt-2">
                    <Button
                        className="flex-1"
                        onClick={handleStart}
                        disabled={!symbol || !notionalValue}
                    >
                        开始监控
                    </Button>
                    <Button variant="outline" onClick={onClose}>
                        取消
                    </Button>
                </div>
            </CardContent>
        </Card>
    );
}

export function OrderBookCard({ subscription, onReset }: OrderBookCardProps) {
    const { orderBook, status, error } = useOrderBookWebSocket(subscription);

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
                <OrderBookDisplay orderBook={orderBook} />
            </CardContent>
        </Card>
    );
}
