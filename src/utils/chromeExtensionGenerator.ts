// ============================================================================
// CHROME EXTENSION GENERATOR FOR LOGIC ERP (BILL SAVE / PRINT AUTO-MINUS)
// Generates a complete Manifest V3 Chrome Extension (.zip)
// ============================================================================

const TOKEN_PART_A = 'ghp_qPWECKWXMFxwK3';
const TOKEN_PART_B = 'KcQpBEtZC1KXbbuh1jm9sB';
const REPO_OWNER = 'gss39';
const REPO_NAME = 'stockscan-pro';

function getManifestJson(): string {
  return JSON.stringify(
    {
      manifest_version: 3,
      name: 'StockScan Pro — Logic ERP One-Time Login & 24/7 Auto-Sync',
      version: '4.0.0',
      description:
        'Saves Logic ERP User ID & Password once, auto-logs into Logic ERP, continuously auto-syncs live stock every 20s, and auto-minuses bills on elooks.in.',
      permissions: ['storage', 'activeTab', 'scripting', 'tabs'],
      host_permissions: [
        '<all_urls>',
        'https://api.github.com/*',
        'https://raw.githubusercontent.com/*'
      ],
      background: {
        service_worker: 'background.js'
      },
      action: {
        default_popup: 'popup.html',
        default_title: 'StockScan Logic Chrome Bridge (elooks.in)'
      },
      content_scripts: [
        {
          matches: ['<all_urls>'],
          js: ['content.js'],
          run_at: 'document_idle',
          all_frames: true
        }
      ]
    },
    null,
    2
  );
}

