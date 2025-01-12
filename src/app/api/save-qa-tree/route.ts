import { db } from '@/app/db';
import { getSession } from '@auth0/nextjs-auth0/edge';
import { qa_trees } from '@/app/db/schema';

export const runtime = 'edge';

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session?.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const userId = session.user.sub;
    const { marketId, treeData, title = `Analysis Tree for Market ${marketId}` } = await request.json();
    
    if (!marketId || !treeData) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const now = new Date();
    const [result] = await db.insert(qa_trees)
      .values({
        auth0_id: userId,
        market_id: marketId,
        title,
        tree_data: treeData,
        created_at: now,
        updated_at: now
      })
      .returning({ id: qa_trees.id });

    return new Response(JSON.stringify({ id: result.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Error saving QA tree:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}