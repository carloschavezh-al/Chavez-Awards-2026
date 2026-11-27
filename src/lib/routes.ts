export type RouteMode = 'landing' | 'admin' | 'screen' | 'vote';

const BACKEND_URL_STORAGE_KEY = 'gala_familiar_backend_url';

export function getConfiguredBackendUrl(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const paramUrl = params.get('backend')?.trim();
  if (paramUrl) {
    try {
      const parsed = new URL(paramUrl);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        const clean = parsed.origin;
        try {
          window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, clean);
        } catch {
          // Ignore storage error
        }
        return clean;
      }
    } catch {
      // Ignore invalid URL
    }
  }
  try {
    return window.localStorage.getItem(BACKEND_URL_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function setConfiguredBackendUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) {
    try {
      window.localStorage.removeItem(BACKEND_URL_STORAGE_KEY);
    } catch {
      // Ignore
    }
    return '';
  }
  const parsed = new URL(trimmed);
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('La URL debe iniciar con https:// o http://');
  }
  const clean = parsed.origin;
  try {
    window.localStorage.setItem(BACKEND_URL_STORAGE_KEY, clean);
  } catch {
    // Ignore
  }
  return clean;
}

export function resolveApiUrl(path: string): string {
  const base = getConfiguredBackendUrl();
  if (!base) return path;
  return `${base}${path}`;
}

export function resolveWsUrl(): string {
  const base = getConfiguredBackendUrl();
  if (base) {
    const parsed = new URL(base);
    const wsProto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProto}//${parsed.host}/ws`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}

export function resolveRouteMode(): RouteMode {
  if (typeof window === 'undefined') return 'landing';

  const hash = window.location.hash.toLowerCase().replace(/^#\/?/, '');
  if (hash === 'votar' || hash === 'vote') return 'vote';
  if (hash === 'pantalla' || hash === 'screen') return 'screen';
  if (hash === 'admin') return 'admin';

  const params = new URLSearchParams(window.location.search);
  const viewParam = params.get('view')?.toLowerCase();
  if (viewParam === 'vote' || viewParam === 'votar') return 'vote';
  if (viewParam === 'screen' || viewParam === 'pantalla') return 'screen';
  if (viewParam === 'admin') return 'admin';

  const pathname = window.location.pathname.toLowerCase().replace(/\/+$/, '');
  if (pathname.endsWith('/votar') || pathname.endsWith('/vote')) {
    return 'vote';
  }
  if (pathname.endsWith('/pantalla') || pathname.endsWith('/screen')) {
    return 'screen';
  }
  if (pathname.endsWith('/admin')) {
    return 'admin';
  }

  return 'landing';
}

export function getAppBasePath(): string {
  if (typeof window === 'undefined') return '/';
  let pathname = window.location.pathname;
  pathname = pathname.replace(/\/(votar|vote|pantalla|screen|admin|index\.html)\/?$/i, '/');
  if (!pathname.endsWith('/')) pathname += '/';
  return pathname;
}

export function buildViewUrl(mode: RouteMode): string {
  if (typeof window === 'undefined') {
    if (mode === 'vote') return '/votar';
    if (mode === 'screen') return '/pantalla';
    if (mode === 'admin') return '/admin';
    return '/';
  }
  const origin = window.location.origin;
  const basePath = getAppBasePath();
  const backend = getConfiguredBackendUrl();
  const isRootHosting = basePath === '/';
  const isGithubPages = window.location.hostname.endsWith('github.io');

  let url: string;
  if (isRootHosting && !isGithubPages) {
    const suffix =
      mode === 'vote'
        ? 'votar'
        : mode === 'screen'
        ? 'pantalla'
        : mode === 'admin'
        ? 'admin'
        : '';
    url = `${origin}/${suffix}`;
  } else if (mode === 'landing') {
    url = `${origin}${basePath}`;
  } else {
    const viewParam = mode === 'vote' ? 'vote' : mode === 'screen' ? 'screen' : 'admin';
    url = `${origin}${basePath}?view=${viewParam}`;
  }

  if (backend && backend !== origin) {
    const sep = url.includes('?') ? '&' : '?';
    url += `${sep}backend=${encodeURIComponent(backend)}`;
  }
  return url;
}
