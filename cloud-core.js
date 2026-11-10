/* ============================================================
 * Action Leap V3 · Cloud 数据层（CDN SDK 封装）
 * 初始化一次；Auth / Database / RPC / LLM 全部走同一 client。
 * 命名空间：ALC
 * ============================================================ */
(function (global) {
  'use strict';

  var PC = global.PUBLIC_CONFIG;
  var cloud = null;

  function init() {
    if (cloud) return cloud;
    cloud = WorkBuddyCloud.createWorkBuddyCloud({
      endpoint: PC.endpoint,
      oauthRelayBaseUrl: PC.oauthRelayBaseUrl,
      publishableKey: PC.publishableKey
    });
    return cloud;
  }
  function getCloud() { return cloud || init(); }

  /* ---------------- 工具 ---------------- */
  function uid(pre) {
    var s = '';
    var c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (var i = 0; i < 24; i++) s += c[Math.floor(Math.random() * c.length)];
    return (pre || 'id') + '_' + s;
  }
  function slug(s) {
    return (s || '').toString().trim().toLowerCase()
      .replace(/[^a-zA-Z0-9一-龥_-]/g, '-').replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'item';
  }
  function token(n) {
    n = n || 24;
    var s = '';
    var c = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    for (var i = 0; i < n; i++) s += c[Math.floor(Math.random() * c.length)];
    return s;
  }
  function esc(s) {
    return (s == null ? '' : String(s))
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function emptyFramework() { return []; }

  /* ---------------- 学员卡数据契约（v2） ----------------
   * 讲师只给：method 工具方法 / task 主题任务 / hintScene、hintBehavior 可改写提示
   *           / direction 指标方向（5 选 1，仅用于汇报分组）
   * 学员自己写：scene 工作场景 / behavior 改善什么行为 / metricName+unit 改善哪个指标
   *           / baseline 现在是多少 / goal 想变成多少
   *           / resultImpact 做成了什么 / quantActual 实际值
   * 旧数据行（section/scene/action/target/note）原样保留，各页面按 isNewRow 分别渲染，
   * 不清库、不迁移、不覆盖 —— 两期测试数据仍可正常打开。
   * --------------------------------------------------- */
  var DIRECTIONS = [
    { k: 'efficiency', name: '效率', hint: '周期 / 响应速度 / 等待时间' },
    { k: 'quality',    name: '质量', hint: '准确率 / 返工 / 差错' },
    { k: 'cost',       name: '成本', hint: '费用 / 工时 / 资源投入' },
    { k: 'collab',     name: '协同', hint: '跨部门 / 沟通 / 决策' },
    { k: 'growth',     name: '业绩', hint: '成交 / 收入 / 客户 / 产出' }
  ];
  function directionLabel(k) {
    for (var i = 0; i < DIRECTIONS.length; i++) if (DIRECTIONS[i].k === k) return DIRECTIONS[i].name;
    return '未分类';
  }
  function isNewRow(r) { return !!(r && (r.v === 2 || r.method || r.task)); }
  function newRow() {
    return { id: uid('a'), v: 2, method: '', task: '', hintScene: '', hintBehavior: '', direction: 'efficiency' };
  }
  /* 清洗讲师端一行。新行走新字段；有旧字段的老行原样保留。 */
  function cleanRow(r) {
    r = r || {};
    var legacy = r.section || r.scene || r.action || r.target || r.note;
    if (isNewRow(r) || !legacy) {
      return { id: r.id || uid('a'), v: 2,
        method: r.method || '', task: r.task || '',
        hintScene: r.hintScene || '', hintBehavior: r.hintBehavior || '',
        direction: r.direction || 'efficiency' };
    }
    return { id: r.id || uid('a'), section: r.section || '', scene: r.scene || '',
      action: r.action || '', target: r.target || '',
      direction: r.direction || 'up', note: r.note || '' };
  }
  /* 达成判定：新卡按「现在 → 想变成」自动推断升/降，旧行按讲师设的 up/down。
   * 只用于逐卡明细，不汇总成全班总指标。 */
  function cardAchieved(r) {
    if (!r) return null;
    if (r.v === 2 || (r.goal != null && r.goal !== '')) {
      var b = parseFloat(r.baseline), g = parseFloat(r.goal), a = parseFloat(r.quantActual);
      if (isNaN(g) || isNaN(a)) return null;
      var up = isNaN(b) ? true : (g >= b);
      return up ? (a >= g) : (a <= g);
    }
    if (r.target === '' || r.target == null) return null;
    var t = parseFloat(r.target), av = parseFloat(r.quantActual);
    if (isNaN(t) || isNaN(av)) return null;
    return (r.direction === 'down') ? (av <= t) : (av >= t);
  }

  /* ---------------- Auth（创建者登录，邮箱验证码，无密码） ---------------- */
  var auth = {
    getSession: function () { return getCloud().auth.getSession(); },
    sendOtp: function (email) { return getCloud().auth.sendOtp({ email: email }); },
    verifyOtp: function (p) { return getCloud().auth.verifyOtp(p); },
    signOut: function () { return getCloud().auth.signOut(); },
    onAuthStateChange: function (cb) { return getCloud().auth.onAuthStateChange(cb); }
  };

  /* ---------------- 课程蓝图（创建者所有） ---------------- */
  function listCourses() {
    return getCloud().database.from('courses').select('*')
      .order('created_at', { ascending: false })
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function getCourse(id) {
    return getCloud().database.from('courses').select('*').eq('id', id).single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function saveCourse(course) {
    var payload = {
      theme: course.theme || '', needs: course.needs || '',
      framework: course.framework || [], templates: course.templates || []
    };
    if (course.id) {
      return getCloud().database.from('courses').update(payload).eq('id', course.id)
        .select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
    }
    return getCloud().database.from('courses').insert(payload)
      .select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  /* 删除课程 = 连同它下面所有项目一起删（子表：提交、反馈、评价、批注）
   * 用 SECURITY DEFINER 函数在数据库端一次做完，避免前端逐表删被外键卡住。 */
  function deleteCourse(id) {
    return getCloud().database.rpc('delete_course', { p_id: id })
      .then(function (r) {
        if (r.error) throw r.error;
        if (r.data && r.data.ok === false) throw new Error(r.data.error === 'forbidden' ? '只有创建者可以删除课程' : '课程不存在');
        return true;
      });
  }

  /* ---------------- 项目实例（创建者所有） ---------------- */
  function listProjects(courseId) {
    var q = getCloud().database.from('projects').select('*')
      .order('created_at', { ascending: false });
    if (courseId) q = q.eq('course_id', courseId);
    return q.then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function getProject(id) {
    return getCloud().database.from('projects').select('*').eq('id', id).single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function saveProject(p) {
    var payload = {
      course_id: p.course_id, title: p.title || '',
      client: p.client || '', cohort: p.cohort || '',
      start_date: p.start_date || null, end_date: p.end_date || null,
      students: p.students || [],
      framework: p.framework || [],
      collaborators: p.collaborators || [],
      schedule: p.schedule || {}, wrapup: p.wrapup || {}
    };
    if (p.id) {
      return getCloud().database.from('projects').update(payload).eq('id', p.id)
        .select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
    }
    return getCloud().database.from('projects').insert(payload)
      .select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  /* 删除项目 = 连同它的学员提交、上司反馈、讲师评价、批注一起删。
   * 同样走数据库函数，外键是 NO ACTION，前端逐表删会被卡住。 */
  function deleteProject(id) {
    return getCloud().database.rpc('delete_project', { p_id: id })
      .then(function (r) {
        if (r.error) throw r.error;
        if (r.data && r.data.ok === false) throw new Error(r.data.error === 'forbidden' ? '只有创建者可以删除项目' : '项目不存在');
        return true;
      });
  }

  /* 时间线（4 阶段）与复盘萃取 */
  function defaultSchedule() {
    var d = new Date();
    return {
      startDate: d.toISOString().slice(0, 10),
      phases: [
        { key: 'fill', label: '学员填写', weeks: 1 },
        { key: 'sup', label: '上司反馈', weeks: 1 },
        { key: 'submit', label: '学员提交', weeks: 1 },
        { key: 'review', label: '讲师评价 / 案例', weeks: 1 }
      ],
      closed: false
    };
  }
  function isoDate(d) { return d.toISOString().slice(0, 10); }
  function parseDate(s) {
    if (!s) return null;
    var d = new Date(s + (s.length === 10 ? 'T00:00:00' : ''));
    return isNaN(d.getTime()) ? null : d;
  }
  function phaseInfo(project, nowDate) {
    nowDate = nowDate || new Date();
    var sch = (project && project.schedule) || {};
    var start = parseDate(sch.startDate);
    if (!start) return null;
    var phases = (sch.phases && sch.phases.length)
      ? sch.phases
      : defaultSchedule().phases;
    var dayMs = 86400000;
    var cursor = new Date(start.getTime());
    var list = [];
    var totalDays = 0;
    phases.forEach(function (p, i) {
      var w = Math.max(1, Math.round(+p.weeks) || 1);
      var s = new Date(cursor.getTime());
      var e = new Date(cursor.getTime() + w * 7 * dayMs);
      list.push({ index: i, key: p.key, label: p.label, weeks: w, start: s, end: e, startStr: isoDate(s), endStr: isoDate(e) });
      cursor = e; totalDays += w * 7;
    });
    var endAll = new Date(start.getTime() + totalDays * dayMs);
    var statusList = list.map(function (p) {
      if (nowDate >= p.end) return 'done';
      if (nowDate >= p.start) return 'active';
      return 'todo';
    });
    var idx = -1;
    list.forEach(function (p, i) { if (nowDate >= p.start && nowDate < p.end) idx = i; });
    var currentLabel = idx >= 0 ? list[idx].label
      : (nowDate < start ? '尚未开始' : '已全部阶段结束');
    return {
      hasSchedule: true, startStr: isoDate(start), endStr: isoDate(endAll),
      phases: list.map(function (p, i) { return Object.assign({}, p, { status: statusList[i] }); }),
      currentIndex: idx, currentLabel: currentLabel,
      started: nowDate >= start, ended: nowDate >= endAll,
      closed: !!sch.closed, totalWeeks: Math.round(totalDays / 7)
    };
  }
  function saveWrapup(pid, wrapup) {
    return getCloud().database.from('projects').update({ wrapup: wrapup })
      .eq('id', pid).select().single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  /* ---------------- 免登录 RPC（学员 / 上司，令牌校验） ---------------- */
  function getProjectForStudent(pid, tok) {
    return getCloud().database.rpc('get_project_for_student', { p_pid: pid, p_tok: tok })
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function saveSubmission(pid, tok, rows, completed) {
    return getCloud().database.rpc('save_submission',
      { p_pid: pid, p_tok: tok, p_rows: rows, p_completed: !!completed })
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function getSubmissionForSup(pid, tok, suptok) {
    return getCloud().database.rpc('get_submission_for_sup',
      { p_pid: pid, p_tok: tok, p_suptok: suptok })
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function saveSupFeedback(pid, tok, suptok, overall, suggestions, commitment) {
    return getCloud().database.rpc('save_sup_feedback',
      { p_pid: pid, p_tok: tok, p_suptok: suptok, p_overall: overall,
        p_suggestions: suggestions, p_commitment: commitment })
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  /* ---------------- 评价阶段读取（创建者，owner 隔离） ---------------- */
  function getSubmissions(pid) {
    return getCloud().database.from('submissions').select('*').eq('project_id', pid)
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function getFeedback(pid) {
    return getCloud().database.from('supervisor_feedback').select('*').eq('project_id', pid)
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function getReviews(pid) {
    return getCloud().database.from('trainer_reviews').select('*').eq('project_id', pid)
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function saveReview(review) {
    if (review.id) {
      return getCloud().database.from('trainer_reviews').update({
        rating: review.rating, comment: review.comment, exemplar: review.exemplar
      }).eq('id', review.id).select().single()
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    }
    return getCloud().database.from('trainer_reviews').insert({
      project_id: review.project_id, student_token: review.student_token,
      rating: review.rating, comment: review.comment, exemplar: review.exemplar
    }).select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  /* ---------------- 课程模版库（组织资产，可增删改） ----------------
   * 同一门课里「方法 + 场景 + 行动」相同的范例视为同一条：再次固化只更新内容，
   * 不重复堆一张卡（旧版是 push，重复点会堆出一串一模一样的卡片）。
   * 写入一律整表覆盖，避免多条并发 read-modify-write 互相吞掉。
   * ------------------------------------------------------------ */
  function templateKey(t) {
    var parts = (isNewRow(t) || t.behavior)
      ? ['v2', t.scene, t.behavior, t.task]
      : [t.section, t.action, t.scene];
    return parts.map(function (s) {
      return String(s || '').replace(/\s+/g, '').toLowerCase();
    }).join('|');
  }
  function saveTemplates(courseId, list) {
    return getCloud().database.from('courses').update({ templates: list || [] })
      .eq('id', courseId).select().single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function appendTemplates(courseId, incoming) {
    return getCourse(courseId).then(function (course) {
      var list = (course.templates || []).slice();
      var idx = {};
      list.forEach(function (t, i) { idx[templateKey(t)] = i; });
      (incoming || []).forEach(function (t) {
        var k = templateKey(t);
        if (idx[k] !== undefined && idx[k] !== null) {
          var old = list[idx[k]];
          list[idx[k]] = Object.assign({}, old, {
            section: t.section || old.section, action: t.action || old.action,
            scene: t.scene || old.scene, target: t.target || old.target,
            method: t.method || old.method, task: t.task || old.task,
            behavior: t.behavior || old.behavior, metricName: t.metricName || old.metricName,
            unit: t.unit || old.unit, baseline: t.baseline || old.baseline,
            goal: t.goal || old.goal, direction: t.direction || old.direction,
            resultImpact: t.resultImpact || old.resultImpact,
            quantActual: t.quantActual || old.quantActual,
            source: t.source || old.source,
            updatedAt: new Date().toISOString()
          });
        } else {
          idx[k] = list.length;
          list.push(t);
        }
      });
      return saveTemplates(courseId, list);
    });
  }
  function updateTemplate(courseId, templateId, patch) {
    return getCourse(courseId).then(function (course) {
      var list = (course.templates || []).map(function (t) {
        return (t.id === templateId) ? Object.assign({}, t, patch, { updatedAt: new Date().toISOString() }) : t;
      });
      return saveTemplates(courseId, list);
    });
  }
  function removeTemplate(courseId, templateId) {
    return getCourse(courseId).then(function (course) {
      var list = (course.templates || []).filter(function (t) { return t.id !== templateId; });
      return saveTemplates(courseId, list);
    });
  }
  function appendTemplate(courseId, template) { return appendTemplates(courseId, [template]); }

  /* ---------------- 当前登录身份（uid + email + 是否管理员） ---------------- */
  function whoami() {
    return getCloud().database.rpc('whoami')
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data || { uid: '', email: '', isAdmin: false };
      });
  }
  /* 移交管理权限：数据库端校验调用者是不是当前管理员，并把全部数据换到新账号名下 */
  function transferAdmin(email) {
    return getCloud().database.rpc('transfer_admin', { p_new_email: email })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data || { ok: false, error: '移交失败' };
      });
  }

  /* ---------------- 超级管理员：管理员与工作空间 ----------------
   * 一个应用一个超级管理员；超级管理员可以把某个邮箱开成管理员。
   * 每位管理员有独立工作空间（读策略按 owner / 成员判定），互相看不到数据。
   * ------------------------------------------------------------- */
  function listAdmins() {
    return getCloud().database.rpc('admin_list')
      .then(function (r) {
        if (r.error) throw r.error;
        if (r.data && r.data.ok === false) throw new Error(r.data.error || '读取失败');
        return (r.data && r.data.admins) || [];
      });
  }
  function grantAdmin(email, name) {
    return getCloud().database.rpc('admin_grant', { p_email: email, p_name: name || '' })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data || { ok: false, error: '添加失败' };
      });
  }
  function setAdminStatus(email, status) {
    return getCloud().database.rpc('admin_set_status', { p_email: email, p_status: status })
      .then(function (r) {
        if (r.error) throw r.error;
        return r.data || { ok: false, error: '操作失败' };
      });
  }
  /* 数据移交：把一门课程（含其项目、学员名单与填写、上司反馈、讲师评价）
   * 整体挂到另一位管理员名下。传 courseId = null 表示全部课程。
   * 只换归属，不复制数据；移交后原主人不再看到它（超级管理员例外，他始终可见全部）。 */
  function transferData(toEmail, courseId) {
    return getCloud().database.rpc('transfer_data', {
      p_to_email: toEmail,
      p_course_id: (courseId == null || courseId === '') ? null : courseId
    }).then(function (r) {
      if (r.error) throw r.error;
      return r.data || { ok: false, error: '移交失败' };
    });
  }

  /* ---------------- 项目协作人（只读共享：甲方培训负责人） ----------------
   * 协作人绑定在「项目」上：同一个课程的不同期次，可以邀请不同的人。
   * 他们凭自己的邮箱登录，能看到本项目所在的课程、本项目迁移表、学员填写、反馈、报表。
   * 写入权限仍在 owner 手上（数据库 RLS 已限制），协作人只能批注。
   * ------------------------------------------------------------------ */
  function listCollaborators(projectId) {
    return getProject(projectId).then(function (p) { return p.collaborators || []; });
  }
  function addCollaborator(projectId, email, name, role) {
    var e = (email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return Promise.reject(new Error('请输入有效邮箱'));
    return getProject(projectId).then(function (p) {
      var list = p.collaborators || [];
      var dup = list.some(function (x) { return (x.email || '').toLowerCase() === e; });
      if (dup) throw new Error('该邮箱已在本项目协作人列表中');
      list.push({ email: e, name: (name || '').trim(), role: role || 'viewer', addedAt: new Date().toISOString() });
      return getCloud().database.from('projects').update({ collaborators: list })
        .eq('id', projectId).select().single()
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    });
  }
  function removeCollaborator(projectId, email) {
    var e = (email || '').trim().toLowerCase();
    return getProject(projectId).then(function (p) {
      var list = (p.collaborators || []).filter(function (x) { return (x.email || '').toLowerCase() !== e; });
      return getCloud().database.from('projects').update({ collaborators: list })
        .eq('id', projectId).select().single()
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    });
  }

  /* 只改「本项目的迁移表」（不动其它字段，避免覆盖名单 / 时间线） */
  function saveProjectRows(projectId, rows) {
    return getCloud().database.from('projects').update({ framework: rows || [] })
      .eq('id', projectId).select().single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }

  /* ---------------- 批注（协作人在任意位置留建议） ---------------- */
  function listComments(courseId) {
    return getCloud().database.from('comments').select('*').eq('course_id', courseId)
      .order('created_at', { ascending: true })
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function addComment(c) {
    return getCloud().database.from('comments').insert({
      course_id: c.courseId,
      project_id: c.projectId || null,
      target_kind: c.kind,
      target_ref: String(c.ref == null ? '' : c.ref),
      anchor_label: c.label || '',
      body: c.body,
      author_email: c.authorEmail || '',
      author_name: c.authorName || '',
      status: 'open'
    }).select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function listOpenComments() {
    return getCloud().database.from('comments').select('*').eq('status', 'open')
      .order('created_at', { ascending: false })
      .then(function (r) { if (r.error) throw r.error; return r.data || []; });
  }
  function setCommentStatus(id, status) {
    return getCloud().database.from('comments').update({
      status: status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null
    }).eq('id', id).select().single()
      .then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function deleteComment(id) {
    return getCloud().database.from('comments').delete().eq('id', id)
      .then(function (r) { if (r.error) throw r.error; });
  }

  /* ---------------- LLM（关键less，AI 仅后台出现） ---------------- */
  function listModels() {
    return getCloud().llm.models.list()
      .then(function (models) { return (models || []).filter(function (m) { return m.disabled !== true; }); });
  }
  function draftRows(prompt) {
    return listModels().then(function (models) {
      if (!models.length) throw new Error('no-model');
      var model = models[0];
      var messages = [
        { role: 'system', content: '你是企业培训课程设计师。只输出严格 JSON 数组，每个对象含字段：method(课上教的工具方法，简短), task(课后主题任务：让学员把方法用到自己岗位上的练习，不要写死具体工作场景), hintScene(给学员的场景启发，用「例如…」开头，只是提示不是答案), hintBehavior(给学员的行为启发，同样只是提示), direction(指标方向，只能是 efficiency/quality/cost/collab/growth 之一)。严禁替学员写死工作场景、具体行为或指标名——那是学员自己要定的。不要解释，不要 markdown。' },
        { role: 'user', content: prompt }
      ];
      var answer = '';
      return iterate(getCloud().llm.chat.completions.create({
        model: model.id, messages: messages, stream: true,
        response_format: { type: 'json_object' }
      }), function (chunk) {
        var d = chunk.choices && chunk.choices[0] && chunk.choices[0].delta && chunk.choices[0].delta.content;
        if (d) answer += d;
      }).then(function () {
        var m = answer.match(/\[[\s\S]*\]/);
        if (!m) throw new Error('bad-json');
        return JSON.parse(m[0]);
      });
    });
  }
  function iterate(stream, onChunk) {
    return new Promise(function (resolve, reject) {
      var step = function () {
        stream.next().then(function (res) {
          if (res.done) { resolve(); return; }
          try { onChunk(res.value); } catch (e) { reject(e); return; }
          step();
        }).catch(reject);
      };
      step();
    });
  }

  global.ALC = {
    init: init, getCloud: getCloud,
    uid: uid, slug: slug, token: token, esc: esc, emptyFramework: emptyFramework,
    DIRECTIONS: DIRECTIONS, directionLabel: directionLabel, isNewRow: isNewRow,
    newRow: newRow, cleanRow: cleanRow, cardAchieved: cardAchieved,
    auth: auth,
    listCourses: listCourses, getCourse: getCourse, saveCourse: saveCourse, deleteCourse: deleteCourse,
    listProjects: listProjects, getProject: getProject, saveProject: saveProject, deleteProject: deleteProject,
    defaultSchedule: defaultSchedule, phaseInfo: phaseInfo, saveWrapup: saveWrapup,
    getProjectForStudent: getProjectForStudent, saveSubmission: saveSubmission,
    getSubmissionForSup: getSubmissionForSup, saveSupFeedback: saveSupFeedback,
    getSubmissions: getSubmissions, getFeedback: getFeedback, getReviews: getReviews,
    saveReview: saveReview, appendTemplate: appendTemplate,
    appendTemplates: appendTemplates, saveTemplates: saveTemplates,
    updateTemplate: updateTemplate, removeTemplate: removeTemplate,
    whoami: whoami, transferAdmin: transferAdmin,
    listAdmins: listAdmins, grantAdmin: grantAdmin, setAdminStatus: setAdminStatus,
    transferData: transferData,
    listCollaborators: listCollaborators, addCollaborator: addCollaborator, removeCollaborator: removeCollaborator,
    saveProjectRows: saveProjectRows,
    listComments: listComments, listOpenComments: listOpenComments, addComment: addComment,
    setCommentStatus: setCommentStatus, deleteComment: deleteComment,
    listModels: listModels, draftRows: draftRows
  };
})(window);
