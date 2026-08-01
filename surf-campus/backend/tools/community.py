"""社区内容工具"""
import json
import re
import time
from typing import Optional
from . import _load_json, _save_json


def community(action: str, params: dict = None) -> str:
    """社区内容相关操作"""
    if params is None:
        params = {}

    if action == "feed":
        return _get_feed(params.get("section"), params.get("page", 1))
    elif action == "publish_post":
        return _publish_post(
            params.get("content", ""),
            params.get("section", "general"),
            params.get("anonymous", False),
            params.get("title"),
        )
    elif action == "comment":
        return _add_comment(params.get("post_id", ""), params.get("content", ""), params.get("anonymous", False))
    elif action == "like":
        return _like_post(params.get("post_id", ""))
    elif action == "collect":
        return _collect_post(params.get("post_id", ""))
    elif action == "report":
        return _report_post(params.get("post_id", ""), params.get("reason", ""))
    else:
        return json.dumps({"error": f"未知操作: {action}"})


ALLOWED_SECTIONS = {"academic", "campus-life", "opportunities", "teams", "treehole"}
AI_MENTION_RE = re.compile(r"(?<![\w@])@ai\b", re.IGNORECASE)


def _ai_mention_count(value):
    """Count explicit @AI mentions while avoiding email-like strings."""
    return len(AI_MENTION_RE.findall(str(value or "")))


def _normalize_tags(tags):
    normalized = []
    for raw_tag in tags or []:
        tag = " ".join(str(raw_tag).strip().lstrip("#").split())[:24]
        if tag and tag.casefold() not in {item.casefold() for item in normalized}:
            normalized.append(tag)
    return normalized[:5]


def _get_feed(section=None, page=1):
    data = _load_json("posts.json")
    collection_data = _load_json("collections.json")
    collections = set(collection_data.get("collections", []))
    collection_tags = collection_data.get("tags", {})
    likes_by_user = _load_json("likes.json").get("users", {})
    liked_posts = set(likes_by_user.get("u001", []))
    posts = data.get("posts", [])

    posts = [p for p in posts if p.get("status", "published") == "published" and p.get("section") != "treehole"]

    if section:
        posts = [p for p in posts if p.get("section") == section]

    # 分页
    page_size = 10
    start = (page - 1) * page_size
    end = start + page_size
    page_posts = posts[start:end]

    results = []
    for p in page_posts:
        results.append({
            "id": p.get("id", ""),
            "title": p.get("title", ""),
            "content": p.get("content", ""),
            "section": p.get("section", "campus-life"),
            "anonymous": p.get("anonymous", False),
            "author": p.get("author", "校园成员"),
            "time": p.get("time", ""),
            "likes": p.get("likes", 0),
            "liked": p.get("id", "") in liked_posts,
            "comments_count": p.get("comments_count", 0),
            "tags": p.get("tags", []),
            "media": p.get("media", []),
            "status": p.get("status", "published"),
            "collected": p.get("id", "") in collections,
            "collection_tags": collection_tags.get(p.get("id", ""), []),
        })

    return json.dumps({
        "page": page,
        "total": len(posts),
        "posts": results,
    }, ensure_ascii=False, indent=2)


def _publish_post(content, section="campus-life", anonymous=False, title=None, tags=None, media=None, status="pending"):
    if not content.strip():
        return json.dumps({"error": "内容不能为空"})

    section = section if section in ALLOWED_SECTIONS else "campus-life"
    normalized_tags = _normalize_tags(tags)
    ai_mention_count = _ai_mention_count(content)
    data = _load_json("posts.json")
    posts = data.get("posts", [])
    new_post = {
        "id": f"post_{int(time.time())}_{len(posts)}",
        "title": title or "",
        "content": content,
        "section": section,
        "anonymous": anonymous,
        "author": "匿名同学" if anonymous else "张三",
        "time": time.strftime("%Y-%m-%d %H:%M"),
        "likes": 0,
        "comments_count": 0,
        "comments": [],
        "tags": normalized_tags,
        "media": media or [],
        "status": status,
        "moderation_note": "",
        "ai_mention_count": ai_mention_count,
        "ai_status": "requested" if ai_mention_count else "none",
    }
    posts.insert(0, new_post)
    _save_json("posts.json", {"posts": posts})

    return json.dumps({
        "status": "ok",
        "message": "内容已提交审核" + ("（前台将保持匿名）" if anonymous else ""),
        "post_id": new_post["id"],
        "status": status,
    }, ensure_ascii=False)


