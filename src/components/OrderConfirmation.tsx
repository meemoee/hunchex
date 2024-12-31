import { useEffect, useRef, useState } from 'react'
import { useUser } from '@auth0/nextjs-auth0/client'
import { type TopMover } from '@/types/mover'

// Color interpolation helper
const interpolateColor = (percentage: number): string => {
  const colors = [
    { point: 0, color: '#1B5E20' },   // Deep Green
    { point: 15, color: '#4CAF50' },  // Light Green
    { point: 30, color: '#FFC107' },  // Yellow
    { point: 45, color: '#FF9800' },  // Light Orange
    { point: 60, color: '#F44336' }   // Red
  ];
  
  // Find the two colors to interpolate between
  let startColor = colors[0];
  let endColor = colors[colors.length - 1];
  
  for (let i = 0; i < colors.length - 1; i++) {
    if (percentage >= colors[i].point && percentage <= colors[i + 1].point) {
      startColor = colors[i];
      endColor = colors[i + 1];
      break;
    }
  }
  
  // Calculate interpolation factor
  const range = endColor.point - startColor.point;
  const factor = range === 0 ? 1 : (percentage - startColor.point) / range;
  
  // Convert hex to RGB and interpolate
  const start = {
    r: parseInt(startColor.color.slice(1, 3), 16),
    g: parseInt(startColor.color.slice(3, 5), 16),
    b: parseInt(startColor.color.slice(5, 7), 16)
  };
  
  const end = {
    r: parseInt(endColor.color.slice(1, 3), 16),
    g: parseInt(endColor.color.slice(3, 5), 16),
    b: parseInt(endColor.color.slice(5, 7), 16)
  };
  
  const r = Math.round(start.r + (end.r - start.r) * factor);
  const g = Math.round(start.g + (end.g - start.g) * factor);
  const b = Math.round(start.b + (end.b - start.b) * factor);
  
  return `rgb(${r}, ${g}, ${b})`;
};

type OrderbookData = {
  data: {
    asks: Array<{price: number, size: number, change?: number}>
    bids: Array<{price: number, size: number, change?: number}>
    spread: number | null
    mid: number | null
  }
}

type OrderConfirmationProps = {
  isOpen: boolean
  mover: TopMover | null
  selectedOutcome: string
  amount: string
  price: number
  orderbook: OrderbookData | null
  onClose: () => void
  onAmountChange: (value: string) => void
  onPriceChange: (value: number) => void
  onConfirm: () => void
  onOrderSuccess: () => void
  onRefreshUserData: () => void
  orderStatus: {
    type: 'success' | 'error' | null
    message: string
  }
  balance: number
  setOrderStatus: (status: {
    type: 'success' | 'error' | null
    message: string
  }) => void
}

const formatNumber = (num: number, maxDecimals = 2) => {
  let formatted = num.toFixed(maxDecimals)
  formatted = formatted.replace(/\.?0+$/, '')
  return formatted
}

