// Migrações embutidas no bundle do Cloudflare Worker (o Worker não lê arquivos do disco).
// Ao criar uma migração nova, acrescente-a aqui: o teste worker.test.ts falha se algum .sql ficar de fora.
import type { Migration } from './migrate.js';
import m01 from './migrations/001_core.sql';
import m02 from './migrations/002_deal_history.sql';
import m03 from './migrations/003_files_contracts.sql';
import m04 from './migrations/004_portal.sql';
import m05 from './migrations/005_calendar.sql';
import m06 from './migrations/006_vitrine.sql';
import m07 from './migrations/007_avaliacao.sql';
import m08 from './migrations/008_site.sql';
import m09 from './migrations/009_app_theme.sql';
import m10 from './migrations/010_rls.sql';
import m11 from './migrations/011_blobs.sql';
import m12 from './migrations/012_contract_finance.sql';
import m13 from './migrations/013_video_files.sql';
import m14 from './migrations/014_late_fees.sql';
import m15 from './migrations/015_indices.sql';
import m16 from './migrations/016_contract_docs.sql';
import m17 from './migrations/017_guarantors_inspections_stays.sql';
import m18 from './migrations/018_property_alerts.sql';

export const bundledMigrations: Migration[] = [
  { name: '001_core.sql', sql: m01 },
  { name: '002_deal_history.sql', sql: m02 },
  { name: '003_files_contracts.sql', sql: m03 },
  { name: '004_portal.sql', sql: m04 },
  { name: '005_calendar.sql', sql: m05 },
  { name: '006_vitrine.sql', sql: m06 },
  { name: '007_avaliacao.sql', sql: m07 },
  { name: '008_site.sql', sql: m08 },
  { name: '009_app_theme.sql', sql: m09 },
  { name: '010_rls.sql', sql: m10 },
  { name: '011_blobs.sql', sql: m11 },
  { name: '012_contract_finance.sql', sql: m12 },
  { name: '013_video_files.sql', sql: m13 },
  { name: '014_late_fees.sql', sql: m14 },
  { name: '015_indices.sql', sql: m15 },
  { name: '016_contract_docs.sql', sql: m16 },
  { name: '017_guarantors_inspections_stays.sql', sql: m17 },
  { name: '018_property_alerts.sql', sql: m18 },
];
