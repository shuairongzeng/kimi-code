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
    input, textarea { background: #14161a; color: #e6e8eb; border-color: #2c3138; }
    .muted { color: #9aa0a6; }
  }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #6b7280; }
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
  input, textarea {
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
</style>
</head>
<body>
<h1>自定义子智能体</h1>
<p class="muted">
  在这里创建、编辑或删除自定义子智能体。保存后主 Agent 的 task 工具立即可见并可派活；
  文件存放在 <code>~/.zimi-code/agents/*.md</code>。
</p>

<div class="card">
  <table>
    <thead><tr><th>名称</th><th>描述</th><th>使用时机</th><th>模型 / 推理</th><th></th></tr></thead>
    <tbody id="rows"><tr><td colspan="5" class="muted">加载中…</td></tr></tbody>
  </table>
  <p style="margin:12px 0 0"><button class="primary" id="new-btn">+ 新建子智能体</button></p>
  <div class="error" id="list-error"></div>
</div>

<form class="card" id="editor" hidden>
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
  <div class="row">
    <div>
      <label for="f-tools">工具白名单（可选，逗号分隔）</label>
      <input id="f-tools" placeholder="留空 = 全部工具" />
    </div>
    <div>
      <label for="f-disallowed">禁用工具（可选，逗号分隔）</label>
      <input id="f-disallowed" placeholder="例如 Bash" />
    </div>
  </div>
  <label for="f-subagents">允许调用的子智能体（可选，逗号分隔）</label>
  <input id="f-subagents" placeholder="留空 = 默认" />
  <div class="row">
    <div>
      <label for="f-model">默认模型（可选）</label>
      <input id="f-model" list="model-options-list" placeholder="留空 = 继承主 Agent 模型" />
      <datalist id="model-options-list"></datalist>
    </div>
    <div>
      <label for="f-thinking">推理等级（可选）</label>
      <input id="f-thinking" list="effort-options-list" placeholder="选模型后自动带出，可手改" />
      <datalist id="effort-options-list"></datalist>
      <div class="hint" id="effort-hint">选择模型后按该模型支持等级自动填写</div>
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

<script>
(function () {
  var token = (location.hash.match(/token=([^&]+)/) || [])[1] || '';
  var authHeadersOnly = {};
  if (token) authHeadersOnly['Authorization'] = 'Bearer ' + token;
  function jsonHeaders() {
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }
  var editing = null;
  var modelCatalog = {};
  var lastAutoEffort = null;

  function $(id) { return document.getElementById(id); }
  function splitList(value) {
    var items = value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    return items.length ? items : undefined;
  }
  function showError(el, payload) {
    var message = (payload && payload.msg) || (payload && payload.error && payload.error.message) || '请求失败';
    el.textContent = message;
  }

  function loadModelCatalog() {
    fetch('/api/v1/models', { headers: authHeadersOnly })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.j && res.j.code !== 0)) return;
        var items = (res.j.data && res.j.data.items) || [];
        var list = $('model-options-list');
        list.textContent = '';
        items.forEach(function (item) {
          var alias = item.provider + '/' + item.model;
          modelCatalog[alias] = item;
          var opt = document.createElement('option');
          opt.value = alias;
          list.appendChild(opt);
        });
      })
      .catch(function () {});
  }

  function refreshEffortOptions() {
    var alias = $('f-model').value.trim();
    var item = modelCatalog[alias];
    var list = $('effort-options-list');
    list.textContent = '';
    var hint = $('effort-hint');
    if (!item) {
      hint.textContent = '选择模型后按该模型支持等级自动填写';
      return;
    }
    var efforts = item.support_efforts || [];
    efforts.forEach(function (effort) {
      var opt = document.createElement('option');
      opt.value = effort;
      list.appendChild(opt);
    });
    if (!efforts.length) {
      hint.textContent = '该模型不支持推理等级调节';
      lastAutoEffort = null;
      return;
    }
    var auto = item.default_effort || efforts[efforts.length - 1];
    var current = $('f-thinking').value.trim();
    if (current === '' || current === lastAutoEffort) {
      $('f-thinking').value = auto;
    }
    lastAutoEffort = auto;
    hint.textContent = '支持 ' + efforts.join(' / ') + '，模型默认 ' + auto + '（可手改）';
  }

  function load() {
    $('list-error').textContent = '';
    fetch('/api/v1/agents', { headers: authHeadersOnly })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
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
    $('f-tools').value = (agent && agent.tools) ? agent.tools.join(', ') : '';
    $('f-disallowed').value = (agent && agent.disallowedTools) ? agent.disallowedTools.join(', ') : '';
    $('f-subagents').value = (agent && agent.subagents) ? agent.subagents.join(', ') : '';
    $('f-model').value = (agent && agent.model) || '';
    $('f-thinking').value = (agent && agent.thinking) || '';
    lastAutoEffort = null;
    refreshEffortOptions();
    $('f-delegate').checked = !(agent && agent.disallowedTools && agent.disallowedTools.indexOf('Agent') !== -1);
    $('f-prompt').value = agent ? agent.prompt : '';
    $('f-delegate').checked = agent ? $('f-delegate').checked : false;
    $('form-error').textContent = '';
    $('editor').hidden = false;
    $('editor').scrollIntoView({ behavior: 'smooth' });
  }

  function remove(name) {
    if (!confirm('删除子智能体 "' + name + '"？')) return;
    fetch('/api/v1/agents/' + encodeURIComponent(name), { method: 'DELETE', headers: authHeadersOnly })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.j && res.j.code !== 0)) { showError($('list-error'), res.j); return; }
        load();
      })
      .catch(function (e) { showError($('list-error'), { error: { message: String(e) } }); });
  }

  $('new-btn').onclick = function () { openEditor(null); };
  $('cancel-btn').onclick = function () { $('editor').hidden = true; };
  $('f-model').addEventListener('input', refreshEffortOptions);
  loadModelCatalog();

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
    var tools = splitList($('f-tools').value);
    if (tools) payload.tools = tools;
    var disallowed = splitList($('f-disallowed').value);
    if (disallowed) payload.disallowedTools = disallowed;
    var subagents = splitList($('f-subagents').value);
    if (subagents) payload.subagents = subagents;
    if ($('f-delegate').checked) payload.delegate = true;
    var model = $('f-model').value.trim();
    if (model) payload.model = model;
    var thinking = $('f-thinking').value.trim();
    if (thinking) payload.thinking = thinking;
    var method = editing ? 'PUT' : 'POST';
    var url = editing ? '/api/v1/agents/' + encodeURIComponent(editing) : '/api/v1/agents';
    fetch(url, { method: method, headers: jsonHeaders(), body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || (res.j && res.j.code !== 0)) { showError($('form-error'), res.j); return; }
        $('editor').hidden = true;
        load();
      })
      .catch(function (e) { showError($('form-error'), { error: { message: String(e) } }); });
  });

  load();
})();
</script>
</body>
</html>
`;
