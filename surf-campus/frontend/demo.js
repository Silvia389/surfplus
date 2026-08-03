const API_BASE = '';
const SECTION_META = {
  all: { label: '推荐' },
  academic: { label: '学术' },
  'campus-life': { label: '校园生活' },
  opportunities: { label: '活动与机会' },
  teams: { label: '组队与项目' },
};
const RECOMMENDED_TAGS = ['CSE101', '期末复习', 'AI', '黑客松', '图书馆', '羽毛球'];
const AVATAR_META = {
  sun: { icon: 'sun', label: '晴日' },
  wave: { icon: 'waves', label: '海风' },
  leaf: { icon: 'leaf', label: '新芽' },
  star: { icon: 'star', label: '星光' },
  spark: { icon: 'sparkles', label: '灵感' },
  moon: { icon: 'moon', label: '月亮' },
};

const state = {
  route: 'feed',
  section: 'all',
  loading: true,
  loadingMore: false,
  page: 1,
  total: 0,
  posts: [],
  notifications: [],
  resources: [],
  questions: [],
  assignments: [],
  events: [],
  opportunities: [],
  opportunitySkills: [],
  treeholes: [],
  treeholeText: '',
  activeTreeholeComment: '',
  directoryPeople: [],
  directoryKeyword: '',
  activeDirectoryChat: '',
  activeOpportunityApply: '',
  groups: [],
  conversations: [],
  preferences: { sections: ['academic', 'campus-life', 'opportunities', 'teams'], interests: ['AI', 'CSE101'], show_context_rail: true, content_language: 'mixed', theme: 'system' },
  participation: { points: 0, records: [] },
  authSession: { phone_authenticated: false, email_authenticated: false, campus_verified: false, can_publish: false, name: '', phone_masked: '', campus_account: '', needs_onboarding: false },
  profile: { username: '', bio: '', birthday: '', avatar: 'sun', profile_complete: false },
  authConfig: { configured: false, mock_binding_enabled: true, provider: 'XJTLU UIM OAuth2' },
  tags: [],
  errors: {},
  composerExpanded: false,
  composerText: '',
  composerSection: 'campus-life',
  composerTags: [],
  composerAnonymous: false,
  uploads: [],
  publishing: false,
  pendingPostId: '',
  search: { keyword: '', type: 'all', section: 'all', mode: 'search', loading: false, result: null, error: '', aiReply: '' },
  tagResult: null,
  selectedPost: null,
  selectedResource: null,
  activeCollectionPost: '',
  resourceCatalog: null,
  resourceFilters: { keyword: '', year: 'all', term: 'all', major: 'all', course: 'all', type: 'all', semester: 'all', mode: 'all' },
  activeComment: '',
  activeAI: '',
  aiReplies: {},
  commentAIReplies: {},
  pendingAIReply: '',
};

const $ = id => document.getElementById(id);

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function asArray(value, key) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.[key]) ? value[key] : [];
}

function refreshIcons() {
  if (window.lucide?.createIcons) window.lucide.createIcons({ attrs: { 'stroke-width': 1.8 } });
}

function applyTheme(theme = 'system') {
  document.documentElement.dataset.theme = theme === 'system' ? '' : theme;
  document.documentElement.style.colorScheme = theme === 'dark' ? 'dark' : theme === 'light' ? 'light' : '';
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const themeColor = theme === 'dark' || (theme === 'system' && prefersDark) ? '#121714' : '#f4f5f2';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeColor);
}

