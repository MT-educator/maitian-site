#!/usr/bin/env python3
"""
maitian-all-in-one.py — 麦田完整服务（前后端一体）
  同时提供前端页面 + API 接口
部署: 上传到 Render.com 或任何 Python 云平台
端口: 从环境变量 PORT 读取
用法: python3 maitian-all-in-one.py
"""

import json, os, base64, time, hashlib, sqlite3, mimetypes
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

PORT = int(os.environ.get("PORT", 8768))
BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"

UPLOAD_DIR.mkdir(exist_ok=True)

# ========== 数据库初始化 ==========
DB_PATH = BASE_DIR / "maitian.db"

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
def db(q, params=(), commit=False):
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

def jload(s, d=None):
    try: return json.loads(s)
    except: return d if d is not None else []

def jdump(v):
    return json.dumps(v, ensure_ascii=False)

def pw_hash(p):
    return hashlib.sha256(p.encode()).hexdigest()

def gen_id():
    return int(time.time() * 1000)

def save_img(post_id, imgs):
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

class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        if str(a[1]) not in ("200", "204"):
            super().log_message(*a)

    def _j(self, d, s=200):
        b = json.dumps(d, ensure_ascii=False).encode()
        self.send_response(s)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", len(b))
        self.end_headers()
        self.wfile.write(b)

    def _f(self, path):
        if not path.exists():
            self.send_response(404); self.end_headers(); return
        mime, _ = mimetypes.guess_type(str(path))
        self.send_response(200)
        self.send_header("Content-Type", mime or "application/octet-stream")
        self.send_header("Content-Length", path.stat().st_size)
        self.end_headers()
        self.wfile.write(path.read_bytes())

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _body(self):
        n = int(self.headers.get("Content-Length", 0))
        return json.loads(self.rfile.read(n).decode()) if n else {}

    # ========= GET =========
    def do_GET(self):
        p = self.path.split("?")[0]

        # 静态文件
        if p == "/" or p == "/index.html":
            self._f(BASE_DIR / "index.html"); return
        if p.startswith("/maitian-"):
            self._f(BASE_DIR / p[1:]); return
        if p.startswith("/images-web/"):
            self._f(BASE_DIR / p[1:]); return
        if p.startswith("/uploads/"):
            self._f(UPLOAD_DIR / p.split("/")[-1]); return

        # API
        if p == "/api/users":
            rows = db("SELECT * FROM users")
            cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
            self._j([{**dict(zip(cols, r)), "password": "***"} for r in rows]); return

        if p == "/api/feed":
            rows = db("SELECT id,author,text,images,time,likes,likedBy,comments FROM feed ORDER BY id DESC")
            self._j([{"id":r[0],"author":r[1],"text":r[2],"images":["/uploads/"+f for f in jload(r[3],[])],"time":r[4],"likes":r[5],"likedBy":jload(r[6],[]),"comments":jload(r[7],[])} for r in rows]); return

        if p == "/api/museum":
            rows = db("SELECT id,author,text,time,likes,likedBy,comments,replies FROM museum ORDER BY id DESC")
            self._j([{"id":r[0],"author":r[1],"text":r[2],"time":r[3],"likes":r[4],"likedBy":jload(r[5],[]),"comments":jload(r[6],[]),"replies":jload(r[7],[])} for r in rows]); return

        if p == "/api/stories":
            rows = db("SELECT id,author,text,images,time,likes,likedBy,comments,official FROM stories ORDER BY id DESC")
            self._j([{"id":r[0],"author":r[1],"text":r[2],"images":["/uploads/"+f for f in jload(r[3],[])],"time":r[4],"likes":r[5],"likedBy":jload(r[6],[]),"comments":jload(r[7],[]),"official":bool(r[8])} for r in rows]); return

        self.send_response(404); self.end_headers()

    # ========= POST =========
    def do_POST(self):
        p = self.path.split("?")[0]
        d = self._body()

        # 注册
        if p == "/api/users/register":
            nick = (d.get("nickname") or "").strip()
            pwd = (d.get("password") or "").strip()
            if len(nick) < 2: self._j({"ok":False,"msg":"昵称至少2个字"},400); return
            if len(pwd) < 4: self._j({"ok":False,"msg":"密码至少4位"},400); return
            if db("SELECT 1 FROM users WHERE nickname = ?", (nick,)):
                self._j({"ok":False,"msg":"昵称已存在"},400); return
            db("INSERT INTO users VALUES (?,?,?,?,0,'[]','[]','[]','[]','[]',?)",
               (nick, pw_hash(pwd), d.get("avatar","😊"), d.get("bio",""), gen_id()), commit=True)
            self._j({"ok":True,"user":{"nickname":nick,"avatar":d.get("avatar","😊"),"bio":"","points":0,"badges":[],"taskJoined":[],"taskDone":[],"exchanges":[],"history":[]}}); return

        # 登录
        if p == "/api/users/login":
            nick = (d.get("nickname") or "").strip()
            pwd = (d.get("password") or "").strip()
            rows = db("SELECT * FROM users WHERE nickname = ?", (nick,))
            if not rows: self._j({"ok":False,"msg":"用户不存在"},404); return
            cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
            u = dict(zip(cols, rows[0]))
            if u["password"] != pw_hash(pwd): self._j({"ok":False,"msg":"密码错误"},401); return
            u["password"] = "***"
            for k in ["badges","taskJoined","taskDone","exchanges","history"]:
                u[k] = jload(u[k], [])
            self._j({"ok":True,"user":u}); return

        # 更新用户
        if p == "/api/users/update":
            nick = (d.get("nickname") or "").strip()
            for k in ["avatar","bio","points","badges","taskJoined","taskDone","exchanges","history"]:
                if k in d:
                    v = jdump(d[k]) if isinstance(d[k], (list,dict)) else d[k]
                    db(f"UPDATE users SET {k}=? WHERE nickname=?", (v, nick), commit=True)
            rows = db("SELECT * FROM users WHERE nickname = ?", (nick,))
            cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
            u = dict(zip(cols, rows[0]))
            u["password"] = "***"
            for k in ["badges","taskJoined","taskDone","exchanges","history"]:
                u[k] = jload(u[k], [])
            self._j({"ok":True,"user":u}); return

        # 发动态
        if p == "/api/feed":
            pid = gen_id()
            imgs = save_img(pid, d.get("images",[]))
            db("INSERT INTO feed VALUES (?,?,?,?,?,0,'[]','[]')",
               (pid, d.get("author","匿名"), d.get("text",""), jdump(imgs), time.strftime("%Y-%m-%d %H:%M")), commit=True)
            self._j({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"images":["/uploads/"+f for f in imgs],"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[]}}); return

        # 动态点赞
        if "/api/feed/" in p and p.endswith("/like"):
            pid = int(p.split("/")[3])
            rows = db("SELECT likedBy FROM feed WHERE id=?", (pid,))
            if not rows: self._j({"ok":False,"msg":"不存在"},404); return
            lb = jload(rows[0][0], [])
            vis = d.get("visitor","anon")
            if vis in lb: lb.remove(vis)
            else: lb.append(vis)
            db("UPDATE feed SET likes=?, likedBy=? WHERE id=?", (len(lb), jdump(lb), pid), commit=True)
            self._j({"ok":True,"likes":len(lb),"liked":vis in lb}); return

        # 动态评论
        if "/api/feed/" in p and p.endswith("/comment"):
            pid = int(p.split("/")[3])
            rows = db("SELECT comments FROM feed WHERE id=?", (pid,))
            if not rows: self._j({"ok":False,"msg":"不存在"},404); return
            cmts = jload(rows[0][0], [])
            cmt = {"id":gen_id(),"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%m-%d %H:%M")}
            if not cmt["text"]: self._j({"ok":False,"msg":"评论不能为空"},400); return
            cmts.append(cmt)
            db("UPDATE feed SET comments=? WHERE id=?", (jdump(cmts), pid), commit=True)
            self._j({"ok":True,"comment":cmt}); return

        # 烦恼博物馆发帖
        if p == "/api/museum":
            pid = gen_id()
            db("INSERT INTO museum VALUES (?,?,?,?,0,'[]','[]','[]')",
               (pid, d.get("author","匿名"), d.get("text",""), time.strftime("%Y-%m-%d %H:%M")), commit=True)
            self._j({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[],"replies":[]}}); return

        # 故事卡片
        if p == "/api/stories":
            pid = gen_id()
            imgs = save_img(pid, d.get("images",[]))
            db("INSERT INTO stories VALUES (?,?,?,?,?,0,'[]','[]',0)",
               (pid, d.get("author","匿名"), d.get("text",""), jdump(imgs), time.strftime("%Y-%m-%d %H:%M")), commit=True)
            self._j({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"images":["/uploads/"+f for f in imgs],"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[],"official":False}}); return

        self._j({"ok":False,"msg":"接口不存在"},404)

if __name__ == "__main__":
    print(f"🌾 麦田服务启动 → http://0.0.0.0:{PORT}")
    HTTPServer(("0.0.0.0", PORT), H).serve_forever()
