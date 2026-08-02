"""XJTLU Virtual Campus — 后端 API"""
import base64
from collections import deque
from email.message import EmailMessage
import hashlib
import secrets
import json
import logging
import os
import re
import smtplib
import threading
import time
import uuid
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request as URLRequest, urlopen
from pathlib import Path
from typing import Any, Optional

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from dotenv import load_dotenv
import uvicorn

app = FastAPI(title="XJTLU Virtual Campus", version="0.1.0")

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")
DATA_DIR = Path(os.environ.get("SURF_DATA_DIR", str(BASE_DIR / "data"))).resolve()
UPLOAD_DIR = Path(os.environ.get("SURF_UPLOAD_DIR", str(BASE_DIR / "uploads"))).resolve()
UPLOAD_DIR.mkdir(exist_ok=True)
RESOURCE_FILE_DIR = Path(os.environ.get("SURF_RESOURCE_FILE_DIR", str(BASE_DIR / "resource_files"))).resolve()
RESOURCE_FILE_DIR.mkdir(exist_ok=True)

SECTION_LABELS = {
    "academic": "学术",
    "campus-life": "校园生活",
    "opportunities": "活动与机会",
    "teams": "组队与项目",
}
ADMIN_ROLES = {"platform_admin", "moderator", "teacher", "organizer"}
WRITE_ROLES = {"platform_admin", "moderator"}
REQUEST_LOG_LIMIT = 200
REQUEST_LOG = deque(maxlen=REQUEST_LOG_LIMIT)
REQUEST_LOG_LOCK = threading.Lock()
REQUEST_STATS = {"started_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "requests": 0, "errors": 0, "total_ms": 0.0, "max_ms": 0.0}
request_logger = logging.getLogger("surf.request")
VERIFICATION_CODES: dict[str, dict[str, Any]] = {}
VERIFICATION_CODES_LOCK = threading.Lock()


def read_data(filename: str, fallback: dict) -> dict:
    path = DATA_DIR / filename
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_data(filename: str, data: dict) -> None:
    path = DATA_DIR / filename
    temporary = path.with_suffix(path.suffix + ".tmp")
    with temporary.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
    temporary.replace(path)


def audit(actor_role: str, action: str, target_type: str, target_id: str, detail: str = "") -> None:
    data = read_data("audit.json", {"records": []})
    data["records"].insert(0, {
        "id": f"audit_{uuid.uuid4().hex[:10]}",
        "time": time.strftime("%Y-%m-%d %H:%M:%S"),
        "actor_role": actor_role,
        "action": action,
        "target_type": target_type,
        "target_id": target_id,
        "detail": detail,
    })
    write_data("audit.json", data)


def current_admin_role(x_admin_role: str = Header(default="student")) -> str:
    if x_admin_role not in ADMIN_ROLES:
        raise HTTPException(status_code=403, detail="当前角色无权访问管理端")
    return x_admin_role


def moderation_role(role: str = Depends(current_admin_role)) -> str:
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="当前角色只有查看权限")
    return role


def learning_write_role(role: str = Depends(current_admin_role)) -> str:
    if role not in {"platform_admin", "teacher"}:
        raise HTTPException(status_code=403, detail="当前角色无权维护课程内容")
    return role


def event_write_role(role: str = Depends(current_admin_role)) -> str:
    if role not in {"platform_admin", "organizer"}:
        raise HTTPException(status_code=403, detail="当前角色无权维护活动")
    return role


def opportunity_write_role(role: str = Depends(current_admin_role)) -> str:
    if role not in {"platform_admin", "organizer", "teacher"}:
        raise HTTPException(status_code=403, detail="当前角色无权维护项目招募")
    return role


def current_auth_session() -> dict:
    return read_data("auth.json", {}).get("session", {
        "phone_authenticated": False,
        "email_authenticated": False,
        "phone_masked": "",
        "campus_verified": False,
        "user_id": "",
        "name": "",
        "campus_account": "",
    })


def auth_data() -> dict:
    data = read_data("auth.json", {})
    data.setdefault("session", current_auth_session())
    data.setdefault("accounts", [])
    return data


def save_auth_session(session: dict) -> None:
    data = auth_data()
    data["session"] = session
    write_data("auth.json", data)


def password_digest(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 180_000).hex()


def valid_email(email: str) -> bool:
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email))


def aliyun_sms_configured() -> bool:
    return os.environ.get("SURF_SMS_PROVIDER", "mock").strip().lower() == "aliyun"


def aliyun_exception_detail(exc: Exception) -> str:
    """Expose a safe provider error without leaking credentials or SDK internals."""
    code = str(getattr(exc, "code", "") or "").strip()
    message = str(getattr(exc, "message", "") or "").strip()
    request_id = str(getattr(exc, "request_id", "") or "").strip()
    if code or message:
        detail = f"阿里云错误 {code or 'Unknown'}：{message or '请求失败'}"
        return f"{detail}（RequestId: {request_id}）" if request_id else detail
    return "阿里云短信服务暂时不可用，请稍后重试"


def aliyun_sms_client():
    try:
        from alibabacloud_dypnsapi20170525.client import Client
        from alibabacloud_tea_openapi.models import Config
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="未安装阿里云号码认证 SDK，请先安装后端依赖") from exc
    access_key_id = os.environ.get("ALIYUN_ACCESS_KEY_ID", "").strip()
    access_key_secret = os.environ.get("ALIYUN_ACCESS_KEY_SECRET", "").strip()
    if not access_key_id or not access_key_secret:
        raise HTTPException(status_code=503, detail="缺少阿里云 AccessKey 配置")
    config = Config(
        access_key_id=access_key_id,
        access_key_secret=access_key_secret,
        endpoint=os.environ.get("ALIYUN_DYPNSAPI_ENDPOINT", "dypnsapi.aliyuncs.com"),
        connect_timeout=5000,
        read_timeout=8000,
    )
    return Client(config)


def send_aliyun_sms_code(target: str) -> None:
    try:
        from alibabacloud_dypnsapi20170525.models import SendSmsVerifyCodeRequest
        from alibabacloud_tea_util.models import RuntimeOptions
        template_param = os.environ.get("ALIYUN_SMS_TEMPLATE_PARAM", '{"code":"##code##","min":"5"}')
        request = SendSmsVerifyCodeRequest(
            country_code="86",
            phone_number=target,
            scheme_name=os.environ.get("ALIYUN_SMS_SCHEME_NAME", "").strip() or None,
            sign_name=os.environ.get("ALIYUN_SMS_SIGN_NAME", "恒创联众").strip() or None,
            template_code=os.environ.get("ALIYUN_SMS_TEMPLATE_CODE", "100001").strip() or None,
            template_param=template_param,
            code_length=int(os.environ.get("ALIYUN_SMS_CODE_LENGTH", "6")),
            code_type=1,
            interval=int(os.environ.get("SURF_AUTH_CODE_COOLDOWN_SECONDS", "60")),
            valid_time=int(os.environ.get("SURF_AUTH_CODE_TTL_SECONDS", "600")),
            return_verify_code=False,
        )
        response = aliyun_sms_client().send_sms_verify_code_with_options(request, RuntimeOptions())
        body = response.body
        if not body or body.code != "OK" or body.success is False:
            detail = (body.message if body else "阿里云短信服务未返回结果") or "阿里云短信发送失败"
            raise HTTPException(status_code=502, detail=detail)
    except HTTPException:
        raise
    except Exception as exc:
        request_logger.exception("Aliyun SMS send failed")
        raise HTTPException(status_code=502, detail=aliyun_exception_detail(exc)) from exc


def check_aliyun_sms_code(target: str, code: str) -> None:
    try:
        from alibabacloud_dypnsapi20170525.models import CheckSmsVerifyCodeRequest
        from alibabacloud_tea_util.models import RuntimeOptions
        request = CheckSmsVerifyCodeRequest(
            country_code="86",
            phone_number=target,
            scheme_name=os.environ.get("ALIYUN_SMS_SCHEME_NAME", "").strip() or None,
            verify_code=code.strip(),
        )
        response = aliyun_sms_client().check_sms_verify_code_with_options(request, RuntimeOptions())
        body = response.body
        verify_result = body.model.verify_result if body and body.model else "UNKNOWN"
        if not body or body.code != "OK" or body.success is False or verify_result != "PASS":
            raise HTTPException(status_code=401, detail="验证码不正确或已过期")
    except HTTPException:
        raise
    except Exception as exc:
        request_logger.exception("Aliyun SMS check failed")
        raise HTTPException(status_code=502, detail=aliyun_exception_detail(exc)) from exc


