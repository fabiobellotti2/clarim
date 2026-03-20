// ============================================================
// CLARIM — categorias.js
// Renderização, CRUD e seletor visual de ícones
// ============================================================

import { $, showToast } from './utils.js';
import { state, fbAdd, fbUpdate, fbDelete, fbBatch } from './firebase.js';
import { openModal, closeModal } from './ui.js';

// ── Biblioteca de ícones ──────────────────────────────────────
export const ICON_LIBRARY = [
  // Casa & Moradia
  '🏠','🏡','🏢','🔑','💡','🛋️','🧹','🪴',
  // Alimentação
  '🍽️','🍔','🍕','🥗','☕','🛒','🍱','🥩',
  // Transporte
  '🚗','🚌','✈️','⛽','🚂','🛵','🚲','🚕',
  // Saúde
  '❤️','💊','🏥','🩺','🧘','🦷','👶','💉',
  // Educação
  '📚','🎓','✏️','💻','📖','🔬','🎒','🖊️',
  // Lazer & Entretenimento
  '🎮','🎬','🎵','⚽','🎨','🏊','🎪','📺',
  // Vestuário & Compras
  '👕','👟','🛍️','💄','👜','⌚','👒','🕶️',
  // Finanças & Trabalho
  '💰','💳','📈','🏦','💸','💼','📊','🤝',
  // Pets & Natureza
  '🐶','🐱','🐾','🌿','🐠','🦜','🌳','🌻',
  // Utilidades
  '⚡','💧','📱','🔧','🌐','📡','🔒','🖥️',
  // Especiais
  '🎁','🙏','👨‍👩‍👧','🌍','🏋️','🎯','⭐','🏷️',
];

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
let selectedCor  = '#4FFFB0';
let selectedIcon = '🏷️';
let editingCatId = null;       // null = criação, string = edição
let searchTerm   = '';         // filtro de busca persistente entre renders
let filterType   = 'todos';   // 'todos' | 'despesa' | 'receita'

// ── Estado da operação de renomeação pendente ─────────────────
// Mantém os dados enquanto o usuário decide no modal de confirmação
let _pendingRename = null;  // { id, nomeAntigo, nomeNovo, payload }

// ── Helper: ícone de uma categoria por nome ───────────────────
/**
 * Retorna o ícone de uma categoria buscando em state.allCategorias
 * e fazendo fallback para DEFAULT_CATS e depois para '🏷️'.
 * @param {string} nome
 */
export function getCatIcon(nome) {
  if (!nome) return '🏷️';
  return (
    state.allCategorias.find(c => c.nome === nome)?.icon ||
    DEFAULT_CATS.find(c => c.nome === nome)?.icon ||
    '🏷️'
  );
}

// ── Renderização da grade de ícones no modal ──────────────────
function renderIconGrid() {
  const grid = $('cat-icon-grid');
  if (!grid) return;
  grid.innerHTML = ICON_LIBRARY.map(icon =>
    `<button type="button" class="icon-opt${icon === selectedIcon ? ' selected' : ''}"
             data-icon="${icon}" title="${icon}">${icon}</button>`
  ).join('');
}

