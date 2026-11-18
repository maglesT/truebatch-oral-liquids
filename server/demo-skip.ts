// Demo installations only: skips every wait running now in a batch, or in one of its stages, as the named demo person
// (server/demo.ts). node dist/server/demo-skip.js <batch no.> [stage] --as <username>
import { demoSkipCommand } from './demo.js';
import { LIQUIDS } from './product.js';

process.exitCode = await demoSkipCommand(LIQUIDS, process.argv.slice(2), process.env);
