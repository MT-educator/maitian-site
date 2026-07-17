/**
 * maitian-feed-api.js
 * 麦田动态 / 烦恼博物馆 / 麦田故事 —— localStorage 版
 * 用法：在 index.html 的 <head> 末尾加载此文件
 */
var MT_FEED_KEY = 'mt_feed_v2';
var MT_MUSEUM_KEY = 'mt_museum_v2';
var MT_STORIES_KEY = 'mt_stories_v2';

// ========== 工具 ==========
function escHtml(s) {
  var d = document.createElement('div'); d.textContent = s; return d.innerHTML;
}
function avatarColor(name) {
  var colors = ['#FF6B6B','#4ECDC4','#45B7D1','#F7DC6','#9B59B6','#1ABC9C','#F39C12','#E74C3C','#3498DB','#2ECC71'];
  var h = 0; if (!name) return colors[0];
  for (var i = 0; i < name.length; i++) h = ((h << 5) - h) + name.charCodeAt(i);
  return colors[Math.abs(h) % colors.length];
}
function _nowStr() {
  var d = new Date();
  var pad = function(n){return n<10?'0'+n:''+n};
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes());
}
function _genId() {
  return Date.now();
}

// ========== localStorage 读写 ==========
function _lsLoad(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; }
  catch(e) { return []; }
}
function _lsSave(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
  // 异步推送到 Supabase
  if (typeof mtPushFeed === 'function' && key === 'mt_feed_v2') {
    mtPushFeed(data).catch(function(){});
  }
  if (typeof mtPushMuseum === 'function' && key === 'mt_museum_v2') {
    mtPushMuseum(data).catch(function(){});
  }
  if (typeof mtPushStories === 'function' && key === 'mt_stories_v2') {
    mtPushStories(data).catch(function(){});
  }
}

// ========== 数据加载/保存 ==========
function feedLoad()   { return Promise.resolve(_lsLoad(MT_FEED_KEY)); }
function feedSave(d)  { _lsSave(MT_FEED_KEY, d); return d; }
function museumLoad() { return Promise.resolve(_lsLoad(MT_MUSEUM_KEY)); }
function museumSave(d){ _lsSave(MT_MUSEUM_KEY, d); return d; }
function storiesLoad(){ return Promise.resolve(_lsLoad(MT_STORIES_KEY)); }
function storiesSave(d){ _lsSave(MT_STORIES_KEY, d); return d; }

// ========== 访客 ID ==========
var visitorId = localStorage.getItem('mt_visitor') || (function() {
  var id = 'v_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
  localStorage.setItem('mt_visitor', id); return id;
})();

