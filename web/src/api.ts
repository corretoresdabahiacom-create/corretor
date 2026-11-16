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

/** Reduz e reencoda fotos no navegador: aplica a rotação, remove metadados (EXIF/GPS) e poupa banda e espaço no servidor. */
async function prepareImage(file: File, url: string): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const logo = url.includes('/brand/logo');
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const max = logo ? 800 : 2000, k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d'); if (!ctx) return file;
    if (!logo) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, logo ? 'image/png' : 'image/jpeg', 0.85));
    if (!blob || (blob.size >= file.size && k === 1 && !logo)) return file; // não piora o que já está pequeno
    return new File([blob], file.name.replace(/\.\w+$/, logo ? '.png' : '.jpg'), { type: blob.type });
  } catch { return file; }
}

/** Envia um arquivo (multipart). O navegador define o Content-Type com o boundary. */
export async function upload<T = any>(url: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  if (fields.category !== 'documento') file = await prepareImage(file, url);
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
