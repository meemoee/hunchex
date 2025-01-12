import { db } from '@/app/db';
import { redis } from '@/app/db/redis';
import { sql } from 'drizzle-orm';
import * as schema from '@/app/db/schema';

// Type guard for database errors
interface DbError extends Error {
  code?: string;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  const isAdmin = authHeader === process.env.DEBUG_ADMIN_TOKEN;

  async function testDatabaseConnection() {
    try {
      // Basic connectivity test using proper schema reference
      const queryResult = await db.select().from(schema.qa_trees).limit(1);
      
      // Get table statistics and database status
      const diagnostics = await Promise.all([
        // Table counts
        db.select({
          count: sql`count(*)`
        }).from(schema.qa_trees),
        
        // Database version and settings
        db.execute(sql`SELECT version() as version`),
        db.execute(sql`SHOW max_connections`),
        db.execute(sql`SELECT count(*) as active_connections FROM pg_stat_activity`),
        
        // Connection pool status
        db.execute(sql`SELECT 
          state, 
          count(*) as count 
          FROM pg_stat_activity 
          GROUP BY state`),

        // Table sizes
        db.execute(sql`SELECT 
          relname as table_name,
          n_live_tup as row_count,
          pg_size_pretty(pg_total_relation_size(relid)) as total_size
          FROM pg_stat_user_tables
          ORDER BY n_live_tup DESC`)
      ]);

      // Get counts for all main tables
      const tableCounts = await Promise.all([
        db.select({ count: sql`count(*)` }).from(schema.qa_trees),
        db.select({ count: sql`count(*)` }).from(schema.users),
        db.select({ count: sql`count(*)` }).from(schema.holdings),
        db.select({ count: sql`count(*)` }).from(schema.orders),
        db.select({ count: sql`count(*)` }).from(schema.markets),
        db.select({ count: sql`count(*)` }).from(schema.market_prices)
      ]);

      return {
        status: 'connected',
        details: 'Successfully executed diagnostic queries',
        data: {
          sampleRecord: queryResult[0],
          tableCounts: {
            qa_trees: tableCounts[0],
            users: tableCounts[1],
            holdings: tableCounts[2],
            orders: tableCounts[3],
            markets: tableCounts[4],
            market_prices: tableCounts[5]
          },
          databaseInfo: {
            version: diagnostics[1],
            maxConnections: diagnostics[2],
            activeConnections: diagnostics[3],
            connectionStates: diagnostics[4],
            tableSizes: diagnostics[5]
          }
        }
      };
    } catch (error) {
      const isDbError = (error: unknown): error is DbError => {
        return error instanceof Error && 'code' in error;
      };

      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown database error',
        details: error instanceof Error ? error.stack : undefined,
        context: {
          connectionUrl: isAdmin ? 
            process.env.DATABASE_URL?.replace(/\/\/.*@/, '//[REDACTED]@') : 
            undefined,
          errorCode: isDbError(error) ? error.code : undefined,
          errorName: error instanceof Error ? error.name : undefined,
          timestamp: new Date().toISOString()
        }
      };
    }
  }

  async function testRedisConnection() {
    try {
      const pingResult = await redis.ping();
      const info = await redis.info();
      const dbSize = await redis.dbsize();
      
      return {
        status: 'connected',
        details: 'Successfully connected to Redis',
        data: isAdmin ? {
          ping: pingResult,
          dbSize,
          info: info,
          memory: await redis.info('memory'),
          clients: await redis.info('clients')
        } : {
          dbSize
        }
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown Redis error',
        details: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      };
    }
  }

  async function testAuth0Connection() {
    try {
      const configResponse = await fetch(
        `${process.env.AUTH0_ISSUER_BASE_URL}/.well-known/openid-configuration`
      );
      
      if (!configResponse.ok) {
        throw new Error(`Auth0 configuration failed: ${configResponse.statusText}`);
      }

      const userinfoResponse = await fetch(
        `${process.env.AUTH0_ISSUER_BASE_URL}/userinfo`,
        {
          headers: {
            'Authorization': 'Bearer dummy_token'
          }
        }
      );

      return {
        status: 'connected',
        details: 'Auth0 endpoints accessible',
        endpoints: {
          configuration: configResponse.status,
          userinfo: userinfoResponse.status
        },
        data: isAdmin ? {
          configurationResponse: await configResponse.json()
        } : undefined
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown Auth0 error',
        details: error instanceof Error ? error.stack : undefined,
        timestamp: new Date().toISOString()
      };
    }
  }

  function getSystemInfo() {
    return {
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      resourceUsage: process.resourceUsage(),
      uptime: process.uptime(),
      versions: process.versions,
      env: process.env.NODE_ENV,
      arch: process.arch,
      platform: process.platform,
      pid: process.pid
    };
  }

  try {
    const debugInfo = {
      timestamp: new Date().toISOString(),
      environment: {
        variables: Object.keys(process.env).filter(key => 
          key.startsWith('AUTH0_') || 
          key.startsWith('NEXT_') || 
          key.startsWith('VERCEL_') ||
          key.startsWith('DATABASE_') ||
          key.startsWith('REDIS_')
        ),
        values: isAdmin ? {
          nodeEnv: process.env.NODE_ENV,
          vercelEnv: process.env.VERCEL_ENV,
          region: process.env.VERCEL_REGION,
          auth0: {
            baseUrl: process.env.AUTH0_BASE_URL,
            issuerBaseUrl: process.env.AUTH0_ISSUER_BASE_URL,
            hasClientId: !!process.env.AUTH0_CLIENT_ID,
            hasClientSecret: !!process.env.AUTH0_CLIENT_SECRET,
            hasSecret: !!process.env.AUTH0_SECRET
          }
        } : undefined
      },
      request: {
        url: request.url,
        method: request.method,
        headers: Object.fromEntries(
          Array.from(request.headers.entries())
            .filter(([key]) => !key.toLowerCase().includes('authorization'))
        )
      },
      system: getSystemInfo(),
      connections: {
        database: await testDatabaseConnection(),
        redis: await testRedisConnection(),
        auth0: await testAuth0Connection()
      },
      build: {
        timestamp: new Date().toISOString(),
        vercelEnv: process.env.VERCEL_ENV || 'local',
        deploymentUrl: process.env.VERCEL_URL || 'localhost',
        commitSha: process.env.VERCEL_GIT_COMMIT_SHA,
        branch: process.env.VERCEL_GIT_COMMIT_REF,
        projectId: process.env.VERCEL_PROJECT_ID
      }
    };

    return new Response(JSON.stringify(debugInfo, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (error) {
    const errorResponse = {
      error: {
        message: error instanceof Error ? error.message : 'An unknown error occurred',
        stack: isAdmin ? (error instanceof Error ? error.stack : undefined) : undefined,
        timestamp: new Date().toISOString(),
        context: {
          path: request.url,
          method: request.method,
          headers: isAdmin ? Object.fromEntries(
            Array.from(request.headers.entries())
              .filter(([key]) => !key.toLowerCase().includes('authorization'))
          ) : undefined
        }
      }
    };

    return new Response(JSON.stringify(errorResponse, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}