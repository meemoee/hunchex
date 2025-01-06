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
        this.asks = asks.sort((a, b) => a.price.minus(b.price).toNumber());
        this.bids = bids.sort((a, b) => b.price.minus(a.price).toNumber());
        
        if (this.asks.length && this.bids.length) {
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
    constructor(sql, redis, polyOrderbook, broadcast) {
        console.log('OrderManager initialization:', {
            hasSql: !!sql,
            hasRedis: !!redis,
            hasPolyOrderbook: !!polyOrderbook,
            hasBroadcast: !!broadcast
        });
        
        this.sql = sql;
        this.redis = redis;
        this.polyOrderbook = polyOrderbook;
        this.broadcastToUser = broadcast;

        if (!process.env.AUTH0_AUDIENCE || !process.env.AUTH0_ISSUER_BASE_URL) {
            throw new Error('Missing required Auth0 configuration');
        }

        this.checkJwt = auth({
            audience: process.env.AUTH0_AUDIENCE,
            issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
            tokenSigningAlg: 'RS256'
        });
    }

    getAuthMiddleware() {
        return this.checkJwt;
    }

    async getOrderbookSnapshot(marketId, tokenId) {
		try {
			console.log('Getting orderbook for token ID:', tokenId);
			
			const rawBook = await this.polyOrderbook.getOrderbookSnapshot(tokenId);
			
			// Don't invert prices again - just convert to Decimal
			const bids = rawBook.bids.map(bid => ({
				price: new Decimal(bid.price),
				size: new Decimal(bid.size)
			}));
			
			const asks = rawBook.asks.map(ask => ({
				price: new Decimal(ask.price),
				size: new Decimal(ask.size)
			}));
			
			return new OrderBook(bids, asks);
		} catch (err) {
			console.error('Orderbook snapshot error:', err);
			throw new Error(`Error getting orderbook: ${err.message}`);
		}
	}

    async validateOrder(userId, marketId, tokenId, outcome, side, orderType, size, price = null) {
        console.log('\n=== OrderManager: validateOrder START ===');
        console.log('Validating order:', { userId, marketId, tokenId, outcome, side, orderType, size, price });
        
        try {
            const marketResult = await this.sql`
                SELECT active, closed, archived 
                FROM markets 
                WHERE id = ${marketId}
            `;
            
            if (!marketResult.length) {
                throw new Error('Market not found');
            }
            
            const market = marketResult[0];
            if (!market.active || market.closed || market.archived) {
                throw new Error('Market is not active');
            }

            if (side === OrderSide.SELL) {
                const holdingsResult = await this.sql`
                    SELECT CAST(amount AS NUMERIC) as amount
                    FROM holdings 
                    WHERE user_id = ${userId} 
                    AND market_id = ${marketId} 
                    AND token_id = ${tokenId}
                    FOR UPDATE
                `;
                
                const currentHoldings = holdingsResult.length ? 
                    new Decimal(holdingsResult[0].amount) : 
                    new Decimal(0);

                if (currentHoldings.lessThan(size)) {
                    throw new Error(`Insufficient holdings. Have: ${currentHoldings}, Need: ${size}`);
                }
            } else {
                const userResult = await this.sql`
                    SELECT CAST(balance AS NUMERIC) as balance 
                    FROM users 
                    WHERE auth0_id = ${userId}
                    FOR UPDATE
                `;
                
                if (!userResult.length) {
                    throw new Error('User not found');
                }
                
                const balance = new Decimal(userResult[0].balance);
                
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

            return true;
        } catch (err) {
            console.error('OrderManager validation error:', err);
            throw err;
        }
    }

    // In OrderManager.js
async executeMarketOrder(userId, marketId, tokenId, outcome, side, size) {
    try {
        await this.sql`BEGIN`;

        // Validate the order
        await this.validateOrder(userId, marketId, tokenId, outcome, side, OrderType.MARKET, size);
        
        // Get orderbook snapshot for execution
        const book = await this.getOrderbookSnapshot(marketId, tokenId);
        
        let remainingSize = new Decimal(size);
        let totalCost = new Decimal(0);
        let filledSize = new Decimal(0);
        
        const levels = side === OrderSide.BUY ? book.asks : book.bids;
        
        // Calculate fills
        for (const level of levels) {
            if (remainingSize.lte(0)) break;
            
            const fillSize = Decimal.min(remainingSize, level.size);
            totalCost = totalCost.plus(fillSize.times(level.price));
            filledSize = filledSize.plus(fillSize);
            remainingSize = remainingSize.minus(fillSize);
        }
        
        if (filledSize.eq(0)) {
            await this.sql`ROLLBACK`;
            throw new Error('Could not fill any quantity');
        }
        
        if (remainingSize.gt(0)) {
            await this.sql`ROLLBACK`;
            throw new Error('Partial fill only - insufficient liquidity');
        }
        
        const avgPrice = totalCost.div(filledSize);
        
        // Check for existing holdings
        const existingHoldings = await this.sql`
            SELECT id, amount::text, entry_price::text
            FROM holdings
            WHERE user_id = ${userId}
            AND market_id = ${marketId}
            AND token_id = ${tokenId}
            FOR UPDATE
        `;

        // Update or create holdings
        if (existingHoldings.length > 0) {
            const current = existingHoldings[0];
            const currentAmount = new Decimal(current.amount);
            const currentPrice = new Decimal(current.entry_price);
            const newAmount = currentAmount.plus(filledSize);
            const newPrice = currentAmount.times(currentPrice)
                .plus(filledSize.times(avgPrice))
                .div(newAmount);

            await this.sql`
                UPDATE holdings
                SET amount = CAST(${newAmount.toString()} AS NUMERIC),
                    entry_price = CAST(${newPrice.toString()} AS NUMERIC)
                WHERE id = ${current.id}
            `;
        } else {
            await this.sql`
                INSERT INTO holdings
                (user_id, market_id, token_id, outcome, position, amount, entry_price)
                VALUES (
                    ${userId},
                    ${marketId},
                    ${tokenId},
                    ${outcome},
                    ${side},
                    CAST(${filledSize.toString()} AS NUMERIC),
                    CAST(${avgPrice.toString()} AS NUMERIC)
                )
            `;
        }
        
        // Update user balance
        await this.sql`
            UPDATE users 
            SET balance = balance - CAST(${totalCost.toString()} AS NUMERIC)
            WHERE auth0_id = ${userId}
        `;
        
        // Insert order record
        const orderResult = await this.sql`
            INSERT INTO orders 
            (user_id, market_id, token_id, outcome, side, size, price, order_type, status)
            VALUES (
                ${userId}, 
                ${marketId}, 
                ${tokenId}, 
                ${outcome}, 
                ${side}, 
                CAST(${filledSize.toString()} AS NUMERIC), 
                CAST(${avgPrice.toString()} AS NUMERIC), 
                ${OrderType.MARKET}, 
                'completed'
            )
            RETURNING id
        `;
        
        await this.sql`COMMIT`;

        // Broadcast immediate execution update
        broadcastToUser(userId, {
            type: 'order_execution',
            needsHoldingsRefresh: true,
            timestamp: new Date().toISOString(),
            orderId: orderResult[0].id,
            orderType: 'market'
        });

        // Small delay to ensure DB commit is complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Broadcast holdings update to refresh UI
        broadcastToUser(userId, {
            type: 'holdings_update',
            timestamp: new Date().toISOString()
        });
        
        return {
            success: true,
            filledSize: filledSize.toNumber(),
            avgPrice: avgPrice.toNumber(),
            remainingSize: remainingSize.toNumber(),
            orderId: orderResult[0].id
        };
        
    } catch (err) {
        await this.sql`ROLLBACK`;
        console.error('Market order execution error:', err);
        throw err;
    }
}


    async submitLimitOrder(userId, marketId, tokenId, outcome, side, size, price) {
        try {
            await this.sql`BEGIN`;
            
            await this.validateOrder(
                userId, marketId, tokenId, outcome, side, OrderType.LIMIT, size, price
            );
            
            const book = await this.getOrderbookSnapshot(marketId, tokenId);
            
            if (side === OrderSide.BUY) {
                if (book.asks.length && new Decimal(price).gte(book.asks[0].price)) {
                    const result = await this.executeMarketOrder(
                        userId, marketId, tokenId, outcome, side, size
                    );
                    await this.sql`COMMIT`;
                    return result;
                }
            } else {
                if (book.bids.length && new Decimal(price).lte(book.bids[0].price)) {
                    const result = await this.executeMarketOrder(
                        userId, marketId, tokenId, outcome, side, size
                    );
                    await this.sql`COMMIT`;
                    return result;
                }
            }
            
            // Insert limit order
            const orderResult = await this.sql`
                INSERT INTO orders 
                (user_id, market_id, token_id, outcome, side, size, price, order_type, status)
                VALUES (
                    ${userId}, 
                    ${marketId}, 
                    ${tokenId}, 
                    ${outcome}, 
                    ${side}, 
                    CAST(${size.toString()} AS NUMERIC), 
                    CAST(${price.toString()} AS NUMERIC), 
                    ${OrderType.LIMIT}, 
                    'active'
                )
                RETURNING id
            `;
            
            // Deduct balance for limit order
            const totalCost = new Decimal(size).times(price);
            await this.sql`
                UPDATE users 
                SET balance = balance - CAST(${totalCost.toString()} AS NUMERIC)
                WHERE auth0_id = ${userId}
            `;
            
            await this.sql`COMMIT`;
            
            return {
                success: true,
                filledSize: 0,
                avgPrice: 0,
                remainingSize: size,
                reason: 'Limit order stored',
                orderId: orderResult[0].id
            };
            
        } catch (err) {
            await this.sql`ROLLBACK`;
            console.error('Limit order submission error:', err);
            throw err;
        }
    }

    async cancelOrder(userId, orderId) {
        try {
            await this.sql`BEGIN`;

            const orderResult = await this.sql`
                SELECT id, size::text, price::text, order_type
                FROM orders 
                WHERE id = ${orderId} 
                AND user_id = ${userId} 
                AND status = 'active'
                FOR UPDATE
            `;

            if (!orderResult.length) {
                await this.sql`ROLLBACK`;
                throw new Error('Order not found or already processed');
            }

            const order = orderResult[0];

            if (order.order_type === OrderType.LIMIT) {
                const refundAmount = new Decimal(order.size).times(order.price);
                await this.sql`
                    UPDATE users 
                    SET balance = balance + CAST(${refundAmount.toString()} AS NUMERIC)
                    WHERE auth0_id = ${userId}
                `;
            }

            await this.sql`
                UPDATE orders 
                SET status = 'cancelled' 
                WHERE id = ${orderId}
            `;

            await this.sql`COMMIT`;

            return {
                success: true,
                message: 'Order cancelled successfully'
            };
        } catch (err) {
            await this.sql`ROLLBACK`;
            console.error('Order cancellation error:', err);
            throw err;
        }
    }
}

module.exports = {
    OrderManager,
    OrderType,
    OrderSide,
    OrderBook
};
