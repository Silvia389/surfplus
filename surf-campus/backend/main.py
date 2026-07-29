"""XJTLU Virtual Campus — 后端 API"""
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="XJTLU Virtual Campus", version="0.1.0")

# 懒加载 Agent（避免无 API Key 时启动失败）
_agent = None
def get_agent():
    global _agent
    if _agent is None:
        from agent import CampusAgent
        _agent = CampusAgent()
    return _agent

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── 数据模型 ───

class ChatRequest(BaseModel):
    session_id: str
    message: str

class ChatResponse(BaseModel):
    reply: str

# ─── 根路径 — 返回前端首页 ───

@app.get("/")
def serve_index():
    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
    return FileResponse(os.path.join(frontend_dir, "index.html"))

@app.get("/health")
def health_check():
    return {"service": "XJTLU Virtual Campus", "version": "0.1.0", "status": "running"}

# ─── AI 对话 ───

@app.post("/api/chat", response_model=ChatResponse)
def api_chat(req: ChatRequest):
    """AI 对话接口（核心入口）"""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")
    try:
        agent = get_agent()
        reply = agent.chat(session_id=req.session_id, user_message=req.message)
    except Exception as e:
        reply = f"（AI 暂时无法回应：{str(e)[:80]}）"
    return ChatResponse(reply=reply)

@app.post("/api/session/clear")
def clear_session(session_id: str):
    """清除对话历史"""
    try:
        agent = get_agent()
        agent.clear_session(session_id)
    except Exception:
        pass
    return {"status": "cleared"}

# ─── 课程与学术 ───

@app.get("/api/courses/timetable")
def get_timetable(week: str = None):
    from tools.academic import academic_center
    import json
    return json.loads(academic_center("timetable", {"week": week}))

@app.get("/api/courses/assignments")
def get_assignments(course: str = None):
    from tools.academic import academic_center
    import json
    return json.loads(academic_center("assignments", {"course": course}))

@app.get("/api/courses/exams")
def get_exam_scores():
    from tools.academic import academic_center
    import json
    return json.loads(academic_center("exam_scores"))

@app.get("/api/courses/resources")
def get_resources(keyword: str = None, course: str = None):
    from tools.academic import academic_center
    import json
    return json.loads(academic_center("resource_search", {"keyword": keyword or "", "course": course}))

@app.get("/api/courses/qa")
def get_qa(keyword: str = None):
    from tools.academic import academic_center
    import json
    return json.loads(academic_center("qa_search", {"keyword": keyword or ""}))

@app.post("/api/courses/qa")
def post_qa(course: str, question: str, anonymous: bool = False):
    from tools.academic import academic_center
    import json
    return json.loads(academic_center("qa_ask", {"course": course, "question": question, "anonymous": anonymous}))

@app.get("/api/professors")
def get_professors(keyword: str = None):
    from tools.search import _search_professors
    import json
    return json.loads(_search_professors(keyword or ""))

# ─── 社区 ───

@app.get("/api/community/feed")
def get_feed(section: str = None, page: int = 1):
    from tools.community import _get_feed
    import json
    return json.loads(_get_feed(section, page))

@app.post("/api/community/posts")
def create_post(content: str, section: str = "general", anonymous: bool = False, title: str = None):
    from tools.community import _publish_post
    import json
    return json.loads(_publish_post(content, section, anonymous, title))

@app.post("/api/community/comments")
def add_comment(post_id: str, content: str, anonymous: bool = False):
    from tools.community import _add_comment
    import json
    return json.loads(_add_comment(post_id, content, anonymous))

@app.post("/api/community/like")
def like_post(post_id: str):
    from tools.community import _like_post
    import json
    return json.loads(_like_post(post_id))

@app.post("/api/community/collect")
def collect_post(post_id: str):
    from tools.community import _collect_post
    import json
    return json.loads(_collect_post(post_id))

