export type SourceId = "hyperliquid" | "lighter" | "grvt";

export type SourceProvider = "hyperliquid" | "lighter" | "grvt";

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
    id: "lighter",
    label: "Lighter",
    provider: "lighter",
  },
  {
    id: "grvt",
    label: "GRVT",
    provider: "grvt",
  },
];

const SOURCE_MAP = new Map(SOURCE_OPTIONS.map((option) => [option.id, option]));

const findSourceOrDefault = (id: SourceId): SourceConfig | undefined => {
  return SOURCE_MAP.get(id);
};

export const DEFAULT_LEFT_SOURCE =
  findSourceOrDefault("lighter") ?? SOURCE_OPTIONS[0];

export const DEFAULT_RIGHT_SOURCE =
  findSourceOrDefault("grvt") ??
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
