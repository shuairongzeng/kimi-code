export const AGENTS_ADMIN_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Agents · Zimi Code</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px; font: 14px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #f7f8fa; color: #1c1e21;
  }
  @media (prefers-color-scheme: dark) {
    body { background: #14161a; color: #e6e8eb; }
    .card, form.card { background: #1c1f24; border-color: #2c3138; }
    input, textarea, select { background: #14161a; color: #e6e8eb; border-color: #2c3138; }
    .muted { color: #9aa0a6; }
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #6b7280; }
  .topbar { margin: 0 0 8px; }
  .topbar a { color: #2f6fed; text-decoration: none; font-size: 13px; }
  .card {
    background: #fff; border: 1px solid #e3e5e8; border-radius: 10px;
    padding: 16px; margin-top: 16px;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #eceef0; vertical-align: top; }
  @media (prefers-color-scheme: dark) { th, td { border-color: #2c3138; } }
  th { font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
  td.name { font-family: ui-monospace, monospace; white-space: nowrap; }
  button {
    border: 1px solid #c9ccd1; background: #fff; color: inherit; border-radius: 6px;
    padding: 5px 12px; cursor: pointer; font-size: 13px;
  }
  button.primary { background: #2f6fed; border-color: #2f6fed; color: #fff; }
  button.danger { color: #c0392b; border-color: #c0392b; background: transparent; }
  label { display: block; margin: 10px 0 4px; font-weight: 600; font-size: 13px; }
  input, textarea, select {
    width: 100%; border: 1px solid #c9ccd1; border-radius: 6px; padding: 7px 9px;
    font: inherit; background: #fff; color: inherit;
  }
  textarea { min-height: 160px; font-family: ui-monospace, monospace; font-size: 13px; }
  .row { display: flex; gap: 12px; }
  .row > div { flex: 1; }
  .error { color: #c0392b; margin-top: 10px; white-space: pre-wrap; }
  .hint { font-size: 12px; color: #6b7280; margin-top: 2px; }
  .badge {
    display: inline-block; font-size: 11px; padding: 1px 7px; border-radius: 999px;
    background: #e8eefc; color: #2f6fed;
  }
  @media (prefers-color-scheme: dark) { .badge { background: #22304d; } }
  .boxes {
    border: 1px solid #e3e5e8; border-radius: 8px; padding: 8px 10px;
    max-height: 180px; overflow-y: auto; margin-top: 4px;
  }
  @media (prefers-color-scheme: dark) { .boxes { border-color: #2c3138; } }
  .boxes label { display: flex; align-items: baseline; gap: 8px; font-weight: 400; margin: 2px 0; }
  .boxes label input { width: auto; }
  .boxes .tname { font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; }
  .boxes .tdesc { color: #6b7280; font-size: 12px; }
  .overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 100;
    display: flex; align-items: flex-start; justify-content: center; padding: 40px 16px;
    overflow-y: auto;
  }
  .overlay[hidden] { display: none !important; }
  .overlay .panel {
    background: #fff; border: 1px solid #e3e5e8; border-radius: 12px;
    padding: 20px; width: 100%; max-width: 760px; position: relative;
    box-shadow: 0 20px 60px rgba(0,0,0,.25);
  }
  @media (prefers-color-scheme: dark) { .overlay .panel { background: #1c1f24; border-color: #2c3138; } }
  .panel-close {
    position: absolute; top: 10px; right: 10px; border: none; background: transparent;
    font-size: 18px; line-height: 1; padding: 4px 8px; cursor: pointer; color: #6b7280;
    z-index: 300; /* stay above dropdowns (z-index 120) and other panel content */
  }
  .combo { position: relative; }
  .combo input { width: 100%; }
  .combo .dropdown {
    position: absolute; top: 100%; left: 0; right: 0; z-index: 120;
    background: #fff; border: 1px solid #e3e5e8; border-radius: 8px; margin-top: 2px;
    max-height: 260px; overflow-y: auto; box-shadow: 0 8px 30px rgba(0,0,0,.18);
  }
  @media (prefers-color-scheme: dark) { .combo .dropdown { background: #1c1f24; border-color: #2c3138; } }
  .dropdown .group {
    padding: 6px 10px 2px; font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .05em; color: #6b7280; position: sticky; top: 0; background: inherit;
  }
  .dropdown .opt {
    display: flex; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 13px;
    align-items: baseline;
  }
  .dropdown .opt:hover, .dropdown .opt.active { background: rgba(47,111,237,.12); }
  .dropdown .opt .mid { font-family: ui-monospace, monospace; }
  .dropdown .opt .mdesc { color: #6b7280; font-size: 12px; flex: 1; }
  .dropdown .empty { padding: 10px; color: #6b7280; font-size: 13px; }
</style>
</head>
<body>
<p class="topbar"><a id="back-link" href="/">← 返回主界面</a></p>
<h1>自定义子智能体</h1>
<p class="muted">
  在这里创建、编辑或删除自定义子智能体。保存后主 Agent 的 task 工具立即可见并可派活；
  文件存放在 <code>~/.zimi-code/agents/*.md</code>。
</p>

<div class="card" id="auth-panel" hidden>
  <h2 style="margin:0 0 4px; font-size:16px">需要登录令牌</h2>
  <p class="muted">未能自动检测登录令牌。请回到主界面，从地址栏复制 <code>#token=</code> 之后的字符串粘贴到下方。</p>
  <input id="auth-token" placeholder="粘贴令牌" />
  <p style="margin:10px 0 0"><button class="primary" id="auth-go">进入</button></p>
  <div class="error" id="auth-error"></div>
</div>

<div class="card" id="main-card" hidden>
  <table>
    <thead><tr><th>名称</th><th>描述</th><th>使用时机</th><th>模型 / 推理</th><th></th></tr></thead>
    <tbody id="rows"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody>
  </table>
  <p style="margin:12px 0 0"><button class="primary" id="new-btn">+ 新建子智能体</button></p>
  <div class="error" id="list-error"></div>
</div>

<div class="overlay" id="editor-overlay" hidden>
<form class="panel" id="editor">
  <button type="button" class="panel-close" id="panel-close" aria-label="关闭">×</button>
  <h2 id="editor-title" style="margin:0 0 4px; font-size:16px">新建子智能体</h2>
  <div class="row">
    <div>
      <label for="f-name">名称（kebab-case）</label>
      <input id="f-name" required pattern="[a-z0-9]+(-[a-z0-9]+)*" placeholder="doc-writer" />
      <div class="hint">小写字母/数字与连字符，例如 code-reviewer</div>
    </div>
    <div>
      <label for="f-when">使用时机（可选）</label>
      <input id="f-when" placeholder="需要更新文档时" />
    </div>
  </div>
  <label for="f-desc">描述（主 Agent 据此决定是否派活）</label>
  <input id="f-desc" required placeholder="一句话说明它擅长什么" />
  <label style="display:flex;align-items:center;gap:8px;font-weight:600"><input id="f-tools-all" type="checkbox" style="width:auto" checked /> 允许使用全部工具</label>
  <div id="tools-allow-wrap" hidden>
    <label>勾选允许使用的工具（不勾 = 禁用全部工具）</label>
    <div class="boxes" id="tools-allow-box"></div>
  </div>
  <label>勾选要禁用的工具（可选）</label>
  <div class="boxes" id="tools-deny-box"></div>
  <label for="f-subagents">允许调用的子智能体（可选，逗号分隔）</label>
  <input id="f-subagents" placeholder="留空 = 默认" />
  <div class="row">
    <div class="combo">
      <label for="f-model">模型（可选）</label>
      <input id="f-model" autocomplete="off" placeholder="留空 = 继承主 Agent 模型（输入即筛选，按供应商分组）" />
      <input type="hidden" id="f-model-alias" />
      <div class="dropdown" id="model-dropdown" hidden></div>
    </div>
    <div>
      <label for="f-thinking">模型推理等级（可选）</label>
      <select id="f-thinking"></select>
      <div class="hint" id="effort-hint">选择模型后按该模型支持等级自动填写</div>
    </div>
  </div>
  <div class="row" id="thinking-custom-row" hidden>
    <div>
      <label for="f-thinking-custom" id="thinking-custom-label" hidden>自定义推理等级值</label>
      <input id="f-thinking-custom" hidden placeholder="例如 xhigh" />
    </div>
  </div>
  <label style="display:flex;align-items:center;gap:8px;font-weight:600"><input id="f-delegate" type="checkbox" style="width:auto" /> 允许该子智能体再派发子任务（默认关闭：叶子工作者）</label>
  <label for="f-prompt">工作内容（系统提示正文）</label>
  <textarea id="f-prompt" required placeholder="描述它的职责、风格、约束…"></textarea>
  <p style="margin:14px 0 0">
    <button type="submit" class="primary">保存</button>
    <button type="button" id="cancel-btn">取消</button>
  </p>
  <div class="error" id="form-error"></div>
</form>
</div>

<script>
(function () {
  var token = '';
  var editing = null;
  var modelCatalog = {};
  var toolOptions = [];
  var lastAutoEffort = null;

  function $(id) { return document.getElementById(id); }
  function authHeaders() {
    return token ? { Authorization: 'Bearer ' + token } : {};
  }
  function jsonHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }
  function splitList(value) {
    var items = value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return items.length ? items : undefined;
  }
  function showError(el, payload) {
    var message = (payload && payload.msg) || (payload && payload.error && payload.error.message) || '请求失败';
    if (message === 'Unauthorized' || message === 'unauthorized') message = '未授权：令牌缺失或无效';
    el.textContent = message;
  }

  function tokenCandidates() {
    var out = [];
    var m = location.hash.match(/token=([^&]+)/);
    if (m) out.push(m[1]);
    function scan(store) {
      try {
        for (var i = 0; i < store.length; i++) {
          var key = store.key(i);
          var v = store.getItem(key);
          if (typeof v === 'string' && v.length >= 20 && v.length <= 200 && /^[A-Za-z0-9._\\-]+$/.test(v)) out.push(v);
        }
      } catch (e) {}
    }
    scan(sessionStorage);
    scan(localStorage);
    return out;
  }

  function verifyToken(candidate) {
    return fetch('/api/v1/agents', { headers: { Authorization: 'Bearer ' + candidate } })
      .then(function (r) { return r.status === 200; })
      .catch(function () { return false; });
  }

  function bootWithToken(candidate) {
    token = candidate;
    if (token) $('back-link').href = '/#token=' + encodeURIComponent(token);
    $('auth-panel').hidden = true;
    $('main-card').hidden = false;
    loadToolOptions();
    loadModelCatalog();
    load();
  }

  function showAuthPanel() {
    $('auth-panel').hidden = false;
    $('main-card').hidden = true;
    $('rows').innerHTML = '';
  }

  function tryCandidates(list, index) {
    if (index >= list.length) { showAuthPanel(); return; }
    verifyToken(list[index]).then(function (ok) {
      if (ok) bootWithToken(list[index]);
      else tryCandidates(list, index + 1);
    });
  }

  $('auth-go').onclick = function () {
    var candidate = $('auth-token').value.trim();
    if (!candidate) return;
    verifyToken(candidate).then(function (ok) {
      if (ok) bootWithToken(candidate);
      else $('auth-error').textContent = '令牌无效，请重新复制';
    });
  };

  function loadToolOptions() {
    fetch('/api/v1/agents/tool-options', { headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.j && res.j.code !== 0)) return;
        toolOptions = (res.j.data && res.j.data.tools) || [];
        renderToolBoxes();
      })
      .catch(function () {});
  }

  $('f-delegate').addEventListener('change', function () {
    setDelegateChecks($('f-delegate').checked === false);
  });

  function setDelegateChecks(checked) {
    var boxes = document.querySelectorAll('#tools-deny-box input[type=checkbox]');
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].value === 'Agent' || boxes[i].value === 'AgentSwarm') {
        boxes[i].checked = checked;
        boxes[i].disabled = true;
      }
    }
  }

  function renderToolBoxes() {
    ['tools-allow-box', 'tools-deny-box'].forEach(function (boxId) {
      var box = $(boxId);
      box.textContent = '';
      toolOptions.forEach(function (tool) {
        if (boxId === 'tools-allow-box' && (tool.name === 'Agent' || tool.name === 'AgentSwarm')) return;
        var label = document.createElement('label');
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.value = tool.name;
        input.setAttribute('data-box', boxId);
        var name = document.createElement('span');
        name.className = 'tname';
        name.textContent = tool.name;
        var desc = document.createElement('span');
        desc.className = 'tdesc';
        desc.textContent = tool.description || '';
        label.appendChild(input);
        label.appendChild(name);
        label.appendChild(desc);
        box.appendChild(label);
      });
    });
  }

  function setBoxChecks(boxId, names) {
    var boxes = document.querySelectorAll('#' + boxId + ' input[type=checkbox]');
    for (var i = 0; i < boxes.length; i++) {
      boxes[i].checked = names.indexOf(boxes[i].value) !== -1;
    }
  }

  function checkedNames(boxId) {
    var out = [];
    var boxes = document.querySelectorAll('#' + boxId + ' input[type=checkbox]');
    for (var i = 0; i < boxes.length; i++) {
      if (boxes[i].checked) out.push(boxes[i].value);
    }
    return out;
  }

  $('f-tools-all').addEventListener('change', function () {
    $('tools-allow-wrap').hidden = $('f-tools-all').checked;
  });

  function loadModelCatalog() {
    fetch('/api/v1/models', { headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.j && res.j.code !== 0)) return;
        var items = (res.j.data && res.j.data.items) || [];
        modelCatalog = {};
        items.forEach(function (item) {
          var alias = item.provider + '/' + item.model;
          modelCatalog[alias] = item;
        });
        refreshEffortOptions();
      })
      .catch(function () {});
  }

  function modelItems() {
    return Object.keys(modelCatalog).map(function (alias) { return modelCatalog[alias]; });
  }

  function subseqMatch(needle, haystack) {
    if (!needle) return true;
    var n = needle.toLowerCase();
    var h = haystack.toLowerCase();
    var i = 0;
    for (var j = 0; j < h.length && i < n.length; j++) {
      if (h[j] === n[i]) i++;
    }
    return i === n.length;
  }

  function renderModelDropdown(query) {
    var dd = $('model-dropdown');
    dd.textContent = '';
    var q = (query || '').trim();
    var items = modelItems().filter(function (item) {
      return subseqMatch(q, item.provider + '/' + item.model) || subseqMatch(q, item.model);
    });
    if (!items.length) {
      var empty = document.createElement('div');
      empty.className = 'empty';
      empty.textContent = '没有匹配的模型';
      dd.appendChild(empty);
      dd.hidden = false;
      return;
    }
    var byProvider = {};
    var order = [];
    items.forEach(function (item) {
      if (!byProvider[item.provider]) { byProvider[item.provider] = []; order.push(item.provider); }
      byProvider[item.provider].push(item);
    });
    order.forEach(function (provider) {
      var group = document.createElement('div');
      group.className = 'group';
      group.textContent = provider;
      dd.appendChild(group);
      byProvider[provider].forEach(function (item) {
        var opt = document.createElement('div');
        opt.className = 'opt';
        opt.setAttribute('data-alias', item.provider + '/' + item.model);
        var mid = document.createElement('span');
        mid.className = 'mid';
        mid.textContent = item.model;
        var mdesc = document.createElement('span');
        mdesc.className = 'mdesc';
        mdesc.textContent = item.display_name && item.display_name !== item.model ? item.display_name : '';
        opt.appendChild(mid);
        opt.appendChild(mdesc);
        opt.onmousedown = function (e) {
          e.preventDefault();
          pickModel(item.provider + '/' + item.model);
        };
        dd.appendChild(opt);
      });
    });
    dd.hidden = false;
  }

  function pickModel(alias) {
    $('f-model').value = alias;
    $('f-model-alias').value = alias;
    $('model-dropdown').hidden = true;
    refreshEffortOptions();
  }

  $('f-model').addEventListener('input', function () {
    $('f-model-alias').value = '';
    renderModelDropdown(this.value);
    refreshEffortOptions();
  });
  $('f-model').addEventListener('focus', function () { renderModelDropdown(this.value); });
  $('f-model').addEventListener('blur', function () {
    setTimeout(function () { $('model-dropdown').hidden = true; }, 150);
  });

  function effortChoices(item) {
    var full = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];
    if (item && item.support_efforts && item.support_efforts.length) {
      var set = item.support_efforts.slice();
      if (set.indexOf('off') === -1) set.unshift('off');
      return set;
    }
    return full;
  }

  function selectedModelItem() {
    var alias = $('f-model-alias').value;
    return alias ? modelCatalog[alias] : undefined;
  }

  function effortLabel(value) {
    if (value === 'off') return '关闭思考（off）';
    return value;
  }

  function refreshEffortOptions() {
    var item = selectedModelItem();
    var sel = $('f-thinking');
    var current = sel.value;
    var choices = effortChoices(item);
    sel.textContent = '';
    var unset = document.createElement('option');
    unset.value = '';
    unset.textContent = '跟随默认（不设置）';
    sel.appendChild(unset);
    choices.forEach(function (effort) {
      var opt = document.createElement('option');
      opt.value = effort;
      opt.textContent = effortLabel(effort);
      sel.appendChild(opt);
    });
    var custom = document.createElement('option');
    custom.value = '__custom__';
    custom.textContent = '自定义值…';
    sel.appendChild(custom);
    var hint = $('effort-hint');
    if (!item) {
      hint.textContent = '未选模型：可选全部通用等级；选择模型后按该模型支持范围收敛';
      if (current && current !== '__custom__') sel.value = current;
      syncThinkingCustom();
      return;
    }
    var efforts = item.support_efforts || [];
    if (!efforts.length) {
      hint.textContent = '该模型不支持推理等级调节';
      lastAutoEffort = null;
      sel.value = '';
      syncThinkingCustom();
      return;
    }
    var auto = item.default_effort || efforts[efforts.length - 1];
    if (current === '' || current === lastAutoEffort || choices.indexOf(current) === -1) {
      sel.value = auto;
    } else {
      sel.value = current;
    }
    lastAutoEffort = auto;
    hint.textContent = '支持 ' + efforts.join(' / ') + '，模型默认 ' + auto + '（可改）';
    syncThinkingCustom();
  }

  function syncThinkingCustom() {
    var isCustom = $('f-thinking').value === '__custom__';
    $('thinking-custom-label').hidden = !isCustom;
    $('f-thinking-custom').hidden = !isCustom;
  }

  $('f-thinking').addEventListener('change', syncThinkingCustom);

  function load() {
    $('list-error').textContent = '';
    fetch('/api/v1/agents', { headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.status === 401) { showAuthPanel(); return; }
        if (!res.ok || (res.j && res.j.code !== 0)) { showError($('list-error'), res.j); return; }
        var agents = (res.j.data && res.j.data.agents) || [];
        var body = $('rows');
        body.textContent = '';
        if (!agents.length) {
          var empty = document.createElement('tr');
          var cell = document.createElement('td');
          cell.colSpan = 5;
          cell.className = 'muted';
          cell.textContent = '还没有自定义子智能体，点「新建」创建第一个。';
          empty.appendChild(cell);
          body.appendChild(empty);
          return;
        }
        agents.forEach(function (a) {
          var tr = document.createElement('tr');
          var tdName = document.createElement('td');
          tdName.className = 'name';
          tdName.textContent = a.name;
          var tdDesc = document.createElement('td');
          tdDesc.textContent = a.description;
          var tdWhen = document.createElement('td');
          tdWhen.textContent = a.whenToUse || '';
          var tdModel = document.createElement('td');
          tdModel.className = 'muted';
          tdModel.textContent = (a.model || '继承主 Agent') + (a.thinking ? ' / ' + a.thinking : '');
          var tdOps = document.createElement('td');
          tdOps.style.whiteSpace = 'nowrap';
          var edit = document.createElement('button');
          edit.textContent = '编辑';
          edit.onclick = function () { openEditor(a); };
          var del = document.createElement('button');
          del.className = 'danger';
          del.textContent = '删除';
          del.style.marginLeft = '6px';
          del.onclick = function () { remove(a.name); };
          tdOps.appendChild(edit);
          tdOps.appendChild(del);
          tr.appendChild(tdName); tr.appendChild(tdDesc); tr.appendChild(tdWhen); tr.appendChild(tdModel); tr.appendChild(tdOps);
          body.appendChild(tr);
        });
      })
      .catch(function (e) { showError($('list-error'), { error: { message: String(e) } }); });
  }

  function openEditor(agent) {
    editing = agent ? agent.name : null;
    $('editor-title').textContent = agent ? '编辑 ' + agent.name : '新建子智能体';
    $('f-name').value = agent ? agent.name : '';
    $('f-name').disabled = !!agent;
    $('f-desc').value = agent ? agent.description : '';
    $('f-when').value = (agent && agent.whenToUse) || '';
    var allowAll = !(agent && agent.tools);
    $('f-tools-all').checked = allowAll;
    $('tools-allow-wrap').hidden = allowAll;
    setBoxChecks('tools-allow-box', (agent && agent.tools) || []);
    var deny = ((agent && agent.disallowedTools) || []).filter(function (n) { return n !== 'Agent' && n !== 'AgentSwarm'; });
    setBoxChecks('tools-deny-box', deny);
    $('f-subagents').value = (agent && agent.subagents) ? agent.subagents.join(', ') : '';
    var alias = (agent && agent.model) || '';
    $('f-model').value = alias;
    $('f-model-alias').value = alias;
    lastAutoEffort = null;
    var savedThinking = (agent && agent.thinking) || '';
    refreshEffortOptions();
    if (savedThinking) {
      var sel = $('f-thinking');
      if (Array.prototype.some.call(sel.options, function (o) { return o.value === savedThinking; })) {
        sel.value = savedThinking;
      } else {
        sel.value = '__custom__';
        $('f-thinking-custom').value = savedThinking;
      }
      syncThinkingCustom();
    }
    $('f-delegate').checked = agent ? !((agent.disallowedTools || []).indexOf('Agent') !== -1) : false;
    setDelegateChecks($('f-delegate').checked === false);
    $('f-prompt').value = agent ? agent.prompt : '';
    $('form-error').textContent = '';
    $('editor-overlay').hidden = false;
    $('f-name').focus();
  }

  function closeEditor() {
    $('editor-overlay').hidden = true;
  }

  function remove(name) {
    if (!confirm('删除子智能体 "' + name + '"？')) return;
    fetch('/api/v1/agents/' + encodeURIComponent(name), { method: 'DELETE', headers: authHeaders() })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.j && res.j.code !== 0)) { showError($('list-error'), res.j); return; }
        load();
      })
      .catch(function (e) { showError($('list-error'), { error: { message: String(e) } }); });
  }

  $('new-btn').onclick = function () { openEditor(null); };
  $('cancel-btn').onclick = function () { closeEditor(); };
  $('panel-close').onclick = function () { closeEditor(); };
  $('editor-overlay').addEventListener('mousedown', function (e) {
    if (e.target === this) closeEditor();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('model-dropdown').hidden) { $('model-dropdown').hidden = true; return; }
    if (!$('editor-overlay').hidden) closeEditor();
  });

  $('editor').addEventListener('submit', function (event) {
    event.preventDefault();
    $('form-error').textContent = '';
    var payload = {
      name: $('f-name').value.trim(),
      description: $('f-desc').value.trim(),
      prompt: $('f-prompt').value.trim()
    };
    var when = $('f-when').value.trim();
    if (when) payload.whenToUse = when;
    if (!$('f-tools-all').checked) payload.tools = checkedNames('tools-allow-box');
    var deny = checkedNames('tools-deny-box');
    if (deny.length) payload.disallowedTools = deny;
    var subagents = splitList($('f-subagents').value);
    if (subagents) payload.subagents = subagents;
    if ($('f-delegate').checked) payload.delegate = true;
    var model = $('f-model-alias').value;
    if (model) payload.model = model;
    var thinkingSel = $('f-thinking').value;
    var thinking = thinkingSel === '__custom__' ? $('f-thinking-custom').value.trim() : thinkingSel;
    if (thinking) payload.thinking = thinking;
    var method = editing ? 'PUT' : 'POST';
    var url = editing ? '/api/v1/agents/' + encodeURIComponent(editing) : '/api/v1/agents';
    fetch(url, { method: method, headers: jsonHeaders(), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.j && res.j.code !== 0)) { showError($('form-error'), res.j); return; }
        closeEditor();
        load();
      })
      .catch(function (e) { showError($('form-error'), { error: { message: String(e) } }); });
  });

  tryCandidates(tokenCandidates(), 0);
})();
</script>
</body>
</html>
`;
