/**
 * maitian-feed-api.js
 * 麦田动态 / 烦恼博物馆 / 麦田故事 —— API 版
 * 替换 index.html 里的内联 localStorage 脚本
 * 用法：在 index.html 的 <head> 末尾加载此文件
 */
const _API = '';  // 部署后自动使用当前域名

// ========== 工具 ==========
function escHtml(s) {
  const d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function avatarColor(name) {
  const colors = ['#FF6B6B','#4ECDC4','#45B7D1','#F7DC6','#9B59B6','#1ABC9C','#F39C12','#E74C3C','#3498DB','#2ECC71'];
  let h = 0; if (!name) return colors[0];
  for (let i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return colors[Math.abs(h) % colors.length];
}

// ========== 缓存 ==========
let _feedCache = null, _museumCache = null, _storiesCache = null;
let _feedLoaded = false, _museumLoaded = false, _storiesLoaded = false;

// ========== 访客 ID ==========
let visitorId = localStorage.getItem('mt_visitor') || (() => {
  const id = 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  localStorage.setItem('mt_visitor', id); return id;
})();

// ========== 数据加载 ==========
async function feedLoad() {
  if (_feedCache) return _feedCache;
  try { const r = await fetch(_API + '/api/feed'); _feedCache = await r.json(); _feedLoaded = true; return _feedCache; }
  catch(e) { console.warn('[feed] 加载失败', e); return _feedCache || []; }
}
function feedSave(data) { _feedCache = data; }
async function museumLoad() {
  if (_museumCache) return _museumCache;
  try { const r = await fetch(_API + '/api/museum'); _museumCache = await r.json(); _museumLoaded = true; return _museumCache; }
  catch(e) { return _museumCache || []; }
}
function museumSave(data) { _museumCache = data; }
async function storiesLoad() {
  if (_storiesCache) return _storiesCache;
  try { const r = await fetch(_API + '/api/stories'); _storiesCache = await r.json(); _storiesLoaded = true; return _storiesCache; }
  catch(e) { return _storiesCache || []; }
}
function storiesSave(data) { _storiesCache = data; }

// ========== 图片预览（发布时）============
let currentImages = [];
function previewImage(e) {
  const files = e.target.files; if (!files) return;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; if (!f.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = function(ev) {
      currentImages.push(ev.target.result);
      renderImagePreviews();
    };
    reader.readAsDataURL(f);
  }
  e.target.value = '';
}
function renderImagePreviews() {
  const box = document.getElementById('feedImgPreview'); if (!box) return;
  box.innerHTML = currentImages.map((img, i) =>
    '<div style="position:relative;display:inline-block;"><img src="'+img+'" style="width:80px;height:80px;object-fit:cover;border-radius:8px;"><button onclick="removeImage('+i+')" style="position:absolute;top:-6px;right:-6px;background:#e74c3c;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:12px;">×</button></div>'
  ).join('');
}
function removeImage(idx) { currentImages.splice(idx, 1); renderImagePreviews(); }

// ========== 提交动态 ==========
async function submitPost() {
  const text = (document.getElementById('feedInput')||{}).value||'';
  const name = ((document.getElementById('feedName')||{}).value||'').trim() || '匿名';
  if (!text.trim() && currentImages.length === 0) { alert('写点什么吧～'); return; }
  try {
    const resp = await fetch(_API + '/api/feed', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text:text, images:currentImages, author:name})
    });
    const result = await resp.json();
    if (result.ok) {
      _feedCache = null;
      (document.getElementById('feedInput')||{}).value = '';
      currentImages = [];
      renderImagePreviews();
      const feed = await feedLoad(); feedRender(feed);
      // 加积分
      if (typeof addPoints === 'function') { addPoints(2,'发布动态'); checkBadges(); updateNavUI(); }
    }
  } catch(e) { alert('发布失败，请检查服务是否启动'); }
}

