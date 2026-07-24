/**
 * maitian-supabase.js
 * Supabase 跨设备同步层
 * 与内联 localStorage 键名对齐：
 *   - 麦田动态: maitian_feed_v2
 *   - 烦恼博物馆: maitian_museum_v1
 *   - 麦田故事: maitian_stories_v1
 *   - 用户: mt_users_v2 (由 maitian-app.js 管理)
 */
var MT_SUPABASE_URL = 'https://gqzyxxwhnzmqthvmehzt.supabase.co';
var MT_SUPABASE_KEY = 'sb_publishable_P_TEaz0kOHld9rATH13VyA_W2RXUBc_';
var _mtSupabase = null;

function mtSupabase() {
  if (!_mtSupabase && window.supabase && window.supabase.createClient) {
    _mtSupabase = window.supabase.createClient(MT_SUPABASE_URL, MT_SUPABASE_KEY);
  }
  return _mtSupabase;
}

// ============ localStorage 键名（与内联代码一致）============
var MT_INLINE_KEYS = {
  feed:   'maitian_feed_v2',
  museum: 'maitian_museum_v1',
  stories:'maitian_stories_v1',
  users:  'mt_users_v2'
};

// ============ 全局迁移锁 ============
var _mtMigrated = localStorage.getItem('mt_supabase_migrated_v2');

async function mtMigrateToSupabase() {
  if (_mtMigrated) return;
  var sb = mtSupabase();
  if (!sb) { console.log('[麦田] Supabase 未就绪，跳过迁移'); return; }

  console.log('[麦田] 开始首次迁移 localStorage → Supabase...');

  // 迁移动态
  try {
    var feedRaw = localStorage.getItem(MT_INLINE_KEYS.feed);
    if (feedRaw) {
      var feed = JSON.parse(feedRaw);
      if (feed && feed.length > 0) {
        await sb.from('feed_posts').delete().neq('id', 0);
        var rows = feed.map(function(p) { return { id:p.id, author:p.author, text:p.text, images:p.images, created_at:p.time, likes:p.likes, liked_by:p.likedBy, comments:p.comments }; });
        await sb.from('feed_posts').insert(rows);
        console.log('[麦田] 迁移动态: ' + rows.length + ' 条');
      }
    }
  } catch(e) { console.warn('[麦田] 迁移动态失败:', e.message); }

  // 迁移博物馆（存完整对象为 JSON）
  try {
    var museumRaw = localStorage.getItem(MT_INLINE_KEYS.museum);
    if (museumRaw) {
      var museum = JSON.parse(museumRaw);
      if (museum && museum.length > 0) {
        await sb.from('museum_posts').delete().neq('id', 0);
        var rows = museum.map(function(p) {
          return { id:p.id, author:p.author, text:JSON.stringify(p), created_at:p.time, likes:0, liked_by:[], comments:[], replies:[] };
        });
        await sb.from('museum_posts').insert(rows);
        console.log('[麦田] 迁移博物馆: ' + rows.length + ' 条');
      }
    }
  } catch(e) { console.warn('[麦田] 迁移博物馆失败:', e.message); }

  // 迁移故事（存完整对象为 JSON）
  try {
    var storiesRaw = localStorage.getItem(MT_INLINE_KEYS.stories);
    if (storiesRaw) {
      var stories = JSON.parse(storiesRaw);
      if (stories && stories.length > 0) {
        await sb.from('stories').delete().neq('id', 0);
        var rows = stories.map(function(p) {
          return { id:p.id, author:p.author, text:JSON.stringify(p), images:p.images, created_at:p.time, likes:p.likes, liked_by:p.likedBy, comments:p.comments, official:p.official||false };
        });
        await sb.from('stories').insert(rows);
        console.log('[麦田] 迁移故事: ' + rows.length + ' 条');
      }
    }
  } catch(e) { console.warn('[麦田] 迁移故事失败:', e.message); }

  // 迁移用户（由 maitian-app.js 的 mtSync.pushProfile 处理，这里跳过）
  localStorage.setItem('mt_supabase_migrated_v2', '1');
  console.log('[麦田] 首次迁移完成');
}

// ============ 云端拉取（写入内联 localStorage 键名）============
async function mtPullFromSupabase() {
  var sb = mtSupabase();
  if (!sb) return;

  try {
    // 拉取动态 — 合并云端和本地数据（云端有、本地也有 → 合并互动字段）
    var r1 = await sb.from('feed_posts').select('*').order('id', { ascending: false });
    if (r1.data && r1.data.length > 0) {
      var mergedFeed = mtMergeLocalWithRemote(MT_INLINE_KEYS.feed, r1.data, function(p) {
        return { id:p.id, author:p.author, text:p.text, images:p.images, time:p.created_at, likes:p.likes, likedBy:p.liked_by, comments:p.comments };
      }, 'id');
      localStorage.setItem(MT_INLINE_KEYS.feed, JSON.stringify(mergedFeed));
    }

    // 拉取博物馆 — 合并云端和本地数据
    var r2 = await sb.from('museum_posts').select('*').order('id', { ascending: false });
    if (r2.data && r2.data.length > 0) {
      var mergedMuseum = mtMergeLocalWithRemote(MT_INLINE_KEYS.museum, r2.data, function(p) {
        try {
          var obj = JSON.parse(p.text);
          obj.id = obj.id || p.id;
          return obj;
        } catch(e) {
          return { id:p.id, no:'000', author:p.author, anon:false, title:p.text||'', desc:'', time:p.created_at, strategies:[] };
        }
      }, 'id');
      localStorage.setItem(MT_INLINE_KEYS.museum, JSON.stringify(mergedMuseum));
    }

    // 拉取故事 — 合并云端和本地数据
    var r3 = await sb.from('stories').select('*').order('id', { ascending: false });
    if (r3.data && r3.data.length > 0) {
      var mergedStories = mtMergeLocalWithRemote(MT_INLINE_KEYS.stories, r3.data, function(p) {
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
      }, 'id');
      localStorage.setItem(MT_INLINE_KEYS.stories, JSON.stringify(mergedStories));
    }

    // 拉取用户
    var r4 = await sb.from('profiles').select('*');
    if (r4.data && r4.data.length > 0) {
      var users = r4.data.map(function(u) {
        return {
          nickname:u.nickname, password:u.password, avatar:u.avatar,
          bio:u.bio, points:u.points, badges:u.badges||[],
          taskJoined:u.task_joined||[], taskDone:u.task_done||[],
          exchanges:u.exchanges||[], history:u.history||[]
        };
      });
      localStorage.setItem(MT_INLINE_KEYS.users, JSON.stringify(users));
    }

    console.log('[麦田] 从 Supabase 同步完成');
  } catch(e) {
    console.warn('[麦田] 云端同步失败，使用本地数据:', e.message);
  }
}

