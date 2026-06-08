#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var parser = require('../vm-junior-training-parser.js');
var squadEnhancer = require('../vm-squad-view-enhancer.user.js');

var root = path.resolve(__dirname, '..');
var trainingFixture = fs.readFileSync(path.join(root, 'raw_data', 'training-panel.md'), 'utf8');
var trainingHtml = squadEnhancer.extractVmBody(trainingFixture);
var rowHtml = trainingHtml.slice(trainingHtml.indexOf('playerId=1646544') - 200, trainingHtml.indexOf('playerId=1646544') + 3200);
var rowAttributes = parser.parseAttributesFromHtml(rowHtml);

assert.strictEqual(rowAttributes.UM_PRZYJECIE, 16, 'expected Przyjecie value from training row html');
assert.strictEqual(rowAttributes.UM_BLOK_AKTYWNY, 8.4, 'expected Blok value from training row html');
assert.ok(Object.keys(rowAttributes).length >= 10, 'expected multiple attributes in training row html');

assert.strictEqual(rowAttributes.UM_SERWIS, 13.7, 'expected Serwis from single player row html');

var trainable = parser.getTrainableSkills(rowAttributes);

assert.ok(trainable.length > 0, 'expected trainable skills');
assert.ok(trainable.every(function (skill) { return skill.level < 30.5; }), 'trainable skills should be below max');

console.log('vm-junior-training-parser: all tests passed');
