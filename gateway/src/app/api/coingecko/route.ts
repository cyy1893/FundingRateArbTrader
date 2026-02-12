import { NextResponse } from "next/server";

const TRADER_API_BASE_URL =
  process.env.TRADER_API_BASE_URL ??
  process.env.API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "http://localhost:8080";

type CoinGeckoPayload = {
  symbols?: string[];
};

function mapMarket(raw: Record<string, unknown>) {
  return {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    image: raw.image != null ? String(raw.image) : null,
    symbol: String(raw.symbol ?? "").toUpperCase(),
    currentPrice:
      raw.current_price != null ? Number(raw.current_price) : null,
    volumeUsd: raw.volume_usd != null ? Number(raw.volume_usd) : null,
    priceChange1h:
      raw.price_change_1h != null ? Number(raw.price_change_1h) : null,
    priceChange24h:
      raw.price_change_24h != null ? Number(raw.price_change_24h) : null,
    priceChange7d:
      raw.price_change_7d != null ? Number(raw.price_change_7d) : null,
  };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as CoinGeckoPayload;
  const symbols = Array.isArray(body.symbols) ? body.symbols : [];

  const upstream = await fetch(`${TRADER_API_BASE_URL.replace(/\/$/, "")}/coingecko`, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ symbols }),
  });

  const payload = await upstream.json().catch(() => ({}));
  if (!upstream.ok) {
    return NextResponse.json(
      { markets: [], errors: [{ source: "Trader API", message: payload?.detail ?? "无法获取 CoinGecko 数据" }] },
      { status: upstream.status },
    );
  }

  const markets = Array.isArray(payload?.markets)
    ? payload.markets.map((item: Record<string, unknown>) => mapMarket(item))
    : [];
  const errors = Array.isArray(payload?.errors) ? payload.errors : [];
  return NextResponse.json({ markets, errors });
}