def verification_target(channel: str, target: str) -> str:
    if channel in {"phone", "sms"}:
        digits = re.sub(r"\D", "", target)
        if len(digits) != 11:
            raise HTTPException(status_code=400, detail="请输入 11 位手机号")
        return digits
    normalized = target.strip().lower()
    if not valid_email(normalized):
        raise HTTPException(status_code=400, detail="请输入有效的邮箱地址")
    return normalized


def deliver_verification_code(channel: str, target: str, code: str) -> str:
    """Use a configured provider, otherwise keep local development deterministic."""
    if channel == "sms" and aliyun_sms_configured():
        send_aliyun_sms_code(target)
        return "aliyun"
    if channel == "sms" and os.environ.get("SURF_SMS_PROVIDER_URL", "").strip():
        payload = json.dumps({"to": target, "code": code, "template": os.environ.get("SURF_SMS_TEMPLATE", "")}).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        token = os.environ.get("SURF_SMS_PROVIDER_TOKEN", "").strip()
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = URLRequest(os.environ["SURF_SMS_PROVIDER_URL"], data=payload, headers=headers, method="POST")
        try:
            with urlopen(request, timeout=8) as response:
                if response.status >= 400:
                    raise HTTPException(status_code=502, detail="短信服务暂时不可用，请稍后重试")
        except (HTTPError, URLError, TimeoutError) as exc:
            raise HTTPException(status_code=502, detail="短信服务暂时不可用，请稍后重试") from exc
        return "sms-provider"
    if channel == "email" and os.environ.get("SURF_SMTP_HOST", "").strip():
        sender = os.environ.get("SURF_SMTP_FROM", "").strip()
        if not sender:
            raise HTTPException(status_code=500, detail="邮件服务缺少发件人配置")
        message = EmailMessage()
        message["Subject"] = os.environ.get("SURF_EMAIL_SUBJECT", "SURF Campus 验证码")
        message["From"] = sender
        message["To"] = target
        message.set_content(f"你的 SURF Campus 验证码是 {code}，10 分钟内有效。请勿将验证码告诉他人。")
        host = os.environ["SURF_SMTP_HOST"]
        port = int(os.environ.get("SURF_SMTP_PORT", "465"))
        username = os.environ.get("SURF_SMTP_USERNAME", "")
        password = os.environ.get("SURF_SMTP_PASSWORD", "")
        try:
            if os.environ.get("SURF_SMTP_SECURITY", "ssl").lower() == "starttls":
                with smtplib.SMTP(host, port, timeout=8) as server:
                    server.starttls()
                    if username:
                        server.login(username, password)
                    server.send_message(message)
            else:
                with smtplib.SMTP_SSL(host, port, timeout=8) as server:
                    if username:
                        server.login(username, password)
                    server.send_message(message)
        except (OSError, smtplib.SMTPException) as exc:
            raise HTTPException(status_code=502, detail="邮件服务暂时不可用，请稍后重试") from exc
        return "smtp"
    return "mock"


def issue_verification_code(channel: str, target: str) -> dict:
    normalized = verification_target(channel, target)
    key = f"{channel}:{normalized}"
    now = time.time()
    cooldown = max(1, int(os.environ.get("SURF_AUTH_CODE_COOLDOWN_SECONDS", "30")))
    ttl = max(60, int(os.environ.get("SURF_AUTH_CODE_TTL_SECONDS", "600")))
    with VERIFICATION_CODES_LOCK:
        previous = VERIFICATION_CODES.get(key)
        if previous and now - previous["sent_at"] < cooldown:
            remaining = cooldown - int(now - previous["sent_at"])
            raise HTTPException(status_code=429, detail=f"请 {remaining} 秒后重新获取验证码")
    if channel == "sms":
        configured = aliyun_sms_configured() or bool(os.environ.get("SURF_SMS_PROVIDER_URL", "").strip())
    else:
        configured = bool(os.environ.get("SURF_SMTP_HOST", "").strip())
    if configured:
        code = f"{secrets.randbelow(1_000_000):06d}"
    else:
        code = os.environ.get("SURF_MOCK_SMS_CODE" if channel == "sms" else "SURF_MOCK_EMAIL_CODE", "123456")
    provider = deliver_verification_code(channel, normalized, code)
    with VERIFICATION_CODES_LOCK:
        VERIFICATION_CODES[key] = {"code": code if provider != "aliyun" else None, "provider": provider, "expires_at": now + ttl, "sent_at": now}
    response = {"sent": True, "channel": channel, "masked_target": (f"{normalized[:3]}****{normalized[-4:]}" if channel == "sms" else f"{normalized[:2]}***{normalized[normalized.index('@'):]}") , "provider": provider, "expires_in": ttl, "cooldown": cooldown}
    if provider == "mock" and os.environ.get("SURF_AUTH_DEBUG_CODES", "true").lower() == "true":
        response["debug_code"] = code
    return response


def consume_verification_code(channel: str, target: str, code: str) -> None:
    normalized = verification_target(channel, target)
    key = f"{channel}:{normalized}"
    with VERIFICATION_CODES_LOCK:
        saved = VERIFICATION_CODES.get(key)
        if not saved or time.time() > saved["expires_at"]:
            VERIFICATION_CODES.pop(key, None)
            raise HTTPException(status_code=401, detail="验证码已过期或未发送，请重新获取")
        provider = saved.get("provider", "mock")
        if provider == "aliyun":
            check_aliyun_sms_code(normalized, code)
            VERIFICATION_CODES.pop(key, None)
            return
        if not secrets.compare_digest(str(saved["code"]), code.strip()):
            raise HTTPException(status_code=401, detail="验证码不正确")
        VERIFICATION_CODES.pop(key, None)


def campus_verified_session() -> dict:
    session = current_auth_session()
    if not session.get("campus_verified"):
        raise HTTPException(status_code=403, detail="绑定 XJTLU 校园账号后才能发布内容")
    return session

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


@app.middleware("http")
async def observe_requests(request: Request, call_next):
    incoming_id = request.headers.get("x-request-id", "")
    request_id = incoming_id if re.fullmatch(r"[A-Za-z0-9._-]{1,80}", incoming_id) else uuid.uuid4().hex[:16]
    started = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
    except Exception:
        request_logger.exception("Unhandled request error request_id=%s path=%s", request_id, request.url.path)
        response = JSONResponse(status_code=500, content={"detail": "服务暂时不可用", "request_id": request_id})
    duration_ms = round((time.perf_counter() - started) * 1000, 2)
    event = {
        "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "status": status_code,
        "duration_ms": duration_ms,
    }
    with REQUEST_LOG_LOCK:
        REQUEST_LOG.appendleft(event)
        REQUEST_STATS["requests"] += 1
        REQUEST_STATS["errors"] += int(status_code >= 400)
        REQUEST_STATS["total_ms"] += duration_ms
        REQUEST_STATS["max_ms"] = max(REQUEST_STATS["max_ms"], duration_ms)
    request_logger.info(json.dumps(event, ensure_ascii=False, separators=(",", ":")))
    response.headers["X-Request-ID"] = request_id
    response.headers["Server-Timing"] = f"app;dur={duration_ms:.2f}"
    return response

# ─── 数据模型 ───

class ChatRequest(BaseModel):
    session_id: str
    message: str
    context: Optional[dict[str, Any]] = None

class ChatResponse(BaseModel):
    reply: str


class CommunityAIRequest(BaseModel):
    post_id: str = Field(min_length=1, max_length=120)
    message: str = Field(min_length=1, max_length=800)
    comment_id: Optional[str] = Field(default=None, max_length=120)


class MediaItem(BaseModel):
    id: str
    type: str
    url: str
    name: str
    mime: str
    size: int
    duration: Optional[float] = None
    poster: Optional[str] = None


class PostCreate(BaseModel):
    content: str = Field(min_length=1, max_length=5000)
    title: str = Field(default="", max_length=120)
    section: str = "campus-life"
    anonymous: bool = False
    tags: list[str] = Field(default_factory=list, max_length=5)
    media: list[MediaItem] = Field(default_factory=list, max_length=9)


class MediaUpload(BaseModel):
    name: str
    mime: str
    data: str
    duration: Optional[float] = None


class ModerationAction(BaseModel):
    status: str
    reason: str = Field(default="", max_length=300)


class AdminNotificationCreate(BaseModel):
    content: str = Field(min_length=1, max_length=300)
    priority: str = "normal"
    published: bool = True
    pinned: bool = False


