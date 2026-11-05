-- Defesa em profundidade: RLS ligada em todas as tabelas, sem políticas (nega tudo a quem não é dono).
-- A API conecta como dono das tabelas (neondb_owner), que ignora RLS; o isolamento entre imobiliárias continua sendo feito por org_id na API.
-- Se algum dia a Data API do Neon ou outro role for criado, nada fica exposto por padrão.
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
