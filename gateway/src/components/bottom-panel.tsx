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

type UnifiedVenue = {
    id: "lighter" | "grvt";
    name: string;
    totalUsd: number;
    balances: {
        headers: string[];
        rows: { key: string; cells: string[] }[];
    };
    positionGroups: {
        headers: string[];
        rows: { key: string; cells: string[] }[];
    }[];
};

type BottomPanelProps = {
    venues: UnifiedVenue[];
};

type TabType = "positions" | "balances";

const usdFormatter = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
});

export function BottomPanel({ venues }: BottomPanelProps) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [activeTab, setActiveTab] = useState<TabType>("positions");

    // Aggregate all positions
    const allPositions = venues.flatMap((venue) =>
        venue.positionGroups.flatMap((group) =>
            group.rows.map((row) => ({
                venue: venue.name,
                market: row.cells[0],
                position: row.cells[1],
                value: row.cells[2],
                pnl: row.cells[3],
            }))
        )
    );

    const hasPositions = allPositions.length > 0;

    return (
        <div className="bg-white border-t border-gray-200 shadow-sm">
            {/* Tab Bar */}
            <div className="flex items-center justify-between px-6 py-2 border-b border-gray-200 bg-gray-50">
                <div className="flex items-center gap-1">
                    <button
                        onClick={() => {
                            setActiveTab("positions");
                            setIsExpanded(true);
                        }}
                        className={cn(
                            "px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-all",
                            activeTab === "positions"
                                ? "text-gray-900 border-b-2 border-blue-600"
                                : "text-gray-600 hover:text-gray-900"
                        )}
                    >
                        持仓 {hasPositions && `(${allPositions.length})`}
                    </button>
                    <button
                        onClick={() => {
                            setActiveTab("balances");
                            setIsExpanded(true);
                        }}
                        className={cn(
                            "px-4 py-2 text-xs font-semibold uppercase tracking-wide transition-all",
                            activeTab === "balances"
                                ? "text-gray-900 border-b-2 border-blue-600"
                                : "text-gray-600 hover:text-gray-900"
                        )}
                    >
                        余额
                    </button>
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
                    {activeTab === "positions" ? (
                        <PositionsTable positions={allPositions} />
                    ) : (
                        <BalancesTable venues={venues} />
                    )}
                </div>
            </div>
        </div>
    );
}

function PositionsTable({
    positions,
}: {
    positions: Array<{
        venue: string;
        market: string;
        position: string;
        value: string;
        pnl: string;
    }>;
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
                    <TableHead className="text-gray-700 font-semibold uppercase text-[10px] tracking-wider">
                        交易所
                    </TableHead>
                    <TableHead className="text-gray-700 font-semibold uppercase text-[10px] tracking-wider">
                        市场
                    </TableHead>
                    <TableHead className="text-right text-gray-700 font-semibold uppercase text-[10px] tracking-wider">
                        仓位
                    </TableHead>
                    <TableHead className="text-right text-gray-700 font-semibold uppercase text-[10px] tracking-wider">
                        持仓价值
                    </TableHead>
                    <TableHead className="text-right text-gray-700 font-semibold uppercase text-[10px] tracking-wider">
                        未实现盈亏
                    </TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {positions.map((pos, idx) => {
                    const pnlValue = parseFloat(pos.pnl.replace(/[$,]/g, ""));
                    const isPnlPositive = pnlValue >= 0;

                    return (
                        <TableRow
                            key={`${pos.venue}-${pos.market}-${idx}`}
                            className="border-gray-200 hover:bg-gray-50"
                        >
                            <TableCell className="text-gray-600 text-xs">
                                {pos.venue}
                            </TableCell>
                            <TableCell className="text-gray-900 font-semibold text-sm font-mono">
                                {pos.market}
                            </TableCell>
                            <TableCell className="text-right text-gray-700 text-sm font-mono">
                                {pos.position}
                            </TableCell>
                            <TableCell className="text-right text-gray-900 text-sm font-mono">
                                {pos.value}
                            </TableCell>
                            <TableCell
                                className={cn(
                                    "text-right text-sm font-mono font-semibold",
                                    isPnlPositive ? "text-green-700" : "text-red-700"
                                )}
                            >
                                {pos.pnl}
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}

function BalancesTable({ venues }: { venues: UnifiedVenue[] }) {
    return (
        <div className="grid grid-cols-2 gap-6">
            {venues.map((venue) => (
                <div key={venue.id}>
                    <h4 className="text-gray-900 font-semibold text-sm mb-3 uppercase tracking-wide">
                        {venue.name}
                    </h4>
                    <Table>
                        <TableHeader>
                            <TableRow className="border-gray-200 hover:bg-transparent">
                                {venue.balances.headers.map((header, idx) => (
                                    <TableHead
                                        key={`${venue.id}-header-${idx}`}
                                        className="text-gray-700 font-semibold uppercase text-[10px] tracking-wider"
                                    >
                                        {header}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {venue.balances.rows.map((row) => (
                                <TableRow
                                    key={row.key}
                                    className="border-gray-200 hover:bg-gray-50"
                                >
                                    {row.cells.map((cell, idx) => (
                                        <TableCell
                                            key={`${row.key}-${idx}`}
                                            className="text-gray-900 text-sm font-mono"
                                        >
                                            {cell}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            ))}
        </div>
    );
}
