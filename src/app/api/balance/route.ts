import { getSession } from "@auth0/nextjs-auth0/edge";
import { db } from "@/app/db";
import { users } from "@/app/db/schema";
import { eq } from "drizzle-orm";

interface UserSession {
  user: {
    sub: string;
    email: string;
    name?: string;
  }
}

async function getOrCreateUser(session: UserSession) {
  let user = await db.query.users.findFirst({
    where: eq(users.auth0_id, session.user.sub)
  });

  if (!user) {
    const [newUser] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        auth0_id: session.user.sub,
        email: session.user.email,
        name: session.user.name || '',
        balance: '0'
      })
      .returning();
    user = newUser;
  }

  return user;
}

export const runtime = 'edge';

export async function GET() {
  try {
    const session = (await getSession()) as UserSession | null;
    
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await getOrCreateUser(session);
    return new Response(JSON.stringify({ balance: user.balance }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Balance retrieval error:', error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

export async function PUT(request: Request) {
  try {
    const session = (await getSession()) as UserSession | null;
    
    if (!session?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { 
        status: 401,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const { amount, operation } = await request.json();
    
    if (typeof amount !== 'number' || !['increase', 'decrease'].includes(operation)) {
      return new Response(JSON.stringify({ error: "Invalid request body" }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const user = await getOrCreateUser(session);
    
    const currentBalance = parseFloat(user.balance?.toString() || '0');
    const newBalance = operation === 'increase' 
      ? currentBalance + amount 
      : currentBalance - amount;

    if (newBalance < 0) {
      return new Response(JSON.stringify({ error: "Insufficient balance" }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    await db
      .update(users)
      .set({ 
        balance: newBalance.toFixed(2),
        updated_at: new Date()
      })
      .where(eq(users.auth0_id, session.user.sub));

    return new Response(JSON.stringify({ balance: newBalance }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error('Balance update error:', error);
    return new Response(JSON.stringify({ error: "Internal Server Error" }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}