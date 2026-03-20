// ============================================================
// CLARIM — despesas.js
// Renderização, CRUD, modais e importação de despesas
// ============================================================

import { $, fmt, fmtDate, showToast, converterValorBR, normalizarDataExcel, MONTHS } from './utils.js';
import { state, fbAdd, fbUpdate, fbDelete, fbBatch } from './firebase.js';
import { openModal, closeModal, badgeStatus, populateCatFiltro } from './ui.js';
import { atualizarSaldoConta, atualizarLimiteCartao } from './contas.js';
import { getCatIcon, DEFAULT_CATS } from './categorias.js';

// ── Estado local ──────────────────────────────────────────────
let currentTipo    = 'debito';
let currentRec     = 'unico';
let editingId      = null;
let baixaLancId    = null;
let baixaValorOrig = 0;
const selectedIds  = new Set();

// ── Estado do filtro de período (persiste entre mudanças de aba) ──
let despMode = 'mes';   // 'mes' | 'periodo'
// ── Estado de ordenação da tabela ─────────────────────────────
let despSortCol = 'data';    // coluna ativa
let despSortDir = 'desc';   // 'asc' | 'desc'
let despMesAtual = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
let despInicio = '';
let despFim    = '';

// ── Estado da importação pendente ─────────────────────────────
let pendingRows = [];

// ── Builder de linha individual ───────────────────────────────
function _buildRowHtml(l) {
  const st       = calcStatusDinamico(l);
  const valorExib = _vt(l);
  return `
  <div class="tbl-row desp-grid" data-id="${l.id}">
    <div style="display:flex;align-items:center;justify-content:center">
      <input type="checkbox" class="row-cb" data-id="${l.id}"${selectedIds.has(l.id) ? ' checked' : ''}>
    </div>
    <div class="td-date">${fmtDate(l.data)}</div>
    <div class="td-date" style="color:${l.dataPagamento ? 'var(--text2)' : 'var(--text3)'}">${l.dataPagamento ? fmtDate(l.dataPagamento) : '—'}</div>
    <div class="td-desc">${l.descricao || '—'}</div>
    <div class="td-cat" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${getCatIcon(l.categoria)} ${l.categoria || '—'}</div>
    <div style="text-align:right;font-weight:600">${fmt(valorExib)}</div>
    <div style="text-align:center">
      ${st === 'pago'
        ? `<span class="badge-rev" title="Clique para reverter para Pendente" onclick="window.reverterPago('${l.id}')">${badgeStatus('pago')}</span>`
        : badgeStatus(st)}
    </div>
    <div style="display:flex;gap:.4rem;justify-content:flex-end">
      <button class="btn-action" onclick="window.abrirDetalhesDespesa('${l.id}')" title="Editar">✏️</button>
      ${st !== 'pago' ? `<button class="btn-action" onclick="window.abrirBaixa('${l.id}')">✓ Pagar</button>` : ''}
      <button class="btn-action btn-del" onclick="window.deletarLancamento('${l.id}')">🗑</button>
    </div>
  </div>`;
}

/**
 * Atualiza cirurgicamente apenas a linha correspondente ao id,
 * sem re-renderizar a tabela inteira. Usado pelo fluxo otimista e
 * pelo handler clarim:lancamentos quando a mudança é só 'modified'.
 */
export function patchRowDespesa(id) {
  const l   = state.allLancamentos.find(x => x.id === id);
  const row = document.querySelector(`#desp-body .tbl-row[data-id="${id}"]`);
  if (!row) return; // linha não está visível (filtro ativo) — ignora
  if (!l) { row.remove(); return; } // item deletado
  const tpl = document.createElement('template');
  tpl.innerHTML = _buildRowHtml(l).trim();
  row.replaceWith(tpl.content.firstElementChild);
}

// ── Renderização ──────────────────────────────────────────────
export function renderDespesas() {
  const body = $('desp-body');
  if (!body) return;

  const cols = 'desp-grid'; // classe CSS — ver style.css: 32px 90px 90px 1fr 140px 110px 85px 125px
  const head = $('desp-head');
  // A classe desp-grid já está no HTML; apenas garante que está presente (sem inline style)
  if (head && !head.classList.contains('desp-grid')) head.classList.add('desp-grid');

  const searchTerm = $('desp-search')?.value?.toLowerCase() || '';
  const catFil     = $('desp-cat')?.value    || '';
  const contaFil   = $('desp-conta')?.value  || '';
  const stFil      = $('desp-status')?.value || '';

  let data = [...state.allLancamentos];
  if (searchTerm) data = data.filter(l => (l.descricao || '').toLowerCase().includes(searchTerm));

  // Filtro de período (estado persistente entre mudanças de aba)
  if (despMode === 'periodo' && despInicio && despFim) {
    data = data.filter(l => l.data && l.data >= despInicio && l.data <= despFim);
  } else if (despMode === 'mes' && despMesAtual) {
    data = data.filter(l => (l.data || '').slice(0, 7) === despMesAtual);
  }

  if (catFil)     data = data.filter(l => l.categoria === catFil);
  if (contaFil) {
    const contaNome = state.allContas.find(c => c.id === contaFil)?.nome;
    data = data.filter(l => l.contaId === contaFil || (contaNome && l.conta === contaNome));
  }
  // Filtro de status usa o status computado (não o armazenado)
  if (stFil) data = data.filter(l => calcStatusDinamico(l) === stFil);

  // Ordenação por coluna (estado persistente)
  data.sort((a, b) => {
    let va, vb;
    switch (despSortCol) {
      case 'data':
        va = a.data || ''; vb = b.data || ''; break;
      case 'descricao':
        va = (a.descricao || '').toLowerCase(); vb = (b.descricao || '').toLowerCase(); break;
      case 'categoria':
        va = (a.categoria || '').toLowerCase(); vb = (b.categoria || '').toLowerCase(); break;
      case 'pagamento':
        va = a.dataPagamento || ''; vb = b.dataPagamento || ''; break;
      case 'valor':
        va = _vt(a); vb = _vt(b); break;
      case 'status': {
        const order = { pago: 0, avencer: 1, atrasado: 2 };
        va = order[calcStatusDinamico(a)] ?? 3;
        vb = order[calcStatusDinamico(b)] ?? 3; break;
      }
      default: va = ''; vb = '';
    }
    if (va < vb) return despSortDir === 'asc' ? -1 : 1;
    if (va > vb) return despSortDir === 'asc' ?  1 : -1;
    return 0;
  });

  if (!data.length) {
    body.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text3)">Nenhuma despesa encontrada.</div>`;
    syncMasterCb();
    return;
  }

  body.innerHTML = data.map(l => _buildRowHtml(l)).join('');

  populateCatFiltro('desp-cat', state.allLancamentos);
  _syncNavUI();
  _updateSortArrows();

  // Popula filtro de conta preservando seleção atual
  const contaSel = $('desp-conta');
  if (contaSel && state.allContas.length) {
    const cur = contaSel.value;
    contaSel.innerHTML = '<option value="">Todas as contas</option>'
      + state.allContas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    if (cur) contaSel.value = cur;
  }

  syncMasterCb();
}

