"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function ErrorNotification({ message }: { message: string | null }) {
    const lastMessageRef = useRef<string | null>(null);

    useEffect(() => {
        if (message && message !== lastMessageRef.current) {
            toast.error(message, {
                duration: 5000,
                className: "bg-destructive text-destructive-foreground border-destructive",
            });
            lastMessageRef.current = message;
        }
    }, [message]);

    return null;
}
