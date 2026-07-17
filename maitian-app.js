// ============ 麦田成长体系 (localStorage 版) ============
console.log('maitian-app.js loaded — localStorage mode');

// ============ localStorage keys ============
var MT_USERS_KEY = 'mt_users_v2';
var MT_SESSION_KEY = 'mt_session_v1';

// ============ 本地数据读写 ============
function mtLoadUsers() {
  try { return JSON.parse(localStorage.getItem(MT_USERS_KEY)) || []; }
  catch(e) { return []; }
}
function mtSaveUsers(users) {
  localStorage.setItem(MT_USERS_KEY, JSON.stringify(users));
  // 异步推送到 Supabase
  if (typeof mtPushProfile === 'function') {
    var u = _curUser;
    if (u) mtPushProfile(u).catch(function(){});
  }
}

// ============ 会话管理 ============
function _getSession() {
  try { return JSON.parse(localStorage.getItem(MT_SESSION_KEY)); }
  catch(e) { return null; }
}
function _setSession(nick) {
  if (nick) localStorage.setItem(MT_SESSION_KEY, JSON.stringify({nickname: nick}));
  else localStorage.removeItem(MT_SESSION_KEY);
}

var _curUser = null;

function getCurrentUser() {
  var sess = _getSession();
  if (!sess) { _curUser = null; return null; }
  var users = mtLoadUsers();
  _curUser = users.find(function(u) { return u.nickname === sess.nickname; }) || null;
  if (!_curUser) _setSession(null);
  return _curUser;
}

