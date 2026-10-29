// Hand-rolled hash routing (plan: no react-router). Hash shape is
// "#/<page>" or "#/<page>/<param>" (used only by rooms detail so far).
// Project selection lives in ProjectContext/localStorage, not the URL.

import { useEffect, useState } from 'react';

export type Page =
  | 'dashboard'
  | 'keep'
  | 'chronicle'
  | 'rooms'
  | 'routes'
  | 'patrol'
  | 'doctor'
  | 'import'
  | 'settings';

export const PAGES: { page: Page; label: string }[] = [
  { page: 'dashboard', label: '總覽' },
  { page: 'keep', label: 'Keep 儀表板' },
  { page: 'chronicle', label: 'Chronicle 時間軸' },
  { page: 'rooms', label: '房間瀏覽' },
  { page: 'routes', label: '路線與巡行' },
  { page: 'patrol', label: '巡查' },
  { page: 'doctor', label: '健康檢查' },
  { page: 'import', label: '匯入精靈' },
  { page: 'settings', label: '設定' },
];

const KNOWN_PAGES = new Set<Page>(PAGES.map((p) => p.page));

export interface Route {
  page: Page;
  param?: string;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const [pageRaw, ...rest] = raw.split('/');
  const page = KNOWN_PAGES.has(pageRaw as Page) ? (pageRaw as Page) : 'dashboard';
  const param = rest.length > 0 ? decodeURIComponent(rest.join('/')) : undefined;
  return { page, param };
}

export function useHashRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string): void {
  window.location.hash = path;
}
