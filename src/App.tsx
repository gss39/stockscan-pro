/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import {
  Camera,
  CheckCircle2,
  FileSpreadsheet,
  Image as ImageIcon,
  PlusCircle,
  RefreshCw,
  Search,
  X,
  XCircle
} from 'lucide-react';
import { DashboardView } from './components/DashboardView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { PWAInstallButton } from './components/PWAInstallButton';
import { ArticleStock, SheetMetadata, SizeStockEntry } from './types/stock';
import { trackAnalyticsEvent } from './utils/analytics';
import {
  consolidateArticlesByGroup,
  parseStockExcel
} from './utils/excelParser';
import {
  fetchSharedStockJson,
  pushSharedStockJson,
  StoredStockJson
} from './utils/githubSync';
import { scannerSound } from './utils/sound';

const STORAGE_KEY_JSON = 'stockscan_json_store_v4';

function checkIsDashboardRoute(): boolean {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  const search = window.location.search.toLowerCase();
  return (
    path.endsWith('/dashboard') ||
    path.endsWith('/dashboard/') ||
    path.includes('/dashboard') ||
    hash.includes('dashboard') ||
    search.includes('dashboard')
  );
}

export default function App() {
  const [isDashboardRoute, setIsDashboardRoute] = useState<boolean>(() =>
    checkIsDashboardRoute()
  );

  const [stockJson, setStockJson] = useState<StoredStockJson>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_JSON);
      if (saved) {
        const parsed = JSON.parse(saved) as StoredStockJson;
        if (parsed && Array.isArray(parsed.articles)) {
          return parsed;
        }
      }
    } catch {
      // Ignore storage error
    }
    return {
      articles: [],
      sheetMeta: null,
      version: 0
    };
  });

  const articles = useMemo(
    () => consolidateArticlesByGroup(stockJson.articles),
    [stockJson.articles]
  );
  const sheetMeta = stockJson.sheetMeta;
  const versionRef = useRef<number>(stockJson.version);
  const articlesCountRef = useRef<number>(stockJson.articles.length);

  const [isSyncing, setIsSyncing] = useState<boolean>(false);

  // Search / Scanned query in the search bar
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isCameraOpen, setIsCameraOpen] = useState<boolean>(false);
  const [isScanning, setIsScanning] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');

  // Manual Add Stock Form State
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [newArticleCode, setNewArticleCode] = useState('');
  const [newArticleName, setNewArticleName] = useState('');
  const [newColor, setNewColor] = useState('');
  const [newPrice, setNewPrice] = useState('');
  const [newRack, setNewRack] = useState('Rack A-1');
  const [newSizeRows, setNewSizeRows] = useState<
    { size: string; barcode: string; quantity: string }[]
  >([
    { size: 'S', barcode: '', quantity: '10' },
    { size: 'M', barcode: '', quantity: '15' },
    { size: 'L', barcode: '', quantity: '12' },
    { size: 'XL', barcode: '', quantity: '8' }
  ]);

  const [feedbackBanner, setFeedbackBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const scannerRef = useRef<Html5Qrcode | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const lastLoggedQueryRef = useRef<string>('');

  // Listen for URL route / hash changes (e.g. /dashboard or #/dashboard)
  useEffect(() => {
    const handleRouteChange = () => {
      setIsDashboardRoute(checkIsDashboardRoute());
    };
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  // Listen for route changes (e.g. /dashboard or #/dashboard)
  useEffect(() => {
    const handleRouteChange = () => {
      setIsDashboardRoute(checkIsDashboardRoute());
    };
    window.addEventListener('popstate', handleRouteChange);
    window.addEventListener('hashchange', handleRouteChange);
    return () => {
      window.removeEventListener('popstate', handleRouteChange);
      window.removeEventListener('hashchange', handleRouteChange);
    };
  }, []);

  // Track user visit & periodic heartbeat
  useEffect(() => {
    trackAnalyticsEvent({ eventType: 'visit' });
    const heartbeat = setInterval(() => {
      trackAnalyticsEvent({ eventType: 'heartbeat' });
    }, 60000);
    return () => clearInterval(heartbeat);
  }, []);

  // Persist converted JSON in localStorage whenever it changes
  const saveLocalJson = useCallback((next: StoredStockJson) => {
    versionRef.current = next.version;
    articlesCountRef.current = next.articles.length;
    setStockJson(next);
    try {
      localStorage.setItem(STORAGE_KEY_JSON, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  }, []);

  // Fetch latest converted JSON from cloud/server so all phones stay synced automatically
  const fetchLatestJsonFromServer = useCallback(async () => {
    const data = await fetchSharedStockJson();
    if (
      data &&
      Array.isArray(data.articles) &&
      data.articles.length > 0 &&
      (data.version > versionRef.current || articlesCountRef.current === 0)
    ) {
      saveLocalJson(data);
    }
  }, [saveLocalJson]);

  // Push converted JSON to shared cloud + server when Excel is uploaded or updated
  const pushJsonToServer = async (
    nextArticles: ArticleStock[],
    nextMeta: SheetMetadata
  ): Promise<boolean> => {
    const payload: StoredStockJson = {
      articles: nextArticles,
      sheetMeta: nextMeta,
      version: Date.now()
    };
    saveLocalJson(payload);
    return await pushSharedStockJson(payload);
  };

  // Poll shared JSON every 5 seconds and on window focus so all phones update automatically
  useEffect(() => {
    fetchLatestJsonFromServer();
    const interval = setInterval(fetchLatestJsonFromServer, 5000);
    const onFocus = () => fetchLatestJsonFromServer();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchLatestJsonFromServer]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Support USB / Bluetooth barcode scanner gun automatically
  useEffect(() => {
    let buffer = '';
    let lastKeyTime = 0;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isDashboardRoute) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }
      const now = Date.now();
      if (now - lastKeyTime > 120) buffer = '';
      lastKeyTime = now;

      if (e.key === 'Enter' && buffer.length >= 3) {
        e.preventDefault();
        const code = buffer.trim();
        buffer = '';
        handleBarcodeDetected(code);
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        buffer += e.key;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const stopCamera = async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // Ignore stop errors
      }
      scannerRef.current = null;
    }
    setIsScanning(false);
    setIsCameraOpen(false);
  };

  const toggleCameraScanner = async () => {
    if (isCameraOpen) {
      await stopCamera();
      return;
    }
    setIsCameraOpen(true);
    setFeedbackBanner(null);

    setTimeout(() => {
      startCamera(facingMode);
    }, 80);
  };

  const startCamera = async (mode: 'environment' | 'user' = facingMode) => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        scannerRef.current.clear();
      } catch {
        // Ignore
      }
      scannerRef.current = null;
    }

    try {
      const formatsToSupport = [
        Html5QrcodeSupportedFormats.EAN_13,
        Html5QrcodeSupportedFormats.EAN_8,
        Html5QrcodeSupportedFormats.UPC_A,
        Html5QrcodeSupportedFormats.UPC_E,
        Html5QrcodeSupportedFormats.CODE_128,
        Html5QrcodeSupportedFormats.CODE_39,
        Html5QrcodeSupportedFormats.ITF,
        Html5QrcodeSupportedFormats.QR_CODE
      ];

      const qr = new Html5Qrcode('barcode-reader-viewport', {
        formatsToSupport,
        verbose: false
      });
      scannerRef.current = qr;

      await qr.start(
        { facingMode: mode },
        {
          fps: 12,
          qrbox: { width: 250, height: 110 },
          aspectRatio: 1.77
        },
        (decodedText) => {
          const clean = decodedText.trim();
          if (clean) {
            handleBarcodeDetected(clean);
            stopCamera();
          }
        },
        () => {
          // Ignore frame misses
        }
      );

      setIsScanning(true);
    } catch {
      setIsScanning(false);
      setFeedbackBanner({
        type: 'error',
        text: 'Camera permission blocked. Use the "Photo" button to scan an image or type the barcode in the search bar.'
      });
      trackAnalyticsEvent({
        eventType: 'issue',
        issue: {
          type: 'camera_error',
          title: 'Camera Permission Blocked or Unavailable',
          detail: 'User tried opening live barcode camera scanner, but camera access failed.'
        }
      });
    }
  };

  const handleFlipCamera = async () => {
    const next = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(next);
    if (isScanning) {
      await startCamera(next);
    }
  };

  const handleBarcodeDetected = (code: string) => {
    const clean = code.trim();
    if (!clean) return;
    setSearchQuery(clean);

    const q = clean.toLowerCase();
    const found = articles.some(
      (art) =>
        art.articleCode.toLowerCase().includes(q) ||
        art.articleBarcode.toLowerCase().includes(q) ||
        art.name.toLowerCase().includes(q) ||
        art.sizes.some((s) => s.barcode.toLowerCase().includes(q))
    );

    if (found) {
      scannerSound.playSuccessBeep();
    } else {
      scannerSound.playWarningBeep();
    }
  };

  const handlePhotoScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFeedbackBanner({ type: 'info', text: 'Scanning barcode from image...' });

    if (isCameraOpen) {
      await stopCamera();
    }

    try {
      const tempQr = new Html5Qrcode('barcode-photo-temp');
      const decoded = await tempQr.scanFile(file, false);
      tempQr.clear();
      setFeedbackBanner(null);
      handleBarcodeDetected(decoded.trim());
    } catch {
      setFeedbackBanner({
        type: 'error',
        text: 'No clear barcode detected in this image. Please type the barcode or article number in the search bar.'
      });
      trackAnalyticsEvent({
        eventType: 'issue',
        issue: {
          type: 'photo_scan_error',
          title: 'Unreadable Barcode Photo',
          detail: `User uploaded photo "${file.name}" but no valid barcode could be decoded.`
        }
      });
    } finally {
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  };

  // Convert uploaded Excel sheet directly into JSON, replace old JSON, and sync across all phones
  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsSyncing(true);
      const parsedArticles = await parseStockExcel(file);
      const totalPcs = parsedArticles.reduce(
        (sum, a) => sum + a.sizes.reduce((s, z) => s + z.quantity, 0),
        0
      );

      const nextMeta: SheetMetadata = {
        fileName: file.name,
        uploadedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        totalArticles: parsedArticles.length,
        totalPieces: totalPcs
      };

      // Immediately store converted JSON locally
      const nowVersion = Date.now();
      saveLocalJson({
        articles: parsedArticles,
        sheetMeta: nextMeta,
        version: nowVersion
      });
      setSearchQuery('');

      // Update shared JSON on server so all phones automatically get the new JSON
      await pushJsonToServer(parsedArticles, nextMeta);
      setIsSyncing(false);

      setFeedbackBanner({
        type: 'success',
        text: `Excel converted to JSON & updated! (${parsedArticles.length} Articles · ${totalPcs} Pcs)`
      });
      scannerSound.playSuccessBeep();
    } catch (err: unknown) {
      setIsSyncing(false);
      const msg = err instanceof Error ? err.message : 'Excel file error';
      setFeedbackBanner({
        type: 'error',
        text: `Upload Error: ${msg}`
      });
      trackAnalyticsEvent({
        eventType: 'issue',
        issue: {
          type: 'upload_error',
          title: `Excel Upload Failed (${file.name})`,
          detail: msg
        }
      });
    } finally {
      if (excelInputRef.current) excelInputRef.current.value = '';
    }
  };

  const handleOpenManualAdd = (prefillCode?: string) => {
    setNewArticleCode(prefillCode || `ART-${101 + articles.length}`);
    setNewArticleName('');
    setNewColor('Standard');
    setNewPrice('');
    setNewRack('Rack A-1');
    setNewSizeRows([
      { size: 'S', barcode: prefillCode || '', quantity: '10' },
      { size: 'M', barcode: '', quantity: '15' },
      { size: 'L', barcode: '', quantity: '12' },
      { size: 'XL', barcode: '', quantity: '8' }
    ]);
    setIsAddModalOpen(true);
  };

  const handleSaveManualArticle = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = newArticleCode.trim() || `ART-${101 + articles.length}`;
    const name = newArticleName.trim() || code;
    const priceNum = parseFloat(newPrice) || 0;

    const validSizes: SizeStockEntry[] = newSizeRows
      .filter((r) => r.size.trim() !== '')
      .map((r, idx) => ({
        size: r.size.trim(),
        barcode: r.barcode.trim() || `${code}-${idx + 1}`,
        quantity: Math.max(0, parseInt(r.quantity, 10) || 0)
      }));

    if (validSizes.length === 0) return;

    const newArt: ArticleStock = {
      id: `art-${Date.now()}`,
      articleCode: code,
      articleBarcode: validSizes[0].barcode || code,
      name,
      category: 'General',
      color: newColor.trim() || 'Standard',
      sellingPrice: priceNum,
      mrp: priceNum,
      rackLocation: newRack.trim() || 'Main Store',
      sizes: validSizes
    };

    const nextArticles = [newArt, ...articles];
    const totalPcs = nextArticles.reduce(
      (sum, a) => sum + a.sizes.reduce((s, z) => s + z.quantity, 0),
      0
    );
    const nextMeta: SheetMetadata = {
      fileName: sheetMeta?.fileName || 'Stock_JSON_Data',
      uploadedAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      totalArticles: nextArticles.length,
      totalPieces: totalPcs
    };

    saveLocalJson({
      articles: nextArticles,
      sheetMeta: nextMeta,
      version: Date.now()
    });
    setSearchQuery(code);
    setIsAddModalOpen(false);
    scannerSound.playSuccessBeep();

    await pushJsonToServer(nextArticles, nextMeta);
    setFeedbackBanner({
      type: 'success',
      text: `Article "${code}" saved to JSON store!`
    });
  };

  // Show only one single article ONLY when a barcode is scanned or searched
  const filteredArticles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];

    // 1. Prioritize exact match on Barcode or Article Code
    const exactMatch = articles.find(
      (art) =>
        art.articleCode.toLowerCase() === q ||
        art.articleBarcode.toLowerCase() === q ||
        art.sizes.some((s) => s.barcode.toLowerCase() === q)
    );
    if (exactMatch) return [exactMatch];

    // 2. Otherwise return the first matching article
    const firstPartial = articles.find(
      (art) =>
        art.articleCode.toLowerCase().includes(q) ||
        art.articleBarcode.toLowerCase().includes(q) ||
        art.name.toLowerCase().includes(q) ||
        art.color.toLowerCase().includes(q) ||
        art.sizes.some((s) => s.barcode.toLowerCase().includes(q))
    );
    return firstPartial ? [firstPartial] : [];
  }, [articles, searchQuery]);

  const cleanQuery = searchQuery.trim().toLowerCase();

  // Automatically log searches and user issues (not found / out of stock) after short debounce
  useEffect(() => {
    if (!cleanQuery || cleanQuery.length < 2) {
      lastLoggedQueryRef.current = '';
      return;
    }

    const timer = setTimeout(() => {
      if (lastLoggedQueryRef.current === cleanQuery) return;
      lastLoggedQueryRef.current = cleanQuery;

      if (filteredArticles.length > 0) {
        const matched = filteredArticles[0];
        const totalStock = matched.sizes.reduce((sum, s) => sum + s.quantity, 0);
        const exactScannedSize = matched.sizes.find(
          (s) => s.barcode.toLowerCase() === cleanQuery
        );

        // 1. Track article search popularity
        trackAnalyticsEvent({
          eventType: 'search',
          article: {
            articleCode: matched.articleCode,
            name: matched.name,
            barcode:
              exactScannedSize?.barcode ||
              matched.articleBarcode ||
              matched.sizes[0]?.barcode ||
              '',
            totalStock
          }
        });

        // 2. Track issue if the scanned size or entire article is out of stock (0 qty)
        if (exactScannedSize && exactScannedSize.quantity <= 0) {
          trackAnalyticsEvent({
            eventType: 'issue',
            issue: {
              type: 'out_of_stock',
              title: `Size "${exactScannedSize.size}" Out of Stock for ${matched.articleCode}`,
              detail: `User scanned barcode ${exactScannedSize.barcode} (${matched.name}, Size ${exactScannedSize.size}) which has 0 quantity.`,
              query: searchQuery.trim()
            }
          });
        } else if (totalStock <= 0) {
          trackAnalyticsEvent({
            eventType: 'issue',
            issue: {
              type: 'out_of_stock',
              title: `Article "${matched.articleCode}" Completely Out of Stock`,
              detail: `User searched "${matched.name}" (${matched.articleCode}) which has 0 total pieces left.`,
              query: searchQuery.trim()
            }
          });
        }
      } else {
        // 3. Track issue when user searches/scans a barcode or article that is NOT found
        trackAnalyticsEvent({
          eventType: 'issue',
          issue: {
            type: 'not_found',
            title: `Article / Barcode Not Found in Stock`,
            detail:
              articles.length === 0
                ? `User searched "${searchQuery.trim()}" while no Excel stock sheet was loaded.`
                : `User searched or scanned "${searchQuery.trim()}" which does not exist in the active stock sheet.`,
            query: searchQuery.trim()
          }
        });
      }
    }, 650);

    return () => clearTimeout(timer);
  }, [cleanQuery, filteredArticles, articles.length, searchQuery]);

  // Render route-only Analytics Dashboard when URL route is /dashboard or #/dashboard
  if (isDashboardRoute) {
    return (
      <DashboardView
        totalArticlesInSheet={articles.length}
        totalPiecesInSheet={sheetMeta?.totalPieces || 0}
        sheetFileName={sheetMeta?.fileName}
        articles={articles}
        onRefreshStock={fetchLatestJsonFromServer}
      />
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 pb-10">
      {/* Hidden inputs for Excel & Photo scan */}
      <div id="barcode-photo-temp" className="hidden" />
      <input
        ref={excelInputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleExcelUpload}
        className="hidden"
      />
      <input
        ref={photoInputRef}
        type="file"
        accept="image/*"
        onChange={handlePhotoScan}
        className="hidden"
      />

      {/* 1. HEADER */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 px-3.5 py-3">
        <div className="max-w-lg mx-auto flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h1 className="text-base font-bold tracking-tight text-slate-900 truncate">
              StockScan
            </h1>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#/dashboard';
                setIsDashboardRoute(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg transition-colors min-h-[38px] whitespace-nowrap"
            >
              <span>Dashboard</span>
            </button>
            <button
              type="button"
              onClick={() => excelInputRef.current?.click()}
              disabled={isSyncing}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors min-h-[38px] whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5" />
              <span>{isSyncing ? 'Updating...' : 'Excel Upload'}</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-lg mx-auto px-3.5 pt-3 space-y-3">
        {/* 2. SEARCH BAR WITH CAMERA ICON (Immediately below Header) */}
        <section className="bg-white border border-slate-200 rounded-2xl p-2.5 shadow-xs space-y-2.5">
          <div className="flex items-center gap-2">
            {/* Search Input with Clear Button */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Barcode, Article No or Item Name..."
                className="w-full pl-9 pr-8 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:border-blue-600 focus:outline-none font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
                  aria-label="Clear search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Camera Icon Button inside Search Bar */}
            <button
              type="button"
              onClick={toggleCameraScanner}
              title="Scan Barcode with Camera"
              className={`h-[42px] px-3.5 rounded-xl flex items-center justify-center gap-1.5 font-semibold text-xs transition-all shrink-0 ${
                isCameraOpen
                  ? 'bg-red-600 text-white'
                  : 'bg-slate-900 hover:bg-slate-800 text-white'
              }`}
            >
              <Camera className="w-4 h-4" />
              <span>{isCameraOpen ? 'Close' : 'Scan'}</span>
            </button>
          </div>

          {/* Collapsible Live Camera Viewport (Opens when Camera Icon is tapped) */}
          {isCameraOpen && (
            <div className="rounded-xl overflow-hidden bg-slate-900 border border-slate-800">
              <div id="barcode-reader-viewport" className="w-full min-h-[190px]" />
              <div className="px-3 py-2 bg-slate-950 flex items-center justify-between gap-2 border-t border-slate-800">
                <span className="text-[11px] text-emerald-400 font-medium">
                  Point camera at barcode...
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => photoInputRef.current?.click()}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md"
                  >
                    <ImageIcon className="w-3 h-3" />
                    <span>Photo</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleFlipCamera}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Flip</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Notification Banner */}
        {feedbackBanner && (
          <div
            className={`p-3 rounded-xl border text-xs font-medium flex items-center justify-between gap-2 ${
              feedbackBanner.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : feedbackBanner.type === 'error'
                ? 'bg-red-50 border-red-200 text-red-900'
                : 'bg-blue-50 border-blue-200 text-blue-900'
            }`}
          >
            <span>{feedbackBanner.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackBanner(null)}
              className="text-[11px] underline opacity-75 shrink-0"
            >
              Close
            </button>
          </div>
        )}

        {/* MANUAL ADD ARTICLE & SIZES FORM */}
        {isAddModalOpen && (
          <section className="bg-white border-2 border-blue-600 rounded-2xl p-4 shadow-sm space-y-3.5">
            <div className="flex items-center justify-between border-b border-slate-200 pb-2.5">
              <h2 className="text-sm font-bold text-slate-900">
                Add Stock Manually
              </h2>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveManualArticle} className="space-y-3">
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Article No *
                  </label>
                  <input
                    type="text"
                    required
                    value={newArticleCode}
                    onChange={(e) => setNewArticleCode(e.target.value)}
                    placeholder="e.g. ART-501"
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    MRP / Price (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={newPrice}
                    onChange={(e) => setNewPrice(e.target.value)}
                    placeholder="e.g. 999"
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Item Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newArticleName}
                    onChange={(e) => setNewArticleName(e.target.value)}
                    placeholder="e.g. Cotton Formal Shirt"
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Color
                  </label>
                  <input
                    type="text"
                    value={newColor}
                    onChange={(e) => setNewColor(e.target.value)}
                    placeholder="e.g. White / Black"
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                    Rack / Location
                  </label>
                  <input
                    type="text"
                    value={newRack}
                    onChange={(e) => setNewRack(e.target.value)}
                    placeholder="e.g. Rack A-2"
                    className="w-full px-2.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                  />
                </div>
              </div>

              {/* Size-wise inputs */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-slate-700">
                    Sizes & Quantities:
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setNewSizeRows((prev) => [
                        ...prev,
                        { size: '', barcode: '', quantity: '5' }
                      ])
                    }
                    className="text-[11px] font-semibold text-blue-600 hover:underline"
                  >
                    + Add Size
                  </button>
                </div>

                {newSizeRows.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-1.5 items-center">
                    <input
                      type="text"
                      value={row.size}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewSizeRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, size: val } : r))
                        );
                      }}
                      placeholder="Size (M/32)"
                      className="col-span-3 px-2 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
                    />
                    <input
                      type="text"
                      value={row.barcode}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewSizeRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, barcode: val } : r))
                        );
                      }}
                      placeholder="Barcode (Optional)"
                      className="col-span-5 px-2 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono"
                    />
                    <input
                      type="number"
                      min={0}
                      value={row.quantity}
                      onChange={(e) => {
                        const val = e.target.value;
                        setNewSizeRows((prev) =>
                          prev.map((r, i) => (i === idx ? { ...r, quantity: val } : r))
                        );
                      }}
                      placeholder="Qty"
                      className="col-span-3 px-2 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setNewSizeRows((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="col-span-1 text-slate-400 hover:text-red-600 flex justify-center"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3.5 py-2 text-xs font-medium text-slate-600 bg-slate-100 rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
                >
                  Save Stock
                </button>
              </div>
            </form>
          </section>
        )}

        {/* 3. STOCK LIST VIEW (Shown only when an Article / Barcode is Scanned or Searched) */}
        <section className="space-y-3">
          {!cleanQuery ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center">
              <div className="text-sm font-semibold text-slate-800">
                {articles.length === 0
                  ? 'Upload an Excel stock sheet using the "Excel Upload" button above'
                  : 'Scan a barcode or enter an Article No in the search bar above'}
              </div>
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center space-y-3">
              <XCircle className="w-8 h-8 text-red-500 mx-auto" />
              <div>
                <div className="text-sm font-bold text-slate-900">
                  "{searchQuery}" not found in stock
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  You can add this barcode/article manually right now or upload an updated Excel sheet.
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleOpenManualAdd(searchQuery)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl"
              >
                <PlusCircle className="w-4 h-4" />
                <span>+ Add "{searchQuery}" Manually</span>
              </button>
            </div>
          ) : (
            filteredArticles.map((article) => {
              const totalQty = article.sizes.reduce((sum, s) => sum + s.quantity, 0);
              const matchedSizeForHeader =
                cleanQuery.length > 0
                  ? article.sizes.find(
                      (s) =>
                        s.barcode.toLowerCase() === cleanQuery ||
                        s.barcode.toLowerCase().includes(cleanQuery)
                    )
                  : undefined;
              const displayBarcode =
                matchedSizeForHeader?.barcode ||
                article.articleBarcode ||
                article.sizes[0]?.barcode ||
                '';

              return (
                <div
                  key={article.id}
                  className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs"
                >
                  {/* Blue Header Section: Left (Item Name on top, Barcode below) | Right (MRP & Total Pcs) */}
                  <div className="px-4 py-3 bg-slate-900 text-white flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-white truncate">
                        {article.name}
                      </div>
                      <div className="text-xs text-slate-300 font-mono tabular-nums truncate mt-0.5">
                        {displayBarcode}
                      </div>
                    </div>

                    <div className="text-right shrink-0 font-mono tabular-nums">
                      <div className="text-sm font-bold text-emerald-400">
                        MRP ₹{article.mrp || article.sellingPrice}
                      </div>
                      <div className="text-[11px] text-slate-300 mt-0.5">
                        Total: <span className="font-bold text-white">{totalQty} Pcs</span>
                      </div>
                    </div>
                  </div>

                  {/* Column Headers: Article / Barcode | Size | Qty */}
                  <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 grid grid-cols-12 items-center text-[11px] font-semibold text-slate-500">
                    <span className="col-span-6">ARTICLE NO / BARCODE</span>
                    <span className="col-span-3 text-center">SIZE</span>
                    <span className="col-span-3 text-right">QTY</span>
                  </div>

                  {/* Size-Wise Quantity List View */}
                  <div className="divide-y divide-slate-100">
                    {article.sizes.map((sizeItem, sizeIdx) => {
                      const isMatchedSize =
                        cleanQuery.length > 0 &&
                        sizeItem.barcode.toLowerCase() === cleanQuery;
                      const isOut = sizeItem.quantity <= 0;

                      return (
                        <div
                          key={`${sizeItem.size}-${sizeItem.barcode}-${sizeIdx}`}
                          className={`px-4 py-3 grid grid-cols-12 items-center gap-2 ${
                            isMatchedSize ? 'bg-blue-50/80' : 'bg-white'
                          }`}
                        >
                          {/* 1st: Article Number on top, Barcode underneath */}
                          <div className="col-span-6 min-w-0">
                            <div className="text-xs font-bold text-slate-900 font-mono tabular-nums flex items-center gap-1.5">
                              <span className="truncate">{article.articleCode}</span>
                              {isMatchedSize && (
                                <span className="text-[10px] font-sans font-semibold text-blue-700 shrink-0">
                                  · Scanned
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-slate-500 font-mono tabular-nums truncate mt-0.5">
                              {sizeItem.barcode}
                            </div>
                          </div>

                          {/* 2nd: Size */}
                          <div className="col-span-3 flex justify-center">
                            <span
                              className={`min-w-[44px] h-8 px-2.5 rounded-lg border flex items-center justify-center font-mono font-bold text-xs tabular-nums ${
                                isOut
                                  ? 'bg-slate-100 border-slate-200 text-slate-400'
                                  : isMatchedSize
                                  ? 'bg-blue-600 border-blue-600 text-white'
                                  : 'bg-slate-100 border-slate-300 text-slate-900'
                              }`}
                            >
                              {sizeItem.size}
                            </span>
                          </div>

                          {/* 3rd: Qty (Green if > 0, Red if 0 — no yellow warning icon) */}
                          <div className="col-span-3 text-right font-mono tabular-nums">
                            {isOut ? (
                              <span className="inline-flex items-center justify-end gap-1 text-red-600 font-bold text-xs">
                                <XCircle className="w-3.5 h-3.5 shrink-0" />
                                <span>0</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-end gap-1 text-emerald-600 font-bold text-sm">
                                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                                <span>{sizeItem.quantity}</span>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </section>
      </main>
      <OfflineIndicator />
    </div>
  );
}
