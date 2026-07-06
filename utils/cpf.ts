// Utilitários de CPF: máscara para exibição/digitação e validação de dígitos verificadores.

export function unformatCPF(value: string): string {
  return (value || '').replace(/\D/g, '').slice(0, 11);
}

export function formatCPF(value: string): string {
  const digits = unformatCPF(value);
  return digits
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
}

export function isValidCPF(value: string): boolean {
  const cpf = unformatCPF(value);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false; // sequências tipo 111.111.111-11

  const digits = cpf.split('').map(Number);

  const checkDigit = (base: number[]): number => {
    let sum = 0;
    let weight = base.length + 1;
    for (const d of base) {
      sum += d * weight;
      weight--;
    }
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };

  const d1 = checkDigit(digits.slice(0, 9));
  const d2 = checkDigit(digits.slice(0, 10));

  return d1 === digits[9] && d2 === digits[10];
}
