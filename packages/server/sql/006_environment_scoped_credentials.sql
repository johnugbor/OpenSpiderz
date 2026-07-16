ALTER TABLE credentials ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE oauth2_credentials ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
CREATE INDEX credentials_workspace_idx ON credentials(workspace_id);
CREATE INDEX oauth2_credentials_workspace_idx ON oauth2_credentials(workspace_id);
