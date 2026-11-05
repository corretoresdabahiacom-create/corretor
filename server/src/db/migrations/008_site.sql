-- Site da vitrine: configuração editável pela imobiliária, imagens do site e vídeos (por link) dos imóveis.
ALTER TABLE organizations ADD COLUMN site JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE properties ADD COLUMN videos JSONB NOT NULL DEFAULT '[]'::jsonb;
CREATE TABLE site_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mime TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER, height INTEGER,
  sha256 TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX site_images_org ON site_images(org_id, created_at);
