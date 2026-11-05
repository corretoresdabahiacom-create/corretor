ALTER TABLE organizations ADD COLUMN brand JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE properties ADD COLUMN featured BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN card_profile JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE org_assets (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('logo')),
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, kind)
);

-- Acessos à vitrine por origem (link, qr, cartao). Só contagens; sem dados pessoais.
CREATE TABLE vitrine_stats (
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  source TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day, source)
);
