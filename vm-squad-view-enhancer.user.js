// ==UserScript==
// @name         VM Squad View Enhancer
// @namespace    https://vm-manager.org/
// @version      0.1.10
// @description  Enhances VM Manager squad view with training progress and position fit.
// @match        *://*.vm-manager.org/*
// @grant        none
// @run-at       document-end
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-squad-view-enhancer.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-squad-view-enhancer.user.js
// ==/UserScript==

(function (root, factory) {
  var api = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root && root.document) {
    api.start();
  }
}(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  var STYLE_ID = 'vms-style';
  var HEADER_CLASS = 'vms-training-header';
  var HEADER_SPACER_CLASS = 'vms-nationality-header';
  var FIT_HEADER_CLASS = 'vms-fit-header';
  var CELL_CLASS = 'vms-training-cell';
  var FIT_CELL_CLASS = 'vms-fit-cell';
  var FILTER_PANEL_CLASS = 'vms-filter-panel';
  var FILTER_CHECKBOX_CLASS = 'vms-position-filter';
  var FILTER_RESET_CLASS = 'vms-filter-reset';
  var SORTABLE_HEADER_CLASS = 'vms-sortable-header';
  var SORT_MARKER_CLASS = 'vms-sort-marker';
  var BAR_CLASS = 'vms-training-bar';
  var FILL_CLASS = 'vms-training-fill';
  var TEXT_CLASS = 'vms-training-text';
  var ENHANCED_TABLE_ATTR = 'data-vms-enhanced-table';
  var SQUAD_SIGNATURE_ATTR = 'data-vms-squad-signature';
  var TRAINING_URL = '/Ajax_handler.php?phpsite=view_body.php&action=Training';
  var CACHE_KEY = 'vms.trainingPlayerData.v2';
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var COLUMN_WIDTH = 64;
  var FIT_COLUMN_WIDTH = 58;
  var MAX_ATTRIBUTE = 50.5;
  var SORT_COLUMNS = {
    'Zawodnik': 'name',
    'Wiek': 'age',
    'Wzrost': 'height',
    'Przyd.': 'fit',
    'Forma': 'form',
    'Trening': 'training',
    'Doś.': 'experience',
    'Pensja': 'salary',
    'Wartość': 'value'
  };
  var POSITION_SHORT_NAMES = {
    'At': 'Atakujący',
    'L': 'Libero',
    'P': 'Przyjmujący',
    'R': 'Rozgrywający',
    'Sr': 'Środkowy',
    'Śr': 'Środkowy'
  };
  var POSITION_FILTERS = [
    { shortName: 'At', label: 'At' },
    { shortName: 'P', label: 'P' },
    { shortName: 'R', label: 'R' },
    { shortName: 'Śr', label: 'Śr' },
    { shortName: 'L', label: 'L' }
  ];
  var ATTRIBUTE_CODES = {
    UM_SERWIS: 'Serwis',
    UM_SILA_SERWISU: 'Siła serwisu',
    UM_PRZYJECIE: 'Przyjęcie',
    UM_ROZGRYWANIE: 'Rozgrywanie',
    UM_WYSTAWA: 'Wystawa',
    UM_ATAK_ZE_SKRZYDLA: 'Atak ze skrzydła',
    UM_ATAK_ZE_SRODKA: 'Atak ze środka',
    UM_ATAK_2L: 'Atak z 2 linii',
    UM_OMIJANIE_BLOKU: 'Omijanie bloku',
    UM_KIWKA: 'Kiwka',
    UM_ATAK_BO: 'Atak blok-aut',
    UM_OBRONA: 'Obrona',
    UM_ASEKURACJA: 'Asekuracja',
    UM_BLOK_AKTYWNY: 'Blok',
    UM_BLOK_PASYWNY: 'Blok pasywny',
    UM_USTAWIANIE: 'Ustawianie się do bloku'
  };
  var POSITION_RULES = {
    'Atakujący': {
      primary: ['Ustawianie się do bloku', 'Blok', 'Asekuracja', 'Obrona'],
      secondary: ['Serwis', 'Atak ze skrzydła', 'Kiwka', 'Atak z 2 linii', 'Omijanie bloku']
    },
    'Libero': {
      primary: ['Przyjęcie', 'Obrona', 'Asekuracja'],
      secondary: []
    },
    'Przyjmujący': {
      primary: ['Przyjęcie', 'Obrona', 'Asekuracja', 'Ustawianie się do bloku', 'Blok'],
      secondary: ['Serwis', 'Atak ze skrzydła', 'Kiwka', 'Atak z 2 linii', 'Omijanie bloku']
    },
    'Rozgrywający': {
      primary: ['Rozgrywanie', 'Wystawa', 'Obrona', 'Asekuracja'],
      secondary: ['Ustawianie się do bloku', 'Blok']
    },
    'Środkowy': {
      primary: ['Atak ze środka', 'Omijanie bloku', 'Ustawianie się do bloku', 'Blok'],
      secondary: ['Serwis', 'Kiwka']
    }
  };

  var scheduleTimer = null;
  var trainingPromise = null;
  var trainingState = {
    status: 'idle',
    values: null
  };

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
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

  function extractVmBody(responseText) {
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

  function parseSquadPlayerIdsFromHtml(html) {
    var ids = [];
    var seen = {};
    var regex = /Player&playerId=(\d+)/g;
    var match;

    while ((match = regex.exec(String(html || ''))) !== null) {
      if (!seen[match[1]]) {
        seen[match[1]] = true;
        ids.push(match[1]);
      }
    }

    return ids;
  }

  function parseTrainingPercentMapFromHtml(html) {
    var result = {};
    var data = parseTrainingPlayerDataFromHtml(html);

    Object.keys(data).forEach(function (playerId) {
      if (data[playerId].trainingPercent !== null) {
        result[playerId] = data[playerId].trainingPercent;
      }
    });

    return result;
  }

  function parseAttributeValue(value) {
    var match = normalizeText(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);

    return match ? Number(match[0]) : null;
  }

  function average(values) {
    if (!values.length) {
      return null;
    }

    return values.reduce(function (sum, value) {
      return sum + value;
    }, 0) / values.length;
  }

  function calculateSummary(position, attributes) {
    var rules = POSITION_RULES[position];
    var primary = [];
    var secondary = [];
    var weightedSum = 0;
    var weightTotal = 0;

    if (!rules) {
      return {
        primaryAverage: null,
        secondaryAverage: null,
        fit: null
      };
    }

    rules.primary.forEach(function (name) {
      if (typeof attributes[name] === 'number') {
        primary.push(attributes[name]);
        weightedSum += attributes[name];
        weightTotal += 1;
      }
    });

    rules.secondary.forEach(function (name) {
      if (typeof attributes[name] === 'number') {
        secondary.push(attributes[name]);
        weightedSum += attributes[name] * 0.5;
        weightTotal += 0.5;
      }
    });

    if (primary.length !== rules.primary.length) {
      weightTotal = 0;
    }

    return {
      primaryAverage: average(primary),
      secondaryAverage: average(secondary),
      fit: weightTotal > 0 ? (weightedSum / (MAX_ATTRIBUTE * weightTotal)) * 100 : null
    };
  }

  function parseTrainingPlayerDataFromHtml(html) {
    var result = {};
    var source = String(html || '');
    var rowRegex = /<tr><td class=(["'])second_left_right\1><\/td>[\s\S]*?Player&playerId=(\d+)[\s\S]*?<\/tr><tr><td class=(["'])second_bottom_left\3>/g;
    var rowMatch;

    while ((rowMatch = rowRegex.exec(source)) !== null) {
      var rowHtml = rowMatch[0];
      var playerId = rowMatch[2];
      var positionMatch = rowHtml.match(/<font class=green>([^<]+)<\/font>/);
      var percentMatch = rowHtml.match(/&nbsp;\s*(\d+)\s*%/);
      var attrRegex = /span_player_value_(UM_[A-Z0-9_]+)[^>]*>[\s\S]*?<font class=['"]?link['"]?>\(([-\d.,]+)\)/g;
      var attrMatch;
      var attributes = {};
      var position = positionMatch ? POSITION_SHORT_NAMES[normalizeText(positionMatch[1])] || '' : '';
      var trainingPercent = percentMatch ? Number(percentMatch[1]) : null;
      var summary;

      while ((attrMatch = attrRegex.exec(rowHtml)) !== null) {
        var name = ATTRIBUTE_CODES[attrMatch[1]];
        var value = parseAttributeValue(attrMatch[2]);

        if (name && value !== null && !Number.isNaN(value)) {
          attributes[name] = value;
        }
      }

      summary = calculateSummary(position, attributes);
      result[playerId] = {
        trainingPercent: trainingPercent === null || Number.isNaN(trainingPercent) ? null : Math.max(0, Math.min(100, trainingPercent)),
        position: position,
        attributes: attributes,
        fitSummary: summary
      };
    }

    return result;
  }

  function injectStyles(documentRef) {
    var style;

    if (documentRef.getElementById(STYLE_ID)) {
      return;
    }

    style = documentRef.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.vms-training-header {',
      '  color: #d7edf8;',
      '}',
      '.vms-nationality-header {',
      '  color: #d7edf8;',
      '}',
      '.vms-fit-header {',
      '  color: #d7edf8;',
      '}',
      '.vms-sortable-header {',
      '  cursor: pointer;',
      '  user-select: none;',
      '}',
      '.vms-sortable-header:hover {',
      '  color: #ffffff;',
      '}',
      '.vms-sort-marker {',
      '  display: inline-block;',
      '  width: 8px;',
      '  margin-left: 2px;',
      '  color: #8fd0ff;',
      '  font-size: 9px;',
      '  line-height: 1;',
      '  text-align: left;',
      '}',
      '.vms-training-cell {',
      '  box-sizing: border-box;',
      '  width: 64px;',
      '  min-width: 64px;',
      '  max-width: 64px;',
      '  white-space: nowrap;',
      '  padding-left: 3px;',
      '  padding-right: 3px;',
      '}',
      '.vms-fit-cell {',
      '  box-sizing: border-box;',
      '  width: 58px;',
      '  min-width: 58px;',
      '  max-width: 58px;',
      '  white-space: nowrap;',
      '  padding-left: 3px;',
      '  padding-right: 3px;',
      '}',
      '.vms-fit-value {',
      '  display: inline-block;',
      '  min-width: 42px;',
      '  font-weight: bold;',
      '  font-size: 10px;',
      '  line-height: 1;',
      '  text-align: right;',
      '}',
      '.vms-fit-missing {',
      '  color: #8fa8b8;',
      '  text-align: center;',
      '}',
      '.vms-fit-low { color: #d98b61; }',
      '.vms-fit-mid { color: #ffd45c; }',
      '.vms-fit-good { color: #73d87a; }',
      '.vms-fit-ready { color: #8fd0ff; }',
      '.vms-filter-panel {',
      '  margin: 0 0 2px 0;',
      '  padding: 5px 8px;',
      '  box-sizing: border-box;',
      '}',
      '.vms-filter-bar {',
      '  display: flex;',
      '  align-items: center;',
      '  gap: 6px;',
      '  flex-wrap: wrap;',
      '  color: #d7edf8;',
      '  font-size: 11px;',
      '}',
      '.vms-filter-title {',
      '  color: #9fb8c7;',
      '  margin-right: 2px;',
      '}',
      '.vms-filter-chip {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 3px;',
      '  padding: 2px 5px;',
      '  border: 1px solid rgba(80, 156, 202, 0.45);',
      '  background: rgba(1, 18, 28, 0.42);',
      '  cursor: pointer;',
      '  user-select: none;',
      '}',
      '.vms-filter-chip input {',
      '  margin: 0;',
      '}',
      '.vms-filter-reset {',
      '  margin-left: 4px;',
      '  padding: 2px 6px;',
      '  border: 1px solid rgba(80, 156, 202, 0.45);',
      '  background: rgba(7, 31, 48, 0.72);',
      '  color: #d7edf8;',
      '  font-size: 11px;',
      '  cursor: pointer;',
      '}',
      '.vms-training-wrap {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: flex-start;',
      '  gap: 4px;',
      '  width: 58px;',
      '  min-width: 58px;',
      '  vertical-align: middle;',
      '}',
      '.vms-training-bar {',
      '  position: relative;',
      '  display: inline-block;',
      '  width: 28px;',
      '  height: 7px;',
      '  overflow: hidden;',
      '  border: 1px solid rgba(80, 156, 202, 0.55);',
      '  background: rgba(1, 18, 28, 0.72);',
      '  box-sizing: border-box;',
      '}',
      '.vms-training-fill {',
      '  display: block;',
      '  height: 100%;',
      '  width: 0%;',
      '  background: #47a6dc;',
      '}',
      '.vms-training-text {',
      '  display: inline-block;',
      '  width: 24px;',
      '  color: #d7edf8;',
      '  font-size: 10px;',
      '  line-height: 1;',
      '  text-align: right;',
      '}',
      '.vms-training-loading .vms-training-text,',
      '.vms-training-missing .vms-training-text {',
      '  color: #8fa8b8;',
      '  text-align: center;',
      '}',
      '.vms-training-low .vms-training-fill { background: #b66b58; }',
      '.vms-training-mid .vms-training-fill { background: #d4b64f; }',
      '.vms-training-good .vms-training-fill { background: #4fad7c; }',
      '.vms-training-ready .vms-training-fill { background: #45b7e8; }',
      '.vms-training-low .vms-training-text { color: #d98b61; }',
      '.vms-training-mid .vms-training-text { color: #ffd45c; }',
      '.vms-training-good .vms-training-text { color: #73d87a; }',
      '.vms-training-ready .vms-training-text { color: #8fd0ff; }'
    ].join('\n');
    documentRef.head.appendChild(style);
  }

  function getPercentClass(percent) {
    if (percent <= 24) {
      return 'vms-training-low';
    }
    if (percent <= 59) {
      return 'vms-training-mid';
    }
    if (percent <= 84) {
      return 'vms-training-good';
    }
    return 'vms-training-ready';
  }

  function getFitClass(percent) {
    if (percent <= 39.9) {
      return 'vms-fit-low';
    }
    if (percent <= 59.9) {
      return 'vms-fit-mid';
    }
    if (percent <= 79.9) {
      return 'vms-fit-good';
    }
    return 'vms-fit-ready';
  }

  function parseNumber(value) {
    var normalized = normalizeText(value)
      .replace(/\u00a0/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/[^\d,.-]/g, '')
      .replace(/\s+/g, '')
      .replace(',', '.');
    var number;

    if (!/\d/.test(normalized)) {
      return null;
    }

    number = Number(normalized);

    return Number.isNaN(number) ? null : number;
  }

  function createTrainingContent(documentRef, state, percent) {
    var wrapper = documentRef.createElement('span');
    var bar = documentRef.createElement('span');
    var fill = documentRef.createElement('span');
    var text = documentRef.createElement('span');

    wrapper.className = 'vms-training-wrap';
    bar.className = BAR_CLASS;
    fill.className = FILL_CLASS;
    text.className = TEXT_CLASS;

    if (state === 'loading') {
      wrapper.className += ' vms-training-loading';
      text.textContent = '...';
    } else if (state === 'missing') {
      wrapper.className += ' vms-training-missing';
      text.textContent = '--';
    } else {
      wrapper.className += ' ' + getPercentClass(percent);
      fill.style.width = percent + '%';
      text.textContent = percent + '%';
    }

    bar.appendChild(fill);
    wrapper.appendChild(bar);
    wrapper.appendChild(text);

    return wrapper;
  }

  function setTrainingCell(cell, percent) {
    var state = percent === null ? 'missing' : 'ready';

    cell.textContent = '';
    cell.appendChild(createTrainingContent(cell.ownerDocument, state, percent));
  }

  function setTrainingCellLoading(cell) {
    cell.textContent = '';
    cell.appendChild(createTrainingContent(cell.ownerDocument, 'loading', null));
  }

  function formatAverage(value) {
    return value === null ? '--' : value.toFixed(1);
  }

  function createFitTitle(data) {
    var summary = data && data.fitSummary ? data.fitSummary : null;

    if (!summary || summary.fit === null) {
      return '';
    }

    return [
      'Kluczowe śr.: ' + formatAverage(summary.primaryAverage),
      'Drugorzędne śr.: ' + formatAverage(summary.secondaryAverage),
      'Pozycja: ' + (data.position || '--')
    ].join(' | ');
  }

  function setFitCell(cell, data) {
    var summary = data && data.fitSummary ? data.fitSummary : null;
    var fit = summary ? summary.fit : null;
    var value = cell.ownerDocument.createElement('span');

    cell.textContent = '';
    value.className = 'vms-fit-value';

    if (fit === null || Number.isNaN(fit)) {
      value.className += ' vms-fit-missing';
      value.textContent = '--';
      cell.removeAttribute('title');
      cell.removeAttribute('data-vms-fit-value');
    } else {
      value.className += ' ' + getFitClass(fit);
      value.textContent = fit.toFixed(1) + '%';
      cell.setAttribute('title', createFitTitle(data));
      cell.setAttribute('data-vms-fit-value', String(fit));
    }

    cell.appendChild(value);
  }

  function setFitCellLoading(cell) {
    var value = cell.ownerDocument.createElement('span');

    cell.textContent = '';
    cell.removeAttribute('title');
    cell.removeAttribute('data-vms-fit-value');
    value.className = 'vms-fit-value vms-fit-missing';
    value.textContent = '...';
    cell.appendChild(value);
  }

  function getPlayerIdFromRow(row) {
    var links = Array.prototype.slice.call(row.querySelectorAll('[onclick], [OnClick]'));
    var i;
    var text;
    var match;

    for (i = 0; i < links.length; i += 1) {
      text = links[i].getAttribute('onclick') || links[i].getAttribute('OnClick') || '';
      match = text.match(/Player&playerId=(\d+)/);
      if (match) {
        return match[1];
      }
    }

    return '';
  }

  function findPlayerLinkCell(row) {
    var cells = Array.prototype.slice.call(row.children);
    var i;

    for (i = 0; i < cells.length; i += 1) {
      if (getPlayerIdFromRow(cells[i])) {
        return {
          cell: cells[i],
          index: i
        };
      }
    }

    return null;
  }

  function normalizePositionShort(value) {
    var normalized = normalizeText(value);

    return normalized === 'Sr' ? 'Śr' : normalized;
  }

  function getPositionShortFromRow(row) {
    var marker = row.querySelector('font.green, .green');

    return marker ? normalizePositionShort(marker.textContent) : '';
  }

  function incrementTableColspans(table, targetAmount) {
    var cells;
    var currentAmount;
    var diff;

    if (!table) {
      return;
    }

    currentAmount = Number(table.getAttribute(ENHANCED_TABLE_ATTR)) || 0;
    diff = targetAmount - currentAmount;
    if (diff <= 0) {
      return;
    }

    cells = Array.prototype.slice.call(table.querySelectorAll('td[colspan]'));
    cells.forEach(function (cell) {
      var value = Number(cell.getAttribute('colspan'));
      if (!Number.isNaN(value) && value > 0) {
        cell.setAttribute('colspan', String(value + diff));
      }
    });

    table.setAttribute(ENHANCED_TABLE_ATTR, String(targetAmount));
  }

  function getActivePositionFilters(documentRef) {
    var checkboxes = Array.prototype.slice.call(documentRef.querySelectorAll('.' + FILTER_CHECKBOX_CLASS));
    var active = {};

    checkboxes.forEach(function (checkbox) {
      if (checkbox.checked) {
        active[checkbox.value] = true;
      }
    });

    return active;
  }

  function applyPositionFilter(documentRef) {
    var active = getActivePositionFilters(documentRef);
    var rows = findSquadPlayerRows(documentRef);

    rows.forEach(function (row) {
      var block = getPlayerBlock(row);
      var position = row.getAttribute('data-vms-position-short') || getPositionShortFromRow(row);
      var visible = Boolean(active[position]);

      if (!block) {
        return;
      }

      block.blockRow.style.display = visible ? '' : 'none';
      if (block.spacerRow) {
        block.spacerRow.style.display = visible ? '' : 'none';
      }
    });
  }

  function createPositionFilterControl(documentRef, item) {
    var label = documentRef.createElement('label');
    var input = documentRef.createElement('input');
    var text = documentRef.createElement('span');

    label.className = 'vms-filter-chip';
    input.className = FILTER_CHECKBOX_CLASS;
    input.type = 'checkbox';
    input.value = item.shortName;
    input.checked = true;
    text.textContent = item.label;
    input.addEventListener('change', function () {
      Array.prototype.slice.call(documentRef.querySelectorAll('.' + FILTER_CHECKBOX_CLASS)).forEach(function (checkbox) {
        if (checkbox.value === input.value) {
          checkbox.checked = input.checked;
        }
      });
      applyPositionFilter(documentRef);
    });

    label.appendChild(input);
    label.appendChild(text);

    return label;
  }

  function enhanceFilterPanel(headerRow) {
    var documentRef = headerRow.ownerDocument;
    var table = headerRow.closest('table');
    var parent = table ? table.parentNode : null;
    var oldRow = headerRow.parentNode.querySelector('.vms-filter-row');
    var existing = parent ? parent.querySelector('.' + FILTER_PANEL_CLASS) : null;
    var panel;
    var bar;
    var title;
    var reset;

    if (oldRow) {
      oldRow.remove();
    }

    if (existing) {
      return;
    }

    if (!parent || !table) {
      return;
    }

    panel = documentRef.createElement('div');
    bar = documentRef.createElement('span');
    title = documentRef.createElement('span');
    reset = documentRef.createElement('button');

    panel.className = FILTER_PANEL_CLASS;
    bar.className = 'vms-filter-bar';
    title.className = 'vms-filter-title';
    title.textContent = 'Pozycja:';
    reset.className = FILTER_RESET_CLASS;
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.addEventListener('click', function () {
      Array.prototype.slice.call(documentRef.querySelectorAll('.' + FILTER_CHECKBOX_CLASS)).forEach(function (checkbox) {
        checkbox.checked = true;
      });
      applyPositionFilter(documentRef);
    });

    bar.appendChild(title);
    POSITION_FILTERS.forEach(function (item) {
      bar.appendChild(createPositionFilterControl(documentRef, item));
    });
    bar.appendChild(reset);
    panel.appendChild(bar);
    parent.insertBefore(panel, table);
  }

  function ensureNationalityHeader(row) {
    var cells = Array.prototype.slice.call(row.children);
    var i;
    var playerHeaderCell;
    var spacerCell;

    if (row.querySelector('.' + HEADER_SPACER_CLASS)) {
      return false;
    }

    for (i = 0; i < cells.length; i += 1) {
      if (normalizeText(cells[i].textContent) === 'Zawodnik') {
        playerHeaderCell = cells[i];
        break;
      }
    }

    if (!playerHeaderCell) {
      return false;
    }

    spacerCell = playerHeaderCell.ownerDocument.createElement('td');
    spacerCell.className = playerHeaderCell.className + ' ' + HEADER_SPACER_CLASS;
    spacerCell.setAttribute('width', '24');
    spacerCell.setAttribute('align', 'center');
    spacerCell.innerHTML = '<b>&nbsp;</b>';
    playerHeaderCell.parentNode.insertBefore(spacerCell, playerHeaderCell.nextSibling);

    return true;
  }

  function enhanceHeaderRow(row) {
    var cells = Array.prototype.slice.call(row.children);
    var i;
    var formHeaderCell;
    var heightHeaderCell;
    var fitCell;
    var trainingCell;
    var addedNationalityHeader;

    addedNationalityHeader = ensureNationalityHeader(row);

    if (row.querySelector('.' + HEADER_CLASS) && row.querySelector('.' + FIT_HEADER_CLASS)) {
      if (addedNationalityHeader) {
        incrementTableColspans(row.closest('table'), 3);
      }
      enhanceFilterPanel(row);
      return;
    }

    cells = Array.prototype.slice.call(row.children);
    for (i = 0; i < cells.length; i += 1) {
      if (normalizeText(cells[i].textContent) === 'Forma') {
        formHeaderCell = cells[i];
      } else if (normalizeText(cells[i].textContent) === 'Wzrost') {
        heightHeaderCell = cells[i];
      }
    }

    if (!formHeaderCell || !heightHeaderCell) {
      return;
    }

    if (!row.querySelector('.' + FIT_HEADER_CLASS)) {
      fitCell = heightHeaderCell.ownerDocument.createElement('td');
      fitCell.className = heightHeaderCell.className + ' ' + FIT_HEADER_CLASS;
      fitCell.setAttribute('width', String(FIT_COLUMN_WIDTH));
      fitCell.setAttribute('align', 'center');
      fitCell.innerHTML = '<b>Przyd.</b>';
      heightHeaderCell.parentNode.insertBefore(fitCell, heightHeaderCell.nextSibling);
    }

    if (!row.querySelector('.' + HEADER_CLASS)) {
      trainingCell = formHeaderCell.ownerDocument.createElement('td');
      trainingCell.className = formHeaderCell.className + ' ' + HEADER_CLASS;
      trainingCell.setAttribute('width', String(COLUMN_WIDTH));
      trainingCell.setAttribute('align', 'center');
      trainingCell.innerHTML = '<b>Trening</b>';
      formHeaderCell.parentNode.insertBefore(trainingCell, formHeaderCell.nextSibling);
    }

    incrementTableColspans(row.closest('table'), 3);
    enhanceFilterPanel(row);
  }

  function getHeaderLabel(cell) {
    return normalizeText(cell.textContent).replace(/\s+[v^]$/, '');
  }

  function ensureSortMarker(cell) {
    var marker = cell.querySelector('.' + SORT_MARKER_CLASS);

    if (!marker) {
      marker = cell.ownerDocument.createElement('span');
      marker.className = SORT_MARKER_CLASS;
      marker.setAttribute('aria-hidden', 'true');
      cell.appendChild(marker);
    }

    return marker;
  }

  function updateSortMarkers(documentRef, activeKey, direction) {
    var headers = Array.prototype.slice.call(documentRef.querySelectorAll('.' + SORTABLE_HEADER_CLASS));

    headers.forEach(function (header) {
      var marker = ensureSortMarker(header);
      marker.textContent = header.getAttribute('data-vms-sort-key') === activeKey ? (direction === 'asc' ? '^' : 'v') : '';
    });
  }

  function enableHeaderSorting(row) {
    var cells = Array.prototype.slice.call(row.children);

    cells.forEach(function (cell) {
      var label = getHeaderLabel(cell);
      var sortKey = SORT_COLUMNS[label];

      if (!sortKey || cell.getAttribute('data-vms-sort-ready') === '1') {
        return;
      }

      cell.className += ' ' + SORTABLE_HEADER_CLASS;
      cell.setAttribute('data-vms-sort-ready', '1');
      cell.setAttribute('data-vms-sort-key', sortKey);
      cell.setAttribute('title', 'Sortuj po: ' + label);
      ensureSortMarker(cell);

      cell.addEventListener('click', function () {
        sortSquadBy(sortKey, cell.ownerDocument);
      });
    });
  }

  function findHeaderRows(documentRef) {
    var rows = Array.prototype.slice.call(documentRef.querySelectorAll('tr'));

    return rows.filter(function (row) {
      var cellTexts = Array.prototype.slice.call(row.children).map(function (cell) {
        return normalizeText(cell.textContent);
      });

      return cellTexts.indexOf('Forma') !== -1 &&
        cellTexts.some(function (text) { return text.indexOf('Zawodnik') !== -1; }) &&
        cellTexts.some(function (text) { return text.indexOf('Pensja') !== -1; }) &&
        cellTexts.some(function (text) { return text.indexOf('Wartość') !== -1; });
    });
  }

  function findSquadPlayerRows(documentRef) {
    var rows = Array.prototype.slice.call(documentRef.querySelectorAll('tr'));

    return rows.filter(function (row) {
      var link = findPlayerLinkCell(row);
      var text = normalizeText(row.textContent);
      return Boolean(link && row.children[link.index + 5] && text.indexOf('€') !== -1);
    });
  }

  function enhancePlayerRow(row) {
    var existing = row.querySelector('.' + CELL_CLASS);
    var linkInfo;
    var heightCellIndex;
    var formCellIndex;
    var heightCell;
    var formCell;
    var fitCell;
    var trainingCell;
    var playerId;

    linkInfo = findPlayerLinkCell(row);
    if (!linkInfo) {
      return null;
    }

    row.setAttribute('data-vms-position-short', getPositionShortFromRow(row));

    if (existing && row.querySelector('.' + FIT_CELL_CLASS)) {
      return existing;
    }

    heightCellIndex = linkInfo.index + 4;
    formCellIndex = linkInfo.index + 5;
    heightCell = row.children[heightCellIndex];
    formCell = row.children[formCellIndex];
    if (!heightCell || !formCell) {
      return null;
    }

    playerId = getPlayerIdFromRow(row);
    fitCell = row.querySelector('.' + FIT_CELL_CLASS);
    if (!fitCell) {
      fitCell = row.ownerDocument.createElement('td');
      fitCell.className = heightCell.className + ' ' + FIT_CELL_CLASS;
      fitCell.setAttribute('width', String(FIT_COLUMN_WIDTH));
      fitCell.setAttribute('align', 'center');
      fitCell.setAttribute('data-vms-player-id', playerId);
      setFitCellLoading(fitCell);
      heightCell.parentNode.insertBefore(fitCell, heightCell.nextSibling);
    }

    trainingCell = row.querySelector('.' + CELL_CLASS);
    if (!trainingCell) {
      trainingCell = row.ownerDocument.createElement('td');
      trainingCell.className = formCell.className + ' ' + CELL_CLASS;
      trainingCell.setAttribute('width', String(COLUMN_WIDTH));
      trainingCell.setAttribute('align', 'center');
      trainingCell.setAttribute('data-vms-player-id', playerId);
      setTrainingCellLoading(trainingCell);
      formCell.parentNode.insertBefore(trainingCell, formCell.nextSibling);
    }

    incrementTableColspans(row.closest('table'), 2);

    return trainingCell;
  }

  function getCellTextByIndex(row, index) {
    return row.children[index] ? normalizeText(row.children[index].textContent) : '';
  }

  function getSortValue(row, sortKey) {
    var linkInfo = findPlayerLinkCell(row);
    var text;
    var value;

    if (!linkInfo) {
      return null;
    }

    if (sortKey === 'name') {
      return getCellTextByIndex(row, linkInfo.index).toLocaleLowerCase();
    }

    if (sortKey === 'age') {
      return parseNumber(getCellTextByIndex(row, linkInfo.index + 3));
    }

    if (sortKey === 'height') {
      return parseNumber(getCellTextByIndex(row, linkInfo.index + 4));
    }

    if (sortKey === 'fit') {
      text = row.querySelector('.' + FIT_CELL_CLASS);
      return text ? parseNumber(text.getAttribute('data-vms-fit-value')) : null;
    }

    if (sortKey === 'form') {
      return parseNumber(getCellTextByIndex(row, linkInfo.index + 6));
    }

    if (sortKey === 'training') {
      text = row.querySelector('.' + CELL_CLASS + ' .' + TEXT_CLASS);
      return text ? parseNumber(text.textContent) : null;
    }

    if (sortKey === 'experience') {
      return parseNumber(getCellTextByIndex(row, linkInfo.index + 8));
    }

    if (sortKey === 'salary') {
      return parseNumber(getCellTextByIndex(row, linkInfo.index + 9));
    }

    if (sortKey === 'value') {
      value = parseNumber(getCellTextByIndex(row, linkInfo.index + 10));
      return value;
    }

    return null;
  }

  function getPlayerBlock(row) {
    var innerTable = row.closest('table');
    var tableCell = innerTable ? innerTable.parentNode : null;
    var blockRow = tableCell && tableCell.tagName && tableCell.tagName.toLowerCase() === 'td' ? tableCell.parentNode : null;
    var spacerRow = blockRow ? blockRow.nextElementSibling : null;

    if (!blockRow || !blockRow.parentNode || blockRow.tagName.toLowerCase() !== 'tr') {
      return null;
    }

    if (spacerRow && spacerRow.tagName.toLowerCase() === 'tr' && !getPlayerIdFromRow(spacerRow)) {
      return {
        row: row,
        blockRow: blockRow,
        spacerRow: spacerRow
      };
    }

    return {
      row: row,
      blockRow: blockRow,
      spacerRow: null
    };
  }

  function compareSortValues(left, right, direction) {
    var multiplier = direction === 'asc' ? 1 : -1;

    if (left.value === null && right.value === null) {
      return left.index - right.index;
    }
    if (left.value === null) {
      return 1;
    }
    if (right.value === null) {
      return -1;
    }
    if (typeof left.value === 'string' || typeof right.value === 'string') {
      return String(left.value).localeCompare(String(right.value), 'pl') * multiplier || left.index - right.index;
    }
    if (left.value === right.value) {
      return left.index - right.index;
    }

    return (left.value - right.value) * multiplier;
  }

  function sortSquadBy(sortKey, documentRef) {
    var rows = findSquadPlayerRows(documentRef);
    var currentKey = documentRef.body.getAttribute('data-vms-sort-key');
    var currentDirection = documentRef.body.getAttribute('data-vms-sort-direction') || 'desc';
    var nextDirection = currentKey === sortKey && currentDirection === 'desc' ? 'asc' : 'desc';
    var blocks;
    var parent;

    blocks = rows.map(function (row, index) {
      var block = getPlayerBlock(row);

      if (!block) {
        return null;
      }

      return {
        index: index,
        value: getSortValue(row, sortKey),
        block: block
      };
    }).filter(Boolean);

    if (!blocks.length) {
      return;
    }

    parent = blocks[0].block.blockRow.parentNode;
    blocks.sort(function (left, right) {
      return compareSortValues(left, right, nextDirection);
    });

    blocks.forEach(function (item) {
      parent.appendChild(item.block.blockRow);
      if (item.block.spacerRow) {
        parent.appendChild(item.block.spacerRow);
      }
    });

    documentRef.body.setAttribute('data-vms-sort-key', sortKey);
    documentRef.body.setAttribute('data-vms-sort-direction', nextDirection);
    documentRef.body.removeAttribute(SQUAD_SIGNATURE_ATTR);
    updateSortMarkers(documentRef, sortKey, nextDirection);
    applyPositionFilter(documentRef);
  }

  function createSquadSignature(rows) {
    return rows.map(function (row) {
      return getPlayerIdFromRow(row);
    }).join('|');
  }

  function readTrainingCache(storage) {
    var raw;
    var parsed;

    if (!storage) {
      return null;
    }

    try {
      raw = storage.getItem(CACHE_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }

    if (!parsed || !parsed.createdAt || !parsed.values) {
      return null;
    }

    if (Date.now() - parsed.createdAt > CACHE_TTL_MS) {
      return null;
    }

    return parsed.values;
  }

  function writeTrainingCache(storage, values) {
    if (!storage) {
      return;
    }

    try {
      storage.setItem(CACHE_KEY, JSON.stringify({
        createdAt: Date.now(),
        values: values
      }));
    } catch (error) {
      // Cache failures should not affect the squad view.
    }
  }

  function fetchTrainingValues() {
    var cached;

    if (trainingState.status === 'loaded') {
      return Promise.resolve(trainingState.values);
    }

    if (trainingPromise) {
      return trainingPromise;
    }

    cached = readTrainingCache(root.sessionStorage);
    if (cached) {
      trainingState.status = 'loaded';
      trainingState.values = cached;
      return Promise.resolve(cached);
    }

    trainingState.status = 'loading';
    trainingPromise = root.fetch(TRAINING_URL, {
      credentials: 'same-origin'
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Training fetch failed with status ' + response.status);
      }
      return response.text();
    }).then(function (text) {
      var html = extractVmBody(text);
      var values = parseTrainingPlayerDataFromHtml(html);

      trainingState.status = 'loaded';
      trainingState.values = values;
      writeTrainingCache(root.sessionStorage, values);

      return values;
    }).catch(function (error) {
      trainingState.status = 'error';
      trainingState.values = null;
      throw error;
    }).finally(function () {
      trainingPromise = null;
    });

    return trainingPromise;
  }

  function applyTrainingValues(values) {
    var trainingCells = Array.prototype.slice.call(root.document.querySelectorAll('.' + CELL_CLASS));
    var fitCells = Array.prototype.slice.call(root.document.querySelectorAll('.' + FIT_CELL_CLASS));

    trainingCells.forEach(function (cell) {
      var playerId = cell.getAttribute('data-vms-player-id');
      var data = values && Object.prototype.hasOwnProperty.call(values, playerId) ? values[playerId] : null;
      var percent = data ? data.trainingPercent : null;
      setTrainingCell(cell, percent);
    });

    fitCells.forEach(function (cell) {
      var playerId = cell.getAttribute('data-vms-player-id');
      var data = values && Object.prototype.hasOwnProperty.call(values, playerId) ? values[playerId] : null;
      setFitCell(cell, data);
    });
  }

  function applyTrainingError() {
    var trainingCells = Array.prototype.slice.call(root.document.querySelectorAll('.' + CELL_CLASS));
    var fitCells = Array.prototype.slice.call(root.document.querySelectorAll('.' + FIT_CELL_CLASS));

    trainingCells.forEach(function (cell) {
      setTrainingCell(cell, null);
    });

    fitCells.forEach(function (cell) {
      setFitCell(cell, null);
    });
  }

  function enhanceSquad() {
    var documentRef = root.document;
    var headerRows = findHeaderRows(documentRef);
    var playerRows = findSquadPlayerRows(documentRef);
    var signature;

    if (!headerRows.length || !playerRows.length) {
      return;
    }

    injectStyles(documentRef);
    signature = createSquadSignature(playerRows);

    if (documentRef.body.getAttribute(SQUAD_SIGNATURE_ATTR) === signature &&
      Array.prototype.slice.call(documentRef.querySelectorAll('.' + CELL_CLASS)).length >= playerRows.length &&
      Array.prototype.slice.call(documentRef.querySelectorAll('.' + FIT_CELL_CLASS)).length >= playerRows.length) {
      if (trainingState.status === 'loaded') {
        applyTrainingValues(trainingState.values);
      }
      applyPositionFilter(documentRef);
      return;
    }

    headerRows.forEach(enhanceHeaderRow);
    headerRows.forEach(enableHeaderSorting);
    playerRows.forEach(enhancePlayerRow);
    documentRef.body.setAttribute(SQUAD_SIGNATURE_ATTR, signature);
    applyPositionFilter(documentRef);

    fetchTrainingValues().then(applyTrainingValues).catch(applyTrainingError);
  }

  function scheduleEnhancement() {
    if (scheduleTimer) {
      root.clearTimeout(scheduleTimer);
    }

    scheduleTimer = root.setTimeout(function () {
      scheduleTimer = null;
      enhanceSquad();
    }, 120);
  }

  function start() {
    if (!root || !root.document || !root.fetch) {
      return;
    }

    enhanceSquad();

    new root.MutationObserver(scheduleEnhancement).observe(root.document.body, {
      childList: true,
      subtree: true
    });
  }

  return {
    calculateSummary: calculateSummary,
    extractVmBody: extractVmBody,
    parseTrainingPlayerDataFromHtml: parseTrainingPlayerDataFromHtml,
    parseSquadPlayerIdsFromHtml: parseSquadPlayerIdsFromHtml,
    parseTrainingPercentMapFromHtml: parseTrainingPercentMapFromHtml,
    start: start
  };
}));