// ========== 渲染动态列表 ==========
function renderPostImagesPreview(post) {
  const imgs = post.images || [];
  if (imgs.length === 0) return '';
  if (imgs.length === 1) return '<div class="feed-card-image" style="max-height:200px;overflow:hidden;border-radius:8px;transform:rotate(-0.5deg);"><img src="/uploads/'+imgs[0]+'" style="width:100%;height:100%;object-fit:cover;"></div>';
  const back2 = imgs.length >= 3 ? '<div class="stack-photo stack-back2"></div>' : '';
  return '<div class="feed-card-image-stack">'+back2+'<div class="stack-photo stack-back1"></div><div class="stack-photo stack-front"><img src="/uploads/'+imgs[0]+'"></div><div class="stack-count">+'+(imgs.length-1)+'张</div></div>';
}
function renderPostImages(post) {
  const imgs = post.images || [];
  if (imgs.length === 0) return '';
  const cls = 'feed-card-images' + (imgs.length > 1 ? ' multi' : '');
  return '<div class="'+cls+'">'+imgs.map(s=>(s.startsWith('data:')?'<div class="feed-card-image"><img src="'+s+'"></div>':'<div class="feed-card-image"><img src="/uploads/'+s+'"></div>')).join('')+'</div>';
}

async function feedRender(feed) {
  if (!feed) feed = await feedLoad();
  const list = document.getElementById('feedList'); if (!list) return;
  if (!feed || feed.length === 0) { list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">🌱</div>还没有动态<br>来做第一个分享的人吧！</div>'; return; }
  const noteColors = ['note-yellow','note-pink','note-blue','note-green','note-orange','note-purple','note-teal'];
  let html = '';
  for (let i = 0; i < feed.length; i++) {
    const post = feed[i];
    const liked = ((post.likedBy||[]).indexOf(visitorId)!==-1);
    const imgHtml = renderPostImagesPreview(post);
    const cmts = post.comments || [];
    const authorFirst = post.author && post.author[0] ? post.author[0] : '?';
    const noteColor = noteColors[i % noteColors.length];
    const rot = (((i * 7.3) % 6) - 3).toFixed(1);
    html += '<div class="feed-card '+noteColor+'" style="--r:'+rot+'deg" onclick="openFeedModal('+post.id+');event.stopPropagation();">' +
      '<div class="feed-card-header">' +
        '<div class="feed-card-avatar" style="background:'+avatarColor(post.author)+'">'+authorFirst+'</div>' +
        '<div class="feed-card-info"><div class="feed-card-name">'+escHtml(post.author)+'</div>' +
        '<div class="feed-card-time">'+post.time+'</div></div>' +
      '</div>' +
      (post.text ? '<div class="feed-card-body">'+escHtml(post.text)+'</div>' : '') +
      imgHtml +
      '<div class="feed-card-bar">' +
        '<button class="feed-like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleLike('+post.id+')">❤️ <span>'+(post.likes||0)+'</span></button>' +
        '<button class="feed-comment-btn" onclick="event.stopPropagation();toggleComments('+post.id+')">💬 <span>'+cmts.length+'</span></button>' +
      '</div>' +
      '<div class="feed-comments" id="comments-'+post.id+'">' +
        (cmts||[]).map(c => {
          const cFirst = c.author&&c.author[0]?c.author[0]:'?';
          return '<div class="comment-item"><div class="comment-avatar" style="background:'+avatarColor(c.author)+'">'+cFirst+'</div>' +
            '<div class="comment-body"><div class="comment-name">'+escHtml(c.author)+'</div>' +
            '<div class="comment-text">'+escHtml(c.text)+'</div><div class="comment-time">'+c.time+'</div></div></div>';
        }).join('') +
        '<div class="comment-form"><input class="comment-input" placeholder="写评论……" onkeydown="if(event.key==\'Enter\')addComment('+post.id+',this)">' +
        '<button class="comment-send" onclick="addComment('+post.id+',this.previousElementSibling)">发送</button></div></div></div>';
  }
  list.innerHTML = html;
}

// ========== 点赞 / 评论 ==========
async function toggleLike(postId) {
  try {
    await fetch(_API + '/api/feed/' + postId + '/like', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({visitor:visitorId})
    });
    _feedCache = null; const feed = await feedLoad(); feedRender(feed);
  } catch(e) { console.warn('点赞失败',e); }
}
function toggleComments(postId) {
  const el = document.getElementById('comments-'+postId); if (!el) return;
  el.classList.toggle('show');
  if (el.classList.contains('show')) { const inp = el.querySelector('.comment-input'); if (inp) inp.focus(); }
}
async function addComment(postId, inputEl) {
  const text = inputEl ? inputEl.value.trim() : ''; if (!text) return;
  const name = ((document.getElementById('feedName')||{}).value||'').trim() || '匿名';
  try {
    await fetch(_API + '/api/feed/' + postId + '/comment', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, author:name})
    });
    _feedCache = null; const feed = await feedLoad(); feedRender(feed);
    if (inputEl) inputEl.value = '';
  } catch(e) { console.warn('评论失败',e); }
}

