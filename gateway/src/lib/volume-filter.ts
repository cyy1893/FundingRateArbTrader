export type VolumeThresholdOption = {
  label: string;
  value: number;
};

export const DEFAULT_VOLUME_THRESHOLD = 100_000;

export const VOLUME_THRESHOLD_OPTIONS: VolumeThresholdOption[] = [
  { label: "≥ US$1B", value: 1_000_000_000 },
  { label: "≥ US$100M", value: 100_000_000 },
  { label: "≥ US$10M", value: 10_000_000 },
  { label: "≥ US$1M", value: 1_000_000 },
  { label: "≥ US$100K（默认）", value: DEFAULT_VOLUME_THRESHOLD },
  { label: "不限", value: 0 },
];
