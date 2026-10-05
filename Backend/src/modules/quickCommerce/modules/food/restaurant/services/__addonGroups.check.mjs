// Self-check for buildAddonGroups. Run: node src/modules/food/restaurant/services/__addonGroups.check.mjs
import assert from 'node:assert/strict';
import { buildAddonGroups } from './publicAddons.service.js';

const a = (name, g) => ({ id: name, name, price: 20, group: g });

// Grouping, ordering, and the radio/checkbox split.
{
  const groups = buildAddonGroups([
    a('Thin Crust', { name: 'Upgrade Your Base', minSelect: 0, maxSelect: 1, sortOrder: 1 }),
    a('Double Burst', { name: 'Upgrade Your Base', minSelect: 0, maxSelect: 1, sortOrder: 1 }),
    a('Coke', { name: 'Add a Drink', minSelect: 0, maxSelect: 2, sortOrder: 2 }),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].title, 'Upgrade Your Base');
  assert.equal(groups[0].options.length, 2);
  assert.equal(groups[0].selectionType, 'single', 'maxSelect 1 must render as radios');
  assert.equal(groups[0].selectionLabel, 'Select up to 1 option');
  assert.equal(groups[1].title, 'Add a Drink');
  assert.equal(groups[1].selectionType, 'multi', 'maxSelect 2 must render as checkboxes');
}

// A required group reads like Zomato's "Required • Select any 1 option".
{
  const [g] = buildAddonGroups([a('Regular', { name: 'Quantity', minSelect: 1, maxSelect: 1, sortOrder: 0 })]);
  assert.equal(g.isRequired, true);
  assert.equal(g.selectionLabel, 'Required • Select any 1 option');
}

// Ungrouped add-ons still get a heading rather than vanishing.
{
  const [g] = buildAddonGroups([a('Extra cheese', {})]);
  assert.equal(g.title, 'Add-ons');
  assert.equal(g.isRequired, false);
}

// Members disagreeing on rules: lowest sortOrder wins, so lowering maxSelect on the
// first option takes effect instead of being overridden by a stale sibling.
{
  const [g] = buildAddonGroups([
    a('B', { name: 'Base', minSelect: 0, maxSelect: 3, sortOrder: 5 }),
    a('A', { name: 'Base', minSelect: 0, maxSelect: 1, sortOrder: 1 }),
  ]);
  assert.equal(g.maxSelect, 1);
  assert.equal(g.selectionType, 'single');
}

assert.deepEqual(buildAddonGroups([]), []);
console.log('buildAddonGroups: all checks passed');
