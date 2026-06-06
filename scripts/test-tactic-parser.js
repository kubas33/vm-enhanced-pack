#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var tacticEnhancer = require('../vm-tactic-view-enhancer.user.js');

var root = path.resolve(__dirname, '..');
var tacticFixture = fs.readFileSync(path.join(root, 'raw_data', 'tactic-page.md'), 'utf8');
var trainingFixture = fs.readFileSync(path.join(root, 'raw_data', 'training-panel.md'), 'utf8');
var tacticHtml = tacticEnhancer.extractVmBody(tacticFixture);
var trainingHtml = tacticEnhancer.extractVmBody(trainingFixture);
var players = tacticEnhancer.parseSelectedTacticPlayersFromHtml(tacticHtml);
var trainingValues = tacticEnhancer.parseTrainingPercentMapFromHtml(trainingHtml);
var summary = tacticEnhancer.buildTacticTrainingSummary(players, trainingValues);
var bySlot = {};

players.forEach(function (player) {
  bySlot[player.slot] = player;
});

assert.strictEqual(players.length, 12, 'expected selected tactic players for slots 1-12');
assert.strictEqual(bySlot[1].playerId, '1904716', 'expected slot 1 selected player');
assert.strictEqual(bySlot[2].playerId, '1929386', 'expected slot 2 selected player');
assert.strictEqual(bySlot[3].playerId, '2004221', 'expected slot 3 selected player');
assert.strictEqual(bySlot[4].playerId, '1976867', 'expected slot 4 selected player');
assert.strictEqual(bySlot[5].playerId, '1929147', 'expected slot 5 selected player');
assert.strictEqual(bySlot[6].playerId, '2004527', 'expected slot 6 selected player');
assert.strictEqual(bySlot[7].playerId, '1928566', 'expected slot 7 selected player');
assert.strictEqual(bySlot[8].playerId, '1974424', 'expected reserve slot 8 selected player');
assert.strictEqual(bySlot[9].playerId, '2004528', 'expected reserve slot 9 selected player');
assert.strictEqual(bySlot[10].playerId, '2004526', 'expected reserve slot 10 selected player');
assert.strictEqual(bySlot[11].playerId, '2059902', 'expected reserve slot 11 selected player');
assert.strictEqual(bySlot[12].playerId, '1974667', 'expected reserve slot 12 selected player');

assert.strictEqual(tacticEnhancer.getTrainingExcess(50), 0, '50% should not create excess');
assert.strictEqual(tacticEnhancer.getTrainingExcess(51), 1, '51% should create 1% excess');
assert.strictEqual(tacticEnhancer.getTrainingExcess(88), 38, '88% should create 38% excess');

assert.strictEqual(summary.players.length, 12, 'expected all selected players in summary data');
assert.ok(
  summary.players.some(function (player) {
    return player.slot > 7 && player.excess > 0;
  }),
  'expected reserves above 50% to keep local warning data'
);
assert.ok(
  summary.startersAtRisk.every(function (player) {
    return player.slot <= 7;
  }),
  'expected global warning to exclude reserves'
);
assert.strictEqual(
  summary.possibleLoss,
  summary.startersAtRisk.reduce(function (sum, player) {
    return sum + (player.percent - 50);
  }, 0),
  'expected possible loss to be sum of starter excess values'
);

console.log('tactic parser ok: ' + players.length + ' selected players matched');
