export const runtime = 'edge';

export async function GET() {
  const envDebug = {
    base_url: process.env.AUTH0_BASE_URL || process.env.VERCEL_URL,
    frontend_url: process.env.FRONTEND_URL,
    vercel_url: process.env.VERCEL_URL,
    auth0_configured: !!(
      process.env.AUTH0_SECRET &&
      process.env.AUTH0_BASE_URL &&
      process.env.AUTH0_ISSUER_BASE_URL &&
      process.env.AUTH0_CLIENT_ID &&
      process.env.AUTH0_CLIENT_SECRET
    )
  };
  
  return new Response(JSON.stringify(envDebug, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};