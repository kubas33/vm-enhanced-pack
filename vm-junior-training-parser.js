// ==UserScript==
// @name         VM Junior Training Parser
// @namespace    https://vm-manager.org/
// @version      1.0.0
// @description  Parses junior player data from VM Manager training view HTML/DOM.
// @grant        none
// @run-at       document-start
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-parser.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-parser.js
// ==/UserScript==

(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.VMJuniorTrainingParser = api;
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var INPUT_PREFIX = 'young_trening_option_';
  var MAX_JUNIOR_LEVEL = 30.5;

  function parseNumber(value) {
    var match = String(value || '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function parseAttributesFromHtml(html) {
    var result = {};
    var source = String(html || '');
    var regex = /span_player_value_(UM_[A-Z0-9_]+)[^>]*>[\s\S]*?<font class=['"]?link['"]?>\(([-\d.,]+)\)/g;
    var match;

    while ((match = regex.exec(source)) !== null) {
      var value = parseNumber(match[2]);
      if (value !== null && !Number.isNaN(value)) {
        result[match[1]] = value;
      }
    }

    return result;
  }

  function parsePlayerIdFromName(name) {
    var match = String(name || '').match(/young_trening_option_(\d+)/);
    return match ? match[1] : null;
  }

  function parsePlayerIdFromRow(row) {
    var link = row ? row.querySelector('.small_link[onclick*="playerId="]') : null;
    var match = link && link.getAttribute('onclick')
      ? link.getAttribute('onclick').match(/playerId=(\d+)/)
      : null;

    if (match) {
      return match[1];
    }

    var input = row ? row.querySelector('input[type="radio"][name^="' + INPUT_PREFIX + '"]') : null;
    return input ? parsePlayerIdFromName(input.name) : null;
  }

  function parsePlayerNameFromRow(row) {
    var link = row ? row.querySelector('.small_link') : null;

    if (!link) {
      return '';
    }

    return String(link.textContent || '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\(\d{1,2}\s*lat[^)]*\)\s*$/, '')
      .trim();
  }

  function parseAgeFromRow(row) {
    var link = row ? row.querySelector('.small_link') : null;
    var match = link ? String(link.textContent || '').match(/\((\d{1,2})\s*lat/i) : null;
    return match ? Number(match[1]) : null;
  }

  function parsePositionFromRow(row) {
    var node = row ? row.querySelector('font.green') : null;
    return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : '';
  }

  function getPlayerRowHtml(row) {
    if (!row) {
      return '';
    }

    var html = row.outerHTML || '';
    var next = row.nextElementSibling;

    if (next && next.querySelector && next.querySelector('td.second_bottom_left')) {
      html += next.outerHTML || '';
    }

    return html;
  }

  function parsePlayerFromRow(row) {
    var playerId = parsePlayerIdFromRow(row);

    if (!playerId) {
      return null;
    }

    return {
      playerId: playerId,
      name: parsePlayerNameFromRow(row),
      age: parseAgeFromRow(row),
      position: parsePositionFromRow(row),
      attributes: parseAttributesFromHtml(getPlayerRowHtml(row)),
    };
  }

  function getPlayerRowsFromForm(form, inputPrefix) {
    var prefix = inputPrefix || INPUT_PREFIX;
    var names = {};
    var rows = [];
    var inputs = form.querySelectorAll('input[type="radio"][name^="' + prefix + '"]');
    var i;
    var input;
    var row;

    for (i = 0; i < inputs.length; i += 1) {
      input = inputs[i];
      if (names[input.name]) {
        continue;
      }
      names[input.name] = true;
      row = input.closest('tr');
      if (!row || !row.querySelector('.small_link')) {
        continue;
      }
      rows.push(row);
    }

    return rows;
  }

  function parseJuniorPlayersFromForm(form) {
    var players = [];
    var seen = {};
    var rows = getPlayerRowsFromForm(form, INPUT_PREFIX);
    var i;
    var player;

    for (i = 0; i < rows.length; i += 1) {
      player = parsePlayerFromRow(rows[i]);
      if (!player || seen[player.playerId]) {
        continue;
      }
      seen[player.playerId] = true;
      players.push(player);
    }

    return players;
  }

  function getTrainableSkills(attributes, maxLevel) {
    var limit = maxLevel == null ? MAX_JUNIOR_LEVEL : maxLevel;
    return Object.keys(attributes || {})
      .filter(function (code) {
        return attributes[code] < limit - 0.001;
      })
      .sort(function (left, right) {
        return attributes[right] - attributes[left];
      })
      .map(function (code) {
        return {
          code: code,
          level: attributes[code],
          targetLevel: MAX_JUNIOR_LEVEL,
        };
      });
  }

  return {
    INPUT_PREFIX: INPUT_PREFIX,
    MAX_JUNIOR_LEVEL: MAX_JUNIOR_LEVEL,
    parseNumber: parseNumber,
    parseAttributesFromHtml: parseAttributesFromHtml,
    parsePlayerFromRow: parsePlayerFromRow,
    parseJuniorPlayersFromForm: parseJuniorPlayersFromForm,
    getTrainableSkills: getTrainableSkills,
  };
}));
