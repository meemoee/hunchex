import { handleAuth } from '@auth0/nextjs-auth0/edge';

export const runtime = 'edge';

const authHandler = handleAuth();

export async function GET(request: Request) {
  try {
    // Get the auth path from the URL instead of params
    const url = new URL(request.url);
    const authPath = url.pathname.split('/').pop() || '';
    
    // Create a context object with the auth path
    const ctx = {
      params: { auth0: authPath }
    };
    
    const response = await authHandler(request, ctx);
    return response;
  } catch (error) {
    console.error('Auth error:', error);
    return new Response(
      JSON.stringify({ error: 'Authentication failed' }), 
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}