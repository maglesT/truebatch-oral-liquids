import { product } from '../../web/src/product.js';

// Imported first by main.tsx, so every screen module sees the packing product when it loads.
Object.assign(product, {
  name: 'TrueBatch Tablets Packing',
  about: 'The packing batch record: from the released bulk tablets to QA release of the packed batch.',
  masters: 'Packing masters',
  packing: true,
});
