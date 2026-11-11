-- Armazenamento de arquivos no próprio Postgres (STORAGE_DRIVER=db): gratuito, sem cartão e persistente
-- em hospedagens com disco efêmero (ex.: Render free). Apagar a organização apaga os arquivos em cascata.
CREATE TABLE IF NOT EXISTS blobs (
  key        text PRIMARY KEY,                       -- orgId/fileId (mesma chave dos outros drivers)
  org_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  mime       text NOT NULL,
  size       integer NOT NULL,
  data       bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS blobs_org_idx ON blobs(org_id);
ALTER TABLE blobs ENABLE ROW LEVEL SECURITY;   -- mesma defesa em profundidade da 010
REVOKE ALL ON TABLE blobs FROM PUBLIC;