// ========== 图片预览（发布时）============
var currentImages = [];
function previewImage(e) {
  var files = e.target.files; if (!files) return;
  for (var i = 0; i < files.length; i++) {
    var f = files[i]; if (!f.type.match(/^image\//)) continue;
    var reader = new FileReader();
    reader.onload = (function() {
      var base64 = null;
      return function(ev) {
        // Compress large images
        var img = new Image();
        img.onload = function() {
          var canvas = document.createElement('canvas');
          var ctx = canvas.getContext('2d');
          var maxW = 800;
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          canvas.width = w; canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          var compressed = canvas.toDataURL('image/jpeg', 0.7);
          currentImages.push(compressed);
          renderImagePreviews();
        };
        img.src = ev.target.result;
      };
    })();
    reader.readAsDataURL(f);
  }
  e.target.value = '';
}
function renderImagePreviews() {
  var box = document.getElementById('feedImgPreview'); if (!box) return;
  box.innerHTML = currentImages.map(function(img, i) {
    return '<div style="position:relative;display:inline-block;"><img src="'+img+'" style="width:80px;height:80px;object-fit:cover;border-radius:8px;"><button onclick="removeImage('+i+')" style="position:absolute;top:-6px;right:-6px;background:#e74c3c;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;font-size:12px;">×</button></div>';
  }).join('');
}
function removeImage(idx) { currentImages.splice(idx, 1); renderImagePreviews(); }

// ========== 提交动态 ==========
function submitPost() {
  var text = (document.getElementById('feedInput')||{}).value||'';
  var name = ((document.getElementById('feedName')||{}).value||'').trim() || '匿名';
  if (!text.trim() && currentImages.length === 0) { alert('写点什么吧～'); return; }
  var feed = _lsLoad(MT_FEED_KEY);
  var post = {
    id: _genId(),
    author: name,
    text: text,
    images: currentImages.slice(),
    time: _nowStr(),
    likes: 0,
    likedBy: [],
    comments: []
  };
  feed.unshift(post);
  _lsSave(MT_FEED_KEY, feed);
  (document.getElementById('feedInput')||{}).value = '';
  currentImages = [];
  renderImagePreviews();
  feedRender(feed);
  // 加积分
  if (typeof addPoints === 'function') { addPoints(2,'发布动态'); checkBadges(); updateNavUI(); }
}

// ========== 图片渲染辅助 ==========
function _renderPostImages(post) {
  var imgs = post.images || [];
  if (imgs.length === 0) return '';
  // 用于卡片预览：显示第一张
  return '<div class="feed-card-image" style="max-height:200px;overflow:hidden;border-radius:8px;transform:rotate(-0.5deg);"><img src="'+imgs[0]+'" style="width:100%;height:100%;object-fit:cover;"></div>';
}
function _renderPostImagesFull(post) {
  var imgs = post.images || [];
  if (imgs.length === 0) return '';
  var cls = 'feed-card-images' + (imgs.length > 1 ? ' multi' : '');
  return '<div class="'+cls+'">'+imgs.map(function(s){return '<div class="feed-card-image"><img src="'+s+'"></div>'}).join('')+'</div>';
}

// ========== 渲染动态列表 ==========
function feedRender(feed) {
  if (!feed) feed = _lsLoad(MT_FEED_KEY);
  var list = document.getElementById('feedList'); if (!list) return;
  if (!feed || feed.length === 0) { list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">🌱</div>还没有动态<br>来做第一个分享的人吧！</div>'; return; }
  var noteColors = ['note-yellow','note-pink','note-blue','note-green','note-orange','note-purple','note-teal'];
  var html = '';
  for (var i = 0; i < feed.length; i++) {
    var post = feed[i];
    var liked = ((post.likedBy||[]).indexOf(visitorId)!==-1);
    var imgHtml = _renderPostImages(post);
    var cmts = post.comments || [];
    var authorFirst = post.author && post.author[0] ? post.author[0] : '?';
    var noteColor = noteColors[i % noteColors.length];
    var rot = (((i * 7.3) % 6) - 3).toFixed(1);
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
        (cmts||[]).map(function(c) {
          var cFirst = c.author&&c.author[0]?c.author[0]:'?';
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
function toggleLike(postId) {
  var feed = _lsLoad(MT_FEED_KEY);
  var post = feed.find(function(p){return p.id === postId});
  if (!post) return;
  var lb = post.likedBy || [];
  var idx = lb.indexOf(visitorId);
  if (idx >= 0) lb.splice(idx, 1);
  else lb.push(visitorId);
  post.likedBy = lb;
  post.likes = lb.length;
  _lsSave(MT_FEED_KEY, feed);
  feedRender(feed);
}
function toggleComments(postId) {
  var el = document.getElementById('comments-'+postId); if (!el) return;
  el.classList.toggle('show');
  if (el.classList.contains('show')) { var inp = el.querySelector('.comment-input'); if (inp) inp.focus(); }
}
function addComment(postId, inputEl) {
  var text = inputEl ? inputEl.value.trim() : ''; if (!text) return;
  var name = ((document.getElementById('feedName')||{}).value||'').trim() || '匿名';
  var feed = _lsLoad(MT_FEED_KEY);
  var post = feed.find(function(p){return p.id === postId});
  if (!post) return;
  post.comments = post.comments || [];
  post.comments.push({id:_genId(), author:name, text:text, time:_nowStr()});
  _lsSave(MT_FEED_KEY, feed);
  feedRender(feed);
  if (inputEl) inputEl.value = '';
}

// ========== 动态详情弹窗 ==========
var currentFeedId = null;
function openFeedModal(postId) {
  currentFeedId = postId;
  var feed = _lsLoad(MT_FEED_KEY);
  var post = feed.find(function(p){return p.id === postId}); if (!post) return;
  var imgs = _renderPostImagesFull(post);
  var cmts = post.comments || [];
  var liked = ((post.likedBy||[]).indexOf(visitorId)!==-1);
  document.getElementById('feedModalHeader').innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
      '<div class="feed-card-avatar" style="background:'+avatarColor(post.author)+';width:44px;height:44px;font-size:20px;">'+(post.author[0]||'?')+'</div>' +
      '<div><div style="font-size:15px;font-weight:600;color:var(--earth);">'+escHtml(post.author)+'</div>' +
      '<div style="font-size:12px;color:var(--text-light);">'+post.time+'</div></div></div>';
  var cmtsHtml = '';
  if (cmts.length > 0) {
    cmtsHtml = '<div class="feed-modal-comments-title">💬 评论 · '+cmts.length+' 条</div><div class="feed-modal-comments-list">' +
      cmts.map(function(c){return '<div class="feed-modal-comment-item"><div class="feed-card-avatar" style="background:'+avatarColor(c.author)+';width:32px;height:32px;font-size:14px;">'+(c.author[0]||'?')+'</div>' +
        '<div class="feed-modal-comment-body"><div class="feed-modal-comment-name">'+escHtml(c.author)+'</div>' +
        '<div class="feed-modal-comment-text">'+escHtml(c.text)+'</div><div class="feed-modal-comment-time">'+c.time+'</div></div></div>'}).join('') +
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
  setTimeout(function(){var inp=document.getElementById('feedModalCommentInput');if(inp)inp.focus()},300);
}
function closeFeedModal(e) {
  if (!e || e.target === document.getElementById('feedModal') || !e.target) {
    document.getElementById('feedModal').classList.remove('open'); currentFeedId = null;
  }
}
function toggleLikeModal(postId) { toggleLike(postId); openFeedModal(postId); }
function addCommentModal(postId) {
  var inp = document.getElementById('feedModalCommentInput'); if (!inp) return;
  addComment(postId, inp);
  openFeedModal(postId);
}

// ========== 烦恼博物馆 ==========
function submitMuseumPost() {
  var text = ((document.getElementById('museumInput')||{}).value||'').trim();
  if (!text) { alert('写点烦恼吧～'); return; }
  var name = ((document.getElementById('museumName')||{}).value||'').trim() || '匿名';
  var museum = _lsLoad(MT_MUSEUM_KEY);
  var post = {id:_genId(), author:name, text:text, time:_nowStr(), likes:0, likedBy:[], comments:[], replies:[]};
  museum.unshift(post);
  _lsSave(MT_MUSEUM_KEY, museum);
  ((document.getElementById('museumInput')||{}).value||{}).value = '';
  renderMuseum(museum);
}
function renderMuseum() {
  var list = document.getElementById('museumList'); if (!list) return;
  var museum = _lsLoad(MT_MUSEUM_KEY);
  if (!museum || museum.length === 0) { list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">🏛️</div>还没有内容<br>来说说你的烦恼吧</div>'; return; }
  list.innerHTML = museum.map(function(post) {
    var liked = ((post.likedBy||[]).indexOf(visitorId)!==-1);
    var cmts = post.comments || [];
    return '<div class="museum-card"><div class="museum-card-header"><div class="feed-card-avatar" style="background:#6C5B7;">'+(post.author[0]||'?')+'</div>' +
      '<div><div class="feed-card-name">'+escHtml(post.author)+'</div><div class="feed-card-time">'+post.time+'</div></div></div>' +
      '<div class="museum-card-body">'+escHtml(post.text)+'</div>' +
      '<div class="feed-card-bar"><button class="feed-like-btn'+(liked?' liked':'')+'" onclick="toggleMuseumLike('+post.id+')">❤️ <span>'+(post.likes||0)+'</span></button>' +
      '<button class="feed-comment-btn" onclick="toggleMuseumComments('+post.id+')">💬 <span>'+cmts.length+'</span></button></div>' +
      '<div class="feed-comments" id="museum-comments-'+post.id+'">' +
        (cmts||[]).map(function(c){return '<div class="comment-item"><div class="comment-avatar" style="background:'+avatarColor(c.author)+'">'+(c.author[0]||'?')+'</div>' +
          '<div class="comment-body"><div class="comment-name">'+escHtml(c.author)+'</div><div class="comment-text">'+escHtml(c.text)+'</div>' +
          '<div class="comment-time">'+c.time+'</div></div></div>'}).join('') +
        '<div class="comment-form"><input class="comment-input" placeholder="给个拥抱……" onkeydown="if(event.key==\'Enter\')addMuseumComment('+post.id+',this)">' +
        '<button class="comment-send" onclick="addMuseumComment('+post.id+',this.previousElementSibling)">发送</button></div></div></div>';
  }).join('');
}
function toggleMuseumLike(postId) {
  var museum = _lsLoad(MT_MUSEUM_KEY);
  var post = museum.find(function(p){return p.id === postId});
  if (!post) return;
  var lb = post.likedBy || [];
  var idx = lb.indexOf(visitorId);
  if (idx >= 0) lb.splice(idx, 1);
  else lb.push(visitorId);
  post.likedBy = lb;
  post.likes = lb.length;
  _lsSave(MT_MUSEUM_KEY, museum);
  renderMuseum();
}
function toggleMuseumComments(postId) {
  var el = document.getElementById('museum-comments-'+postId); if (!el) return;
  el.classList.toggle('show');
}
function addMuseumComment(postId, inputEl) {
  var text = inputEl ? inputEl.value.trim() : ''; if (!text) return;
  var name = ((document.getElementById('museumName')||{}).value||'').trim() || '匿名';
  var museum = _lsLoad(MT_MUSEUM_KEY);
  var post = museum.find(function(p){return p.id === postId});
  if (!post) return;
  post.comments = post.comments || [];
  post.comments.push({id:_genId(), author:name, text:text, time:_nowStr()});
  _lsSave(MT_MUSEUM_KEY, museum);
  renderMuseum();
  if (inputEl) inputEl.value = '';
}

// ========== 麦田故事 ==========
var currentStoryImages = [];
function previewStoryImage(e) {
  var files = e.target.files; if (!files) return;
  for (var i = 0; i < files.length; i++) {
    var f = files[i]; if (!f.type.match(/^image\//)) continue;
    var reader = new FileReader();
    reader.onload = (function() {
      return function(ev) {
        var img = new Image();
        img.onload = function() {
          var canvas = document.createElement('canvas');
          var ctx = canvas.getContext('2d');
          var maxW = 800;
          var w = img.width, h = img.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
          canvas.width = w; canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          currentStoryImages.push(canvas.toDataURL('image/jpeg', 0.7));
          renderStoryImagePreviews();
        };
        img.src = ev.target.result;
      };
    })();
    reader.readAsDataURL(f);
  }
  e.target.value = '';
}
function renderStoryImagePreviews() {
  var box = document.getElementById('storyImgPreview'); if (!box) return;
  box.innerHTML = currentStoryImages.map(function(img,i){
    return '<div style="position:relative;display:inline-block;"><img src="'+img+'" style="width:80px;height:80px;object-fit:cover;border-radius:8px;"><button onclick="removeStoryImage('+i+')" style="position:absolute;top:-6px;right:-6px;background:#e74c3c;color:#fff;border:none;border-radius:50%;width:20px;height:20px;cursor:pointer;">×</button></div>';
  }).join('');
}
function removeStoryImage(idx) { currentStoryImages.splice(idx,1); renderStoryImagePreviews(); }

function submitStory() {
  var text = ((document.getElementById('storyInput')||{}).value||'').trim();
  if (!text && currentStoryImages.length === 0) { alert('写点故事吧～'); return; }
  var name = ((document.getElementById('storyName')||{}).value||'').trim() || '匿名';
  var stories = _lsLoad(MT_STORIES_KEY);
  var post = {id:_genId(), author:name, text:text, images:currentStoryImages.slice(), time:_nowStr(), likes:0, likedBy:[], comments:[], official:false};
  stories.unshift(post);
  _lsSave(MT_STORIES_KEY, stories);
  ((document.getElementById('storyInput')||{}).value||{}).value = '';
  currentStoryImages = []; renderStoryImagePreviews();
  renderStories(stories);
  // 加积分
  if (typeof addPoints === 'function') { addPoints(5,'发布故事'); checkBadges(); updateNavUI(); }
}
function renderStories() {
  var list = document.getElementById('storiesList'); if (!list) return;
  var stories = _lsLoad(MT_STORIES_KEY);
  if (!stories || stories.length === 0) { list.innerHTML = '<div class="feed-empty"><div class="feed-empty-icon">📖</div>还没有故事<br>来分享第一个故事吧</div>'; return; }
  var noteColors = ['note-yellow','note-pink','note-blue','note-green','note-orange','note-purple','note-teal'];
  list.innerHTML = stories.map(function(s, i) {
    var liked = ((s.likedBy||[]).indexOf(visitorId)!==-1);
    var cmts = s.comments || [];
    var imgs = (s.images||[]).map(function(img){return '<img src="'+img+'">'}).join('');
    var noteColor = noteColors[i % noteColors.length];
    return '<div class="story-card '+noteColor+'" onclick="openStoryModal('+s.id+')">' +
      '<div class="story-card-header"><div class="feed-card-avatar" style="background:'+avatarColor(s.author)+'">'+(s.author[0]||'?')+'</div>' +
      '<div><div class="feed-card-name">'+escHtml(s.author)+'</div><div class="feed-card-time">'+s.time+'</div></div></div>' +
      (s.text ? '<div class="story-card-body">'+escHtml(s.text)+'</div>' : '') +
      (imgs ? '<div class="story-card-images">'+imgs+'</div>' : '') +
      '<div class="story-card-bar"><button class="feed-like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleStoryLike('+s.id+')">❤️ <span>'+(s.likes||0)+'</span></button>' +
      '<button class="feed-comment-btn" onclick="event.stopPropagation();openStoryModal('+s.id+')">💬 <span>'+cmts.length+'</span></button></div></div>';
  }).join('');
}
function openStoryModal(storyId) {
  var stories = _lsLoad(MT_STORIES_KEY);
  var s = stories.find(function(x){return x.id === storyId}); if (!s) return;
  var liked = ((s.likedBy||[]).indexOf(visitorId)!==-1);
  var cmts = s.comments || [];
  document.getElementById('storyModalHeader').innerHTML =
    '<div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">' +
      '<div class="feed-card-avatar" style="background:'+avatarColor(s.author)+';width:44px;height:44px;font-size:20px;">'+(s.author[0]||'?')+'</div>' +
      '<div><div style="font-size:15px;font-weight:600;">'+escHtml(s.author)+'</div><div style="font-size:12px;color:var(--text-light);">'+s.time+'</div></div></div>';
  var imgs = (s.images||[]).map(function(img){return '<img src="'+img+'" style="max-width:100%;border-radius:8px;">'}).join('');
  var cmtsHtml = '';
  if (cmts.length > 0) {
    cmtsHtml = '<div class="feed-modal-comments-title">💬 评论 · '+cmts.length+' 条</div><div class="feed-modal-comments-list">' +
      cmts.map(function(c){return '<div class="feed-modal-comment-item"><div class="feed-card-avatar" style="background:'+avatarColor(c.author)+';width:32px;height:32px;font-size:14px;">'+(c.author[0]||'?')+'</div>' +
        '<div class="feed-modal-comment-body"><div class="feed-modal-comment-name">'+escHtml(c.author)+'</div>' +
        '<div class="feed-modal-comment-text">'+escHtml(c.text)+'</div><div class="feed-modal-comment-time">'+c.time+'</div></div></div>'}).join('') + '</div>';
  }
  document.getElementById('storyModalBody').innerHTML =
    (s.text ? '<div class="feed-modal-text">'+escHtml(s.text)+'</div>' : '') + imgs +
    '<div class="feed-modal-actions"><button class="feed-like-btn'+(liked?' liked':'')+'" onclick="event.stopPropagation();toggleStoryLike('+storyId+')">❤️ <span>'+(s.likes||0)+'</span></button></div>' +
    cmtsHtml +
    '<div class="feed-modal-comment-form"><input class="feed-modal-comment-input" id="storyModalCommentInput" placeholder="写评论……" onkeydown="if(event.key==\'Enter\')submitStoryComment('+storyId+')">' +
    '<button class="feed-modal-comment-send" onclick="submitStoryComment('+storyId+')">➤</button></div>';
  document.getElementById('storyModal').classList.add('open');
  setTimeout(function(){var inp=document.getElementById('storyModalCommentInput');if(inp)inp.focus()},300);
}
function closeStoryModal() { document.getElementById('storyModal').classList.remove('open'); }
function toggleStoryLike(storyId) {
  var stories = _lsLoad(MT_STORIES_KEY);
  var s = stories.find(function(x){return x.id === storyId}); if (!s) return;
  var lb = s.likedBy || [];
  var idx = lb.indexOf(visitorId);
  if (idx >= 0) lb.splice(idx, 1);
  else lb.push(visitorId);
  s.likedBy = lb;
  s.likes = lb.length;
  _lsSave(MT_STORIES_KEY, stories);
  renderStories();
}
function submitStoryComment(storyId) {
  var inp = document.getElementById('storyModalCommentInput'); if (!inp) return;
  var text = inp.value.trim(); if (!text) return;
  var name = ((document.getElementById('storyName')||{}).value||'').trim() || '匿名';
  var stories = _lsLoad(MT_STORIES_KEY);
  var s = stories.find(function(x){return x.id === storyId}); if (!s) return;
  s.comments = s.comments || [];
  s.comments.push({id:_genId(), author:name, text:text, time:_nowStr()});
  _lsSave(MT_STORIES_KEY, stories);
  inp.value = ''; openStoryModal(storyId);
}

// ========== Tab 切换 ==========
function switchTab(tab) {
  document.querySelectorAll('.interact-tab').forEach(function(b){b.classList.remove('active')});
  var btn = document.querySelector('.interact-tab[data-tab="'+tab+'"]');
  if (btn) btn.classList.add('active');
  document.getElementById('feedSection').style.display = tab==='feed' ? '' : 'none';
  document.getElementById('museumSection').style.display = tab==='museum' ? '' : 'none';
  document.getElementById('storiesSection').style.display = tab==='stories' ? '' : 'none';
  if (tab === 'feed')   { feedLoad().then(feedRender); }
  if (tab === 'museum') { museumLoad().then(renderMuseum); }
  if (tab === 'stories') { storiesLoad().then(renderStories); }
}

// ========== 初始化 ==========
window.addEventListener('DOMContentLoaded', function() {
  // 导航滚动
  var nav = document.getElementById('mainNav');
  if (nav) window.addEventListener('scroll', function(){nav.classList.toggle('scrolled', window.scrollY > 40)});
  // 淡入动画
  document.querySelectorAll('.fade-up').forEach(function(el) {
    var obs = new IntersectionObserver(function(entries) {
      entries.forEach(function(e){if(e.isIntersecting){el.classList.add('visible');obs.unobserve(el)}});
    }, {threshold:0.15});
    obs.observe(el);
  });

  // 等待 Supabase 同步完成后加载初始数据
  function loadTab() {
    var params = new URLSearchParams(location.search);
    var tab = params.get('tab') || 'feed';
    switchTab(tab);
  }

  if (typeof mtInitSupabase === 'function') {
    // 确保 Supabase 先同步
    mtInitSupabase().then(loadTab).catch(loadTab);
  } else {
    loadTab();
  }

  console.log('[麦田] localStorage + Supabase 模式已启动，访客ID：'+visitorId);
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
