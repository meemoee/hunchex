import { pgTable, text, timestamp, numeric, uuid, boolean, jsonb } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().notNull(),
  auth0_id: text("auth0_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name"),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default('0'),
  created_at: timestamp("created_at"),  // Removed withTimezone
  updated_at: timestamp("updated_at")   // Removed withTimezone
});

export const holdings = pgTable("holdings", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull(),
  market_id: text("market_id").notNull(),
  token_id: text("token_id").notNull(),
  position: text("position").notNull(),
  outcome: text("outcome"),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  entry_price: numeric("entry_price", { precision: 10, scale: 4 }),  // Changed to scale: 4
  created_at: timestamp("created_at")  // Removed withTimezone
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  user_id: text("user_id").notNull(),
  market_id: text("market_id").notNull(),
  token_id: text("token_id").notNull(),
  outcome: text("outcome").notNull(),
  side: text("side").notNull(),
  size: numeric("size", { precision: 10, scale: 2 }).notNull(),
  price: numeric("price", { precision: 10, scale: 4 }).notNull(),  // Changed to scale: 4
  order_type: text("order_type").notNull(),
  status: text("status").notNull().default('active'),
  created_at: timestamp("created_at")  // Removed withTimezone
});

export const markets = pgTable("markets", {
  id: text("id").primaryKey(),
  event_id: text("event_id"),
  question: text("question"),
  subtitle: text("subtitle"),
  url: text("url"),
  condid: text("condid"),
  slug: text("slug"),
  end_date: timestamp("end_date"),
  description: text("description"),
  outcomes: jsonb("outcomes"),  // Changed to jsonb
  group_item_title: text("group_item_title"),
  open_time: timestamp("open_time"),
  close_time: timestamp("close_time"),
  status: text("status"),
  clobtokenids: jsonb("clobtokenids"),  // Changed to jsonb
  active: boolean("active").default(true),
  closed: boolean("closed").default(false),
  archived: boolean("archived").default(false),
  image: text("image"),
  yes_sub_title: text("yes_sub_title"),
  no_sub_title: text("no_sub_title"),
  created_at: timestamp("created_at"),
  updated_at: timestamp("updated_at")
});

export const qa_trees = pgTable("qa_trees", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title"),
  market_id: text("market_id").notNull(),
  auth0_id: text("auth0_id").notNull(),
  tree_data: jsonb("tree_data").notNull(),
  created_at: timestamp("created_at"),
  updated_at: timestamp("updated_at")
});

export const market_prices = pgTable("market_prices", {
  id: uuid("id").primaryKey().defaultRandom(),
  market_id: text("market_id").notNull(),
  timestamp: timestamp("timestamp"),
  yes_price: numeric("yes_price"),
  no_price: numeric("no_price"),
  best_bid: numeric("best_bid"),
  best_ask: numeric("best_ask"),
  last_traded_price: numeric("last_traded_price"),
  volume: numeric("volume"),
  liquidity: numeric("liquidity")
});