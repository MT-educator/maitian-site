#!/usr/bin/env python3
"""
maitian_wsgi.py — 麦田 WSGI 应用（零依赖，纯标准库）
适配 PythonAnywhere 部署
"""
import json, os, base64, time, hashlib, sqlite3, mimetypes
from pathlib import Path
from urllib.parse import urlparse, parse_qs

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

DB_PATH = BASE_DIR / "maitian.db"

# ========== 数据库初始化 ==========
def init_db():
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute("""CREATE TABLE IF NOT EXISTS users (
        nickname TEXT PRIMARY KEY, password TEXT, avatar TEXT, bio TEXT,
        points INT DEFAULT 0, badges TEXT DEFAULT '[]', taskJoined TEXT DEFAULT '[]',
        taskDone TEXT DEFAULT '[]', exchanges TEXT DEFAULT '[]', history TEXT DEFAULT '[]',
        created INT DEFAULT 0)""")
    c.execute("""CREATE TABLE IF NOT EXISTS feed (
        id INT PRIMARY KEY, author TEXT, text TEXT, images TEXT, time TEXT,
        likes INT DEFAULT 0, likedBy TEXT DEFAULT '[]', comments TEXT DEFAULT '[]')""")
    c.execute("""CREATE TABLE IF NOT EXISTS museum (
        id INT PRIMARY KEY, author TEXT, text TEXT, time TEXT,
        likes INT DEFAULT 0, likedBy TEXT DEFAULT '[]', comments TEXT DEFAULT '[]', replies TEXT DEFAULT '[]')""")
    c.execute("""CREATE TABLE IF NOT EXISTS stories (
        id INT PRIMARY KEY, author TEXT, text TEXT, images TEXT, time TEXT,
        likes INT DEFAULT 0, likedBy TEXT DEFAULT '[]', comments TEXT DEFAULT '[]', official INT DEFAULT 0)""")
    conn.commit()
    conn.close()

init_db()

# ========== 工具函数 ==========
def _db(q, params=(), commit=False):
    conn = sqlite3.connect(str(DB_PATH))
    c = conn.cursor()
    c.execute(q, params)
    if commit:
        conn.commit()
        conn.close()
        return None
    rows = c.fetchall()
    conn.close()
    return rows

def _jload(s, d=None):
    try: return json.loads(s)
    except: return d if d is not None else []

def _jdump(v):
    return json.dumps(v, ensure_ascii=False)

def _pw_hash(p):
    return hashlib.sha256(p.encode()).hexdigest()

def _gen_id():
    return int(time.time() * 1000)

def _save_img(post_id, imgs):
    names = []
    for i, d in enumerate(imgs):
        if not d or not d.startswith("data:image/"):
            continue
        try:
            h, b = d.split(",", 1)
            ext = (h.split("/")[1].split(";")[0] or "png")[:10]
            (UPLOAD_DIR / f"{post_id}_{i}.{ext}").write_bytes(base64.b64decode(b))
            names.append(f"{post_id}_{i}.{ext}")
        except: pass
    return names

# ========== WSGI 响应工具 ==========
def json_response(data, status=200):
    body = json.dumps(data, ensure_ascii=False).encode('utf-8')
    headers = [
        ('Content-Type', 'application/json; charset=utf-8'),
        ('Access-Control-Allow-Origin', '*'),
        ('Content-Length', str(len(body))),
    ]
    return status, headers, [body]

def file_response(path):
    if not path.exists():
        return 404, [('Content-Type', 'text/plain')], [b'Not Found']
    mime, _ = mimetypes.guess_type(str(path))
    body = path.read_bytes()
    headers = [
        ('Content-Type', mime or 'application/octet-stream'),
        ('Content-Length', str(len(body))),
    ]
    return 200, headers, [body]

def cors_headers():
    return [
        ('Access-Control-Allow-Origin', '*'),
        ('Access-Control-Allow-Methods', 'GET, POST, OPTIONS'),
        ('Access-Control-Allow-Headers', 'Content-Type'),
    ]

