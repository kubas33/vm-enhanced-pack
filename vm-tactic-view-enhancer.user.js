// ==UserScript==
// @name         VM Tactic View Enhancer
// @namespace    https://vm-manager.org/
// @version      0.1.6
// @description  Enhances VM Manager tactic view with match-day training progress warnings.
// @match        *://*.vm-manager.org/*
// @grant        none
// @run-at       document-end
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-tactic-view-enhancer.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-tactic-view-enhancer.user.js
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

  var STYLE_ID = 'vmt-style';
  var BADGE_CLASS = 'vmt-training-badge';
  var SUMMARY_CELL_CLASS = 'vmt-summary-cell';
  var SUMMARY_PANEL_CLASS = 'vmt-summary-panel';
  var ENHANCED_ATTR = 'data-vmt-enhanced';
  var SIGNATURE_ATTR = 'data-vmt-signature';
  var TRAINING_URL = '/Ajax_handler.php?phpsite=view_body.php&action=Training';
  var CACHE_KEY = 'vms.trainingPlayerData.v2';
  var CACHE_TTL_MS = 5 * 60 * 1000;
  var WARNING_THRESHOLD = 50;
  var STARTING_SLOTS = 7;
  var FIELD_POSITION_LABELS = {
    1: 'Rozgrywający',
    2: 'Przyjmujący 1',
    3: 'Środkowy',
    4: 'Atakujący',
    5: 'Przyjmujący 2',
    6: 'Środkowy',
    7: 'Libero'
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

  function parseTrainingPercentMapFromHtml(html) {
    var result = {};
    var source = String(html || '');
    var rowRegex = /<tr><td class=(["'])second_left_right\1><\/td>[\s\S]*?Player&playerId=(\d+)[\s\S]*?<\/tr><tr><td class=(["'])second_bottom_left\3>/g;
    var rowMatch;

    while ((rowMatch = rowRegex.exec(source)) !== null) {
      var rowHtml = rowMatch[0];
      var playerId = rowMatch[2];
      var percentMatch = rowHtml.match(/&nbsp;\s*(\d+)\s*%/);
      var percent = percentMatch ? Number(percentMatch[1]) : null;

      if (percent !== null && !Number.isNaN(percent)) {
        result[playerId] = {
          trainingPercent: Math.max(0, Math.min(100, percent))
        };
      }
    }

    return result;
  }

  function cleanPlayerLabel(value) {
    return normalizeText(value).replace(/^\([^)]+\)\s*/, '');
  }

  function parseSelectedOptionFromHtml(selectHtml) {
    var optionRegex = /<option\s+value=(['"]?)(\d+)\1([^>]*)>([^<]*)/gi;
    var optionMatch;

    while ((optionMatch = optionRegex.exec(String(selectHtml || ''))) !== null) {
      if (/\bselected\b/i.test(optionMatch[3])) {
        return {
          playerId: optionMatch[2],
          label: normalizeText(optionMatch[4]),
          name: cleanPlayerLabel(optionMatch[4])
        };
      }
    }

    return {
      playerId: '0',
      label: '',
      name: ''
    };
  }

  function parseSelectedTacticPlayersFromHtml(html) {
    var result = [];
    var source = String(html || '');
    var selectRegex = /<select\b[^>]*\bid=(['"])([^'"]*player(1[0-2]|[1-9]))\1[^>]*>[\s\S]*?<\/select>/gi;
    var selectMatch;
    var seen = {};

    while ((selectMatch = selectRegex.exec(source)) !== null) {
      var slot = Number(selectMatch[3]);
      var selected;

      if (seen[slot]) {
        continue;
      }

      selected = parseSelectedOptionFromHtml(selectMatch[0]);
      seen[slot] = true;
      result.push({
        slot: slot,
        selectId: selectMatch[2],
        playerId: selected.playerId,
        label: selected.label,
        name: selected.name
      });
    }

    return result.sort(function (left, right) {
      return left.slot - right.slot;
    });
  }

  function getTrainingPercent(values, playerId) {
    if (!playerId || playerId === '0' || !values ||
      !Object.prototype.hasOwnProperty.call(values, playerId)) {
      return null;
    }

    if (typeof values[playerId] === 'number') {
      return values[playerId];
    }

    if (values[playerId] && typeof values[playerId].trainingPercent === 'number') {
      return values[playerId].trainingPercent;
    }

    return null;
  }

  function getTrainingExcess(percent) {
    return typeof percent === 'number' && percent > WARNING_THRESHOLD ? percent - WARNING_THRESHOLD : 0;
  }

  function buildTacticTrainingSummary(players, trainingValues) {
    var enriched = players.map(function (player) {
      var percent = getTrainingPercent(trainingValues, player.playerId);
      var excess = getTrainingExcess(percent);

      return {
        slot: player.slot,
        selectId: player.selectId,
        playerId: player.playerId,
        label: player.label,
        name: player.name,
        percent: percent,
        excess: excess,
        countsInSummary: player.slot <= STARTING_SLOTS
      };
    });
    var startersAtRisk = enriched.filter(function (player) {
      return player.countsInSummary && player.excess > 0;
    });
    var possibleLoss = startersAtRisk.reduce(function (sum, player) {
      return sum + player.excess;
    }, 0);

    return {
      players: enriched,
      startersAtRisk: startersAtRisk,
      possibleLoss: possibleLoss
    };
  }

  function injectStyles(documentRef) {
    var style;

    if (documentRef.getElementById(STYLE_ID)) {
      return;
    }

    style = documentRef.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.vmt-training-wrap {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  margin-left: 6px;',
      '  vertical-align: middle;',
      '  font-size: 10px;',
      '  line-height: 1;',
      '}',
      '.vmt-training-field {',
      '  margin: 0;',
      '}',
      '.vmt-training-reserve {',
      '  margin-left: 6px;',
      '}',
      '.vmt-position-line {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '  width: 150px;',
      '  margin: 0 auto;',
      '  line-height: 1.1;',
      '}',
      '.vmt-position-label {',
      '  flex: 1 1 auto;',
      '  min-width: 0;',
      '  text-align: right;',
      '  white-space: nowrap;',
      '}',
      '.vmt-training-badge {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  justify-content: center;',
      '  min-width: 28px;',
      '  height: 16px;',
      '  padding: 0 5px;',
      '  border-radius: 4px;',
      '  color: #ffffff;',
      '  font-weight: bold;',
      '  box-sizing: border-box;',
      '  opacity: 0.92;',
      '}',
      '.vmt-training-safe { background: rgba(66, 173, 76, 0.82); }',
      '.vmt-training-risk { background: rgba(202, 152, 20, 0.86); }',
      '.vmt-training-danger { background: rgba(204, 55, 64, 0.9); }',
      '.vmt-training-missing {',
      '  background: rgba(106, 136, 154, 0.32);',
      '  color: #9fb8c7;',
      '}',
      '.vmt-summary-cell {',
      '  margin-top: 12px;',
      '  padding-top: 9px;',
      '  border-top: 1px solid rgba(80, 156, 202, 0.26);',
      '}',
      '.vmt-summary-panel {',
      '  width: 430px;',
      '  max-width: 100%;',
      '  color: #d7edf8;',
      '  font-size: 11px;',
      '  line-height: 1.35;',
      '}',
      '.vmt-summary-title {',
      '  margin-bottom: 5px;',
      '  color: #ffe36a;',
      '  font-size: 11px;',
      '  font-weight: bold;',
      '  text-align: left;',
      '}',
      '.vmt-summary-box {',
      '  padding: 6px 8px;',
      '  border: 1px solid rgba(80, 156, 202, 0.35);',
      '  background: rgba(1, 18, 28, 0.18);',
      '}',
      '.vmt-summary-warning {',
      '  display: flex;',
      '  gap: 6px;',
      '  align-items: flex-start;',
      '  margin-bottom: 5px;',
      '  color: #ffffff;',
      '  font-weight: bold;',
      '}',
      '.vmt-summary-icon {',
      '  color: #e3aa16;',
      '  font-size: 12px;',
      '  line-height: 1;',
      '}',
      '.vmt-summary-empty {',
      '  color: #73d87a;',
      '  text-align: center;',
      '}',
      '.vmt-summary-row {',
      '  display: flex;',
      '  justify-content: space-between;',
      '  gap: 12px;',
      '  margin-top: 3px;',
      '}',
      '.vmt-summary-name {',
      '  min-width: 0;',
      '  overflow: hidden;',
      '  text-overflow: ellipsis;',
      '  white-space: nowrap;',
      '}',
      '.vmt-summary-excess {',
      '  color: #ff6b6b;',
      '  font-weight: bold;',
      '  white-space: nowrap;',
      '}'
    ].join('\n');
    documentRef.head.appendChild(style);
  }

  function getPercentClass(percent) {
    if (percent === null) {
      return 'vmt-training-missing';
    }
    if (percent <= WARNING_THRESHOLD) {
      return 'vmt-training-safe';
    }
    if (percent <= 74) {
      return 'vmt-training-risk';
    }
    return 'vmt-training-danger';
  }

  function getSelectSlot(select) {
    var match = select && select.id ? select.id.match(/player(1[0-2]|[1-9])$/i) : null;

    return match ? Number(match[1]) : null;
  }

  function getSelectedPlayerFromSelect(select) {
    var slot = getSelectSlot(select);
    var option = select && select.options ? select.options[select.selectedIndex] : null;

    if (!slot) {
      return null;
    }

    return {
      slot: slot,
      selectId: select.id,
      playerId: option ? String(option.value || '0') : '0',
      label: option ? normalizeText(option.textContent) : '',
      name: option ? cleanPlayerLabel(option.textContent) : ''
    };
  }

  function getTacticPlayers(documentRef) {
    var selects = Array.prototype.slice.call(documentRef.querySelectorAll('select[id]'));
    var players = [];
    var seen = {};

    selects.forEach(function (select) {
      var player = getSelectedPlayerFromSelect(select);

      if (!player || seen[player.slot]) {
        return;
      }

      seen[player.slot] = true;
      players.push(player);
    });

    return players.sort(function (left, right) {
      return left.slot - right.slot;
    });
  }

  function isTacticPage(documentRef) {
    return Boolean(documentRef.querySelector('.set_tactic') && getTacticPlayers(documentRef).length > 0);
  }

  function createBadge(documentRef, percent) {
    var badge = documentRef.createElement('span');

    badge.className = BADGE_CLASS + ' ' + getPercentClass(percent);
    badge.textContent = percent === null ? '--' : percent + '%';

    return badge;
  }

  function removeDirectTrainingWrap(parent) {
    var children = parent ? Array.prototype.slice.call(parent.children) : [];

    children.forEach(function (child) {
      if (child.className && String(child.className).indexOf('vmt-training-wrap') !== -1) {
        child.remove();
      }
    });
  }

  function findSelectFrame(select) {
    var node = select;

    while (node && node.parentNode) {
      if (node.tagName && node.tagName.toLowerCase() === 'table' &&
        node.querySelector && node.querySelector('select') === select) {
        return node;
      }
      node = node.parentNode;
    }

    return null;
  }

  function getFieldPositionLabel(slot) {
    return FIELD_POSITION_LABELS[slot] || '';
  }

  function findExistingFieldPositionCell(documentRef, slot) {
    var line = documentRef.querySelector('.vmt-position-line[data-vmt-slot="' + slot + '"]');

    return line ? line.parentNode : null;
  }

  function findFieldPositionCell(documentRef, slot) {
    var existing = findExistingFieldPositionCell(documentRef, slot);
    var label = getFieldPositionLabel(slot);
    var cells;
    var matches;

    if (existing) {
      return existing;
    }

    if (!label) {
      return null;
    }

    cells = Array.prototype.slice.call(documentRef.querySelectorAll('.set_tactic td'));
    matches = cells.filter(function (cell) {
      return !cell.querySelector('select') && normalizeText(cell.textContent) === label;
    });

    if (label === 'Środkowy') {
      return matches[slot === 6 ? matches.length - 1 : 0] || null;
    }

    return matches[0] || null;
  }

  function renderFieldPlayerBadge(select, player) {
    var documentRef = select.ownerDocument;
    var frame = findSelectFrame(select);
    var selectParent = frame && frame.parentNode ? frame.parentNode : select.parentNode;
    var cell = findFieldPositionCell(documentRef, player.slot);
    var line;
    var label;
    var text;

    if (selectParent) {
      removeDirectTrainingWrap(selectParent);
    }

    if (!cell) {
      return;
    }

    label = getFieldPositionLabel(player.slot);
    cell.textContent = '';
    cell.setAttribute('align', 'center');

    line = documentRef.createElement('span');
    line.className = 'vmt-position-line';
    line.setAttribute('data-vmt-slot', String(player.slot));
    line.appendChild(createBadge(documentRef, player.percent));

    text = documentRef.createElement('span');
    text.className = 'vmt-position-label';
    text.textContent = label;
    line.appendChild(text);
    cell.appendChild(line);
  }

  function renderReservePlayerBadge(select, player) {
    var documentRef = select.ownerDocument;
    var frame = findSelectFrame(select);
    var parent = frame && frame.parentNode ? frame.parentNode : select.parentNode;
    var wrap;

    if (!parent) {
      return;
    }

    removeDirectTrainingWrap(parent);

    if (frame) {
      frame.style.display = 'inline-table';
      frame.style.verticalAlign = 'middle';
    }

    wrap = documentRef.createElement('span');
    wrap.className = 'vmt-training-wrap vmt-training-reserve';
    wrap.appendChild(createBadge(documentRef, player.percent));

    if (frame && frame.parentNode === parent) {
      parent.insertBefore(wrap, frame.nextSibling);
    } else {
      parent.appendChild(wrap);
    }
  }

  function renderPlayerBadge(select, player) {
    if (player.slot <= STARTING_SLOTS && select.closest && select.closest('.set_tactic')) {
      renderFieldPlayerBadge(select, player);
    } else {
      renderReservePlayerBadge(select, player);
    }
  }

  function findSelectBySlot(documentRef, slot) {
    var players = Array.prototype.slice.call(documentRef.querySelectorAll('select[id]'));
    var i;

    for (i = 0; i < players.length; i += 1) {
      if (getSelectSlot(players[i]) === slot) {
        return players[i];
      }
    }

    return null;
  }

  function removeLegacySummaryCells(documentRef) {
    Array.prototype.slice.call(documentRef.querySelectorAll('td.' + SUMMARY_CELL_CLASS)).forEach(function (cell) {
      cell.remove();
    });
  }

  function findBlockTacticCell(documentRef) {
    var rows = Array.prototype.slice.call(documentRef.querySelectorAll('tr'));
    var i;

    for (i = 0; i < rows.length; i += 1) {
      var cells = Array.prototype.slice.call(rows[i].children);
      var blockCell = cells.find(function (cell) {
        var text = normalizeText(cell.textContent);
        return text.indexOf('Taktyka bloku:') !== -1 && text.indexOf('Rezerwowi:') === -1;
      });

      if (blockCell) {
        return blockCell;
      }
    }

    return null;
  }

  function ensureSummaryHost(documentRef) {
    var blockCell = findBlockTacticCell(documentRef);
    var host;

    removeLegacySummaryCells(documentRef);

    if (!blockCell) {
      return null;
    }

    host = blockCell.querySelector('.' + SUMMARY_CELL_CLASS);
    if (host) {
      return host;
    }

    host = documentRef.createElement('div');
    host.className = SUMMARY_CELL_CLASS;
    blockCell.appendChild(host);

    return host;
  }

  function renderSummary(documentRef, summary) {
    var cell = ensureSummaryHost(documentRef);
    var panel;
    var title;
    var box;

    if (!cell) {
      return;
    }

    cell.textContent = '';
    panel = documentRef.createElement('div');
    title = documentRef.createElement('div');
    box = documentRef.createElement('div');
    panel.className = SUMMARY_PANEL_CLASS;
    title.className = 'vmt-summary-title';
    title.textContent = 'Podsumowanie treningu przed meczem';
    box.className = 'vmt-summary-box';

    if (!summary.startersAtRisk.length) {
      var empty = documentRef.createElement('div');
      empty.className = 'vmt-summary-empty';
      empty.textContent = 'Brak zawodników powyżej 50%';
      box.appendChild(empty);
    } else {
      var warning = documentRef.createElement('div');
      var icon = documentRef.createElement('span');
      var warningText = documentRef.createElement('span');

      warning.className = 'vmt-summary-warning';
      icon.className = 'vmt-summary-icon';
      icon.textContent = '⚠';
      warningText.textContent = summary.startersAtRisk.length + ' zawodników >50%, strata: ' + summary.possibleLoss + '%';
      warning.appendChild(icon);
      warning.appendChild(warningText);
      box.appendChild(warning);

      summary.startersAtRisk.forEach(function (player) {
        var row = documentRef.createElement('div');
        var name = documentRef.createElement('span');
        var excess = documentRef.createElement('span');

        row.className = 'vmt-summary-row';
        name.className = 'vmt-summary-name';
        name.textContent = positionMapper(player.slot) + ' ' + (player.name || player.label);
        excess.className = 'vmt-summary-excess';
        excess.textContent = '+' + player.excess + '%';
        row.appendChild(name);
        row.appendChild(excess);
        box.appendChild(row);
      });
    }

    panel.appendChild(title);
    panel.appendChild(box);
    cell.appendChild(panel);
  }

  function positionMapper(slot) {
    return {
    1: '(R)',
      2: '(P1)',
      3: '(S1)',
      4: '(A)',
      5: '(P2)',
      6: '(S2)',
      7: '(L)'
    }[slot] || '';
  }

  function createSignature(players) {
    return players.map(function (player) {
      return player.slot + ':' + player.playerId;
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
      // Cache failures should not affect the tactic view.
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
      var values = parseTrainingPercentMapFromHtml(html);

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

  function renderTrainingValues(values) {
    var documentRef = root.document;
    var players = getTacticPlayers(documentRef);
    var summary = buildTacticTrainingSummary(players, values);

    summary.players.forEach(function (player) {
      var select = findSelectBySlot(documentRef, player.slot);
      if (select) {
        renderPlayerBadge(select, player);
      }
    });

    renderSummary(documentRef, summary);
  }

  function renderTrainingError() {
    renderTrainingValues({});
  }

  function enhanceTactic() {
    var documentRef = root.document;
    var players;
    var signature;

    if (!isTacticPage(documentRef)) {
      return;
    }

    injectStyles(documentRef);
    players = getTacticPlayers(documentRef);
    signature = createSignature(players);

    if (documentRef.body.getAttribute(SIGNATURE_ATTR) === signature &&
      documentRef.body.getAttribute(ENHANCED_ATTR) === '1' &&
      documentRef.querySelectorAll('.vmt-training-wrap').length >= players.length &&
      documentRef.querySelector('.' + SUMMARY_PANEL_CLASS)) {
      return;
    }

    documentRef.body.setAttribute(SIGNATURE_ATTR, signature);
    documentRef.body.setAttribute(ENHANCED_ATTR, '1');

    fetchTrainingValues().then(renderTrainingValues).catch(renderTrainingError);
  }

  function scheduleEnhancement() {
    if (scheduleTimer) {
      root.clearTimeout(scheduleTimer);
    }

    scheduleTimer = root.setTimeout(function () {
      scheduleTimer = null;
      enhanceTactic();
    }, 120);
  }

  function start() {
    if (!root || !root.document || !root.fetch) {
      return;
    }

    enhanceTactic();

    new root.MutationObserver(scheduleEnhancement).observe(root.document.body, {
      childList: true,
      subtree: true
    });
  }

  return {
    buildTacticTrainingSummary: buildTacticTrainingSummary,
    extractVmBody: extractVmBody,
    getTrainingExcess: getTrainingExcess,
    parseSelectedTacticPlayersFromHtml: parseSelectedTacticPlayersFromHtml,
    parseTrainingPercentMapFromHtml: parseTrainingPercentMapFromHtml,
    start: start
  };
}));
