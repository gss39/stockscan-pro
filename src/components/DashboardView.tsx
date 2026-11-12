import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Layers,
  MinusCircle,
  PackageCheck,
  PlusCircle,
  Puzzle,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Unplug
} from 'lucide-react';
import { ArticleStock } from '../types/stock';
import {
  AnalyticsStoreJson,
  fetchAnalyticsData,
  getLocalAnalytics,
  recordDeductionsToAnalytics,
  resetAnalyticsData
} from '../utils/analytics';
import { downloadChromeExtensionZip } from '../utils/chromeExtensionGenerator';
import { fetchSharedStockJson, pushSharedStockJson } from '../utils/githubSync';
import { downloadLogicErpAutoSyncBat } from '../utils/logicErpSyncGenerator';

interface DashboardViewProps {
  totalArticlesInSheet: number;
  totalPiecesInSheet: number;
  sheetFileName?: string;
  articles?: ArticleStock[];
  onRefreshStock?: () => Promise<void> | void;
}

type DashboardMenuTab = 'overview' | 'logic-db' | 'stock-data' | 'sold-history' | 'extension';

type LogicConnectionMode = 'chrome-web' | 'desktop-sql';

interface LogicDbConnectionState {
  connected: boolean;
  connectionMode: LogicConnectionMode;
  storeName: string;
  // Chrome / Web Dashboard Version fields
  webPortalUrl: string;
  webUserId: string;
  webPassword: string;
  // Desktop SQL Server Version fields
  sqlServer: string;
  sqlDatabase: string;
  sqlUser: string;
  sqlPassword: string;
  connectedAt: string;
}

const LOGIC_DB_STORAGE_KEY = 'stockscan_logic_db_connection_v3';

