import { getSession } from '@auth0/nextjs-auth0/edge';
import { neon } from '@neondatabase/serverless';

export const runtime = 'edge';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(
  request: Request, 
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  console.log('=== GET /api/qa-trees/[id] START ===', {
    treeId: id
  });

  try {
    const session = await getSession();
    
    if (!session?.user) {
      console.log('No authenticated user found');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = session.user.sub;
    const treeId = id;
    
    console.log('Loading tree:', { treeId, userId });
    const treeResult = await sql`
      SELECT 
        id, 
        auth0_id, 
        market_id, 
        title, 
        tree_data,
        created_at
      FROM qa_trees 
      WHERE id = ${treeId} AND auth0_id = ${userId}
    `;

    if (treeResult.length === 0) {
      console.log('No tree found or unauthorized access');
      return new Response(JSON.stringify({ error: 'Tree not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const treeData = treeResult[0].tree_data;
    
    console.log('Loaded tree data:', {
      treeId: treeResult[0].id,
      marketId: treeResult[0].market_id,
      title: treeResult[0].title
    });

    return new Response(JSON.stringify(treeData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching QA tree:', {
      error: error instanceof Error ? error.message : String(error),
      treeId: id
    });

    return new Response(JSON.stringify({ 
      error: 'Failed to fetch QA tree', 
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}