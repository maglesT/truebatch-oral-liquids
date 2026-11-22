// Which product this web UI is: TrueBatch Oral Liquids (web/src/main.tsx) or TrueBatch Oral Liquids Packing, whose entry
// (packing/web/main.tsx) sets it before the screens load. The server checks everything again.
export const product = {
  name: 'TrueBatch Oral Liquids',
  about: 'Electronic batch records for oral liquids, from dispensing to QA release of the bulk.',
  // What the product calls its master records: the tab, the page heading and the way back to it.
  masters: 'Master records',
  packing: false,
  // The words master data's dosage form of this product's products has (plan data change 5): the pick lists offer only
  // oral liquids (not tablets, capsules or injections). Of those, a master offers the products master data marks as bulk
  // (packing masters: pack, and bulk for the bulk filled) and those it does not mark yet.
  dosageForms: ['oral solution', 'syrup', 'suspension', 'emulsion', 'drops', 'elixir', 'powder for oral', 'dry syrup'],
};
