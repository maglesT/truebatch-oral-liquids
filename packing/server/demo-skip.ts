// TrueBatch Tablets Packing, demo installations only: node dist/packing/server/demo-skip.js <batch no.> [stage] --as <username>
import { demoSkipCommand } from '../../server/demo.js';
import { PACKING } from '../product.js';

process.exitCode = await demoSkipCommand(PACKING, process.argv.slice(2), process.env);
