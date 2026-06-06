// ==UserScript==
// @name         Volleyball Bulk Change Add
// @namespace    https://vm-manager.org/
// @version      0.1.0
// @description  Enhances VM Manager tactic changes view with bulk change add functionality.
// @match        *://*.vm-manager.org/*
// @grant        none
// @run-at       document-end
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-tactic-changes-view-enhancer.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-tactic-changes-view-enhancer.user.js
// ==/UserScript==

(function () {
  'use strict';

  const SAVE_ACTION_BY_TYPE = {
    League: 'Tactic',
    Cup: 'Tactic',
    IntCup: 'Tactic',
    Friendly: 'Tactic',
    YoungLeague: 'VM2YoungTactic',
    YoungFriendly: 'VM2YoungTactic'
  };

  function getOnClick(el) {
    return el.getAttribute('onclick') || el.getAttribute('OnClick') || '';
  }

  function getSaveOnclick() {
    return [...document.querySelectorAll('span.link')]
      .map(getOnClick)
      .find(text => text.includes('PlayersChangeAdd')) || '';
  }

  function getNativeRoute() {
    const saveOnclick = getSaveOnclick();
    const match = saveOnclick.match(/PlayersChangeAdd\('([^']+)'\s*,\s*(\d+)\)/);

    const type = match?.[1] || 'League';
    const changeId = match?.[2] || '0';

    return {
      action: SAVE_ACTION_BY_TYPE[type] || 'Tactic',
      type,
      changeId
    };
  }

  function isChangeAddView() {
    const route = getNativeRoute();

    return route.changeId === '0' &&
      document.querySelector('#player_out') &&
      document.querySelector('#player_in') &&
      getSaveOnclick().includes('PlayersChangeAdd');
  }

  function val(id, fallback = '0') {
    return document.getElementById(id)?.value ?? fallback;
  }

  function radio(name, fallback = '0') {
    return document.querySelector(`input[name="${name}"]:checked`)?.value ?? fallback;
  }

  function readSetPicker(selector) {
    return new Set(
      [...document.querySelectorAll(`${selector} input[type="checkbox"]:checked`)]
        .map(cb => cb.value)
    );
  }

  function readRowSets(row) {
    return new Set(
      [...row.querySelectorAll('.tm-pair-sets input[type="checkbox"]:checked')]
        .map(cb => cb.value)
    );
  }

  function currentTemplateParams() {
    return {
      set_1: '0',
      set_2: '0',
      set_3: '0',
      set_4: '0',
      set_5: '0',

      match_result: val('match_result'),
      match_result_points: val('match_result_points', '1'),
      match_state: val('match_state'),
      match_state_points: val('match_state_points', '1'),
      win_lost_points: val('win_lost_points'),

      reason_type: radio('reason_type'),
      fitness: val('fitness'),
      psyche: val('psyche'),
      failed_actions: val('failed_actions'),
      failed_actions_running: val('failed_actions_running'),

      return_reason_type: radio('return_reason_type'),
      return_fitness: val('return_fitness'),
      return_psyche: val('return_psyche'),
      return_failed_actions: val('return_failed_actions'),
      return_failed_actions_running: val('return_failed_actions_running'),
      return_actions_running: val('return_actions_running')
    };
  }

  function applySets(template, sets) {
    template.set_1 = sets.has('1') ? '1' : '0';
    template.set_2 = sets.has('2') ? '1' : '0';
    template.set_3 = sets.has('3') ? '1' : '0';
    template.set_4 = sets.has('4') ? '1' : '0';
    template.set_5 = sets.has('5') ? '1' : '0';
    return template;
  }

  function buildSaveUrl(pair) {
    const route = getNativeRoute();
    const template = applySets(currentTemplateParams(), pair.sets);

    const params = new URLSearchParams({
      phpsite: 'view_body.php',
      action: route.action,
      subview: 'ChangeSave',
      type: route.type,
      changeId: '0',
      player_in: pair.playerIn,
      player_out: pair.playerOut,
      ...template
    });

    return `/Ajax_handler.php?${params.toString()}`;
  }

  function clonePlayerSelect(sourceId) {
    const source = document.getElementById(sourceId);
    const clone = source.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.margin = '0 6px';
    clone.style.maxWidth = '220px';
    return clone;
  }

  function playerLabel(value) {
    const option = document.querySelector(`#player_out option[value="${CSS.escape(value)}"]`);
    return option?.textContent?.trim() || value;
  }

  function createSetPicker(className, visible = true) {
    const wrap = document.createElement('span');
    wrap.className = className;
    wrap.style.display = visible ? 'inline-flex' : 'none';
    wrap.style.alignItems = 'center';
    wrap.style.gap = '4px';
    wrap.style.marginLeft = '8px';

    const labelText = document.createElement('span');
    labelText.textContent = 'Sety:';
    wrap.append(labelText);

    for (let i = 1; i <= 5; i++) {
      const label = document.createElement('label');
      label.style.display = 'inline-flex';
      label.style.alignItems = 'center';
      label.style.gap = '2px';

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = String(i);
      cb.checked = document.getElementById(`set_${i}`)?.checked ?? true;

      label.append(cb, document.createTextNode(String(i)));
      wrap.append(label);
    }

    return wrap;
  }

  function createPairRow(list, useOwnSets = false) {
    const row = document.createElement('div');
    row.className = 'tm-pair-row';
    row.style.display = 'flex';
    row.style.alignItems = 'center';
    row.style.flexWrap = 'wrap';
    row.style.gap = '6px';
    row.style.marginTop = '6px';

    const outSelect = clonePlayerSelect('player_out');
    const inSelect = clonePlayerSelect('player_in');
    const setPicker = createSetPicker('tm-pair-sets', useOwnSets);

    const remove = document.createElement('button');
    remove.textContent = 'Usuń';
    remove.addEventListener('click', () => row.remove());

    row.append(
      document.createTextNode('Schodzi:'),
      outSelect,
      document.createTextNode('Wchodzi:'),
      inSelect,
      setPicker,
      remove
    );

    list.appendChild(row);
  }

  function getPairRows(useOwnSets) {
    const globalSets = readSetPicker('.tm-global-sets');

    return [...document.querySelectorAll('.tm-pair-row')].map(row => {
      const selects = row.querySelectorAll('select');

      return {
        playerOut: selects[0].value,
        playerIn: selects[1].value,
        sets: useOwnSets ? readRowSets(row) : globalSets
      };
    });
  }

  function setOwnSetsMode(enabled) {
    document.querySelectorAll('.tm-pair-sets').forEach(el => {
      el.style.display = enabled ? 'inline-flex' : 'none';
    });

    const globalSets = document.querySelector('.tm-global-sets');
    if (globalSets) {
      globalSets.style.display = enabled ? 'none' : 'inline-flex';
    }
  }

  function getOriginalPlayerBlock() {
    const playerOut = document.getElementById('player_out');
    return playerOut?.closest('table')?.closest('table')?.closest('td')?.closest('tr')?.closest('table');
  }

  function hideOriginalPlayerBlock() {
    const block = getOriginalPlayerBlock();
    if (block) {
      block.style.display = 'none';
    }
  }

  function hideOriginalSaveButton() {
    const saveButton = [...document.querySelectorAll('span.link')]
      .find(el => getOnClick(el).includes('PlayersChangeAdd'));

    const table = saveButton?.closest('table');
    if (table) {
      table.style.display = 'none';
    }
  }

  async function savePair(pair) {
    const response = await fetch(buildSaveUrl(pair), {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return response.text();
  }

  function injectPanel() {
    if (!isChangeAddView()) return;

    if (document.getElementById('tm-bulk-change-add')) {
      hideOriginalPlayerBlock();
      hideOriginalSaveButton();
      return;
    }

    const route = getNativeRoute();

    const panel = document.createElement('div');
    panel.id = 'tm-bulk-change-add';
    panel.style.cssText = `
      box-sizing: border-box;
      width: 100%;
      background: #102f43;
      color: white;
      border: 1px solid #2f80b7;
      padding: 10px;
      margin: 8px 0;
      font: 12px Arial, sans-serif;
    `;

    const title = document.createElement('b');
    title.textContent = 'Masowe dodawanie zmian z bieżącymi regułami';

    const routeInfo = document.createElement('div');
    routeInfo.style.marginTop = '6px';
    routeInfo.style.color = '#facc15';
    routeInfo.textContent = `Zapis do: action=${route.action}, type=${route.type}`;

    const hint = document.createElement('div');
    hint.textContent = 'Reguły poniżej działają jako szablon dla wszystkich par.';
    hint.style.margin = '6px 0 8px';

    const optionsRow = document.createElement('div');
    optionsRow.style.display = 'flex';
    optionsRow.style.alignItems = 'center';
    optionsRow.style.flexWrap = 'wrap';
    optionsRow.style.gap = '10px';
    optionsRow.style.margin = '6px 0';

    const globalSetPicker = createSetPicker('tm-global-sets', true);

    const ownSetsCheckbox = document.createElement('input');
    ownSetsCheckbox.type = 'checkbox';
    ownSetsCheckbox.id = 'tm-own-sets';

    const ownSetsLabel = document.createElement('label');
    ownSetsLabel.htmlFor = 'tm-own-sets';
    ownSetsLabel.style.display = 'inline-flex';
    ownSetsLabel.style.alignItems = 'center';
    ownSetsLabel.style.gap = '4px';
    ownSetsLabel.append(ownSetsCheckbox, document.createTextNode('osobne sety dla każdej pary'));

    optionsRow.append(globalSetPicker, ownSetsLabel);

    const list = document.createElement('div');

    const buttons = document.createElement('div');
    buttons.style.marginTop = '8px';

    const addButton = document.createElement('button');
    addButton.textContent = 'Dodaj parę';
    addButton.addEventListener('click', () => createPairRow(list, ownSetsCheckbox.checked));

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Zapisz wszystkie pary';
    saveButton.style.marginLeft = '8px';

    const status = document.createElement('span');
    status.style.marginLeft = '10px';

    buttons.append(addButton, saveButton, status);

    ownSetsCheckbox.addEventListener('change', () => {
      setOwnSetsMode(ownSetsCheckbox.checked);
    });

    saveButton.addEventListener('click', async () => {
      const pairs = getPairRows(ownSetsCheckbox.checked);

      if (!pairs.length) {
        status.textContent = 'Brak par.';
        return;
      }

      const invalid = pairs.find(pair => pair.playerOut === pair.playerIn);
      if (invalid) {
        status.textContent = 'Błąd: zawodnik schodzący i wchodzący są tacy sami.';
        return;
      }

      const noSets = pairs.find(pair => pair.sets.size === 0);
      if (noSets) {
        status.textContent = 'Błąd: jedna z par nie ma wybranego żadnego seta.';
        return;
      }

      const summary = pairs
        .map(pair => `${playerLabel(pair.playerOut)} <= ${playerLabel(pair.playerIn)} [sety: ${[...pair.sets].join(',')}]`)
        .join('\n');

      if (!confirm(`Dodać ${pairs.length} zmian?\n\n${summary}`)) return;

      saveButton.disabled = true;
      addButton.disabled = true;

      try {
        for (let i = 0; i < pairs.length; i++) {
          status.textContent = `Zapisuję ${i + 1}/${pairs.length}...`;
          await savePair(pairs[i]);
          await new Promise(resolve => setTimeout(resolve, 250));
        }

        status.textContent = `Dodano: ${pairs.length}`;

        const currentRoute = getNativeRoute();
        const listAction = currentRoute.type.startsWith('Young') ? 'YoungTactic' : 'Tactic';

        if (typeof window.callGetViewPanelBodyBig_1 === 'function') {
          window.callGetViewPanelBodyBig_1(`${listAction}&type=${currentRoute.type}&subview=Changes`);
        }
      } catch (error) {
        status.textContent = `Błąd zapisu: ${error.message}`;
      } finally {
        saveButton.disabled = false;
        addButton.disabled = false;
      }
    });

    panel.append(title, routeInfo, hint, optionsRow, list, buttons);

    createPairRow(list);

    const originalBlock = getOriginalPlayerBlock();
    originalBlock?.parentElement?.insertBefore(panel, originalBlock);

    hideOriginalPlayerBlock();
    hideOriginalSaveButton();
    setOwnSetsMode(false);
  }

  const observer = new MutationObserver(() => injectPanel());
  observer.observe(document.body, { childList: true, subtree: true });

  injectPanel();
})();