def _add_comment(post_id, content, anonymous=False):
    if not content.strip():
        return json.dumps({"error": "评论内容不能为空"})
    data = _load_json("posts.json")
    posts = data.get("posts", [])
    for p in posts:
        if p.get("id") == post_id:
            comment = {
                "id": f"cmt_{int(time.time())}",
                "content": content,
                "anonymous": anonymous,
                "time": time.strftime("%Y-%m-%d %H:%M"),
                "ai_mention_count": _ai_mention_count(content),
                "ai_status": "requested" if _ai_mention_count(content) else "none",
            }
            p.setdefault("comments", []).append(comment)
            p["comments_count"] = len(p["comments"])
            _save_json("posts.json", {"posts": posts})
            return json.dumps({
                "status": "ok",
                "message": "评论成功",
                "comment_id": comment["id"],
                "ai_requested": bool(comment["ai_mention_count"]),
            })
    return json.dumps({"error": "帖子未找到"})


def _like_post(post_id, user_id="u001"):
    data = _load_json("posts.json")
    posts = data.get("posts", [])
    likes_data = _load_json("likes.json") or {"users": {}}
    user_likes = likes_data.setdefault("users", {}).setdefault(user_id, [])
    for p in posts:
        if p.get("id") == post_id:
            if post_id in user_likes:
                user_likes.remove(post_id)
                p["likes"] = max(0, p.get("likes", 0) - 1)
                liked = False
            else:
                user_likes.append(post_id)
                p["likes"] = p.get("likes", 0) + 1
                liked = True
            _save_json("posts.json", {"posts": posts})
            _save_json("likes.json", likes_data)
            return json.dumps({"status": "ok", "likes": p["likes"], "liked": liked})
    return json.dumps({"error": "帖子未找到"})


def _collect_post(post_id, tag=""):
    data = _load_json("posts.json")
    if not any(p.get("id") == post_id and p.get("status", "published") == "published" and p.get("section") != "treehole" for p in data.get("posts", [])):
        return json.dumps({"error": "帖子未找到或不可收藏"}, ensure_ascii=False)
    collection_data = _load_json("collections.json") or {"collections": []}
    collections = collection_data.setdefault("collections", [])
    tags_by_post = collection_data.setdefault("tags", {})
    clean_tag = " ".join(str(tag or "").strip().lstrip("#").split())[:24]
    if clean_tag:
        if post_id not in collections:
            collections.insert(0, post_id)
        tags = tags_by_post.setdefault(post_id, [])
        if clean_tag.casefold() not in {item.casefold() for item in tags}:
            tags.append(clean_tag)
        collected = True
    elif post_id in collections:
        collections.remove(post_id)
        tags_by_post.pop(post_id, None)
        collected = False
    else:
        collections.insert(0, post_id)
        collected = True
    _save_json("collections.json", collection_data)
    return json.dumps({"status": "ok", "collected": collected, "tags": tags_by_post.get(post_id, []), "message": f"已收藏到 #{clean_tag}" if clean_tag else ("已收藏" if collected else "已取消收藏")}, ensure_ascii=False)


def _report_post(post_id, reason):
    return json.dumps({"status": "ok", "message": "举报已收到，管理员会尽快处理"})


# ─── 工具定义 ───

COMMUNITY_TOOL = {
    "type": "function",
    "function": {
        "name": "community",
        "description": "社区内容：浏览信息流、发布帖子、评论、点赞、收藏、举报",
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["feed", "publish_post", "comment", "like", "collect", "report"],
                },
                "params": {
                    "type": "object",
                    "properties": {
                        "section": {"type": "string"},
                        "page": {"type": "integer"},
                        "title": {"type": "string"},
                        "content": {"type": "string"},
                        "anonymous": {"type": "boolean"},
                        "post_id": {"type": "string"},
                        "reason": {"type": "string"},
                    },
                },
            },
            "required": ["action"],
        },
    },
}
