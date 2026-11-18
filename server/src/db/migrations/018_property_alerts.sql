-- Interessados que pedem aviso de novos imóveis pela vitrine pública (sem login).
-- O corretor vê quem combina com cada imóvel recém-publicado e avisa pelo WhatsApp; nada é enviado automaticamente.
CREATE TABLE IF NOT EXISTS property_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  purpose TEXT CHECK (purpose IS NULL OR purpose IN ('venda','aluguel','temporada','arrendamento')),
  kind TEXT CHECK (kind IS NULL OR kind IN ('urbano','rural')),
  city TEXT,
  max_price NUMERIC(14,2) CHECK (max_price IS NULL OR max_price > 0),
  min_bedrooms INT CHECK (min_bedrooms IS NULL OR min_bedrooms BETWEEN 0 AND 20),
  status TEXT NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo','pausado')),
  consent_text TEXT NOT NULL,
  ip_hash TEXT,
  last_notified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS property_alerts_org ON property_alerts(org_id, status, created_at DESC);
ALTER TABLE property_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE property_alerts FROM PUBLIC;
