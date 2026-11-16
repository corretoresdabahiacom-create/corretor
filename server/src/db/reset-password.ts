// Redefine a senha de um usuário (contas antigas com hash argon2 não entram no Cloudflare Workers).
// Uso: DATABASE_URL=... npm -w server run reset-password -- email@exemplo.com 'NovaSenha123'
import { q1, pool } from './pool.js';
import { hashPassword, passwordProblem } from '../lib/auth.js';

const [email, senha] = process.argv.slice(2);
if (!email || !senha) { console.error('Uso: reset-password <email> <nova senha>'); process.exit(1); }
const problem = passwordProblem(senha);
if (problem) { console.error(problem); process.exit(1); }
const u = await q1<{ id: string }>('UPDATE users SET password_hash=$2, updated_at=now() WHERE lower(email)=lower($1) RETURNING id', [email, await hashPassword(senha)]);
if (u) await q1('DELETE FROM sessions WHERE user_id=$1 RETURNING 1', [u.id]);
console.log(u ? 'Senha redefinida; sessões antigas encerradas.' : 'Usuário não encontrado.');
await pool.end();
