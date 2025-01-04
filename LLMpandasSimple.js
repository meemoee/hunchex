const { Client } = require('pg');
const Redis = require('redis');
const fetch = require('node-fetch');
const _ = require('lodash');
require('dotenv').config();

// Database and API configurations
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DB_PARAMS = {
    dbname: "market_data",
    user: "market_data_user",
    password: "1pCU8cOG1npoN0d0",
    host: "market-data-db.cpk8ckae4ddx.us-east-1.rds.amazonaws.com",
    port: 5432
};

// Redis connection
const redisClient = Redis.createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        connectTimeout: 60000,
        timeout: 60000
    }
});

async function getCachedMarketData() {
    const cacheKey = "market_data_cache";
    try {
        await redisClient.connect();
        
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            console.log("Loading data from Redis cache...");
            return processJsonFields(JSON.parse(cachedData));
        }

        console.log("Cache miss - loading from database...");
        const df = await fetchFromDatabase();
        
        console.log("Caching data in Redis...");
        await redisClient.setEx(
            cacheKey,
            7 * 24 * 3600,  // Cache for 1 week
            JSON.stringify(df)
        );
        return df;
    } catch (error) {
        console.error(`Cache error: ${error}`);
        return fetchFromDatabase();
    } finally {
        await redisClient.disconnect();
    }
}

function processJsonFields(df) {
    try {
        // Filter out closed markets
        df = df.filter(row => row.closed !== true);
        
        // Handle numeric fields
        const numericFields = ['volume', 'liquidity', 'yes_price', 'no_price', 
                             'best_bid', 'best_ask', 'last_traded_price'];
        
        df.forEach(row => {
            numericFields.forEach(field => {
                row[field] = parseFloat(row[field]) || 0;
            });
        });
    } catch (error) {
        console.error(`Error processing fields: ${error}`);
        console.error(error.stack);
    }
    return df;
}

async function fetchFromDatabase() {
    console.log("Fetching from database...");
    const startTime = Date.now();
    
    const client = new Client(DB_PARAMS);
    await client.connect();

    try {
        const result = await client.query(`
            WITH latest_prices AS (
                SELECT DISTINCT ON (market_id)
                    market_id,
                    yes_price,
                    no_price,
                    best_bid,
                    best_ask,
                    last_traded_price,
                    volume,
                    liquidity,
                    timestamp as price_timestamp
                FROM market_prices
                ORDER BY market_id, timestamp DESC
            )
            SELECT 
                m.id,
                m.event_id,
                m.question,
                m.subtitle,
                m.yes_sub_title,
                m.url,
                m.condid,
                m.slug,
                m.end_date,
                m.description,
                m.outcomes,
                m.group_item_title,
                m.open_time,
                m.close_time,
                m.status,
                m.clobtokenids,
                m.active,
                m.closed,
                m.archived,
                m.image,
                m.created_at,
                m.updated_at,
                e.title as event_title,
                e.category as event_category,
                e.sub_title as event_subtitle,
                e.mutually_exclusive as event_mutually_exclusive,
                p.yes_price,
                p.no_price,
                p.best_bid,
                p.best_ask,
                p.last_traded_price,
                p.volume,
                p.liquidity,
                p.price_timestamp
            FROM markets m
            LEFT JOIN events e ON m.event_id = e.id
            LEFT JOIN latest_prices p ON m.id = p.market_id
            WHERE (
                CASE 
                    WHEN m.id NOT LIKE '%-%' THEN 
                        m.active = true AND 
                        m.closed = false AND
                        (m.end_date > NOW() OR m.end_date IS NULL)
                    ELSE 
                        (m.end_date > NOW() OR m.end_date IS NULL)
                END
            )
            ORDER BY m.updated_at DESC
        `);

        console.log(`Fetched ${result.rows.length} records in ${(Date.now() - startTime) / 1000} seconds`);
        return processJsonFields(result.rows);
    } finally {
        await client.end();
    }
}