// ========== 动态详情弹窗 ==========
let currentFeedId = null;
async function openFeedModal(postId) {
  currentFeedId = postId;
  const feed = await feedLoad();
  const post = feed.find(p => p.id === postId); if (!post) return;
  const imgs = renderPostImages(post);
  const cmts = post.comments || [];
  const liked = ((post.likedBy||[]).indexOf(visitorId)!==-1);
  document.getElementById('feedModalHeader').innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
      '<div class="feed-card-avatar" style="background:'+avatarColor(post.author)+';width:44px;height:44px;font-size:20px;">'+(post.author[0]||'?')+'</div>' +
      '<div><div style="font-size:15px;font-weight:600;color:var(--earth);">'+escHtml(post.author)+'</div>' +
      '<div style="font-size:12px;color:var(--text-light);">'+post.time+'</div></div></div>';
  let cmtsHtml = '';
  if (cmts.length > 0) {
    cmtsHtml = '<div class="feed-modal-comments-title">💬 评论 · '+cmts.length+' 条</div><div class="feed-modal-comments-list">' +
      cmts.map(c => '<div class="feed-modal-comment-item"><div class="feed-card-avatar" style="background:'+avatarColor(c.author)+';width:32px;height:32px;font-size:14px;">'+(c.author[0]||'?')+'</div>' +
        '<div class="feed-modal-comment-body"><div class="feed-modal-comment-name">'+escHtml(c.author)+'</div>' +
        '<div class="feed-modal-comment-text">'+escHtml(c.text)+'</div><div class="feed-modal-comment-time">'+c.time+'</div></div></div>').join('') +
      '</div>';
  } else { cmtsHtml = '<div class="feed-modal-comments-title">💬 评论</div><div style="text-align:center;padding:16px;color:var(--text-light);font-size:13px;">还没有评论，来说两句吧 🌱</div>'; }
  document.getElementById('feedModalBody').innerHTML =
    (post.text ? '<div class="feed-modal-text">'+escHtml(post.text)+'</div>' : '') +
    imgs +
    '<div class="feed-modal-actions"><button class="feed-like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleLikeModal('+postId+')">❤️ <span>'+(post.likes||0)+'</span></button></div>' +
    cmtsHtml +
    '<div class="feed-modal-comment-form"><input class="feed-modal-comment-input" id="feedModalCommentInput" placeholder="写评论……" onkeydown="if(event.key==\'Enter\')addCommentModal('+postId+')">' +
    '<button class="feed-modal-comment-send" onclick="addCommentModal('+postId+')">➤</button></div>';
  document.getElementById('feedModal').classList.add('open');
  setTimeout(() => { const inp = document.getElementById('feedModalCommentInput'); if (inp) inp.focus(); }, 300);
}
function closeFeedModal(e) {
  if (!e || e.target === document.getElementById('feedModal') || !e.target) {
    document.getElementById('feedModal').classList.remove('open'); currentFeedId = null;
  }
}
async function toggleLikeModal(postId) { await toggleLike(postId); await openFeedModal(postId); }
async function addCommentModal(postId) {
  const inp = document.getElementById('feedModalCommentInput'); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  const name = ((document.getElementById('feedName')||{}).value||'').trim() || '匿名';
  try {
    await fetch(_API + '/api/feed/' + postId + '/comment', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, author:name})
    });
    inp.value = ''; await openFeedModal(postId);
  } catch(e) { console.warn('评论失败',e); }
}

