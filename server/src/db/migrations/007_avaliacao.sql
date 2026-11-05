-- Pedidos de avaliação de imóvel vindos da vitrine (sem imóvel cadastrado ainda).
ALTER TABLE portal_leads ALTER COLUMN property_id DROP NOT NULL;
ALTER TABLE portal_leads ADD COLUMN kind TEXT NOT NULL DEFAULT 'interesse' CHECK (kind IN ('interesse','avaliacao'));
ALTER TABLE portal_leads ADD COLUMN details JSONB NOT NULL DEFAULT '{}'::jsonb;
