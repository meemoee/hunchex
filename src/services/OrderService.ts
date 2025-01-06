import { type OrderResponse, type OrderRequest, type OrderType } from '@/types/orders';

export class OrderService {
  private determineOrderType(orderData: Partial<OrderRequest>): OrderType {
    return orderData.price ? 'limit' : 'market';
  }

  async submitOrder(userId: string, orderData: Omit<OrderRequest, 'orderType'>): Promise<OrderResponse> {
    console.log('Submitting order:', {
      userId,
      marketId: orderData.marketId,
      side: orderData.side,
      size: orderData.size,
      hasPrice: !!orderData.price
    });

    try {
      const orderType = this.determineOrderType(orderData);
      const requestBody = {
        ...orderData,
        orderType
      };

      const response = await fetch('/api/submit-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        credentials: 'include' // Important for Auth0 session cookie
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('Order submission failed:', errorData);
        throw new Error(errorData.error || 'Order submission failed');
      }

      const responseData = await response.json();
      
      // Enhance response with client-side context
      return {
        ...responseData,
        needsHoldingsRefresh: orderType === 'market' || responseData.immediateExecution,
        orderType
      };
    } catch (error) {
      console.error('Order service error:', error);
      throw error;
    }
  }
}