class NotificationStateAction(BaseModel):
    action: str


class AdminNotificationAction(BaseModel):
    action: str
    reason: str = Field(default="", max_length=300)


class ResourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    course: str = Field(min_length=1, max_length=40)
    type: str = Field(default="参考资料", max_length=40)
    uploader: str = Field(default="课程团队", max_length=80)
    description: str = Field(default="", max_length=1000)
    semester: str = Field(default="2026 Summer", max_length=40)
    year: str = Field(default="all", max_length=20)
    term: str = Field(default="all", max_length=20)
    major: str = Field(default="all", max_length=40)
    file_url: Optional[str] = None
    file_name: Optional[str] = None
    mime: Optional[str] = None
    size: int = Field(default=0, ge=0)


class ContentStatusAction(BaseModel):
    status: str
    reason: str = Field(default="", max_length=300)


class AnswerCreate(BaseModel):
    content: str = Field(min_length=1, max_length=3000)
    role_label: str = Field(default="教师", max_length=30)


class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    time: str = Field(min_length=1, max_length=80)
    location: str = Field(min_length=1, max_length=100)
    organizer: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)
    capacity: int = Field(default=0, ge=0, le=100000)


class OpportunityCreate(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    kind: str = Field(default="项目招募", max_length=40)
    description: str = Field(default="", max_length=1200)
    skills: list[str] = Field(default_factory=list, max_length=8)
    tags: list[str] = Field(default_factory=list, max_length=5)
    deadline: str = Field(default="", max_length=40)
    capacity: int = Field(default=1, ge=1, le=1000)


class OpportunityApplicationCreate(BaseModel):
    opportunity_id: str = Field(min_length=1, max_length=120)
    message: str = Field(default="", max_length=600)
    skills: list[str] = Field(default_factory=list, max_length=8)


class OpportunityApplicationAction(BaseModel):
    status: str = Field(min_length=1, max_length=20)
    reason: str = Field(default="", max_length=300)


class PreferenceUpdate(BaseModel):
    sections: list[str] = Field(default_factory=list, max_length=4)
    interests: list[str] = Field(default_factory=list, max_length=12)
    show_context_rail: bool = True
    content_language: str = "mixed"


class PhoneLoginRequest(BaseModel):
    phone: str = Field(min_length=11, max_length=20)
    code: str = Field(min_length=4, max_length=8)


class PhoneCodeRequest(BaseModel):
    phone: str = Field(min_length=11, max_length=20)


class EmailCodeRequest(BaseModel):
    email: str = Field(min_length=5, max_length=160)


class EmailLoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    password: str = Field(min_length=6, max_length=128)


class EmailRegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=160)
    code: str = Field(min_length=4, max_length=8)
    password: str = Field(min_length=6, max_length=128)


class MockCampusBindRequest(BaseModel):
    account: str = Field(default="student001@student.xjtlu.edu.cn", max_length=120)


class OAuthCallbackError(Exception):
    """Raised when the configured campus OAuth provider cannot be trusted."""

# ─── 根路径 — 返回前端首页 ───

@app.get("/")
def serve_index():
    frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
    return FileResponse(os.path.join(frontend_dir, "index.html"))

@app.get("/health")
def health_check():
    return {"service": "XJTLU Virtual Campus", "version": "0.1.0", "status": "running"}


@app.get("/api/auth/session")
def get_auth_session():
    session = current_auth_session()
    identity_level = "campus" if session.get("campus_verified") else ("phone" if session.get("phone_authenticated") else ("email" if session.get("email_authenticated") else "guest"))
    return {**session, "can_publish": bool(session.get("campus_verified")), "identity_level": identity_level}


@app.post("/api/auth/phone/code")
def send_phone_code(req: PhoneCodeRequest):
    return issue_verification_code("sms", req.phone)


@app.post("/api/auth/email")
def login_by_email(req: EmailLoginRequest):
    email = req.email.strip().lower()
    if not valid_email(email):
        raise HTTPException(status_code=400, detail="请输入有效的邮箱地址")
    account = next((item for item in auth_data().get("accounts", []) if item.get("email") == email), None)
    expected_password = os.environ.get("SURF_DEMO_EMAIL_PASSWORD", "SURF2026")
    password_ok = secrets.compare_digest(req.password, expected_password)
    if account:
        password_ok = secrets.compare_digest(password_digest(req.password, account.get("password_salt", "")), account.get("password_hash", ""))
    if not password_ok:
        raise HTTPException(status_code=401, detail="邮箱或密码不正确，请重试")
    is_campus = email.endswith("@xjtlu.edu.cn") or email.endswith("@student.xjtlu.edu.cn")
    account_name = re.sub(r"[^A-Za-z0-9_-]", "", email.split("@", 1)[0])[:40] or "student"
    session = {
        "phone_authenticated": True,
        "email_authenticated": True,
        "phone_masked": "",
        "campus_verified": is_campus,
        "user_id": f"email_{account_name}",
        "name": account_name.replace(".", " ").title(),
        "campus_account": email if is_campus else "",
        "email": email,
    }
    save_auth_session(session)
    return {**session, "can_publish": is_campus, "identity_level": "campus" if is_campus else "email"}


@app.post("/api/auth/email/code")
def send_email_code(req: EmailCodeRequest):
    return issue_verification_code("email", req.email)


@app.post("/api/auth/register")
def register_by_email(req: EmailRegisterRequest):
    email = verification_target("email", req.email)
    if len(req.password) < 6:
        raise HTTPException(status_code=400, detail="密码至少需要 6 位")
    consume_verification_code("email", email, req.code)
    data = auth_data()
    if any(item.get("email") == email for item in data.get("accounts", [])):
        raise HTTPException(status_code=409, detail="该邮箱已经注册，请直接登录")
    salt = secrets.token_hex(16)
    data.setdefault("accounts", []).append({
        "email": email,
        "password_salt": salt,
        "password_hash": password_digest(req.password, salt),
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    })
    is_campus = email.endswith("@xjtlu.edu.cn") or email.endswith("@student.xjtlu.edu.cn")
    account_name = re.sub(r"[^A-Za-z0-9_-]", "", email.split("@", 1)[0])[:40] or "student"
    session = {
        "phone_authenticated": True,
        "email_authenticated": True,
        "phone_masked": "",
        "campus_verified": is_campus,
        "user_id": f"email_{account_name}",
        "name": account_name.replace(".", " ").title(),
        "campus_account": email if is_campus else "",
        "email": email,
    }
    data["session"] = session
    write_data("auth.json", data)
    return {**session, "can_publish": is_campus, "identity_level": "campus" if is_campus else "email"}


@app.delete("/api/auth/session")
def logout_auth_session():
    session = {
        "phone_authenticated": False,
        "email_authenticated": False,
        "phone_masked": "",
        "campus_verified": False,
        "user_id": "",
        "name": "",
        "campus_account": "",
    }
    save_auth_session(session)
    return {**session, "can_publish": False, "identity_level": "guest"}


@app.post("/api/auth/phone")
def login_by_phone(req: PhoneLoginRequest):
    digits = re.sub(r"\D", "", req.phone)
    if len(digits) != 11:
        raise HTTPException(status_code=400, detail="请输入 11 位手机号")
    if aliyun_sms_configured() or os.environ.get("SURF_SMS_PROVIDER_URL", "").strip():
        consume_verification_code("sms", digits, req.code)
    elif req.code != os.environ.get("SURF_MOCK_SMS_CODE", "123456"):
        raise HTTPException(status_code=401, detail="验证码不正确")
    session = {
        "phone_authenticated": True,
        "email_authenticated": False,
        "phone_masked": f"{digits[:3]}****{digits[-4:]}",
        "campus_verified": False,
        "user_id": "",
        "name": "手机访客",
        "campus_account": "",
    }
    save_auth_session(session)
    return {**session, "can_publish": False, "identity_level": "phone"}


@app.get("/api/auth/xjtlu/config")
def xjtlu_auth_config():
    client_id = os.environ.get("XJTLU_OAUTH_CLIENT_ID", "")
    redirect_uri = os.environ.get("XJTLU_OAUTH_REDIRECT_URI", "")
    token_url = os.environ.get("XJTLU_OAUTH_TOKEN_URL", "")
    userinfo_url = os.environ.get("XJTLU_OAUTH_USERINFO_URL", "")
    return {
        "provider": "XJTLU UIM OAuth2",
        "authorize_url": os.environ.get("XJTLU_OAUTH_AUTHORIZE_URL", "https://sso.xjtlu.edu.cn/esc-sso/oauth2.0/authorize"),
        "token_url": token_url,
        "userinfo_url": userinfo_url,
        "configured": bool(client_id and redirect_uri and token_url and userinfo_url),
        "mock_binding_enabled": os.environ.get("SURF_ENABLE_MOCK_AUTH", "true").lower() == "true",
    }