function avatarBadge(value = 'sun', fallback = '校') {
  const meta = AVATAR_META[value];
  if (!meta) return `<span class="avatar">${escapeHTML(fallback)}</span>`;
  return `<span class="avatar avatar-${escapeHTML(value)}"><i data-lucide="${escapeHTML(meta.icon)}" aria-hidden="true"></i></span>`;
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
    ...options,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || `请求失败（${response.status}）`);
  return payload;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast${type === 'error' ? ' is-error' : ''}`;
  toast.innerHTML = `<i data-lucide="${type === 'error' ? 'circle-alert' : 'check-circle-2'}" aria-hidden="true"></i><span>${escapeHTML(message)}</span>`;
  $('toast-region').appendChild(toast);
  refreshIcons();
  window.setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(6px)';
    window.setTimeout(() => toast.remove(), 180);
  }, 3000);
}

const LOGIN_STORAGE_KEY = 'surf-login-complete';
const LOGIN_ACCOUNT_KEY = 'surf-login-account';
const mascotPhysics = new WeakMap();
let loginPointer = { x: window.innerWidth * .28, y: window.innerHeight * .58 };
let loginFocusTarget = null;
let loginAnimationFrame = 0;
let loginMoodTimer = 0;
let passwordIsVisible = false;
let emailEntryMode = 'login';
const loginCodeTimers = new Map();

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function hasStoredLogin() {
  return localStorage.getItem(LOGIN_STORAGE_KEY) === 'true' || sessionStorage.getItem(LOGIN_STORAGE_KEY) === 'true';
}

function rememberLogin(persistent) {
  localStorage.removeItem(LOGIN_STORAGE_KEY);
  sessionStorage.removeItem(LOGIN_STORAGE_KEY);
  (persistent ? localStorage : sessionStorage).setItem(LOGIN_STORAGE_KEY, 'true');
}

function rememberAccount(result, persistent) {
  if (!persistent) return;
  const account = {
    email: result?.email || '',
    phone: result?.phone_masked || '',
    name: result?.name || '',
  };
  localStorage.setItem(LOGIN_ACCOUNT_KEY, JSON.stringify(account));
}

function setLoginMood(mood) {
  const experience = $('login-experience');
  if (experience) experience.dataset.mood = mood;
}

function activeLoginMood() {
  const active = document.activeElement;
  if (active?.id === 'login-password') return passwordIsVisible ? 'peek' : 'password';
  if (active?.closest?.('.login-form')) return 'email';
  return 'idle';
}

function pulseLoginMood(mood, duration = 760) {
  window.clearTimeout(loginMoodTimer);
  setLoginMood('idle');
  requestAnimationFrame(() => setLoginMood(mood));
  loginMoodTimer = window.setTimeout(() => setLoginMood(activeLoginMood()), duration);
}

function animateMascots() {
  const experience = $('login-experience');
  if (!experience || experience.hidden) {
    loginAnimationFrame = 0;
    return;
  }
  const focusRect = loginFocusTarget?.isConnected ? loginFocusTarget.getBoundingClientRect() : null;
  const target = focusRect ? { x: focusRect.left + focusRect.width / 2, y: focusRect.top + focusRect.height / 2 } : loginPointer;
  experience.querySelectorAll('.mascot').forEach((mascot, index) => {
    const body = mascot.querySelector('.mascot-body');
    const rect = mascot.getBoundingClientRect();
    const desiredX = clamp((target.x - (rect.left + rect.width / 2)) / Math.max(180, rect.width * 1.6), -1, 1);
    const desiredY = clamp((target.y - (rect.top + rect.height * .32)) / Math.max(180, rect.height), -1, 1);
    const physics = mascotPhysics.get(mascot) || { x: 0, y: 0 };
    const response = .105 + index * .012;
    physics.x += (desiredX - physics.x) * response;
    physics.y += (desiredY - physics.y) * response;
    mascotPhysics.set(mascot, physics);
    const personality = [1.05, .72, .48, 1.18][index];
    body.style.transform = `translate3d(${(physics.x * 5 * personality).toFixed(2)}px, ${(physics.y * 3).toFixed(2)}px, 0) rotate(${(physics.x * 3.2 * personality).toFixed(2)}deg)`;
    mascot.querySelectorAll('.pupil').forEach(pupil => {
      const limit = mascot.matches('.mascot-orange, .mascot-yellow') ? 3.2 : 6.4;
      pupil.style.transform = `translate(calc(-50% + ${(physics.x * limit).toFixed(2)}px), calc(-50% + ${(physics.y * limit).toFixed(2)}px))`;
    });
  });
  loginAnimationFrame = requestAnimationFrame(animateMascots);
}

function startMascotMotion() {
  if (!loginAnimationFrame) loginAnimationFrame = requestAnimationFrame(animateMascots);
}

function showLoginGate() {
  const experience = $('login-experience');
  const shell = $('app-shell');
  if (!experience || !shell) return;
  experience.hidden = false;
  shell.inert = true;
  shell.setAttribute('aria-hidden', 'true');
  document.body.classList.add('auth-pending');
  document.body.classList.remove('auth-complete');
  startMascotMotion();
  refreshIcons();
}

function unlockApp() {
  const experience = $('login-experience');
  const shell = $('app-shell');
  if (!experience || !shell) return;
  experience.hidden = true;
  shell.inert = false;
  shell.removeAttribute('aria-hidden');
  document.body.classList.remove('auth-pending');
  document.body.classList.add('auth-complete');
  render();
  renderRails();
  renderIdentityChrome();
  maybeShowProfileOnboarding();
}

function syncLoginGate() {
  if (state.authSession.dev_bypass || ((state.authSession.phone_authenticated || state.authSession.email_authenticated) && hasStoredLogin())) unlockApp();
  else showLoginGate();
}

function maybeShowProfileOnboarding() {
  const dialog = $('profile-onboarding-dialog');
  if (!dialog || dialog.open || !state.authSession.user_id) return;
  if (!state.authSession.needs_onboarding && state.profile.profile_complete) return;
  const form = $('profile-onboarding-form');
  if (form && !form.dataset.hydrated) {
    $('onboarding-username').value = state.profile.username || state.authSession.name || '';
    form.dataset.hydrated = 'true';
  }
  dialog.showModal();
  refreshIcons();
  requestAnimationFrame(() => $('onboarding-username')?.focus());
}

function setLoginMessage(element, message, success = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle('is-success', success);
}

function setLoginBusy(form, busy) {
  const button = form?.querySelector('.login-submit');
  if (!button) return;
  if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
  button.disabled = busy;
  button.innerHTML = busy ? '<span class="login-button-spinner" aria-hidden="true"></span><span>Signing in...</span>' : button.dataset.originalHtml;
  refreshIcons();
}

function failLogin(form, message) {
  setLoginBusy(form, false);
  setLoginMessage(form?.querySelector('.login-message'), message);
  pulseLoginMood('error');
}

function completeLogin(result, persistent, form) {
  state.authSession = result;
  state.profile = result.profile || state.profile;
  rememberLogin(persistent);
  rememberAccount(result, persistent);
  setLoginBusy(form, false);
  setLoginMessage(form?.querySelector('.login-message'), 'Welcome to SURF Campus.', true);
  pulseLoginMood('success', 620);
  window.setTimeout(() => {
    unlockApp();
    showToast('登录成功，欢迎回到 SURF Campus');
    maybeShowProfileOnboarding();
  }, 620);
}

function initProfileOnboardingGuard() {
  $('profile-onboarding-dialog')?.addEventListener('cancel', event => event.preventDefault());
  const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');
  mediaQuery?.addEventListener?.('change', () => {
    if (state.preferences.theme === 'system') applyTheme('system');
  });
}

function switchLoginMode(mode, focus = true) {
  const emailForm = $('email-login-form');
  const registerForm = $('email-register-form');
  const phoneForm = $('login-phone-form');
  const showPhone = mode === 'phone';
  emailEntryMode = 'login';
  emailForm.hidden = emailEntryMode !== 'login';
  emailForm.classList.toggle('is-secondary', showPhone && emailEntryMode === 'login');
  registerForm.hidden = showPhone || emailEntryMode !== 'register';
  phoneForm.hidden = !showPhone;
  document.querySelectorAll('[role="tab"][data-login-mode]').forEach(tab => {
    const active = tab.dataset.loginMode === mode;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  loginFocusTarget = null;
  setLoginMood('idle');
  if (focus) requestAnimationFrame(() => $(showPhone ? 'login-phone' : 'login-email')?.focus());
}

function switchEmailEntry(mode, focus = true) {
  emailEntryMode = mode;
  const loginForm = $('email-login-form');
  const registerForm = $('email-register-form');
  loginForm.hidden = mode !== 'login';
  registerForm.hidden = mode !== 'register';
  $('login-heading').querySelector('h2').textContent = mode === 'register' ? 'Create your account' : 'Welcome back!';
  $('login-heading').querySelector('p').textContent = mode === 'register' ? 'Verify your email to get started' : 'Please enter your details';
  $('create-account').parentElement.hidden = mode === 'register';
  document.querySelectorAll('[role="tab"][data-login-mode]').forEach(tab => {
    const active = tab.dataset.loginMode === 'email';
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  loginFocusTarget = null;
  setLoginMood('idle');
  if (focus) requestAnimationFrame(() => $(mode === 'register' ? 'register-email' : 'login-email')?.focus());
}

function startCodeCountdown(button, seconds = 30) {
  const oldTimer = loginCodeTimers.get(button.id);
  if (oldTimer) window.clearInterval(oldTimer);
  let remaining = seconds;
  button.disabled = true;
  button.textContent = `${remaining}s`;
  const timer = window.setInterval(() => {
    remaining -= 1;
    button.textContent = remaining > 0 ? `${remaining}s` : '重新发送';
    if (remaining <= 0) {
      window.clearInterval(timer);
      loginCodeTimers.delete(button.id);
      button.disabled = false;
    }
  }, 1000);
  loginCodeTimers.set(button.id, timer);
}

function showCodeSentMessage(element, response, label) {
  const debug = response.debug_code ? ` 本地演示验证码：${response.debug_code}` : '';
  setLoginMessage(element, `${label}已发送，有效期 10 分钟。${debug}`, true);
}

function initLoginExperience() {
  const experience = $('login-experience');
  if (!experience) return;
  startMascotMotion();
  switchLoginMode('phone', false);
  $('remember-login').checked = hasStoredLogin() || $('remember-login').checked;
  $('remember-phone').checked = hasStoredLogin() || $('remember-phone').checked;

  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch' || loginFocusTarget) return;
    loginPointer = { x: event.clientX, y: event.clientY };
  }, { passive: true });

  experience.addEventListener('focusin', event => {
    if (!event.target.matches('input')) return;
    if (event.target.closest('#email-login-form') && emailEntryMode === 'login') switchLoginMode('email', false);
    loginFocusTarget = event.target;
    setLoginMood(event.target.id === 'login-password' ? (passwordIsVisible ? 'peek' : 'password') : 'email');
  });
  experience.addEventListener('focusout', () => {
    window.setTimeout(() => {
      if (!experience.contains(document.activeElement) || !document.activeElement.matches('input')) {
        loginFocusTarget = null;
        setLoginMood('idle');
      }
    }, 0);
  });
  experience.addEventListener('input', event => {
    const form = event.target.closest('.login-form');
    form?.querySelector('.login-message')?.replaceChildren();
  });

  experience.addEventListener('click', event => {
    const modeButton = event.target.closest('[data-login-mode]');
    if (modeButton) {
      switchLoginMode(modeButton.dataset.loginMode);
      return;
    }
    if (event.target.closest('#password-toggle')) {
      const input = $('login-password');
      passwordIsVisible = input.type === 'password';
      input.type = passwordIsVisible ? 'text' : 'password';
      const toggle = $('password-toggle');
      toggle.setAttribute('aria-pressed', String(passwordIsVisible));
      toggle.setAttribute('aria-label', passwordIsVisible ? '隐藏密码' : '显示密码');
      toggle.innerHTML = `<i data-lucide="${passwordIsVisible ? 'eye-off' : 'eye'}"></i>`;
      loginFocusTarget = input;
      setLoginMood(passwordIsVisible ? 'peek' : 'password');
      refreshIcons();
      requestAnimationFrame(() => input.focus({ preventScroll: true }));
      return;
    }
    if (event.target.closest('#forgot-password')) {
      $('password-reset-dialog')?.showModal();
      refreshIcons();
      return;
    }
    const policy = event.target.closest('[data-login-policy]');
    if (policy) {
      const content = policy.dataset.loginPolicy === 'privacy'
        ? '我们只保存完成登录、找回密码和校园身份绑定所需的数据。密码使用带随机盐的 PBKDF2 哈希保存，手机号以掩码形式展示；数据仅用于 SURF Campus 的账号与社区功能。'
        : '你可以使用手机号验证码登录，也可以使用邮箱和密码登录。发布公开内容前需要绑定 XJTLU 校园身份；匿名树洞与实名话题分开处理。';
      $('login-policy-title').textContent = policy.dataset.loginPolicy === 'privacy' ? 'Privacy' : 'Terms';
      $('login-policy-content').textContent = content;
      $('login-policy-dialog')?.showModal();
      refreshIcons();
      return;
    }
    if (event.target.closest('#create-account')) {
      switchLoginMode('email', false);
      switchEmailEntry('register');
      return;
    }
    if (event.target.closest('#send-code')) {
      const phone = $('login-phone').value.replace(/\D/g, '');
      if (phone.length !== 11) {
        failLogin($('login-phone-form'), '请先输入 11 位手机号。');
        $('login-phone').focus();
        return;
      }
      const button = $('send-code');
      api('/api/auth/phone/code', { method: 'POST', body: JSON.stringify({ phone }) })
        .then(response => { startCodeCountdown(button, response.cooldown || 30); showCodeSentMessage($('phone-login-message'), response, '短信验证码'); })
        .catch(error => setLoginMessage($('phone-login-message'), error.message));
      return;
    }
    if (event.target.closest('#send-email-code')) {
      const email = $('register-email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) {
        setLoginMessage($('email-register-message'), '请输入有效的邮箱地址。');
        $('register-email').focus();
        return;
      }
      const button = $('send-email-code');
      api('/api/auth/email/code', { method: 'POST', body: JSON.stringify({ email }) })
        .then(response => { startCodeCountdown(button, response.cooldown || 30); showCodeSentMessage($('email-register-message'), response, '邮箱验证码'); })
        .catch(error => setLoginMessage($('email-register-message'), error.message));
      return;
    }
    if (event.target.closest('#send-reset-code')) {
      const email = $('reset-email').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) { setLoginMessage($('reset-password-message'), '请输入有效的邮箱地址。'); return; }
      const button = $('send-reset-code');
      api('/api/auth/email/code', { method: 'POST', body: JSON.stringify({ email }) })
        .then(response => { startCodeCountdown(button, response.cooldown || 30); showCodeSentMessage($('reset-password-message'), response, '邮箱验证码'); })
        .catch(error => setLoginMessage($('reset-password-message'), error.message));
      return;
    }
    if (event.target.closest('[data-email-view]')) {
      switchEmailEntry(event.target.closest('[data-email-view]').dataset.emailView);
    }
  });

  $('email-login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = $('login-email').value.trim();
    const password = $('login-password').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { failLogin(form, 'Please enter a valid email address.'); $('login-email').focus(); return; }
    if (password.length < 6) { failLogin(form, 'Password must be at least 6 characters.'); $('login-password').focus(); return; }
    setLoginBusy(form, true);
    try {
      const result = await api('/api/auth/email', { method: 'POST', body: JSON.stringify({ email, password }) });
      completeLogin(result, $('remember-login').checked, form);
    } catch (error) {
      failLogin(form, error.message);
    }
  });

  $('login-phone-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const phone = $('login-phone').value.replace(/\D/g, '');
    const code = $('login-code').value.trim();
    if (phone.length !== 11) { failLogin(form, '请输入 11 位手机号。'); $('login-phone').focus(); return; }
    if (code.length !== 6) { failLogin(form, '请输入 6 位短信验证码。'); $('login-code').focus(); return; }
    setLoginBusy(form, true);
    try {
      const result = await api('/api/auth/phone', { method: 'POST', body: JSON.stringify({ phone, code }) });
      completeLogin(result, $('remember-phone').checked, form);
    } catch (error) {
      failLogin(form, error.message);
    }
  });

  $('email-register-form').addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const email = $('register-email').value.trim();
    const code = $('register-email-code').value.trim();
    const password = $('register-password').value;
    const confirmation = $('register-password-confirm').value;
    if (!/^\S+@\S+\.\S+$/.test(email)) { failLogin(form, '请输入有效的邮箱地址。'); $('register-email').focus(); return; }
    if (code.length !== 6) { failLogin(form, '请输入 6 位邮箱验证码。'); $('register-email-code').focus(); return; }
    if (password.length < 6) { failLogin(form, '密码至少需要 6 位。'); $('register-password').focus(); return; }
    if (password !== confirmation) { failLogin(form, '两次输入的密码不一致。'); $('register-password-confirm').focus(); return; }
    setLoginBusy(form, true);
    try {
      const result = await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ email, code, password }) });
      completeLogin(result, true, form);
    } catch (error) {
      failLogin(form, error.message);
    }
  });

  $('password-reset-form')?.addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('reset-email').value.trim();
    const code = $('reset-code').value.trim();
    const password = $('reset-password').value;
    if (!/^\S+@\S+\.\S+$/.test(email) || code.length !== 6 || password.length < 6) {
      setLoginMessage($('reset-password-message'), '请填写有效邮箱、6 位验证码和至少 6 位新密码。');
      return;
    }
    try {
      const result = await api('/api/auth/password/reset', { method: 'POST', body: JSON.stringify({ email, code, password }) });
      setLoginMessage($('reset-password-message'), result.message || '密码已更新，请登录。', true);
      window.setTimeout(() => $('password-reset-dialog')?.close(), 650);
    } catch (error) { setLoginMessage($('reset-password-message'), error.message); }
  });

  document.querySelectorAll('[data-close-login-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog')?.close()));
}

function formatTime(value) {
  if (!value) return '刚刚';
  return String(value).replace(/^2026-/, '').replace(/:\d\d$/, '');
}

function postAvatar(post) {
  if (post.anonymous) return '匿';
  return (post.author || '校').slice(0, 1);
}

function postLanguage(post) {
  const value = `${post.title || ''} ${post.content || ''}`;
  const hasChinese = /[\u3400-\u9fff]/.test(value);
  const hasEnglish = /[A-Za-z]{3,}/.test(value);
  if (hasChinese && hasEnglish) return '中英混合';
  return hasEnglish ? 'English' : '中文';
}

function normalizePost(post) {
  return {
    id: post.id,
    title: post.title || '',
    content: post.content ?? post['内容'] ?? '',
    section: post.section ?? post['板块'] ?? 'campus-life',
    anonymous: Boolean(post.anonymous ?? post['匿名']),
    author: post.author || (post.anonymous ? '匿名同学' : '校园成员'),
    time: post.time ?? post['时间'] ?? '',
    likes: Number(post.likes ?? post['点赞'] ?? 0),
    comments_count: Number(post.comments_count ?? post['评论'] ?? 0),
    comments: post.comments || [],
    tags: post.tags || [],
    media: post.media || [],
    status: post.status || 'published',
    ai_mention_count: Number(post.ai_mention_count || 0),
    ai_status: post.ai_status || 'none',
    collected: Boolean(post.collected),
    liked: Boolean(post.liked),
    collection_tags: post.collection_tags || [],
  };
}

function hasAIMention(value) {
  return /(^|[^\w@])@ai\b/i.test(String(value || ''));
}

function insertAIMention(targetId) {
  const field = document.getElementById(targetId);
  if (!field) return;
  const start = Number.isInteger(field.selectionStart) ? field.selectionStart : field.value.length;
  const end = Number.isInteger(field.selectionEnd) ? field.selectionEnd : start;
  field.value = `${field.value.slice(0, start)}@AI ${field.value.slice(end)}`;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.focus();
  const cursor = start + 4;
  field.setSelectionRange(cursor, cursor);
}

function stateBlock(title, message, icon = 'inbox', action = '') {
  return `<div class="state-block"><i data-lucide="${icon}" aria-hidden="true"></i><strong>${escapeHTML(title)}</strong><p>${escapeHTML(message)}</p>${action}</div>`;
}

function skeletonFeed(count = 3) {
  return Array.from({ length: count }, () => '<div class="skeleton-post"><div class="skeleton-line short"></div><div class="skeleton-line wide"></div><div class="skeleton-line medium"></div></div>').join('');
}

function pageHeader(eyebrow, title, description, extra = '') {
  return `<header class="page-header"><div class="page-header-row"><div><span class="eyebrow">${escapeHTML(eyebrow)}</span><h1>${escapeHTML(title)}</h1><p>${escapeHTML(description)}</p></div>${extra}</div></header>`;
}

function renderComposer() {
  if (!state.authSession.can_publish) {
    return `<section class="identity-card composer-gate" aria-label="发布权限"><div class="detail-section-heading"><div><strong>绑定 XJTLU 账号后发布</strong><small>${escapeHTML(state.authSession.phone_masked || '手机访客')} 当前可以浏览、搜索和收藏。</small></div><span class="status important">仅浏览</span></div><button class="button button-secondary" type="button" data-route="identity"><i data-lucide="badge-check"></i>前往绑定校园身份</button></section>`;
  }
  const selectedTags = state.composerTags.map(tag => `<span class="selected-tag">#${escapeHTML(tag)}<button type="button" data-remove-tag="${escapeHTML(tag)}" aria-label="移除 ${escapeHTML(tag)}"><i data-lucide="x"></i></button></span>`).join('');
  const recommended = RECOMMENDED_TAGS.filter(tag => !state.composerTags.includes(tag)).slice(0, 6).map(tag => `<button class="tag-button" type="button" data-add-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`).join('');
  const uploads = state.uploads.map((upload, index) => renderUpload(upload, index)).join('');
  const blocked = !state.composerText.trim() || state.publishing || state.uploads.some(item => item.status !== 'done');
  const status = state.pendingPostId ? `<span class="status success">上一条已提交审核${state.pendingAIReply ? '，@AI 已登记' : ''}</span>` : '';
  return `<section class="composer" id="composer" aria-label="发布校园话题">
    <div class="composer-top">
      <span class="avatar">张</span>
      <div class="composer-body">
        <textarea id="composer-text" placeholder="分享一个问题、发现或校园近况…" aria-label="帖子正文" maxlength="5000">${escapeHTML(state.composerText)}</textarea>
        ${state.composerExpanded ? `<div class="composer-expanded">
          <div class="composer-fields">
            <select class="field" id="composer-section" aria-label="选择分区">
              ${Object.entries(SECTION_META).filter(([key]) => key !== 'all').map(([key, value]) => `<option value="${key}" ${state.composerSection === key ? 'selected' : ''}>${value.label}</option>`).join('')}
            </select>
            <span class="status">每篇话题属于一个受控分区</span>
          </div>
          <div class="tag-editor" aria-label="帖子 Tag">${selectedTags}<input id="tag-input" maxlength="24" placeholder="添加 Tag，回车确认（最多 5 个）"></div>
          <div class="recommended-tags" aria-label="推荐 Tag">${recommended}</div>
          ${uploads ? `<div class="media-queue">${uploads}</div>` : ''}
        </div>` : ''}
        <div class="composer-bottom">
          <div class="composer-tools">
            <button class="tool-button" type="button" data-ai-insert="composer-text" title="插入 @AI"><i data-lucide="sparkles"></i><span>@AI</span></button>
            <label class="tool-button ${state.uploads.some(item => item.type === 'video') ? 'is-disabled' : ''}" title="添加图片"><i data-lucide="image-plus"></i><span>图片</span><input id="image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple></label>
            <label class="tool-button ${state.uploads.length ? 'is-disabled' : ''}" title="添加视频"><i data-lucide="video"></i><span>视频</span><input id="video-input" type="file" accept="video/mp4,video/webm,video/quicktime"></label>
          </div>
          <div class="composer-submit">
            ${status}
            <label class="identity-toggle" title="仅匿名树洞默认匿名；公共分区需要主动选择"><input id="composer-anonymous" type="checkbox" ${state.composerAnonymous ? 'checked' : ''}><span>匿名发布</span></label>
            <button class="button" id="publish-button" type="button" ${blocked ? 'disabled' : ''}>${state.publishing ? '<i data-lucide="loader-circle"></i>提交中' : '<i data-lucide="send"></i>提交审核'}</button>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function renderPriorityStrip() {
  const notice = state.notifications.find(item => !item.read && item.priority === 'important') || state.notifications.find(item => !item.read);
  const assignment = state.assignments[0];
  const event = state.events[0];
  const items = [
    notice ? { route: 'notifications', icon: 'bell-ring', label: '未读通知', title: notice.content } : null,
    assignment ? { route: 'resources', icon: 'clock-3', label: '今日任务', title: `${assignment.course} · ${assignment.title}` } : null,
    event ? { route: 'events', icon: 'calendar-days', label: '近期活动', title: event.title } : null,
  ].filter(Boolean);
  if (!items.length) return '';
  return `<div class="priority-strip" aria-label="校园任务速览">${items.map(item => `<button type="button" data-route="${item.route}"><i data-lucide="${item.icon}"></i><span><small>${escapeHTML(item.label)}</small><strong>${escapeHTML(item.title)}</strong></span><i data-lucide="chevron-right"></i></button>`).join('')}</div>`;
}

function renderUpload(upload, index) {
  const preview = upload.type === 'video'
    ? `<video src="${escapeHTML(upload.preview)}" muted preload="metadata"></video>`
    : `<img src="${escapeHTML(upload.preview)}" alt="待上传图片 ${index + 1}">`;
  const status = upload.status === 'error'
    ? `<span class="upload-status"><i data-lucide="circle-alert"></i>${escapeHTML(upload.error || '上传失败')}</span>`
    : upload.status === 'done'
      ? '<span class="upload-status"><i data-lucide="check"></i>已上传</span>'
      : `<span class="upload-status"><progress max="100" value="${upload.progress}"></progress>${upload.progress}%</span>`;
  return `<div class="upload-tile" data-upload-id="${upload.id}">${preview}<div class="upload-tools">
    ${index > 0 ? `<button type="button" data-move-upload="left" data-upload-id="${upload.id}" aria-label="向前移动"><i data-lucide="arrow-left"></i></button>` : ''}
    ${index < state.uploads.length - 1 ? `<button type="button" data-move-upload="right" data-upload-id="${upload.id}" aria-label="向后移动"><i data-lucide="arrow-right"></i></button>` : ''}
    ${upload.status === 'error' ? `<button type="button" data-retry-upload="${upload.id}" aria-label="重试上传"><i data-lucide="rotate-cw"></i></button>` : ''}
    <button type="button" data-remove-upload="${upload.id}" aria-label="删除附件"><i data-lucide="trash-2"></i></button>
  </div>${status}</div>`;
}

function renderPostMedia(post) {
  const images = post.media.filter(item => item.type === 'image');
  const videos = post.media.filter(item => item.type === 'video');
  const imageGrid = images.length ? `<div class="post-media count-${Math.min(images.length, 3)}">${images.map((item, index) => `<button class="media-button" type="button" data-view-media="${escapeHTML(item.url)}" data-media-type="image" aria-label="查看图片 ${index + 1}"><img src="${escapeHTML(item.url)}" alt="${escapeHTML(item.name || `帖子图片 ${index + 1}`)}" loading="lazy"></button>`).join('')}</div>` : '';
  const video = videos[0] ? `<div class="video-wrap"><video src="${escapeHTML(videos[0].url)}" controls playsinline preload="metadata" ${videos[0].poster ? `poster="${escapeHTML(videos[0].poster)}"` : ''}><track kind="captions"></video>${videos[0].duration ? `<span class="video-duration">${formatDuration(videos[0].duration)}</span>` : ''}<div class="video-state" hidden>视频加载失败，请稍后重试</div></div>` : '';
  return imageGrid + video;
}

function renderPost(post, detail = false) {
  const section = SECTION_META[post.section]?.label || '校园生活';
  const tags = post.tags.map(tag => `<button class="inline-tag" type="button" data-tag="${escapeHTML(tag)}">${escapeHTML(tag)}</button>`).join('');
  const commentPanel = state.activeComment === post.id ? (state.authSession.can_publish ? `<form class="search-panel comment-form" data-comment-form="${post.id}"><div class="search-form-large"><input class="field" id="comment-input-${post.id}" name="comment" maxlength="800" placeholder="写下有帮助的回应…" required><button class="tool-button" type="button" data-ai-insert="comment-input-${post.id}" title="插入 @AI"><i data-lucide="sparkles"></i><span>@AI</span></button><button class="button button-small" type="submit">发布评论</button></div></form>` : '<div class="identity-provider"><i data-lucide="lock-keyhole"></i><span>手机访客可以查看评论；绑定 XJTLU 校园身份后才能回应。</span></div>') : '';
  const aiReply = state.aiReplies[post.id];
  const aiPanel = state.activeAI === post.id ? `<form class="search-panel ai-inline-form" data-ai-form="${post.id}"><span class="eyebrow">基于这篇话题提问</span><div class="search-form-large"><input class="field" name="question" maxlength="800" placeholder="总结重点、核对信息或整理下一步…" required><button class="button button-small" type="submit">问 AI</button></div>${aiReply ? `<div class="dialog-note"><strong>AI 回答：</strong>${escapeHTML(aiReply)}</div>` : ''}</form>` : '';
  const comments = detail ? `<section class="detail-comments"><div class="detail-section-heading"><h3>评论</h3><span>${Number(post.comments_count || post.comments?.length || 0)} 条</span></div>${post.comments?.length ? `<div class="simple-list">${post.comments.map(comment => { const ai = state.commentAIReplies[comment.id]; return `<div class="simple-row"><span class="avatar">${comment.anonymous ? '匿' : '校'}</span><div class="simple-content"><strong>${comment.anonymous ? '匿名同学' : '校园成员'}</strong><p>${escapeHTML(comment.content)}</p><div class="simple-meta"><span>${escapeHTML(formatTime(comment.time))}</span>${comment.ai_mention_count ? '<span class="status">@AI</span>' : ''}</div>${ai ? `<div class="ai-answer comment-ai-answer"><strong>AI 回答</strong><p>${escapeHTML(ai.reply || '暂时没有足够依据回答。')}</p><small>${escapeHTML(ai.uncertainty || '基于当前帖子上下文；重要事项请以官方信息为准。')}</small></div>` : ''}</div></div>`; }).join('')}</div>` : '<div class="detail-empty">还没有评论，成为第一个回应的人。</div>'}</section>` : '';
  const collectionTags = (post.collection_tags || []).map(tag => `<span class="inline-tag">#${escapeHTML(tag)}</span>`).join('');
  const collectionPanel = state.activeCollectionPost === post.id ? `<form class="collection-panel" data-collection-form="${escapeHTML(post.id)}"><div class="detail-section-heading"><div><strong>收藏到自己的 Tag</strong><small>收藏和个人 Tag 一次完成，Tag 由你自定义。</small></div><button class="icon-button" type="button" data-close-collection="${escapeHTML(post.id)}" aria-label="关闭"><i data-lucide="x"></i></button></div>${collectionTags ? `<div class="post-tags">${collectionTags}</div>` : ''}<div class="search-form-large"><input class="field" name="tag" maxlength="24" placeholder="例如：待复习、找队友、灵感"><button class="button button-small" type="submit">${post.collected ? '添加 Tag' : '收藏并添加 Tag'}</button></div>${post.collected ? `<button class="button button-secondary button-small" type="button" data-remove-collection="${escapeHTML(post.id)}">取消收藏</button>` : ''}</form>` : '';
  const likeAction = state.authSession.can_publish
    ? `<button class="action-button ${post.liked ? 'is-active' : ''}" type="button" data-like-post="${post.id}" aria-pressed="${post.liked ? 'true' : 'false'}"><i data-lucide="heart"></i><span class="label">${post.liked ? '已赞' : '赞'}</span><span>${post.likes || ''}</span></button>`
    : `<button class="action-button is-locked" type="button" data-route="identity" title="绑定学校邮箱后才能点赞"><i data-lucide="heart-off"></i><span class="label">绑定后点赞</span></button>`;
  return `<article class="post" data-post-id="${escapeHTML(post.id)}">
    <header class="post-head"><span class="avatar post-avatar">${escapeHTML(postAvatar(post))}</span><div class="post-author"><strong>${escapeHTML(post.anonymous ? '匿名同学' : post.author)}</strong><span>${escapeHTML(formatTime(post.time))} · ${postLanguage(post)}</span></div><span class="section-label">${escapeHTML(section)}</span></header>
    ${post.title ? `<h2 class="post-title"><button class="post-title-button" type="button" data-open-post="${escapeHTML(post.id)}">${escapeHTML(post.title)}</button></h2>` : ''}
    <p class="post-copy" data-open-post="${escapeHTML(post.id)}" role="button" tabindex="0" aria-label="打开话题详情">${escapeHTML(post.content)}</p>
    ${tags ? `<div class="post-tags">${tags}</div>` : ''}
    ${renderPostMedia(post)}
    <div class="post-actions">
      ${likeAction}
      <button class="action-button" type="button" data-comment-post="${post.id}"><i data-lucide="message-circle"></i><span class="label">评论</span><span>${post.comments_count || ''}</span></button>
      <button class="action-button ${post.collected ? 'is-active' : ''}" type="button" data-collect-post="${post.id}" aria-expanded="${state.activeCollectionPost === post.id}" aria-label="收藏并添加 Tag"><i data-lucide="bookmark-plus"></i><span class="label">${post.collected ? '已收藏 / Tag' : '收藏并加 Tag'}</span></button>
      <button class="action-button" type="button" data-ai-post="${post.id}"><i data-lucide="sparkles"></i><span class="label">问 AI</span></button>
      <button class="action-button report" type="button" data-report-post="${post.id}" aria-label="举报"><i data-lucide="flag"></i></button>
    </div>
    ${commentPanel}${aiPanel}${collectionPanel}${comments}
  </article>`;
}