// ── Abre o modal (criação ou edição) ──────────────────────────
export function abrirModalCategoria(id = null) {
  editingCatId = id;

  const titleEl = $('cat-modal-title');

  if (id) {
    // ── Modo edição: preenche com dados da categoria existente ──
    const cat = state.allCategorias.find(c => c.id === id);
    if (!cat) return showToast('Categoria não encontrada.', 'err');

    selectedIcon = cat.icon || '🏷️';
    selectedCor  = cat.cor  || '#4FFFB0';

    if (titleEl) titleEl.textContent = 'Editar Categoria';
    $('cat-nome') && ($('cat-nome').value = cat.nome || '');
    $('cat-tipo') && ($('cat-tipo').value = cat.tipo || 'despesa');

    // Destaca a cor salva
    document.querySelectorAll('.cor-opt').forEach(o => {
      o.style.border = o.dataset.cor === selectedCor ? '2px solid white' : '2px solid transparent';
    });

    // Limite mensal
    const limAtivoEl = $('cat-limite-ativo');
    const limWrap    = $('cat-limite-wrap');
    const limValorEl = $('cat-limite-valor');
    if (limAtivoEl) limAtivoEl.checked = !!cat.limiteAtivo;
    if (limValorEl) limValorEl.value   = cat.valorLimite > 0 ? cat.valorLimite : '';
    if (limWrap)    limWrap.style.display = cat.limiteAtivo ? '' : 'none';
  } else {
    // ── Modo criação: reset completo ────────────────────────────
    selectedIcon = '🏷️';
    selectedCor  = '#4FFFB0';

    if (titleEl) titleEl.textContent = 'Nova Categoria';
    $('cat-nome') && ($('cat-nome').value = '');
    $('cat-tipo') && ($('cat-tipo').value = 'despesa');

    document.querySelectorAll('.cor-opt').forEach(o => o.style.border = '2px solid transparent');
    const first = document.querySelector('.cor-opt');
    if (first) first.style.border = '2px solid white';

    // Limite mensal — reset
    const limAtivoEl = $('cat-limite-ativo');
    const limWrap    = $('cat-limite-wrap');
    const limValorEl = $('cat-limite-valor');
    if (limAtivoEl) limAtivoEl.checked  = false;
    if (limValorEl) limValorEl.value    = '';
    if (limWrap)    limWrap.style.display = 'none';
  }

  // Renderiza grade e atualiza preview com o ícone correto marcado
  renderIconGrid();
  const preview = $('cat-icon-preview');
  if (preview) preview.textContent = selectedIcon;

  openModal('modal-cat');
}

// ── Aplica busca por texto E filtro por tipo ─────────────────
function _filterCats() {
  const term = searchTerm.toLowerCase().trim();
  let visible = 0;

  document.querySelectorAll('#cats-grid .scard[data-nome]').forEach(card => {
    const nomeMatch = !term || card.dataset.nome.includes(term);
    const tipoMatch = filterType === 'todos' || card.dataset.tipo === filterType;
    const show = nomeMatch && tipoMatch;
    card.classList.toggle('cat-hidden', !show);
    if (show) visible++;
  });

  const isFiltered = term || filterType !== 'todos';
  const emptyEl = $('cats-empty-state');
  if (emptyEl) emptyEl.style.display = (isFiltered && visible === 0) ? '' : 'none';
}

// ── Renderização da página de categorias ──────────────────────
export function renderCategorias() {
  const gridEl = $('cats-grid');
  if (!gridEl) return;

  const cats = state.allCategorias.length ? state.allCategorias : DEFAULT_CATS;
  gridEl.innerHTML = cats.map(c => `
    <div class="scard cat-card" data-nome="${(c.nome || '').toLowerCase()}" data-tipo="${c.tipo || 'despesa'}"
         style="text-align:center;border-top:3px solid ${c.cor || 'var(--green)'}">
      <div style="font-size:1.8rem;margin-bottom:.4rem">${c.icon || '🏷️'}</div>
      <div style="font-size:.82rem;font-weight:600">${c.nome}</div>
      <div class="cat-tipo-badge">${c.tipo || 'despesa'}</div>
      ${c.id ? `
        <div style="display:flex;gap:.4rem;justify-content:center;margin-top:.6rem">
          <button class="btn-action" onclick="window.abrirModalCategoria('${c.id}')" title="Editar">✏️</button>
          <button class="btn-action btn-del" onclick="window.deletarCategoria('${c.id}')" title="Remover">🗑</button>
        </div>` : ''}
    </div>`).join('');

  // Reaplica o filtro atual (preserva busca ativa após onSnapshot)
  _filterCats();
}

// ── Ações ─────────────────────────────────────────────────────
export async function deletarCategoria(id) {
  if (!confirm('Remover esta categoria?')) return;
  await fbDelete('categorias', id);
  showToast('Categoria removida.');
}

