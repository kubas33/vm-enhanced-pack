// ==UserScript==
// @name         VM Junior Training Parser
// @namespace    https://vm-manager.org/
// @version      1.1.4
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
  var JUNIOR_FORM_ID = 'young_trening_options';
  var MAX_JUNIOR_LEVEL = 30.5;
  var DEFAULT_JUNIOR_POOL_CAP = 40;
  var SCOUT_ACCEPT_MARKER = 'YoungPlayerTempAccept';
  var DEFAULT_JUNIOR_TRAINING_ACTIONS = [
    'YoungTrening',
    'YoungTraining',
    'Young_trening',
  ];

  var SCOUT_SKILL_LABEL_TO_CODE = {
    'serwis': 'UM_SERWIS',
    'sila serwisu': 'UM_SILA_SERWISU',
    'atak ze skrzydla': 'UM_ATAK_ZE_SKRZYDLA',
    'atak ze srodka': 'UM_ATAK_ZE_SRODKA',
    'kiwka': 'UM_KIWKA',
    'atak z 2 linii': 'UM_ATAK_2L',
    'omijanie bloku': 'UM_OMIJANIE_BLOKU',
    'atak blok-aut': 'UM_ATAK_BO',
    'rozgrywanie': 'UM_ROZGRYWANIE',
    'wystawa': 'UM_WYSTAWA',
    'przyjecie': 'UM_PRZYJECIE',
    'obrona': 'UM_OBRONA',
    'asekuracja': 'UM_ASEKURACJA',
    'ustawianie sie do bloku': 'UM_USTAWIANIE',
    'blok pasywny': 'UM_BLOK_PASYWNY',
    'blok': 'UM_BLOK_AKTYWNY',
  };

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

  function normalizeSkillLabel(label) {
    return String(label || '')
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[★•]\s*/, '')
      .trim();
  }

  function htmlToText(html) {
    return String(html || '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&euro;/gi, '€')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#039;/gi, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getTableRowsFromHtml(html) {
    var rows = [];
    var rowRegex = /<TR\b[^>]*>([\s\S]*?)<\/TR>/gi;
    var cellRegex = /<TD\b[^>]*>([\s\S]*?)<\/TD>/gi;
    var rowMatch;
    var cellMatch;
    var cells;

    while ((rowMatch = rowRegex.exec(String(html || ''))) !== null) {
      cells = [];
      cellRegex.lastIndex = 0;

      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(htmlToText(cellMatch[1]));
      }

      if (cells.length >= 2) {
        rows.push(cells);
      }
    }

    return rows;
  }

  function getTableRowsFromDom(root) {
    var scope = root && root.querySelectorAll ? root : null;

    if (!scope) {
      return [];
    }

    return Array.prototype.map.call(scope.querySelectorAll('tr'), function (row) {
      return Array.prototype.map.call(row.children || [], function (cell) {
        return htmlToText(cell.textContent || '');
      });
    }).filter(function (cells) {
      return cells.length >= 2;
    });
  }

  function unescapeVmString(value) {
    return String(value || '')
      .replace(/\\'/g, "'")
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\\\/g, '\\');
  }

  function parseAjaxVmBody(responseText) {
    var parsed;
    var bodyMatch;

    if (!responseText) {
      return '';
    }

    try {
      parsed = JSON.parse(responseText);
      if (parsed && typeof parsed.body === 'string') {
        return parsed.body;
      }
    } catch (error) {
      // VM ajax responses are often object-like strings rather than strict JSON.
    }

    bodyMatch = String(responseText).match(/body:\s*'((?:\\'|[^'])*)'/);
    if (bodyMatch) {
      return unescapeVmString(bodyMatch[1]);
    }

    return String(responseText);
  }

  function extractJuniorTrainingSection(html) {
    var source = String(html || '');
    var markers = [
      "id='" + JUNIOR_FORM_ID + "'",
      'id="' + JUNIOR_FORM_ID + '"',
      'id=' + JUNIOR_FORM_ID,
    ];
    var start = -1;
    var i;

    for (i = 0; i < markers.length; i += 1) {
      start = source.indexOf(markers[i]);
      if (start >= 0) {
        break;
      }
    }

    if (start < 0) {
      return '';
    }

    var section = source.slice(start);
    var closeForm = section.search(/<\/FORM>/i);

    if (closeForm >= 0) {
      return section.slice(0, closeForm);
    }

    return section.slice(0, 15000);
  }

  function parsePoolMatch(match, poolCap, requireCapMax) {
    if (!match) {
      return null;
    }

    var current = parseNumber(match[1]);
    var max = parseNumber(match[2]);

    if (current === null || max === null) {
      return null;
    }

    if (requireCapMax && max !== poolCap) {
      return null;
    }

    return {
      current: current,
      max: Math.min(max, poolCap),
    };
  }

  function parseJuniorPoolLinesFromHtml(html, poolCap) {
    var cap = poolCap == null ? DEFAULT_JUNIOR_POOL_CAP : poolCap;
    var source = String(html || '');
    var regex = /Punkty treningowe:\s*(\d+)\s*\/\s*(\d+)/gi;
    var match;

    while ((match = regex.exec(source)) !== null) {
      var parsed = parsePoolMatch(match, cap, true);

      if (parsed) {
        return parsed;
      }
    }

    return null;
  }

  function parseJuniorTrainingPoolFromHtml(html, poolCap) {
    var cap = poolCap == null ? DEFAULT_JUNIOR_POOL_CAP : poolCap;
    var section = extractJuniorTrainingSection(html);

    if (section) {
      var sectionPool = parsePoolMatch(
        section.match(/Punkty treningowe:\s*(\d+)\s*\/\s*(\d+)/i),
        cap
      );

      if (sectionPool) {
        return sectionPool;
      }
    }

    return parseJuniorPoolLinesFromHtml(html, cap);
  }

  function discoverJuniorTrainingActionsFromHtml(html) {
    var source = String(html || '');
    var actions = [];
    var regex = /callGetViewPanel(?:MenuAnd)?Body(?:Big_1)?\(\s*'([^']+)'\s*(?:,\s*'([^']+)')?\s*\)/gi;
    var match;
    var i;
    var parts;

    function addAction(action) {
      if (!action || actions.indexOf(action) >= 0) {
        return;
      }

      if (/young|mlod|młod|junior|trening/i.test(action)) {
        actions.push(action);
      }
    }

    while ((match = regex.exec(source)) !== null) {
      parts = [match[1], match[2]];

      for (i = 0; i < parts.length; i += 1) {
        addAction(parts[i]);
      }
    }

    DEFAULT_JUNIOR_TRAINING_ACTIONS.forEach(function (action) {
      addAction(action);
    });

    return actions;
  }

  function buildTrainingAjaxUrl(action) {
    var actionValue = String(action || '').trim();
    var segments;
    var params;
    var j;
    var pair;

    if (!actionValue) {
      return '';
    }

    segments = actionValue.split('&');
    params = ['phpsite=view_body.php', 'action=' + encodeURIComponent(segments[0])];

    for (j = 1; j < segments.length; j += 1) {
      pair = segments[j].split('=');

      if (pair.length >= 2) {
        params.push(encodeURIComponent(pair[0]) + '=' + encodeURIComponent(pair.slice(1).join('=')));
      }
    }

    return '/Ajax_handler.php?' + params.join('&');
  }

  function findScoutCandidateContainer(root) {
    var scope = root && root.querySelector ? root : null;

    if (!scope) {
      return null;
    }

    var accept = scope.querySelector('[onclick*="' + SCOUT_ACCEPT_MARKER + '"]');

    if (!accept) {
      return null;
    }

    var container = accept;

    while (container && container !== scope) {
      var text = container.textContent || '';

      if (text.indexOf('Akceptuj') >= 0 && text.indexOf('Serwis') >= 0) {
        return container;
      }

      container = container.parentElement;
    }

    return null;
  }

  function parseScoutAttributesFromRows(rows) {
    var attributes = {};
    var i;
    var cells;
    var label;
    var code;
    var value;

    for (i = 0; i < rows.length; i += 1) {
      cells = rows[i].filter(function (cell) {
        return cell !== '';
      });

      if (cells.length < 2) {
        continue;
      }

      label = cells[cells.length - 2];
      code = SCOUT_SKILL_LABEL_TO_CODE[normalizeSkillLabel(label)];

      if (!code) {
        continue;
      }

      value = parseNumber(cells[cells.length - 1]);

      if (value !== null && !Number.isNaN(value)) {
        attributes[code] = value;
      }
    }

    return attributes;
  }

  function parseScoutAttributesFromHtml(html) {
    return parseScoutAttributesFromRows(getTableRowsFromHtml(html));
  }

  function parseScoutHeaderFromHtml(html) {
    var source = String(html || '');
    var acceptIdx = source.indexOf(SCOUT_ACCEPT_MARKER);
    var chunk = acceptIdx >= 0 ? source.slice(0, acceptIdx) : source;
    var headerRe = />([^<]+,\s*[^<]+?)\s*\([^)]*?(\d{1,2})\s*lat\)/gi;
    var match;
    var name = '';
    var age = null;

    while ((match = headerRe.exec(chunk)) !== null) {
      name = match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      age = Number(match[2]);
    }

    return {
      name: name,
      age: Number.isFinite(age) ? age : null,
    };
  }

  function parseScoutPositionFromRows(rows) {
    var i;
    var cells;

    for (i = 0; i < rows.length; i += 1) {
      cells = rows[i].filter(function (cell) {
        return cell !== '';
      });

      if (cells.length >= 2 && normalizeSkillLabel(cells[cells.length - 2]) === 'pozycja') {
        return cells[cells.length - 1];
      }
    }

    return '';
  }

  function parseScoutPositionFromHtml(html) {
    return parseScoutPositionFromRows(getTableRowsFromHtml(html));
  }

  function parseScoutCandidateFromHtml(html) {
    var source = String(html || '');

    if (source.indexOf(SCOUT_ACCEPT_MARKER) < 0) {
      return null;
    }

    var header = parseScoutHeaderFromHtml(source);
    var attributes = parseScoutAttributesFromHtml(source);

    if (!header.name && !Object.keys(attributes).length) {
      return null;
    }

    return {
      playerId: 'scout',
      name: header.name,
      age: header.age,
      position: parseScoutPositionFromHtml(source),
      attributes: attributes,
    };
  }

  function parseScoutCandidateFromRoot(root) {
    var container = findScoutCandidateContainer(root || document);
    var candidate;
    var rows;
    var attributes;
    var position;

    if (!container) {
      return null;
    }

    candidate = parseScoutCandidateFromHtml(container.innerHTML || container.outerHTML || '');

    if (!candidate) {
      return null;
    }

    rows = getTableRowsFromDom(container);
    attributes = parseScoutAttributesFromRows(rows);
    position = parseScoutPositionFromRows(rows);

    if (Object.keys(attributes).length) {
      candidate.attributes = attributes;
    }

    if (position) {
      candidate.position = position;
    }

    return candidate;
  }

  function isScoutView(root) {
    var scope = root && root.querySelector ? root : document;
    return Boolean(scope.querySelector('[onclick*="' + SCOUT_ACCEPT_MARKER + '"]'));
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
    JUNIOR_FORM_ID: JUNIOR_FORM_ID,
    MAX_JUNIOR_LEVEL: MAX_JUNIOR_LEVEL,
    DEFAULT_JUNIOR_POOL_CAP: DEFAULT_JUNIOR_POOL_CAP,
    parseNumber: parseNumber,
    parseAjaxVmBody: parseAjaxVmBody,
    parseAttributesFromHtml: parseAttributesFromHtml,
    DEFAULT_JUNIOR_TRAINING_ACTIONS: DEFAULT_JUNIOR_TRAINING_ACTIONS,
    parseJuniorTrainingPoolFromHtml: parseJuniorTrainingPoolFromHtml,
    discoverJuniorTrainingActionsFromHtml: discoverJuniorTrainingActionsFromHtml,
    buildTrainingAjaxUrl: buildTrainingAjaxUrl,
    parsePlayerFromRow: parsePlayerFromRow,
    parseJuniorPlayersFromForm: parseJuniorPlayersFromForm,
    parseScoutCandidateFromHtml: parseScoutCandidateFromHtml,
    parseScoutCandidateFromRoot: parseScoutCandidateFromRoot,
    findScoutCandidateContainer: findScoutCandidateContainer,
    isScoutView: isScoutView,
    getTrainableSkills: getTrainableSkills,
  };
}));