# ========== 路由处理 ==========
def handle_get(path):
    """处理 GET 请求，返回 (status, headers, body_iter)"""
    # 静态文件
    if path == "/" or path == "/index.html":
        return file_response(BASE_DIR / "index.html")
    if path.startswith("/maitian-"):
        return file_response(BASE_DIR / path[1:])
    if path.startswith("/images-web/"):
        return file_response(BASE_DIR / path[1:])
    if path.startswith("/uploads/"):
        return file_response(UPLOAD_DIR / path.split("/")[-1])

    # API
    if path == "/api/users":
        rows = _db("SELECT * FROM users")
        cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
        return json_response([{**dict(zip(cols, r)), "password": "***"} for r in rows])

    if path == "/api/feed":
        rows = _db("SELECT id,author,text,images,time,likes,likedBy,comments FROM feed ORDER BY id DESC")
        return json_response([{"id":r[0],"author":r[1],"text":r[2],"images":["/uploads/"+f for f in _jload(r[3],[])],"time":r[4],"likes":r[5],"likedBy":_jload(r[6],[]),"comments":_jload(r[7],[])} for r in rows])

    if path == "/api/museum":
        rows = _db("SELECT id,author,text,time,likes,likedBy,comments,replies FROM museum ORDER BY id DESC")
        return json_response([{"id":r[0],"author":r[1],"text":r[2],"time":r[3],"likes":r[4],"likedBy":_jload(r[5],[]),"comments":_jload(r[6],[]),"replies":_jload(r[7],[])} for r in rows])

    if path == "/api/stories":
        rows = _db("SELECT id,author,text,images,time,likes,likedBy,comments,official FROM stories ORDER BY id DESC")
        return json_response([{"id":r[0],"author":r[1],"text":r[2],"images":["/uploads/"+f for f in _jload(r[3],[])],"time":r[4],"likes":r[5],"likedBy":_jload(r[6],[]),"comments":_jload(r[7],[]),"official":bool(r[8])} for r in rows])

    return 404, [('Content-Type', 'text/plain')], [b'Not Found']

