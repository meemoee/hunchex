import { useState, useEffect, useRef, useCallback } from 'react'
import QATree from './QATree'
import { Decimal } from 'decimal.js'
import { ChevronDown, TrendingUp, TrendingDown, Loader2 } from 'lucide-react'
import PriceChart from './PriceChart'
import { OrderConfirmation } from './OrderConfirmation'
import { formatPrice, formatVolumeChange } from '@/lib/utils'

interface PriceHistoryItem {
  t: string;
  y: number;
}

interface TickerData extends TopMover {
  price_change_percent: number;
}

interface TopMover {
  market_id: string
  question: string
  yes_sub_title?: string
  image: string
  url: string
  final_last_traded_price: number
  price_change: number
  final_best_ask: number
  final_best_bid: number
  volume: number
  volume_change: number
  volume_change_percentage: number
  description?: string
  outcomes?: string[] | string
  clobtokenids?: string[]
}

interface TimeInterval {
  label: string
  value: string
}

interface TopMoversListProps {
  topMovers: TopMover[]
  error: string | null
  timeIntervals: TimeInterval[]
  selectedInterval: string
  onIntervalChange: (interval: string) => void
  onLoadMore: () => void
  hasMore: boolean
  openMarketsOnly: boolean
  onOpenMarketsChange: (value: boolean) => void
  isLoading?: boolean
  isLoadingMore?: boolean
  onOrderSuccess?: () => void
  onRefreshUserData?: () => void
  balance: number
}

interface PriceHistory {
  time: string
  price: number
}

interface SearchState {
  query: string
  results: TopMover[]
  page: number
  hasMore: boolean
  isLoading: boolean
}

type OrderbookData = {
  data: {
    asks: Array<{price: number, size: number, change?: number}>
    bids: Array<{price: number, size: number, change?: number}>
    spread: number | null
    mid: number | null
  }
}

const openUrl = (url: string): void => {
  window.open(url, '_blank')
}

const getVolumeColor = (percentage: number): string => {
  const maxPercentage = 100
  const normalizedPercentage = Math.min(Math.abs(percentage), maxPercentage) / maxPercentage
  const startColor = [156, 163, 175] 
  const endColor = [255, 255, 0]

  const r = Math.round(startColor[0] + (endColor[0] - startColor[0]) * normalizedPercentage)
  const g = Math.round(startColor[1] + (endColor[1] - startColor[1]) * normalizedPercentage)
  const b = Math.round(startColor[2] + (endColor[2] - startColor[2]) * normalizedPercentage)

  return `rgb(${r}, ${g}, ${b})`
}

async function fetchPriceHistory(marketId: string, interval: string = '1d'): Promise<PriceHistory[]> {
  const response = await fetch(`http://localhost:3001/api/price_history?marketId=${marketId}&interval=${interval}`)
  if (!response.ok) {
    throw new Error('Failed to fetch price history')
  }
  const data = await response.json()
  
  return data
    .filter((item: PriceHistoryItem) => item.t && item.y)
    .map((item: PriceHistoryItem) => ({
      time: Math.floor(new Date(item.t).getTime() / 1000),
      price: item.y * 100
    }))
    .sort((a, b) => a.time - b.time)
}

// Mobile-friendly styles
const priceInfoStyles = {
  wrapper: "flex flex-row w-full items-center justify-end gap-4 px-2",
  profileActions: "flex items-center justify-start w-auto mt-0 ml-0",
  priceVolume: "flex items-center justify-end ml-0 md:ml-4",
  priceInfo: "flex flex-col items-end min-w-[100px]",
  actionGroup: "grid grid-cols-[80px_16px_80px] items-center justify-start"
}

