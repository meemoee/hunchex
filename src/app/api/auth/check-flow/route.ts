import { NextResponse } from 'next/dist/server/web/spec-extension/response';

export const runtime = 'edge';

// Define JWT types
interface JWTHeader {
  alg: string;
  typ: string;
}

// Add this interface for the parsed verification data
interface VerificationData {
  code_verifier: string;
  [key: string]: unknown;
}

interface JWTPayload {
  sub?: string;
  iat?: number;
  exp?: number;
  aud?: string | string[];
  iss?: string;
  [key: string]: unknown;
}

interface DecodedJWT {
  header: JWTHeader;
  payload: JWTPayload;
  signature: string;
}

// Define Auth0 token response type
interface Auth0TokenResponse {
  access_token: string;
  id_token?: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

// Update the ParsedAuthCookie interface
interface ParsedAuthCookie {
  raw: string;
  decoded: string;
  verificationData: string;
  signature: string;
  methods: {
    direct: VerificationData | null;
    decoded: unknown;
    base64url: unknown;
    base64: unknown;
  };
  allCookies: Array<{ key: string; value: string }>;
}

interface AuthCookieError {
  error: string;
  details?: string;
  raw?: string;
  allCookies?: Array<{ key: string; value: string }>;
}

// Define state type
interface AuthState {
  nonce?: string;
  redirectUrl?: string;
  [key: string]: unknown;
}

// Define debug info structure
interface DebugInfo {
  request: {
    url: string;
    method: string;
    headers: { [key: string]: string };
    queryParams: { [key: string]: string };
  };
  auth: {
    code: {
      value: string | null;
      length: number | undefined;
      full: string | null;
      isBase64: boolean;
    };
    state: {
      value: string | null;
      decoded: AuthState | null;
      encoded: string | null;
    };
    cookie: ParsedAuthCookie | AuthCookieError;
  };
  environment: {
    baseUrl: string | undefined;
    issuerBaseUrl: string | undefined;
    vercelUrl: string | undefined;
    hasClientId: boolean;
    hasClientSecret: boolean;
    hasSecret: boolean;
    nodeEnv: string | undefined;
  };
  urlAnalysis: {
    pathname: string;
    searchParams: { [key: string]: string };
    origin: string;
    host: string;
  };
  tokenExchange?: {
    request: {
      url: string;
      method: string;
      headers: { [key: string]: string };
      params: { [key: string]: string };
    };
    response: Auth0TokenResponse;
    status: number;
    decodedTokens: {
      access_token: DecodedJWT | null;
      id_token: DecodedJWT | null;
    } | null;
  };
  alternativeFormats?: {
    original: string;
    base64url: string;
    base64: string;
    urlEncoded: string;
  };
}

// Type guard for auth cookie error
function isAuthCookieError(cookie: ParsedAuthCookie | AuthCookieError): cookie is AuthCookieError {
  return 'error' in cookie;
}

function decodeJWT(token: string): DecodedJWT | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return {
      header: JSON.parse(atob(parts[0])),
      payload: JSON.parse(atob(parts[1])),
      signature: parts[2]
    };
  } catch {
    return null;
  }
}

