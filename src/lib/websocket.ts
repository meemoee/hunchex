import { useState, useCallback } from 'react';
import { WSMessage } from '../types/websocket';

// Keep all type definitions for future use
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
  // Keep state hooks for future re-enablement
  const [isConnected] = useState(false);

  const sendMessage = useCallback((data: WSMessage) => {
    console.log('WebSocket disabled - message not sent:', data);
  }, []);

  const subscribeToUpdates = useCallback((handler: UpdateHandler) => {
    console.log('WebSocket disabled - updates not available');
    // Return empty cleanup function to maintain API compatibility
    return () => {};
  }, []);

  return {
    socket: null,
    isConnected,
    sendMessage,
    subscribeToUpdates
  };
}