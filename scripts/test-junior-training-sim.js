#!/usr/bin/env node

'use strict';

var assert = require('assert');
var sim = require('../vm-junior-training-sim.js');

assert.strictEqual(sim.trainingsRequiredForSkill(7, 30, 16), 135, '7->30 at age 16 should cost 135 trainings');
assert.strictEqual(sim.trainingsRequiredForSkill(7, 30.5, 16), 137, '7->30.5 at age 16 should cost 137 trainings');
assert.strictEqual(sim.trainingsRequiredForSkill(30.3, 30.5, 18), 2, '30.3->30.5 at age 18 should need ~2 trainings');
assert.strictEqual(sim.trainingsRequiredForSkill(29.8, 30.5, 18), 6, '29.8->30.5 at age 18 should need 2+4 trainings');

var soloResult = sim.simulate({
  age: 16,
  daysLeftInSeason: 500,
  seasonDays: 90,
  trainingPool: 0,
  strategy: 'priority',
  skills: [{ code: 'UM_PRZYJECIE', level: 7, targetLevel: 30.5 }],
});

assert.strictEqual(soloResult.totalLevelUps, 24, '7->30.5 should produce 24 attribute level-ups');
assert.strictEqual(soloResult.skills[0].levelUps, 24, 'single skill should track its own level-ups');
assert.strictEqual(soloResult.skills[0].trainingsUsed, 137, '7->30.5 should use 137 trainings on that skill');
assert.strictEqual(soloResult.skills[0].reachedTarget, true);
assert.strictEqual(sim.sessionsToLevelUp(30, 16), 2, '30->30.5 full band at age 16');
assert.strictEqual(sim.sessionsToLevelUp(30.3, 18), 2, '30.3->30.5 proportional at age 18');
assert.strictEqual(sim.sessionsToLevelUp(14, 16), 5, '14->15 should still use tier below 15');
assert.strictEqual(sim.sessionsToLevelUp(15, 16), 6, '15->16 should use tier below 25');
assert.strictEqual(sim.sessionsToLevelUp(25, 17), 8, 'age 17 adds +1 to tier 25+ cost');
assert.strictEqual(sim.totalTrainingBudget(33, 100), 433, 'budget with 33 start pool and 100 days');
assert.strictEqual(sim.totalTrainingBudget(0, 10), 40, 'budget with empty pool and 10 days');
assert.strictEqual(sim.getCareerDays(16, 45, 90), 45 + 90 + 90, '16yo with 45 days left gets 3 season chunks');

var tightInput = {
  age: 18,
  daysLeftInSeason: 36,
  seasonDays: 90,
  trainingPool: 0,
  skills: [
    { code: 'UM_PRZYJECIE', level: 7, targetLevel: 30.5 },
    { code: 'UM_OBRONA', level: 7, targetLevel: 30.5 },
  ],
};

var priorityResult = sim.simulate(Object.assign({}, tightInput, { strategy: 'priority' }));

assert(
  priorityResult.skills[0].level > priorityResult.skills[1].level,
  'priority should advance first skill further than second with limited budget'
);

var rotationResult = sim.simulate(Object.assign({}, tightInput, { strategy: 'roundRobin' }));

assert(
  rotationResult.skills[1].level > priorityResult.skills[1].level,
  'rotation should develop second skill further than priority strategy'
);

var comparison = sim.compareStrategies({
  age: 16,
  daysLeftInSeason: 120,
  seasonDays: 90,
  trainingPool: 10,
  skills: [{ code: 'UM_PRZYJECIE', level: 20, targetLevel: 30.5 }],
}, ['priority', 'roundRobin']);

assert.strictEqual(comparison.length, 2, 'compareStrategies should return one result per strategy');
assert.strictEqual(comparison[0].strategy, 'priority');
assert.strictEqual(comparison[1].strategy, 'roundRobin');

console.log('vm-junior-training-sim: all tests passed');
