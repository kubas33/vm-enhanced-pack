// ==UserScript==
// @name         Volleyball junior training calculator
// @namespace    https://vm-manager.org/
// @version      0.5.9
// @description  Projects junior academy skill growth with comparable allocation strategies.
// @match        *://*.vm-manager.org/*
// @match        *://vm-manager.org/*
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-calculator.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-calculator.user.js
// @run-at       document-end
// @grant        none
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-dom-utils.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-position-rules.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-sim.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-parser.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-matches-schedule.js
// ==/UserScript==

(function () {
  'use strict';

  var dom = window.VMDomUtils;
  var positionRules = window.VMPositionRules;
  var sim = window.VMJuniorTrainingSim;
  var parser = window.VMJuniorTrainingParser;
  var schedule = window.VMMatchesSchedule;
  var CALCULATOR_VERSION = '0.5.8';
  var SKILLS_HINT_EMPTY = 'Nie udało się ustalić rekomendowanych umiejętności — użyj «Wczytaj wszystkie»';

  if (!dom || !positionRules || !sim || !parser || !schedule) {
    throw new Error('Junior Training Calculator wymaga vm-dom-utils.js, vm-position-rules.js, vm-junior-training-sim.js, vm-junior-training-parser.js i vm-matches-schedule.js.');
  }

  var PANEL_ID = 'vjtc-panel';
  var FORM_ID = 'young_trening_options';
  var DEFAULT_STRATEGIES = ['priority', 'roundRobin'];
  var SCHEDULE_CACHE_KEY = 'vjtc.matchesSchedule.v3';
  var SCHEDULE_CACHE_TTL_MS = 5 * 60 * 1000;
  var POOL_CACHE_KEY = 'vjtc.juniorTrainingPool.v1';
  var POOL_CACHE_TTL_MS = 5 * 60 * 1000;
  var JUNIOR_COUNT_CACHE_KEY = 'vjtc.juniorCount.v1';
  var JUNIOR_COUNT_CACHE_TTL_MS = 5 * 60 * 1000;
  var schedulePromise = null;
  var trainingPoolPromise = null;

  var SKILL_OPTIONS = [
    { code: 'UM_PRZYJECIE', label: 'Przyjecie' },
    { code: 'UM_OBRONA', label: 'Obrona' },
    { code: 'UM_ATAK_ZE_SKRZYDLA', label: 'Atak ze skrzydla' },
    { code: 'UM_ATAK_ZE_SRODKA', label: 'Atak ze srodka' },
    { code: 'UM_ROZGRYWANIE', label: 'Rozgrywanie' },
    { code: 'UM_SERWIS', label: 'Serwis' },
    { code: 'UM_BLOK_AKTYWNY', label: 'Blok' },
    { code: 'UM_ASEKURACJA', label: 'Asekuracja' },
    { code: 'UM_WYSTAWA', label: 'Wystawa' },
    { code: 'UM_KIWKA', label: 'Kiwka' },
    { code: 'UM_ATAK_2L', label: 'Atak z 2 linii' },
    { code: 'UM_OMIJANIE_BLOKU', label: 'Omijanie bloku' },
    { code: 'UM_USTAWIANIE', label: 'Ustawianie sie do bloku' },
    { code: 'UM_BLOK_PASYWNY', label: 'Blok pasywny' },
    { code: 'UM_ATAK_BO', label: 'Atak blok-aut' },
    { code: 'UM_SILA_SERWISU', label: 'Sila serwisu' },
  ];

  var skillLabelByCode = SKILL_OPTIONS.reduce(function (map, item) {
    map[item.code] = item.label;
    return map;
  }, {});

  var SCOUT_SKILL_LABELS = {
    'serwis': 'UM_SERWIS',
    'sila serwisu': 'UM_SILA_SERWISU',
    'przyjecie': 'UM_PRZYJECIE',
    'rozgrywanie': 'UM_ROZGRYWANIE',
    'wystawa': 'UM_WYSTAWA',
    'atak ze skrzydla': 'UM_ATAK_ZE_SKRZYDLA',
    'atak ze srodka': 'UM_ATAK_ZE_SRODKA',
    'atak z 2 linii': 'UM_ATAK_2L',
    'omijanie bloku': 'UM_OMIJANIE_BLOKU',
    'kiwka': 'UM_KIWKA',
    'atak blok-aut': 'UM_ATAK_BO',
    'obrona': 'UM_OBRONA',
    'asekuracja': 'UM_ASEKURACJA',
    'blok': 'UM_BLOK_AKTYWNY',
    'blok pasywny': 'UM_BLOK_PASYWNY',
    'ustawianie sie do bloku': 'UM_USTAWIANIE',
  };

  var FALLBACK_RECOMMENDED_CODES = {
    'atakujacy': [
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
    'libero': [
      'UM_PRZYJECIE',
      'UM_OBRONA',
      'UM_ASEKURACJA',
    ],
    'przyjmujacy': [
      'UM_PRZYJECIE',
      'UM_OBRONA',
      'UM_ASEKURACJA',
      'UM_USTAWIANIE',
      'UM_BLOK_AKTYWNY',
      'UM_SERWIS',
      'UM_ATAK_ZE_SKRZYDLA',
      'UM_KIWKA',
      'UM_ATAK_2L',
      'UM_OMIJANIE_BLOKU',
    ],
    'rozgrywajacy': [
      'UM_ROZGRYWANIE',
      'UM_WYSTAWA',
      'UM_OBRONA',
      'UM_ASEKURACJA',
      'UM_USTAWIANIE',
      'UM_BLOK_AKTYWNY',
    ],
    'srodkowy': [
      'UM_ATAK_ZE_SRODKA',
      'UM_OMIJANIE_BLOKU',
      'UM_USTAWIANIE',
      'UM_BLOK_AKTYWNY',
      'UM_SERWIS',
      'UM_KIWKA',
    ],
  };

  function injectStyles() {
    if (document.getElementById('vjtc-styles')) {
      return;
    }

    var style = document.createElement('style');
    style.id = 'vjtc-styles';
    style.textContent = ''
      + '.vjtc-panel{margin:8px 0;padding:10px 12px;border:1px solid rgba(93,176,225,.35);'
      + 'background:rgba(5,23,35,.78);color:#dceefa;font-size:11px;line-height:1.4;border-radius:4px;}'
      + '.vjtc-title{margin:0 0 8px;font-size:12px;color:#fff;}'
      + '.vjtc-player-row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-bottom:8px;align-items:end;}'
      + '.vjtc-player-actions{display:flex;gap:6px;flex-wrap:wrap;}'
      + '.vjtc-btn:disabled{opacity:.5;cursor:not-allowed;}'
      + '.vjtc-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:8px;}'
      + '.vjtc-hint{margin:0 0 8px;color:#9ec7de;font-size:10px;}'
      + '.vjtc-grid label{display:flex;flex-direction:column;gap:3px;}'
      + '.vjtc-grid input,.vjtc-grid select{width:100%;box-sizing:border-box;}'
      + '.vjtc-skills{margin:8px 0;}'
      + '.vjtc-skill-row{display:grid;grid-template-columns:auto 1.3fr .65fr .65fr auto auto;gap:6px;margin-bottom:6px;align-items:center;}'
      + '.vjtc-skill-order{display:flex;flex-direction:column;gap:2px;}'
      + '.vjtc-skill-order .vjtc-btn{padding:1px 5px;line-height:1;}'
      + '.vjtc-field-hint{margin-top:2px;color:#8eb6ca;font-size:10px;min-height:12px;}'
      + '.vjtc-strategies{display:flex;flex-wrap:wrap;gap:10px;margin:8px 0;}'
      + '.vjtc-strategies label{display:inline-flex;align-items:center;gap:4px;}'
      + '.vjtc-actions{margin:8px 0;}'
      + '.vjtc-btn{cursor:pointer;padding:4px 10px;}'
      + '.vjtc-results{margin-top:10px;overflow-x:auto;}'
      + '.vjtc-results table{width:100%;border-collapse:collapse;font-size:11px;}'
      + '.vjtc-results th,.vjtc-results td{border:1px solid rgba(93,176,225,.25);padding:4px 6px;text-align:left;}'
      + '.vjtc-results th{background:rgba(93,176,225,.12);}'
      + '.vjtc-ok{color:#7dffb0;}'
      + '.vjtc-miss{color:#ffb36b;}'
      + '.vjtc-meta{margin-top:6px;color:#9ec7de;font-size:10px;}'
      + '.vjtc-scout-subtitle{margin:0 0 8px;color:#b8d9ec;font-size:11px;}'
      + '.vjtc-mode-scout .vjtc-player-row,.vjtc-mode-scout .vjtc-refresh-skill{display:none;}';
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function parseNumber(value, fallback) {
    var parsed = Number(String(value).replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function normalizeVmText(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^[★•]\s*/, '')
      .trim();
  }

  function htmlToText(value) {
    return String(value || '')
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

  function getFallbackPositionKey(position) {
    var normalized = normalizeVmText(position);

    if (normalized === 'at') {
      return 'atakujacy';
    }
    if (normalized === 'p') {
      return 'przyjmujacy';
    }
    if (normalized === 'r') {
      return 'rozgrywajacy';
    }
    if (normalized === 'sr') {
      return 'srodkowy';
    }
    if (normalized === 'l') {
      return 'libero';
    }

    return normalized;
  }

  function getCodeForScoutLabel(label) {
    var normalized = normalizeVmText(label);
    var fromRules;

    if (SCOUT_SKILL_LABELS[normalized]) {
      return SCOUT_SKILL_LABELS[normalized];
    }

    if (positionRules.ATTRIBUTE_LABEL_TO_CODE) {
      fromRules = positionRules.ATTRIBUTE_LABEL_TO_CODE[label];
      if (fromRules) {
        return fromRules;
      }
    }

    return '';
  }

  function normalizeAttributeMap(attributes) {
    var result = {};

    Object.keys(attributes || {}).forEach(function (key) {
      var code = /^UM_/.test(key) ? key : getCodeForScoutLabel(key);
      var value = parseNumber(attributes[key], null);

      if (code && value !== null) {
        result[code] = value;
      }
    });

    return result;
  }

  function readScoutRowsFromDom() {
    return Array.prototype.map.call(document.querySelectorAll('tr'), function (row) {
      return Array.prototype.map.call(row.children || [], function (cell) {
        return String(cell.textContent || '').replace(/\s+/g, ' ').trim();
      }).filter(function (text) {
        return text !== '';
      });
    }).filter(function (cells) {
      return cells.length >= 2;
    });
  }

  function readScoutAttributesFromDom() {
    var attributes = {};

    readScoutRowsFromDom().forEach(function (cells) {
      var label = cells[cells.length - 2];
      var code = getCodeForScoutLabel(label);
      var value;

      if (!code) {
        return;
      }

      value = parseNumber(cells[cells.length - 1], null);

      if (value !== null) {
        attributes[code] = value;
      }
    });

    return attributes;
  }

  function readScoutCellPairsFromHtml(source) {
    var pairs = [];
    var regex = /<td\b[^>]*>([\s\S]*?)<\/td>\s*(?=<td\b[^>]*>([\s\S]*?)<\/td>)/gi;
    var match;

    while ((match = regex.exec(String(source || ''))) !== null) {
      pairs.push([
        htmlToText(match[1]),
        htmlToText(match[2]),
      ]);
    }

    return pairs;
  }

  function readScoutAttributesFromHtml(source) {
    var attributes = {};

    readScoutCellPairsFromHtml(source).forEach(function (pair) {
      var code = getCodeForScoutLabel(pair[0]);
      var value;

      if (!code) {
        return;
      }

      value = parseNumber(pair[1], null);

      if (value !== null) {
        attributes[code] = value;
      }
    });

    return attributes;
  }

  function readScoutPositionFromDom() {
    var rows = readScoutRowsFromDom();
    var position = '';

    rows.forEach(function (cells) {
      var label = cells[cells.length - 2];

      if (normalizeVmText(label) === 'pozycja') {
        position = cells[cells.length - 1];
      }
    });

    return position;
  }

  function readScoutPositionFromHtml(source) {
    var position = '';
    var directMatch = String(source || '').match(/<td\b[^>]*>\s*Pozycja\s*<\/td>\s*<td\b[^>]*>([\s\S]*?)<\/td>/i);

    if (directMatch) {
      return htmlToText(directMatch[1]);
    }

    readScoutCellPairsFromHtml(source).forEach(function (pair) {
      if (normalizeVmText(pair[0]) === 'pozycja') {
        position = pair[1];
      }
    });

    return position;
  }

  function getFallbackRecommendedSkills(position, attributes) {
    var positionKey = getFallbackPositionKey(position);
    var codes = FALLBACK_RECOMMENDED_CODES[positionKey] || [];
    var normalizedAttributes = normalizeAttributeMap(attributes);

    return codes.reduce(function (items, code) {
      var level = normalizedAttributes[code];

      if (
        level == null
        || Number.isNaN(Number(level))
        || (
          positionRules.isTrainableLevel
            ? !positionRules.isTrainableLevel(level, sim.CONFIG.maxLevel)
            : level >= sim.CONFIG.maxLevel - 0.001
        )
      ) {
        return items;
      }

      items.push({
        code: code,
        level: Number(level),
        targetLevel: sim.CONFIG.maxLevel,
      });
      return items;
    }, []);
  }

  function parseTrainingPoolFromForm(form) {
    if (!form) {
      return null;
    }

    var text = form.textContent || '';
    var match = text.match(/Punkty treningowe:\s*(\d+)\s*\/\s*(\d+)/i);

    if (!match) {
      return null;
    }

    return {
      current: parseNumber(match[1], 0),
      max: parseNumber(match[2], sim.CONFIG.poolCap),
    };
  }

  function getJuniorTrainingForm() {
    return dom.getVisibleElementById(document, FORM_ID);
  }

  function getJuniorTrainingFormAnywhere() {
    var nodes = dom.getElementsById(document, FORM_ID);
    var i;

    for (i = 0; i < nodes.length; i += 1) {
      if (parseTrainingPoolFromForm(nodes[i])) {
        return nodes[i];
      }
    }

    return nodes[0] || null;
  }

  function readJuniorTrainingPoolFromDom() {
    var form = getJuniorTrainingFormAnywhere();
    return form ? parseTrainingPoolFromForm(form) : null;
  }

  function buildSkillOptions(selectedCode) {
    return SKILL_OPTIONS.map(function (item) {
      var selected = item.code === selectedCode ? ' selected' : '';
      return '<option value="' + escapeHtml(item.code) + '"' + selected + '>' + escapeHtml(item.label) + '</option>';
    }).join('');
  }

  function buildStrategyCheckboxes(selectedIds) {
    return Object.keys(sim.STRATEGY_META).map(function (strategyId) {
      var meta = sim.STRATEGY_META[strategyId];
      var checked = selectedIds.indexOf(strategyId) !== -1 ? ' checked' : '';
      return ''
        + '<label title="' + escapeHtml(meta.description) + '">'
        + '<input type="checkbox" name="vjtc-strategy" value="' + escapeHtml(strategyId) + '"' + checked + '>'
        + escapeHtml(meta.label)
        + '</label>';
    }).join('');
  }

  function createSkillRow(code, level, targetLevel, refreshDisabled) {
    var row = document.createElement('div');
    row.className = 'vjtc-skill-row';
    row.innerHTML = ''
      + '<div class="vjtc-skill-order">'
      + '<button type="button" class="vjtc-btn vjtc-move-up" title="Wyzej priorytet">▲</button>'
      + '<button type="button" class="vjtc-btn vjtc-move-down" title="Nizej priorytet">▼</button>'
      + '</div>'
      + '<select class="vjtc-skill-code">' + buildSkillOptions(code || 'UM_PRZYJECIE') + '</select>'
      + '<input class="vjtc-skill-level" type="number" min="0" max="30.5" step="0.5" value="' + escapeHtml(level == null ? 10 : level) + '">'
      + '<input class="vjtc-skill-target" type="number" min="0" max="30.5" step="0.5" value="' + escapeHtml(targetLevel == null ? sim.CONFIG.maxLevel : targetLevel) + '" title="Cel">'
      + '<button type="button" class="vjtc-btn vjtc-refresh-skill" title="Odswiez poziom z profilu"' + (refreshDisabled ? ' disabled' : '') + '>↻</button>'
      + '<button type="button" class="vjtc-btn vjtc-remove-skill">Usun</button>';
    return row;
  }

  function getScoutCandidate(panel) {
    return panel && panel._vjtcScoutCandidate ? panel._vjtcScoutCandidate : null;
  }

  function getActivePlayer(panel, form) {
    if (panel && panel.dataset.vjtcMode === 'scout') {
      return getScoutCandidate(panel);
    }

    var select = panel.querySelector('#vjtc-player');
    if (!select || !select.value) {
      return null;
    }
    return getSelectedPlayer(parser.parseJuniorPlayersFromForm(form), select.value);
  }

  function getPlayerSkillLevel(player, code) {
    if (!player || !player.attributes) {
      return null;
    }
    var level = player.attributes[code];
    return level == null || Number.isNaN(Number(level)) ? null : Number(level);
  }

  function setRowLevelFromPlayer(row, player) {
    if (!row || !player) {
      return false;
    }
    var code = row.querySelector('.vjtc-skill-code').value;
    var level = getPlayerSkillLevel(player, code);
    if (level === null) {
      return false;
    }
    row.querySelector('.vjtc-skill-level').value = String(level);
    return true;
  }

  function refreshSkillLevels(panel, form, singleRow) {
    var player = getActivePlayer(panel, form);
    if (!player) {
      return;
    }
    var rows = singleRow
      ? [singleRow]
      : panel.querySelectorAll('.vjtc-skill-row');
    Array.prototype.forEach.call(rows, function (row) {
      setRowLevelFromPlayer(row, player);
    });
  }

  function updatePlayerActionButtonsState(panel, form) {
    var hasPlayer = Boolean(getActivePlayer(panel, form));
    var refreshAll = panel.querySelector('#vjtc-refresh-levels');
    if (refreshAll) {
      refreshAll.disabled = !hasPlayer;
    }
    panel.querySelectorAll('.vjtc-refresh-skill').forEach(function (button) {
      button.disabled = !hasPlayer;
    });
  }

  function getDefaultSkillLevel(panel, form, code) {
    var player = getActivePlayer(panel, form);
    var level = player ? getPlayerSkillLevel(player, code) : null;
    return level == null ? 10 : level;
  }

  function upgradeSkillRow(row, refreshDisabled) {
    if (row.querySelector('.vjtc-refresh-skill')) {
      return;
    }
    var refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'vjtc-btn vjtc-refresh-skill';
    refreshButton.title = 'Odswiez poziom z profilu';
    refreshButton.textContent = '↻';
    refreshButton.disabled = Boolean(refreshDisabled);
    row.insertBefore(refreshButton, row.querySelector('.vjtc-remove-skill'));
  }

  function ensurePanelControls(panel, form) {
    var playerRow = panel.querySelector('.vjtc-player-row');
    var loadButton = panel.querySelector('#vjtc-load-player');
    var refreshAllButton = panel.querySelector('#vjtc-refresh-levels');
    var grid = panel.querySelector('.vjtc-grid');
    var seasonDaysInput = panel.querySelector('#vjtc-season-days');

    if (playerRow && loadButton && !refreshAllButton) {
      var actions = document.createElement('div');
      actions.className = 'vjtc-player-actions';
      loadButton.parentNode.insertBefore(actions, loadButton);
      actions.appendChild(loadButton);
      refreshAllButton = document.createElement('button');
      refreshAllButton.type = 'button';
      refreshAllButton.className = 'vjtc-btn';
      refreshAllButton.id = 'vjtc-refresh-levels';
      refreshAllButton.textContent = 'Odswiez poziomy';
      refreshAllButton.disabled = true;
      actions.appendChild(refreshAllButton);
    }

    if (grid && !panel.querySelector('#vjtc-junior-count')) {
      var juniorCountLabel = document.createElement('label');
      juniorCountLabel.innerHTML = 'Juniorzy<input id="vjtc-junior-count" type="number" min="0" max="'
        + escapeHtml(sim.CONFIG.maxJuniorCount)
        + '" step="1" value="' + escapeHtml(sim.CONFIG.optimalJuniorCount) + '">'
        + '<span class="vjtc-field-hint" id="vjtc-junior-count-hint"></span>';
      if (seasonDaysInput && seasonDaysInput.closest('label')) {
        grid.insertBefore(juniorCountLabel, seasonDaysInput.closest('label'));
      } else {
        grid.appendChild(juniorCountLabel);
      }
    }

    panel.querySelectorAll('.vjtc-skill-row').forEach(function (row) {
      upgradeSkillRow(row, true);
    });

    if (panel.dataset.vjtcControlsBound === '1') {
      updatePlayerActionButtonsState(panel, form);
      return;
    }
    panel.dataset.vjtcControlsBound = '1';

    panel.addEventListener('change', function (event) {
      if (event.target.id === 'vjtc-junior-count') {
        panel.dataset.juniorCountManual = '1';
        var juniorCountHint = panel.querySelector('#vjtc-junior-count-hint');
        if (juniorCountHint) {
          juniorCountHint.textContent = 'Ustawione recznie.';
        }
        return;
      }

      if (!event.target.classList.contains('vjtc-skill-code')) {
        return;
      }
      var row = event.target.closest('.vjtc-skill-row');
      var player = getActivePlayer(panel, form);
      if (row && player) {
        setRowLevelFromPlayer(row, player);
      }
    });

    panel.addEventListener('input', function (event) {
      if (event.target.id === 'vjtc-junior-count') {
        panel.dataset.juniorCountManual = '1';
      }
    });

    panel.addEventListener('click', function (event) {
      if (event.target.id === 'vjtc-refresh-levels') {
        refreshSkillLevels(panel, form);
        return;
      }
      if (event.target.classList.contains('vjtc-refresh-skill')) {
        var skillRow = event.target.closest('.vjtc-skill-row');
        if (skillRow) {
          refreshSkillLevels(panel, form, skillRow);
        }
      }
    });

    updatePlayerActionButtonsState(panel, form);
  }

  function moveSkillRow(row, direction) {
    var parent = row.parentElement;

    if (!parent) {
      return;
    }

    if (direction < 0 && row.previousElementSibling) {
      parent.insertBefore(row, row.previousElementSibling);
      return;
    }

    if (direction > 0 && row.nextElementSibling) {
      parent.insertBefore(row.nextElementSibling, row);
    }
  }

  function readScheduleCache() {
    try {
      var raw = window.sessionStorage.getItem(SCHEDULE_CACHE_KEY);
      if (!raw) {
        return null;
      }

      var cached = JSON.parse(raw);
      if (!cached || Date.now() - cached.savedAt > SCHEDULE_CACHE_TTL_MS) {
        return null;
      }

      return cached.data;
    } catch (error) {
      return null;
    }
  }

  function writeScheduleCache(data) {
    try {
      window.sessionStorage.setItem(SCHEDULE_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        data: data,
      }));
    } catch (error) {
      // ignore storage failures
    }
  }

  function getTeamIdFromDocument() {
    return schedule.findTeamIdFromHtml(document.documentElement.innerHTML);
  }

  function fetchSeasonScheduleData() {
    var cached = readScheduleCache();

    if (cached) {
      return Promise.resolve(cached);
    }

    if (schedulePromise) {
      return schedulePromise;
    }

    schedulePromise = schedule.fetchSeasonSchedule(window.fetch, {
      teamId: getTeamIdFromDocument(),
    }).then(function (data) {
      writeScheduleCache(data);
      return data;
    }).finally(function () {
      schedulePromise = null;
    });

    return schedulePromise;
  }

  function applySeasonScheduleToPanel(panel, data) {
    var daysInput = panel.querySelector('#vjtc-days-left');
    var hint = panel.querySelector('#vjtc-days-left-hint');

    if (!data || !daysInput || document.activeElement === daysInput) {
      return;
    }

    if (data.daysLeftInSeason != null) {
      daysInput.value = String(data.daysLeftInSeason);
    }

    if (hint) {
      if (data.seasonEndDate && data.lastMatchDate) {
        hint.textContent = 'Aut. (liga): ' + data.lastMatchDate + ' + ' + data.bufferDays
          + ' dni = ' + data.seasonEndDate
          + (data.currentDate ? ' | dziś ' + data.currentDate : '')
          + (data.leagueMatchCount ? ' | mecze lig.: ' + data.leagueMatchCount : '')
          + (data.monthsWithLeagueMatches ? ' | mies. lig.: ' + data.monthsWithLeagueMatches : '')
          + (data.seasonEndedBecauseEmptyMonth ? ' (koniec po mies. bez ligi)' : '');
      } else {
        hint.textContent = 'Nie udało się odczytać terminarza.';
      }
    }
  }

  function readPoolCache() {
    try {
      var raw = window.sessionStorage.getItem(POOL_CACHE_KEY);
      if (!raw) {
        return null;
      }

      var cached = JSON.parse(raw);
      if (!cached || Date.now() - cached.savedAt > POOL_CACHE_TTL_MS) {
        return null;
      }

      return cached.data;
    } catch (error) {
      return null;
    }
  }

  function writePoolCache(data) {
    try {
      window.sessionStorage.setItem(POOL_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        data: data,
      }));
    } catch (error) {
      // ignore storage failures
    }
  }

  function readJuniorCountCache() {
    try {
      var raw = window.sessionStorage.getItem(JUNIOR_COUNT_CACHE_KEY);
      if (!raw) {
        return null;
      }

      var cached = JSON.parse(raw);
      if (!cached || Date.now() - cached.savedAt > JUNIOR_COUNT_CACHE_TTL_MS) {
        return null;
      }

      return cached.count;
    } catch (error) {
      return null;
    }
  }

  function writeJuniorCountCache(count) {
    try {
      window.sessionStorage.setItem(JUNIOR_COUNT_CACHE_KEY, JSON.stringify({
        savedAt: Date.now(),
        count: sim.normalizeJuniorCount(count),
      }));
    } catch (error) {
      // ignore storage failures
    }
  }

  function applyJuniorCountToPanel(panel, count, hintText) {
    var input = panel.querySelector('#vjtc-junior-count');
    var hint = panel.querySelector('#vjtc-junior-count-hint');
    var normalized = sim.normalizeJuniorCount(count);

    if (!input || document.activeElement === input || panel.dataset.juniorCountManual === '1') {
      return;
    }

    input.value = String(normalized);

    if (hint && hintText) {
      hint.textContent = hintText;
    }
  }

  function refreshJuniorCountFromForm(panel, form) {
    var count = parser.parseJuniorPlayersFromForm(form).length;

    writeJuniorCountCache(count);
    applyJuniorCountToPanel(
      panel,
      count,
      'Aut. z listy juniorow: ' + count + '/' + sim.CONFIG.maxJuniorCount
    );
  }

  function refreshJuniorCountFromCache(panel) {
    var cached = readJuniorCountCache();

    if (cached !== null) {
      applyJuniorCountToPanel(
        panel,
        cached,
        'Z ostatniej wizyty w treningu juniorow: ' + cached + '/' + sim.CONFIG.maxJuniorCount
      );
      return;
    }

    applyJuniorCountToPanel(
      panel,
      sim.CONFIG.optimalJuniorCount,
      'Domyslnie: ' + sim.CONFIG.optimalJuniorCount + '/' + sim.CONFIG.maxJuniorCount
    );
  }

  function fetchJuniorTrainingPoolFromAction(action) {
    var url = parser.buildTrainingAjaxUrl(action);

    if (!url) {
      return Promise.resolve(null);
    }

    return window.fetch(url)
      .then(function (response) {
        if (!response.ok) {
          throw new Error('Training fetch failed with status ' + response.status);
        }
        return response.text();
      })
      .then(function (text) {
        var html = parser.parseAjaxVmBody(text);
        return parser.parseJuniorTrainingPoolFromHtml(html, sim.CONFIG.poolCap);
      });
  }

  function fetchJuniorTrainingPoolFromAjax() {
    var actions = parser.discoverJuniorTrainingActionsFromHtml(document.documentElement.innerHTML);
    var index = 0;

    function tryNext() {
      if (index >= actions.length) {
        return Promise.resolve(null);
      }

      var action = actions[index];
      index += 1;

      return fetchJuniorTrainingPoolFromAction(action).then(function (poolData) {
        if (poolData) {
          poolData._vjtcAction = action;
          return poolData;
        }

        return tryNext();
      });
    }

    return tryNext();
  }

  function resolveJuniorTrainingPool() {
    var domPool = readJuniorTrainingPoolFromDom();

    if (domPool) {
      writePoolCache(domPool);
      return Promise.resolve({
        pool: domPool,
        source: 'dom',
      });
    }

    var cached = readPoolCache();

    if (cached) {
      return Promise.resolve({
        pool: cached,
        source: 'cache',
      });
    }

    if (trainingPoolPromise) {
      return trainingPoolPromise;
    }

    trainingPoolPromise = fetchJuniorTrainingPoolFromAjax()
      .then(function (poolData) {
        if (!poolData) {
          throw new Error('Junior training pool not found');
        }

        writePoolCache({
          current: poolData.current,
          max: poolData.max,
        });
        return {
          pool: {
            current: poolData.current,
            max: poolData.max,
          },
          source: 'ajax',
          action: poolData._vjtcAction || '',
        };
      })
      .finally(function () {
        trainingPoolPromise = null;
      });

    return trainingPoolPromise;
  }

  function buildPoolHint(result) {
    if (!result || !result.pool) {
      return '';
    }

    if (result.source === 'dom') {
      return 'Z formularza treningu juniorow: ' + result.pool.current + '/' + result.pool.max;
    }

    if (result.source === 'cache') {
      return 'Z ostatniej wizyty w treningu juniorow: ' + result.pool.current + '/' + result.pool.max;
    }

    if (result.action) {
      return 'Aut. (' + result.action + '): ' + result.pool.current + '/' + result.pool.max;
    }

    return 'Aut. z treningu juniorow: ' + result.pool.current + '/' + result.pool.max;
  }

  function applyPoolDataToPanel(panel, poolData, hintText) {
    var poolInput = panel.querySelector('#vjtc-pool');
    var hint = panel.querySelector('#vjtc-pool-hint');

    if (!poolData || !poolInput || document.activeElement === poolInput) {
      return;
    }

    poolInput.value = String(poolData.current);
    poolInput.max = String(Math.min(poolData.max, sim.CONFIG.poolCap));

    if (hint && hintText) {
      hint.textContent = hintText;
    }
  }

  function refreshPoolFromTrainingAjax(panel) {
    var hint = panel.querySelector('#vjtc-pool-hint');

    if (hint) {
      hint.textContent = 'Pobieram pule juniorow...';
    }

    return resolveJuniorTrainingPool()
      .then(function (result) {
        applyPoolDataToPanel(panel, result.pool, buildPoolHint(result));
        return result.pool;
      })
      .catch(function () {
        if (hint) {
          hint.textContent = 'Nie udalo sie pobrac puli juniorow — wejdz raz w trening juniorow lub ustaw recznie (max '
            + sim.CONFIG.poolCap + ').';
        }
        return null;
      });
  }

  function refreshDaysLeftFromSchedule(panel) {
    return fetchSeasonScheduleData()
      .then(function (data) {
        applySeasonScheduleToPanel(panel, data);
        return data;
      })
      .catch(function () {
        var hint = panel.querySelector('#vjtc-days-left-hint');
        if (hint) {
          hint.textContent = 'Terminarz niedostępny — ustaw dni ręcznie.';
        }
        return null;
      });
  }

  function clearSkillRows(panel) {
    var skillsRoot = panel.querySelector('#vjtc-skills');
    skillsRoot.innerHTML = '';
    return skillsRoot;
  }

  function setSkillRows(panel, skills, form) {
    var skillsRoot = clearSkillRows(panel);
    var items = Array.isArray(skills)
      ? skills
      : [{ code: 'UM_PRZYJECIE', level: 10, targetLevel: sim.CONFIG.maxLevel }];
    var refreshDisabled = form ? !getActivePlayer(panel, form) : true;

    items.forEach(function (skill) {
      skillsRoot.appendChild(createSkillRow(skill.code, skill.level, skill.targetLevel, refreshDisabled));
    });
  }

  function updateSkillsHint(panel, skills) {
    var hint = panel.querySelector('#vjtc-skills-hint');

    if (!hint) {
      return;
    }

    if (skills && skills.length) {
      hint.textContent = '';
      return;
    }

    if (panel.dataset.vjtcMode === 'scout') {
      hint.textContent = 'Nie udało się ustalić rekomendowanych umiejętności — dodaj umiejętności ręcznie.';
      return;
    }

    hint.textContent = SKILLS_HINT_EMPTY;
  }

  function getRecommendedSkillsForPlayer(player) {
    var position;
    var attributes;
    var skills;

    if (!player) {
      return [];
    }

    position = player.position || '';
    attributes = normalizeAttributeMap(player.attributes);

    if (player.playerId === 'scout') {
      var domAttributes = readScoutAttributesFromDom();
      var htmlSource = document.documentElement ? document.documentElement.innerHTML : '';
      var htmlAttributes = readScoutAttributesFromHtml(htmlSource);

      if (!position) {
        position = readScoutPositionFromDom();
      }

      if (!position) {
        position = readScoutPositionFromHtml(htmlSource);
      }

      Object.keys(domAttributes).forEach(function (code) {
        attributes[code] = domAttributes[code];
      });

      Object.keys(htmlAttributes).forEach(function (code) {
        attributes[code] = htmlAttributes[code];
      });

      player._vjtcDomAttributeCount = Object.keys(domAttributes).length;
      player._vjtcHtmlAttributeCount = Object.keys(htmlAttributes).length;
      player.position = position;
      player.attributes = attributes;
    }

    skills = positionRules.getRecommendedTrainableSkills
      ? positionRules.getRecommendedTrainableSkills(position, attributes, {
        maxLevel: sim.CONFIG.maxLevel,
      })
      : [];

    if (skills && skills.length) {
      return skills;
    }

    return getFallbackRecommendedSkills(position, attributes);
  }

  function buildPlayerOptions(players, selectedId) {
    if (!players.length) {
      return '<option value="">Brak juniorow na stronie</option>';
    }

    return '<option value="">-- wybierz zawodnika --</option>' + players.map(function (player) {
      var label = player.name || ('ID ' + player.playerId);
      var suffix = player.age != null ? ' (' + player.age + ' lat)' : '';
      var selected = player.playerId === selectedId ? ' selected' : '';
      return '<option value="' + escapeHtml(player.playerId) + '"' + selected + '>' + escapeHtml(label + suffix) + '</option>';
    }).join('');
  }

  function getSelectedPlayer(players, playerId) {
    return players.find(function (player) {
      return player.playerId === playerId;
    }) || null;
  }

  function loadPlayerIntoPanel(panel, player, skillsMode, form) {
    var ageInput = panel.querySelector('#vjtc-age');
    var skills;

    if (player && player.age != null && ageInput) {
      ageInput.value = String(player.age);
    }

    panel.dataset.selectedPlayerId = player ? player.playerId : '';

    if (!player) {
      updateSkillsHint(panel, []);
      return;
    }

    if (!skillsMode) {
      return;
    }

    skills = skillsMode === 'all'
      ? parser.getTrainableSkills(player.attributes)
      : getRecommendedSkillsForPlayer(player);

    setSkillRows(panel, skills, form);
    updateSkillsHint(panel, skills);
  }

  function refreshPlayerSelect(panel, form) {
    var players = parser.parseJuniorPlayersFromForm(form);
    var select = panel.querySelector('#vjtc-player');
    var previousId = select ? select.value || panel.dataset.selectedPlayerId || '' : '';

    if (!select) {
      return players;
    }

    select.innerHTML = buildPlayerOptions(players, previousId);

    if (previousId) {
      var player = getSelectedPlayer(players, previousId);
      if (player) {
        loadPlayerIntoPanel(panel, player, false, form);
      }
    }

    panel.dataset.playerCount = String(players.length);
    updatePlayerActionButtonsState(panel, form);
    return players;
  }

  function ensurePanel(form) {
    var panel = dom.getVisibleElementById(document, PANEL_ID);

    if (panel) {
      return panel;
    }

    dom.removeHiddenById(document, PANEL_ID);

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'vjtc-panel';
    panel.dataset.vjtcMode = 'training';

    var poolData = parseTrainingPoolFromForm(form);
    var defaultPool = poolData ? poolData.current : 0;
    var players = parser.parseJuniorPlayersFromForm(form);
    var defaultJuniorCount = sim.normalizeJuniorCount(players.length);

    panel.innerHTML = ''
      + '<h3 class="vjtc-title">Kalkulator treningu juniorow</h3>'
      + '<p class="vjtc-hint">Umiejetnosci wczytuj z tabeli treningu juniorow (ukryte wartosci w HTML wiersza).</p>'
      + '<div class="vjtc-player-row">'
      + '<label>Zawodnik<select id="vjtc-player">' + buildPlayerOptions(players, '') + '</select></label>'
      + '<div class="vjtc-player-actions">'
      + '<button type="button" class="vjtc-btn" id="vjtc-load-player">Wczytaj wszystkie</button>'
      + '<button type="button" class="vjtc-btn" id="vjtc-refresh-levels" disabled>Odswiez poziomy</button>'
      + '</div>'
      + '</div>'
      + '<div class="vjtc-grid">'
      + '<label>Wiek<input id="vjtc-age" type="number" min="14" max="18" step="1" value="16"></label>'
      + '<label>Dni do konca sezonu<input id="vjtc-days-left" type="number" min="0" step="1" value="45">'
      + '<span class="vjtc-field-hint" id="vjtc-days-left-hint"></span></label>'
      + '<label>Pula pkt<input id="vjtc-pool" type="number" min="0" max="' + escapeHtml(sim.CONFIG.poolCap) + '" step="1" value="' + escapeHtml(defaultPool) + '">'
      + '<span class="vjtc-field-hint" id="vjtc-pool-hint"></span></label>'
      + '<label>Juniorzy<input id="vjtc-junior-count" type="number" min="0" max="' + escapeHtml(sim.CONFIG.maxJuniorCount) + '" step="1" value="' + escapeHtml(defaultJuniorCount) + '">'
      + '<span class="vjtc-field-hint" id="vjtc-junior-count-hint"></span></label>'
      + '<label>Dni sezonu<input id="vjtc-season-days" type="number" min="1" step="1" value="' + escapeHtml(sim.CONFIG.seasonDays) + '"></label>'
      + '</div>'
      + '<p class="vjtc-hint">Kolejnosc umiejetnosci = priorytet strategii „Priorytet” (▲▼). Wybor zawodnika laduje rekomendowane umiejetnosci pozycji.</p>'
      + '<p class="vjtc-hint" id="vjtc-skills-hint"></p>'
      + '<div class="vjtc-skills" id="vjtc-skills"></div>'
      + '<div class="vjtc-actions">'
      + '<button type="button" class="vjtc-btn" id="vjtc-add-skill">Dodaj umiejetnosc</button>'
      + '</div>'
      + '<div class="vjtc-strategies" id="vjtc-strategies">' + buildStrategyCheckboxes(DEFAULT_STRATEGIES) + '</div>'
      + '<div class="vjtc-actions">'
      + '<button type="button" class="vjtc-btn" id="vjtc-calculate">Oblicz</button>'
      + '</div>'
      + '<div class="vjtc-results" id="vjtc-results"></div>';

    if (form.parentElement) {
      form.parentElement.insertBefore(panel, form.nextSibling);
    } else {
      form.appendChild(panel);
    }

    setSkillRows(panel, [
      { code: 'UM_PRZYJECIE', level: 10, targetLevel: sim.CONFIG.maxLevel },
      { code: 'UM_OBRONA', level: 10, targetLevel: sim.CONFIG.maxLevel },
    ], form);

    panel.querySelector('#vjtc-player').addEventListener('change', function () {
      var currentPlayers = parser.parseJuniorPlayersFromForm(form);
      var player = getSelectedPlayer(currentPlayers, panel.querySelector('#vjtc-player').value);
      loadPlayerIntoPanel(panel, player, 'recommended', form);
      updatePlayerActionButtonsState(panel, form);
    });

    panel.querySelector('#vjtc-load-player').addEventListener('click', function () {
      var currentPlayers = parser.parseJuniorPlayersFromForm(form);
      var player = getSelectedPlayer(currentPlayers, panel.querySelector('#vjtc-player').value);

      if (!player) {
        window.alert('Wybierz zawodnika z listy.');
        return;
      }

      loadPlayerIntoPanel(panel, player, 'all', form);
      updatePlayerActionButtonsState(panel, form);
    });

    var skillsRoot = panel.querySelector('#vjtc-skills');

    panel.querySelector('#vjtc-add-skill').addEventListener('click', function () {
      var code = 'UM_SERWIS';
      var hasPlayer = Boolean(getActivePlayer(panel, form));
      skillsRoot.appendChild(createSkillRow(
        code,
        getDefaultSkillLevel(panel, form, code),
        sim.CONFIG.maxLevel,
        !hasPlayer
      ));
    });

    panel.addEventListener('click', function (event) {
      var skillRow = event.target.closest('.vjtc-skill-row');

      if (event.target.classList.contains('vjtc-remove-skill')) {
        var rows = skillsRoot.querySelectorAll('.vjtc-skill-row');
        if (rows.length > 1 && skillRow) {
          skillRow.remove();
        }
        return;
      }

      if (event.target.classList.contains('vjtc-move-up') && skillRow) {
        moveSkillRow(skillRow, -1);
        return;
      }

      if (event.target.classList.contains('vjtc-move-down') && skillRow) {
        moveSkillRow(skillRow, 1);
      }
    });

    panel.querySelector('#vjtc-calculate').addEventListener('click', function () {
      renderResults(panel, collectInput(panel));
    });

    ensurePanelControls(panel, form);

    return panel;
  }

  function collectInput(panel) {
    var strategies = Array.prototype.slice.call(
      panel.querySelectorAll('input[name="vjtc-strategy"]:checked')
    ).map(function (node) {
      return node.value;
    });

    var skills = Array.prototype.slice.call(panel.querySelectorAll('.vjtc-skill-row')).map(function (row) {
      return {
        code: row.querySelector('.vjtc-skill-code').value,
        level: parseNumber(row.querySelector('.vjtc-skill-level').value, 0),
        targetLevel: parseNumber(row.querySelector('.vjtc-skill-target').value, sim.CONFIG.maxLevel),
      };
    });

    return {
      age: parseNumber(panel.querySelector('#vjtc-age').value, 16),
      daysLeftInSeason: parseNumber(panel.querySelector('#vjtc-days-left').value, 0),
      trainingPool: parseNumber(panel.querySelector('#vjtc-pool').value, 0),
      juniorCount: parseNumber(panel.querySelector('#vjtc-junior-count').value, sim.CONFIG.optimalJuniorCount),
      seasonDays: parseNumber(panel.querySelector('#vjtc-season-days').value, sim.CONFIG.seasonDays),
      skills: skills,
      strategies: strategies.length ? strategies : DEFAULT_STRATEGIES,
    };
  }

  function formatLevel(level) {
    return Number(level).toFixed(1).replace(/\.0$/, '');
  }

  function formatPercent(value) {
    return (Number(value) * 100).toFixed(2).replace('.', ',') + '%';
  }

  function renderResults(panel, input) {
    var resultsRoot = panel.querySelector('#vjtc-results');
    var results = sim.compareStrategies(input, input.strategies);
    var skillCodes = input.skills.map(function (skill) { return skill.code; });
    var head = ''
      + '<tr><th>Strategia</th>'
      + skillCodes.map(function (code) {
        return '<th>' + escapeHtml(skillLabelByCode[code] || code) + '</th>';
      }).join('')
      + '<th>Do celu?</th><th>Skoki</th></tr>';

    var body = results.map(function (result) {
      var meta = sim.STRATEGY_META[result.strategy] || { label: result.strategy };
      var cells = result.skills.map(function (skill) {
        var className = skill.reachedTarget ? 'vjtc-ok' : 'vjtc-miss';
        var suffix = skill.reachedTarget
          ? ' (' + skill.trainingsUsed + ' tr.)'
          : ' (-' + skill.remainingTrainingsToTarget + ' tr.)';
        return ''
          + '<td class="' + className + '">'
          + escapeHtml(formatLevel(skill.level))
          + escapeHtml(suffix)
          + '</td>';
      }).join('');

      return ''
        + '<tr>'
        + '<td>' + escapeHtml(meta.label) + '</td>'
        + cells
        + '<td>' + escapeHtml(result.allTargetsReached ? 'tak' : 'nie') + '</td>'
        + '<td>' + escapeHtml(String(result.totalLevelUps)) + '</td>'
        + '</tr>';
    }).join('');

    var first = results[0] || null;
    var meta = first
      ? '<div class="vjtc-meta">Horyzont: ' + first.careerDays + ' dni | Treningi: ~' + first.budget
      + ' | Efektywne tr.: ~' + Math.round(first.effectiveBudget)
      + ' | Juniorzy: ' + first.juniorCount + '/' + sim.CONFIG.maxJuniorCount
      + ' | Efektywnosc: ' + escapeHtml(formatPercent(first.trainingEfficiency))
      + (first.wastedPoints ? ' | Stracone pkt (cap): ' + first.wastedPoints : '')
      + '</div>'
      : '';

    resultsRoot.innerHTML = ''
      + '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
      + meta;
  }

  function refreshPoolFromForm(panel, form) {
    var poolData = parseTrainingPoolFromForm(form);
    var hint = panel.querySelector('#vjtc-pool-hint');

    if (!poolData) {
      return;
    }

    writePoolCache(poolData);
    applyPoolDataToPanel(
      panel,
      poolData,
      'Z formularza treningu juniorow: ' + poolData.current + '/' + poolData.max
    );
  }

  function buildScoutSubtitle(candidate) {
    var parts = [candidate.name || 'Kandydat'];

    if (candidate.age != null) {
      parts.push(candidate.age + ' lat');
    }

    if (candidate.position) {
      parts.push(candidate.position);
    }

    return parts.join(' · ');
  }

  function buildScoutSignature(candidate) {
    return [
      candidate.name || '',
      candidate.age == null ? '' : String(candidate.age),
      candidate.position || '',
      Object.keys(candidate.attributes || {}).sort().map(function (code) {
        return code + ':' + candidate.attributes[code];
      }).join('|'),
    ].join('#');
  }

  function loadScoutCandidateIntoPanel(panel, candidate) {
    var ageInput = panel.querySelector('#vjtc-age');
    var subtitle = panel.querySelector('#vjtc-scout-subtitle');
    var skills;

    panel._vjtcScoutCandidate = candidate;
    panel.dataset.vjtcVersion = CALCULATOR_VERSION;

    if (ageInput && candidate.age != null) {
      ageInput.value = String(candidate.age);
    }

    if (subtitle) {
      subtitle.textContent = buildScoutSubtitle(candidate);
    }

    skills = getRecommendedSkillsForPlayer(candidate);
    panel.dataset.scoutAttributeCount = String(Object.keys(candidate.attributes || {}).length);
    panel.dataset.scoutDomAttributeCount = String(candidate._vjtcDomAttributeCount || 0);
    panel.dataset.scoutHtmlAttributeCount = String(candidate._vjtcHtmlAttributeCount || 0);
    panel.dataset.scoutRecommendedCount = String(skills.length);

    setSkillRows(panel, skills, null);
    updateSkillsHint(panel, skills);
    return skills;
  }

  function findScoutPanelAnchor() {
    var accept = document.querySelector('[onclick*="YoungPlayerTempAccept"]');
    return accept ? accept.closest('table') : null;
  }

  function ensureScoutPanel(candidate) {
    var panel = dom.getVisibleElementById(document, PANEL_ID);
    var anchor = findScoutPanelAnchor();

    if (!anchor || !anchor.parentElement) {
      return null;
    }

    if (panel && panel.dataset.vjtcMode !== 'scout') {
      panel.remove();
      panel = null;
    }

    if (!panel) {
      dom.removeHiddenById(document, PANEL_ID);

      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.className = 'vjtc-panel vjtc-mode-scout';
      panel.dataset.vjtcMode = 'scout';
      var defaultJuniorCount = readJuniorCountCache();
      if (defaultJuniorCount === null) {
        defaultJuniorCount = sim.CONFIG.optimalJuniorCount;
      }

      panel.innerHTML = ''
        + '<h3 class="vjtc-title">Kalkulator treningu juniorow</h3>'
        + '<p class="vjtc-scout-subtitle" id="vjtc-scout-subtitle"></p>'
        + '<p class="vjtc-hint">Symulacja rozwoju kandydata przed akceptacja propozycji skauta.</p>'
        + '<div class="vjtc-grid">'
        + '<label>Wiek<input id="vjtc-age" type="number" min="14" max="18" step="1" value="16"></label>'
        + '<label>Dni do konca sezonu<input id="vjtc-days-left" type="number" min="0" step="1" value="45">'
        + '<span class="vjtc-field-hint" id="vjtc-days-left-hint"></span></label>'
        + '<label>Pula pkt<input id="vjtc-pool" type="number" min="0" max="' + escapeHtml(sim.CONFIG.poolCap) + '" step="1" value="0">'
        + '<span class="vjtc-field-hint" id="vjtc-pool-hint"></span></label>'
        + '<label>Juniorzy<input id="vjtc-junior-count" type="number" min="0" max="' + escapeHtml(sim.CONFIG.maxJuniorCount) + '" step="1" value="' + escapeHtml(defaultJuniorCount) + '">'
        + '<span class="vjtc-field-hint" id="vjtc-junior-count-hint"></span></label>'
        + '<label>Dni sezonu<input id="vjtc-season-days" type="number" min="1" step="1" value="' + escapeHtml(sim.CONFIG.seasonDays) + '"></label>'
        + '</div>'
        + '<p class="vjtc-hint">Kolejnosc umiejetnosci = priorytet strategii „Priorytet” (▲▼). Kandydat laduje rekomendowane umiejetnosci pozycji.</p>'
        + '<p class="vjtc-hint" id="vjtc-skills-hint"></p>'
        + '<div class="vjtc-skills" id="vjtc-skills"></div>'
        + '<div class="vjtc-actions">'
        + '<button type="button" class="vjtc-btn" id="vjtc-add-skill">Dodaj umiejetnosc</button>'
        + '</div>'
        + '<div class="vjtc-strategies" id="vjtc-strategies">' + buildStrategyCheckboxes(DEFAULT_STRATEGIES) + '</div>'
        + '<div class="vjtc-actions">'
        + '<button type="button" class="vjtc-btn" id="vjtc-calculate">Oblicz</button>'
        + '</div>'
        + '<div class="vjtc-results" id="vjtc-results"></div>';

      anchor.parentElement.insertBefore(panel, anchor);

      var skillsRoot = panel.querySelector('#vjtc-skills');

      panel.querySelector('#vjtc-add-skill').addEventListener('click', function () {
        var code = 'UM_SERWIS';
        var scoutCandidate = getScoutCandidate(panel);
        var level = scoutCandidate && scoutCandidate.attributes[code] != null
          ? scoutCandidate.attributes[code]
          : 10;
        skillsRoot.appendChild(createSkillRow(code, level, sim.CONFIG.maxLevel, true));
      });

      panel.addEventListener('click', function (event) {
        var skillRow = event.target.closest('.vjtc-skill-row');

        if (event.target.classList.contains('vjtc-remove-skill')) {
          var rows = skillsRoot.querySelectorAll('.vjtc-skill-row');
          if (rows.length > 1 && skillRow) {
            skillRow.remove();
          }
          return;
        }

        if (event.target.classList.contains('vjtc-move-up') && skillRow) {
          moveSkillRow(skillRow, -1);
          return;
        }

        if (event.target.classList.contains('vjtc-move-down') && skillRow) {
          moveSkillRow(skillRow, 1);
        }
      });

      panel.querySelector('#vjtc-calculate').addEventListener('click', function () {
        renderResults(panel, collectInput(panel));
      });

      panel.addEventListener('change', function (event) {
        if (!event.target.classList.contains('vjtc-skill-code')) {
          return;
        }

        var row = event.target.closest('.vjtc-skill-row');
        var scoutCandidate = getScoutCandidate(panel);

        if (row && scoutCandidate) {
          setRowLevelFromPlayer(row, scoutCandidate);
        }
      });

      panel.dataset.vjtcControlsBound = '1';
    }

    return panel;
  }

  function enhanceScoutView() {
    if (!parser.isScoutView(document)) {
      return;
    }

    var candidate = parser.parseScoutCandidateFromRoot(document);

    if (!candidate) {
      return;
    }

    injectStyles();

    var panel = ensureScoutPanel(candidate);

    if (!panel) {
      return;
    }

    ensurePanelControls(panel, null);

    var signature = buildScoutSignature(candidate);
    var hasSkillRows = panel.querySelectorAll('.vjtc-skill-row').length > 0;

    if (panel.dataset.scoutSignature !== signature || !hasSkillRows) {
      loadScoutCandidateIntoPanel(panel, candidate);
      panel.dataset.scoutSignature = signature;
    }

    if (!panel.dataset.poolRequested) {
      panel.dataset.poolRequested = '1';
      refreshPoolFromTrainingAjax(panel);
    }

    refreshJuniorCountFromCache(panel);

    if (!panel.dataset.scheduleRequested) {
      panel.dataset.scheduleRequested = '1';
      refreshDaysLeftFromSchedule(panel);
    }
  }

  function enhanceJuniorTrainingView() {
    var form = getJuniorTrainingForm();

    if (!form) {
      return;
    }

    injectStyles();

    var existingPanel = dom.getVisibleElementById(document, PANEL_ID);
    if (existingPanel && existingPanel.dataset.vjtcMode === 'scout') {
      existingPanel.remove();
      existingPanel = null;
    }

    var panel = existingPanel || ensurePanel(form);
    refreshPlayerSelect(panel, form);
    refreshPoolFromForm(panel, form);
    ensurePanelControls(panel, form);
    refreshJuniorCountFromForm(panel, form);

    if (!panel.dataset.scheduleRequested) {
      panel.dataset.scheduleRequested = '1';
      refreshDaysLeftFromSchedule(panel);
    }
  }

  function scheduleEnhance() {
    window.setTimeout(function () {
      if (parser.isScoutView(document)) {
        enhanceScoutView();
        return;
      }

      enhanceJuniorTrainingView();
    }, 80);
  }

  document.addEventListener('change', function (event) {
    if (event.target && event.target.id === FORM_ID) {
      scheduleEnhance();
    }
  });

  var observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scheduleEnhance();
}());
