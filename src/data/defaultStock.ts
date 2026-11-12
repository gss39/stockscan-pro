import { ArticleStock } from '../types/stock';

export const DEFAULT_ARTICLES: ArticleStock[] = [
  {
    id: 'art-1',
    articleCode: 'ART-101',
    articleBarcode: '890100100101',
    name: 'Men Cotton Casual Check Shirt',
    category: 'Shirts',
    color: 'Navy Blue',
    mrp: 1299,
    sellingPrice: 899,
    rackLocation: 'Rack A-1',
    sizes: [
      { size: 'S (38)', barcode: '890100100101', quantity: 8 },
      { size: 'M (40)', barcode: '890100100102', quantity: 15 },
      { size: 'L (42)', barcode: '890100100103', quantity: 12 },
      { size: 'XL (44)', barcode: '890100100104', quantity: 3 },
      { size: 'XXL (46)', barcode: '890100100105', quantity: 0 }
    ]
  },
  {
    id: 'art-2',
    articleCode: 'ART-205',
    articleBarcode: '890200200201',
    name: 'Slim Fit Stretchable Denim Jeans',
    category: 'Jeans',
    color: 'Dark Indigo',
    mrp: 1899,
    sellingPrice: 1350,
    rackLocation: 'Rack B-4',
    sizes: [
      { size: '28', barcode: '890200200201', quantity: 5 },
      { size: '30', barcode: '890200200202', quantity: 18 },
      { size: '32', barcode: '890200200203', quantity: 22 },
      { size: '34', barcode: '890200200204', quantity: 9 },
      { size: '36', barcode: '890200200205', quantity: 0 },
      { size: '38', barcode: '890200200206', quantity: 4 }
    ]
  },
  {
    id: 'art-3',
    articleCode: 'ART-310',
    articleBarcode: '890300300301',
    name: 'Sports Running Mesh Shoes',
    category: 'Footwear',
    color: 'Black / White',
    mrp: 2499,
    sellingPrice: 1699,
    rackLocation: 'Rack C-2',
    sizes: [
      { size: 'UK 6', barcode: '890300300301', quantity: 4 },
      { size: 'UK 7', barcode: '890300300302', quantity: 11 },
      { size: 'UK 8', barcode: '890300300303', quantity: 16 },
      { size: 'UK 9', barcode: '890300300304', quantity: 7 },
      { size: 'UK 10', barcode: '890300300305', quantity: 0 }
    ]
  },
  {
    id: 'art-4',
    articleCode: 'ART-408',
    articleBarcode: '890400400401',
    name: 'Ladies Printed Kurti Set',
    category: 'Ethnic Wear',
    color: 'Maroon',
    mrp: 1599,
    sellingPrice: 1099,
    rackLocation: 'Rack D-3',
    sizes: [
      { size: 'XS', barcode: '890400400401', quantity: 2 },
      { size: 'S', barcode: '890400400402', quantity: 10 },
      { size: 'M', barcode: '890400400403', quantity: 14 },
      { size: 'L', barcode: '890400400404', quantity: 6 },
      { size: 'XL', barcode: '890400400405', quantity: 0 },
      { size: 'XXL', barcode: '890400400406', quantity: 5 }
    ]
  }
];
