// ==UserScript==
// @name         VM Individual Tactics Enhancer
// @namespace    https://vm-manager.org/
// @version      0.1.1
// @description  Bulk edit, position presets and dirty-state tracking for VM Manager individual tactics view.
// @match        *://*.vm-manager.org/*
// @match        *://vm-manager.org/*
// @grant        none
// @run-at       document-end
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-dom-utils.js
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-individual-tactics-enhancer.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-individual-tactics-enhancer.user.js
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

  var dom = (root && root.VMDomUtils) || (function () {
    try {
      return require('./vm-dom-utils.js');
    } catch (error) {
      return null;
    }
  })();

  if (!dom) {
    throw new Error('VM Individual Tactics Enhancer wymaga vm-dom-utils.js (@require).');
  }

  var STYLE_ID = 'viti-style';
  var PANEL_ID = 'viti-bulk-panel';
  var SIGNATURE_ATTR = 'data-viti-signature';
  var ENHANCED_ATTR = 'data-viti-enhanced';
  var HOLD_INTERVAL_MS = 80;

  var PRESET_HINTS = {
    attack: 'At/P: 8/1/1 · Śr: 8/3/1 · R/L: 1/1/1 we wszystkich kolumnach ataku',
    defense: 'At/P/Śr: obrona 8, asekuracja 1 · R/L: 1/1',
    generic: 'Pierwsza kolumna 8 (1 dla R/L), pozostałe kolumny 1'
  };

  var POSITION_FILTERS = ['', 'At', 'P', 'R', 'Śr', 'L'];

  var ATTACK_PRESETS = {
    At: { atak: 8, kiwka: 1, out: 1 },
    P: { atak: 8, kiwka: 1, out: 1 },
    Śr: { atak: 8, kiwka: 3, out: 1 },
    Sr: { atak: 8, kiwka: 3, out: 1 },
    R: { atak: 1, kiwka: 1, out: 1 },
    L: { atak: 1, kiwka: 1, out: 1 }
  };

  var DEFENSE_PRESETS = {
    At: { obr: 8, asek: 1 },
    P: { obr: 8, asek: 1 },
    Śr: { obr: 8, asek: 1 },
    Sr: { obr: 8, asek: 1 },
    R: { obr: 1, asek: 1 },
    L: { obr: 1, asek: 1 }
  };

  var PRESET_FIELD_ALIASES = {
    obr: ['obr', 'obrona'],
    asek: ['asek', 'asekuracja'],
    atak: ['atak'],
    kiwka: ['kiwka'],
    out: ['out']
  };

  var state = {
    snapshot: null,
    activePositionFilter: '',
    scenarioSelect: null,
    scenarioPreviousIndex: 0,
    holdTimer: null
  };

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getOnClick(el) {
    return el.getAttribute('onclick') || el.getAttribute('OnClick') || '';
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

  function parseSpanId(spanId) {
    var id = String(spanId || '');
    var match;

    match = id.match(/^line_(\d+)_block_(\d+)_([^_]+)_(\d+)$/);
    if (match) {
      return {
        line: match[1],
        block: match[2],
        field: match[3],
        playerId: match[4]
      };
    }

    match = id.match(/^line_(\d+)_([^_]+)_(\d+)$/);
    if (match) {
      return {
        line: match[1],
        block: '',
        field: match[2],
        playerId: match[3]
      };
    }

    match = id.match(/^([^_]+)_(\d+)$/);
    if (match) {
      return {
        field: match[1],
        playerId: match[2]
      };
    }

    match = id.match(/^(.+)_(\d+)$/);
    if (match) {
      return {
        field: match[1].split('_').pop(),
        playerId: match[2]
      };
    }

    return null;
  }

  function isTacticsValueSpan(span) {
    var cell;

    if (!span || !span.id || !span.closest) {
      return false;
    }

    cell = span.closest('td');

    return Boolean(
      cell &&
      cell.querySelector('input.sector_plus_minus') &&
      /^\d+$/.test(normalizeText(span.textContent))
    );
  }

  function collectValueSpans(documentRef) {
    var seen = {};
    var result = [];

    dom.queryVisibleAll(documentRef, 'span[id]').forEach(function (span) {
      var parsed;

      if (!isTacticsValueSpan(span)) {
        return;
      }

      parsed = parseSpanId(span.id);

      if (!parsed || seen[span.id]) {
        return;
      }

      seen[span.id] = true;
      result.push(span);
    });

    return result;
  }

  function findColumnHeaderAnchor(documentRef) {
    var headerFont = dom.queryVisibleAll(documentRef, 'font.center').find(function (node) {
      var cell = node.closest('td');

      return normalizeText(node.textContent).length > 0 &&
        cell &&
        /fourth/.test(String(cell.className || ''));
    });
    var node;

    if (!headerFont) {
      headerFont = dom.queryVisibleAll(documentRef, 'font.center').find(function (node) {
        return normalizeText(node.textContent).length > 0;
      });
    }

    if (!headerFont) {
      return null;
    }

    node = headerFont;

    while (node && node.nodeType === 1) {
      if (node.tagName === 'TR' && node.querySelector('font.center')) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function readSpanBounds(span) {
    var cell = span.closest('td');
    var minusBtn;
    var plusBtn;
    var minusMatch;
    var plusMatch;

    if (!cell) {
      return { min: 1, max: 8 };
    }

    minusBtn = cell.querySelector('input.sector_plus_minus[value="-"]');
    plusBtn = cell.querySelector('input.sector_plus_minus[value="+"]');
    minusMatch = minusBtn ? getOnClick(minusBtn).match(/spanValueMinus\('[^']+',(\d+)\)/) : null;
    plusMatch = plusBtn ? getOnClick(plusBtn).match(/spanValuePlus\('[^']+',(\d+)\)/) : null;

    return {
      min: minusMatch ? parseInt(minusMatch[1], 10) : 1,
      max: plusMatch ? parseInt(plusMatch[1], 10) : 8
    };
  }

  function readSpanValue(span) {
    return parseInt(span.textContent, 10) || 0;
  }

  function findPlayerRowContainer(span) {
    var node = span.parentElement;

    while (node && node.nodeType === 1) {
      if (node.tagName === 'TABLE' && node.querySelector('font.green') && node.querySelector('span.link')) {
        return node;
      }

      node = node.parentElement;
    }

    return null;
  }

  function parsePlayerMeta(container) {
    var posFont = container.querySelector('font.green');
    var link = container.querySelector('span.link[onclick*="Player&playerId="], span.link[OnClick*="Player&playerId="]');
    var onclick = link ? getOnClick(link) : '';
    var idMatch = onclick.match(/playerId=(\d+)/);

    return {
      positionShort: normalizeText(posFont ? posFont.textContent : ''),
      name: normalizeText(link ? link.textContent : ''),
      playerId: idMatch ? idMatch[1] : '',
      container: container
    };
  }

  function parseColumnLabels(documentRef) {
    var headerRow = findColumnHeaderAnchor(documentRef);
    var labels;

    if (headerRow) {
      labels = Array.prototype.slice.call(headerRow.querySelectorAll('font.center'))
        .map(function (node) {
          return normalizeText(node.textContent);
        })
        .filter(function (label) {
          return label.length > 0;
        });

      if (labels.length) {
        return labels;
      }
    }

    return dom.queryVisibleAll(documentRef, 'font.center')
      .map(function (node) {
        return normalizeText(node.textContent);
      })
      .filter(function (label) {
        return label.length > 0;
      });
  }

  function stripHtmlTags(value) {
    return normalizeText(String(value || '').replace(/<[^>]+>/g, ' '));
  }

  function parseIndividualViewFromHtmlRegex(html) {
    var source = String(html || '');
    var scenarioOpt = '';
    var scenarioLabel = '';
    var selectMatch = source.match(/<select\b[^>]*\bid=(['"])cup_id\1[^>]*>([\s\S]*?)<\/select>/i);
    var selectedOptionMatch;
    var labels = [];
    var labelMatch;
    var labelRegex = /<font class=['"]center['"]>([^<]+)<\/font>/gi;
    var rows = [];
    var rowRegex;
    var rowMatch;
    var fieldOrder = [];
    var columns = [];
    var i;

    if (selectMatch) {
      var optionsPart = selectMatch[2];
      var optionRegex = /<option[^>]*value=(['"])([^'"]+)\1[^>]*>([^<]*)/gi;
      var optionMatch;
      var firstOption = null;

      while ((optionMatch = optionRegex.exec(optionsPart)) !== null) {
        if (!firstOption) {
          firstOption = optionMatch;
        }

        if (/selected/i.test(optionMatch[0])) {
          selectedOptionMatch = optionMatch;
          break;
        }
      }

      if (!selectedOptionMatch && firstOption) {
        selectedOptionMatch = firstOption;
      }

      if (selectedOptionMatch) {
        scenarioOpt = selectedOptionMatch[2];
        scenarioLabel = normalizeText(selectedOptionMatch[3]);
      }
    }

    while ((labelMatch = labelRegex.exec(source)) !== null) {
      labels.push(normalizeText(labelMatch[1]));
    }

    rowRegex = /<font class=green>([^<]+)<\/font>[\s\S]*?playerId=(\d+)([\s\S]*?)(?=<font class=green>|IndividualSave|$)/gi;

    while ((rowMatch = rowRegex.exec(source)) !== null) {
      var positionShort = normalizeText(rowMatch[1]);
      var playerId = rowMatch[2];
      var rowChunk = rowMatch[3];
      var fields = {};
      var spanRegex = /<span id=(['"])([^'"]+)\1>(\d+)<\/span>/gi;
      var spanMatch;

      while ((spanMatch = spanRegex.exec(rowChunk)) !== null) {
        var parsedId = parseSpanId(spanMatch[2]);

        if (!parsedId) {
          continue;
        }

        fields[parsedId.field] = {
          spanId: spanMatch[2],
          field: parsedId.field,
          value: parseInt(spanMatch[3], 10)
        };

        if (fieldOrder.indexOf(parsedId.field) === -1) {
          fieldOrder.push(parsedId.field);
        }
      }

      if (!Object.keys(fields).length) {
        continue;
      }

      rows.push({
        playerId: playerId,
        positionShort: positionShort,
        name: '',
        container: null,
        fields: fields
      });
    }

    for (i = 0; i < fieldOrder.length; i += 1) {
      columns.push({
        field: fieldOrder[i],
        label: labels[i] || fieldOrder[i]
      });
    }

    return {
      scenarioOpt: scenarioOpt,
      scenarioLabel: scenarioLabel,
      columns: columns,
      rows: rows
    };
  }

  function parseIndividualViewFromHtml(html, documentRef) {
    if (documentRef && documentRef.querySelector) {
      return parseIndividualView(documentRef);
    }

    if (typeof DOMParser !== 'undefined') {
      return parseIndividualView(
        new DOMParser().parseFromString('<div id="viti-root">' + html + '</div>', 'text/html')
      );
    }

    return parseIndividualViewFromHtmlRegex(html);
  }

  function parseIndividualView(documentRef) {
    var spans = collectValueSpans(documentRef);
    var byPlayer = {};
    var rows = [];
    var columns = [];
    var fieldOrder = [];
    var labels = parseColumnLabels(documentRef);
    var select = dom.getVisibleElementById(documentRef, 'cup_id');
    var scenarioOpt = '';
    var scenarioLabel = '';
    var i;
    var span;
    var parsedId;
    var playerId;
    var meta;
    var fieldNames;
    var j;

    spans.forEach(function (valueSpan) {
      parsedId = parseSpanId(valueSpan.id);

      if (!parsedId) {
        return;
      }

      playerId = parsedId.playerId;

      if (!byPlayer[playerId]) {
        meta = parsePlayerMeta(findPlayerRowContainer(valueSpan) || valueSpan.parentElement);
        byPlayer[playerId] = {
          playerId: playerId,
          positionShort: meta.positionShort,
          name: meta.name,
          container: meta.container,
          fields: {}
        };
      }

      byPlayer[playerId].fields[parsedId.field] = {
        spanId: valueSpan.id,
        field: parsedId.field,
        value: readSpanValue(valueSpan),
        bounds: readSpanBounds(valueSpan),
        span: valueSpan
      };
    });

    rows = Object.keys(byPlayer).map(function (id) {
      return byPlayer[id];
    });

    if (rows.length) {
      fieldNames = Object.keys(rows[0].fields);

      rows.forEach(function (row) {
        Object.keys(row.fields).forEach(function (field) {
          if (fieldOrder.indexOf(field) === -1) {
            fieldOrder.push(field);
          }
        });
      });

      if (!fieldOrder.length) {
        fieldOrder = fieldNames;
      }

      for (i = 0; i < fieldOrder.length; i += 1) {
        columns.push({
          field: fieldOrder[i],
          label: labels[i] || fieldOrder[i]
        });
      }
    }

    if (select) {
      scenarioOpt = select.value || '';
      scenarioLabel = select.options[select.selectedIndex]
        ? normalizeText(select.options[select.selectedIndex].textContent)
        : scenarioOpt;
    }

    return {
      scenarioOpt: scenarioOpt,
      scenarioLabel: scenarioLabel,
      columns: columns,
      rows: rows
    };
  }

  function isIndividualTacticsView(documentRef) {
    var select = dom.getVisibleElementById(documentRef, 'cup_id');
    var hasScenarioSelect = Boolean(
      select &&
      select.querySelector('option[value*="Squad&opt="]')
    );
    var hasSaveLink = dom.queryVisibleAll(documentRef, 'span.link').some(function (link) {
      return getOnClick(link).indexOf('IndividualSave') !== -1;
    });
    var hasValueSpans = collectValueSpans(documentRef).length > 0;

    return hasScenarioSelect && (hasValueSpans || hasSaveLink);
  }

  function takeSnapshot(view) {
    var snapshot = {};

    view.rows.forEach(function (row) {
      Object.keys(row.fields).forEach(function (field) {
        var cell = row.fields[field];
        snapshot[cell.spanId] = cell.span ? readSpanValue(cell.span) : cell.value;
      });
    });

    return snapshot;
  }

  function countDirtyChanges(documentRef, snapshot) {
    var count = 0;

    if (!snapshot) {
      return 0;
    }

    Object.keys(snapshot).forEach(function (spanId) {
      var span = dom.getVisibleElementById(documentRef, spanId);

      if (span && readSpanValue(span) !== snapshot[spanId]) {
        count += 1;
      }
    });

    return count;
  }

  function isDirty(documentRef) {
    return countDirtyChanges(documentRef, state.snapshot) > 0;
  }

  function setSpanValue(documentRef, spanId, targetValue, bounds) {
    var span = dom.getVisibleElementById(documentRef, spanId);
    var min = bounds.min;
    var max = bounds.max;
    var current;
    var next;

    if (!span) {
      return;
    }

    next = Math.max(min, Math.min(max, parseInt(targetValue, 10) || min));
    current = readSpanValue(span);

    if (current === next) {
      return;
    }

    if (root && typeof root.spanValuePlus === 'function' && typeof root.spanValueMinus === 'function') {
      while (current < next) {
        root.spanValuePlus(spanId, max);
        current += 1;
      }

      while (current > next) {
        root.spanValueMinus(spanId, min);
        current -= 1;
      }
      return;
    }

    span.textContent = String(next);
  }

  function getFilteredRows(view, positionFilter) {
    if (!positionFilter) {
      return view.rows;
    }

    return view.rows.filter(function (row) {
      return row.positionShort === positionFilter ||
        (positionFilter === 'Śr' && row.positionShort === 'Sr');
    });
  }

  function applyFieldValue(documentRef, rows, field, value) {
    rows.forEach(function (row) {
      var cell = row.fields[field];

      if (!cell) {
        return;
      }

      setSpanValue(documentRef, cell.spanId, value, cell.bounds);
    });
  }

  function findFieldCell(row, presetField) {
    var names = PRESET_FIELD_ALIASES[presetField] || [presetField];
    var i;

    for (i = 0; i < names.length; i += 1) {
      if (row.fields[names[i]]) {
        return row.fields[names[i]];
      }
    }

    return null;
  }

  function applyPresetToRow(documentRef, row, preset) {
    Object.keys(preset).forEach(function (presetField) {
      var cell = findFieldCell(row, presetField);

      if (!cell) {
        return;
      }

      setSpanValue(documentRef, cell.spanId, preset[presetField], cell.bounds);
    });
  }

  function applyPositionPresets(documentRef, view, presetMap) {
    view.rows.forEach(function (row) {
      var preset = presetMap[row.positionShort] || presetMap.Sr;

      if (!preset) {
        return;
      }

      applyPresetToRow(documentRef, row, preset);
    });
  }

  function buildGenericPresets(view) {
    var presets = {};
    var positions = ['At', 'P', 'Śr', 'Sr', 'R', 'L'];

    positions.forEach(function (position) {
      var isLowPriority = position === 'R' || position === 'L';

      presets[position] = {};
      view.columns.forEach(function (column, index) {
        presets[position][column.field] = isLowPriority ? 1 : (index === 0 ? 8 : 1);
      });
    });

    return presets;
  }

  function getPresetMap(view) {
    var fields = view.columns.map(function (column) {
      return column.field;
    });

    if (fields.indexOf('atak') !== -1) {
      return ATTACK_PRESETS;
    }

    if (fields.indexOf('obr') !== -1 || fields.indexOf('asek') !== -1 ||
        fields.indexOf('obrona') !== -1 || fields.indexOf('asekuracja') !== -1) {
      return DEFENSE_PRESETS;
    }

    if (view.columns.length) {
      return buildGenericPresets(view);
    }

    return null;
  }

  function getPresetHint(view) {
    var fields = view.columns.map(function (column) {
      return column.field;
    });

    if (fields.indexOf('atak') !== -1) {
      return PRESET_HINTS.attack;
    }

    if (fields.indexOf('obr') !== -1 || fields.indexOf('asek') !== -1 ||
        fields.indexOf('obrona') !== -1 || fields.indexOf('asekuracja') !== -1) {
      return PRESET_HINTS.defense;
    }

    return PRESET_HINTS.generic;
  }

  function updateRowVisibility(view, positionFilter) {
    view.rows.forEach(function (row) {
      if (!row.container) {
        return;
      }

      if (!positionFilter) {
        row.container.style.display = '';
        return;
      }

      row.container.style.display = (
        row.positionShort === positionFilter ||
        (positionFilter === 'Śr' && row.positionShort === 'Sr')
      ) ? '' : 'none';
    });
  }

  function ensureStyles(documentRef) {
    var style;

    if (documentRef.getElementById(STYLE_ID)) {
      return;
    }

    style = documentRef.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + PANEL_ID + ' {',
      '  margin: 8px 0 10px;',
      '  padding: 10px 12px;',
      '  border: 1px solid #4a6078;',
      '  background: #1a2430;',
      '  color: #d8e2ec;',
      '  font: 12px/1.4 Tahoma, Verdana, sans-serif;',
      '}',
      '#' + PANEL_ID + ' .viti-row {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 8px;',
      '  align-items: center;',
      '  margin-bottom: 8px;',
      '}',
      '#' + PANEL_ID + ' .viti-row:last-child {',
      '  margin-bottom: 0;',
      '}',
      '#' + PANEL_ID + ' label {',
      '  color: #9eb4c8;',
      '}',
      '#' + PANEL_ID + ' select,',
      '#' + PANEL_ID + ' input[type="number"] {',
      '  background: #0f1720;',
      '  color: #eef4fa;',
      '  border: 1px solid #4a6078;',
      '  padding: 2px 6px;',
      '}',
      '#' + PANEL_ID + ' button {',
      '  background: #2d4258;',
      '  color: #eef4fa;',
      '  border: 1px solid #58708a;',
      '  padding: 3px 8px;',
      '  cursor: pointer;',
      '}',
      '#' + PANEL_ID + ' button:hover {',
      '  background: #3a536d;',
      '}',
      '#' + PANEL_ID + ' .viti-status {',
      '  color: #9eb4c8;',
      '}',
      '#' + PANEL_ID + ' .viti-status.viti-dirty {',
      '  color: #ffb347;',
      '  font-weight: bold;',
      '}',
      '.viti-save-dirty {',
      '  color: #ffb347 !important;',
      '  font-weight: bold;',
      '}',
      '.viti-value-input {',
      '  width: 42px;',
      '  text-align: center;',
      '  background: #0f1720;',
      '  color: #eef4fa;',
      '  border: 1px solid #58708a;',
      '}',
      '#' + PANEL_ID + ' .viti-preset-hint {',
      '  color: #7f93a8;',
      '  font-size: 11px;',
      '  flex-basis: 100%;',
      '}'
    ].join('\n');
    documentRef.head.appendChild(style);
  }

  function updateDirtyUi(documentRef, statusNode) {
    var dirtyCount = countDirtyChanges(documentRef, state.snapshot);
    var saveLink = dom.queryVisibleAll(documentRef, 'span.link').find(function (link) {
      return getOnClick(link).indexOf('IndividualSave') !== -1;
    });

    if (statusNode) {
      if (dirtyCount) {
        statusNode.textContent = dirtyCount + ' niezapisanych zmian';
        statusNode.className = 'viti-status viti-dirty';
      } else {
        statusNode.textContent = 'Brak niezapisanych zmian';
        statusNode.className = 'viti-status';
      }
    }

    if (saveLink) {
      if (dirtyCount) {
        saveLink.classList.add('viti-save-dirty');
      } else {
        saveLink.classList.remove('viti-save-dirty');
      }
    }
  }

  function beginNumericEdit(documentRef, span, bounds, statusNode) {
    var input;
    var finish;

    if (!span || span.getAttribute(ENHANCED_ATTR) === 'input') {
      return;
    }

    input = documentRef.createElement('input');
    input.type = 'number';
    input.min = String(bounds.min);
    input.max = String(bounds.max);
    input.value = String(readSpanValue(span));
    input.className = 'viti-value-input';

    finish = function (commit) {
      if (commit) {
        setSpanValue(documentRef, span.id, input.value, bounds);
        updateDirtyUi(documentRef, statusNode);
      }

      if (input.parentNode) {
        input.parentNode.replaceChild(span, input);
      }

      span.setAttribute(ENHANCED_ATTR, '1');
    };

    span.setAttribute(ENHANCED_ATTR, 'input');
    span.parentNode.replaceChild(input, span);
    input.focus();
    input.select();

    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish(true);
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        finish(false);
      }
    });

    input.addEventListener('blur', function () {
      finish(true);
    });
  }

  function attachHoldRepeat(documentRef, button) {
    var action = function () {
      button.click();
    };

    button.addEventListener('mousedown', function (event) {
      if (event.button !== 0) {
        return;
      }

      clearInterval(state.holdTimer);
      state.holdTimer = setInterval(action, HOLD_INTERVAL_MS);
    });

    ['mouseup', 'mouseleave'].forEach(function (eventName) {
      button.addEventListener(eventName, function () {
        clearInterval(state.holdTimer);
        state.holdTimer = null;
      });
    });
  }

  function attachValueEnhancements(documentRef, view, statusNode) {
    view.rows.forEach(function (row) {
      Object.keys(row.fields).forEach(function (field) {
        var cell = row.fields[field];
        var span = cell.span;

        if (!span || span.getAttribute(ENHANCED_ATTR) === '1' || span.getAttribute(ENHANCED_ATTR) === 'input') {
          return;
        }

        span.setAttribute(ENHANCED_ATTR, '1');
        span.title = 'Kliknij, aby wpisać wartość';
        span.style.cursor = 'pointer';

        span.addEventListener('click', function () {
          beginNumericEdit(documentRef, span, cell.bounds, statusNode);
        });
      });

      if (!row.container) {
        return;
      }

      row.container.querySelectorAll('input.sector_plus_minus').forEach(function (button) {
        if (button.getAttribute(ENHANCED_ATTR) === '1') {
          return;
        }

        button.setAttribute(ENHANCED_ATTR, '1');
        attachHoldRepeat(documentRef, button);
        button.addEventListener('click', function () {
          setTimeout(function () {
            updateDirtyUi(documentRef, statusNode);
          }, 0);
        });
      });
    });
  }

  function hookScenarioSelect(documentRef, statusNode) {
    var select = dom.getVisibleElementById(documentRef, 'cup_id');

    if (!select || select.getAttribute(SIGNATURE_ATTR) === 'hooked') {
      state.scenarioSelect = select;
      return;
    }

    select.setAttribute(SIGNATURE_ATTR, 'hooked');
    state.scenarioSelect = select;
    state.scenarioPreviousIndex = select.selectedIndex;

    select.addEventListener('focus', function () {
      state.scenarioPreviousIndex = select.selectedIndex;
    }, true);

    select.addEventListener('change', function (event) {
      if (isDirty(documentRef)) {
        if (!root.confirm('Masz niezapisane zmiany. Zmienić scenariusz bez zapisu?')) {
          select.selectedIndex = state.scenarioPreviousIndex;
          event.stopImmediatePropagation();
          event.preventDefault();
          return;
        }
      }

      state.scenarioPreviousIndex = select.selectedIndex;
      state.snapshot = null;
      updateDirtyUi(documentRef, statusNode);
    }, true);
  }

  function hookSaveLink(documentRef, statusNode) {
    dom.queryVisibleAll(documentRef, 'span.link').forEach(function (link) {
      if (getOnClick(link).indexOf('IndividualSave') === -1) {
        return;
      }

      if (link.getAttribute(SIGNATURE_ATTR) === 'hooked') {
        return;
      }

      link.setAttribute(SIGNATURE_ATTR, 'hooked');
      link.addEventListener('click', function () {
        setTimeout(function () {
          var view = parseIndividualView(documentRef);
          state.snapshot = takeSnapshot(view);
          updateDirtyUi(documentRef, statusNode);
        }, 400);
      });
    });
  }

  function insertPanel(documentRef, panel) {
    var anchorRow = findColumnHeaderAnchor(documentRef);
    var panelTr = documentRef.createElement('tr');
    var panelTd = documentRef.createElement('td');

    panelTd.colSpan = 10;
    panelTd.appendChild(panel);
    panelTr.appendChild(panelTd);

    if (anchorRow && anchorRow.parentElement) {
      anchorRow.parentElement.insertBefore(panelTr, anchorRow);
      return;
    }

    documentRef.body.appendChild(panel);
  }

  function buildPanel(documentRef, view) {
    var panel = documentRef.createElement('div');
    var filterRow = documentRef.createElement('div');
    var bulkRow = documentRef.createElement('div');
    var presetRow = documentRef.createElement('div');
    var statusRow = documentRef.createElement('div');
    var positionSelect = documentRef.createElement('select');
    var columnSelect = documentRef.createElement('select');
    var valueInput = documentRef.createElement('input');
    var statusNode = documentRef.createElement('span');
    var i;

    panel.id = PANEL_ID;

    POSITION_FILTERS.forEach(function (value) {
      var option = documentRef.createElement('option');
      option.value = value;
      option.textContent = value || 'Wszyscy';
      positionSelect.appendChild(option);
    });

    view.columns.forEach(function (column) {
      var option = documentRef.createElement('option');
      option.value = column.field;
      option.textContent = column.label;
      columnSelect.appendChild(option);
    });

    valueInput.type = 'number';
    valueInput.min = '1';
    valueInput.max = '8';
    valueInput.value = '8';
    valueInput.style.width = '52px';

    filterRow.className = 'viti-row';
    filterRow.appendChild(documentRef.createElement('label')).textContent = 'Filtr pozycji:';
    filterRow.lastChild.setAttribute('for', 'viti-position-filter');
    positionSelect.id = 'viti-position-filter';
    filterRow.appendChild(positionSelect);

    bulkRow.className = 'viti-row';
    bulkRow.appendChild(documentRef.createElement('label')).textContent = 'Kolumna:';
    bulkRow.appendChild(columnSelect);
    valueInput.id = 'viti-bulk-value';

    ['1', '8'].forEach(function (presetValue) {
      var button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = presetValue;
      button.addEventListener('click', function () {
        applyFieldValue(
          documentRef,
          getFilteredRows(view, state.activePositionFilter),
          columnSelect.value,
          presetValue
        );
        updateDirtyUi(documentRef, statusNode);
      });
      bulkRow.appendChild(button);
    });

    bulkRow.appendChild(valueInput);

    var applyButton = documentRef.createElement('button');
    applyButton.type = 'button';
    applyButton.textContent = 'Zastosuj';
    applyButton.addEventListener('click', function () {
      applyFieldValue(
        documentRef,
        getFilteredRows(view, state.activePositionFilter),
        columnSelect.value,
        valueInput.value
      );
      updateDirtyUi(documentRef, statusNode);
    });
    bulkRow.appendChild(applyButton);

    presetRow.className = 'viti-row';
    presetRow.appendChild(documentRef.createElement('label')).textContent = 'Presety:';

    var presetHint = documentRef.createElement('span');
    presetHint.className = 'viti-preset-hint';
    presetHint.textContent = getPresetHint(view);
    presetHint.title = getPresetHint(view);

    [
      { label: 'At/P', positions: ['At', 'P'], title: 'Atakujący i przyjmujący — wartości z presetu pozycji' },
      { label: 'Śr', positions: ['Śr', 'Sr'], title: 'Środkowi — wartości z presetu pozycji' },
      { label: 'R/L', positions: ['R', 'L'], title: 'Rozgrywający i libero — wartości z presetu pozycji' },
      { label: 'Wszystkie pozycje', positions: null, title: 'Zastosuj presety do wszystkich pozycji naraz' }
    ].forEach(function (presetAction) {
      var button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = presetAction.label;
      button.title = presetAction.title;
      button.addEventListener('click', function () {
        var presetMap = getPresetMap(view);
        var targetRows;

        if (!presetMap) {
          return;
        }

        if (presetAction.positions) {
          targetRows = view.rows.filter(function (row) {
            return presetAction.positions.indexOf(row.positionShort) !== -1;
          });
          targetRows.forEach(function (row) {
            var preset = presetMap[row.positionShort] || presetMap.Sr;
            applyPresetToRow(documentRef, row, preset);
          });
        } else {
          applyPositionPresets(documentRef, view, presetMap);
        }

        updateDirtyUi(documentRef, statusNode);
      });
      presetRow.appendChild(button);
    });

    presetRow.appendChild(presetHint);

    statusRow.className = 'viti-row';
    statusNode.className = 'viti-status';
    statusNode.textContent = 'Brak niezapisanych zmian';
    statusRow.appendChild(statusNode);

    positionSelect.value = state.activePositionFilter;
    positionSelect.addEventListener('change', function () {
      state.activePositionFilter = positionSelect.value;
      updateRowVisibility(view, state.activePositionFilter);
    });

    panel.appendChild(filterRow);
    panel.appendChild(bulkRow);
    panel.appendChild(presetRow);
    panel.appendChild(statusRow);

    return {
      panel: panel,
      statusNode: statusNode
    };
  }

  function getViewSignature(view) {
    return [
      view.scenarioOpt,
      view.columns.map(function (column) {
        return column.field;
      }).join(','),
      view.rows.map(function (row) {
        return row.playerId;
      }).join(',')
    ].join('|');
  }

  function cleanupIndividualEnhancements(documentRef) {
    var panel = documentRef.getElementById(PANEL_ID);
    var wrapperTr;

    if (panel) {
      wrapperTr = panel.closest('tr');
      panel.remove();

      if (wrapperTr && !normalizeText(wrapperTr.textContent)) {
        wrapperTr.remove();
      }
    }

    dom.queryVisibleAll(documentRef, '.viti-save-dirty').forEach(function (node) {
      node.classList.remove('viti-save-dirty');
    });

    state.snapshot = null;
    state.scenarioSelect = null;
  }

  function enhanceIndividualTactics(documentRef) {
    var view;
    var signature;
    var existingPanel;
    var built;

    if (!isIndividualTacticsView(documentRef)) {
      cleanupIndividualEnhancements(documentRef);
      return;
    }

    view = parseIndividualView(documentRef);

    if (!view.rows.length) {
      return;
    }

    signature = getViewSignature(view);
    existingPanel = documentRef.getElementById(PANEL_ID);

    if (existingPanel && existingPanel.getAttribute(SIGNATURE_ATTR) === signature) {
      updateDirtyUi(documentRef, existingPanel.querySelector('.viti-status'));
      return;
    }

    cleanupIndividualEnhancements(documentRef);
    ensureStyles(documentRef);

    built = buildPanel(documentRef, view);
    insertPanel(documentRef, built.panel);

    built.panel.setAttribute(SIGNATURE_ATTR, signature);

    if (!state.snapshot) {
      state.snapshot = takeSnapshot(view);
    }

    updateRowVisibility(view, state.activePositionFilter);
    attachValueEnhancements(documentRef, view, built.statusNode);
    hookScenarioSelect(documentRef, built.statusNode);
    hookSaveLink(documentRef, built.statusNode);
    updateDirtyUi(documentRef, built.statusNode);
  }

  function start() {
    dom.createViewScheduler({
      document: root.document,
      isActive: isIndividualTacticsView,
      onEnhance: enhanceIndividualTactics,
      onDeactivate: cleanupIndividualEnhancements,
      delayMs: 120
    }).start();
  }

  return {
    start: start,
    extractVmBody: extractVmBody,
    parseIndividualView: parseIndividualView,
    parseIndividualViewFromHtml: parseIndividualViewFromHtml,
    parseIndividualViewFromHtmlRegex: parseIndividualViewFromHtmlRegex,
    parseSpanId: parseSpanId,
    isIndividualTacticsView: isIndividualTacticsView,
    takeSnapshot: takeSnapshot,
    countDirtyChanges: countDirtyChanges,
    getPresetMap: getPresetMap,
    getPresetHint: getPresetHint,
    buildGenericPresets: buildGenericPresets,
    findColumnHeaderAnchor: findColumnHeaderAnchor,
    collectValueSpans: collectValueSpans,
    ATTACK_PRESETS: ATTACK_PRESETS,
    DEFENSE_PRESETS: DEFENSE_PRESETS
  };
}));
