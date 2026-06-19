// ==UserScript==
// @name         VM Training History Parser
// @namespace    https://vm-manager.org/
// @version      0.1.5
// @description  Parses senior training snapshots, coaches, infrastructure and training efficiency context.
// @grant        none
// @run-at       document-start
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-training-history-parser.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-training-history-parser.js
// ==/UserScript==

(function (root, factory) {
  var api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.VMTrainingHistoryParser = api;
  }
}(typeof window !== 'undefined' ? window : this, function () {
  'use strict';

  var SENIOR_FORM_ID = 'trening_options';
  var SENIOR_SELECT_ID = 'trening_type_senior';
  var SENIOR_INPUT_PREFIX = 'trening_option_';
  var VERSION = '0.1.5';
  var MAX_COACH_ATTRIBUTE = 30;
  var MAX_SENIOR_INFRASTRUCTURE_BONUS = 20;

  var TRAINING_OPTION_META = {
    wybrany: { cost: 4 },
    wytrz: {
      cost: 1,
      skillCode: 'WYTRZYMALOSC',
      skillLabel: 'Wytrzymalosc',
      trainingKind: 'physical',
    },
    odp: {
      cost: 1,
      skillCode: 'ODPORNOSC',
      skillLabel: 'Odpornosc na stres',
      trainingKind: 'psychological',
    },
    nietrenuj: { cost: 0 },
  };

  var TECHNICAL_SKILL_CODES = {
    UM_SERWIS: true,
    UM_PRZYJECIE: true,
    UM_ROZGRYWANIE: true,
    UM_WYSTAWA: true,
    UM_ATAK_ZE_SKRZYDLA: true,
    UM_ATAK_ZE_SRODKA: true,
    UM_ATAK_2L: true,
    UM_OMIJANIE_BLOKU: true,
    UM_KIWKA: true,
    UM_ATAK_BO: true,
    UM_OBRONA: true,
    UM_ASEKURACJA: true,
    UM_BLOK_AKTYWNY: true,
    UM_BLOK_PASYWNY: true,
    UM_USTAWIANIE: true,
  };

  var SKILL_LABELS = {
    UM_SERWIS: 'Serwis',
    UM_SILA_SERWISU: 'Sila serwisu',
    UM_PRZYJECIE: 'Przyjecie',
    UM_ROZGRYWANIE: 'Rozgrywanie',
    UM_WYSTAWA: 'Wystawa',
    UM_ATAK_ZE_SKRZYDLA: 'Atak ze skrzydla',
    UM_ATAK_ZE_SRODKA: 'Atak ze srodka',
    UM_ATAK_2L: 'Atak z 2 linii',
    UM_OMIJANIE_BLOKU: 'Omijanie bloku',
    UM_KIWKA: 'Kiwka',
    UM_ATAK_BO: 'Atak blok-aut',
    UM_OBRONA: 'Obrona',
    UM_ASEKURACJA: 'Asekuracja',
    UM_BLOK_AKTYWNY: 'Blok',
    UM_BLOK_PASYWNY: 'Blok pasywny',
    UM_USTAWIANIE: 'Ustawianie sie do bloku',
    WYTRZYMALOSC: 'Wytrzymalosc',
    ODPORNOSC: 'Odpornosc na stres',
  };

  var BUILDING_BY_KIND = {
    physical: 'Silownia',
    psychological: 'Gabinet psychologa',
    technical: 'Gabinet doradcow trenera',
  };

  var MAIN_COACH_ATTRIBUTE_BY_KIND = {
    physical: 'Trening fizyczny',
    psychological: 'Psychologia',
    technical: 'Trening techniczny',
  };

  function normalizeText(value) {
    return String(value || '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&euro;/gi, 'EUR')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#039;/gi, "'")
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeKey(value) {
    return normalizeText(value)
      .toLowerCase()
      .replace(/ł/g, 'l')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseNumber(value) {
    var match = String(value || '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
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

  function parseSkillOptionsFromHtml(html) {
    var result = {};
    var selectMatch = String(html || '').match(/id=['"]?trening_type_senior['"]?[\s\S]*?<\/SELECT>/i);
    var source = selectMatch ? selectMatch[0] : String(html || '');
    var regex = /<OPTION\b[^>]*value=['"]?(UM_[A-Z0-9_]+)['"]?[^>]*>([^<]*)/gi;
    var match;

    while ((match = regex.exec(source)) !== null) {
      result[match[1]] = normalizeText(match[2]);
    }

    return result;
  }

  function parseSelectedTrainingCode(html) {
    var spanMatch = String(html || '').match(/id=['"]span_last_trening['"][^>]*>([^<]+)/i);
    var selectedOptionMatch;

    if (spanMatch) {
      return normalizeText(spanMatch[1]);
    }

    selectedOptionMatch = String(html || '').match(/<OPTION\b[^>]*value=['"]?(UM_[A-Z0-9_]+)['"]?[^>]*selected[^>]*>/i);
    return selectedOptionMatch ? selectedOptionMatch[1] : '';
  }

  function getTrainingKindForSkill(skillCode) {
    if (skillCode === 'WYTRZYMALOSC' || skillCode === 'UM_SILA_SERWISU') {
      return 'physical';
    }
    if (skillCode === 'ODPORNOSC') {
      return 'psychological';
    }
    if (TECHNICAL_SKILL_CODES[skillCode]) {
      return 'technical';
    }
    return '';
  }

  function parsePoolFromHtml(html) {
    var match = String(html || '').match(/Punkty treningowe:\s*(\d+)\s*\/\s*(\d+)/i);
    if (!match) {
      return null;
    }
    return {
      current: Number(match[1]),
      max: Number(match[2]),
    };
  }

  function parseAttributesFromRowHtml(rowHtml) {
    var result = {};
    var regex = /(?:name|id)=\\?['"]span_player_value_(UM_[A-Z0-9_]+)\\?['"][^>]*>([\s\S]*?)(?=<span\b|<\/td>|<\/tr>)/gi;
    var match;
    var value;

    while ((match = regex.exec(String(rowHtml || ''))) !== null) {
      value = parseNumber(match[2]);
      if (value !== null && !Number.isNaN(value)) {
        result[match[1]] = value;
      }
    }

    return result;
  }

  function parseSpecialOptionValue(rowHtml, optionValue) {
    var regex = new RegExp(
      "<input[^>]+name=[\\'\"]?" + SENIOR_INPUT_PREFIX + "\\d+[\\'\"]?[^>]+value=[\\'\"]?" + optionValue + "[\\'\"]?[^>]*>[\\s\\S]*?<\\/td><td[^>]*>([\\s\\S]*?)<\\/td>",
      'i'
    );
    var match = String(rowHtml || '').match(regex);

    return match ? parseNumber(match[1]) : null;
  }

  function parseCheckedOption(rowHtml, playerId) {
    var source = String(rowHtml || '');
    var regexes = [
      new RegExp("<input[^>]+checked[^>]+name=[\\'\"]?" + SENIOR_INPUT_PREFIX + playerId + "[\\'\"]?[^>]+value=[\\'\"]?([^\\'\">\\s]+)", 'i'),
      new RegExp("<input[^>]+name=[\\'\"]?" + SENIOR_INPUT_PREFIX + playerId + "[\\'\"]?[^>]+checked[^>]+value=[\\'\"]?([^\\'\">\\s]+)", 'i'),
      new RegExp("<input[^>]+name=[\\'\"]?" + SENIOR_INPUT_PREFIX + playerId + "[\\'\"]?[^>]+value=[\\'\"]?([^\\'\">\\s]+)[\\'\"]?[^>]+checked", 'i'),
    ];
    var i;
    var match;

    for (i = 0; i < regexes.length; i += 1) {
      match = source.match(regexes[i]);
      if (match) {
        return match[1];
      }
    }

    return '';
  }

  function parsePlayerFromRowHtml(rowHtml, selectedTrainingCode, skillOptions) {
    var source = String(rowHtml || '');
    var idMatch = source.match(/Player(?:&|&amp;)playerId=(\d+)/);
    var nameMatch = source.match(/<span class=['"]small_link['"][\s\S]*?<b>([^<]+)<\/b>,\s*([^<(]+)(?:\((\d{1,2})\s*lat,\s*(\d+)\s*cm\))?/i);
    var positionMatch = source.match(/<font class=green>([^<]+)<\/font>/i);
    var barMatch = source.match(/&nbsp;\s*(\d+)\s*%/i);
    var playerId = idMatch ? idMatch[1] : '';
    var selectedOption;
    var trainedSkillCode;
    var meta;
    var attributes;
    var trainingKind;

    if (!playerId) {
      return null;
    }

    selectedOption = parseCheckedOption(source, playerId);
    meta = TRAINING_OPTION_META[selectedOption] || { cost: 0 };
    trainedSkillCode = selectedOption === 'wybrany' ? selectedTrainingCode : (meta.skillCode || '');
    attributes = parseAttributesFromRowHtml(source);
    trainingKind = getTrainingKindForSkill(trainedSkillCode);

    return {
      playerId: playerId,
      playerName: nameMatch ? normalizeText(nameMatch[1] + ', ' + nameMatch[2]) : '',
      age: nameMatch && nameMatch[3] ? Number(nameMatch[3]) : null,
      height: nameMatch && nameMatch[4] ? Number(nameMatch[4]) : null,
      position: positionMatch ? normalizeText(positionMatch[1]) : '',
      bar: barMatch ? Number(barMatch[1]) : null,
      selectedOption: selectedOption,
      trainingCost: meta.cost || 0,
      trainedSkillCode: trainedSkillCode,
      trainedSkillLabel: SKILL_LABELS[trainedSkillCode] || skillOptions[trainedSkillCode] || trainedSkillCode,
      trainingKind: trainingKind,
      trainedLevel: getTrainedLevel(selectedOption, trainedSkillCode, source, attributes),
      attributes: attributes,
    };
  }

  function getTrainedLevel(selectedOption, trainedSkillCode, rowHtml, attributes) {
    if (!selectedOption || selectedOption === 'nietrenuj') {
      return null;
    }

    if (selectedOption === 'wybrany') {
      return attributes[trainedSkillCode] == null ? null : attributes[trainedSkillCode];
    }

    if (selectedOption === 'wytrz') {
      return parseSpecialOptionValue(rowHtml, 'wytrz');
    }

    if (selectedOption === 'odp') {
      return parseSpecialOptionValue(rowHtml, 'odp');
    }

    return null;
  }

  function parseSeniorTrainingSnapshotFromHtml(html) {
    var source = String(html || '');
    var skillOptions = parseSkillOptionsFromHtml(source);
    var selectedTrainingCode = parseSelectedTrainingCode(source);
    var rowRegex = /<tr\b[^>]*>\s*<td\b[^>]*class=["']second_left_right["'][^>]*>[\s\S]*?Player(?:&|&amp;)playerId=(\d+)[\s\S]*?<\/tr>\s*<tr\b[^>]*>\s*<td\b[^>]*class=["']second_bottom_left["'][^>]*>/gi;
    var players = [];
    var seen = {};
    var match;
    var player;

    while ((match = rowRegex.exec(source)) !== null) {
      if (seen[match[1]] || match[0].indexOf(SENIOR_INPUT_PREFIX + match[1]) < 0) {
        continue;
      }
      player = parsePlayerFromRowHtml(match[0], selectedTrainingCode, skillOptions);
      if (player) {
        seen[player.playerId] = true;
        players.push(player);
      }
    }

    return {
      formId: SENIOR_FORM_ID,
      selectedTrainingCode: selectedTrainingCode,
      selectedTrainingLabel: SKILL_LABELS[selectedTrainingCode] || skillOptions[selectedTrainingCode] || selectedTrainingCode,
      pool: parsePoolFromHtml(source),
      players: players,
    };
  }

  function parseSeniorTrainingSnapshotFromRoot(root) {
    var scope = root && root.querySelectorAll ? root : null;
    var select;
    var selectedTrainingCode;
    var skillOptions = {};
    var players = [];
    var seen = {};
    var inputs;
    var pool;

    if (!scope) {
      return null;
    }

    select = scope.querySelector('#' + SENIOR_SELECT_ID);
    selectedTrainingCode = select ? select.value : parseSelectedTrainingCode(scope.innerHTML || '');

    if (select) {
      Array.prototype.slice.call(select.options || []).forEach(function (option) {
        skillOptions[option.value] = normalizeText(option.textContent || option.innerText || '');
      });
    } else {
      skillOptions = parseSkillOptionsFromHtml(scope.innerHTML || '');
    }

    inputs = Array.prototype.slice.call(scope.querySelectorAll('input[type="radio"][name^="' + SENIOR_INPUT_PREFIX + '"]'));
    inputs.forEach(function (input) {
      var playerId = parsePlayerIdFromInputName(input.name);
      var row;
      var player;

      if (!playerId || seen[playerId]) {
        return;
      }

      row = input.closest ? input.closest('tr') : null;
      if (!row) {
        return;
      }

      player = parsePlayerFromRowElement(row, playerId, selectedTrainingCode, skillOptions);
      if (player) {
        seen[playerId] = true;
        players.push(player);
      }
    });

    pool = parsePoolFromText(scope.textContent || '');

    return {
      formId: SENIOR_FORM_ID,
      selectedTrainingCode: selectedTrainingCode,
      selectedTrainingLabel: SKILL_LABELS[selectedTrainingCode] || skillOptions[selectedTrainingCode] || selectedTrainingCode,
      pool: pool,
      players: players,
    };
  }

  function parsePlayerIdFromInputName(name) {
    var match = String(name || '').match(new RegExp('^' + SENIOR_INPUT_PREFIX + '(\\d+)$'));
    return match ? match[1] : '';
  }

  function parsePoolFromText(text) {
    var match = String(text || '').match(/Punkty treningowe:\s*(\d+)\s*\/\s*(\d+)/i);
    if (!match) {
      return null;
    }
    return {
      current: Number(match[1]),
      max: Number(match[2]),
    };
  }

  function parsePlayerFromRowElement(row, playerId, selectedTrainingCode, skillOptions) {
    var source = row.outerHTML || '';
    var base = parsePlayerFromRowHtml(source, selectedTrainingCode, skillOptions);
    var selectedInput = row.querySelector('input[type="radio"][name="' + SENIOR_INPUT_PREFIX + playerId + '"]:checked');
    var selectedOption;
    var meta;
    var trainedSkillCode;

    if (!base) {
      return null;
    }

    selectedOption = selectedInput ? selectedInput.value : base.selectedOption;
    meta = TRAINING_OPTION_META[selectedOption] || { cost: 0 };
    trainedSkillCode = selectedOption === 'wybrany' ? selectedTrainingCode : (meta.skillCode || '');

    base.selectedOption = selectedOption;
    base.trainingCost = meta.cost || 0;
    base.trainedSkillCode = trainedSkillCode;
    base.trainedSkillLabel = SKILL_LABELS[trainedSkillCode] || skillOptions[trainedSkillCode] || trainedSkillCode;
    base.trainingKind = getTrainingKindForSkill(trainedSkillCode);
    base.trainedLevel = getTrainedLevelFromRowElement(row, selectedOption, trainedSkillCode, base.attributes);

    return base;
  }

  function getTrainedLevelFromRowElement(row, selectedOption, trainedSkillCode, attributes) {
    var selectedInput;
    var valueCell;

    if (!selectedOption || selectedOption === 'nietrenuj') {
      return null;
    }

    if (selectedOption === 'wybrany') {
      return attributes && attributes[trainedSkillCode] != null ? attributes[trainedSkillCode] : null;
    }

    selectedInput = row.querySelector('input[type="radio"][value="' + selectedOption + '"]');
    valueCell = selectedInput && selectedInput.closest && selectedInput.closest('td')
      ? selectedInput.closest('td').nextElementSibling
      : null;

    return valueCell ? parseNumber(valueCell.textContent || valueCell.innerText || '') : null;
  }

  function parseLastTrainingEffectsFromHtml(html) {
    var source = String(html || '');
    var beforePool = source.split(/Punkty treningowe:/i)[0];
    var regex = /Player(?:&|&amp;)playerId=(\d+)[\s\S]*?<b>([^<]+)<\/b>,\s*([^<]+)<\/span><\/td><td[^>]*align=["']right["']>([\s\S]*?)<\/td><td[^>]*align=["']right["']>(\d+)<\/td>/g;
    var result = [];
    var match;

    if (!/Efekt ostatniego treningu/i.test(source)) {
      return result;
    }

    while ((match = regex.exec(beforePool)) !== null) {
      result.push({
        playerId: match[1],
        playerName: normalizeText(match[2] + ', ' + match[3]),
        skillLabel: normalizeText(match[4]),
        levelAfter: Number(match[5]),
      });
    }

    return result;
  }

  function pairTrainingSnapshots(beforeSnapshot, afterSnapshot, context) {
    var afterById = {};
    var effects = {};
    var sessionId;
    var records;

    (afterSnapshot.players || []).forEach(function (player) {
      afterById[player.playerId] = player;
    });

    (context && context.lastEffects || []).forEach(function (effect) {
      effects[effect.playerId + '|' + normalizeKey(effect.skillLabel)] = effect;
    });

    sessionId = createSessionId(beforeSnapshot, afterSnapshot, context);
    records = (beforeSnapshot.players || []).map(function (beforePlayer) {
      var afterPlayer = afterById[beforePlayer.playerId] || null;
      var afterLevel = getAfterLevel(beforePlayer, afterPlayer);
      var delta = beforePlayer.trainedLevel !== null && afterLevel !== null
        ? roundLevel(afterLevel - beforePlayer.trainedLevel)
        : null;
      var effect = effects[beforePlayer.playerId + '|' + normalizeKey(beforePlayer.trainedSkillLabel)];

      return {
        sessionId: sessionId,
        playerId: beforePlayer.playerId,
        playerName: beforePlayer.playerName,
        age: beforePlayer.age,
        height: beforePlayer.height,
        position: beforePlayer.position,
        selectedOption: beforePlayer.selectedOption,
        trainingCost: beforePlayer.trainingCost,
        trainedSkillCode: beforePlayer.trainedSkillCode,
        trainedSkillLabel: beforePlayer.trainedSkillLabel,
        trainingKind: beforePlayer.trainingKind,
        barBefore: beforePlayer.bar,
        barAfter: afterPlayer ? afterPlayer.bar : null,
        levelBefore: beforePlayer.trainedLevel,
        levelAfter: afterLevel,
        delta: delta,
        effectJumpReported: Boolean(effect),
        effectLevelAfter: effect ? effect.levelAfter : null,
      };
    });

    return {
      id: sessionId,
      capturedAt: context && context.capturedAt ? context.capturedAt : new Date().toISOString(),
      selectedTrainingCode: beforeSnapshot.selectedTrainingCode,
      selectedTrainingLabel: beforeSnapshot.selectedTrainingLabel,
      poolBefore: beforeSnapshot.pool,
      poolAfter: afterSnapshot.pool,
      efficiency: context && context.efficiency ? context.efficiency : null,
      coaches: context && context.coaches ? context.coaches : null,
      infrastructure: context && context.infrastructure ? context.infrastructure : null,
      records: records,
    };
  }

  function getAfterLevel(beforePlayer, afterPlayer) {
    if (!afterPlayer || !beforePlayer.trainedSkillCode || beforePlayer.selectedOption === 'nietrenuj') {
      return null;
    }

    if (beforePlayer.selectedOption === 'wybrany') {
      return afterPlayer.attributes && afterPlayer.attributes[beforePlayer.trainedSkillCode] != null
        ? afterPlayer.attributes[beforePlayer.trainedSkillCode]
        : null;
    }

    return afterPlayer.trainedLevel;
  }

  function roundLevel(value) {
    if (value === null || Number.isNaN(Number(value))) {
      return null;
    }
    return Math.round(Number(value) * 10) / 10;
  }

  function createSessionId(beforeSnapshot, afterSnapshot, context) {
    var base = [
      context && context.capturedAt ? context.capturedAt : new Date().toISOString(),
      beforeSnapshot.selectedTrainingCode,
      beforeSnapshot.players ? beforeSnapshot.players.length : 0,
      afterSnapshot.pool ? afterSnapshot.pool.current : '',
    ].join('|');

    return 'vth-' + hashString(base);
  }

  function hashString(value) {
    var hash = 0;
    var source = String(value || '');
    var i;

    for (i = 0; i < source.length; i += 1) {
      hash = ((hash << 5) - hash) + source.charCodeAt(i);
      hash |= 0;
    }

    return Math.abs(hash).toString(36);
  }

  function parseCoachesFromHtml(html) {
    var source = String(html || '');
    var regex = />(I trener|II trener|Trener juniorów|Trener juniorĂłw)<[\s\S]*?<b>([^<]+)<\/b>[\s\S]*?<TABLE width='684'([\s\S]*?)<\/TABLE>/g;
    var result = [];
    var match;

    while ((match = regex.exec(source)) !== null) {
      result.push({
        role: normalizeCoachRole(match[1]),
        name: normalizeText(match[2]),
        attributes: parseCoachAttributes(match[3]),
      });
    }

    return result;
  }

  function normalizeCoachRole(role) {
    var key = normalizeKey(role);
    if (key === 'i trener') {
      return 'head';
    }
    if (key === 'ii trener') {
      return 'assistant';
    }
    if (key === 'trener juniorow') {
      return 'junior';
    }
    return key;
  }

  function parseCoachAttributes(html) {
    var source = String(html || '');
    var regex = /<TD[^>]*>(?:<b>)?([^<]+?)(?:<\/b>)?<\/TD><TD[^>]*align='right'[^>]*>(?:<b>)?(\d+)/g;
    var result = {};
    var match;
    var label;

    while ((match = regex.exec(source)) !== null) {
      label = normalizeCoachAttributeLabel(match[1]);
      if (label) {
        result[label] = Number(match[2]);
      }
    }

    return result;
  }

  function normalizeCoachAttributeLabel(label) {
    var key = normalizeKey(label);
    if (key === 'trening fizyczny') {
      return 'Trening fizyczny';
    }
    if (key === 'trening techniczny') {
      return 'Trening techniczny';
    }
    if (key === 'psychologia' || key === 'trening psychiczny') {
      return 'Psychologia';
    }
    if (key === 'zdolnosci adaptacyjne') {
      return 'Zdolnosci adaptacyjne';
    }
    if (key === 'poziom dyscypliny') {
      return 'Poziom dyscypliny';
    }
    if (key === 'praca z juniorami') {
      return 'Praca z juniorami';
    }
    if (key === 'motywowanie') {
      return 'Motywowanie';
    }
    return '';
  }

  function parseInfrastructureFromHtml(html) {
    var source = String(html || '');
    var regex = /<td class=["']second["'] width=["']250["'] align=["']left["']>([^<]+?)\s*\(Poziom:\s*(\d+)\)/g;
    var result = {};
    var match;
    var name;

    while ((match = regex.exec(source)) !== null) {
      name = normalizeBuildingName(match[1]);
      if (name) {
        result[name] = Number(match[2]);
      }
    }

    return result;
  }

  function normalizeBuildingName(name) {
    var key = normalizeKey(name);
    if (key === 'gabinet doradcow trenera') {
      return 'Gabinet doradcow trenera';
    }
    if (key === 'hala treningowa') {
      return 'Hala treningowa';
    }
    if (key === 'gabinet psychologa') {
      return 'Gabinet psychologa';
    }
    if (key === 'silownia') {
      return 'Silownia';
    }
    if (key === 'gabinet lekarza') {
      return 'Gabinet lekarza';
    }
    if (key === 'sklep') {
      return 'Sklep';
    }
    return normalizeText(name);
  }

  function calculateCoachTrainingScore(coaches, trainingKind) {
    var head = findCoach(coaches, 'head');
    var assistant = findCoach(coaches, 'assistant');
    var headScore = calculateSingleCoachScore(head, trainingKind);
    var assistantScore = calculateSingleCoachScore(assistant, trainingKind);

    if (headScore === null && assistantScore === null) {
      return null;
    }

    return {
      headCoachScore: headScore,
      assistantCoachScore: assistantScore,
      weightedCoachScore: ((headScore || 0) * 2 / 3) + ((assistantScore || 0) / 3),
      maxCoachScore: MAX_COACH_ATTRIBUTE,
    };
  }

  function findCoach(coaches, role) {
    return (coaches || []).find(function (coach) {
      return coach.role === role;
    }) || null;
  }

  function calculateSingleCoachScore(coach, trainingKind) {
    var attributes = coach && coach.attributes ? coach.attributes : null;
    var mainAttribute = MAIN_COACH_ATTRIBUTE_BY_KIND[trainingKind];

    if (!attributes || !mainAttribute) {
      return null;
    }

    return (Number(attributes[mainAttribute] || 0) * 0.6)
      + (Number(attributes['Poziom dyscypliny'] || 0) * 0.2)
      + (Number(attributes['Zdolnosci adaptacyjne'] || 0) * 0.2);
  }

  function calculateInfrastructureMultiplier(infrastructure, trainingKind) {
    var levels = infrastructure || {};
    var kindBuilding = BUILDING_BY_KIND[trainingKind];
    var hallLevel = Number(levels['Hala treningowa'] || 0);
    var kindLevel = kindBuilding ? Number(levels[kindBuilding] || 0) : 0;
    var totalBonus = hallLevel + kindLevel;

    return {
      hallLevel: hallLevel,
      kindBuilding: kindBuilding || '',
      kindBuildingLevel: kindLevel,
      totalBonusPercent: totalBonus,
      multiplier: 1 + (totalBonus / 100),
      maxBonusPercent: MAX_SENIOR_INFRASTRUCTURE_BONUS,
    };
  }

  function calculateSeniorEfficiency(coaches, infrastructure, trainingKind) {
    var coachScore = calculateCoachTrainingScore(coaches, trainingKind);
    var infrastructureScore = calculateInfrastructureMultiplier(infrastructure, trainingKind);
    var coachComponent;
    var rawTrainingMultiplier;
    var normalizedEfficiency;

    if (!coachScore) {
      return null;
    }

    coachComponent = coachScore.weightedCoachScore / MAX_COACH_ATTRIBUTE;
    rawTrainingMultiplier = coachComponent * infrastructureScore.multiplier;
    normalizedEfficiency = rawTrainingMultiplier / (1 + (MAX_SENIOR_INFRASTRUCTURE_BONUS / 100));

    return {
      trainingKind: trainingKind,
      coachComponent: coachComponent,
      rawTrainingMultiplier: rawTrainingMultiplier,
      normalizedEfficiency: normalizedEfficiency,
      coachScore: coachScore,
      infrastructure: infrastructureScore,
    };
  }

  function flattenSessionToRecords(session) {
    return (session.records || []).map(function (record) {
      var efficiency = session.efficiency || {};
      var coachScore = efficiency.coachScore || {};
      var infrastructure = efficiency.infrastructure || {};

      return {
        session_id: session.id,
        captured_at: session.capturedAt,
        selected_training_code: session.selectedTrainingCode,
        selected_training_label: session.selectedTrainingLabel,
        player_id: record.playerId,
        player_name: record.playerName,
        age: record.age,
        height: record.height,
        position: record.position,
        selected_option: record.selectedOption,
        training_cost: record.trainingCost,
        trained_skill_code: record.trainedSkillCode,
        trained_skill_label: record.trainedSkillLabel,
        training_kind: record.trainingKind,
        bar_before: record.barBefore,
        bar_after: record.barAfter,
        level_before: record.levelBefore,
        level_after: record.levelAfter,
        delta: record.delta,
        effect_jump_reported: record.effectJumpReported,
        raw_training_multiplier: efficiency.rawTrainingMultiplier,
        normalized_efficiency: efficiency.normalizedEfficiency,
        coach_component: efficiency.coachComponent,
        coach_weighted_score: coachScore.weightedCoachScore,
        infrastructure_multiplier: infrastructure.multiplier,
        infrastructure_bonus_percent: infrastructure.totalBonusPercent,
      };
    });
  }

  function toCsv(rows) {
    var columns;

    if (!rows || !rows.length) {
      return '';
    }

    columns = Object.keys(rows[0]);
    return [columns.join(',')].concat(rows.map(function (row) {
      return columns.map(function (column) {
        return csvCell(row[column]);
      }).join(',');
    })).join('\n');
  }

  function csvCell(value) {
    var text = value == null ? '' : String(value);

    if (/[",\n\r]/.test(text)) {
      return '"' + text.replace(/"/g, '""') + '"';
    }

    return text;
  }

  return {
    VERSION: VERSION,
    SENIOR_FORM_ID: SENIOR_FORM_ID,
    SENIOR_SELECT_ID: SENIOR_SELECT_ID,
    SENIOR_INPUT_PREFIX: SENIOR_INPUT_PREFIX,
    SKILL_LABELS: SKILL_LABELS,
    BUILDING_BY_KIND: BUILDING_BY_KIND,
    parseAjaxVmBody: parseAjaxVmBody,
    parseSeniorTrainingSnapshotFromHtml: parseSeniorTrainingSnapshotFromHtml,
    parseSeniorTrainingSnapshotFromRoot: parseSeniorTrainingSnapshotFromRoot,
    parseLastTrainingEffectsFromHtml: parseLastTrainingEffectsFromHtml,
    pairTrainingSnapshots: pairTrainingSnapshots,
    parseCoachesFromHtml: parseCoachesFromHtml,
    parseInfrastructureFromHtml: parseInfrastructureFromHtml,
    calculateSeniorEfficiency: calculateSeniorEfficiency,
    flattenSessionToRecords: flattenSessionToRecords,
    toCsv: toCsv,
    getTrainingKindForSkill: getTrainingKindForSkill,
  };
}));
