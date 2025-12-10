import { useEffect, useRef, useState, useCallback } from 'react';

export type OrderBookLevel = {
  price: number;
  size: number;
  total: number;
};

export type OrderBookSide = {
  levels: OrderBookLevel[];
};

export type VenueOrderBook = {
  venue: 'drift' | 'lighter';
  symbol: string;
  bids: OrderBookSide;
  asks: OrderBookSide;
  timestamp: number;
};

export type OrderBookSnapshot = {
  drift?: VenueOrderBook;
  lighter?: VenueOrderBook;
};

export type OrderBookSubscription = {
  symbol: string;
  drift_leverage: number;
  lighter_leverage: number;
  drift_direction: 'long' | 'short';
  lighter_direction: 'long' | 'short';
  notional_value: number;
  depth: number;
  throttle_ms?: number;
  drift_poll_ms?: number;
};

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useOrderBookWebSocket(subscription: OrderBookSubscription | null) {
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [hasSnapshot, setHasSnapshot] = useState(false);
  const [hasDrift, setHasDrift] = useState(false);
  const [hasLighter, setHasLighter] = useState(false);
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const subscriptionRef = useRef<OrderBookSubscription | null>(null);
  const latestSnapshotRef = useRef<OrderBookSnapshot | null>(null);
  const throttleIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const normalizeSymbol = useCallback((sym: string | undefined | null) => {
    if (!sym) return "";
    return sym.replace(/-PERP$/i, "").trim().toUpperCase();
  }, []);

  const connect = useCallback((sub?: OrderBookSubscription | null) => {
    const activeSub = sub ?? subscriptionRef.current;
    if (!activeSub) return;

    setStatus('connecting');
    setError(null);
    setOrderBook(null);
    setHasSnapshot(false);
    setHasDrift(false);
    setHasLighter(false);
    latestSnapshotRef.current = null;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8080/ws/orderbook`;

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

          const currentSymbol = subscriptionRef.current?.symbol;
          if (currentSymbol) {
            const target = normalizeSymbol(currentSymbol);
            const symbols = [data.drift?.symbol, data.lighter?.symbol]
              .map((sym) => normalizeSymbol(sym))
              .filter(Boolean);
            if (symbols.length > 0 && symbols.some((sym) => sym !== target)) {
              return;
            }
          }

          setHasSnapshot(true);
          setHasDrift(Boolean(data.drift));
          setHasLighter(Boolean(data.lighter));
          latestSnapshotRef.current = data;
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('WebSocket connection error');
        setStatus('error');
        setHasSnapshot(false);
        setHasDrift(false);
        setHasLighter(false);
      };

      ws.onclose = () => {
        setStatus('disconnected');
        wsRef.current = null;
        setHasSnapshot(false);
        setHasDrift(false);
        setHasLighter(false);

        // Auto-reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          const latestSub = subscriptionRef.current;
          if (latestSub) connect(latestSub);
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
    setHasDrift(false);
    setHasLighter(false);
    latestSnapshotRef.current = null;
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
  }, [subscription, connect, disconnect, normalizeSymbol]);

  useEffect(() => {
    throttleIntervalRef.current = setInterval(() => {
      if (latestSnapshotRef.current) {
        setOrderBook(latestSnapshotRef.current);
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
    status,
    error,
    hasSnapshot,
    hasDrift,
    hasLighter,
    reconnect: connect,
  };
}
