ALTER TABLE workflow_versions ADD COLUMN restore_message text;
CREATE TABLE audit_logs (id bigserial PRIMARY KEY, workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE, actor_id uuid REFERENCES users(id) ON DELETE SET NULL, action text NOT NULL, entity_type text NOT NULL, entity_id uuid, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_logs_workspace_created_idx ON audit_logs(workspace_id,created_at DESC);
