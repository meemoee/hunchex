import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import dotenv from 'dotenv';

dotenv.config({ path: './src/app/db/.env.local' });

async function verifyQATreeSchema() {
  try {
    // Create the connection
    const sql = neon(process.env.DATABASE_URL);
    const db = drizzle(sql);

    console.log('Connected to Neon database');
    
    // Test connection with a simple query
    const tableCheck = await db.execute(`
      SELECT EXISTS (
        SELECT FROM pg_tables
        WHERE schemaname = 'public'
        AND tablename = 'qa_trees'
      );
    `);

    const tableExists = tableCheck[0].exists;
    console.log('qa_trees table exists:', tableExists);

    if (tableExists) {
      // Get table schema
      const tableSchema = await db.execute(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'qa_trees'
        ORDER BY ordinal_position;
      `);

      console.log('\nCurrent qa_trees table schema:');
      console.table(tableSchema);
    } else {
      console.log('\nCreating qa_trees table...');
      
      // Create the table if it doesn't exist
      await db.execute(`
        CREATE TABLE qa_trees (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id TEXT NOT NULL,
          market_id TEXT NOT NULL,
          tree_data JSONB NOT NULL,
          title TEXT,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES users(auth0_id)
        );

        -- Add index on user_id for faster lookups
        CREATE INDEX idx_qa_trees_user_id ON qa_trees(user_id);
        
        -- Add index on market_id for faster lookups
        CREATE INDEX idx_qa_trees_market_id ON qa_trees(market_id);
      `);

      console.log('qa_trees table created successfully');
    }

  } catch (error) {
    console.error('Error:', error);
  }
}

verifyQATreeSchema();