import * as XLSX from 'xlsx';
import { ArticleStock, SizeStockEntry } from '../types/stock';

function parseNum(val: unknown, fallback = 0): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const cleaned = val.replace(/[^0-9.-]/g, '');
    const parsed = parseFloat(cleaned);
    return Number.isNaN(parsed) ? fallback : parsed;
  }
  return fallback;
}

function cleanStr(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'number') {
    return Math.trunc(val).toString();
  }
  return String(val).trim();
}

const BARCODE_KEYS = ['barcode', 'bar code', 'ean', 'upc', 'scan code', 'item code', 'code', 'बारकोड'];
const ARTICLE_KEYS = ['article', 'article no', 'article code', 'art no', 'art', 'style', 'style no', 'design', 'design no', 'sku', 'model'];
const NAME_KEYS = ['item name', 'name', 'product', 'product name', 'description', 'particulars', 'item', 'आइटम', 'नाम'];
const SIZE_KEYS = ['size', 'sz', 'sizes', 'साइज', 'साइज़'];
const QTY_KEYS = ['qty', 'quantity', 'stock', 'available', 'closing stock', 'cl. stk', 'cl stock', 'balance', 'pcs', 'स्टॉक', 'मात्रा'];
const PRICE_KEYS = ['price', 'rate', 'selling price', 'sale price', 'sp', 'wsp', 'रेट', 'कीमत'];
const MRP_KEYS = ['mrp', 'm.r.p.', 'retail price', 'एमआरपी'];
const COLOR_KEYS = ['color', 'colour', 'shade', 'रंग'];
const RACK_KEYS = ['rack', 'location', 'bin', 'godown', 'shelf', 'रैक'];
const CATEGORY_KEYS = ['category', 'group', 'department', 'type'];

const KNOWN_MATRIX_SIZE_HEADERS = new Set([
  'xs', 's', 'm', 'l', 'xl', 'xxl', '2xl', '3xl', '4xl', '5xl', 'free', 'free size',
  '26', '28', '30', '32', '34', '36', '38', '40', '42', '44', '46',
  '5', '6', '7', '8', '9', '10', '11', '12',
  'uk 6', 'uk 7', 'uk 8', 'uk 9', 'uk 10', 'uk6', 'uk7', 'uk8', 'uk9', 'uk10'
]);

function findHeader(
  headers: string[],
  synonyms: string[],
  excludeCols: (string | null)[] = []
): string | null {
  const excluded = new Set(excludeCols.filter(Boolean));
  const norm = headers
    .filter((h) => !excluded.has(h))
    .map((h) => ({
      raw: h,
      clean: h.trim().toLowerCase().replace(/[_-]/g, ' ')
    }));
  for (const syn of synonyms) {
    const exact = norm.find((h) => h.clean === syn);
    if (exact) return exact.raw;
  }
  for (const syn of synonyms) {
    const partial = norm.find((h) => h.clean.includes(syn));
    if (partial) return partial.raw;
  }
  return null;
}

/**
 * Ensures that if an article list has multiple entries for the same article/item name
 * (e.g. when each size row had its own unique barcode), all sizes of the same article
 * are merged together into a single ArticleStock entry.
 */
