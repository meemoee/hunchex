'use client'

import { Send, Zap, TrendingUp, DollarSign } from 'lucide-react'
import { useState } from 'react'

export default function RightSidebar() {
  const [chatMessage, setChatMessage] = useState('')
  interface Market {
    id: string;
    question: string;
    yes_price?: number;
    volume?: number;
  }

  interface Message {
    type: 'user' | 'assistant' | 'markets';
    content?: string;
    markets?: Market[];
  }
  
  const [messages, setMessages] = useState<Message[]>([])
  const [hasStartedChat, setHasStartedChat] = useState(false)
  const [streamingContent, setStreamingContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)

  const formatChatHistory = (messages: Message[]): string => {
    return messages
      .map(msg => `${msg.type === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
      .join('\n');
  }

  const [streamingMarkets, setStreamingMarkets] = useState<Market[]>([]);

	const handleChatMessage = async (userMessage: string) => {
	  if (!userMessage.trim() || isStreaming) return;
	  
	  setHasStartedChat(true)
	  setMessages(prev => [...prev, { type: 'user', content: userMessage }])
	  setChatMessage('')
	  setIsStreaming(true)
	  
	  try {
		const response = await fetch('http://localhost:3001/api/chat', {
		  method: 'POST',
		  headers: { 'Content-Type': 'application/json' },
		  body: JSON.stringify({ 
			message: userMessage,
			chatHistory: formatChatHistory(messages)
		  })
		})
		
		const reader = response.body?.getReader()
		if (!reader) throw new Error('No reader')
		
		let accumulatedContent = '';
		let marketData: Market[] = [];
		
		while (true) {
		  const { done, value } = await reader.read()
		  if (done) break
		  const text = new TextDecoder().decode(value)
		  try {
			const lines = text.split('\n')
			for (const line of lines) {
			  if (line.startsWith('data: ')) {
				const jsonStr = line.slice(6).trim()
				if (jsonStr === "[DONE]") break;
				
				try {
				  const parsed = JSON.parse(jsonStr);
				  if (parsed.type === 'markets') {
					console.log("Received markets data:", parsed.markets);
					marketData = parsed.markets;
				  } else if (parsed.content) {
					if (!parsed.content.includes("Starting synthesis") && 
						!parsed.content.includes("Synthesis complete")) {
					  // Log the incoming content for debugging
					  console.log('Incoming chunk:', JSON.stringify(parsed.content));
					  console.log('Current accumulated:', JSON.stringify(accumulatedContent));

					  // Concatenate the incoming content and remove market IDs
					  accumulatedContent += parsed.content;
					  const cleanedContent = removeMarketIds(accumulatedContent, marketData);
					  
					  console.log('New accumulated:', JSON.stringify(cleanedContent));
					  setStreamingContent(cleanedContent);
					  
					  // Dynamically update visible markets based on accumulated content
					  if (marketData.length > 0) {
						const newFilteredMarkets = marketData.filter((market: Market) => 
						  accumulatedContent.toLowerCase().includes(market.id.toLowerCase())
						);
						setStreamingMarkets(newFilteredMarkets);
					  }
					}
				  }
				} catch (parseError) {
				  console.error('Error parsing streaming response');
				}
			  }
			}
		  } catch (error) {
			console.error('Error parsing stream chunk:', error)
		  }
		}
		
		// Filter markets based on IDs mentioned in the streaming content
		let filteredMarkets = marketData;
		if (marketData && accumulatedContent) {
		  filteredMarkets = marketData.filter((market: Market) => 
			accumulatedContent.toLowerCase().includes(market.id.toLowerCase())
		  );
		}

		// Update messages with both assistant response and filtered market data
		setMessages(prev => {
		  const newMessages = [...prev];
		  if (accumulatedContent) {
			newMessages.push({
			  type: 'assistant',
			  content: removeMarketIds(accumulatedContent, marketData)
			});
		  }
		  if (filteredMarkets && filteredMarkets.length > 0) {
			newMessages.push({
			  type: 'markets',
			  markets: filteredMarkets,
			  content: ''
			});
		  }
		  return newMessages;
		});
		
		setStreamingContent('');
	  } catch (error) {
		console.error('Streaming error:', error)
	  } finally {
		setIsStreaming(false)
	  }
	}
  
  const removeMarketIds = (text: string, markets: Market[]): string => {
	  let result = text;
	  if (markets && markets.length > 0) {
		// First handle multiple IDs in parentheses
		const multipleIdsRegex = /\s*\([^)]*?(?:(?:\w+-\w+(?:-\w+)*)|(?:\d{6})(?:\s*,\s*(?:\w+-\w+(?:-\w+)*)|(?:\d{6}))*)[^)]*?\)\s*/g;
		result = result.replace(multipleIdsRegex, (match, offset) => {
		  const nextChar = result[offset + match.length];
		  return (nextChar && /[.,!?]/.test(nextChar)) ? '' : ' ';
		});

		// Then handle individual IDs
		markets.forEach(market => {
		  const marketId = market.id;
		  // Escape special characters in the market ID for regex
		  const escapedId = marketId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		  const regex = new RegExp(`\\s*\\(${escapedId}\\)\\s*`, 'g');
		  // Replace with a single space if between words, or empty string if next to punctuation
		  result = result.replace(regex, (match, offset) => {
			const nextChar = result[offset + match.length];
			return (nextChar && /[.,!?]/.test(nextChar)) ? '' : ' ';
		  });
		});
	  }
	  return result.replace(/\s+/g, ' ').trim();
	}

  const defaultContent = [
    {
      icon: Zap,
      question: "How does it work?",
      answer: "Get instant insights on market movements",
      subPoints: [
        { icon: TrendingUp, text: "Track price changes in real-time" },
        { icon: DollarSign, text: "Identify profitable opportunities" }
      ]
    },
    {
      icon: TrendingUp,
      question: "What are Top Movers?",
      answer: "Markets with significant price changes",
      subPoints: [
        { icon: Zap, text: "Filter by time intervals" },
        { icon: DollarSign, text: "Sort by price movement %" }
      ]
    },
    {
      icon: DollarSign,
      question: "How to trade?",
      answer: "Simple steps to start trading",
      subPoints: [
        { icon: TrendingUp, text: "Login to your account" },
        { icon: Zap, text: "Select a market and place orders" }
      ]
    }
  ]

  return (
    <aside className="fixed top-14 right-0 h-[calc(100vh-56px)] w-[400px] bg-[#1a1b1e]/70 backdrop-blur-md z-[999] border-l border-white/10 hidden xl:block">
      <div className="p-6 overflow-y-auto h-full">
        {!hasStartedChat ? (
          <>
            <h2 className="text-xl font-bold mb-6 whitespace-nowrap overflow-hidden text-ellipsis">
              Turn your 💬 into 💰
            </h2>
            {defaultContent.map((item, index) => (
              <div key={index} className="mb-6 pb-6 border-b border-white/10 last:border-0">
                <div className="flex items-center mb-2">
                  <span className="mr-3 text-blue-500">
                    <item.icon size={16} />
                  </span>
                  <h3 className="text-sm font-semibold">{item.question}</h3>
                </div>
                <p className="text-gray-400 text-sm ml-9 mb-2">{item.answer}</p>
                <div className="space-y-1 ml-9">
                  {item.subPoints.map((subPoint, subIndex) => (
                    <div key={subIndex} className="flex items-center">
                      <span className="mr-2 text-blue-500">
                        <subPoint.icon size={12} />
                      </span>
                      <span className="text-xs text-gray-400">{subPoint.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="space-y-4 mb-20">
            {messages.map((message, index) => (
              <div key={index} className="bg-[#2c2e33] p-3 rounded-lg">
                {console.log('Rendering message:', message)}
                {message.type === 'markets' && message.markets ? (
                  <div className="space-y-2">
                    {Array.isArray(message.markets) && message.markets.map((market, idx) => (
                      <div key={idx} className="border-l-2 border-blue-500 pl-2">
                        <p className="text-white text-sm">{market.question}</p>
                        <div className="text-gray-400 text-xs mt-1">
                          <span className="mr-3">ID: {market.id}</span>
                          <span className="mr-3">Yes: ${market.yes_price?.toFixed(3)}</span>
                          <span>Volume: ${market.volume?.toLocaleString()}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-white text-sm">{message.content}</p>
                )}
              </div>
            ))}
            {streamingContent && (
              <div className="bg-[#2c2e33] p-3 rounded-lg">
                <p className="text-white text-sm">{streamingContent}</p>
              </div>
            )}
          </div>
        )}
        
        {/* Chat Input */}
        <div className="fixed bottom-0 right-0 w-[400px] p-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleChatMessage(chatMessage);
                }
              }}
              placeholder="What do you believe?"
              className="flex-grow p-2 bg-[#2c2e33] border border-[#4a4b50] rounded-lg text-white text-sm"
            />
            <button 
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-blue-500"
              onClick={() => handleChatMessage(chatMessage)}
            >
              <Send size={20} />
            </button>
          </div>
        </div>
      </div>
    </aside>
  )
}
