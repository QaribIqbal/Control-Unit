import type { IncomingMessage, ServerResponse } from 'node:http';
// Vercel's catch-all route preserves each public /api/... URL for Express.
import { getHostedApp, unavailableApp } from '../server/cloud.js';

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  let app; try { app = await getHostedApp(); } catch { app = unavailableApp(); }
  app(req, res);
}