function renderFeed() {
  const tabs = Object.entries(SECTION_META).map(([key, value]) => `<button class="feed-tab ${state.section === key ? 'is-active' : ''}" type="button" data-section="${key}">${value.label}</button>`).join('');
  let feed = skeletonFeed();
  if (!state.loading) {
    if (state.errors.posts) feed = stateBlock('话题暂时无法加载', '请检查网络后重试。其他校园入口仍然可用。', 'cloud-off', '<button class="button button-secondary button-small" type="button" data-retry-feed>重新加载</button>');
    else if (!state.posts.length) feed = stateBlock('这个分区还没有话题', '发布第一个问题或发现，让相关同学更容易找到它。', 'message-circle-dashed');
    else feed = state.posts.map(post => renderPost(post)).join('') + (state.posts.length < state.total ? `<div class="load-more"><button class="button button-secondary" type="button" id="load-more" ${state.loadingMore ? 'disabled' : ''}>${state.loadingMore ? '正在加载…' : '加载更多'}</button></div>` : '');
  }
  $('view-root').innerHTML = `${pageHeader('Campus topics', '校园话题', '从学术问题到校园生活，按分区连续阅读已审核内容。')}<div class="feed-tabs">${tabs}</div>${renderPriorityStrip()}${renderComposer()}<div class="feed-list">${feed}</div>`;
  refreshIcons();
}

function renderSearch() {
  const search = state.search;
  let body = stateBlock('从一个关键词开始', '同时搜索帖子标题与正文、Tag、分区、课程资料、问答和活动。', 'search');
  if (search.loading) body = skeletonFeed(2);
  if (search.error) body = stateBlock('搜索暂时失败', search.error, 'cloud-off');
  if (search.result) body = `${search.mode === 'ai' && search.aiReply ? `<div class="ai-answer search-ai-answer"><strong>基于当前搜索结果的 AI 回答</strong><p>${escapeHTML(search.aiReply)}</p><small>引用关键词与当前结果；重要事项请打开原始资料或官方通知核对。</small></div>` : ''}${renderSearchResult(search.result)}`;
  $('view-root').innerHTML = `${pageHeader('Discover', '发现校园内容', '结果可以按内容类型和分区筛选，并沿相关 Tag 继续探索。')}
    <section class="search-panel"><form id="search-page-form"><div class="search-form-large"><input class="field" id="search-keyword" value="${escapeHTML(search.keyword)}" placeholder="例如：CSE101、黑客松、期末复习" required><button class="button" type="submit"><i data-lucide="${search.mode === 'ai' ? 'sparkles' : 'search'}"></i>${search.mode === 'ai' ? '问 AI' : '搜索'}</button></div><div class="search-filters"><div class="segmented-control" aria-label="搜索模式"><button type="button" data-search-mode="search" class="${search.mode === 'search' ? 'is-active' : ''}">搜索内容</button><button type="button" data-search-mode="ai" class="${search.mode === 'ai' ? 'is-active' : ''}">问 AI</button></div><select class="field" id="search-type"><option value="all">全部类型</option><option value="post" ${search.type === 'post' ? 'selected' : ''}>帖子</option><option value="resource" ${search.type === 'resource' ? 'selected' : ''}>课程资料</option><option value="question" ${search.type === 'question' ? 'selected' : ''}>课程问答</option><option value="event" ${search.type === 'event' ? 'selected' : ''}>活动</option></select><select class="field" id="search-section"><option value="all">全部分区</option>${Object.entries(SECTION_META).filter(([key]) => key !== 'all').map(([key, value]) => `<option value="${key}" ${search.section === key ? 'selected' : ''}>${value.label}</option>`).join('')}</select></div></form></section>${body}`;
  refreshIcons();
}