export async function salvarCategoria() {
  const nome        = $('cat-nome')?.value?.trim();
  const tipo        = $('cat-tipo')?.value || 'despesa';
  const limiteAtivo = !!$('cat-limite-ativo')?.checked;
  const valorLimite = limiteAtivo ? (parseFloat($('cat-limite-valor')?.value) || 0) : 0;

  if (!nome) return showToast('Informe o nome da categoria.', 'err');
  if (limiteAtivo && !valorLimite) return showToast('Informe o valor do limite mensal.', 'err');

  const payload = { nome, icon: selectedIcon, cor: selectedCor, tipo, limiteAtivo, valorLimite };

  if (editingCatId) {
    const catAtual    = state.allCategorias.find(c => c.id === editingCatId);
    const nomeOriginal = catAtual?.nome || '';

    // ── Nome mudou → abre modal de confirmação de impacto ───────
    if (nome !== nomeOriginal) {
      _abrirRenomearModal(editingCatId, nomeOriginal, nome, payload);
      return;
    }

    // ── Apenas outros campos mudaram → salva direto ─────────────
    await fbUpdate('categorias', editingCatId, payload);
    showToast('Categoria atualizada ✅');
    editingCatId = null;
    closeModal('modal-cat');
    return;
  }

  // ── Criação ──────────────────────────────────────────────────
  await fbAdd('categorias', payload);
  showToast('Categoria criada ✅');
  closeModal('modal-cat');
}

// ── Popula e abre o modal de confirmação de renomeação ────────
function _abrirRenomearModal(id, nomeAntigo, nomeNovo, payload) {
  _pendingRename = { id, nomeAntigo, nomeNovo, payload };

  // Contagem de registros afetados
  const nLanc  = state.allLancamentos.filter(l => l.categoria === nomeAntigo).length;
  const nRec   = state.allReceitas.filter(r => r.categoria === nomeAntigo).length;
  const total  = nLanc + nRec;

  const alertEl = $('rename-alert');
  if (alertEl) {
    alertEl.innerHTML =
      `Você está renomeando <b>"${nomeAntigo}"</b> para <b>"${nomeNovo}"</b>.`;
  }

  const impactEl = $('rename-impact');
  if (impactEl) {
    impactEl.innerHTML = total > 0
      ? `Isso afetará <b>${total}</b> lançamento(s) existente(s) &nbsp;
         <span style="color:var(--text3)">(${nLanc} despesa(s) · ${nRec} receita(s))</span>.`
      : `Nenhum lançamento existente usa esta categoria.`;
  }

  // Texto dinâmico das opções
  const optADesc = $('rename-opt-a-desc');
  if (optADesc) {
    optADesc.textContent = total > 0
      ? `Atualizar ${total} lançamento(s) para "${nomeNovo}". Recomendado para manter os gráficos corretos.`
      : `Nenhum lançamento para atualizar — categoria ainda não tem uso.`;
  }
  const optBDesc = $('rename-opt-b-desc');
  if (optBDesc) {
    optBDesc.textContent =
      `Manter os ${total} lançamento(s) anteriores como "${nomeAntigo}". ` +
      `Apenas novos lançamentos usarão "${nomeNovo}".`;
  }

  // Garante Opção A selecionada e sincroniza visual
  const radioA = document.querySelector('input[name="rename-choice"][value="a"]');
  if (radioA) radioA.checked = true;
  _syncRenameOpts();

  openModal('modal-rename-cat');
}

/** Atualiza a classe .rename-opt-active conforme o radio checado */
function _syncRenameOpts() {
  const val = document.querySelector('input[name="rename-choice"]:checked')?.value;
  $('rename-opt-a')?.classList.toggle('rename-opt-active', val === 'a');
  $('rename-opt-b')?.classList.toggle('rename-opt-active', val === 'b');
}

