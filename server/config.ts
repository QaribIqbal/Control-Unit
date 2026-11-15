import 'dotenv/config';
import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

function integer(value: string | undefined, fallback: number, min: number, max: number) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Configuration number must be between ${min} and ${max}`);
  return number;
}
export type RuntimeMode = 'local' | 'hosted';
export function validateHostedConfig(config: { mode: RuntimeMode; appOrigin: string; databaseUrl: string; dashboardPassword: string; sessionSecret: string; ingestionToken: string }) {
  if (config.mode !== 'hosted') return;
  try {
    const origin = new URL(config.appOrigin);
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || !origin.hostname) throw new Error();
    if (!config.databaseUrl || config.dashboardPassword.length < 12 || config.dashboardPassword.length > 1024 || config.sessionSecret.length < 32 || config.ingestionToken.length < 32) throw new Error();
  } catch { throw new Error('Hosted configuration is missing or invalid'); }
}
export function loadConfig(modeOverride?: RuntimeMode) {
  const configuredMode = process.env.CONTROL_UNIT_MODE;
  if (configuredMode && configuredMode !== 'local' && configuredMode !== 'hosted') throw new Error('Invalid runtime mode configuration');
  const mode: RuntimeMode = modeOverride || configuredMode as RuntimeMode || (process.env.VERCEL || process.env.NETLIFY ? 'hosted' : 'local');
  const port = integer(process.env.PORT, 4310, 1024, 65535);
  const hosted = { mode, appOrigin: process.env.APP_ORIGIN || (mode === 'local' ? `http://localhost:${port}` : ''), databaseUrl: process.env.DATABASE_URL || '', dashboardPassword: process.env.DASHBOARD_PASSWORD || '', sessionSecret: process.env.SESSION_SECRET || '', ingestionToken: process.env.INGESTION_TOKEN || '' };
  validateHostedConfig(hosted);
  if (mode === 'hosted') hosted.appOrigin = new URL(hosted.appOrigin).origin;
  const home = resolve(process.env.RIO_HOME || homedir());
  const root = process.cwd(); const data = resolve(process.env.DATA_DIR || join(root, 'data'));
  const timezone = process.env.TIMEZONE || 'Asia/Karachi';
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
  return { ...hosted, home, root, data, timezone, port,
    database: join(data, 'control-unit.sqlite'), inbox: resolve(process.env.INBOX_DIR || join(root, 'inbox')),
    importIntervalMs: integer(process.env.IMPORT_INTERVAL_SECONDS, 60, 10, 86400) * 1000,
    apiKey: process.env.OPENAI_API_KEY || '', model: process.env.LLM_MODEL || 'gpt-4.1-mini',
    dailyLimit: integer(process.env.LLM_DAILY_CALL_LIMIT, 20, 0, 1000),
    paths: Object.fromEntries(Object.entries({ applications: process.env.RIO_APPLICATIONS_PATH, opportunities: process.env.RIO_OPPORTUNITIES_PATH,
      workbook: process.env.RIO_WORKBOOK_PATH, linkedin: process.env.RIO_LINKEDIN_PATH, dental: process.env.RIO_DENTAL_PATH,
      social: process.env.RIO_SOCIAL_PATH, memory: process.env.RIO_MEMORY_PATH }).filter(([, value]) => Boolean(value))) as Record<string, string>,
    allowedRoots: mode === 'hosted' ? [] : [join(home, 'workspace'), join(home, 'memory'), join(home, '.claude', 'linkedin'), data] };
}
export type Config = ReturnType<typeof loadConfig>;
