// Self-contained provider / model / effort configuration page for the desktop
// shell. It talks to the embedded zimi server through window.zimiSettings.req
// (preload-settings.ts -> ipcMain 'zimi-settings:req' in settingsWindow.ts ->
// 127.0.0.1 REST with the bearer token attached in the main process). The
// page is loaded from a data: URL, so it must stay dependency-free and never
// reference external origins. Endpoints mirror docs/en/reference/server-api.md.

export const SETTINGS_HTML = String.raw`<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Zimi Code Settings</title>
<style>
:root { color-scheme: dark }
body { margin: 0; background: #0d1117; color: #e6edf3; font: 14px/1.55 ui-monospace, SFMono-Regular, Consolas, 'Segoe UI', sans-serif }
header { position: sticky; top: 0; background: #161b22; border-bottom: 1px solid #30363d; padding: 10px 18px; display: flex; gap: 14px; align-items: center; z-index: 5 }
header h1 { font-size: 15px; margin: 0; font-weight: 600 }
main { padding: 18px; max-width: 1080px; margin: 0 auto; display: grid; grid-template-columns: 360px 1fr; gap: 18px; align-items: start }
h2 { font-size: 13px; margin: 0 0 10px; color: #8b949e; text-transform: uppercase; letter-spacing: .04em }
.card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px; margin-bottom: 14px }
button { font: inherit; background: #21262d; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 5px 12px; cursor: pointer }
button.primary { background: #238636; border-color: #2ea043; color: #fff }
button.danger { background: #3d1214; border-color: #6e2c2f }
button:disabled { opacity: .5; cursor: default }
.btnrow { display: flex; gap: 8px; align-items: center; margin-top: 10px }
.btnrow select, .btnrow input { flex: 1 }
input[type=text], input[type=password], select, textarea { font: inherit; background: #0d1117; color: #e6edf3; border: 1px solid #30363d; border-radius: 6px; padding: 6px 8px; width: 100% }
.row { display: grid; grid-template-columns: 150px 1fr; gap: 10px; margin: 8px 0; align-items: start }
.row > span { padding-top: 7px; color: #8b949e }
small { color: #8b949e }
.provider { border-bottom: 1px solid #30363d; padding: 10px 0 }
.provider:last-child { border-bottom: 0 }
.provider h3 { margin: 0 0 4px; font-size: 15px }
#status { margin-left: auto; padding: 4px 12px; border-radius: 12px; background: #21262d; color: #8b949e; white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
#status.ok { background: #238636; color: #fff }
#status.err { background: #6e2c2f; color: #fff }
</style>
</head>
<body>
<header>
  <h1>Providers &amp; Models</h1>
  <span id="status">loading...</span>
</header>
<main>
  <aside id="sidebar"></aside>
  <section id="content"></section>
</main>
<script>
'use strict';

var TYPES = ['zimi', 'openai', 'openai_responses', 'anthropic', 'google-genai', 'vertexai'];
var S = { providers: [], models: [], defaultModel: null, editing: null, form: null, log: [] };

function status(kind, text) {
  var el = document.getElementById('status');
  el.className = kind;
  el.textContent = text;
  S.log.unshift(text);
  S.log = S.log.slice(0, 24);
  if (kind === 'err') console.error(text);
}

function api(method, path, body) {
  return window.zimiSettings.req(method, path, body).then(function (r) {
    if (r && r.ok) return r.data;
    throw new Error((r && r.error) || 'request failed');
  });
}

function el(tag, attrs, kids) {
  var e = document.createElement(tag);
  if (attrs) {
    if (attrs.text !== undefined) e.textContent = attrs.text;
    if (attrs.cls) e.className = attrs.cls;
    if (attrs.id) e.id = attrs.id;
    if (attrs.style) e.setAttribute('style', attrs.style);
  }
  kids = kids || [];
  for (var i = 0; i < kids.length; i++) {
    if (kids[i] !== null) e.appendChild(typeof kids[i] === 'string' ? document.createTextNode(kids[i]) : kids[i]);
  }
  return e;
}

function button(label, cls, handler) {
  var b = el('button', { text: label, cls: cls });
  b.addEventListener('click', handler);
  return b;
}

function modelsOf(id) {
  return S.models.filter(function (m) { return m.provider === id; });
}

// ---------- load ----------

function loadAll() {
  status('', 'loading...');
  Promise.all([api('GET', '/api/v1/providers'), api('GET', '/api/v1/models'), api('GET', '/api/v1/config')])
    .then(function (res) {
      S.providers = res[0].items || [];
      S.models = res[1].items || [];
      S.defaultModel = (res[2] || {}).default_model || null;
      status('ok', 'loaded');
      render();
    })
    .catch(function (e) { status('err', 'load: ' + e.message); render(); });
}

function after(action, next) {
  return function (p) {
    return p.then(function (x) { status('' + action + ' ok'); return next(x); },
                  function (e) { status('err', action + ': ' + e.message); render(); throw e; });
  };
}

function refreshReport(r) {
  var changed = (r && r.changed) || [];
  var failed = (r && r.failed) || [];
  var unchanged = (r && r.unchanged) || [];
  if (changed.length === 0 && failed.length === 0 && unchanged.length === 0) return 'refresh: empty report';
  return 'refresh ' + changed.length + ' changed / ' + failed.length + ' failed / ' + unchanged.length + ' unchanged'
    + (failed.length > 0 ? ' -- ' + failed.map(function (f) { return f.provider + ': ' + f.reason; }).join(' | ') : '');
}

// ---------- render ----------

function render() {
  var side = document.getElementById('sidebar');
  side.innerHTML = '';
  side.appendChild(defaultCard());
  side.appendChild(providerCard());
  var content = document.getElementById('content');
  content.innerHTML = '';
  content.appendChild(S.editing ? editCard(S.editing) : logCard());
}

function defaultCard() {
  var card = el('div', { cls: 'card' });
  card.appendChild(el('h2', { text: 'GLOBAL DEFAULT MODEL' }));
  var pick = el('select', { id: 'defaultPick' });
  for (var i = 0; i < S.models.length; i++) {
    var o = document.createElement('option');
    o.value = S.models[i].model;
    o.textContent = S.models[i].model + (S.models[i].default_effort ? ' - ' + S.models[i].default_effort : '');
    if (S.models[i].model === S.defaultModel) o.selected = true;
    pick.appendChild(o);
  }
  if (S.models.length === 0) pick.appendChild(el('option', { text: '(none configured)' }));
  card.appendChild(pick);
  var btn = button('Set default', 'primary', function () {
    var modelId = pick.value;
    if (!modelId) { status('err', 'no model selected'); return; }
    btn.disabled = true;
    api('POST', '/api/v1/models/' + encodeURIComponent(modelId) + ':set_default', {})
      .then(function () { status('ok', 'default model -> ' + modelId); return loadAll(); },
            function (e) { status('err', 'set-default: ' + e.message); btn.disabled = false; });
  });
  card.appendChild(el('div', { cls: 'btnrow' }, [btn]));
  return card;
}

function providerCard() {
  var card = el('div', { cls: 'card' });
  card.appendChild(el('h2', { text: 'PROVIDERS' }));
  var add = button('+ Add provider', 'primary', function () { S.editing = { provider: null }; S.form = null; render(); });
  card.appendChild(add);
  for (var i = 0; i < S.providers.length; i++) {
    var p = S.providers[i];
    var meta = p.type + ' - ' + (p.has_api_key ? 'key stored' : 'NO KEY') + ' - ' + modelsOf(p.id).length + ' model(s)';
    var row = el('div', { cls: 'provider' }, [
      el('h3', { text: p.id + (p.default_model ? ' -> ' + p.default_model : '') }),
      el('div', { text: meta, style: 'color:#8b949e;font-size:12px' }),
      el('div', { cls: 'btnrow' }, [
        button('Edit', '', (function (pp) { return function () { S.editing = { provider: pp }; render(); }; })(p)),
        button('Delete', 'danger', (function (pp) {
          return function () {
            if (!window.confirm('Delete ' + pp.id + ' and its ' + modelsOf(pp.id).length + ' model aliases?')) return;
            api('DELETE', '/api/v1/providers/' + encodeURIComponent(pp.id))
              .then(function () { status('ok', 'deleted ' + pp.id); return loadAll(); },
                    function (e) { status('err', 'delete: ' + e.message); });
          };
        })(p)),
      ]),
    ]);
    card.appendChild(row);
  }
  if (S.providers.length === 0) card.appendChild(el('div', { text: 'No providers configured yet.', style: 'color:#8b949e' }));
  return card;
}

function logCard() {
  var card = el('div', { cls: 'card' });
  card.appendChild(el('h2', { text: 'ACTIVITY' }));
  for (var i = 0; i < S.log.length; i++) {
    card.appendChild(el('div', { text: S.log[i], style: 'font-size:12px;color:' + (i === 0 ? '#e6edf3' : '#8b949e') }));
  }
  return card;
}

// ---------- edit / add form ----------

function seedModelRows(providerId) {
  return modelsOf(providerId).map(function (m) {
    var name = m.model.indexOf('/') >= 0 ? m.model.slice(m.model.indexOf('/') + 1) : m.model;
    var ctx = m.max_context_size || 128000;
    var eff = (m.support_efforts || []).join(',');
    return name + ' | ' + ctx + (eff ? ' | ' + eff : '');
  }).join('\n');
}

function parseModelRows(text) {
  var rows = [];
  var lines = text.split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line === '') continue;
    var parts = line.split('|').map(function (x) { return x.trim(); });
    var entry = { model: parts[0], max_context_size: /^\d+$/.test(parts[1] || '') ? Number(parts[1]) : 128000 };
    if (parts[2]) entry.support_efforts = parts[2].split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    rows.push(entry);
  }
  return rows;
}

function editCard(state) {
  var editing = state.provider !== null;
  var p = state.provider || {};
  var form = state.form || (state.form = {
    type: p.type || 'openai',
    discover: !editing,
    baseUrl: p.base_url || (state.baseUrlDraft || ''),
    apiKey: '',
    clearKey: false,
    defaultModel: p.default_model || '',
    models: editing ? seedModelRows(p.id) : '',
  });

  var card = el('div', { cls: 'card' });
  card.appendChild(el('h2', { text: editing ? 'EDIT PROVIDER' : 'ADD PROVIDER' }));

  var row = function (label, control, hint) {
    var wrap = el('div', { cls: 'row' }, [el('span', { text: label }), control]);
    if (hint) wrap.appendChild(el('div', { text: hint, style: 'grid-column:1/-1' }));
    return wrap;
  };
  var input = function (id, type, value, placeholder, disabled) {
    var i = el('input', { cls: '', style: '' });
    i.id = id; i.type = type; i.value = value;
    if (placeholder) i.placeholder = placeholder;
    if (disabled) i.disabled = true;
    return i;
  };

  card.appendChild(row('Provider ID', editing ? input('fId', 'text', p.id, '', true) : input('fId', 'text', '', 'my-provider', false)));

  var typeSel = el('select', {});
  for (var t = 0; t < TYPES.length; t++) {
    var o = document.createElement('option');
    o.value = TYPES[t]; o.textContent = TYPES[t];
    if (TYPES[t] === form.type) o.selected = true;
    typeSel.appendChild(o);
  }
  card.appendChild(row('Wire protocol', typeSel, 'ignored while model discovery is on (protocol auto-detected)'));

  var urlInput = input('fUrl', 'text', form.baseUrl, 'https://api.example.com/v1');
  card.appendChild(row('Base URL', urlInput, 'must not contain env-var placeholders such as \${...}'));

  var keyInput = input('fKey', 'password', '', 'sk-...');
  card.appendChild(row('API key', keyInput, editing && p.has_api_key ? 'leave blank to keep the stored key' : 'stored in config.toml on save'));

  var discover = el('input', {});
  discover.type = 'checkbox';
  discover.checked = form.discover && !editing;
  discover.addEventListener('change', function () { state.form.discover = discover.checked; render(); });
  card.appendChild(el('label', { text: ' discover models from the endpoint (protocol auto-detected, one alias per discovered model)' }, [discover]));

  var modelsArea = input('fModels', 'text', '', '', false);
  modelsArea.tagName === 'INPUT';
  var ta = document.createElement('textarea');
  ta.rows = 6;
  ta.value = form.models;
  ta.disabled = form.discover && !editing;
  card.appendChild(row('Models', ta, 'one per line: name | context | effort1,effort2 -- e.g. my-model | 256000 | low,medium,high (context defaults to 128000; omitted = removed on save)'));

  var defaultSel = el('select', {});
  defaultSel.appendChild(el('option', { text: '(none)' }));
  var currentModels = (form.models || '').split('\n').map(function (l) { return l.split('|')[0].trim(); }).filter(Boolean);
  for (var m = 0; m < currentModels.length; m++) {
    var opt = document.createElement('option');
    opt.value = currentModels[m]; opt.textContent = currentModels[m];
    if (currentModels[m] === form.defaultModel) opt.selected = true;
    defaultSel.appendChild(opt);
  }
  card.appendChild(row('Default model', defaultSel));

  var cancel = button('Cancel', '', function () { S.editing = null; S.form = null; render(); });
  var refresh = button('Refresh models', '', function () {
    if (!editing) { status('err', 'refresh is per-provider only once saved'); return; }
    refresh.disabled = true;
    api('POST', '/api/v1/providers/' + encodeURIComponent(p.id) + ':refresh', {})
      .then(function (rep) { status('ok', refreshReport(rep)); return loadAll(); },
            function (e) { status('err', 'refresh: ' + e.message); refresh.disabled = false; });
  });
  var save = button('Save provider', 'primary', function () { onSave(save, editing, p, urlInput, keyInput, discover, ta, defaultSel, typeSel); });
  card.appendChild(el('div', { cls: 'btnrow' }, [cancel, refresh, save]));
  return card;
}

function onSave(saveBtn, editing, p, urlInput, keyInput, discover, ta, defaultSel, typeSel) {
  saveBtn.disabled = true;
  var body;
  var path;
  try {
    if (discover.checked && !editing) {
      body = { id: p.id || document.getElementById('fId').value, discover: true, base_url: urlInput.value };
      if (keyInput.value) body.api_key = keyInput.value;
      path = '/api/v1/providers';
      saveBtn.disabled = false;
      api('POST', path, body)
        .then(function () { status('ok', 'provider created (discovery probe ran)'); S.editing = null; S.form = null; return loadAll(); },
              function (e) { status('err', 'save: ' + e.message); saveBtn.disabled = false; });
      return;
    }
    var models = parseModelRows(ta.value);
    if (!editing) {
      body = { id: document.getElementById('fId').value, type: typeSel.value, base_url: urlInput.value, models: models };
      if (keyInput.value) body.api_key = keyInput.value;
      if (defaultSel.value) body.default_model = defaultSel.value;
      path = '/api/v1/providers';
    } else {
      body = { type: typeSel.value, base_url: urlInput.value, models: models };
      if (keyInput.value !== '') body.api_key = keyInput.value;
      else if (editing && p.has_api_key && !keyInput.value) delete body.api_key;
      if (defaultSel.value) body.default_model = defaultSel.value;
      path = '/api/v1/providers/' + encodeURIComponent(p.id);
    }
    if (!body.base_url) { status('err', 'base URL required'); saveBtn.disabled = false; return; }
    if (body.models.length === 0) { status('err', 'provider needs at least one model (or use discovery mode)'); saveBtn.disabled = false; return; }
    if (!body.id && !editing) { status('err', 'provider id required'); saveBtn.disabled = false; return; }
    var run = editing ? api('PUT', path, body) : api('POST', path, body);
    run.then(function () { status('ok', 'saved'); S.editing = null; S.form = null; return loadAll(); },
             function (e) { status('err', 'save: ' + e.message); saveBtn.disabled = false; });
  } catch (e) {
    status('err', 'save: ' + e.message);
    saveBtn.disabled = false;
  }
}

loadAll();
</script>
</body>
</html>
`;
