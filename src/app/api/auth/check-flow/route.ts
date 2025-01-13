import { NextResponse } from 'next/dist/server/web/spec-extension/response';


export const runtime = 'edge';

export async function GET(request: Request) {
  try {
    const headersList = Object.fromEntries(request.headers);

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
        redirect_uri: `${process.env.AUTH0_BASE_URL}/api/auth/callback`
      })
    });

    const tokenResponse = await tokenRequest.json();

    return NextResponse.json({
      flowCheck: {
        phase: 'token_exchange',
        code_present: !!new URL(request.url).searchParams.get('code'),
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