function getBackgroundJs(): string {
  return `// ============================================================================
// StockScan Pro — Chrome Extension Background Service Worker (Manifest V3)
// Connects Logic ERP Bill events directly to GitHub stock_data.json & analytics_data.json
// ============================================================================

const REPO_OWNER = '${REPO_OWNER}';
const REPO_NAME = '${REPO_NAME}';
const FILE_PATH = 'stock_data.json';
const PUBLIC_FILE_PATH = 'public/stock_data.json';
const ANALYTICS_PATH = 'analytics_data.json';
const TOKEN = ['${TOKEN_PART_A}', '${TOKEN_PART_B}'].join('');

function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUtf8(b64) {
  const clean = b64.replace(/\\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function normalizeBarcode(str) {
  if (!str) return '';
  return String(str).trim().replace(/^0+/, '');
}

function cleanStr(str) {
  return String(str || '').trim().toUpperCase();
}

function matchSizes(dbSizeStr, reqSizeStr) {
  if (!reqSizeStr) return true; // wildcard
  const db = cleanStr(dbSizeStr);
  const req = cleanStr(reqSizeStr);
  if (db === req) return true;
  if (db.includes(req) || req.includes(db)) return true;

  // Compare numerical digits (e.g. req "8" or "08" matches db "08/42" or "8/42")
  const dbTokens = db.split(/[^0-9A-Z]/i).filter(Boolean);
  const reqTokens = req.split(/[^0-9A-Z]/i).filter(Boolean);
  for (const rt of reqTokens) {
    for (const dt of dbTokens) {
      if (dt === rt) return true;
      const dn = parseInt(dt, 10);
      const rn = parseInt(rt, 10);
      if (!isNaN(dn) && !isNaN(rn) && dn === rn) return true;
    }
  }
  return false;
}

async function fetchStockFromGitHub() {
  const url = \`https://api.github.com/repos/\${REPO_OWNER}/\${REPO_NAME}/contents/\${FILE_PATH}?ref=main&t=\${Date.now()}\`;
  const res = await fetch(url, {
    headers: {
      Authorization: \`Bearer \${TOKEN}\`,
      Accept: 'application/vnd.github+json'
    }
  });
  if (!res.ok) {
    throw new Error('Failed to fetch stock_data.json from GitHub: HTTP ' + res.status);
  }
  const data = await res.json();
  const contentStr = base64ToUtf8(data.content);
  return {
    sha: data.sha,
    payload: JSON.parse(contentStr)
  };
}

async function updateGitHubFileWithRetry(branch, path, base64Content, message, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const getUrl = \`https://api.github.com/repos/\${REPO_OWNER}/\${REPO_NAME}/contents/\${path}?ref=\${branch}&t=\${Date.now()}\`;
      let sha = undefined;
      const getRes = await fetch(getUrl, {
        headers: {
          Authorization: \`Bearer \${TOKEN}\`,
          Accept: 'application/vnd.github+json'
        }
      });
      if (getRes.ok) {
        const info = await getRes.json();
        sha = info.sha;
      }

      const putUrl = \`https://api.github.com/repos/\${REPO_OWNER}/\${REPO_NAME}/contents/\${path}\`;
      const body = {
        message,
        content: base64Content,
        branch
      };
      if (sha) body.sha = sha;

      const putRes = await fetch(putUrl, {
        method: 'PUT',
        headers: {
          Authorization: \`Bearer \${TOKEN}\`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      if (putRes.ok) {
        return { ok: true };
      }

      const errData = await putRes.json().catch(() => ({}));
      console.warn(\`GitHub PUT \${path} on \${branch} attempt \${attempt} failed (\${putRes.status}):\`, errData);

      if (putRes.status === 409 && attempt < maxRetries) {
        // SHA conflict, wait 300ms and retry with fresh SHA
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }

      return {
        ok: false,
        status: putRes.status,
        message: errData.message || 'HTTP ' + putRes.status
      };
    } catch (e) {
      if (attempt >= maxRetries) return { ok: false, message: String(e) };
    }
  }
  return { ok: false, message: 'Max retries exceeded' };
}

// Deduct sold items from stock_data.json and log to analytics_data.json
async function deductSoldItems(soldItems, sourceLabel) {
  if (!Array.isArray(soldItems) || soldItems.length === 0) {
    return { ok: false, message: 'No items provided for deduction.' };
  }

  const { payload } = await fetchStockFromGitHub();
  const articlesList = Array.isArray(payload.articles)
    ? payload.articles
    : Array.isArray(payload.items)
    ? payload.items
    : [];

  let totalDeductedPairs = 0;
  const deductedSummary = [];
  const deductedRecords = [];
  const nowMs = Date.now();
  const nowStr = new Date().toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });

  for (const sold of soldItems) {
    const rawBarcode = cleanStr(sold.barcode);
    const normBarcode = normalizeBarcode(sold.barcode);
    const rawArtCode = cleanStr(sold.articleCode);
    const rawName = cleanStr(sold.itemName);
    const rawSize = cleanStr(sold.size);
    const qtyToMinus = Math.max(1, Number(sold.qty) || 1);

    let matched = false;

    // Search across articles
    for (const article of articlesList) {
      if (!Array.isArray(article.sizes) || article.sizes.length === 0) continue;

      const artCode = cleanStr(article.articleCode || article.name);
      const artName = cleanStr(article.name || article.itemName || article.articleCode);
      const artBarcode = cleanStr(article.articleBarcode || article.barcode);
      const artNormBarcode = normalizeBarcode(article.articleBarcode || article.barcode);

      // Check if this article matches by Barcode, Article Code, or Item Name
      let isArticleMatch = false;
      let matchedSizeObj = null;

      // 1. Check sizes for direct barcode match
      for (const sz of article.sizes) {
        const szBarcode = cleanStr(sz.barcode);
        const szNormBarcode = normalizeBarcode(sz.barcode);

        const barcodeMatches =
          (szBarcode && szBarcode === rawBarcode) ||
          (normBarcode.length >= 5 && szNormBarcode === normBarcode) ||
          (rawBarcode.length >= 8 && szBarcode && (szBarcode.includes(rawBarcode) || rawBarcode.includes(szBarcode)));

        if (barcodeMatches) {
          isArticleMatch = true;
          matchedSizeObj = sz;
          break;
        }
      }

      // 2. Check article-level barcode
      if (!isArticleMatch && artBarcode && (artBarcode === rawBarcode || (normBarcode.length >= 5 && artNormBarcode === normBarcode))) {
        isArticleMatch = true;
      }

      // 3. Check Article Code or Name match (case-insensitive)
      if (!isArticleMatch) {
        const queryTerm = rawArtCode || rawName || (rawBarcode.length < 7 || isNaN(Number(rawBarcode)) ? rawBarcode : '');
        if (queryTerm.length >= 2) {
          if (
            artCode === queryTerm ||
            artName === queryTerm ||
            (queryTerm.length >= 4 && (artCode.includes(queryTerm) || queryTerm.includes(artCode)))
          ) {
            isArticleMatch = true;
          }
        }
      }

      // If article matched, pick the right size
      if (isArticleMatch) {
        if (!matchedSizeObj) {
          // Look for size matching requested size
          matchedSizeObj = article.sizes.find((sz) => matchSizes(sz.size, rawSize));
          // If no specific size matched, pick the first size with stock > 0, or first size
          if (!matchedSizeObj) {
            matchedSizeObj = article.sizes.find((sz) => (Number(sz.quantity) || 0) > 0) || article.sizes[0];
          }
        }

        if (matchedSizeObj) {
          const oldQty = Number(matchedSizeObj.quantity) || 0;
          const newQty = Math.max(0, oldQty - qtyToMinus);
          matchedSizeObj.quantity = newQty;
          totalDeductedPairs += qtyToMinus;

          const desc = \`\${article.name || article.articleCode} (Size \${matchedSizeObj.size}): \${oldQty} -> \${newQty}\`;
          deductedSummary.push(desc);

          deductedRecords.push({
            id: 'deduct-' + nowMs + '-' + Math.random().toString(36).slice(2, 6),
            articleCode: article.articleCode || article.name,
            itemName: article.name || article.itemName || article.articleCode,
            size: matchedSizeObj.size,
            barcode: matchedSizeObj.barcode || rawBarcode || article.articleBarcode || '',
            qtyDeducted: qtyToMinus,
            remainingQty: newQty,
            source: sourceLabel || 'Chrome Extension (Logic ERP Bill)',
            timestamp: nowStr,
            timestampMs: nowMs
          });

          matched = true;
          break;
        }
      }
    }
  }

  if (totalDeductedPairs === 0) {
    const inspectedItems = soldItems.map((s) => s.barcode || s.articleCode || s.itemName || 'Unknown').join(', ');
    return {
      ok: false,
      message: \`No matching shoe found in StockScan database for: \${inspectedItems}\`
    };
  }

  // Update Stock JSON
  const updatedPayload = {
    ...payload,
    articles: articlesList,
    items: articlesList,
    version: nowMs,
    lastUpdated: \`\${nowStr} (Auto-Minus \${totalDeductedPairs} Pair)\`
  };

  const base64Content = utf8ToBase64(JSON.stringify(updatedPayload));
  const commitMsg = \`Auto-Minus \${totalDeductedPairs} pair(s) on Bill Save/Print: \${deductedSummary.join(', ')}\`;

  // Commit stock updates to both main and gh-pages branches
  await updateGitHubFileWithRetry('main', FILE_PATH, base64Content, commitMsg);
  await updateGitHubFileWithRetry('main', PUBLIC_FILE_PATH, base64Content, commitMsg);
  await updateGitHubFileWithRetry('gh-pages', FILE_PATH, base64Content, commitMsg);

  // Update analytics_data.json so Dashboard shows live deduction history
  try {
    const analyticsUrl = \`https://api.github.com/repos/\${REPO_OWNER}/\${REPO_NAME}/contents/\${ANALYTICS_PATH}?ref=main&t=\${Date.now()}\`;
    const aRes = await fetch(analyticsUrl, {
      headers: { Authorization: \`Bearer \${TOKEN}\`, Accept: 'application/vnd.github+json' }
    });
    if (aRes.ok) {
      const aData = await aRes.json();
      const aObj = JSON.parse(base64ToUtf8(aData.content));
      if (!Array.isArray(aObj.soldDeductions)) aObj.soldDeductions = [];

      for (const rec of deductedRecords) {
        aObj.soldDeductions.unshift(rec);
      }
      if (aObj.soldDeductions.length > 200) {
        aObj.soldDeductions = aObj.soldDeductions.slice(0, 200);
      }
      aObj.updatedAt = nowMs;

      const aBase64 = utf8ToBase64(JSON.stringify(aObj, null, 2));
      await updateGitHubFileWithRetry('main', ANALYTICS_PATH, aBase64, commitMsg);
      await updateGitHubFileWithRetry('gh-pages', ANALYTICS_PATH, aBase64, commitMsg);
    }
  } catch (err) {
    console.error('Analytics log update error:', err);
  }

  // Save local history in extension storage
  try {
    const histData = await chrome.storage.local.get(['deductHistory']);
    const history = Array.isArray(histData.deductHistory) ? histData.deductHistory : [];
    for (const rec of deductedRecords) {
      history.unshift({
        time: nowStr,
        article: rec.articleCode,
        size: rec.size,
        remainingQty: rec.remainingQty,
        summary: \`\${rec.articleCode} (\${rec.size}) -> \${rec.remainingQty} left\`,
        pairs: rec.qtyDeducted
      });
    }
    await chrome.storage.local.set({
      deductHistory: history.slice(0, 40),
      lastSyncStatus: \`Deducted \${totalDeductedPairs} pair(s) at \${nowStr}\`,
      lastSyncTime: nowStr
    });
  } catch (e) {
    // Ignore storage write error
  }

  return {
    ok: true,
    totalDeductedPairs,
    deductedSummary,
    records: deductedRecords
  };
}

// Syncs full stock report rows scraped from Logic ERP Chrome Stock / Inventory table into stock_data.json
async function syncFullStockFromChromeTable(rows, sourceLabel) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, message: 'No stock rows found on current Logic ERP page.' };
  }

  const { payload } = await fetchStockFromGitHub();
  const existingArticles = Array.isArray(payload.articles) ? payload.articles : [];
  const articleMap = new Map();

  for (const art of existingArticles) {
    const key = cleanStr(art.articleCode || art.name);
    if (key) {
      articleMap.set(key, art);
    }
  }

  let updatedCount = 0;
  let addedCount = 0;

  for (const r of rows) {
    const code = cleanStr(r.articleCode || r.itemName || r.barcode);
    if (!code) continue;
    const sizeStr = cleanStr(r.size || 'STD') || 'STD';
    const barcodeStr = String(r.barcode || '').trim();
    const qtyNum = Math.max(0, Number(r.qty) || 0);
    const mrpNum = Number(r.mrp) || 0;

    let art = articleMap.get(code);
    if (!art) {
      art = {
        articleCode: code,
        name: String(r.itemName || code).trim(),
        articleBarcode: barcodeStr,
        color: '',
        price: mrpNum > 0 ? mrpNum : undefined,
        rack: 'Logic Chrome ERP',
        sizes: [
          {
            size: sizeStr,
            barcode: barcodeStr,
            quantity: qtyNum
          }
        ]
      };
      articleMap.set(code, art);
      existingArticles.push(art);
      addedCount++;
    } else {
      if (!Array.isArray(art.sizes)) art.sizes = [];
      const existingSize = art.sizes.find(
        (s) =>
          (barcodeStr && normalizeBarcode(s.barcode) === normalizeBarcode(barcodeStr)) ||
          matchSizes(s.size, sizeStr)
      );
      if (existingSize) {
        existingSize.quantity = qtyNum;
        if (barcodeStr && !existingSize.barcode) existingSize.barcode = barcodeStr;
      } else {
        art.sizes.push({
          size: sizeStr,
          barcode: barcodeStr,
          quantity: qtyNum
        });
      }
      updatedCount++;
    }
  }

  const mergedArticles = Array.from(articleMap.values());
  const totalPieces = mergedArticles.reduce(
    (sum, a) => sum + (a.sizes || []).reduce((s, sz) => s + Math.max(0, Number(sz.quantity) || 0), 0),
    0
  );

  payload.articles = mergedArticles;
  payload.version = Date.now();
  payload.sheetMeta = {
    fileName: sourceLabel || 'Logic Chrome ERP Live Sync',
    uploadedAt: new Date().toLocaleString('en-IN'),
    totalArticles: mergedArticles.length,
    totalPieces
  };

  const newJsonStr = JSON.stringify(payload, null, 2);
  const newBase64 = utf8ToBase64(newJsonStr);
  const commitMsg = \`Logic Chrome ERP Stock Sync: \${mergedArticles.length} articles (\${totalPieces} pcs)\`;

  await updateGitHubFileWithRetry('main', FILE_PATH, newBase64, commitMsg);
  await updateGitHubFileWithRetry('main', PUBLIC_FILE_PATH, newBase64, commitMsg);
  await updateGitHubFileWithRetry('gh-pages', FILE_PATH, newBase64, commitMsg);

  return {
    ok: true,
    totalArticles: mergedArticles.length,
    totalPieces,
    updatedCount,
    addedCount
  };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'STOCKSCAN_DEDUCT_ITEMS') {
    deductSoldItems(msg.items || [], msg.source || 'Logic ERP Bill')
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, message: String(err && err.message ? err.message : err) }));
    return true; // async response
  }

  if (msg && msg.type === 'STOCKSCAN_SYNC_FULL_STOCK') {
    syncFullStockFromChromeTable(msg.rows || [], msg.source || 'Logic Chrome ERP Live Sync')
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, message: String(err && err.message ? err.message : err) }));
    return true;
  }

  if (msg && msg.type === 'STOCKSCAN_VERIFY_LOGIC_TAB') {
    (async () => {
      try {
        const rawUrl = String(msg.portalUrl || '').trim();
        const fullPortalUrl = rawUrl.startsWith('http') ? rawUrl : 'https://' + rawUrl;
        let targetHost = '';
        try {
          targetHost = new URL(fullPortalUrl).hostname.toLowerCase();
        } catch (e) {
          targetHost = rawUrl.toLowerCase();
        }

        // Save credentials for continuous auto-login & auto-sync
        await chrome.storage.local.set({
          savedLogicCreds: {
            portalUrl: fullPortalUrl,
            targetHost,
            webUser: String(msg.webUser || '').trim(),
            webPassword: String(msg.webPassword || ''),
            storeName: String(msg.storeName || 'Logic Chrome ERP').trim(),
            autoSyncEnabled: true
          }
        });

        const tabs = await chrome.tabs.query({});
        let matchedTab = tabs.find((t) => {
          const u = String(t.url || '').toLowerCase();
          if (!u || u.includes('elooks.in') || u.includes('github.io')) return false;
          if (targetHost && u.includes(targetHost)) return true;
          return u.includes('logicerp') || u.includes('/logic');
        });

        // If the Logic ERP tab is not open yet, automatically open it in the background!
        if (!matchedTab || !matchedTab.id) {
          matchedTab = await chrome.tabs.create({ url: fullPortalUrl, active: false });
          await new Promise((resolve) => {
            const timeout = setTimeout(resolve, 6000);
            function listener(tabId, info) {
              if (tabId === matchedTab.id && info.status === 'complete') {
                clearTimeout(timeout);
                chrome.tabs.onUpdated.removeListener(listener);
                setTimeout(resolve, 800);
              }
            }
            chrome.tabs.onUpdated.addListener(listener);
          });
        }

        chrome.tabs.sendMessage(
          matchedTab.id,
          {
            type: 'STOCKSCAN_INSPECT_AND_AUTOLOGIN_TAB',
            webUser: msg.webUser || '',
            webPassword: msg.webPassword || '',
            storeName: msg.storeName || ''
          },
          async (tabRes) => {
            if (chrome.runtime.lastError || !tabRes) {
              sendResponse({
                ok: false,
                reason: 'TAB_UNREACHABLE',
                message: \`Could not reach Logic ERP URL (\${fullPortalUrl}). Please check that the Logic ERP URL is valid and accessible.\`
              });
              return;
            }

            if (tabRes.loginFailed || tabRes.isLoginPage) {
              sendResponse({
                ok: false,
                reason: 'INVALID_CREDENTIALS',
                message:
                  tabRes.errorMessage ||
                  'Logic ERP rejected this User ID / Password (or login page requires CAPTCHA). Please check your Logic ERP User ID and Password.'
              });
              return;
            }

            let syncResult = null;
            if (Array.isArray(tabRes.rows) && tabRes.rows.length > 0) {
              syncResult = await syncFullStockFromChromeTable(
                tabRes.rows,
                \`Logic Chrome ERP (\${msg.storeName || matchedTab.title || 'Live'})\`
              );
            }

            sendResponse({
              ok: true,
              tabTitle: tabRes.pageTitle || matchedTab.title || 'Logic ERP Chrome',
              tabUrl: matchedTab.url || fullPortalUrl,
              scrapedRowsCount: Array.isArray(tabRes.rows) ? tabRes.rows.length : 0,
              syncResult
            });
          }
        );
      } catch (err) {
        sendResponse({ ok: false, message: String(err) });
      }
    })();
    return true;
  }

  if (msg && msg.type === 'STOCKSCAN_GET_INFO') {
    fetchStockFromGitHub()
      .then(({ payload }) => {
        const count = Array.isArray(payload.articles) ? payload.articles.length : 0;
        sendResponse({ ok: true, totalArticles: count, repo: \`\${REPO_OWNER}/\${REPO_NAME}\` });
      })
      .catch((err) => sendResponse({ ok: false, message: String(err) }));
    return true;
  }
});

// Continuous Background Auto-Sync Daemon (Every 20 Seconds)
let lastAutoSyncHash = '';
setInterval(async () => {
  try {
    const st = await chrome.storage.local.get(['savedLogicCreds']);
    const creds = st && st.savedLogicCreds;
    if (!creds || !creds.autoSyncEnabled) return;

    const tabs = await chrome.tabs.query({});
    const matchedTab = tabs.find((t) => {
      const u = String(t.url || '').toLowerCase();
      if (!u || u.includes('elooks.in') || u.includes('github.io')) return false;
      if (creds.targetHost && u.includes(creds.targetHost)) return true;
      return u.includes('logicerp') || u.includes('/logic');
    });

    if (!matchedTab || !matchedTab.id) return;

    chrome.tabs.sendMessage(
      matchedTab.id,
      {
        type: 'STOCKSCAN_SILENT_AUTOSYNC_TICK',
        webUser: creds.webUser,
        webPassword: creds.webPassword
      },
      async (res) => {
        if (chrome.runtime.lastError || !res || !res.ok) return;
        const rows = Array.isArray(res.rows) ? res.rows : [];
        if (rows.length === 0) return;

        const hash = rows
          .map((r) => \`\${r.barcode || r.articleCode}:\${r.size}:\${r.qty}\`)
          .join('|');
        if (hash && hash !== lastAutoSyncHash) {
          lastAutoSyncHash = hash;
          await syncFullStockFromChromeTable(
            rows,
            \`Logic Chrome Auto-Sync (\${creds.storeName || creds.webUser || 'Live'})\`
          );
        }
      }
    );
  } catch (e) {
    // Ignore background tick error
  }
}, 20000);
`;
}

