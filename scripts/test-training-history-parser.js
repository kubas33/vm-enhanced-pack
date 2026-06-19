#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var parser = require('../vm-training-history-parser.js');

var root = path.resolve(__dirname, '..');

function fixtureBody(name) {
  return parser.parseAjaxVmBody(fs.readFileSync(path.join(root, 'raw_data', name), 'utf8'));
}

var beforeHtml = fixtureBody('training-panel.md');
var afterHtml = fixtureBody('training-made.md');
var coachesHtml = fixtureBody('coaches.md');
var infrastructureHtml = fixtureBody('infrastructure-building.md');

var before = parser.parseSeniorTrainingSnapshotFromHtml(beforeHtml);
var after = parser.parseSeniorTrainingSnapshotFromHtml(afterHtml);
var beforeFromDomHtml = parser.parseSeniorTrainingSnapshotFromHtml(beforeHtml.replace(/Player&playerId=/g, 'Player&amp;playerId='));
var effects = parser.parseLastTrainingEffectsFromHtml(afterHtml);
var effectsFromDomHtml = parser.parseLastTrainingEffectsFromHtml(afterHtml.replace(/Player&playerId=/g, 'Player&amp;playerId='));
var coaches = parser.parseCoachesFromHtml(coachesHtml);
var infrastructure = parser.parseInfrastructureFromHtml(infrastructureHtml);
var efficiency = parser.calculateSeniorEfficiency(coaches, infrastructure, 'technical');
var session = parser.pairTrainingSnapshots(before, after, {
  capturedAt: '2026-06-18T12:00:00.000Z',
  coaches: coaches,
  infrastructure: infrastructure,
  efficiency: efficiency,
  lastEffects: effects,
});
var rows = parser.flattenSessionToRecords(session);

assert.strictEqual(before.selectedTrainingCode, 'UM_BLOK_AKTYWNY', 'expected selected senior training skill');
assert.strictEqual(before.selectedTrainingLabel, 'Blok', 'expected selected training label');
assert.deepStrictEqual(before.pool, { current: 33, max: 60 }, 'expected senior training pool');
assert.strictEqual(before.players.length, 24, 'expected 24 senior training rows before training');
assert.strictEqual(after.players.length, 24, 'expected 24 senior training rows after training');
assert.strictEqual(beforeFromDomHtml.players.length, 24, 'expected browser outerHTML encoded player links to parse');

var mansoBefore = before.players.find(function (player) { return player.playerId === '2060721'; });
var mansoAfter = after.players.find(function (player) { return player.playerId === '2060721'; });
var mansoRecord = session.records.find(function (record) { return record.playerId === '2060721'; });
var wojciechowskiBefore = before.players.find(function (player) { return player.playerId === '1903780'; });

assert.ok(mansoBefore, 'expected Manso before row');
assert.ok(mansoAfter, 'expected Manso after row');
assert.strictEqual(mansoBefore.selectedOption, 'wybrany', 'expected Manso to train selected skill');
assert.strictEqual(mansoBefore.trainedSkillCode, 'UM_BLOK_AKTYWNY', 'expected Manso trained skill');
assert.strictEqual(mansoBefore.trainedLevel, 34.9, 'expected Manso pre-training block level from fixture');
assert.strictEqual(mansoAfter.trainedLevel, 40.1, 'expected Manso post-training selected block level from after fixture');
assert.strictEqual(mansoRecord.levelBefore, 34.9, 'expected record level before');
assert.strictEqual(mansoRecord.levelAfter, 40.1, 'expected record level after');
assert.strictEqual(mansoRecord.delta, 5.2, 'expected record delta from fixture pair');
assert.strictEqual(wojciechowskiBefore.attributes.UM_USTAWIANIE, 40.9, 'expected hidden Ustawianie decimal value from player row');

var rapcanAfter = after.players.find(function (player) { return player.playerId === '2059902'; });
assert.ok(rapcanAfter, 'expected Rapcan after row');
assert.strictEqual(rapcanAfter.selectedOption, 'odp', 'expected Rapcan to train stress resistance in after fixture');
assert.strictEqual(rapcanAfter.trainedSkillCode, 'ODPORNOSC', 'expected stress training code');
assert.strictEqual(rapcanAfter.trainingKind, 'psychological', 'expected stress training kind');
assert.strictEqual(rapcanAfter.trainedLevel, 35, 'expected stress level from selected option cell');

var konarskiRecord = session.records.find(function (record) { return record.playerId === '1865181'; });
assert.ok(konarskiRecord, 'expected Konarski record');
assert.strictEqual(konarskiRecord.effectJumpReported, true, 'expected reported level jump for Konarski block training');

assert.strictEqual(effects.length, 2, 'expected two reported level jumps');
assert.strictEqual(effectsFromDomHtml.length, 2, 'expected browser outerHTML encoded effect links to parse');
assert.strictEqual(coaches.length, 3, 'expected three coach roles');
assert.strictEqual(coaches[0].attributes['Trening techniczny'], 30, 'expected head coach technical training');
assert.strictEqual(coaches[1].attributes['Zdolnosci adaptacyjne'], 30, 'expected assistant adaptability');
assert.strictEqual(infrastructure['Gabinet doradcow trenera'], 15, 'expected technical building level');
assert.strictEqual(infrastructure['Hala treningowa'], 0, 'expected training hall level');

assert.ok(efficiency, 'expected technical efficiency');
assert.strictEqual(Math.round(efficiency.coachScore.weightedCoachScore * 10) / 10, 29.2, 'expected weighted coach score');
assert.strictEqual(Math.round(efficiency.rawTrainingMultiplier * 10000) / 10000, 1.1193, 'expected raw multiplier');
assert.strictEqual(Math.round(efficiency.normalizedEfficiency * 10000) / 10000, 0.9328, 'expected normalized efficiency');
assert.strictEqual(rows.length, 24, 'expected one CSV row per player');
assert.ok(parser.toCsv(rows).indexOf('normalized_efficiency') >= 0, 'expected CSV headers');

console.log('vm-training-history-parser: all tests passed');
