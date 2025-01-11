// src/lib/websocket.ts
import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';

// Singleton WebSocket manager
class WebSocketManager {
  private static instance: WebSocketManager;
  private socket: WebSocket | null = null;
  private messageHandlers = new Set<MessageCallback>();
  private activeSubscriptions = new Set<string>();
  private retryCount = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private connectionCount = 0;
  private userId: string | null = null;

  private constructor() {}

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  private createConnection(userId: string) {
    if (this.socket?.readyState === WebSocket.OPEN) return;

    this.userId = userId;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:3000' : window.location.host;
    const wsUrl = new URL(`${protocol}//${host}/api/ws`);
    wsUrl.searchParams.set('token', userId);

    console.log('Creating WebSocket connection:', {
      url: wsUrl.toString(),
      retryCount: this.retryCount
    });

    this.socket = new WebSocket(wsUrl);
    this.setupSocketHandlers();
  }

  private setupSocketHandlers() {
    if (!this.socket) return;

    this.socket.onopen = () => {
      console.log('WebSocket connected successfully');
      this.retryCount = 0;
      
      // Resubscribe to active streams
      this.activeSubscriptions.forEach(sub => {
        const [marketId, side] = sub.split('-');
        this.send({
          type: 'subscribe_orderbook',
          marketId,
          side
        });
      });
    };

    this.socket.onclose = (event) => {
      console.log('WebSocket closed:', event);
      
      if (document.visibilityState === 'visible' && this.retryCount < MAX_RETRIES) {
        const backoffDelay = Math.min(
          INITIAL_RETRY_DELAY * Math.pow(2, this.retryCount),
          MAX_BACKOFF_DELAY
        );
        
        this.clearReconnectTimeout();
        this.reconnectTimeout = setTimeout(() => {
          this.retryCount++;
          if (this.userId) this.createConnection(this.userId);
        }, backoffDelay);
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type) {
          this.messageHandlers.forEach(handler => {
            try {
              handler(data.type as UpdateType, data);
            } catch (error) {
              console.error('Error in message handler:', error);
            }
          });
        }
      } catch (error) {
        console.error('Error processing WebSocket message:', error);
      }
    };

    this.socket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  connect(userId: string) {
    this.connectionCount++;
    console.log('Connection requested, count:', this.connectionCount);
    if (this.connectionCount === 1) {
      this.createConnection(userId);
    }
  }

  disconnect() {
    this.connectionCount--;
    console.log('Disconnect requested, count:', this.connectionCount);
    if (this.connectionCount === 0) {
      this.cleanup();
    }
  }

  private cleanup() {
    this.clearReconnectTimeout();
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.close();
    }
    this.socket = null;
  }

  private clearReconnectTimeout() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }

  send(data: any) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(data));
    }
  }

  subscribeToOrderbook(marketId: string, side: 'YES' | 'NO') {
    const subKey = `${marketId}-${side}`;
    this.activeSubscriptions.add(subKey);
    this.send({
      type: 'subscribe_orderbook',
      marketId,
      side
    });
  }

  unsubscribeFromOrderbook(marketId: string, side: 'YES' | 'NO') {
    const subKey = `${marketId}-${side}`;
    this.activeSubscriptions.delete(subKey);
    this.send({
      type: 'unsubscribe_orderbook',
      marketId,
      side
    });
  }

  addMessageHandler(handler: MessageCallback) {
    this.messageHandlers.add(handler);
  }

  removeMessageHandler(handler: MessageCallback) {
    this.messageHandlers.delete(handler);
  }

  get isConnected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }
}

const wsManager = WebSocketManager.getInstance();

type WebSocketState = {
  isConnected: boolean;
  error: Error | null;
};

type UpdateType = 
  | 'holdings_update' 
  | 'orders_update' 
  | 'balance_update' 
  | 'orderbook_update' 
  | 'price_update'
  | 'error';

type MessageCallback = (type: UpdateType, data: any) => void;

type StreamSubscription = {
  marketId: string;
  side: 'YES' | 'NO';
};

const MAX_RETRIES = 5;
const MAX_BACKOFF_DELAY = 30000; // 30 seconds
const INITIAL_RETRY_DELAY = 1000; // 1 second

export function useWebSocket() {
  const [state, setState] = useState<WebSocketState>({
    isConnected: false,
    error: null
  });
  const { user, isLoading } = useUser();

  useEffect(() => {
    if (!user?.sub || isLoading) return;

    wsManager.connect(user.sub);
    
    const checkConnection = () => {
      setState({
        isConnected: wsManager.isConnected,
        error: null
      });
    };

    // Check connection status periodically
    const interval = setInterval(checkConnection, 1000);
    checkConnection();

    return () => {
      clearInterval(interval);
      wsManager.disconnect();
    };
  }, [user, isLoading]);

  const subscribeToOrderbook = useCallback((marketId: string, side: 'YES' | 'NO') => {
    wsManager.subscribeToOrderbook(marketId, side);
  }, []);

  const unsubscribeFromOrderbook = useCallback((marketId: string, side: 'YES' | 'NO') => {
    wsManager.unsubscribeFromOrderbook(marketId, side);
  }, []);

  const subscribeToUpdates = useCallback((callback: MessageCallback) => {
    wsManager.addMessageHandler(callback);
    return () => {
      wsManager.removeMessageHandler(callback);
    };
  }, []);

  return {
    isConnected: state.isConnected,
    error: state.error,
    subscribeToOrderbook,
    unsubscribeFromOrderbook,
    subscribeToUpdates
  };
}

// Helper hook for orderbook subscriptions
export function useOrderbookSubscription(marketId: string | null, side: 'YES' | 'NO' | null) {
  const { subscribeToOrderbook, unsubscribeFromOrderbook } = useWebSocket();

  useEffect(() => {
    if (!marketId || !side) return;

    subscribeToOrderbook(marketId, side);
    return () => unsubscribeFromOrderbook(marketId, side);
  }, [marketId, side, subscribeToOrderbook, unsubscribeFromOrderbook]);
}
