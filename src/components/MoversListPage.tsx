'use client'

import { useState, useEffect, useCallback } from 'react'
import { useWebSocket, WSUpdateData } from '@/lib/websocket'
import Link from 'next/link'
import Image from 'next/image'
import '@/styles/gradientAnimation.css'
import { Bell, Menu, ChevronLeft } from 'lucide-react'
import { type TopMover } from '@/types/mover'
import dynamic from 'next/dynamic'
import { useUser } from "@auth0/nextjs-auth0/client"

const GradientLogo = dynamic(() => import('./GradientLogo'), { ssr: false })
const TopMoversList = dynamic(() => import('./TopMoversList'), { ssr: false })
const RightSidebar = dynamic(() => import('./RightSidebar'), { ssr: false })

type UserProfile = {
  holdings: {
    id: string
    user_id: string
    market_id: string
    token_id: string
    position: string
    outcome?: string  // Make optional
    amount: string
    entry_price?: string  // Make optional
    current_price?: string
    created_at: string
    question?: string
    image?: string
  }[]
  activeOrders: {
	  id: number
	  market_id: string
	  token_id: string
	  outcome: string
	  side: string
	  size: string
	  limit_price: number
	  order_type: string
	  status: string
	  created_at: string
	  question: string
	  image?: string  // Add this line, make it optional with ?
	}[]
}

const TIME_INTERVALS = [
  { label: '5 minutes', value: '5' },
  { label: '10 minutes', value: '10' },
  { label: '30 minutes', value: '30' },
  { label: 'hour', value: '60' },
  { label: '4 hours', value: '240' },
  { label: '8 hours', value: '480' },
  { label: 'day', value: '1440' },
  { label: 'week', value: '10080' }
] as const

