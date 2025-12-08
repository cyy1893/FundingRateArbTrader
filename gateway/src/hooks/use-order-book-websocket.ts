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
};

type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export function useOrderBookWebSocket(subscription: OrderBookSubscription | null) {
  const [orderBook, setOrderBook] = useState<OrderBookSnapshot | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const connect = useCallback(() => {
    if (!subscription) return;

    setStatus('connecting');
    setError(null);

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.hostname}:8080/ws/orderbook`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        // Send subscription parameters
        ws.send(JSON.stringify(subscription));
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle error messages from server
          if (data.error) {
            setError(data.error);
            setStatus('error');
            return;
          }

          // Update order book data
          setOrderBook(data);
        } catch (err) {
          console.error('Failed to parse WebSocket message:', err);
        }
      };

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setError('WebSocket connection error');
        setStatus('error');
      };

      ws.onclose = () => {
        setStatus('disconnected');
        wsRef.current = null;

        // Auto-reconnect after 3 seconds
        reconnectTimeoutRef.current = setTimeout(() => {
          if (subscription) {
            connect();
          }
        }, 3000);
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      setStatus('error');
    }
  }, [subscription]);

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
  }, []);

  useEffect(() => {
    if (subscription) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [subscription, connect, disconnect]);

  return {
    orderBook,
    status,
    error,
    reconnect: connect,
  };
}
