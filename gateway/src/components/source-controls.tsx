"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  SOURCE_OPTIONS,
  type SourceId,
} from "@/lib/external";

type SourceControlsProps = {
  leftSourceId: SourceId;
  rightSourceId: SourceId;
};

export function SourceControls({
  leftSourceId,
  rightSourceId,
}: SourceControlsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateSearchParams = useCallback(
    (key: string, value: string, defaultValue?: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (defaultValue && value === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const query = params.toString();
      router.push(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
    },
    [pathname, router, searchParams],
  );

  const handlePrimarySourceChange = useCallback(
    (value: string) => {
      updateSearchParams("sourceA", value, DEFAULT_LEFT_SOURCE.id);
    },
    [updateSearchParams],
  );

  const handleSecondarySourceChange = useCallback(
    (value: string) => {
      updateSearchParams("sourceB", value, DEFAULT_RIGHT_SOURCE.id);
    },
    [updateSearchParams],
  );

  return (
    <div className="rounded-lg border border-border/80 bg-background/60 p-3">
      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row">
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide">
            左侧交易所
          </span>
          <Select value={leftSourceId} onValueChange={handlePrimarySourceChange}>
            <SelectTrigger className="focus-visible:outline-none focus-visible:ring-0">
              <SelectValue placeholder="选择交易所" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wide">
            右侧交易所
          </span>
          <Select value={rightSourceId} onValueChange={handleSecondarySourceChange}>
            <SelectTrigger className="focus-visible:outline-none focus-visible:ring-0">
              <SelectValue placeholder="选择交易所" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>
    </div>
  );
}
