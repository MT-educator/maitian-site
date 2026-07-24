/**
 * maitian-supabase.js  (v3 — 原生 fetch 版，不依赖 Supabase JS 库)
 * 兼容 iOS Safari / Android Chrome / 桌面浏览器
 *
 * localStorage 键名（与内联代码一致）：
 *   - 麦田动态: maitian_feed_v2
 *   - 烦恼博物馆: maitian_museum_v1
 *   - 麦田故事: maitian_stories_v1
 *   - 用户: mt_users_v2
 */

var MT_SUPABASE_URL  = 'https://gqzyxxwhnzmqthvmehzt.supabase.co';
var MT_SUPABASE_KEY  = 'sb_publishable_P_TEaz0kOHld9rATH13VyA_W2RXUBc_';
var MT_REST_BASE     = MT_SUPABASE_URL + '/rest/v1/';
var MT_HEADERS        = {
  'apikey':       MT_SUPABASE_KEY,
  'Authorization':'Bearer ' + MT_SUPABASE_KEY,
  'Content-Type': 'application/json'
};

var MT_INLINE_KEYS = {
  feed:   'maitian_feed_v2',
  museum: 'maitian_museum_v1',
  stories:'maitian_stories_v1',
  users:  'mt_users_v2'
};

// ============ 安全 localStorage 工具 ============
function mtSafeSetItem(key, value, silent) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch(e) {
    if (e.name === 'QuotaExceededError' || (e.message && e.message.toLowerCase().indexOf('quota') !== -1)) {
      mtClearOldCache();
      try {
        localStorage.setItem(key, value);
        return true;
      } catch(e2) {
        if (!silent) console.warn('[麦田] 存储空间已满，无法保存:', key);
        return false;
      }
    }
    if (!silent) console.warn('[麦田] localStorage 写入失败:', e.message);
    return false;
  }
}

function mtClearOldCache() {
  // 清理已知旧键和冗余键，保留核心数据
  var keysToRemove = ['mt_supabase_migrated', 'mt_supabase_migrated_v2', 'mt_supabase_migrated_v3'];
  keysToRemove.forEach(function(k) {
    try { localStorage.removeItem(k); } catch(e){}
  });
  // 如果 feed 数据过大，只保留最近 30 条
  try {
    var feed = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.feed) || '[]');
    if (feed.length > 30) {
      localStorage.setItem(MT_INLINE_KEYS.feed, JSON.stringify(feed.slice(0, 30)));
    }
  } catch(e){}
  try {
    var stories = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.stories) || '[]');
    if (stories.length > 20) {
      localStorage.setItem(MT_INLINE_KEYS.stories, JSON.stringify(stories.slice(0, 20)));
    }
  } catch(e){}
}

// ============ 原生 fetch 封装 ============
function mtFetch(path, options) {
  options = options || {};
  options.headers = Object.assign({}, MT_HEADERS, options.headers || {});
  return fetch(MT_REST_BASE + path, options).then(function(resp) {
    if (!resp.ok) {
      return resp.text().then(function(txt) {
        throw new Error('Supabase ' + resp.status + ': ' + txt.substring(0, 200));
      });
    }
    // DELETE 返回空 body
    if (resp.status === 204) return [];
    return resp.json();
  });
}

function mtSelect(table, orderCol) {
  var q = 'select=*';
  if (orderCol) q += '&order=' + orderCol + '.desc';
  return mtFetch(table + '?' + q);
}

function mtUpsert(table, rows, conflictCol) {
  if (!rows || rows.length === 0) return Promise.resolve();
  var path = table;
  var headers = { 'Prefer': 'resolution=merge-duplicates' };
  if (conflictCol) {
    path += '?on_conflict=' + conflictCol;
  }
  return mtFetch(path, {
    method:  'POST',
    headers: headers,
    body:    JSON.stringify(rows)
  });
}

// ============ 合并工具 ============
function mtMergeLocalWithRemote(localKey, remoteArr, mapFn) {
  var local = [];
  try { local = JSON.parse(localStorage.getItem(localKey) || '[]'); } catch(e) {}
  var remoteMap = {};
  remoteArr.forEach(function(r) {
    var obj = mapFn(r);
    if (obj && obj.id) remoteMap[obj.id] = obj;
  });
  // 本地已有 → 合并互动字段
  local.forEach(function(p) {
    if (remoteMap[p.id]) {
      var r = remoteMap[p.id];
      p.likes = Math.max(p.likes || 0, r.likes || 0);
      p.likedBy = Array.from(new Set((p.likedBy || []).concat(r.likedBy || [])));
      var commentMap = {};
      (r.comments || []).forEach(function(c) { commentMap[c.id] = c; });
      (p.comments || []).forEach(function(c) { if (!commentMap[c.id]) commentMap[c.id] = c; });
      p.comments = Object.keys(commentMap).map(function(k) { return commentMap[k]; }).sort(function(a,b) { return a.id - b.id; });
    }
  });
  // 云端有但本地没有 → 加入
  Object.keys(remoteMap).forEach(function(id) {
    if (!local.some(function(p) { return p.id == id; })) {
      local.push(remoteMap[id]);
    }
  });
  local.sort(function(a, b) { return (b.id || 0) - (a.id || 0); });
  return local;
}