export function OrderConfirmation({
  isOpen,
  mover,
  selectedOutcome,
  amount,
  price,
  orderbook,
  onClose,
  onAmountChange,
  onPriceChange,
  onConfirm,
  onOrderSuccess,
  onRefreshUserData,
  orderStatus,
  setOrderStatus,
  balance,
}: OrderConfirmationProps) {
  const [orderType, setOrderType] = useState<'market' | 'limit'>('limit')
  const [action, setAction] = useState<'buy' | 'sell'>('buy')
  const [balancePercentage, setBalancePercentage] = useState<number>(1) // 1% default
  const [takeProfitEnabled, setTakeProfitEnabled] = useState(false)
  const [stopLossEnabled, setStopLossEnabled] = useState(false)
  const [takeProfitPrice, setTakeProfitPrice] = useState(0.75) // 75%
  const [stopLossPrice, setStopLossPrice] = useState(0.25) // 25%
  const { user } = useUser()

  const handleSubmitOrder = async () => {
    if (!mover || !amount || !price || !user) return;

    try {
      const res = await fetch('/api/auth/me');
      const session = await res.json();
      const accessToken = session.accessToken;

      const response = await fetch('/api/submit-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          marketId: mover.market_id,
          outcome: selectedOutcome,
          side: action,
          size: Number(amount),
          price: price
        })
      });

      if (!response.ok) {
        const error = await response.json();
        setOrderStatus({
          type: 'error',
          message: error.error || 'Failed to submit order'
        });
        return;
      }

      const result = await response.json();
      setOrderStatus({
        type: 'success',
        message: 'Order submitted successfully'
      });
      onOrderSuccess();
      onRefreshUserData();

    } catch (error) {
      console.error('Error submitting order:', error);
      setOrderStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to submit order'
      });
    }
  }

  // Get effective price considering market order threshold
  const getEffectivePrice = (inputPrice: number): number => {
    if (!orderbook?.data) return inputPrice
    
    if (action === 'buy') {
      const lowestAsk = orderbook.data.asks[0]?.price
      return inputPrice >= lowestAsk ? lowestAsk : inputPrice
    } else {
      const highestBid = orderbook.data.bids[0]?.price
      return inputPrice <= highestBid ? highestBid : inputPrice
    }
  }

  // Determine order type based on price and orderbook
  const updateOrderType = (currentPrice: number) => {
    if (!orderbook?.data) return
    
    if (action === 'buy') {
      // For buy orders: if price >= lowest ask, it's a market order
      const lowestAsk = orderbook.data.asks[0]?.price
      setOrderType(currentPrice >= lowestAsk ? 'market' : 'limit')
    } else {
      // For sell orders: if price <= highest bid, it's a market order
      const highestBid = orderbook.data.bids[0]?.price
      setOrderType(currentPrice <= highestBid ? 'market' : 'limit')
    }
  }

  // Update order type whenever price changes
  useEffect(() => {
    updateOrderType(price)
  }, [price, orderbook, action])

  const orderbookRef = useRef<HTMLDivElement>(null)
  const previousScrollPosition = useRef(0)

  const handlePriceClick = (clickedPrice: number) => {
    onPriceChange(clickedPrice)
  }

  const [lastScrollTop, setLastScrollTop] = useState(0)

  const centerSpread = (): boolean => {
    const container = orderbookRef.current
    if (!container || !orderbook) return false

    const content = container.querySelector('.orderbook-content')
    if (!content) return false

    const asks = content.querySelectorAll('.ask-row')
    const bids = content.querySelectorAll('.bid-row')
    
    if (asks.length === 0 || bids.length === 0) return false

    const lastAsk = asks[asks.length - 1]
    const firstBid = bids[0]
    
    if (!lastAsk || !firstBid) return false

    const lastAskRect = lastAsk.getBoundingClientRect()
    const firstBidRect = firstBid.getBoundingClientRect()
    const spreadPoint = (lastAskRect.bottom + firstBidRect.top) / 2
    const containerRect = container.getBoundingClientRect()
    const relativeSpreadPoint = spreadPoint - containerRect.top
    
    container.scrollTop = relativeSpreadPoint - (containerRect.height / 2)
    setLastScrollTop(container.scrollTop)
    return true
  }

  // Save scroll position when user scrolls
  const handleScroll = () => {
    const container = orderbookRef.current
    if (container) {
      setLastScrollTop(container.scrollTop)
    }
  }

  const [hasInitiallyCentered, setHasInitiallyCentered] = useState(false)

  useEffect(() => {
    if (isOpen && orderbook && !hasInitiallyCentered) {
      // Add a small delay to ensure DOM is ready
      const timer = setTimeout(() => {
        const success = centerSpread()
        if (success) {
          setHasInitiallyCentered(true)
        }
        // Initialize balance percentage and amount
        const initialDollarAmount = (balance * (balancePercentage / 100)).toFixed(2)
        const initialShares = price > 0 ? (Number(initialDollarAmount) / price).toFixed(2) : '0'
        onAmountChange(initialShares)
      }, 100)
      return () => clearTimeout(timer)
    }
  }, [isOpen, orderbook, hasInitiallyCentered, balance, balancePercentage, price, onAmountChange])

  useEffect(() => {
    if (!isOpen) {
      setHasInitiallyCentered(false)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen) {
      previousScrollPosition.current = window.scrollY
      document.body.style.position = 'fixed'
      document.body.style.width = '100%'
      document.body.style.top = `-${previousScrollPosition.current}px`
    } else {
      document.body.style.position = ''
      document.body.style.width = ''
      document.body.style.top = ''
      window.scrollTo(0, previousScrollPosition.current)
    }
  }, [isOpen])

  
  return (
    <>
      {isOpen && mover && (
        <div className="fixed inset-0 bg-black/75 flex items-center justify-center z-[9999]">
      <div className="bg-[#1a1b1e] w-[90%] max-w-[500px] rounded-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start gap-4">
          <img
            src={mover.image}
            alt=""
            className="w-14 h-14 rounded-lg object-cover"
          />
          <div>
            <div className="flex items-center gap-2 mb-2">
              <button
                onClick={() => setAction('buy')}
                className={`px-3 py-1 rounded ${
                  action === 'buy' 
                    ? 'bg-green-600 text-white' 
                    : 'bg-[#2a2b2e] text-gray-400'
                }`}
              >
                Buy
              </button>
              <button
                onClick={() => setAction('sell')}
                className={`px-3 py-1 rounded ${
                  action === 'sell' 
                    ? 'bg-red-600 text-white' 
                    : 'bg-[#2a2b2e] text-gray-400'
                }`}
              >
                Sell
              </button>
            </div>
            <h3 className="font-bold text-xl">
              {selectedOutcome}
            </h3>
            <p className="text-sm text-gray-400">{mover.question}</p>
            <div className="text-xs text-gray-500 mt-1">
            </div>
            {mover.yes_sub_title && (
              <p className="text-sm text-gray-400 mt-1">{mover.yes_sub_title}</p>
            )}
          </div>
        </div>

        <div className="mt-6 mb-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-400">Probability</label>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={takeProfitEnabled}
                    onChange={(e) => setTakeProfitEnabled(e.target.checked)}
                    className="form-checkbox h-4 w-4 text-green-500 rounded"
                  />
                  <span className="text-sm text-gray-400">Take Profit</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={stopLossEnabled}
                    onChange={(e) => setStopLossEnabled(e.target.checked)}
                    className="form-checkbox h-4 w-4 text-red-500 rounded"
                  />
                  <span className="text-sm text-gray-400">Stop Loss</span>
                </label>
              </div>
            </div>
          </div>
          <div className="relative h-2 bg-[#2a2b2e] rounded-lg mt-6">
            {/* Base track */}
            <div 
              className="absolute inset-0"
              onClick={(e) => {
                if (!takeProfitEnabled && !stopLossEnabled) {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                  onPriceChange(x);
                }
              }}
              style={{ cursor: (!takeProfitEnabled && !stopLossEnabled) ? 'pointer' : 'default' }}
            >
              {/* Take profit highlight */}
              {takeProfitEnabled && (
                <div 
                  className="absolute h-full bg-green-500/20"
                  style={{
                    left: `${(price * 100)}%`,
                    right: `${100 - (takeProfitPrice * 100)}%`
                  }}
                />
              )}
              {/* Stop loss highlight */}
              {stopLossEnabled && (
                <div 
                  className="absolute h-full bg-red-500/20"
                  style={{
                    left: `${(stopLossPrice * 100)}%`,
                    right: `${100 - (price * 100)}%`
                  }}
                />
              )}
            </div>
            
            {/* Thumbs */}
            <div 
              className="absolute w-4 h-4 mt-[-4px] bg-white rounded-full cursor-pointer hover:scale-110 transition-transform"
              style={{ left: `calc(${price * 100}% - 8px)` }}
              onMouseDown={(e) => {
                e.preventDefault(); // Prevent text selection
                const slider = e.currentTarget.parentElement;
                if (!slider) return;
                
                const handleMove = (moveEvent: MouseEvent) => {
                  moveEvent.preventDefault();
                  const rect = slider.getBoundingClientRect();
                  const x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                  onPriceChange(x);
                };
                
                const handleUp = () => {
                  window.removeEventListener('mousemove', handleMove);
                  window.removeEventListener('mouseup', handleUp);
                  window.removeEventListener('mouseleave', handleUp);
                };
                
                window.addEventListener('mousemove', handleMove);
                window.addEventListener('mouseup', handleUp);
                window.addEventListener('mouseleave', handleUp);
              }}
            />
            
            {takeProfitEnabled && (
              <div 
                className="absolute w-3 h-3 mt-[-2px] bg-green-500 rounded-full cursor-pointer hover:scale-110 transition-transform"
                style={{ left: `calc(${takeProfitPrice * 100}% - 6px)` }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const slider = e.currentTarget.parentElement;
                  if (!slider) return;
                  
                  const handleMove = (moveEvent: MouseEvent) => {
                    moveEvent.preventDefault();
                    const rect = slider.getBoundingClientRect();
                    const x = Math.max(price, Math.min(1, (moveEvent.clientX - rect.left) / rect.width));
                    setTakeProfitPrice(x);
                  };
                  
                  const handleUp = () => {
                    window.removeEventListener('mousemove', handleMove);
                    window.removeEventListener('mouseup', handleUp);
                    window.removeEventListener('mouseleave', handleUp);
                  };
                  
                  window.addEventListener('mousemove', handleMove);
                  window.addEventListener('mouseup', handleUp);
                  window.addEventListener('mouseleave', handleUp);
                }}
              />
            )}
            
            {stopLossEnabled && (
              <div 
                className="absolute w-3 h-3 mt-[-2px] bg-red-500 rounded-full cursor-pointer hover:scale-110 transition-transform"
                style={{ left: `calc(${stopLossPrice * 100}% - 6px)` }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  const slider = e.currentTarget.parentElement;
                  if (!slider) return;
                  
                  const handleMove = (moveEvent: MouseEvent) => {
                    moveEvent.preventDefault();
                    const rect = slider.getBoundingClientRect();
                    const x = Math.max(0, Math.min(price, (moveEvent.clientX - rect.left) / rect.width));
                    setStopLossPrice(x);
                  };
                  
                  const handleUp = () => {
                    window.removeEventListener('mousemove', handleMove);
                    window.removeEventListener('mouseup', handleUp);
                    window.removeEventListener('mouseleave', handleUp);
                  };
                  
                  window.addEventListener('mousemove', handleMove);
                  window.addEventListener('mouseup', handleUp);
                  window.addEventListener('mouseleave', handleUp);
                }}
              />
            )}
          </div>
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        <div className="mb-4">
          <label className="text-sm text-gray-400 block mb-2">Balance Percentage</label>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={balancePercentage}
            onChange={e => {
              const percentage = Number(e.target.value)
              setBalancePercentage(percentage)
              const dollarAmount = (balance * (percentage / 100)).toFixed(2)
              const shares = price > 0 ? (Number(dollarAmount) / price).toFixed(2) : '0'
              onAmountChange(shares)
            }}
            className="w-full h-2 bg-[#2a2b2e] rounded-lg appearance-none cursor-pointer"
          />
          <div className="flex justify-between text-xs text-gray-400 mt-1">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
          <div className="text-sm mt-2 text-center" style={{ color: interpolateColor(balancePercentage) }}>
            Using {balancePercentage}% of balance (${(balance * (balancePercentage / 100)).toFixed(2)})
            <div className="text-gray-400">
              Potential profit: ${action === 'buy' 
                ? (Number(amount) * (1 - getEffectivePrice(price))).toFixed(2)  // Buy profit
                : (Number(amount) * getEffectivePrice(price)).toFixed(2)        // Sell profit
              }
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-sm text-gray-400">Shares</label>
            <input
              type="number"
              value={amount}
              onChange={e => onAmountChange(e.target.value)}
              className="w-full p-2 bg-[#2a2b2e] rounded mt-1 text-center"
              min="0"
            />
          </div>
          <div>
            <label className="text-sm text-gray-400">Price (%)</label>
            <input
              type="number"
              value={(price * 100).toFixed(1)}
              onChange={e => onPriceChange(Number(e.target.value) / 100)}
              className="w-full p-2 bg-[#2a2b2e] rounded mt-1 text-center"
              min="0"
              max="100"
              step="0.1"
            />
          </div>
        </div>

        <div className="text-center my-4">
          <div className="text-xl font-bold">
            Total: ${(Number(amount) * price).toFixed(2)}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {orderType.toUpperCase()} ORDER
          </div>
          <div className="text-sm text-gray-400 mt-2">
            Available Balance: ${typeof balance === 'number' ? balance.toFixed(2) : '0.00'}
          </div>
        </div>

        {orderbook && (
          <div className="mt-4">
            <div className="flex justify-center space-x-8 mb-4">
              <div className="text-center">
                <span className="text-xs text-gray-400 block">spread</span>
                <span className="text-sm">
                  {orderbook.data.spread !== null ? 
                    formatNumber(orderbook.data.spread * 100, 3) + '%' : 
                    '-'}
                </span>
              </div>
              <div className="text-center">
                <span className="text-xs text-gray-400 block">mid</span>
                <span className="text-sm">
                  {orderbook.data.mid !== null ? 
                    formatNumber(orderbook.data.mid * 100, 3) + '%' : 
                    '-'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 text-center text-xs text-gray-400 mb-2">
              <div>Size</div>
              <div>Price</div>
              <div>Size</div>
            </div>

            <div 
              className="max-h-[350px] overflow-y-auto" 
              ref={orderbookRef}
              onScroll={handleScroll}
            >
              <div className="orderbook-content">
                {orderbook.data.asks.slice().reverse().map((ask, i) => (
                  <button
                    key={`ask-${i}`}
                    className="orderbook-row ask-row grid grid-cols-3 text-center py-1 w-full hover:bg-white/5 text-red-500"
                    onClick={() => handlePriceClick(ask.price)}
                  >
                    <div></div>
                    <div>{formatNumber(ask.price * 100, 1)}%</div>
                    <div className="flex items-center justify-start gap-1">
                      <span>{formatNumber(ask.size)}</span>
                      {ask.change && (
                        <span className="text-[10px] text-gray-400">
                          {ask.change > 0 ? '↑' : '↓'}
                          {formatNumber(Math.abs(ask.change), 1)}
                        </span>
                      )}
                    </div>
                  </button>
                ))}

                {orderbook.data.bids.map((bid, i) => (
                  <button
                    key={`bid-${i}`}
                    className="orderbook-row bid-row grid grid-cols-3 text-center py-1 w-full hover:bg-white/5 text-green-500"
                    onClick={() => handlePriceClick(bid.price)}
                  >
                    <div className="flex items-center justify-end gap-1">
                      {bid.change && (
                        <span className="text-[10px] text-gray-400">
                          {bid.change > 0 ? '↑' : '↓'}
                          {formatNumber(Math.abs(bid.change), 1)}
                        </span>
                      )}
                      <span>{formatNumber(bid.size)}</span>
                    </div>
                    <div>{formatNumber(bid.price * 100, 1)}%</div>
                    <div></div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-4 mt-6">
          <button
            onClick={handleSubmitOrder}
            className="flex-1 bg-green-600 text-white p-3 rounded font-bold hover:bg-green-700 transition-colors"
          >
            Confirm
          </button>
          <button
            onClick={onClose}
            className="flex-1 bg-red-600 text-white p-3 rounded font-bold hover:bg-red-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
        </div>
      )}
    </>
  )
}
