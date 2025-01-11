// src/app/api/qa-trees/route.ts
import { NextResponse } from 'next/server';
import { getSession } from '@auth0/nextjs-auth0/edge';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: Request) {
  console.log('=== GET /api/qa-trees START ===');
  
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');

    if (!marketId) {
      return NextResponse.json({ 
        error: 'Market ID required'
      }, { status: 400 });
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

    return NextResponse.json(trees);
  } catch (error) {
    console.error('Error fetching QA trees:', error);
    return NextResponse.json({ 
      error: 'Failed to fetch QA trees',
      details: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}