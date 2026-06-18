// ==UserScript==
// @name         VM Training History Exporter
// @namespace    https://vm-manager.org/
// @version      0.1.3
// @description  Saves senior training before/after snapshots locally and exports training history as JSON/CSV.
// @match        *://*.vm-manager.org/*
// @match        *://vm-manager.org/*
// @updateURL    https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-training-history-exporter.user.js
// @downloadURL  https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-training-history-exporter.user.js
// @run-at       document-end
// @grant        none
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-dom-utils.js
// @require      https://github.com/kubas33/vm-enhanced-pack/raw/refs/heads/main/vm-training-history-parser.js
// ==/UserScript==

(function () {
  'use strict';

  var dom = window.VMDomUtils;
  var parser = window.VMTrainingHistoryParser;

  if (!dom || !parser) {
    throw new Error('VM Training History Exporter wymaga vm-dom-utils.js i vm-training-history-parser.js.');
  }

  var PANEL_ID = 'vth-panel';
  var STYLE_ID = 'vth-styles';
  var DB_NAME = 'vm-training-history';
  var DB_VERSION = 1;
  var STORE_SESSIONS = 'sessions';
  var SNAPSHOT_CACHE_KEY = 'vth.pendingSeniorSnapshot.v1';
  var CONTEXT_CACHE_KEY = 'vth.trainingContext.v1';
  var SNAPSHOT_TTL_MS = 60 * 60 * 1000;
  var CONTEXT_TTL_MS = 10 * 60 * 1000;
  var TRAINING_ACTION = 'TrainingAccept';
  var COACHES_URL = '/Ajax_handler.php?phpsite=view_body.php&action=Coaches';
  var BUILDINGS_URL = '/Ajax_handler.php?phpsite=view_body.php&action=Buildings&bodyMenu=body_menu_2';
  var enhanceTimer = 0;
  var saveInProgress = false;
  var lastSavedSessionId = '';

  function injectStyles() {
    var style;

    if (document.getElementById(STYLE_ID)) {
      return;
    }

    style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = ''
      + '.vth-panel{margin:6px 0;padding:7px 10px;border:1px solid rgba(93,176,225,.32);'
      + 'background:rgba(5,23,35,.72);color:#dceefa;font-size:11px;line-height:1.35;border-radius:3px;}'
      + '.vth-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}'
      + '.vth-panel strong{color:#fff;}'
      + '.vth-btn{cursor:pointer;padding:3px 8px;font-size:11px;}'
      + '.vth-status{color:#9ec7de;}'
      + '.vth-status-error{color:#ff9d8a;}'
      + '.vth-status-ok{color:#7dffb0;}'
      + '.vth-preview{margin-top:6px;display:none;color:#dceefa;}'
      + '.vth-preview table{width:100%;border-collapse:collapse;font-size:11px;margin-top:5px;}'
      + '.vth-preview th,.vth-preview td{border:1px solid rgba(93,176,225,.25);padding:3px 5px;text-align:left;}'
      + '.vth-preview th{background:rgba(93,176,225,.12);}';
    document.head.appendChild(style);
  }

  function getTrainingForm() {
    return dom.getVisibleElementById(document, parser.SENIOR_FORM_ID);
  }

  function parseCurrentSnapshot() {
    var form = getTrainingForm();
    if (!form) {
      return null;
    }
    if (typeof parser.parseSeniorTrainingSnapshotFromRoot === 'function') {
      return parser.parseSeniorTrainingSnapshotFromRoot(form);
    }
    return parser.parseSeniorTrainingSnapshotFromHtml(form.outerHTML || form.innerHTML || '');
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      var request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          db.createObjectStore(STORE_SESSIONS, { keyPath: 'id' });
        }
      };
      request.onsuccess = function () {
        resolve(request.result);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  }

  function putSession(session) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_SESSIONS, 'readwrite');
        tx.objectStore(STORE_SESSIONS).put(session);
        tx.oncomplete = function () {
          db.close();
          resolve(session);
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function getAllSessions() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_SESSIONS, 'readonly');
        var request = tx.objectStore(STORE_SESSIONS).getAll();
        request.onsuccess = function () {
          db.close();
          resolve(request.result || []);
        };
        request.onerror = function () {
          db.close();
          reject(request.error);
        };
      });
    });
  }

  function clearSessions() {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_SESSIONS, 'readwrite');
        tx.objectStore(STORE_SESSIONS).clear();
        tx.oncomplete = function () {
          db.close();
          resolve();
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error);
        };
      });
    });
  }

  function readPendingSnapshot() {
    var raw;

    try {
      raw = window.sessionStorage.getItem(SNAPSHOT_CACHE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writePendingSnapshot(snapshot) {
    try {
      window.sessionStorage.setItem(SNAPSHOT_CACHE_KEY, JSON.stringify({
        createdAt: Date.now(),
        snapshot: snapshot,
      }));
    } catch (error) {
      // History export must not block the VM training action.
    }
  }

  function clearPendingSnapshot() {
    try {
      window.sessionStorage.removeItem(SNAPSHOT_CACHE_KEY);
    } catch (error) {
      // Ignore storage failures.
    }
  }

  function readContextCache() {
    var raw;
    var parsed;

    try {
      raw = window.sessionStorage.getItem(CONTEXT_CACHE_KEY);
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }

    if (!parsed || !parsed.createdAt || Date.now() - parsed.createdAt > CONTEXT_TTL_MS) {
      return null;
    }

    return parsed;
  }

  function writeContextCache(context) {
    try {
      window.sessionStorage.setItem(CONTEXT_CACHE_KEY, JSON.stringify(Object.assign({
        createdAt: Date.now(),
      }, context)));
    } catch (error) {
      // Context can be re-fetched later.
    }
  }

  function fetchVmBody(url) {
    return window.fetch(url, { credentials: 'same-origin' })
      .then(function (response) {
        if (!response.ok) {
          throw new Error('VM fetch failed: ' + response.status);
        }
        return response.text();
      })
      .then(parser.parseAjaxVmBody);
  }

  function getTrainingContext(trainingKind) {
    var cached = readContextCache();

    if (cached && cached.coaches && cached.infrastructure) {
      return Promise.resolve(buildContext(cached.coaches, cached.infrastructure, trainingKind));
    }

    return Promise.all([
      fetchVmBody(COACHES_URL),
      fetchVmBody(BUILDINGS_URL),
    ]).then(function (parts) {
      var coaches = parser.parseCoachesFromHtml(parts[0]);
      var infrastructure = parser.parseInfrastructureFromHtml(parts[1]);

      writeContextCache({
        coaches: coaches,
        infrastructure: infrastructure,
      });

      return buildContext(coaches, infrastructure, trainingKind);
    });
  }

  function buildContext(coaches, infrastructure, trainingKind) {
    return {
      coaches: coaches,
      infrastructure: infrastructure,
      efficiency: parser.calculateSeniorEfficiency(coaches, infrastructure, trainingKind),
    };
  }

  function getPrimaryTrainingKind(snapshot) {
    var trained = (snapshot.players || []).find(function (player) {
      return player.selectedOption !== 'nietrenuj' && player.trainingKind;
    });
    return trained ? trained.trainingKind : parser.getTrainingKindForSkill(snapshot.selectedTrainingCode);
  }

  function captureBeforeTraining(forceStatus) {
    var snapshot = parseCurrentSnapshot();

    if (!snapshot || !snapshot.players || !snapshot.players.length) {
      if (forceStatus) {
        setStatus('Nie zapisano snapshotu: parser nie znalazl zawodnikow w tabeli.', 'error');
      }
      return;
    }

    writePendingSnapshot(snapshot);
    setStatus('Snapshot przed treningiem zapisany: ' + snapshot.players.length + ' zawodnikow.', 'ok');
  }

  function trySaveAfterTraining(forceStatus) {
    var pending;
    var afterSnapshot;
    var trainingKind;
    var effects;

    if (saveInProgress) {
      return;
    }

    pending = readPendingSnapshot();
    if (!pending || !pending.snapshot || Date.now() - pending.createdAt > SNAPSHOT_TTL_MS) {
      if (forceStatus) {
        setStatus('Brak snapshotu przed treningiem. Kliknij Snapshot przed przed nastepnym treningiem.', 'error');
      }
      return;
    }

    afterSnapshot = parseCurrentSnapshot();
    if (!afterSnapshot || !afterSnapshot.players || !afterSnapshot.players.length) {
      if (forceStatus) {
        setStatus('Nie widze tabeli treningu do zapisu po.', 'error');
      }
      return;
    }

    saveInProgress = true;
    trainingKind = getPrimaryTrainingKind(pending.snapshot);
    effects = parser.parseLastTrainingEffectsFromHtml(document.body ? document.body.innerHTML : '');

    getTrainingContext(trainingKind).then(function (context) {
      var session = parser.pairTrainingSnapshots(pending.snapshot, afterSnapshot, Object.assign({}, context, {
        capturedAt: new Date().toISOString(),
        lastEffects: effects,
      }));

      if (session.id === lastSavedSessionId) {
        return session;
      }

      return putSession(session).then(function () {
        lastSavedSessionId = session.id;
        clearPendingSnapshot();
        setStatus('Zapisano sesje treningowa: ' + session.records.length + ' rekordow.', 'ok');
        updateStats();
        refreshPreviewIfOpen();
        return session;
      });
    }).catch(function (error) {
      setStatus('Nie zapisano historii: ' + error.message, 'error');
    }).finally(function () {
      saveInProgress = false;
    });
  }

  function ensurePanel() {
    var form = getTrainingForm();
    var panel;

    if (!form) {
      return null;
    }

    injectStyles();
    panel = dom.getVisibleElementById(document, PANEL_ID);
    if (panel) {
      return panel;
    }

    dom.removeHiddenById(document, PANEL_ID);

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = 'vth-panel';
    panel.innerHTML = ''
      + '<div class="vth-row">'
      + '<strong>Historia treningow</strong>'
      + '<span class="vth-status" id="vth-status">Gotowe.</span>'
      + '<button type="button" class="vth-btn" id="vth-export-json" title="Pobierz cala lokalna historie jako JSON">Eksport JSON</button>'
      + '<button type="button" class="vth-btn" id="vth-export-csv" title="Pobierz cala lokalna historie jako CSV">Eksport CSV</button>'
      + '<button type="button" class="vth-btn" id="vth-preview-toggle">Podglad</button>'
      + '<button type="button" class="vth-btn" id="vth-capture-before" title="Awaryjnie zapisz obecna tabele jako stan przed treningiem">Snapshot przed</button>'
      + '<button type="button" class="vth-btn" id="vth-save-after" title="Awaryjnie porownaj obecna tabele ze snapshotem przed i zapisz sesje">Zapisz po</button>'
      + '<button type="button" class="vth-btn" id="vth-clear">Wyczysc</button>'
      + '<span class="vth-status" id="vth-count"></span>'
      + '</div>'
      + '<div class="vth-preview" id="vth-preview"></div>';

    form.insertBefore(panel, form.firstElementChild);
    panel.querySelector('#vth-export-json').addEventListener('click', exportJson);
    panel.querySelector('#vth-export-csv').addEventListener('click', exportCsv);
    panel.querySelector('#vth-preview-toggle').addEventListener('click', togglePreview);
    panel.querySelector('#vth-capture-before').addEventListener('click', function () {
      captureBeforeTraining(true);
    });
    panel.querySelector('#vth-save-after').addEventListener('click', function () {
      trySaveAfterTraining(true);
    });
    panel.querySelector('#vth-clear').addEventListener('click', clearHistory);
    updateStats();
    return panel;
  }

  function setStatus(message, kind) {
    var panel = ensurePanel();
    var status = panel ? panel.querySelector('#vth-status') : null;

    if (!status) {
      return;
    }

    status.className = 'vth-status' + (kind ? ' vth-status-' + kind : '');
    status.textContent = message;
  }

  function updateStats() {
    getAllSessions().then(function (sessions) {
      var panel = ensurePanel();
      var count = panel ? panel.querySelector('#vth-count') : null;
      var records = sessions.reduce(function (sum, session) {
        return sum + (session.records ? session.records.length : 0);
      }, 0);

      if (count) {
        count.textContent = 'Lokalnie: ' + sessions.length + ' sesji / ' + records + ' rekordow';
      }
      updatePendingStatus();
    }).catch(function () {
      // Stats are non-critical.
    });
  }

  function updatePendingStatus() {
    var pending = readPendingSnapshot();
    var hasEffects = /Efekt ostatniego treningu/i.test(document.body ? document.body.textContent || '' : '');

    if (pending && pending.snapshot) {
      setStatus('Jest snapshot przed treningiem. Po wykonaniu treningu zapisze sesje.', 'ok');
      return;
    }

    if (hasEffects) {
      setStatus('Widze efekt ostatniego treningu, ale nie mam snapshotu przed. Nastepny trening powinien zapisac sie automatycznie.', 'error');
    }
  }

  function refreshPreviewIfOpen() {
    var panel = dom.getVisibleElementById(document, PANEL_ID);
    var preview = panel ? panel.querySelector('#vth-preview') : null;

    if (preview && preview.style.display === 'block') {
      renderPreview(preview);
    }
  }

  function exportJson() {
    getAllSessions().then(function (sessions) {
      downloadText(buildExportFilename('json'), JSON.stringify({
        exportedAt: new Date().toISOString(),
        sessions: sessions,
      }, null, 2), 'application/json');
    }).catch(function (error) {
      setStatus('Eksport JSON nieudany: ' + error.message, 'error');
    });
  }

  function exportCsv() {
    getAllSessions().then(function (sessions) {
      var rows = [];
      sessions.forEach(function (session) {
        rows = rows.concat(parser.flattenSessionToRecords(session));
      });
      downloadText(buildExportFilename('csv'), parser.toCsv(rows), 'text/csv;charset=utf-8');
    }).catch(function (error) {
      setStatus('Eksport CSV nieudany: ' + error.message, 'error');
    });
  }

  function clearHistory() {
    if (!window.confirm('Usunac lokalna historie treningow?')) {
      return;
    }

    clearSessions().then(function () {
      setStatus('Historia wyczyszczona.', 'ok');
      updateStats();
    }).catch(function (error) {
      setStatus('Nie udalo sie wyczyscic historii: ' + error.message, 'error');
    });
  }

  function togglePreview() {
    var panel = ensurePanel();
    var preview = panel ? panel.querySelector('#vth-preview') : null;

    if (!preview) {
      return;
    }

    if (preview.style.display === 'block') {
      preview.style.display = 'none';
      return;
    }

    renderPreview(preview);
  }

  function renderPreview(preview) {
    getAllSessions().then(function (sessions) {
      var latest = sessions.slice().sort(function (left, right) {
        return String(right.capturedAt || '').localeCompare(String(left.capturedAt || ''));
      })[0];
      var records;

      preview.style.display = 'block';

      if (!latest) {
        preview.innerHTML = '<div class="vth-status">Brak zapisanych sesji.</div>';
        return;
      }

      records = latest.records || [];
      preview.innerHTML = ''
        + '<div><strong>Ostatnia sesja:</strong> ' + escapeHtml(formatSessionHeader(latest)) + '</div>'
        + '<div class="vth-status">Pokazano pierwsze ' + Math.min(records.length, 8) + ' z ' + records.length + ' rekordow ostatniej sesji. Eksport obejmie wszystkie lokalne sesje.</div>'
        + buildPreviewTable(records.slice(0, 8));
    }).catch(function (error) {
      preview.style.display = 'block';
      preview.innerHTML = '<div class="vth-status vth-status-error">Nie udalo sie wczytac podgladu: ' + escapeHtml(error.message) + '</div>';
    });
  }

  function formatSessionHeader(session) {
    var records = session.records || [];
    var trained = records.filter(function (record) {
      return record.selectedOption !== 'nietrenuj';
    });
    var changed = trained.filter(function (record) {
      return Number(record.delta) > 0;
    });
    var avgDelta = trained.length
      ? trained.reduce(function (sum, record) { return sum + (Number(record.delta) || 0); }, 0) / trained.length
      : 0;
    var efficiency = session.efficiency && session.efficiency.normalizedEfficiency != null
      ? ' | efektywnosc ' + formatPercent(session.efficiency.normalizedEfficiency)
      : '';

    return [
      session.capturedAt || '',
      session.selectedTrainingLabel || session.selectedTrainingCode || '',
      trained.length + ' trenuje',
      changed.length + ' ze zmiana',
      'sr. delta ' + avgDelta.toFixed(2),
    ].join(' | ') + efficiency;
  }

  function buildPreviewTable(records) {
    if (!records.length) {
      return '';
    }

    return ''
      + '<table><thead><tr>'
      + '<th>Zawodnik</th><th>Opcja</th><th>Atrybut</th><th>Przed</th><th>Po</th><th>Delta</th><th>Pasek</th>'
      + '</tr></thead><tbody>'
      + records.map(function (record) {
        return ''
          + '<tr>'
          + '<td>' + escapeHtml(record.playerName || record.playerId) + '</td>'
          + '<td>' + escapeHtml(record.selectedOption || '') + '</td>'
          + '<td>' + escapeHtml(record.trainedSkillLabel || record.trainedSkillCode || '') + '</td>'
          + '<td>' + escapeHtml(formatValue(record.levelBefore)) + '</td>'
          + '<td>' + escapeHtml(formatValue(record.levelAfter)) + '</td>'
          + '<td>' + escapeHtml(formatValue(record.delta)) + '</td>'
          + '<td>' + escapeHtml(formatValue(record.barBefore)) + ' -> ' + escapeHtml(formatValue(record.barAfter)) + '</td>'
          + '</tr>';
      }).join('')
      + '</tbody></table>';
  }

  function formatPercent(value) {
    return (Number(value) * 100).toFixed(2) + '%';
  }

  function formatValue(value) {
    return value == null ? '' : String(value);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function downloadText(filename, content, mimeType) {
    var blob = new Blob([content], { type: mimeType });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  function buildExportFilename(extension) {
    var now = new Date();
    var stamp = [
      now.getFullYear(),
      pad2(now.getMonth() + 1),
      pad2(now.getDate()),
      pad2(now.getHours()),
      pad2(now.getMinutes()),
      pad2(now.getSeconds()),
    ].join('-');

    return 'vm-training-history-' + stamp + '.' + extension;
  }

  function pad2(value) {
    return String(value).padStart(2, '0');
  }

  function patchMakeTrening() {
    var original;

    if (window.__vthMakeTreningPatched || typeof window.MakeTrening !== 'function') {
      return;
    }

    original = window.MakeTrening;
    window.MakeTrening = function (action) {
      if (action === TRAINING_ACTION) {
        captureBeforeTraining(false);
      }
      return original.apply(this, arguments);
    };
    window.__vthMakeTreningPatched = true;
  }

  function bindClickFallback() {
    if (document.body && document.body.getAttribute('data-vth-click-bound') === '1') {
      return;
    }

    document.body.setAttribute('data-vth-click-bound', '1');
    document.addEventListener('pointerdown', captureFromTrainingActionEvent, true);
    document.addEventListener('mousedown', captureFromTrainingActionEvent, true);
    document.addEventListener('click', captureFromTrainingActionEvent, true);
  }

  function captureFromTrainingActionEvent(event) {
    var target = event.target;

    if (!target || !target.closest) {
      return;
    }

    if (isTrainingActionTarget(target)) {
      captureBeforeTraining(false);
    }
  }

  function isTrainingActionTarget(target) {
    var node = target.closest('[onclick], [OnClick]');
    var handler;

    if (!node) {
      return false;
    }

    handler = node.getAttribute('onclick') || node.getAttribute('OnClick') || '';
    return handler.indexOf('MakeTrening') !== -1 && handler.indexOf(TRAINING_ACTION) !== -1;
  }

  function scheduleEnhance() {
    window.clearTimeout(enhanceTimer);
    enhanceTimer = window.setTimeout(function () {
      if (!getTrainingForm()) {
        return;
      }

      ensurePanel();
      patchMakeTrening();
      bindClickFallback();
      trySaveAfterTraining();
    }, 120);
  }

  document.addEventListener('change', function (event) {
    var target = event.target;
    if (target && (target.id === parser.SENIOR_SELECT_ID || String(target.name || '').indexOf(parser.SENIOR_INPUT_PREFIX) === 0)) {
      scheduleEnhance();
    }
  });

  new MutationObserver(scheduleEnhance).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });

  scheduleEnhance();
}());
