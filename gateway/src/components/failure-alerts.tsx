'use client';

import { useMemo, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

export type FailureAlertItem = {
  key: string;
  title: string;
  message: string;
};

type FailureAlertsOverlayProps = {
  alerts: FailureAlertItem[];
};

export function FailureAlertsOverlay({ alerts }: FailureAlertsOverlayProps) {
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(
    () => new Set(),
  );

  const visibleAlerts = useMemo(
    () => alerts.filter((alert) => !dismissedKeys.has(alert.key)),
    [alerts, dismissedKeys],
  );

  if (visibleAlerts.length === 0) {
    return null;
  }

  const dismissAlert = (key: string) => {
    setDismissedKeys((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  };

  return (
    <div className="fixed top-4 right-4 z-50 w-full max-w-md space-y-3 drop-shadow-lg">
      {visibleAlerts.map((alert) => (
        <Alert key={alert.key} variant="destructive" className="relative pr-10">
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-1.5 top-1.5 h-6 w-6 text-destructive-foreground"
            aria-label={`关闭 ${alert.title}`}
            onClick={() => dismissAlert(alert.key)}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
          <AlertTitle>{alert.title}</AlertTitle>
          <AlertDescription>{alert.message}</AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