// ============ 密码哈希 ============
function _simpleHash(s) {
  var hash = 0, i, chr;
  if (s.length === 0) return '0';
  for (i = 0; i < s.length; i++) {
    chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return 'h_' + Math.abs(hash).toString(16);
}

// ============ 用户注册/登录 ============
function registerUser(nick, pwd, avatar, bio) {
  if (nick.length < 2) return {ok:false, msg:'昵称至少2个字'};
  if (pwd.length < 4) return {ok:false, msg:'密码至少4位'};
  var users = mtLoadUsers();
  if (users.find(function(u) { return u.nickname === nick; })) {
    return {ok:false, msg:'昵称已存在'};
  }
  var newUser = {
    nickname: nick,
    password: _simpleHash(pwd),
    avatar: avatar || '😊',
    bio: bio || '',
    points: 0,
    badges: [],
    taskJoined: [],
    taskDone: [],
    exchanges: [],
    history: []
  };
  users.push(newUser);
  mtSaveUsers(users);
  _curUser = newUser;
  _setSession(nick);
  return {ok:true, user: _copyUser(newUser)};
}

function loginUser(nick, pwd) {
  var users = mtLoadUsers();
  var u = users.find(function(u) { return u.nickname === nick; });
  if (!u) return {ok:false, msg:'用户不存在'};
  if (u.password !== _simpleHash(pwd)) return {ok:false, msg:'密码错误'};
  _curUser = u;
  _setSession(nick);
  return {ok:true, user: _copyUser(u)};
}

function logoutUser() { _curUser = null; _setSession(null); }

function _copyUser(u) {
  return JSON.parse(JSON.stringify(u));
}

// ============ 更新用户数据 ============
function saveUserData() {
  if (!_curUser) return;
  var users = mtLoadUsers();
  var idx = -1;
  for (var i = 0; i < users.length; i++) {
    if (users[i].nickname === _curUser.nickname) { idx = i; break; }
  }
  if (idx >= 0) users[idx] = _copyUser(_curUser);
  mtSaveUsers(users);
}

function addPoints(n, reason) {
  var u = getCurrentUser(); if (!u) return;
  u.points = (u.points||0) + n;
  u.history = u.history || [];
  u.history.push({n:n, r:reason, t:Date.now()});
  saveUserData();
}

// ============ 勋章/任务/商店定义 ============
var BADGE_DEF = [
  {id:'b_first_post', name:'初出茅庐', icon:'🌱', desc:'发布第一条动态', check: function(u){ return (u.history||[]).filter(function(h){return h.r==='发布动态'}).length>=1; }},
  {id:'b_first_story', name:'故事大王', icon:'📖', desc:'发布第一个故事', check: function(u){ return (u.history||[]).filter(function(h){return h.r==='发布故事'}).length>=1; }},
  {id:'b_first_task', name:'行动派', icon:'📋', desc:'完成第一个任务', check: function(u){ return (u.taskDone||[]).length>=1; }},
  {id:'b_50pts', name:'小有收获', icon:'🌿', desc:'积分达到50', check: function(u){ return (u.points||0)>=50; }},
  {id:'b_100pts', name:'麦田之星', icon:'⭐', desc:'积分达到100', check: function(u){ return (u.points||0)>=100; }},
];
function checkBadges() {
  var u = getCurrentUser(); if (!u) return;
  u.badges = u.badges || []; var changed = false;
  BADGE_DEF.forEach(function(b){
    if (u.badges.indexOf(b.id)!==-1) return;
    if (b.check(u)) { u.badges.push(b.id); changed = true; }
  });
  if (changed) saveUserData();
}

var TASK_DEF = [
  {id:'t1', title:'拍一张今天的早餐', desc:'用手机拍下今天的早餐，发到麦田动态里', points:10, type:'instant'},
  {id:'t2', title:'写一篇麦田故事', desc:'在「麦田的故事」里分享一个真实故事', points:20, type:'instant'},
  {id:'t3', title:'给一条动态留言', desc:'在麦田动态里给别人的动态写一条评论', points:5, type:'instant'},
  {id:'t4', title:'连续3天签到', desc:'连续3天打开麦田网站', points:15, type:'checkin'},
  {id:'t5', title:'推荐一本书', desc:'在烦恼博物馆里推荐一本你喜欢的书', points:15, type:'instant'},
];
function getTaskById(id) { return TASK_DEF.find(function(t){return t.id===id}) || null; }

function acceptTask(id) {
  var u = getCurrentUser(); if (!u) return false;
  u.taskJoined = u.taskJoined || [];
  if (u.taskJoined.indexOf(id)!==-1) return false;
  u.taskJoined.push(id); saveUserData(); return true;
}
function completeTask(id) {
  var u = getCurrentUser(); if (!u) return false;
  u.taskDone = u.taskDone || [];
  if (u.taskDone.indexOf(id)!==-1) return false;
  var t = getTaskById(id); if (!t) return false;
  u.taskDone.push(id); addPoints(t.points, '完成任务：'+t.title); checkBadges();
  return true;
}

var STORE_DEF = [
  {id:'s1', name:'《小王子》', desc:'经典童话，适合8-12岁', cost:30, cat:'book', icon:'📚'},
  {id:'s2', name:'《夏洛的网》', desc:'关于友谊的生命故事', cost:40, cat:'book', icon:'📖'},
  {id:'s3', name:'麦田笔记本', desc:'A5牛皮纸封面', cost:20, cat:'stationery', icon:'📓'},
  {id:'s4', name:'彩色铅笔套装', desc:'12色，适合画画', cost:25, cat:'stationery', icon:'📏'},
  {id:'s5', name:'周末营地抵扣券', desc:'抵扣100元营地费用', cost:80, cat:'course', icon:'🎓'},
];
function getStoreItems(cat) { if (!cat||cat==='all') return STORE_DEF; return STORE_DEF.filter(function(i){return i.cat===cat}); }

function exchangeItem(id) {
  var u = getCurrentUser(); if (!u) return {ok:false,msg:'请先登录'};
  var item = STORE_DEF.find(function(i){return i.id===id}); if (!item) return {ok:false,msg:'商品不存在'};
  if ((u.points||0) < item.cost) return {ok:false,msg:'积分不足'};
  u.points -= item.cost; u.exchanges = u.exchanges||[]; u.exchanges.push({itemId:id,time:Date.now()});
  saveUserData();
  return {ok:true, item:item};
}

// ============ UI ============
var AVATAR_LIST = ['😊','🐱','🐶','🐰','🦊','🐻','🐼','🐸','🐵','🦁','🐯','🐨','🎈','🌈','⭐','🌻','🍎','📚','🎨','⚽'];
var DEFAULT_AVATAR = '😊';

function updateNavUI() {
  var u = getCurrentUser();
  var lb = document.getElementById('navLoginBtn');
  var ld = document.getElementById('navUserLogged');
  var av = document.getElementById('navAvatar');
  var pt = document.getElementById('navPoints');
  if (!lb || !ld) return;
  if (u) {
    lb.style.display = 'none'; ld.style.display = 'flex';
    setAvatarEl(av, u.avatar);
    pt.textContent = (u.points||0) + '分';
  } else {
    lb.style.display = 'inline-block'; ld.style.display = 'none';
  }
}

function openAuthModal(mode) {
  var m = document.getElementById('authModal'); if (m) m.classList.add('open');
  var tl = document.getElementById('authTabLogin');
  var tr = document.getElementById('authTabRegister');
  var sub = document.getElementById('authSubmit');
  var regF = document.getElementById('authRegisterFields');
  if (tl) tl.classList.toggle('active', mode==='login');
  if (tr) tr.classList.toggle('active', mode==='register');
  if (regF) regF.style.display = mode==='register' ? 'block' : 'none';
  if (sub) sub.textContent = mode==='login' ? '登录' : '注册';
  if (mode === 'register') {
    renderAvatarGrid();
    window._pendingRegisterAvatar = null;
    var prev = document.getElementById('authAvatarPreview');
    if (prev) prev.innerHTML = '';
  }
}
function closeAuthModal() {
  var m = document.getElementById('authModal'); if (m) m.classList.remove('open');
  var e = document.getElementById('authError'); if (e) e.textContent = '';
}
function switchAuthTab(mode) { openAuthModal(mode); }

function renderAvatarGrid() {
  var grid = document.getElementById('avatarGrid');
  if (!grid) return;
  grid.innerHTML = AVATAR_LIST.map(function(em, i) {
    return '<div class="avatar-opt'+(i===0?' selected':'')+'" data-emoji="'+em+'" onclick="selectAvatar(this)">'+em+'</div>';
  }).join('');
}
function selectAvatar(el) {
  document.querySelectorAll('.avatar-opt').forEach(function(o){o.classList.remove('selected')});
  el.classList.add('selected');
  var prev = document.getElementById('editAvatarPreview');
  if (prev) prev.innerHTML = '';
}

// ============ 头像上传 ============
function handleAvatarUpload(e) {
  var file = e.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
  if (file.size > 10*1024*1024) { alert('图片太大，请选择10MB以下的图片'); return; }
  var reader = new FileReader();
  reader.onload = function(ev) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      var maxW = 200, maxH = 200;
      var w = img.width, h = img.height;
      if (w > maxW || h > maxH) { var scale = Math.min(maxW/w, maxH/h); w = Math.round(w*scale); h = Math.round(h*scale); }
      canvas.width = w; canvas.height = h;
      ctx.save();
      ctx.beginPath();
      ctx.arc(w/2, h/2, Math.min(w,h)/2, 0, Math.PI*2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
      var base64 = canvas.toDataURL('image/jpeg', 0.8);
      window._pendingAvatar = base64;
      var prev = document.getElementById('editAvatarPreview');
      if (prev) prev.innerHTML = '<img src="'+base64+'" style="width:72px;height:72px;border-radius:50%;object-fit:cover;">';
      document.querySelectorAll('.avatar-opt').forEach(function(o){o.classList.remove('selected')});
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function handleAuthAvatarUpload(e) {
  var file = e.target.files[0]; if (!file) return;
  if (!file.type.startsWith('image/')) { alert('请选择图片文件'); return; }
  if (file.size > 10*1024*1024) { alert('图片太大，请选择10MB以下的图片'); return; }
  var reader = new FileReader();
  reader.onload = function(ev) {
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      var maxW = 200, maxH = 200;
      var w = img.width, h = img.height;
      if (w > maxW || h > maxH) { var scale = Math.min(maxW/w, maxH/h); w = Math.round(w*scale); h = Math.round(h*scale); }
      canvas.width = w; canvas.height = h;
      ctx.save();
      ctx.beginPath();
      ctx.arc(w/2, h/2, Math.min(w,h)/2, 0, Math.PI*2);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(img, 0, 0, w, h);
      ctx.restore();
      var base64 = canvas.toDataURL('image/jpeg', 0.8);
      window._pendingRegisterAvatar = base64;
      var prev = document.getElementById('authAvatarPreview');
      if (prev) prev.innerHTML = '<img src="'+base64+'" style="width:56px;height:56px;border-radius:50%;object-fit:cover;">';
      document.querySelectorAll('#avatarGrid .avatar-opt').forEach(function(o){o.classList.remove('selected')});
    };
    img.src = ev.target.result;
  };
  reader.readAsDataURL(file);
  e.target.value = '';
}

function setAvatarEl(el, avatar) {
  if (!el) return;
  if (avatar && avatar.indexOf('data:image') === 0) {
    el.innerHTML = '<img src="'+avatar+'" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">';
  } else {
    el.innerHTML = '';
    el.textContent = avatar || DEFAULT_AVATAR;
  }
}

// ============ 编辑资料 ============
function openEditProfile() {
  var u = getCurrentUser(); if (!u) return;
  var m = document.getElementById('editProfileModal'); if (m) m.classList.add('open');
  var prev = document.getElementById('editAvatarPreview');
  if (prev) setAvatarEl(prev, u.avatar || DEFAULT_AVATAR);
  var grid = document.getElementById('editAvatarGrid');
  if (grid) {
    grid.innerHTML = AVATAR_LIST.map(function(em) {
      return '<div class="avatar-opt'+(em === u.avatar ? ' selected' : '')+'" data-emoji="'+em+'" onclick="selectAvatar(this)">'+em+'</div>';
    }).join('');
  }
  var bioEl = document.getElementById('editBio'); if (bioEl) bioEl.value = u.bio || '';
  window._pendingAvatar = null;
}
function closeEditProfile() {
  var m = document.getElementById('editProfileModal'); if (m) m.classList.remove('open');
}
function saveProfile() {
  var u = getCurrentUser(); if (!u) return;
  if (window._pendingAvatar) {
    u.avatar = window._pendingAvatar;
    window._pendingAvatar = null;
  } else {
    var avatarEl = document.querySelector('#editAvatarGrid .avatar-opt.selected');
    if (avatarEl) u.avatar = avatarEl.getAttribute('data-emoji') || u.avatar;
  }
  var bioEl = document.getElementById('editBio');
  if (bioEl) u.bio = bioEl.value.trim();
  saveUserData();
  closeEditProfile();
  renderProfile();
  updateNavUI();
}

// ============ 登录/注册提交 ============
function submitAuth() {
  var isLogin = document.getElementById('authTabLogin').classList.contains('active');
  var nick = (document.getElementById('authUsername').value||'').trim();
  var pwd = (document.getElementById('authPassword').value||'');
  var err = document.getElementById('authError');
  if (!nick || !pwd) { err.textContent = '请填写完整'; return; }
  var result;
  if (isLogin) {
    result = loginUser(nick, pwd);
  } else {
    var avatar = DEFAULT_AVATAR;
    if (window._pendingRegisterAvatar) {
      avatar = window._pendingRegisterAvatar;
      window._pendingRegisterAvatar = null;
    } else {
      var avatarEl = document.querySelector('#avatarGrid .avatar-opt.selected');
      if (avatarEl) avatar = avatarEl.getAttribute('data-emoji') || DEFAULT_AVATAR;
    }
    var bio = document.getElementById('authBio') ? (document.getElementById('authBio').value||'').trim() : '';
    result = registerUser(nick, pwd, avatar, bio);
  }
  if (result.ok) {
    closeAuthModal();
    updateNavUI();
    renderProfile();
    renderTaskList();
    renderStoreGrid();
  } else {
    err.textContent = result.msg;
  }
}

function toggleUserMenu() {
  var dd = document.getElementById('userDropdown'); if (dd) dd.classList.toggle('show');
}
function doLogout() {
  logoutUser(); updateNavUI();
  var dd = document.getElementById('userDropdown'); if (dd) dd.classList.remove('show');
}
function requireLogin() {
  var u = getCurrentUser(); if (!u) { openAuthModal('login'); return false; } return true;
}

// ============ 页面导航 ============
function showMainSite() {
  ['profile','tasks','store'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  ['hero','about','commercial','rural','interact','stories'].forEach(function(id){
    var el = document.getElementById(id); if (el) el.style.display = '';
  });
  var dd = document.getElementById('userDropdown'); if (dd) dd.classList.remove('show');
}
function backToSite() {
  showMainSite();
  window.scrollTo({top:0, behavior:'smooth'});
}

function goProfile() {
  if (!requireLogin()) return;
  getCurrentUser();
  renderProfile();
  document.querySelectorAll('section').forEach(function(s){s.style.display='none'});
  var sec = document.getElementById('profile'); if (sec) { sec.style.display='block'; setTimeout(function(){window.scrollTo({top:0})},50); }
}
function goTasks() {
  if (!requireLogin()) return;
  getCurrentUser();
  renderTaskList();
  document.querySelectorAll('section').forEach(function(s){s.style.display='none'});
  var sec = document.getElementById('tasks'); if (sec) { sec.style.display='block'; setTimeout(function(){window.scrollTo({top:0})},50); }
}
function goStore() {
  if (!requireLogin()) return;
  getCurrentUser();
  renderStoreGrid();
  document.querySelectorAll('section').forEach(function(s){s.style.display='none'});
  var sec = document.getElementById('store'); if (sec) { sec.style.display='block'; setTimeout(function(){window.scrollTo({top:0})},50); }
}

// ============ 渲染 ============
function renderProfile() {
  var u = getCurrentUser(); if (!u) return;
  var el;
  el = document.getElementById('profileName'); if (el) el.textContent = u.nickname;
  el = document.getElementById('profilePoints'); if (el) el.textContent = u.points || 0;
  el = document.getElementById('profileBadges'); if (el) el.textContent = (u.badges||[]).length;
  el = document.getElementById('profilePosts');
  if (el) el.textContent = (u.history||[]).filter(function(h){return h.r==='发布动态'||h.r==='发布故事'}).length;
  el = document.getElementById('profileAvatar'); if (el) setAvatarEl(el, u.avatar || DEFAULT_AVATAR);
  el = document.getElementById('profileBio'); if (el) el.textContent = u.bio || '';
  var navAv = document.getElementById('navAvatar'); if (navAv) setAvatarEl(navAv, u.avatar || DEFAULT_AVATAR);

  var bg = document.getElementById('badgesGrid');
  if (bg) bg.innerHTML = BADGE_DEF.map(function(b){
    var ok = (u.badges||[]).indexOf(b.id)!==-1;
    return '<div class="badge-item '+(ok?'unlocked':'')+'"><div class="badge-icon">'+(ok?b.icon:'🔒')+'</div><div class="badge-name">'+(ok?b.name:b.desc)+'</div></div>';
  }).join('');

  var ph = document.getElementById('pointsHistory');
  if (ph) {
    var hist = (u.history||[]).slice().reverse();
    if (hist.length===0) ph.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:20px;font-size:13px;">暂无记录</div>';
    else ph.innerHTML = hist.map(function(h){
      return '<div class="points-item"><div class="points-item-left"><div class="points-item-icon">'+(h.n>0?'📈':'📉')+'</div><div><div class="points-item-desc">'+(h.r||'未知')+'</div><div class="points-item-time">'+(new Date(h.t||Date.now())).toLocaleString()+'</div></div></div><div class="points-item-val '+(h.n>0?'plus':'minus')+'">'+(h.n>0?'+':'')+h.n+'</div></div>';
    }).join('');
  }
  renderMyTasks();
}

function renderMyTasks() {
  var u = getCurrentUser(); if (!u) return;
  var ml = document.getElementById('myTasksList'); if (!ml) return;
  var joined = u.taskJoined || [];
  var done = u.taskDone || [];
  if (joined.length===0) { ml.innerHTML = '<div style="text-align:center;color:var(--text-light);padding:20px;font-size:13px;">还没有领取任务，去任务中心看看吧</div>'; return; }
  ml.innerHTML = joined.map(function(tid){
    var t = getTaskById(tid); if (!t) return '';
    var isD = done.indexOf(tid)!==-1;
    return '<div class="task-my-item"><span>'+escHtml(t.title)+'</span><span class="task-status '+(isD?'approved':'pending')+'">'+(isD?'已完成':'进行中')+'</span></div>';
  }).join('');
}

function renderTaskList() {
  var u = getCurrentUser();
  var tl = document.getElementById('taskList'); if (!tl) return;
  tl.innerHTML = TASK_DEF.map(function(t){
    var joined = u && (u.taskJoined||[]).indexOf(t.id)!==-1;
    var done = u && (u.taskDone||[]).indexOf(t.id)!==-1;
    return '<div class="task-card"><div class="task-card-header"><div class="task-title">'+escHtml(t.title)+'</div><div class="task-points">+'+t.points+'分</div></div><div class="task-desc">'+escHtml(t.desc)+'</div><div class="task-meta">类型：'+(t.type==='instant'?'即时完成':'签到挑战')+'</div>' +
      (u ? (done?'<button class="task-btn done" disabled>已完成</button>':joined?'<button class="task-btn" onclick="doCompleteTask(\''+t.id+'\')">完成任务</button>':'<button class="task-btn" onclick="doAcceptTask(\''+t.id+'\')">领取任务</button>') : '<div style="font-size:13px;color:var(--text-light);">登录后领取任务</div>') +
    '</div>';
  }).join('');
}

function doAcceptTask(tid) {
  if (!requireLogin()) return; acceptTask(tid); renderTaskList(); renderProfile();
}
function doCompleteTask(tid) {
  if (!requireLogin()) return; completeTask(tid); renderTaskList(); renderProfile();
}

function renderStoreGrid(cat) {
  var u = getCurrentUser();
  var sg = document.getElementById('storeGrid'); if (!sg) return;
  var items = getStoreItems(cat);
  sg.innerHTML = items.map(function(item){
    var can = u && (u.points||0) >= item.cost;
    return '<div class="store-item"><div class="store-item-icon">'+item.icon+'</div><div class="store-item-name">'+escHtml(item.name)+'</div><div class="store-item-desc">'+escHtml(item.desc)+'</div><div class="store-item-cost">'+item.cost+' 积分</div>' +
      (u ? '<button class="store-btn '+(can?'':'disabled')+'" onclick="doExchange(\''+item.id+'\')">兑换</button>' : '<button class="store-btn" onclick="openAuthModal(\'login\')">登录后兑换</button>') +
    '</div>';
  }).join('');
  var sp = document.getElementById('storePoints'); if (sp && u) sp.textContent = u.points || 0;
}

function filterStore(cat, btn) {
  renderStoreGrid(cat);
  document.querySelectorAll('.store-filter-btn').forEach(function(b){b.classList.remove('active')});
  if (btn) btn.classList.add('active');
}

var _pendingExchangeId = null;
function doExchange(itemId) {
  if (!requireLogin()) return;
  var item = STORE_DEF.find(function(i){return i.id===itemId}); if (!item) return;
  var u = getCurrentUser(); if ((u.points||0) < item.cost) { alert('积分不足'); return; }
  _pendingExchangeId = itemId;
  var em = document.getElementById('exchangeModal');
  if (em) em.classList.add('open');
  var ei = document.getElementById('exchangeModalIcon'); if (ei) ei.textContent = item.icon;
  var et = document.getElementById('exchangeModalTitle'); if (et) et.textContent = '确认兑换';
  var ed = document.getElementById('exchangeModalDesc'); if (ed) ed.textContent = '兑换「'+item.name+'」需要 '+item.cost+' 积分，确认兑换吗？兑换后积分不退还。';
}
function confirmExchange() {
  if (!_pendingExchangeId) return;
  var result = exchangeItem(_pendingExchangeId);
  if (result.ok) alert('兑换成功！请联系管理员领取「'+result.item.name+'」');
  else alert(result.msg);
  closeExchangeModal(); _pendingExchangeId = null;
  renderStoreGrid(); renderProfile();
}
function closeExchangeModal() {
  var em = document.getElementById('exchangeModal'); if (em) em.classList.remove('open');
}

// ============ 初始化 ============
function initMaitianApp() {
  if (_getSession()) getCurrentUser();
  updateNavUI();

  var nb = document.getElementById('navUserBtn');
  if (nb && !nb._menuInit) {
    nb.addEventListener('click', function(e) {
      toggleUserMenu(); e.stopPropagation();
    });
    nb._menuInit = true;
  }
  if (!document._dropdownInit) {
    document.addEventListener('click', function(e) {
      var dd = document.getElementById('userDropdown');
      var nb = document.getElementById('navUserBtn');
      if (dd && nb && !nb.contains(e.target)) dd.classList.remove('show');
    });
    document._dropdownInit = true;
  }

  var u = getCurrentUser();
  if (u) { renderProfile(); renderTaskList(); renderStoreGrid(); }
}

if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', function() {
  // 先从 Supabase 拉取，再初始化
  if (typeof mtInitSupabase === 'function') {
    mtInitSupabase().then(initMaitianApp).catch(function() { initMaitianApp(); });
  } else {
    initMaitianApp();
  }
});
else {
  if (typeof mtInitSupabase === 'function') {
    mtInitSupabase().then(initMaitianApp).catch(function() { initMaitianApp(); });
  } else {
    initMaitianApp();
  }
}

// ============ 发布积分监听 ============
document.addEventListener('DOMContentLoaded', function(){
  var feedList = document.getElementById('feedList');
  if (feedList) {
    var lastCount = feedList.children.length;
    setInterval(function(){
      if (feedList.children.length > lastCount) {
        addPoints(2, '发布动态'); checkBadges(); updateNavUI();
        lastCount = feedList.children.length;
      }
    }, 2000);
  }
  var storiesList = document.getElementById('storiesList');
  if (storiesList) {
    var lastCount2 = storiesList.children.length;
    setInterval(function(){
      if (storiesList.children.length > lastCount2) {
        addPoints(5, '发布故事'); checkBadges(); updateNavUI();
        lastCount2 = storiesList.children.length;
      }
    }, 2000);
  }
});