// ========== 烦恼博物馆 ==========
async function submitMuseumPost() {
  const text = ((document.getElementById('museumInput')||{}).value||'').trim();
  if (!text) { alert('写点烦恼吧～'); return; }
  const name = ((document.getElementById('museumName')||{}).value||'').trim() || '匿名';
  try {
    await fetch(_API + '/api/museum', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, author:name})
    });
    _museumCache = null;
    ((document.getElementById('museumInput')||{}).value||{}).value = '';
    const museum = await museumLoad(); renderMuseum(museum);
  } catch(e) { alert('发布失败'); }
}
async function renderMuseum() {
  const list = document.getElementById('museumList'); if (!list) return;
  const museum = await museumLoad();
  if (!museum || museum.length === 0) { list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">🏛️</div>还没有内容<br>来说说你的烦恼吧</div>'; return; }
  list.innerHTML = museum.map(post => {
    const liked = ((post.likedBy||[]).indexOf(visitorId)!==-1);
    const cmts = post.comments || [];
    return '<div class="museum-card"><div class="museum-card-header"><div class="feed-card-avatar" style="background:#6C5B7;">'+(post.author[0]||'?')+'</div>' +
      '<div><div class="feed-card-name">'+escHtml(post.author)+'</div><div class="feed-card-time">'+post.time+'</div></div></div>' +
      '<div class="museum-card-body">'+escHtml(post.text)+'</div>' +
      '<div class="feed-card-bar"><button class="feed-like-btn'+(liked?' liked':'')+'" onclick="toggleMuseumLike('+post.id+')">❤️ <span>'+(post.likes||0)+'</span></button>' +
      '<button class="feed-comment-btn" onclick="toggleMuseumComments('+post.id+')">💬 <span>'+cmts.length+'</span></button></div>' +
      '<div class="feed-comments" id="museum-comments-'+post.id+'">' +
        (cmts||[]).map(c => '<div class="comment-item"><div class="comment-avatar" style="background:'+avatarColor(c.author)+'">'+(c.author[0]||'?')+'</div>' +
          '<div class="comment-body"><div class="comment-name">'+escHtml(c.author)+'</div><div class="comment-text">'+escHtml(c.text)+'</div>' +
          '<div class="comment-time">'+c.time+'</div></div></div>').join('') +
        '<div class="comment-form"><input class="comment-input" placeholder="给个拥抱……" onkeydown="if(event.key==\'Enter\')addMuseumComment('+post.id+',this)">' +
        '<button class="comment-send" onclick="addMuseumComment('+post.id+',this.previousElementSibling)">发送</button></div></div></div>';
  }).join('');
}
async function toggleMuseumLike(postId) {
  try {
    await fetch(_API + '/api/museum/' + postId + '/like', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({visitor:visitorId})
    });
    _museumCache = null; await renderMuseum();
  } catch(e) { console.warn('点赞失败',e); }
}
function toggleMuseumComments(postId) {
  const el = document.getElementById('museum-comments-'+postId); if (!el) return;
  el.classList.toggle('show');
}
async function addMuseumComment(postId, inputEl) {
  const text = inputEl ? inputEl.value.trim() : ''; if (!text) return;
  const name = ((document.getElementById('museumName')||{}).value||'').trim() || '匿名';
  try {
    await fetch(_API + '/api/museum/' + postId + '/comment', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, author:name})
    });
    _museumCache = null; await renderMuseum(); if (inputEl) inputEl.value = '';
  } catch(e) { console.warn('评论失败',e); }
}

// ========== 麦田故事 ==========
let currentStoryImages = [];
function previewStoryImage(e) {
  const files = e.target.files; if (!files) return;
  for (let i = 0; i < files.length; i++) {
    const f = files[i]; if (!f.type.startsWith('image/')) continue;
    const reader = new FileReader();
    reader.onload = function(ev) { currentStoryImages.push(ev.target.result); renderStoryImagePreviews(); };
    reader.readAsDataURL(f);
  }
  e.target.value = '';
}
function renderStoryImagePreviews() {
  const box = document.getElementById('storyImgPreview'); if (!box) return;
  box.innerHTML = currentStoryImages.map((img,i) =>
    '<div style="position:relative;display:inline-block;"><img src="'+img+'" style="width:80px;height:80px;object-fit:cover;border-radius:8px;"><button onclick="removeStoryImage('+i+')" style="position:absolute;top:-6px;right:-6px;background:#e74c3c;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;">×</button></div>'
  ).join('');
}
function removeStoryImage(idx) { currentStoryImages.splice(idx,1); renderStoryImagePreviews(); }

