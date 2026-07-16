CREATE TABLE trigger_state (workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE, node_id text NOT NULL, cursor jsonb, last_checked_at timestamptz, PRIMARY KEY (workflow_id,node_id));
