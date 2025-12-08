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
import { cn } from "@/lib/utils";

type Props = {
    isOpen: boolean;
    onClose: () => void;
};

const SYMBOLS = ["BTC", "ETH", "SOL", "HYPE", "XRP", "FARTCOIN", "SUI", "WIF", "APT", "PUMP"];

export function OrderDepthSidebar({ isOpen, onClose }: Props) {
    const [symbol, setSymbol] = useState("");
    const [driftLeverage, setDriftLeverage] = useState("1");
    const [lighterLeverage, setLighterLeverage] = useState("1");
    const [driftDirection, setDriftDirection] = useState<"long" | "short">("long");
    const [lighterDirection, setLighterDirection] = useState<"long" | "short">("long");
    const [notionalValue, setNotionalValue] = useState("");

    const [subscription, setSubscription] = useState<OrderBookSubscription | null>(null);
    const { orderBook, status, error } = useOrderBookWebSocket(subscription);

    const handleStart = () => {
        if (!symbol) return;

        const sub: OrderBookSubscription = {
            symbol,
            drift_leverage: parseFloat(driftLeverage) || 1,
            lighter_leverage: parseFloat(lighterLeverage) || 1,
            drift_direction: driftDirection,
            lighter_direction: lighterDirection,
            notional_value: parseFloat(notionalValue) || 1000,
            depth: 10,
        };

        setSubscription(sub);
    };

    const handleReset = () => {
        setSymbol("");
        setDriftLeverage("1");
        setLighterLeverage("1");
        setDriftDirection("long");
        setLighterDirection("long");
        setNotionalValue("");
        setSubscription(null);
    };

    return (
        <aside
            className={cn(
                "pointer-events-none flex w-full flex-shrink-0 transition-all duration-300 xl:h-full",
                isOpen ? "opacity-100 xl:w-[480px]" : "w-0 opacity-0",
            )}
        >
            <div
                className={cn(
                    "pointer-events-auto flex h-full w-full flex-col rounded-xl border bg-card shadow-lg",
                    !isOpen && "hidden",
                )}
            >
                <div className="h-full overflow-y-auto p-6 space-y-6">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-2xl font-semibold">订单深度监控</h2>
                            <p className="text-sm text-muted-foreground mt-1">
                                实时监控 Drift 和 Lighter 的订单簿深度
                            </p>
                        </div>
                        <Button variant="ghost" size="icon" onClick={onClose}>
                            <X className="h-5 w-5" />
                        </Button>
                    </div>

                    {/* Connection Status */}
                    {subscription && (
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
                    )}

                    {/* Error Message */}
                    {error && (
                        <div className="rounded-lg bg-red-50 border border-red-200 p-4">
                            <p className="text-sm text-red-800">{error}</p>
                        </div>
                    )}

                    {!subscription ? (
                        /* Configuration Form */
                        <div className="space-y-6">
                            {/* Step 1: Symbol Selection */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>步骤 1: 选择币种</CardTitle>
                                    <CardDescription>选择要监控的交易对</CardDescription>
                                </CardHeader>
                                <CardContent>
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
                                </CardContent>
                            </Card>

                            {/* Step 2: Leverage and Direction */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>步骤 2: 配置杠杆和方向</CardTitle>
                                    <CardDescription>分别设置 Drift 和 Lighter 的参数</CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-2 gap-4">
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
                                    <div className="grid grid-cols-2 gap-4">
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
                                </CardContent>
                            </Card>

                            {/* Step 3: Notional Value */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>步骤 3: 合约名义价值</CardTitle>
                                    <CardDescription>输入合约的名义价值（USD）</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <Label htmlFor="notional">名义价值 (USD)</Label>
                                    <Input
                                        id="notional"
                                        type="number"
                                        min="1"
                                        value={notionalValue}
                                        onChange={(e) => setNotionalValue(e.target.value)}
                                        placeholder="1000"
                                    />
                                </CardContent>
                            </Card>

                            {/* Start Button */}
                            <div className="flex gap-3">
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
                        </div>
                    ) : (
                        /* Order Book Display */
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-semibold">{symbol} 订单簿</h3>
                                    <p className="text-sm text-muted-foreground">
                                        名义价值: ${subscription.notional_value.toFixed(2)}
                                    </p>
                                </div>
                                <Button variant="outline" size="sm" onClick={handleReset}>
                                    重新配置
                                </Button>
                            </div>

                            <OrderBookDisplay orderBook={orderBook} />
                        </div>
                    )}
                </div>
            </div>
        </aside>
    );
}
