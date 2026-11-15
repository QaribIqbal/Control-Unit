import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, request } from './api';

afterEach(() => vi.unstubAllGlobals());

describe('dashboard API responses', () => {
  it('preserves unauthorized status so the workspace can clear protected data', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":"Session expired"}', { status: 401 }));
    await expect(request('/api/dashboard')).rejects.toMatchObject({ status: 401, message: 'Session expired' });
  });
  it('reports server configuration errors separately from sign-in errors', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Unavailable</html>', { status: 503 }));
    await expect(request('/api/session')).rejects.toEqual(expect.objectContaining({ status: 503, message: expect.stringContaining('configuration') }));
  });
  it('turns host HTML errors into useful errors without exposing page contents', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Bad gateway</html>', { status: 502 }));
    await expect(request('/api/dashboard')).rejects.toThrow('Server request failed (502)');
  });
  it('rejects an invalid success response instead of treating it as dashboard data', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>Application shell</html>'));
    await expect(request('/api/dashboard')).rejects.toBeInstanceOf(ApiError);
  });
  it('returns successful JSON with same-origin credentials', async () => {
    const fetcher = vi.fn(async () => Response.json({ authenticated: true, mode: 'hosted' }));
    vi.stubGlobal('fetch', fetcher);
    await expect(request('/api/session')).resolves.toEqual({ authenticated: true, mode: 'hosted' });
    expect(fetcher).toHaveBeenCalledWith('/api/session', expect.objectContaining({ credentials: 'same-origin' }));
  });
});