function renderSearchResult(result, tagMode = false) {
  const groups = [
    ['posts', '帖子', item => `<strong>${escapeHTML(item.title || item.content)}</strong><p>${escapeHTML(SECTION_META[item.section]?.label || '')} · ${escapeHTML((item.tags || []).map(tag => `#${tag}`).join(' '))}</p>`],
    ['resources', '课程资料', item => `<strong>${escapeHTML(item.name || item['name'])}</strong><p>${escapeHTML(item.course || '')} · ${escapeHTML(item.type || '')} · ${escapeHTML(item.uploader || '')}</p>`],
    ['questions', '课程问答', item => `<strong>${escapeHTML(item.question || '')}</strong><p>${escapeHTML(item.course || '')} · ${Number(item.answers || 0)} 个回答</p>`],
    ['events', '活动', item => `<strong>${escapeHTML(item.title || '')}</strong><p>${escapeHTML(item.time || '')} · ${escapeHTML(item.location || '')}</p>`],
  ];
  const sections = groups.map(([key, label, renderer]) => {
    const items = result[key] || [];
    if (!items.length) return '';
    return `<section class="result-section"><h2>${label}<span>${items.length} 条</span></h2>${items.map(item => `<div class="result-row" ${key === 'posts' ? `data-open-post="${escapeHTML(item.id)}" tabindex="0" role="button"` : ''}>${renderer(item)}</div>`).join('')}</section>`;
  }).join('');
  const related = (result.related_tags || []).map(item => {
    const name = typeof item === 'string' ? item : item.name;
    return `<button class="tag-button" type="button" data-tag="${escapeHTML(name)}">${escapeHTML(name)}</button>`;
  }).join('');
  return `<div class="result-summary">${tagMode ? `Tag #${escapeHTML(result.tag)}` : `“${escapeHTML(result.keyword)}”`} 共找到 ${Number(result.total || 0)} 条内容</div>${sections || stateBlock('没有匹配内容', '尝试课程代码、活动名称或更短的关键词。', 'search-x')}${related ? `<div class="related-explore"><span class="status">继续探索</span>${related}</div>` : ''}`;
}

function renderTag() {
  const tag = state.tagResult?.tag || state.search.keyword;
  const body = state.search.loading ? skeletonFeed(2) : state.search.error ? stateBlock('Tag 内容加载失败', state.search.error, 'cloud-off') : state.tagResult ? renderSearchResult(state.tagResult, true) : skeletonFeed(2);
  $('view-root').innerHTML = `${pageHeader('Tag aggregation', `#${tag}`, '聚合同一议题下的帖子、课程问答、资料、活动和相关 Tag。', '<button class="button button-secondary button-small" type="button" data-route="feed"><i data-lucide="arrow-left"></i>返回话题</button>')}${body}`;
  refreshIcons();
}

function renderNotifications() {
  const content = state.errors.notifications ? stateBlock('通知暂时无法加载', '稍后重试，重要通知不会与普通话题混排。', 'cloud-off') : state.notifications.length ? `<div class="simple-list">${state.notifications.map(item => `<div class="simple-row"><span class="simple-icon"><i data-lucide="${item.priority === 'important' || item.pinned ? 'bell-ring' : 'bell'}"></i></span><div class="simple-content"><strong>${escapeHTML(item.content)}</strong><div class="simple-meta"><span>${escapeHTML(formatTime(item.time))}</span>${item.pinned ? '<span class="status important">置顶</span>' : ''}<span class="status ${item.priority === 'important' ? 'important' : item.processed ? 'success' : ''}">${item.processed ? '已处理' : item.saved_for_later ? '稍后处理' : item.read ? '已读' : '未读'}</span></div></div><div class="row-actions">${!item.processed ? `<button class="button button-secondary button-small" type="button" data-notification-action="later" data-notification-id="${escapeHTML(item.id)}">${item.saved_for_later ? '取消稍后' : '稍后'}</button><button class="button button-small" type="button" data-notification-action="processed" data-notification-id="${escapeHTML(item.id)}">标记处理</button>` : ''}</div></div>`).join('')}</div>` : stateBlock('没有通知', '需要处理的校园信息会出现在这里。', 'bell-off');
  $('view-root').innerHTML = `${pageHeader('Notifications', '通知中心', '重要通知与普通校园话题保持分离，支持明确的已读状态。')}${content}`;
  refreshIcons();
}

function renderResources() {
  const saved = JSON.parse(localStorage.getItem('surf-saved-resources') || '[]');
  const recent = JSON.parse(localStorage.getItem('surf-recent-resources') || '[]');
  const { keyword, year, term, major, course, type, mode } = state.resourceFilters;
  const catalog = state.resourceCatalog || { years: [], terms: [], majors: [], courses: [] };
  const majorOptions = (catalog.majors || []).filter(item => year === 'all' || (item.years || []).includes(year));
  const courseOptions = (catalog.courses || []).filter(item => (year === 'all' || item.year === year) && (term === 'all' || item.term === term) && (major === 'all' || item.major === major || item.major === 'all-majors'));
  const resources = state.resources.filter(item => {
    const matchesText = !keyword || `${item.name} ${item.course} ${item.type} ${item.uploader} ${item.major}`.toLowerCase().includes(keyword.toLowerCase());
    return matchesText && (year === 'all' || item.year === year) && (term === 'all' || item.term === term) && (major === 'all' || item.major === major || item.major === 'all-majors') && (course === 'all' || item.course === course) && (type === 'all' || item.type === type) && (mode === 'all' || (mode === 'saved' ? saved.includes(item.id) : recent.includes(item.id)));
  });
  const typeOptions = [...new Set(state.resources.map(item => item.type).filter(Boolean))];
  const labelFor = (items, value) => items.find(item => item.value === value)?.label || value;
  const content = state.errors.resources ? stateBlock('资料暂时无法加载', '请稍后重试。', 'cloud-off') : resources.length ? `<div class="simple-list">${resources.map(item => `<div class="simple-row resource-row"><span class="simple-icon"><i data-lucide="file-text"></i></span><button class="simple-content resource-open" type="button" data-resource-open="${escapeHTML(item.id)}"><strong>${escapeHTML(item.name)}</strong><p>${escapeHTML(item.course)} · ${escapeHTML(item.type)}</p><div class="simple-meta"><span>${escapeHTML(labelFor(catalog.years || [], item.year))}</span><span>${escapeHTML(labelFor(catalog.terms || [], item.term))}</span><span>${escapeHTML(labelFor(catalog.majors || [], item.major))}</span><span>上传者 ${escapeHTML(item.uploader)}</span><span>${item.file_url ? '可预览 / 下载' : '仅元数据'}</span></div></button><button class="button button-secondary button-small" type="button" data-tag="${escapeHTML(item.course)}">相关内容</button></div>`).join('')}</div>` : stateBlock('这个课程路径下还没有资料', '可返回上一步更换年级、学期、专业或课程。', 'search-x');
  const questions = state.errors.questions ? stateBlock('课程问答暂时无法加载', '资料列表仍可继续使用。', 'cloud-off') : state.questions.length ? `<div class="simple-list">${state.questions.map(item => {
    const question = item.question ?? item['问题']; const course = item.course ?? item['课程']; const answers = item.answers_detail || [];
    return `<div class="simple-row"><span class="simple-icon"><i data-lucide="message-circle-question"></i></span><div class="simple-content"><strong>${escapeHTML(question)}</strong><div class="simple-meta"><span>${escapeHTML(course)}</span><span>${Number(item.answers ?? item['回答数'] ?? 0)} 个回答</span></div>${answers.length ? `<p><b>${escapeHTML(answers[0].role || '课程团队')}：</b>${escapeHTML(answers[0].content)}</p><div class="answer-actions"><span class="status ${answers[0].accepted ? 'success' : ''}">${answers[0].accepted ? '已采纳' : '人工回答'}</span>${!answers[0].accepted ? `<button class="button button-secondary button-small" type="button" data-accept-answer="${escapeHTML(answers[0].id)}" data-question-id="${escapeHTML(item.id)}">采纳回答</button>` : ''}</div>` : '<p>等待教师、助教或前辈回答</p>'}</div></div>`;
  }).join('')}</div>` : stateBlock('还没有课程问题', '提出第一个问题，回答会沉淀在课程上下文中。', 'messages-square');
  const pathSummary = [year !== 'all' ? labelFor(catalog.years || [], year) : '', term !== 'all' ? labelFor(catalog.terms || [], term) : '', major !== 'all' ? labelFor(catalog.majors || [], major) : '', course !== 'all' ? course : ''].filter(Boolean).join(' / ');
  $('view-root').innerHTML = `${pageHeader('Course library', '课程资料与问答', '先选年级与上下学期，再按专业进入具体课程；大一默认使用共同课程路径。')}<section class="search-panel"><form id="resource-filter-form"><div class="resource-path" aria-label="资料筛选路径"><label><span>1 年级</span><select class="field" id="resource-year"><option value="all">全部年级</option>${(catalog.years || []).map(item => `<option value="${escapeHTML(item.value)}" ${year === item.value ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('')}</select></label><label><span>2 学期</span><select class="field" id="resource-term"><option value="all">上 / 下学期</option>${(catalog.terms || []).map(item => `<option value="${escapeHTML(item.value)}" ${term === item.value ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('')}</select></label><label><span>3 专业</span><select class="field" id="resource-major"><option value="all">全部专业</option>${majorOptions.map(item => `<option value="${escapeHTML(item.value)}" ${major === item.value ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('')}</select></label><label><span>4 课程</span><select class="field" id="resource-course"><option value="all">全部课程</option>${courseOptions.map(item => `<option value="${escapeHTML(item.value)}" ${course === item.value ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('')}</select></label></div>${pathSummary ? `<div class="resource-path-summary"><i data-lucide="route"></i>${escapeHTML(pathSummary)}</div>` : ''}<div class="search-form-large resource-search-row"><input class="field" id="resource-keyword" value="${escapeHTML(keyword)}" placeholder="在当前课程路径中搜索资料"><select class="field" id="resource-type"><option value="all">全部类型</option>${typeOptions.map(value => `<option value="${escapeHTML(value)}" ${type === value ? 'selected' : ''}>${escapeHTML(value)}</option>`).join('')}</select><button class="button button-secondary" type="submit">筛选</button></div><div class="search-filters"><div class="segmented-control" aria-label="资料范围"><button type="button" data-resource-mode="all" class="${mode === 'all' ? 'is-active' : ''}">全部</button><button type="button" data-resource-mode="recent" class="${mode === 'recent' ? 'is-active' : ''}">最近</button><button type="button" data-resource-mode="saved" class="${mode === 'saved' ? 'is-active' : ''}">收藏</button></div></div></form></section><section class="result-section"><h2>课程资料 <span>${resources.length} 项</span></h2>${content}</section><section class="search-panel"><form id="question-form"><span class="eyebrow">提交课程问题</span><div class="search-form-large"><select class="field" name="course">${(courseOptions.length ? courseOptions : catalog.courses || []).map(item => `<option value="${escapeHTML(item.value)}">${escapeHTML(item.label)}</option>`).join('')}</select><input class="field" name="question" maxlength="800" placeholder="把问题留在课程上下文里…" required><button class="button" type="submit">提问</button></div><label class="identity-toggle"><input name="anonymous" type="checkbox"><span>匿名提问</span></label></form></section><section class="result-section"><h2>课程问答 <span>${state.questions.length} 项</span></h2>${questions}</section>`;
  refreshIcons();
}

function renderResourceDetail() {
  const item = state.selectedResource;
  if (!item) { routeTo('resources'); return; }
  const saved = JSON.parse(localStorage.getItem('surf-saved-resources') || '[]');
  const isSaved = saved.includes(item.id);
  const preview = item.file_url && ['application/pdf', 'text/plain', 'text/markdown'].includes(item.mime)
    ? `<div class="resource-preview"><iframe src="${escapeHTML(item.file_url)}" title="${escapeHTML(item.name)} 预览"></iframe></div>`
    : stateBlock(item.file_url ? '该文件需要下载后查看' : '当前只有资料元数据', item.file_url ? 'DOCX/PPTX 不在浏览器内直接预览。' : '课程团队上传真实文件后，预览与下载会在这里启用。', item.file_url ? 'file-down' : 'file-question');
  $('view-root').innerHTML = `${pageHeader('Resource detail', item.name, `${item.course} · ${item.type} · ${item.semester}`, '<button class="button button-secondary button-small" type="button" data-route="resources"><i data-lucide="arrow-left"></i>返回资料</button>')}<article class="resource-detail"><div class="resource-meta"><span>上传者 ${escapeHTML(item.uploader)}</span><span>${item.file_name ? escapeHTML(item.file_name) : '未附文件'}</span><span>${item.size ? `${Math.ceil(item.size / 1024)} KB` : ''}</span></div>${preview}<div class="resource-actions"><button class="button button-secondary" type="button" data-save-resource="${escapeHTML(item.id)}"><i data-lucide="bookmark"></i>${isSaved ? '已收藏' : '收藏'}</button>${item.file_url ? `<a class="button" href="${escapeHTML(item.file_url)}" download="${escapeHTML(item.file_name || item.name)}"><i data-lucide="download"></i>下载</a>` : '<button class="button" type="button" disabled><i data-lucide="download"></i>暂无文件</button>'}<button class="button button-secondary" type="button" data-ai-resource="${escapeHTML(item.id)}"><i data-lucide="sparkles"></i>问 AI</button></div><div id="resource-ai"></div></article>`;
  refreshIcons();
}

function renderEvents() {
  const content = state.errors.events ? stateBlock('活动暂时无法加载', '请稍后重试。', 'cloud-off') : state.events.length ? `<div class="simple-list">${state.events.map(item => {
    const registered = Boolean(item.registered_by_me);
    const actions = registered
      ? `<button class="button button-secondary button-small" type="button" data-event-cancel="${escapeHTML(item.id)}">取消报名</button><button class="button button-secondary button-small" type="button" data-event-reminder="${escapeHTML(item.id)}" data-reminder-enabled="${item.reminder_enabled ? 'true' : 'false'}">${item.reminder_enabled ? '关闭提醒' : '开启提醒'}</button><a class="button button-secondary button-small" href="/api/events/${encodeURIComponent(item.id)}/calendar" download>日历</a>`
      : `<button class="button button-secondary button-small" type="button" data-event="${escapeHTML(item.id)}">报名</button>`;
    return `<div class="simple-row"><span class="simple-icon"><i data-lucide="calendar-days"></i></span><div class="simple-content"><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.description || '')}</p><div class="simple-meta"><span>${escapeHTML(item.time)}</span><span>${escapeHTML(item.location)}</span><span>${escapeHTML(item.organizer)}</span>${registered ? '<span class="status success">已报名</span>' : ''}</div></div><div class="row-actions">${actions}</div></div>`;
  }).join('')}</div>` : stateBlock('近期没有活动', '活动组织者发布后会出现在这里。', 'calendar-off');
  $('view-root').innerHTML = `${pageHeader('Campus events', '校园活动', '先看时间、地点和组织方，再决定是否参加。')}${content}`;
  refreshIcons();
}

function renderOpportunities() {
  const canStart = Boolean(state.authSession.phone_authenticated || state.authSession.email_authenticated);
  const createPanel = canStart
    ? `<section class="search-panel team-create-panel"><div class="detail-section-heading"><div><strong>发起一个组队</strong><small>每位已登录用户都可以创建招募，发布后会自动生成项目群。</small></div><span class="status success">可发布</span></div><form id="opportunity-create-form"><div class="search-form-large"><input class="field" name="title" maxlength="160" placeholder="招募标题，例如：一起参加 AI 黑客松" required><select class="field" name="kind"><option>项目招募</option><option>比赛招募</option><option>课程项目</option><option>科研合作</option></select></div><div class="search-form-large"><input class="field" name="skills" placeholder="需要的技能，用逗号分隔"><input class="field" name="deadline" placeholder="截止日期，例如 2026-08-15"><input class="field" name="capacity" type="number" min="1" max="1000" value="3" aria-label="招募人数"></div><textarea class="field" name="description" maxlength="1200" rows="3" placeholder="说说项目目标、时间安排和你希望找到的队友"></textarea><div class="composer-bottom"><span class="simple-meta">登录身份：${escapeHTML(state.authSession.name || state.authSession.phone_masked || '校园成员')}</span><button class="button" type="submit"><i data-lucide="users-round"></i>发布组队</button></div></form></section>`
    : `<section class="identity-card composer-gate"><div class="detail-section-heading"><div><strong>登录后发起组队</strong><small>手机或邮箱登录后即可创建招募。</small></div><span class="status important">需要登录</span></div></section>`;
  const content = state.errors.opportunities
    ? stateBlock('组队招募暂时无法加载', '请稍后重试，已提交的申请不会丢失。', 'cloud-off')
    : state.opportunities.length
      ? `<div class="simple-list">${state.opportunities.map(item => {
        const application = item.my_application;
        const skillTags = (item.skills || []).map(skill => `<span class="inline-tag">${escapeHTML(skill)}</span>`).join('');
        const applyOpen = state.activeOpportunityApply === item.id;
        const applyForm = applyOpen ? `<form class="inline-action-form" data-opportunity-apply-form="${escapeHTML(item.id)}" id="opportunity-apply-${escapeHTML(item.id)}"><label for="opportunity-message-${escapeHTML(item.id)}">申请留言 <span>可选</span></label><div class="inline-action-fields"><textarea class="field" id="opportunity-message-${escapeHTML(item.id)}" name="message" maxlength="600" rows="2" placeholder="简要说明你的相关经验或可投入时间"></textarea><div class="inline-action-buttons"><button class="button button-secondary button-small" type="button" data-cancel-opportunity="${escapeHTML(item.id)}">取消</button><button class="button button-small" type="submit"><i data-lucide="send"></i>提交申请</button></div></div></form>` : '';
        return `<article class="simple-row opportunity-row"><span class="simple-icon"><i data-lucide="users-round"></i></span><div class="simple-content"><strong>${escapeHTML(item.title)}</strong><p>${escapeHTML(item.description || '')}</p><div class="post-tags">${skillTags}</div><div class="simple-meta"><span>${escapeHTML(item.kind || '项目招募')}</span><span>截止 ${escapeHTML(item.deadline || '待定')}</span><span>${Number(item.applications_count || 0)} / ${Number(item.capacity || 0)} 人</span><span class="status ${item.match_score ? 'success' : ''}">${escapeHTML(item.match_reason || '等待匹配')}</span></div></div><div class="row-actions">${application ? `<span class="status ${application.status === 'accepted' ? 'success' : application.status === 'rejected' ? 'hidden' : ''}">${application.status === 'accepted' ? '已通过' : application.status === 'rejected' ? '未通过' : '申请中'}</span>` : `<button class="button button-secondary button-small" type="button" data-apply-opportunity="${escapeHTML(item.id)}" aria-expanded="${applyOpen}" aria-controls="opportunity-apply-${escapeHTML(item.id)}">申请加入</button>`}</div>${applyForm}</article>`;
      }).join('')}</div>`
      : stateBlock('还没有公开招募', '项目发起人发布比赛、科研或课程项目后会出现在这里。', 'users-round');
  $('view-root').innerHTML = `${pageHeader('Teams & projects', '组队与项目', '按技能查看项目、比赛和科研招募，申请状态会保留在当前身份下。')}${createPanel}<section class="search-panel"><div class="simple-meta"><span>你的技能</span>${state.opportunitySkills.map(skill => `<span class="inline-tag">${escapeHTML(skill)}</span>`).join('') || '<span class="status">暂未设置</span>'}</div></section>${content}`;
  refreshIcons();
}

function renderDirectory() {
  const people = state.errors.directory ? stateBlock('通讯录暂时无法加载', state.errors.directory, 'cloud-off') : state.directoryPeople.length ? `<div class="simple-list">${state.directoryPeople.map(person => {
    const chatOpen = state.activeDirectoryChat === person.id;
    const chatForm = chatOpen ? `<form class="inline-action-form" data-directory-chat-form="${escapeHTML(person.id)}" id="directory-chat-${escapeHTML(person.id)}"><label for="directory-message-${escapeHTML(person.id)}">发给 ${escapeHTML(person.name)}</label><div class="inline-action-fields"><textarea class="field" id="directory-message-${escapeHTML(person.id)}" name="message" maxlength="1000" rows="2" placeholder="写下第一条消息…" required></textarea><div class="inline-action-buttons"><button class="button button-secondary button-small" type="button" data-cancel-chat="${escapeHTML(person.id)}">取消</button><button class="button button-small" type="submit"><i data-lucide="send"></i>发送</button></div></div></form>` : '';
    return `<div class="simple-row directory-row"><span class="avatar">${escapeHTML((person.name || '校').slice(0, 1))}</span><div class="simple-content"><strong>${escapeHTML(person.name)}</strong><p>${escapeHTML(person.department)} · ${escapeHTML(person.year || person.role)}</p><div class="post-tags">${(person.tags || []).map(tag => `<span class="inline-tag">${escapeHTML(tag)}</span>`).join('')}</div></div>${person.id === 'u001' ? '<span class="status">当前账号</span>' : `<button class="button button-secondary button-small" type="button" data-start-chat="${escapeHTML(person.id)}" data-person-name="${escapeHTML(person.name)}" aria-expanded="${chatOpen}" aria-controls="directory-chat-${escapeHTML(person.id)}"><i data-lucide="message-circle"></i>私聊</button>`}${chatForm}</div>`;
  }).join('')}</div>` : stateBlock('没有匹配的师生', '尝试姓名、学院或更短的关键词。', 'contact-round');
  const groups = state.groups.length ? `<div class="simple-list">${state.groups.map(group => `<article class="simple-row group-row"><span class="simple-icon"><i data-lucide="messages-square"></i></span><div class="simple-content"><strong>${escapeHTML(group.name)}</strong><p>${escapeHTML(group.description || '')}</p><div class="simple-meta"><span>${Number(group.members?.length || 0)} 位成员</span><span>关联招募 ${escapeHTML(group.opportunity_id || '')}</span></div><div class="group-messages">${(group.messages || []).slice(-3).map(message => `<p><b>${escapeHTML(message.sender)}：</b>${escapeHTML(message.content)} <small>${escapeHTML(formatTime(message.time))}</small></p>`).join('')}</div><form class="search-panel group-message-form" data-group-message-form="${escapeHTML(group.id)}"><div class="search-form-large"><input class="field" name="content" maxlength="1000" placeholder="同步一条项目进展…" required><button class="button button-small" type="submit">发送</button></div></form></div></article>`).join('')}</div>` : stateBlock('还没有项目群', '通过组队招募后，相关项目群会出现在这里。', 'messages-square');
  $('view-root').innerHTML = `${pageHeader('Campus directory', '校内通讯与项目群', '按姓名或学院发现不同年级同学，私聊和项目群保持在校内身份范围。')}<section class="search-panel"><form id="directory-form"><div class="search-form-large"><input class="field" id="directory-keyword" value="${escapeHTML(state.directoryKeyword)}" placeholder="搜索姓名或学院"><button class="button" type="submit"><i data-lucide="search"></i>查找</button></div></form></section><section class="result-section"><h2>校内成员 <span>${state.directoryPeople.length} 人</span></h2>${people}</section><section class="result-section"><h2>项目群 <span>${state.groups.length} 个</span></h2>${groups}</section>`;
  refreshIcons();
}

function rankPosts(posts) {
  const interests = (state.preferences.interests || []).map(value => String(value).toLowerCase());
  const sections = new Set(state.preferences.sections || []);
  const score = post => (sections.has(post.section) ? 2 : 0) + interests.reduce((sum, interest) => sum + (`${post.title} ${post.content} ${(post.tags || []).join(' ')}`.toLowerCase().includes(interest) ? 1 : 0), 0);
  return [...posts].sort((a, b) => score(b) - score(a));
}

function renderPreferences() {
  const sections = Object.entries(SECTION_META).filter(([key]) => key !== 'all').map(([key, meta]) => `<label class="identity-toggle"><input type="checkbox" name="sections" value="${key}" ${state.preferences.sections.includes(key) ? 'checked' : ''}><span>${meta.label}</span></label>`).join('');
  const profile = state.profile || {};
  const avatars = Object.entries(AVATAR_META).map(([key, meta]) => `<label class="avatar-choice"><input type="radio" name="avatar" value="${key}" ${profile.avatar === key ? 'checked' : ''}><span class="avatar avatar-${key}"><i data-lucide="${meta.icon}"></i></span><small>${meta.label}</small></label>`).join('');
  const records = state.participation.records?.length ? state.participation.records.map(item => `<div class="simple-row"><span class="simple-icon"><i data-lucide="badge-check"></i></span><div class="simple-content"><strong>${escapeHTML(item.label)}</strong><div class="simple-meta"><span>${escapeHTML(item.time)}</span><span>${escapeHTML(item.type)}</span></div></div><span class="status success">+${Number(item.points || 0)}</span></div>`).join('') : '<div class="empty">暂无参与记录</div>';
  const theme = ['system', 'light', 'dark'].map(value => `<label class="theme-choice"><input type="radio" name="theme" value="${value}" ${state.preferences.theme === value ? 'checked' : ''}><span>${value === 'system' ? '跟随系统' : value === 'light' ? '明亮模式' : '黑暗模式'}</span></label>`).join('');
  $('view-root').innerHTML = `${pageHeader('Profile preferences', '个人资料与设置', '资料用于你的公开身份，偏好和主题设置会保存到当前账号。', '<button class="button button-secondary button-small" type="button" data-route="feed"><i data-lucide="arrow-left"></i>返回话题</button>')}<section class="identity-card profile-panel"><div class="detail-section-heading"><div><span class="eyebrow">Profile</span><h2>你的公开资料</h2></div><span class="status ${profile.profile_complete ? 'success' : 'important'}">${profile.profile_complete ? '已完成' : '待完成'}</span></div><form id="profile-form"><div class="avatar-picker" role="radiogroup" aria-label="选择头像">${avatars}</div><label class="field-label" for="profile-username">用户名</label><input class="field" id="profile-username" name="username" minlength="2" maxlength="24" value="${escapeHTML(profile.username || state.authSession.name || '')}" required><label class="field-label" for="profile-bio">简介 <span class="field-hint">可选</span></label><textarea class="field" id="profile-bio" name="bio" maxlength="160" rows="3" placeholder="一句话介绍你的兴趣或正在做的事">${escapeHTML(profile.bio || '')}</textarea><label class="field-label" for="profile-birthday">生日 <span class="field-hint">可选</span></label><input class="field" id="profile-birthday" name="birthday" type="date" value="${escapeHTML(profile.birthday || '')}"><p class="login-message" id="profile-message" aria-live="polite"></p><button class="button" type="submit"><i data-lucide="save"></i>保存资料</button></form></section><section class="search-panel"><form id="preferences-form"><div class="field-label">首页分区</div><div class="preference-grid">${sections}</div><label class="field-label" for="preference-interests">兴趣 Tag</label><input class="field" id="preference-interests" name="interests" value="${escapeHTML(state.preferences.interests.join(', '))}" placeholder="例如 AI, 羽毛球, CSE101"><label class="field-label" for="content-language">内容语言</label><select class="field" id="content-language" name="content_language"><option value="mixed" ${state.preferences.content_language === 'mixed' ? 'selected' : ''}>中英混合</option><option value="zh" ${state.preferences.content_language === 'zh' ? 'selected' : ''}>中文优先</option><option value="en" ${state.preferences.content_language === 'en' ? 'selected' : ''}>English first</option></select><div class="field-label">主题模式</div><div class="theme-grid">${theme}</div><label class="identity-toggle"><input type="checkbox" name="show_context_rail" ${state.preferences.show_context_rail ? 'checked' : ''}><span>显示桌面端校园速览</span></label><button class="button" type="submit"><i data-lucide="save"></i>保存设置</button></form></section><section class="result-section"><h2>参与记录 <span>${Number(state.participation.points || 0)} 积分</span></h2><div class="simple-list">${records}</div></section>`;
  refreshIcons();
}

function renderIdentity() {
  const session = state.authSession;
  const verified = Boolean(session.campus_verified);
  const phoneForm = `<section class="identity-card"><div><span class="eyebrow">Phone access</span><h2>手机验证码登录</h2></div><p>手机登录用于浏览校园内容，不授予发帖、评论或课程提问权限。</p><form data-identity-phone-login><div class="search-form-large"><input class="field" name="phone" inputmode="tel" maxlength="11" placeholder="11 位手机号" required><input class="field" name="code" inputmode="numeric" maxlength="6" placeholder="本地验证码 123456" required><button class="button" type="submit">手机登录</button></div></form></section>`;
  const bindActions = session.phone_authenticated && !verified ? `<section class="identity-card"><div class="detail-section-heading"><div><span class="eyebrow">School email</span><h2>绑定学校邮箱</h2></div><span class="status important">绑定后可互动</span></div><p>验证码只会发送到 <strong>@student.xjtlu.edu.cn</strong> 或 <strong>@xjtlu.edu.cn</strong> 邮箱。手机号登录但未完成绑定时，仍然不能发帖、评论或点赞。</p><form id="campus-email-bind-form"><div class="search-form-large"><input class="field" id="campus-email" name="email" type="email" placeholder="name@student.xjtlu.edu.cn" required><div class="login-input-wrap login-code-wrap"><input class="field" id="campus-email-code" name="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码" required><button class="send-code-button" id="send-campus-email-code" type="button">获取验证码</button></div></div><p class="login-message" id="campus-email-message" aria-live="polite"></p><button class="button" type="submit"><i data-lucide="badge-check"></i>验证并开启互动</button></form><div class="identity-actions">${state.authConfig.configured ? '<button class="button button-secondary" type="button" id="xjtlu-bind"><i data-lucide="external-link"></i>改用学校单点登录</button>' : ''}${state.authConfig.mock_binding_enabled ? '<button class="button button-secondary" type="button" id="mock-xjtlu-bind">本地验证绑定</button>' : ''}</div></section>` : '';
  const verifiedCard = verified ? `<section class="identity-card"><div class="detail-section-heading"><div><span class="eyebrow">Campus verified</span><h2>校内身份已验证</h2></div><span class="status success">可发布</span></div><p>${escapeHTML(session.name || '校园成员')} · ${escapeHTML(session.campus_account || '')}<br>${escapeHTML(session.phone_masked || '')}</p><div class="identity-actions"><button class="button button-secondary" type="button" data-route="preferences"><i data-lucide="sliders-horizontal"></i>首页偏好</button><button class="button button-secondary" type="button" id="remove-campus-binding">切换到手机访客</button></div></section>` : `<section class="identity-card"><div class="detail-section-heading"><div><span class="eyebrow">Campus verification</span><h2>绑定 XJTLU 校园身份</h2></div><span class="status important">不可发布</span></div><p>当前 ${escapeHTML(session.phone_masked || '手机号')} 只能浏览。完成学校账号授权后，才能发帖和参与公开讨论。</p>${bindActions}<div class="identity-provider"><i data-lucide="shield-check"></i><span>${state.authConfig.configured ? '学校 OAuth2 已配置，将跳转到 XJTLU Authentication Centre。' : '本地尚未配置学校发放的 OAuth2 client_id 与回调地址；可使用本地验证绑定测试权限闭环。'}</span></div></section>`;
  const logoutCard = session.phone_authenticated ? '<section class="identity-card"><div class="detail-section-heading"><div><span class="eyebrow">Session</span><h2>退出当前账号</h2></div></div><p>退出后将返回互动登录界面。</p><button class="button button-secondary" type="button" id="logout-session"><i data-lucide="log-out"></i>退出登录</button></section>' : '';
  $('view-root').innerHTML = `${pageHeader('Identity & access', '身份与登录', '手机号负责基础访问，XJTLU 学校邮箱负责校内身份验证和互动权限。', '<button class="button button-secondary button-small" type="button" data-route="feed"><i data-lucide="arrow-left"></i>返回话题</button>')}${verifiedCard}${verified ? phoneForm : ''}${session.phone_authenticated ? '' : phoneForm}${logoutCard}`;
  refreshIcons();
}

function renderTreehole() {
  const composer = `<section class="composer treehole-composer"><form id="treehole-form"><div class="composer-top"><span class="avatar">匿</span><div class="composer-body"><textarea id="treehole-text" name="content" maxlength="1200" placeholder="匿名写下一个只属于树洞的校园处境…">${escapeHTML(state.treeholeText)}</textarea><div class="composer-bottom"><div class="composer-tools"><span class="status">匿名树洞 · 前台匿名，违规内容可由管理端追溯</span></div><button class="button" type="submit" ${state.treeholeText.trim() ? '' : 'disabled'}><i data-lucide="send"></i>投进树洞</button></div></div></div></form></section>`;
  const list = state.errors.treeholes ? stateBlock('树洞暂时无法加载', state.errors.treeholes, 'cloud-off') : state.treeholes.length ? `<div class="simple-list">${state.treeholes.map(item => {
    const comments = item.comments?.length ? `<div class="treehole-comments">${item.comments.map(comment => `<div class="simple-row"><span class="avatar">匿</span><div class="simple-content"><p>${escapeHTML(comment.content)}</p><div class="simple-meta"><span>${escapeHTML(formatTime(comment.time))}</span><span class="status">匿名评论</span></div></div></div>`).join('')}</div>` : '';
    const commentPanel = state.activeTreeholeComment === item.id ? `<form class="search-panel treehole-comment-form" data-treehole-comment-form="${escapeHTML(item.id)}"><div class="search-form-large"><input class="field" name="content" maxlength="600" placeholder="匿名回应这个处境…" required><button class="button button-small" type="submit">匿名评论</button></div></form>` : '';
    return `<article class="post treehole-post"><header class="post-head"><span class="avatar post-avatar">匿</span><div class="post-author"><strong>匿名同学</strong><span>${escapeHTML(formatTime(item.time || item['时间']))}</span></div><span class="section-label">匿名树洞</span></header><p class="post-copy">${escapeHTML(item.content || item['内容'])}</p><div class="post-actions"><button class="action-button" type="button" data-treehole-comment="${escapeHTML(item.id)}"><i data-lucide="message-circle"></i><span class="label">评论</span><span>${item.comments_count || ''}</span></button><button class="action-button report" type="button" data-treehole-report="${escapeHTML(item.id)}"><i data-lucide="flag"></i><span class="label">举报</span></button>${item.reported ? '<span class="status important">已进入审核</span>' : ''}</div>${commentPanel}${comments}</article>`;
  }).join('')}</div>` : stateBlock('树洞里还没有内容', '发布一个匿名处境，公共实名话题流不会展示它。', 'lock-keyhole');
  $('view-root').innerHTML = `${pageHeader('Anonymous space', '匿名树洞', '树洞不默认混入实名公共话题流；按场景匿名表达，并保留必要的安全追溯。')}${composer}${list}`;
  refreshIcons();
}

function renderDetail() {
  if (!state.selectedPost) {
    $('view-root').innerHTML = `${pageHeader('Topic detail', '话题详情', '正在加载完整内容。')}${skeletonFeed(1)}`;
    refreshIcons();
    return;
  }
  $('view-root').innerHTML = `${pageHeader('Topic detail', SECTION_META[state.selectedPost.section]?.label || '校园话题', '查看完整话题、媒体和讨论。', '<button class="button button-secondary button-small" type="button" data-route="feed"><i data-lucide="arrow-left"></i>返回话题</button>')}<div class="feed-list">${renderPost(state.selectedPost, true)}</div>`;
  refreshIcons();
}

function render() {
  document.querySelectorAll('[data-route]').forEach(button => button.classList.toggle('is-active', button.dataset.route === state.route));
  if (state.route === 'feed') renderFeed();
  if (state.route === 'search') renderSearch();
  if (state.route === 'tag') renderTag();
  if (state.route === 'notifications') renderNotifications();
  if (state.route === 'resources') renderResources();
  if (state.route === 'resource-detail') renderResourceDetail();
  if (state.route === 'events') renderEvents();
  if (state.route === 'opportunities') renderOpportunities();
  if (state.route === 'directory') renderDirectory();
  if (state.route === 'preferences') renderPreferences();
  if (state.route === 'identity') renderIdentity();
  if (state.route === 'treehole') renderTreehole();
  if (state.route === 'detail') renderDetail();
}

function renderRails() {
  const unread = state.notifications.filter(item => !item.read);
  $('nav-unread').textContent = unread.length;
  $('nav-unread').hidden = unread.length === 0;
  $('unread-dot').hidden = unread.length === 0;
  document.querySelector('.context-rail')?.classList.toggle('is-hidden', state.preferences.show_context_rail === false);
  document.querySelector('.app-shell')?.classList.toggle('hide-context-rail', state.preferences.show_context_rail === false);
  $('rail-notifications').innerHTML = unread.slice(0, 3).map(item => `<div class="rail-notification"><span>${escapeHTML(item.content)}<small>${escapeHTML(formatTime(item.time))}</small></span></div>`).join('') || '<span class="status success">没有未读通知</span>';
  $('rail-tags').innerHTML = state.tags.slice(0, 10).map(item => `<button class="hot-tag" type="button" data-tag="${escapeHTML(item.name)}">#${escapeHTML(item.name)} <b>${item.count || ''}</b></button>`).join('') || '<span class="status">暂无热门 Tag</span>';
  const event = state.events[0];
  if (event) $('rail-event').innerHTML = `<div class="rail-kicker">下一场校园活动</div><h2>${escapeHTML(event.title)}</h2><p>${escapeHTML(event.time)} · ${escapeHTML(event.location)}</p>`;
  refreshIcons();
}

function renderIdentityChrome() {
  const verified = Boolean(state.authSession.campus_verified);
  const profile = state.profile || {};
  const note = $('identity-note-text');
  if (note) note.innerHTML = verified ? '校内身份已验证<br><small>公开内容默认实名</small>' : '手机访客<br><small>绑定 XJTLU 后可发布</small>';
  const icon = $('identity-note')?.querySelector('i, svg');
  if (icon?.tagName === 'I') icon.dataset.lucide = verified ? 'shield-check' : 'smartphone';
  const name = document.querySelector('.profile-button strong');
  const meta = document.querySelector('.profile-button small');
  const avatar = document.querySelector('.profile-button .avatar');
  if (name) name.textContent = profile.username || state.authSession.name || '手机访客';
  if (meta) meta.textContent = profile.bio || (verified ? 'XJTLU 校内身份' : '仅浏览');
  if (avatar) {
    avatar.className = `avatar avatar-${profile.avatar || 'sun'}`;
    avatar.innerHTML = `<i data-lucide="${AVATAR_META[profile.avatar]?.icon || 'user-round'}" aria-hidden="true"></i>`;
  }
  refreshIcons();
}

async function loadFeed(reset = true) {
  if (reset) {
    state.loading = true;
    state.page = 1;
    state.posts = [];
    state.errors.posts = '';
    render();
  } else {
    state.loadingMore = true;
    render();
  }
  try {
    const section = state.section === 'all' ? '' : `&section=${encodeURIComponent(state.section)}`;
    const data = await api(`/api/community/feed?page=${state.page}${section}`);
    const posts = asArray(data, 'posts').map(normalizePost);
    state.posts = rankPosts(reset ? posts : [...state.posts, ...posts]);
    state.total = Number(data.total || state.posts.length);
  } catch (error) {
    state.errors.posts = error.message;
  } finally {
    state.loading = false;
    state.loadingMore = false;
    render();
  }
}

async function loadInitialData() {
  state.loading = true;
  render();
  const requests = {
    posts: api('/api/community/feed?page=1'),
    notifications: api('/api/notifications'),
    assignments: api('/api/courses/assignments'),
    resources: api('/api/courses/resources'),
    resourceCatalog: api('/api/courses/catalog'),
    questions: api('/api/courses/qa'),
    events: api('/api/events'),
    opportunities: api('/api/opportunities'),
    treeholes: api('/api/treehole/hot'),
    directory: api('/api/directory'),
    groups: api('/api/groups'),
    conversations: api('/api/messaging/conversations'),
    profile: api('/api/profile'),
    preferences: api('/api/profile/preferences'),
    participation: api('/api/profile/participation'),
    authSession: api('/api/auth/session'),
    authConfig: api('/api/auth/xjtlu/config'),
    tags: api('/api/discover/tags'),
  };
  const results = await Promise.allSettled(Object.entries(requests).map(async ([key, request]) => [key, await request]));
  results.forEach((result, index) => {
    const key = Object.keys(requests)[index];
    if (result.status === 'rejected') {
      state.errors[key] = result.reason.message;
      return;
    }
    const data = result.value[1];
    if (key === 'posts') { state.posts = asArray(data, 'posts').map(normalizePost); state.total = Number(data.total || state.posts.length); }
    if (key === 'notifications') state.notifications = asArray(data, 'notifications').map(item => ({ ...item, read: Boolean(item.read ?? item['已读']), content: item.content ?? item['内容'], time: item.time ?? item['时间'], priority: item.priority || 'normal' }));
    if (key === 'resources') state.resources = asArray(data, 'resources').map((item, index) => ({ id: item.id || `resource_${index}`, name: item.name ?? item['名称'], course: item.course ?? item['课程'], type: item.type ?? item['类型'], uploader: item.uploader ?? item['上传者'], description: item.description || '', year: item.year || 'all', term: item.term || 'all', major: item.major || 'all', semester: item.semester || '2026 Summer', file_url: item.file_url || null, file_name: item.file_name || null, mime: item.mime || null, size: Number(item.size || 0) }));
    if (key === 'resourceCatalog') state.resourceCatalog = data;
    if (key === 'assignments') state.assignments = asArray(data, 'assignments').map(item => ({ course: item.course ?? item['课程'], title: item.title ?? item['作业'], deadline: item.deadline ?? item['截止'], status: item.status ?? item['状态'] }));
    if (key === 'questions') state.questions = asArray(data, 'questions');
    if (key === 'events') state.events = asArray(data, 'events').map(item => ({ ...item, title: item.title ?? item['活动'], time: item.time ?? item['时间'], location: item.location ?? item['地点'], organizer: item.organizer ?? item['组织'] }));
    if (key === 'opportunities') { state.opportunities = asArray(data, 'opportunities'); state.opportunitySkills = asArray(data, 'skills'); }
    if (key === 'treeholes') state.treeholes = asArray(data, 'hot_posts');
    if (key === 'directory') state.directoryPeople = asArray(data).map(person => ({ id: person.id, name: person['姓名'], role: person['角色'], department: person['学院'], email: person['邮箱'], year: person['年级'], tags: person.tags || [] }));
    if (key === 'groups') state.groups = asArray(data, 'groups');
    if (key === 'conversations') state.conversations = asArray(data, 'conversations');
    if (key === 'profile') state.profile = { ...state.profile, ...data };
    if (key === 'preferences') state.preferences = { ...state.preferences, ...data };
    if (key === 'participation') state.participation = data;
    if (key === 'authSession') state.authSession = data;
    if (key === 'authConfig') state.authConfig = data;
    if (key === 'tags') state.tags = asArray(data, 'tags');
  });
  state.posts = rankPosts(state.posts);
  state.loading = false;
  applyTheme(state.preferences.theme);
  render();
  renderRails();
  renderIdentityChrome();
  syncLoginGate();
  maybeShowProfileOnboarding();
}

function routeTo(route) {
  state.route = route;
  if (route !== 'detail') state.selectedPost = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function runSearch() {
  if (!state.search.keyword.trim()) return;
  state.search.loading = true;
  state.search.error = '';
  state.search.result = null;
  state.search.aiReply = '';
  render();
  try {
    state.search.result = await api(`/api/search?keyword=${encodeURIComponent(state.search.keyword)}&content_type=${encodeURIComponent(state.search.type)}&section=${encodeURIComponent(state.search.section)}`);
    if (state.search.mode === 'ai') {
      const summary = [state.search.result.posts, state.search.result.resources, state.search.result.questions, state.search.result.events].flat().slice(0, 8).map(item => Object.values(item).slice(0, 4).join(' · ')).join('\n');
      const answer = await api('/api/chat', { method: 'POST', body: JSON.stringify({ session_id: `search_${Date.now()}`, message: `基于这些搜索结果回答：${state.search.keyword}`, context: { type: 'search', label: state.search.keyword, text: summary } }) });
      state.search.aiReply = answer.reply || '暂时没有足够依据回答。';
    }
  } catch (error) {
    state.search.error = error.message;
  } finally {
    state.search.loading = false;
    render();
  }
}

async function openTag(tag) {
  state.route = 'tag';
  state.search.keyword = tag;
  state.search.loading = true;
  state.search.error = '';
  state.tagResult = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  try {
    state.tagResult = await api(`/api/discover/tags/${encodeURIComponent(tag)}`);
  } catch (error) {
    state.search.error = error.message;
  } finally {
    state.search.loading = false;
    render();
  }
}

function normalizeTag(raw) {
  return raw.trim().replace(/^#+/, '').replace(/\s+/g, ' ').slice(0, 24);
}

function addComposerTag(raw) {
  const tag = normalizeTag(raw);
  if (!tag) return;
  if (state.composerTags.some(item => item.toLowerCase() === tag.toLowerCase())) return;
  if (state.composerTags.length >= 5) { showToast('每篇帖子最多添加 5 个 Tag', 'error'); return; }
  state.composerTags.push(tag);
  render();
  requestAnimationFrame(() => $('tag-input')?.focus());
}

function readFile(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = event => { if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 45)); };
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function getVideoMetadata(url) {
  return new Promise(resolve => {
    const video = document.createElement('video');
    let settled = false;
    const finish = value => { if (!settled) { settled = true; window.clearTimeout(timeout); resolve(value); } };
    const timeout = window.setTimeout(() => finish({ duration: Number.isFinite(video.duration) ? video.duration : null, posterData: null }), 4000);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) ? video.duration : null;
      video.currentTime = Math.min(.15, Math.max(0, (duration || 0) / 2));
      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          const width = Math.min(video.videoWidth || 1280, 1280);
          canvas.width = width;
          canvas.height = Math.max(1, Math.round(width * (video.videoHeight || 720) / (video.videoWidth || 1280)));
          canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
          finish({ duration, posterData: canvas.toDataURL('image/jpeg', .82) });
        } catch (error) { finish({ duration, posterData: null }); }
      };
    };
    video.onerror = () => finish({ duration: null, posterData: null });
    video.src = url;
  });
}

