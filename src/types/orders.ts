export type OrderType = 'market' | 'limit';

export type OrderSide = 'buy' | 'sell';

export interface OrderRequest {
  marketId: string;
  outcome: string;
  side: OrderSide;
  size: number;
  price?: number;
  orderType: OrderType;
}

export interface OrderResponse {
  success: boolean;
  order: {
    success: boolean;
    filledSize: string;
    avgPrice: string;
    remainingSize: string;
    orderId: string;
    reason?: string;
  };
  needsHoldingsRefresh?: boolean;
  orderType?: OrderType;
  requestId?: string;
}

export type OrderStatus = {
  type: 'success' | 'error' | null;
  message: string;
};
