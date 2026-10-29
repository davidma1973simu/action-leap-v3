/* ============================================================
 * Action Leap V3 · 协作批注模块（ALCM）
 * 协作人（培训负责人 / 业务领导）只读，但可在任意位置留建议；
 * Owner（讲师）看到未处理数量，可就地标记已处理。
 *
 * 用法：
 *   ALCM.init({ courseId, projectId, isOwner, me, onChange })
 *   在需要批注的位置放：<button class="cmt-btn"
 *       data-cmt-kind="fw_row" data-cmt-ref="行id" data-cmt-label="第3行 · 掌握新方法"></button>
 *   渲染后调用 ALCM.decorate(容器) 填充图标与计数。
 *   Owner 收件箱：ALCM.inboxHTML()
 * ============================================================ */
(function (global) {
  'use strict';
  var A = global.ALC;

  var ctx = null;
  var all = [];
  var onChange = null;
  var modal = null;

  var ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
    'stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" ' +
    'style="vertical-align:-2px;margin-right:4px">' +
    '<path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.9 8.9 0 0 1-3.8-.9L3 21l1.9-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z"/></svg>';

  function esc(s) { return A.esc(s); }
  function key(kind, ref) { return (kind || '') + '::' + (ref == null ? '' : ref); }

  function init(o) {
    ctx = o || {};
    onChange = o && o.onChange;
    return load();
  }

  function load() {
    if (!ctx || !ctx.courseId || !A) return Promise.resolve([]);
    return A.listComments(ctx.courseId).then(function (list) {
      all = list || [];
      decorate(document);
      if (onChange) onChange(all);
      return all;
    }).catch(function () { all = []; return all; });
  }

  function group() {
    var m = {};
    all.forEach(function (c) {
      var k = key(c.target_kind, c.target_ref);
      (m[k] = m[k] || []).push(c);
    });
    return m;
  }

  function openCount() {
    return all.filter(function (c) { return c.status === 'open'; }).length;
  }

  /* 给按钮填充图标与未处理计数 */
  function decorate(root) {
    root = root || document;
    var g = group();
    var els = root.querySelectorAll('[data-cmt-kind]');
    Array.prototype.forEach.call(els, function (el) {
      var k = key(el.getAttribute('data-cmt-kind'), el.getAttribute('data-cmt-ref'));
      var open = (g[k] || []).filter(function (c) { return c.status === 'open'; }).length;
      el.classList.toggle('has-open', open > 0);
      el.innerHTML = ICON + '建议' + (open ? '<span class="n">' + open + '</span>' : '');
      el.title = open ? (open + ' 条未处理建议') : '在这里留一条建议';
    });
  }

  /* ---------------- 浮层 ---------------- */
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'cmt-mask';
    modal.innerHTML =
      '<div class="cmt-modal">' +
        '<div class="cmt-head">' +
          '<div><div class="eyebrow">协作建议</div><h3 id="cmtAnchor">位置</h3></div>' +
          '<button class="cmt-x" data-cmt-close type="button" aria-label="关闭">&times;</button>' +
        '</div>' +
        '<div id="cmtList" class="cmt-list"></div>' +
        '<label>你的建议（针对这一处）</label>' +
        '<textarea id="cmtBody" rows="4" placeholder="这里哪里需要改、改什么、为什么。说具体一点，Owner 才好处理。"></textarea>' +
        '<div class="cmt-actions">' +
          '<button class="btn sm" data-cmt-submit type="button">提交建议</button>' +
          '<button class="btn ghost sm" data-cmt-close type="button">关闭</button>' +
          '<span id="cmtHint" class="meta"></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(modal);
    return modal;
  }

  var cur = null; // { kind, ref, label }

  function openModal(kind, ref, label) {
    ensureModal();
    cur = { kind: kind, ref: ref, label: label || '' };
    modal.querySelector('#cmtAnchor').textContent = label || '这一处';
    modal.querySelector('#cmtBody').value = '';
    modal.querySelector('#cmtHint').textContent = '';
    renderList();
    modal.classList.add('show');
    setTimeout(function () { modal.querySelector('#cmtBody').focus(); }, 60);
  }
  function closeModal() { if (modal) modal.classList.remove('show'); }

  function renderList() {
    var box = modal.querySelector('#cmtList');
    var list = (group()[key(cur.kind, cur.ref)] || []);
    if (!list.length) {
      box.innerHTML = '<div class="cmt-none">还没有人在这里留建议。写下第一条。</div>';
      return;
    }
    box.innerHTML = list.map(function (c) {
      var who = c.author_name ? (esc(c.author_name) + ' · ' + esc(c.author_email)) : esc(c.author_email || '协作者');
      var when = (c.created_at || '').slice(0, 10) + ' ' + (c.created_at || '').slice(11, 16);
      var cls = c.status === 'resolved' ? ' cmt-resolved' : '';
      var ops = '';
      if (ctx && ctx.isOwner) {
        ops = '<div class="cmt-ops">' +
          (c.status === 'open'
            ? '<button class="btn ghost sm" data-cmt-resolve="' + c.id + '">标记已处理</button>'
            : '<span class="pill">已处理</span>') +
          '<button class="btn ghost sm" data-cmt-del="' + c.id + '">删除</button>' +
          '</div>';
      } else if (c.status === 'resolved') {
        ops = '<div class="cmt-ops"><span class="pill">已处理</span></div>';
      }
      return '<div class="cmt-item' + cls + '">' +
        '<div class="cmt-meta">' + who + ' · ' + when + '</div>' +
        '<div class="cmt-text">' + esc(c.body) + '</div>' + ops + '</div>';
    }).join('');
  }

  function submit() {
    if (!cur) return;
    var body = modal.querySelector('#cmtBody').value.trim();
    if (!body) { modal.querySelector('#cmtHint').textContent = '请先写点内容'; return; }
    var hint = modal.querySelector('#cmtHint');
    hint.textContent = '提交中…';
    A.addComment({
      courseId: ctx.courseId,
      projectId: ctx.projectId || null,
      kind: cur.kind, ref: cur.ref, label: cur.label,
      body: body,
      authorEmail: (ctx.me && ctx.me.email) || '',
      authorName: (ctx.me && ctx.me.name) || ''
    }).then(function () {
      hint.textContent = '';
      modal.querySelector('#cmtBody').value = '';
      return load();
    }).then(function () {
      renderList();
      hint.textContent = '已提交，Owner 会收到';
    }).catch(function (e) {
      hint.textContent = '提交失败：' + (e.message || e);
    });
  }

  function resolve(id) {
    A.setCommentStatus(id, 'resolved').then(function () {
      toast('已标记为已处理');
      return load();
    }).then(function () { if (modal && modal.classList.contains('show')) renderList(); })
      .catch(function (e) { toast('操作失败：' + (e.message || e)); });
  }
  function del(id) {
    if (!confirm('删除这条建议？')) return;
    A.deleteComment(id).then(function () {
      toast('已删除');
      return load();
    }).then(function () { if (modal && modal.classList.contains('show')) renderList(); })
      .catch(function (e) { toast('删除失败：' + (e.message || e)); });
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove('show'); }, 2000);
  }

  /* ---------------- Owner 收件箱 ---------------- */
  function inboxHTML() {
    var open = all.filter(function (c) { return c.status === 'open'; });
    if (!open.length) {
      return '<div class="cmt-none">还没有未处理的协作建议。培训负责人 / 业务领导登录后，可在任意位置留建议。</div>';
    }
    open.sort(function (a, b) { return (b.created_at || '').localeCompare(a.created_at || ''); });
    return open.map(function (c) {
      var who = c.author_name ? (esc(c.author_name) + ' · ' + esc(c.author_email)) : esc(c.author_email || '协作者');
      var when = (c.created_at || '').slice(0, 10) + ' ' + (c.created_at || '').slice(11, 16);
      return '<div class="cmt-item">' +
        '<div class="cmt-meta">' + who + ' · ' + when + '</div>' +
        '<div class="cmt-anchor">位置：' + esc(c.anchor_label || '未标注') + '</div>' +
        '<div class="cmt-text">' + esc(c.body) + '</div>' +
        '<div class="cmt-ops"><button class="btn ghost sm" data-cmt-resolve="' + c.id + '">标记已处理</button></div>' +
      '</div>';
    }).join('');
  }

  /* ---------------- 全局事件委托 ---------------- */
  document.addEventListener('click', function (e) {
    var t = e.target;

    var btn = t.closest && t.closest('[data-cmt-kind]');
    if (btn) {
      e.preventDefault();
      openModal(btn.getAttribute('data-cmt-kind'), btn.getAttribute('data-cmt-ref'),
        btn.getAttribute('data-cmt-label'));
      return;
    }
    if (t.closest && t.closest('[data-cmt-close]')) { closeModal(); return; }
    if (t.closest && t.closest('[data-cmt-submit]')) { submit(); return; }

    var r = t.closest && t.closest('[data-cmt-resolve]');
    if (r) { resolve(r.getAttribute('data-cmt-resolve')); return; }

    var d = t.closest && t.closest('[data-cmt-del]');
    if (d) { del(d.getAttribute('data-cmt-del')); return; }
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeModal();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && modal && modal.classList.contains('show')) submit();
  });

  global.ALCM = {
    init: init, load: load, decorate: decorate,
    openCount: openCount, inboxHTML: inboxHTML,
    open: openModal, close: closeModal,
    getContext: function () { return ctx; }
  };
})(window);