function printMarketInfo(market) {
    const hasHyphen = String(market.id).includes('-');
    console.log(`\nQuestion: ${market.question}`);
    console.log(`Subtitle: ${market.subtitle || 'N/A'}`);
    console.log(`Yes Subtitle: ${market.yes_sub_title === undefined ? 'N/A' : market.yes_sub_title}`);
    console.log(`Market ID: ${market.id} (Contains hyphen: ${hasHyphen})`);
    console.log(`Active: ${market.active || 'N/A'}`);
    console.log(`Closed: ${market.closed || 'N/A'}`);
    console.log(`End Date: ${market.end_date || 'N/A'}`);
    console.log(`Liquidity: $${market.liquidity.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`Volume: $${market.volume.toLocaleString('en-US', {minimumFractionDigits: 2})}`);
    console.log(`Yes Price: ${market.yes_price || 'N/A'}`);
    console.log(`No Price: ${market.no_price || 'N/A'}`);
    console.log(`URL: ${market.url || 'N/A'}`);
    console.log("-".repeat(80));
}

async function getStructuredQuery(userInput) {
    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "perplexity/llama-3.1-sonar-small-128k-online",
                messages: [
                    {
                        role: "system",
                        content: `You are an advanced market analysis assistant. CRITICAL CONTEXT PROCESSING RULES:

1. ALWAYS analyze the entire chat history before generating a response
2. Identify key topics, entities, and themes from previous messages
3. Use previous conversation context to:
   - Refine search queries
   - Provide more targeted and relevant market suggestions
   - Maintain continuity with previous discussions

CONTEXT TRACKING EXAMPLE:
- If previous messages discussed Taylor Swift, future queries should prioritize related markets
- If cryptocurrency was mentioned earlier, subsequent queries should consider crypto-related markets first

Chat History:
${userInput.chatHistory || 'No previous chat history'}

Your task is to generate precise, context-aware market analysis queries that build upon and extend the conversation's previous context.`
                    },
                    {
                        role: "user",
                        content: `Chat History:
${userInput.chatHistory || 'No previous chat history'}

Current Query: Using the context from the chat history above, convert the following query into THREE precise, single-line pandas DataFrame queries. Your queries should:
1. Build upon topics/entities mentioned in the chat history
2. Combine previous context with the new query terms
3. Include relevant synonyms and related terms

CRITICAL RULES FOR QUERY GENERATION:
1. ALWAYS use pd.to_datetime() with errors='coerce' for date comparisons
2. ALWAYS use specific price columns: 'yes_price', 'no_price', 'last_traded_price'
3. Return ONLY the DataFrame query
4. Use precise text matching in 'question' column

DATE QUERY GUIDELINES:
- Use: pd.to_datetime(df['end_date'], errors='coerce')
- Compare against pd.Timestamp with error handling
- Ensure proper date range comparisons

PRICE QUERY GUIDELINES:
- Use columns: 'yes_price', 'no_price', 'last_traded_price'
- For near-50/50 markets: df[(df['yes_price'] >= 0.4) & (df['yes_price'] <= 0.6)]
- For high confidence markets: df[((df['yes_price'] >= 0.9) | (df['yes_price'] <= 0.1))]

===EXAMPLES===
Vague: "What presidential markets exist?"
Better: "Find markets related to presidential topics, sorted by volume, showing top 10"
Query: df[df['question'].str.contains('president|election|campaign', case=False)].sort_values('volume', ascending=False).head(25)
Vague: "What's happening in tech?"
Better: "Find markets mentioning technology or innovation, sorted by trading volume, showing top 15"
Query: df[df['question'].str.contains('tech|technology|innovation|AI|artificial intelligence', case=False)].sort_values('volume', ascending=False).head(15)
Vague: "Interesting global events?"
Better: "Find markets about international or global events, sorted by liquidity, showing top 10"
Query: df[df['question'].str.contains('global|international|world|worldwide', case=False)].sort_values('liquidity', ascending=False).head(10)
Vague: "What sports betting looks good?"
Better: "Find active sports markets with high liquidity, sorted by volume, showing top 8"
Query: df[df['question'].str.contains('sports|game|match|tournament', case=False)].sort_values('liquidity', ascending=False).head(8)
Vague: "Upcoming entertainment predictions?"
Better: "Find markets about movies, awards, or entertainment, sorted by creation date, showing 10 most recent"
Query: df[df['question'].str.contains('movie|award|entertainment|film', case=False)].sort_values('created_at', ascending=False).head(10)
Vague: "What markets are close to 50/50?"
Better: "Find markets with yes_price between 0.4 and 0.6, indicating near-even odds, sorted by volume"
Query: df[(df['yes_price'] >= 0.4) & (df['yes_price'] <= 0.6)].sort_values('volume', ascending=False).head(10)
Vague: "Markets about to end soon?"
Better: "Show markets with end dates in the next 30 days, sorted by liquidity"
Query: df[(pd.to_datetime(df['end_date']) <= pd.Timestamp.today() + pd.Timedelta(days=30)) & (pd.to_datetime(df['end_date']) > pd.Timestamp.today())].sort_values('liquidity', ascending=False).head(10)
Vague: "What are people betting most confidently about?"
Better: "Find markets with extremely high confidence (very low or very high yes_price), sorted by volume"
Query: df[((df['yes_price'] >= 0.9) | (df['yes_price'] <= 0.1)) & (df['liquidity'] > 10000)].sort_values('volume', ascending=False).head(10)
Vague: "Markets about recent technologies?"
Better: "Find recently created markets mentioning emerging technologies, sorted by volume"
Query: df[(df['created_at'] >= pd.Timestamp.now() - pd.Timedelta(days=60)) & df['question'].str.contains('AI|blockchain|quantum|robot', case=False)].sort_values('volume', ascending=False).head(10)
Vague: "What political markets are trending?"
Better: "Find political markets with highest recent trading volume"
Query: df[df['question'].str.contains('politics|election|vote|campaign', case=False)].sort_values('volume', ascending=False).head(10)
===EXAMPLES===

YOU MUST focus on various wordings and phrasings, fuzzy matching, paraphrasing, etc because the questions fields OFTEN contain different phrasing than the exact search query the  user wants to find, so you should use the OR operator to your advantage for highly diverse wordings of the same thing to get all possible variations. Use OR operator heavily, often looking at 5-10 different forms various words as a means of getting all possible markets that could be involved with the intent.

Notable markets are usually contentious - meaning lots of buyers and sellers can't agree. This is characterized by yes odds somewhat close to 50/50 and high volume/liquidity.


User Query: ${userInput}

DataFrame Query (QUERY ONLY):`
                    }
                ],
                temperature: 0.2
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        const content = result.choices[0].message.content.trim();
        // Extract only lines that look like pandas queries
        const queries = content.split('\n')
            .filter(line => {
                line = line.trim();
                // Only keep lines that start with 'df[' or contain common pandas operations
                return line.startsWith('df[') || 
                       line.includes('.sort_values') || 
                       line.includes('.head(') ||
                       line.includes('.query(');
            })
            .map(q => q.trim())
            .filter(q => q); // Remove any empty strings
        
        return queries.slice(0, 3); // Ensure we only get up to 3 queries
    } catch (error) {
        console.error("Error getting structured query:", error);
        return null;
    }
}

