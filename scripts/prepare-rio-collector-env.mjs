import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'dotenv';

const root = process.cwd();
const source = parse(readFileSync(join(root, '.env')));
const token = source.INGESTION_TOKEN;
if (!token || token.length < 32 || /[\r\n]/.test(token)) {
  throw new Error('Project .env needs a valid INGESTION_TOKEN before preparing Rio’s collector file.');
}

const directory = join(root, 'handoff', 'rio');
mkdirSync(directory, { recursive: true });
const destination = join(directory, '.env');
writeFileSync(destination,
  `CONTROL_UNIT_URL=https://control-unit-iota.vercel.app\nINGESTION_TOKEN=${JSON.stringify(token)}\nCOLLECTOR_ID=rio-primary\n`,
  { mode: 0o600 });
console.log('Prepared handoff/rio/.env with collector settings only.');

if (process.argv.includes('--verify')) {
  const prepared = parse(readFileSync(destination));
  if (prepared.CONTROL_UNIT_URL !== 'https://control-unit-iota.vercel.app' ||
      prepared.COLLECTOR_ID !== 'rio-primary' || prepared.INGESTION_TOKEN !== token) {
    throw new Error('Prepared collector file did not parse back to the expected settings.');
  }
  const response = await fetch('https://control-unit-iota.vercel.app/api/executions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${prepared.INGESTION_TOKEN}` },
    body: '{}',
  });
  if (response.status !== 400) {
    throw new Error(`Collector authentication check failed (HTTP ${response.status}).`);
  }
  console.log('Hosted ingestion accepted the token parsed from the prepared file; empty test record was rejected without storing data.');
}
