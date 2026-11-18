// TrueBatch Tablets Packing's web entry: the shared screens of web/src as the packing product.
import './product.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../web/src/App.js';
import '../../web/src/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
