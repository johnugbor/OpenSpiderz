CREATE TYPE workspace_role AS ENUM ('owner', 'admin', 'member', 'read_only');
CREATE TYPE workflow_environment AS ENUM ('development', 'production');

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  environment workflow_environment NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, environment)
);

CREATE TABLE workspace_memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role workspace_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX workspace_memberships_user_idx ON workspace_memberships(user_id);

ALTER TABLE workflows ADD COLUMN workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE workflows ADD COLUMN environment workflow_environment NOT NULL DEFAULT 'development';
ALTER TABLE workflows ADD COLUMN active_version_id uuid;
CREATE INDEX workflows_workspace_environment_idx ON workflows(workspace_id, environment);

CREATE TABLE workflow_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  definition jsonb NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  immutable boolean NOT NULL DEFAULT false,
  UNIQUE (workflow_id, version_number)
);

ALTER TABLE workflows ADD CONSTRAINT workflows_active_version_fk FOREIGN KEY (active_version_id) REFERENCES workflow_versions(id) ON DELETE SET NULL;

CREATE TABLE workflow_deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_version_id uuid NOT NULL REFERENCES workflow_versions(id) ON DELETE RESTRICT,
  production_workflow_id uuid NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  deployed_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  deployed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_version_id, production_workflow_id)
);