async function queueFiles(files, type) {
  if (!files.length) return;
  state.composerExpanded = true;
  const accepted = type === 'video' ? Array.from(files).slice(0, 1) : Array.from(files).slice(0, Math.max(0, 6 - state.uploads.length));
  for (const file of accepted) {
    const limit = type === 'video' ? 40 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > limit) { showToast(`${file.name} 超过本地上传限制`, 'error'); continue; }
    const upload = { id: `local_${Date.now()}_${Math.random().toString(16).slice(2)}`, file, type, preview: URL.createObjectURL(file), status: 'reading', progress: 1, error: '', serverData: null, duration: null, posterData: null };
    state.uploads.push(upload);
    render();
    if (type === 'video') {
      const metadata = await getVideoMetadata(upload.preview);
      upload.duration = metadata.duration;
      upload.posterData = metadata.posterData;
    }
    await uploadOne(upload);
  }
}

async function uploadOne(upload) {
  upload.status = 'reading'; upload.progress = 1; upload.error = ''; render();
  try {
    const data = await readFile(upload.file, progress => { upload.progress = progress; render(); });
    upload.status = 'uploading'; upload.progress = 55; render();
    upload.serverData = await api('/api/media', { method: 'POST', body: JSON.stringify({ name: upload.file.name, mime: upload.file.type, data, duration: upload.duration }) });
    if (upload.type === 'video' && upload.posterData) {
      const poster = await api('/api/media', { method: 'POST', body: JSON.stringify({ name: `${upload.file.name}-cover.jpg`, mime: 'image/jpeg', data: upload.posterData }) });
      upload.serverData.poster = poster.url;
    }
    upload.status = 'done'; upload.progress = 100;
  } catch (error) {
    upload.status = 'error'; upload.error = error.message;
  }
  render();
}

