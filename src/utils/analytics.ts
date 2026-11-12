import {
  ANALYTICS_FILE_PATH,
  fetchCloudJsonFile,
  saveCloudJsonFile
} from './githubSync';

export interface VisitorEntry {
  visitorId: string;
  device: string;
  firstSeen: string;
  lastSeen: string;
  lastSeenTs: number;
  visitsCount: number;
}

export interface ArticleSearchStat {
  articleCode: string;
  name: string;
  barcode: string;
  count: number;
  lastSearchedAt: string;
  lastSearchedTs: number;
  totalStock: number;
}

export interface UserIssueEntry {
  id: string;
  type: 'not_found' | 'out_of_stock' | 'camera_error' | 'photo_scan_error' | 'upload_error';
  title: string;
  detail: string;
  query?: string;
  device: string;
  visitorId: string;
  timestamp: string;
  timestampMs: number;
  occurrences: number;
}

export interface DeductedSaleLogEntry {
  id: string;
  articleCode: string;
  itemName: string;
  size: string;
  barcode: string;
  qtyDeducted: number;
  remainingQty: number;
  source: string;
  timestamp: string;
  timestampMs: number;
}

export interface AnalyticsStoreJson {
  totalVisits: number;
  visitors: VisitorEntry[];
  articleSearches: ArticleSearchStat[];
  issues: UserIssueEntry[];
  soldDeductions?: DeductedSaleLogEntry[];
  updatedAt: number;
}

const VISITOR_ID_KEY = 'stockscan_visitor_id_v1';
const LOCAL_ANALYTICS_KEY = 'stockscan_analytics_local_v1';