def _oauth_json_request(url: str, *, method: str = "GET", form: Optional[dict[str, str]] = None, bearer: str = "", extra_headers: Optional[dict[str, str]] = None) -> dict:
    """Call a configured OAuth endpoint and require a JSON object response."""
    if not url.startswith(("https://", "http://")):
        raise OAuthCallbackError("OAuth endpoint 必须使用 HTTP(S)")
    body = urlencode(form or {}).encode("utf-8") if form is not None else None
    headers = {"Accept": "application/json"}
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
    if bearer:
        headers["Authorization"] = f"Bearer {bearer}"
    headers.update(extra_headers or {})
    request = URLRequest(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=8) as response:
            raw = response.read()
    except (HTTPError, URLError, TimeoutError) as exc:
        raise OAuthCallbackError("OAuth 服务暂时不可用") from exc
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise OAuthCallbackError("OAuth 服务返回了无效数据") from exc
    if not isinstance(payload, dict):
        raise OAuthCallbackError("OAuth 服务返回格式无效")
    return payload


def _oauth_expected_issuer() -> str:
    configured = os.environ.get("XJTLU_OAUTH_ISSUER", "").strip().rstrip("/")
    if configured:
        return configured
    authorize_url = os.environ.get("XJTLU_OAUTH_AUTHORIZE_URL", "https://sso.xjtlu.edu.cn/esc-sso/oauth2.0/authorize")
    return authorize_url.split("/esc-sso/", 1)[0].rstrip("/")


def _oauth_email_claim(userinfo: dict) -> str:
    for key in ("email", "mail", "upn", "preferred_username"):
        value = str(userinfo.get(key, "")).strip().lower()
        if "@" in value:
            return value
    return ""


def _oauth_allowed_email(email: str) -> bool:
    domains = {item.strip().lower().lstrip("@") for item in os.environ.get("XJTLU_CAMPUS_EMAIL_DOMAINS", "student.xjtlu.edu.cn,xjtlu.edu.cn").split(",") if item.strip()}
    return bool(email and any(email.endswith(f"@{domain}") for domain in domains))


@app.get("/api/auth/xjtlu/start")
def start_xjtlu_auth():
    if not current_auth_session().get("phone_authenticated"):
        raise HTTPException(status_code=403, detail="请先完成手机验证")
    config = xjtlu_auth_config()
    client_id = os.environ.get("XJTLU_OAUTH_CLIENT_ID", "")
    redirect_uri = os.environ.get("XJTLU_OAUTH_REDIRECT_URI", "")
    if not config["configured"]:
        raise HTTPException(status_code=503, detail="尚未配置学校 OAuth2 的 client_id、回调地址、token 和 userinfo 接口")
    state_token = uuid.uuid4().hex
    auth_data = read_data("auth.json", {"session": current_auth_session()})
    auth_data["oauth_state"] = {"value": state_token, "created_at": time.time(), "redirect_uri": redirect_uri}
    write_data("auth.json", auth_data)
    scope = os.environ.get("XJTLU_OAUTH_SCOPE", "openid profile email").strip()
    query = urlencode({"client_id": client_id, "response_type": "code", "redirect_uri": redirect_uri, "state": state_token, "scope": scope})
    return {"authorization_url": f"{config['authorize_url']}?{query}"}


@app.get("/api/auth/xjtlu/callback")
def xjtlu_auth_callback(code: str = Query(default="", max_length=2048), state: str = Query(default="", max_length=256), error: str = Query(default="", max_length=120)):
    """Exchange an XJTLU authorization code and establish campus identity."""
    if error:
        raise HTTPException(status_code=400, detail="XJTLU 登录未完成")
    if not code or not state:
        raise HTTPException(status_code=400, detail="缺少 OAuth2 code 或 state")
    auth_data = read_data("auth.json", {"session": current_auth_session()})
    saved_state = auth_data.get("oauth_state")
    if isinstance(saved_state, str):
        saved_state = {"value": saved_state, "created_at": 0, "redirect_uri": os.environ.get("XJTLU_OAUTH_REDIRECT_URI", "")}
    if not isinstance(saved_state, dict) or not secrets.compare_digest(str(saved_state.get("value", "")), state):
        raise HTTPException(status_code=400, detail="OAuth2 state 校验失败")
    if time.time() - float(saved_state.get("created_at") or 0) > 600:
        raise HTTPException(status_code=400, detail="OAuth2 state 已过期，请重新登录")
    config = xjtlu_auth_config()
    if not config["configured"]:
        raise HTTPException(status_code=503, detail="尚未配置完整的学校 OAuth2 接口")
    configured_redirect = os.environ.get("XJTLU_OAUTH_REDIRECT_URI", "")
    saved_redirect = str(saved_state.get("redirect_uri") or "")
    if not saved_redirect or not secrets.compare_digest(saved_redirect, configured_redirect):
        raise HTTPException(status_code=400, detail="OAuth2 回调地址与登录请求不一致")
    auth_data.pop("oauth_state", None)
    write_data("auth.json", auth_data)
    token_form = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": os.environ.get("XJTLU_OAUTH_CLIENT_ID", ""),
        "redirect_uri": str(saved_state.get("redirect_uri") or os.environ.get("XJTLU_OAUTH_REDIRECT_URI", "")),
    }
    client_secret = os.environ.get("XJTLU_OAUTH_CLIENT_SECRET", "")
    token_headers = {}
    if client_secret and os.environ.get("XJTLU_OAUTH_TOKEN_AUTH", "client_secret_post").lower() == "client_secret_basic":
        basic = base64.b64encode(f"{token_form['client_id']}:{client_secret}".encode("utf-8")).decode("ascii")
        token_headers["Authorization"] = f"Basic {basic}"
    elif client_secret:
        token_form["client_secret"] = client_secret
    try:
        token_payload = _oauth_json_request(config["token_url"], method="POST", form=token_form, extra_headers=token_headers)
        access_token = str(token_payload.get("access_token", ""))
        if not access_token:
            raise OAuthCallbackError("OAuth token 响应缺少 access_token")
        userinfo = _oauth_json_request(config["userinfo_url"], bearer=access_token)
        issuer = str(userinfo.get("iss") or userinfo.get("issuer") or "").rstrip("/")
        if not issuer or not secrets.compare_digest(issuer, _oauth_expected_issuer()):
            raise OAuthCallbackError("校园身份 issuer 校验失败")
        email = _oauth_email_claim(userinfo)
        if not _oauth_allowed_email(email):
            raise OAuthCallbackError("OAuth 账号不是允许的 XJTLU 校园邮箱")
        subject = str(userinfo.get("sub") or userinfo.get("student_id") or email)
        session = current_auth_session()
        if not session.get("phone_authenticated"):
            raise OAuthCallbackError("请先完成手机验证")
        session.update({
            "campus_verified": True,
            "user_id": subject,
            "name": str(userinfo.get("name") or userinfo.get("display_name") or email.split("@", 1)[0]),
            "campus_account": email,
            "campus_provider": "xjtlu-oauth2",
        })
        auth_data["session"] = session
        write_data("auth.json", auth_data)
        return RedirectResponse(url="/", status_code=303)
    except OAuthCallbackError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/auth/xjtlu/mock-bind")
def mock_bind_xjtlu(req: MockCampusBindRequest):
    if os.environ.get("SURF_ENABLE_MOCK_AUTH", "true").lower() != "true":
        raise HTTPException(status_code=404, detail="Mock 身份绑定已关闭")
    session = current_auth_session()
    if not session.get("phone_authenticated"):
        raise HTTPException(status_code=403, detail="请先完成手机验证")
    account = req.account.strip().lower()
    if not account.endswith(("@student.xjtlu.edu.cn", "@xjtlu.edu.cn")):
        raise HTTPException(status_code=400, detail="只接受 XJTLU 校园邮箱")
    session.update({"campus_verified": True, "user_id": "u001", "name": "张三", "campus_account": account})
    session.pop("campus_provider", None)
    save_auth_session(session)
    return {**session, "can_publish": True, "identity_level": "campus"}