export function consolidateArticlesByGroup(articles: ArticleStock[]): ArticleStock[] {
  if (!Array.isArray(articles) || articles.length === 0) return [];

  const map = new Map<string, ArticleStock>();

  for (const art of articles) {
    const code = (art.articleCode || '').trim();
    const barcode = (art.articleBarcode || '').trim();
    const name = (art.name || '').trim();

    // If articleCode is identical to the individual size barcode (e.g. numeric EAN),
    // group by the article's item name (e.g. "RSO4744 WGR") so all sizes stay together.
    const isCodeJustBarcode =
      !code ||
      code === barcode ||
      (art.sizes.length === 1 && code === art.sizes[0].barcode);

    const groupIdentifier = isCodeJustBarcode && name ? name : code || name || barcode;
    const groupKey = groupIdentifier.toLowerCase();

    const displayArticleCode = isCodeJustBarcode && name ? name : code || name || barcode;

    const existing = map.get(groupKey);
    if (existing) {
      if (!existing.mrp && art.mrp) existing.mrp = art.mrp;
      if (!existing.sellingPrice && art.sellingPrice) existing.sellingPrice = art.sellingPrice;

      for (const s of art.sizes || []) {
        const sizeLabel = (s.size || 'Standard').trim();
        const existingSize = existing.sizes.find(
          (es) =>
            es.size.toLowerCase() === sizeLabel.toLowerCase() &&
            (es.barcode === s.barcode || !es.barcode || !s.barcode)
        );
        if (existingSize) {
          existingSize.quantity += Number(s.quantity) || 0;
          if (s.barcode && !existingSize.barcode) existingSize.barcode = s.barcode;
        } else {
          existing.sizes.push({
            size: sizeLabel,
            barcode: s.barcode || art.articleBarcode || displayArticleCode,
            quantity: Number(s.quantity) || 0,
            rackLocation: s.rackLocation || art.rackLocation || 'Main Store'
          });
        }
      }
    } else {
      map.set(groupKey, {
        ...art,
        articleCode: displayArticleCode,
        name: name || displayArticleCode,
        sizes: (art.sizes || []).map((s) => ({
          size: (s.size || 'Standard').trim(),
          barcode: s.barcode || art.articleBarcode || displayArticleCode,
          quantity: Number(s.quantity) || 0,
          rackLocation: s.rackLocation || art.rackLocation || 'Main Store'
        }))
      });
    }
  }

  const sizeOrderRank: Record<string, number> = {
    xxs: 1,
    xs: 2,
    s: 3,
    m: 4,
    l: 5,
    xl: 6,
    xxl: 7,
    '2xl': 7,
    '3xl': 8,
    '4xl': 9,
    '5xl': 10,
    free: 99,
    'free size': 99
  };

  const result = Array.from(map.values());
  for (const item of result) {
    item.sizes.sort((a, b) => {
      const sa = a.size.trim().toLowerCase();
      const sb = b.size.trim().toLowerCase();
      if (sizeOrderRank[sa] && sizeOrderRank[sb]) {
        return sizeOrderRank[sa] - sizeOrderRank[sb];
      }
      return sa.localeCompare(sb, undefined, { numeric: true, sensitivity: 'base' });
    });
  }

  return result;
}

