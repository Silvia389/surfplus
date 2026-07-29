"""社团与活动工具"""
import json
import time
from . import _load_json, _save_json


def clubs_events(action: str, params: dict = None) -> str:
    """社团与活动相关操作"""
    if params is None:
        params = {}

    if action == "list_clubs":
        return _list_clubs()
    elif action == "club_info":
        return _club_info(params.get("club_id", ""))
    elif action == "list_events":
        return _list_events(params.get("month"))
    elif action == "register_event":
        return _register_event(params.get("event_id", ""))
    else:
        return json.dumps({"error": f"未知操作: {action}"})


def _list_clubs():
    data = _load_json("events.json")
    clubs = data.get("clubs", [])
    results = []
    for c in clubs:
        results.append({
            "id": c.get("id", ""),
            "名称": c["name"],
            "描述": c.get("description", ""),
            "成员数": c.get("members", 0),
        })
    if not results:
        return json.dumps({"message": "暂无社团数据"})
    return json.dumps(results, ensure_ascii=False, indent=2)


def _club_info(club_id):
    data = _load_json("events.json")
    for c in data.get("clubs", []):
        if c.get("id") == club_id or c.get("name") == club_id:
            return json.dumps(c, ensure_ascii=False, indent=2)
    return json.dumps({"message": "社团未找到"})


def _list_events(month=None):
    data = _load_json("events.json")
    events = data.get("events", [])
    results = []
    for e in events:
        if month and month not in e.get("time", ""):
            continue
        results.append({
            "id": e.get("id", ""),
            "活动": e["title"],
            "时间": e.get("time", ""),
            "地点": e.get("location", ""),
            "组织": e.get("organizer", ""),
            "报名": e.get("registered", 0),
        })
    if not results:
        return json.dumps({"message": "暂无可报名的活动"})
    return json.dumps(results[:10], ensure_ascii=False, indent=2)


def _register_event(event_id):
    data = _load_json("events.json")
    events = data.get("events", [])
    for e in events:
        if e.get("id") == event_id:
            e["registered"] = e.get("registered", 0) + 1
            _save_json("events.json", data)
            # 写入通知（带活动时间，用于动态倒计时）
            msg_data = _load_json("messages.json")
            notifs = msg_data.get("notifications", [])
            notif = {
                "id": f"notif_evt_{event_id}_{int(time.time())}",
                "type": "event",
                "event_id": event_id,
                "event_title": e["title"],
                "event_time": e.get("time", ""),
                "content": f"你已报名「{e['title']}」，活动时间：{e.get('time', '待定')}",
                "time": time.strftime("%Y-%m-%d %H:%M"),
                "read": False,
            }
            notifs.insert(0, notif)
            msg_data["notifications"] = notifs
            _save_json("messages.json", msg_data)
            return json.dumps({"status": "ok", "message": f"已成功报名「{e['title']}」！"}, ensure_ascii=False)
    return json.dumps({"error": "活动未找到"}, ensure_ascii=False)


# ─── 工具定义 ───

CLUBS_TOOL = {
    "type": "function",
    "function": {
        "name": "clubs_events",
        "description": "社团与活动：查看社团列表、社团详情、活动日历、报名活动",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["list_clubs", "club_info", "list_events", "register_event"],
                },
                "params": {
                    "type": "object",
                    "properties": {
                        "club_id": {"type": "string"},
                        "month": {"type": "string"},
                        "event_id": {"type": "string"},
                    },
                },
            },
            "required": ["action"],
        },
    },
}
