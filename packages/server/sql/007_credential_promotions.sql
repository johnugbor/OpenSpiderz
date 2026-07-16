CREATE TABLE credential_promotions (development_credential_id uuid PRIMARY KEY, production_credential_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
