export function mailConfig(env = process.env) {
  return {
    enabled: String(env.MAIL_ENABLED || 'false').toLowerCase() === 'true',
    port: Number(env.MAIL_PORT || 8025),
    host: env.MAIL_HOST || '127.0.0.1',
    smtpHost: env.MAIL_SMTP_HOST || '',
    smtpPort: Number(env.MAIL_SMTP_PORT || 465),
    smtpSecure: String(env.MAIL_SMTP_SECURE || 'true').toLowerCase() !== 'false',
    smtpUser: env.MAIL_SMTP_USER || '',
    smtpPassword: env.MAIL_SMTP_PASSWORD || '',
    from: env.MAIL_FROM || '',
    verificationSubject: env.MAIL_VERIFICATION_SUBJECT || '',
    internalToken: env.MAIL_INTERNAL_TOKEN || '',
  };
}

export function assertTransportConfig(config) {
  const missing = [];
  if (!config.smtpHost) missing.push('MAIL_SMTP_HOST');
  if (missing.length) throw new Error(`缺少邮件配置: ${missing.join(', ')}`);
}

export function assertMailConfig(config) {
  assertTransportConfig(config);
  const missing = [];
  if (!config.from) missing.push('MAIL_FROM');
  if (!config.verificationSubject) missing.push('MAIL_VERIFICATION_SUBJECT');
  if (missing.length) throw new Error(`缺少邮件配置: ${missing.join(', ')}`);
}