// ============ 全局迁移锁 ============
var _mtMigrated = localStorage.getItem('mt_supabase_migrated_v3');

async function mtMigrateToSupabase() {
  if (_mtMigrated) return;
  console.log('[麦田] 开始首次迁移 localStorage -> Supabase (v3)...');
  try {
    var feed = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.feed) || '[]');
    if (feed.length > 0) {
      var feedRows = feed.map(function(p) {
        return { id:p.id, author:p.author, text:p.text, images:p.images, created_at:p.time, likes:p.likes||0, liked_by:p.likedBy||[], comments:p.comments||[] };
      });
      await mtUpsert('feed_posts', feedRows, 'id');
      console.log('[麦田] 迁移动态: ' + feedRows.length + ' 条');
    }
    var museum = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.museum) || '[]');
    if (museum.length > 0) {
      var museumRows = museum.map(function(p) {
        return { id:p.id, author:p.author, text:JSON.stringify(p), created_at:p.time, likes:0, liked_by:[], comments:[], replies:[] };
      });
      await mtUpsert('museum_posts', museumRows, 'id');
      console.log('[麦田] 迁移博物馆: ' + museumRows.length + ' 条');
    }
    var stories = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.stories) || '[]');
    if (stories.length > 0) {
      var storyRows = stories.map(function(p) {
        return { id:p.id, author:p.author, text:JSON.stringify(p), images:p.images, created_at:p.time, likes:p.likes||0, liked_by:p.likedBy||[], comments:p.comments||[], official:p.official||false };
      });
      await mtUpsert('stories', storyRows, 'id');
      console.log('[麦田] 迁移故事: ' + storyRows.length + ' 条');
    }
  } catch(e) {
    console.warn('[麦田] 迁移失败:', e.message);
  }
  mtSafeSetItem('mt_supabase_migrated_v3', '1');
  console.log('[麦田] 首次迁移完成');
}

// ============ 云端拉取（合并，不覆盖）============
async function mtPullFromSupabase() {
  try {
    // 拉取动态
    var feedData = await mtSelect('feed_posts', 'id');
    if (feedData && feedData.length > 0) {
      var mergedFeed = mtMergeLocalWithRemote(MT_INLINE_KEYS.feed, feedData, function(p) {
        return { id:p.id, author:p.author, text:p.text, images:p.images, time:p.created_at, likes:p.likes, likedBy:p.liked_by, comments:p.comments };
      });
      mtSafeSetItem(MT_INLINE_KEYS.feed, JSON.stringify(mergedFeed));
    }

    // 拉取博物馆
    var museumData = await mtSelect('museum_posts', 'id');
    if (museumData && museumData.length > 0) {
      var mergedMuseum = mtMergeLocalWithRemote(MT_INLINE_KEYS.museum, museumData, function(p) {
        try {
          var obj = JSON.parse(p.text);
          obj.id = obj.id || p.id;
          return obj;
        } catch(e) {
          return { id:p.id, no:'000', author:p.author, anon:false, title:p.text||'', desc:'', time:p.created_at, strategies:[] };
        }
      });
      mtSafeSetItem(MT_INLINE_KEYS.museum, JSON.stringify(mergedMuseum));
    }

    // 拉取故事
    var storyData = await mtSelect('stories', 'id');
    if (storyData && storyData.length > 0) {
      var mergedStories = mtMergeLocalWithRemote(MT_INLINE_KEYS.stories, storyData, function(p) {
        try {
          var obj = JSON.parse(p.text);
          obj.id = obj.id || p.id;
          obj.images = obj.images || p.images || [];
          obj.likes = obj.likes || p.likes || 0;
          obj.likedBy = obj.likedBy || p.liked_by || [];
          obj.comments = obj.comments || p.comments || [];
          obj.official = obj.official !== undefined ? obj.official : (p.official || false);
          obj.time = obj.time || p.created_at;
          return obj;
        } catch(e) {
          return { id:p.id, author:p.author, anon:false, title:'', text:p.text||'', images:p.images||[], time:p.created_at, likes:p.likes||0, likedBy:p.liked_by||[], comments:p.comments||[], official:p.official||false, featured:false };
        }
      });
      mtSafeSetItem(MT_INLINE_KEYS.stories, JSON.stringify(mergedStories));
    }

    // 拉取用户
    var userData = await mtSelect('profiles');
    if (userData && userData.length > 0) {
      var users = userData.map(function(u) {
        return {
          nickname:u.nickname, password:u.password, avatar:u.avatar,
          bio:u.bio, points:u.points, badges:u.badges||[],
          taskJoined:u.task_joined||[], taskDone:u.task_done||[],
          exchanges:u.exchanges||[], history:u.history||[]
        };
      });
      mtSafeSetItem(MT_INLINE_KEYS.users, JSON.stringify(users));
    }

    console.log('[麦田] 从云端同步完成 (fetch)');
  } catch(e) {
    console.warn('[麦田] 云端同步失败，使用本地数据:', e.message);
    throw e;
  }
}

