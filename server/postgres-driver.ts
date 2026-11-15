import { Pool } from 'pg';
import type { PoolClient } from 'pg';
import type { SqlDatabase } from './postgres-store.js';

export type { SqlDatabase } from './postgres-store.js';

export function createPostgresDatabase(connectionString: string): SqlDatabase {
  let pool: Pool;
  try {
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
    const mode = url.searchParams.get('sslmode');
    // pg accepts nonstandard flags that weaken TLS. Never permit those to
    // override certificate validation, including through environment defaults.
    if (mode === 'no-verify' || url.searchParams.get('ssl') === 'no-verify' ||
        url.searchParams.get('uselibpqcompat') === 'true' ||
        (!mode && !url.searchParams.has('ssl') && process.env.PGSSLMODE === 'no-verify')) throw new Error();
    if (mode && !['disable', 'prefer', 'require', 'verify-ca', 'verify-full'].includes(mode)) throw new Error();
    // Preserve the URL's encryption choice and CA/client-certificate settings;
    // make pg's certificate-verifying behavior explicit across pg versions.
    if (mode && mode !== 'disable') url.searchParams.set('sslmode', 'verify-full');
    pool = new Pool({
      connectionString: url.toString(), max: 3,
      connectionTimeoutMillis: 10_000, idleTimeoutMillis: 10_000,
      statement_timeout: 15_000, idle_in_transaction_session_timeout: 15_000,
      allowExitOnIdle: true,
    });
  } catch {
    throw new Error('Invalid PostgreSQL connection configuration');
  }
  // pg has already discarded an idle client when it emits this event. Avoid an
  // unhandled event without logging raw driver errors or the connection URL.
  pool.on('error', () => { console.error('PostgreSQL idle connection failed'); });

  const query = async <T extends Record<string, unknown>>(connection: Pool | PoolClient, text: string, params?: unknown[]): Promise<{ rows: T[] }> => {
    try { return await connection.query<T>(text, params); }
    catch { throw new Error('PostgreSQL query failed'); }
  };

  return {
    query: (text, params) => query(pool, text, params),
    async transaction<T>(fn: (db: SqlDatabase) => Promise<T>): Promise<T> {
      let client: PoolClient;
      try { client = await pool.connect(); }
      catch { throw new Error('PostgreSQL connection failed'); }
      let discard = false;
      const connection: SqlDatabase = {
        query: (text, params) => query(client, text, params),
        async transaction() { throw new Error('Nested PostgreSQL transactions are unsupported'); },
        async close() { throw new Error('Transaction connections are owned by the pool'); },
      };
      try {
        await query(client, 'BEGIN');
        const result = await fn(connection);
        await query(client, 'COMMIT');
        return result;
      } catch (error) {
        try { await query(client, 'ROLLBACK'); }
        catch { discard = true; }
        throw error;
      } finally { client.release(discard); }
    },
    async close() {
      try { await pool.end(); }
      catch { throw new Error('PostgreSQL shutdown failed'); }
    },
  };
}
