import { db } from '@/app/db';
import { redis } from '@/app/db/redis';
import { sql } from 'drizzle-orm';
import * as schema from '@/app/db/schema';

interface SQLCountResult {
  count: number;
}

interface DatabaseTableData {
  count: SQLCountResult[];
  hasSampleData: boolean;
}

interface DatabaseResult {
  status: string;
  error?: string;
  data?: DatabaseTableData | { query_failed: boolean };
}

interface RedisOperationData {
  ping?: string;
  writeSuccessful?: boolean;
  deleteSuccessful?: boolean;
}

interface RedisResult {
  status: string;
  error?: string;
  data?: RedisOperationData;
}

interface Auth0EndpointData {
  authenticated: boolean;
  statusCode: number;
}

interface Auth0Result {
  status: string;
  error?: string;
  data?: Auth0EndpointData;
}

interface APIRouteData {
  authenticated: boolean;
  statusCode: number;
  response: unknown;
}

interface APIResult {
  status: string;
  error?: string;
  data?: APIRouteData;
}

export async function GET() {
  async function getAuth0Token() {
    try {
      const response = await fetch(`${process.env.AUTH0_ISSUER_BASE_URL}/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          client_id: process.env.AUTH0_CLIENT_ID,
          client_secret: process.env.AUTH0_CLIENT_SECRET,
          audience: process.env.AUTH0_AUDIENCE,
          grant_type: 'client_credentials'
        })
      });

      if (!response.ok) {
        return {
          success: false,
          error: `Failed to get token: HTTP ${response.status}`,
          details: await response.text()
        };
      }

      const data = await response.json();
      return {
        success: true,
        token: data.access_token
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error getting token'
      };
    }
  }

  async function testDatabaseTables() {
    const results: Record<string, DatabaseResult> = {};
    
    try {
      const tables = [
        { name: 'qa_trees', schema: schema.qa_trees },
        { name: 'users', schema: schema.users },
        { name: 'holdings', schema: schema.holdings },
        { name: 'orders', schema: schema.orders },
        { name: 'markets', schema: schema.markets },
        { name: 'market_prices', schema: schema.market_prices }
      ];

      for (const table of tables) {
        try {
          const rawCount = await db.select({ count: sql`count(*)` }).from(table.schema);
          const count = rawCount as SQLCountResult[];
          const sample = await db.select().from(table.schema).limit(1);
          results[table.name] = { 
            status: 'ok',
            data: { count, hasSampleData: sample.length > 0 }
          };
        } catch (error) {
          results[table.name] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error',
            data: { query_failed: true }
          };
        }
      }

      // Test a join operation
      try {
        await db.select()
          .from(schema.holdings)
          .leftJoin(schema.users, sql`${schema.holdings.user_id} = ${schema.users.auth0_id}`)
          .limit(1);
        results['join_test'] = { status: 'ok' };
      } catch (error) {
        results['join_test'] = {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
  }

  async function testRedisOperations() {
    const results: Record<string, RedisResult> = {};
    
    try {
      // Test connection
      try {
        const pingResult = await redis.ping();
        results.connection = { 
          status: 'ok',
          data: { ping: pingResult }
        };
      } catch (error) {
        results.connection = {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }

      // Test operations
      try {
        const testKey = 'debug_test_' + Date.now();
        await redis.set(testKey, 'test_value');
        const getValue = await redis.get(testKey);
        await redis.del(testKey);
        const getAfterDel = await redis.get(testKey);

        results.operations = { 
          status: 'ok',
          data: {
            writeSuccessful: getValue === 'test_value',
            deleteSuccessful: getAfterDel === null
          }
        };
      } catch (error) {
        results.operations = {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }

      // Test pub/sub
      try {
        const channel = 'debug_test_channel';
        await redis.publish(channel, 'test');
        results.pubsub = { status: 'ok' };
      } catch (error) {
        results.pubsub = {
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        };
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
  }

  async function testAuth0Endpoints() {
    const results: Record<string, Auth0Result> = {};
    const tokenResult = await getAuth0Token();
    
    try {
      const endpoints = [
        { path: '.well-known/openid-configuration', method: 'GET' },
        { path: 'userinfo', method: 'GET', requiresAuth: true },
        { path: 'oauth/token', method: 'POST' }
      ];

      for (const endpoint of endpoints) {
        try {
          const headers: Record<string, string> = {
            'Content-Type': 'application/json'
          };

          if (endpoint.requiresAuth && tokenResult.success) {
            headers['Authorization'] = `Bearer ${tokenResult.token}`;
          }

          const response = await fetch(
            `${process.env.AUTH0_ISSUER_BASE_URL}/${endpoint.path}`,
            {
              method: endpoint.method,
              headers
            }
          );

          results[endpoint.path] = { 
            status: response.ok ? 'ok' : 'error',
            error: !response.ok ? `HTTP ${response.status}` : undefined,
            data: {
              authenticated: Boolean(endpoint.requiresAuth && tokenResult?.success),
              statusCode: response.status
            }
          };
        } catch (error) {
          results[endpoint.path] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
}

  async function testAPIRoutes() {
    const results: Record<string, APIResult> = {};
    const tokenResult = await getAuth0Token();
    
    try {
      const routes = [
        { path: '/api/auth/token', method: 'GET' },
        { path: '/api/auth/debug', method: 'GET' },
        { path: '/api/holdings', method: 'GET', requiresAuth: true },
        { path: '/api/orders', method: 'GET', requiresAuth: true },
        { path: '/api/qa-trees', method: 'GET', requiresAuth: true },
        { path: '/api/balance', method: 'GET', requiresAuth: true },
        { path: '/api/active-orders', method: 'GET', requiresAuth: true },
        { path: '/api/markets', method: 'GET', requiresAuth: true }
      ];

      for (const route of routes) {
        try {
          const headers: Record<string, string> = {};
          
          if (route.requiresAuth && tokenResult.success) {
            headers['Authorization'] = `Bearer ${tokenResult.token}`;
          }

          const response = await fetch(
            `${process.env.AUTH0_BASE_URL}${route.path}`,
            {
              method: route.method,
              headers
            }
          );

          const responseText = await response.text();
          let responseData;
          try {
            responseData = JSON.parse(responseText);
          } catch {
            responseData = responseText;
          }

          results[route.path] = { 
            status: response.ok ? 'ok' : 'error',
            error: !response.ok ? `HTTP ${response.status} - ${responseText}` : undefined,
            data: {
              authenticated: Boolean(route.requiresAuth && tokenResult?.success),
              statusCode: response.status,
              response: responseData
            }
          };
        } catch (error) {
          results[route.path] = {
            status: 'error',
            error: error instanceof Error ? error.message : 'Unknown error'
          };
        }
      }
    } catch (error) {
      return {
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return results;
}

  function testEnvironmentVariables() {
    const required = [
      'AUTH0_ISSUER_BASE_URL',
      'AUTH0_CLIENT_ID',
      'AUTH0_CLIENT_SECRET',
      'AUTH0_SECRET',
      'AUTH0_AUDIENCE',
      'AUTH0_BASE_URL',
      'DATABASE_URL',
      'REDIS_URL'
    ];

    return Object.fromEntries(
      required.map(key => [
        key,
        { 
          status: process.env[key] ? 'ok' : 'error',
          error: !process.env[key] ? 'Missing' : undefined
        }
      ])
    );
  }

  try {
    const diagnostics = {
      timestamp: new Date().toISOString(),
      overview: {
        environment: process.env.NODE_ENV,
        nodeVersion: process.version,
        deployment: {
          url: process.env.VERCEL_URL,
          environment: process.env.VERCEL_ENV,
          region: process.env.VERCEL_REGION,
          branch: process.env.VERCEL_GIT_COMMIT_REF,
          commitSha: process.env.VERCEL_GIT_COMMIT_SHA
        }
      },
      tests: {
        environment: testEnvironmentVariables(),
        database: await testDatabaseTables(),
        redis: await testRedisOperations(),
        auth0: await testAuth0Endpoints(),
        api: await testAPIRoutes()
      }
    };

    const failures = Object.entries(diagnostics.tests)
      .flatMap(([category, tests]) => 
        Object.entries(tests)
          .filter(([, result]) => result.status === 'error')
          .map(([name, result]) => ({
            category,
            name,
            error: result.error
          }))
      );

    return new Response(JSON.stringify({
      ...diagnostics,
      summary: {
        total_tests: Object.values(diagnostics.tests)
          .flatMap(tests => Object.keys(tests)).length,
        failures: failures.length,
        failed_components: failures
      }
    }, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    return new Response(JSON.stringify({
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      }
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}