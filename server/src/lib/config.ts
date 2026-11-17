// Configuração via variáveis de ambiente. Nenhum segredo real aqui; veja .env.example.
export const config = {
  databaseUrl:
    process.env.DATABASE_URL || 'postgres://imobflow:imobflow_dev@127.0.0.1:5432/imobflow',
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? '127.0.0.1',
  appName: process.env.APP_NAME ?? 'ImobFlow', // nome provisório, configurável
  // Sem barra no final: um PUBLIC_ORIGIN colado como "https://x.workers.dev/" bloqueava todas as alterações (Origin não batia).
  publicOrigin: (process.env.PUBLIC_ORIGIN || 'http://localhost:5173').trim().replace(/\/+$/, ''),
  cookieSecure: (process.env.COOKIE_SECURE ?? 'false') === 'true',
  sessionDays: Number(process.env.SESSION_DAYS ?? 14),
  isProd: process.env.NODE_ENV === 'production',
  // Em dev, o link de recuperação/convite é devolvido na resposta (claramente identificado).
  // Em produção deve ser enviado por e-mail (serviço ainda não integrado — ver docs).
  devExposeTokens: (process.env.DEV_EXPOSE_TOKENS ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true',
  // Armazenamento de arquivos: 'local' (dev) ou 's3' (qualquer serviço compatível, ex.: Cloudflare R2).
  storageDriver: (process.env.STORAGE_DRIVER ?? 'local') as 'local' | 's3' | 'db',
  storageDir: process.env.STORAGE_DIR ?? './storage-dev',
  s3: {
    endpoint: process.env.S3_ENDPOINT, bucket: process.env.S3_BUCKET, region: process.env.S3_REGION ?? 'auto',
    accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024,
  maxVideoBytes: Number(process.env.MAX_VIDEO_MB ?? 30) * 1024 * 1024,           // por vídeo
  maxOrgVideoBytes: Number(process.env.MAX_ORG_VIDEO_MB ?? 150) * 1024 * 1024,    // total por imobiliária (protege a cota gratuita do banco)
  // Portal público
  formSecret: process.env.FORM_SECRET ?? (process.env.NODE_ENV === 'production' ? '' : 'dev-only-form-secret'),
  turnstileSecret: process.env.TURNSTILE_SECRET, // opcional (Cloudflare Turnstile, gratuito)
  turnstileSiteKey: process.env.TURNSTILE_SITE_KEY,
  trustProxy: (process.env.TRUST_PROXY ?? 'false') === 'true', // true atrás de Cloudflare/proxy: IP real para limites
  webDist: process.env.WEB_DIST, // pasta do build do web; se definida, a API também serve o app
  email: {
    driver: (process.env.EMAIL_DRIVER ?? 'none') as 'none' | 'console' | 'resend' | 'memory',
    from: process.env.EMAIL_FROM ?? '',
    resendKey: process.env.RESEND_API_KEY,
  },
};

const DEV_DATABASE_URL = 'postgres://imobflow:imobflow_dev@127.0.0.1:5432/imobflow';
const DEV_PUBLIC_ORIGIN = 'http://localhost:5173';

/** Problemas de configuração de produção (só nomes de variáveis, nunca valores). Vazio = pode subir. */
export function productionProblems(): string[] {
  if (!config.isProd) return [];
  const problems: string[] = [];
  if (config.databaseUrl === DEV_DATABASE_URL) problems.push('DATABASE_URL não definida (connection string do Neon, com ?sslmode=require)');
  else {
    if (config.databaseUrl.includes('imobflow_dev')) problems.push('DATABASE_URL usa a senha de desenvolvimento');
    if (!/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(config.databaseUrl) && !/sslmode=(require|verify-full|verify-ca)/.test(config.databaseUrl))
      problems.push('DATABASE_URL remota (ex.: Neon) deve terminar com ?sslmode=require');
  }
  if (!config.formSecret) problems.push('FORM_SECRET não definido (texto aleatório com 24+ caracteres)');
  else if (config.formSecret.length < 24) problems.push('FORM_SECRET muito curto (mínimo 24 caracteres)');
  if (config.publicOrigin === DEV_PUBLIC_ORIGIN) problems.push('PUBLIC_ORIGIN não definido (endereço do site, ex.: https://corretor.SEU-SUBDOMINIO.workers.dev)');
  else if (!/^https:\/\/[^/]+$/.test(config.publicOrigin)) problems.push('PUBLIC_ORIGIN deve ser só o endereço https://, sem caminho');
  if (!config.cookieSecure) problems.push('COOKIE_SECURE=true é obrigatório (HTTPS)');
  if (config.devExposeTokens) problems.push('DEV_EXPOSE_TOKENS deve ser false');
  if (config.email.driver === 'resend' && (!config.email.resendKey || !config.email.from)) problems.push('EMAIL_DRIVER=resend exige RESEND_API_KEY e EMAIL_FROM');
  return problems;
}

/** Falha cedo em produção se a configuração for insegura. */
export function assertProductionConfig() {
  const problems = productionProblems();
  if (problems.length) throw new Error('Configuração insegura para produção:\n - ' + problems.join('\n - '));
}
