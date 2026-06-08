// ==UserScript==
// @name         VM Changes List Enhancer
// @namespace    https://vm-manager.org/
// @version      0.1.0
// @description  Sorting and filtering for VM Manager tactic changes list view.
// @match        *://*.vm-manager.org/*
// @match        *://vm-manager.org/*
// @grant        none
// @run-at       document-end
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-dom-utils.js
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-changes-list-enhancer.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-changes-list-enhancer.user.js
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
    throw new Error('VM Changes List Enhancer wymaga vm-dom-utils.js (@require).');
  }

  var STYLE_ID = 'vtcl-style';
  var PANEL_ID = 'vtcl-filter-panel';
  var SIGNATURE_ATTR = 'data-vtcl-signature';
  var SORT_KEY_ATTR = 'data-vtcl-sort-key';
  var SORT_DIR_ATTR = 'data-vtcl-sort-direction';
  var SORTABLE_CLASS = 'vtcl-sortable';
  var SORT_MARKER_CLASS = 'vtcl-sort-marker';
  var SET_FILTER_CLASS = 'vtcl-set-filter';
  var PLAYER_FILTER_ID = 'vtcl-player-filter';
  var SEARCH_INPUT_ID = 'vtcl-search-input';
  var COUNTER_CLASS = 'vtcl-counter';

  var SORT_KEYS = {
    playerOut: 'playerOut',
    playerIn: 'playerIn',
    activeSetCount: 'activeSetCount',
    activeSets: 'activeSets'
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
    var bodyMatch;

    if (!responseText) {
      return '';
    }

    try {
      return JSON.parse(responseText).body || '';
    } catch (error) {
      bodyMatch = responseText.match(/body:\s*'((?:\\.|[^'\\])*)'/);
      return bodyMatch ? unescapeVmString(bodyMatch[1]) : '';
    }
  }

  function isChangeAddView(documentRef) {
    var saveVisible = dom.queryVisibleAll(documentRef, 'span.link').some(function (el) {
      return getOnClick(el).indexOf('PlayersChangeAdd') !== -1;
    });

    return saveVisible && Boolean(dom.getVisibleElementById(documentRef, 'player_out'));
  }

  function findChangesHeaderRow(documentRef) {
    var rows = Array.prototype.slice.call(documentRef.querySelectorAll('tr'));
    var i;
    var row;
    var text;

    for (i = 0; i < rows.length; i += 1) {
      row = rows[i];

      if (!dom.isVisibleElement(row)) {
        continue;
      }

      text = normalizeText(row.textContent);
      if (text.indexOf('Zmiana') === -1 || text.indexOf('Sety') === -1) {
        continue;
      }

      if (row.querySelector('img[src*="menu_mr"]') || row.querySelector('img[title*="Wynik meczu"]')) {
        return row;
      }
    }

    return null;
  }

  function findChangeDataRows(documentRef) {
    return dom.queryVisibleAll(documentRef, 'span.small_link')
      .filter(function (el) {
        return getOnClick(el).indexOf('ChangeEdit&changeId=') !== -1;
      })
      .map(function (el) {
        return el.closest('tr');
      })
      .filter(Boolean);
  }

  function isChangesListView(documentRef) {
    return !isChangeAddView(documentRef) &&
      Boolean(findChangesHeaderRow(documentRef)) &&
      findChangeDataRows(documentRef).length > 0;
  }

  function getPlayerLinks(row) {
    return Array.prototype.slice.call(row.querySelectorAll('span.small_link')).filter(function (el) {
      return getOnClick(el).indexOf('Player&playerId=') !== -1;
    });
  }

  function getPlayerId(link) {
    var match = getOnClick(link).match(/playerId=(\d+)/);
    return match ? match[1] : '';
  }

  function getPlayerName(link) {
    return normalizeText(link ? link.textContent : '');
  }

  function parseSetsFromRow(row) {
    var sets = [false, false, false, false, false];
    var imgs = Array.prototype.slice.call(row.querySelectorAll('img[alt*="secie nr"]'));

    imgs.forEach(function (img) {
      var label = img.getAttribute('alt') || img.getAttribute('title') || '';
      var match = label.match(/secie nr (\d)/);

      if (!match) {
        return;
      }

      sets[parseInt(match[1], 10) - 1] = /będzie aktywna secie/.test(label);
    });

    return sets;
  }

  function getChangeId(row) {
    var editLink = Array.prototype.slice.call(row.querySelectorAll('span.small_link')).find(function (el) {
      return getOnClick(el).indexOf('ChangeEdit&changeId=') !== -1;
    });
    var match = editLink ? getOnClick(editLink).match(/changeId=(\d+)/) : null;

    return match ? match[1] : '';
  }

  function stripHtmlTags(value) {
    return normalizeText(String(value || '').replace(/<[^>]+>/g, ''));
  }

  function parseSetsFromHtmlFragment(fragment) {
    var sets = [false, false, false, false, false];
    var regex = /(?:alt|title)=["']([^"']*secie nr (\d)[^"']*)["']/gi;
    var match;

    while ((match = regex.exec(fragment)) !== null) {
      sets[parseInt(match[2], 10) - 1] = /będzie aktywna secie/.test(match[1]);
    }

    return sets;
  }

  function buildParsedChangeRow(data) {
    var activeSets = data.sets
      .map(function (active, index) {
        return active ? String(index + 1) : null;
      })
      .filter(Boolean);

    return {
      row: data.row || null,
      changeId: data.changeId,
      playerOutId: data.playerOutId,
      playerInId: data.playerInId,
      playerOut: data.playerOut,
      playerIn: data.playerIn,
      sets: data.sets,
      activeSets: activeSets,
      activeSetCount: activeSets.length,
      activeSetsLabel: activeSets.join(',')
    };
  }

  function parseChangeRow(row) {
    var links = getPlayerLinks(row);
    var sets = parseSetsFromRow(row);

    return buildParsedChangeRow({
      row: row,
      changeId: getChangeId(row),
      playerOutId: getPlayerId(links[0]),
      playerInId: getPlayerId(links[1]),
      playerOut: getPlayerName(links[0]),
      playerIn: getPlayerName(links[1]),
      sets: sets
    });
  }

  function parseChangeRowsFromHtmlRegex(html) {
    var results = [];
    var regex = /<span class=['"]small_link['"][^>]*Player&playerId=(\d+)[^>]*>([\s\S]*?)<\/span>\s*<img[^>]*change_zm[^>]*>\s*<span class=['"]small_link['"][^>]*Player&playerId=(\d+)[^>]*>([\s\S]*?)<\/span>([\s\S]*?)ChangeEdit&changeId=(\d+)/gi;
    var match;

    while ((match = regex.exec(html)) !== null) {
      results.push(buildParsedChangeRow({
        changeId: match[6],
        playerOutId: match[1],
        playerInId: match[3],
        playerOut: stripHtmlTags(match[2]),
        playerIn: stripHtmlTags(match[4]),
        sets: parseSetsFromHtmlFragment(match[5])
      }));
    }

    return results;
  }

  function parseChangeRowsFromHtml(html, documentRef) {
    var parser;
    var doc;
    var rows;

    if (documentRef && documentRef.createElement) {
      doc = documentRef.implementation.createHTMLDocument('');
      doc.body.innerHTML = html;
      rows = findChangeDataRows(doc);
      return rows.map(parseChangeRow);
    }

    if (typeof DOMParser !== 'undefined') {
      parser = new DOMParser();
      doc = parser.parseFromString('<div id="vtcl-root">' + html + '</div>', 'text/html');
      rows = findChangeDataRows(doc);
      return rows.map(parseChangeRow);
    }

    return parseChangeRowsFromHtmlRegex(html);
  }

  function getChangeBlock(row) {
    var innerTable = row.closest('table');
    var tableCell = innerTable ? innerTable.parentNode : null;
    var blockRow = tableCell && tableCell.parentNode ? tableCell.parentNode : null;
    var spacerRow = blockRow ? blockRow.nextElementSibling : null;

    if (!blockRow || blockRow.tagName.toLowerCase() !== 'tr') {
      return null;
    }

    if (spacerRow &&
      spacerRow.tagName.toLowerCase() === 'tr' &&
      spacerRow.querySelector('td[height="1"]')) {
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

  function setBlockVisible(block, visible) {
    block.blockRow.style.display = visible ? '' : 'none';
    if (block.spacerRow) {
      block.spacerRow.style.display = visible ? '' : 'none';
    }
  }

  function getSortValue(parsed, sortKey) {
    if (sortKey === SORT_KEYS.playerOut) {
      return parsed.playerOut.toLocaleLowerCase('pl');
    }

    if (sortKey === SORT_KEYS.playerIn) {
      return parsed.playerIn.toLocaleLowerCase('pl');
    }

    if (sortKey === SORT_KEYS.activeSetCount) {
      return parsed.activeSetCount;
    }

    if (sortKey === SORT_KEYS.activeSets) {
      return parsed.activeSetsLabel;
    }

    return null;
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

  function getActiveSetFilters(documentRef) {
    var selected = dom.queryVisibleAll(documentRef, '.' + SET_FILTER_CLASS + ':checked').map(function (input) {
      return input.value;
    });

    if (!selected.length || selected.indexOf('all') !== -1) {
      return null;
    }

    return selected;
  }

  function getSearchQuery(documentRef) {
    var input = dom.getVisibleElementById(documentRef, SEARCH_INPUT_ID) ||
      documentRef.getElementById(SEARCH_INPUT_ID);

    return input ? normalizeText(input.value).toLocaleLowerCase('pl') : '';
  }

  function getSelectedPlayerId(documentRef) {
    var select = dom.getVisibleElementById(documentRef, PLAYER_FILTER_ID) ||
      documentRef.getElementById(PLAYER_FILTER_ID);

    return select ? select.value : '';
  }

  function rowMatchesFilters(parsed, documentRef) {
    var query = getSearchQuery(documentRef);
    var playerId = getSelectedPlayerId(documentRef);
    var setFilters = getActiveSetFilters(documentRef);
    var haystack;

    if (query) {
      haystack = (parsed.playerOut + ' ' + parsed.playerIn).toLocaleLowerCase('pl');
      if (haystack.indexOf(query) === -1) {
        return false;
      }
    }

    if (playerId && parsed.playerOutId !== playerId && parsed.playerInId !== playerId) {
      return false;
    }

    if (setFilters) {
      return setFilters.every(function (setNumber) {
        return parsed.sets[parseInt(setNumber, 10) - 1];
      });
    }

    return true;
  }

  function updateCounter(documentRef, visibleCount, totalCount) {
    var counter = documentRef.querySelector('.' + COUNTER_CLASS);

    if (!counter) {
      return;
    }

    counter.textContent = visibleCount === totalCount
      ? 'Zmian: ' + totalCount
      : 'Pokazano ' + visibleCount + ' / ' + totalCount;
  }

  function applyFilters(documentRef) {
    var rows = findChangeDataRows(documentRef);
    var parsedRows = rows.map(parseChangeRow);
    var visibleCount = 0;

    parsedRows.forEach(function (parsed) {
      var block = getChangeBlock(parsed.row);
      var visible = rowMatchesFilters(parsed, documentRef);

      if (!block) {
        return;
      }

      setBlockVisible(block, visible);
      if (visible) {
        visibleCount += 1;
      }
    });

    updateCounter(documentRef, visibleCount, parsedRows.length);
  }

  function sortChangesBy(sortKey, documentRef) {
    var rows = findChangeDataRows(documentRef);
    var currentKey = documentRef.body.getAttribute(SORT_KEY_ATTR);
    var currentDirection = documentRef.body.getAttribute(SORT_DIR_ATTR) || 'desc';
    var nextDirection = currentKey === sortKey && currentDirection === 'desc' ? 'asc' : 'desc';
    var blocks;
    var parent;

    blocks = rows.map(function (row, index) {
      var block = getChangeBlock(row);
      var parsed = parseChangeRow(row);

      if (!block) {
        return null;
      }

      return {
        index: index,
        value: getSortValue(parsed, sortKey),
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

    documentRef.body.setAttribute(SORT_KEY_ATTR, sortKey);
    documentRef.body.setAttribute(SORT_DIR_ATTR, nextDirection);
    updateSortControls(documentRef, sortKey, nextDirection);
    applyFilters(documentRef);
  }

  function ensureSortMarker(button) {
    var marker = button.querySelector('.' + SORT_MARKER_CLASS);

    if (!marker) {
      marker = button.ownerDocument.createElement('span');
      marker.className = SORT_MARKER_CLASS;
      marker.setAttribute('aria-hidden', 'true');
      button.appendChild(marker);
    }

    return marker;
  }

  function updateSortControls(documentRef, activeKey, direction) {
    Array.prototype.slice.call(documentRef.querySelectorAll('.' + SORTABLE_CLASS)).forEach(function (button) {
      var marker = ensureSortMarker(button);
      var key = button.getAttribute('data-vtcl-sort-key');

      marker.textContent = key === activeKey ? (direction === 'asc' ? ' ^' : ' v') : '';
      button.setAttribute('aria-pressed', key === activeKey ? 'true' : 'false');
    });
  }

  function createSortButton(documentRef, label, sortKey) {
    var button = documentRef.createElement('button');
    var marker = documentRef.createElement('span');

    button.type = 'button';
    button.className = SORTABLE_CLASS;
    button.setAttribute('data-vtcl-sort-key', sortKey);
    button.setAttribute('title', 'Sortuj po: ' + label);
    button.textContent = label;
    marker.className = SORT_MARKER_CLASS;
    marker.setAttribute('aria-hidden', 'true');
    button.appendChild(marker);

    button.addEventListener('click', function () {
      sortChangesBy(sortKey, documentRef);
    });

    return button;
  }

  function collectPlayers(parsedRows) {
    var map = {};
    var players = [];

    parsedRows.forEach(function (parsed) {
      if (parsed.playerOutId && !map[parsed.playerOutId]) {
        map[parsed.playerOutId] = true;
        players.push({ id: parsed.playerOutId, name: parsed.playerOut });
      }
      if (parsed.playerInId && !map[parsed.playerInId]) {
        map[parsed.playerInId] = true;
        players.push({ id: parsed.playerInId, name: parsed.playerIn });
      }
    });

    players.sort(function (left, right) {
      return left.name.localeCompare(right.name, 'pl');
    });

    return players;
  }

  function populatePlayerFilter(select, parsedRows) {
    var players = collectPlayers(parsedRows);
    var currentValue = select.value;

    select.textContent = '';
    select.appendChild(new Option('Wszyscy zawodnicy', ''));

    players.forEach(function (player) {
      select.appendChild(new Option(player.name, player.id));
    });

    if (currentValue && players.some(function (player) { return player.id === currentValue; })) {
      select.value = currentValue;
    }
  }

  function createSetFilterChip(documentRef, label, value, checked) {
    var chip = documentRef.createElement('label');
    var input = documentRef.createElement('input');
    var text = documentRef.createElement('span');

    chip.className = 'vtcl-filter-chip';
    input.className = SET_FILTER_CLASS;
    input.type = 'checkbox';
    input.value = value;
    input.checked = checked;
    text.textContent = label;

    input.addEventListener('change', function () {
      if (value === 'all' && input.checked) {
        dom.queryVisibleAll(documentRef, '.' + SET_FILTER_CLASS).forEach(function (checkbox) {
          if (checkbox.value !== 'all') {
            checkbox.checked = false;
          }
        });
      } else if (value !== 'all' && input.checked) {
        dom.queryVisibleAll(documentRef, '.' + SET_FILTER_CLASS).forEach(function (checkbox) {
          if (checkbox.value === 'all') {
            checkbox.checked = false;
          }
        });
      } else if (value !== 'all') {
        var anySet = dom.queryVisibleAll(documentRef, '.' + SET_FILTER_CLASS).some(function (checkbox) {
          return checkbox.value !== 'all' && checkbox.checked;
        });

        if (!anySet) {
          dom.queryVisibleAll(documentRef, '.' + SET_FILTER_CLASS).forEach(function (checkbox) {
            checkbox.checked = checkbox.value === 'all';
          });
        }
      }

      applyFilters(documentRef);
    });

    chip.appendChild(input);
    chip.appendChild(text);

    return chip;
  }

  function resetFilters(documentRef) {
    var search = documentRef.getElementById(SEARCH_INPUT_ID);
    var player = documentRef.getElementById(PLAYER_FILTER_ID);

    if (search) {
      search.value = '';
    }
    if (player) {
      player.value = '';
    }

    dom.queryVisibleAll(documentRef, '.' + SET_FILTER_CLASS).forEach(function (checkbox) {
      checkbox.checked = checkbox.value === 'all';
    });

    applyFilters(documentRef);
  }

  function injectStyles(documentRef) {
    if (documentRef.getElementById(STYLE_ID)) {
      return;
    }

    var style = documentRef.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + PANEL_ID + ' {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  margin: 0 0 6px 0;',
      '  padding: 8px 10px;',
      '  background: #102f43;',
      '  border: 1px solid #2f80b7;',
      '  color: #e8f4fa;',
      '  font: 12px Arial, sans-serif;',
      '}',
      '.vtcl-filter-row {',
      '  display: flex;',
      '  align-items: center;',
      '  flex-wrap: wrap;',
      '  gap: 8px;',
      '  margin-top: 6px;',
      '}',
      '.vtcl-filter-row:first-child {',
      '  margin-top: 0;',
      '}',
      '.vtcl-filter-label {',
      '  color: #9fb8c7;',
      '}',
      '.vtcl-search-input {',
      '  min-width: 180px;',
      '  padding: 3px 6px;',
      '  border: 1px solid rgba(80, 156, 202, 0.45);',
      '  background: #0b2231;',
      '  color: #ffffff;',
      '}',
      '.vtcl-player-select {',
      '  min-width: 180px;',
      '  max-width: 240px;',
      '  padding: 2px 4px;',
      '  border: 1px solid rgba(80, 156, 202, 0.45);',
      '  background: #0b2231;',
      '  color: #ffffff;',
      '}',
      '.vtcl-filter-chip {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  gap: 3px;',
      '  padding: 2px 6px;',
      '  border: 1px solid rgba(80, 156, 202, 0.35);',
      '  border-radius: 3px;',
      '}',
      '.vtcl-filter-chip input {',
      '  margin: 0;',
      '}',
      '.vtcl-sortable {',
      '  padding: 2px 8px;',
      '  border: 1px solid rgba(80, 156, 202, 0.45);',
      '  background: #0b2231;',
      '  color: #d8ecff;',
      '  cursor: pointer;',
      '}',
      '.vtcl-sortable:hover {',
      '  color: #ffffff;',
      '}',
      '.vtcl-sortable[aria-pressed="true"] {',
      '  border-color: #facc15;',
      '  color: #facc15;',
      '}',
      '.vtcl-sort-marker {',
      '  font-size: 10px;',
      '}',
      '.vtcl-counter {',
      '  color: #facc15;',
      '  margin-left: auto;',
      '}',
      '.vtcl-reset {',
      '  padding: 2px 8px;',
      '  border: 1px solid rgba(80, 156, 202, 0.45);',
      '  background: #0b2231;',
      '  color: #d8ecff;',
      '  cursor: pointer;',
      '}'
    ].join('\n');

    documentRef.head.appendChild(style);
  }

  function createFilterPanel(documentRef, parsedRows) {
    var panel = documentRef.createElement('div');
    var rowSearch = documentRef.createElement('div');
    var rowSets = documentRef.createElement('div');
    var rowSort = documentRef.createElement('div');
    var searchLabel = documentRef.createElement('span');
    var searchInput = documentRef.createElement('input');
    var playerLabel = documentRef.createElement('span');
    var playerSelect = documentRef.createElement('select');
    var setsLabel = documentRef.createElement('span');
    var sortLabel = documentRef.createElement('span');
    var counter = documentRef.createElement('span');
    var reset = documentRef.createElement('button');
    var setNumber;

    panel.id = PANEL_ID;

    rowSearch.className = 'vtcl-filter-row';
    rowSets.className = 'vtcl-filter-row';
    rowSort.className = 'vtcl-filter-row';

    searchLabel.className = 'vtcl-filter-label';
    searchLabel.textContent = 'Szukaj:';
    searchInput.id = SEARCH_INPUT_ID;
    searchInput.className = 'vtcl-search-input';
    searchInput.type = 'search';
    searchInput.placeholder = 'Nazwisko zawodnika...';
    searchInput.addEventListener('input', function () {
      applyFilters(documentRef);
    });

    playerLabel.className = 'vtcl-filter-label';
    playerLabel.textContent = 'Zawodnik:';
    playerSelect.id = PLAYER_FILTER_ID;
    playerSelect.className = 'vtcl-player-select';
    playerSelect.addEventListener('change', function () {
      applyFilters(documentRef);
    });
    populatePlayerFilter(playerSelect, parsedRows);

    counter.className = COUNTER_CLASS;
    reset.className = 'vtcl-reset';
    reset.type = 'button';
    reset.textContent = 'Reset';
    reset.addEventListener('click', function () {
      resetFilters(documentRef);
    });

    rowSearch.appendChild(searchLabel);
    rowSearch.appendChild(searchInput);
    rowSearch.appendChild(playerLabel);
    rowSearch.appendChild(playerSelect);
    rowSearch.appendChild(reset);
    rowSearch.appendChild(counter);

    setsLabel.className = 'vtcl-filter-label';
    setsLabel.textContent = 'Sety:';
    rowSets.appendChild(setsLabel);
    rowSets.appendChild(createSetFilterChip(documentRef, 'wszystkie', 'all', true));
    for (setNumber = 1; setNumber <= 5; setNumber += 1) {
      rowSets.appendChild(createSetFilterChip(documentRef, String(setNumber), String(setNumber), false));
    }

    sortLabel.className = 'vtcl-filter-label';
    sortLabel.textContent = 'Sortuj:';
    rowSort.appendChild(sortLabel);
    rowSort.appendChild(createSortButton(documentRef, 'Schodzący', SORT_KEYS.playerOut));
    rowSort.appendChild(createSortButton(documentRef, 'Wchodzący', SORT_KEYS.playerIn));
    rowSort.appendChild(createSortButton(documentRef, 'Liczba setów', SORT_KEYS.activeSetCount));
    rowSort.appendChild(createSortButton(documentRef, 'Sety', SORT_KEYS.activeSets));

    panel.appendChild(rowSearch);
    panel.appendChild(rowSets);
    panel.appendChild(rowSort);

    return panel;
  }

  function createSignature(parsedRows) {
    return parsedRows.map(function (parsed) {
      return parsed.changeId;
    }).join('|');
  }

  function cleanupChangesList(documentRef) {
    var panel = documentRef.getElementById(PANEL_ID);

    if (panel) {
      panel.remove();
    }

    findChangeDataRows(documentRef).forEach(function (row) {
      var block = getChangeBlock(row);
      if (block) {
        setBlockVisible(block, true);
      }
    });

    documentRef.body.removeAttribute(SIGNATURE_ATTR);
    documentRef.body.removeAttribute(SORT_KEY_ATTR);
    documentRef.body.removeAttribute(SORT_DIR_ATTR);
  }

  function enhanceChangesList(documentRef) {
    var headerRow = findChangesHeaderRow(documentRef);
    var rows = findChangeDataRows(documentRef);
    var parsedRows = rows.map(parseChangeRow);
    var signature = createSignature(parsedRows);
    var headerTable;
    var parent;
    var panel;

    if (!headerRow || !parsedRows.length) {
      return;
    }

    injectStyles(documentRef);

    if (documentRef.body.getAttribute(SIGNATURE_ATTR) === signature && documentRef.getElementById(PANEL_ID)) {
      populatePlayerFilter(documentRef.getElementById(PLAYER_FILTER_ID), parsedRows);
      applyFilters(documentRef);
      return;
    }

    cleanupChangesList(documentRef);
    documentRef.body.setAttribute(SIGNATURE_ATTR, signature);

    headerTable = headerRow.closest('table');
    parent = headerTable ? headerTable.parentNode : null;
    if (!parent) {
      return;
    }

    panel = createFilterPanel(documentRef, parsedRows);
    parent.insertBefore(panel, headerTable);

    applyFilters(documentRef);
  }

  function start() {
    if (!root || !root.document) {
      return;
    }

    dom.createViewScheduler({
      document: root.document,
      isActive: isChangesListView,
      onEnhance: enhanceChangesList,
      onDeactivate: cleanupChangesList,
      delayMs: 120
    }).start();
  }

  return {
    extractVmBody: extractVmBody,
    parseChangeRow: parseChangeRow,
    parseChangeRowsFromHtml: parseChangeRowsFromHtml,
    parseChangeRowsFromHtmlRegex: parseChangeRowsFromHtmlRegex,
    findChangeDataRows: findChangeDataRows,
    isChangesListView: isChangesListView,
    isChangeAddView: isChangeAddView,
    rowMatchesFilters: rowMatchesFilters,
    getSortValue: getSortValue,
    start: start
  };
}));
