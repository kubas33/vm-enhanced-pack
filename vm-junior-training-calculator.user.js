// ==UserScript==
// @name         Volleyball junior training calculator
// @namespace    https://vm-manager.org/
// @version      0.2.0
// @description  Projects junior academy skill growth with comparable allocation strategies.
// @match        *://*.vm-manager.org/*
// @match        *://vm-manager.org/*
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-calculator.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-calculator.user.js
// @run-at       document-end
// @grant        none
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-dom-utils.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-sim.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-junior-training-parser.js
// ==/UserScript==

(function () {
  'use strict';

  var dom = window.VMDomUtils;
  var sim = window.VMJuniorTrainingSim;
  var parser = window.VMJuniorTrainingParser;

  if (!dom || !sim || !parser) {
    throw new Error('Junior Training Calculator wymaga vm-dom-utils.js, vm-junior-training-sim.js i vm-junior-training-parser.js.');
  }

  var PANEL_ID = 'vjtc-panel';
  var FORM_ID = 'young_trening_options';
  var DEFAULT_STRATEGIES = ['priority', 'roundRobin'];

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
      + '.vjtc-player-row{display:grid;grid-template-columns:1.6fr auto;gap:8px;margin-bottom:8px;align-items:end;}'
      + '.vjtc-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:8px;}'
      + '.vjtc-hint{margin:0 0 8px;color:#9ec7de;font-size:10px;}'
      + '.vjtc-grid label{display:flex;flex-direction:column;gap:3px;}'
      + '.vjtc-grid input,.vjtc-grid select{width:100%;box-sizing:border-box;}'
      + '.vjtc-skills{margin:8px 0;}'
      + '.vjtc-skill-row{display:grid;grid-template-columns:1.4fr .7fr .7fr auto;gap:6px;margin-bottom:6px;}'
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
      + '.vjtc-meta{margin-top:6px;color:#9ec7de;font-size:10px;}';
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

  function createSkillRow(code, level, targetLevel) {
    var row = document.createElement('div');
    row.className = 'vjtc-skill-row';
    row.innerHTML = ''
      + '<select class="vjtc-skill-code">' + buildSkillOptions(code || 'UM_PRZYJECIE') + '</select>'
      + '<input class="vjtc-skill-level" type="number" min="0" max="30.5" step="0.5" value="' + escapeHtml(level == null ? 10 : level) + '">'
      + '<input class="vjtc-skill-target" type="number" min="0" max="30.5" step="0.5" value="' + escapeHtml(targetLevel == null ? sim.CONFIG.maxLevel : targetLevel) + '" title="Cel">'
      + '<button type="button" class="vjtc-btn vjtc-remove-skill">Usun</button>';
    return row;
  }

  function clearSkillRows(panel) {
    var skillsRoot = panel.querySelector('#vjtc-skills');
    skillsRoot.innerHTML = '';
    return skillsRoot;
  }

  function setSkillRows(panel, skills) {
    var skillsRoot = clearSkillRows(panel);
    var items = skills && skills.length ? skills : [{ code: 'UM_PRZYJECIE', level: 10, targetLevel: sim.CONFIG.maxLevel }];

    items.forEach(function (skill) {
      skillsRoot.appendChild(createSkillRow(skill.code, skill.level, skill.targetLevel));
    });
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

  function loadPlayerIntoPanel(panel, player, loadAllSkills) {
    var ageInput = panel.querySelector('#vjtc-age');

    if (player && player.age != null && ageInput) {
      ageInput.value = String(player.age);
    }

    if (!player || !loadAllSkills) {
      panel.dataset.selectedPlayerId = player ? player.playerId : '';
      return;
    }

    setSkillRows(panel, parser.getTrainableSkills(player.attributes));
    panel.dataset.selectedPlayerId = player.playerId;
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
        loadPlayerIntoPanel(panel, player, false);
      }
    }

    panel.dataset.playerCount = String(players.length);
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

    var poolData = parseTrainingPoolFromForm(form);
    var defaultPool = poolData ? poolData.current : 0;
    var players = parser.parseJuniorPlayersFromForm(form);

    panel.innerHTML = ''
      + '<h3 class="vjtc-title">Kalkulator treningu juniorow</h3>'
      + '<p class="vjtc-hint">Umiejetnosci wczytuj z tabeli treningu juniorow (ukryte wartosci w HTML wiersza).</p>'
      + '<div class="vjtc-player-row">'
      + '<label>Zawodnik<select id="vjtc-player">' + buildPlayerOptions(players, '') + '</select></label>'
      + '<button type="button" class="vjtc-btn" id="vjtc-load-player">Wczytaj umiejetnosci</button>'
      + '</div>'
      + '<div class="vjtc-grid">'
      + '<label>Wiek<input id="vjtc-age" type="number" min="14" max="18" step="1" value="16"></label>'
      + '<label>Dni do konca sezonu<input id="vjtc-days-left" type="number" min="0" step="1" value="45"></label>'
      + '<label>Pula pkt<input id="vjtc-pool" type="number" min="0" max="40" step="1" value="' + escapeHtml(defaultPool) + '"></label>'
      + '<label>Dni sezonu<input id="vjtc-season-days" type="number" min="1" step="1" value="' + escapeHtml(sim.CONFIG.seasonDays) + '"></label>'
      + '</div>'
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
    ]);

    panel.querySelector('#vjtc-player').addEventListener('change', function () {
      var currentPlayers = parser.parseJuniorPlayersFromForm(form);
      var player = getSelectedPlayer(currentPlayers, panel.querySelector('#vjtc-player').value);
      loadPlayerIntoPanel(panel, player, false);
    });

    panel.querySelector('#vjtc-load-player').addEventListener('click', function () {
      var currentPlayers = parser.parseJuniorPlayersFromForm(form);
      var player = getSelectedPlayer(currentPlayers, panel.querySelector('#vjtc-player').value);

      if (!player) {
        window.alert('Wybierz zawodnika z listy.');
        return;
      }

      loadPlayerIntoPanel(panel, player, true);
    });

    var skillsRoot = panel.querySelector('#vjtc-skills');

    panel.querySelector('#vjtc-add-skill').addEventListener('click', function () {
      skillsRoot.appendChild(createSkillRow('UM_SERWIS', 8, sim.CONFIG.maxLevel));
    });

    panel.addEventListener('click', function (event) {
      if (event.target.classList.contains('vjtc-remove-skill')) {
        var rows = skillsRoot.querySelectorAll('.vjtc-skill-row');
        if (rows.length > 1) {
          event.target.closest('.vjtc-skill-row').remove();
        }
      }
    });

    panel.querySelector('#vjtc-calculate').addEventListener('click', function () {
      renderResults(panel, collectInput(panel));
    });

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
      seasonDays: parseNumber(panel.querySelector('#vjtc-season-days').value, sim.CONFIG.seasonDays),
      skills: skills,
      strategies: strategies.length ? strategies : DEFAULT_STRATEGIES,
    };
  }

  function formatLevel(level) {
    return Number(level).toFixed(1).replace(/\.0$/, '');
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
      + '<th>Do celu?</th><th>Treningi</th></tr>';

    var body = results.map(function (result) {
      var meta = sim.STRATEGY_META[result.strategy] || { label: result.strategy };
      var cells = result.skills.map(function (skill) {
        var className = skill.reachedTarget ? 'vjtc-ok' : 'vjtc-miss';
        var suffix = skill.reachedTarget
          ? ''
          : ' (-' + skill.remainingTrainingsToTarget + ')';
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
        + '<td>' + escapeHtml(result.trainingsUsed + '/' + result.budget) + '</td>'
        + '</tr>';
    }).join('');

    var first = results[0] || null;
    var meta = first
      ? '<div class="vjtc-meta">Horyzont: ' + first.careerDays + ' dni | Budzet treningow: ~' + first.budget
      + (first.wastedPoints ? ' | Stracone pkt (cap): ' + first.wastedPoints : '')
      + '</div>'
      : '';

    resultsRoot.innerHTML = ''
      + '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>'
      + meta;
  }

  function refreshPoolFromForm(panel, form) {
    var poolData = parseTrainingPoolFromForm(form);
    var poolInput = panel.querySelector('#vjtc-pool');

    if (!poolData || !poolInput || document.activeElement === poolInput) {
      return;
    }

    poolInput.value = String(poolData.current);
    poolInput.max = String(Math.min(poolData.max, sim.CONFIG.poolCap));
  }

  function enhanceJuniorTrainingView() {
    var form = getJuniorTrainingForm();

    if (!form) {
      return;
    }

    injectStyles();
    var panel = dom.getVisibleElementById(document, PANEL_ID) || ensurePanel(form);
    refreshPlayerSelect(panel, form);
    refreshPoolFromForm(panel, form);
  }

  function scheduleEnhance() {
    window.setTimeout(enhanceJuniorTrainingView, 80);
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