/** Executa a operação após o usuário confirmar no modal */
async function _confirmarRenomear() {
  if (!_pendingRename) return;
  const { id, nomeAntigo, nomeNovo, payload } = _pendingRename;
  const choice = document.querySelector('input[name="rename-choice"]:checked')?.value || 'b';

  const btn = $('btn-confirm-rename');
  if (btn) { btn.disabled = true; btn.textContent = 'Salvando…'; }

  try {
    // 1. Salva a categoria com o novo nome (sempre)
    await fbUpdate('categorias', id, payload);

    if (choice === 'a') {
      // 2. Batch update em despesas e receitas com o nome antigo
      const lancUpdates = state.allLancamentos
        .filter(l => l.categoria === nomeAntigo)
        .map(l => ({ id: l.id, data: { categoria: nomeNovo } }));

      const recUpdates = state.allReceitas
        .filter(r => r.categoria === nomeAntigo)
        .map(r => ({ id: r.id, data: { categoria: nomeNovo } }));

      if (lancUpdates.length) await fbBatch('lancamentos', lancUpdates);
      if (recUpdates.length)  await fbBatch('receitas',    recUpdates);

      const total = lancUpdates.length + recUpdates.length;
      showToast(`✅ "${nomeNovo}" salvo · ${total} lançamento(s) atualizados.`);
    } else {
      showToast(`✅ Categoria renomeada para "${nomeNovo}". Histórico preservado.`);
    }

    _pendingRename = null;
    editingCatId   = null;
    closeModal('modal-rename-cat');
    closeModal('modal-cat');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirmar Mudança'; }
  }
}

// ── Inicialização dos event listeners ─────────────────────────
export function initCategorias() {
  // Botão nova categoria delega para abrirModalCategoria
  $('btn-nova-cat')?.addEventListener('click', () => abrirModalCategoria(null));

  // Preenche o texto do empty state (feito uma vez, não a cada render)
  const emptyEl = $('cats-empty-state');
  if (emptyEl) emptyEl.textContent = 'Nenhuma categoria encontrada com este nome.';

  // Busca em tempo real
  $('search-cat')?.addEventListener('input', function () {
    searchTerm = this.value;
    _filterCats();
  });

  // Filtro por tipo (segmented control)
  document.querySelectorAll('.cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      filterType = btn.dataset.tipo;
      document.querySelectorAll('.cat-filter-btn')
        .forEach(b => b.classList.toggle('active', b === btn));
      _filterCats();
    });
  });

  // Seleção de ícone (delegação no grid)
  $('cat-icon-grid')?.addEventListener('click', e => {
    const btn = e.target.closest('.icon-opt');
    if (!btn) return;
    selectedIcon = btn.dataset.icon;
    const preview = $('cat-icon-preview');
    if (preview) preview.textContent = selectedIcon;
    document.querySelectorAll('#cat-icon-grid .icon-opt')
      .forEach(o => o.classList.toggle('selected', o === btn));
  });

  // Toggle de limite mensal — mostra/oculta o input de valor
  $('cat-limite-ativo')?.addEventListener('change', function () {
    const wrap = $('cat-limite-wrap');
    if (wrap) wrap.style.display = this.checked ? '' : 'none';
    if (!this.checked) { const v = $('cat-limite-valor'); if (v) v.value = ''; }
  });

  // Salvar / cancelar — modal principal
  $('btn-save-cat')?.addEventListener('click', salvarCategoria);
  $('btn-cancel-cat')?.addEventListener('click', () => {
    editingCatId = null;
    closeModal('modal-cat');
  });

  // Modal de confirmação de renomeação
  document.querySelectorAll('input[name="rename-choice"]').forEach(r => {
    r.addEventListener('change', _syncRenameOpts);
  });
  $('btn-confirm-rename')?.addEventListener('click', _confirmarRenomear);
  $('btn-cancel-rename')?.addEventListener('click', () => {
    _pendingRename = null;
    closeModal('modal-rename-cat');
  });

  // Seletor de cores
  document.querySelectorAll('.cor-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedCor = opt.dataset.cor;
      document.querySelectorAll('.cor-opt').forEach(o => o.style.border = '2px solid transparent');
      opt.style.border = '2px solid white';
    });
  });
}
