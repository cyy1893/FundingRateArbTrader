import { useEffect, useRef, useState, useCallback } from 'react';

import { getClientAuthToken } from '@/lib/auth';

export type OrderBookLevel = {
  price: number;
  size: number;
  total: number;
};

export type OrderBookSide = {
  levels: OrderBookLevel[];
};

export type VenueOrderBook = {
  venue: 'lighter' | 'grvt';
  symbol: string;
  bids: OrderBookSide;
  asks: OrderBookSide;
  timestamp: number;
};

export type OrderBookSnapshot = {
  lighter?: VenueOrderBook;
  grvt?: VenueOrderBook;
};

export type TradeEntry = {
  venue: 'lighter' | 'grvt';
  symbol: string;
  price: number;
  size: number;
  is_buy: boolean;
  timestamp: number;
};

export type TradesSnapshot = {
  lighter?: TradeEntry[];
  grvt?: TradeEntry[];
};

export type OrderBookPayload = {
  orderbooks?: OrderBookSnapshot;
  trades?: TradesSnapshot;
};

export type OrderBookSubscription = {
  symbol: string;
  lighter_leverage: number;
  lighter_direction: 'long' | 'short';
  notional_value: number;
  depth: number;
  throttle_ms?: number;
};

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useOrderBookWebSocket(subscription: OrderBookSubscription | null) {
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [trades, setTrades] = useState<TradesSnapshot | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [hasLighter, setHasLighter] = useState(false);
  const [hasGrvt, setHasGrvt] = useState(false);
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionRef = useRef<OrderBookSubscription | null>(null);
  const latestSnapshotRef = useRef<OrderBookPayload | null>(null);
  const throttleIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const tradeBufferRef = useRef<TradesSnapshot>({});

  const connect = useCallback(function doConnect(sub?: OrderBookSubscription | null) {
    const activeSub = sub ?? subscriptionRef.current;
    if (!activeSub) return;

    setStatus('connecting');
    setError(null);
    setOrderBook(null);
    setHasSnapshot(false);
    setHasLighter(false);
    setHasGrvt(false);
    latestSnapshotRef.current = null;
    tradeBufferRef.current = {};

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const base =
      process.env.NEXT_PUBLIC_TRADER_WS_URL ??
      `${protocol}//${window.location.hostname}:8080`;
    const token = getClientAuthToken();
    const wsUrl = `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/ws/orderbook${
      token ? `?token=${encodeURIComponent(token)}` : ''
    }`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        // Send subscription parameters
        ws.send(JSON.stringify(activeSub));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          // Handle error messages from server
          if (data.error) {
            setError(data.error);
            setStatus('error');
            setHasSnapshot(false);
            return;
          }

          const payload = data as OrderBookPayload;
          const ob = payload.orderbooks ?? {};
          const tr = payload.trades ?? {};

          setHasSnapshot(Boolean(payload.orderbooks));
          setHasLighter(Boolean(ob.lighter || tr.lighter));
          setHasGrvt(Boolean(ob.grvt || tr.grvt));
          latestSnapshotRef.current = payload;
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('WebSocket connection error');
        setStatus('error');
        setHasSnapshot(false);
        setHasLighter(false);
        setHasGrvt(false);
        tradeBufferRef.current = {};
      };

      ws.onclose = () => {
        setStatus('disconnected');
        wsRef.current = null;
        setHasSnapshot(false);
        setHasLighter(false);

        // Auto-reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          const latestSub = subscriptionRef.current;
          if (latestSub) doConnect(latestSub);
        }, 3000);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setStatus('error');
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setStatus('disconnected');
    setOrderBook(null);
    setError(null);
    setHasSnapshot(false);
    setHasLighter(false);
    setHasGrvt(false);
    latestSnapshotRef.current = null;
    tradeBufferRef.current = {};
  }, []);

  const mergeTrades = useCallback((incoming: TradeEntry[] | undefined, venue: 'lighter' | 'grvt') => {
    if (!incoming || incoming.length === 0) {
      return;
    }
    const existing = tradeBufferRef.current[venue] ?? [];
    const combined = [...incoming, ...existing];
    combined.sort((a, b) => b.timestamp - a.timestamp);
    tradeBufferRef.current = {
      ...tradeBufferRef.current,
      [venue]: combined.slice(0, 100),
    };
  }, []);

  useEffect(() => {
    subscriptionRef.current = subscription;
    if (subscription) {
      connect(subscription);
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [subscription, connect, disconnect]);

  useEffect(() => {
    throttleIntervalRef.current = setInterval(() => {
      const payload = latestSnapshotRef.current;
      if (payload) {
        if (payload.orderbooks) {
          setOrderBook(payload.orderbooks);
        }
        if (payload.trades) {
          mergeTrades(payload.trades.lighter, 'lighter');
          mergeTrades(payload.trades.grvt, 'grvt');
          setTrades({ ...tradeBufferRef.current });
        }
      }
    }, 500);

    return () => {
      if (throttleIntervalRef.current) {
        clearInterval(throttleIntervalRef.current);
        throttleIntervalRef.current = null;
      }
    };
  }, []);

  return {
    orderBook,
    trades,
    status,
    error,
    hasSnapshot,
    hasLighter,
    hasGrvt,
    reconnect: connect,
  };
}
