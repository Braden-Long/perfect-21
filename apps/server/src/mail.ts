import nodemailer from 'nodemailer';

export type SendMail = (to: string, subject: string, text: string) => Promise<void>;

/**
 * Build the transactional mail sender from the environment, or null when
 * email recovery should stay disabled.
 *
 *   SMTP_URL   e.g. smtps://user:pass@smtp.example.com:465  (required)
 *   MAIL_FROM  e.g. "Perfect 21 <no-reply@perfect21.example>" (required)
 *
 * Any transactional provider (Resend, Postmark, SES, Mailgun…) exposes SMTP
 * credentials that drop straight in here.
 */
export function createMailer(env: NodeJS.ProcessEnv = process.env): SendMail | null {
  const url = env.SMTP_URL;
  const from = env.MAIL_FROM;
  if (!url || !from) return null;
  const transport = nodemailer.createTransport(url);
  return async (to, subject, text) => {
    await transport.sendMail({ from, to, subject, text });
  };
}
