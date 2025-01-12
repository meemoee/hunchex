import { getSession } from '@auth0/nextjs-auth0/edge';
import { neon } from '@neondatabase/serverless';

export const runtime = 'edge';

type LoggableValue = string | number | boolean | null | undefined | object;

interface MarketInfo {
  id: string;
  event_id: string;
  question: string;
  description: string;
  active: boolean;
  closed: boolean;
  archived: boolean;
  event_title: string;
}

interface QANode {
  question: string;
  answer: string;
  children?: QANode[];
}

interface QAPair {
  question: string;
  answer: string;
}

const config = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_URL: "https://openrouter.ai/api/v1/chat/completions",
  DEFAULT_MAX_DEPTH: 2,
  DEFAULT_NODES_PER_LAYER: 3
};

const sql = neon(process.env.DATABASE_URL!);

const logger = {
  debug: (...args: LoggableValue[]) => console.log(`=== QA TREE DEBUG ===\n`, new Date().toISOString(), ...args),
  error: (...args: LoggableValue[]) => console.error(`!!! QA TREE ERROR !!!\n`, new Date().toISOString(), ...args),
  info: (...args: LoggableValue[]) => console.log(`=== QA TREE INFO ===\n`, new Date().toISOString(), ...args)
};

const PERPLEXITY_SYSTEM_PROMPT = `YOU ARE A PRECISE EXTRACTION MACHINE:

ABSOLUTE REQUIREMENTS:
1. EVERY RESPONSE MUST USE EXACT ORIGINAL TEXT
2. FORMAT: 
   QUESTION: [VERBATIM QUESTION FROM SOURCE CONTEXT]
   ANSWER: [VERBATIM EXPLANATION/CONTEXT FROM SOURCE]
3. DO NOT REPHRASE OR SUMMARIZE
4. CAPTURE ORIGINAL MEANING WITH ZERO DEVIATION
5. QUESTIONS MUST BE DISCOVERABLE IN ORIGINAL TEXT
6. PRESERVE ALL ORIGINAL FORMATTING, CITATIONS, NUANCES

OUTPUT MUST BE RAW, UNMODIFIED EXTRACTION`;

const GEMINI_SYSTEM_PROMPT = `VERBATIM EXTRACTION PROTOCOL:

MISSION: EXTRACT QUESTIONS AND ANSWERS WITH 100% FIDELITY TO SOURCE TEXT

ABSOLUTE EXTRACTION RULES:
1. USE ONLY TEXT DIRECTLY FROM SOURCE
2. NO PARAPHRASING OR SUMMARIZATION
3. PRESERVE ORIGINAL FORMATTING
4. MAINTAIN EXACT WORDING
5. CAPTURE FULL CONTEXTUAL MEANING

REQUIRED OUTPUT FORMAT:
{
    "qa_pairs": [
        {
            "question": "EXACT QUESTION FROM SOURCE",
            "answer": "EXACT CORRESPONDING TEXT"
        }
    ]
}

ZERO DEVIATION FROM SOURCE ALLOWED`;