@app.delete("/api/auth/xjtlu/binding")
def remove_xjtlu_binding():
    session = current_auth_session()
    session.update({"campus_verified": False, "user_id": "", "name": "手机访客", "campus_account": ""})
    session.pop("campus_provider", None)
    save_auth_session(session)
    identity_level = "email" if session.get("email_authenticated") else "phone"
    return {**session, "can_publish": False, "identity_level": identity_level}

# ─── AI 对话 ───

@app.post("/api/chat", response_model=ChatResponse)
def api_chat(req: ChatRequest):
    """AI 对话接口（核心入口）"""
    if not req.message.strip():
        raise HTTPException(status_code=400, detail="消息不能为空")
    try:
        agent = get_agent()
        contextual_message = req.message
        if req.context:
            contextual_message = f"当前上下文：{req.context.get('text') or req.context.get('label', '')}\n用户问题：{req.message}"
        reply = agent.chat(session_id=req.session_id, user_message=contextual_message)
    except Exception as e:
        reply = f"（AI 暂时无法回应：{str(e)[:80]}）"
    return ChatResponse(reply=reply)


@app.post("/api/community/ai")
def community_ai(req: CommunityAIRequest):
    """Answer an @AI mention with the post and optional comment as bounded context."""
    from tools.community import _load_json

    data = _load_json("posts.json")
    post = next((item for item in data.get("posts", []) if item.get("id") == req.post_id), None)
    if not post:
        raise HTTPException(status_code=404, detail="帖子未找到")
    if post.get("status", "published") != "published":
        raise HTTPException(status_code=409, detail="帖子通过审核后才能调用 @AI")

    context_parts = [post.get("title", "校园话题"), post.get("content", "")]
    if req.comment_id:
        comment = next((item for item in post.get("comments", []) if item.get("id") == req.comment_id), None)
        if not comment:
            raise HTTPException(status_code=404, detail="评论未找到")
        context_parts.append(f"评论：{comment.get('content', '')}")

    context = "\n".join(part for part in context_parts if part)
    try:
        agent = get_agent()
        reply = agent.chat(
            session_id=f"community_{req.post_id}_{req.comment_id or 'post'}",
            user_message=f"当前校园话题上下文：{context}\n用户通过 @AI 提问：{req.message}",
        )
    except Exception as error:
        reply = f"（AI 暂时无法回应：{str(error)[:80]}）"
    return {
        "reply": reply,
        "source": {"post_id": req.post_id, "comment_id": req.comment_id, "label": post.get("title") or "校园话题"},
        "uncertainty": "AI 回答基于当前帖子与评论，重要事项请以课程团队或官方通知为准。",
    }

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

@app.get("/api/courses/catalog")
def get_course_catalog():
    return read_data("course_catalog.json", {"years": [], "terms": [], "majors": [], "courses": []})

@app.get("/api/courses/qa")
def get_qa(keyword: str = None):
    from tools.academic import academic_center
    import json
    return json.loads(academic_center("qa_search", {"keyword": keyword or ""}))

@app.post("/api/courses/qa")
def post_qa(course: str, question: str, anonymous: bool = False, session: dict = Depends(campus_verified_session)):
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
def create_post(req: PostCreate, session: dict = Depends(campus_verified_session)):
    from tools.community import _publish_post
    result = json.loads(_publish_post(
        req.content,
        req.section,
        req.anonymous,
        req.title,
        req.tags,
        [item.model_dump() for item in req.media],
        "pending",
    ))
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@app.post("/api/community/comments")
def add_comment(post_id: str, content: str, anonymous: bool = False, session: dict = Depends(campus_verified_session)):
    from tools.community import _add_comment
    import json
    return json.loads(_add_comment(post_id, content, anonymous))

@app.post("/api/community/like")
def like_post(post_id: str, user_id: str = "u001"):
    from tools.community import _like_post
    import json
    return json.loads(_like_post(post_id, user_id))

@app.post("/api/community/collect")
def collect_post(post_id: str, tag: str = ""):
    from tools.community import _collect_post
    import json
    return json.loads(_collect_post(post_id, tag))

@app.get("/api/community/posts/{post_id}")
def get_post_detail(post_id: str):
    """获取单个帖子详情（含评论列表）"""
    from tools.community import _load_json
    import json
    data = _load_json("posts.json")
    collection_data = _load_json("collections.json")
    collections = set(collection_data.get("collections", []))
    collection_tags = collection_data.get("tags", {})
    liked_posts = set(_load_json("likes.json").get("users", {}).get("u001", []))
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
                "liked": p.get("id", "") in liked_posts,
                "comments_count": p.get("comments_count", 0),
                "comments": [
                    {
                        "id": c.get("id", ""),
                        "content": c.get("content", ""),
                        "anonymous": c.get("anonymous", False),
                        "time": c.get("time", ""),
                        "ai_mention_count": c.get("ai_mention_count", 0),
                        "ai_status": c.get("ai_status", "none"),
                    }
                    for c in comments
                ],
                "author": p.get("author", "校园成员"),
                "tags": p.get("tags", []),
                "media": p.get("media", []),
                "status": p.get("status", "published"),
                "ai_mention_count": p.get("ai_mention_count", 0),
                "ai_status": p.get("ai_status", "none"),
                "collected": p.get("id", "") in collections,
                "collection_tags": collection_tags.get(p.get("id", ""), []),
            }
    raise HTTPException(status_code=404, detail="帖子未找到")

@app.post("/api/community/report")
def report_post(post_id: str, reason: str = ""):
    posts = read_data("posts.json", {"posts": []}).get("posts", [])
    if not any(item.get("id") == post_id for item in posts):
        raise HTTPException(status_code=404, detail="帖子未找到")
    data = read_data("reports.json", {"reports": []})
    report_id = f"report_{uuid.uuid4().hex[:10]}"
    data["reports"].insert(0, {
        "id": report_id,
        "post_id": post_id,
        "reason": reason.strip() or "未说明原因",
        "status": "pending",
        "created_at": time.strftime("%Y-%m-%d %H:%M"),
        "resolution": "",
    })
    write_data("reports.json", data)
    return {"status": "ok", "report_id": report_id, "message": "举报已提交，处理结果会保留在管理记录中"}


@app.post("/api/media")
def upload_media(req: MediaUpload):
    if req.mime not in {"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm", "video/quicktime"}:
        raise HTTPException(status_code=415, detail="不支持的媒体格式")
    try:
        encoded = req.data.split(",", 1)[-1]
        payload = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="媒体数据无效") from exc
    limit = 40 * 1024 * 1024 if req.mime.startswith("video/") else 10 * 1024 * 1024
    if not payload or len(payload) > limit:
        raise HTTPException(status_code=413, detail="媒体为空或超过 P0 本地上传限制")
    extension = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}[req.mime]
    media_id = f"media_{uuid.uuid4().hex[:12]}"
    filename = f"{media_id}{extension}"
    (UPLOAD_DIR / filename).write_bytes(payload)
    return {
        "id": media_id,
        "type": "video" if req.mime.startswith("video/") else "image",
        "url": f"/media/{filename}",
        "name": re.sub(r"[^\w.\- ]", "", req.name)[:100] or filename,
        "mime": req.mime,
        "size": len(payload),
        "duration": req.duration,
    }

# ─── 匿名树洞 ───

@app.get("/api/treehole/hot")
def treehole_hot():
    from tools.treehole import _treehole_hot
    import json
    return json.loads(_treehole_hot())

@app.post("/api/treehole/posts")
def treehole_post(content: str, category: str = None, session: dict = Depends(campus_verified_session)):
    from tools.treehole import _treehole_post
    import json
    return json.loads(_treehole_post(content, category))

@app.post("/api/treehole/comments")
def treehole_comment(post_id: str, content: str, session: dict = Depends(campus_verified_session)):
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


