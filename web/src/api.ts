export class ApiError extends Error {
  constructor(public status: number, message: string, public body: any = {}) {
    super(message);
  }
}

export async function api<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.');
  }
  const text = await res.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/api/auth/')) window.dispatchEvent(new Event('imobflow:unauthorized'));
    throw new ApiError(res.status, data.error ?? 'Não foi possível concluir a ação.', data);
  }
  return data as T;
}

export const get = <T = any>(u: string) => api<T>('GET', u);
export const post = <T = any>(u: string, b: unknown = {}) => api<T>('POST', u, b);
export const patch = <T = any>(u: string, b: unknown) => api<T>('PATCH', u, b);
export const put = <T = any>(u: string, b: unknown = {}) => api<T>('PUT', u, b);
export const del = <T = any>(u: string) => api<T>('DELETE', u);

export const qs = (o: Record<string, unknown>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || v === null || v === '' || v === false) continue;
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
};

/** Envia um arquivo (multipart). O navegador define o Content-Type com o boundary. */
export async function upload<T = any>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', file);
  let res: Response;
  try { res = await fetch(url, { method: 'POST', credentials: 'same-origin', body: fd }); }
  catch { throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.'); }
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Não foi possível enviar o arquivo.', data);
  return data as T;
}