async function getMarketInfo(marketId: string): Promise<MarketInfo | null> {
  try {
    logger.debug('Fetching market info for:', marketId);
    const result = await sql<MarketInfo[]>`
      SELECT 
        m.id,
        m.event_id,
        m.question,
        m.description,
        m.active,
        m.closed,
        m.archived,
        e.title as event_title 
      FROM markets m
      JOIN events e ON m.event_id = e.id
      WHERE m.id = ${marketId}
    `;

    if (!result || result.length === 0) {
      logger.debug(`No market found for ID: ${marketId}`);
      return null;
    }

    const marketInfo = result[0];
    logger.debug('Market info retrieved:', {
      id: marketInfo.id,
      question: marketInfo.question,
      eventTitle: marketInfo.event_title
    });

    return marketInfo;
  } catch (error) {
    logger.error('Market info retrieval error:', error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function parseWithGemini(content: string): Promise<QAPair[] | null> {
  if (!content) {
    logger.error('No content provided for Gemini parsing');
    return null;
  }

  logger.debug('Starting Gemini parsing with content length:', content.length);
  logger.debug('Content preview:', content.substring(0, 200) + '...');

  const prompt = `
VERBATIM EXTRACTION PROTOCOL:

SOURCE TEXT:
${content}

EXTRACTION INSTRUCTIONS:
- IDENTIFY ALL QUESTIONS AND CORRESPONDING ANSWERS
- USE EXACT TEXT FROM SOURCE
- ADD HEADERS, NEWLINES, BOLD, AND ITALICS AT KEY PLACES FOR BEST FORMATTING
- DO NOT ALTER ORIGINAL WORDING`;

  const headers = {
    "Authorization": `Bearer ${config.OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Market Analysis QA Tree Generator"
  };

  const data = {
    model: "google/gemini-flash-1.5-8b",
    messages: [
      { role: "system", content: GEMINI_SYSTEM_PROMPT },
      { role: "user", content: prompt }
    ],
    response_format: { type: "json_object" },
    temperature: 0.1,
    max_tokens: 4000,
    stream: true
  };

  try {
    const response = await fetch(config.OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });

    if (!response.ok) return null;

    const collectedContent: string[] = [];
    let buffer = '';

    for await (const chunk of response.body!) {
      buffer += new TextDecoder().decode(chunk, { stream: true });
      let newlineIndex;
      
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              collectedContent.push(content);
            }
          } catch (error) {
		  logger.error("JSON parsing error in stream:", error instanceof Error ? error.message : String(error));
            continue;
          }
        }
      }
    }

    const fullResponse = collectedContent.join('');
    logger.debug('Collected full response:', fullResponse);
    
    try {
      const parsed = JSON.parse(fullResponse);
      logger.debug('Parsed QA pairs:', JSON.stringify(parsed.qa_pairs, null, 2));
      return parsed.qa_pairs || [];
    } catch (error) {
	logger.error("JSON parsing error in stream:", error instanceof Error ? error.message : String(error));
      return null;
    }
  } catch (error) {
    logger.error("Gemini parsing error:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function generateRootQuestion(marketInfo: MarketInfo): Promise<QAPair | null> {
  const prompt = `
CORE MARKET INSIGHT EXTRACTION:

MARKET CONTEXT:
Title: ${marketInfo.question}
Description: ${marketInfo.description}
Event: ${marketInfo.event_title}

INSTRUCTION: 
GENERATE A PRECISE, VERBATIM QUESTION CAPTURING THE FUNDAMENTAL MARKET UNCERTAINTY`;

  try {
    const response = await fetch(config.OPENROUTER_URL, {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${config.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000"
      },
      body: JSON.stringify({
        model: "perplexity/llama-3.1-sonar-large-128k-online",
        messages: [
          {
            role: "system",
            content: PERPLEXITY_SYSTEM_PROMPT
          },
          { role: "user", content: prompt }
        ],
        stream: true,
        max_tokens: 4000,
        temperature: 0.5
      })
    });

    if (!response.ok) return null;

    const collectedContent: string[] = [];
    for await (const chunk of response.body!) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              process.stdout.write(content);
              collectedContent.push(content);
            }
          } catch (error) {
		  logger.error("JSON parsing error in stream:", error instanceof Error ? error.message : String(error));
            continue;
          }
        }
      }
    }

    const fullResponse = collectedContent.join('');
    const parsedQaPairs = await parseWithGemini(fullResponse);

    if (parsedQaPairs) {
      return parsedQaPairs.length === 1 ? parsedQaPairs[0] : parsedQaPairs[0];
    }

    return null;
  } catch (error) {
    logger.error("Request Error:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function generateSubQuestions(
  parentQuestion: QANode,
  marketInfo: MarketInfo,
  nodesPerLayer = 3
): Promise<QAPair[] | null> {
  const prompt = `
PARENT QUESTION CONTEXT:
QUESTION: ${parentQuestion.question}
ANSWER: ${parentQuestion.answer}

MARKET DETAILS:
Title: ${marketInfo.question}
Description: ${marketInfo.description}

INSTRUCTION:
EXTRACT ${nodesPerLayer} PRECISE SUB-QUESTIONS THAT:
- DIRECTLY RELATE TO PARENT QUESTION
- CAPTURE DISTINCT ANALYTICAL PERSPECTIVES
- DO NOT OVERLAP IN QUESTION MATTER
- EACH EXPLORE UNIQUE FACETS OF THE QUESTION TO PIECE TOGETHER THE PUZZLE`;

  try {
    const response = await fetch(config.OPENROUTER_URL, {
      method: 'POST',
      headers: {
        "Authorization": `Bearer ${config.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "perplexity/llama-3.1-sonar-large-128k-online",
        messages: [
          {
            role: "system",
            content: PERPLEXITY_SYSTEM_PROMPT
          },
          { role: "user", content: prompt }
        ],
        stream: true,
        max_tokens: 4000,
        temperature: 0.5
      })
    });

    if (!response.ok) return null;

    const collectedContent: string[] = [];
    for await (const chunk of response.body!) {
      const text = new TextDecoder().decode(chunk);
      const lines = text.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content;
            if (content) {
              collectedContent.push(content);
            }
          } catch (error) {
		  logger.error("JSON parsing error in stream:", error instanceof Error ? error.message : String(error));
            continue;
          }
        }
      }
    }

    const fullResponse = collectedContent.join('');
    const parsedQaPairs = await parseWithGemini(fullResponse);

    return parsedQaPairs;
  } catch (error) {
    logger.error("Request Error:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

async function saveQaTree(auth0UserId: string, marketId: string, treeData: QANode): Promise<string> {
  const treeId = crypto.randomUUID();
  const now = new Date().toISOString();
  
  logger.info('Saving QA tree:', {
    treeId,
    auth0UserId,
    marketId,
    timestamp: now,
    treeDataSize: JSON.stringify(treeData).length
  });
  
  try {
    await sql`
      INSERT INTO qa_trees (
        id, 
        auth0_id, 
        market_id, 
        title, 
        tree_data,
        created_at,
        updated_at
      ) VALUES (
        ${treeId},
        ${auth0UserId},
        ${marketId},
        ${`Analysis Tree for Market ${marketId}`},
        ${JSON.stringify(treeData)}::jsonb,
        ${now},
        ${now}
      )
    `;
    
    logger.info(`Successfully saved QA tree with ID: ${treeId}`);
    return treeId;
  } catch (error) {
    logger.error("Error saving QA tree:", {
      error: error instanceof Error ? error.message : String(error),
      treeId,
      marketId,
      auth0UserId
    });
    throw error;
  }
}

export async function POST(request: Request) {
  const startTime = performance.now();
  logger.info('Starting QA tree generation...');

  try {
    const session = await getSession();
    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { marketId, maxDepth = config.DEFAULT_MAX_DEPTH, nodesPerLayer = config.DEFAULT_NODES_PER_LAYER } = await request.json();

    if (!marketId) {
      logger.error('No market ID provided');
      return new Response(JSON.stringify({ error: 'Market ID required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    logger.debug('Fetching market info...');
    const marketInfo = await getMarketInfo(marketId);
    if (!marketInfo) {
      logger.error(`Market not found: ${marketId}`);
      return new Response(JSON.stringify({ error: 'Market not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    logger.debug('Market info retrieved:', marketInfo);

    logger.debug('Generating root question...');
    const root = await generateRootQuestion(marketInfo);
    if (!root) {
      logger.error('Failed to generate root question');
      return new Response(JSON.stringify({ error: 'Failed to generate root question' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    logger.debug('Root question generated:', root);

    const treeData: QANode = {
      question: root.question,
      answer: root.answer,
      children: []
    };

    async function populateChildren(node: QANode, depth: number) {
      logger.debug(`Populating children at depth ${depth}`, {
        parentQuestion: node.question,
        currentDepth: depth,
        maxDepth
      });
      
      if (depth >= maxDepth) {
        logger.debug('Max depth reached, stopping branch');
        return;
      }

      logger.debug('Generating sub-questions for:', node.question);
	  
	  
	 const subQuestions = await generateSubQuestions(
        { question: node.question, answer: node.answer },
        marketInfo,
        nodesPerLayer
      );

      if (subQuestions) {
        node.children = Array.isArray(subQuestions) ? subQuestions : [subQuestions];
        for (const child of node.children) {
          await populateChildren(child, depth + 1);
        }
      }
    }

    logger.debug('Saving tree to database...');
    const treeId = await saveQaTree(session.user.sub, marketId, treeData);
    logger.info(`Tree saved successfully with ID: ${treeId}`);

    return new Response(JSON.stringify({ treeId }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    logger.error('Error generating QA tree:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return new Response(JSON.stringify({ 
      error: 'Failed to generate QA tree',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  } finally {
    const elapsedTime = (performance.now() - startTime) / 1000;
    logger.info(`QA tree generation request completed in ${elapsedTime.toFixed(2)}s`);
  }
}
