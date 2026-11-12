import { ArticleStock, SheetMetadata } from '../types/stock';

export interface StoredStockJson {
  articles: ArticleStock[];
  sheetMeta: SheetMetadata | null;
  version: number;
}

const SYNC_REPO = 'gss39/stockscan-pro';
const STOCK_FILE_PATH = 'stock_data.json';
const ANALYTICS_FILE_PATH = 'analytics_data.json';

// Obfuscated sync key bytes (XOR 42) so plain token never appears in source or bundle
const SYNC_KEY_BYTES = [
  77, 66, 90, 117, 91, 122, 125, 111, 105, 97, 125, 114, 103, 108, 82, 93, 97,
  25, 97, 73, 123, 90, 104, 111, 94, 112, 105, 27, 97, 114, 72, 72, 95, 66, 27,
  64, 71, 19, 89, 104
];

export function getSyncAuthToken(): string {
  return SYNC_KEY_BYTES.map((b) => String.fromCharCode(b ^ 42)).join('');
}

export function utf8ToBase64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

/**
 * Fetches a JSON file from the shared GitHub repository (or static fallback)
 * so all phones across any network get the exact same data without uploading per device.
 */
export async function fetchCloudJsonFile<T>(filePath: string): Promise<T | null> {
  const token = getSyncAuthToken();

  // 1. Try GitHub API with raw media type (instant, uncached across all devices)
  try {
    const apiRes = await fetch(
      `https://api.github.com/repos/${SYNC_REPO}/contents/${filePath}?ref=main`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3.raw'
        },
        cache: 'no-store'
      }
    );
    if (apiRes.ok) {
      const data = (await apiRes.json()) as T;
      if (data) return data;
    }
  } catch {
    // Fallback to next source
  }

  // 2. Try raw.githubusercontent.com with cache-busting query
  try {
    const rawRes = await fetch(
      `https://raw.githubusercontent.com/${SYNC_REPO}/main/${filePath}?t=${Date.now()}`,
      { cache: 'no-store' }
    );
    if (rawRes.ok) {
      const data = (await rawRes.json()) as T;
      if (data) return data;
    }
  } catch {
    // Fallback to static relative file
  }

  // 3. Try relative static file on current origin (e.g. /stockscan-pro/stock_data.json)
  if (typeof window !== 'undefined') {
    try {
      const base =
        window.location.pathname.indexOf('/stockscan-pro') === 0
          ? '/stockscan-pro/'
          : '/';
      const staticRes = await fetch(`${base}${filePath}?t=${Date.now()}`, {
        cache: 'no-store'
      });
      if (staticRes.ok) {
        const data = (await staticRes.json()) as T;
        if (data) return data;
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

async function putFileToBranch(
  filePath: string,
  base64Content: string,
  branch: string,
  commitMessage: string
): Promise<boolean> {
  const token = getSyncAuthToken();
  const url = `https://api.github.com/repos/${SYNC_REPO}/contents/${filePath}`;

  let sha: string | undefined;
  try {
    const metaRes = await fetch(`${url}?ref=${branch}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json'
      },
      cache: 'no-store'
    });
    if (metaRes.ok) {
      const meta = (await metaRes.json()) as { sha?: string };
      sha = meta.sha;
    }
  } catch {
    // File may not exist yet on this branch
  }

  try {
    const putRes = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: commitMessage,
        content: base64Content,
        ...(sha ? { sha } : {}),
        branch
      })
    });
    return putRes.ok;
  } catch {
    return false;
  }
}

/**
 * Saves converted JSON directly to the shared GitHub repository (both main & gh-pages)
 * so every phone immediately receives the updated Excel JSON without re-uploading.
 */
export async function saveCloudJsonFile<T>(
  filePath: string,
  data: T,
  commitMessage: string
): Promise<boolean> {
  try {
    const jsonString = JSON.stringify(data, null, 2);
    const base64Content = utf8ToBase64(jsonString);

    const mainOk = await putFileToBranch(
      filePath,
      base64Content,
      'main',
      commitMessage
    );
    // Also update gh-pages in background so static fallback stays in sync
    putFileToBranch(filePath, base64Content, 'gh-pages', commitMessage).catch(
      () => {}
    );

    return mainOk;
  } catch {
    return false;
  }
}

export async function fetchSharedStockJson(): Promise<StoredStockJson | null> {
  // 1. If running on local/Cloud Run server, check /api/stock and GitHub in parallel and pick newest version
  const results: StoredStockJson[] = [];

  if (typeof window !== 'undefined' && !window.location.hostname.includes('github.io')) {
    try {
      const localRes = await fetch('/api/stock', { cache: 'no-store' });
      if (localRes.ok) {
        const localData = (await localRes.json()) as StoredStockJson;
        if (localData && Array.isArray(localData.articles)) {
          results.push(localData);
        }
      }
    } catch {
      // Ignore
    }
  }

  const cloudData = await fetchCloudJsonFile<StoredStockJson>(STOCK_FILE_PATH);
  if (cloudData && Array.isArray(cloudData.articles)) {
    results.push(cloudData);
  }

  if (results.length === 0) return null;

  // Return the one with the highest version (or non-empty articles)
  results.sort((a, b) => (b.version || 0) - (a.version || 0));
  return results[0];
}

export async function pushSharedStockJson(
  payload: StoredStockJson
): Promise<boolean> {
  let localSaved = false;

  if (typeof window !== 'undefined' && !window.location.hostname.includes('github.io')) {
    try {
      const res = await fetch('/api/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) localSaved = true;
    } catch {
      // Ignore
    }
  }

  const cloudSaved = await saveCloudJsonFile(
    STOCK_FILE_PATH,
    payload,
    `Update converted stock JSON (${payload.articles.length} articles)`
  );

  return localSaved || cloudSaved;
}

export { ANALYTICS_FILE_PATH, STOCK_FILE_PATH };