async function publishPost() {
  const content = state.composerText.trim();
  if (!content || state.publishing) return;
  if (state.uploads.some(item => item.status !== 'done')) { showToast('请等待媒体上传完成或移除失败附件', 'error'); return; }
  state.publishing = true; render();
  try {
    const result = await api('/api/community/posts', { method: 'POST', body: JSON.stringify({
      content,
      section: state.composerSection,
      anonymous: state.composerAnonymous,
      tags: state.composerTags,
      media: state.uploads.map(item => item.serverData),
    }) });
    state.uploads.forEach(item => URL.revokeObjectURL(item.preview));
    state.pendingPostId = result.post_id;
    if (hasAIMention(content)) {
      try {
        const ai = await api('/api/chat', { method: 'POST', body: JSON.stringify({ session_id: `draft_${result.post_id}`, message: content.replace(/(^|[^\w@])@ai\b/i, '$1').trim() || '请概括这条校园话题。', context: { type: 'post-draft', label: '新提交的校园话题', text: content } }) });
        state.pendingAIReply = ai.reply || '暂时没有足够依据回答。';
      } catch (error) {
        state.pendingAIReply = 'AI 暂时不可用，审核通过后可在帖子详情重试。';
      }
    } else {
      state.pendingAIReply = '';
    }
    state.composerText = '';
    state.composerTags = [];
    state.composerAnonymous = false;
    state.uploads = [];
    state.composerExpanded = false;
    showToast('已提交审核；通过后会出现在校园话题流');
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.publishing = false; render();
  }
}

async function openPost(id, focusComments = false) {
  state.route = 'detail'; state.selectedPost = null; state.activeComment = focusComments ? id : ''; render();
  try {
    state.selectedPost = normalizePost(await api(`/api/community/posts/${encodeURIComponent(id)}`));
  } catch (error) {
    showToast(error.message, 'error'); state.route = 'feed';
  }
  render(); window.scrollTo({ top: 0, behavior: 'smooth' });
  if (focusComments) requestAnimationFrame(() => document.querySelector(`[data-comment-form="${id}"] input`)?.focus());
}

async function likePost(id) {
  try {
    const result = await api(`/api/community/like?post_id=${encodeURIComponent(id)}`, { method: 'POST' });
    const update = post => post.id === id ? { ...post, likes: result.likes, liked: Boolean(result.liked) } : post;
    state.posts = state.posts.map(update);
    if (state.selectedPost?.id === id) state.selectedPost = update(state.selectedPost);
    showToast(result.liked ? '已点赞' : '已取消点赞');
    render();
  } catch (error) { showToast(error.message, 'error'); }
}

