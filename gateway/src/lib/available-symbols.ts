import type { SourceConfig } from "@/lib/external";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

export type AvailableSymbolEntry = {
  symbol: string;
  displayName: string;
};

export type AvailableSymbolsSnapshot = {
  symbols: AvailableSymbolEntry[];
  fetchedAt: Date | null;
};

export async function getAvailableSymbols(
  primarySource: SourceConfig,
  secondarySource: SourceConfig,
): Promise<AvailableSymbolsSnapshot> {
  const upstream = `${TRADER_API_BASE_URL.replace(/\/$/, "")}/available-symbols`;
  const response = await fetch(upstream, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      primary_source: primarySource.provider,
      secondary_source: secondarySource.provider,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(
      `无法获取可用币种（${response.status}）：${message || "未知错误"}`,
    );
  }

  const payload = (await response.json()) as {
    symbols?: Array<Record<string, unknown>>;
    fetched_at?: string | null;
  };

  const symbols = (payload.symbols ?? []).map((entry) => ({
    symbol: String(entry.symbol ?? ""),
    displayName: String(entry.display_name ?? entry.symbol ?? ""),
  }));

  return {
    symbols,
    fetchedAt: payload.fetched_at ? new Date(payload.fetched_at) : null,
  };
}