// ── Ações ─────────────────────────────────────────────────────

/**
 * Calcula a referência de fatura (YYYY-MM) considerando o dia de fechamento.
 * Se a compra foi feita APÓS o fechamento, pertence à fatura do próximo mês.
 */
function calcFaturaRef(cartaoId, dataCompra) {
  if (!dataCompra) return '';
  const cartao     = state.allCartoes.find(c => c.id === cartaoId);
  const fechamento = parseInt(cartao?.fechamento) || 0;
  const [y, m, d]  = dataCompra.split('-').map(Number);
  if (fechamento > 0 && d > fechamento) {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    return `${nextY}-${String(nextM).padStart(2, '0')}`;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * Calcula o status visual de um lançamento em tempo real.
 * Independente do valor armazenado em Firestore (exceto 'pago').
 */
function calcStatusDinamico(l) {
  if (l.status === 'pago') return 'pago';
  const hoje = new Date().toISOString().slice(0, 10);
  return (l.data && l.data < hoje) ? 'atrasado' : 'avencer';
}

/**
 * Resolve o valor efetivo de um lançamento com retrocompatibilidade.
 * Prioridade: valorTotal → (valorOriginal + valorAjuste) → valor legado
 */
function _vt(l) {
  if (l.valorTotal !== undefined && l.valorTotal !== null && l.valorTotal !== '') return Number(l.valorTotal);
  if (l.valorOriginal !== undefined) return Number(l.valorOriginal || 0) + Number(l.valorAjuste || 0);
  return Number(l.valor || 0);
}

/** Resolve o contaId de um lancamento: usa contaId salvo ou busca por nome. */
function resolverContaId(l) {
  if (l.contaId) return l.contaId;
  return state.allContas.find(c => c.nome === l.conta)?.id || null;
}

/** Popula o <select id="f-conta"> com state.allContas, pré-selecionando por ID. */
function populateFContaSel(preSelectId) {
  const sel = $('f-conta');
  if (!sel) return;
  sel.innerHTML = '<option value="">— Selecione a conta —</option>'
    + state.allContas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
  if (preSelectId) sel.value = preSelectId;
}

export async function marcarPago(id) {
  const l = state.allLancamentos.find(x => x.id === id);
  if (!l) return;

  const hoje    = new Date().toISOString().slice(0, 10);
  const payload = { status: 'pago', dataPagamento: hoje };

  // Subtrai do saldo da conta (débito/dinheiro apenas)
  if (l.tipo !== 'cartao') {
    const contaId = resolverContaId(l);
    if (contaId) {
      payload.contaId = contaId;
      await atualizarSaldoConta(contaId, l.valor, 'subtracao');
    }
  }

  await fbUpdate('lancamentos', id, payload);
  showToast('Marcado como pago ✅');
}

export async function deletarLancamento(id) {
  if (!confirm('Deseja excluir este lançamento?')) return;
  const l = state.allLancamentos.find(x => x.id === id);
  await fbDelete('lancamentos', id);
  // Restaura limite do cartão se o item não havia sido pago
  if (l?.tipo === 'cartao' && l.cartaoId && l.status !== 'pago') {
    await atualizarLimiteCartao(l.cartaoId, l.valor, 'soma');
  }
  showToast('Lançamento excluído.');
}

// ── Reversão de status ────────────────────────────────────────
export async function reverterPago(id) {
  if (!confirm('Reverter este lançamento para "Pendente"?')) return;
  const l = state.allLancamentos.find(x => x.id === id);
  if (!l) return;

  // Snapshot para rollback
  const snap = { ...l };
  const valorParaEstorno = _vt(l);
  const contaIdParaEstorno = l.tipo !== 'cartao' ? resolverContaId(l) : null;

  // 1. Atualização otimista — DOM reage instantaneamente
  Object.assign(l, { status: 'pendente', dataPagamento: '', valorAjuste: 0, valorTotal: '' });
  patchRowDespesa(id);

  try {
    if (contaIdParaEstorno) await atualizarSaldoConta(contaIdParaEstorno, valorParaEstorno, 'soma');
    await fbUpdate('lancamentos', id, { status: 'pendente', dataPagamento: '', valorAjuste: 0, valorTotal: '' });
    showToast('Status revertido para Pendente.');
  } catch {
    // Rollback: restaura estado local e re-renderiza a linha
    Object.assign(l, snap);
    patchRowDespesa(id);
    showToast('Falha ao reverter. O status foi restaurado.', 'err');
  }
}

// ── Modal de Baixa (Pagamento) ────────────────────────────────
export function abrirBaixa(id) {
  const l = state.allLancamentos.find(x => x.id === id);
  if (!l) return;

  baixaLancId    = id;
  baixaValorOrig = parseFloat(l.valor) || 0;

  // Caixa de resumo do lançamento
  const box = $('baixa-box');
  if (box) box.innerHTML = `
    <div class="baixa-row"><span>Descrição</span><span>${l.descricao || '—'}</span></div>
    <div class="baixa-row"><span>Vencimento</span><span>${fmtDate(l.data)}</span></div>
    <div class="baixa-row"><span>Valor original</span><span style="font-weight:600;color:var(--red)">${fmt(baixaValorOrig)}</span></div>
    ${l.categoria ? `<div class="baixa-row"><span>Categoria</span><span>${l.categoria}</span></div>` : ''}`;

  // Popula select de contas com saldo atual visível
  const selConta = $('b-conta');
  if (selConta) {
    selConta.innerHTML = state.allContas.length
      ? state.allContas.map(c =>
          `<option value="${c.id}">${c.nome} — ${fmt(parseFloat(c.saldo) || 0)}</option>`
        ).join('')
      : '<option value="">Nenhuma conta cadastrada</option>';
    const contaIdAtual = resolverContaId(l);
    if (contaIdAtual) selConta.value = contaIdAtual;
  }

  // Padrões: data = hoje, valor = valor original, ajuste = zerado
  $('b-datapag')    && ($('b-datapag').value    = new Date().toISOString().slice(0, 10));
  $('b-valor-final')&& ($('b-valor-final').value = baixaValorOrig.toFixed(2));
  $('b-ajuste')     && ($('b-ajuste').value      = '');
  $('b-obs')        && ($('b-obs').value         = '');

  openModal('modal-baixa');
}

async function confirmarBaixa() {
  const contaId   = $('b-conta')?.value;
  const dataPag   = $('b-datapag')?.value;
  const valorPago = parseFloat($('b-valor-final')?.value) || 0;
  const obs       = $('b-obs')?.value?.trim() || '';

  if (!contaId)   return showToast('Selecione uma conta para o pagamento.', 'err');
  if (!dataPag)   return showToast('Informe a data de pagamento.', 'err');
  if (!valorPago) return showToast('Informe um valor válido.', 'err');

  const ajusteBaixa    = parseFloat($('b-ajuste')?.value) || 0;
  const idLanc         = baixaLancId;
  const valorOriginal  = baixaValorOrig;
  const l              = state.allLancamentos.find(x => x.id === idLanc);
  const snap           = l ? { ...l } : null;

  // 1. Atualização otimista do estado local
  if (l) {
    Object.assign(l, {
      status: 'pago', contaId, dataPagamento: dataPag,
      valorPago, valorOriginal, valorAjuste: ajusteBaixa,
      valorTotal: valorPago, valor: valorPago, obs,
    });
    patchRowDespesa(idLanc); // DOM reage antes da chamada ao Firebase
  }

  // 2. Fecha modal e limpa estado de forma síncrona
  baixaLancId    = null;
  baixaValorOrig = 0;
  closeModal('modal-baixa');
  showToast('Pagamento registrado ✅');

  // 3. Persiste no Firebase em background
  try {
    await atualizarSaldoConta(contaId, valorPago, 'subtracao');
    await fbUpdate('lancamentos', idLanc, {
      status: 'pago', contaId, dataPagamento: dataPag, valorPago, obs,
      valorOriginal, valorAjuste: ajusteBaixa, valorTotal: valorPago, valor: valorPago,
    });
  } catch {
    // Rollback: restaura estado e visual
    if (l && snap) {
      Object.assign(l, snap);
      patchRowDespesa(idLanc);
    }
    showToast('Falha ao registrar pagamento. O status foi revertido.', 'err');
  }
}

// ── Modal: helpers de estado ──────────────────────────────────
function restoreModalNovaDespesa() {
  const tipoWrap = $('tipo-tabs-wrap');
  const recWrap  = $('fr-recorrencia');
  if (tipoWrap) tipoWrap.style.display = '';
  if (recWrap)  recWrap.style.display  = '';
  const frObs = $('fr-obs');
  if (frObs) frObs.style.display = 'none';
  // Reset edição em massa
  const frBulk = $('fr-bulk-cat');
  if (frBulk) frBulk.style.display = 'none';
  const cbBulk = $('bulk-apply-cat');
  if (cbBulk) cbBulk.checked = false;
}

export function abrirDetalhesDespesa(id) {
  const l = state.allLancamentos.find(x => x.id === id);
  if (!l) return;

  editingId = id;

  // Esconde controles exclusivos de criação
  const tipoWrap = $('tipo-tabs-wrap');
  const recWrap  = $('fr-recorrencia');
  if (tipoWrap) tipoWrap.style.display = 'none';
  if (recWrap)  recWrap.style.display  = 'none';
  switchRecOpt('unico');

  // Título
  $('modal-title') && ($('modal-title').textContent = 'Detalhe / Editar Despesa');

  // Campos principais
  $('f-desc')       && ($('f-desc').value       = l.descricao   || '');
  $('f-valor')      && ($('f-valor').value      = l.valorOriginal !== undefined ? (l.valorOriginal || '') : (l.valor || ''));
  $('f-ajuste')     && ($('f-ajuste').value     = l.valorAjuste  !== undefined ? (l.valorAjuste  || '') : '');
  $('f-valortotal') && ($('f-valortotal').value = _vt(l).toFixed(2));
  $('f-data')       && ($('f-data').value       = l.data         || '');
  $('f-obs')        && ($('f-obs').value        = l.obs          || '');

  // Categoria — repopula do Firestore para garantir lista atualizada
  _populateFCat(l.categoria || '');

  // Conta de baixa — popula do state para garantir value=id
  const contaIdLanc = resolverContaId(l);
  if (!contaIdLanc && l.conta) {
    showToast(`Conta "${l.conta}" não encontrada. Selecione manualmente.`, 'err');
  }
  populateFContaSel(contaIdLanc);

  // Status + data de pagamento
  const selSt = $('f-status');
  if (selSt) selSt.value = l.status || 'pendente';
  const frDp = $('fr-datapag');
  if (frDp) frDp.style.display = l.status === 'pago' ? '' : 'none';
  $('f-datapag') && ($('f-datapag').value = l.dataPagamento || '');

  // Exibe campo de observações
  const frObs = $('fr-obs');
  if (frObs) frObs.style.display = '';

  // Checkbox de edição em massa — conta quantos OUTROS lançamentos têm a mesma descrição
  const descNorm    = (l.descricao || '').toLowerCase().trim();
  const othersSame  = state.allLancamentos.filter(
    x => x.id !== id && (x.descricao || '').toLowerCase().trim() === descNorm
  );
  const frBulk = $('fr-bulk-cat');
  const cbBulk = $('bulk-apply-cat');
  if (frBulk) frBulk.style.display = othersSame.length > 0 ? '' : 'none';
  if (cbBulk) cbBulk.checked = false;
  const countEl = $('bulk-cat-count');
  if (countEl) countEl.textContent = othersSame.length;

  openModal('modal-lancamento');
}

// ── Exclusão em massa ─────────────────────────────────────────
function updateBulkDeleteBtn() {
  const btn = $('btn-excluir-sel');
  if (btn) btn.style.display = selectedIds.size > 0 ? '' : 'none';
}

function syncMasterCb() {
  const master = $('desp-master-cb');
  if (!master) return;
  const all     = document.querySelectorAll('#desp-body .row-cb');
  const checked = document.querySelectorAll('#desp-body .row-cb:checked');
  master.checked       = all.length > 0 && checked.length === all.length;
  master.indeterminate = checked.length > 0 && checked.length < all.length;
}

async function excluirSelecionados() {
  const ids = [...selectedIds];
  if (!ids.length) return;
  if (!confirm(`Deseja excluir ${ids.length} lançamento(s) selecionado(s)?`)) return;
  await Promise.all(ids.map(id => fbDelete('lancamentos', id)));
  selectedIds.clear();
  updateBulkDeleteBtn();
  showToast(`${ids.length} lançamento(s) excluído(s).`);
}

// ── Popula o select de categoria do modal a partir do Firestore ─
function _populateFCat(preSelectVal) {
  const sel = $('f-cat');
  if (!sel) return;
  const cats = state.allCategorias.length ? state.allCategorias : DEFAULT_CATS;
  sel.innerHTML = cats
    .map(c => `<option value="${c.nome}"${c.nome === preSelectVal ? ' selected' : ''}>${c.icon || '🏷️'} ${c.nome}</option>`)
    .join('');
}

// ── Modal Nova Despesa ────────────────────────────────────────
export function openModalDespesa() {
  editingId = null;
  restoreModalNovaDespesa();
  ['f-desc','f-valor','f-ajuste','f-valortotal','f-data','fx-valor','fx-dia','fx-inicio','fx-fim',
   'pc-qtd','pc-v1','pc-vn','pc-data1','pc-dia','f-obs'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  $('f-status') && ($('f-status').value = 'pendente');
  const frDp = $('fr-datapag');
  if (frDp) frDp.style.display = 'none';
  $('modal-title') && ($('modal-title').textContent = 'Nova Despesa');
  _populateFCat('');
  populateFContaSel(null);
  switchRecOpt('unico');
  openModal('modal-lancamento');
}

export function switchRecOpt(rec) {
  currentRec = rec;
  ['unico','fixo','parcelado'].forEach(r => {
    const wrap = $('wrap-' + r);
    if (wrap) wrap.style.display = r === rec ? '' : 'none';
    const opt = document.querySelector(`.rec-opt[data-rec="${r}"]`);
    if (opt) opt.classList.toggle('active', r === rec);
  });
}

// ── Salvar Despesa ────────────────────────────────────────────
export async function salvarDespesa() {
  const desc      = $('f-desc')?.value?.trim();
  const cat       = $('f-cat')?.value;
  const contaId   = $('f-conta')?.value || '';
  const contaNome = state.allContas.find(c => c.id === contaId)?.nome || '';

  if (!desc) return showToast('Informe a descrição.', 'err');

  // ── Modo edição ───────────────────────────────────────────
  if (editingId) {
    const valorOriginal = parseFloat($('f-valor')?.value || 0);
    const valorAjuste   = parseFloat($('f-ajuste')?.value || 0);
    const valorTotal    = valorOriginal + valorAjuste;
    const valor         = valorTotal; // alias para retrocompatibilidade
    const data   = $('f-data')?.value;
    const status = $('f-status')?.value || 'pendente';
    const obs    = $('f-obs')?.value?.trim() || '';
    if (!data)          return showToast('Informe a data.', 'err');
    if (!valorOriginal) return showToast('Informe o valor.', 'err');

    // Detecta mudança de status para ajustar saldo da conta
    const lancAtual   = state.allLancamentos.find(x => x.id === editingId);
    const statusAntes = lancAtual?.status;
    // contaId vem direto do select (já é um ID real); fallback para o salvo
    const contaIdEff  = contaId || lancAtual?.contaId || '';

    if (lancAtual?.tipo !== 'cartao' && contaIdEff) {
      if (statusAntes !== 'pago' && status === 'pago') {
        await atualizarSaldoConta(contaIdEff, valor, 'subtracao');
      } else if (statusAntes === 'pago' && status !== 'pago') {
        await atualizarSaldoConta(contaIdEff, parseFloat(lancAtual.valor) || 0, 'soma');
      }
    }

    await fbUpdate('lancamentos', editingId, {
      descricao: desc, categoria: cat, conta: contaNome, valor, data, status, obs,
      contaId:       contaIdEff,
      dataPagamento: status === 'pago' ? ($('f-datapag')?.value || '') : '',
      valorOriginal, valorAjuste, valorTotal,
    });

    // ── Edição em massa por descrição ─────────────────────────
    const applyAll = $('bulk-apply-cat')?.checked;
    if (applyAll) {
      const descNorm = desc.toLowerCase().trim();
      const others   = state.allLancamentos.filter(
        x => x.id !== editingId && (x.descricao || '').toLowerCase().trim() === descNorm
      );
      const total = others.length + 1; // +1 = o lançamento atual já atualizado acima
      if (!confirm(`Deseja alterar a categoria de TODOS os ${total} lançamento(s) com a descrição "${desc}" para "${cat}"?`)) {
        showToast('Lançamento atualizado ✅');
        editingId = null;
        restoreModalNovaDespesa();
        closeModal('modal-lancamento');
        return;
      }
      try {
        await fbBatch('lancamentos', others.map(x => ({ id: x.id, data: { categoria: cat } })));
        showToast(`✅ ${total} lançamento(s) atualizados para a categoria "${cat}"`);
      } catch {
        // fbBatch já exibiu o toast de erro; não precisamos fazer nada aqui
      }
    } else {
      showToast('Lançamento atualizado ✅');
    }

    editingId = null;
    restoreModalNovaDespesa();
    closeModal('modal-lancamento');
    return;
  }

  const tipo = currentTipo;
  const rec  = currentRec;

  if (rec === 'unico') {
    const valorOriginal = parseFloat($('f-valor')?.value || 0);
    const valorAjuste   = parseFloat($('f-ajuste')?.value || 0);
    const valorTotal    = valorOriginal + valorAjuste;
    const valor         = valorTotal;
    const data   = $('f-data')?.value;
    const status = $('f-status')?.value || 'pendente';
    if (!data)          return showToast('Informe a data.', 'err');
    if (!valorOriginal) return showToast('Informe o valor.', 'err');
    const payload = { descricao: desc, categoria: cat, conta: contaNome, contaId, valor, valorOriginal, valorAjuste, valorTotal, data, status, tipo, recorrencia: 'unico' };
    if (tipo === 'cartao') {
      const cId = $('f-cartao-id')?.value || '';
      payload.cartaoId  = cId;
      if (cId) payload.faturaRef = calcFaturaRef(cId, data);
    }
    await fbAdd('lancamentos', payload);
    // Subtrai do limite disponível do cartão (não do saldo bancário)
    if (tipo === 'cartao' && payload.cartaoId) {
      await atualizarLimiteCartao(payload.cartaoId, valor, 'subtracao');
    }
    showToast('Despesa salva ✅');

  } else if (rec === 'fixo') {
    const valor  = parseFloat($('fx-valor')?.value || 0);
    const dia    = parseInt($('fx-dia')?.value || 1);
    const inicio = $('fx-inicio')?.value;
    const fim    = $('fx-fim')?.value;
    if (!valor || !inicio || !fim) return showToast('Preencha todos os campos de despesa fixa.', 'err');
    const [yI, mI] = inicio.split('-').map(Number);
    const [yF, mF] = fim.split('-').map(Number);
    const promises = [];
    for (let y = yI, m = mI; y < yF || (y === yF && m <= mF); ) {
      const data = `${y}-${String(m).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
      promises.push(fbAdd('lancamentos', { descricao: desc, categoria: cat, conta: contaNome, contaId, valor, data, status: 'pendente', tipo, recorrencia: 'fixo' }));
      m++; if (m > 12) { m = 1; y++; }
    }
    await Promise.all(promises);
    showToast(`${promises.length} lançamentos fixos criados ✅`);

  } else if (rec === 'parcelado') {
    const qtd   = parseInt($('pc-qtd')?.value || 0);
    const v1    = parseFloat($('pc-v1')?.value || 0);
    const vn    = parseFloat($('pc-vn')?.value || v1);
    const data1 = $('pc-data1')?.value;
    if (!qtd || !v1 || !data1) return showToast('Preencha todos os campos do parcelamento.', 'err');
    const [y0, m0, d0] = data1.split('-').map(Number);
    const promises = [];
    for (let i = 0; i < qtd; i++) {
      let m = m0 + i, y = y0;
      while (m > 12) { m -= 12; y++; }
      const data  = `${y}-${String(m).padStart(2,'0')}-${String(d0).padStart(2,'0')}`;
      const valor = i === 0 ? v1 : vn;
      promises.push(fbAdd('lancamentos', {
        descricao: `${desc} (${i+1}/${qtd})`, categoria: cat, conta: contaNome, contaId, valor, data,
        status: 'pendente', tipo, recorrencia: 'parcelado', parcela: i+1, totalParcelas: qtd
      }));
    }
    await Promise.all(promises);
    showToast(`${qtd} parcelas criadas ✅`);
  }

  closeModal('modal-lancamento');
}

// ── Seletor de Cartão ─────────────────────────────────────────
export function populateCartaoSel() {
  const sel = $('f-cartao-id');
  if (!sel) return;
  sel.innerHTML = state.allCartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')
    || '<option value="">Nenhum cartão</option>';
}

// ── Helpers de importação ─────────────────────────────────────
export async function garantirCategoria(nome) {
  if (!nome) return;
  const normalizada = nome.toLowerCase().trim();
  const existe = state.allCategorias.some(c => (c.nome || '').toLowerCase() === normalizada);
  if (!existe) {
    await fbAdd('categorias', { nome });
    state.allCategorias.push({ nome });
  }
}

export async function garantirConta(nome) {
  if (!nome) return;
  const normalizada = nome.toLowerCase().trim();
  const existe = state.allContas.some(c => (c.nome || '').toLowerCase() === normalizada);
  if (!existe) {
    await fbAdd('contas', { nome });
    state.allContas.push({ nome });
  }
}

// ── Importar Excel ────────────────────────────────────────────
export function importarDespesasExcel(file) {
  if (typeof XLSX === 'undefined') {
    showToast('Biblioteca XLSX não carregada.', 'err');
    return;
  }
  const reader = new FileReader();
  reader.onload = async (evt) => {
    try {
      const data     = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheet    = workbook.Sheets[workbook.SheetNames[0]];
      const rows     = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      for (const row of rows) {
        const payload = {
          descricao:       row.descricao || row.Descricao || row['Descrição'] || '',
          categoria:       row.categoria || row.Categoria || row['Categoria'] || 'Outros',
          conta:           row.conta     || row.Conta     || row['Conta']     || 'Conta Geral',
          valor:           Math.abs(converterValorBR(row.valor || row.Valor || row['Valor'] || 0)),
          data:            normalizarDataExcel(row.data || row.Data || row['Data']),
          status:          String(row.status || row.Status || row['Status'] || 'pendente').toLowerCase(),
          tipoPagamento:   row.tipoPagamento   || row.TipoPagamento   || 'debito',
          tipoRecorrencia: row.tipoRecorrencia || row.TipoRecorrencia || 'unico',
          ajuste:          converterValorBR(row.ajuste || row.Ajuste || 0),
          dataPagamento:   normalizarDataExcel(row.dataPagamento || row.DataPagamento || ''),
        };
        if (!payload.descricao || !payload.data) continue;
        if (payload.categoria) await garantirCategoria(payload.categoria);
        if (payload.conta)     await garantirConta(payload.conta);
        await fbAdd('lancamentos', payload);
      }
      showToast('Importação concluída com sucesso.');
    } catch (err) {
      console.error(err);
      showToast('Erro ao importar Excel.', 'err');
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Exportar XLSX ─────────────────────────────────────────────
export function exportXLSX(tipo, filename) {
  if (typeof XLSX === 'undefined') {
    showToast('Biblioteca XLSX não carregada.', 'err');
    return;
  }
  const data = tipo === 'lancamentos' ? state.allLancamentos : state.allReceitas;
  const rows = tipo === 'lancamentos'
    ? data.map(l => ({
        Descrição:      l.descricao       || '',
        Categoria:      l.categoria       || '',
        Vencimento:     l.data            || '',
        Pagamento:      l.dataPagamento   || '',
        'Valor Original': Number(l.valorOriginal ?? l.valor ?? 0),
        Ajuste:         Number(l.valorAjuste  ?? 0),
        'Valor Total':  Number(l.valorTotal   ?? _vt(l)),
        Status:         l.status          || '',
        Conta:          l.conta           || '',
      }))
    : data.map(l => ({
        Descrição: l.descricao || '',
        Categoria: l.categoria || '',
        Valor:     Number(l.valor || 0),
        Data:      l.data       || '',
        Status:    l.status     || '',
      }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

// ── Importador Inteligente 2.0 ────────────────────────────────

/** Diferença absoluta em dias entre dois strings YYYY-MM-DD */
function _dateDiffDays(a, b) {
  const da = new Date(a + 'T12:00:00');
  const db = new Date(b + 'T12:00:00');
  return Math.abs((da - db) / 86400000);
}

/**
 * Sugere categoria usando:
 * 1. Memória: lançamentos existentes com prefixo de descrição igual
 * 2. Mapa de palavras-chave
 */
function _sugerirCategoria(descricao) {
  const desc = (descricao || '').toLowerCase();
  const prefix = desc.slice(0, 7);
  if (prefix.length >= 4) {
    const found = state.allLancamentos.find(
      l => l.categoria && l.descricao && l.descricao.toLowerCase().startsWith(prefix)
    );
    if (found?.categoria) return found.categoria;
  }
  const KW = [
    [/uber|99pop|táxi|taxi|ônibus|onibus|metrô|metro|gasolina|combustível|combustivel|posto\b|shell|ipiranga/i, 'Transporte'],
    [/ifood|rappi|restaurante|lanche|pizza|burger|mcdonald|subway|supermercado|mercado|padaria|açougue/i, 'Alimentação'],
    [/netflix|spotify|amazon prime|disney|hbo|cinema|teatro|lazer|steam|playstation|xbox/i, 'Lazer'],
    [/farmácia|farma|drogaria|hospital|médico|medico|saúde|saude|plano\b|dental|unimed|amil|hapvida/i, 'Saúde'],
    [/escola|faculdade|universidade|curso\b|udemy|alura|livro|educação|educacao|mensalidade/i, 'Educação'],
    [/aluguel|condomínio|condominio|energia|água|agua|luz\b|internet|telefone|gás\b|gas\b|iptu|seguro\b/i, 'Contas de Casa'],
  ];
  for (const [rx, cat] of KW) if (rx.test(desc)) return cat;
  return '';
}

/** Busca o primeiro lançamento com mesmo valor e data a ±3 dias */
function _findMatch(valor, data) {
  if (!valor || !data) return null;
  for (const l of state.allLancamentos) {
    if (Math.abs((parseFloat(l.valor) || 0) - valor) > 0.01) continue;
    if (!l.data || _dateDiffDays(l.data, data) > 3) continue;
    return l;
  }
  return null;
}

/** Lê o arquivo, detecta matches e abre o modal de revisão (sem salvar nada ainda) */
function parseImportFile(file) {
  if (typeof XLSX === 'undefined') { showToast('Biblioteca XLSX não carregada.', 'err'); return; }
  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const wb    = XLSX.read(new Uint8Array(evt.target.result), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows  = XLSX.utils.sheet_to_json(sheet, { defval: '' });
      let idx = 0;

      pendingRows = rows.map(row => {
        const descricao  = String(row.descricao || row.Descricao || row['Descrição'] || row.DESCRICAO || '').trim();
        const valor      = Math.abs(converterValorBR(row.valor || row.Valor || row['Valor'] || row.VALOR || 0));
        const data       = normalizarDataExcel(row.data || row.Data || row['Data'] || row.DATA || '');
        const catFile    = String(row.categoria || row.Categoria || row['Categoria'] || '').trim();
        const contaFile  = String(row.conta || row.Conta || row['Conta'] || '').trim();
        if (!descricao || !data) return null;

        const categoria = catFile || _sugerirCategoria(descricao);
        const match = _findMatch(valor, data);
        let action = 'new', matchId = null, matchDesc = '', selected = true;

        if (match) {
          if (match.status === 'pago') {
            action = 'duplicado'; selected = false;
            matchId = match.id; matchDesc = match.descricao || '';
          } else {
            action = 'baixa';
            matchId = match.id; matchDesc = match.descricao || '';
          }
        }
        return {
          idx: idx++, descricao, valor, data,
          categoria, catOverride: '',
          conta: contaFile, contaOverride: '',
          action, matchId, matchDesc, selected,
        };
      }).filter(Boolean);

      if (!pendingRows.length) { showToast('Nenhum lançamento válido encontrado.', 'err'); return; }
      _renderImportReview();
      openModal('modal-import-review');
    } catch (err) {
      console.error(err);
      showToast('Erro ao processar arquivo.', 'err');
    }
  };
  reader.readAsArrayBuffer(file);
}

/** Atualiza o painel de resumo de ações */
function _updateImpSummary() {
  const el = $('imp-summary');
  if (!el) return;
  const novos  = pendingRows.filter(r => r.action === 'new').length;
  const baixas = pendingRows.filter(r => r.action === 'baixa').length;
  const dups   = pendingRows.filter(r => r.action === 'duplicado').length;
  const sel    = pendingRows.filter(r => r.selected).length;
  el.innerHTML = `
    <span class="imp-badge imp-new">➕ ${novos} novos</span>
    <span class="imp-badge imp-baixa">✅ ${baixas} baixas</span>
    <span class="imp-badge imp-dup">⚠️ ${dups} duplicados</span>
    <span style="margin-left:auto;font-size:.8rem;color:var(--text2)">${sel} de ${pendingRows.length} selecionados</span>`;
}

/** Renderiza a tabela de revisão (chamada uma vez ao abrir o modal) */
function _renderImportReview() {
  _updateImpSummary();
  const body = $('imp-review-body');
  if (!body) return;

  const catOpts   = '<option value="">— categoria —</option>'
    + state.allCategorias.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
  const contaOpts = '<option value="">— conta —</option>'
    + state.allContas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');

  body.innerHTML = pendingRows.map(r => {
    const badge = {
      new:       `<span class="imp-badge imp-new">➕ Criar Novo</span>`,
      baixa:     `<span class="imp-badge imp-baixa" title="Existente: ${r.matchDesc}">✅ Dar Baixa</span>`,
      duplicado: `<span class="imp-badge imp-dup"   title="Já pago: ${r.matchDesc}">⚠️ Duplicado</span>`,
    }[r.action];
    return `
    <div class="imp-row${r.action === 'duplicado' ? ' imp-row-dup' : ''}" data-idx="${r.idx}">
      <div style="display:flex;align-items:center;justify-content:center">
        <input type="checkbox" class="row-cb imp-cb" data-idx="${r.idx}"${r.selected ? ' checked' : ''}>
      </div>
      <div class="imp-date">${fmtDate(r.data)}</div>
      <div class="imp-desc" title="${r.descricao}">${r.descricao}</div>
      <div class="imp-val">${fmt(r.valor)}</div>
      <div>${badge}</div>
      <div><select class="imp-sel imp-cat-sel"   data-idx="${r.idx}">${catOpts}</select></div>
      <div><select class="imp-sel imp-conta-sel" data-idx="${r.idx}">${contaOpts}</select></div>
    </div>`;
  }).join('');

  // Pós-render: aplica seleções já conhecidas nos selects
  pendingRows.forEach(r => {
    const catEl   = body.querySelector(`.imp-cat-sel[data-idx="${r.idx}"]`);
    const contaEl = body.querySelector(`.imp-conta-sel[data-idx="${r.idx}"]`);
    if (catEl) catEl.value = r.catOverride || r.categoria || '';
    if (contaEl) {
      const id = r.contaOverride
        || state.allContas.find(c => c.nome.toLowerCase() === (r.conta || '').toLowerCase())?.id
        || '';
      if (id) contaEl.value = id;
    }
  });
}

/** Executa o commit: fbUpdate para baixas, fbAdd para novos */
async function _confirmarImportacao() {
  const selecionados = pendingRows.filter(r => r.selected);
  if (!selecionados.length) return showToast('Selecione ao menos um lançamento.', 'err');

  const btn = $('btn-confirm-import');
  if (btn) { btn.disabled = true; btn.textContent = 'Processando…'; }

  const hoje = new Date().toISOString().slice(0, 10);
  try {
    const results = await Promise.all(selecionados.map(async r => {
      const contaId   = r.contaOverride || '';
      const contaNome = state.allContas.find(c => c.id === contaId)?.nome || r.conta || '';
      const categoria = r.catOverride || r.categoria || 'Outros';

      if (r.action === 'baixa' && r.matchId) {
        // Dar baixa no lançamento pendente existente
        await fbUpdate('lancamentos', r.matchId, {
          status: 'pago', dataPagamento: r.data || hoje,
          ...(contaId ? { contaId, conta: contaNome } : {}),
        });
        if (contaId) await atualizarSaldoConta(contaId, r.valor, 'subtracao');
        return 'baixa';
      }
      // Criar novo (inclui duplicados marcados conscientemente)
      await fbAdd('lancamentos', {
        descricao: r.descricao, categoria, conta: contaNome, contaId,
        valor: r.valor, data: r.data, status: 'pago', tipo: 'debito', recorrencia: 'unico',
      });
      if (contaId) await atualizarSaldoConta(contaId, r.valor, 'subtracao');
      return 'novo';
    }));

    const criados  = results.filter(r => r === 'novo').length;
    const baixados = results.filter(r => r === 'baixa').length;
    pendingRows = [];
    closeModal('modal-import-review');
    showToast(`${criados} criado(s) e ${baixados} baixa(s) realizada(s) ✅`);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '✓ Confirmar Importação'; }
  }
}

// ── Ordenação de colunas ──────────────────────────────────────

/** Atualiza as setas de ordenação e a classe .sorted nos cabeçalhos. */
function _updateSortArrows() {
  document.querySelectorAll('#desp-head .th[data-col]').forEach(th => {
    const col   = th.dataset.col;
    const arrow = th.querySelector('.sort-arrow');
    const active = col === despSortCol;
    th.classList.toggle('sorted', active);
    if (arrow) arrow.textContent = active ? (despSortDir === 'asc' ? ' ↑' : ' ↓') : '';
  });
}

// ── Navegação de mês e período personalizado ──────────────────

/** Atualiza o label central com o mês atual ou o intervalo de datas. */
function _updateMesLabel() {
  const label = $('desp-mes-label');
  if (!label) return;
  if (despMode === 'periodo') {
    label.textContent = (despInicio && despFim)
      ? `${fmtDate(despInicio)} — ${fmtDate(despFim)}`
      : 'Período personalizado';
    return;
  }
  if (!despMesAtual) { label.textContent = 'Todos os meses'; return; }
  const [y, m] = despMesAtual.split('-');
  label.textContent = `${MONTHS[parseInt(m) - 1]} ${y}`;
}

/** Sincroniza a visibilidade do nav-bar e do periodo-bar conforme o modo ativo. */
function _syncNavUI() {
  const nav  = $('desp-month-nav');
  const pbar = $('periodo-bar');
  const btn  = $('btn-periodo-toggle');
  const isPeriodo = despMode === 'periodo';
  if (nav)  nav.style.display  = isPeriodo ? 'none' : '';
  if (pbar) pbar.style.display = isPeriodo ? '' : 'none';
  if (btn) {
    btn.classList.toggle('active', isPeriodo);
    btn.textContent = isPeriodo ? '← Voltar ao Mês' : '📅 Período';
  }
  // Restaura valores dos inputs de data ao exibir o periodo-bar
  if (isPeriodo) {
    const i1 = $('desp-inicio'); if (i1 && despInicio) i1.value = despInicio;
    const i2 = $('desp-fim');    if (i2 && despFim)    i2.value = despFim;
  }
  _updateMesLabel();
}

/** Avança ou retrocede um mês. */
function _navegarMes(delta) {
  if (despMode !== 'mes') return;
  if (!despMesAtual) {
    const d = new Date();
    despMesAtual = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  let [y, m] = despMesAtual.split('-').map(Number);
  m += delta;
  if (m > 12) { m = 1;  y++; }
  if (m < 1)  { m = 12; y--; }
  despMesAtual = `${y}-${String(m).padStart(2, '0')}`;
  renderDespesas();
}

/** Ativa o modo de período personalizado. */
function _ativarPeriodo() {
  despMode = 'periodo';
  renderDespesas();
}

/** Volta ao modo de navegação mensal. */
function _voltarMes() {
  despMode   = 'mes';
  despInicio = '';
  despFim    = '';
  const i1 = $('desp-inicio'); if (i1) i1.value = '';
  const i2 = $('desp-fim');    if (i2) i2.value = '';
  renderDespesas();
}

// ── Inicialização dos event listeners ─────────────────────────
export function initDespesas() {
  // Tipo de pagamento (débito / cartão)
  document.querySelectorAll('.tipo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentTipo = tab.dataset.tipo;
      document.querySelectorAll('.tipo-tab').forEach(t => t.classList.toggle('active', t === tab));
      const frCartao = $('fr-cartao-sel');
      if (frCartao) frCartao.style.display = currentTipo === 'cartao' ? '' : 'none';
    });
  });

  // Recorrência da despesa
  document.querySelectorAll('#rec-opts .rec-opt').forEach(opt => {
    opt.addEventListener('click', () => switchRecOpt(opt.dataset.rec));
  });

  // Mostrar/ocultar data de pagamento conforme status
  $('f-status')?.addEventListener('change', function () {
    const fr = $('fr-datapag');
    if (fr) fr.style.display = this.value === 'pago' ? '' : 'none';
  });

  // Auto-calcular total conforme valor original e ajuste
  function _recalcTotal() {
    const vo = parseFloat($('f-valor')?.value) || 0;
    const aj = parseFloat($('f-ajuste')?.value) || 0;
    const vt = $('f-valortotal');
    if (vt) vt.value = (vo + aj).toFixed(2);
  }
  $('f-valor')?.addEventListener('input',  _recalcTotal);
  $('f-ajuste')?.addEventListener('input', _recalcTotal);

  // Botão nova despesa
  $('btn-nova-desp')?.addEventListener('click', openModalDespesa);

  // Botão lançar no cartão
  $('btn-nova-desp-cc')?.addEventListener('click', () => {
    openModalDespesa();
    currentTipo = 'cartao';
    document.querySelectorAll('.tipo-tab').forEach(t => t.classList.toggle('active', t.dataset.tipo === 'cartao'));
    const frCartao = $('fr-cartao-sel');
    if (frCartao) frCartao.style.display = '';
  });

  // Salvar / cancelar modal despesa
  $('btn-save-lanc')?.addEventListener('click', salvarDespesa);
  $('btn-cancel-lanc')?.addEventListener('click', () => {
    editingId = null;
    restoreModalNovaDespesa();
    closeModal('modal-lancamento');
  });

  // Importar — abre o fluxo de revisão inteligente
  const btnImport  = $('btn-import-desp');
  const fileImport = $('file-import-desp');
  if (btnImport && fileImport) {
    btnImport.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      parseImportFile(file);   // Importador Inteligente 2.0
      e.target.value = '';
    });
  }

  // Exportar
  $('btn-export-desp')?.addEventListener('click', () => exportXLSX('lancamentos', 'Despesas_Clarim'));

  // ── Review Modal: event delegation ────────────────────────────
  $('imp-review-body')?.addEventListener('change', e => {
    const idx = parseInt(e.target.dataset.idx);
    const row = pendingRows.find(r => r.idx === idx);
    if (!row) return;
    if (e.target.matches('.imp-cb'))        { row.selected = e.target.checked; _updateImpSummary(); }
    if (e.target.matches('.imp-cat-sel'))   { row.catOverride   = e.target.value; }
    if (e.target.matches('.imp-conta-sel')) { row.contaOverride = e.target.value; }
  });

  // Selecionar / desmarcar todos
  $('imp-sel-all')?.addEventListener('click', () => {
    const next = !pendingRows.every(r => r.selected);
    pendingRows.forEach(r => r.selected = next);
    document.querySelectorAll('#imp-review-body .imp-cb').forEach(cb => cb.checked = next);
    _updateImpSummary();
    const btn = $('imp-sel-all');
    if (btn) btn.textContent = next ? '☐ Desmarcar Todos' : '☑ Selecionar Todos';
  });

  // Desmarcar apenas duplicados
  $('imp-desel-dup')?.addEventListener('click', () => {
    pendingRows.forEach(r => { if (r.action === 'duplicado') r.selected = false; });
    document.querySelectorAll('#imp-review-body .imp-cb').forEach(cb => {
      const r = pendingRows.find(r => r.idx === parseInt(cb.dataset.idx));
      if (r) cb.checked = r.selected;
    });
    _updateImpSummary();
  });

  // Confirmar / cancelar importação
  $('btn-confirm-import')?.addEventListener('click',          _confirmarImportacao);
  $('btn-cancel-import-review')?.addEventListener('click', () => {
    pendingRows = [];
    closeModal('modal-import-review');
  });

  // Ordenação por clique nos cabeçalhos
  document.querySelectorAll('#desp-head .th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      if (despSortCol === col) {
        despSortDir = despSortDir === 'asc' ? 'desc' : 'asc';
      } else {
        despSortCol = col;
        despSortDir = 'asc';
      }
      renderDespesas();
    });
  });

  // Filtros (sem desp-mes — substituído pela navegação de mês)
  ['desp-search','desp-cat','desp-conta','desp-status'].forEach(id => {
    $(id)?.addEventListener('input',  renderDespesas);
    $(id)?.addEventListener('change', renderDespesas);
  });

  // ── Navegação de mês ──────────────────────────────────────
  $('desp-prev-mes')?.addEventListener('click', () => _navegarMes(-1));
  $('desp-next-mes')?.addEventListener('click', () => _navegarMes(1));

  // Toggle período / mês
  $('btn-periodo-toggle')?.addEventListener('click', () => {
    if (despMode === 'mes') _ativarPeriodo();
    else _voltarMes();
  });

  // Período customizado: aplica ao preencher ambas as datas
  const _aplicarPeriodo = () => {
    despInicio = $('desp-inicio')?.value || '';
    despFim    = $('desp-fim')?.value    || '';
    _updateMesLabel();
    if (despInicio && despFim) renderDespesas();
  };
  $('desp-inicio')?.addEventListener('change', _aplicarPeriodo);
  $('desp-fim')?.addEventListener('change',    _aplicarPeriodo);

  // ── Modal de Baixa ─────────────────────────────────────────
  // Ajuste → recalcula valor pago em tempo real
  $('b-ajuste')?.addEventListener('input', () => {
    const ajuste = parseFloat($('b-ajuste')?.value) || 0;
    const vf = $('b-valor-final');
    if (vf) vf.value = (baixaValorOrig + ajuste).toFixed(2);
  });
  $('btn-save-baixa')?.addEventListener('click', confirmarBaixa);
  $('btn-cancel-baixa')?.addEventListener('click', () => {
    baixaLancId    = null;
    baixaValorOrig = 0;
    closeModal('modal-baixa');
  });

  // ── Exclusão em massa ──────────────────────────────────────
  // Checkbox individual (delegação no body)
  $('desp-body')?.addEventListener('change', e => {
    if (!e.target.matches('.row-cb')) return;
    const id = e.target.dataset.id;
    if (e.target.checked) selectedIds.add(id);
    else selectedIds.delete(id);
    syncMasterCb();
    updateBulkDeleteBtn();
  });

  // Checkbox master
  $('desp-master-cb')?.addEventListener('change', e => {
    document.querySelectorAll('#desp-body .row-cb').forEach(cb => {
      cb.checked = e.target.checked;
      if (e.target.checked) selectedIds.add(cb.dataset.id);
      else selectedIds.delete(cb.dataset.id);
    });
    updateBulkDeleteBtn();
  });

  // Botão excluir selecionados
  $('btn-excluir-sel')?.addEventListener('click', excluirSelecionados);
}