async function submitComment(form) {
  const id = form.dataset.commentForm;
  const content = new FormData(form).get('comment').trim();
  if (!content) return;
  try {
    const result = await api(`/api/community/comments?post_id=${encodeURIComponent(id)}&content=${encodeURIComponent(content)}&anonymous=false`, { method: 'POST' });
    if (hasAIMention(content) && result.comment_id) {
      try {
        state.commentAIReplies[result.comment_id] = await api('/api/community/ai', { method: 'POST', body: JSON.stringify({ post_id: id, comment_id: result.comment_id, message: content.replace(/(^|[^\w@])@ai\b/i, '$1').trim() || '请基于这条评论给出建议。' }) });
        showToast('评论已发布，AI 回答已附在下方');
      } catch (error) {
        showToast(`评论已发布，AI 暂时不可用：${error.message}`, 'error');
      }
    } else {
      showToast('评论已发布');
    }
    state.activeComment = '';
    if (state.route === 'detail') await openPost(id); else await loadFeed(true);
  } catch (error) { showToast(error.message, 'error'); }
}

async function refreshTreeholes() {
  const data = await api('/api/treehole/hot');
  state.treeholes = asArray(data, 'hot_posts');
}

async function submitTreehole(form) {
  const values = new FormData(form);
  const content = String(values.get('content') || '').trim();
  if (!content) return;
  try {
    await api(`/api/treehole/posts?content=${encodeURIComponent(content)}`, { method: 'POST' });
    state.treeholeText = '';
    await refreshTreeholes();
    showToast('匿名内容已进入树洞，不会出现在实名公共流');
    render();
  } catch (error) { showToast(error.message, 'error'); }
}

async function submitTreeholeComment(form) {
  const postId = form.dataset.treeholeCommentForm;
  const content = new FormData(form).get('content').trim();
  if (!content) return;
  try {
    await api(`/api/treehole/comments?post_id=${encodeURIComponent(postId)}&content=${encodeURIComponent(content)}`, { method: 'POST' });
    state.activeTreeholeComment = '';
    await refreshTreeholes();
    showToast('匿名评论已发布');
    render();
  } catch (error) { showToast(error.message, 'error'); }
}

async function submitAI(form) {
  const id = form.dataset.aiForm;
  const question = new FormData(form).get('question').trim();
  const post = state.posts.find(item => item.id === id) || state.selectedPost;
  if (!question || !post) return;
  try {
    state.aiReplies[id] = '正在整理当前话题…'; render();
    const result = await api('/api/chat', { method: 'POST', body: JSON.stringify({ session_id: `web_${Date.now()}`, message: question, context: { type: 'post', label: post.title || '校园话题', text: post.content } }) });
    state.aiReplies[id] = result.reply || '暂时没有足够依据回答。'; render();
  } catch (error) { state.aiReplies[id] = 'AI 暂时不可用，请稍后重试。'; render(); }
}

function openMedia(url, type) {
  $('media-dialog-content').innerHTML = type === 'video' ? `<video src="${escapeHTML(url)}" controls autoplay playsinline></video>` : `<img src="${escapeHTML(url)}" alt="帖子图片详情">`;
  $('media-dialog').showModal(); refreshIcons();
}

