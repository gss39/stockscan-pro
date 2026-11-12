export interface SizeStockEntry {
  size: string;
  barcode: string;
  quantity: number;
  rackLocation?: string;
}

export interface ArticleStock {
  id: string;
  articleCode: string;
  articleBarcode: string;
  name: string;
  category: string;
  color: string;
  mrp: number;
  sellingPrice: number;
  rackLocation: string;
  sizes: SizeStockEntry[];
}

export interface SheetMetadata {
  fileName: string;
  uploadedAt: string;
  totalArticles: number;
  totalPieces: number;
}
