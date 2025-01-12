const { ClobClient } = require("@polymarket/clob-client");

class PolyOrderbook {
  constructor() {
    this.client = new ClobClient("https://clob.polymarket.com");
  }

  async getOrderbookSnapshot(tokenId, isYes = true) {
    try {
      const book = await this.client.getOrderBook(tokenId);
      
      // Only transform prices if we're looking at the NO side
      const transformPrice = (price) => 
        isYes ? parseFloat(price) : 1 - parseFloat(price);

      return {
        asks: book.asks.map(ask => ({
          price: transformPrice(ask.price),
          size: parseFloat(ask.size)
        })),
        bids: book.bids.map(bid => ({
          price: transformPrice(bid.price),
          size: parseFloat(bid.size)
        })).sort((a, b) => b.price - a.price),
        timestamp: book.timestamp,
        market: book.market,
        asset_id: book.asset_id,
        isYes: isYes  // Add flag to indicate which side this is
      };
    } catch (error) {
      throw new Error(`Polymarket orderbook error: ${error.message}`);
    }
  }
}

module.exports = PolyOrderbook;