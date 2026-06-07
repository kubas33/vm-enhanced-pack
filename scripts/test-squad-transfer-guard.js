#!/usr/bin/env node

'use strict';

var assert = require('assert');
var squadEnhancer = require('../vm-squad-view-enhancer.user.js');

function createMockDocument(options) {
  var ids = options.ids || {};
  var rows = options.rows || [];

  return {
    getElementById: function (id) {
      return ids[id] ? {} : null;
    },
    querySelectorAll: function (selector) {
      if (selector === 'tr') {
        return rows;
      }
      if (selector === '.vms-filter-panel') {
        return options.filterPanels || [];
      }
      return [];
    },
    body: {
      removeAttribute: function () {}
    }
  };
}

function createMockRow(cellTexts, html) {
  var rowHtml = html || cellTexts.join(' ');
  var playerOnclick = "callGetViewPanelMenuAndBody('Player&playerId=1949633','Player&playerId=1949633');";

  var linkCell = {
    textContent: '',
    getAttribute: function (name) {
      return name === 'onclick' || name === 'OnClick' ? playerOnclick : null;
    },
    querySelectorAll: function (selector) {
      if (selector === '[onclick], [OnClick]') {
        return [linkCell];
      }
      return [];
    }
  };

  return {
    children: cellTexts.map(function (text, index) {
      return index === 0 ? linkCell : { textContent: text };
    }),
    querySelector: function (selector) {
      if (selector === 'font.green_small') {
        return /green_small/.test(rowHtml) ? {} : null;
      }
      return null;
    },
    textContent: rowHtml
  };
}

var transferListDoc = createMockDocument({
  ids: { search_count: true }
});

var transferHeaderDoc = createMockDocument({
  rows: [createMockRow(['Data', 'Zawodnik', 'Wiek', 'Ser', 'SilaS', 'Cena'])]
});

var transferPlayerRow = createMockRow(
  ['', '', '07.06', 'POL', 'Śr', 'Niemczyk', '23', '15', '39 988 €'],
  '<font class="green_small">Śr</font> Niemczyk 39 988 €'
);

var squadPlayerRow = createMockRow(
  ['', '', 'POL', 'At', 'Manso', '23', '201', '12', '1 000 €'],
  '<font class="green">At</font> Manso 1 000 €'
);

assert.strictEqual(
  squadEnhancer.isTransferListDocument(transferListDoc),
  true,
  'search_count should identify transfer list'
);
assert.strictEqual(
  squadEnhancer.isTransferListDocument(transferHeaderDoc),
  true,
  'transfer header columns should identify transfer list'
);
assert.strictEqual(
  squadEnhancer.isSquadPlayerRow(transferPlayerRow),
  false,
  'transfer rows with green_small must be ignored'
);
assert.strictEqual(
  squadEnhancer.isSquadPlayerRow(squadPlayerRow),
  true,
  'squad rows without green_small should still match'
);

console.log('squad transfer guard ok');
