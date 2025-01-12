// src/app/api/qa-trees/route.ts
import { getSession } from '@auth0/nextjs-auth0/edge';
import { neon } from '@neondatabase/serverless';

export const runtime = 'edge';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: Request) {
  console.log('=== GET /api/qa-trees START ===');
  
  try {
    const session = await getSession();
    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');

    if (!marketId) {
      return new Response(JSON.stringify({ 
        error: 'Market ID required'
      }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const trees = await sql`
      SELECT 
        id, 
        auth0_id,
        market_id, 
        title, 
        tree_data,
        created_at,
        updated_at
      FROM qa_trees 
      WHERE auth0_id = ${session.user.sub}
        AND market_id = ${marketId}
      ORDER BY updated_at DESC
    `;

    console.log('Retrieved trees:', {
      count: trees.length,
      firstTreeId: trees[0]?.id
    });

    return new Response(JSON.stringify(trees), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error fetching QA trees:', error);
    return new Response(JSON.stringify({ 
      error: 'Failed to fetch QA trees',
      details: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}