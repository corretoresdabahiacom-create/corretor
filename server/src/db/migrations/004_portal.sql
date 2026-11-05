ALTER TABLE organizations
  ADD COLUMN referred_by_org UUID REFERENCES organizations(id),
  ADD COLUMN public_name TEXT,
  ADD COLUMN public_whatsapp TEXT,
  ADD COLUMN public_badge BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE properties
  ADD COLUMN public_code TEXT UNIQUE,
  ADD COLUMN published_at TIMESTAMPTZ;

CREATE TABLE portal_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  message TEXT,
  consent_text TEXT NOT NULL,
  consent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ref TEXT,
  status TEXT NOT NULL DEFAULT 'novo' CHECK (status IN ('novo','convertido','descartado')),
  person_id UUID REFERENCES people(id),
  handled_by UUID REFERENCES users(id),
  handled_at TIMESTAMPTZ,
  ip_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX portal_leads_org_idx ON portal_leads(org_id, status, created_at DESC);

-- Contagens agregadas por dia (sem dados pessoais): views = carregamentos da página, não visitantes únicos.
CREATE TABLE portal_stats (
  property_id UUID NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  event TEXT NOT NULL CHECK (event IN ('view','share','lead')),
  channel TEXT NOT NULL DEFAULT '',
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (property_id, day, event, channel)
);
