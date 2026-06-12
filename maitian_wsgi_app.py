#!/usr/bin/env python3
"""
maitian_wsgi_app.py — 麦田 Flask WSGI 应用（适配 PythonAnywhere）
部署到 PythonAnywhere 的 WSGI 文件里导入此模块:
  from maitian_wsgi_app import app as application
"""
import json, os, base64, time, hashlib, sqlite3, mimetypes
from pathlib import Path
from flask import Flask, request, jsonify, send_file

app = Flask(__name__)
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

def user_row(r, cols):
    u = dict(zip(cols, r))
    u["password"] = "***"
    for k in ["badges","taskJoined","taskDone","exchanges","history","likedBy"]:
        if k in u: u[k] = jload(u[k], [])
    if "comments" in u: u["comments"] = jload(u.get("comments","[]"), [])
    if "images" in u: u["images"] = ["/uploads/"+f for f in jload(u.get("images","[]"), [])]
    if "replies" in u: u["replies"] = jload(u.get("replies","[]"), [])
    if "official" in u: u["official"] = bool(u.get("official", 0))
    return u

# ========== 静态文件 & 页面 ==========
@app.route("/")
@app.route("/index.html")
def index():
    return send_file(BASE_DIR / "index.html")

@app.route("/maitian-<path:filename>")
def maitian_assets(filename):
    p = BASE_DIR / f"maitian-{filename}"
    if p.exists():
        return send_file(p)
    return "Not found", 404

@app.route("/images-web/<path:filename>")
def images_web(filename):
    p = BASE_DIR / "images-web" / filename
    if p.exists():
        return send_file(p)
    return "Not found", 404

@app.route("/uploads/<filename>")
def uploads_file(filename):
    p = UPLOAD_DIR / filename
    if p.exists():
        return send_file(p)
    return "Not found", 404

# ========== API: 用户 ==========
@app.route("/api/users", methods=["GET"])
def api_users_list():
    cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
    rows = db("SELECT * FROM users")
    return jsonify([user_row(r, cols) for r in rows])

@app.route("/api/users/register", methods=["POST"])
def api_register():
    d = request.get_json(force=True, silent=True) or {}
    nick = (d.get("nickname") or "").strip()
    pwd = (d.get("password") or "").strip()
    if len(nick) < 2: return jsonify({"ok":False,"msg":"昵称至少2个字"}), 400
    if len(pwd) < 4: return jsonify({"ok":False,"msg":"密码至少4位"}), 400
    if db("SELECT 1 FROM users WHERE nickname = ?", (nick,)):
        return jsonify({"ok":False,"msg":"昵称已存在"}), 400
    db("INSERT INTO users VALUES (?,?,?,?,0,'[]','[]','[]','[]','[]',?)",
       (nick, pw_hash(pwd), d.get("avatar","😊"), d.get("bio",""), gen_id()), commit=True)
    return jsonify({"ok":True,"user":{"nickname":nick,"avatar":d.get("avatar","😊"),"bio":"","points":0,"badges":[],"taskJoined":[],"taskDone":[],"exchanges":[],"history":[]}})

@app.route("/api/users/login", methods=["POST"])
def api_login():
    d = request.get_json(force=True, silent=True) or {}
    nick = (d.get("nickname") or "").strip()
    pwd = (d.get("password") or "").strip()
    cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
    rows = db("SELECT * FROM users WHERE nickname = ?", (nick,))
    if not rows: return jsonify({"ok":False,"msg":"用户不存在"}), 404
    u = user_row(rows[0], cols)
    if rows[0][1] != pw_hash(pwd): return jsonify({"ok":False,"msg":"密码错误"}), 401
    return jsonify({"ok":True,"user":u})

