interface RequestInfo {
  headers: Record<string, string>;
  url: string;
  cookies: string | null;
}

interface TokenExchange {
  status: number;
  response: {
    access_token?: string;
    error?: string;
    error_description?: string;
  };
}

interface ConfigInfo {
  baseUrl?: string;
  frontendUrl?: string;
  vercelUrl?: string;
  issuerUrl?: string;
  audience?: string;
  hasClientId: boolean;
  hasClientSecret: boolean;
  hasSecret: boolean;
}

interface TestResults {
  timestamp: string;
  request: RequestInfo;
  tokenExchange?: TokenExchange;
  config?: ConfigInfo;
  error?: {
    message: string;
    stack?: string;
  };
}

export const runtime = 'edge';

export async function GET(request: Request) {
  const results: TestResults = {
    timestamp: new Date().toISOString(),
    request: {
      headers: Object.fromEntries(request.headers),
      url: request.url,
      cookies: request.headers.get('cookie')
    }
  };

  try {
    const tokenRequest = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.AUTH0_CLIENT_ID!,
        client_secret: process.env.AUTH0_CLIENT_SECRET!,
        audience: process.env.AUTH0_AUDIENCE!
      })
    });

    results.tokenExchange = {
      status: tokenRequest.status,
      response: await tokenRequest.json(),
    };

    results.config = {
      baseUrl: process.env.AUTH0_BASE_URL || process.env.VERCEL_URL,
      frontendUrl: process.env.FRONTEND_URL,
      vercelUrl: process.env.VERCEL_URL,
      issuerUrl: process.env.AUTH0_ISSUER_BASE_URL,
      audience: process.env.AUTH0_AUDIENCE,
      hasClientId: !!process.env.AUTH0_CLIENT_ID,
      hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
      hasSecret: !!process.env.AUTH0_SECRET
    };

  } catch (error) {
    results.error = {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    };
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' }
  });
}