-- Aparência do app (por imobiliária), editável pelo administrador.
ALTER TABLE organizations ADD COLUMN app_theme JSONB NOT NULL DEFAULT '{}'::jsonb;
