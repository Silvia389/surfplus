/* XJTLU Virtual Campus — Demo JavaScript (API 版) */

// ==================== 配置 ====================
const API_BASE = '';  // 前后端同源，无需前缀

// ==================== 页面导航 ====================

function $(id) { return document.getElementById(id); }

function switchTab(page) {
  // 隐藏所有页面
  document.querySelectorAll('.page-content:not(.sub-page)').forEach(p => p.style.display = 'none');
  // 显示选中页面
  $('page-' + page).style.display = 'block';
  // 更新 Tab 状态
  document.querySelectorAll('.tab-item').forEach(t => {
    t.classList.toggle('active', t.dataset.page === page);
  });
  // 更新标题
  $('header-title').textContent = {
    'feed': '动态广场',
    'academic': '学术中心',
    'events': '活动',
    'treehole': '匿名树洞',
    'profile': '我的'
  }[page] || 'XJTLU Campus';
  $('header-back').style.display = 'none';
  $('header-action').textContent = '';

  // 关闭所有 sub-page
  document.querySelectorAll('.sub-page').forEach(p => p.style.display = 'none');
}

function navigateTo(page) {
  $('header-back').style.display = 'inline';
  $('header-title').textContent = {
    'login': '登录',
    'register': '注册',
    'post-detail': '帖子详情',
    'treehole-detail': '树洞详情',
    'event-detail': '活动详情',
    'messages': '站内消息',
    'notifications': '通知中心',
    'settings': '设置',
    'post-create': '发布动态',
    'search-results': '搜索结果'
  }[page] || 'XJTLU Campus';

  $('page-' + page).style.display = 'block';
}

function goBack() {
  document.querySelectorAll('.sub-page').forEach(p => p.style.display = 'none');
  $('header-back').style.display = 'none';
  // 恢复当前 tab 的标题
  const activeTab = document.querySelector('.tab-item.active');
  if (activeTab) switchTab(activeTab.dataset.page);
}

// ==================== Toast ====================