export default function MoversListPage() {
  const { user, error: authError, isLoading: isAuthLoading } = useUser()
  const [topMovers, setTopMovers] = useState<TopMover[]>([])
  const [error, setError] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [selectedInterval, setSelectedInterval] = useState('240')
  const [openMarketsOnly, setOpenMarketsOnly] = useState(false)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [holdings, setHoldings] = useState<UserProfile['holdings']>([])
  const [activeOrders, setActiveOrders] = useState<UserProfile['activeOrders']>([])
  const [balance, setBalance] = useState(0)
  const [totalValue, setTotalValue] = useState(0)
  const [isLoadingMovers, setIsLoadingMovers] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [isLoadingUserData, setIsLoadingUserData] = useState(false)


  const fetchBalance = useCallback(async () => {
	  if (!user) return false
	  try {
		const response = await fetch('/api/balance')
		const data = await response.json()
		if (response.ok) {
		  const newBalance = Number(data.balance)
		  setBalance(newBalance)
		  return true
		}
		return false
	  } catch (error) {
		console.error('Balance fetch error:', error)
		return false
	  }
	}, [user])

  const fetchActiveOrders = useCallback(async () => {
    if (!user) return false
    console.log('Debug (MoversListPage): fetchActiveOrders called')
    try {
      const response = await fetch('/api/active-orders')
      if (response.ok) {
        const data = await response.json()
        setActiveOrders(data)
        return true
      }
      return false
    } catch (error) {
      console.error('Active orders fetch error:', error)
      return false
    }
  }, [user])


  const fetchHoldings = useCallback(async (options = { forceRefresh: false }) => {
    if (!user) return false;
    console.log('Debug (MoversListPage): fetchHoldings called');
    try {
      console.log('\n=== FETCHING HOLDINGS ===');
      console.log('Options:', options);
      
      if (options.forceRefresh) {
        console.log('Force refresh requested, invalidating cache...');
        const invalidateResponse = await fetch('/api/invalidate-holdings', {
          method: 'POST'
        });
        
        if (!invalidateResponse.ok) {
          console.warn('Cache invalidation failed:', await invalidateResponse.text());
        }
      }
      
      console.log('Fetching holdings...');
      const response = await fetch('/api/holdings', {
        credentials: 'include'
      });
      
      if (!response.ok) {
        throw new Error(`Holdings fetch failed: ${response.status}`);
      }

      const rawText = await response.text();
      console.log('Raw response length:', rawText.length);

      let data;
      try {
        data = JSON.parse(rawText);
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
        throw new Error('Failed to parse holdings response');
      }

      console.log('Holdings count:', data.length);

      const formattedHoldings = data.map((holding: UserProfile['holdings'][0]) => ({
		  ...holding,
		  amount: holding.amount?.toString() || '0',
		  entry_price: holding.entry_price?.toString() || '0',
		  current_price: holding.current_price?.toString() || '0'
		}));

      setHoldings(formattedHoldings);
      console.log('Holdings updated successfully');
      console.log('=== HOLDINGS FETCH COMPLETE ===\n');
      
      return true;
    } catch (error) {
      console.error('Holdings fetch error:', error);
      return false;
    }
  }, [user]);

  const calculateTotalValue = useCallback(() => {
    const holdingsValue = holdings.reduce((total, holding) => {
      const amount = parseFloat(holding.amount) || 0
      const price = parseFloat(holding.current_price || '0')
      return total + (amount * price)
    }, 0)

    setTotalValue(balance + holdingsValue)
  }, [holdings, balance])

  useEffect(() => {
    calculateTotalValue()
  }, [calculateTotalValue])

  useEffect(() => {
    if (user) {
      setIsLoadingUserData(true)
      Promise.all([
        fetchHoldings(),
        fetchBalance(),
        fetchActiveOrders()
      ]).finally(() => {
        setIsLoadingUserData(false)
      })
    }
  }, [user, fetchHoldings, fetchBalance, fetchActiveOrders])

  const { socket, isConnected, subscribeToUpdates } = useWebSocket()

  useEffect(() => {
    if (!socket || !isConnected) return

    interface PriceUpdateData {
      market_id: string;
      last_traded_price: number;
      yes_price: number;
      no_price: number;
      volume: number;
    }

    const updateMoverData = (updateData: PriceUpdateData) => {
      setTopMovers(prevMovers => {
        const index = prevMovers.findIndex(m => m.market_id === updateData.market_id)
        if (index === -1) return prevMovers

        const updatedMovers = [...prevMovers]
        updatedMovers[index] = {
          ...updatedMovers[index],
          final_last_traded_price: updateData.last_traded_price,
          final_best_ask: updateData.yes_price,
          final_best_bid: updateData.no_price,
          volume: updateData.volume
        }

        return updatedMovers
      })
    }

    subscribeToUpdates(<T extends keyof WSUpdateData>(type: T, data: WSUpdateData[T]) => {
	  console.log('Debug (MoversListPage): Received WS event', type, data);
	  switch (type) {
		case 'holdings_update':
		  console.log('Holdings update received, refreshing...');
		  fetchHoldings()
		  break
		case 'balance_update':
		  const balanceData = data as { balance: number };
		  console.log('Balance update received:', balanceData.balance);
		  setBalance(balanceData.balance)
		  break
		case 'orders_update':
		  console.log('Orders update received, refreshing...');
		  fetchActiveOrders()
		  break
		case 'price_update':
		  updateMoverData(data as PriceUpdateData)
		  break
		case 'order_execution':
		  console.log('Order execution update received:', data);
		  if ('needsHoldingsRefresh' in data && data.needsHoldingsRefresh) {
			console.log('Immediate holdings refresh required');
			Promise.all([
			  fetchHoldings(),
			  fetchBalance(),
			  fetchActiveOrders()
			]).catch(console.error);
		  }
		  break
	  }
	})
  }, [socket, isConnected, subscribeToUpdates, fetchHoldings, fetchBalance, fetchActiveOrders])
  

  const fetchTopMovers = useCallback(async (page = 1, pageSize = 10, search = '') => {
	  console.log('Starting fetch:', { 
		page, 
		pageSize, 
		search, 
		interval: selectedInterval, 
		openMarketsOnly  // Changed from openOnly to openMarketsOnly to match state variable
	  });
	  
	  setError(null);
	  if (page === 1) {
		setIsLoadingMovers(true);
	  } else {
		setIsLoadingMore(true);
	  }
	  
	  try {
		const url = `/api/top_movers?interval=${selectedInterval}&page=${page}&pageSize=${pageSize}&search=${encodeURIComponent(search)}&openOnly=${openMarketsOnly}`;
		console.log('Fetch URL:', url);
		
		const response = await fetch(url);
		console.log('Response Status:', response.status);
		
		if (!response.ok) {
		  const errorText = await response.text();
		  console.error('Error Response:', errorText);
		  throw new Error(`Failed to fetch: ${errorText}`);
		}
		
		const data = await response.json();
		console.log('Raw Response Data:', data);
		
		// Validate each mover has required fields
		const processedMovers = data.map((mover: Partial<TopMover>, index: number) => {
		  if (!mover.market_id) {
			console.error('Missing market_id for mover:', index, mover);
		  }
		  return {
			...mover,
			market_id: mover.market_id || '',
			volume: mover.volume || 0,
			volume_change: mover.volume_change || 0,
			volume_change_percentage: mover.volume_change_percentage || 0,
		  } as TopMover;
		});

		console.log('Processed Movers:', processedMovers);

		if (page === 1) {
		  setTopMovers(processedMovers);
		} else {
		  setTopMovers(prev => [...prev, ...processedMovers]);
		}
		
		setHasMore(processedMovers.length === pageSize);
	  } catch (error) {
		console.error('Complete Fetch Error:', error);
		setError('Failed to fetch top movers. Please try again.');
	  } finally {
		if (page === 1) {
		  setIsLoadingMovers(false);
		} else {
		  setIsLoadingMore(false);
		}
	  }
	}, [selectedInterval, openMarketsOnly]);

  useEffect(() => {
    fetchTopMovers(1, 10)
  }, [selectedInterval, openMarketsOnly, fetchTopMovers])

  if (isAuthLoading) return <div className="min-h-screen bg-background flex items-center justify-center">Loading...</div>
  if (authError) return <div className="min-h-screen bg-background flex items-center justify-center text-red-500">Error: {authError.message}</div>

  return (
    <div className="min-h-screen relative z-[1] bg-[#1a1b1e] isolation-isolate">
      <div 
        className="fixed inset-0 -z-10 pointer-events-none will-change-transform backface-hidden perspective-1000 animated-gradient-bg"
        style={{
          transform: 'translateZ(0)',
          WebkitTransform: 'translateZ(0)',
          WebkitBackfaceVisibility: 'hidden',
          WebkitPerspective: '1000'
        }}
      />
      <header className="fixed top-0 left-0 right-0 h-14 bg-[#1a1b1e] border-b border-white/10 z-50">
        <div className="h-full flex items-center justify-between px-4 max-w-6xl mx-auto">
          <button className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <Menu size={20} />
          </button>
          <GradientLogo />
          <button className="p-2 hover:bg-white/10 rounded-lg transition-colors">
            <Bell size={20} />
          </button>
        </div>
      </header>

      <div className="flex flex-col md:flex-row pt-14">
        {/* Left Sidebar */}
        <aside className={`fixed top-14 left-0 h-[calc(100vh-56px)] w-[400px] bg-[#1a1b1e]/70 backdrop-blur-md z-[999] border-r border-white/10 flex-col ${isSidebarCollapsed ? 'w-[50px]' : 'w-[400px]'} hidden xl:flex`}>
          <button 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="p-2 hover:bg-white/10 w-full flex justify-center mt-4"
          >
            <ChevronLeft className={`transform transition-transform ${isSidebarCollapsed ? 'rotate-180' : ''}`} size={20} />
          </button>
          
          {!isSidebarCollapsed && (
            <div className="p-4 overflow-y-auto flex-grow">
              {user ? (
                <>
                  <div className="flex flex-col items-center mb-6">
                    <Image 
                      src={user.picture || "/images/default-avatar.png"}
                      alt={`${user.name}'s profile`}
                      width={120}
                      height={120}
                      className="rounded-full mb-2"
                    />
                    <h2 className="text-xl font-bold mb-2">{user.name}</h2>
                    <p className="text-sm text-gray-400">{user.email}</p>
                  </div>
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold mb-2 flex justify-between items-center">
                      Total Value
                      <span className="text-sm font-normal">
                        ${totalValue.toFixed(2)}
                      </span>
                    </h3>
                    <p className="mb-4">Cash: ${balance.toFixed(2)}</p>

                    {/* Balance Adjustment Box */}
                    <div className="mb-6 p-4 bg-gray-800 rounded">
                      <h3 className="text-lg font-semibold mb-3">Adjust Balance</h3>
                      <div className="flex gap-2 mb-3">
                        <input
                          type="number"
                          id="balanceAmount"
                          className="flex-1 bg-gray-700 rounded px-3 py-2 text-white"
                          placeholder="Amount"
                          min="0"
                          step="0.01"
                        />
                        <button
                          onClick={async () => {
                            const amount = parseFloat((document.getElementById('balanceAmount') as HTMLInputElement).value);
                            if (isNaN(amount) || amount <= 0) {
                              alert('Please enter a valid amount');
                              return;
                            }
                            try {
                              const response = await fetch('/api/balance', {
                                method: 'PUT',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                  amount,
                                  operation: 'increase'
                                }),
                              });
                              if (response.ok) {
                                const data = await response.json();
                                setBalance(data.balance);
                                (document.getElementById('balanceAmount') as HTMLInputElement).value = '';
                              } else {
                                alert('Failed to update balance');
                              }
                            } catch (error) {
                              console.error('Error updating balance:', error);
                              alert('Error updating balance');
                            }
                          }}
                          className="bg-green-600 hover:bg-green-700 px-4 py-2 rounded"
                        >
                          Add
                        </button>
                        <button
                          onClick={async () => {
                            const amount = parseFloat((document.getElementById('balanceAmount') as HTMLInputElement).value);
                            if (isNaN(amount) || amount <= 0) {
                              alert('Please enter a valid amount');
                              return;
                            }
                            try {
                              const response = await fetch('/api/balance', {
                                method: 'PUT',
                                headers: {
                                  'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                  amount,
                                  operation: 'decrease'
                                }),
                              });
                              if (response.ok) {
                                const data = await response.json();
                                setBalance(data.balance);
                                (document.getElementById('balanceAmount') as HTMLInputElement).value = '';
                              } else {
                                const error = await response.text();
                                alert(error || 'Failed to update balance');
                              }
                            } catch (error) {
                              console.error('Error updating balance:', error);
                              alert('Error updating balance');
                            }
                          }}
                          className="bg-red-600 hover:bg-red-700 px-4 py-2 rounded"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <h3 className="text-lg font-semibold mb-2 mt-6">Your Holdings</h3>
                    {isLoadingUserData ? (
                      <div className="text-center py-4">Loading holdings...</div>
                    ) : error ? (
                      <div className="text-red-500 py-2">{error}</div>
                    ) : holdings.length === 0 ? (
                      <div className="text-gray-400 py-2">No holdings found</div>
                    ) : holdings.map((holding, index) => (
                      <div key={index} className="mb-4 p-2 bg-gray-800 rounded">
                        <div className="flex items-center gap-3">
                          <Image
                            src={holding.image && holding.image !== '0' && holding.image !== 'null' && holding.image !== '' ? 
                              holding.image : '/images/placeholder.png'}
                            alt="Market image"
                            width={32}
                            height={32}
                            className="rounded object-cover flex-shrink-0"
                          />
                          <p className="font-semibold text-sm">{holding.question || 'Unknown Market'}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                          <p>Outcome: <span className="font-medium">{holding.outcome || 'Unknown'}</span></p>
                          <p>Position: <span className="font-medium">{holding.amount}</span></p>
                          <p>Entry Price: <span className="font-medium">
                            {holding.entry_price ? `${(parseFloat(holding.entry_price) * 100).toFixed(0)}¢` : 'N/A'}
                          </span></p>
                          <p>Current Price: <span className="font-medium">
                            {holding.current_price ? `${(parseFloat(holding.current_price) * 100).toFixed(0)}¢` : 'N/A'}
                          </span></p>
                          <p>Current Value: <span className="font-medium">
                            {holding.current_price ? 
                              `${(parseFloat(holding.amount) * parseFloat(holding.current_price)).toFixed(2)}` : 'N/A'}
                          </span></p>
                        </div>
                      </div>
                    ))}

                    <h3 className="text-lg font-semibold mb-2 mt-6">Active Orders</h3>
                    {isLoadingUserData ? (
                      <div className="text-center py-4">Loading orders...</div>
                    ) : activeOrders.length === 0 ? (
                      <div className="text-gray-400 py-2">No active orders</div>
                    ) : activeOrders.map((order, index) => (
                      <div key={index} className="mb-4 p-2 bg-gray-800 rounded">
                        <div className="flex justify-between items-start">
                          <div className="flex items-center gap-3">
                            <Image
                              src={order.image || '/images/placeholder.png'}
                              alt="Order image"
                              width={32}
                              height={32}
                              className="rounded object-cover flex-shrink-0"
                            />
                            <p className="font-semibold text-sm">{order.question}</p>
                          </div>
                          <button
                            onClick={async () => {
                              // Optimistically remove the order
                              setActiveOrders(prev => prev.filter(o => o.id !== order.id));
                              
                              try {
                                const response = await fetch(`/api/orders/${order.id}`, {
                                  method: 'DELETE'
                                });
                                
                                if (!response.ok) {
                                  // Revert on error
                                  const error = await response.json();
                                  console.error('Error cancelling order:', error);
                                  await fetchActiveOrders(); // Refresh to get accurate state
                                }
                              } catch (error) {
                                console.error('Error cancelling order:', error);
                                await fetchActiveOrders(); // Refresh to get accurate state
                              }
                            }}
                            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-gray-700 transition-colors"
                            title="Cancel Order"
                          >
                            ×
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 mt-2 text-sm">
                          <p>Side: <span className="font-medium">{order.side}</span></p>
                          <p>Outcome: <span className="font-medium">{order.outcome}</span></p>
                          <p>Size: <span className="font-medium">{order.size}</span></p>
                          <p>Price: <span className="font-medium">
                            {(order.limit_price * 100).toFixed(0)}¢
                          </span></p>
                          <p>Created: <span className="font-medium">
                            {new Date(order.created_at).toLocaleDateString()}
                          </span></p>
                        </div>
                      </div>
                    ))}

                    <Link 
                      href="/api/auth/logout"
                      className="block w-full p-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors mt-4 text-center"
                    >
                      Logout
                    </Link>
                  </div>
                </>
              ) : (
                <div className="text-center pt-8">
                  <p className="mb-4 text-gray-400">Please log in to continue</p>
                  <Link 
                    href="/api/auth/login"
                    className="block w-full p-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                  >
                    Login
                  </Link>
                </div>
              )}
            </div>
          )}
        </aside>

        {/* Main Content */}
        <main className="max-w-3xl mx-auto px-4 flex-grow">
          <TopMoversList
            topMovers={topMovers}
            isLoading={isLoadingMovers || isLoadingUserData}
            isLoadingMore={isLoadingMore}
            error={error}
            timeIntervals={TIME_INTERVALS}
            selectedInterval={selectedInterval}
            onIntervalChange={interval => {
              setSelectedInterval(interval)
              setCurrentPage(1)
            }}
            onLoadMore={() => {
              const nextPage = currentPage + 1
              setCurrentPage(nextPage)
              fetchTopMovers(nextPage, 10)
            }}
            hasMore={hasMore}
            openMarketsOnly={openMarketsOnly}
            onOpenMarketsChange={value => {
              setOpenMarketsOnly(value)
              setCurrentPage(1)
            }}
            balance={balance}
          />
        </main>

        <RightSidebar />
      </div>
    </div>
  )
}
