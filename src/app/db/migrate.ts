import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { migrate } from "drizzle-orm/neon-http/migrator";
import * as dotenv from "dotenv";
import path from "path";

// Load .env.local file
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

const runMigration = async () => {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set in .env.local");
  }

  const sql = neon(process.env.DATABASE_URL);
  const db = drizzle(sql);

  console.log("⏳ Running migrations...");
  console.log("Using database URL:", process.env.DATABASE_URL); // This will help verify the URL is loaded
  
  const start = Date.now();
  await migrate(db, { migrationsFolder: "./drizzle" });
  const end = Date.now();

  console.log(`✅ Migrations completed in ${end - start}ms`);
  process.exit(0);
};

runMigration().catch((err) => {
  console.error("❌ Migration failed");
  console.error(err);
  process.exit(1);
});