export function getOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_ID_KEY);
    if (existing) return existing;
    const generated = `USR-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    localStorage.setItem(VISITOR_ID_KEY, generated);
    return generated;
  } catch {
    return 'USR-GUEST';
  }
}

export function detectDeviceLabel(): string {
  if (typeof navigator === 'undefined') return 'Mobile / Web';
  const ua = navigator.userAgent || '';
  let os = 'Device';
  if (/android/i.test(ua)) os = 'Android Phone';
  else if (/iPhone|iPad|iPod/i.test(ua)) os = 'iPhone / iOS';
  else if (/Windows/i.test(ua)) os = 'Windows PC';
  else if (/Mac/i.test(ua)) os = 'Mac';
  else if (/Linux/i.test(ua)) os = 'Linux';

  let browser = 'Browser';
  if (/Edg\//i.test(ua)) browser = 'Edge';
  else if (/Chrome\//i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) browser = 'Safari';
  else if (/Firefox\//i.test(ua)) browser = 'Firefox';

  return `${os} · ${browser}`;
}

function formatNow(): string {
  return new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function getLocalAnalytics(): AnalyticsStoreJson {
  try {
    const raw = localStorage.getItem(LOCAL_ANALYTICS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AnalyticsStoreJson;
      if (parsed && Array.isArray(parsed.visitors)) {
        return parsed;
      }
    }
  } catch {
    // Ignore
  }
  return {
    totalVisits: 0,
    visitors: [],
    articleSearches: [],
    issues: [],
    updatedAt: 0
  };
}

function saveLocalAnalytics(data: AnalyticsStoreJson) {
  try {
    localStorage.setItem(LOCAL_ANALYTICS_KEY, JSON.stringify(data));
  } catch {
    // Ignore
  }
}

function applyEventToStore(
  store: AnalyticsStoreJson,
  payload: {
    eventType: 'visit' | 'heartbeat' | 'search' | 'issue' | 'deduction';
    visitorId: string;
    device: string;
    article?: {
      articleCode: string;
      name: string;
      barcode: string;
      totalStock: number;
    };
    issue?: {
      type: 'not_found' | 'out_of_stock' | 'camera_error' | 'photo_scan_error' | 'upload_error';
      title: string;
      detail: string;
      query?: string;
    };
    deductions?: DeductedSaleLogEntry[];
  }
): AnalyticsStoreJson {
  const nowMs = Date.now();
  const nowStr = formatNow();
  const { visitorId, device } = payload;

  if (!Array.isArray(store.soldDeductions)) {
    store.soldDeductions = [];
  }

  if (payload.eventType === 'deduction' && Array.isArray(payload.deductions)) {
    for (const item of payload.deductions) {
      store.soldDeductions.unshift(item);
    }
    // Keep last 150 sold deductions
    if (store.soldDeductions.length > 150) {
      store.soldDeductions = store.soldDeductions.slice(0, 150);
    }
  }

  const existingVisitor = store.visitors.find((v) => v.visitorId === visitorId);
  if (existingVisitor) {
    existingVisitor.lastSeen = nowStr;
    existingVisitor.lastSeenTs = nowMs;
    existingVisitor.device = device;
    if (payload.eventType === 'visit') {
      existingVisitor.visitsCount += 1;
      store.totalVisits += 1;
    }
  } else {
    store.visitors.unshift({
      visitorId,
      device,
      firstSeen: nowStr,
      lastSeen: nowStr,
      lastSeenTs: nowMs,
      visitsCount: 1
    });
    store.totalVisits += 1;
  }

  if (payload.eventType === 'search' && payload.article?.articleCode) {
    const codeKey = payload.article.articleCode.trim().toLowerCase();
    const existingArt = store.articleSearches.find(
      (a) => a.articleCode.toLowerCase() === codeKey
    );
    if (existingArt) {
      existingArt.count += 1;
      existingArt.lastSearchedAt = nowStr;
      existingArt.lastSearchedTs = nowMs;
      existingArt.name = payload.article.name || existingArt.name;
      existingArt.barcode = payload.article.barcode || existingArt.barcode;
      existingArt.totalStock = payload.article.totalStock;
    } else {
      store.articleSearches.push({
        articleCode: payload.article.articleCode,
        name: payload.article.name || payload.article.articleCode,
        barcode: payload.article.barcode || '',
        count: 1,
        lastSearchedAt: nowStr,
        lastSearchedTs: nowMs,
        totalStock: payload.article.totalStock
      });
    }
    store.articleSearches.sort((a, b) => b.count - a.count);
  }

  if (payload.eventType === 'issue' && payload.issue) {
    const { type, title, detail, query } = payload.issue;
    const cleanQ = (query || '').trim().toLowerCase();
    const existingIss = store.issues.find(
      (iss) =>
        iss.type === type &&
        (cleanQ ? (iss.query || '').toLowerCase() === cleanQ : iss.detail === detail)
    );
    if (existingIss) {
      existingIss.occurrences += 1;
      existingIss.timestamp = nowStr;
      existingIss.timestampMs = nowMs;
      existingIss.device = device;
    } else {
      store.issues.unshift({
        id: `iss-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
        type,
        title,
        detail,
        query: query?.trim(),
        device,
        visitorId,
        timestamp: nowStr,
        timestampMs: nowMs,
        occurrences: 1
      });
    }
  }

  store.updatedAt = nowMs;
  return store;
}

export async function recordDeductionsToAnalytics(
  deductions: DeductedSaleLogEntry[]
): Promise<void> {
  const visitorId = getOrCreateVisitorId();
  const device = detectDeviceLabel();
  const eventPayload = {
    eventType: 'deduction' as const,
    visitorId,
    device,
    deductions
  };

  const local = applyEventToStore(getLocalAnalytics(), eventPayload);
  saveLocalAnalytics(local);

  try {
    const remote =
      (await fetchCloudJsonFile<AnalyticsStoreJson>(ANALYTICS_FILE_PATH)) ||
      getLocalAnalytics();
    const updated = applyEventToStore(remote, eventPayload);
    saveLocalAnalytics(updated);
    await saveCloudJsonFile(
      ANALYTICS_FILE_PATH,
      updated,
      `Record ${deductions.length} sold deduction(s)`
    );
  } catch {
    // Ignore
  }
}

let cloudSyncPending = false;

