export interface TopMover {
  market_id: string;
  question: string;
  yes_sub_title?: string;
  image: string;
  url: string;
  final_last_traded_price: number;
  price_change: number;
  final_best_ask: number;
  final_best_bid: number;
  volume: number;
  volume_change: number;
  volume_change_percentage: number;
  description?: string;
  outcomes?: string[] | string;
  clobtokenids?: string[];
  active?: boolean;  // Added as optional
  closed?: boolean;  // Added as optional
  archived?: boolean;  // Added as optional
}