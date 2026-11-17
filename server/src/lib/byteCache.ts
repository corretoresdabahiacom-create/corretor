// Cache em memória limitado por BYTES (não só por quantidade). No Cloudflare Workers a memória do isolate é de 128 MB
// e, sem `sharp`, a "miniatura" é a própria foto: um limite por quantidade (ex.: 400 itens) podia estourar a memória.
import { hasSharp } from './image.js';

export class ByteCache<V extends { data: Buffer }> {
  private m = new Map<string, V>();
  private bytes = 0;
  constructor(private maxBytes: number) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v) { this.m.delete(k); this.m.set(k, v); } // mais recente no fim (LRU)
    return v;
  }
  set(k: string, v: V) {
    const size = v.data.length;
    if (size > this.maxBytes / 4) return; // itens enormes não entram (não expulsam o cache inteiro)
    const old = this.m.get(k);
    if (old) { this.bytes -= old.data.length; this.m.delete(k); }
    this.m.set(k, v); this.bytes += size;
    while (this.bytes > this.maxBytes) {
      const first = this.m.keys().next().value!;
      this.bytes -= this.m.get(first)!.data.length; this.m.delete(first);
    }
  }
  get size() { return this.m.size; }
  get usedBytes() { return this.bytes; }
}

/** Limite padrão por cache: generoso em Node (miniaturas pequenas), contido no Worker (imagens originais). */
export const defaultCacheBytes = () => (hasSharp ? 48 : 12) * 1024 * 1024;