async function synthesizeResults(results, userQuery) {
    try {
        const response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: "perplexity/llama-3.1-sonar-small-128k-online",
                messages: [
                    {
                        role: "system",
                        content: `You are a market analysis assistant. Use the chat history to provide context for your responses.`
                    },
                    {
                        role: "user",
                        content: `Chat History:
${userQuery?.chatHistory || 'No previous chat history'}

Current Query: Analyze these prediction market results and provide a concise synthesis focused on my intent.

Today's Date: ${new Date().toISOString().split('T')[0]}
My Query: "${userQuery}"

Market Results:
${results.map(market => `
- ${market.question} (${market.id})
  Price: Yes=${market.yes_price?.toFixed(3) || 'N/A'} No=${market.no_price?.toFixed(3) || 'N/A'}
  Volume: $${market.volume?.toLocaleString()}
  Liquidity: $${market.liquidity?.toLocaleString()}
  End Date: ${market.end_date || 'N/A'}
  Market ID: ${market.id}
`).join('\n')}

Answer my query.
Always try to feature as many relevant markets as possible.

CRITICAL: When mentioning ANY specific market, you MUST include its ID in parentheses immediately after, like "presidential election market (510893)" or "Bitcoin price prediction (KXINAUG-25-JB)".

Response (2-3 sentences only):`
                    }
                ],
                stream: true,
                temperature: 0.2
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        let buffer = '';
        for await (const chunk of response.body) {
            buffer += new TextDecoder().decode(chunk, { stream: true });
            let newlineIndex;
            
            while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                const line = buffer.slice(0, newlineIndex);
                buffer = buffer.slice(newlineIndex + 1);

                if (line.startsWith('data: ')) {
                    const jsonStr = line.slice(6).trim();
                    if (jsonStr === "[DONE]") {
                        return;
                    }

                    try {
                        const parsed = JSON.parse(jsonStr);
                        const content = parsed.choices?.[0]?.delta?.content;
                        if (content) {
                            process.stdout.write(content);
                        }
                    } catch (error) {
                        console.error('Error parsing JSON chunk:', error);
                        continue;
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error getting market synthesis:", error);
        return null;
    }
}

async function processMarketQuery(data, query) {
    try {
        let filteredData = [...data];  // Work with a copy
        
        // Handle str.contains() for question field with pipe-separated terms
        const containsPattern = /str\.contains\('([^']+)', *case=False\)/;
        const containsMatch = query.match(containsPattern);
        if (containsMatch) {
            const searchTerms = containsMatch[1].split('|').map(term => term.trim().toLowerCase());
            console.log('Processing search terms:', searchTerms);
            
            filteredData = filteredData.filter(market => 
                market.question && searchTerms.some(term => 
                    market.question.toLowerCase().includes(term)
                )
            );
            
            // Log matches found for each term
            const matchCounts = searchTerms.map(term => ({
                term,
                matches: filteredData.filter(market => 
                    market.question.toLowerCase().includes(term)
                ).length
            }));
            console.log('Match counts by term:', matchCounts);
        }

        // Handle sort_values()
        const sortPattern = /sort_values\('([^']+)'.*\)/;
        const sortMatch = query.match(sortPattern);
        if (sortMatch) {
            const sortField = sortMatch[1];
            filteredData = _.orderBy(filteredData, [sortField], ['desc']);
        }

        // Always enforce a maximum of 25 results
        // First check for head() in query
        const headPattern = /\.head\((\d+)\)/;
        const headMatch = query.match(headPattern);
        const requestedLimit = headMatch ? parseInt(headMatch[1]) : 25;
        // Never return more than 25 results, regardless of query
        filteredData = filteredData.slice(0, Math.min(requestedLimit, 25));

        return filteredData;
    } catch (error) {
        console.error("Error processing market query:", error);
        return [];
    }
}


// Export functions for use in other modules
module.exports = {
    getStructuredQuery,
    getCachedMarketData,
    processMarketQuery,
    synthesizeResults
};
