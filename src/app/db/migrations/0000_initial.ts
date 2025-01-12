import { pgTable, text, timestamp, numeric, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable("users", {
  id: text("id").primaryKey().notNull(),
  auth0_id: text("auth0_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default('0'),
  created_at: timestamp("created_at").defaultNow().notNull(),
  updated_at: timestamp("updated_at").defaultNow().notNull()
});

export const holdings = pgTable("holdings", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull(),
  market_id: text("market_id").notNull(),
  position: text("position").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  created_at: timestamp("created_at").defaultNow().notNull()
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull(),
  market_id: text("market_id").notNull(),
  status: text("status").notNull().default('active'),
  created_at: timestamp("created_at").defaultNow().notNull()
});

type PgTable = typeof users | typeof holdings | typeof orders;
type DbWithSchema = {
  schema: {
    createTable: (table: PgTable) => Promise<void>;
    dropTable: (table: PgTable) => Promise<void>;
  };
};

export async function up(db: DbWithSchema) {
  await db.schema.createTable(users);
  await db.schema.createTable(holdings);
  await db.schema.createTable(orders);
}

export async function down(db: DbWithSchema) {
  await db.schema.dropTable(orders);
  await db.schema.dropTable(holdings);
  await db.schema.dropTable(users);
}