function bindEvents() {
  document.addEventListener('click', event => {
    const route = event.target.closest('[data-route]');
    if (route) { routeTo(route.dataset.route); return; }
    if (event.target.closest('#xjtlu-bind')) { api('/api/auth/xjtlu/start').then(result => { window.location.assign(result.authorization_url); }).catch(error => showToast(error.message, 'error')); return; }
    if (event.target.closest('#send-campus-email-code')) {
      const email = $('campus-email')?.value.trim().toLowerCase();
      if (!/^\S+@(?:student\.)?xjtlu\.edu\.cn$/i.test(email)) {
        setLoginMessage($('campus-email-message'), '请输入以 @student.xjtlu.edu.cn 或 @xjtlu.edu.cn 结尾的学校邮箱。');
        $('campus-email')?.focus();
        return;
      }
      const button = $('send-campus-email-code');
      api('/api/auth/campus-email/code', { method: 'POST', body: JSON.stringify({ email }) })
        .then(response => { startCodeCountdown(button, response.cooldown || 30); showCodeSentMessage($('campus-email-message'), response, '学校邮箱验证码'); })
        .catch(error => setLoginMessage($('campus-email-message'), error.message));
      return;
    }
    if (event.target.closest('#mock-xjtlu-bind')) { api('/api/auth/xjtlu/mock-bind', { method: 'POST', body: JSON.stringify({ account: 'student001@student.xjtlu.edu.cn' }) }).then(result => { state.authSession = result; state.profile = result.profile || state.profile; showToast('本地校内身份已绑定'); render(); renderIdentityChrome(); }).catch(error => showToast(error.message, 'error')); return; }
    if (event.target.closest('#remove-campus-binding')) { api('/api/auth/xjtlu/binding', { method: 'DELETE' }).then(result => { state.authSession = result; showToast('已切换为手机访客，仅可浏览'); render(); renderIdentityChrome(); }).catch(error => showToast(error.message, 'error')); return; }
    if (event.target.closest('#logout-session')) {
      api('/api/auth/session', { method: 'DELETE' }).then(result => {
        state.authSession = result;
        localStorage.removeItem(LOGIN_STORAGE_KEY);
        localStorage.removeItem(LOGIN_ACCOUNT_KEY);
        sessionStorage.removeItem(LOGIN_STORAGE_KEY);
        state.route = 'feed';
        $('email-login-form')?.reset();
        $('login-phone-form')?.reset();
        switchLoginMode('email', false);
        showLoginGate();
        requestAnimationFrame(() => $('login-email')?.focus());
      }).catch(error => showToast(error.message, 'error'));
      return;
    }
    if (event.target.closest('#sidebar-compose, #mobile-compose')) {
      routeTo('feed'); state.composerExpanded = true; render(); requestAnimationFrame(() => $('composer-text')?.focus()); return;
    }
    const section = event.target.closest('[data-section]');
    if (section) { state.section = section.dataset.section; loadFeed(true); return; }
    const addTag = event.target.closest('[data-add-tag]');
    if (addTag) { addComposerTag(addTag.dataset.addTag); return; }
    const removeTag = event.target.closest('[data-remove-tag]');
    if (removeTag) { state.composerTags = state.composerTags.filter(tag => tag !== removeTag.dataset.removeTag); render(); return; }
    const aiInsert = event.target.closest('[data-ai-insert]');
    if (aiInsert) { insertAIMention(aiInsert.dataset.aiInsert); return; }
    const tag = event.target.closest('[data-tag]');
    if (tag) { openTag(tag.dataset.tag); return; }
    const resourceOpen = event.target.closest('[data-resource-open]');
    if (resourceOpen) {
      const item = state.resources.find(value => value.id === resourceOpen.dataset.resourceOpen);
      if (item) {
        state.selectedResource = item; state.route = 'resource-detail';
        const recent = JSON.parse(localStorage.getItem('surf-recent-resources') || '[]').filter(value => value !== item.id);
        localStorage.setItem('surf-recent-resources', JSON.stringify([item.id, ...recent].slice(0, 12)));
        render(); window.scrollTo({ top: 0, behavior: 'smooth' });
      }
      return;
    }
    const resourceMode = event.target.closest('[data-resource-mode]');
    if (resourceMode) { state.resourceFilters.mode = resourceMode.dataset.resourceMode; render(); return; }
    const searchMode = event.target.closest('[data-search-mode]');
    if (searchMode) { state.search.mode = searchMode.dataset.searchMode; state.search.aiReply = ''; render(); return; }
    const saveResource = event.target.closest('[data-save-resource]');
    if (saveResource) {
      const id = saveResource.dataset.saveResource; const saved = JSON.parse(localStorage.getItem('surf-saved-resources') || '[]');
      const next = saved.includes(id) ? saved.filter(value => value !== id) : [...saved, id];
      localStorage.setItem('surf-saved-resources', JSON.stringify(next)); showToast(next.includes(id) ? '已收藏资料' : '已取消收藏'); render(); return;
    }
    const aiResource = event.target.closest('[data-ai-resource]');
    if (aiResource) { $('resource-ai').innerHTML = `<form class="search-panel" data-resource-ai-form="${escapeHTML(aiResource.dataset.aiResource)}"><div class="search-form-large"><input class="field" name="question" placeholder="问问这份资料…" required><button class="button button-small" type="submit">发送</button></div></form>`; refreshIcons(); requestAnimationFrame(() => document.querySelector('[data-resource-ai-form] input')?.focus()); return; }
    const accept = event.target.closest('[data-accept-answer]');
    if (accept) {
      api(`/api/courses/qa/${encodeURIComponent(accept.dataset.questionId)}/accept?answer_id=${encodeURIComponent(accept.dataset.acceptAnswer)}`, { method: 'POST' }).then(result => { const index = state.questions.findIndex(item => item.id === accept.dataset.questionId); if (index >= 0) state.questions[index] = result.question; showToast('已采纳回答'); render(); }).catch(error => showToast(error.message, 'error')); return;
    }
    const removeUpload = event.target.closest('[data-remove-upload]');
    if (removeUpload) { const upload = state.uploads.find(item => item.id === removeUpload.dataset.removeUpload); if (upload) URL.revokeObjectURL(upload.preview); state.uploads = state.uploads.filter(item => item.id !== removeUpload.dataset.removeUpload); render(); return; }
    const retryUpload = event.target.closest('[data-retry-upload]');
    if (retryUpload) { const upload = state.uploads.find(item => item.id === retryUpload.dataset.retryUpload); if (upload) uploadOne(upload); return; }
    const moveUpload = event.target.closest('[data-move-upload]');
    if (moveUpload) { const index = state.uploads.findIndex(item => item.id === moveUpload.dataset.uploadId); const target = moveUpload.dataset.moveUpload === 'left' ? index - 1 : index + 1; if (index >= 0 && target >= 0 && target < state.uploads.length) [state.uploads[index], state.uploads[target]] = [state.uploads[target], state.uploads[index]]; render(); return; }
    if (event.target.closest('#publish-button')) { publishPost(); return; }
    if (event.target.closest('#load-more')) { state.page += 1; loadFeed(false); return; }
    if (event.target.closest('[data-retry-feed]')) { loadFeed(true); return; }
    const open = event.target.closest('[data-open-post]');
    if (open) { openPost(open.dataset.openPost); return; }
    const like = event.target.closest('[data-like-post]');
    if (like) { likePost(like.dataset.likePost); return; }
    const collect = event.target.closest('[data-collect-post]');
    if (collect) { state.activeCollectionPost = state.activeCollectionPost === collect.dataset.collectPost ? '' : collect.dataset.collectPost; render(); if (state.activeCollectionPost) requestAnimationFrame(() => document.querySelector(`[data-collection-form="${collect.dataset.collectPost}"] input`)?.focus()); return; }
    const closeCollection = event.target.closest('[data-close-collection]');
    if (closeCollection) { state.activeCollectionPost = ''; render(); return; }
    const removeCollection = event.target.closest('[data-remove-collection]');
    if (removeCollection) { const id = removeCollection.dataset.removeCollection; api(`/api/community/collect?post_id=${encodeURIComponent(id)}`, { method: 'POST' }).then(result => { const update = post => post.id === id ? { ...post, collected: false, collection_tags: [] } : post; state.posts = state.posts.map(update); if (state.selectedPost?.id === id) state.selectedPost = update(state.selectedPost); state.activeCollectionPost = ''; showToast(result.message || '已取消收藏'); render(); }).catch(error => showToast(error.message, 'error')); return; }
    const comment = event.target.closest('[data-comment-post]');
    if (comment) { state.activeAI = ''; openPost(comment.dataset.commentPost, true); return; }
    const ai = event.target.closest('[data-ai-post]');
    if (ai) { state.activeAI = state.activeAI === ai.dataset.aiPost ? '' : ai.dataset.aiPost; state.activeComment = ''; render(); requestAnimationFrame(() => document.querySelector(`[data-ai-form="${ai.dataset.aiPost}"] input`)?.focus()); return; }
    const report = event.target.closest('[data-report-post]');
    if (report) { $('report-post-id').value = report.dataset.reportPost; $('report-dialog').showModal(); refreshIcons(); return; }
    const media = event.target.closest('[data-view-media]');
    if (media) { openMedia(media.dataset.viewMedia, media.dataset.mediaType); return; }
    if (event.target.closest('[data-close-media]')) { $('media-dialog').close(); return; }
    const notificationAction = event.target.closest('[data-notification-action]');
    if (notificationAction) {
      const id = notificationAction.dataset.notificationId;
      api(`/api/notifications/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action: notificationAction.dataset.notificationAction }) }).then(result => {
        const index = state.notifications.findIndex(value => value.id === id);
        if (index >= 0) state.notifications[index] = { ...state.notifications[index], ...result.notification };
        showToast(notificationAction.dataset.notificationAction === 'processed' ? '已标记为处理完成' : result.notification.saved_for_later ? '已加入稍后处理' : '已取消稍后处理');
        render(); renderRails();
      }).catch(error => showToast(error.message, 'error'));
      return;
    }
    const eventButton = event.target.closest('[data-event]');
    if (eventButton) { api(`/api/events/register?event_id=${encodeURIComponent(eventButton.dataset.event)}`, { method: 'POST' }).then(async () => { showToast('报名成功，提醒已加入通知中心'); const data = await api('/api/events'); state.events = asArray(data, 'events').map(item => ({ ...item, title: item.title ?? item['活动'], time: item.time ?? item['时间'], location: item.location ?? item['地点'], organizer: item.organizer ?? item['组织'] })); render(); }).catch(error => showToast(error.message, 'error')); return; }
    const cancelEvent = event.target.closest('[data-event-cancel]');
    if (cancelEvent) { api(`/api/events/register?event_id=${encodeURIComponent(cancelEvent.dataset.eventCancel)}`, { method: 'DELETE' }).then(async () => { showToast('已取消报名'); const data = await api('/api/events'); state.events = asArray(data, 'events').map(item => ({ ...item, title: item.title ?? item['活动'], time: item.time ?? item['时间'], location: item.location ?? item['地点'], organizer: item.organizer ?? item['组织'] })); render(); }).catch(error => showToast(error.message, 'error')); return; }
    const reminder = event.target.closest('[data-event-reminder]');
    if (reminder) { const enabled = reminder.dataset.reminderEnabled !== 'true'; api(`/api/events/reminder?event_id=${encodeURIComponent(reminder.dataset.eventReminder)}&enabled=${enabled}`, { method: 'PATCH' }).then(async result => { showToast(result.message || '提醒状态已更新'); const data = await api('/api/events'); state.events = asArray(data, 'events').map(item => ({ ...item, title: item.title ?? item['活动'], time: item.time ?? item['时间'], location: item.location ?? item['地点'], organizer: item.organizer ?? item['组织'] })); render(); }).catch(error => showToast(error.message, 'error')); return; }
    const treeholeComment = event.target.closest('[data-treehole-comment]');
    if (treeholeComment) { state.activeTreeholeComment = state.activeTreeholeComment === treeholeComment.dataset.treeholeComment ? '' : treeholeComment.dataset.treeholeComment; render(); requestAnimationFrame(() => document.querySelector(`[data-treehole-comment-form="${treeholeComment.dataset.treeholeComment}"] input`)?.focus()); return; }
    const treeholeReport = event.target.closest('[data-treehole-report]');
    if (treeholeReport) { api(`/api/treehole/report?post_id=${encodeURIComponent(treeholeReport.dataset.treeholeReport)}&reason=${encodeURIComponent('匿名树洞举报：疑似不当内容')}`, { method: 'POST' }).then(async () => { await refreshTreeholes(); showToast('举报已进入管理端审核'); render(); }).catch(error => showToast(error.message, 'error')); return; }
    const startChat = event.target.closest('[data-start-chat]');
    if (startChat) {
      state.activeDirectoryChat = state.activeDirectoryChat === startChat.dataset.startChat ? '' : startChat.dataset.startChat;
      state.activeOpportunityApply = '';
      render();
      if (state.activeDirectoryChat) requestAnimationFrame(() => document.querySelector(`[data-directory-chat-form="${startChat.dataset.startChat}"] textarea`)?.focus());
      return;
    }
    const cancelChat = event.target.closest('[data-cancel-chat]');
    if (cancelChat) {
      const personId = cancelChat.dataset.cancelChat;
      state.activeDirectoryChat = '';
      render();
      requestAnimationFrame(() => document.querySelector(`[data-start-chat="${personId}"]`)?.focus());
      return;
    }
    const opportunityButton = event.target.closest('[data-apply-opportunity]');
    if (opportunityButton) {
      state.activeOpportunityApply = state.activeOpportunityApply === opportunityButton.dataset.applyOpportunity ? '' : opportunityButton.dataset.applyOpportunity;
      state.activeDirectoryChat = '';
      render();
      if (state.activeOpportunityApply) requestAnimationFrame(() => document.querySelector(`[data-opportunity-apply-form="${opportunityButton.dataset.applyOpportunity}"] textarea`)?.focus());
      return;
    }
    const cancelOpportunity = event.target.closest('[data-cancel-opportunity]');
    if (cancelOpportunity) {
      const opportunityId = cancelOpportunity.dataset.cancelOpportunity;
      state.activeOpportunityApply = '';
      render();
      requestAnimationFrame(() => document.querySelector(`[data-apply-opportunity="${opportunityId}"]`)?.focus());
      return;
    }
  });

  document.addEventListener('focusin', event => {
    if (event.target.id === 'composer-text' && !state.composerExpanded) {
      state.composerExpanded = true; render(); requestAnimationFrame(() => { const text = $('composer-text'); text?.focus(); text?.setSelectionRange(text.value.length, text.value.length); });
    }
  });

  document.addEventListener('input', event => {
    if (event.target.id === 'composer-text') { state.composerText = event.target.value; const button = $('publish-button'); if (button) button.disabled = !state.composerText.trim() || state.uploads.some(item => item.status !== 'done'); }
    if (event.target.id === 'treehole-text') { state.treeholeText = event.target.value; const button = event.target.form?.querySelector('button[type="submit"]'); if (button) button.disabled = !state.treeholeText.trim(); }
  });

  document.addEventListener('change', event => {
    if (event.target.id === 'composer-section') state.composerSection = event.target.value;
    if (event.target.id === 'composer-anonymous') state.composerAnonymous = event.target.checked;
    if (event.target.id === 'image-input') queueFiles(event.target.files, 'image');
    if (event.target.id === 'video-input') queueFiles(event.target.files, 'video');
    if (event.target.id === 'search-type') { state.search.type = event.target.value; if (state.search.keyword) runSearch(); }
    if (event.target.id === 'search-section') { state.search.section = event.target.value; if (state.search.keyword) runSearch(); }
    const searchMode = event.target.closest('[data-search-mode]');
    if (searchMode) { state.search.mode = searchMode.dataset.searchMode; render(); }
    if (event.target.id === 'resource-course') { state.resourceFilters.course = event.target.value; render(); }
    if (event.target.id === 'resource-type') { state.resourceFilters.type = event.target.value; render(); }
    if (event.target.id === 'resource-year') { state.resourceFilters.year = event.target.value; state.resourceFilters.term = 'all'; state.resourceFilters.major = 'all'; state.resourceFilters.course = 'all'; render(); }
    if (event.target.id === 'resource-term') { state.resourceFilters.term = event.target.value; state.resourceFilters.major = 'all'; state.resourceFilters.course = 'all'; render(); }
    if (event.target.id === 'resource-major') { state.resourceFilters.major = event.target.value; state.resourceFilters.course = 'all'; render(); }
  });

  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('global-search')?.focus(); }
    if (event.target.id === 'tag-input' && (event.key === 'Enter' || event.key === ',')) { event.preventDefault(); addComposerTag(event.target.value); }
    if (event.key === 'Enter' && event.target.matches('[data-open-post][role="button"]')) openPost(event.target.dataset.openPost);
  });

  document.addEventListener('submit', event => {
    if (event.target.matches('[data-identity-phone-login]')) { event.preventDefault(); const form = new FormData(event.target); api('/api/auth/phone', { method: 'POST', body: JSON.stringify({ phone: form.get('phone'), code: form.get('code') }) }).then(result => { state.authSession = result; state.profile = result.profile || state.profile; rememberLogin(true); rememberAccount(result, true); showToast('手机登录成功，绑定学校邮箱后可发布'); render(); renderIdentityChrome(); maybeShowProfileOnboarding(); }).catch(error => showToast(error.message, 'error')); }
    if (event.target.id === 'profile-onboarding-form' || event.target.id === 'profile-form') {
      event.preventDefault();
      const form = new FormData(event.target);
      const payload = { username: String(form.get('username') || '').trim(), bio: String(form.get('bio') || '').trim(), birthday: String(form.get('birthday') || ''), avatar: String(form.get('avatar') || 'sun') };
      api('/api/profile', { method: 'PATCH', body: JSON.stringify(payload) }).then(profile => {
        state.profile = profile;
        state.authSession = { ...state.authSession, name: profile.username, needs_onboarding: false, profile_complete: true, profile };
        if (event.target.id === 'profile-onboarding-form') {
          $('profile-onboarding-dialog')?.close();
          event.target.dataset.hydrated = '';
          showToast('资料已保存，欢迎进入校园');
        } else {
          showToast('个人资料已保存');
        }
        render(); renderRails(); renderIdentityChrome();
      }).catch(error => setLoginMessage($(event.target.id === 'profile-onboarding-form' ? 'profile-onboarding-message' : 'profile-message'), error.message));
    }
    if (event.target.id === 'campus-email-bind-form') {
      event.preventDefault();
      const form = new FormData(event.target);
      const email = String(form.get('email') || '').trim().toLowerCase();
      const code = String(form.get('code') || '').trim();
      api('/api/auth/campus-email', { method: 'POST', body: JSON.stringify({ email, code }) }).then(result => {
        state.authSession = result;
        state.profile = result.profile || state.profile;
        showToast('学校邮箱已验证，现在可以发帖、评论和点赞');
        render(); renderRails(); renderIdentityChrome();
      }).catch(error => setLoginMessage($('campus-email-message'), error.message));
    }
    if (event.target.id === 'global-search-form') { event.preventDefault(); state.search.keyword = $('global-search').value.trim(); if (!state.search.keyword) return; state.route = 'search'; runSearch(); }
    if (event.target.id === 'directory-form') { event.preventDefault(); state.directoryKeyword = $('directory-keyword').value.trim(); api(`/api/directory?keyword=${encodeURIComponent(state.directoryKeyword)}`).then(data => { state.directoryPeople = asArray(data).map(person => ({ id: person.id, name: person['姓名'], role: person['角色'], department: person['学院'], email: person['邮箱'], year: person['年级'], tags: person.tags || [] })); render(); }).catch(error => showToast(error.message, 'error')); }
    if (event.target.id === 'preferences-form') { event.preventDefault(); const form = new FormData(event.target); const sections = form.getAll('sections'); const interests = String(form.get('interests') || '').split(',').map(value => value.trim()).filter(Boolean); const theme = String(form.get('theme') || 'system'); api('/api/profile/preferences', { method: 'PATCH', body: JSON.stringify({ sections, interests, show_context_rail: form.get('show_context_rail') === 'on', content_language: form.get('content_language'), theme }) }).then(result => { state.preferences = result; applyTheme(result.theme); state.posts = rankPosts(state.posts); showToast('首页偏好已保存'); routeTo('feed'); renderRails(); }).catch(error => showToast(error.message, 'error')); }
    if (event.target.matches('[data-group-message-form]')) { event.preventDefault(); const form = new FormData(event.target); const groupId = event.target.dataset.groupMessageForm; api(`/api/groups/${encodeURIComponent(groupId)}/messages?content=${encodeURIComponent(form.get('content'))}`, { method: 'POST' }).then(async () => { const data = await api('/api/groups'); state.groups = asArray(data, 'groups'); showToast('项目群消息已发送'); render(); }).catch(error => showToast(error.message, 'error')); }
    if (event.target.matches('[data-collection-form]')) {
      event.preventDefault(); const id = event.target.dataset.collectionForm; const tag = normalizeTag(new FormData(event.target).get('tag'));
      if (!tag) { showToast('请输入一个自己的 Tag', 'error'); return; }
      api(`/api/community/collect?post_id=${encodeURIComponent(id)}&tag=${encodeURIComponent(tag)}`, { method: 'POST' }).then(result => { const update = post => post.id === id ? { ...post, collected: true, collection_tags: result.tags || [tag] } : post; state.posts = state.posts.map(update); if (state.selectedPost?.id === id) state.selectedPost = update(state.selectedPost); showToast(result.message || `已收藏到 #${tag}`); render(); requestAnimationFrame(() => document.querySelector(`[data-collection-form="${id}"] input`)?.focus()); }).catch(error => showToast(error.message, 'error'));
    }
    if (event.target.matches('[data-directory-chat-form]')) {
      event.preventDefault();
      const formElement = event.target;
      const message = String(new FormData(formElement).get('message') || '').trim();
      if (!message) return;
      const submitButton = formElement.querySelector('button[type="submit"]');
      submitButton.disabled = true; submitButton.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>发送中';
      api(`/api/messaging/chat?target_id=${encodeURIComponent(formElement.dataset.directoryChatForm)}&message=${encodeURIComponent(message)}`, { method: 'POST' }).then(async result => {
        const data = await api('/api/messaging/conversations');
        state.conversations = asArray(data, 'conversations'); state.activeDirectoryChat = '';
        showToast(result.message || '私聊已发起'); render();
      }).catch(error => { submitButton.disabled = false; submitButton.innerHTML = '<i data-lucide="send"></i>重试发送'; refreshIcons(); showToast(error.message, 'error'); });
    }
    if (event.target.matches('[data-opportunity-apply-form]')) {
      event.preventDefault();
      const formElement = event.target;
      const submitButton = formElement.querySelector('button[type="submit"]');
      submitButton.disabled = true; submitButton.innerHTML = '<span class="button-spinner" aria-hidden="true"></span>提交中';
      api('/api/opportunities/apply', { method: 'POST', body: JSON.stringify({ opportunity_id: formElement.dataset.opportunityApplyForm, message: String(new FormData(formElement).get('message') || '').trim(), skills: state.opportunitySkills }) })
        .then(async result => { const data = await api('/api/opportunities'); state.opportunities = asArray(data, 'opportunities'); state.activeOpportunityApply = ''; showToast(result.message || '申请已提交，等待招募发起人处理'); render(); })
        .catch(error => { submitButton.disabled = false; submitButton.innerHTML = '<i data-lucide="send"></i>重试申请'; refreshIcons(); showToast(error.message, 'error'); });
    }
    if (event.target.id === 'opportunity-create-form') {
      event.preventDefault();
      const form = event.target;
      const values = new FormData(form);
      const split = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
      const submitButton = form.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      api('/api/opportunities', { method: 'POST', body: JSON.stringify({
        title: String(values.get('title') || '').trim(),
        kind: values.get('kind'),
        description: String(values.get('description') || '').trim(),
        skills: split(values.get('skills')),
        deadline: String(values.get('deadline') || '').trim(),
        capacity: Number(values.get('capacity') || 1),
      }) }).then(async result => {
        const data = await api('/api/opportunities');
        state.opportunities = asArray(data, 'opportunities');
        state.opportunitySkills = asArray(data, 'skills');
        showToast(result.message || '组队招募已发布');
        render();
      }).catch(error => { submitButton.disabled = false; showToast(error.message, 'error'); });
    }
    if (event.target.id === 'search-page-form') { event.preventDefault(); state.search.keyword = $('search-keyword').value.trim(); runSearch(); }
    if (event.target.id === 'resource-filter-form') { event.preventDefault(); state.resourceFilters.keyword = $('resource-keyword').value.trim(); render(); }
    if (event.target.matches('[data-comment-form]')) { event.preventDefault(); submitComment(event.target); }
    if (event.target.id === 'treehole-form') { event.preventDefault(); submitTreehole(event.target); }
    if (event.target.matches('[data-treehole-comment-form]')) { event.preventDefault(); submitTreeholeComment(event.target); }
    if (event.target.matches('[data-ai-form]')) { event.preventDefault(); submitAI(event.target); }
    if (event.target.matches('[data-resource-ai-form]')) {
      event.preventDefault(); const form = new FormData(event.target); const item = state.resources.find(value => value.id === event.target.dataset.resourceAiForm); if (!item) return;
      api('/api/chat', { method: 'POST', body: JSON.stringify({ session_id: `resource_${Date.now()}`, message: form.get('question'), context: { type: 'resource', label: item.name, text: `${item.course} ${item.type} ${item.description}` } }) }).then(result => { $('resource-ai').innerHTML = `<div class="ai-answer"><strong>AI 回答</strong><p>${escapeHTML(result.reply || '暂时没有足够依据回答。')}</p><small>参考当前资料元数据；重要学术问题请以教师或官方资料为准。</small></div>`; }).catch(() => { $('resource-ai').innerHTML = '<div class="ai-answer"><strong>AI 暂时不可用</strong><p>请稍后重试，或直接向课程团队提问。</p></div>'; });
    }
    if (event.target.id === 'question-form') {
      event.preventDefault(); const form = new FormData(event.target);
      api(`/api/courses/qa?course=${encodeURIComponent(form.get('course'))}&question=${encodeURIComponent(form.get('question'))}&anonymous=${form.get('anonymous') === 'on'}`, { method: 'POST' }).then(async () => {
        showToast('问题已提交到课程问答');
        const data = await api('/api/courses/qa'); state.questions = asArray(data, 'questions'); render();
      }).catch(error => showToast(error.message, 'error'));
    }
  });

  $('report-form').addEventListener('submit', async event => {
    event.preventDefault();
    const postId = $('report-post-id').value;
    const reason = $('report-reason').value;
    if (!reason) return;
    try {
      await api(`/api/community/report?post_id=${encodeURIComponent(postId)}&reason=${encodeURIComponent(reason)}`, { method: 'POST' });
      $('report-dialog').close(); $('report-form').reset(); showToast('举报已提交到管理端');
    } catch (error) { showToast(error.message, 'error'); }
  });

  document.addEventListener('error', event => {
    if (event.target.tagName === 'VIDEO') {
      const stateLayer = event.target.parentElement?.querySelector('.video-state');
      if (stateLayer) stateLayer.hidden = false;
    }
  }, true);
}

initLoginExperience();
initProfileOnboardingGuard();
bindEvents();
render();
loadInitialData();
