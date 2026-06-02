#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var squadEnhancer = require('../vm-squad-view-enhancer.user.js');

var root = path.resolve(__dirname, '..');
var squadFixture = fs.readFileSync(path.join(root, 'raw_data', 'squad-panel.md'), 'utf8');
var trainingFixture = fs.readFileSync(path.join(root, 'raw_data', 'training-panel.md'), 'utf8');
var squadHtml = squadEnhancer.extractVmBody(squadFixture);
var trainingHtml = squadEnhancer.extractVmBody(trainingFixture);
var squadIds = squadEnhancer.parseSquadPlayerIdsFromHtml(squadHtml);
var trainingPercentMap = squadEnhancer.parseTrainingPercentMapFromHtml(trainingHtml);

assert.strictEqual(squadIds.length, 24, 'expected 24 squad players in fixture');
assert.strictEqual(Object.keys(trainingPercentMap).length, 24, 'expected 24 training rows in fixture');
assert.strictEqual(trainingPercentMap['2060721'], 94, 'expected Manso training progress');
assert.strictEqual(trainingPercentMap['1976867'], 27, 'expected Caple training progress');
assert.strictEqual(trainingPercentMap['2088564'], 0, 'expected Zagalo training progress');

squadIds.forEach(function (playerId) {
  assert.ok(
    Object.prototype.hasOwnProperty.call(trainingPercentMap, playerId),
    'missing training progress for playerId=' + playerId
  );
});

console.log('squad parser ok: ' + squadIds.length + ' players matched');
