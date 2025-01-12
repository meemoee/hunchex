export interface Holding {
  id: string;
  user_id: string;
  market_id: string;
  token_id: string;
  position: string;
  outcome?: string;
  amount: string;
  entry_price?: string;
  created_at: string;
}