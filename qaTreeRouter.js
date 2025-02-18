// qaTreeRouter.js
const express = require('express');
const router = express.Router();
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);

router.get('/qa-trees', async (req, res) => {
    console.log('QA Trees Request Details:', {
        auth0Id: req.headers['x-user-id'],
        marketId: req.query.marketId,
        fullHeaders: req.headers
    });

    try {
        const auth0Id = req.headers['x-user-id'];
        const marketId = req.query.marketId;

        if (!auth0Id) {
            console.error('Missing auth0Id in request headers');
            return res.status(401).json({ error: 'Unauthorized - User ID required' });
        }

        if (!marketId) {
            console.error('Missing marketId in request query');
            return res.status(400).json({ error: 'Market ID is required' });
        }

        const trees = await sql`
            SELECT 
                id as tree_id, 
                market_id, 
                title, 
                tree_data, 
                created_at, 
                updated_at
            FROM qa_trees 
            WHERE 
                auth0_id = ${auth0Id} 
                AND market_id = ${marketId}
            ORDER BY updated_at DESC
        `;

        console.log('QA Trees Query Results:', {
            treeCount: trees.length,
            firstTree: trees[0]
        });

        res.json(trees);
    } catch (error) {
        console.error('Error in QA trees route:', error);
        res.status(500).json({ 
            error: 'Internal Server Error', 
            details: error.message 
        });
    }
});

// Get a specific QA tree
router.get('/qa-trees/:id', async (req, res) => {
    try {
        const auth0Id = req.headers['x-user-id'];
        if (!auth0Id) {
            return res.status(401).json({ error: 'Unauthorized - User ID required' });
        }

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
    try {
        const auth0Id = req.headers['x-user-id'];
        if (!auth0Id) {
            return res.status(401).json({ error: 'Unauthorized - User ID required' });
        }

        const { marketId, treeData, title } = req.body;
        if (!marketId || !treeData) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        const result = await sql`
            INSERT INTO qa_trees (auth0_id, market_id, tree_data, title)
            VALUES (${auth0Id}, ${marketId}, ${treeData}, ${title})
            RETURNING id
        `;

        res.json({ id: result[0].id });
    } catch (error) {
        console.error('Error saving QA tree:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// Update a QA tree
router.put('/qa-trees/:id', async (req, res) => {
    try {
        const auth0Id = req.headers['x-user-id'];
        if (!auth0Id) {
            return res.status(401).json({ error: 'Unauthorized - User ID required' });
        }

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
        const auth0Id = req.headers['x-user-id'];
        if (!auth0Id) {
            return res.status(401).json({ error: 'Unauthorized - User ID required' });
        }

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
