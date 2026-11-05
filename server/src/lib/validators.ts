export const digits = (s: string) => s.replace(/\D/g, '');

export function isValidCPF(input: string): boolean {
  const c = digits(input);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export function isValidCNPJ(input: string): boolean {
  const c = digits(input);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(c[i]) * weights[i];
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

export function isValidDocument(kind: 'fisica' | 'juridica', doc: string): boolean {
  return kind === 'fisica' ? isValidCPF(doc) : isValidCNPJ(doc);
}

export const normalizePhone = (p: string) => digits(p);
export const isValidPhone = (p: string) => {
  const d = digits(p);
  // 10/11 dígitos (DDD + número) ou com DDI 55
  return /^(55)?\d{10,11}$/.test(d);
};
export const isValidCEP = (c: string) => digits(c).length === 8;
