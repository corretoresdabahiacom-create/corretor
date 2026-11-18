// Conversão e compressão de vídeo no próprio navegador (sem servidor, sem custo): o vídeo é tocado, redesenhado em tamanho menor
// e regravado com MediaRecorder em MP4 (H.264) ou WebM. Leva o tempo do vídeo (grava em tempo real) e a aba precisa ficar aberta.
export const VIDEO_LIMIT = 30 * 1024 * 1024;
export const MAX_SECONDS = 600;

export const isDirectVideo = (f: File) => /^video\/(mp4|webm)$/.test(f.type) && f.size <= VIDEO_LIMIT;

export function recorderType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? null;
}

/** Bits por segundo de vídeo para o resultado caber no limite (descontando o áudio). */
export function videoBitrate(seconds: number, maxBytes = VIDEO_LIMIT * 0.9, audioBps = 96_000) {
  return Math.min(2_500_000, Math.floor((maxBytes * 8) / seconds - audioBps));
}

export async function convertVideo(file: File, onProgress: (pct: number) => void, signal?: AbortSignal): Promise<File> {
  const type = recorderType();
  if (!type || !('captureStream' in HTMLCanvasElement.prototype)) throw new Error('Este navegador não consegue converter vídeo. Exporte o vídeo como MP4 (H.264) ou WebM e envie de novo.');
  const url = URL.createObjectURL(file);
  const v = document.createElement('video'); v.src = url; v.playsInline = true; v.preload = 'auto';
  let ac: AudioContext | null = null;
  try {
    await new Promise<void>((ok, bad) => { v.onloadedmetadata = () => ok(); v.onerror = () => bad(new Error('Este navegador não consegue abrir este vídeo. Exporte como MP4 (H.264) ou WebM.')); });
    const dur = v.duration;
    if (!Number.isFinite(dur) || dur <= 0) throw new Error('Não consegui ler a duração do vídeo.');
    if (dur > MAX_SECONDS) throw new Error('Vídeo com mais de 10 minutos. Use um link do YouTube ou Vimeo.');
    const vbps = videoBitrate(dur);
    if (vbps < 350_000) throw new Error(`Vídeo longo demais para o limite de ${Math.round(VIDEO_LIMIT / 1048576)} MB. Corte o vídeo ou use um link do YouTube/Vimeo.`);
    const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.max(2, Math.round((v.videoWidth * k) / 2) * 2), h = Math.max(2, Math.round((v.videoHeight * k) / 2) * 2);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const ctx = c.getContext('2d')!;
    const tracks: MediaStreamTrack[] = [...c.captureStream(30).getVideoTracks()];
    try { // áudio sem tocar no alto-falante
      ac = new AudioContext(); const dest = ac.createMediaStreamDestination();
      ac.createMediaElementSource(v).connect(dest); tracks.push(...dest.stream.getAudioTracks());
    } catch { /* sem áudio */ }
    const rec = new MediaRecorder(new MediaStream(tracks), { mimeType: type, videoBitsPerSecond: vbps, audioBitsPerSecond: 96_000 });
    const chunks: Blob[] = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise<void>((ok) => { rec.onstop = () => ok(); });
    let stop = false;
    const draw = () => { if (stop) return; ctx.drawImage(v, 0, 0, w, h); onProgress(Math.min(99, Math.round((v.currentTime / dur) * 100))); requestAnimationFrame(draw); };
    const fail = new Promise<never>((_, bad) => { v.onerror = () => bad(new Error('Falha ao reproduzir o vídeo durante a conversão.')); signal?.addEventListener('abort', () => bad(new Error('Conversão cancelada.'))); });
    rec.start(1000); await v.play(); draw();
    await Promise.race([new Promise<void>((ok) => { v.onended = () => ok(); }), fail]);
    stop = true; rec.stop(); await done;
    const blob = new Blob(chunks, { type: type.split(';')[0] });
    if (blob.size > VIDEO_LIMIT) throw new Error(`O vídeo convertido ficou com ${(blob.size / 1048576).toFixed(0)} MB (limite ${Math.round(VIDEO_LIMIT / 1048576)} MB). Corte o vídeo ou use um link do YouTube/Vimeo.`);
    onProgress(100);
    return new File([blob], file.name.replace(/\.\w+$/, '') + (blob.type === 'video/mp4' ? '.mp4' : '.webm'), { type: blob.type });
  } finally { v.pause(); v.removeAttribute('src'); v.load(); URL.revokeObjectURL(url); ac?.close().catch(() => {}); }
}
