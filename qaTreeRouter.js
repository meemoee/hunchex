// qaTreeRouter.js
const express = require('express');
const { auth } = require('express-oauth2-jwt-bearer');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const { logger, authLoggingMiddleware } = require('./authLogger');
const sql = neon(process.env.DATABASE_URL);

// Auth0 JWT validation middleware
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER,
  tokenSigningAlg: 'RS256'
});

// Error handling for Auth0 middleware
const handleAuth0Errors = (err, req, res, next) => {
  logger.error('Auth0 Error:', err);
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({ 
      error: 'Invalid token',
      details: err.message 
    });
  }
  next(err);
};

// Apply JWT check middleware and logging to all routes
router.use(checkJwt);
router.use(authLoggingMiddleware);
router.use(handleAuth0Errors);

// Get all QA trees for a user
router.get('/qa-trees', async (req, res) => {
    const startTime = Date.now();
    logger.debug('GET /qa-trees - Request received', {
        headers: req.headers,
        query: req.query,
        params: req.params,
        url: req.originalUrl,
        method: req.method,
        path: req.path
    });
    
    try {
        const auth0Id = req.auth.sub;
        const marketId = req.query.marketId;

        logger.debug('MarketId debug info:', {
            rawMarketId: req.query.marketId,
            trimmedMarketId: marketId?.trim(),
            typeof: typeof marketId,
            isEmpty: marketId === '',
            isNull: marketId === null,
            isUndefined: marketId === undefined
        });

        if (!marketId) {
            logger.debug('No marketId provided, returning all trees');
        } else {
            logger.debug('Filtering trees by marketId:', marketId);
        }
        
        logger.debug('Authentication details:', {
            auth: JSON.stringify(req.auth, null, 2),
            timestamp: new Date().toISOString(),
            endpoint: '/qa-trees',
            method: 'GET',
            marketId
        });

        const queryStartTime = Date.now();
        logger.debug('Starting SQL query for user', {
            auth0Id,
            marketId,
            timestamp: new Date().toISOString(),
            queryStartTime,
            sqlFilters: {
                auth0_id: auth0Id,
                marketId: marketId || 'no filter'
            }
        });
        
        // Log received marketId details
        logger.debug('MarketId details:', {
            received: marketId,
            receivedType: typeof marketId,
            trimmed: marketId?.trim(),
            trimmedType: typeof marketId?.trim()
        });

        const conditions = [];
        conditions.push(sql`auth0_id = ${auth0Id}`);
        
        if (marketId) {
            // Exact match for market_id when provided
            conditions.push(sql`market_id = ${marketId.toString().trim()}`);
        } else {
            // Return only records with null market_id when no marketId provided
            conditions.push(sql`market_id IS NULL`);
        }

        logger.debug('SQL conditions:', {
            conditions: conditions.map(c => c.sql()),
            marketIdPresent: !!marketId,
            appliedConditions: conditions.length
        });

        const queryString = sql`
            SELECT id, market_id, tree_data, title, created_at, updated_at 
            FROM qa_trees 
            WHERE ${sql.join(conditions, sql` AND `)}
            ORDER BY updated_at DESC
        `;
        
        logger.debug('Running SQL query:', { 
            sqlString: await queryString.sql()
        });
        
        const trees = await queryString;
        
        const queryDuration = Date.now() - queryStartTime;
        logger.debug('SQL query completed', {
            timestamp: new Date().toISOString(),
            duration: queryDuration,
            treeCount: trees.length,
            auth0Id
        });

        // Log detailed information about each tree
        trees.forEach((tree, index) => {
            logger.debug(`Tree ${index + 1} details:`, {
                timestamp: new Date().toISOString(),
                treeId: tree.id,
                marketId: tree.market_id,
                title: tree.title,
                created: tree.created_at,
                updated: tree.updated_at,
                dataSize: JSON.stringify(tree.tree_data).length,
                auth0Id
            });
        });
        
        const totalDuration = Date.now() - startTime;
        console.log(`[${new Date().toISOString()}] Sending response - Total duration: ${totalDuration}ms`);
        res.json(trees);
    } catch (error) {
        logger.error('Error fetching QA trees:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            requestId: Date.now().toString(36)
        });
    }
});

// Get a specific QA tree
router.get('/qa-trees/:id', async (req, res) => {
    try {
        const auth0Id = req.auth.sub;

        const { id } = req.params;
        const trees = await sql`
            SELECT id, market_id, tree_data, title, created_at, updated_at 
            FROM qa_trees 
            WHERE id = ${id} AND auth0_id = ${auth0Id}
        `;

        if (trees.length === 0) {
            return res.status(404).json({ error: 'QA tree not found' });
        }

        res.json(trees[0]);
    } catch (error) {
        console.error('Error fetching QA tree:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Save a new QA tree
router.post('/qa-trees', async (req, res) => {
    const startTime = Date.now();
    logger.debug('POST /qa-trees - Request received', {
        timestamp: new Date().toISOString(),
        endpoint: '/qa-trees',
        method: 'POST'
    });

    try {
        const auth0Id = req.auth.sub;
        logger.debug('Authentication details for save:', {
            auth: JSON.stringify(req.auth, null, 2),
            timestamp: new Date().toISOString()
        });

        const { marketId, treeData, title } = req.body;
        logger.debug('Received tree data:', {
            timestamp: new Date().toISOString(),
            auth0Id,
            marketId,
            title,
            treeDataSize: JSON.stringify(treeData).length,
            treeStructure: JSON.stringify(treeData, null, 2)
        });

        if (!marketId || !treeData) {
            logger.error('Missing required fields:', {
                timestamp: new Date().toISOString(),
                auth0Id,
                hasMarketId: !!marketId,
                hasTreeData: !!treeData
            });
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await sql`
            INSERT INTO qa_trees (auth0_id, market_id, tree_data, title)
            VALUES (${auth0Id}, ${marketId}, ${treeData}, ${title})
            RETURNING id
        `;

        const endTime = Date.now();
        logger.debug('Tree successfully saved:', {
            timestamp: new Date().toISOString(),
            duration: endTime - startTime,
            treeId: result[0].id,
            auth0Id,
            marketId
        });
        
        res.json({ id: result[0].id });
    } catch (error) {
        logger.error('Error saving QA tree:', {
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack,
            auth0Id: req.auth?.sub,
            marketId: req.body?.marketId
        });
        res.status(500).json({ 
            error: 'Internal Server Error',
            requestId: Date.now().toString(36)
        });
    }
});

// Update a QA tree
router.put('/qa-trees/:id', async (req, res) => {
    try {
        const auth0Id = req.auth.sub;

        const { id } = req.params;
        const { treeData, title } = req.body;
        if (!treeData) {
            return res.status(400).json({ error: 'Missing tree data' });
        }

        const result = await sql`
            UPDATE qa_trees 
            SET tree_data = ${treeData}, 
                title = ${title},
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ${id} AND auth0_id = ${auth0Id}
            RETURNING id
        `;

        if (result.length === 0) {
            return res.status(404).json({ error: 'QA tree not found or unauthorized' });
        }

        res.json({ id: result[0].id });
    } catch (error) {
        console.error('Error updating QA tree:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Delete a QA tree
router.delete('/qa-trees/:id', async (req, res) => {
    try {
        const auth0Id = req.auth.sub;

        const { id } = req.params;
        const result = await sql`
            DELETE FROM qa_trees 
            WHERE id = ${id} AND auth0_id = ${auth0Id}
            RETURNING id
        `;

        if (result.length === 0) {
            return res.status(404).json({ error: 'QA tree not found or unauthorized' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting QA tree:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

module.exports = router;
