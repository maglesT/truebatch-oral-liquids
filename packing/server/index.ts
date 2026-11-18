// TrueBatch Tablets Packing: the shared server (server/start.ts) as the packing product, with its own web UI.
import { fileURLToPath } from 'node:url';
import { start } from '../../server/start.js';
import { PACKING } from '../product.js';

await start(PACKING, fileURLToPath(new URL('../../packing-web', import.meta.url)));
