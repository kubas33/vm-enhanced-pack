// ==UserScript==
// @name         VM Individual Tactics Enhancer
// @namespace    https://vm-manager.org/
// @version      0.2.2
// @description  Bulk edit, player selection, attribute chips, position presets and dirty-state tracking for VM Manager individual tactics view.
// @match        *://*.vm-manager.org/*
// @match        *://vm-manager.org/*
// @grant        none
// @run-at       document-end
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-dom-utils.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-position-rules.js
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
  var positionRules = (root && root.VMPositionRules) || (function () {
    try {
      return require('./vm-position-rules.js');
    } catch (error) {
      return null;
    }
  })();

  if (!dom) {
    throw new Error('VM Individual Tactics Enhancer wymaga vm-dom-utils.js (@require).');
  }

  if (!positionRules) {
    throw new Error('VM Individual Tactics Enhancer wymaga vm-position-rules.js (@require).');
  }

  var STYLE_ID = 'viti-style';
  var PANEL_ID = 'viti-bulk-panel';
  var SIGNATURE_ATTR = 'data-viti-signature';
  var ENHANCED_ATTR = 'data-viti-enhanced';
  var ROW_ENHANCED_ATTR = 'data-viti-row-enhanced';
  var HOLD_INTERVAL_MS = 80;
  var TRAINING_URL = '/Ajax_handler.php?phpsite=view_body.php&action=Training';
  var TRAINING_CACHE_KEY = 'vms.trainingPlayerData.v2';
  var TRAINING_CACHE_TTL_MS = 5 * 60 * 1000;

  var ATTRIBUTE_CODES = positionRules.ATTRIBUTE_CODES;

  var TACTICS_ATTR_CHIPS = {
    defense: {
      default: [
        { label: 'Obrona', short: 'Obr' },
        { label: 'Asekuracja', short: 'Asek' }
      ]
    },
    serve: {
      default: [
        { label: 'Serwis', short: 'Ser' },
        { label: 'Siła serwisu', short: 'Siła' }
      ]
    },
    setting: {
      default: [
        { label: 'Rozgrywanie', short: 'Roz' },
        { label: 'Wystawa', short: 'Wys' }
      ]
    }
  };

  var trainingPromise = null;
  var trainingState = {
    status: 'idle',
    values: null
  };

  var PRESET_HINTS = {
    attack: 'At/P: 8/1/1 · Śr: 8/3/1 · R/L: 1/1/1',
    defense: '8/1 lub 8/4 — ustawia całą drużynę',
    serve: 'Cel serwisu: 1. P (8/1/1), 2. P (1/8/1), libero (1/1/8). Siła bez zmian.'
  };

  var POSITION_OPTIONS = ['At', 'P', 'R', 'Śr', 'L'];

  var ATTACK_PRESETS = {
    At: { atak: 8, kiwka: 1, out: 1 },
    P: { atak: 8, kiwka: 1, out: 1 },
    Śr: { atak: 8, kiwka: 3, out: 1 },
    Sr: { atak: 8, kiwka: 3, out: 1 },
    R: { atak: 1, kiwka: 1, out: 1 },
    L: { atak: 1, kiwka: 1, out: 1 }
  };

  var DEFENSE_GLOBAL_PRESETS = [
    { label: '8 / 1', values: [8, 1], title: 'Obrona 8, asekuracja 1 — cała drużyna' },
    { label: '8 / 4', values: [8, 4], title: 'Obrona 8, asekuracja 4 — cała drużyna' }
  ];

  var SERVE_GLOBAL_PRESETS = [
    { label: '→ 1. przyjmujący', values: [8, 1, 1], title: 'Serwis: 8 / 1 / 1' },
    { label: '→ 2. przyjmujący', values: [1, 8, 1], title: 'Serwis: 1 / 8 / 1' },
    { label: '→ libero', values: [1, 1, 8], title: 'Serwis: 1 / 1 / 8' }
  ];

  var PRESET_FIELD_ALIASES = {
    obr: ['obr', 'obrona'],
    asek: ['asek', 'asekuracja'],
    atak: ['atak'],
    kiwka: ['kiwka'],
    out: ['out']
  };

  var state = {
    snapshot: null,
    positionVisibility: {},
    positionVisibilityScenario: '',
    selectedPlayerIds: {},
    scenarioSelect: null,
    scenarioPreviousIndex: 0,
    holdTimer: null,
    updateSelectionUi: null,
    updatePositionFilterUi: null
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

    // Używamy querySelectorAll zamiast queryVisibleAll — filtr pozycji ukrywa
    // wiersze przez display:none, a parser musi widzieć całą drużynę.
    Array.prototype.slice.call(documentRef.querySelectorAll('span[id]')).forEach(function (span) {
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
      var nodes = dom.getElementsById(documentRef, spanId);
      var span = nodes.length ? nodes[0] : null;

      if (span && readSpanValue(span) !== snapshot[spanId]) {
        count += 1;
      }
    });

    return count;
  }

  function isDirty(documentRef) {
    return countDirtyChanges(documentRef, state.snapshot) > 0;
  }

  function getSpanById(documentRef, spanId) {
    var span = dom.getVisibleElementById(documentRef, spanId);
    var nodes;

    if (span) {
      return span;
    }

    nodes = dom.getElementsById(documentRef, spanId);
    return nodes.length ? nodes[0] : null;
  }

  function setSpanValue(documentRef, spanId, targetValue, bounds, preferredSpan) {
    var span = preferredSpan || getSpanById(documentRef, spanId);
    var safeBounds = bounds || { min: 1, max: 8 };
    var min = safeBounds.min;
    var max = safeBounds.max;
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

      if (readSpanValue(span) !== next) {
        span.textContent = String(next);
      }

      return;
    }

    span.textContent = String(next);
  }

  function refreshRowFieldFromDom(documentRef, cell) {
    var span = getSpanById(documentRef, cell.spanId);

    if (!span) {
      return;
    }

    cell.span = span;
    cell.bounds = readSpanBounds(span);
  }

  function normalizePositionKey(positionShort) {
    return positionShort === 'Sr' ? 'Śr' : positionShort;
  }

  function isAttackLine2(view) {
    return /2l/i.test(String(view.scenarioOpt || ''));
  }

  function getDefaultPositionVisibility(view) {
    var visibility = {
      At: true,
      P: true,
      R: true,
      Śr: true,
      L: true
    };

    if (getViewType(view) === 'attack') {
      visibility.R = false;
      visibility.L = false;

      if (isAttackLine2(view)) {
        visibility.Śr = false;
      }
    }

    return visibility;
  }

  function initPositionVisibility(view) {
    if (state.positionVisibilityScenario !== view.scenarioOpt) {
      state.positionVisibility = getDefaultPositionVisibility(view);
      state.positionVisibilityScenario = view.scenarioOpt;
    }
  }

  function isPositionVisible(positionShort) {
    var key = normalizePositionKey(positionShort);

    if (!state.positionVisibility || state.positionVisibility[key] === undefined) {
      return true;
    }

    return Boolean(state.positionVisibility[key]);
  }

  function getVisibleRows(view) {
    return view.rows.filter(function (row) {
      return isPositionVisible(row.positionShort);
    });
  }

  function getFilteredRows(view) {
    return getVisibleRows(view);
  }

  function getSelectedRows(view) {
    return view.rows.filter(function (row) {
      return Boolean(state.selectedPlayerIds[row.playerId]);
    });
  }

  function getBulkTargetRows(view) {
    var selected = getSelectedRows(view);

    if (selected.length) {
      return selected;
    }

    return getVisibleRows(view);
  }

  function countSelectedPlayers() {
    return Object.keys(state.selectedPlayerIds).length;
  }

  function setPlayerSelected(playerId, selected) {
    if (!playerId) {
      return;
    }

    if (selected) {
      state.selectedPlayerIds[playerId] = true;
    } else {
      delete state.selectedPlayerIds[playerId];
    }

    if (state.updateSelectionUi) {
      state.updateSelectionUi();
    }
  }

  function clearPlayerSelection(documentRef) {
    state.selectedPlayerIds = {};
    syncCheckboxUi(documentRef);

    if (state.updateSelectionUi) {
      state.updateSelectionUi();
    }
  }

  function selectVisiblePlayers(documentRef) {
    var view = parseIndividualView(documentRef);

    view.rows.forEach(function (row) {
      if (!row.container || row.container.style.display === 'none') {
        return;
      }

      setPlayerSelected(row.playerId, true);
    });

    syncCheckboxUi(documentRef);
  }

  function applyBulkFieldValue(documentRef, statusNode, columnField, value) {
    var view = parseIndividualView(documentRef);
    var rows = getBulkTargetRows(view);

    applyFieldValue(documentRef, rows, columnField, value);
    updateDirtyUi(documentRef, statusNode);
  }

  function syncCheckboxUi(documentRef) {
    dom.queryVisibleAll(documentRef, '.viti-player-checkbox').forEach(function (checkbox) {
      var playerId = checkbox.getAttribute('data-viti-player-id');
      checkbox.checked = Boolean(state.selectedPlayerIds[playerId]);
    });
  }

  function parseAttributeValue(value) {
    var match = normalizeText(value).replace(',', '.').match(/-?\d+(?:\.\d+)?/);

    return match ? Number(match[0]) : null;
  }

  function parseTrainingPlayerDataFromHtml(html) {
    var result = {};
    var source = String(html || '');
    var rowRegex = /<tr><td class=(["'])second_left_right\1><\/td>[\s\S]*?Player&playerId=(\d+)[\s\S]*?<\/tr><tr><td class=(["'])second_bottom_left\3>/g;
    var rowMatch;

    while ((rowMatch = rowRegex.exec(source)) !== null) {
      var rowHtml = rowMatch[0];
      var playerId = rowMatch[2];
      var attrRegex = /span_player_value_(UM_[A-Z0-9_]+)[^>]*>[\s\S]*?<font class=['"]?link['"]?>\(([-\d.,]+)\)/g;
      var attrMatch;
      var attributes = {};

      while ((attrMatch = attrRegex.exec(rowHtml)) !== null) {
        var name = ATTRIBUTE_CODES[attrMatch[1]];
        var value = parseAttributeValue(attrMatch[2]);

        if (name && value !== null && !Number.isNaN(value)) {
          attributes[name] = value;
        }
      }

      result[playerId] = { attributes: attributes };
    }

    return result;
  }

  function readTrainingCache(storage) {
    var raw;
    var parsed;

    if (!storage) {
      return null;
    }

    try {
      raw = storage.getItem(TRAINING_CACHE_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }

    if (!parsed || !parsed.createdAt || !parsed.values) {
      return null;
    }

    if (Date.now() - parsed.createdAt > TRAINING_CACHE_TTL_MS) {
      return null;
    }

    return parsed.values;
  }

  function writeTrainingCache(storage, values) {
    if (!storage) {
      return;
    }

    try {
      storage.setItem(TRAINING_CACHE_KEY, JSON.stringify({
        createdAt: Date.now(),
        values: values
      }));
    } catch (error) {
      // Cache failures should not block the tactics view.
    }
  }

  function fetchTrainingPlayerData() {
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

    if (!root || !root.fetch) {
      return Promise.resolve(null);
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
      var values = parseTrainingPlayerDataFromHtml(extractVmBody(text));

      trainingState.status = 'loaded';
      trainingState.values = values;
      writeTrainingCache(root.sessionStorage, values);

      return values;
    }).catch(function () {
      trainingState.status = 'error';
      trainingState.values = null;
      return null;
    }).finally(function () {
      trainingPromise = null;
    });

    return trainingPromise;
  }

  function getGradeClass(value) {
    if (value <= 9.9) {
      return 'viti-grade-very-weak';
    }

    if (value <= 20.5) {
      return 'viti-grade-weak';
    }

    if (value <= 30.5) {
      return 'viti-grade-solid';
    }

    if (value <= 40.5) {
      return 'viti-grade-good';
    }

    if (value <= 47.5) {
      return 'viti-grade-very-good';
    }

    return 'viti-grade-elite';
  }

  function getAttackAttrChips(positionShort, line2) {
    var middle = [
      { label: 'Atak ze środka', short: 'Śrd' },
      { label: 'Omijanie bloku', short: 'Om' },
      { label: 'Kiwka', short: 'Kiw' }
    ];
    var wingLine = [
      { label: 'Atak ze skrzydła', short: 'Skr' },
      { label: 'Omijanie bloku', short: 'Om' },
      { label: 'Kiwka', short: 'Kiw' }
    ];
    var secondLine = [
      { label: 'Atak z 2 linii', short: '2L' },
      { label: 'Omijanie bloku', short: 'Om' },
      { label: 'Kiwka', short: 'Kiw' }
    ];
    var pos = normalizePositionKey(positionShort);

    if (pos === 'Śr') {
      return middle;
    }

    if (line2) {
      return secondLine;
    }

    return wingLine;
  }

  function getAttrChipsForRow(view, row) {
    var viewType = getViewType(view);
    var typeMap = TACTICS_ATTR_CHIPS[viewType];

    if (viewType === 'attack') {
      return getAttackAttrChips(row.positionShort, isAttackLine2(view));
    }

    if (!typeMap) {
      return [];
    }

    return typeMap[row.positionShort] || typeMap.default || [];
  }

  function findSaveLink(documentRef) {
    return dom.queryVisibleAll(documentRef, 'span.link').find(function (link) {
      return getOnClick(link).indexOf('IndividualSave') !== -1;
    }) || null;
  }

  function findPlayerNameCell(container) {
    var link = container.querySelector('span.link[onclick*="Player&playerId="], span.link[OnClick*="Player&playerId="]');

    return link ? link.closest('td') : null;
  }

  function renderAttributeChips(documentRef, chipsHost, chipDefs, attributes) {
    chipsHost.textContent = '';

    chipDefs.forEach(function (chipDef) {
      var value = attributes ? attributes[chipDef.label] : null;
      var chip = documentRef.createElement('span');
      var gradeClass;

      chip.className = 'viti-attr-chip';

      if (value === null || value === undefined || Number.isNaN(value)) {
        chip.textContent = chipDef.short + ' —';
        chip.className += ' viti-attr-chip-missing';
        chip.title = chipDef.label + ': brak danych';
      } else {
        gradeClass = getGradeClass(value);
        chip.textContent = chipDef.short + ' ' + Math.round(value);
        chip.className += ' ' + gradeClass;
        chip.title = chipDef.label + ': ' + value;
      }

      chipsHost.appendChild(chip);
    });
  }

  function applyTrainingAttributesToView(documentRef, view, trainingData) {
    if (!trainingData) {
      return;
    }

    view.rows.forEach(function (row) {
      var chipsHost = row.container ? row.container.querySelector('.viti-attr-chips') : null;
      var playerData = trainingData[row.playerId];
      var chipDefs;

      if (!chipsHost) {
        return;
      }

      chipDefs = getAttrChipsForRow(view, row);
      renderAttributeChips(
        documentRef,
        chipsHost,
        chipDefs,
        playerData ? playerData.attributes : null
      );
    });
  }

  function cleanupRowEnhancements(documentRef) {
    documentRef.querySelectorAll('.viti-attr-chips').forEach(function (node) {
      node.remove();
    });

    documentRef.querySelectorAll('.viti-player-select').forEach(function (node) {
      node.remove();
    });

    documentRef.querySelectorAll('[' + ROW_ENHANCED_ATTR + '="1"]').forEach(function (node) {
      node.removeAttribute(ROW_ENHANCED_ATTR);
    });
  }

  function attachRowEnhancements(documentRef, view) {
    view.rows.forEach(function (row) {
      var nameCell;
      var selectLabel;
      var checkbox;
      var chipsHost;
      var chipDefs;

      if (!row.container || row.container.getAttribute(ROW_ENHANCED_ATTR) === '1') {
        return;
      }

      nameCell = findPlayerNameCell(row.container);

      if (!nameCell) {
        return;
      }

      row.container.setAttribute(ROW_ENHANCED_ATTR, '1');

      selectLabel = documentRef.createElement('label');
      selectLabel.className = 'viti-player-select';
      selectLabel.title = 'Zaznacz zawodnika do edycji grupowej';

      checkbox = documentRef.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'viti-player-checkbox';
      checkbox.setAttribute('data-viti-player-id', row.playerId);
      checkbox.checked = Boolean(state.selectedPlayerIds[row.playerId]);
      checkbox.addEventListener('change', function () {
        setPlayerSelected(row.playerId, checkbox.checked);
      });

      selectLabel.appendChild(checkbox);
      nameCell.insertBefore(selectLabel, nameCell.firstChild);

      chipDefs = getAttrChipsForRow(view, row);

      if (chipDefs.length) {
        chipsHost = documentRef.createElement('div');
        chipsHost.className = 'viti-attr-chips';
        renderAttributeChips(documentRef, chipsHost, chipDefs, null);
        nameCell.appendChild(chipsHost);
      }
    });
  }

  function applyFieldValue(documentRef, rows, field, value) {
    rows.forEach(function (row) {
      var cell = row.fields[field];

      if (!cell) {
        return;
      }

      refreshRowFieldFromDom(documentRef, cell);
      setSpanValue(documentRef, cell.spanId, value, cell.bounds, cell.span);
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

      refreshRowFieldFromDom(documentRef, cell);
      setSpanValue(documentRef, cell.spanId, preset[presetField], cell.bounds, cell.span);
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

  function isPowerColumn(column) {
    var label = column.label.toLowerCase();

    return label.indexOf('siła') !== -1 ||
      label.indexOf('sila') !== -1 ||
      label.indexOf('(w %)') !== -1;
  }

  function getPresetColumns(view) {
    return view.columns.filter(function (column) {
      return !isPowerColumn(column);
    });
  }

  function getViewType(view) {
    var fields = view.columns.map(function (column) {
      return column.field;
    });
    var labels = view.columns.map(function (column) {
      return column.label.toLowerCase();
    });
    var scenario = String(view.scenarioOpt || '').toLowerCase();

    if (fields.indexOf('atak') !== -1) {
      return 'attack';
    }

    if (fields.indexOf('obr') !== -1 || fields.indexOf('asek') !== -1 ||
        fields.indexOf('obrona') !== -1 || fields.indexOf('asekuracja') !== -1) {
      return 'defense';
    }

    if (scenario.indexOf('opt=ser') !== -1 ||
        labels.some(function (label) { return label.indexOf('serwis') !== -1; })) {
      return 'serve';
    }

    if (scenario.indexOf('opt=roz') !== -1 ||
        labels.some(function (label) { return label.indexOf('rozgryw') !== -1; })) {
      return 'setting';
    }

    return 'generic';
  }

  function applyColumnValuesPreset(documentRef, view, rows, values) {
    var columns = getPresetColumns(view);

    rows.forEach(function (row) {
      columns.forEach(function (column, index) {
        var cell = row.fields[column.field];

        if (!cell || values[index] === undefined) {
          return;
        }

        setSpanValue(documentRef, cell.spanId, values[index], cell.bounds);
      });
    });
  }

  function getPresetMap(view) {
    if (getViewType(view) === 'attack') {
      return ATTACK_PRESETS;
    }

    return null;
  }

  function getPresetHint(view) {
    var type = getViewType(view);

    if (type === 'attack') {
      return PRESET_HINTS.attack;
    }

    if (type === 'defense') {
      return PRESET_HINTS.defense;
    }

    if (type === 'serve') {
      return PRESET_HINTS.serve;
    }

    return '';
  }

  function buildPresetActions(view, documentRef, statusNode) {
    var type = getViewType(view);
    var presetMap;

    if (type === 'defense') {
      return DEFENSE_GLOBAL_PRESETS.map(function (preset) {
        return {
          label: preset.label,
          title: preset.title,
          apply: function () {
            applyColumnValuesPreset(documentRef, view, view.rows, preset.values);
            updateDirtyUi(documentRef, statusNode);
          }
        };
      });
    }

    if (type === 'serve') {
      return SERVE_GLOBAL_PRESETS.map(function (preset) {
        return {
          label: preset.label,
          title: preset.title,
          apply: function () {
            applyColumnValuesPreset(documentRef, view, view.rows, preset.values);
            updateDirtyUi(documentRef, statusNode);
          }
        };
      });
    }

    if (type !== 'attack') {
      return [];
    }

    presetMap = ATTACK_PRESETS;

    return [
      {
        label: 'At/P',
        title: 'Atakujący i przyjmujący: 8/1/1',
        apply: function () {
          getVisibleRows(view)
            .filter(function (row) { return row.positionShort === 'At' || row.positionShort === 'P'; })
            .forEach(function (row) {
              applyPresetToRow(documentRef, row, presetMap[row.positionShort] || presetMap.At);
            });
          updateDirtyUi(documentRef, statusNode);
        }
      },
      {
        label: 'Śr',
        title: 'Środkowi: 8/3/1',
        apply: function () {
          getVisibleRows(view)
            .filter(function (row) { return row.positionShort === 'Śr' || row.positionShort === 'Sr'; })
            .forEach(function (row) {
              applyPresetToRow(documentRef, row, presetMap.Śr);
            });
          updateDirtyUi(documentRef, statusNode);
        }
      },
      {
        label: 'R/L',
        title: 'Rozgrywający i libero: 1/1/1',
        apply: function () {
          getVisibleRows(view)
            .filter(function (row) { return row.positionShort === 'R' || row.positionShort === 'L'; })
            .forEach(function (row) {
              applyPresetToRow(documentRef, row, presetMap[row.positionShort] || presetMap.R);
            });
          updateDirtyUi(documentRef, statusNode);
        }
      },
      {
        label: 'Wszystkie pozycje',
        title: 'Zastosuj presety pozycyjne do całej drużyny',
        apply: function () {
          applyPositionPresets(documentRef, { rows: getVisibleRows(view) }, presetMap);
          updateDirtyUi(documentRef, statusNode);
        }
      }
    ];
  }

  function updateRowVisibility(view) {
    view.rows.forEach(function (row) {
      if (!row.container) {
        return;
      }

      row.container.style.display = isPositionVisible(row.positionShort) ? '' : 'none';
    });
  }

  function syncPositionFilterUi(documentRef) {
    dom.queryVisibleAll(documentRef, '.viti-position-filter').forEach(function (checkbox) {
      var position = checkbox.getAttribute('data-viti-position');

      if (!position) {
        return;
      }

      checkbox.checked = isPositionVisible(position);
    });
  }

  var PANEL_BG = '#1a2430';
  var PANEL_BORDER = '#4a6078';

  function ensureStyles(documentRef) {
    var style = documentRef.getElementById(STYLE_ID);

    if (!style) {
      style = documentRef.createElement('style');
      style.id = STYLE_ID;
      documentRef.head.appendChild(style);
    }

    style.textContent = [
      '#' + PANEL_ID + ' {',
      '  margin: 0;',
      '  padding: 8px 10px;',
      '  border: 1px solid ' + PANEL_BORDER + ';',
      '  border-bottom: none;',
      '  border-radius: 0;',
      '  background: ' + PANEL_BG + ';',
      '  color: #d8e2ec;',
      '  font: 12px/1.4 Tahoma, Verdana, sans-serif;',
      '  width: 100%;',
      '  box-sizing: border-box;',
      '}',
      'tr.viti-panel-row td.viti-panel-cell {',
      '  padding: 0 !important;',
      '  background: ' + PANEL_BG + ' !important;',
      '}',
      'tr.viti-header-cap-row td,',
      'tr.viti-header-cap-row td.fourth_top_left,',
      'tr.viti-header-cap-row td.fourth_top_bottom,',
      'tr.viti-header-cap-row td.fourth_top_right {',
      '  height: 0 !important;',
      '  padding: 0 !important;',
      '  margin: 0 !important;',
      '  line-height: 0 !important;',
      '  font-size: 0 !important;',
      '  background: ' + PANEL_BG + ' !important;',
      '  background-image: none !important;',
      '  border: none !important;',
      '}',
      'tr.viti-header-row td.fourth,',
      'tr.viti-header-row td.fourth_left_right {',
      '  background: ' + PANEL_BG + ' !important;',
      '  background-image: none !important;',
      '  border-color: ' + PANEL_BORDER + ' !important;',
      '}',
      'tr.viti-header-row font.center {',
      '  color: #d8e2ec !important;',
      '}',
      'tr.viti-header-foot-row td,',
      'tr.viti-header-foot-row td.fourth_bottom_left,',
      'tr.viti-header-foot-row td.fourth_bottom_right,',
      'tr.viti-header-foot-row td.fourth_top_bottom {',
      '  height: 0 !important;',
      '  padding: 0 !important;',
      '  margin: 0 !important;',
      '  line-height: 0 !important;',
      '  font-size: 0 !important;',
      '  background: ' + PANEL_BG + ' !important;',
      '  background-image: none !important;',
      '  border: none !important;',
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
      '  white-space: nowrap;',
      '}',
      '#' + PANEL_ID + ' .viti-preset-group {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 6px;',
      '  align-items: center;',
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
      '}',
      '#' + PANEL_ID + ' .viti-selection-count {',
      '  color: #9eb4c8;',
      '  min-width: 110px;',
      '}',
      '#' + PANEL_ID + ' .viti-bulk-hint {',
      '  color: #7f93a8;',
      '  font-size: 11px;',
      '}',
      '#' + PANEL_ID + ' .viti-save-btn {',
      '  margin-left: auto;',
      '}',
      '#' + PANEL_ID + ' .viti-save-btn.viti-save-dirty {',
      '  border-color: #ffb347;',
      '  color: #ffb347;',
      '}',
      '.viti-player-select {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  margin-right: 6px;',
      '  vertical-align: middle;',
      '}',
      '.viti-player-checkbox {',
      '  margin: 0;',
      '  cursor: pointer;',
      '}',
      '.viti-attr-chips {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 4px;',
      '  margin-top: 3px;',
      '}',
      '.viti-attr-chip {',
      '  display: inline-block;',
      '  padding: 0 4px;',
      '  border-radius: 2px;',
      '  font: 10px/1.5 Tahoma, Verdana, sans-serif;',
      '  background: #243444;',
      '  color: #c5d4e0;',
      '  white-space: nowrap;',
      '}',
      '.viti-attr-chip-missing {',
      '  color: #7f93a8;',
      '}',
      '.viti-grade-very-weak { color: #8f9ba3 !important; }',
      '.viti-grade-weak { color: #d98b61 !important; }',
      '.viti-grade-solid { color: #ffd45c !important; }',
      '.viti-grade-good { color: #73d87a !important; }',
      '.viti-grade-very-good { color: #4bd6d6 !important; }',
      '.viti-grade-elite { color: #ff76d6 !important; }',
      '.viti-dirty-value {',
      '  color: #ffb347 !important;',
      '  font-weight: bold;',
      '}',
      '.viti-dirty-cell {',
      '  box-shadow: inset 0 0 0 1px #ffb347;',
      '}',
      '#' + PANEL_ID + ' .viti-position-filters {',
      '  display: flex;',
      '  flex-wrap: wrap;',
      '  gap: 10px;',
      '  align-items: center;',
      '}',
      '#' + PANEL_ID + ' .viti-position-filter-label {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 4px;',
      '  color: #d8e2ec;',
      '  cursor: pointer;',
      '}'
    ].join('\n');
  }

  function stylePanelHeaderIntegration(documentRef) {
    var anchorRow = findColumnHeaderAnchor(documentRef);
    var panelRow = documentRef.querySelector('tr.viti-panel-row');
    var capRow;
    var footRow;

    if (!anchorRow) {
      return;
    }

    anchorRow.classList.add('viti-header-row');

    footRow = anchorRow.nextElementSibling;

    if (footRow && footRow.tagName === 'TR') {
      footRow.classList.add('viti-header-foot-row');
    }

    if (panelRow) {
      capRow = panelRow.previousElementSibling;

      if (capRow && capRow.tagName === 'TR') {
        capRow.classList.add('viti-header-cap-row');
      }
    } else {
      capRow = anchorRow.previousElementSibling;

      if (capRow && capRow.tagName === 'TR' && !capRow.classList.contains('viti-panel-row')) {
        capRow.classList.add('viti-header-cap-row');
      }
    }
  }

  function updateDirtyFieldMarkers(documentRef, snapshot) {
    documentRef.querySelectorAll('.viti-dirty-value').forEach(function (node) {
      node.classList.remove('viti-dirty-value');
      node.removeAttribute('title');
    });

    documentRef.querySelectorAll('.viti-dirty-cell').forEach(function (node) {
      node.classList.remove('viti-dirty-cell');
    });

    if (!snapshot) {
      return;
    }

    Object.keys(snapshot).forEach(function (spanId) {
      var span = getSpanById(documentRef, spanId);
      var cell;
      var savedValue;
      var currentValue;

      if (!span) {
        return;
      }

      savedValue = snapshot[spanId];
      currentValue = readSpanValue(span);

      if (currentValue === savedValue) {
        return;
      }

      span.classList.add('viti-dirty-value');
      span.title = 'Niezapisane: ' + savedValue + ' → ' + currentValue;
      cell = span.closest('td');

      if (cell) {
        cell.classList.add('viti-dirty-cell');
      }
    });
  }

  function updateDirtyUi(documentRef, statusNode) {
    var dirtyCount = countDirtyChanges(documentRef, state.snapshot);
    var saveLink = findSaveLink(documentRef);
    var panelSaveButton = documentRef.querySelector('#' + PANEL_ID + ' .viti-save-btn');

    updateDirtyFieldMarkers(documentRef, state.snapshot);

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

    if (panelSaveButton) {
      if (dirtyCount) {
        panelSaveButton.classList.add('viti-save-dirty');
      } else {
        panelSaveButton.classList.remove('viti-save-dirty');
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
    panelTd.className = 'viti-panel-cell';
    panelTd.appendChild(panel);
    panelTr.className = 'viti-panel-row';
    panelTr.appendChild(panelTd);

    if (anchorRow && anchorRow.parentElement) {
      anchorRow.parentElement.insertBefore(panelTr, anchorRow);
      stylePanelHeaderIntegration(documentRef);
      return;
    }

    documentRef.body.appendChild(panel);
  }

  function buildPanel(documentRef, view) {
    var panel = documentRef.createElement('div');
    var filterRow = documentRef.createElement('div');
    var selectionRow = documentRef.createElement('div');
    var bulkRow = documentRef.createElement('div');
    var presetRow = documentRef.createElement('div');
    var statusRow = documentRef.createElement('div');
    var positionFilters = documentRef.createElement('div');
    var columnSelect = documentRef.createElement('select');
    var valueInput = documentRef.createElement('input');
    var statusNode = documentRef.createElement('span');
    var selectionCountNode = documentRef.createElement('span');
    var bulkHintNode = documentRef.createElement('span');
    var saveButton = documentRef.createElement('button');
    var i;

    function refreshBulkHint() {
      var selectedCount = countSelectedPlayers();

      if (selectedCount) {
        bulkHintNode.textContent = 'Zastosuj trafi do ' + selectedCount + ' zaznaczonych zawodników.';
      } else {
        bulkHintNode.textContent = 'Bez zaznaczenia: stosuj do widocznych pozycji.';
      }
    }

    function refreshSelectionUi() {
      selectionCountNode.textContent = 'Zaznaczeni: ' + countSelectedPlayers();
      refreshBulkHint();
    }

    panel.id = PANEL_ID;

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
    filterRow.appendChild(documentRef.createElement('label')).textContent = 'Pozycje:';
    positionFilters.className = 'viti-position-filters';

    POSITION_OPTIONS.forEach(function (position) {
      var positionLabel = documentRef.createElement('label');
      var positionCheckbox = documentRef.createElement('input');

      positionLabel.className = 'viti-position-filter-label';
      positionCheckbox.type = 'checkbox';
      positionCheckbox.className = 'viti-position-filter';
      positionCheckbox.setAttribute('data-viti-position', position);
      positionCheckbox.checked = isPositionVisible(position);
      positionCheckbox.addEventListener('change', function () {
        state.positionVisibility[position] = positionCheckbox.checked;

        if (!POSITION_OPTIONS.some(function (pos) {
          return state.positionVisibility[pos];
        })) {
          state.positionVisibility[position] = true;
          positionCheckbox.checked = true;
        }

        updateRowVisibility(parseIndividualView(documentRef));
      });

      positionLabel.appendChild(positionCheckbox);
      positionLabel.appendChild(documentRef.createTextNode(position));
      positionFilters.appendChild(positionLabel);
    });

    filterRow.appendChild(positionFilters);

    selectionRow.className = 'viti-row';
    selectionCountNode.className = 'viti-selection-count';
    selectionRow.appendChild(selectionCountNode);

    ['Zaznacz widocznych', 'Odznacz wszystkich'].forEach(function (label) {
      var button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', function () {
        if (label === 'Zaznacz widocznych') {
          selectVisiblePlayers(documentRef);
        } else {
          clearPlayerSelection(documentRef);
        }
      });
      selectionRow.appendChild(button);
    });

    bulkRow.className = 'viti-row';
    bulkRow.appendChild(documentRef.createElement('label')).textContent = 'Kolumna:';
    bulkRow.appendChild(columnSelect);
    valueInput.id = 'viti-bulk-value';

    ['1', '8'].forEach(function (presetValue) {
      var button = documentRef.createElement('button');
      button.type = 'button';
      button.textContent = presetValue;
      button.addEventListener('click', function () {
        applyBulkFieldValue(documentRef, statusNode, columnSelect.value, presetValue);
      });
      bulkRow.appendChild(button);
    });

    bulkRow.appendChild(valueInput);

    var applyButton = documentRef.createElement('button');
    applyButton.type = 'button';
    applyButton.textContent = 'Zastosuj';
    applyButton.addEventListener('click', function () {
      applyBulkFieldValue(documentRef, statusNode, columnSelect.value, valueInput.value);
    });
    bulkRow.appendChild(applyButton);

    bulkHintNode.className = 'viti-bulk-hint';
    bulkRow.appendChild(bulkHintNode);

    presetRow.className = 'viti-row';
    presetRow.appendChild(documentRef.createElement('label')).textContent = 'Presety:';

    var presetGroup = documentRef.createElement('div');
    presetGroup.className = 'viti-preset-group';

    var presetActions = buildPresetActions(view, documentRef, statusNode);
    var presetHintText = getPresetHint(view);

    presetActions.forEach(function (presetAction) {
      var button = documentRef.createElement('button');
      button.type = 'button';
      button.className = 'viti-preset-btn';
      button.textContent = presetAction.label;
      button.title = presetAction.title;
      button.addEventListener('click', presetAction.apply);
      presetGroup.appendChild(button);
    });

    presetRow.appendChild(presetGroup);

    if (presetHintText) {
      var presetHint = documentRef.createElement('span');
      presetHint.className = 'viti-preset-hint';
      presetHint.textContent = presetHintText;
      presetHint.title = presetHintText;
      presetRow.appendChild(presetHint);
    }

    if (presetActions.length) {
      panel.appendChild(filterRow);
      panel.appendChild(selectionRow);
      panel.appendChild(bulkRow);
      panel.appendChild(presetRow);
    } else {
      panel.appendChild(filterRow);
      panel.appendChild(selectionRow);
      panel.appendChild(bulkRow);
    }

    statusRow.className = 'viti-row';
    statusNode.className = 'viti-status';
    statusNode.textContent = 'Brak niezapisanych zmian';
    statusRow.appendChild(statusNode);

    saveButton.type = 'button';
    saveButton.className = 'viti-save-btn';
    saveButton.textContent = 'Zapisz';
    saveButton.title = 'Zapisz taktykę indywidualną';
    saveButton.addEventListener('click', function () {
      var saveLink = findSaveLink(documentRef);

      if (saveLink) {
        saveLink.click();
      }
    });
    statusRow.appendChild(saveButton);
    panel.appendChild(statusRow);

    state.updateSelectionUi = refreshSelectionUi;
    state.updatePositionFilterUi = function () {
      syncPositionFilterUi(documentRef);
    };
    refreshSelectionUi();
    syncPositionFilterUi(documentRef);

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

    cleanupRowEnhancements(documentRef);
    documentRef.querySelectorAll('.viti-header-row, .viti-header-cap-row, .viti-header-foot-row').forEach(function (row) {
      row.classList.remove('viti-header-row', 'viti-header-cap-row', 'viti-header-foot-row');
    });

    state.snapshot = null;
    state.scenarioSelect = null;
    state.selectedPlayerIds = {};
    state.positionVisibility = {};
    state.positionVisibilityScenario = '';
    state.updateSelectionUi = null;
    state.updatePositionFilterUi = null;
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
      ensureStyles(documentRef);
      stylePanelHeaderIntegration(documentRef);
      updateDirtyUi(documentRef, existingPanel.querySelector('.viti-status'));
      return;
    }

    cleanupIndividualEnhancements(documentRef);
    ensureStyles(documentRef);
    initPositionVisibility(view);

    built = buildPanel(documentRef, view);
    insertPanel(documentRef, built.panel);

    built.panel.setAttribute(SIGNATURE_ATTR, signature);

    if (!state.snapshot) {
      state.snapshot = takeSnapshot(view);
    }

    updateRowVisibility(view);
    attachRowEnhancements(documentRef, view);
    attachValueEnhancements(documentRef, view, built.statusNode);
    hookScenarioSelect(documentRef, built.statusNode);
    hookSaveLink(documentRef, built.statusNode);
    updateDirtyUi(documentRef, built.statusNode);

    fetchTrainingPlayerData().then(function (trainingData) {
      applyTrainingAttributesToView(documentRef, view, trainingData);
    });
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
    getViewType: getViewType,
    getPresetColumns: getPresetColumns,
    applyColumnValuesPreset: applyColumnValuesPreset,
    buildPresetActions: buildPresetActions,
    findColumnHeaderAnchor: findColumnHeaderAnchor,
    collectValueSpans: collectValueSpans,
    ATTACK_PRESETS: ATTACK_PRESETS,
    DEFENSE_GLOBAL_PRESETS: DEFENSE_GLOBAL_PRESETS,
    SERVE_GLOBAL_PRESETS: SERVE_GLOBAL_PRESETS
  };
}));
