export type OrderResponse = {
  success: boolean;
  order: {
    success: boolean;
    filledSize: string;
    avgPrice: string;
    remainingSize: string;
    orderId: string;
    reason?: string;
  };
};

export type OrderStatus = {
  type: 'success' | 'error' | null;
  message: string;
};