function loadSavedLogicDbState(): LogicDbConnectionState {
  try {
    const raw = localStorage.getItem(LOGIC_DB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LogicDbConnectionState>;
      if (parsed && typeof parsed === 'object') {
        return {
          connected: Boolean(parsed.connected),
          connectionMode:
            parsed.connectionMode === 'desktop-sql' ? 'desktop-sql' : 'chrome-web',
          storeName: parsed.storeName || 'Elooks Main Store',
          webPortalUrl: parsed.webPortalUrl || 'https://erp.logicerp.com',
          webUserId: parsed.webUserId || 'admin',
          webPassword: parsed.webPassword || '',
          sqlServer: parsed.sqlServer || 'localhost\\SQLEXPRESS',
          sqlDatabase: parsed.sqlDatabase || 'LOGICDATA',
          sqlUser: parsed.sqlUser || 'sa',
          sqlPassword: parsed.sqlPassword || '',
          connectedAt: parsed.connectedAt || ''
        };
      }
    }
  } catch {
    // Ignore storage read errors
  }
  return {
    connected: false,
    connectionMode: 'chrome-web',
    storeName: 'Elooks Main Store',
    webPortalUrl: 'https://erp.logicerp.com',
    webUserId: 'admin',
    webPassword: '',
    sqlServer: 'localhost\\SQLEXPRESS',
    sqlDatabase: 'LOGICDATA',
    sqlUser: 'sa',
    sqlPassword: '',
    connectedAt: ''
  };
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  totalArticlesInSheet,
  totalPiecesInSheet,
  sheetFileName,
  articles: propArticles = [],
  onRefreshStock
}) => {
  const [activeTab, setActiveTab] = useState<DashboardMenuTab>('overview');
  const [analytics, setAnalytics] = useState<AnalyticsStoreJson>(() => getLocalAnalytics());
  const [cloudArticles, setCloudArticles] = useState<ArticleStock[]>(propArticles);
  const [cloudFileName, setCloudFileName] = useState<string>(sheetFileName || '');
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [confirmClear, setConfirmClear] = useState<boolean>(false);

  // Logic ERP Database Connection State
  const [dbState, setDbState] = useState<LogicDbConnectionState>(() => loadSavedLogicDbState());
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [isConnectingDb, setIsConnectingDb] = useState<boolean>(false);
  const [dbConnectStep, setDbConnectStep] = useState<string>('');
  const [dbFeedback, setDbFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Quick Minus State
  const [quickBarcode, setQuickBarcode] = useState('');
  const [quickQty, setQuickQty] = useState(1);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickFeedback, setQuickFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  // Live Stock Explorer Search & Filter State
  const [stockSearch, setStockSearch] = useState('');
  const [stockFilter, setStockFilter] = useState<'all' | 'in-stock' | 'low' | 'out'>('all');
  const [adjustingKey, setAdjustingKey] = useState<string | null>(null);

  const activeArticles = useMemo(
    () => (cloudArticles.length > 0 ? cloudArticles : propArticles),
    [cloudArticles, propArticles]
  );

  // Strictly separate Excel uploaded data from real Logic ERP synced data
  const effectiveSourceFileName = cloudFileName || sheetFileName || '';
  const isRealLogicSyncedSource = useMemo(
    () => effectiveSourceFileName.toLowerCase().includes('logic'),
    [effectiveSourceFileName]
  );

  const logicErpOnlyArticles = useMemo(() => {
    if (isRealLogicSyncedSource) return activeArticles;
    return activeArticles.filter((a) =>
      String((a as { rack?: string }).rack || '')
        .toLowerCase()
        .includes('logic')
    );
  }, [activeArticles, isRealLogicSyncedSource]);

  const logicErpOnlyPieces = useMemo(
    () =>
      logicErpOnlyArticles.reduce(
        (sum, art) =>
          sum +
          (art.sizes || []).reduce((s, sz) => s + Math.max(0, Number(sz.quantity) || 0), 0),
        0
      ),
    [logicErpOnlyArticles]
  );

  useEffect(() => {
    if (propArticles.length > 0) {
      setCloudArticles(propArticles);
    }
  }, [propArticles]);

  const loadData = useCallback(
    async (showSpinner = false) => {
      if (showSpinner) setIsRefreshing(true);
      const [freshAnalytics, freshStock] = await Promise.all([
        fetchAnalyticsData(),
        fetchSharedStockJson()
      ]);
      setAnalytics(freshAnalytics);
      if (freshStock && Array.isArray(freshStock.articles) && freshStock.articles.length > 0) {
        setCloudArticles(freshStock.articles);
        if (freshStock.sheetMeta?.fileName) {
          setCloudFileName(freshStock.sheetMeta.fileName);
        }
      }
      if (onRefreshStock) {
        await onRefreshStock();
      }
      if (showSpinner) setIsRefreshing(false);
    },
    [onRefreshStock]
  );

  useEffect(() => {
    loadData(true);
    const interval = setInterval(() => loadData(false), 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Save DB connection state to localStorage
  const persistDbState = (next: LogicDbConnectionState) => {
    setDbState(next);
    try {
      localStorage.setItem(LOGIC_DB_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage error
    }
  };

  // Handle REAL Logic ERP Database Connect Form Submit (Never accepts fake username/password!)
  const handleConnectLogicDb = async (e: React.FormEvent) => {
    e.preventDefault();
    setDbFeedback(null);

    if (dbState.connectionMode === 'chrome-web') {
      if (!dbState.webPortalUrl.trim() || !dbState.webUserId.trim()) {
        setDbFeedback({
          ok: false,
          msg: 'Please enter your Logic ERP Chrome Portal URL and User ID.'
        });
        return;
      }
      if (!dbState.webPassword.trim()) {
        setDbFeedback({
          ok: false,
          msg: 'Please enter your Logic ERP Chrome / Web Password to verify.'
        });
        return;
      }

      setIsConnectingDb(true);
      setDbConnectStep(
        'Checking StockScan Chrome Extension Bridge in your browser...'
      );

      // 1. Check if Chrome Extension Bridge is actually installed in this browser
      const hasBridge =
        typeof document !== 'undefined' &&
        Boolean(document.documentElement.getAttribute('data-stockscan-bridge'));

      if (!hasBridge) {
        setIsConnectingDb(false);
        setDbConnectStep('');
        persistDbState({ ...dbState, connected: false, connectedAt: '' });
        setDbFeedback({
          ok: false,
          msg: '❌ Real Verification Failed: Aapke Chrome browser me abhi "StockScan Logic Chrome ERP Bridge" extension load nahi hai! Browser security (CORS) ke karan koi bhi website bina Chrome Extension Bridge ke dusri website (Logic ERP) ka User ID / Password verify nahi kar sakti. Pehle neeche diye button se Chrome Bridge (.zip) download karke chrome://extensions me Load Unpacked karein aur dusre tab me Logic ERP login rakhein.'
        });
        return;
      }

      // 2. Ask the installed Chrome Extension to verify that the Logic ERP tab is open and logged in
      setDbConnectStep(
        `Verifying open Logic ERP tab (${dbState.webPortalUrl}) via Chrome Extension...`
      );

      const verifyRes = await new Promise<{
        ok: boolean;
        message?: string;
        tabTitle?: string;
        scrapedRowsCount?: number;
      }>((resolve) => {
        const reqId = 'req_' + Date.now();
        const timer = setTimeout(() => {
          window.removeEventListener('message', onMsg);
          resolve({
            ok: false,
            message:
              'Chrome Extension Bridge v3 did not respond. Please re-download the latest Chrome ERP Bridge (.zip) below and click Reload in chrome://extensions.'
          });
        }, 2500);

        function onMsg(event: MessageEvent) {
          if (
            event.source === window &&
            event.data &&
            event.data.type === 'STOCKSCAN_DASHBOARD_VERIFY_RES' &&
            event.data.requestId === reqId
          ) {
            clearTimeout(timer);
            window.removeEventListener('message', onMsg);
            resolve(event.data.result || { ok: false, message: 'Verification failed.' });
          }
        }

        window.addEventListener('message', onMsg);
        window.postMessage(
          {
            type: 'STOCKSCAN_DASHBOARD_VERIFY_REQ',
            requestId: reqId,
            portalUrl: dbState.webPortalUrl,
            webUser: dbState.webUserId,
            storeName: dbState.storeName
          },
          '*'
        );
      });

      if (!verifyRes.ok) {
        setIsConnectingDb(false);
        setDbConnectStep('');
        persistDbState({ ...dbState, connected: false, connectedAt: '' });
        setDbFeedback({
          ok: false,
          msg:
            '❌ ' +
            (verifyRes.message ||
              'Could not verify active Logic ERP Chrome session.')
        });
        return;
      }

      await loadData(false);

      const nowStr = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      persistDbState({
        ...dbState,
        connected: true,
        connectedAt: nowStr
      });
      setIsConnectingDb(false);
      setDbConnectStep('');
      setDbFeedback({
        ok: true,
        msg: `✅ Real Logic ERP Chrome Tab Verified (${verifyRes.tabTitle || dbState.webPortalUrl})! Synced ${verifyRes.scrapedRowsCount || 0} live rows from Logic ERP.`
      });
      return;
    }

    // Desktop SQL Server mode: verify if real SQL data has been pushed from PC .bat connector
    if (!dbState.sqlServer.trim() || !dbState.sqlDatabase.trim() || !dbState.sqlUser.trim()) {
      setDbFeedback({
        ok: false,
        msg: 'Please enter SQL Server, Database Name, and SQL User ID.'
      });
      return;
    }

    if (!dbState.sqlPassword.trim()) {
      setDbFeedback({
        ok: false,
        msg: 'Please enter your Logic ERP Database Password.'
      });
      return;
    }

    setIsConnectingDb(true);
    setDbConnectStep(`Checking for live SQL data from ${dbState.sqlServer} (${dbState.sqlDatabase})...`);
    await loadData(false);
    setIsConnectingDb(false);
    setDbConnectStep('');

    if (!isRealLogicSyncedSource) {
      persistDbState({ ...dbState, connected: false, connectedAt: '' });
      handleDownloadConfiguredSqlBat();
      setDbFeedback({
        ok: false,
        msg: `⚠️ Waiting for PC SQL Connector: Website seedhe aapke local computer ke SQL Server (${dbState.sqlServer}) ko bina connector ke read nahi kar sakti (abhi jo stock dikh raha hai vo aapki uploaded Excel file "${effectiveSourceFileName || 'Excel'}" ka hai). Aapke SQL User '${dbState.sqlUser}' aur Password ke saath pre-configured ".bat" file abhi download ho gayi hai — use apne Logic ERP wale PC par run karein, tabhi real SQL stock yahan sync hoga.`
      });
      return;
    }

    const nowStr = new Date().toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

    persistDbState({
      ...dbState,
      connected: true,
      connectedAt: nowStr
    });
    setDbFeedback({
      ok: true,
      msg: `✅ Connected to real Logic ERP SQL Sync (${effectiveSourceFileName}) with ${logicErpOnlyArticles.length} Logic ERP articles.`
    });
  };

  const handleDisconnectLogicDb = () => {
    const next: LogicDbConnectionState = {
      ...dbState,
      connected: false,
      connectedAt: ''
    };
    persistDbState(next);
    setDbFeedback({
      ok: false,
      msg: 'Disconnected from Logic ERP session.'
    });
  };

  const handleDownloadConfiguredSqlBat = () => {
    downloadLogicErpAutoSyncBat({
      sqlServer: dbState.sqlServer,
      sqlDatabase: dbState.sqlDatabase,
      sqlAuthMode: 'sql',
      sqlUser: dbState.sqlUser,
      sqlPassword: dbState.sqlPassword,
      syncIntervalSec: 10
    });
  };

  const handleDownloadConfiguredChromeBridge = () => {
    downloadChromeExtensionZip({
      portalUrl: dbState.webPortalUrl,
      webUser: dbState.webUserId,
      storeName: dbState.storeName
    });
  };

  const handleQuickMinus = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const query = quickBarcode.trim();
    if (!query) return;

    setQuickLoading(true);
    setQuickFeedback(null);

    try {
      const stock = await fetchSharedStockJson();
      if (!stock || !Array.isArray(stock.articles) || stock.articles.length === 0) {
        setQuickFeedback({ ok: false, msg: 'No stock data found in database.' });
        setQuickLoading(false);
        return;
      }

      const qUpper = query.toUpperCase();
      const qNorm = query.replace(/^0+/, '');
      let foundArticle = null;
      let foundSize = null;

      for (const art of stock.articles) {
        if (!Array.isArray(art.sizes)) continue;
        const artCode = String(art.articleCode || art.name || '').trim().toUpperCase();
        const artBarcode = String(art.articleBarcode || (art as any).barcode || '').trim();
        const artNorm = artBarcode.replace(/^0+/, '');

        for (const sz of art.sizes) {
          const szBarcode = String(sz.barcode || '').trim();
          const szNorm = szBarcode.replace(/^0+/, '');
          if ((szBarcode && szBarcode === query) || (qNorm.length >= 5 && szNorm === qNorm)) {
            foundArticle = art;
            foundSize = sz;
            break;
          }
        }
        if (foundArticle) break;

        if (artBarcode === query || (qNorm.length >= 5 && artNorm === qNorm)) {
          foundArticle = art;
          foundSize = art.sizes.find((s) => (Number(s.quantity) || 0) > 0) || art.sizes[0];
          break;
        }

        if (artCode === qUpper || (qUpper.length >= 3 && artCode.includes(qUpper))) {
          foundArticle = art;
          foundSize = art.sizes.find((s) => (Number(s.quantity) || 0) > 0) || art.sizes[0];
          break;
        }
      }

      if (!foundArticle || !foundSize) {
        setQuickFeedback({ ok: false, msg: `Shoe not found for: ${query}` });
        setQuickLoading(false);
        return;
      }

      const oldQty = Number(foundSize.quantity) || 0;
      const minusCount = Math.max(1, quickQty);
      const newQty = Math.max(0, oldQty - minusCount);
      foundSize.quantity = newQty;

      stock.version = Date.now();
      await pushSharedStockJson(stock);

      const nowMs = Date.now();
      const nowStr = new Date().toLocaleString('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });

      await recordDeductionsToAnalytics([
        {
          id: `deduct-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
          articleCode: foundArticle.articleCode || foundArticle.name,
          itemName: foundArticle.name || foundArticle.articleCode,
          size: foundSize.size,
          barcode: foundSize.barcode || foundArticle.articleBarcode || query,
          qtyDeducted: minusCount,
          remainingQty: newQty,
          source: 'Dashboard Minus',
          timestamp: nowStr,
          timestampMs: nowMs
        }
      ]);

      setQuickBarcode('');
      setQuickFeedback({
        ok: true,
        msg: `Deducted -${minusCount} Piece(s): ${foundArticle.name || foundArticle.articleCode} (${foundSize.size}) -> ${newQty} Left in Stock`
      });
      await loadData(false);
    } catch (err) {
      setQuickFeedback({ ok: false, msg: 'Error deducting shoe: ' + String(err) });
    } finally {
      setQuickLoading(false);
    }
  };

  // Direct +1 / -1 Stock adjustment from Live Stock Table
  const handleDirectSizeQtyChange = async (
    articleCode: string,
    sizeLabel: string,
    delta: number
  ) => {
    const key = `${articleCode}__${sizeLabel}`;
    setAdjustingKey(key);
    try {
      const stock = await fetchSharedStockJson();
      if (!stock || !Array.isArray(stock.articles)) return;

      const art = stock.articles.find(
        (a) => (a.articleCode || a.name) === articleCode
      );
      if (!art || !Array.isArray(art.sizes)) return;

      const sz = art.sizes.find((s) => s.size === sizeLabel);
      if (!sz) return;

      const oldQty = Number(sz.quantity) || 0;
      const newQty = Math.max(0, oldQty + delta);
      sz.quantity = newQty;
      stock.version = Date.now();

      await pushSharedStockJson(stock);

      if (delta < 0) {
        const nowMs = Date.now();
        const nowStr = new Date().toLocaleString('en-IN', {
          day: '2-digit',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
          hour12: true
        });
        await recordDeductionsToAnalytics([
          {
            id: `deduct-${nowMs}-${Math.random().toString(36).slice(2, 6)}`,
            articleCode: art.articleCode || art.name,
            itemName: art.name || art.articleCode,
            size: sz.size,
            barcode: sz.barcode || art.articleBarcode || '',
            qtyDeducted: Math.abs(delta),
            remainingQty: newQty,
            source: 'Stock Table Minus',
            timestamp: nowStr,
            timestampMs: nowMs
          }
        ]);
      }

      await loadData(false);
    } finally {
      setAdjustingKey(null);
    }
  };

  const handleClearLogs = async () => {
    setIsRefreshing(true);
    const cleared = await resetAnalyticsData();
    setAnalytics(cleared);
    setConfirmClear(false);
    setIsRefreshing(false);
  };

  const goBackToScanner = () => {
    const basePath = window.location.pathname.includes('/stockscan-pro')
      ? '/stockscan-pro/'
      : '/';
    window.history.pushState({}, '', basePath);
    window.location.hash = '';
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  // ============================================================================
  // COMPUTED ANALYTICS & GRAPH DATA
  // ============================================================================
  const soldDeductions = useMemo(
    () => analytics.soldDeductions || [],
    [analytics.soldDeductions]
  );

  const totalSoldPieces = useMemo(
    () => soldDeductions.reduce((sum, d) => sum + (d.qtyDeducted || 1), 0),
    [soldDeductions]
  );

  const computedTotalArticles = activeArticles.length || totalArticlesInSheet;
  const computedTotalPieces = useMemo(() => {
    if (activeArticles.length > 0) {
      return activeArticles.reduce(
        (sum, art) =>
          sum +
          (art.sizes || []).reduce((sSum, sz) => sSum + Math.max(0, Number(sz.quantity) || 0), 0),
        0
      );
    }
    return totalPiecesInSheet;
  }, [activeArticles, totalPiecesInSheet]);

  // Graph 1: Size-Wise Stock Availability (Top 8 Sizes by Pair Count)
  const sizeDistributionData = useMemo(() => {
    const map = new Map<string, number>();
    for (const art of activeArticles) {
      for (const sz of art.sizes || []) {
        const label = String(sz.size || 'STD').trim();
        const qty = Math.max(0, Number(sz.quantity) || 0);
        map.set(label, (map.get(label) || 0) + qty);
      }
    }
    const entries = Array.from(map.entries())
      .map(([size, count]) => ({ size, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    const maxCount = Math.max(1, ...entries.map((e) => e.count));
    return entries.map((e) => ({
      ...e,
      pct: Math.round((e.count / maxCount) * 100)
    }));
  }, [activeArticles]);

  // Graph 2: Stock Health Breakdown (Healthy 3+, Low 1-2, Out of Stock 0)
  const stockHealthStats = useMemo(() => {
    let healthy = 0;
    let low = 0;
    let out = 0;

    for (const art of activeArticles) {
      const total = (art.sizes || []).reduce(
        (sum, sz) => sum + Math.max(0, Number(sz.quantity) || 0),
        0
      );
      if (total >= 3) healthy++;
      else if (total >= 1) low++;
      else out++;
    }

    const totalArts = Math.max(1, healthy + low + out);
    return {
      healthy,
      low,
      out,
      healthyPct: Math.round((healthy / totalArts) * 100),
      lowPct: Math.round((low / totalArts) * 100),
      outPct: Math.round((out / totalArts) * 100)
    };
  }, [activeArticles]);

  // Graph 3: Top Deducted / Sold Articles Bar Data
  const topSoldArticlesGraph = useMemo(() => {
    const map = new Map<string, { code: string; sold: number; remaining: number }>();
    for (const d of soldDeductions) {
      const code = d.articleCode || d.itemName || 'Article';
      const prev = map.get(code);
      if (prev) {
        prev.sold += d.qtyDeducted || 1;
      } else {
        map.set(code, {
          code,
          sold: d.qtyDeducted || 1,
          remaining: d.remainingQty
        });
      }
    }
    const list = Array.from(map.values())
      .sort((a, b) => b.sold - a.sold)
      .slice(0, 6);
    const maxSold = Math.max(1, ...list.map((i) => i.sold));
    return list.map((item) => ({
      ...item,
      pct: Math.round((item.sold / maxSold) * 100)
    }));
  }, [soldDeductions]);

  // Filtered Articles for User Live Stock Explorer
  const filteredStockArticles = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    return activeArticles
      .filter((art) => {
        const total = (art.sizes || []).reduce(
          (sum, sz) => sum + Math.max(0, Number(sz.quantity) || 0),
          0
        );
        if (stockFilter === 'in-stock' && total <= 0) return false;
        if (stockFilter === 'low' && (total < 1 || total > 2)) return false;
        if (stockFilter === 'out' && total !== 0) return false;

        if (!q) return true;
        const codeMatch = (art.articleCode || '').toLowerCase().includes(q);
        const nameMatch = (art.name || '').toLowerCase().includes(q);
        const barcodeMatch =
          (art.articleBarcode || '').toLowerCase().includes(q) ||
          (art.sizes || []).some(
            (s) =>
              (s.barcode || '').toLowerCase().includes(q) ||
              (s.size || '').toLowerCase().includes(q)
          );
        return codeMatch || nameMatch || barcodeMatch;
      })
      .slice(0, 80);
  }, [activeArticles, stockSearch, stockFilter]);

  const menuItems: { id: DashboardMenuTab; label: string; icon: React.ReactNode; count?: number }[] = [
    {
      id: 'overview',
      label: 'Overview & Graphs',
      icon: <BarChart3 className="w-4 h-4" />
    },
    {
      id: 'logic-db',
      label: 'Logic Database Connect',
      icon: <Database className="w-4 h-4" />
    },
    {
      id: 'stock-data',
      label: 'Live Stock Data',
      icon: <Layers className="w-4 h-4" />,
      count: computedTotalArticles
    },
    {
      id: 'sold-history',
      label: 'Sold / Minus Pieces',
      icon: <PackageCheck className="w-4 h-4" />,
      count: totalSoldPieces
    },
    {
      id: 'extension',
      label: 'Chrome Extension',
      icon: <Puzzle className="w-4 h-4" />
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      {/* Top Bar Contract: 3 zones (Brand / Nav Context / Primary Action) */}
      <header className="sticky top-0 z-30 bg-slate-900 text-white border-b border-slate-800 px-4 sm:px-6 py-3">
        <div className="max-w-[1440px] mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={goBackToScanner}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors shrink-0"
              title="Back to Scanner"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <span className="text-base font-bold tracking-tight text-white whitespace-nowrap shrink-0">
              Elooks StockScan ERP Console
            </span>
          </div>

          <div className="hidden md:flex items-center gap-6 text-xs text-slate-300">
            <span>
              Database:{' '}
              <strong className="font-mono text-white">
                {dbState.connected
                  ? dbState.connectionMode === 'chrome-web'
                    ? `Chrome ERP (${dbState.webUserId})`
                    : `${dbState.sqlDatabase} (${dbState.sqlUser})`
                  : sheetFileName || 'Cloud Stock JSON'}
              </strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Articles: <strong className="font-mono tabular-nums text-white">{computedTotalArticles}</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Total Stock: <strong className="font-mono tabular-nums text-white">{computedTotalPieces} Pairs</strong>
            </span>
            <span aria-hidden="true">·</span>
            <span>
              Minus Pieces: <strong className="font-mono tabular-nums text-emerald-400">{totalSoldPieces} Sold</strong>
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => loadData(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg border border-slate-700 transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>Sync Data</span>
            </button>

            {!confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-red-950 text-slate-300 hover:text-red-300 rounded-lg border border-slate-700 transition-colors whitespace-nowrap shrink-0"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset Sold</span>
              </button>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={handleClearLogs}
                  className="px-2.5 py-1.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded-lg whitespace-nowrap shrink-0"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1.5 text-xs text-slate-300 hover:text-white whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Workspace Container: Left Sidebar Menu + Main Content */}
      <div className="max-w-[1440px] w-full mx-auto flex-1 flex flex-col lg:flex-row">
        {/* Left Sidebar Navigation (Desktop) & Horizontal Scroll Menu (Mobile) */}
        <aside className="w-full lg:w-64 shrink-0 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 p-3 lg:p-4">
          <div className="text-[11px] font-semibold text-slate-400 px-3 mb-2 hidden lg:block">
            Dashboard Navigation
          </div>
          <nav className="flex lg:flex-col gap-1 overflow-x-auto pb-1 lg:pb-0">
            {menuItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id)}
                  className={`flex items-center justify-between gap-2.5 px-3 py-2.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    {item.icon}
                    <span>{item.label}</span>
                  </span>
                  {item.count !== undefined && (
                    <span
                      className={`font-mono text-[11px] tabular-nums ${
                        isActive ? 'text-slate-300' : 'text-slate-400'
                      }`}
                    >
                      {item.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Connected User Status Box in Sidebar */}
          <div className="hidden lg:block mt-6 pt-5 border-t border-slate-200">
            <div className="text-xs font-semibold text-slate-900 mb-1">
              Logic ERP Connection
            </div>
            {dbState.connected ? (
              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-xs space-y-1.5">
                <div className="font-bold text-emerald-900 flex items-center justify-between">
                  <span>
                    {dbState.connectionMode === 'chrome-web' ? 'Chrome ERP' : 'SQL Connected'}
                  </span>
                  <span className="font-mono text-[11px] text-emerald-700">
                    {dbState.connectionMode === 'chrome-web'
                      ? dbState.webUserId
                      : dbState.sqlUser}
                  </span>
                </div>
                <div className="text-[11px] text-emerald-800 font-mono truncate">
                  {dbState.connectionMode === 'chrome-web'
                    ? dbState.webPortalUrl
                    : dbState.sqlServer}
                </div>
                <div className="text-[11px] text-emerald-700">
                  Store: <strong className="font-mono">{dbState.storeName}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('stock-data')}
                  className="w-full mt-1 py-1.5 px-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-semibold rounded-md text-[11px] transition-colors"
                >
                  View User Stock ({computedTotalArticles})
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs space-y-2">
                <div className="text-slate-600 text-[11px] leading-relaxed">
                  Connect your Logic ERP Chrome / Web Dashboard or Desktop SQL Database with password.
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('logic-db')}
                  className="w-full py-1.5 px-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-md text-[11px] transition-colors"
                >
                  Connect Logic ERP
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* Main Content Viewport */}
        <main className="flex-1 p-4 sm:p-6 space-y-6 min-w-0">
          {/* ================================================================
              TAB 1: OVERVIEW & GRAPHS
          ================================================================ */}
          {activeTab === 'overview' && (
            <>
              {/* Logic Database Quick Status Banner */}
              <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      dbState.connected
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-blue-50 text-blue-600'
                    }`}
                  >
                    <Database className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900">
                      {dbState.connected
                        ? dbState.connectionMode === 'chrome-web'
                          ? `Logic ERP Chrome Connected: ${dbState.storeName} (User: ${dbState.webUserId})`
                          : `Logic ERP SQL Connected: ${dbState.storeName} (${dbState.sqlUser}@${dbState.sqlDatabase})`
                        : 'Connect Your Logic ERP (Chrome Web Dashboard or SQL Database)'}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {dbState.connected
                        ? dbState.connectionMode === 'chrome-web'
                          ? `Chrome Portal: ${dbState.webPortalUrl} · Connected at ${dbState.connectedAt} · Showing ${computedTotalArticles} Articles (${computedTotalPieces} Pairs)`
                          : `Server: ${dbState.sqlServer} · Connected at ${dbState.connectedAt} · Showing ${computedTotalArticles} Articles (${computedTotalPieces} Pairs)`
                        : 'Enter your Logic ERP Chrome / Web Password or SQL Password to connect your user account and view live stock'}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {dbState.connected ? (
                    <>
                      <button
                        type="button"
                        onClick={() => setActiveTab('stock-data')}
                        className="px-3.5 py-2 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors whitespace-nowrap"
                      >
                        View Connected Stock
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveTab('logic-db')}
                        className="px-3 py-2 text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors whitespace-nowrap"
                      >
                        Connection Settings
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setActiveTab('logic-db')}
                      className="px-4 py-2 text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors whitespace-nowrap"
                    >
                      Connect Logic Chrome / SQL DB
                    </button>
                  )}
                </div>
              </div>

              {/* 4 Executive KPI Cards */}
              <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between text-slate-500 mb-1.5">
                    <span className="text-xs font-medium">Total Stock In Database</span>
                    <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                    {computedTotalPieces}{' '}
                    <span className="text-xs font-normal text-slate-500">Pairs</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {computedTotalArticles} unique articles loaded
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between text-slate-500 mb-1.5">
                    <span className="text-xs font-medium">Shoes Sold / Minus Ho Gaye</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="text-2xl font-bold text-emerald-600 font-mono tabular-nums">
                    {totalSoldPieces}{' '}
                    <span className="text-xs font-normal text-emerald-700">Pieces Minus</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1">
                    Deducted from live stock
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between text-slate-500 mb-1.5">
                    <span className="text-xs font-medium">In-Stock Articles</span>
                    <Layers className="w-4 h-4 text-slate-700" />
                  </div>
                  <div className="text-2xl font-bold text-slate-900 font-mono tabular-nums">
                    {stockHealthStats.healthy + stockHealthStats.low}{' '}
                    <span className="text-xs font-normal text-slate-500">Active</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {stockHealthStats.low} low stock (1-2 pairs left)
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-xl p-4">
                  <div className="flex items-center justify-between text-slate-500 mb-1.5">
                    <span className="text-xs font-medium">Out Of Stock Articles</span>
                    <Server className="w-4 h-4 text-red-600" />
                  </div>
                  <div className="text-2xl font-bold text-red-600 font-mono tabular-nums">
                    {stockHealthStats.out}{' '}
                    <span className="text-xs font-normal text-slate-500">0 Left</span>
                  </div>
                  <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                    {stockHealthStats.outPct}% of catalog depleted
                  </div>
                </div>
              </section>

              {/* INTERACTIVE GRAPHS ROW */}
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Graph 1: Size-Wise Stock Bar Graph (7 cols) */}
                <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-4">
                      <div>
                        <h2 className="text-sm font-bold text-slate-900">
                          Size-Wise Stock Distribution Graph
                        </h2>
                        <p className="text-xs text-slate-500">
                          Available pairs across top footwear sizes in your database
                        </p>
                      </div>
                      <span className="text-xs font-mono tabular-nums text-slate-600">
                        Total {computedTotalPieces} Pairs
                      </span>
                    </div>

                    {sizeDistributionData.length === 0 ? (
                      <div className="h-52 flex items-center justify-center text-xs text-slate-400">
                        No size distribution data available yet.
                      </div>
                    ) : (
                      <div className="pt-2 pb-1">
                        {/* Vertical SVG Bar Graph */}
                        <div className="h-52 flex items-end gap-3 sm:gap-4 pt-6 px-2 border-b border-slate-200">
                          {sizeDistributionData.map((item) => (
                            <div
                              key={item.size}
                              className="flex-1 flex flex-col items-center justify-end h-full group"
                            >
                              <span className="text-[11px] font-mono tabular-nums font-bold text-slate-700 mb-1.5">
                                {item.count}
                              </span>
                              <div className="w-full max-w-[42px] bg-slate-100 rounded-t-md h-36 flex items-end overflow-hidden">
                                <div
                                  style={{ height: `${Math.max(8, item.pct)}%` }}
                                  className="w-full bg-blue-600 group-hover:bg-blue-700 rounded-t-md transition-opacity"
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-3 sm:gap-4 pt-2 px-2">
                          {sizeDistributionData.map((item) => (
                            <div
                              key={item.size}
                              className="flex-1 text-center font-mono text-[11px] font-semibold text-slate-600 truncate"
                              title={`Size ${item.size}: ${item.count} pairs`}
                            >
                              {item.size}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Graph 2: Stock Health & Top Minus Articles Graph (5 cols) */}
                <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-5 flex flex-col justify-between space-y-5">
                  <div>
                    <h2 className="text-sm font-bold text-slate-900">
                      Stock Health &amp; Deducted Pieces Graph
                    </h2>
                    <p className="text-xs text-slate-500 mb-4">
                      Live inventory availability ratio &amp; top minus shoes
                    </p>

                    {/* Segmented Stock Health Bar */}
                    <div className="space-y-2.5">
                      <div className="h-3.5 w-full rounded-lg bg-slate-100 overflow-hidden flex">
                        <div
                          style={{ width: `${stockHealthStats.healthyPct}%` }}
                          className="bg-emerald-600 h-full"
                          title={`Healthy Stock: ${stockHealthStats.healthy} articles`}
                        />
                        <div
                          style={{ width: `${stockHealthStats.lowPct}%` }}
                          className="bg-amber-500 h-full"
                          title={`Low Stock: ${stockHealthStats.low} articles`}
                        />
                        <div
                          style={{ width: `${stockHealthStats.outPct}%` }}
                          className="bg-red-500 h-full"
                          title={`Out of Stock: ${stockHealthStats.out} articles`}
                        />
                      </div>

                      <div className="grid grid-cols-3 gap-2 text-xs pt-1">
                        <div>
                          <div className="text-slate-500 text-[11px]">Healthy (3+ Pcs)</div>
                          <div className="font-mono font-bold text-emerald-700 tabular-nums">
                            {stockHealthStats.healthy} ({stockHealthStats.healthyPct}%)
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 text-[11px]">Low (1-2 Pcs)</div>
                          <div className="font-mono font-bold text-amber-700 tabular-nums">
                            {stockHealthStats.low} ({stockHealthStats.lowPct}%)
                          </div>
                        </div>
                        <div>
                          <div className="text-slate-500 text-[11px]">Out (0 Left)</div>
                          <div className="font-mono font-bold text-red-600 tabular-nums">
                            {stockHealthStats.out} ({stockHealthStats.outPct}%)
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Top Sold / Minus Articles Horizontal Bar Chart */}
                  <div className="pt-4 border-t border-slate-100">
                    <div className="text-xs font-bold text-slate-800 mb-2.5">
                      Top Sold / Minus Articles
                    </div>
                    {topSoldArticlesGraph.length === 0 ? (
                      <div className="text-xs text-slate-400 py-4">
                        No articles deducted yet.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {topSoldArticlesGraph.map((item) => (
                          <div key={item.code} className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-mono font-semibold text-slate-800 truncate">
                                {item.code}
                              </span>
                              <span className="font-mono tabular-nums text-slate-600">
                                -{item.sold} Piece{item.sold > 1 ? 's' : ''} · {item.remaining} Left
                              </span>
                            </div>
                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                style={{ width: `${Math.max(12, item.pct)}%` }}
                                className="h-full bg-emerald-600 rounded-full"
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/* LIVE SOLD SHOES TABLE ON OVERVIEW */}
              <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <h2 className="text-sm font-bold">
                      Live Shoes Sold (Kitne Pieces Minus Huye &amp; Kitne Bache)
                    </h2>
                  </div>
                  <span className="text-xs text-emerald-300 font-mono font-bold tabular-nums">
                    Total {totalSoldPieces} Pieces Minus
                  </span>
                </div>

                {/* Quick Barcode Minus Bar */}
                <div className="p-3.5 bg-slate-50 border-b border-slate-200">
                  <form onSubmit={handleQuickMinus} className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[220px]">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        type="text"
                        value={quickBarcode}
                        onChange={(e) => setQuickBarcode(e.target.value)}
                        placeholder="Scan or enter Barcode / Article Code (e.g. 8909102136872 or RSO3501B)..."
                        className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <label className="text-xs font-semibold text-slate-600">Pieces:</label>
                      <input
                        type="number"
                        min="1"
                        max="50"
                        value={quickQty}
                        onChange={(e) =>
                          setQuickQty(Math.max(1, parseInt(e.target.value, 10) || 1))
                        }
                        className="w-16 py-2 px-2 text-xs font-mono text-center bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                      />
                      <button
                        type="submit"
                        disabled={quickLoading || !quickBarcode.trim()}
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-lg transition-colors whitespace-nowrap"
                      >
                        <MinusCircle className="w-3.5 h-3.5" />
                        <span>{quickLoading ? 'Deducting...' : 'Minus Piece Now'}</span>
                      </button>
                    </div>
                  </form>

                  {quickFeedback && (
                    <div
                      className={`mt-2.5 p-2.5 rounded-lg text-xs font-semibold flex items-center justify-between ${
                        quickFeedback.ok
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}
                    >
                      <span>{quickFeedback.msg}</span>
                      <button
                        type="button"
                        onClick={() => setQuickFeedback(null)}
                        className="text-slate-500 hover:text-slate-800 ml-2"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>

                {soldDeductions.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    No pieces have been deducted yet. When a bill is saved or printed in Logic ERP, deducted pieces and remaining stock appear here live.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    <div className="px-5 py-2.5 bg-slate-50 grid grid-cols-12 text-[11px] font-semibold text-slate-500">
                      <span className="col-span-5">SHOES / ARTICLE NAME</span>
                      <span className="col-span-2 text-center">SIZE</span>
                      <span className="col-span-2 text-center">MINUS PIECES</span>
                      <span className="col-span-3 text-right">REMAINING IN STOCK</span>
                    </div>

                    {soldDeductions.slice(0, 15).map((entry) => (
                      <div
                        key={entry.id}
                        className="px-5 py-3 grid grid-cols-12 items-center gap-2 hover:bg-slate-50"
                      >
                        <div className="col-span-5 min-w-0">
                          <div className="text-xs font-bold text-slate-900 font-mono truncate">
                            {entry.articleCode}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">
                            Barcode: {entry.barcode}
                          </div>
                        </div>

                        <div className="col-span-2 text-center font-mono text-xs font-bold text-slate-800 tabular-nums">
                          {entry.size}
                        </div>

                        <div className="col-span-2 text-center font-mono text-xs font-bold text-red-600 tabular-nums">
                          -{entry.qtyDeducted} Piece{entry.qtyDeducted > 1 ? 's' : ''}
                        </div>

                        <div className="col-span-3 text-right">
                          <div className="font-mono text-xs font-bold tabular-nums">
                            {entry.remainingQty <= 0 ? (
                              <span className="text-red-600">0 Left (Out of Stock)</span>
                            ) : (
                              <span className="text-emerald-700">
                                {entry.remainingQty} Left in Stock
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                            {entry.timestamp}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {/* ================================================================
              TAB 2: LOGIC ERP DATABASE CONNECT (CHROME WEB ERP + DESKTOP SQL)
          ================================================================ */}
          {activeTab === 'logic-db' && (
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <Database className="w-5 h-5 text-emerald-400" />
                    <div>
                      <h2 className="text-sm font-bold">
                        Logic ERP Connection Console (Chrome Web Dashboard &amp; SQL Database)
                      </h2>
                      <p className="text-[11px] text-slate-400">
                        Connect your Logic ERP Chrome / Web Dashboard version or Desktop SQL Server with user password
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono text-emerald-300">
                    {dbState.connected
                      ? dbState.connectionMode === 'chrome-web'
                        ? `Connected (Chrome ERP): ${dbState.webUserId}`
                        : `Connected (SQL): ${dbState.sqlUser}@${dbState.sqlDatabase}`
                      : 'Not Connected'}
                  </span>
                </div>

                {/* Mode Switcher: Logic ERP Chrome / Web Dashboard vs Desktop SQL Server */}
                <div className="px-5 pt-4 pb-2 border-b border-slate-200 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-slate-700">
                    Select Your Logic ERP Version:
                  </div>
                  <div className="inline-flex p-1 bg-slate-200/80 rounded-lg gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setDbFeedback(null);
                        persistDbState({ ...dbState, connectionMode: 'chrome-web' });
                      }}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
                        dbState.connectionMode === 'chrome-web'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Logic ERP Chrome / Web Dashboard Version
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDbFeedback(null);
                        persistDbState({ ...dbState, connectionMode: 'desktop-sql' });
                      }}
                      className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors ${
                        dbState.connectionMode === 'desktop-sql'
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Desktop MS SQL Server Version
                    </button>
                  </div>
                </div>

                <div className="p-5 grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Left: Connection Credentials Form (7 cols) */}
                  <form
                    onSubmit={handleConnectLogicDb}
                    className="lg:col-span-7 space-y-4"
                  >
                    {dbState.connectionMode === 'chrome-web' ? (
                      <>
                        <div className="p-3 rounded-lg bg-blue-50/70 border border-blue-200 text-xs text-slate-700 leading-relaxed">
                          <strong className="text-slate-900">Logic ERP Chrome / Web Dashboard Mode:</strong> Apna Logic ERP Web Portal URL, User ID aur Password daal kar connect karein. Isse aapka user account connect ho jayega aur Chrome se Live Stock Table + Bill Save/Print Minus seedhe sync honge.
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Store / Branch Name
                            </label>
                            <input
                              type="text"
                              value={dbState.storeName}
                              onChange={(e) =>
                                persistDbState({ ...dbState, storeName: e.target.value })
                              }
                              placeholder="e.g. Elooks Main Store"
                              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Logic ERP Chrome / Web Portal URL
                            </label>
                            <input
                              type="text"
                              value={dbState.webPortalUrl}
                              onChange={(e) =>
                                persistDbState({ ...dbState, webPortalUrl: e.target.value })
                              }
                              placeholder="e.g. https://erp.logicerp.com"
                              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Logic Chrome User ID / Username
                            </label>
                            <input
                              type="text"
                              value={dbState.webUserId}
                              onChange={(e) =>
                                persistDbState({ ...dbState, webUserId: e.target.value })
                              }
                              placeholder="e.g. admin or store_user"
                              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Logic Chrome Password
                            </label>
                            <div className="relative">
                              <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={dbState.webPassword}
                                onChange={(e) =>
                                  persistDbState({ ...dbState, webPassword: e.target.value })
                                }
                                placeholder="Enter Logic Chrome Password"
                                className="w-full pl-8 pr-8 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((p) => !p)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                                title={showPassword ? 'Hide Password' : 'Show Password'}
                              >
                                {showPassword ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="p-3 rounded-lg bg-slate-100 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                          <strong className="text-slate-900">Desktop MS SQL Server Mode:</strong> Agar aapke PC me Logic ERP ka local SQL Server (`SQLEXPRESS`) chalta hai, to SQL User aur Password daal kar connect karein.
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Store / Branch Name
                            </label>
                            <input
                              type="text"
                              value={dbState.storeName}
                              onChange={(e) =>
                                persistDbState({ ...dbState, storeName: e.target.value })
                              }
                              placeholder="e.g. Elooks Main Store"
                              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              SQL Server Host / Instance
                            </label>
                            <input
                              type="text"
                              value={dbState.sqlServer}
                              onChange={(e) =>
                                persistDbState({ ...dbState, sqlServer: e.target.value })
                              }
                              placeholder="e.g. localhost\SQLEXPRESS or 192.168.1.10"
                              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Logic Database Name
                            </label>
                            <input
                              type="text"
                              value={dbState.sqlDatabase}
                              onChange={(e) =>
                                persistDbState({ ...dbState, sqlDatabase: e.target.value })
                              }
                              placeholder="e.g. LOGICDATA"
                              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              SQL User ID
                            </label>
                            <input
                              type="text"
                              value={dbState.sqlUser}
                              onChange={(e) =>
                                persistDbState({ ...dbState, sqlUser: e.target.value })
                              }
                              placeholder="e.g. sa"
                              className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1">
                              Logic Database Password
                            </label>
                            <div className="relative">
                              <KeyRound className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={dbState.sqlPassword}
                                onChange={(e) =>
                                  persistDbState({ ...dbState, sqlPassword: e.target.value })
                                }
                                placeholder="Enter SQL Password"
                                className="w-full pl-8 pr-8 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((p) => !p)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                                title={showPassword ? 'Hide Password' : 'Show Password'}
                              >
                                {showPassword ? (
                                  <EyeOff className="w-3.5 h-3.5" />
                                ) : (
                                  <Eye className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          </div>
                        </div>
                      </>
                    )}

                    {isConnectingDb && (
                      <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-800 font-mono flex items-center gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                        <span>{dbConnectStep}</span>
                      </div>
                    )}

                    {dbFeedback && (
                      <div
                        className={`p-3 rounded-lg text-xs font-semibold ${
                          dbFeedback.ok
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {dbFeedback.msg}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <button
                        type="submit"
                        disabled={isConnectingDb}
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors cursor-pointer"
                      >
                        <Database className="w-4 h-4" />
                        <span>
                          {dbState.connected
                            ? dbState.connectionMode === 'chrome-web'
                              ? 'Re-Verify & Sync Logic Chrome Tab'
                              : 'Re-Verify SQL Sync'
                            : dbState.connectionMode === 'chrome-web'
                              ? 'Verify & Connect Logic Chrome ERP'
                              : 'Verify & Connect Logic SQL Database'}
                        </span>
                      </button>

                      {dbState.connectionMode === 'chrome-web' ? (
                        <button
                          type="button"
                          onClick={handleDownloadConfiguredChromeBridge}
                          className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors cursor-pointer"
                        >
                          <Download className="w-4 h-4" />
                          <span>Step 1: Download Chrome ERP Bridge (.zip)</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleDownloadConfiguredSqlBat}
                          className="inline-flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold bg-slate-900 hover:bg-slate-800 text-white rounded-lg transition-colors cursor-pointer"
                        >
                          <Download className="w-4 h-4" />
                          <span>Step 1: Download Windows SQL Auto-Sync (.bat)</span>
                        </button>
                      )}

                      {dbState.connected && (
                        <button
                          type="button"
                          onClick={handleDisconnectLogicDb}
                          className="inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold bg-slate-100 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-lg transition-colors"
                        >
                          <Unplug className="w-3.5 h-3.5" />
                          <span>Disconnect</span>
                        </button>
                      )}
                    </div>
                  </form>

                  {/* Right: Connected User Profile & Database Telemetry (5 cols) */}
                  <div className="lg:col-span-5 bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col justify-between space-y-4">
                    <div>
                      <div className="text-xs font-bold text-slate-800 mb-3">
                        Real Logic ERP Verification Summary
                      </div>

                      <div className="space-y-2.5 text-xs">
                        <div className="flex items-center justify-between py-1.5 border-b border-slate-200/80">
                          <span className="text-slate-500">Connection Status</span>
                          <span
                            className={`font-bold ${
                              dbState.connected ? 'text-emerald-700' : 'text-amber-600'
                            }`}
                          >
                            {dbState.connected
                              ? dbState.connectionMode === 'chrome-web'
                                ? 'Verified (Live Chrome Tab)'
                                : 'Verified (SQL Sync Active)'
                              : 'Not Connected (Unverified)'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between py-1.5 border-b border-slate-200/80">
                          <span className="text-slate-500">Verified User</span>
                          <span className="font-mono font-bold text-slate-900">
                            {dbState.connected
                              ? dbState.connectionMode === 'chrome-web'
                                ? `${dbState.webUserId} (${dbState.storeName})`
                                : `${dbState.sqlUser} (${dbState.storeName})`
                              : '—'}
                          </span>
                        </div>

                        <div className="flex items-center justify-between py-1.5 border-b border-slate-200/80">
                          <span className="text-slate-500">
                            {dbState.connectionMode === 'chrome-web'
                              ? 'Chrome Portal URL'
                              : 'SQL Server / DB'}
                          </span>
                          <span className="font-mono text-slate-800 truncate max-w-[200px]">
                            {dbState.connectionMode === 'chrome-web'
                              ? dbState.webPortalUrl
                              : `${dbState.sqlServer} / ${dbState.sqlDatabase}`}
                          </span>
                        </div>

                        <div className="flex items-center justify-between py-1.5 border-b border-slate-200/80">
                          <span className="text-slate-500">Logic ERP Synced Stock</span>
                          <span className="font-mono font-bold text-blue-700 tabular-nums">
                            {logicErpOnlyArticles.length} Articles ({logicErpOnlyPieces} Pairs)
                          </span>
                        </div>

                        <div className="flex items-center justify-between py-1.5">
                          <span className="text-slate-500">Excel Uploaded Stock</span>
                          <span className="font-mono text-slate-600 tabular-nums">
                            {!isRealLogicSyncedSource
                              ? `${computedTotalArticles} Articles (${effectiveSourceFileName || 'Excel Sheet'})`
                              : 'Replaced by Logic ERP Sync'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-[11px] text-slate-500 leading-relaxed">
                      <strong>Note (Zero Fake Login):</strong> Yeh form kisi bhi random username/password par connect nahi hoga aur na hi Excel sheet ko Logic ERP data batayega. Real connection ke liye Step 1 se Chrome ERP Bridge (.zip) ko <code className="font-mono">chrome://extensions</code> me load karein aur dusre tab me Logic ERP login rakhein.
                    </div>
                  </div>
                </div>
              </div>

              {/* Connected User's REAL Logic ERP Stock Data Preview (Strictly excludes Excel uploads) */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold">
                      Logic ERP Synced Stock Data Only (Excludes Uploaded Excel Sheet)
                    </h3>
                    <p className="text-[11px] text-slate-400">
                      Yahan sirf wahi data dikhega jo Logic ERP Chrome (&quot;Sync Stock Table&quot;) ya SQL Connector se sync hua hai
                    </p>
                  </div>
                  <span className="text-xs font-mono text-emerald-300 tabular-nums">
                    {logicErpOnlyArticles.length} Logic ERP Articles
                  </span>
                </div>

                {logicErpOnlyArticles.length === 0 ? (
                  <div className="p-8 text-center space-y-2">
                    <div className="text-xs font-bold text-slate-800">
                      Abhi Logic ERP se koi stock sync nahi hua hai (0 Logic ERP Articles).
                    </div>
                    <p className="text-xs text-slate-500 max-w-xl mx-auto leading-relaxed">
                      Abhi aapke scanner par jo <strong>{computedTotalArticles} Articles</strong> hain, vo aapki upload ki gayi Excel file (<strong>{effectiveSourceFileName || 'Excel Sheet'}</strong>) ke hain. Jab aap Chrome me Logic ERP khol kar <strong>&quot;Sync Stock Table&quot;</strong> dabayenge, tabhi Logic ERP ka asli stock yahan dikhega.
                    </p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    <div className="px-5 py-2.5 bg-slate-50 grid grid-cols-12 text-[11px] font-semibold text-slate-500">
                      <span className="col-span-4">LOGIC ERP ARTICLE / BARCODE</span>
                      <span className="col-span-6">SIZE-WISE LIVE QUANTITY</span>
                      <span className="col-span-2 text-right">TOTAL PAIRS</span>
                    </div>

                    {logicErpOnlyArticles.slice(0, 30).map((art) => {
                      const totalPcs = (art.sizes || []).reduce(
                        (s, sz) => s + Math.max(0, Number(sz.quantity) || 0),
                        0
                      );
                      return (
                        <div
                          key={art.id}
                          className="px-5 py-3 grid grid-cols-12 items-center gap-3 hover:bg-slate-50"
                        >
                          <div className="col-span-4 min-w-0">
                            <div className="text-xs font-bold font-mono text-slate-900 truncate">
                              {art.articleCode || art.name}
                            </div>
                            <div className="text-[11px] font-mono text-slate-500 truncate">
                              Barcode: {art.articleBarcode || art.sizes?.[0]?.barcode || '—'}
                            </div>
                          </div>

                          <div className="col-span-6 flex flex-wrap gap-1.5">
                            {(art.sizes || []).map((sz) => (
                              <span
                                key={`${art.id}-${sz.size}`}
                                className={`inline-flex items-center gap-1.5 px-2 py-1 rounded border text-xs font-mono tabular-nums ${
                                  sz.quantity > 0
                                    ? 'bg-slate-50 border-slate-200 text-slate-800'
                                    : 'bg-red-50 border-red-200 text-red-600'
                                }`}
                              >
                                <span>{sz.size}:</span>
                                <strong>{sz.quantity}</strong>
                              </span>
                            ))}
                          </div>

                          <div className="col-span-2 text-right font-mono text-xs font-bold tabular-nums">
                            {totalPcs > 0 ? (
                              <span className="text-emerald-700">{totalPcs} Pairs</span>
                            ) : (
                              <span className="text-red-600">0 Pairs</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ================================================================
              TAB 3: USER LIVE STOCK DATA EXPLORER
          ================================================================ */}
          {activeTab === 'stock-data' && (
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-bold">
                    Live Database Stock Explorer ({computedTotalArticles} Articles · {computedTotalPieces} Pairs)
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    Search any shoe, view size-wise stock, or adjust +1 / -1 directly in database
                  </p>
                </div>

                {/* Interactive Filter Controls */}
                <div className="flex items-center gap-1 p-1 bg-slate-800 rounded-lg">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'in-stock', label: 'In Stock' },
                      { id: 'low', label: 'Low (1-2)' },
                      { id: 'out', label: 'Out (0)' }
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setStockFilter(f.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
                        stockFilter === f.id
                          ? 'bg-white text-slate-900 font-bold'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
                <div className="relative flex-1 min-w-[240px]">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="text"
                    value={stockSearch}
                    onChange={(e) => setStockSearch(e.target.value)}
                    placeholder="Search by Article Code, Shoe Name, Barcode, or Size..."
                    className="w-full pl-9 pr-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-900"
                  />
                </div>
                <span className="text-xs text-slate-500 font-mono tabular-nums">
                  Showing {filteredStockArticles.length} matching articles
                </span>
              </div>

              {filteredStockArticles.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No articles match your current filter.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  <div className="px-5 py-2.5 bg-slate-50 grid grid-cols-12 text-[11px] font-semibold text-slate-500">
                    <span className="col-span-4">ARTICLE / BARCODE</span>
                    <span className="col-span-6">SIZES &amp; INSTANT +/- STOCK CONTROL</span>
                    <span className="col-span-2 text-right">TOTAL STOCK</span>
                  </div>

                  {filteredStockArticles.map((art) => {
                    const artTotal = (art.sizes || []).reduce(
                      (s, sz) => s + Math.max(0, Number(sz.quantity) || 0),
                      0
                    );
                    const code = art.articleCode || art.name;
                    return (
                      <div
                        key={art.id}
                        className="px-5 py-3 grid grid-cols-12 items-center gap-3 hover:bg-slate-50"
                      >
                        <div className="col-span-4 min-w-0">
                          <div className="text-xs font-bold font-mono text-slate-900 truncate">
                            {code}
                          </div>
                          <div className="text-[11px] text-slate-500 font-mono truncate">
                            Barcode: {art.articleBarcode || art.sizes?.[0]?.barcode || '—'}
                          </div>
                        </div>

                        <div className="col-span-6 flex flex-wrap gap-2">
                          {(art.sizes || []).map((sz) => {
                            const isBusy = adjustingKey === `${code}__${sz.size}`;
                            return (
                              <div
                                key={`${art.id}-${sz.size}`}
                                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-mono tabular-nums"
                              >
                                <span className="font-semibold text-slate-600">{sz.size}:</span>
                                <strong
                                  className={
                                    sz.quantity > 0 ? 'text-emerald-700' : 'text-red-600'
                                  }
                                >
                                  {sz.quantity}
                                </strong>
                                <button
                                  type="button"
                                  disabled={isBusy || sz.quantity <= 0}
                                  onClick={() => handleDirectSizeQtyChange(code, sz.size, -1)}
                                  className="text-red-600 hover:text-red-800 disabled:opacity-30 ml-1"
                                  title="Minus 1 Piece"
                                >
                                  <MinusCircle className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() => handleDirectSizeQtyChange(code, sz.size, 1)}
                                  className="text-emerald-600 hover:text-emerald-800 disabled:opacity-30"
                                  title="Add 1 Piece"
                                >
                                  <PlusCircle className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            );
                          })}
                        </div>

                        <div className="col-span-2 text-right font-mono text-xs font-bold tabular-nums">
                          {artTotal > 0 ? (
                            <span className="text-emerald-700">{artTotal} Pairs</span>
                          ) : (
                            <span className="text-red-600">0 Left</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              TAB 4: SOLD / MINUS PIECES HISTORY
          ================================================================ */}
          {activeTab === 'sold-history' && (
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold">
                    Live Shoes Sold (Kitne Pieces Minus Huye &amp; Kitne Bache)
                  </h2>
                </div>
                <span className="text-xs text-emerald-300 font-mono font-bold tabular-nums">
                  Total {totalSoldPieces} Pieces Minus
                </span>
              </div>

              {soldDeductions.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-500">
                  No pieces have been deducted yet.
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  <div className="px-5 py-2.5 bg-slate-50 grid grid-cols-12 text-[11px] font-semibold text-slate-500">
                    <span className="col-span-5">SHOES / ARTICLE NAME</span>
                    <span className="col-span-2 text-center">SIZE</span>
                    <span className="col-span-2 text-center">MINUS PIECES</span>
                    <span className="col-span-3 text-right">REMAINING IN STOCK</span>
                  </div>

                  {soldDeductions.map((entry) => (
                    <div
                      key={entry.id}
                      className="px-5 py-3 grid grid-cols-12 items-center gap-2 hover:bg-slate-50"
                    >
                      <div className="col-span-5 min-w-0">
                        <div className="text-xs font-bold text-slate-900 font-mono truncate">
                          {entry.articleCode}
                        </div>
                        <div className="text-[11px] text-slate-500 font-mono truncate">
                          Barcode: {entry.barcode}
                        </div>
                      </div>

                      <div className="col-span-2 text-center font-mono text-xs font-bold text-slate-800 tabular-nums">
                        {entry.size}
                      </div>

                      <div className="col-span-2 text-center font-mono text-xs font-bold text-red-600 tabular-nums">
                        -{entry.qtyDeducted} Piece{entry.qtyDeducted > 1 ? 's' : ''}
                      </div>

                      <div className="col-span-3 text-right">
                        <div className="font-mono text-xs font-bold tabular-nums">
                          {entry.remainingQty <= 0 ? (
                            <span className="text-red-600">0 Left (Out of Stock)</span>
                          ) : (
                            <span className="text-emerald-700">
                              {entry.remainingQty} Left in Stock
                            </span>
                          )}
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          {entry.timestamp}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ================================================================
              TAB 5: CHROME EXTENSION SETUP
          ================================================================ */}
          {activeTab === 'extension' && (
            <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-5 py-4 bg-slate-900 text-white flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Puzzle className="w-4 h-4 text-emerald-400" />
                  <h2 className="text-sm font-bold">
                    Logic ERP Chrome Bridge: Live Stock Sync + Bill Save/Print Auto-Minus
                  </h2>
                </div>
                <span className="text-xs text-emerald-300 font-mono">
                  Full Stock Table Sync + Strict Qty Column Auto-Minus
                </span>
              </div>

              <div className="p-5 space-y-4">
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 space-y-2">
                  <div className="font-bold text-slate-900">
                    Logic ERP Chrome Bridge Setup (Sirf 30 Second — 1 Baar Ka Kaam):
                  </div>
                  <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700">
                    <li>
                      Neeche green button{' '}
                      <strong>&quot;Download Logic Chrome ERP Bridge (.zip)&quot;</strong> par click
                      karein aur downloaded folder ko Extract (Unzip) kar lein.
                    </li>
                    <li>
                      Chrome me{' '}
                      <code className="font-mono font-bold bg-white px-1.5 py-0.5 rounded border">
                        chrome://extensions
                      </code>{' '}
                      kholein aur upar right corner me <strong>&quot;Developer mode&quot;</strong>{' '}
                      ON karein.
                    </li>
                    <li>
                      Upar left corner me <strong>&quot;Load unpacked&quot;</strong> click karke
                      extracted folder select kar lein.
                    </li>
                    <li>
                      <strong>Full Stock Sync:</strong> Logic Chrome ERP me Stock Report / Inventory
                      table khol kar neeche right corner me{' '}
                      <strong>&quot;Sync Stock Table&quot;</strong> button dabayein — poora live
                      stock bina Excel ke <code className="font-mono">elooks.in</code> par sync ho
                      jayega!
                    </li>
                    <li>
                      <strong>Bill Save / Print Auto-Minus:</strong> Jab bhi aap Chrome Logic ERP me
                      bill <strong>Save ya Print</strong> karenge, Qty column me jitne pieces honge
                      sirf utne hi pieces minus honge!
                    </li>
                  </ol>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={handleDownloadConfiguredChromeBridge}
                    className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg transition-colors cursor-pointer"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      Download Logic Chrome ERP Bridge (StockScan_Logic_Chrome_ERP_Bridge.zip)
                    </span>
                  </button>
                </div>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};
