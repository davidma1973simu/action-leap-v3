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
      client: course.client || '', cohort: course.cohort || '',
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
  function deleteCourse(id) {
    return getCloud().database.from('courses').delete().eq('id', id)
      .then(function (r) { if (r.error) throw r.error; });
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
      schedule: p.schedule || {}, wrapup: p.wrapup || {}
    };
    if (p.id) {
      return getCloud().database.from('projects').update(payload).eq('id', p.id)
        .select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
    }
    return getCloud().database.from('projects').insert(payload)
      .select().single().then(function (r) { if (r.error) throw r.error; return r.data; });
  }
  function deleteProject(id) {
    return getCloud().database.from('projects').delete().eq('id', id)
      .then(function (r) { if (r.error) throw r.error; });
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
  function appendTemplate(courseId, template) {
    return getCourse(courseId).then(function (course) {
      var templates = course.templates || [];
      templates.push(template);
      return getCloud().database.from('courses').update({ templates: templates })
        .eq('id', courseId).select().single()
        .then(function (r) { if (r.error) throw r.error; return r.data; });
    });
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
        { role: 'system', content: '你是企业培训课程设计师。只输出严格 JSON 数组，每个对象含字段：section(掌握的新方法，简短), scene(应用场景，具体的工作情景), action(具体行动，学员在岗位上做出来的可观察行为), target(量化目标值，填不到就留空串), direction(up或down), note(改善的绩效指标名，如无则空串)。不要解释，不要 markdown。' },
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
    auth: auth,
    listCourses: listCourses, getCourse: getCourse, saveCourse: saveCourse, deleteCourse: deleteCourse,
    listProjects: listProjects, getProject: getProject, saveProject: saveProject, deleteProject: deleteProject,
    defaultSchedule: defaultSchedule, phaseInfo: phaseInfo, saveWrapup: saveWrapup,
    getProjectForStudent: getProjectForStudent, saveSubmission: saveSubmission,
    getSubmissionForSup: getSubmissionForSup, saveSupFeedback: saveSupFeedback,
    getSubmissions: getSubmissions, getFeedback: getFeedback, getReviews: getReviews,
    saveReview: saveReview, appendTemplate: appendTemplate,
    listModels: listModels, draftRows: draftRows
  };
})(window);
