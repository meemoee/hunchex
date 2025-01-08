const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');
const fetch = require('node-fetch');

// Logger setup
const logger = {
  debug: (...args) => console.log(new Date().toISOString(), '- DEBUG -', ...args),
  error: (...args) => console.error(new Date().toISOString(), '- ERROR -', ...args)
};

// Constants
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
// System prompts
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

// Database functions
async function getMarketInfo(sql, marketId) {
  logger.debug(`\nFetching market info for ID: ${marketId}`);
  try {
    const result = await sql`
      SELECT m.*, e.title as event_title 
      FROM markets m
      JOIN events e ON m.event_id = e.id
      WHERE m.id = ${marketId}
    `;
    const marketInfo = result[0];
    
    if (marketInfo) {
      Object.entries(marketInfo).forEach(([key, value]) => {
        if (value instanceof Date) {
          marketInfo[key] = value.toISOString();
        }
      });
    }
    
    return marketInfo;
  } catch (error) {
    logger.error("Error fetching market info:", error);
    throw error;
  }
}

// API interaction functions
async function parseWithGemini(content) {
  if (!content) return null;

  console.log("\n--- GEMINI PARSING START ---");

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
    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json"
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
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });

    if (!response.ok) return null;

    let collectedContent = [];
    let buffer = '';

    // Read the response as a stream of Uint8Arrays
    for await (const chunk of response.body) {
      buffer += new TextDecoder().decode(chunk, { stream: true });
      let newlineIndex;
      
      // Process each complete line in the buffer
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
              process.stdout.write(content);
              collectedContent.push(content);
            }
          } catch (error) {
            continue;
          }
        }
      }
    }

    const fullResponse = collectedContent.join('');
    
    try {
      const parsed = JSON.parse(fullResponse);
      return parsed.qa_pairs || [];
    } catch (error) {
      return null;
    }
  } catch (error) {
    console.error("Gemini parsing error:", error);
    return null;
  }
}

async function generateRootQuestion(marketInfo) {
  const prompt = `
CORE MARKET INSIGHT EXTRACTION:

MARKET CONTEXT:
Title: ${marketInfo.question}
Description: ${marketInfo.description}
Event: ${marketInfo.event_title}

INSTRUCTION: 
GENERATE A PRECISE, VERBATIM QUESTION CAPTURING THE FUNDAMENTAL MARKET UNCERTAINTY`;

  return await generateOpenrouterResponse(prompt);
}

async function generateSubQuestions(parentQuestion, marketInfo, depth = 0, maxDepth = 2, nodesPerLayer = 3) {
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

  return await generateOpenrouterResponse(prompt);
}

async function generateOpenrouterResponse(prompt, model = "perplexity/llama-3.1-sonar-large-128k-online") {
  const headers = {
    "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Market Analysis QA Tree Generator"
  };

  const data = {
    model,
    messages: [
      {
        role: "system",
        content: PERPLEXITY_SYSTEM_PROMPT.replace("{date}", new Date().toISOString().split('T')[0])
      },
      { role: "user", content: prompt }
    ],
    stream: true,
    max_tokens: 4000,
    temperature: 0.5
  };

  try {
    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(data)
    });

    if (!response.ok) return null;

    let collectedContent = [];
    
    // Get the raw response text
    const text = await response.text();
    // Split into lines
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
          continue;
        }
      }
    }

    const fullResponse = collectedContent.join('');
    const parsedQaPairs = await parseWithGemini(fullResponse);

    if (parsedQaPairs) {
      return parsedQaPairs.length === 1 ? parsedQaPairs[0] : parsedQaPairs;
    }

    return null;
  } catch (error) {
    logger.error("Request Error:", error);
    return null;
  }
}

async function saveQaTree(sql, auth0UserId, marketId, treeData) {
  try {
    await sql`BEGIN`;
    
    const treeId = crypto.randomUUID();
    
    await sql`
      INSERT INTO qa_trees (tree_id, user_id, market_id, title, description)
      VALUES (
        ${treeId},
        ${auth0UserId},
        ${marketId},
        ${`Analysis Tree for ${marketId}`},
        ${"Automatically generated analysis tree"}
      )
    `;

    async function saveNode(nodeData, parentId = null) {
      const nodeId = crypto.randomUUID();

      await sql`
        INSERT INTO qa_nodes (node_id, tree_id, question, answer, created_by)
        VALUES (
          ${nodeId},
          ${treeId},
          ${nodeData.question || ''},
          ${nodeData.answer || ''},
          ${auth0UserId}
        )
      `;

      if (parentId) {
        await sql`
          INSERT INTO qa_node_relationships (parent_node_id, child_node_id, tree_id)
          VALUES (${parentId}, ${nodeId}, ${treeId})
        `;
      }

      return nodeId;
    }

    const rootNodeId = await saveNode(treeData);

    async function saveChildren(nodeData, parentId) {
      if (nodeData.children?.length) {
        for (const child of nodeData.children) {
          const childId = await saveNode(child, parentId);
          await saveChildren(child, childId);
        }
      }
    }

    await saveChildren(treeData, rootNodeId);
    await sql`COMMIT`;
    
    return treeId;
  } catch (error) {
    await sql`ROLLBACK`;
    throw error;
  }
}

async function generateQaTree(sql, marketId, userId, maxDepth = 2) {
  const marketInfo = await getMarketInfo(sql, marketId);
  if (!marketInfo) {
    throw new Error(`Market not found: ${marketId}`);
  }

  const root = await generateRootQuestion(marketInfo);
  if (!root) {
    throw new Error("Failed to generate root question");
  }

  const treeData = {
    question: root.question,
    answer: root.answer,
    children: []
  };

  async function populateChildren(node, depth = 0) {
    if (depth >= maxDepth) return;

    const subQuestions = await generateSubQuestions(
      { question: node.question, answer: node.answer },
      marketInfo,
      depth,
      maxDepth
    );

    if (subQuestions) {
      node.children = Array.isArray(subQuestions) ? subQuestions : [subQuestions];
      for (const child of node.children) {
        await populateChildren(child, depth + 1);
      }
    }
  }

  await populateChildren(treeData);
  return await saveQaTree(sql, userId, marketId, treeData);
}

// Parse command line arguments
const args = process.argv.slice(2);
const marketId = args[0];
const maxDepth = parseInt(args[1]) || 2;
const nodesPerLayer = parseInt(args[2]) || 3;
const userId = 'google-oauth2|118350871750711913024';

if (!marketId) {
  console.error('Usage: node makeQAtree.js <marketId> [maxDepth] [nodesPerLayer]');
  process.exit(1);
}

// Main execution
async function main() {
  try {
    const sql = neon(process.env.DATABASE_URL);
    const treeId = await generateQaTree(sql, marketId, userId, maxDepth, nodesPerLayer);
    console.log('Successfully generated QA tree with ID:', treeId);
  } catch (error) {
    console.error('Error generating QA tree:', error);
    process.exit(1);
  }
}

main();
