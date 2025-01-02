import { type OrderResponse } from '@/types/orders';

type OrderRequest = {
  marketId: string;
  outcome: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
};

export class OrderService {
  async submitOrder(userId: string, orderData: OrderRequest): Promise<OrderResponse> {
    try {
      const response = await fetch('/api/submit-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          marketId: orderData.marketId,
          outcome: orderData.outcome,
          side: orderData.side,
          size: orderData.size,
          price: orderData.price
        }),
        credentials: 'include' // Important for Auth0 session cookie
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Order submission failed');
      }

      return await response.json();
    } catch (error) {
      console.error('Order service error:', error);
      throw error;
    }
  }
}