async function submitStory() {
  const text = ((document.getElementById('storyInput')||{}).value||'').trim();
  if (!text && currentStoryImages.length === 0) { alert('写点故事吧～'); return; }
  const name = ((document.getElementById('storyName')||{}).value||'').trim() || '匿名';
  try {
    const resp = await fetch(_API + '/api/stories', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, images:currentStoryImages, author:name})
    });
    const result = await resp.json();
    if (result.ok) {
      _storiesCache = null;
      ((document.getElementById('storyInput')||{}).value||{}).value = '';
      currentStoryImages = []; renderStoryImagePreviews();
      const stories = await storiesLoad(); renderStories(stories);
    }
  } catch(e) { alert('发布失败'); }
}
async function renderStories() {
  const list = document.getElementById('storiesList'); if (!list) return;
  const stories = await storiesLoad();
  if (!stories || stories.length === 0) { list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">📖</div>还没有故事<br>来分享第一个故事吧</div>'; return; }
  const noteColors = ['note-yellow','note-pink','note-blue','note-green','note-orange','note-purple','note-teal'];
  list.innerHTML = stories.map((s, i) => {
    const liked = ((s.likedBy||[]).indexOf(visitorId)!==-1);
    const cmts = s.comments || [];
    const imgs = (s.images||[]).map(img => img.startsWith('data:') ? '<img src="'+img+'">' : '<img src="/uploads/'+img+'">').join('');
    const noteColor = noteColors[i % noteColors.length];
    return '<div class="story-card '+noteColor+'" onclick="openStoryModal('+s.id+')">' +
      '<div class="story-card-header"><div class="feed-card-avatar" style="background:'+avatarColor(s.author)+'">'+(s.author[0]||'?')+'</div>' +
      '<div><div class="feed-card-name">'+escHtml(s.author)+'</div><div class="feed-card-time">'+s.time+'</div></div></div>' +
      (s.text ? '<div class="story-card-body">'+escHtml(s.text)+'</div>' : '') +
      (imgs ? '<div class="story-card-images">'+imgs+'</div>' : '') +
      '<div class="story-card-bar"><button class="feed-like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleStoryLike('+s.id+')">❤️ <span>'+(s.likes||0)+'</span></button>' +
      '<button class="feed-comment-btn" onclick="event.stopPropagation();openStoryModal('+s.id+')">💬 <span>'+cmts.length+'</span></button></div></div>';
  }).join('');
}
async function openStoryModal(storyId) {
  const stories = await storiesLoad();
  const s = stories.find(x => x.id === storyId); if (!s) return;
  const liked = ((s.likedBy||[]).indexOf(visitorId)!==-1);
  const cmts = s.comments || [];
  document.getElementById('storyModalHeader').innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
      '<div class="feed-card-avatar" style="background:'+avatarColor(s.author)+';width:44px;height:44px;font-size:20px;">'+(s.author[0]||'?')+'</div>' +
      '<div><div style="font-size:15px;font-weight:600;">'+escHtml(s.author)+'</div><div style="font-size:12px;color:var(--text-light);">'+s.time+'</div></div></div>';
  const imgs = (s.images||[]).map(img => img.startsWith('data:') ? '<img src="'+img+'" style="max-width:100%;border-radius:8px;">' : '<img src="/uploads/'+img+'" style="max-width:100%;border-radius:8px;">').join('');
  let cmtsHtml = '';
  if (cmts.length > 0) {
    cmtsHtml = '<div class="feed-modal-comments-title">💬 评论 · '+cmts.length+' 条</div><div class="feed-modal-comments-list">' +
      cmts.map(c => '<div class="feed-modal-comment-item"><div class="feed-card-avatar" style="background:'+avatarColor(c.author)+';width:32px;height:32px;font-size:14px;">'+(c.author[0]||'?')+'</div>' +
        '<div class="feed-modal-comment-body"><div class="feed-modal-comment-name">'+escHtml(c.author)+'</div>' +
        '<div class="feed-modal-comment-text">'+escHtml(c.text)+'</div><div class="feed-modal-comment-time">'+c.time+'</div></div></div>').join('') + '</div>';
  }
  document.getElementById('storyModalBody').innerHTML =
    (s.text ? '<div class="feed-modal-text">'+escHtml(s.text)+'</div>' : '') + imgs +
    '<div class="feed-modal-actions"><button class="feed-like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleStoryLike('+storyId+')">❤️ <span>'+(s.likes||0)+'</span></button></div>' +
    cmtsHtml +
    '<div class="feed-modal-comment-form"><input class="feed-modal-comment-input" id="storyModalCommentInput" placeholder="写评论……" onkeydown="if(event.key==\'Enter\')submitStoryComment('+storyId+')">' +
    '<button class="feed-modal-comment-send" onclick="submitStoryComment('+storyId+')">➤</button></div>';
  document.getElementById('storyModal').classList.add('open');
}
function closeStoryModal() { document.getElementById('storyModal').classList.remove('open'); }
async function toggleStoryLike(storyId) {
  try {
    await fetch(_API + '/api/stories/' + storyId + '/like', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({visitor:visitorId})
    });
    _storiesCache = null; await renderStories();
  } catch(e) { console.warn('点赞失败',e); }
}
async function submitStoryComment(storyId) {
  const inp = document.getElementById('storyModalCommentInput'); if (!inp) return;
  const text = inp.value.trim(); if (!text) return;
  const name = ((document.getElementById('storyName')||{}).value||'').trim() || '匿名';
  try {
    await fetch(_API + '/api/stories/' + storyId + '/comment', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({text, author:name})
    });
    inp.value = ''; await openStoryModal(storyId);
  } catch(e) { console.warn('评论失败',e); }
}

