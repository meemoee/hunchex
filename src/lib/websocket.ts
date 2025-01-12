import { useState, useEffect, useCallback } from 'react';
import { WSMessage } from '../types/websocket';

interface PriceUpdateData {
  market_id: string;
  last_traded_price: number;
  yes_price: number;
  no_price: number;
  volume: number;
}

interface BalanceUpdateData {
  balance: number;
}

interface OrderExecutionData {
  needsHoldingsRefresh: boolean;
}

type WSUpdateData = {
  price_update: PriceUpdateData;
  balance_update: BalanceUpdateData;
  holdings_update: Record<string, never>;
  orders_update: Record<string, never>;
  order_execution: OrderExecutionData;
}

type UpdateHandler = <T extends keyof WSUpdateData>(type: T, data: WSUpdateData[T]) => void;

export type { WSUpdateData, PriceUpdateData, BalanceUpdateData, OrderExecutionData };

export function useWebSocket() {
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [updateHandlers, setUpdateHandlers] = useState<UpdateHandler[]>([]);

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:3000/api/ws');

    ws.onopen = () => {
      console.log('Connected to WebSocket');
      setIsConnected(true);
      ws.send(JSON.stringify({
        type: 'hello'
      } satisfies WSMessage));
    };

    ws.onmessage = (event) => {
      console.log('Received:', event.data);
      try {
        const message = JSON.parse(event.data) as { type: keyof WSUpdateData; data: WSUpdateData[keyof WSUpdateData] };
        // Notify all subscribers with proper typing
        updateHandlers.forEach(handler => {
          // Type assertion needed here as TypeScript cannot infer the relationship
          // between message.type and message.data
          handler(message.type, message.data as WSUpdateData[typeof message.type]);
        });
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
    };

    ws.onclose = () => {
      console.log('WebSocket closed');
      setIsConnected(false);
    };

    setSocket(ws);

    return () => {
      ws.close();
      setIsConnected(false);
    };
  }, [updateHandlers]);

  const sendMessage = useCallback((data: WSMessage) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(data));
    }
  }, [socket]);

  const subscribeToUpdates = useCallback((handler: UpdateHandler) => {
    setUpdateHandlers(prev => [...prev, handler]);
    return () => {
      setUpdateHandlers(prev => prev.filter(h => h !== handler));
    };
  }, []);

  return {
    socket,
    isConnected,
    sendMessage,
    subscribeToUpdates
  };
}