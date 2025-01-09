import { neon } from '@neondatabase/serverless';
import { getSession } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

const sql = neon(process.env.DATABASE_URL!);

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.sub;
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('marketId');

    console.log('Request details:', {
      userId,
      marketId,
      url: request.url,
      timestamp: new Date().toISOString()
    });

    // Build SQL conditions
    const conditions = [];
    conditions.push(sql`auth0_id = ${userId}`);

    if (marketId) {
      const cleanMarketId = marketId.toString().trim();
      console.log('Market ID condition:', {
        original: marketId,
        cleaned: cleanMarketId,
        isNumeric: /^\d+$/.test(cleanMarketId)
      });
      conditions.push(sql`CAST(market_id AS text) = CAST(${cleanMarketId} AS text)`);
    } else {
      conditions.push(sql`market_id IS NULL`);
    }

    console.log('SQL conditions:', {
      conditionCount: conditions.length,
      hasMarketId: !!marketId
    });

    const queryString = sql`
      SELECT 
        id as tree_id,
        market_id, 
        tree_data, 
        title, 
        created_at, 
        updated_at
      FROM qa_trees 
      WHERE ${sql.join(conditions, sql` AND `)}
      ORDER BY updated_at DESC
    `;

    console.log('Executing query with conditions:', {
      userId,
      marketId,
      timestamp: new Date().toISOString()
    });

    const trees = await queryString;

    console.log('Query results:', {
      count: trees.length,
      marketIds: trees.map(t => t.market_id),
      userId,
      timestamp: new Date().toISOString()
    });

    return NextResponse.json(trees);
  } catch (error) {
    console.error('Error in GET /api/qa-trees:', error);
    return NextResponse.json({ 
      error: 'Internal Server Error',
      message: error instanceof Error ? error.message : 'Unknown error',
      requestId: Date.now().toString(36)
    }, { 
      status: 500 
    });
  }
}