// ========== Tab 切换 ==========
function switchTab(tab) {
  document.querySelectorAll('.interact-tab').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('.interact-tab[data-tab="'+tab+'"]');
  if (btn) btn.classList.add('active');
  document.getElementById('feedSection').style.display = tab==='feed' ? '' : 'none';
  document.getElementById('museumSection').style.display = tab==='museum' ? '' : 'none';
  document.getElementById('storiesSection').style.display = tab==='stories' ? '' : 'none';
  if (tab === 'feed')   { feedLoad().then(feedRender); }
  if (tab === 'museum') { museumLoad().then(renderMuseum); }
  if (tab === 'stories') { storiesLoad().then(renderStories); }
}

// ========== 初始化 ==========
window.addEventListener('DOMContentLoaded', async () => {
  // 导航滚动
  const nav = document.getElementById('mainNav');
  if (nav) window.addEventListener('scroll', () => nav.classList.toggle('scrolled', window.scrollY > 40));
  // 淡入动画
  document.querySelectorAll('.fade-up').forEach(el => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { el.classList.add('visible'); obs.unobserve(el); } });
    }, {threshold:0.15});
    obs.observe(el);
  });
  // 加载初始数据
  const tab = (new URLSearchParams(location.search)).get('tab') || 'feed';
  switchTab(tab);
  console.log('[麦田] API 模式已启动，访客ID：'+visitorId);
});

// ========== 全局函数暴露 ==========
window.submitPost = submitPost;
window.toggleLike = toggleLike;
window.addComment = addComment;
window.toggleComments = toggleComments;
window.openFeedModal = openFeedModal;
window.closeFeedModal = closeFeedModal;
window.toggleLikeModal = toggleLikeModal;
window.addCommentModal = addCommentModal;
window.previewImage = previewImage;
window.removeImage = removeImage;
window.submitMuseumPost = submitMuseumPost;
window.renderMuseum = renderMuseum;
window.toggleMuseumLike = toggleMuseumLike;
window.toggleMuseumComments = toggleMuseumComments;
window.addMuseumComment = addMuseumComment;
window.previewStoryImage = previewStoryImage;
window.removeStoryImage = removeStoryImage;
window.submitStory = submitStory;
window.renderStories = renderStories;
window.openStoryModal = openStoryModal;
window.closeStoryModal = closeStoryModal;
window.toggleStoryLike = toggleStoryLike;
window.submitStoryComment = submitStoryComment;
window.switchTab = switchTab;
window.feedRender = feedRender;
window.feedLoad = feedLoad;
window.feedSave = feedSave;
window.museumLoad = museumLoad;
window.museumSave = museumSave;
window.storiesLoad = storiesLoad;
window.storiesSave = storiesSave;
