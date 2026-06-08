#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var changesEnhancer = require('../vm-changes-list-enhancer.user.js');

var root = path.resolve(__dirname, '..');
var fixture = fs.readFileSync(path.join(root, 'raw_data', 'changes-list-view.md'), 'utf8');
var html = changesEnhancer.extractVmBody(fixture);
var rows = changesEnhancer.parseChangeRowsFromHtml(html);
var paverRow = rows.find(function (row) {
  return row.changeId === '5851843';
});
var capleRow = rows.find(function (row) {
  return row.changeId === '5829155';
});

assert.ok(html.indexOf('ChangeEdit&changeId=') !== -1, 'expected changes list html');
assert.strictEqual(rows.length, 15, 'expected 15 change rows in fixture');
assert.ok(paverRow, 'expected Paver change row');
assert.strictEqual(paverRow.playerOut, 'Paver, Eliáš', 'expected player out name');
assert.strictEqual(paverRow.playerIn, 'Galeandro, Gelindo', 'expected player in name');
assert.deepStrictEqual(paverRow.sets, [false, false, true, false, false], 'expected set pattern for Paver row');
assert.strictEqual(paverRow.activeSetCount, 1, 'expected one active set');
assert.strictEqual(paverRow.activeSetsLabel, '3', 'expected active set label');

assert.ok(capleRow, 'expected Caple change row');
assert.deepStrictEqual(capleRow.sets, [false, false, true, true, false], 'expected sets 3 and 4 active');
assert.strictEqual(capleRow.activeSetsLabel, '3,4', 'expected active sets label');

assert.strictEqual(
  changesEnhancer.getSortValue(paverRow, 'playerOut'),
  'paver, eliáš',
  'expected normalized sort value for player out'
);
assert.strictEqual(
  changesEnhancer.getSortValue(capleRow, 'activeSetCount'),
  2,
  'expected active set count sort value'
);

console.log('changes list parser ok: ' + rows.length + ' rows parsed');
