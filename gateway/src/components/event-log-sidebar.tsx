"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

// ── types ──────────────────────────────────────────────────────────────

type LogEvent = {
  timestamp: string;
  type: string;
  severity: "info" | "warning" | "error";
  symbol: string | null;
  message: string;
};

// ── helpers ────────────────────────────────────────────────────────────

const severityConfig: Record<string, { dot: string; border: string }> = {
  error:   { dot: "bg-red-500",   border: "border-l-red-500" },
  warning: { dot: "bg-yellow-500", border: "border-l-yellow-500" },
  info:    { dot: "bg-blue-500",   border: "border-l-blue-500" },
};

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}

// ── component ──────────────────────────────────────────────────────────

const POLL_MS = 3000;

export function EventLogSidebar() {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevLenRef = useRef(0);

  const fetchEvents = useCallback(async () => {
    try {
      const resp = await fetch("/api/events/recent", { cache: "no-store" });
      if (resp.ok) {
        const data = (await resp.json()) as LogEvent[];
        setEvents(data);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
    const interval = setInterval(fetchEvents, POLL_MS);
    return () => clearInterval(interval);
  }, [fetchEvents]);

  // Auto-scroll when new events arrive
  useEffect(() => {
    if (events.length > prevLenRef.current && containerRef.current) {
      containerRef.current.scrollTop = 0;
    }
    prevLenRef.current = events.length;
  }, [events.length]);

  if (collapsed) {
    return (
      <div className="flex flex-col items-center border-l border-border bg-card px-1 py-3">
        <button
          onClick={() => setCollapsed(false)}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          title="展开事件日志"
        >
          <Bell className="h-4 w-4" />
        </button>
        {events.length > 0 && (
          <span className="mt-1 text-[10px] font-semibold text-muted-foreground">{events.length}</span>
        )}
      </div>
    );
  }

  return (
    <div className="flex w-72 flex-col border-l border-border bg-card">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold">事件日志</span>
          <span className="text-[10px] text-muted-foreground">({events.length})</span>
        </div>
        <button
          onClick={() => setCollapsed(true)}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Event list */}
      <div ref={containerRef} className="flex-1 overflow-auto">
        {events.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            暂无事件
          </div>
        ) : (
          <div className="flex flex-col-reverse">
            {events.map((event, idx) => {
              const cfg = severityConfig[event.severity] ?? severityConfig.info;
              return (
                <div
                  key={`${event.timestamp}-${idx}`}
                  className={`border-l-2 ${cfg.border} px-2.5 py-1.5 text-xs hover:bg-muted/30 transition-colors`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      {event.type}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {timeAgo(event.timestamp)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1">
                    <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
                    {event.symbol && (
                      <span className="font-medium text-foreground">{event.symbol}</span>
                    )}
                  </div>
                  <p className="mt-0.5 leading-snug text-muted-foreground">
                    {event.message}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