async function syncAnalyticsToCloud(eventPayload: {
  eventType: 'visit' | 'heartbeat' | 'search' | 'issue';
  visitorId: string;
  device: string;
  article?: {
    articleCode: string;
    name: string;
    barcode: string;
    totalStock: number;
  };
  issue?: {
    type: 'not_found' | 'out_of_stock' | 'camera_error' | 'photo_scan_error' | 'upload_error';
    title: string;
    detail: string;
    query?: string;
  };
}) {
  if (eventPayload.eventType === 'heartbeat') return;
  if (cloudSyncPending) return;
  cloudSyncPending = true;

  try {
    const remote =
      (await fetchCloudJsonFile<AnalyticsStoreJson>(ANALYTICS_FILE_PATH)) ||
      getLocalAnalytics();
    const updated = applyEventToStore(remote, eventPayload);
    saveLocalAnalytics(updated);
    await saveCloudJsonFile(
      ANALYTICS_FILE_PATH,
      updated,
      `Update analytics (${eventPayload.eventType})`
    );
  } catch {
    // Ignore network error
  } finally {
    cloudSyncPending = false;
  }
}

export async function trackAnalyticsEvent(payload: {
  eventType: 'visit' | 'heartbeat' | 'search' | 'issue';
  article?: {
    articleCode: string;
    name: string;
    barcode: string;
    totalStock: number;
  };
  issue?: {
    type: 'not_found' | 'out_of_stock' | 'camera_error' | 'photo_scan_error' | 'upload_error';
    title: string;
    detail: string;
    query?: string;
  };
}): Promise<void> {
  const visitorId = getOrCreateVisitorId();
  const device = detectDeviceLabel();
  const fullPayload = { ...payload, visitorId, device };

  // 1. Update local copy immediately
  const local = applyEventToStore(getLocalAnalytics(), fullPayload);
  saveLocalAnalytics(local);

  // 2. If on server origin, update /api/analytics/event
  if (typeof window !== 'undefined' && !window.location.hostname.includes('github.io')) {
    try {
      await fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullPayload)
      });
    } catch {
      // Ignore
    }
  }

  // 3. Also sync to shared cloud analytics JSON so all phones report to central dashboard
  syncAnalyticsToCloud(fullPayload);
}

export async function fetchAnalyticsData(): Promise<AnalyticsStoreJson> {
  const local = getLocalAnalytics();
  const cloud = await fetchCloudJsonFile<AnalyticsStoreJson>(ANALYTICS_FILE_PATH);

  // Merge soldDeductions intelligently so deductions from Chrome Extension on GitHub are never lost
  const deductionMap = new Map<string, DeductedSaleLogEntry>();

  if (cloud && Array.isArray(cloud.soldDeductions)) {
    for (const d of cloud.soldDeductions) {
      if (d && (d.id || d.barcode)) {
        const key = d.id || `${d.barcode}-${d.timestampMs}`;
        deductionMap.set(key, d);
      }
    }
  }

  if (local && Array.isArray(local.soldDeductions)) {
    for (const d of local.soldDeductions) {
      if (d && (d.id || d.barcode)) {
        const key = d.id || `${d.barcode}-${d.timestampMs}`;
        if (!deductionMap.has(key)) {
          deductionMap.set(key, d);
        }
      }
    }
  }

  const mergedDeductions = Array.from(deductionMap.values()).sort(
    (a, b) => (b.timestampMs || 0) - (a.timestampMs || 0)
  );

  // Pick the best base record
  const candidates: AnalyticsStoreJson[] = [local];
  if (cloud && Array.isArray(cloud.visitors)) {
    candidates.push(cloud);
  }
  candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  const best: AnalyticsStoreJson = {
    ...candidates[0],
    soldDeductions: mergedDeductions
  };

  saveLocalAnalytics(best);
  return best;
}

export async function resetAnalyticsData(): Promise<AnalyticsStoreJson> {
  const empty: AnalyticsStoreJson = {
    totalVisits: 0,
    visitors: [],
    articleSearches: [],
    issues: [],
    updatedAt: Date.now()
  };
  saveLocalAnalytics(empty);

  if (typeof window !== 'undefined' && !window.location.hostname.includes('github.io')) {
    try {
      await fetch('/api/analytics/reset', { method: 'POST' });
    } catch {
      // Ignore
    }
  }

  await saveCloudJsonFile(ANALYTICS_FILE_PATH, empty, 'Reset analytics logs');
  return empty;
}
