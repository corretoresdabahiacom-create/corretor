import { config } from './config.js';

export interface Mail { to: string; subject: string; text: string }
export const outbox: Mail[] = []; // usado só com EMAIL_DRIVER=memory (testes)

/** Envia e-mail transacional. Devolve true se foi enviado; false se o envio está desligado. Nunca lança por falha do provedor. */
export async function sendMail(m: Mail): Promise<boolean> {
  const d = config.email.driver;
  if (d === 'none') return false;
  if (d === 'memory') { outbox.push(m); return true; }
  if (d === 'console') { console.log(`[e-mail DEV] para=${m.to} assunto=${m.subject}\n${m.text}`); return true; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${config.email.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: config.email.from, to: [m.to], subject: m.subject, text: m.text }),
    });
    return r.ok;
  } catch { return false; }
}