export function parseStockBuffer(buffer: ArrayBuffer | Uint8Array): ArticleStock[] {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const firstSheet = workbook.SheetNames[0];
  if (!firstSheet) {
    throw new Error('Excel file is empty.');
  }

  const worksheet = workbook.Sheets[firstSheet];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, {
    defval: ''
  });

  if (rows.length === 0) {
    throw new Error('No rows found in Excel sheet.');
  }

  const headers = Object.keys(rows[0]).filter((k) => !k.startsWith('__EMPTY'));
  const barcodeCol = findHeader(headers, BARCODE_KEYS);
  const articleCol = findHeader(headers, ARTICLE_KEYS, [barcodeCol]);
  const nameCol = findHeader(headers, NAME_KEYS, [barcodeCol, articleCol]);
  const sizeCol = findHeader(headers, SIZE_KEYS, [barcodeCol, articleCol, nameCol]);
  const qtyCol = findHeader(headers, QTY_KEYS, [barcodeCol, articleCol, nameCol, sizeCol]);
  const priceCol = findHeader(headers, PRICE_KEYS);
  const mrpCol = findHeader(headers, MRP_KEYS);
  const colorCol = findHeader(headers, COLOR_KEYS);
  const rackCol = findHeader(headers, RACK_KEYS);
  const categoryCol = findHeader(headers, CATEGORY_KEYS);

  const matrixSizeCols = headers.filter(
    (h) =>
      KNOWN_MATRIX_SIZE_HEADERS.has(h.trim().toLowerCase()) ||
      /^size\s+/i.test(h.trim())
  );

  const articlesMap = new Map<string, ArticleStock>();

  if (!sizeCol && matrixSizeCols.length >= 2) {
    rows.forEach((row, idx) => {
      const barcode = barcodeCol ? cleanStr(row[barcodeCol]) : '';
      const rawArtCode = articleCol ? cleanStr(row[articleCol]) : '';
      const name = nameCol ? cleanStr(row[nameCol]) : '';
      const artCode = rawArtCode || name || barcode || `ART-${101 + idx}`;
      if (!barcode && !artCode && !name) return;

      const sp = priceCol ? parseNum(row[priceCol], 0) : 0;
      const mrp = mrpCol ? parseNum(row[mrpCol], sp) : sp;
      const color = colorCol ? cleanStr(row[colorCol]) : 'Standard';
      const rack = rackCol ? cleanStr(row[rackCol]) : 'Main Store';
      const category = categoryCol ? cleanStr(row[categoryCol]) : 'Apparel';

      const sizes: SizeStockEntry[] = matrixSizeCols.map((sc) => ({
        size: sc.trim().replace(/^size\s+/i, ''),
        barcode: barcode || artCode,
        quantity: Math.max(0, Math.round(parseNum(row[sc], 0)))
      }));

      const key = (rawArtCode || name || artCode).toLowerCase();
      articlesMap.set(key, {
        id: `art-${Date.now()}-${idx}`,
        articleCode: artCode,
        articleBarcode: barcode || artCode,
        name: name || artCode,
        category: category || 'General',
        color: color || 'Standard',
        sellingPrice: sp,
        mrp: mrp || sp,
        rackLocation: rack || 'Main Store',
        sizes
      });
    });
  } else {
    rows.forEach((row, idx) => {
      const barcode = barcodeCol
        ? cleanStr(row[barcodeCol])
        : headers[0]
        ? cleanStr(row[headers[0]])
        : '';
      const rawArtCode = articleCol ? cleanStr(row[articleCol]) : '';
      const rawName = nameCol
        ? cleanStr(row[nameCol])
        : headers[1]
        ? cleanStr(row[headers[1]])
        : '';

      if (!barcode && !rawArtCode && !rawName) return;

      const sizeVal = sizeCol ? cleanStr(row[sizeCol]) || 'Free Size' : 'Standard';
      const qtyVal = qtyCol
        ? Math.max(0, Math.round(parseNum(row[qtyCol], 0)))
        : headers[2]
        ? Math.max(0, Math.round(parseNum(row[headers[2]], 0)))
        : 0;
      const sp = priceCol ? parseNum(row[priceCol], 0) : 0;
      const mrp = mrpCol ? parseNum(row[mrpCol], sp) : sp;
      const color = colorCol ? cleanStr(row[colorCol]) : '';
      const rack = rackCol ? cleanStr(row[rackCol]) : 'Main Store';
      const category = categoryCol ? cleanStr(row[categoryCol]) : 'General';

      // Group all sizes of the same article together using Article No or Item Name (never individual size barcode)
      const effectiveArticleCode =
        rawArtCode && rawArtCode !== barcode
          ? rawArtCode
          : rawName || rawArtCode || barcode || `ART-${101 + idx}`;

      const groupKey = effectiveArticleCode.toLowerCase();
      const existing = articlesMap.get(groupKey);

      if (existing) {
        const existingSize = existing.sizes.find(
          (s) =>
            s.size.toLowerCase() === sizeVal.toLowerCase() &&
            (s.barcode === barcode || !s.barcode || !barcode)
        );
        if (existingSize) {
          existingSize.quantity += qtyVal;
          if (barcode) existingSize.barcode = barcode;
        } else {
          existing.sizes.push({
            size: sizeVal,
            barcode: barcode || existing.articleBarcode,
            quantity: qtyVal,
            rackLocation: rack
          });
        }
      } else {
        articlesMap.set(groupKey, {
          id: `art-${Date.now()}-${idx}`,
          articleCode: effectiveArticleCode,
          articleBarcode: barcode || effectiveArticleCode,
          name: rawName || effectiveArticleCode,
          category: category || 'General',
          color: color || 'Standard',
          sellingPrice: sp,
          mrp: mrp || sp,
          rackLocation: rack || 'Main Store',
          sizes: [
            {
              size: sizeVal,
              barcode: barcode || effectiveArticleCode,
              quantity: qtyVal,
              rackLocation: rack
            }
          ]
        });
      }
    });
  }

  const result = consolidateArticlesByGroup(Array.from(articlesMap.values()));
  if (result.length === 0) {
    throw new Error('Could not find valid stock rows in the Excel file.');
  }
  return result;
}

export async function parseStockExcel(file: File): Promise<ArticleStock[]> {
  const buffer = await file.arrayBuffer();
  return parseStockBuffer(buffer);
}