@app.delete("/api/events/register")
def cancel_event_registration(event_id: str):
    from tools.events import _cancel_event
    import json
    result = json.loads(_cancel_event(event_id))
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.patch("/api/events/reminder")
def set_event_reminder(event_id: str, enabled: bool = True):
    from tools.events import _set_reminder
    import json
    result = json.loads(_set_reminder(event_id, enabled))
    if result.get("error"):
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.get("/api/events/{event_id}/calendar")
def event_calendar(event_id: str):
    events = read_data("events.json", {"events": []}).get("events", [])
    event = next((item for item in events if item.get("id") == event_id and item.get("status", "published") == "published"), None)
    if not event:
        raise HTTPException(status_code=404, detail="活动未找到")
    title = str(event.get("title", "校园活动")).replace(",", "\\,")
    description = str(event.get("description", "")).replace("\n", "\\n").replace(",", "\\,")
    location = f"{event.get('location', '')}".replace(",", "\\,")
    stamp = time.strftime("%Y%m%dT%H%M%SZ")
    match = re.search(r"(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})-(\d{2}):(\d{2})", str(event.get("time", "")))
    start = f"{match.group(1)}{match.group(2)}{match.group(3)}T{match.group(4)}{match.group(5)}00" if match else ""
    end = f"{match.group(1)}{match.group(2)}{match.group(3)}T{match.group(6)}{match.group(7)}00" if match else ""
    ics = "\r\n".join([
        "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SURF Campus//EN", "BEGIN:VEVENT",
        f"UID:{event_id}@surf-campus", f"DTSTAMP:{stamp}", *( [f"DTSTART:{start}", f"DTEND:{end}"] if start else [] ), f"SUMMARY:{title}", f"LOCATION:{location}", f"DESCRIPTION:{description}",
        "END:VEVENT", "END:VCALENDAR", "",
    ])
    return Response(content=ics, media_type="text/calendar", headers={"Content-Disposition": f'attachment; filename="{event_id}.ics"'})


def _opportunity_view(item: dict, user_skills: list[str], user_id: str = "u001") -> dict:
    skills = item.get("skills", [])
    normalized_user = {str(value).casefold() for value in user_skills}
    overlap = [skill for skill in skills if str(skill).casefold() in normalized_user]
    applications = item.get("applications", [])
    mine = next((value for value in applications if value.get("user_id") == user_id), None)
    reason = f"匹配 {len(overlap)}/{len(skills)} 项技能：{', '.join(overlap)}" if overlap else "可以补充新技能，当前没有直接匹配项"
    return {
        **item,
        "applications": None,
        "applications_count": len(applications),
        "match_score": round(len(overlap) / len(skills) * 100) if skills else 0,
        "match_reason": reason,
        "my_application": mine,
    }


@app.get("/api/opportunities")
def list_opportunities(keyword: str = "", skill: str = "", user_id: str = "u001"):
    opportunities = read_data("opportunities.json", {"opportunities": []}).get("opportunities", [])
    user = next((value for value in read_data("users.json", {"users": []}).get("users", []) if value.get("id") == user_id), {})
    user_skills = user.get("tags", [])
    needle = keyword.strip().casefold()
    skill_needle = skill.strip().casefold()
    visible = []
    for item in opportunities:
        if item.get("status", "published") != "published":
            continue
        searchable = " ".join([item.get("title", ""), item.get("kind", ""), item.get("description", ""), *item.get("skills", []), *item.get("tags", [])]).casefold()
        if needle and needle not in searchable:
            continue
        if skill_needle and not any(skill_needle in str(value).casefold() for value in item.get("skills", [])):
            continue
        visible.append(_opportunity_view(item, user_skills, user_id))
    visible.sort(key=lambda value: (-value["match_score"], value.get("deadline", "")))
    return {"opportunities": visible, "skills": user_skills, "total": len(visible)}


