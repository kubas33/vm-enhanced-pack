#!/usr/bin/env node

'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');
var parser = require('../vm-junior-training-parser.js');
var positionRules = require('../vm-position-rules.js');
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

var scoutHtml = ''
  + '<TABLE><TR><TD><b>Kiełtyka, Aleksander (AKS, 16 lat)</b></TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Serwis</TD>'
  + '<TD width="70" align="right"><span class="link">12</span></TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Rozgrywanie</TD>'
  + '<TD width="70" align="right"><span class="link" OnClick="callGetViewPanelBody_1(&quot;TrainingEffect&amp;playerId=1&quot;)">6</span></TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Atak ze skrzydła</TD>'
  + '<TD width="70" align="right">19</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Atak ze środka</TD>'
  + '<TD width="70" align="right">17</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Kiwka</TD>'
  + '<TD width="70" align="right">13</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Omijanie bloku</TD>'
  + '<TD width="70" align="right">18</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Ustawianie się do bloku</TD>'
  + '<TD width="70" align="right">18</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="140">Blok</TD>'
  + '<TD width="70" align="right">15</TD></TR>'
  + '<TR><TD>Pozycja</TD><TD align="right">Środkowy</TD></TR>'
  + '<TR><TD>Odporność na stres</TD><TD align="right">10</TD></TR>'
  + '<TR><TD><span onclick="YoungPlayerTempAccept()">Akceptuj</span></TD></TR></TABLE>';
var scoutCandidate = parser.parseScoutCandidateFromHtml(scoutHtml);

assert.ok(scoutCandidate, 'expected scout candidate from fixture');
assert.strictEqual(scoutCandidate.name, 'Kiełtyka, Aleksander', 'expected scout candidate name');
assert.strictEqual(scoutCandidate.age, 16, 'expected scout candidate age');
assert.strictEqual(scoutCandidate.position, 'Środkowy', 'expected scout candidate position');
assert.strictEqual(scoutCandidate.attributes.UM_USTAWIANIE, 18, 'expected Ustawianie from scout fixture');
assert.strictEqual(scoutCandidate.attributes.UM_ATAK_ZE_SKRZYDLA, 19, 'expected Atak ze skrzydla from scout fixture');
assert.strictEqual(scoutCandidate.attributes.UM_ROZGRYWANIE, 6, 'expected Rozgrywanie from scout fixture');
assert.strictEqual(scoutCandidate.attributes.UM_ODPORNOSC, undefined, 'non-trainable scout stats should be ignored');

assert.deepStrictEqual(
  positionRules.getRecommendedTrainableSkills(scoutCandidate.position, scoutCandidate.attributes)
    .map(function (skill) { return skill.code; }),
  [
    'UM_ATAK_ZE_SRODKA',
    'UM_OMIJANIE_BLOKU',
    'UM_USTAWIANIE',
    'UM_BLOK_AKTYWNY',
    'UM_SERWIS',
    'UM_KIWKA',
  ],
  'scout candidate should load primary then secondary skills'
);

var pastedScoutHtml = ''
  + '<TABLE><TR><TD><b>Werwiński, Franciszek (<span>AKS Andrut Kalisz</span>, 16 lat)</b></TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Serwis</TD><TD width="50" align=right>14</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Atak ze skrzydła</TD><TD width="50" align=right>19</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Kiwka</TD><TD width="50" align=right>13</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Atak z 2 linii</TD><TD width="50" align=right>14</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Omijanie bloku</TD><TD width="50" align=right>13</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Obrona</TD><TD width="50" align=right>14</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Asekuracja</TD><TD width="50" align=right>13</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Ustawianie się do bloku</TD><TD width="50" align=right>13</TD></TR>'
  + '<TR><TD width="1"></TD><TD width="160">Blok</TD><TD width="50" align=right>15</TD></TR>'
  + '<TR><TD width=100>Wzrost</TD><TD align=right width=100>186 cm</TD></TR>'
  + '<TR><TD>Pozycja</TD><TD align=right>Atakujący</TD></TR>'
  + '<TR><TD><span onclick="YoungPlayerTempAccept()">Akceptuj propozycję</span></TD></TR></TABLE>';
var pastedScoutCandidate = parser.parseScoutCandidateFromHtml(pastedScoutHtml);
var pastedScoutRecommended = positionRules.getRecommendedTrainableSkills(
  pastedScoutCandidate.position,
  pastedScoutCandidate.attributes
);

assert.strictEqual(pastedScoutCandidate.position, 'Atakujący', 'expected position from pasted scout html');
assert.strictEqual(pastedScoutCandidate.attributes.UM_ATAK_ZE_SKRZYDLA, 19, 'expected l-stroke attribute label to parse');
assert.deepStrictEqual(
  pastedScoutRecommended.map(function (skill) { return skill.code; }),
  [
    'UM_USTAWIANIE',
    'UM_BLOK_AKTYWNY',
    'UM_ASEKURACJA',
    'UM_OBRONA',
    'UM_SERWIS',
    'UM_ATAK_ZE_SKRZYDLA',
    'UM_KIWKA',
    'UM_ATAK_2L',
    'UM_OMIJANIE_BLOKU',
  ],
  'pasted scout html should load attacker primary then secondary skills'
);

var poolHtml = ''
  + "<FORM id='trening_options'>Punkty treningowe: 33/60</FORM>"
  + "<FORM id='young_trening_options'>Punkty treningowe: 12/40</FORM>";
var juniorPool = parser.parseJuniorTrainingPoolFromHtml(poolHtml, 40);

assert.deepStrictEqual(juniorPool, { current: 12, max: 40 }, 'junior pool should come from young_trening_options only');

var seniorOnlyHtml = "<FORM id='trening_options'>Punkty treningowe: 33/60</FORM>";
assert.strictEqual(parser.parseJuniorTrainingPoolFromHtml(seniorOnlyHtml, 40), null, 'senior 33/60 must not be used as junior pool');

var poolByCap = parser.parseJuniorTrainingPoolFromHtml('Punkty treningowe: 18/40 i cos dalej', 40);
assert.deepStrictEqual(poolByCap, { current: 18, max: 40 }, 'pool line with /40 should be detected without form id');

var actions = parser.discoverJuniorTrainingActionsFromHtml("callGetViewPanelBody('YoungTrening');");
assert.ok(actions.indexOf('YoungTrening') >= 0, 'expected YoungTrening action discovery');

assert.strictEqual(
  parser.buildTrainingAjaxUrl('YoungTrening'),
  '/Ajax_handler.php?phpsite=view_body.php&action=YoungTrening',
  'expected junior training ajax url'
);

console.log('vm-junior-training-parser: all tests passed');
