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
    console.log('Fetching trees for user:', userId);
    
    // Query to get all QA trees for the user
    const trees = await sql`
      SELECT 
        id as tree_id,
        market_id, 
        tree_data, 
        title, 
        created_at, 
        updated_at
      FROM qa_trees 
      WHERE auth0_id = ${userId} 
      ORDER BY updated_at DESC
    `;

    console.log('Found trees:', trees.map(t => ({
      tree_id: t.tree_id,
      title: t.title
    })));

    return NextResponse.json(trees);
  } catch (error) {
    console.error('Error fetching QA trees:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}