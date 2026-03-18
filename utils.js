// ============================================================
// CLARIM — utils.js
// Funções utilitárias puras (sem dependências do projeto)
// ============================================================

export const $ = id => document.getElementById(id);

export function showEl(id) {
  const e = $(id);
  if (!e) return;
  if (id === 'login-screen') e.style.display = 'flex';
  else if (id === 'app')     e.style.display = 'block';
  else                       e.style.display = '';
}

export function hideEl(id) {
  const e = $(id);
  if (e) e.style.display = 'none';
}

export function setAuthError(msg) {
  const el = $('auth-error');
  if (!el) return;
  if (msg) { el.textContent = msg; el.style.display = ''; }
  else     { el.style.display = 'none'; }
}

export function showToast(msg, type = 'ok') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + (type === 'err' ? 'toast-err' : '');
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

export function fmt(val) {
  return 'R$ ' + Number(val || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

export const MONTHS = [
  'Janeiro','Fevereiro','Março','Abril','Maio','Junho',
  'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'
];

export function converterValorBR(valor) {
  if (valor === null || valor === undefined) return 0;
  if (typeof valor === 'number') return isNaN(valor) ? 0 : valor;
  let texto = String(valor).trim();
  if (!texto) return 0;
  texto = texto.replace(/\s/g, '').replace(/R\$/gi, '').replace(/[^\d,.-]/g, '');
  if (texto.includes(',') && texto.includes('.')) {
    texto = texto.replace(/\./g, '').replace(',', '.');
  } else if (texto.includes(',')) {
    texto = texto.replace(',', '.');
  }
  const numero = parseFloat(texto);
  return isNaN(numero) ? 0 : numero;
}

export function normalizarDataExcel(valor) {
  if (!valor) return '';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  if (typeof valor === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
    const [d, m, y] = valor.split('/');
    return `${y}-${m}-${d}`;
  }
  if (typeof valor === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + valor * 86400000);
    return date.toISOString().slice(0, 10);
  }
  return '';
}
