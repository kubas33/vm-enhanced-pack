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

var scoutFixture = fs.readFileSync(path.join(root, 'raw_data', 'scout-panel.md'), 'utf8');
var scoutHtml = parser.parseAjaxVmBody(scoutFixture);
var scoutCandidate = parser.parseScoutCandidateFromHtml(scoutHtml);

assert.ok(scoutCandidate, 'expected scout candidate from fixture');
assert.strictEqual(scoutCandidate.name, 'Kiełtyka, Aleksander', 'expected scout candidate name');
assert.strictEqual(scoutCandidate.age, 16, 'expected scout candidate age');
assert.strictEqual(scoutCandidate.position, 'Środkowy', 'expected scout candidate position');
assert.strictEqual(scoutCandidate.attributes.UM_USTAWIANIE, 18, 'expected Ustawianie from scout fixture');
assert.strictEqual(scoutCandidate.attributes.UM_ROZGRYWANIE, 6, 'expected Rozgrywanie from scout fixture');
assert.strictEqual(scoutCandidate.attributes.UM_ODPORNOSC, undefined, 'non-trainable scout stats should be ignored');

var poolHtml = ''
  + "<FORM id='trening_options'>Punkty treningowe: 33/60</FORM>"
  + "<FORM id='young_trening_options'>Punkty treningowe: 12/40</FORM>";
var juniorPool = parser.parseJuniorTrainingPoolFromHtml(poolHtml, 40);

assert.deepStrictEqual(juniorPool, { current: 12, max: 40 }, 'junior pool should come from young_trening_options only');

console.log('vm-junior-training-parser: all tests passed');
