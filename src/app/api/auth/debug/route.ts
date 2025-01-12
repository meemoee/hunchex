export async function GET(request: Request) {
  // Move isAdmin check outside try/catch so it's accessible in both blocks
  const authHeader = request.headers.get('authorization');
  const isAdmin = authHeader === process.env.DEBUG_ADMIN_TOKEN;

  try {
    const debugInfo = {
      environment: {
        // List all env variables (just names, not values)
        variables: Object.keys(process.env).filter(key => key.startsWith('AUTH0_') || key.startsWith('NEXT_') || key.startsWith('VERCEL_')),
        // Existing checks but with more detail
        auth0: {
          hasBaseUrl: !!process.env.AUTH0_BASE_URL,
          hasIssuerBaseUrl: !!process.env.AUTH0_ISSUER_BASE_URL,
          hasClientId: !!process.env.AUTH0_CLIENT_ID,
          hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
          hasSecret: !!process.env.AUTH0_SECRET,
          // Only show URLs if admin
          ...(isAdmin && {
            baseUrl: process.env.AUTH0_BASE_URL,
            issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL,
          })
        },
        // Add runtime info
        runtime: {
          nodeEnv: process.env.NODE_ENV,
          nodeVersion: process.version,
          platform: process.platform,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          memory: process.memoryUsage(),
        }
      },
      // Add connection tests
      connections: {
        database: await testDatabaseConnection(),
        auth0: await testAuth0Connection(),
      },
      // Add build info
      build: {
        timestamp: new Date().toISOString(),
        vercelEnv: process.env.VERCEL_ENV || 'local',
        deploymentUrl: process.env.VERCEL_URL || 'localhost',
      }
    };

    return new Response(JSON.stringify(debugInfo, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    // Type guard for Error objects
    const errorMessage = error instanceof Error 
      ? error.message 
      : 'An unknown error occurred';
    
    const errorStack = error instanceof Error 
      ? error.stack 
      : undefined;

    return new Response(JSON.stringify({
      error: {
        message: errorMessage,
        stack: isAdmin ? errorStack : undefined,
        timestamp: new Date().toISOString()
      }
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Helper functions (implement these based on your setup)
async function testDatabaseConnection() {
  try {
    // Add your database connection test here
    return { status: 'connected' };
  } catch (error) {
    return { 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Unknown database error' 
    };
  }
}

async function testAuth0Connection() {
  try {
    // Add your Auth0 connection test here
    return { status: 'connected' };
  } catch (error) {
    return { 
      status: 'error', 
      message: error instanceof Error ? error.message : 'Unknown Auth0 error' 
    };
  }
}