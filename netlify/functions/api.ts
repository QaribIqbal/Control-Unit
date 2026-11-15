import serverless from 'serverless-http';
import { getHostedApp, unavailableApp } from '../../server/cloud';

export const handler = async (event: Parameters<ReturnType<typeof serverless>>[0], context: Parameters<ReturnType<typeof serverless>>[1]) => {
  let app; try { app = await getHostedApp(); } catch { app = unavailableApp(); }
  // Netlify redirects preserve /api in the public event path. Direct function
  // invocations use the function's internal prefix, which Express does not.
  const functionPrefix = '/.netlify/functions/api';
  const path = (event as { path?: string }).path || '';
  const normalizedEvent = path.startsWith(`${functionPrefix}/`) || path === functionPrefix
    ? { ...event, path: `/api${path.slice(functionPrefix.length)}` }
    : event;
  return serverless(app)(normalizedEvent, context);
};
