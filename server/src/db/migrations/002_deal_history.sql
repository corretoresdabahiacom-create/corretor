-- Histórico de etapas do funil (base para conversão por etapa e tempo médio sem dupla contagem)
CREATE TABLE deal_stage_history (
  id bigserial PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  from_stage text,
  to_stage text NOT NULL,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_stage_history_idx ON deal_stage_history(org_id, deal_id);
