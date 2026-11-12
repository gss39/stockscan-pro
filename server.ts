import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { ArticleStock, SheetMetadata } from './src/types/stock.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const JSON_STORE_PATH = path.join(__dirname, 'stock_data.json');
const ANALYTICS_STORE_PATH = path.join(__dirname, 'analytics_data.json');

interface StoredStockJson {
  articles: ArticleStock[];
  sheetMeta: SheetMetadata | null;
  version: number;
}

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

export interface AnalyticsStoreJson {
  totalVisits: number;
  visitors: VisitorEntry[];
  articleSearches: ArticleSearchStat[];
  issues: UserIssueEntry[];
  updatedAt: number;
}

function loadJsonStore(): StoredStockJson {
  try {
    if (fs.existsSync(JSON_STORE_PATH)) {
      const raw = fs.readFileSync(JSON_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as StoredStockJson;
      if (parsed && Array.isArray(parsed.articles)) {
        return parsed;
      }
    }
  } catch {
    // Ignore read error and return empty store
  }
  return {
    articles: [],
    sheetMeta: null,
    version: 0
  };
}

function loadAnalyticsStore(): AnalyticsStoreJson {
  try {
    if (fs.existsSync(ANALYTICS_STORE_PATH)) {
      const raw = fs.readFileSync(ANALYTICS_STORE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as AnalyticsStoreJson;
      if (parsed && Array.isArray(parsed.visitors)) {
        return parsed;
      }
    }
  } catch {
    // Ignore read error
  }
  return {
    totalVisits: 0,
    visitors: [],
    articleSearches: [],
    issues: [],
    updatedAt: Date.now()
  };
}

let currentStockJson: StoredStockJson = loadJsonStore();
let currentAnalyticsJson: AnalyticsStoreJson = loadAnalyticsStore();

function saveJsonStore(nextData: StoredStockJson) {
  currentStockJson = nextData;
  try {
    fs.writeFileSync(JSON_STORE_PATH, JSON.stringify(currentStockJson, null, 2), 'utf-8');
  } catch {
    // Ignore write error in read-only filesystems (still kept in memory)
  }
}

function saveAnalyticsStore(nextData: AnalyticsStoreJson) {
  currentAnalyticsJson = nextData;
  try {
    fs.writeFileSync(ANALYTICS_STORE_PATH, JSON.stringify(currentAnalyticsJson, null, 2), 'utf-8');
  } catch {
    // Ignore write error in read-only filesystems
  }
}

function formatTimeNow(): string {
  return new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Enable CORS so both the main app and GitHub Pages live site can read/update the shared JSON store
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    next();
  });

  app.use(express.json({ limit: '25mb' }));

  // GET /api/stock — Returns the latest converted JSON stock data to all phones
  app.get('/api/stock', (_req, res) => {
    res.json(currentStockJson);
  });

  // POST /api/stock — Receives converted JSON from Excel upload and updates the shared JSON store
  app.post('/api/stock', (req, res) => {
    const { articles, sheetMeta } = req.body as {
      articles?: ArticleStock[];
      sheetMeta?: SheetMetadata;
    };

    if (!Array.isArray(articles)) {
      res.status(400).json({ error: 'Invalid JSON stock payload.' });
      return;
    }

    const totalPieces = articles.reduce(
      (sum, a) => sum + (a.sizes || []).reduce((s, z) => s + (Number(z.quantity) || 0), 0),
      0
    );

    const updatedMeta: SheetMetadata = sheetMeta || {
      fileName: 'Stock_Sheet.xlsx',
      uploadedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      totalArticles: articles.length,
      totalPieces
    };

    const nextJson: StoredStockJson = {
      articles,
      sheetMeta: updatedMeta,
      version: Date.now()
    };

    saveJsonStore(nextJson);
    res.json({ ok: true, version: nextJson.version, sheetMeta: nextJson.sheetMeta });
  });

  // POST /api/stock/sale — Deducts (or adds) quantity for a scanned barcode when a bill is saved in Logic ERP
  app.post('/api/stock/sale', (req, res) => {
    const { barcode, qty = 1 } = req.body as { barcode?: string; qty?: number };
    const cleanCode = (barcode || '').trim().toLowerCase();
    if (!cleanCode) {
      res.status(400).json({ error: 'Barcode is required.' });
      return;
    }

    const deductAmount = Number(qty) || 1;
    let matchedArticleName = '';
    let matchedSizeLabel = '';
    let newRemainingQty = 0;
    let found = false;

    for (const art of currentStockJson.articles) {
      for (const sz of art.sizes || []) {
        if ((sz.barcode || '').trim().toLowerCase() === cleanCode) {
          sz.quantity = Math.max(0, (Number(sz.quantity) || 0) - deductAmount);
          matchedArticleName = art.name;
          matchedSizeLabel = sz.size;
          newRemainingQty = sz.quantity;
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      res.status(404).json({ error: `Barcode "${barcode}" not found in active stock.` });
      return;
    }

    const totalPieces = currentStockJson.articles.reduce(
      (sum, a) => sum + (a.sizes || []).reduce((s, z) => s + (Number(z.quantity) || 0), 0),
      0
    );

    const nextJson: StoredStockJson = {
      articles: currentStockJson.articles,
      sheetMeta: {
        fileName: currentStockJson.sheetMeta?.fileName || 'LogicERP_Live_Sync',
        uploadedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        totalArticles: currentStockJson.articles.length,
        totalPieces
      },
      version: Date.now()
    };

    saveJsonStore(nextJson);
    res.json({
      ok: true,
      articleName: matchedArticleName,
      size: matchedSizeLabel,
      remainingQty: newRemainingQty,
      version: nextJson.version
    });
  });

  // GET /api/analytics — Returns visitor stats, most searched articles, and user issues
  app.get('/api/analytics', (_req, res) => {
    res.json(currentAnalyticsJson);
  });

  // POST /api/analytics/event — Tracks visits, article searches, and user issues
  app.post('/api/analytics/event', (req, res) => {
    const body = req.body as {
      eventType?: 'visit' | 'heartbeat' | 'search' | 'issue';
      visitorId?: string;
      device?: string;
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
    };

    const nowMs = Date.now();
    const nowFormatted = formatTimeNow();
    const visitorId = (body.visitorId || 'anon').slice(0, 64);
    const device = (body.device || 'Mobile / Web').slice(0, 80);

    // Update or create visitor entry
    const existingVisitor = currentAnalyticsJson.visitors.find((v) => v.visitorId === visitorId);
    if (existingVisitor) {
      existingVisitor.lastSeen = nowFormatted;
      existingVisitor.lastSeenTs = nowMs;
      existingVisitor.device = device;
      if (body.eventType === 'visit') {
        existingVisitor.visitsCount += 1;
        currentAnalyticsJson.totalVisits += 1;
      }
    } else {
      currentAnalyticsJson.visitors.unshift({
        visitorId,
        device,
        firstSeen: nowFormatted,
        lastSeen: nowFormatted,
        lastSeenTs: nowMs,
        visitsCount: 1
      });
      currentAnalyticsJson.totalVisits += 1;
    }

    // Keep visitor list capped at 200 entries
    if (currentAnalyticsJson.visitors.length > 200) {
      currentAnalyticsJson.visitors = currentAnalyticsJson.visitors.slice(0, 200);
    }

    // Record article search
    if (body.eventType === 'search' && body.article && body.article.articleCode) {
      const codeKey = body.article.articleCode.trim().toLowerCase();
      const existingArt = currentAnalyticsJson.articleSearches.find(
        (a) => a.articleCode.toLowerCase() === codeKey
      );
      if (existingArt) {
        existingArt.count += 1;
        existingArt.lastSearchedAt = nowFormatted;
        existingArt.lastSearchedTs = nowMs;
        existingArt.name = body.article.name || existingArt.name;
        existingArt.barcode = body.article.barcode || existingArt.barcode;
        existingArt.totalStock = body.article.totalStock;
      } else {
        currentAnalyticsJson.articleSearches.push({
          articleCode: body.article.articleCode,
          name: body.article.name || body.article.articleCode,
          barcode: body.article.barcode || '',
          count: 1,
          lastSearchedAt: nowFormatted,
          lastSearchedTs: nowMs,
          totalStock: body.article.totalStock
        });
      }

      currentAnalyticsJson.articleSearches.sort((a, b) => b.count - a.count);
    }

    // Record user issue / problem
    if (body.eventType === 'issue' && body.issue) {
      const { type, title, detail, query } = body.issue;
      const cleanQuery = (query || '').trim().toLowerCase();

      // Deduplicate identical recent issues by type + query
      const existingIssue = currentAnalyticsJson.issues.find(
        (iss) =>
          iss.type === type &&
          (cleanQuery
            ? (iss.query || '').toLowerCase() === cleanQuery
            : iss.detail === detail)
      );

      if (existingIssue) {
        existingIssue.occurrences += 1;
        existingIssue.timestamp = nowFormatted;
        existingIssue.timestampMs = nowMs;
        existingIssue.device = device;
      } else {
        currentAnalyticsJson.issues.unshift({
          id: `iss-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
          type,
          title,
          detail,
          query: query?.trim(),
          device,
          visitorId,
          timestamp: nowFormatted,
          timestampMs: nowMs,
          occurrences: 1
        });
      }

      if (currentAnalyticsJson.issues.length > 200) {
        currentAnalyticsJson.issues = currentAnalyticsJson.issues.slice(0, 200);
      }
    }

    currentAnalyticsJson.updatedAt = nowMs;
    saveAnalyticsStore(currentAnalyticsJson);

    res.json({ ok: true, updatedAt: nowMs });
  });

  // POST /api/analytics/reset — Clears analytics logs from the dashboard
  app.post('/api/analytics/reset', (_req, res) => {
    currentAnalyticsJson = {
      totalVisits: 0,
      visitors: [],
      articleSearches: [],
      issues: [],
      updatedAt: Date.now()
    };
    saveAnalyticsStore(currentAnalyticsJson);
    res.json({ ok: true, analytics: currentAnalyticsJson });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`StockScan JSON Sync Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
