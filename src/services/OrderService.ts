import { Pool } from 'pg';
import { OrderManager } from '../../OrderManager';
import { type OrderResponse } from '@/types/orders';
import { PolyOrderbook } from '../../polyOrderbook';

type OrderRequest = {
  marketId: string;
  outcome: string;
  side: 'buy' | 'sell';
  size: number;
  price: number;
};

export class OrderService {
  private pool: Pool;
  private orderManager: OrderManager;
  
  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      }
    });
	// Create PolyOrderbook instance
    const polyOrderbook = new PolyOrderbook();
    this.orderManager = new OrderManager(this.pool, null, null);
  }

  async validateMarketAccess(marketId: string, userId: string): Promise<boolean> {
    const result = await this.pool.query(
      'SELECT active, closed FROM markets WHERE id = $1',
      [marketId]
    );
    return result.rows.length > 0 && result.rows[0].active && !result.rows[0].closed;
  }

  async submitOrder(userId: string, orderData: OrderRequest): Promise<OrderResponse> {
    try {
      // Validate market access
      const hasAccess = await this.validateMarketAccess(orderData.marketId, userId);
      if (!hasAccess) {
        throw new Error('Market access denied');
      }

      // Get market token ID
      const tokenId = await this.getMarketTokenId(orderData.marketId, orderData.outcome);

      // Execute order through OrderManager
      return await this.orderManager.executeMarketOrder(
        userId,
        orderData.marketId,
        tokenId,
        orderData.outcome,
        orderData.side,
        orderData.size
      );
    } catch (error) {
      console.error('Order service error:', error);
      throw error;
    }
  }

  private async getMarketTokenId(marketId: string, outcome: string): Promise<string> {
    const result = await this.pool.query(
      'SELECT outcomes, clobtokenids FROM markets WHERE id = $1',
      [marketId]
    );
    
    if (!result.rows.length) {
      throw new Error('Market not found');
    }

    try {
      const cleanOutcomes = result.rows[0].outcomes.replace(/\\"/g, '"').replace(/^"|"$/g, '');
      const cleanTokenIds = result.rows[0].clobtokenids.replace(/\\"/g, '"').replace(/^"|"$/g, '');
      
      const outcomes = JSON.parse(cleanOutcomes);
      const tokenIds = JSON.parse(cleanTokenIds);
      
      const index = outcomes.findIndex((o: string) => o.toLowerCase() === outcome.toLowerCase());
      if (index === -1) {
        throw new Error('Invalid outcome');
      }

      return tokenIds[index];
    } catch (error) {
      console.error('Error parsing market data:', error);
      throw new Error('Invalid market data structure');
    }
  }

  async cleanup() {
    await this.pool.end();
  }
}