const TopMoversList: React.FC<TopMoversListProps> = ({
  timeIntervals,
  selectedInterval,
  onIntervalChange,
  topMovers,
  error,
  onLoadMore,
  hasMore,
  openMarketsOnly,
  onOpenMarketsChange,
  isLoading: propIsLoading,
  isLoadingMore,
  onOrderSuccess,
  onRefreshUserData,
  balance
}) => {
  const [isTimeIntervalDropdownOpen, setIsTimeIntervalDropdownOpen] = useState(false)
  const [expandedMovers, setExpandedMovers] = useState<Record<string, boolean>>({})
  const [priceHistories, setPriceHistories] = useState<Record<string, PriceHistory[]>>({})
  const [loadingHistories, setLoadingHistories] = useState<Record<string, boolean>>({})
  const [chartIntervals, setChartIntervals] = useState<Record<string, string>>({})
  const [hoverTimeout, setHoverTimeout] = useState<NodeJS.Timeout | null>(null)
  const [orderStatus, setOrderStatus] = useState<{
    type: 'success' | 'error' | null;
    message: string;
  }>({ type: null, message: '' })
  const [preloadedData, setPreloadedData] = useState<Record<string, PriceHistory[]>>({})
  const wsRef = useRef<WebSocket | null>(null)
  const [search, setSearch] = useState<SearchState>({
    query: '',
    results: [],
    page: 1,
    hasMore: true,
    isLoading: false
  })
  const [orderConfirmation, setOrderConfirmation] = useState<{
    isOpen: boolean;
    mover: TopMover | null;
    action: string;
    amount: string;
    price: number;
    orderbook: OrderbookData | null;
  }>({
    isOpen: false,
    mover: null,
    action: '',
    amount: '',
    price: 0,
    orderbook: null
  })

  const handleBuySell = async (action: string, mover: TopMover) => {
	  console.log('==== HANDLE BUY/SELL DEBUG START ====');
	  
	  // Parse outcomes consistently
	  const outcomes = Array.isArray(mover.outcomes) ? 
		mover.outcomes : 
		JSON.parse(mover.outcomes.replace(/'/g, '"'));

	  // Determine the action and side based on outcomes
	  const firstOutcome = outcomes[0];
	  const isFirstOutcome = action.toUpperCase() === firstOutcome.toUpperCase();
	  
	  console.log('Outcome Determination:', {
		outcomes,
		firstOutcome,
		action,
		isFirstOutcome
	  });

	  // Determine the WebSocket side to send
	  const side = isFirstOutcome ? 'YES' : 'NO';
	  
	  if (wsRef.current) {
		wsRef.current.close()
		wsRef.current = null
	  }

	  setOrderConfirmation({
		isOpen: true,
		mover,
		selectedOutcome: action,
		action: isFirstOutcome ? 'buy' : 'sell',
		amount: '',
		price: isFirstOutcome ? 
		  mover.final_best_ask : 
		  1 - mover.final_best_bid,
		orderbook: null
	  })

	  wsRef.current = new WebSocket('ws://localhost:3001/ws')

	  await new Promise<void>((resolve) => {
		if (!wsRef.current) return
		
		wsRef.current.onmessage = (event) => {
		  const data = JSON.parse(event.data)
		  console.log('WebSocket Message Received:', {
			type: data.type,
			marketId: data.marketId
		  });

		  if (data.type === 'client_id') {
			resolve()
		  } else if (data.type === 'orderbook_update' && mover.market_id === data.marketId) {
			console.log('Orderbook Update Received:', {
			  marketId: data.marketId,
			  orderbookData: data
			});
			setOrderConfirmation(prev => ({...prev, orderbook: data}))
		  }
		}
	  })

	  if (wsRef.current?.readyState === WebSocket.OPEN) {
		console.log('Sending WebSocket Subscription:', {
		  marketId: mover.market_id,
		  side
		});
		
		wsRef.current.send(JSON.stringify({
		  type: 'subscribe_orderbook',
		  marketId: mover.market_id,
		  side
		}))
	  }

	  console.log('==== HANDLE BUY/SELL DEBUG END ====');
	}

  const handleModalClose = useCallback(async (shouldSubmitOrder = false) => {
	  console.log('TopMoversList: handleModalClose called', { shouldSubmitOrder });
	  
	  // Close WebSocket connection if open
	  if (wsRef.current?.readyState === WebSocket.OPEN) {
		wsRef.current.send(JSON.stringify({ type: 'unsubscribe_orderbook' }));
		wsRef.current.close();
	  }
	  wsRef.current = null;

	  // Only proceed with order submission if explicitly requested
	  if (shouldSubmitOrder && orderConfirmation.mover && orderConfirmation.orderbook) {
		try {
		  // Parse outcomes consistently
		  const outcomes = Array.isArray(orderConfirmation.mover.outcomes) ? 
			orderConfirmation.mover.outcomes : 
			JSON.parse(orderConfirmation.mover.outcomes.replace(/'/g, '"'));

		  // Parse token IDs consistently
		  const tokenIds = Array.isArray(orderConfirmation.mover.clobtokenids) ?
			orderConfirmation.mover.clobtokenids :
			JSON.parse(orderConfirmation.mover.clobtokenids);

		  // Map the action to the corresponding outcome
		  const outcomeIndex = orderConfirmation.action === 'buy' ? 0 : 1;
		  const outcome = outcomes[outcomeIndex];
		  const tokenId = tokenIds[outcomeIndex];

		  if (!outcome || !tokenId) {
			throw new Error(`No matching outcome or token ID found for action: ${orderConfirmation.action}`);
		  }

		  // Convert numeric values to Decimal
		  const decimalPrice = new Decimal(orderConfirmation.price);
		  const decimalAmount = new Decimal(orderConfirmation.amount);

		  console.log('Submitting order with:', {
			marketId: orderConfirmation.mover.market_id,
			tokenId,
			outcome,
			side: orderConfirmation.action,
			size: decimalAmount.toString(),
			price: decimalPrice.toString()
		  });

		  const response = await fetch('http://localhost:3001/api/submit-order', {
			method: 'POST',
			headers: {
			  'Content-Type': 'application/json',
			  'Authorization': `Bearer ${localStorage.getItem('token')}`
			},
			body: JSON.stringify({
			  marketId: orderConfirmation.mover.market_id,
			  tokenId,
			  outcome,
			  side: orderConfirmation.action,
			  size: decimalAmount.toString(),
			  price: decimalPrice.toString()
			})
		  });

		  if (!response.ok) {
			const errorData = await response.json();
			throw new Error(errorData.error || 'Failed to submit order');
		  }

		  const result = await response.json();
		  console.log('Order submission result:', result);

		  setOrderStatus({
			type: 'success',
			message: 'Order submitted successfully!'
		  });
		  
		  onOrderSuccess?.();
		  onRefreshUserData?.();
		  
		} catch (error) {
		  console.error('Order submission error:', error);
		  setOrderStatus({
			type: 'error',
			message: error instanceof Error ? error.message : 'Failed to submit order'
		  });
		}
	  }

	  // Always close the order confirmation window
	  setOrderConfirmation(prev => ({...prev, isOpen: false}));
	}, [orderConfirmation, onOrderSuccess, onRefreshUserData]);

  const searchUniqueTickers = async (loadMore = false) => {
    if (search.query.length < 3 && !loadMore) {
      setSearch(prev => ({...prev, results: [], hasMore: false}))
      return
    }

    setSearch(prev => ({...prev, isLoading: true}))

    try {
      const response = await fetch(
        `http://localhost:3001/api/unique_tickers?interval=${selectedInterval}&search=${encodeURIComponent(search.query)}&page=${loadMore ? search.page + 1 : 1}&pageSize=10&openOnly=${openMarketsOnly}`
      )

      const data = await response.json()
      
      const processedTickers = data.tickers.map((ticker: TickerData) => ({
        ...ticker,
        price_change_percent: parseFloat(ticker.price_change_percent),
        volume: ticker.volume || 0,
        volume_change: ticker.volume_change || 0,
        volume_change_percentage: ticker.volume_change_percentage || 0
      }))

      setSearch(prev => ({
        ...prev,
        results: loadMore ? [...prev.results, ...processedTickers] : processedTickers,
        page: loadMore ? prev.page + 1 : 1,
        hasMore: data.hasMore,
        isLoading: false
      }))
    } catch (error) {
      console.error('Search error:', error)
      setSearch(prev => ({...prev, isLoading: false}))
    }
  }

  const preloadChartData = useCallback(async (marketId: string) => {
    if (!priceHistories[marketId] && !preloadedData[marketId]) {
      try {
        const data = await fetchPriceHistory(marketId)
        setPreloadedData(prev => ({ ...prev, [marketId]: data }))
      } catch (error) {
        console.error('Error preloading chart data:', error)
      }
    }
  }, [priceHistories, preloadedData])

  const handleMoverHover = useCallback((marketId: string) => {
    const timeout = setTimeout(() => {
      preloadChartData(marketId)
    }, 150)
    setHoverTimeout(timeout)
  }, [preloadChartData])

  const handleMoverHoverEnd = useCallback(() => {
    if (hoverTimeout) {
      clearTimeout(hoverTimeout)
      setHoverTimeout(null)
    }
  }, [hoverTimeout])

  const handleChartIntervalChange = async (marketId: string, interval: string) => {
    setChartIntervals(prev => ({ ...prev, [marketId]: interval }))
    setLoadingHistories(prev => ({ ...prev, [marketId]: true }))
    try {
      const data = await fetchPriceHistory(marketId, interval)
      setPriceHistories(prev => ({ ...prev, [marketId]: data }))
    } catch (error) {
      console.error(error)
    } finally {
      setLoadingHistories(prev => ({ ...prev, [marketId]: false }))
    }
  }

  const toggleMoverDetails = async (marketId: string) => {
    setExpandedMovers(prev => {
      const newState = { ...prev, [marketId]: !prev[marketId] }
      
      if (newState[marketId]) {
        if (preloadedData[marketId]) {
          setPriceHistories(prev => ({ ...prev, [marketId]: preloadedData[marketId] }))
          setPreloadedData(prev => {
            const { [marketId]: removed, ...rest } = prev
            return rest
          })
        } else if (!priceHistories[marketId]) {
          setLoadingHistories(prev => ({ ...prev, [marketId]: true }))
          fetchPriceHistory(marketId)
            .then(data => setPriceHistories(prev => ({ ...prev, [marketId]: data })))
            .catch(console.error)
            .finally(() => setLoadingHistories(prev => ({ ...prev, [marketId]: false })))
        }
      }
      
      return newState
    })
  }

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [])

  const displayedMovers = search.query.length >= 3 ? search.results : topMovers
  
  console.log('Displaying movers:', {
  searchQuery: search.query,
  searchResultsCount: search.results.length,
  topMoversCount: topMovers.length,
  displayedMoversCount: displayedMovers.length
});

  return (
    <div className="space-y-6 pb-4 max-w-[1200px] mx-auto relative">
      {(propIsLoading || search.isLoading) && (
        <div className="absolute top-32 inset-x-0 bottom-0 flex justify-center bg-black/50 backdrop-blur-sm z-50 rounded-lg">
          <Loader2 className="w-8 h-8 animate-spin mt-8" />
        </div>
      )}
      <div className="sticky top-14 bg-[#1a1b1e] px-4 py-4 z-40 border-b border-l border-r border-white/10 rounded-b-lg mb-6">
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center space-x-2">
            <span className="text-2xl font-bold">What's happened in the last</span>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setIsTimeIntervalDropdownOpen(!isTimeIntervalDropdownOpen)
                }}
                className="flex items-center space-x-2 text-2xl font-bold hover:text-white/80 transition-colors"
              >
                <span>{timeIntervals.find(i => i.value === selectedInterval)?.label}</span>
                <ChevronDown className="w-5 h-5" />
              </button>

              {isTimeIntervalDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 py-2 bg-[#1a1b1e]/80 rounded-xl shadow-2xl border border-white/10 w-40 animate-in slide-in-from-top-2 duration-300 ease-out backdrop-blur-2xl z-50">
                  {timeIntervals.map((interval, index) => (
                    <button
                      key={interval.value}
                      className={`w-full px-3 py-2 text-left hover:bg-white/10 transition-colors flex items-center justify-between group ${
                        selectedInterval === interval.value ? 'bg-white/5 text-white' : 'text-gray-300'
                      }`}
                      onClick={async (e) => {
                        e.stopPropagation()
                        setIsTimeIntervalDropdownOpen(false)
                        await onIntervalChange(interval.value)
                      }}
                    >
                      <span className={`font-medium ${selectedInterval === interval.value ? 'text-white' : ''}`}>
                        {interval.label}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={openMarketsOnly}
              onChange={e => onOpenMarketsChange(e.target.checked)}
              className="rounded border-gray-600 bg-transparent"
            />
            <span>Open Markets Only</span>
          </label>
        </div>

        <input
          type="text"
          placeholder="Search markets..."
          value={search.query}
          onChange={(e) => {
            const newQuery = e.target.value
            setSearch(prev => ({...prev, query: newQuery}))
            if (newQuery.length >= 3) {
              searchUniqueTickers()
            }
          }}
          className="w-full px-4 py-1.5 bg-[#1a1b1e] border border-white/10 rounded-lg"
        />
      </div>


      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 text-red-500">
          {error}
        </div>
      )}

      <div className="bg-[#1a1b1e] border border-white/10 rounded-lg overflow-hidden">
        {displayedMovers.map((mover, index) => (
          <div
            key={mover.market_id}
            className={`p-2 pl-4 pt-4 pb-4 ${index !== 0 ? 'border-t border-white/10' : ''}`}
            onMouseEnter={() => handleMoverHover(mover.market_id)}
            onMouseLeave={handleMoverHoverEnd}
          >
            <div className="flex flex-col space-y-4">
              <div className="flex items-center justify-between -mt-0.5">
                <div className="flex items-center justify-between w-full">
                  <div 
                    className="cursor-pointer flex items-center max-w-[75%] md:max-w-none"
                    onClick={() => toggleMoverDetails(mover.market_id)}
                  >
                    <img
                      src={mover.image}
                      alt=""
                      className="w-12 h-12 rounded-lg object-cover flex-shrink-0 mr-4 mt-2"
                    />
                    <div className="flex flex-col min-w-0 min-h-[48px] pt-3">
                      <h3 
                        className="font-bold text-base leading-normal max-h-[52px]"
                        style={{ 
                          wordBreak: 'break-word',
                          display: '-webkit-box',
                          WebkitLineClamp: '2',
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden'
                        }}
                      >
                        {mover.question}
                      </h3>
                      {mover.yes_sub_title && (
                        <p 
                          className="text-sm text-gray-400 mt-1"
                          style={{ wordBreak: 'break-word' }}
                        >
                          {mover.yes_sub_title}
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                  <div className={priceInfoStyles.wrapper}>
                    <div className={priceInfoStyles.profileActions}>
                      <div className={priceInfoStyles.actionGroup}>
                      {mover.outcomes ? (
                        Array.isArray(mover.outcomes) ? (
                          mover.outcomes.map((outcome, i) => (
                            <>
                              <button
                                key={outcome}
                                className={`${i === 0 ? 'action-buy text-green-600' : 'action-sell text-red-600'} flex flex-col items-center p-1 pt-3 font-bold w-full overflow-hidden`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleBuySell(outcome, mover)
                                }}
                              >
                                <span
                                  className="outcome-text w-full text-center leading-tight whitespace-nowrap overflow-hidden px-1"
                                  style={{ 
                                    fontSize: '0.85rem',
                                    maskImage: 'linear-gradient(to right, black 80%, transparent 100%)',
                                    WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)'
                                  }}
                                >
                                  {outcome}
                                </span>
                                <span className="text-gray-400 text-sm mt-0.5">
									{i === 0 ? 
									   (mover.market_id.includes('-') ?
										  formatPrice(mover.final_best_bid) :      // Kalshi Yes - use bid
										  formatPrice(mover.final_best_ask)) :     // Polymarket Yes - use ask
									   (mover.market_id.includes('-') ?
										  formatPrice(mover.final_best_ask) :      // Kalshi No - use ask
										  formatPrice(1 - mover.final_best_bid))   // Polymarket No - use 1-bid
									}
								</span>
                              </button>
                              {i === 0 && mover.outcomes && (Array.isArray(mover.outcomes) ? mover.outcomes.length > 1 : JSON.parse(mover.outcomes.replace(/'/g, '"')).length > 1) && (
                                <div className="action-separator text-gray-600 flex items-center justify-center h-full">
                                  |
                                </div>
                              )}
                            </>
                          ))
                        ) : (
                          JSON.parse(mover.outcomes.replace(/&apos;/g, '"')).map((outcome: string, i: number) => (
                            <>
                              <button
                                key={outcome}
                                className={`${i === 0 ? 'action-buy text-green-600' : 'action-sell text-red-600'} flex flex-col items-center p-1 font-bold w-full overflow-hidden`}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleBuySell(outcome.toUpperCase(), mover)
                                }}
                              >
                                <span
                                  className="outcome-text w-full text-center leading-tight whitespace-nowrap overflow-hidden text-ellipsis px-1"
                                  style={{ fontSize: '0.85rem' }}
                                >
                                  {outcome}
                                </span>
                                <span className="text-gray-400 text-sm mt-0.5">
                                  {i === 0 ? 
                                    formatPrice(mover.final_best_ask) :
                                    formatPrice(1 - mover.final_best_bid)
                                  }
                                </span>
                              </button>
                              {i === 0 && JSON.parse(mover.outcomes.replace(/&apos;/g, '"')).length > 1 && (
                                <div className="action-separator text-gray-600 flex items-center justify-center h-full">
                                  |
                                </div>
                              )}
                            </>
                          ))
                        )
                      ) : (
                        <>
                          <button
                            className="action-buy flex flex-col items-center p-1 pt-3 text-green-600 font-bold w-full overflow-hidden"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleBuySell('YES', mover)
                            }}
                          >
                            <span
                              className="outcome-text w-full text-center leading-tight whitespace-nowrap overflow-hidden px-1"
                              style={{ 
                                fontSize: '0.85rem',
                                maskImage: 'linear-gradient(to right, black 80%, transparent 100%)',
                                WebkitMaskImage: 'linear-gradient(to right, black 80%, transparent 100%)'
                              }}
                            >
                              YES
                            </span>
                            <span className="text-gray-400 text-sm mt-0.5">
                              {formatPrice(mover.final_best_ask)}
                            </span>
                          </button>
                          <div className="action-separator text-gray-600 flex items-center justify-center h-full">
                            |
                          </div>
                          <button
                            className="action-sell flex flex-col items-center p-1 pt-3 text-red-600 font-bold w-full overflow-hidden"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleBuySell('No', mover)
                            }}
                          >
                            <span
                              className="outcome-text w-full text-center leading-tight whitespace-nowrap overflow-hidden text-ellipsis px-1"
                              style={{ fontSize: '0.85rem' }}
                            >
                              NO
                            </span>
                            <span className="text-gray-400 text-sm mt-0.5">
                              {formatPrice(1 - mover.final_best_bid)}
                            </span>
                          </button>
                        </>
                      )}
                    </div>

                    <div className={priceInfoStyles.priceInfo + " mt-2"}>
                      <span className="text-xs text-gray-400 mt-1">
                        {mover.outcomes ? 
                          (Array.isArray(mover.outcomes) ? mover.outcomes[0] : 
                          JSON.parse(mover.outcomes.replace(/&apos;/g, '"'))[0]) : 
                          'YES'
                        }
                      </span>
                      <div className="text-3xl font-bold">
                        {formatPrice(mover.final_last_traded_price)}
                      </div>
                      <div className="flex items-center">
                        {mover.price_change >= 0 ? (
                          <>
                            <TrendingUp className="w-4 h-4 text-green-500 mr-1" />
                            <span className="text-green-500 text-[15px]">
                              {formatPrice(mover.price_change)}
                            </span>
                          </>
                        ) : (
                          <>
                            <TrendingDown className="w-4 h-4 text-red-500 mr-1" />
                            <span className="text-red-500 text-[15px]">
                              {formatPrice(Math.abs(mover.price_change))}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <button
                      className="market-logo-button ml-6 mr-3 mt-11"
                      onClick={(e) => {
                        e.stopPropagation()
                        openUrl(mover.url)
                      }}
                    >
                      {mover.url.includes('polymarket') ? (
                        <img src="/images/PolymarketLogo.png" alt="Polymarket" width="22" height="22" />
                      ) : mover.url.includes('kalshi') ? (
                        <img src="/images/KalshiLogo.png" alt="Kalshi" width="22" height="22" />
                      ) : (
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="text-gray-400"
                        >
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                          <polyline points="15 3 21 3 21 9"></polyline>
                          <line x1="10" y1="14" x2="21" y2="3"></line>
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative h-[2px] w-full">
                <div 
                  className="absolute bg-white/50 h-1 top-[-2px]" 
                  style={{ width: `${Math.abs(Number(mover.final_last_traded_price) * 100)}%` }}
                />
                {Number(mover.price_change) > 0 ? (
                  <>
                    <div 
                      className="absolute bg-green-900/90 h-1 top-[-2px]" 
                      style={{ 
                        width: `${Math.abs(Number(mover.price_change) * 100)}%`,
                        right: `${100 - Math.abs(Number(mover.final_last_traded_price) * 100)}%`
                      }}
                    />
                    <div 
                      className="absolute h-2 w-0.5 bg-gray-400 top-[-4px]"
                      style={{ 
                        right: `${100 - Math.abs(Number(mover.final_last_traded_price) * 100)}%`
                      }}
                    />
                  </>
                ) : (
                  <>
                    <div 
                      className="absolute bg-red-500/50 h-1 top-[-2px]" 
                      style={{ 
                        width: `${Math.abs(Number(mover.price_change) * 100)}%`,
                        left: `${Math.abs(Number(mover.final_last_traded_price) * 100)}%`
                      }}
                    />
                    <div 
                      className="absolute h-2 w-0.5 bg-gray-400 top-[-4px]"
                      style={{ 
                        left: `${Math.abs(Number(mover.final_last_traded_price) * 100)}%`
                      }}
                    />
                  </>
                )}
              </div>

              <div className="flex items-center justify-start mt-2 mb-4">
                <span 
                  className="text-[11px] font-bold whitespace-nowrap leading-none"
                  style={{ color: getVolumeColor(mover.volume_change_percentage || 0) }}
                >
                  {formatVolumeChange(mover.volume_change, mover.volume)}
                </span>
              </div>

              {expandedMovers[mover.market_id] && (
                <div className="mt-4 pt-4 border-t border-white/10 animate-in slide-in-from-top-4 duration-500 ease-in-out space-y-4">
                  <div>
                    <div>
                      <div className="relative h-[400px]">
                        {loadingHistories[mover.market_id] && (
                          <div className="absolute inset-0 flex items-center justify-center bg-[#1a1b1e]/50 backdrop-blur-sm z-10">
                            <Loader2 className="w-6 h-6 animate-spin" />
                          </div>
                        )}
                        {priceHistories[mover.market_id] ? (
                          <PriceChart 
                            data={priceHistories[mover.market_id]}
                            selectedInterval={chartIntervals[mover.market_id] || '1d'}
                            onIntervalSelect={(interval) => handleChartIntervalChange(mover.market_id, interval)}
                          />
                        ) : (
                          <div className="h-full flex items-center justify-center">
                            <p className="text-center text-gray-400">No price history available</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <QATree marketId={mover.market_id} />
                  
                  {mover.description && (
                    <p className="text-sm text-gray-400 mt-4">{mover.description}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {((search.query.length >= 3 && search.hasMore) || (!search.query && hasMore)) && (
        <button
          onClick={() => search.query.length >= 3 ? searchUniqueTickers(true) : onLoadMore()}
          disabled={isLoadingMore}
          className={`w-full py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors flex items-center justify-center gap-2 ${
            isLoadingMore ? 'opacity-50 cursor-not-allowed' : ''
          }`}
        >
          {isLoadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
          {isLoadingMore ? 'Loading...' : 'Load More'}
        </button>
      )}

      <OrderConfirmation 
        isOpen={orderConfirmation.isOpen}
        mover={orderConfirmation.mover}
        selectedOutcome={orderConfirmation.selectedOutcome}
        action={orderConfirmation.action}
        amount={orderConfirmation.amount}
        price={orderConfirmation.price}
        orderbook={orderConfirmation.orderbook}
        onClose={handleModalClose}
        onAmountChange={(amount) => setOrderConfirmation(prev => ({...prev, amount}))}
        onPriceChange={(price) => setOrderConfirmation(prev => ({...prev, price}))}
        onConfirm={() => handleModalClose(true)}
        onOrderSuccess={() => onOrderSuccess?.()}
        onRefreshUserData={() => onRefreshUserData?.()}
        orderStatus={orderStatus}
        setOrderStatus={setOrderStatus}
        balance={balance}
      />
    </div>
  )
}

export default TopMoversList