@app.post("/api/opportunities/apply")
def apply_opportunity(req: OpportunityApplicationCreate, user_id: str = "u001"):
    data = read_data("opportunities.json", {"opportunities": []})
    item = next((value for value in data.get("opportunities", []) if value.get("id") == req.opportunity_id), None)
    if not item or item.get("status", "published") != "published":
        raise HTTPException(status_code=404, detail="招募不存在或已下线")
    applications = item.setdefault("applications", [])
    existing = next((value for value in applications if value.get("user_id") == user_id), None)
    if existing:
        return {"status": "ok", "application": existing, "message": "你已经提交过申请"}
    active_count = sum(value.get("status") in {"pending", "accepted"} for value in applications)
    if item.get("capacity", 0) and active_count >= item["capacity"]:
        raise HTTPException(status_code=409, detail="招募名额已满")
    application = {
        "id": f"application_{uuid.uuid4().hex[:10]}",
        "user_id": user_id,
        "name": "张三",
        "message": req.message.strip(),
        "skills": req.skills,
        "status": "pending",
        "created_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    applications.append(application)
    write_data("opportunities.json", data)
    return {"status": "ok", "application": application, "message": "申请已提交，等待招募发起人处理"}

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


@app.get("/api/messaging/conversations")
def list_conversations():
    return {"conversations": read_data("messages.json", {"conversations": []}).get("conversations", [])}


@app.get("/api/groups")
def list_project_groups():
    return {"groups": read_data("groups.json", {"groups": []}).get("groups", [])}


@app.get("/api/profile/preferences")
def get_profile_preferences():
    data = read_data("preferences.json", {})
    return data.get("u001", {"sections": list(SECTION_LABELS), "interests": [], "show_context_rail": True, "content_language": "mixed"})


@app.patch("/api/profile/preferences")
def update_profile_preferences(req: PreferenceUpdate):
    allowed = set(SECTION_LABELS)
    sections = [value for value in req.sections if value in allowed]
    if not sections:
        sections = list(SECTION_LABELS)
    interests = []
    for value in req.interests:
        clean = " ".join(str(value).strip().split())[:24]
        if clean and clean.casefold() not in {item.casefold() for item in interests}:
            interests.append(clean)
    data = read_data("preferences.json", {})
    language = req.content_language if req.content_language in {"mixed", "zh", "en"} else "mixed"
    data["u001"] = {"sections": sections[:4], "interests": interests[:12], "show_context_rail": req.show_context_rail, "content_language": language}
    write_data("preferences.json", data)
    return data["u001"]


@app.get("/api/profile/participation")
def profile_participation():
    return read_data("participation.json", {}).get("u001", {"points": 0, "records": []})


@app.post("/api/groups/{group_id}/messages")
def post_group_message(group_id: str, content: str = Query(min_length=1, max_length=1000)):
    data = read_data("groups.json", {"groups": []})
    group = next((item for item in data.get("groups", []) if item.get("id") == group_id), None)
    if not group:
        raise HTTPException(status_code=404, detail="项目群不存在")
    message = {"id": f"group_msg_{uuid.uuid4().hex[:10]}", "sender": "张三", "content": content.strip(), "time": time.strftime("%Y-%m-%d %H:%M")}
    group.setdefault("messages", []).append(message)
    write_data("groups.json", data)
    return {"status": "ok", "message": message}

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


@app.patch("/api/notifications/{notification_id}")
def update_notification_state(notification_id: str, req: NotificationStateAction):
    if req.action not in {"read", "later", "processed"}:
        raise HTTPException(status_code=400, detail="不支持的通知状态")
    data = read_data("messages.json", {"notifications": []})
    item = next((value for value in data.get("notifications", []) if value.get("id") == notification_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="通知未找到")
    if req.action == "read":
        item["read"] = True
    if req.action == "later":
        item["saved_for_later"] = not item.get("saved_for_later", False)
    if req.action == "processed":
        item["processed"] = True
        item["read"] = True
        item["saved_for_later"] = False
    write_data("messages.json", data)
    return {"status": "ok", "notification": item}

# ─── 全局搜索 ───

@app.get("/api/search")
def global_search(
    keyword: str = Query(min_length=1),
    content_type: str = "all",
    section: str = "all",
):
    """聚合搜索帖子、课程资料、问答和活动。"""
    needle = keyword.strip().casefold()
    posts = []
    for item in read_data("posts.json", {"posts": []}).get("posts", []):
        if item.get("status", "published") != "published" or item.get("section") == "treehole":
            continue
        searchable = " ".join([
            item.get("title", ""), item.get("content", ""), item.get("section", ""),
            SECTION_LABELS.get(item.get("section"), ""), *item.get("tags", []),
        ]).casefold()
        if needle in searchable and (section == "all" or item.get("section") == section):
            posts.append({**item, "type": "post"})

    courses = read_data("courses.json", {})
    resources = []
    for index, item in enumerate(courses.get("resources", [])):
        if item.get("status", "published") != "published":
            continue
        searchable = " ".join(str(value) for value in item.values()).casefold()
        if needle in searchable:
            resources.append({"id": f"resource_{index}", **item, "type": "resource"})
    questions = []
    for index, item in enumerate(courses.get("qa", [])):
        if item.get("status", "published") != "published":
            continue
        searchable = " ".join(str(value) for value in item.values()).casefold()
        if needle in searchable:
            questions.append({"id": f"question_{index}", **item, "type": "question"})
    events = []
    for item in read_data("events.json", {}).get("events", []):
        if item.get("status", "published") != "published":
            continue
        searchable = " ".join(str(value) for value in item.values()).casefold()
        if needle in searchable:
            events.append({**item, "type": "event"})

    groups = {"posts": posts, "resources": resources, "questions": questions, "events": events}
    if content_type != "all":
        key = {"post": "posts", "resource": "resources", "question": "questions", "event": "events"}.get(content_type)
        groups = {name: value if name == key else [] for name, value in groups.items()}
    related_tags = sorted({tag for post in posts for tag in post.get("tags", [])}, key=str.casefold)[:8]
    return {"keyword": keyword, "total": sum(len(items) for items in groups.values()), "related_tags": related_tags, **groups}


@app.get("/api/discover/tags")
def list_tags():
    counts = {}
    for post in read_data("posts.json", {"posts": []}).get("posts", []):
        if post.get("status", "published") != "published" or post.get("section") == "treehole":
            continue
        for tag in post.get("tags", []):
            counts[tag] = counts.get(tag, 0) + 1
    recommended = [
        {"name": "CSE101", "category": "课程"}, {"name": "期末复习", "category": "议题"},
        {"name": "AI", "category": "技能"}, {"name": "黑客松", "category": "活动"},
        {"name": "图书馆", "category": "地点"}, {"name": "羽毛球", "category": "兴趣"},
    ]
    for item in recommended:
        item["count"] = counts.get(item["name"], 0)
    for name, count in counts.items():
        if not any(item["name"].casefold() == name.casefold() for item in recommended):
            recommended.append({"name": name, "category": "自定义", "count": count})
    return {"tags": sorted(recommended, key=lambda item: (-item["count"], item["name"].casefold()))}


@app.get("/api/discover/tags/{tag}")
def tag_aggregation(tag: str):
    result = global_search(tag, "all", "all")
    all_tags = list_tags()["tags"]
    result["tag"] = tag
    result["related_tags"] = [item for item in all_tags if item["name"].casefold() != tag.casefold()][:6]
    return result


# ─── 管理端 ───

@app.get("/api/admin/session")
def admin_session(role: str = Depends(current_admin_role)):
    return {"authenticated": True, "role": role, "permissions": ["read", *( ["moderate", "publish"] if role in WRITE_ROLES else [])]}


@app.get("/api/admin/system/metrics")
def admin_system_metrics(role: str = Depends(current_admin_role)):
    """Return bounded, non-sensitive request health data for local operations checks."""
    with REQUEST_LOG_LOCK:
        stats = dict(REQUEST_STATS)
        recent = list(REQUEST_LOG)[:20]
    request_count = stats["requests"]
    durations = sorted(item["duration_ms"] for item in recent)
    p95_index = min(len(durations) - 1, max(0, round(len(durations) * 0.95) - 1)) if durations else 0
    return {
        "started_at": stats["started_at"],
        "requests": request_count,
        "errors": stats["errors"],
        "error_rate": round(stats["errors"] / request_count, 4) if request_count else 0,
        "avg_ms": round(stats["total_ms"] / request_count, 2) if request_count else 0,
        "max_ms": round(stats["max_ms"], 2),
        "recent_p95_ms": durations[p95_index] if durations else 0,
        "recent": recent,
        "buffer_limit": REQUEST_LOG_LIMIT,
    }


@app.get("/api/admin/overview")
def admin_overview(role: str = Depends(current_admin_role)):
    posts = read_data("posts.json", {"posts": []}).get("posts", [])
    reports = read_data("reports.json", {"reports": []}).get("reports", [])
    audits = read_data("audit.json", {"records": []}).get("records", [])
    return {
        "pending_posts": sum(item.get("status") == "pending" for item in posts),
        "published_posts": sum(item.get("status", "published") == "published" for item in posts),
        "open_reports": sum(item.get("status") == "pending" for item in reports),
        "audit_records": len(audits),
    }


@app.get("/api/admin/posts")
def admin_posts(status: str = "all", role: str = Depends(current_admin_role)):
    posts = read_data("posts.json", {"posts": []}).get("posts", [])
    if status != "all":
        posts = [item for item in posts if item.get("status", "published") == status]
    return {"posts": posts, "total": len(posts)}


@app.patch("/api/admin/posts/{post_id}")
def moderate_post(post_id: str, req: ModerationAction, role: str = Depends(moderation_role)):
    if req.status not in {"published", "hidden", "rejected"}:
        raise HTTPException(status_code=400, detail="不支持的审核状态")
    data = read_data("posts.json", {"posts": []})
    post = next((item for item in data["posts"] if item.get("id") == post_id), None)
    if not post:
        raise HTTPException(status_code=404, detail="帖子未找到")
    post["status"] = req.status
    post["moderation_note"] = req.reason.strip()
    post["moderated_at"] = time.strftime("%Y-%m-%d %H:%M")
    write_data("posts.json", data)
    audit(role, f"post.{req.status}", "post", post_id, req.reason)
    return {"status": "ok", "post": post}


@app.get("/api/admin/reports")
def admin_reports(role: str = Depends(current_admin_role)):
    return read_data("reports.json", {"reports": []})


@app.patch("/api/admin/reports/{report_id}")
def resolve_report(report_id: str, req: ModerationAction, role: str = Depends(moderation_role)):
    data = read_data("reports.json", {"reports": []})
    report = next((item for item in data["reports"] if item.get("id") == report_id), None)
    if not report:
        raise HTTPException(status_code=404, detail="举报未找到")
    report["status"] = "resolved"
    report["resolution"] = req.reason.strip() or req.status
    write_data("reports.json", data)
    audit(role, "report.resolve", "report", report_id, report["resolution"])
    return {"status": "ok", "report": report}


@app.get("/api/admin/audit")
def admin_audit(role: str = Depends(current_admin_role)):
    return read_data("audit.json", {"records": []})


@app.get("/api/admin/tags")
def admin_tags(role: str = Depends(current_admin_role)):
    return list_tags()


@app.get("/api/admin/learning")
def admin_learning(role: str = Depends(current_admin_role)):
    data = read_data("courses.json", {"resources": [], "qa": []})
    return {"resources": data.get("resources", []), "questions": data.get("qa", [])}


@app.post("/api/admin/resources")
def create_admin_resource(req: ResourceCreate, role: str = Depends(learning_write_role)):
    data = read_data("courses.json", {"resources": []})
    item = {
        "id": f"resource_{uuid.uuid4().hex[:10]}", **req.model_dump(),
        "status": "published", "created_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    data.setdefault("resources", []).insert(0, item)
    write_data("courses.json", data)
    audit(role, "resource.publish", "resource", item["id"], item["name"])
    return {"status": "ok", "resource": item}


@app.post("/api/admin/resource-files")
def upload_admin_resource_file(req: MediaUpload, role: str = Depends(learning_write_role)):
    allowed = {
        "application/pdf": ".pdf", "text/plain": ".txt", "text/markdown": ".md",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
    }
    if req.mime not in allowed:
        raise HTTPException(status_code=415, detail="P0 仅支持 PDF、TXT、Markdown、DOCX 和 PPTX")
    try:
        payload = base64.b64decode(req.data.split(",", 1)[-1], validate=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="资料文件数据无效") from exc
    if not payload or len(payload) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="资料文件为空或超过 20MB")
    file_id = f"resource_file_{uuid.uuid4().hex[:12]}"
    filename = f"{file_id}{allowed[req.mime]}"
    (RESOURCE_FILE_DIR / filename).write_bytes(payload)
    audit(role, "resource_file.upload", "resource_file", file_id, req.name)
    return {
        "id": file_id, "url": f"/resource-files/{filename}",
        "name": re.sub(r"[^\w.\- ]", "", req.name)[:160] or filename,
        "mime": req.mime, "size": len(payload),
    }


@app.patch("/api/admin/resources/{resource_id}")
def update_admin_resource(resource_id: str, req: ContentStatusAction, role: str = Depends(learning_write_role)):
    if req.status not in {"published", "hidden"}:
        raise HTTPException(status_code=400, detail="不支持的资料状态")
    data = read_data("courses.json", {"resources": []})
    item = next((value for value in data.get("resources", []) if value.get("id") == resource_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="资料未找到")
    item["status"] = req.status
    item["moderation_note"] = req.reason
    write_data("courses.json", data)
    audit(role, f"resource.{req.status}", "resource", resource_id, req.reason)
    return {"status": "ok", "resource": item}


@app.post("/api/admin/questions/{question_id}/answers")
def create_admin_answer(question_id: str, req: AnswerCreate, role: str = Depends(learning_write_role)):
    data = read_data("courses.json", {"qa": []})
    question = next((value for value in data.get("qa", []) if value.get("id") == question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="问题未找到")
    answer = {
        "id": f"answer_{uuid.uuid4().hex[:10]}", "content": req.content.strip(),
        "author": "课程团队", "role": req.role_label, "status": "published",
        "created_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    previous_count = int(question.get("answers", 0))
    question.setdefault("answers_detail", []).append(answer)
    question["answers"] = max(previous_count + 1, len(question["answers_detail"]))
    question["status"] = "published"
    write_data("courses.json", data)
    audit(role, "question.answer", "question", question_id, req.content[:100])
    return {"status": "ok", "answer": answer, "question": question}


@app.post("/api/courses/qa/{question_id}/accept")
def accept_course_answer(question_id: str, answer_id: str):
    data = read_data("courses.json", {"qa": []})
    question = next((value for value in data.get("qa", []) if value.get("id") == question_id), None)
    if not question:
        raise HTTPException(status_code=404, detail="问题未找到")
    answer = next((value for value in question.get("answers_detail", []) if value.get("id") == answer_id), None)
    if not answer:
        raise HTTPException(status_code=404, detail="回答未找到")
    for value in question.get("answers_detail", []):
        value["accepted"] = value.get("id") == answer_id
    question["accepted_answer_id"] = answer_id
    write_data("courses.json", data)
    return {"status": "ok", "question": question}


@app.get("/api/admin/events")
def admin_events(role: str = Depends(current_admin_role)):
    return {"events": read_data("events.json", {"events": []}).get("events", [])}


@app.post("/api/admin/events")
def create_admin_event(req: EventCreate, role: str = Depends(event_write_role)):
    data = read_data("events.json", {"events": [], "clubs": []})
    item = {
        "id": f"evt_{uuid.uuid4().hex[:10]}", **req.model_dump(), "registered": 0,
        "registrations": [], "status": "published", "created_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    data.setdefault("events", []).insert(0, item)
    write_data("events.json", data)
    audit(role, "event.publish", "event", item["id"], item["title"])
    return {"status": "ok", "event": item}


@app.patch("/api/admin/events/{event_id}")
def update_admin_event(event_id: str, req: ContentStatusAction, role: str = Depends(event_write_role)):
    if req.status not in {"published", "hidden"}:
        raise HTTPException(status_code=400, detail="不支持的活动状态")
    data = read_data("events.json", {"events": []})
    item = next((value for value in data.get("events", []) if value.get("id") == event_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="活动未找到")
    item["status"] = req.status
    item["moderation_note"] = req.reason
    write_data("events.json", data)
    audit(role, f"event.{req.status}", "event", event_id, req.reason)
    return {"status": "ok", "event": item}


@app.delete("/api/admin/events/{event_id}/registrations/{user_id}")
def remove_event_registration(event_id: str, user_id: str, role: str = Depends(event_write_role)):
    data = read_data("events.json", {"events": []})
    item = next((value for value in data.get("events", []) if value.get("id") == event_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="活动未找到")
    registrations = item.setdefault("registrations", [])
    before = len(registrations)
    item["registrations"] = [value for value in registrations if value.get("user_id") != user_id]
    if len(item["registrations"]) == before:
        raise HTTPException(status_code=404, detail="报名记录未找到")
    item["registered"] = max(0, int(item.get("registered", 0)) - 1)
    write_data("events.json", data)
    audit(role, "event.registration.remove", "event", event_id, user_id)
    return {"status": "ok", "event": item}


@app.get("/api/admin/opportunities")
def admin_opportunities(role: str = Depends(current_admin_role)):
    return {"opportunities": read_data("opportunities.json", {"opportunities": []}).get("opportunities", [])}


@app.post("/api/admin/opportunities")
def create_admin_opportunity(req: OpportunityCreate, role: str = Depends(opportunity_write_role)):
    data = read_data("opportunities.json", {"opportunities": []})
    item = {
        "id": f"opp_{uuid.uuid4().hex[:10]}", **req.model_dump(), "owner": "校园项目发起人",
        "status": "published", "applications": [], "created_at": time.strftime("%Y-%m-%d %H:%M"),
    }
    data.setdefault("opportunities", []).insert(0, item)
    write_data("opportunities.json", data)
    audit(role, "opportunity.publish", "opportunity", item["id"], item["title"])
    return {"status": "ok", "opportunity": item}


@app.patch("/api/admin/opportunities/{opportunity_id}")
def update_admin_opportunity(opportunity_id: str, req: ContentStatusAction, role: str = Depends(opportunity_write_role)):
    if req.status not in {"published", "hidden"}:
        raise HTTPException(status_code=400, detail="不支持的招募状态")
    data = read_data("opportunities.json", {"opportunities": []})
    item = next((value for value in data.get("opportunities", []) if value.get("id") == opportunity_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="招募未找到")
    item["status"] = req.status
    item["moderation_note"] = req.reason
    write_data("opportunities.json", data)
    audit(role, f"opportunity.{req.status}", "opportunity", opportunity_id, req.reason)
    return {"status": "ok", "opportunity": item}


@app.patch("/api/admin/opportunities/{opportunity_id}/applications/{application_id}")
def update_opportunity_application(opportunity_id: str, application_id: str, req: OpportunityApplicationAction, role: str = Depends(opportunity_write_role)):
    if req.status not in {"pending", "accepted", "rejected"}:
        raise HTTPException(status_code=400, detail="不支持的申请状态")
    data = read_data("opportunities.json", {"opportunities": []})
    item = next((value for value in data.get("opportunities", []) if value.get("id") == opportunity_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="招募未找到")
    application = next((value for value in item.get("applications", []) if value.get("id") == application_id), None)
    if not application:
        raise HTTPException(status_code=404, detail="申请未找到")
    application["status"] = req.status
    application["moderation_note"] = req.reason
    write_data("opportunities.json", data)
    audit(role, f"opportunity.application.{req.status}", "application", application_id, req.reason)
    return {"status": "ok", "application": application, "opportunity": item}


@app.get("/api/admin/notifications")
def admin_notifications(role: str = Depends(current_admin_role)):
    return {"notifications": read_data("messages.json", {}).get("notifications", [])}


@app.post("/api/admin/notifications")
def create_admin_notification(req: AdminNotificationCreate, role: str = Depends(moderation_role)):
    data = read_data("messages.json", {"conversations": [], "notifications": []})
    item = {
        "id": f"notif_{uuid.uuid4().hex[:10]}", "content": req.content.strip(),
        "time": time.strftime("%Y-%m-%d %H:%M"), "read": False,
        "priority": req.priority if req.priority in {"normal", "important"} else "normal",
        "published": req.published,
        "status": "published" if req.published else "draft",
        "pinned": req.pinned,
    }
    data.setdefault("notifications", []).insert(0, item)
    write_data("messages.json", data)
    audit(role, "notification.publish", "notification", item["id"], item["content"])
    return {"status": "ok", "notification": item}


@app.patch("/api/admin/notifications/{notification_id}")
def update_admin_notification(notification_id: str, req: AdminNotificationAction, role: str = Depends(moderation_role)):
    if req.action not in {"pin", "unpin", "withdraw", "publish"}:
        raise HTTPException(status_code=400, detail="不支持的通知操作")
    data = read_data("messages.json", {"notifications": []})
    item = next((value for value in data.get("notifications", []) if value.get("id") == notification_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="通知未找到")
    if req.action in {"pin", "unpin"}:
        item["pinned"] = req.action == "pin"
    if req.action in {"withdraw", "publish"}:
        item["status"] = "withdrawn" if req.action == "withdraw" else "published"
        item["published"] = req.action == "publish"
        if req.action == "withdraw":
            item["published"] = False
    write_data("messages.json", data)
    audit(role, f"notification.{req.action}", "notification", notification_id, req.reason)
    return {"status": "ok", "notification": item}

# ─── 静态文件挂载（必须放在所有路由之后）───

app.mount("/media", StaticFiles(directory=UPLOAD_DIR), name="media")
app.mount("/resource-files", StaticFiles(directory=RESOURCE_FILE_DIR), name="resource-files")

_admin_dir = os.path.join(os.path.dirname(__file__), "..", "admin")
if os.path.isdir(_admin_dir):
    app.mount("/admin", StaticFiles(directory=_admin_dir, html=True), name="admin")

_frontend_dir = os.path.join(os.path.dirname(__file__), "..", "frontend")
app.mount("/", StaticFiles(directory=_frontend_dir), name="frontend")

# ─── 启动 ───

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    reload_enabled = os.environ.get("UVICORN_RELOAD", "false").strip().lower() == "true"
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=reload_enabled)
