const { Decimal } = require('decimal.js');
const { auth } = require('express-oauth2-jwt-bearer');

const OrderType = {
  MARKET: 'market',
  LIMIT: 'limit'
};

const OrderSide = {
  BUY: 'buy',
  SELL: 'sell'
};

class OrderBook {
  constructor(bids, asks) {
    // For YES orders:
    // Best ask (lowest ask price) is at asks[0]
    // Best bid (highest bid price) is at bids[0]
    
    // Sort asks ascending by YES price
    this.asks = asks.sort((a, b) => a.price.minus(b.price).toNumber());
    
    // Sort bids descending by YES price
    this.bids = bids.sort((a, b) => b.price.minus(a.price).toNumber());
    
    // Calculate spread and midpoint if possible
    if (this.asks.length && this.bids.length) {
      // For YES prices, spread = lowest ask - highest bid
      this.spread = this.asks[0].price.minus(this.bids[0].price);
      this.mid = this.asks[0].price.plus(this.bids[0].price).div(2);
    } else {
      this.spread = null;
      this.mid = null;
    }
  }

  toJSON() {
    return {
      data: {
        asks: this.asks.map(level => ({
          price: level.price.toNumber(),
          size: level.size.toNumber(),
          change: level.change ? level.change.toNumber() : null
        })),
        bids: this.bids.map(level => ({
          price: level.price.toNumber(),
          size: level.size.toNumber(),
          change: level.change ? level.change.toNumber() : null
        })),
        spread: this.spread ? this.spread.toNumber() : null,
        mid: this.mid ? this.mid.toNumber() : null
      }
    };
  }
}

class OrderManager {
  constructor(pool, redis, polyOrderbook) {
    this.pool = pool;
    this.redis = redis;
    this.polyOrderbook = polyOrderbook;

    // Validate Auth0 configuration
    if (!process.env.AUTH0_AUDIENCE || !process.env.AUTH0_ISSUER_BASE_URL) {
      throw new Error('Missing required Auth0 configuration');
    }

    // Auth0 configuration
    this.checkJwt = auth({
      audience: process.env.AUTH0_AUDIENCE,
      issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
      tokenSigningAlg: 'RS256'
    });
  }

  getAuthMiddleware() {
    return this.checkJwt;
  }

  extractUserId(req) {
    if (!req.auth || !req.auth.sub) {
      throw new Error('Invalid or missing authentication token');
    }
    // Verify Auth0 user ID format (auth0|xxxx or similar)
    if (!req.auth.sub.match(/^[a-zA-Z0-9]+\|[a-zA-Z0-9]+$/)) {
      throw new Error('Invalid Auth0 user ID format');
    }
    return req.auth.sub;
  }

  async getOrderbookSnapshot(marketId, tokenId) {
    try {
      console.log('Getting orderbook for token ID:', tokenId);
      
      const rawBook = await this.polyOrderbook.getOrderbookSnapshot(tokenId);
      
      // Convert NO prices to YES prices (1 - NO price)
      const bids = rawBook.bids.map(bid => ({
        price: new Decimal(1).minus(new Decimal(bid.price)),
        size: new Decimal(bid.size)
      }));
      
      const asks = rawBook.asks.map(ask => ({
        price: new Decimal(1).minus(new Decimal(ask.price)),
        size: new Decimal(ask.size)
      }));
      
      return new OrderBook(bids, asks);
    } catch (err) {
      throw new Error(`Error getting orderbook: ${err.message}`);
    }
  }

  async validateOrder(userId, marketId, tokenId, outcome, side, orderType, size, price = null) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      
      // Market validation
      const marketResult = await client.query(
        'SELECT active, closed, archived FROM markets WHERE id = $1',
        [marketId]
      );
      
      if (!marketResult.rows.length) {
        throw new Error('Market not found');
      }
      
      const market = marketResult.rows[0];
      if (!market.active || market.closed || market.archived) {
        throw new Error('Market is not active');
      }

