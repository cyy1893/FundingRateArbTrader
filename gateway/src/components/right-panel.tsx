"use client";

import { useEffect, useState } from "react";
import { useArbitrageSidebar, ArbitrageContent } from "@/components/arbitrage-sidebar";
import { useFundingPredictionSidebar, FundingPredictionContent } from "@/components/funding-prediction-sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

type Tab = "arbitrage" | "prediction";

type SidebarProps = {
    primarySourceId: string;
    secondarySourceId: string;
    volumeThreshold: number;
};

export function RightPanel({
    primarySourceId,
    secondarySourceId,
    volumeThreshold,
}: SidebarProps) {
    const arbitrage = useArbitrageSidebar();
    const prediction = useFundingPredictionSidebar();
    const [open, setOpen] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>("arbitrage");

    // Sync open state with providers
    // If a provider says "open", we open the sheet and switch to that tab
    useEffect(() => {
        if (arbitrage.isOpen) {
            setOpen(true);
            setActiveTab("arbitrage");
        }
    }, [arbitrage.isOpen]);

    useEffect(() => {
        if (prediction.isOpen) {
            setOpen(true);
            setActiveTab("prediction");
        }
    }, [prediction.isOpen]);

    // When sheet closes, close providers
    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (!newOpen) {
            arbitrage.close();
            prediction.close();
        }
    };

    const handleTabChange = (tab: Tab) => {
        setActiveTab(tab);

        const request = {
            sourceA: primarySourceId,
            sourceB: secondarySourceId,
            volumeThreshold,
        };

        if (tab === "arbitrage") {
            const isSame =
                arbitrage.lastRequest &&
                arbitrage.lastRequest.sourceA === request.sourceA &&
                arbitrage.lastRequest.sourceB === request.sourceB &&
                arbitrage.lastRequest.volumeThreshold === request.volumeThreshold;

            // Only call open if it's not already open or if the request changed.
            // calling open() toggles it if same request, so we avoid that if it is open.
            if (!arbitrage.isOpen || !isSame) {
                arbitrage.open(request);
            }
        } else if (tab === "prediction") {
            const isSame =
                prediction.lastRequest &&
                prediction.lastRequest.sourceA === request.sourceA &&
                prediction.lastRequest.sourceB === request.sourceB &&
                prediction.lastRequest.volumeThreshold === request.volumeThreshold;

            if (!prediction.isOpen || !isSame) {
                prediction.open(request);
            }
        }
    };

    return (
        <Sheet open={open} onOpenChange={handleOpenChange} modal={false}>
            <SheetContent className="top-16 h-[calc(100vh-4rem)] w-[500px] border-l shadow-xl outline-none p-0 sm:max-w-[500px] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
                <div className="flex h-full flex-col">
                    <div className="flex border-b">
                        <button
                            onClick={() => handleTabChange("arbitrage")}
                            className={cn(
                                "flex-1 border-b-2 py-4 text-sm font-medium transition-colors hover:bg-muted/50",
                                activeTab === "arbitrage"
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                        >
                            过去 24H APR
                        </button>
                        <button
                            onClick={() => handleTabChange("prediction")}
                            className={cn(
                                "flex-1 border-b-2 py-4 text-sm font-medium transition-colors hover:bg-muted/50",
                                activeTab === "prediction"
                                    ? "border-primary text-primary"
                                    : "border-transparent text-muted-foreground hover:text-foreground",
                            )}
                        >
                            预测 24H APR
                        </button>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        {activeTab === "arbitrage" ? (
                            <ArbitrageContent />
                        ) : (
                            <FundingPredictionContent />
                        )}
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