function showToast(msg, type) {
  const t = $('toast');
  t.textContent = msg;
  t.style.background = type === 'error' ? '#A32D2D' : '#333';
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ==================== API 工具函数 ====================

async function apiGet(path) {
  try {
    const resp = await fetch(API_BASE + path);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error('API GET failed:', path, e);
    throw e;
  }
}

async function apiPost(path) {
  try {
    const resp = await fetch(API_BASE + path, { method: 'POST' });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } catch (e) {
    console.error('API POST failed:', path, e);
    throw e;
  }
}

// ==================== 数据加载 ====================

async function loadAllData() {
  try {
    const [feedData, treeholeData, eventsData, resourcesData, qaData, professorsData, messagesData, notificationsData] =
      await Promise.all([
        apiGet('/api/community/feed').catch(() => null),
        apiGet('/api/treehole/hot').catch(() => null),
        apiGet('/api/events').catch(() => null),
        apiGet('/api/courses/resources').catch(() => null),
        apiGet('/api/courses/qa').catch(() => null),
        apiGet('/api/professors').catch(() => null),
        apiGet('/api/messages').catch(() => null),
        apiGet('/api/notifications').catch(() => null),
      ]);

    if (feedData) renderPosts(feedData);
    if (treeholeData) renderTreehole(treeholeData);
    if (eventsData) renderEvents(eventsData);
    if (resourcesData) renderMaterials(resourcesData);
    if (qaData) renderQuestions(qaData);
    if (professorsData) renderProfessors(professorsData);
    if (messagesData) renderMessages(messagesData);
    if (notificationsData) renderNotifications(notificationsData);
  } catch (e) {
    showToast('数据加载失败，请刷新重试', 'error');
  }
}

// ==================== 渲染函数 ====================

function renderPosts(data) {
  // API 返回: {page, total, posts: [{id, 内容, 板块, 匿名, 时间, 点赞, 评论}]}
  const posts = data.posts || [];
  const list = $('post-list');
  list.innerHTML = posts.map(p => `
    <div class="post-card" data-id="${p.id}" onclick="navigateToPostDetail('${p.id}')">
      <div class="post-card-title">${p['匿名'] ? '🕊️ ' : ''}${p['内容'].substring(0, 30)}${p['内容'].length > 30 ? '...' : ''}</div>
      <div class="post-card-content">${p['内容']}</div>
      <div class="post-card-meta">
        <span>${p['匿名'] ? '匿名' : '用户'}</span>
        <span>${p['时间'] || ''}</span>
      </div>
      <div class="post-card-actions">
        <span class="post-action" onclick="handleLike('${p.id}', event)">❤️ ${p['点赞']}</span>
        <span class="post-action" onclick="event.stopPropagation(); navigateToPostDetail('${p.id}')">💬 ${p['评论']}</span>
        <span class="post-action" onclick="handleCollect('${p.id}', event)">🔖 收藏</span>
      </div>
    </div>
  `).join('');
}

function renderTreehole(data) {
  // API 返回: {hot_posts: [{id, 内容, 时间, 点赞}]}
  const posts = data.hot_posts || [];
  const list = $('treehole-list');
  list.innerHTML = posts.map(p => `
    <div class="treehole-post" data-id="${p.id}">
      <div class="treehole-post-content">${p['内容']}</div>
      <div class="treehole-post-meta">
        <span>🕊️ 匿名</span>
        <span>${p['时间'] || ''}</span>
        <span>❤️ ${p['点赞']}</span>
      </div>
    </div>
  `).join('');
}

function parseEventDate(timeStr) {
  // 解析 "2026-07-28 14:00-16:00" 格式
  try {
    const datePart = timeStr.split(' ')[0];  // "2026-07-28"
    const parts = datePart.split('-');
    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);
    const monthNames = ['', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
    return { day: String(day).padStart(2, '0'), month: monthNames[month] || month + '月' };
  } catch (e) {
    return { day: '??', month: '' };
  }
}

function parseEventTime(timeStr) {
  // 从 "2026-07-28 14:00-16:00" 提取时间部分
  try {
    return timeStr.split(' ').slice(1).join(' ') || '';
  } catch (e) {
    return '';
  }
}

function renderEvents(data) {
  // API 返回纯数组: [{id, 活动, 时间, 地点, 组织, 报名}]
  const events = Array.isArray(data) ? data : (data.events || []);
  const list = $('event-list');
  list.innerHTML = events.map(e => {
    const dateInfo = parseEventDate(e['时间'] || '');
    const timePart = parseEventTime(e['时间'] || '');
    return `
    <div class="event-card" data-id="${e.id}">
      <div class="event-date-badge">
        <span class="event-date-day">${dateInfo.day}</span>
        <span class="event-date-month">${dateInfo.month}</span>
      </div>
      <div class="event-info">
        <div class="event-title">${e['活动']}</div>
        <div class="event-detail">🕐 ${timePart} · 📍 ${e['地点'] || ''}</div>
        <div class="event-detail">👤 ${e['组织'] || ''} · 已报名 ${e['报名'] || 0}人</div>
        <button class="event-register-btn" onclick="handleEventRegister('${e.id}', event)">立即报名</button>
      </div>
    </div>
  `}).join('');
}

function renderMaterials(data) {
  // API 返回纯数组: [{名称, 课程, 类型, 上传者}]
  const items = Array.isArray(data) ? data : (data.resources || []);
  const list = $('material-list');
  list.innerHTML = items.map(m => `
    <div class="material-item" onclick="showToast('查看资料详情')">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${m['名称']}</div>
      <div style="font-size:12px;color:var(--text-muted);">
        ${m['课程'] || ''} · ${m['类型'] || ''} · ${m['上传者'] || ''}
      </div>
    </div>
  `).join('');
}

function renderQuestions(data) {
  // API 返回纯数组: [{课程, 问题, 回答数}]
  const items = Array.isArray(data) ? data : (data.questions || []);
  const list = $('question-list');
  list.innerHTML = items.map(q => `
    <div class="question-item" onclick="showToast('查看问答详情')">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${q['问题']}</div>
      <div style="font-size:12px;color:var(--text-muted);">${q['课程'] || ''} · ${q['回答数'] || 0} 个回答</div>
    </div>
  `).join('');
}

function renderProfessors(data) {
  // API 返回纯数组: [{姓名, 学院, 研究方向, "Office Hour"}]
  const items = Array.isArray(data) ? data : (data.professors || []);
  const list = $('professor-list');
  list.innerHTML = items.map(p => `
    <div class="professor-card" onclick="showToast('查看教授详情')">
      <div style="font-weight:600;font-size:14px;margin-bottom:4px;">${p['姓名']}</div>
      <div style="font-size:12px;color:var(--text-muted);">${p['学院'] || ''} · ${p['研究方向'] || ''}</div>
      <div style="font-size:12px;color:var(--text-muted);">🕐 ${p['Office Hour'] || ''}</div>
    </div>
  `).join('');
}

function renderMessages(data) {
  // API 返回纯数组: [{会话, 内容, 时间}]
  const items = Array.isArray(data) ? data : (data.messages || []);
  const list = $('message-list');
  if (items.length === 0) {
    // 可能返回 {message: "没有找到匹配的消息"} 格式
    if (data && data.message) {
      list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">' + data.message + '</div>';
      return;
    }
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无消息</div>';
    return;
  }
  list.innerHTML = items.map(m => `
    <div class="profile-menu-item" onclick="showToast('查看对话')">
      <span class="menu-icon">💬</span>
      <div style="flex:1;">
        <div style="font-weight:600;font-size:14px;">${m['会话'] || '对话'}</div>
        <div style="font-size:12px;color:var(--text-muted);">${m['内容'] || ''}</div>
      </div>
      <span style="font-size:11px;color:var(--text-muted);">${m['时间'] || ''}</span>
    </div>
  `).join('');
}

function renderNotifications(data) {
  // API 返回: {notifications: [{id, 内容, 时间, 已读}], unread: N}
  const items = data.notifications || [];
  const list = $('notification-list');
  list.innerHTML = items.map(n => `
    <div class="profile-menu-item" onclick="markNotificationRead('${n.id}', event)" style="${n['已读'] ? 'opacity:0.5;' : ''}">
      <span class="menu-icon">${(n['内容'] || '').startsWith('📅') ? '📅' : (n['内容'] || '').startsWith('🔥') ? '🔥' : (n['内容'] || '').startsWith('✅') ? '✅' : '🔔'}</span>
      <div style="flex:1;">
        <div style="font-size:14px;">${n['内容'] || ''}</div>
        <div style="font-size:12px;color:var(--text-muted);">${n['时间'] || ''}</div>
      </div>
      ${!n['已读'] ? '<span class="menu-badge">新</span>' : ''}
    </div>
  `).join('');
  if (items.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">暂无通知</div>';
  }
}

async function markNotificationRead(notifId, event) {
  if (event) event.stopPropagation();
  try {
    await apiPost(`/api/notifications/read?notification_id=${encodeURIComponent(notifId)}`);
    const notificationsData = await apiGet('/api/notifications');
    renderNotifications(notificationsData);
  } catch (e) {
    // 静默失败
  }
}

// ==================== 交互函数 ====================

async function handleLike(postId, event) {
  event.stopPropagation();
  try {
    const result = await apiPost(`/api/community/like?post_id=${encodeURIComponent(postId)}`);
    if (result.status === 'ok') {
      showToast(`点赞成功！当前 ${result.likes} 赞`);
      // 刷新帖子列表
      const feedData = await apiGet('/api/community/feed');
      renderPosts(feedData);
    } else {
      showToast(result.error || '点赞失败', 'error');
    }
  } catch (e) {
    showToast('网络错误，请重试', 'error');
  }
}

function handleComment(postId, event) {
  event.stopPropagation();
  const content = prompt('输入评论内容：');
  if (!content) return;
  apiPost(`/api/community/comments?post_id=${encodeURIComponent(postId)}&content=${encodeURIComponent(content)}`)
    .then(result => {
      if (result.status === 'ok') {
        showToast('评论成功！');
        // 如果在详情页，刷新详情；否则刷新列表
        const detail = $('post-detail-content');
        if (detail && detail.style.display !== 'none') {
          navigateToPostDetail(postId);
        } else {
          return apiGet('/api/community/feed').then(renderPosts);
        }
      } else {
        showToast(result.error || '评论失败', 'error');
      }
    })
    .catch(() => showToast('网络错误，请重试', 'error'));
}

async function handleCollect(postId, event) {
  event.stopPropagation();
  try {
    const result = await apiPost(`/api/community/collect?post_id=${encodeURIComponent(postId)}`);
    if (result.status === 'ok') {
      showToast('已收藏 ⭐');
    } else {
      showToast(result.error || '收藏失败', 'error');
    }
  } catch (e) {
    showToast('网络错误，请重试', 'error');
  }
}

async function navigateToPostDetail(postId) {
  navigateTo('post-detail');
  $('post-detail-content').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载中...</div>';
  try {
    const data = await apiGet(`/api/community/posts/${encodeURIComponent(postId)}`);
    renderPostDetail(data);
  } catch (e) {
    $('post-detail-content').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">加载失败，请返回重试</div>';
  }
}

function renderPostDetail(data) {
  const comments = data.comments || [];
  const html = `
    <div style="padding:16px;">
      <div style="font-size:16px;font-weight:700;margin-bottom:12px;">${data.title || ''}</div>
      <div style="font-size:14px;line-height:1.6;margin-bottom:16px;color:var(--text-primary);">${data.content}</div>
      <div style="display:flex;gap:16px;font-size:12px;color:var(--text-muted);margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid var(--border-color);">
        <span>${data.anonymous ? '🕊️ 匿名' : '👤 用户'}</span>
        <span>${data.time || ''}</span>
        <span>❤️ ${data.likes || 0}</span>
        <span>💬 ${data.comments_count || 0}</span>
      </div>
      <div style="font-size:14px;font-weight:600;margin-bottom:12px;">评论 (${comments.length})</div>
      <div id="comment-list">
        ${comments.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--text-muted);font-size:13px;">暂无评论，快来抢沙发~</div>' :
          comments.map(c => `
            <div style="padding:12px 0;border-bottom:1px solid var(--border-color);">
              <div style="font-size:13px;line-height:1.5;">${c.anonymous ? '🕊️ 匿名' : '👤 用户'}：${c.content}</div>
              <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${c.time || ''}</div>
            </div>
          `).join('')
        }
      </div>
      <div style="margin-top:16px;">
        <button class="primary-btn" onclick="handleCommentOnDetail('${data.id}')">写评论</button>
        <button class="primary-btn" style="background:#f0f0f0;color:#333;margin-left:8px;" onclick="handleLikeOnDetail('${data.id}')">❤️ 点赞</button>
        <button class="primary-btn" style="background:#f0f0f0;color:#333;margin-left:8px;" onclick="handleCollect('${data.id}', event)">🔖 收藏</button>
      </div>
    </div>
  `;
  $('post-detail-content').innerHTML = html;
}

function handleCommentOnDetail(postId) {
  const content = prompt('输入评论内容：');
  if (!content) return;
  apiPost(`/api/community/comments?post_id=${encodeURIComponent(postId)}&content=${encodeURIComponent(content)}`)
    .then(result => {
      if (result.status === 'ok') {
        showToast('评论成功！');
        navigateToPostDetail(postId);
      } else {
        showToast(result.error || '评论失败', 'error');
      }
    })
    .catch(() => showToast('网络错误，请重试', 'error'));
}

async function handleLikeOnDetail(postId) {
  try {
    const result = await apiPost(`/api/community/like?post_id=${encodeURIComponent(postId)}`);
    if (result.status === 'ok') {
      showToast(`点赞成功！当前 ${result.likes} 赞`);
      navigateToPostDetail(postId);
    } else {
      showToast(result.error || '点赞失败', 'error');
    }
  } catch (e) {
    showToast('网络错误，请重试', 'error');
  }
}

async function handleEventRegister(eventId, event) {
  event.stopPropagation();
  try {
    const result = await apiPost(`/api/events/register?event_id=${encodeURIComponent(eventId)}`);
    if (result.status === 'ok') {
      showToast(result.message || '报名成功！通知中心已生成提醒');
      // 刷新活动列表
      const eventsData = await apiGet('/api/events');
      renderEvents(eventsData);
      // 刷新通知列表（报名后会生成倒计时通知）
      const notificationsData = await apiGet('/api/notifications');
      renderNotifications(notificationsData);
    } else {
      showToast(result.error || '报名失败', 'error');
    }
  } catch (e) {
    showToast('网络错误，请重试', 'error');
  }
}

async function handleCreatePost() {
  const titleInput = document.querySelector('.create-post-title-input');
  const textarea = document.querySelector('.create-post-textarea');
  const anonToggle = $('anon-toggle');
  const content = textarea.value.trim();
  const title = titleInput.value.trim();
  const anonymous = anonToggle ? anonToggle.checked : false;

  if (!content) {
    showToast('请输入内容', 'error');
    return;
  }

  try {
    let url = `/api/community/posts?content=${encodeURIComponent(content)}&section=general&anonymous=${anonymous}`;
    if (title) url += `&title=${encodeURIComponent(title)}`;
    const result = await apiPost(url);
    if (result.status === 'ok') {
      showToast(result.message || '发布成功！');
      textarea.value = '';
      titleInput.value = '';
      if (anonToggle) anonToggle.checked = false;
      goBack();
      // 刷新帖子列表
      const feedData = await apiGet('/api/community/feed');
      renderPosts(feedData);
    } else {
      showToast(result.error || '发布失败', 'error');
    }
  } catch (e) {
    showToast('网络错误，请重试', 'error');
  }
}

async function handleTreeholePost() {
  const content = prompt('匿名发布心声：');
  if (!content || !content.trim()) return;

  try {
    const result = await apiPost(`/api/treehole/posts?content=${encodeURIComponent(content.trim())}`);
    if (result.status === 'ok') {
      showToast(result.message || '发布成功！');
      // 刷新树洞
      const treeholeData = await apiGet('/api/treehole/hot');
      renderTreehole(treeholeData);
    } else {
      showToast(result.error || '发布失败', 'error');
    }
  } catch (e) {
    showToast('网络错误，请重试', 'error');
  }
}

async function handleAskQuestion() {
  const course = prompt('请输入课程名称（如 CSE101）：');
  if (!course || !course.trim()) return;
  const question = prompt('请输入你的问题：');
  if (!question || !question.trim()) return;
  const anonChoice = confirm('是否匿名提问？\n确定=匿名，取消=实名');
  const anonymous = anonChoice;

  try {
    const result = await apiPost(`/api/courses/qa?course=${encodeURIComponent(course.trim())}&question=${encodeURIComponent(question.trim())}&anonymous=${anonymous}`);
    if (result.status === 'ok') {
      showToast(result.message || '提问成功！');
      // 刷新问答列表
      const qaData = await apiGet('/api/courses/qa');
      renderQuestions(qaData);
    } else {
      showToast(result.error || '提问失败', 'error');
    }
  } catch (e) {
    showToast('网络错误，请重试', 'error');
  }
}

async function handleSearch() {
  const keyword = prompt('搜索关键词：');
  if (!keyword || !keyword.trim()) return;

  navigateTo('search-results');
  $('search-results-container').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">搜索中...</div>';

  try {
    const result = await apiGet(`/api/search?keyword=${encodeURIComponent(keyword.trim())}`);
    renderSearchResults(result, keyword.trim());
  } catch (e) {
    $('search-results-container').innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">搜索失败，请重试</div>';
  }
}

function renderSearchResults(data, keyword) {
  const catNames = { course: '课程', professor: '教授', event: '活动', post: '帖子' };
  const catIcons = { course: '📚', professor: '🧑‍🏫', event: '📅', post: '💬' };
  let hasResults = false;
  let html = `<div style="padding:16px;"><div style="font-size:14px;color:var(--text-muted);margin-bottom:16px;">关键词「${keyword}」的搜索结果</div>`;

  for (const cat of ['course', 'professor', 'event', 'post']) {
    if (data[cat]) {
      hasResults = true;
      const items = Array.isArray(data[cat]) ? data[cat] : [data[cat]];
      html += `<div style="margin-bottom:20px;">
        <div style="font-size:15px;font-weight:700;margin-bottom:8px;">${catIcons[cat]} ${catNames[cat]} (${items.length})</div>`;
      html += items.map(item => {
        const values = Object.values(item);
        return `<div style="padding:10px 12px;background:var(--bg-secondary);border-radius:8px;margin-bottom:6px;font-size:13px;cursor:pointer;" onclick="showToast('查看详情')">
          ${values.join(' · ')}
        </div>`;
      }).join('');
      html += '</div>';
    }
  }

  if (!hasResults) {
    html += '<div style="text-align:center;padding:40px;color:var(--text-muted);">未找到相关结果</div>';
  }
  html += '</div>';
  $('search-results-container').innerHTML = html;
}

function switchAcademicTab(tab, el) {
  document.querySelectorAll('.academic-tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['materials', 'questions', 'professors'].forEach(p => {
    $('academic-' + p).style.display = p === tab ? 'block' : 'none';
  });
}