@app.get("/api/community/posts/{post_id}")
def get_post_detail(post_id: str):
    """获取单个帖子详情（含评论列表）"""
    from tools.community import _load_json
    import json
    data = _load_json("posts.json")
    for p in data.get("posts", []):
        if p.get("id") == post_id:
            comments = p.get("comments", [])
            return {
                "id": p.get("id", ""),
                "title": p.get("title", ""),
                "content": p.get("content", ""),
                "section": p.get("section", ""),
                "anonymous": p.get("anonymous", False),
                "time": p.get("time", ""),
                "likes": p.get("likes", 0),
                "comments_count": p.get("comments_count", 0),
                "comments": [
                    {
                        "id": c.get("id", ""),
                        "content": c.get("content", ""),
                        "anonymous": c.get("anonymous", False),
                        "time": c.get("time", ""),
                    }
                    for c in comments
                ],
            }
    raise HTTPException(status_code=404, detail="帖子未找到")

@app.post("/api/community/report")
def report_post(post_id: str, reason: str = ""):
    from tools.community import _report_post
    import json
    return json.loads(_report_post(post_id, reason))

# ─── 匿名树洞 ───

@app.get("/api/treehole/hot")
def treehole_hot():
    from tools.treehole import _treehole_hot
    import json
    return json.loads(_treehole_hot())

@app.post("/api/treehole/posts")
def treehole_post(content: str, category: str = None):
    from tools.treehole import _treehole_post
    import json
    return json.loads(_treehole_post(content, category))

@app.post("/api/treehole/comments")
def treehole_comment(post_id: str, content: str):
    from tools.treehole import _treehole_comment
    import json
    return json.loads(_treehole_comment(post_id, content))

@app.post("/api/treehole/report")
def treehole_report(post_id: str, reason: str = ""):
    from tools.treehole import _treehole_report
    import json
    return json.loads(_treehole_report(post_id, reason))

# ─── 活动与社团 ───

@app.get("/api/events")
def list_events(month: str = None):
    from tools.events import _list_events
    import json
    return json.loads(_list_events(month))

@app.post("/api/events/register")
def register_event(event_id: str):
    from tools.events import _register_event
    import json
    return json.loads(_register_event(event_id))

@app.get("/api/clubs")
def list_clubs():
    from tools.events import _list_clubs
    import json
    return json.loads(_list_clubs())

@app.get("/api/clubs/{club_id}")
def club_info(club_id: str):
    from tools.events import _club_info
    import json
    return json.loads(_club_info(club_id))

# ─── 通讯与消息 ───

@app.get("/api/directory")
def search_directory(keyword: str = ""):
    from tools.search import _search_directory
    import json
    return json.loads(_search_directory(keyword))

@app.post("/api/messaging/chat")
def start_chat(target_id: str, message: str = ""):
    from tools.messaging import _start_chat
    import json
    return json.loads(_start_chat(target_id, message))

@app.post("/api/messaging/send")
def send_message(chat_id: str, content: str):
    from tools.messaging import _send_message
    import json
    return json.loads(_send_message(chat_id, content))

@app.get("/api/messages")
def get_messages():
    from tools.messaging import _search_messages
    import json
    return json.loads(_search_messages(""))

# ─── 通知 ───

@app.get("/api/notifications")
def get_notifications(unread_only: bool = False):
    from tools.platform import _list_notifications
    import json
    return json.loads(_list_notifications(unread_only))

@app.post("/api/notifications/read")
def mark_notification_read(notification_id: str = None):
    from tools.platform import _mark_read
    import json
    return json.loads(_mark_read(notification_id))

# ─── 全局搜索 ───

@app.get("/api/search")
def global_search(keyword: str, category: str = None):
    """全局搜索：跨课程、教授、活动、帖子搜索"""
    from tools.search import search_info
    import json
    if category:
        return json.loads(search_info(category, keyword))
    # 跨所有类别搜索
    results = {}
    for cat in ["course", "professor", "event", "post"]:
        try:
            r = json.loads(search_info(cat, keyword))
            if "message" not in r:
                results[cat] = r
        except:
            pass
    return results

# ─── 静态文件挂载（必须放在所有路由之后）───

_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=_frontend_dir), name="frontend")

# ─── 启动 ───

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