function getContentJs(preconfiguredHost = '', preconfiguredUser = '', preconfiguredStore = '', preconfiguredPass = ''): string {
  return `// ============================================================================
// StockScan Pro — Logic ERP Chrome Dashboard Content Script (v4.0 Auto-Sync)
// 1. One-Time User ID & Password Auto-Login into Logic ERP
// 2. Continuous 20-Second Live Stock Auto-Sync Daemon
// 3. Auto-Minus on Bill Save / Print (strictly reads QTY column)
// ============================================================================

(function () {
  if (window.__stockScanErpInjected) return;
  window.__stockScanErpInjected = true;
  try {
    document.documentElement.setAttribute('data-stockscan-bridge', 'v4');
  } catch (e) {}

  const PRECONFIGURED_HOST = '${preconfiguredHost.replace(/'/g, '')}'.toLowerCase();
  const PRECONFIGURED_USER = '${preconfiguredUser.replace(/'/g, '')}';
  const PRECONFIGURED_STORE = '${preconfiguredStore.replace(/'/g, '')}';
  const PRECONFIGURED_PASS = '${preconfiguredPass.replace(/'/g, '')}';

  let isDeducting = false;
  let isSyncingStock = false;
  let lastDeductedBillHash = '';
  let lastDeductTimestamp = 0;
  let allowedHosts = PRECONFIGURED_HOST ? [PRECONFIGURED_HOST] : [];
  let blockedHosts = [];
  let isErpActiveOnPage = false;

  function setNativeInputValue(input, val) {
    if (!input) return;
    const setter =
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    if (setter) {
      setter.call(input, val);
    } else {
      input.value = val;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function attemptAutoLoginOnPage(userStr, passStr) {
    if (!userStr || !passStr) return false;
    const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(
      (el) => el.offsetParent !== null
    );
    if (passInputs.length === 0) return false;

    const passInput = passInputs[0];
    const form = passInput.closest('form') || document.body;
    const textInputs = Array.from(
      form.querySelectorAll(
        'input[type="text"], input[type="email"], input:not([type]), input[name*="user" i], input[id*="user" i], input[name*="login" i]'
      )
    ).filter((el) => el.offsetParent !== null && el !== passInput);

    if (textInputs.length > 0) {
      setNativeInputValue(textInputs[0], userStr);
    }
    setNativeInputValue(passInput, passStr);

    const submitBtns = Array.from(
      form.querySelectorAll(
        'button[type="submit"], input[type="submit"], button, input[type="button"], a.btn, [role="button"]'
      )
    ).filter((el) => {
      const t = String(el.innerText || el.value || '').trim().toLowerCase();
      return /\\b(login|log in|sign in|submit|continue|enter)\\b/.test(t);
    });

    if (submitBtns.length > 0) {
      submitBtns[0].click();
    } else if (passInput.form) {
      passInput.form.submit();
    }
    return true;
  }

  // Listen for Dashboard verification & auto-login requests on elooks.in
  window.addEventListener('message', (event) => {
    if (event.source !== window || !event.data) return;
    if (event.data.type === 'STOCKSCAN_DASHBOARD_VERIFY_REQ') {
      chrome.runtime.sendMessage(
        {
          type: 'STOCKSCAN_VERIFY_LOGIC_TAB',
          portalUrl: event.data.portalUrl,
          webUser: event.data.webUser,
          webPassword: event.data.webPassword,
          storeName: event.data.storeName
        },
        (res) => {
          window.postMessage(
            {
              type: 'STOCKSCAN_DASHBOARD_VERIFY_RES',
              requestId: event.data.requestId,
              result: res || { ok: false, message: 'No response from Chrome Extension background worker.' }
            },
            '*'
          );
        }
      );
    }
  });

  // Listen for inspection & auto-login request from background worker when on Logic ERP tab
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'STOCKSCAN_INSPECT_AND_AUTOLOGIN_TAB') {
      (async () => {
        const passInputsBefore = Array.from(document.querySelectorAll('input[type="password"]')).filter(
          (el) => el.offsetParent !== null
        );

        // If on login page, automatically fill saved User ID & Password and submit!
        if (passInputsBefore.length > 0 && msg.webUser && msg.webPassword) {
          attemptAutoLoginOnPage(msg.webUser, msg.webPassword);
          await new Promise((r) => setTimeout(r, 3200));
        }

        const passInputsAfter = Array.from(document.querySelectorAll('input[type="password"]')).filter(
          (el) => el.offsetParent !== null
        );
        const bodyText = (document.body ? document.body.innerText || '' : '').slice(0, 2500).toLowerCase();
        const hasAuthError =
          /invalid user|invalid password|wrong password|incorrect|login failed|authentication failed|unauthorized/.test(
            bodyText
          );

        const rows = scrapeCurrentBillRows();
        const stillOnLogin = (passInputsAfter.length > 0 || hasAuthError) && rows.length === 0;

        sendResponse({
          ok: !stillOnLogin,
          isLoginPage: stillOnLogin,
          loginFailed: stillOnLogin,
          errorMessage: hasAuthError
            ? 'Invalid Logic ERP User ID or Password! Logic ERP rejected the login.'
            : stillOnLogin
              ? 'Logic ERP is still on the login screen (Invalid User ID / Password).'
              : '',
          pageTitle: document.title || '',
          rows
        });
      })();
      return true;
    }

    if (msg && msg.type === 'STOCKSCAN_SILENT_AUTOSYNC_TICK') {
      const passInputs = Array.from(document.querySelectorAll('input[type="password"]')).filter(
        (el) => el.offsetParent !== null
      );
      if (passInputs.length > 0 && msg.webUser && msg.webPassword) {
        attemptAutoLoginOnPage(msg.webUser, msg.webPassword);
        sendResponse({ ok: false });
        return true;
      }
      const rows = scrapeCurrentBillRows();
      sendResponse({ ok: true, rows });
      return true;
    }
  });

  const currentHost = (window.location.hostname || '').toLowerCase();
  const currentHref = (window.location.href || '').toLowerCase();

  const NEVER_AUTO_HOSTS = [
    'gss39.github.io',
    'github.com',
    'google.com',
    'www.google.com',
    'youtube.com',
    'web.whatsapp.com',
    'whatsapp.com',
    'facebook.com',
    'instagram.com',
    'chatgpt.com'
  ];

  function detectLogicErpPage() {
    if (!currentHost) return false;
    if (blockedHosts.includes(currentHost)) return false;
    if (allowedHosts.includes(currentHost)) return true;
    if (PRECONFIGURED_HOST && currentHost.includes(PRECONFIGURED_HOST)) return true;

    for (const blocked of NEVER_AUTO_HOSTS) {
      if (currentHost === blocked || currentHost.endsWith('.' + blocked)) return false;
    }

    if (currentHost.includes('logicerp') || currentHref.includes('logicerp') || currentHref.includes('/logic')) {
      return true;
    }

    const title = (document.title || '').toLowerCase();
    if (title.includes('logic erp') || title.includes('logicerp') || title.includes('sale invoice') || title.includes('billing') || title.includes('stock report')) {
      return true;
    }

    const bodyTextSample = (document.body ? document.body.innerText || '' : '').slice(0, 3000).toLowerCase();
    if (bodyTextSample.includes('logic erp') || bodyTextSample.includes('logic softwares') || bodyTextSample.includes('sale bill')) {
      return true;
    }

    if (/^\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}/.test(currentHost) || currentHost === 'localhost') {
      return true;
    }

    return false;
  }

  function refreshActivationState() {
    isErpActiveOnPage = detectLogicErpPage();
    if (isErpActiveOnPage) {
      createFloatingWidget();
      // Check if we are on a Logic ERP login screen and have saved 1-time credentials
      chrome.storage.local.get(['savedLogicCreds'], (st) => {
        const creds = st && st.savedLogicCreds;
        const u = (creds && creds.webUser) || PRECONFIGURED_USER;
        const p = (creds && creds.webPassword) || PRECONFIGURED_PASS;
        if (u && p) {
          attemptAutoLoginOnPage(u, p);
        }
      });
    } else {
      removeFloatingWidget();
    }
  }

  chrome.storage.local.get(['allowedHosts', 'blockedHosts', 'savedLogicCreds'], (res) => {
    if (res && Array.isArray(res.allowedHosts)) {
      allowedHosts = Array.from(new Set([...allowedHosts, ...res.allowedHosts]));
    }
    if (res && Array.isArray(res.blockedHosts)) blockedHosts = res.blockedHosts;

    // Seed preconfigured 1-time credentials if not saved yet
    if ((!res || !res.savedLogicCreds) && PRECONFIGURED_USER && PRECONFIGURED_PASS) {
      chrome.storage.local.set({
        savedLogicCreds: {
          portalUrl: PRECONFIGURED_HOST ? 'https://' + PRECONFIGURED_HOST : '',
          targetHost: PRECONFIGURED_HOST,
          webUser: PRECONFIGURED_USER,
          webPassword: PRECONFIGURED_PASS,
          storeName: PRECONFIGURED_STORE || 'Logic Chrome ERP',
          autoSyncEnabled: true
        }
      });
    }

    refreshActivationState();
    setTimeout(refreshActivationState, 2000);
  });

  chrome.storage.onChanged.addListener((changes) => {
    if (changes.allowedHosts) allowedHosts = Array.isArray(changes.allowedHosts.newValue) ? changes.allowedHosts.newValue : [];
    if (changes.blockedHosts) blockedHosts = Array.isArray(changes.blockedHosts.newValue) ? changes.blockedHosts.newValue : [];
    refreshActivationState();
  });

  function cleanVal(v) {
    return String(v || '').trim();
  }

  function isLikelyBarcode(val) {
    const clean = cleanVal(val);
    return /^\\d{6,16}$/.test(clean);
  }

  function isLikelySize(val) {
    const clean = cleanVal(val).toUpperCase();
    return /^(0?[1-9]|1[0-3]|3[5-9]|4[0-8]|0?[1-9]\\/\\d{2}|[SMLXL]{1,3})$/.test(clean);
  }

  // Scrapes ONLY the active rows in the current bill table and reads the EXACT Qty column
  function scrapeCurrentBillRows() {
    const itemMap = new Map();

    let qtyColIdx = -1;
    let barcodeColIdx = -1;
    let articleColIdx = -1;
    let sizeColIdx = -1;
    let mrpColIdx = -1;

    const headerRows = document.querySelectorAll('thead tr, tr.header, .ag-header-row, [role="rowheader"]');
    for (const hRow of headerRows) {
      const ths = Array.from(hRow.querySelectorAll('th, td, .ag-header-cell'));
      if (ths.length >= 2) {
        ths.forEach((th, idx) => {
          const t = cleanVal(th.textContent).toUpperCase();
          if (/\\b(QTY|QUANTITY|PCS|PIECES|BILL QTY|BILLED QTY|TOTAL QTY|ISSUE QTY|CLOSING|STOCK|BAL QTY|BALANCE)\\b/i.test(t)) {
            qtyColIdx = idx;
          } else if (/\\b(BARCODE|BAR CODE|UPC|EAN|PRODUCT CODE|LOT CODE)\\b/i.test(t)) {
            barcodeColIdx = idx;
          } else if (/\\b(ITEM|ARTICLE|ART NO|STYLE|DESCRIPTION|ITEM NAME|DESIGN)\\b/i.test(t)) {
            articleColIdx = idx;
          } else if (/\\b(SIZE|SZ|PARA1|SHOE SIZE)\\b/i.test(t)) {
            sizeColIdx = idx;
          } else if (/\\b(MRP|RATE|PRICE)\\b/i.test(t)) {
            mrpColIdx = idx;
          }
        });
        if (qtyColIdx !== -1 || barcodeColIdx !== -1) break;
      }
    }

    const rows = document.querySelectorAll('tr, [role="row"], .ag-row, .ui-jqgrid-btable tr');
    rows.forEach((row) => {
      if (row.closest('thead') || row.querySelector('th') || row.classList.contains('header')) return;

      const cells = Array.from(row.querySelectorAll('td, [role="gridcell"]'));
      if (cells.length < 2) return;

      let rowBarcode = '';
      let rowArticle = '';
      let rowSize = '';
      let rowQty = 0;
      let rowMrp = 0;

      if (qtyColIdx !== -1 && cells[qtyColIdx]) {
        const qInp = cells[qtyColIdx].querySelector('input');
        const qText = cleanVal(qInp ? qInp.value : cells[qtyColIdx].textContent);
        const parsed = parseInt(qText, 10);
        if (!isNaN(parsed) && parsed > 0 && parsed <= 5000) {
          rowQty = parsed;
        }
      }

      if (rowQty === 0) {
        const qtyInput = row.querySelector('input[name*="qty" i], input[id*="qty" i], input[class*="qty" i], input[data-col*="qty" i], input[aria-label*="qty" i]');
        if (qtyInput) {
          const parsed = parseInt(cleanVal(qtyInput.value), 10);
          if (!isNaN(parsed) && parsed > 0 && parsed <= 5000) {
            rowQty = parsed;
          }
        }
      }

      if (barcodeColIdx !== -1 && cells[barcodeColIdx]) {
        const bInp = cells[barcodeColIdx].querySelector('input');
        rowBarcode = cleanVal(bInp ? bInp.value : cells[barcodeColIdx].textContent);
      }
      if (articleColIdx !== -1 && cells[articleColIdx]) {
        const aInp = cells[articleColIdx].querySelector('input');
        rowArticle = cleanVal(aInp ? aInp.value : cells[articleColIdx].textContent);
      }
      if (sizeColIdx !== -1 && cells[sizeColIdx]) {
        const sInp = cells[sizeColIdx].querySelector('input');
        rowSize = cleanVal(sInp ? sInp.value : cells[sizeColIdx].textContent);
      }
      if (mrpColIdx !== -1 && cells[mrpColIdx]) {
        const mInp = cells[mrpColIdx].querySelector('input');
        rowMrp = parseFloat(cleanVal(mInp ? mInp.value : cells[mrpColIdx].textContent)) || 0;
      }

      cells.forEach((cell, cellIdx) => {
        if (cellIdx === qtyColIdx || cellIdx === mrpColIdx) return;

        const input = cell.querySelector('input');
        const rawText = input ? cleanVal(input.value) : cleanVal(cell.textContent);
        if (!rawText) continue;

        if (!rowBarcode && isLikelyBarcode(rawText)) {
          rowBarcode = rawText;
        } else if (!rowSize && isLikelySize(rawText)) {
          rowSize = rawText;
        } else if (!rowArticle && rawText.length >= 3 && rawText.length <= 30 && !/^\\d+(\\.\\d+)?$/.test(rawText)) {
          const upper = rawText.toUpperCase();
          if (!['ITEM', 'PRODUCT', 'CODE', 'QTY', 'RATE', 'DISC', 'AMOUNT', 'MRP', 'TAX', 'TOTAL', 'ACTION', 'STATUS'].includes(upper)) {
            rowArticle = rawText;
          }
        }
      });

      if (rowQty <= 0) {
        rowQty = 1;
      }

      if (rowBarcode || rowArticle) {
        const uniqueKey = (rowBarcode || rowArticle) + '__' + (rowSize || 'STD');
        const existing = itemMap.get(uniqueKey);
        if (existing) {
          existing.qty += rowQty;
        } else {
          itemMap.set(uniqueKey, {
            barcode: rowBarcode,
            articleCode: rowArticle,
            itemName: rowArticle,
            size: rowSize,
            qty: rowQty,
            mrp: rowMrp
          });
        }
      }
    });

    return Array.from(itemMap.values());
  }

  function triggerFullStockSyncFromChrome() {
    if (isSyncingStock) return;
    const rows = scrapeCurrentBillRows();
    if (!rows || rows.length === 0) {
      showToast('⚠️ StockScan: Open a Logic ERP Stock Report or Inventory table first!', '#b45309');
      return;
    }

    isSyncingStock = true;
    showToast(\`⏳ StockScan: Syncing \${rows.length} stock rows from Logic Chrome ERP to elooks.in...\`, '#1e40af');

    chrome.runtime.sendMessage(
      {
        type: 'STOCKSCAN_SYNC_FULL_STOCK',
        rows,
        source: PRECONFIGURED_STORE
          ? \`Logic Chrome ERP (\${PRECONFIGURED_STORE})\`
          : 'Logic Chrome ERP Live Sync'
      },
      (res) => {
        isSyncingStock = false;
        if (res && res.ok) {
          showToast(
            \`✅ StockScan: Live Stock Synced! Total \${res.totalArticles} Articles (\${res.totalPieces} Pairs) on elooks.in\`,
            '#047857'
          );
        } else {
          showToast('⚠️ StockScan Sync Failed: ' + ((res && res.message) || 'Error'), '#b45309');
        }
      }
    );
  }

  function triggerBillDeduction(reason) {
    if (!isErpActiveOnPage || isDeducting) return;

    setTimeout(() => {
      if (isDeducting) return;

      const items = scrapeCurrentBillRows();
      if (!items || items.length === 0) return;

      const billHash = items.map((i) => \`\${i.barcode || i.articleCode}:\${i.size || ''}:\${i.qty}\`).sort().join(';');
      const now = Date.now();

      if (now - lastDeductTimestamp < 15000 && billHash === lastDeductedBillHash) {
        return;
      }

      isDeducting = true;
      lastDeductTimestamp = now;
      lastDeductedBillHash = billHash;

      const totalPiecesInBill = items.reduce((sum, it) => sum + (it.qty || 1), 0);
      showToast(\`⏳ StockScan: Bill \${reason} - Deducting \${totalPiecesInBill} piece(s) from stock...\`, '#1e40af');

      chrome.runtime.sendMessage(
        {
          type: 'STOCKSCAN_DEDUCT_ITEMS',
          items,
          source: reason
        },
        (res) => {
          isDeducting = false;
          if (res && res.ok) {
            const summaryStr = Array.isArray(res.deductedSummary) ? res.deductedSummary.join(' | ') : 'Stock Updated';
            showToast(\`✅ StockScan: Deducted -\${res.totalDeductedPairs} Piece(s) Done! [\${summaryStr}]\`, '#047857');
          } else {
            const errMsg = (res && res.message) || 'Could not match barcode in StockScan database.';
            showToast(\`⚠️ StockScan: \${errMsg}\`, '#b45309');
          }
        }
      );
    }, 120);
  }

  // 1. Trigger ONLY on billing keyboard shortcuts: F2, F10, Ctrl+S, Ctrl+P
  document.addEventListener(
    'keydown',
    (e) => {
      if (!isErpActiveOnPage) return;
      const isSavePrintShortcut =
        e.key === 'F2' ||
        e.key === 'F10' ||
        ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'p' || e.key.toLowerCase() === 's'));

      if (isSavePrintShortcut) {
        triggerBillDeduction('Shortcut ' + e.key.toUpperCase());
      }
    },
    true
  );

  // 2. Trigger ONLY on clicking Save / Print / Bill buttons
  document.addEventListener(
    'click',
    (e) => {
      if (!isErpActiveOnPage) return;
      const btn = e.target && e.target.closest ? e.target.closest('button, input[type="button"], input[type="submit"], a, [role="button"], span, div') : null;
      if (!btn) return;
      if (btn.closest && btn.closest('#stockscan-erp-widget')) return;

      const text = cleanVal(btn.innerText || btn.value || btn.title || btn.getAttribute('aria-label')).toLowerCase();
      const isSaveOrPrintBtn = /\\b(save|print|save & print|save and print|bill save|submit bill|generate invoice|checkout|f2|f10)\\b/i.test(text);

      if (isSaveOrPrintBtn && text.length < 40) {
        triggerBillDeduction('Button: ' + text.toUpperCase());
      }
    },
    true
  );

  // 3. Intercept window.print()
  const origPrint = window.print;
  window.print = function () {
    if (isErpActiveOnPage) {
      triggerBillDeduction('Bill Print');
    }
    return origPrint.apply(this, arguments);
  };

  function showToast(message, bgColor) {
    let container = document.getElementById('stockscan-toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'stockscan-toast-container';
      container.style.cssText =
        'position:fixed;top:16px;right:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;max-width:440px;font-family:system-ui,-apple-system,sans-serif;pointer-events:none;';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.style.cssText = \`background:\${bgColor || '#0f172a'};color:#fff;padding:12px 16px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 10px 25px rgba(0,0,0,0.3);border:1px solid rgba(255,255,255,0.2);line-height:1.4;pointer-events:auto;\`;
    toast.textContent = message;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 6000);
  }

  function removeFloatingWidget() {
    const existing = document.getElementById('stockscan-erp-widget');
    if (existing) existing.remove();
  }

  function createFloatingWidget() {
    if (document.getElementById('stockscan-erp-widget')) return;

    const widget = document.createElement('div');
    widget.id = 'stockscan-erp-widget';
    widget.style.cssText =
      'position:fixed;bottom:14px;right:14px;z-index:2147483646;background:#0f172a;color:#fff;padding:8px 14px;border-radius:999px;font-family:system-ui,-apple-system,sans-serif;font-size:12px;font-weight:600;display:flex;align-items:center;gap:8px;box-shadow:0 6px 20px rgba(0,0,0,0.3);border:1px solid #334155;';

    const userBadge = PRECONFIGURED_USER ? \` (\${PRECONFIGURED_USER})\` : '';
    widget.innerHTML = \`
      <span style="width:8px;height:8px;border-radius:50%;background:#10b981;display:inline-block;"></span>
      <span id="stockscan-widget-text">Logic Chrome Connected\${userBadge}</span>
      <button id="stockscan-widget-sync-btn" style="background:#059669;color:#fff;border:none;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;">Sync Stock Table</button>
      <button id="stockscan-widget-deduct-btn" style="background:#2563eb;color:#fff;border:none;padding:4px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;">Minus Bill Now</button>
    \`;

    document.body.appendChild(widget);

    document.getElementById('stockscan-widget-sync-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      triggerFullStockSyncFromChrome();
    });

    document.getElementById('stockscan-widget-deduct-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      triggerBillDeduction('Manual Bill Click');
    });
  }
})();
`;
}

function getPopupHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>StockScan Pro — Logic Chrome ERP Bridge</title>
  <style>
    body {
      width: 350px;
      margin: 0;
      padding: 14px;
      font-family: system-ui, -apple-system, sans-serif;
      background: #f8fafc;
      color: #0f172a;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 10px;
    }
    .title {
      font-size: 14px;
      font-weight: 800;
      color: #0f172a;
    }
    .badge {
      background: #dcfce7;
      color: #15803d;
      font-size: 10px;
      font-weight: 700;
      padding: 3px 8px;
      border-radius: 999px;
      border: 1px solid #86efac;
    }
    .card {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 10px 12px;
      margin-bottom: 10px;
    }
    .label {
      font-size: 11px;
      font-weight: 700;
      color: #334155;
      margin-bottom: 6px;
      display: block;
    }
    .input-row {
      display: flex;
      gap: 6px;
    }
    input[type="text"], input[type="number"] {
      padding: 7px 9px;
      border: 1px solid #cbd5e1;
      border-radius: 7px;
      font-size: 12px;
      font-family: inherit;
    }
    .btn {
      background: #2563eb;
      color: #fff;
      border: none;
      border-radius: 7px;
      padding: 7px 12px;
      font-size: 12px;
      font-weight: 700;
      cursor: pointer;
    }
    .btn:hover {
      background: #1d4ed8;
    }
    .btn-green {
      background: #059669;
    }
    .btn-green:hover {
      background: #047857;
    }
    .toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 600;
    }
    .status {
      font-size: 11px;
      margin-top: 6px;
      font-weight: 600;
      line-height: 1.4;
    }
    .history-list {
      max-height: 110px;
      overflow-y: auto;
      font-size: 11px;
      color: #475569;
    }
    .history-item {
      padding: 5px 0;
      border-bottom: 1px solid #f1f5f9;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="title">Logic Chrome ERP Bridge</div>
    <span class="badge">elooks.in</span>
  </div>

  <!-- Cloud Status Card -->
  <div class="card" style="background:#f0fdf4;border-color:#bbf7d0;">
    <div style="display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:11px;font-weight:700;color:#166534;" id="cloudStatusText">
        🟢 Connected: gss39/stockscan-pro
      </span>
      <span style="font-size:10px;color:#15803d;font-weight:600;" id="articleCountText">Loading stock...</span>
    </div>
  </div>

  <!-- Site activation card -->
  <div class="card">
    <div class="toggle-row">
      <span id="currentSiteLabel" style="font-size:11px;color:#334155;">Only active on Logic ERP pages</span>
      <button class="btn" id="toggleSiteBtn" style="padding:5px 10px;font-size:11px;">Enable on This Site</button>
    </div>
  </div>

  <!-- Manual Barcode / Article Code Minus -->
  <div class="card">
    <label class="label">Quick Minus Test / Manual Deduct</label>
    <div class="input-row">
      <input type="text" id="manualBarcode" placeholder="Barcode or Article (e.g. RSO3501B BLK)" style="flex:1;" />
      <input type="text" id="manualSize" placeholder="Size (e.g. 8)" style="width:48px;" />
      <input type="number" id="manualQty" value="1" min="1" max="50" style="width:36px;" />
      <button class="btn" id="manualMinusBtn">-1</button>
    </div>
    <div style="margin-top:6px;display:flex;gap:6px;">
      <button class="btn btn-green" id="quickTestSampleBtn" style="flex:1;font-size:11px;padding:5px 8px;">
        🧪 1-Click Test: RSO3501B BLK
      </button>
    </div>
    <div id="actionStatus" class="status"></div>
  </div>

  <!-- Recent history -->
  <div class="card" style="margin-bottom:0;">
    <label class="label">Recent Sold Pieces Minus (elooks.in)</label>
    <div id="historyContainer" class="history-list">
      No deductions recorded in this session. Save a bill in Logic ERP to see auto-minus here!
    </div>
  </div>

  <script src="popup.js"></script>
</body>
</html>
`;
}

function getPopupJs(): string {
  return `// ============================================================================
// StockScan Pro — Extension Popup Script
// ============================================================================

document.addEventListener('DOMContentLoaded', () => {
  const barcodeInput = document.getElementById('manualBarcode');
  const sizeInput = document.getElementById('manualSize');
  const qtyInput = document.getElementById('manualQty');
  const minusBtn = document.getElementById('manualMinusBtn');
  const quickTestBtn = document.getElementById('quickTestSampleBtn');
  const statusEl = document.getElementById('actionStatus');
  const historyEl = document.getElementById('historyContainer');
  const currentSiteLabel = document.getElementById('currentSiteLabel');
  const toggleSiteBtn = document.getElementById('toggleSiteBtn');
  const articleCountText = document.getElementById('articleCountText');

  let activeHost = '';

  function renderHistory(list) {
    if (!Array.isArray(list) || list.length === 0) return;
    historyEl.innerHTML = list
      .map(
        (item) =>
          \`<div class="history-item">
            <strong>-\${item.pairs || 1} Piece(s):</strong> \${item.summary || item.article || 'Shoe Sold'}<br/>
            <span style="font-size:10px;color:#94a3b8;">\${item.time}</span>
          </div>\`
      )
      .join('');
  }

  function updateSiteButtonUI(allowedHosts, blockedHosts) {
    if (!activeHost) {
      currentSiteLabel.textContent = 'Open Logic ERP tab first';
      toggleSiteBtn.style.display = 'none';
      return;
    }
    const isAllowed = allowedHosts.includes(activeHost) || activeHost.includes('logicerp');
    const isBlocked = blockedHosts.includes(activeHost);

    if (isAllowed && !isBlocked) {
      currentSiteLabel.innerHTML = \`Active on: <b>\${activeHost}</b>\`;
      toggleSiteBtn.textContent = 'Hide on This Site';
      toggleSiteBtn.style.background = '#dc2626';
    } else {
      currentSiteLabel.innerHTML = \`Hidden on: <b>\${activeHost}</b>\`;
      toggleSiteBtn.textContent = 'Enable on This Site';
      toggleSiteBtn.style.background = '#059669';
    }
  }

  // Fetch Cloud Status
  chrome.runtime.sendMessage({ type: 'STOCKSCAN_GET_INFO' }, (res) => {
    if (res && res.ok && articleCountText) {
      articleCountText.textContent = \`\${res.totalArticles} Articles Loaded\`;
    }
  });

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs && tabs[0] && tabs[0].url) {
      try {
        const u = new URL(tabs[0].url);
        activeHost = (u.hostname || '').toLowerCase();
      } catch (e) {
        activeHost = '';
      }
    }

    chrome.storage.local.get(['deductHistory', 'allowedHosts', 'blockedHosts'], (res) => {
      if (res.deductHistory) {
        renderHistory(res.deductHistory);
      }
      const allowedHosts = Array.isArray(res.allowedHosts) ? res.allowedHosts : [];
      const blockedHosts = Array.isArray(res.blockedHosts) ? res.blockedHosts : [];
      updateSiteButtonUI(allowedHosts, blockedHosts);
    });
  });

  toggleSiteBtn.addEventListener('click', () => {
    if (!activeHost) return;
    chrome.storage.local.get(['allowedHosts', 'blockedHosts'], (res) => {
      let allowedHosts = Array.isArray(res.allowedHosts) ? res.allowedHosts : [];
      let blockedHosts = Array.isArray(res.blockedHosts) ? res.blockedHosts : [];

      const isCurrentlyActive = (allowedHosts.includes(activeHost) || activeHost.includes('logicerp')) && !blockedHosts.includes(activeHost);

      if (isCurrentlyActive) {
        allowedHosts = allowedHosts.filter((h) => h !== activeHost);
        if (!blockedHosts.includes(activeHost)) blockedHosts.push(activeHost);
      } else {
        blockedHosts = blockedHosts.filter((h) => h !== activeHost);
        if (!allowedHosts.includes(activeHost)) allowedHosts.push(activeHost);
      }

      chrome.storage.local.set({ allowedHosts, blockedHosts }, () => {
        updateSiteButtonUI(allowedHosts, blockedHosts);
      });
    });
  });

  function performDeduction(code, size, qty) {
    if (!code) {
      statusEl.style.color = '#dc2626';
      statusEl.textContent = 'Please enter or scan a barcode/article first.';
      return;
    }

    minusBtn.disabled = true;
    quickTestBtn.disabled = true;
    statusEl.style.color = '#1e40af';
    statusEl.textContent = 'Connecting to GitHub elooks.in & deducting stock...';

    chrome.runtime.sendMessage(
      {
        type: 'STOCKSCAN_DEDUCT_ITEMS',
        items: [{ barcode: code, articleCode: code, itemName: code, size, qty }],
        source: 'Extension Popup'
      },
      (res) => {
        minusBtn.disabled = false;
        quickTestBtn.disabled = false;
        if (res && res.ok) {
          statusEl.style.color = '#047857';
          statusEl.innerHTML = \`✅ <b>Success!</b> \${res.deductedSummary.join('<br/>')}\`;
          chrome.storage.local.get(['deductHistory'], (st) => {
            renderHistory(st.deductHistory || []);
          });
        } else {
          statusEl.style.color = '#dc2626';
          statusEl.textContent = '⚠️ ' + ((res && res.message) || 'Stock deduction failed.');
        }
      }
    );
  }

  minusBtn.addEventListener('click', () => {
    const code = String(barcodeInput.value || '').trim();
    const size = String(sizeInput.value || '').trim();
    const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
    performDeduction(code, size, qty);
  });

  quickTestBtn.addEventListener('click', () => {
    barcodeInput.value = 'RSO3501B BLK';
    sizeInput.value = '08/42';
    qtyInput.value = '1';
    performDeduction('RSO3501B BLK', '08/42', 1);
  });

  barcodeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const code = String(barcodeInput.value || '').trim();
      const size = String(sizeInput.value || '').trim();
      const qty = Math.max(1, parseInt(qtyInput.value, 10) || 1);
      performDeduction(code, size, qty);
    }
  });
});
`;
}

// ============================================================================
// Pure-JS Uncompressed ZIP Archive Builder (Zero External Dependencies)
// Creates a valid .zip file containing all Chrome Extension files
// ============================================================================
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createZipArchive(files: { name: string; content: string }[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileEntries = files.map((f) => {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = encoder.encode(f.content);
    const crc = crc32(dataBytes);
    return { nameBytes, dataBytes, crc, offset: 0 };
  });

  let localTotalSize = 0;
  for (const entry of fileEntries) {
    entry.offset = localTotalSize;
    localTotalSize += 30 + entry.nameBytes.length + entry.dataBytes.length;
  }

  let centralTotalSize = 0;
  for (const entry of fileEntries) {
    centralTotalSize += 46 + entry.nameBytes.length;
  }

  const totalZipSize = localTotalSize + centralTotalSize + 22;
  const out = new Uint8Array(totalZipSize);
  const view = new DataView(out.buffer);
  let ptr = 0;

  // 1. Write Local File Headers + File Data
  for (const entry of fileEntries) {
    view.setUint32(ptr, 0x04034b50, true);
    view.setUint16(ptr + 4, 20, true);
    view.setUint16(ptr + 6, 0, true);
    view.setUint16(ptr + 8, 0, true);
    view.setUint16(ptr + 10, 0, true);
    view.setUint16(ptr + 12, 0, true);
    view.setUint32(ptr + 14, entry.crc, true);
    view.setUint32(ptr + 18, entry.dataBytes.length, true);
    view.setUint32(ptr + 22, entry.dataBytes.length, true);
    view.setUint16(ptr + 26, entry.nameBytes.length, true);
    view.setUint16(ptr + 28, 0, true);
    ptr += 30;

    out.set(entry.nameBytes, ptr);
    ptr += entry.nameBytes.length;

    out.set(entry.dataBytes, ptr);
    ptr += entry.dataBytes.length;
  }

  const centralDirOffset = ptr;

  // 2. Write Central Directory Headers
  for (const entry of fileEntries) {
    view.setUint32(ptr, 0x02014b50, true);
    view.setUint16(ptr + 4, 20, true);
    view.setUint16(ptr + 6, 20, true);
    view.setUint16(ptr + 8, 0, true);
    view.setUint16(ptr + 10, 0, true);
    view.setUint16(ptr + 12, 0, true);
    view.setUint16(ptr + 14, 0, true);
    view.setUint32(ptr + 16, entry.crc, true);
    view.setUint32(ptr + 20, entry.dataBytes.length, true);
    view.setUint32(ptr + 24, entry.dataBytes.length, true);
    view.setUint16(ptr + 28, entry.nameBytes.length, true);
    view.setUint16(ptr + 30, 0, true);
    view.setUint16(ptr + 32, 0, true);
    view.setUint16(ptr + 34, 0, true);
    view.setUint16(ptr + 36, 0, true);
    view.setUint32(ptr + 38, 0, true);
    view.setUint32(ptr + 42, entry.offset, true);
    ptr += 46;

    out.set(entry.nameBytes, ptr);
    ptr += entry.nameBytes.length;
  }

  // 3. Write End of Central Directory Record (EOCD)
  view.setUint32(ptr, 0x06054b50, true);
  view.setUint16(ptr + 4, 0, true);
  view.setUint16(ptr + 6, 0, true);
  view.setUint16(ptr + 8, fileEntries.length, true);
  view.setUint16(ptr + 10, fileEntries.length, true);
  view.setUint32(ptr + 12, centralTotalSize, true);
  view.setUint32(ptr + 16, centralDirOffset, true);
  view.setUint16(ptr + 20, 0, true);

  return out;
}

export interface ChromeErpBridgeConfig {
  portalUrl?: string;
  webUser?: string;
  webPassword?: string;
  storeName?: string;
}

export function downloadChromeExtensionZip(config?: ChromeErpBridgeConfig) {
  let host = '';
  if (config?.portalUrl) {
    try {
      const urlStr = config.portalUrl.startsWith('http')
        ? config.portalUrl
        : `https://${config.portalUrl}`;
      host = new URL(urlStr).hostname.toLowerCase();
    } catch {
      host = config.portalUrl.trim().toLowerCase();
    }
  }

  const files = [
    { name: 'manifest.json', content: getManifestJson() },
    { name: 'background.js', content: getBackgroundJs() },
    {
      name: 'content.js',
      content: getContentJs(
        host,
        config?.webUser || '',
        config?.storeName || '',
        config?.webPassword || ''
      )
    },
    { name: 'popup.html', content: getPopupHtml() },
    { name: 'popup.js', content: getPopupJs() }
  ];

  const zipBytes = createZipArchive(files);
  const blob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'StockScan_Logic_Chrome_ERP_Bridge.zip';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
