let memoryBearerToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;

export function setBearerToken(token: string | null): void {
  memoryBearerToken = token;
}

export function getBearerToken(): string | null {
  return memoryBearerToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler;
}

export async function apiFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (memoryBearerToken && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${memoryBearerToken}`);
  }

  const res = await fetch(input, {
    ...init,
    headers,
  });

  if (res.status === 401 && unauthorizedHandler) {
    memoryBearerToken = null;
    unauthorizedHandler();
  }

  return res;
}
