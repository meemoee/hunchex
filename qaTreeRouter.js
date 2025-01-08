const express = require('express');
const router = express.Router();
const { sql } = require('@neondatabase/serverless');
const { auth } = require('express-oauth2-jwt-bearer');

// Auth0 middleware
const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  issuerBaseURL: process.env.AUTH0_ISSUER_BASE_URL,
  tokenSigningAlg: 'RS256'
});

// Get all QA trees for a user
router.get('/qa-trees', checkJwt, async (req, res) => {
  const userId = req.auth.sub;
  try {
    const result = await sql`
      SELECT tree_id, title, description, created_at
      FROM qa_trees 
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `;
    res.json(result);
  } catch (error) {
    console.error('Error fetching QA trees:', error);
    res.status(500).json({ error: 'Failed to fetch QA trees' });
  }
});

// Get specific QA tree
router.get('/qa-tree/:treeId', checkJwt, async (req, res) => {
  const userId = req.auth.sub;
  const { treeId } = req.params;
  
  try {
    const result = await sql`
      WITH RECURSIVE tree_nodes AS (
        SELECT 
          node_id, 
          tree_id, 
          question, 
          answer, 
          NULL::uuid AS parent_node_id,
          0 AS depth
        FROM qa_nodes 
        WHERE tree_id = ${treeId} 
        AND node_id NOT IN (
          SELECT child_node_id 
          FROM qa_node_relationships 
          WHERE tree_id = ${treeId}
        )
        UNION ALL
        SELECT 
          n.node_id,
          n.tree_id,
          n.question,
          n.answer,
          r.parent_node_id,
          tn.depth + 1
        FROM qa_nodes n
        JOIN qa_node_relationships r ON n.node_id = r.child_node_id
        JOIN tree_nodes tn ON r.parent_node_id = tn.node_id
        WHERE n.tree_id = ${treeId}
      )
      SELECT 
        node_id,
        question,
        answer,
        parent_node_id,
        depth
      FROM tree_nodes
      ORDER BY depth, node_id
    `;
    
    // Reconstruct tree structure
    const nodeMap = new Map();
    const rootNodes = [];

    result.forEach(node => {
      const treeNode = {
        id: node.node_id,
        question: node.question,
        answer: node.answer,
        children: []
      };
      nodeMap.set(node.node_id, treeNode);

      if (!node.parent_node_id) {
        rootNodes.push(treeNode);
      }
    });

    result.forEach(node => {
      if (node.parent_node_id) {
        const parentNode = nodeMap.get(node.parent_node_id);
        const currentNode = nodeMap.get(node.node_id);
        if (parentNode && currentNode) {
          parentNode.children.push(currentNode);
        }
      }
    });

    res.json(rootNodes[0]);
  } catch (error) {
    console.error('Error fetching QA tree:', error);
    res.status(500).json({ error: 'Failed to fetch QA tree' });
  }
});

// Save new QA tree
router.post('/qa-tree', checkJwt, async (req, res) => {
  const userId = req.auth.sub;
  const { marketId, treeData } = req.body;

  try {
    await sql`BEGIN`;
    
    const treeResult = await sql`
      INSERT INTO qa_trees (user_id, market_id, title, description)
      VALUES (
        ${userId},
        ${marketId},
        ${`Analysis Tree for ${marketId}`},
        ${'User-generated QA Tree'}
      )
      RETURNING tree_id
    `;
    const treeId = treeResult[0].tree_id;

    async function insertNode(node, parentNodeId = null) {
      const nodeResult = await sql`
        INSERT INTO qa_nodes (tree_id, question, answer, created_by)
        VALUES (${treeId}, ${node.question}, ${node.answer}, ${userId})
        RETURNING node_id
      `;
      const nodeId = nodeResult[0].node_id;

      if (parentNodeId) {
        await sql`
          INSERT INTO qa_node_relationships (parent_node_id, child_node_id, tree_id)
          VALUES (${parentNodeId}, ${nodeId}, ${treeId})
        `;
      }

      if (node.children?.length) {
        for (const child of node.children) {
          await insertNode(child, nodeId);
        }
      }

      return nodeId;
    }

    await insertNode(treeData);
    await sql`COMMIT`;
    
    res.json({ message: 'QA Tree saved successfully', treeId });
  } catch (error) {
    await sql`ROLLBACK`;
    console.error('Error saving QA tree:', error);
    res.status(500).json({ error: 'Failed to save QA tree' });
  }
});

// Delete QA tree
router.delete('/qa-tree/:treeId', checkJwt, async (req, res) => {
  const userId = req.auth.sub;
  const { treeId } = req.params;

  try {
    await sql`BEGIN`;
    
    await sql`DELETE FROM qa_node_relationships WHERE tree_id = ${treeId}`;
    await sql`DELETE FROM qa_nodes WHERE tree_id = ${treeId}`;
    
    const result = await sql`
      DELETE FROM qa_trees 
      WHERE tree_id = ${treeId} AND user_id = ${userId}
      RETURNING *
    `;

    if (result.length === 0) {
      await sql`ROLLBACK`;
      return res.status(404).json({ error: 'Tree not found or unauthorized' });
    }

    await sql`COMMIT`;
    res.json({ message: 'Tree deleted successfully' });
  } catch (error) {
    await sql`ROLLBACK`;
    console.error('Error deleting QA tree:', error);
    res.status(500).json({ error: 'Failed to delete tree' });
  }
});

// Update QA tree title
router.patch('/qa-tree/:treeId/title', checkJwt, async (req, res) => {
  const userId = req.auth.sub;
  const { treeId } = req.params;
  const { title } = req.body;

  try {
    const result = await sql`
      UPDATE qa_trees 
      SET title = ${title}
      WHERE tree_id = ${treeId} AND user_id = ${userId}
      RETURNING *
    `;

    if (result.length === 0) {
      return res.status(404).json({ error: 'Tree not found or unauthorized' });
    }

    res.json({ message: 'Tree title updated successfully' });
  } catch (error) {
    console.error('Error updating QA tree title:', error);
    res.status(500).json({ error: 'Failed to update tree title' });
  }
});

module.exports = router;
