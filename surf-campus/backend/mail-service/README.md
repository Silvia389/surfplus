# SURF Campus Mail Service

这是一个独立的 Nodemailer SMTP 服务骨架，当前默认关闭发送，不包含真实发件人、账号、密码或最终邮件文案。

## 本地启动

```bash
cd backend/mail-service
npm install
cp .env.example .env
npm start
```

The start scripts load `.env` automatically. Keep the SMTP authorization code in
`MAIL_SMTP_PASSWORD`; do not commit or paste it into source files.

健康检查：`GET /health`

预留接口：

- `POST /api/email/verify-transport`：检查 SMTP transport 配置
- `POST /api/email/send-verification`：发送验证码，body 为 `{ "to": "...", "code": "..." }`

## 明天需要补的配置

1. `MAIL_ENABLED=true`
2. SMTP 主机、端口、安全模式、用户名和密码
3. `MAIL_FROM`
4. `MAIL_VERIFICATION_SUBJECT`
5. `src/mailer.mjs` 里的最终邮件正文和 HTML 模板
6. 生产环境的 `MAIL_INTERNAL_TOKEN`，并让 FastAPI 的验证码发送适配器调用该服务

服务使用 Nodemailer 的 `createTransport`、`verify` 和 `sendMail` 作为统一发信接口；真正的供应商参数和产品文案留给部署时注入。
