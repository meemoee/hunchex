-- Create qa_trees table
CREATE TABLE IF NOT EXISTS qa_trees (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(auth0_id),
    market_id TEXT NOT NULL REFERENCES markets(id),
    tree_data JSONB NOT NULL,
    title TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);