// ============ 推送（upsert，不删数据）============
async function mtPushFeed(feed) {
  try {
    if (feed && feed.length > 0) {
      var rows = feed.map(function(p) {
        return { id:p.id, author:p.author, text:p.text, images:p.images, created_at:p.time, likes:p.likes||0, liked_by:p.likedBy||[], comments:p.comments||[] };
      });
      await mtUpsert('feed_posts', rows, 'id');
    }
  } catch(e) {
    console.warn('[麦田] 推送动态失败:', e.message);
  }
}

async function mtPushMuseum(museum) {
  try {
    if (museum && museum.length > 0) {
      var rows = museum.map(function(p) {
        return { id:p.id, author:p.author, text:JSON.stringify(p), created_at:p.time, likes:0, liked_by:[], comments:[], replies:[] };
      });
      await mtUpsert('museum_posts', rows, 'id');
    }
  } catch(e) {
    console.warn('[麦田] 推送博物馆失败:', e.message);
  }
}

async function mtPushStories(stories) {
  try {
    if (stories && stories.length > 0) {
      var rows = stories.map(function(p) {
        return { id:p.id, author:p.author, text:JSON.stringify(p), images:p.images, created_at:p.time, likes:p.likes||0, liked_by:p.likedBy||[], comments:p.comments||[], official:p.official||false };
      });
      await mtUpsert('stories', rows, 'id');
    }
  } catch(e) {
    console.warn('[麦田] 推送故事失败:', e.message);
  }
}

async function mtPushProfile(user) {
  try {
    await mtUpsert('profiles', [{
      nickname:user.nickname,
      password:user.password,
      avatar:user.avatar||'emoji',
      bio:user.bio||'',
      points:user.points||0,
      badges:user.badges||[],
      task_joined:user.taskJoined||[],
      task_done:user.taskDone||[],
      exchanges:user.exchanges||[],
      history:user.history||[]
    }], 'nickname');
  } catch(e) {
    console.warn('[麦田] 推送用户失败:', e.message);
  }
}

// ============ 合并后把本地独有数据推回云端 ============
async function mtPushAllLocal() {
  try {
    var feed = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.feed) || '[]');
    if (feed.length > 0) await mtPushFeed(feed);
    var museum = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.museum) || '[]');
    if (museum.length > 0) await mtPushMuseum(museum);
    var stories = JSON.parse(localStorage.getItem(MT_INLINE_KEYS.stories) || '[]');
    if (stories.length > 0) await mtPushStories(stories);
    console.log('[麦田] 本地独有数据已推回云端');
  } catch(e) {
    console.warn('[麦田] 推回本地数据失败:', e.message);
  }
}

// ============ 初始化（防重入）============
var _mtInitPromise = null;

async function mtInitSupabase() {
  if (_mtInitPromise) return _mtInitPromise;
  _mtInitPromise = (async function() {
    await mtMigrateToSupabase();
    await mtPullFromSupabase();
    await mtPushAllLocal();
    console.log('[麦田] 同步层就绪 (v3 原生 fetch)');
  })();
  return _mtInitPromise;
}

// ============ iOS 可见性恢复时自动同步 ============
var _mtLastVisible = Date.now();
document.addEventListener('visibilitychange', function() {
  if (document.visibilityState === 'visible') {
    var gap = Date.now() - _mtLastVisible;
    if (gap > 5000) {
      console.log('[麦田] 页面重新可见，自动同步 (' + Math.round(gap/1000) + 's)');
      _mtLastVisible = Date.now();
      if (typeof mtPullFromSupabase === 'function') {
        mtPullFromSupabase().then(function() {
          if (typeof feedRender === 'function') feedRender(feedLoad());
          if (typeof museumRender === 'function') museumRender();
          if (typeof storiesRender === 'function') storiesRender();
        }).catch(function(){});
      }
    }
  } else {
    _mtLastVisible = Date.now();
  }
});

console.log('[麦田] 同步层已加载 (v3 原生 fetch)');