def handle_post(path, body):
    """处理 POST 请求"""
    d = body

    # 注册
    if path == "/api/users/register":
        nick = (d.get("nickname") or "").strip()
        pwd = (d.get("password") or "").strip()
        if len(nick) < 2: return json_response({"ok":False,"msg":"昵称至少2个字"},400)
        if len(pwd) < 4: return json_response({"ok":False,"msg":"密码至少4位"},400)
        if _db("SELECT 1 FROM users WHERE nickname = ?", (nick,)):
            return json_response({"ok":False,"msg":"昵称已存在"},400)
        _db("INSERT INTO users VALUES (?,?,?,?,0,'[]','[]','[]','[]','[]',?)",
           (nick, _pw_hash(pwd), d.get("avatar","😊"), d.get("bio",""), _gen_id()), commit=True)
        return json_response({"ok":True,"user":{"nickname":nick,"avatar":d.get("avatar","😊"),"bio":"","points":0,"badges":[],"taskJoined":[],"taskDone":[],"exchanges":[],"history":[]}})

    # 登录
    if path == "/api/users/login":
        nick = (d.get("nickname") or "").strip()
        pwd = (d.get("password") or "").strip()
        rows = _db("SELECT * FROM users WHERE nickname = ?", (nick,))
        if not rows: return json_response({"ok":False,"msg":"用户不存在"},404)
        cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
        u = dict(zip(cols, rows[0]))
        if u["password"] != _pw_hash(pwd): return json_response({"ok":False,"msg":"密码错误"},401)
        u["password"] = "***"
        for k in ["badges","taskJoined","taskDone","exchanges","history"]:
            u[k] = _jload(u[k], [])
        return json_response({"ok":True,"user":u})

    # 更新用户
    if path == "/api/users/update":
        nick = (d.get("nickname") or "").strip()
        for k in ["avatar","bio","points","badges","taskJoined","taskDone","exchanges","history"]:
            if k in d:
                v = _jdump(d[k]) if isinstance(d[k], (list,dict)) else d[k]
                _db(f"UPDATE users SET {k}=? WHERE nickname=?", (v, nick), commit=True)
        rows = _db("SELECT * FROM users WHERE nickname = ?", (nick,))
        cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
        u = dict(zip(cols, rows[0]))
        u["password"] = "***"
        for k in ["badges","taskJoined","taskDone","exchanges","history"]:
            u[k] = _jload(u[k], [])
        return json_response({"ok":True,"user":u})

    # 发动态
    if path == "/api/feed":
        pid = _gen_id()
        imgs = _save_img(pid, d.get("images",[]))
        _db("INSERT INTO feed VALUES (?,?,?,?,?,0,'[]','[]')",
           (pid, d.get("author","匿名"), d.get("text",""), _jdump(imgs), time.strftime("%Y-%m-%d %H:%M")), commit=True)
        return json_response({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"images":["/uploads/"+f for f in imgs],"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[]}})

    # 动态点赞
    if "/api/feed/" in path and path.endswith("/like"):
        pid = int(path.split("/")[3])
        rows = _db("SELECT likedBy FROM feed WHERE id=?", (pid,))
        if not rows: return json_response({"ok":False,"msg":"不存在"},404)
        lb = _jload(rows[0][0], [])
        vis = d.get("visitor","anon")
        if vis in lb: lb.remove(vis)
        else: lb.append(vis)
        _db("UPDATE feed SET likes=?, likedBy=? WHERE id=?", (len(lb), _jdump(lb), pid), commit=True)
        return json_response({"ok":True,"likes":len(lb),"liked":vis in lb})

    # 动态评论
    if "/api/feed/" in path and path.endswith("/comment"):
        pid = int(path.split("/")[3])
        rows = _db("SELECT comments FROM feed WHERE id=?", (pid,))
        if not rows: return json_response({"ok":False,"msg":"不存在"},404)
        cmts = _jload(rows[0][0], [])
        cmt = {"id":_gen_id(),"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%m-%d %H:%M")}
        if not cmt["text"]: return json_response({"ok":False,"msg":"评论不能为空"},400)
        cmts.append(cmt)
        _db("UPDATE feed SET comments=? WHERE id=?", (_jdump(cmts), pid), commit=True)
        return json_response({"ok":True,"comment":cmt})

    # 博物馆点赞
    if "/api/museum/" in path and path.endswith("/like"):
        pid = int(path.split("/")[3])
        rows = _db("SELECT likedBy FROM museum WHERE id=?", (pid,))
        if not rows: return json_response({"ok":False,"msg":"不存在"},404)
        lb = _jload(rows[0][0], [])
        vis = d.get("visitor","anon")
        if vis in lb: lb.remove(vis)
        else: lb.append(vis)
        _db("UPDATE museum SET likes=?, likedBy=? WHERE id=?", (len(lb), _jdump(lb), pid), commit=True)
        return json_response({"ok":True,"likes":len(lb),"liked":vis in lb})

    # 博物馆评论
    if "/api/museum/" in path and path.endswith("/comment"):
        pid = int(path.split("/")[3])
        rows = _db("SELECT comments FROM museum WHERE id=?", (pid,))
        if not rows: return json_response({"ok":False,"msg":"不存在"},404)
        cmts = _jload(rows[0][0], [])
        cmt = {"id":_gen_id(),"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%m-%d %H:%M")}
        if not cmt["text"]: return json_response({"ok":False,"msg":"评论不能为空"},400)
        cmts.append(cmt)
        _db("UPDATE museum SET comments=? WHERE id=?", (_jdump(cmts), pid), commit=True)
        return json_response({"ok":True,"comment":cmt})

    # 故事点赞
    if "/api/stories/" in path and path.endswith("/like"):
        pid = int(path.split("/")[3])
        rows = _db("SELECT likedBy FROM stories WHERE id=?", (pid,))
        if not rows: return json_response({"ok":False,"msg":"不存在"},404)
        lb = _jload(rows[0][0], [])
        vis = d.get("visitor","anon")
        if vis in lb: lb.remove(vis)
        else: lb.append(vis)
        _db("UPDATE stories SET likes=?, likedBy=? WHERE id=?", (len(lb), _jdump(lb), pid), commit=True)
        return json_response({"ok":True,"likes":len(lb),"liked":vis in lb})

    # 故事评论
    if "/api/stories/" in path and path.endswith("/comment"):
        pid = int(path.split("/")[3])
        rows = _db("SELECT comments FROM stories WHERE id=?", (pid,))
        if not rows: return json_response({"ok":False,"msg":"不存在"},404)
        cmts = _jload(rows[0][0], [])
        cmt = {"id":_gen_id(),"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%m-%d %H:%M")}
        if not cmt["text"]: return json_response({"ok":False,"msg":"评论不能为空"},400)
        cmts.append(cmt)
        _db("UPDATE stories SET comments=? WHERE id=?", (_jdump(cmts), pid), commit=True)
        return json_response({"ok":True,"comment":cmt})

    # 烦恼博物馆发帖
    if path == "/api/museum":
        pid = _gen_id()
        _db("INSERT INTO museum VALUES (?,?,?,?,0,'[]','[]','[]')",
           (pid, d.get("author","匿名"), d.get("text",""), time.strftime("%Y-%m-%d %H:%M")), commit=True)
        return json_response({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[],"replies":[]}})

    # 故事卡片
    if path == "/api/stories":
        pid = _gen_id()
        imgs = _save_img(pid, d.get("images",[]))
        _db("INSERT INTO stories VALUES (?,?,?,?,?,0,'[]','[]',0)",
           (pid, d.get("author","匿名"), d.get("text",""), _jdump(imgs), time.strftime("%Y-%m-%d %H:%M")), commit=True)
        return json_response({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"images":["/uploads/"+f for f in imgs],"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[],"official":False}})

    return json_response({"ok":False,"msg":"接口不存在"},404)

# ========== WSGI Application ==========
def application(environ, start_response):
    method = environ.get('REQUEST_METHOD', 'GET')
    path = environ.get('PATH_INFO', '/')
    
    # CORS preflight
    if method == 'OPTIONS':
        status = '204 No Content'
        headers = cors_headers()
        start_response(status, headers)
        return [b'']
    
    # GET
    if method == 'GET':
        status_code, headers, body = handle_get(path)
        status = f"{status_code} OK" if status_code == 200 else f"{status_code} Not Found"
        if status_code != 200:
            status = f"{status_code} Not Found" if status_code == 404 else f"{status_code} Error"
        start_response(status, headers)
        return body
    
    # POST
    if method == 'POST':
        try:
            content_length = int(environ.get('CONTENT_LENGTH', 0))
            raw_body = environ['wsgi.input'].read(content_length).decode('utf-8') if content_length else '{}'
            body = json.loads(raw_body)
        except:
            body = {}
        
        status_code, headers, body = handle_post(path, body)
        status_msg = {200: 'OK', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found'}.get(status_code, 'OK')
        status = f"{status_code} {status_msg}"
        start_response(status, headers)
        return body
    
    start_response('405 Method Not Allowed', [('Content-Type', 'text/plain')])
    return [b'Method Not Allowed']

# ========== 本地开发用（PythonAnywhere 不需要） ==========
if __name__ == "__main__":
    from wsgiref.simple_server import make_server
    port = int(os.environ.get("PORT", 8768))
    print(f"🌾 麦田 WSGI 服务启动 → http://0.0.0.0:{port}")
    make_server('0.0.0.0', port, application).serve_forever()
