export type SourceId = "hyperliquid" | "drift" | "lighter";

export type SourceProvider = "hyperliquid" | "drift" | "lighter";

export type SourceConfig = {
  id: SourceId;
  label: string;
  provider: SourceProvider;
};

export const SOURCE_OPTIONS: SourceConfig[] = [
  {
    id: "hyperliquid",
    label: "Hyperliquid",
    provider: "hyperliquid",
  },
  {
    id: "drift",
    label: "Drift",
    provider: "drift",
  },
  {
    id: "lighter",
    label: "Lighter",
    provider: "lighter",
  },
];

const SOURCE_MAP = new Map(SOURCE_OPTIONS.map((option) => [option.id, option]));

const findSourceOrDefault = (id: SourceId): SourceConfig | undefined => {
  return SOURCE_MAP.get(id);
};

export const DEFAULT_LEFT_SOURCE =
  findSourceOrDefault("lighter") ?? SOURCE_OPTIONS[0];

export const DEFAULT_RIGHT_SOURCE =
  findSourceOrDefault("drift") ??
  SOURCE_OPTIONS.find((option) => option.id !== DEFAULT_LEFT_SOURCE.id) ??
  SOURCE_OPTIONS[0];

export function normalizeSource(
  value: string | null | undefined,
  fallback: SourceConfig,
): SourceConfig {
  if (value) {
    const normalized = SOURCE_MAP.get(value as SourceId);
    if (normalized) {
      return normalized;
    }
  }
  return fallback;
}