// ============ 合并工具 ============
function mtMergeArrayBy(remoteArr, key, mapFn) {
  var result = {};
  remoteArr.forEach(function(item) {
    result[key(item)] = mapFn(item);
  });
  return result;
}

function mtMergeLocalWithRemote(localKey, remoteArr, mapFn, sortKey) {
  var local = [];
  try { local = JSON.parse(localStorage.getItem(localKey) || '[]'); } catch(e) {}
  var remoteMap = mtMergeArrayBy(remoteArr, function(r) { return mapFn(r).id; }, mapFn);
  // 本地数据优先（可能有未推送的），但云端已有的按 id 合并
  local.forEach(function(p) {
    if (remoteMap[p.id]) {
      // 云端已有 → 合并互动数据（保留更大的 likes，合并 likedBy 和 comments）
      var r = remoteMap[p.id];
      p.likes = Math.max(p.likes || 0, r.likes || 0);
      p.likedBy = Array.from(new Set((p.likedBy || []).concat(r.likedBy || [])));
      var commentMap = {};
      (r.comments || []).forEach(function(c) { commentMap[c.id] = c; });
      (p.comments || []).forEach(function(c) { if (!commentMap[c.id]) commentMap[c.id] = c; else commentMap[c.id] = c; });
      p.comments = Object.values(commentMap).sort(function(a,b) { return a.id - b.id; });
    }
  });
  // 云端有但本地没有的 → 加入
  Object.keys(remoteMap).forEach(function(id) {
    if (!local.some(function(p) { return p.id == id; })) {
      local.push(remoteMap[id]);
    }
  });
  // 排序
  if (sortKey) {
    local.sort(function(a, b) { return (b[sortKey] || 0) - (a[sortKey] || 0); });
  }
  return local;
}

// ============ 推送（全部改 upsert，不再删光再插）============
async function mtPushFeed(feed) {
  var sb = mtSupabase(); if (!sb) return;
  try {
    if (feed.length > 0) {
      var rows = feed.map(function(p) {
        return { id:p.id, author:p.author, text:p.text, images:p.images, created_at:p.time, likes:p.likes, liked_by:p.likedBy, comments:p.comments };
      });
      await sb.from('feed_posts').upsert(rows, { onConflict: 'id' });
    }
  } catch(e) {
    console.warn('[麦田] 推送动态失败:', e.message);
  }
}

async function mtPushMuseum(museum) {
  var sb = mtSupabase(); if (!sb) return;
  try {
    if (museum.length > 0) {
      var rows = museum.map(function(p) {
        return { id:p.id, author:p.author, text:JSON.stringify(p), created_at:p.time, likes:0, liked_by:[], comments:[], replies:[] };
      });
      await sb.from('museum_posts').upsert(rows, { onConflict: 'id' });
    }
  } catch(e) {
    console.warn('[麦田] 推送博物馆失败:', e.message);
  }
}

async function mtPushStories(stories) {
  var sb = mtSupabase(); if (!sb) return;
  try {
    if (stories.length > 0) {
      var rows = stories.map(function(p) {
        return { id:p.id, author:p.author, text:JSON.stringify(p), images:p.images, created_at:p.time, likes:p.likes, liked_by:p.likedBy, comments:p.comments, official:p.official||false };
      });
      await sb.from('stories').upsert(rows, { onConflict: 'id' });
    }
  } catch(e) {
    console.warn('[麦田] 推送故事失败:', e.message);
  }
}

async function mtPushProfile(user) {
  var sb = mtSupabase(); if (!sb) return;
  try {
    await sb.from('profiles').upsert({
      nickname:user.nickname,
      password:user.password,
      avatar:user.avatar||'😊',
      bio:user.bio||'',
      points:user.points||0,
      badges:user.badges||[],
      task_joined:user.taskJoined||[],
      task_done:user.taskDone||[],
      exchanges:user.exchanges||[],
      history:user.history||[]
    }, { onConflict: 'nickname' });
  } catch(e) {
    console.warn('[麦田] 推送用户失败:', e.message);
  }
}

// ============ 初始化（防重入）============
var _mtInitPromise = null;

async function mtInitSupabase() {
  if (_mtInitPromise) return _mtInitPromise;
  _mtInitPromise = (async function() {
    await mtMigrateToSupabase();
    await mtPullFromSupabase();
    console.log('[麦田] Supabase 同步层就绪');
  })();
  return _mtInitPromise;
}

console.log('[麦田] Supabase 同步层已加载（v2 内联对齐版）');
