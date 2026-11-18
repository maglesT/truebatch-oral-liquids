import type { Product } from '../server/product.js';

// TrueBatch Tablets Packing: the packing batch record, from the RELEASED bulk tablets of TrueBatch Tablets to QA
// release of the packed batch. Its permissions are its own (the platform's code format allows no "-"); the app reads
// each as the TrueBatch code of the same thing (server/product.ts). QC approves the packed batch (the finished packed
// product tested and complies, with the QC report number) before QA releases it, as for tablets (owner, 15 Nov 2026).
export const PACKING: Product = {
  id: 'truebatch_packing',
  name: 'TrueBatch Tablets Packing',
  batchPrefix: 'TP',
  permissions: {
    'truebatch_packing.master.author': 'Write packing master record versions',
    'truebatch_packing.master.check': 'Check a packing master record version written by another person',
    'truebatch_packing.master.approve': 'Approve a checked packing master record version (QA)',
    'truebatch_packing.batch.issue': 'Issue a packing batch record from a released bulk batch',
    'truebatch_packing.batch.operate': 'Record and sign packing steps as performed',
    'truebatch_packing.batch.check': 'Check packing steps performed by another person (second person)',
    'truebatch_packing.batch.supervise': 'Production approval of a completed packing record',
    'truebatch_packing.qc.approve': 'QC approval of the finished packed product (tested and complies)',
    'truebatch_packing.qa.release': 'QA review and release of packed batches',
    'truebatch_packing.view': 'View packing records and packing master versions',
    'truebatch_packing.demo.skip': 'Skip a running wait (demo installations only)',
  },
};
