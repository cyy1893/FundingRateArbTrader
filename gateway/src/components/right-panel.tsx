"use client";

import { useEffect, useState } from "react";
import { useFundingPredictionSidebar, FundingPredictionContent } from "@/components/funding-prediction-sidebar";
import { Sheet, SheetContent } from "@/components/ui/sheet";

export function RightPanel() {
    const prediction = useFundingPredictionSidebar();
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (prediction.isOpen) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setOpen(true);
        }
    }, [prediction.isOpen]);

    const handleOpenChange = (newOpen: boolean) => {
        setOpen(newOpen);
        if (!newOpen) {
            prediction.close();
        }
    };

    return (
        <Sheet open={open} onOpenChange={handleOpenChange} modal={false}>
            <SheetContent className="top-16 h-[calc(100vh-4rem)] w-[700px] border-l shadow-xl outline-none p-0 sm:max-w-[700px] data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
                <div className="flex h-full flex-col">
                    <div className="flex border-b px-4 py-3 text-sm font-medium text-primary">
                        推荐套利币种
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <FundingPredictionContent />
                    </div>
                </div>
            </SheetContent>
        </Sheet>
    );
}
