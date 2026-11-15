export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...options });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      response.status === 503
        ? 'Server configuration needs attention. Check the deployment environment and database connection.'
        : response.status === 401
          ? 'Your session has expired. Sign in again.'
          : response.ok
            ? 'The server returned an unexpected response. Check that the API is deployed with this dashboard.'
            : `Server request failed (${response.status}). Try again or check the deployment logs.`,
      response.status,
    );
  }
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload
      && typeof payload.error === 'string' ? payload.error : null;
    throw new ApiError(response.status === 503
      ? `Server configuration needs attention. ${detail || 'Check the deployment environment and database connection.'}`
      : detail || `Server request failed (${response.status}). Please try again.`, response.status);
  }
  return payload as T;
}