      // Holdings validation for sells
      if (side === OrderSide.SELL) {
        const holdingsResult = await client.query(
          'SELECT amount FROM holdings WHERE user_id = $1 AND market_id = $2 AND token_id = $3',
          [userId, marketId, tokenId]
        );
        
        const currentHoldings = holdingsResult.rows.length ? 
          new Decimal(holdingsResult.rows[0].amount) : 
          new Decimal(0);

        if (currentHoldings.lessThan(size)) {
          throw new Error(`Insufficient holdings. Have: ${currentHoldings}, Need: ${size}`);
        }
      } else {
        // Balance validation for buys
        const balanceResult = await client.query(
          'SELECT balance FROM user_balances WHERE user_id = $1 FOR UPDATE',
          [userId]
        );
        
        if (!balanceResult.rows.length) {
          throw new Error('User balance not found');
        }
        
        const balance = new Decimal(balanceResult.rows[0].balance);
        
        if (orderType === OrderType.MARKET) {
          const book = await this.getOrderbookSnapshot(marketId, tokenId);
          const levels = book.asks;
          
          if (!levels.length) {
            throw new Error('No liquidity in orderbook');
          }
          
          let remaining = new Decimal(size);
          let totalCost = new Decimal(0);
          
          for (const level of levels) {
            if (remaining.lte(0)) break;
            const fillSize = Decimal.min(remaining, level.size);
            totalCost = totalCost.plus(fillSize.times(level.price));
            remaining = remaining.minus(fillSize);
          }
          
          if (remaining.gt(0)) {
            throw new Error('Insufficient liquidity');
          }
          
          if (totalCost.gt(balance)) {
            throw new Error('Insufficient balance for worst-case fill');
          }
        } else {
          if (!price) {
            throw new Error('Limit price required for limit orders');
          }
          
          const totalCost = new Decimal(size).times(price);
          if (totalCost.gt(balance)) {
            throw new Error(`Insufficient balance. Required: ${totalCost}, Have: ${balance}`);
          }
        }
      }

      await client.query('COMMIT');
      return true;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async executeMarketOrder(userId, marketId, tokenId, outcome, side, size) {
    const client = await this.pool.connect();
    try {
      await this.validateOrder(userId, marketId, tokenId, outcome, side, OrderType.MARKET, size);
      
      const book = await this.getOrderbookSnapshot(marketId, tokenId);
      
      let remainingSize = new Decimal(size);
      let totalCost = new Decimal(0);
      let filledSize = new Decimal(0);
      
      const levels = side === OrderSide.BUY ? book.asks : book.bids;
      
      for (const level of levels) {
        if (remainingSize.lte(0)) break;
        
        const fillSize = Decimal.min(remainingSize, level.size);
        totalCost = totalCost.plus(fillSize.times(level.price));
        filledSize = filledSize.plus(fillSize);
        remainingSize = remainingSize.minus(fillSize);
      }
      
      if (filledSize.eq(0)) {
        throw new Error('Could not fill any quantity');
      }
      
      if (remainingSize.gt(0)) {
        throw new Error('Partial fill only - insufficient liquidity');
      }
      
      const avgPrice = totalCost.div(filledSize);
      
      await client.query('BEGIN');
      
      await client.query(`
        INSERT INTO holdings (user_id, market_id, token_id, outcome, position, amount, entry_price)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id, market_id, token_id) 
        DO UPDATE SET 
          amount = holdings.amount + $6,
          entry_price = (holdings.entry_price * holdings.amount + $7 * $6) 
                       / (holdings.amount + $6)
      `, [userId, marketId, tokenId, outcome, side, filledSize.toString(), avgPrice.toString()]);
      
      await client.query(
        'UPDATE user_balances SET balance = balance - $1 WHERE user_id = $2',
        [totalCost.toString(), userId]
      );
      
      const tradeResult = await client.query(`
        INSERT INTO trade_history 
        (user_id, market_id, token_id, outcome, side, size, price, order_type)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id
      `, [userId, marketId, tokenId, outcome, side, filledSize.toString(), 
          avgPrice.toString(), OrderType.MARKET]);
      
      await client.query('COMMIT');
      
      return {
        success: true,
        filledSize,
        avgPrice,
        remainingSize,
        orderId: tradeResult.rows[0].id
      };
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async submitLimitOrder(userId, marketId, tokenId, outcome, side, size, price) {
    const client = await this.pool.connect();
    try {
      await this.validateOrder(
        userId, marketId, tokenId, outcome, side, OrderType.LIMIT, size, price
      );
      
      const book = await this.getOrderbookSnapshot(marketId, tokenId);
      
      if (side === OrderSide.BUY) {
        if (book.asks.length && new Decimal(price).gte(book.asks[0].price)) {
          return await this.executeMarketOrder(userId, marketId, tokenId, outcome, side, size);
        }
      } else {
        if (book.bids.length && new Decimal(price).lte(book.bids[0].price)) {
          return await this.executeMarketOrder(userId, marketId, tokenId, outcome, side, size);
        }
      }
      
      await client.query('BEGIN');
      
      const orderResult = await client.query(`
        INSERT INTO active_orders 
        (user_id, market_id, token_id, outcome, side, size, limit_price, order_type, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
        RETURNING id
      `, [userId, marketId, tokenId, outcome, side, size.toString(), 
          price.toString(), OrderType.LIMIT]);
      
      await client.query('COMMIT');
      
      return {
        success: true,
        filledSize: new Decimal(0),
        avgPrice: new Decimal(0),
        remainingSize: new Decimal(0),
        reason: 'Limit order stored',
        orderId: orderResult.rows[0].id
      };
      
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = {
  OrderManager,
  OrderType,
  OrderSide,
  OrderBook
};
