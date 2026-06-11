#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var enhancer = require('../vm-individual-tactics-enhancer.user.js');

var root = path.resolve(__dirname, '..');
var fixture = fs.readFileSync(path.join(root, 'raw_data', 'individual-tactics-view.md'), 'utf8');
var html = enhancer.extractVmBody(fixture);
var view = enhancer.parseIndividualViewFromHtml(html);
var capleRow = view.rows.find(function (row) {
  return row.playerId === '1976867';
});
var cimirotRow = view.rows.find(function (row) {
  return row.playerId === '1974424';
});

assert.ok(html.indexOf('IndividualSave') !== -1, 'expected individual tactics html');
assert.strictEqual(view.scenarioOpt, 'Squad&opt=atk1b1l', 'expected selected scenario opt');
assert.deepStrictEqual(
  view.columns.map(function (column) {
    return column.field;
  }),
  ['atak', 'kiwka', 'out'],
  'expected attack column fields'
);
assert.deepStrictEqual(
  view.columns.map(function (column) {
    return column.label;
  }),
  ['normalny atak', 'kiwka', 'atak blok-out'],
  'expected attack column labels'
);
assert.strictEqual(view.rows.length, 2, 'expected two player rows in fixture');
assert.ok(capleRow, 'expected Caple row');
assert.strictEqual(capleRow.positionShort, 'At', 'expected Caple position');
assert.strictEqual(capleRow.fields.atak.value, 1, 'expected Caple normal attack value');
assert.strictEqual(capleRow.fields.kiwka.value, 8, 'expected Caple tip value');
assert.ok(cimirotRow, 'expected Cimirot row');
assert.strictEqual(cimirotRow.positionShort, 'Śr', 'expected Cimirot position');
assert.strictEqual(cimirotRow.fields.kiwka.value, 3, 'expected Cimirot tip value');

assert.strictEqual(
  enhancer.getPresetMap(view),
  enhancer.ATTACK_PRESETS,
  'expected attack preset map for attack view'
);

var snapshot = enhancer.takeSnapshot(view);
assert.strictEqual(
  Object.keys(snapshot).length,
  6,
  'expected six tracked span values in snapshot'
);
assert.strictEqual(snapshot['line_1_block_1_atak_1976867'], 1, 'expected Caple attack in snapshot');

var defenseFixture = fs.readFileSync(path.join(root, 'raw_data', 'individual-tactics-defense-view.md'), 'utf8');
var defenseHtml = enhancer.extractVmBody(defenseFixture);
var defenseView = enhancer.parseIndividualViewFromHtml(defenseHtml);

assert.strictEqual(defenseView.columns.length, 2, 'expected two defense columns');
assert.strictEqual(defenseView.rows.length, 1, 'expected one defense row');
assert.strictEqual(defenseView.rows[0].fields.obrona.value, 8, 'expected defense value');
assert.strictEqual(defenseView.rows[0].fields.asekuracja.value, 3, 'expected coverage value');
assert.strictEqual(
  enhancer.getPresetMap(defenseView),
  enhancer.DEFENSE_PRESETS,
  'expected defense preset map'
);

console.log('individual tactics parser ok: ' + view.rows.length + ' attack rows, ' + defenseView.rows.length + ' defense rows');
