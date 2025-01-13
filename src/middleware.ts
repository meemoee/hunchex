import { NextResponse } from 'next/dist/server/web/spec-extension/response';
import type { NextRequest } from 'next/dist/server/web/spec-extension/request';
import { getSession } from '@auth0/nextjs-auth0/edge';

export const config = {
  matcher: [
    '/((?!api/auth|_next/static|_next/image|favicon.ico).*)',
  ],
};

export default async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/_next') || req.nextUrl.pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  try {
    const session = await getSession();  // Remove req parameter for edge runtime
    if (!session?.user) {
      return new NextResponse(
        JSON.stringify({ error: 'Not authenticated' }), 
        { 
          status: 401,
          headers: { 'content-type': 'application/json' }
        }
      );
    }
    return NextResponse.next();
  } catch (e) {
    console.error('Auth middleware error:', e);
    return new NextResponse(
      JSON.stringify({ error: 'Authentication failed' }), 
      { 
        status: 401,
        headers: { 'content-type': 'application/json' }
      }
    );
  }
}