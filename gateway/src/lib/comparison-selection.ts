import {
  DEFAULT_LEFT_SOURCE,
  DEFAULT_RIGHT_SOURCE,
  normalizeSource,
  type SourceConfig,
  type SourceId,
} from "@/lib/external";
import { DEFAULT_VOLUME_THRESHOLD } from "@/lib/volume-filter";

export type ComparisonSelection = {
  primarySourceId: SourceId;
  secondarySourceId: SourceId;
  volumeThreshold: number;
  symbols: Array<{ symbol: string; displayName: string }>;
  updatedAt?: string;
};

export type ResolvedComparisonSelection = {
  primarySource: SourceConfig;
  secondarySource: SourceConfig;
  volumeThreshold: number;
  symbols: Array<{ symbol: string; displayName: string }>;
  updatedAt: Date | null;
};

const STORAGE_KEY = "fra:last-comparison-selection";
const SOURCE_IDS: SourceId[] = ["hyperliquid", "lighter", "grvt"];

const isBrowser = typeof window !== "undefined";

const isSourceId = (value: unknown): value is SourceId => {
  return typeof value === "string" && SOURCE_IDS.includes(value as SourceId);
};

const normalizeSymbols = (
  symbols: Array<{ symbol: string; displayName: string }>,
): Array<{ symbol: string; displayName: string }> => {
  const seen = new Set<string>();

  return symbols.reduce<Array<{ symbol: string; displayName: string }>>(
    (acc, entry) => {
      const rawSymbol = entry.symbol?.trim();
      if (!rawSymbol) {
        return acc;
      }
      const symbol = rawSymbol.toUpperCase();
      if (seen.has(symbol)) {
        return acc;
      }
      seen.add(symbol);
      const displayName = entry.displayName?.trim() || symbol;
      acc.push({ symbol, displayName });
      return acc;
    },
    [],
  );
};

export function persistComparisonSelection(selection: ComparisonSelection) {
  if (!isBrowser) {
    return;
  }

  const primarySourceId = isSourceId(selection.primarySourceId)
    ? selection.primarySourceId
    : DEFAULT_LEFT_SOURCE.id;
  const secondarySourceId = isSourceId(selection.secondarySourceId)
    ? selection.secondarySourceId
    : DEFAULT_RIGHT_SOURCE.id;

  const payload: ComparisonSelection = {
    primarySourceId,
    secondarySourceId,
    volumeThreshold:
      Number.isFinite(selection.volumeThreshold) && selection.volumeThreshold >= 0
        ? selection.volumeThreshold
        : DEFAULT_VOLUME_THRESHOLD,
    symbols: normalizeSymbols(selection.symbols ?? []).slice(0, 300),
    updatedAt: selection.updatedAt ?? new Date().toISOString(),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.error("Failed to persist comparison selection", error);
  }
}

export function readComparisonSelection(): ResolvedComparisonSelection | null {
  if (!isBrowser) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ComparisonSelection>;

    const primarySource = isSourceId(parsed.primarySourceId)
      ? parsed.primarySourceId
      : DEFAULT_LEFT_SOURCE.id;
    const secondarySource = isSourceId(parsed.secondarySourceId)
      ? parsed.secondarySourceId
      : DEFAULT_RIGHT_SOURCE.id;
    const volumeThreshold =
      Number.isFinite(parsed.volumeThreshold) && (parsed.volumeThreshold ?? 0) >= 0
        ? Number(parsed.volumeThreshold)
        : DEFAULT_VOLUME_THRESHOLD;
    const symbols = normalizeSymbols(parsed.symbols ?? []);

    return {
      primarySource: normalizeSource(primarySource, DEFAULT_LEFT_SOURCE),
      secondarySource: normalizeSource(secondarySource, DEFAULT_RIGHT_SOURCE),
      volumeThreshold,
      symbols,
      updatedAt: parsed.updatedAt ? new Date(parsed.updatedAt) : null,
    };
  } catch (error) {
    console.error("Failed to read comparison selection", error);
    return null;
  }
}
