-- ImobFlow — migração 001: núcleo (multiempresa, usuários, pessoas, imóveis, funil, agenda, auditoria)
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL DEFAULT 'gratuito',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,   -- marca, prefixo de código, fuso, etc.
  property_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','gestor','corretor','assistente','consulta')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX users_org_idx ON users(org_id);

CREATE TABLE sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE password_resets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('gestor','corretor','assistente','consulta')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invites_org_idx ON invites(org_id);

-- Cadastro unificado de pessoas (uma pessoa, vários papéis)
CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('fisica','juridica')),
  name text NOT NULL,
  display_name text,
  document text,                 -- CPF/CNPJ (acesso restrito por permissão)
  document_norm text,            -- somente dígitos, para detecção de duplicidade
  phones text[] NOT NULL DEFAULT '{}',
  emails text[] NOT NULL DEFAULT '{}',
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_pref text,
  roles text[] NOT NULL DEFAULT '{}',
  owner_user_id uuid REFERENCES users(id),
  source text,
  private_notes text,
  consent jsonb NOT NULL DEFAULT '{}'::jsonb,
  relationship_status text NOT NULL DEFAULT 'ativo',
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,   -- preferências de comprador/interessado
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);
CREATE INDEX people_org_idx ON people(org_id);
CREATE INDEX people_doc_idx ON people(org_id, document_norm) WHERE document_norm IS NOT NULL;
CREATE INDEX people_phones_idx ON people USING gin(phones);
CREATE INDEX people_emails_idx ON people USING gin(emails);
CREATE INDEX people_name_trgm ON people USING gin(name gin_trgm_ops);

CREATE TABLE person_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'nota',
  body text NOT NULL,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX person_interactions_idx ON person_interactions(person_id, created_at DESC);

-- Imóveis: tipo (urbano/rural) e localização (litorânea etc.) são campos distintos
CREATE TABLE properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  description text,
  kind text NOT NULL CHECK (kind IN ('urbano','rural')),
  subtype text NOT NULL,
  purposes text[] NOT NULL DEFAULT '{}',        -- venda, aluguel, temporada, arrendamento
  location_tags text[] NOT NULL DEFAULT '{}',   -- litoral, serra, lago, etc.
  status text NOT NULL DEFAULT 'em_preparacao'
    CHECK (status IN ('em_preparacao','disponivel','reservado','em_negociacao','vendido','alugado','arrendado','indisponivel','arquivado')),
  address jsonb NOT NULL DEFAULT '{}'::jsonb,   -- logradouro, numero, bairro, cidade, uf, cep, pais
  city text,
  state text,
  neighborhood text,
  latitude numeric(9,6),
  longitude numeric(9,6),
  price_sale numeric(14,2),
  price_rent numeric(14,2),
  price_lease numeric(14,2),
  recurring_fees jsonb NOT NULL DEFAULT '{}'::jsonb,   -- condomínio, IPTU, ITR...
  area_total numeric(14,2),
  area_built numeric(14,2),
  area_unit text NOT NULL DEFAULT 'm2' CHECK (area_unit IN ('m2','ha','alqueire')),
  bedrooms integer,
  suites integer,
  bathrooms integer,
  parking integer,
  urban_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  rural_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  coastal_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  features text[] NOT NULL DEFAULT '{}',
  owner_person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  broker_user_id uuid REFERENCES users(id),
  captured_at date NOT NULL DEFAULT current_date,
  available_from date,
  internal_notes text,
  publish_authorized boolean NOT NULL DEFAULT false,
  show_exact_location boolean NOT NULL DEFAULT false,
  show_price boolean NOT NULL DEFAULT true,
  public_slug text,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);
CREATE INDEX properties_org_idx ON properties(org_id, status);
CREATE INDEX properties_search_idx ON properties USING gin ((coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(city,'') || ' ' || coalesce(neighborhood,'')) gin_trgm_ops);
CREATE UNIQUE INDEX properties_slug_idx ON properties(public_slug) WHERE public_slug IS NOT NULL;

CREATE TABLE favorites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, property_id)
);

CREATE TABLE saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  filters jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Funil configurável
CREATE TABLE pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  position integer NOT NULL,
  kind text NOT NULL DEFAULT 'aberta' CHECK (kind IN ('aberta','ganha','perdida')),
  UNIQUE (org_id, key)
);

CREATE TABLE deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id),
  purpose text NOT NULL DEFAULT 'venda' CHECK (purpose IN ('venda','aluguel','temporada','arrendamento')),
  stage_key text NOT NULL,
  owner_user_id uuid REFERENCES users(id),
  source text,
  estimated_value numeric(14,2),    -- valor estimado
  negotiated_value numeric(14,2),   -- valor negociado (última proposta aceita/em curso)
  closed_value numeric(14,2),       -- valor efetivamente concluído (somente ao ganhar)
  next_action text,
  follow_up_at timestamptz,
  lost_reason text,
  private_notes text,
  closed_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, stage_key) REFERENCES pipeline_stages(org_id, key)
);
CREATE INDEX deals_org_idx ON deals(org_id, stage_key);
CREATE INDEX deals_person_idx ON deals(person_id);

CREATE TABLE deal_properties (
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  PRIMARY KEY (deal_id, property_id)
);

CREATE TABLE deal_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  type text NOT NULL,   -- nota, etapa, proposta, reserva, visita, tarefa
  body text NOT NULL,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deal_activities_idx ON deal_activities(deal_id, created_at DESC);

CREATE TABLE proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  property_id uuid REFERENCES properties(id),
  direction text NOT NULL CHECK (direction IN ('proposta','contraproposta')),
  amount numeric(14,2) NOT NULL,
  status text NOT NULL DEFAULT 'enviada' CHECK (status IN ('enviada','aceita','recusada','retirada')),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX proposals_deal_idx ON proposals(deal_id);

CREATE TABLE reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  property_id uuid NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  person_id uuid REFERENCES people(id),
  expires_at timestamptz,
  status text NOT NULL DEFAULT 'ativa' CHECK (status IN ('ativa','cancelada','convertida','expirada')),
  notes text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title text NOT NULL,
  due_at timestamptz,
  assignee_user_id uuid REFERENCES users(id),
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  done_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_org_idx ON tasks(org_id, done_at, due_at);

-- Agenda
CREATE TABLE events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('visita','reuniao','captacao','avaliacao','vistoria','assinatura','retorno','tarefa','vencimento','outro')),
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  owner_user_id uuid REFERENCES users(id),
  participants uuid[] NOT NULL DEFAULT '{}',
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  property_id uuid REFERENCES properties(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES deals(id) ON DELETE SET NULL,
  location text,
  instructions text,
  status text NOT NULL DEFAULT 'agendado' CHECK (status IN ('agendado','concluido','cancelado','reagendado')),
  reminder_minutes integer[] NOT NULL DEFAULT '{60}',
  outcome text,
  next_action text,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);
CREATE INDEX events_org_idx ON events(org_id, starts_at);
CREATE INDEX events_owner_idx ON events(owner_user_id, starts_at);

CREATE TABLE event_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_id uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Auditoria de operações sensíveis (sem dados pessoais desnecessários)
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  org_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_idx ON audit_log(org_id, created_at DESC);
