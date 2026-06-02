// ==UserScript==
// @name         VM Profile View Enhancer
// @namespace    https://vm-manager.org/
// @version      0.1.2
// @description  Enhances VM Manager player profile attributes with position-aware markers and summary.
// @match        *://*.vm-manager.org/*
// @grant        none
// @run-at       document-end
// @updateURL    https://github.com/kubas33/vm-profile-view-enhancer/raw/refs/heads/main/vm-profile-view-enhancer.user.js
// @downloadURL  https://github.com/kubas33/vm-profile-view-enhancer/raw/refs/heads/main/vm-profile-view-enhancer.user.js
// ==/UserScript==

(function () {
  'use strict';

  var MAX_ATTRIBUTE = 50.5;
  var STYLE_ID = 'vmp-style';
  var PANEL_CLASS = 'vmp-panel';
  var ICON_CLASS = 'vmp-marker';
  var ENHANCED_ATTR = 'data-vmp-enhanced';
  var SIGNATURE_ATTR = 'data-vmp-signature';

  var ATTRIBUTE_NAMES = [
    'Serwis',
    'Siła serwisu',
    'Atak ze skrzydła',
    'Atak ze środka',
    'Kiwka',
    'Atak z 2 linii',
    'Omijanie bloku',
    'Atak blok-aut',
    'Rozgrywanie',
    'Wystawa',
    'Przyjęcie',
    'Obrona',
    'Asekuracja',
    'Ustawianie się do bloku',
    'Blok',
    'Blok pasywny',
    'Odporność na stres',
    'Wytrzymałość'
  ];

  var SPECIAL_SCALE_ATTRIBUTES = makeSet(['Odporność na stres', 'Wytrzymałość']);

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

  var ATTRIBUTE_SET = makeSet(ATTRIBUTE_NAMES);
  var scheduleTimer = null;

  function makeSet(items) {
    return items.reduce(function (result, item) {
      result[item] = true;
      return result;
    }, {});
  }

  function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function parseAttributeValue(value) {
    var normalized = normalizeText(value).replace(',', '.');
    var match = normalized.match(/-?\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : null;
  }

  function getGradeClass(value) {
    if (value <= 9.9) {
      return 'vmp-grade-very-weak';
    }
    if (value <= 20.5) {
      return 'vmp-grade-weak';
    }
    if (value <= 30.5) {
      return 'vmp-grade-solid';
    }
    if (value <= 40.5) {
      return 'vmp-grade-good';
    }
    if (value <= 47.5) {
      return 'vmp-grade-very-good';
    }
    return 'vmp-grade-elite';
  }

  function getSpecialGradeClass(value) {
    if (value < 20) {
      return 'vmp-special-low';
    }
    if (value < 35) {
      return 'vmp-special-medium';
    }
    if (value < 45) {
      return 'vmp-special-high';
    }
    return 'vmp-special-elite';
  }

  function getAttributeGradeClass(attribute) {
    if (SPECIAL_SCALE_ATTRIBUTES[attribute.name]) {
      return getSpecialGradeClass(attribute.value);
    }

    return getGradeClass(attribute.value);
  }

  function injectStyles() {
    var style;

    if (document.getElementById(STYLE_ID)) {
      return;
    }

    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = [
      '.vmp-panel {',
      '  margin: 0 0 8px 0;',
      '  padding: 7px 9px;',
      '  border: 1px solid rgba(85, 170, 220, 0.35);',
      '  background: rgba(7, 31, 48, 0.72);',
      '  color: #d7edf8;',
      '  font-size: 11px;',
      '  line-height: 1.35;',
      '  box-sizing: border-box;',
      '}',
      '.vmp-panel-title {',
      '  color: #ffe36a;',
      '  font-weight: bold;',
      '  margin-right: 8px;',
      '}',
      '.vmp-panel-grid {',
      '  display: flex;',
      '  align-items: center;',
      '  justify-content: space-between;',
      '  gap: 8px;',
      '}',
      '.vmp-panel-item {',
      '  flex: 1 1 0;',
      '  min-width: 0;',
      '  white-space: nowrap;',
      '}',
      '.vmp-panel-item:nth-child(2) {',
      '  text-align: center;',
      '}',
      '.vmp-panel-item:nth-child(3) {',
      '  text-align: right;',
      '}',
      '.vmp-panel-label {',
      '  color: #9fb8c7;',
      '  margin-right: 3px;',
      '}',
      '.vmp-panel-value {',
      '  color: #ffffff;',
      '  font-weight: bold;',
      '}',
      '.vmp-row-primary td {',
      '  background: rgba(255, 214, 74, 0.16);',
      '}',
      '.vmp-row-secondary td {',
      '  background: rgba(99, 183, 255, 0.10);',
      '}',
      '.vmp-row-other td {',
      '  opacity: 0.76;',
      '}',
      '.vmp-marker {',
      '  display: inline-block;',
      '  width: 12px;',
      '  margin-right: 3px;',
      '  text-align: center;',
      '  font-weight: bold;',
      '}',
      '.vmp-marker-primary {',
      '  color: #ffe36a;',
      '}',
      '.vmp-marker-secondary {',
      '  color: #8fd0ff;',
      '}',
      '.vmp-marker-placeholder {',
      '  visibility: hidden;',
      '}',
      '.vmp-value {',
      '  font-weight: bold;',
      '}',
      '.vmp-grade-very-weak, .vmp-grade-very-weak span, .vmp-grade-very-weak .link { color: #8f9ba3 !important; }',
      '.vmp-grade-weak, .vmp-grade-weak span, .vmp-grade-weak .link { color: #d98b61 !important; }',
      '.vmp-grade-solid, .vmp-grade-solid span, .vmp-grade-solid .link { color: #ffd45c !important; }',
      '.vmp-grade-good, .vmp-grade-good span, .vmp-grade-good .link { color: #73d87a !important; }',
      '.vmp-grade-very-good, .vmp-grade-very-good span, .vmp-grade-very-good .link { color: #4bd6d6 !important; }',
      '.vmp-grade-elite, .vmp-grade-elite span, .vmp-grade-elite .link { color: #ff76d6 !important; }',
      '.vmp-special-low, .vmp-special-low span, .vmp-special-low .link { color: #d98b61 !important; }',
      '.vmp-special-medium, .vmp-special-medium span, .vmp-special-medium .link { color: #ffd45c !important; }',
      '.vmp-special-high, .vmp-special-high span, .vmp-special-high .link { color: #73d87a !important; }',
      '.vmp-special-elite, .vmp-special-elite span, .vmp-special-elite .link { color: #ff76d6 !important; }',
      '@media (max-width: 760px) {',
      '  .vmp-panel-grid { gap: 5px; }',
      '  .vmp-panel-item { font-size: 10px; }',
      '}'
    ].join('\n');
    document.head.appendChild(style);
  }

  function findPosition(container) {
    var rows = Array.prototype.slice.call(container.querySelectorAll('tr'));
    var i;
    var cells;
    var label;

    for (i = 0; i < rows.length; i += 1) {
      cells = Array.prototype.slice.call(rows[i].children);
      label = cells.length >= 1 ? normalizeText(cells[0].textContent).replace(/^[★•]\s*/, '') : '';
      if (cells.length >= 2 && label === 'Pozycja') {
        return normalizeText(cells[1].textContent);
      }
    }

    return '';
  }

  function collectAttributeRows(container) {
    var rows = Array.prototype.slice.call(container.querySelectorAll('tr'));
    var result = [];

    rows.forEach(function (row) {
      var cells = Array.prototype.slice.call(row.children);
      var nameCell;
      var valueCell;
      var name;
      var value;

      if (cells.length < 3) {
        return;
      }

      nameCell = cells[1];
      valueCell = cells[2];
      name = normalizeText(nameCell.textContent).replace(/^[★•]\s*/, '');

      if (!ATTRIBUTE_SET[name]) {
        return;
      }

      value = parseAttributeValue(valueCell.textContent);
      if (value === null || Number.isNaN(value)) {
        return;
      }

      result.push({
        row: row,
        nameCell: nameCell,
        valueCell: valueCell,
        name: name,
        value: value
      });
    });

    return result;
  }

  function findProfileContainers() {
    var candidates = Array.prototype.slice.call(document.querySelectorAll('td.second[width="684"], td.second'));

    return candidates.filter(function (candidate) {
      var position = findPosition(candidate);
      var attributes = collectAttributeRows(candidate);

      return Boolean(position && attributes.length >= 8);
    });
  }

  function getImportance(position, name) {
    var rules = POSITION_RULES[position];

    if (!rules) {
      return 'none';
    }

    if (rules.primary.indexOf(name) !== -1) {
      return 'primary';
    }

    if (rules.secondary.indexOf(name) !== -1) {
      return 'secondary';
    }

    return 'none';
  }

  function resetEnhancements(container) {
    var markers = Array.prototype.slice.call(container.querySelectorAll('.' + ICON_CLASS));
    var panelRows = Array.prototype.slice.call(container.querySelectorAll('.vmp-panel-row'));
    var panels = Array.prototype.slice.call(container.querySelectorAll('.' + PANEL_CLASS));
    var enhancedRows = Array.prototype.slice.call(container.querySelectorAll('.vmp-row-primary, .vmp-row-secondary, .vmp-row-other'));
    var enhancedValues = Array.prototype.slice.call(container.querySelectorAll('.vmp-value'));
    var gradeClasses = [
      'vmp-grade-very-weak',
      'vmp-grade-weak',
      'vmp-grade-solid',
      'vmp-grade-good',
      'vmp-grade-very-good',
      'vmp-grade-elite',
      'vmp-special-low',
      'vmp-special-medium',
      'vmp-special-high',
      'vmp-special-elite'
    ];

    markers.forEach(function (marker) {
      marker.remove();
    });

    panelRows.forEach(function (row) {
      row.remove();
    });

    panels.forEach(function (panel) {
      panel.remove();
    });

    enhancedRows.forEach(function (row) {
      row.classList.remove('vmp-row-primary', 'vmp-row-secondary', 'vmp-row-other');
    });

    enhancedValues.forEach(function (cell) {
      cell.classList.remove.apply(cell.classList, ['vmp-value'].concat(gradeClasses));
    });

    container.removeAttribute(ENHANCED_ATTR);
    container.removeAttribute(SIGNATURE_ATTR);
  }

  function createSignature(position, attributes) {
    return [
      position,
      attributes.map(function (attribute) {
        return attribute.name + '=' + attribute.value;
      }).join('|')
    ].join('::');
  }

  function addMarker(nameCell, importance) {
    var marker;

    marker = document.createElement('span');
    marker.className = ICON_CLASS;
    if (importance === 'primary') {
      marker.className += ' vmp-marker-primary';
      marker.textContent = '★';
    } else if (importance === 'secondary') {
      marker.className += ' vmp-marker-secondary';
      marker.textContent = '•';
    } else {
      marker.className += ' vmp-marker-placeholder';
      marker.textContent = '•';
    }
    marker.setAttribute('aria-hidden', 'true');
    nameCell.insertBefore(marker, nameCell.firstChild);
  }

  function formatAverage(value) {
    return value === null ? '—' : value.toFixed(1);
  }

  function calculateSummary(position, attributes) {
    var primary = [];
    var secondary = [];
    var weightedSum = 0;
    var weightTotal = 0;

    attributes.forEach(function (attribute) {
      var importance = getImportance(position, attribute.name);
      var weight = 0;

      if (importance === 'primary') {
        primary.push(attribute.value);
        weight = 1;
      } else if (importance === 'secondary') {
        secondary.push(attribute.value);
        weight = 0.5;
      }

      if (weight > 0) {
        weightedSum += attribute.value * weight;
        weightTotal += weight;
      }
    });

    return {
      primaryAverage: average(primary),
      secondaryAverage: average(secondary),
      fit: weightTotal > 0 ? (weightedSum / (MAX_ATTRIBUTE * weightTotal)) * 100 : null
    };
  }

  function average(values) {
    if (!values.length) {
      return null;
    }

    return values.reduce(function (sum, value) {
      return sum + value;
    }, 0) / values.length;
  }

  function createMetric(label, value) {
    var item = document.createElement('span');
    var labelNode = document.createElement('span');
    var valueNode = document.createElement('span');

    item.className = 'vmp-panel-item';
    labelNode.className = 'vmp-panel-label';
    valueNode.className = 'vmp-panel-value';
    labelNode.textContent = label + ':';
    valueNode.textContent = value;
    item.appendChild(labelNode);
    item.appendChild(valueNode);

    return item;
  }

  function createPanel(position, summary) {
    var panel = document.createElement('div');
    var title = document.createElement('span');
    var grid = document.createElement('div');

    panel.className = PANEL_CLASS;
    title.className = 'vmp-panel-title';
    title.textContent = 'VM+';
    grid.className = 'vmp-panel-grid';

    // grid.appendChild(createMetric('Pozycja', position || '—'));
    grid.appendChild(createMetric('Kluczowe śr.', formatAverage(summary.primaryAverage)));
    grid.appendChild(createMetric('Drugorzędne śr.', formatAverage(summary.secondaryAverage)));
    grid.appendChild(createMetric('Dopasowanie', summary.fit === null ? '—' : summary.fit.toFixed(1) + '%'));

    // panel.appendChild(title);
    panel.appendChild(grid);

    return panel;
  }

  function findPanelAnchor(container, attributes) {
    var firstRow = attributes.length ? attributes[0].row : null;
    var table = firstRow ? firstRow.closest('table') : null;
    var attributeColumn = table ? table.closest('td') : null;
    var contentRow = attributeColumn ? attributeColumn.closest('tr') : null;

    return contentRow || null;
  }

  function insertPanel(container, attributes, panel) {
    var anchor = findPanelAnchor(container, attributes);
    var row;
    var spacerCell;
    var cell;

    if (!anchor) {
      container.insertBefore(panel, container.firstChild);
      return;
    }

    row = document.createElement('tr');
    row.className = 'vmp-panel-row';
    spacerCell = document.createElement('td');
    cell = document.createElement('td');
    spacerCell.colSpan = anchor.children.length >= 3 ? 2 : 0;
    cell.colSpan = Math.max(anchor.children.length - spacerCell.colSpan, 1);
    cell.appendChild(panel);
    if (spacerCell.colSpan > 0) {
      row.appendChild(spacerCell);
    }
    row.appendChild(cell);
    anchor.parentNode.insertBefore(row, anchor);
  }

  function enhanceProfile(container) {
    var position;
    var attributes;
    var signature;
    var summary;
    var panel;

    position = findPosition(container);
    attributes = collectAttributeRows(container);
    signature = createSignature(position, attributes);

    if (!position || attributes.length < 8) {
      return;
    }

    if (container.getAttribute(ENHANCED_ATTR) === '1' && container.getAttribute(SIGNATURE_ATTR) === signature) {
      return;
    }

    resetEnhancements(container);
    position = findPosition(container);
    attributes = collectAttributeRows(container);
    signature = createSignature(position, attributes);

    attributes.forEach(function (attribute) {
      var importance = getImportance(position, attribute.name);

      attribute.valueCell.classList.add('vmp-value', getAttributeGradeClass(attribute));

      if (importance === 'primary') {
        attribute.row.classList.add('vmp-row-primary');
      } else if (importance === 'secondary') {
        attribute.row.classList.add('vmp-row-secondary');
      } else {
        attribute.row.classList.add('vmp-row-other');
      }

      addMarker(attribute.nameCell, importance);
    });

    summary = calculateSummary(position, attributes);
    panel = createPanel(position, summary);
    insertPanel(container, attributes, panel);
    container.setAttribute(ENHANCED_ATTR, '1');
    container.setAttribute(SIGNATURE_ATTR, signature);
  }

  function enhanceProfiles() {
    injectStyles();
    findProfileContainers().forEach(enhanceProfile);
  }

  function scheduleEnhancement() {
    if (scheduleTimer) {
      window.clearTimeout(scheduleTimer);
    }

    scheduleTimer = window.setTimeout(function () {
      scheduleTimer = null;
      enhanceProfiles();
    }, 120);
  }

  function start() {
    enhanceProfiles();

    new MutationObserver(scheduleEnhancement).observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.body) {
    start();
  } else {
    window.addEventListener('DOMContentLoaded', start, { once: true });
  }
}());