@app.route("/api/users/update", methods=["POST"])
def api_update_user():
    d = request.get_json(force=True, silent=True) or {}
    nick = (d.get("nickname") or "").strip()
    for k in ["avatar","bio","points","badges","taskJoined","taskDone","exchanges","history"]:
        if k in d:
            v = jdump(d[k]) if isinstance(d[k], (list,dict)) else d[k]
            db(f"UPDATE users SET {k}=? WHERE nickname=?", (v, nick), commit=True)
    cols = ["nickname","password","avatar","bio","points","badges","taskJoined","taskDone","exchanges","history","created"]
    rows = db("SELECT * FROM users WHERE nickname = ?", (nick,))
    if not rows: return jsonify({"ok":False,"msg":"用户不存在"}), 404
    return jsonify({"ok":True,"user":user_row(rows[0], cols)})

# ========== API: 动态 ==========
@app.route("/api/feed", methods=["GET"])
def api_feed_list():
    rows = db("SELECT id,author,text,images,time,likes,likedBy,comments FROM feed ORDER BY id DESC")
    return jsonify([{"id":r[0],"author":r[1],"text":r[2],"images":["/uploads/"+f for f in jload(r[3],[])],"time":r[4],"likes":r[5],"likedBy":jload(r[6],[]),"comments":jload(r[7],[])} for r in rows])

@app.route("/api/feed", methods=["POST"])
def api_feed_post():
    d = request.get_json(force=True, silent=True) or {}
    pid = gen_id()
    imgs = save_img(pid, d.get("images",[]))
    db("INSERT INTO feed VALUES (?,?,?,?,?,0,'[]','[]')",
       (pid, d.get("author","匿名"), d.get("text",""), jdump(imgs), time.strftime("%Y-%m-%d %H:%M")), commit=True)
    return jsonify({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"images":["/uploads/"+f for f in imgs],"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[]}})

@app.route("/api/feed/<int:pid>/like", methods=["POST"])
def api_feed_like(pid):
    d = request.get_json(force=True, silent=True) or {}
    rows = db("SELECT likedBy FROM feed WHERE id=?", (pid,))
    if not rows: return jsonify({"ok":False,"msg":"不存在"}), 404
    lb = jload(rows[0][0], [])
    vis = d.get("visitor","anon")
    if vis in lb: lb.remove(vis)
    else: lb.append(vis)
    db("UPDATE feed SET likes=?, likedBy=? WHERE id=?", (len(lb), jdump(lb), pid), commit=True)
    return jsonify({"ok":True,"likes":len(lb),"liked":vis in lb})

@app.route("/api/feed/<int:pid>/comment", methods=["POST"])
def api_feed_comment(pid):
    d = request.get_json(force=True, silent=True) or {}
    rows = db("SELECT comments FROM feed WHERE id=?", (pid,))
    if not rows: return jsonify({"ok":False,"msg":"不存在"}), 404
    cmts = jload(rows[0][0], [])
    cmt = {"id":gen_id(),"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%m-%d %H:%M")}
    if not cmt["text"]: return jsonify({"ok":False,"msg":"评论不能为空"}), 400
    cmts.append(cmt)
    db("UPDATE feed SET comments=? WHERE id=?", (jdump(cmts), pid), commit=True)
    return jsonify({"ok":True,"comment":cmt})

# ========== API: 烦恼博物馆 ==========
@app.route("/api/museum", methods=["GET"])
def api_museum_list():
    rows = db("SELECT id,author,text,time,likes,likedBy,comments,replies FROM museum ORDER BY id DESC")
    return jsonify([{"id":r[0],"author":r[1],"text":r[2],"time":r[3],"likes":r[4],"likedBy":jload(r[5],[]),"comments":jload(r[6],[]),"replies":jload(r[7],[])} for r in rows])

@app.route("/api/museum", methods=["POST"])
def api_museum_post():
    d = request.get_json(force=True, silent=True) or {}
    pid = gen_id()
    db("INSERT INTO museum VALUES (?,?,?,?,0,'[]','[]','[]')",
       (pid, d.get("author","匿名"), d.get("text",""), time.strftime("%Y-%m-%d %H:%M")), commit=True)
    return jsonify({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[],"replies":[]}})

