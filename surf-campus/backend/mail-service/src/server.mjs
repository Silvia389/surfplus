import { createServer } from 'node:http';
import { mailConfig } from './config.mjs';
import { sendVerificationEmail, verifyMailer } from './mailer.mjs';

const config = mailConfig();

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function authorized(req) {
  if (!config.internalToken) return true;
  return req.headers.authorization === `Bearer ${config.internalToken}`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    return json(res, 200, { service: 'surf-campus-mail-service', enabled: config.enabled, status: 'ready' });
  }
  if (!authorized(req)) return json(res, 401, { detail: '邮件服务鉴权失败' });
  if (req.method === 'POST' && req.url === '/api/email/verify-transport') {
    try { return json(res, 200, await verifyMailer(config)); } catch (error) { return json(res, 503, { detail: error.message }); }
  }
  if (req.method === 'POST' && req.url === '/api/email/send-verification') {
    try {
      const body = await readJson(req);
      if (!body.to || !body.code) return json(res, 400, { detail: 'to 和 code 是必填项' });
      const result = await sendVerificationEmail({ to: body.to, code: body.code }, config);
      return json(res, 200, { status: 'sent', message_id: result.messageId });
    } catch (error) { return json(res, 503, { detail: error.message }); }
  }
  return json(res, 404, { detail: 'Not found' });
});

server.listen(config.port, config.host, () => {
  console.log(`SURF mail service listening on http://${config.host}:${config.port}`);
});
