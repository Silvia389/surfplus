import nodemailer from 'nodemailer';
import { assertMailConfig, assertTransportConfig, mailConfig } from './config.mjs';

export function createMailer(config = mailConfig()) {
  assertTransportConfig(config);
  return nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? {
      user: config.smtpUser,
      pass: config.smtpPassword,
    } : undefined,
  });
}

export async function verifyMailer(config = mailConfig()) {
  const transporter = createMailer(config);
  await transporter.verify();
  return { status: 'ok' };
}

export async function sendVerificationEmail({ to, code }, config = mailConfig()) {
  if (!config.enabled) throw new Error('邮件服务尚未启用');
  assertMailConfig(config);
  const transporter = createMailer(config);
  return transporter.sendMail({
    from: config.from,
    to,
    subject: config.verificationSubject,
    // Keep the copy intentionally unfinished until the product owner supplies it.
    text: `TODO: replace with the approved verification email copy. Code: ${code}`,
  });
}
