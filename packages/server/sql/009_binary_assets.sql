CREATE TABLE binary_assets (
  data_id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mime_type text NOT NULL,
  file_name text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX binary_assets_workspace_idx ON binary_assets(workspace_id, created_at DESC);