function tryParse<T>(str: string): T | null {
  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

function parseAuthCookie(cookieString: string | null): ParsedAuthCookie | AuthCookieError {
  if (!cookieString) return { error: 'No cookie string provided' };
  
  const allCookies = cookieString.split(';').map(c => {
    const [key, ...rest] = c.trim().split('=');
    return { key, value: rest.join('=') };
  });

  const authCookie = allCookies.find(c => c.key === 'auth_verification');
  if (!authCookie) return { error: 'No auth_verification cookie found', allCookies };

  try {
    const decodedValue = decodeURIComponent(authCookie.value);
    const [verificationData, signature] = decodedValue.split('.');

    // In the tryParse function calls in parseAuthCookie, update to use the proper type:
		const methods = {
		  direct: tryParse<VerificationData>(verificationData),
		  decoded: tryParse<unknown>(atob(verificationData)),
		  base64url: tryParse<unknown>(Buffer.from(verificationData, 'base64url').toString()),
		  base64: tryParse<unknown>(Buffer.from(verificationData, 'base64').toString()),
		};

    return {
      raw: authCookie.value,
      decoded: decodedValue,
      verificationData,
      signature,
      methods,
      allCookies
    };
  } catch (e) {
    return { 
      error: 'Parsing error',
      details: e instanceof Error ? e.message : String(e),
      raw: authCookie.value
    };
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const headersList = Object.fromEntries(request.headers);
    const queryParams = Object.fromEntries(url.searchParams);
    const cookieData = parseAuthCookie(request.headers.get('cookie'));
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');

    // Super verbose debug info
    const debugInfo: DebugInfo = {
      request: {
        url: request.url,
        method: request.method,
        headers: headersList,
        queryParams
      },
      auth: {
        code: {
          value: code ? `${code.substring(0, 10)}...${code.substring(code.length - 10)}` : null,
          length: code?.length,
          full: code,
          isBase64: code ? /^[A-Za-z0-9+/=_-]+$/.test(code) : false
        },
        state: {
          value: state,
          decoded: state ? tryParse<AuthState>(decodeURIComponent(state)) : null,
          encoded: state ? encodeURIComponent(state) : null
        },
        cookie: cookieData
      },
      environment: {
        baseUrl: process.env.AUTH0_BASE_URL,
        issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL,
        vercelUrl: process.env.VERCEL_URL,
        hasClientId: !!process.env.AUTH0_CLIENT_ID,
        hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
        hasSecret: !!process.env.AUTH0_SECRET,
        nodeEnv: process.env.NODE_ENV
      },
      urlAnalysis: {
        pathname: url.pathname,
        searchParams: Object.fromEntries(url.searchParams),
        origin: url.origin,
        host: url.host
      }
    };

    // Try token exchange if we have code and valid cookie data
    if (code && !isAuthCookieError(cookieData) && cookieData.methods.direct?.code_verifier) {
      const params = new URLSearchParams();
      params.set('grant_type', 'authorization_code');
      params.set('client_id', process.env.AUTH0_CLIENT_ID!);
      params.set('client_secret', process.env.AUTH0_CLIENT_SECRET!);
      params.set('code', code);
      params.set('code_verifier', cookieData.methods.direct.code_verifier);
      params.set('redirect_uri', `${process.env.AUTH0_BASE_URL}/api/auth/callback`);

      const tokenRequestInfo = {
        url: `${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`,
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        params: Object.fromEntries(params)
      };

      const tokenRequest = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: params
      });

      const tokenResponse = await tokenRequest.json();

      // Initialize tokenExchange object with all properties
      debugInfo.tokenExchange = {
        request: tokenRequestInfo,
        response: tokenResponse,
        status: tokenRequest.status,
        decodedTokens: tokenResponse.access_token ? {
          access_token: decodeJWT(tokenResponse.access_token),
          id_token: tokenResponse.id_token ? decodeJWT(tokenResponse.id_token) : null
        } : null
      };
    }

    // Try alternative code verifier formats
    if (!isAuthCookieError(cookieData) && cookieData.methods.direct?.code_verifier) {
      debugInfo.alternativeFormats = {
        original: cookieData.methods.direct.code_verifier,
        base64url: Buffer.from(cookieData.methods.direct.code_verifier).toString('base64url'),
        base64: Buffer.from(cookieData.methods.direct.code_verifier).toString('base64'),
        urlEncoded: encodeURIComponent(cookieData.methods.direct.code_verifier)
      };
    }

    return NextResponse.json({
      debug: debugInfo
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      phase: 'error',
      headers: Object.fromEntries(request.headers)
    }, { status: 500 });
  }
}