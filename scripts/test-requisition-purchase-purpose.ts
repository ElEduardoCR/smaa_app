import assert from 'node:assert/strict';
import { requisitionItemPurpose, requisitionPurchaseNotes, validateRequisitionPurpose } from '../src/lib/requisitionPurpose';
import { matchesPurchaseSearch } from '../src/lib/purchaseSearch';

const items = [
    { description: 'Tornillos M8', notes: 'Acero inoxidable', purpose: ' Transportador línea 2 ' },
    { description: 'Tuercas M8', notes: 'Caja de 100', purpose: '' },
];

assert.equal(requisitionItemPurpose('Mantenimiento general', items[0]), 'Transportador línea 2');
assert.equal(requisitionItemPurpose(' Mantenimiento general ', items[1]), 'Mantenimiento general');
assert.doesNotThrow(() => validateRequisitionPurpose('Mantenimiento general', items));
assert.doesNotThrow(() => validateRequisitionPurpose('', [{ purpose: 'Proyecto A' }, { purpose: 'Proyecto B' }]));
assert.throws(() => validateRequisitionPurpose(' ', items), /artículo 2/);
assert.equal(requisitionPurchaseNotes('Mantenimiento general', items[0]), 'Para: Transportador línea 2\nAcero inoxidable');
assert.equal(requisitionPurchaseNotes(undefined, { notes: 'Notas históricas' }), 'Notas históricas');
assert.equal(requisitionPurchaseNotes(null, {}), null);

const purchase = {
    po_number: 'PO00425',
    notes: 'Urgente para reparación de compresor',
    supplier: { name: 'Ferretería del Norte', business_name: 'Materiales SA', rfc: 'AAA010101AAA' },
    items: items.map(item => ({ ...item, notes: requisitionPurchaseNotes('Mantenimiento general', item) })),
};

assert(matchesPurchaseSearch('tornillos transportador linea 2', purchase), 'Find an item together with its project, without requiring accents');
assert(matchesPurchaseSearch('compresor', purchase), 'Find historical header notes');
assert(matchesPurchaseSearch('acero inoxidable', purchase), 'Find line specifications');
assert(matchesPurchaseSearch('tuercas mantenimiento', purchase), 'Find inherited purpose after conversion');
assert(matchesPurchaseSearch('ferreteria po00425', purchase), 'Keep supplier and folio searches');
assert(!matchesPurchaseSearch('soldadura', purchase));
assert(matchesPurchaseSearch('', { po_number: 'PO1', notes: null, items: null, supplier: null }));
assert(!matchesPurchaseSearch('transportador', { po_number: 'PO1', notes: null, items: null, supplier: null }));

console.log('Requisition purpose inheritance, conversion notes and purchase search checks passed.');
