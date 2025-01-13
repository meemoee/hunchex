import { NextResponse } from 'next/dist/server/web/spec-extension/response';

export const runtime = 'edge';

function parseAuthCookie(cookieString: string | null): { code_verifier?: string, state?: string } {
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
    const url = new URL(request.url);
    const headersList = Object.fromEntries(request.headers);
    const cookieData = parseAuthCookie(request.headers.get('cookie'));
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    
    // Debug info before token exchange
    const preflightDebug = {
      code_details: {
        code: code?.substring(0, 10) + '...',
        code_length: code?.length,
        state: state,
        cookie_state: cookieData.state,
        states_match: state === cookieData.state
      },
      verifier_details: {
        code_verifier: cookieData.code_verifier?.substring(0, 10) + '...',
        verifier_length: cookieData.code_verifier?.length
      }
    };

    if (!cookieData.code_verifier) {
      return NextResponse.json({
        error: 'No code_verifier found in auth cookie',
        debug: preflightDebug
      }, { status: 400 });
    }

    if (!code) {
      return NextResponse.json({
        error: 'No code found in URL',
        debug: preflightDebug
      }, { status: 400 });
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('client_id', process.env.AUTH0_CLIENT_ID!);
    params.set('client_secret', process.env.AUTH0_CLIENT_SECRET!);
    params.set('code', code);
    params.set('code_verifier', cookieData.code_verifier);
    params.set('redirect_uri', `${process.env.AUTH0_BASE_URL}/api/auth/callback`);

    const tokenRequest = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: params
    });

    const tokenResponse = await tokenRequest.json();

    return NextResponse.json({
      flowCheck: {
        phase: 'token_exchange',
        debug: preflightDebug,
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