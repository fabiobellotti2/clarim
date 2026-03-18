// ============================================================
// CLARIM — categorias.js
// Renderização, CRUD e modal de categorias
// ============================================================

import { $, showToast } from './utils.js';
import { state, fbAdd, fbDelete } from './firebase.js';
import { openModal, closeModal } from './ui.js';

// ── Categorias padrão ─────────────────────────────────────────
export const DEFAULT_CATS = [
  { nome: 'Contas de Casa', icon: '🏠', cor: '#60A5FA', tipo: 'despesa' },
  { nome: 'Alimentação',    icon: '🍽️', cor: '#4FFFB0', tipo: 'despesa' },
  { nome: 'Transporte',     icon: '🚗', cor: '#FFD166', tipo: 'despesa' },
  { nome: 'Saúde',          icon: '❤️', cor: '#FF6B6B', tipo: 'despesa' },
  { nome: 'Educação',       icon: '📚', cor: '#A78BFA', tipo: 'despesa' },
  { nome: 'Lazer',          icon: '🎮', cor: '#F472B6', tipo: 'despesa' },
  { nome: 'Salário',        icon: '💼', cor: '#4FFFB0', tipo: 'receita' },
];

// ── Estado local ──────────────────────────────────────────────
let selectedCor = '#4FFFB0';

// ── Renderização ──────────────────────────────────────────────
export function renderCategorias() {
  const grid = $('cats-grid');
  if (!grid) return;

  const cats = state.allCategorias.length ? state.allCategorias : DEFAULT_CATS;
  grid.innerHTML = cats.map(c => `
    <div class="scard" style="text-align:center;border-top:3px solid ${c.cor || 'var(--green)'}">
      <div style="font-size:1.8rem;margin-bottom:.4rem">${c.icon || '🏷️'}</div>
      <div style="font-size:.82rem;font-weight:600">${c.nome}</div>
      <div style="font-size:.7rem;color:var(--text3);margin-top:.2rem">${c.tipo || ''}</div>
      ${c.id ? `<button class="btn-action btn-del" style="margin-top:.6rem" onclick="window.deletarCategoria('${c.id}')">🗑</button>` : ''}
    </div>`).join('');
}

// ── Ações ─────────────────────────────────────────────────────
export async function deletarCategoria(id) {
  if (!confirm('Remover esta categoria?')) return;
  await fbDelete('categorias', id);
  showToast('Categoria removida.');
}

export async function salvarCategoria() {
  const nome = $('cat-nome')?.value?.trim();
  const icon = $('cat-icon')?.value?.trim() || '🏷️';
  const tipo = $('cat-tipo')?.value || 'despesa';
  if (!nome) return showToast('Informe o nome da categoria.', 'err');
  await fbAdd('categorias', { nome, icon, cor: selectedCor, tipo });
  showToast('Categoria salva ✅');
  closeModal('modal-cat');
}

// ── Inicialização dos event listeners ─────────────────────────
export function initCategorias() {
  // Botão nova categoria
  $('btn-nova-cat')?.addEventListener('click', () => {
    selectedCor = '#4FFFB0';
    $('cat-nome') && ($('cat-nome').value = '');
    $('cat-icon') && ($('cat-icon').value = '');
    // Resetar seleção visual de cor
    document.querySelectorAll('.cor-opt').forEach(o => o.style.border = '2px solid transparent');
    const first = document.querySelector('.cor-opt');
    if (first) first.style.border = '2px solid white';
    openModal('modal-cat');
  });

  // Salvar / cancelar modal categoria
  $('btn-save-cat')?.addEventListener('click',   salvarCategoria);
  $('btn-cancel-cat')?.addEventListener('click', () => closeModal('modal-cat'));

  // Seletor de cores
  document.querySelectorAll('.cor-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedCor = opt.dataset.cor;
      document.querySelectorAll('.cor-opt').forEach(o => o.style.border = '2px solid transparent');
      opt.style.border = '2px solid white';
    });
  });
}
