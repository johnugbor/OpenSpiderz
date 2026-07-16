CREATE TABLE oauth2_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  token_url text NOT NULL,
  secret_ciphertext bytea NOT NULL,
  secret_iv bytea NOT NULL CHECK (octet_length(secret_iv) = 12),
  secret_auth_tag bytea NOT NULL CHECK (octet_length(secret_auth_tag) = 16),
  key_version smallint NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oauth2_credentials_expiry_idx ON oauth2_credentials(expires_at);
