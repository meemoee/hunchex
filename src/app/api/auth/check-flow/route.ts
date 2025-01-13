import { NextResponse } from 'next/dist/server/web/spec-extension/response';

export const runtime = 'edge';

function parseAuthCookie(cookieString: string | null): { code_verifier?: string } {
  if (!cookieString) return {};
  const authCookie = cookieString.split(';').find(c => c.trim().startsWith('auth_verification='));
  if (!authCookie) return {};
  
  try {
    const [, value] = authCookie.split('=');
    const decodedValue = decodeURIComponent(value);
    const [verificationData] = decodedValue.split('.');
    return JSON.parse(verificationData);
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  try {
    const headersList = Object.fromEntries(request.headers);
    const cookieData = parseAuthCookie(request.headers.get('cookie'));
    
    if (!cookieData.code_verifier) {
      return NextResponse.json({
        error: 'No code_verifier found in auth cookie',
        cookie_data: cookieData
      }, { status: 400 });
    }

    const tokenRequest = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        code: new URL(request.url).searchParams.get('code') || '',
        code_verifier: cookieData.code_verifier,
        redirect_uri: `${process.env.AUTH0_BASE_URL}/api/auth/callback`
      })
    });

    const tokenResponse = await tokenRequest.json();

    return NextResponse.json({
      flowCheck: {
        phase: 'token_exchange',
        code_present: !!new URL(request.url).searchParams.get('code'),
        code_verifier_present: !!cookieData.code_verifier,
        response: tokenResponse,
        headers: headersList,
        config: {
          redirect_uri: `${process.env.AUTH0_BASE_URL}/api/auth/callback`,
          issuer: process.env.AUTH0_ISSUER_BASE_URL,
          client_type: 'spa'
        }
      }
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      phase: 'token_exchange_error',
      headers: Object.fromEntries(request.headers)
    }, { status: 500 });
  }
}