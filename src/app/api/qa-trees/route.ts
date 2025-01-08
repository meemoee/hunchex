import { db } from '@/app/db';
import { getSession } from '@auth0/nextjs-auth0';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.sub;
    
    // Query to get all QA trees for the user
    const trees = await db.query(
      'SELECT id, market_id, tree_data, title, created_at, updated_at FROM qa_trees WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );

    return NextResponse.json(trees);
  } catch (error) {
    console.error('Error fetching QA trees:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.sub;
    const body = await request.json();
    
    const { marketId, treeData, title } = body;
    
    if (!marketId || !treeData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Save the QA tree
    const result = await db.query(
      'INSERT INTO qa_trees (user_id, market_id, tree_data, title) VALUES ($1, $2, $3, $4) RETURNING id',
      [userId, marketId, treeData, title]
    );

    return NextResponse.json({ id: result[0].id });
  } catch (error) {
    console.error('Error saving QA tree:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// PUT endpoint for updating a QA tree
export async function PUT(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.sub;
    const body = await request.json();
    const { id, treeData, title } = body;
    
    if (!id || !treeData) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Update the QA tree
    const result = await db.query(
      'UPDATE qa_trees SET tree_data = $1, title = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3 AND user_id = $4 RETURNING id',
      [treeData, title, id, userId]
    );

    if (result.length === 0) {
      return NextResponse.json({ error: 'QA tree not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({ id: result[0].id });
  } catch (error) {
    console.error('Error updating QA tree:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE endpoint for removing a QA tree
export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.sub;
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'Missing tree ID' }, { status: 400 });
    }

    // Delete the QA tree
    const result = await db.query(
      'DELETE FROM qa_trees WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.length === 0) {
      return NextResponse.json({ error: 'QA tree not found or unauthorized' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting QA tree:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}