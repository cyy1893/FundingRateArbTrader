"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

type AggregatedPositionRow = {
    symbol: string;
    lighterUnrealizedPnl: number;
    grvtUnrealizedPnl: number;
    totalUnrealizedPnl: number;
    hasLighterPosition: boolean;
    hasGrvtPosition: boolean;
};

type BottomPanelProps = {
    positions: AggregatedPositionRow[];
    closingState: Record<string, { postOnly: boolean; market: boolean }>;
    onCloseSymbol: (symbol: string, mode: "post_only" | "market") => void;
};

const usdFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

export function BottomPanel({ positions, closingState, onCloseSymbol }: BottomPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const hasPositions = positions.length > 0;

    return (
        <div className="bg-white border-t border-gray-200 shadow-sm">
            {/* Tab Bar */}
            <div className="flex items-center justify-between px-6 py-2 border-b border-gray-200 bg-gray-50">
                <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-900 border-b-2 border-blue-600">
                    持仓 {hasPositions && `(${positions.length})`}
                </div>

                <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-2 px-3 py-1 rounded text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-all"
                >
                    {isExpanded ? (
                        <>
                            <ChevronDown className="h-3 w-3" />
                            收起
                        </>
                    ) : (
                        <>
                            <ChevronUp className="h-3 w-3" />
                            展开
                        </>
                    )}
                </button>
            </div>

            {/* Content */}
            <div
                className={cn(
                    "overflow-hidden transition-all duration-300",
                    isExpanded ? "max-h-72" : "max-h-0"
                )}
            >
                <div className="p-4 overflow-hidden max-h-72 bg-white">
                    <PositionsTable
                        positions={positions}
                        closingState={closingState}
                        onCloseSymbol={onCloseSymbol}
                    />
                </div>
            </div>
        </div>
    );
}

function PositionsTable({
    positions,
    closingState,
    onCloseSymbol,
}: {
    positions: AggregatedPositionRow[];
    closingState: Record<string, { postOnly: boolean; market: boolean }>;
    onCloseSymbol: (symbol: string, mode: "post_only" | "market") => void;
}) {
    if (positions.length === 0) {
        return (
            <div className="text-center py-12 text-gray-500 text-sm">
                暂无持仓
            </div>
        );
    }

    return (
        <Table>
            <TableHeader>
                <TableRow className="border-gray-200 hover:bg-transparent">
                    <TableHead className="text-gray-700 font-semibold uppercase text-[10px] tracking-wider">币种</TableHead>
                    <TableHead className="text-right text-gray-700 font-semibold uppercase text-[10px] tracking-wider">Lighter未实现盈亏</TableHead>
                    <TableHead className="text-right text-gray-700 font-semibold uppercase text-[10px] tracking-wider">GRVT未实现盈亏</TableHead>
                    <TableHead className="text-right text-gray-700 font-semibold uppercase text-[10px] tracking-wider">总未实现盈亏</TableHead>
                    <TableHead className="text-right text-gray-700 font-semibold uppercase text-[10px] tracking-wider">平仓操作</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {positions.map((pos) => {
                    const isTotalPositive = pos.totalUnrealizedPnl >= 0;
                    const state = closingState[pos.symbol] ?? { postOnly: false, market: false };
                    const disableActions = state.postOnly || state.market || (!pos.hasLighterPosition && !pos.hasGrvtPosition);

                    return (
                        <TableRow
                            key={pos.symbol}
                            className="border-gray-200 hover:bg-gray-50"
                        >
                            <TableCell className="text-gray-900 font-semibold text-sm font-mono">
                                {pos.symbol}
                            </TableCell>
                            <TableCell
                                className={cn(
                                    "text-right text-sm font-mono font-semibold",
                                    pos.lighterUnrealizedPnl >= 0 ? "text-green-700" : "text-red-700"
                                )}
                            >
                                {usdFormatter.format(pos.lighterUnrealizedPnl)}
                            </TableCell>
                            <TableCell
                                className={cn(
                                    "text-right text-sm font-mono font-semibold",
                                    pos.grvtUnrealizedPnl >= 0 ? "text-green-700" : "text-red-700"
                                )}
                            >
                                {usdFormatter.format(pos.grvtUnrealizedPnl)}
                            </TableCell>
                            <TableCell
                                className={cn(
                                    "text-right text-sm font-mono font-semibold",
                                    isTotalPositive ? "text-green-700" : "text-red-700"
                                )}
                            >
                                {usdFormatter.format(pos.totalUnrealizedPnl)}
                            </TableCell>
                            <TableCell className="text-right">
                                <div className="flex items-center justify-end gap-2">
                                    <button
                                        onClick={() => onCloseSymbol(pos.symbol, "post_only")}
                                        disabled={disableActions}
                                        className="rounded border border-slate-300 px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {state.postOnly ? "提交中..." : "挂单平仓"}
                                    </button>
                                    <button
                                        onClick={() => onCloseSymbol(pos.symbol, "market")}
                                        disabled={disableActions}
                                        className="rounded border border-rose-300 px-2 py-1 text-[11px] font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                        {state.market ? "提交中..." : "紧急市价平仓"}
                                    </button>
                                </div>
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}
