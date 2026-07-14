// ==UserScript==
// @name         VM Changes List Enhancer
// @namespace    https://vm-manager.org/
// @version      0.2.0
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
  var PANEL_ROW_ID = 'vtcl-filter-panel-row';
  var SIGNATURE_ATTR = 'data-vtcl-signature';
  var SORT_KEY_ATTR = 'data-vtcl-sort-key';
  var SORT_DIR_ATTR = 'data-vtcl-sort-direction';
  var SORTABLE_CLASS = 'vtcl-sortable';
  var SORT_MARKER_CLASS = 'vtcl-sort-marker';
  var SET_FILTER_CLASS = 'vtcl-set-filter';
  var POSITION_FILTER_CLASS = 'vtcl-position-filter';
  var PLAYER_FILTER_ID = 'vtcl-player-filter';
  var SEARCH_INPUT_ID = 'vtcl-search-input';
  var COUNTER_CLASS = 'vtcl-counter';
  var POSITION_STATUS_CLASS = 'vtcl-position-status';
  var BULK_CHECKBOX_CLASS = 'vtcl-bulk-checkbox';
  var BULK_SELECT_VISIBLE_CLASS = 'vtcl-bulk-select-visible';
  var BULK_CLEAR_CLASS = 'vtcl-bulk-clear';
  var BULK_DELETE_CLASS = 'vtcl-bulk-delete';
  var BULK_STATUS_CLASS = 'vtcl-bulk-status';

  var DEBUG_STORAGE_KEY = 'vtcl.debug';
  var STATE_STORAGE_KEY = 'vtcl.listState.v1';
  var POSITION_OPTIONS = ['At', 'P', 'Śr', 'R', 'L'];
  var enhancing = false;
  var lastEnhanceKey = '';
  var activeListContext = null;
  var activePositionRoute = '';
  var activePlayerPositionMap = {};
  var positionLoadPromises = {};

  function findChangeEditAnchor(documentRef, scope, requireVisible) {
    var root = scope && scope.querySelectorAll ? scope : documentRef;
    var links = Array.prototype.slice.call(root.querySelectorAll('span.small_link')).filter(function (el) {
      return getOnClick(el).indexOf('ChangeEdit&changeId=') !== -1;
    });
    var visibleLink = links.find(function (el) {
      return dom.isVisibleElement(el);
    });

    if (requireVisible === false) {
      return visibleLink || links[0] || null;
    }

    return visibleLink || null;
  }

  function hasChangesListContent(documentRef) {
    return Boolean(findChangeEditAnchor(documentRef, null, false)) ||
      Boolean(dom.getVisibleElementById(documentRef, PANEL_ID));
  }

  function isContextAlive(context) {
    if (!context || !context.scope || !context.scope.isConnected) {
      return false;
    }

    if (!context.mountTarget || !context.mountTarget.parent || !context.mountTarget.parent.isConnected) {
      return false;
    }

    return context.dataRows.some(function (row) {
      return row && row.isConnected;
    });
  }

  function invalidateStaleContext() {
    if (activeListContext && !isContextAlive(activeListContext)) {
      activeListContext = null;
      lastEnhanceKey = '';
      return true;
    }

    return false;
  }

  function getCachedListRoot() {
    if (!activeListContext || !isContextAlive(activeListContext)) {
      return null;
    }

    return {
      headerRow: activeListContext.headerRow,
      headerBlockRow: activeListContext.headerBlockRow,
      listTable: activeListContext.listTable,
      dataRows: activeListContext.dataRows,
      scope: activeListContext.scope,
      mountTarget: activeListContext.mountTarget
    };
  }

  function rememberListContext(listRoot, signature) {
    activeListContext = {
      headerRow: listRoot.headerRow,
      headerBlockRow: listRoot.headerBlockRow,
      listTable: listRoot.listTable,
      dataRows: listRoot.dataRows,
      scope: listRoot.scope,
      mountTarget: listRoot.mountTarget,
      signature: signature
    };
  }

  function clearListContext() {
    activeListContext = null;
  }

  function isDebugEnabled() {
    if (!root || !root.localStorage) {
      return false;
    }

    return root.localStorage.getItem(DEBUG_STORAGE_KEY) === '1';
  }

  function debugLog() {
    if (!isDebugEnabled() || !root || !root.console) {
      return;
    }

    root.console.log.apply(root.console, ['[vtcl]'].concat(Array.prototype.slice.call(arguments)));
  }

  function infoLog() {
    if (!root || !root.console) {
      return;
    }

    root.console.info.apply(root.console, ['[vtcl]'].concat(Array.prototype.slice.call(arguments)));
  }

  function isInvalidScopeNode(node) {
    if (!node || !node.tagName) {
      return true;
    }

    var tag = node.tagName.toLowerCase();
    return tag === 'body' || tag === 'html' || tag === 'head';
  }

  function findVmContentPanel(documentRef, visibleEdit) {
    var node = visibleEdit;

    while (node && node.parentNode) {
      if (node.id && node.id.indexOf('view_panel_body') === 0) {
        return node;
      }
      node = node.parentNode;
    }

    return dom.queryVisibleFirst(documentRef, '[id^="view_panel_body"]');
  }

  function getViewScope(documentRef) {
    var editAnchor;
    var vmPanel;
    var node;

    invalidateStaleContext();

    if (activeListContext && activeListContext.scope) {
      return activeListContext.scope;
    }

    editAnchor = findChangeEditAnchor(documentRef);
    if (!editAnchor) {
      return null;
    }

    vmPanel = findVmContentPanel(documentRef, editAnchor);
    node = editAnchor;

    while (node && node.nodeType === 1) {
      if (isInvalidScopeNode(node)) {
        break;
      }

      if (vmPanel && node !== vmPanel && !vmPanel.contains(node)) {
        node = node.parentNode;
        continue;
      }

      if (findChangeDataRowsInScope(node).length &&
        findChangesHeaderRow(documentRef, node, false)) {
        return node;
      }

      node = node.parentNode;
    }

    return vmPanel;
  }

  function describeNode(node) {
    if (!node || !node.tagName) {
      return String(node);
    }

    return node.tagName.toLowerCase() +
      (node.id ? '#' + node.id : '') +
      (node.className ? '.' + String(node.className).trim().replace(/\s+/g, '.') : '');
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function normalizePositionShort(value) {
    var text = normalizeText(value);

    if (text === 'Sr') {
      return 'Śr';
    }

    if (text === 'A') {
      return 'At';
    }

    return text;
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

  function parsePlayerPositionMapFromTacticHtml(html) {
    var result = {};
    var optionRegex = /<option\s+value=(['"]?)(\d+)\1[^>]*>\s*\(([^)]+)\)/gi;
    var match;
    var position;

    while ((match = optionRegex.exec(String(html || ''))) !== null) {
      position = normalizePositionShort(match[3]);
      if (POSITION_OPTIONS.indexOf(position) !== -1) {
        result[match[2]] = position;
      }
    }

    return result;
  }

  function getChangesRouteFromListRoot(listRoot) {
    var row = listRoot && listRoot.dataRows && listRoot.dataRows[0];
    var deleteRoute = row ? getChangeDeleteRoute(row) : '';
    var parsed;

    if (deleteRoute) {
      parsed = parseVmRoute(deleteRoute);
      return parsed.action + '&type=' + encodeURIComponent(parsed.params.type || 'League') + '&subview=Changes';
    }

    return '';
  }

  function getTacticRouteFromChangesRoute(route) {
    var parsed = parseVmRoute(route);

    if (!parsed.action) {
      return '';
    }

    return parsed.action + '&type=' + encodeURIComponent(parsed.params.type || 'League') + '&subview=Tactic';
  }

  function updatePositionStatus(documentRef, text) {
    var panel = getFilterPanel(documentRef);
    var status = panel ? panel.querySelector('.' + POSITION_STATUS_CLASS) : null;

    if (status && status.textContent !== (text || '')) {
      status.textContent = text || '';
    }
  }

  function applyPositionMap(documentRef, changesRoute, map) {
    activePositionRoute = changesRoute || '';
    activePlayerPositionMap = map || {};
    updatePositionStatus(documentRef, Object.keys(activePlayerPositionMap).length
      ? 'Pozycje załadowane.'
      : 'Pozycje niedostępne.');
    applyFilters(documentRef);
  }

  function loadPositionMapForList(documentRef, listRoot) {
    var changesRoute = getChangesRouteFromListRoot(listRoot);
    var tacticRoute = getTacticRouteFromChangesRoute(changesRoute);

    if (!changesRoute || !tacticRoute || !root || typeof root.fetch !== 'function') {
      updatePositionStatus(documentRef, 'Pozycje niedostępne.');
      return;
    }

    if (activePositionRoute === changesRoute && Object.keys(activePlayerPositionMap).length) {
      updatePositionStatus(documentRef, 'Pozycje załadowane.');
      return;
    }

    updatePositionStatus(documentRef, 'Ładuję pozycje...');

    if (!positionLoadPromises[changesRoute]) {
      positionLoadPromises[changesRoute] = root.fetch(buildAjaxUrlFromVmRoute(tacticRoute), {
        method: 'GET',
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest'
        }
      })
        .then(function (response) {
          if (!response.ok) {
            throw new Error('HTTP ' + response.status);
          }
          return response.text();
        })
        .then(function (text) {
          return parsePlayerPositionMapFromTacticHtml(extractVmBody(text));
        });
    }

    positionLoadPromises[changesRoute]
      .then(function (map) {
        applyPositionMap(documentRef, changesRoute, map);
      })
      .catch(function (error) {
        debugLog('loadPositionMapForList failed', error && error.message ? error.message : error);
        if (activePositionRoute !== changesRoute) {
          activePositionRoute = changesRoute;
          activePlayerPositionMap = {};
        }
        updatePositionStatus(documentRef, 'Nie udało się załadować pozycji.');
        applyFilters(documentRef, listRoot);
      });
  }

  var SORT_KEYS = {
    playerOut: 'playerOut',
    playerIn: 'playerIn',
    activeSetCount: 'activeSetCount',
    activeSets: 'activeSets'
  };

  function getStorage() {
    if (!root || !root.localStorage) {
      return null;
    }

    return root.localStorage;
  }

  function isValidSortKey(sortKey) {
    return Object.keys(SORT_KEYS).some(function (key) {
      return SORT_KEYS[key] === sortKey;
    });
  }

  function isValidSortDirection(direction) {
    return direction === 'asc' || direction === 'desc';
  }

  function normalizeSetFilters(values) {
    var map = {};
    var result = [];

    if (!Array.isArray(values)) {
      return ['all'];
    }

    values.forEach(function (value) {
      var text = String(value);

      if (text === 'all' || /^[1-5]$/.test(text)) {
        map[text] = true;
      }
    });

    if (map.all) {
      return ['all'];
    }

    ['1', '2', '3', '4', '5'].forEach(function (value) {
      if (map[value]) {
        result.push(value);
      }
    });

    return result.length ? result : ['all'];
  }

  function normalizePositionFilters(values) {
    var map = {};
    var result = [];

    if (!Array.isArray(values)) {
      return ['all'];
    }

    values.forEach(function (value) {
      var text = normalizePositionShort(value);

      if (text === 'all' || POSITION_OPTIONS.indexOf(text) !== -1) {
        map[text] = true;
      }
    });

    if (map.all) {
      return ['all'];
    }

    POSITION_OPTIONS.forEach(function (value) {
      if (map[value]) {
        result.push(value);
      }
    });

    return result.length ? result : ['all'];
  }

  function normalizeStoredState(state) {
    var result = {
      search: '',
      playerId: '',
      setFilters: ['all'],
      positionFilters: ['all'],
      sortKey: '',
      sortDirection: ''
    };

    if (!state || typeof state !== 'object') {
      return result;
    }

    result.search = typeof state.search === 'string' ? state.search : '';
    result.playerId = typeof state.playerId === 'string' ? state.playerId : '';
    result.setFilters = normalizeSetFilters(state.setFilters);
    result.positionFilters = normalizePositionFilters(state.positionFilters);

    if (isValidSortKey(state.sortKey) && isValidSortDirection(state.sortDirection)) {
      result.sortKey = state.sortKey;
      result.sortDirection = state.sortDirection;
    }

    return result;
  }

  function readListState() {
    var storage = getStorage();
    var raw;

    if (!storage) {
      return normalizeStoredState(null);
    }

    try {
      raw = storage.getItem(STATE_STORAGE_KEY);
      return normalizeStoredState(raw ? JSON.parse(raw) : null);
    } catch (error) {
      return normalizeStoredState(null);
    }
  }

  function writeListState(state) {
    var storage = getStorage();

    if (!storage) {
      return;
    }

    try {
      storage.setItem(STATE_STORAGE_KEY, JSON.stringify(normalizeStoredState(state)));
    } catch (error) {
      // ignore storage failures
    }
  }

  function clearListState() {
    var storage = getStorage();

    if (!storage) {
      return;
    }

    try {
      storage.removeItem(STATE_STORAGE_KEY);
    } catch (error) {
      // ignore storage failures
    }
  }

  function getCurrentListState(documentRef) {
    var panel = getFilterPanel(documentRef);
    var search = panel ? panel.querySelector('#' + dom.cssEscape(SEARCH_INPUT_ID)) : null;
    var player = panel ? panel.querySelector('#' + dom.cssEscape(PLAYER_FILTER_ID)) : null;
    var selectedSets = queryPanelControls(documentRef, '.' + SET_FILTER_CLASS + ':checked').map(function (input) {
      return input.value;
    });
    var selectedPositions = queryPanelControls(documentRef, '.' + POSITION_FILTER_CLASS + ':checked').map(function (input) {
      return input.value;
    });

    return normalizeStoredState({
      search: search ? search.value : '',
      playerId: player ? player.value : '',
      setFilters: selectedSets,
      positionFilters: selectedPositions,
      sortKey: documentRef.body.getAttribute(SORT_KEY_ATTR) || '',
      sortDirection: documentRef.body.getAttribute(SORT_DIR_ATTR) || ''
    });
  }

  function saveCurrentListState(documentRef) {
    writeListState(getCurrentListState(documentRef));
  }

  function isChangeAddView(documentRef) {
    var saveVisible = dom.queryVisibleAll(documentRef, 'span.link').some(function (el) {
      return getOnClick(el).indexOf('PlayersChangeAdd') !== -1;
    });

    return saveVisible && Boolean(dom.getVisibleElementById(documentRef, 'player_out'));
  }

  function findChangesHeaderRow(documentRef, scope, requireVisible) {
    var rootScope = scope && scope.querySelectorAll ? scope : documentRef;
    var rows = Array.prototype.slice.call(rootScope.querySelectorAll('tr'));
    var i;
    var row;
    var text;

    for (i = 0; i < rows.length; i += 1) {
      row = rows[i];

      if (requireVisible !== false && !dom.isVisibleElement(row)) {
        continue;
      }

      text = normalizeText(row.textContent);
      if (text.indexOf('Zmiana') === -1 || text.indexOf('Sety') === -1) {
        continue;
      }

      if (row.querySelector('img[src*="menu_mr"]') ||
        row.querySelector('img[title*="Wynik meczu"]') ||
        row.querySelector('img[alt*="Wynik meczu"]')) {
        return row;
      }
    }

    return null;
  }

  function collectDebugStatus(documentRef) {
    var scope = getViewScope(documentRef);
    var headerRow = scope ? findChangesHeaderRow(documentRef, scope, false) : null;
    var scopedRows = scope ? findChangeDataRowsInScope(scope) : [];
    var panel = documentRef.getElementById(PANEL_ID);

    return {
      debugEnabled: isDebugEnabled(),
      isChangeAddView: isChangeAddView(documentRef),
      scope: scope ? describeNode(scope) : 'none',
      headerFound: Boolean(headerRow),
      headerVisible: headerRow ? dom.isVisibleElement(headerRow) : false,
      scopedDataRows: scopedRows.length,
      mountedPanel: Boolean(panel && panel.isConnected),
      mountedPanelVisible: Boolean(dom.getVisibleElementById(documentRef, PANEL_ID)),
      mountMode: panel && panel.isConnected ? 'div' : 'none'
    };
  }

  function findChangeDataRowsInScope(scope) {
    if (!scope || !scope.querySelectorAll) {
      return [];
    }

    return Array.prototype.slice.call(scope.querySelectorAll('span.small_link'))
      .filter(function (el) {
        return getOnClick(el).indexOf('ChangeEdit&changeId=') !== -1;
      })
      .map(function (el) {
        return el.closest('tr');
      })
      .filter(Boolean);
  }

  function findChangeDataRows(documentRef, listRoot) {
    var scope = listRoot && listRoot.listTable ? listRoot.listTable : documentRef;

    return findChangeDataRowsInScope(scope);
  }

  function isChangesListView(documentRef) {
    if (isChangeAddView(documentRef)) {
      return false;
    }

    invalidateStaleContext();

    if (isContextAlive(activeListContext)) {
      return Boolean(findChangesHeaderRow(documentRef, activeListContext.scope, true));
    }

    if (!findChangeEditAnchor(documentRef, null, true)) {
      return false;
    }

    return Boolean(findChangesListRoot(documentRef));
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

  function getChangeDeleteRoute(row) {
    var deleteLink = Array.prototype.slice.call(row.querySelectorAll('span.small_link')).find(function (el) {
      return getOnClick(el).indexOf('ChangeDelete&changeId=') !== -1;
    });
    var onclick = deleteLink ? getOnClick(deleteLink) : '';
    var match = onclick.match(/callGetViewPanelBodyBig_1\(['"]([^'"]+)['"]\)/);

    return match ? match[1] : '';
  }

  function parseVmRoute(route) {
    var parts = String(route || '').split('&');
    var action = parts.shift() || '';
    var params = {};

    parts.forEach(function (part) {
      var splitAt = part.indexOf('=');
      var key;
      var value;

      if (splitAt === -1) {
        return;
      }

      key = part.slice(0, splitAt);
      value = part.slice(splitAt + 1);

      try {
        key = decodeURIComponent(key.replace(/\+/g, ' '));
        value = decodeURIComponent(value.replace(/\+/g, ' '));
      } catch (error) {
        // keep raw values when decoding fails
      }

      params[key] = value;
    });

    return {
      action: action,
      params: params
    };
  }

  function buildAjaxUrlFromVmRoute(route) {
    var parsed = parseVmRoute(route);
    var params = new URLSearchParams({
      phpsite: 'view_body.php',
      action: parsed.action
    });

    Object.keys(parsed.params).forEach(function (key) {
      params.set(key, parsed.params[key]);
    });

    return '/Ajax_handler.php?' + params.toString();
  }

  function getChangesListRouteFromDeleteRoute(route) {
    var parsed = parseVmRoute(route);
    var type = parsed.params.type || 'League';

    return parsed.action + '&type=' + encodeURIComponent(type) + '&subview=Changes';
  }

  async function deleteChangeByRoute(route) {
    var response = await fetch(buildAjaxUrlFromVmRoute(route), {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      throw new Error('HTTP ' + response.status);
    }

    return response.text();
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

  function getTableParent(node) {
    var parent = node ? node.parentNode : null;

    if (!parent) {
      return null;
    }

    if (parent.tagName.toLowerCase() === 'tbody') {
      return parent.parentNode;
    }

    if (parent.tagName.toLowerCase() === 'table') {
      return parent;
    }

    return null;
  }

  function getBlockRowFromInnerRow(row) {
    var innerTable;
    var tableCell;
    var blockRow;
    var listTable;
    var node;

    if (!row) {
      return null;
    }

    innerTable = row.closest('table');
    if (innerTable) {
      tableCell = innerTable.parentNode;
      if (tableCell && tableCell.tagName.toLowerCase() === 'td') {
        blockRow = tableCell.parentNode;
        if (blockRow && blockRow.tagName.toLowerCase() === 'tr') {
          return blockRow;
        }
      }
    }

    node = row;
    while (node && node.tagName && node.tagName.toLowerCase() !== 'body') {
      if (node.tagName.toLowerCase() === 'tr') {
        listTable = getTableParent(node);
        if (listTable && findChangeDataRowsInScope(listTable).length) {
          return node;
        }
      }
      node = node.parentNode;
    }

    return null;
  }

  function findListContainer(blockRow, headerRow) {
    var node = blockRow;

    while (node && node.tagName && node.tagName.toLowerCase() !== 'body') {
      if (node.tagName.toLowerCase() === 'table') {
        if (findChangeDataRowsInScope(node).length &&
          (!headerRow || node.contains(headerRow))) {
          return node;
        }
      }
      node = node.parentNode;
    }

    return getTableParent(blockRow);
  }

  function getChangeBlock(row) {
    var blockRow = getBlockRowFromInnerRow(row);
    var spacerRow = blockRow ? blockRow.nextElementSibling : null;

    if (!blockRow) {
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

  function getBulkCheckboxes(documentRef) {
    return Array.prototype.slice.call(documentRef.querySelectorAll('.' + BULK_CHECKBOX_CLASS));
  }

  function getSelectedBulkItems(documentRef) {
    return getBulkCheckboxes(documentRef)
      .filter(function (checkbox) {
        return checkbox.checked;
      })
      .map(function (checkbox) {
        var row = checkbox.closest('tr');
        var parsed = row ? parseChangeRow(row) : null;

        if (!row || !parsed || !parsed.changeId) {
          return null;
        }

        return {
          row: row,
          checkbox: checkbox,
          changeId: parsed.changeId,
          label: parsed.playerOut + ' <= ' + parsed.playerIn,
          route: getChangeDeleteRoute(row)
        };
      })
      .filter(function (item) {
        return item && item.route;
      });
  }

  function isBulkCheckboxVisible(checkbox) {
    var row = checkbox ? checkbox.closest('tr') : null;
    var block = row ? getChangeBlock(row) : null;

    return Boolean(block && block.blockRow.style.display !== 'none');
  }

  function updateBulkDeleteControls(documentRef) {
    var panel = getFilterPanel(documentRef);
    var selectedCount = getSelectedBulkItems(documentRef).length;
    var status = panel ? panel.querySelector('.' + BULK_STATUS_CLASS) : null;
    var deleteButton = panel ? panel.querySelector('.' + BULK_DELETE_CLASS) : null;
    var clearButton = panel ? panel.querySelector('.' + BULK_CLEAR_CLASS) : null;

    if (status) {
      status.textContent = selectedCount ? 'Zaznaczono: ' + selectedCount : 'Zaznacz wybrane zmiany do usunięcia.';
    }

    if (deleteButton) {
      deleteButton.disabled = selectedCount === 0;
    }

    if (clearButton) {
      clearButton.disabled = selectedCount === 0;
    }
  }

  function ensureBulkCheckbox(row) {
    var links;
    var targetCell;
    var wrap;
    var checkbox;

    if (!row || row.querySelector('.' + BULK_CHECKBOX_CLASS)) {
      return;
    }

    links = getPlayerLinks(row);
    targetCell = links[0] ? links[0].closest('td') : row.cells[0];
    if (!targetCell) {
      return;
    }

    wrap = row.ownerDocument.createElement('label');
    checkbox = row.ownerDocument.createElement('input');

    wrap.className = 'vtcl-bulk-checkbox-wrap';
    wrap.title = 'Zaznacz zmianę do masowego usunięcia';
    checkbox.type = 'checkbox';
    checkbox.className = BULK_CHECKBOX_CLASS;
    checkbox.value = getChangeId(row);

    checkbox.addEventListener('change', function () {
      updateBulkDeleteControls(row.ownerDocument);
    });

    wrap.appendChild(checkbox);
    targetCell.insertBefore(wrap, targetCell.firstChild);
  }

  function ensureBulkCheckboxes(documentRef, listRoot) {
    var root = listRoot || getCachedListRoot() || findChangesListRoot(documentRef);

    if (!root) {
      return;
    }

    root.dataRows.forEach(ensureBulkCheckbox);
    updateBulkDeleteControls(documentRef);
  }

  function clearBulkSelection(documentRef) {
    getBulkCheckboxes(documentRef).forEach(function (checkbox) {
      checkbox.checked = false;
    });
    updateBulkDeleteControls(documentRef);
  }

  function selectVisibleBulkRows(documentRef) {
    getBulkCheckboxes(documentRef).forEach(function (checkbox) {
      if (isBulkCheckboxVisible(checkbox)) {
        checkbox.checked = true;
      }
    });
    updateBulkDeleteControls(documentRef);
  }

  function removeBulkDeleteControls(documentRef) {
    Array.prototype.slice.call(documentRef.querySelectorAll('.vtcl-bulk-checkbox-wrap')).forEach(function (wrap) {
      wrap.remove();
    });
  }

  async function deleteSelectedChanges(documentRef) {
    var items = getSelectedBulkItems(documentRef);
    var panel = getFilterPanel(documentRef);
    var status = panel ? panel.querySelector('.' + BULK_STATUS_CLASS) : null;
    var buttons = panel ? panel.querySelectorAll('button') : [];
    var listRoute;
    var summary;
    var i;

    if (!items.length) {
      updateBulkDeleteControls(documentRef);
      return;
    }

    summary = items.slice(0, 12).map(function (item) {
      return item.label;
    }).join('\n');

    if (items.length > 12) {
      summary += '\n...';
    }

    if (!root.confirm('Usunąć zaznaczone zmiany: ' + items.length + '?\n\n' + summary)) {
      return;
    }

    Array.prototype.forEach.call(buttons, function (button) {
      button.disabled = true;
    });

    try {
      for (i = 0; i < items.length; i += 1) {
        if (status) {
          status.textContent = 'Usuwam ' + (i + 1) + '/' + items.length + '...';
        }
        await deleteChangeByRoute(items[i].route);
      }

      if (status) {
        status.textContent = 'Usunięto: ' + items.length;
      }

      listRoute = getChangesListRouteFromDeleteRoute(items[0].route);
      clearListContext();
      lastEnhanceKey = '';

      if (root && typeof root.callGetViewPanelBodyBig_1 === 'function') {
        root.callGetViewPanelBodyBig_1(listRoute);
      } else {
        items.forEach(function (item) {
          var block = getChangeBlock(item.row);

          if (block && block.blockRow) {
            block.blockRow.remove();
          }
          if (block && block.spacerRow) {
            block.spacerRow.remove();
          }
        });
        enhanceChangesList(documentRef);
      }
    } catch (error) {
      Array.prototype.forEach.call(buttons, function (button) {
        button.disabled = false;
      });
      if (status) {
        status.textContent = 'Błąd usuwania: ' + error.message;
      }
      updateBulkDeleteControls(documentRef);
    }
  }

  function findChangesListRoot(documentRef) {
    var scope = getViewScope(documentRef);
    var headerRow;
    var headerBlockRow;
    var dataRows;
    var listTable;
    var mountTarget;

    if (!scope) {
      return null;
    }

    headerRow = findChangesHeaderRow(documentRef, scope, true);
    if (!headerRow) {
      headerRow = findChangesHeaderRow(documentRef, scope, false);
    }

    if (!headerRow) {
      debugLog('findChangesListRoot: brak nagłówka w scope', describeNode(scope));
      return null;
    }

    headerBlockRow = getBlockRowFromInnerRow(headerRow) || headerRow;
    dataRows = findChangeDataRowsInScope(scope);

    if (!dataRows.length) {
      debugLog('findChangesListRoot: brak wierszy ChangeEdit w scope', describeNode(scope));
      return null;
    }

    listTable = findListContainer(headerBlockRow, headerRow) || getTableParent(headerBlockRow) || scope;
    mountTarget = getMountTarget(headerRow, headerBlockRow, scope);

    if (!mountTarget) {
      debugLog('findChangesListRoot: brak mountTarget', describeNode(scope));
      return null;
    }

    return {
      headerRow: headerRow,
      headerBlockRow: headerBlockRow,
      listTable: listTable,
      dataRows: findChangeDataRowsInScope(listTable).length ? findChangeDataRowsInScope(listTable) : dataRows,
      scope: scope,
      mountTarget: mountTarget
    };
  }

  function getMountTarget(headerRow, headerBlockRow, scope) {
    var headerTable = headerRow.closest('table');
    var parent = headerTable ? headerTable.parentNode : null;
    var node;

    if (parent && scope && scope.contains(parent)) {
      return {
        parent: parent,
        before: headerTable
      };
    }

    if (headerBlockRow.parentNode && scope && scope.contains(headerBlockRow)) {
      return {
        parent: headerBlockRow.parentNode,
        before: headerBlockRow
      };
    }

    node = headerBlockRow;
    while (node && node !== scope) {
      if (node.parentNode && scope.contains(node.parentNode)) {
        return {
          parent: node.parentNode,
          before: node
        };
      }
      node = node.parentNode;
    }

    if (scope) {
      return {
        parent: scope,
        before: scope.firstElementChild
      };
    }

    return null;
  }

  function isPanelMounted(documentRef, listRoot) {
    var panel = documentRef.getElementById(PANEL_ID);

    if (!panel || !panel.isConnected || !listRoot || !listRoot.scope) {
      return false;
    }

    return listRoot.scope.contains(panel);
  }

  function getFilterPanel(documentRef) {
    return dom.getVisibleElementById(documentRef, PANEL_ID) || documentRef.getElementById(PANEL_ID);
  }

  function queryPanelControls(documentRef, selector) {
    var panel = getFilterPanel(documentRef);

    if (!panel) {
      return [];
    }

    return Array.prototype.slice.call(panel.querySelectorAll(selector));
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
    var selected = queryPanelControls(documentRef, '.' + SET_FILTER_CLASS + ':checked').map(function (input) {
      return input.value;
    });

    if (!selected.length || selected.indexOf('all') !== -1) {
      return null;
    }

    return selected;
  }

  function getActivePositionFilters(documentRef) {
    var selected = queryPanelControls(documentRef, '.' + POSITION_FILTER_CLASS + ':checked').map(function (input) {
      return normalizePositionShort(input.value);
    });

    if (!selected.length || selected.indexOf('all') !== -1) {
      return null;
    }

    return selected;
  }

  function getSearchQuery(documentRef) {
    var panel = getFilterPanel(documentRef);
    var input = panel ? panel.querySelector('#' + dom.cssEscape(SEARCH_INPUT_ID)) : null;

    return input ? normalizeText(input.value).toLocaleLowerCase('pl') : '';
  }

  function getSelectedPlayerId(documentRef) {
    var panel = getFilterPanel(documentRef);
    var select = panel ? panel.querySelector('#' + dom.cssEscape(PLAYER_FILTER_ID)) : null;

    return select ? select.value : '';
  }

  function rowMatchesFilters(parsed, documentRef) {
    var query = getSearchQuery(documentRef);
    var playerId = getSelectedPlayerId(documentRef);
    var setFilters = getActiveSetFilters(documentRef);
    var positionFilters = getActivePositionFilters(documentRef);
    var playerOutPosition;
    var playerInPosition;
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
      if (!setFilters.every(function (setNumber) {
        return parsed.sets[parseInt(setNumber, 10) - 1];
      })) {
        return false;
      }
    }

    if (positionFilters) {
      playerOutPosition = activePlayerPositionMap[parsed.playerOutId] || '';
      playerInPosition = activePlayerPositionMap[parsed.playerInId] || '';

      if (positionFilters.indexOf(playerOutPosition) === -1 &&
        positionFilters.indexOf(playerInPosition) === -1) {
        return false;
      }
    }

    return true;
  }

  function updateCounter(documentRef, visibleCount, totalCount) {
    var panel = getFilterPanel(documentRef);
    var counter = panel ? panel.querySelector('.' + COUNTER_CLASS) : null;

    if (!counter) {
      return;
    }

    counter.textContent = visibleCount === totalCount
      ? 'Zmian: ' + totalCount
      : 'Pokazano ' + visibleCount + ' / ' + totalCount;
  }

  function applyFilters(documentRef, listRoot) {
    var root = listRoot || getCachedListRoot() || findChangesListRoot(documentRef);
    var rows = root ? root.dataRows : [];
    var parsedRows = rows.map(parseChangeRow);
    var visibleCount = 0;

    if (!root) {
      return;
    }

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
    updateBulkDeleteControls(documentRef);
  }

  function sortChanges(sortKey, direction, documentRef, listRoot, shouldSaveState) {
    listRoot = listRoot || getCachedListRoot() || findChangesListRoot(documentRef);
    var rows = listRoot ? listRoot.dataRows : [];
    var blocks;
    var parent;

    if (!isValidSortKey(sortKey) || !isValidSortDirection(direction)) {
      return false;
    }

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
      return compareSortValues(left, right, direction);
    });

    blocks.forEach(function (item) {
      parent.appendChild(item.block.blockRow);
      if (item.block.spacerRow) {
        parent.appendChild(item.block.spacerRow);
      }
    });

    documentRef.body.setAttribute(SORT_KEY_ATTR, sortKey);
    documentRef.body.setAttribute(SORT_DIR_ATTR, direction);
    updateSortControls(documentRef, sortKey, direction);
    if (shouldSaveState) {
      saveCurrentListState(documentRef);
    }
    applyFilters(documentRef);
    return true;
  }

  function sortChangesBy(sortKey, documentRef) {
    var currentKey = documentRef.body.getAttribute(SORT_KEY_ATTR);
    var currentDirection = documentRef.body.getAttribute(SORT_DIR_ATTR) || 'desc';
    var nextDirection = currentKey === sortKey && currentDirection === 'desc' ? 'asc' : 'desc';

    sortChanges(sortKey, nextDirection, documentRef, null, true);
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
      var panel = getFilterPanel(documentRef);
      var setFilters = panel ? panel.querySelectorAll('.' + SET_FILTER_CLASS) : [];

      if (value === 'all' && input.checked) {
        Array.prototype.forEach.call(setFilters, function (checkbox) {
          if (checkbox.value !== 'all') {
            checkbox.checked = false;
          }
        });
      } else if (value !== 'all' && input.checked) {
        Array.prototype.forEach.call(setFilters, function (checkbox) {
          if (checkbox.value === 'all') {
            checkbox.checked = false;
          }
        });
      } else if (value !== 'all') {
        var anySet = Array.prototype.some.call(setFilters, function (checkbox) {
          return checkbox.value !== 'all' && checkbox.checked;
        });

        if (!anySet) {
          Array.prototype.forEach.call(setFilters, function (checkbox) {
            checkbox.checked = checkbox.value === 'all';
          });
        }
      }

      saveCurrentListState(documentRef);
      applyFilters(documentRef);
    });

    chip.appendChild(input);
    chip.appendChild(text);

    return chip;
  }

  function createPositionFilterChip(documentRef, label, value, checked) {
    var chip = documentRef.createElement('label');
    var input = documentRef.createElement('input');
    var text = documentRef.createElement('span');

    chip.className = 'vtcl-filter-chip';
    input.className = POSITION_FILTER_CLASS;
    input.type = 'checkbox';
    input.value = value;
    input.checked = checked;
    text.textContent = label;

    input.addEventListener('change', function () {
      var panel = getFilterPanel(documentRef);
      var positionFilters = panel ? panel.querySelectorAll('.' + POSITION_FILTER_CLASS) : [];

      if (value === 'all' && input.checked) {
        Array.prototype.forEach.call(positionFilters, function (checkbox) {
          if (checkbox.value !== 'all') {
            checkbox.checked = false;
          }
        });
      } else if (value !== 'all' && input.checked) {
        Array.prototype.forEach.call(positionFilters, function (checkbox) {
          if (checkbox.value === 'all') {
            checkbox.checked = false;
          }
        });
      } else if (value !== 'all') {
        var anyPosition = Array.prototype.some.call(positionFilters, function (checkbox) {
          return checkbox.value !== 'all' && checkbox.checked;
        });

        if (!anyPosition) {
          Array.prototype.forEach.call(positionFilters, function (checkbox) {
            checkbox.checked = checkbox.value === 'all';
          });
        }
      }

      saveCurrentListState(documentRef);
      applyFilters(documentRef);
    });

    chip.appendChild(input);
    chip.appendChild(text);

    return chip;
  }

  function resetFilters(documentRef) {
    var panel = getFilterPanel(documentRef);
    var search = panel ? panel.querySelector('#' + dom.cssEscape(SEARCH_INPUT_ID)) : null;
    var player = panel ? panel.querySelector('#' + dom.cssEscape(PLAYER_FILTER_ID)) : null;

    if (search) {
      search.value = '';
    }
    if (player) {
      player.value = '';
    }

    queryPanelControls(documentRef, '.' + SET_FILTER_CLASS).forEach(function (checkbox) {
      checkbox.checked = checkbox.value === 'all';
    });

    queryPanelControls(documentRef, '.' + POSITION_FILTER_CLASS).forEach(function (checkbox) {
      checkbox.checked = checkbox.value === 'all';
    });

    clearListState();
    applyFilters(documentRef);
  }

  function setPlayerFilterValue(select, value) {
    var option;

    if (!select || !value) {
      return;
    }

    option = Array.prototype.slice.call(select.options).find(function (item) {
      return item.value === value;
    });

    if (option) {
      select.value = value;
    }
  }

  function restoreFilterPanelState(documentRef, listRoot) {
    var state = readListState();
    var panel = getFilterPanel(documentRef);
    var search = panel ? panel.querySelector('#' + dom.cssEscape(SEARCH_INPUT_ID)) : null;
    var player = panel ? panel.querySelector('#' + dom.cssEscape(PLAYER_FILTER_ID)) : null;
    var setFilters = panel ? panel.querySelectorAll('.' + SET_FILTER_CLASS) : [];
    var positionFilters = panel ? panel.querySelectorAll('.' + POSITION_FILTER_CLASS) : [];
    var selectedSets = normalizeSetFilters(state.setFilters);
    var selectedPositions = normalizePositionFilters(state.positionFilters);

    if (search) {
      search.value = state.search;
    }

    setPlayerFilterValue(player, state.playerId);

    Array.prototype.forEach.call(setFilters, function (checkbox) {
      checkbox.checked = selectedSets.indexOf(checkbox.value) !== -1;
    });

    Array.prototype.forEach.call(positionFilters, function (checkbox) {
      checkbox.checked = selectedPositions.indexOf(normalizePositionShort(checkbox.value)) !== -1;
    });

    if (state.sortKey && state.sortDirection) {
      return sortChanges(state.sortKey, state.sortDirection, documentRef, listRoot, false);
    }

    updateSortControls(documentRef, '', '');
    applyFilters(documentRef, listRoot);
    return true;
  }

  function injectStyles(documentRef) {
    if (documentRef.getElementById(STYLE_ID)) {
      return;
    }

    var style = documentRef.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '#' + PANEL_ROW_ID + ' td {',
      '  padding: 0;',
      '}',
      '#' + PANEL_ID + ' {',
      '  box-sizing: border-box;',
      '  width: 100%;',
      '  margin: 0;',
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
      '.vtcl-position-status {',
      '  color: #9fb8c7;',
      '}',
      '.vtcl-reset {',
      '  padding: 2px 8px;',
      '  border: 1px solid rgba(80, 156, 202, 0.45);',
      '  background: #0b2231;',
      '  color: #d8ecff;',
      '  cursor: pointer;',
      '}',
      '.vtcl-bulk-checkbox-wrap {',
      '  display: inline-flex;',
      '  align-items: center;',
      '  margin-right: 6px;',
      '  vertical-align: middle;',
      '}',
      '.vtcl-bulk-checkbox {',
      '  margin: 0;',
      '}',
      '.vtcl-bulk-status {',
      '  color: #9fb8c7;',
      '}',
      '.vtcl-bulk-delete {',
      '  border-color: rgba(248, 113, 113, 0.65);',
      '  color: #fecaca;',
      '}'
    ].join('\n');

    documentRef.head.appendChild(style);
  }

  function createFilterPanel(documentRef, parsedRows) {
    var panel = documentRef.createElement('div');
    var rowSearch = documentRef.createElement('div');
    var rowSets = documentRef.createElement('div');
    var rowPositions = documentRef.createElement('div');
    var rowSort = documentRef.createElement('div');
    var rowBulk = documentRef.createElement('div');
    var searchLabel = documentRef.createElement('span');
    var searchInput = documentRef.createElement('input');
    var playerLabel = documentRef.createElement('span');
    var playerSelect = documentRef.createElement('select');
    var setsLabel = documentRef.createElement('span');
    var positionsLabel = documentRef.createElement('span');
    var positionStatus = documentRef.createElement('span');
    var sortLabel = documentRef.createElement('span');
    var bulkLabel = documentRef.createElement('span');
    var bulkSelectVisible = documentRef.createElement('button');
    var bulkClear = documentRef.createElement('button');
    var bulkDelete = documentRef.createElement('button');
    var bulkStatus = documentRef.createElement('span');
    var counter = documentRef.createElement('span');
    var reset = documentRef.createElement('button');
    var setNumber;

    panel.id = PANEL_ID;

    rowSearch.className = 'vtcl-filter-row';
    rowSets.className = 'vtcl-filter-row';
    rowPositions.className = 'vtcl-filter-row';
    rowSort.className = 'vtcl-filter-row';
    rowBulk.className = 'vtcl-filter-row';

    searchLabel.className = 'vtcl-filter-label';
    searchLabel.textContent = 'Szukaj:';
    searchInput.id = SEARCH_INPUT_ID;
    searchInput.className = 'vtcl-search-input';
    searchInput.type = 'search';
    searchInput.placeholder = 'Nazwisko zawodnika...';
    searchInput.addEventListener('input', function () {
      saveCurrentListState(documentRef);
      applyFilters(documentRef);
    });

    playerLabel.className = 'vtcl-filter-label';
    playerLabel.textContent = 'Zawodnik:';
    playerSelect.id = PLAYER_FILTER_ID;
    playerSelect.className = 'vtcl-player-select';
    playerSelect.addEventListener('change', function () {
      saveCurrentListState(documentRef);
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

    positionsLabel.className = 'vtcl-filter-label';
    positionsLabel.textContent = 'Pozycja:';
    positionStatus.className = POSITION_STATUS_CLASS;
    positionStatus.textContent = 'Ładuję pozycje...';
    rowPositions.appendChild(positionsLabel);
    rowPositions.appendChild(createPositionFilterChip(documentRef, 'wszystkie', 'all', true));
    POSITION_OPTIONS.forEach(function (position) {
      rowPositions.appendChild(createPositionFilterChip(documentRef, position, position, false));
    });
    rowPositions.appendChild(positionStatus);

    sortLabel.className = 'vtcl-filter-label';
    sortLabel.textContent = 'Sortuj:';
    rowSort.appendChild(sortLabel);
    rowSort.appendChild(createSortButton(documentRef, 'Schodzący', SORT_KEYS.playerOut));
    rowSort.appendChild(createSortButton(documentRef, 'Wchodzący', SORT_KEYS.playerIn));
    rowSort.appendChild(createSortButton(documentRef, 'Liczba setów', SORT_KEYS.activeSetCount));
    rowSort.appendChild(createSortButton(documentRef, 'Sety', SORT_KEYS.activeSets));

    bulkLabel.className = 'vtcl-filter-label';
    bulkLabel.textContent = 'Masowe usuwanie:';

    bulkSelectVisible.className = 'vtcl-reset ' + BULK_SELECT_VISIBLE_CLASS;
    bulkSelectVisible.type = 'button';
    bulkSelectVisible.textContent = 'Zaznacz widoczne';
    bulkSelectVisible.addEventListener('click', function () {
      selectVisibleBulkRows(documentRef);
    });

    bulkClear.className = 'vtcl-reset ' + BULK_CLEAR_CLASS;
    bulkClear.type = 'button';
    bulkClear.textContent = 'Odznacz';
    bulkClear.addEventListener('click', function () {
      clearBulkSelection(documentRef);
    });

    bulkDelete.className = 'vtcl-reset ' + BULK_DELETE_CLASS;
    bulkDelete.type = 'button';
    bulkDelete.textContent = 'Usuń zaznaczone';
    bulkDelete.disabled = true;
    bulkDelete.addEventListener('click', function () {
      deleteSelectedChanges(documentRef);
    });

    bulkStatus.className = BULK_STATUS_CLASS;
    bulkStatus.textContent = 'Zaznacz wybrane zmiany do usunięcia.';

    rowBulk.appendChild(bulkLabel);
    rowBulk.appendChild(bulkSelectVisible);
    rowBulk.appendChild(bulkClear);
    rowBulk.appendChild(bulkDelete);
    rowBulk.appendChild(bulkStatus);

    panel.appendChild(rowSearch);
    panel.appendChild(rowSets);
    panel.appendChild(rowPositions);
    panel.appendChild(rowSort);
    panel.appendChild(rowBulk);

    return panel;
  }

  function createSignature(parsedRows) {
    return parsedRows.map(function (parsed) {
      return parsed.changeId;
    }).join('|');
  }

  function removeFilterPanel(documentRef) {
    var panelRow = documentRef.getElementById(PANEL_ROW_ID);
    var panel = documentRef.getElementById(PANEL_ID);

    if (panelRow) {
      panelRow.remove();
    } else if (panel) {
      panel.remove();
    }

    dom.removeHiddenById(documentRef, PANEL_ID);
    dom.removeHiddenById(documentRef, PANEL_ROW_ID);
  }

  function mountFilterPanel(documentRef, listRoot, panel) {
    var mountTarget = listRoot.mountTarget;
    var panelRow = documentRef.getElementById(PANEL_ROW_ID);

    if (!panel || !mountTarget || !mountTarget.parent) {
      debugLog('mountFilterPanel: brak mountTarget');
      return false;
    }

    if (!panel.id) {
      panel.id = PANEL_ID;
    }

    if (panelRow) {
      panelRow.remove();
    }

    if (panel.parentNode && panel.parentNode !== mountTarget.parent) {
      panel.remove();
    }

    mountTarget.parent.insertBefore(panel, mountTarget.before);
    debugLog('mountFilterPanel', describeNode(mountTarget.parent), 'before', describeNode(mountTarget.before));
    return documentRef.getElementById(PANEL_ID) === panel && panel.isConnected;
  }

  function hasVisibleChangesList(documentRef) {
    return hasChangesListContent(documentRef);
  }

  function cleanupChangesList(documentRef, force) {
    var listRoot = getCachedListRoot() || findChangesListRoot(documentRef);
    var panel = documentRef.getElementById(PANEL_ID);

    if (!force && panel && panel.isConnected && isContextAlive(activeListContext)) {
      return;
    }

    removeFilterPanel(documentRef);
    removeBulkDeleteControls(documentRef);

    if (listRoot) {
      listRoot.dataRows.forEach(function (row) {
        var block;

        if (!row || !row.isConnected) {
          return;
        }

        block = getChangeBlock(row);
        if (block) {
          setBlockVisible(block, true);
        }
      });
    }

    documentRef.body.removeAttribute(SIGNATURE_ATTR);
    documentRef.body.removeAttribute(SORT_KEY_ATTR);
    documentRef.body.removeAttribute(SORT_DIR_ATTR);
    lastEnhanceKey = '';
    clearListContext();
  }

  function enhanceChangesList(documentRef) {
    var listRoot;
    var parsedRows;
    var signature;
    var panel;
    var playerSelect;
    var enhanceKey;
    var mounted;

    if (enhancing) {
      return;
    }

    invalidateStaleContext();

    listRoot = findChangesListRoot(documentRef);
    if (!listRoot) {
      return;
    }

    parsedRows = listRoot.dataRows.map(parseChangeRow);
    signature = createSignature(parsedRows);
    enhanceKey = signature + '@' + describeNode(listRoot.scope);
    panel = documentRef.getElementById(PANEL_ID);

    if (enhanceKey === lastEnhanceKey && isPanelMounted(documentRef, listRoot)) {
      ensureBulkCheckboxes(documentRef, listRoot);
      applyFilters(documentRef, listRoot);
      loadPositionMapForList(documentRef, listRoot);
      return;
    }

    enhancing = true;

    try {
      injectStyles(documentRef);

      if (documentRef.body.getAttribute(SIGNATURE_ATTR) !== signature) {
        removeFilterPanel(documentRef);
        documentRef.body.removeAttribute(SIGNATURE_ATTR);
      }

      if (!panel || !panel.isConnected) {
        panel = createFilterPanel(documentRef, parsedRows);
      } else {
        playerSelect = panel.querySelector('#' + dom.cssEscape(PLAYER_FILTER_ID));
        if (playerSelect) {
          populatePlayerFilter(playerSelect, parsedRows);
        }
      }

      mounted = mountFilterPanel(documentRef, listRoot, panel);
      if (!mounted) {
        infoLog('nie udało się zamontować panelu — włącz debug: localStorage.setItem("vtcl.debug","1")');
        debugLog('enhanceChangesList: mount failed', collectDebugStatus(documentRef));
        return;
      }

      documentRef.body.setAttribute(SIGNATURE_ATTR, signature);
      lastEnhanceKey = enhanceKey;
      rememberListContext(listRoot, signature);
      ensureBulkCheckboxes(documentRef, listRoot);
      restoreFilterPanelState(documentRef, listRoot);
      loadPositionMapForList(documentRef, listRoot);
      infoLog('panel filtrów aktywny', describeNode(listRoot.scope));
      debugLog('enhanceChangesList: ok', collectDebugStatus(documentRef));
    } finally {
      enhancing = false;
    }
  }

  function debugStatus(documentRef) {
    var doc = documentRef || (root && root.document);
    var status = collectDebugStatus(doc);
    status.isChangesListView = Boolean(findChangesListRoot(doc));
    status.listRootFound = status.isChangesListView;
    debugLog('debugStatus', status);
    return status;
  }

  function start() {
    if (!root || !root.document) {
      return;
    }

    infoLog('VM Changes List Enhancer v0.2.0 — debug: localStorage.setItem("vtcl.debug","1")');
    debugLog('start');

    if (root) {
      root.VMChangesListEnhancer = api;
    }

    dom.createViewScheduler({
      document: root.document,
      isActive: isChangesListView,
      onEnhance: enhanceChangesList,
      onDeactivate: function (documentRef) {
        cleanupChangesList(documentRef, true);
      },
      delayMs: 200
    }).start();
  }

  var api = {
    extractVmBody: extractVmBody,
    parsePlayerPositionMapFromTacticHtml: parsePlayerPositionMapFromTacticHtml,
    parseChangeRow: parseChangeRow,
    parseChangeRowsFromHtml: parseChangeRowsFromHtml,
    parseChangeRowsFromHtmlRegex: parseChangeRowsFromHtmlRegex,
    findChangeDataRows: findChangeDataRows,
    findChangesListRoot: findChangesListRoot,
    isChangesListView: isChangesListView,
    isChangeAddView: isChangeAddView,
    rowMatchesFilters: rowMatchesFilters,
    getSortValue: getSortValue,
    debugStatus: debugStatus,
    start: start
  };

  return api;
}));
