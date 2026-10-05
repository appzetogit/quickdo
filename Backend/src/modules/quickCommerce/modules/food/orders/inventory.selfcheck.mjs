// Standalone check of the stock-quantity arithmetic — no DB, no server.
//   node src/modules/food/orders/inventory.selfcheck.mjs
//
// Only the pure part is covered here. The atomic decrement, the partial
// rollback and the restore claim are all single Mongo operations and are
// checked against a real database, not simulated: simulating them would test
// a copy of the semantics rather than the semantics.
import assert from 'node:assert';
import { totalQuantityByItem } from './services/inventory.service.js';

const A = '507f1f77bcf86cd799439011';
const B = '507f1f77bcf86cd799439012';

// The same product on two lines (two pack sizes, or one line with add-ons and
// one without) comes off the same shelf. Decrementing per line would take one
// unit when the customer bought three.
const summed = totalQuantityByItem([
    { itemId: A, quantity: 2 },
    { itemId: A, quantity: 1 },
    { itemId: B, quantity: 5 },
]);
assert.equal(summed.get(A), 3);
assert.equal(summed.get(B), 5);

// A missing or malformed quantity is one unit, never zero — a line that claims
// nothing would let an item be ordered without being taken off the shelf.
assert.equal(totalQuantityByItem([{ itemId: A }]).get(A), 1);
assert.equal(totalQuantityByItem([{ itemId: A, quantity: 0 }]).get(A), 1);
assert.equal(totalQuantityByItem([{ itemId: A, quantity: -4 }]).get(A), 1);

// Unusable ids are dropped rather than throwing: they cannot name a shelf, and
// the order path rejects them separately with a message naming the item.
assert.equal(totalQuantityByItem([{ itemId: 'not-an-id', quantity: 2 }]).size, 0);
assert.equal(totalQuantityByItem([{ quantity: 2 }]).size, 0);
assert.equal(totalQuantityByItem([]).size, 0);
assert.equal(totalQuantityByItem(undefined).size, 0);

console.log('inventory helpers: all assertions passed');