@app.route("/api/museum/<int:pid>/like", methods=["POST"])
def api_museum_like(pid):
    d = request.get_json(force=True, silent=True) or {}
    rows = db("SELECT likedBy FROM museum WHERE id=?", (pid,))
    if not rows: return jsonify({"ok":False,"msg":"不存在"}), 404
    lb = jload(rows[0][0], [])
    vis = d.get("visitor","anon")
    if vis in lb: lb.remove(vis)
    else: lb.append(vis)
    db("UPDATE museum SET likes=?, likedBy=? WHERE id=?", (len(lb), jdump(lb), pid), commit=True)
    return jsonify({"ok":True,"likes":len(lb),"liked":vis in lb})

@app.route("/api/museum/<int:pid>/comment", methods=["POST"])
def api_museum_comment(pid):
    d = request.get_json(force=True, silent=True) or {}
    rows = db("SELECT comments FROM museum WHERE id=?", (pid,))
    if not rows: return jsonify({"ok":False,"msg":"不存在"}), 404
    cmts = jload(rows[0][0], [])
    cmt = {"id":gen_id(),"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%m-%d %H:%M")}
    if not cmt["text"]: return jsonify({"ok":False,"msg":"评论不能为空"}), 400
    cmts.append(cmt)
    db("UPDATE museum SET comments=? WHERE id=?", (jdump(cmts), pid), commit=True)
    return jsonify({"ok":True,"comment":cmt})

# ========== API: 故事卡片 ==========
@app.route("/api/stories", methods=["GET"])
def api_stories_list():
    rows = db("SELECT id,author,text,images,time,likes,likedBy,comments,official FROM stories ORDER BY id DESC")
    return jsonify([{"id":r[0],"author":r[1],"text":r[2],"images":["/uploads/"+f for f in jload(r[3],[])],"time":r[4],"likes":r[5],"likedBy":jload(r[6],[]),"comments":jload(r[7],[]),"official":bool(r[8])} for r in rows])

@app.route("/api/stories", methods=["POST"])
def api_stories_post():
    d = request.get_json(force=True, silent=True) or {}
    pid = gen_id()
    imgs = save_img(pid, d.get("images",[]))
    db("INSERT INTO stories VALUES (?,?,?,?,?,0,'[]','[]',0)",
       (pid, d.get("author","匿名"), d.get("text",""), jdump(imgs), time.strftime("%Y-%m-%d %H:%M")), commit=True)
    return jsonify({"ok":True,"post":{"id":pid,"author":d.get("author","匿名"),"text":d.get("text",""),"images":["/uploads/"+f for f in imgs],"time":time.strftime("%Y-%m-%d %H:%M"),"likes":0,"likedBy":[],"comments":[],"official":False}})

@app.route("/api/stories/<int:pid>/like", methods=["POST"])
def api_stories_like(pid):
    d = request.get_json(force=True, silent=True) or {}
    rows = db("SELECT likedBy FROM stories WHERE id=?", (pid,))
    if not rows: return jsonify({"ok":False,"msg":"不存在"}), 404
    lb = jload(rows[0][0], [])
    vis = d.get("visitor","anon")
    if vis in lb: lb.remove(vis)
    else: lb.append(vis)
    db("UPDATE stories SET likes=?, likedBy=? WHERE id=?", (len(lb), jdump(lb), pid), commit=True)
    return jsonify({"ok":True,"likes":len(lb),"liked":vis in lb})

@app.route("/api/stories/<int:pid>/comment", methods=["POST"])
def api_stories_comment(pid):
    d = request.get_json(force=True, silent=True) or {}
    rows = db("SELECT comments FROM stories WHERE id=?", (pid,))
    if not rows: return jsonify({"ok":False,"msg":"不存在"}), 404
    cmts = jload(rows[0][0], [])
    cmt = {"id":gen_id(),"author":d.get("author","匿名"),"text":d.get("text",""),"time":time.strftime("%m-%d %H:%M")}
    if not cmt["text"]: return jsonify({"ok":False,"msg":"评论不能为空"}), 400
    cmts.append(cmt)
    db("UPDATE stories SET comments=? WHERE id=?", (jdump(cmts), pid), commit=True)
    return jsonify({"ok":True,"comment":cmt})

# ========== CORS 全局支持 ==========
@app.after_request
def add_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

# WSGI 入口
application = app