function toggleLanguage(el, lang) {
  document.querySelectorAll('.toggle-option').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  showToast(lang === 'zh' ? '已切换为中文' : 'Switched to English');
}

var loginMode = 'password';
function toggleLoginMode() {
  loginMode = loginMode === 'password' ? 'code' : 'password';
  $('login-password-group').style.display = loginMode === 'password' ? 'block' : 'none';
  $('login-code-group').style.display = loginMode === 'code' ? 'block' : 'none';
  $('login-mode-text').textContent = loginMode === 'password' ? '验证码登录' : '密码登录';
}

function handleLogin() {
  showToast('登录成功！欢迎回来 👋');
  goBack();
}

function handleSendCode() {
  showToast('验证码已发送到您的邮箱');
}

// ==================== AI 助手 ====================

var aiSessionId = 'web_' + Date.now();
var aiMessages = [];

function openAIChat() {
  $('ai-chat-overlay').style.display = 'flex';
  setTimeout(function() { $('ai-chat-input').focus(); }, 300);
}

function closeAIChat() {
  $('ai-chat-overlay').style.display = 'none';
}

function appendAIMsg(role, text) {
  var container = $('ai-chat-messages');
  var div = document.createElement('div');
  div.className = 'ai-msg ai-' + role;
  var bubble = document.createElement('div');
  bubble.className = 'ai-msg-bubble';
  bubble.textContent = text;
  div.appendChild(bubble);
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function showAITyping() {
  var container = $('ai-chat-messages');
  var div = document.createElement('div');
  div.className = 'ai-typing';
  div.id = 'ai-typing-indicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

function hideAITyping() {
  var el = $('ai-typing-indicator');
  if (el) el.remove();
}

async function sendAIMessage() {
  var input = $('ai-chat-input');
  var msg = input.value.trim();
  if (!msg) return;

  // 显示用户消息
  appendAIMsg('user', msg);
  aiMessages.push({ role: 'user', content: msg });
  input.value = '';
  $('ai-chat-send').disabled = true;

  // 显示"正在输入"动画
  showAITyping();

  try {
    var resp = await fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: aiSessionId, message: msg })
    });
    var data = await resp.json();
    hideAITyping();

    if (data.reply) {
      appendAIMsg('bot', data.reply);
      aiMessages.push({ role: 'bot', content: data.reply });
    } else if (data.detail) {
      appendAIMsg('bot', '出错了：' + data.detail);
    } else {
      appendAIMsg('bot', '抱歉，我没有理解。能换个方式问吗？');
    }
  } catch (e) {
    hideAITyping();
    appendAIMsg('bot', '网络错误，请稍后重试。');
  }

  $('ai-chat-send').disabled = false;
  input.focus();
}

// ==================== 初始化 ====================

// 状态栏时间
function updateTime() {
  const now = new Date();
  $('status-time').textContent = now.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}
updateTime();
setInterval(updateTime, 30000);

// 加载所有数据
loadAllData();
