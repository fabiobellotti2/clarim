// ============================================================
// CLARIM — receitas.js
// Renderização, CRUD, modais e recebimento de receitas
// ============================================================

import { $, fmt, fmtDate, showToast } from './utils.js';
import { state, fbAdd, fbUpdate, fbDelete } from './firebase.js';
import { DEFAULT_CATS } from './categorias.js';
import { openModal, closeModal, badgeStatus, populateMesFiltro } from './ui.js';
import { atualizarSaldoConta } from './contas.js';
import { exportXLSX } from './despesas.js';

// ── Estado local ──────────────────────────────────────────────
let editingRecId   = null;
let recebId        = null;
let recebValorOrig = 0;

// ── Helper: popula select de conta no modal de recebimento ────
function populateRecebContaSel(preSelectId) {
  const sel = $('receb-conta');
  if (!sel) return;
  sel.innerHTML = state.allContas.length
    ? state.allContas.map(c =>
        `<option value="${c.id}">${c.nome} — ${fmt(parseFloat(c.saldo) || 0)}</option>`
      ).join('')
    : '<option value="">Nenhuma conta cadastrada</option>';
  if (preSelectId) sel.value = preSelectId;
}

// ── Builder de linha individual ───────────────────────────────
const _REC_COLS = '90px 1fr 110px 85px 110px 130px';

function _buildRecRowHtml(r) {
  return `
  <div class="tbl-row" data-id="${r.id}" style="grid-template-columns:${_REC_COLS}">
    <div>${fmtDate(r.data)}</div>
    <div>${r.descricao || '—'}</div>
    <div>${r.categoria || '—'}</div>
    <div style="text-align:right;font-weight:600;color:var(--green)">${fmt(r.valor)}</div>
    <div style="text-align:center">
      ${r.status === 'recebido'
        ? `<span class="badge-rev" title="Clique para reverter para Previsto" onclick="window.reverterReceita('${r.id}')">${badgeStatus(r.status)}</span>`
        : badgeStatus(r.status)}
    </div>
    <div style="display:flex;gap:.4rem;justify-content:flex-end">
      <button class="btn-action" onclick="window.abrirDetalheReceita('${r.id}')" title="Editar">✏️</button>
      ${r.status !== 'recebido'
        ? `<button class="btn-action" onclick="window.abrirRecebimento('${r.id}')">✓ Receber</button>`
        : ''}
      <button class="btn-action btn-del" onclick="window.deletarReceita('${r.id}')">🗑</button>
    </div>
  </div>`;
}

export function patchRowReceita(id) {
  const r   = state.allReceitas.find(x => x.id === id);
  const row = document.querySelector(`#rec-body .tbl-row[data-id="${id}"]`);
  if (!row) return;
  if (!r) { row.remove(); return; }
  const tpl = document.createElement('template');
  tpl.innerHTML = _buildRecRowHtml(r).trim();
  row.replaceWith(tpl.content.firstElementChild);
}

// ── Renderização ──────────────────────────────────────────────
export function renderReceitas() {
  const body = $('rec-body');
  if (!body) return;

  const head = $('rec-head');
  if (head) head.style.gridTemplateColumns = _REC_COLS;

  let data = [...state.allReceitas];
  const searchTerm = $('rec-search')?.value?.toLowerCase() || '';
  const mesFil     = $('rec-mes')?.value      || '';
  const contaFil   = $('rec-conta')?.value    || '';
  const stFil      = $('rec-status-f')?.value || '';

  if (searchTerm) data = data.filter(r => (r.descricao || '').toLowerCase().includes(searchTerm));
  if (mesFil)     data = data.filter(r => (r.data || '').slice(0, 7) === mesFil);
  if (contaFil) {
    const contaNome = state.allContas.find(c => c.id === contaFil)?.nome;
    data = data.filter(r => r.contaId === contaFil || (contaNome && r.conta === contaNome));
  }
  if (stFil)      data = data.filter(r => r.status === stFil);
  data.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  if (!data.length) {
    body.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text3)">Nenhuma receita encontrada.</div>`;
    return;
  }

  body.innerHTML = data.map(r => _buildRecRowHtml(r)).join('');

  populateMesFiltro('rec-mes', state.allReceitas);

  // Popula filtro de conta preservando seleção atual
  const contaSel = $('rec-conta');
  if (contaSel && state.allContas.length) {
    const cur = contaSel.value;
    contaSel.innerHTML = '<option value="">Todas as contas</option>'
      + state.allContas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    if (cur) contaSel.value = cur;
  }
}

// ── Ações ─────────────────────────────────────────────────────
export async function deletarReceita(id) {
  if (!confirm('Deseja excluir esta receita?')) return;
  await fbDelete('receitas', id);
  showToast('Receita excluída.');
}

// ── Reversão de status ────────────────────────────────────────
export async function reverterReceita(id) {
  if (!confirm('Reverter esta receita para "Previsto"?')) return;
  const r = state.allReceitas.find(x => x.id === id);
  if (!r) return;

  const snap         = { ...r };
  const contaId      = r.contaId || state.allContas.find(c => c.nome === r.conta)?.id || null;
  const valorEstorno = parseFloat(r.valorFinal || r.valor) || 0;

  // 1. Atualização otimista
  Object.assign(r, { status: 'previsto', dataRecebimento: '', contaId: '', valorFinal: '' });
  patchRowReceita(id);

  try {
    if (contaId) await atualizarSaldoConta(contaId, valorEstorno, 'subtracao');
    await fbUpdate('receitas', id, { status: 'previsto', dataRecebimento: '', contaId: '', valorFinal: '' });
    showToast('Receita revertida para Previsto.');
  } catch {
    Object.assign(r, snap);
    patchRowReceita(id);
    showToast('Falha ao reverter. O status foi restaurado.', 'err');
  }
}

// ── Modal de Recebimento ──────────────────────────────────────
export function abrirRecebimento(id) {
  const r = state.allReceitas.find(x => x.id === id);
  if (!r) return;

  recebId        = id;
  recebValorOrig = parseFloat(r.valor) || 0;

  const box = $('receb-box');
  if (box) box.innerHTML = `
    <div class="baixa-row"><span>Descrição</span><span>${r.descricao || '—'}</span></div>
    <div class="baixa-row"><span>Previsto para</span><span>${fmtDate(r.data)}</span></div>
    <div class="baixa-row"><span>Valor previsto</span><span style="font-weight:600;color:var(--green)">${fmt(recebValorOrig)}</span></div>
    ${r.categoria ? `<div class="baixa-row"><span>Categoria</span><span>${r.categoria}</span></div>` : ''}`;

  const contaIdAtual = r.contaId || state.allContas.find(c => c.nome === r.conta)?.id || null;
  populateRecebContaSel(contaIdAtual);

  $('receb-data')        && ($('receb-data').value        = new Date().toISOString().slice(0, 10));
  $('receb-valor-final') && ($('receb-valor-final').value = recebValorOrig.toFixed(2));
  $('receb-ajuste')      && ($('receb-ajuste').value      = '');

  openModal('modal-recebimento');
}

async function confirmarRecebimento() {
  const contaId    = $('receb-conta')?.value;
  const dataRec    = $('receb-data')?.value;
  const valorFinal = parseFloat($('receb-valor-final')?.value) || 0;

  if (!contaId)    return showToast('Selecione uma conta de destino.', 'err');
  if (!dataRec)    return showToast('Informe a data do recebimento.', 'err');
  if (!valorFinal) return showToast('Informe um valor válido.', 'err');

  const contaNome = state.allContas.find(c => c.id === contaId)?.nome || '';
  const idRec     = recebId;
  const r         = state.allReceitas.find(x => x.id === idRec);
  const snap      = r ? { ...r } : null;

  // 1. Atualização otimista
  if (r) {
    Object.assign(r, { status: 'recebido', contaId, conta: contaNome, dataRecebimento: dataRec, valorFinal });
    patchRowReceita(idRec);
  }

  // 2. Fecha modal
  recebId        = null;
  recebValorOrig = 0;
  closeModal('modal-recebimento');
  showToast('Recebimento registrado ✅');

  // 3. Firebase em background
  try {
    await atualizarSaldoConta(contaId, valorFinal, 'soma');
    await fbUpdate('receitas', idRec, { status: 'recebido', contaId, conta: contaNome, dataRecebimento: dataRec, valorFinal });
  } catch {
    if (r && snap) {
      Object.assign(r, snap);
      patchRowReceita(idRec);
    }
    showToast('Falha ao registrar recebimento. O status foi revertido.', 'err');
  }
}

// ── Popula o select de categoria do modal receita ─────────────
function _populateRecCat(preSelectVal) {
  const sel = $('rec-cat');
  if (!sel) return;
  const cats = state.allCategorias.length ? state.allCategorias : DEFAULT_CATS;
  sel.innerHTML = cats
    .map(c => `<option value="${c.nome}"${c.nome === preSelectVal ? ' selected' : ''}>${c.icon || '🏷️'} ${c.nome}</option>`)
    .join('');
}

// ── Modal Nova / Editar Receita ───────────────────────────────
export function openModalReceita() {
  editingRecId = null;
  ['rec-desc','rec-valor','rec-data','rec-inicio','rec-fim'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  $('rec-status') && ($('rec-status').value = 'previsto');
  $('modal-rec-title') && ($('modal-rec-title').textContent = 'Nova Receita');
  // Mostra controles de recorrência
  const recWrap = $('rec-rec-wrap');
  if (recWrap) recWrap.style.display = '';
  const fixoWrap = $('rec-fixo-wrap');
  if (fixoWrap) fixoWrap.style.display = 'none';
  document.querySelectorAll('#rec-rec-opts .rec-opt')
    .forEach(o => o.classList.toggle('active', o.dataset.rec === 'unico'));
  _populateRecCat('');
  openModal('modal-receita');
}

export function abrirDetalheReceita(id) {
  const r = state.allReceitas.find(x => x.id === id);
  if (!r) return;

  editingRecId = id;

  // Esconde recorrência no modo edição
  const recWrap = $('rec-rec-wrap');
  if (recWrap) recWrap.style.display = 'none';
  const fixoWrap = $('rec-fixo-wrap');
  if (fixoWrap) fixoWrap.style.display = 'none';

  $('modal-rec-title') && ($('modal-rec-title').textContent = 'Editar Receita');
  $('rec-desc')  && ($('rec-desc').value  = r.descricao || '');
  $('rec-valor') && ($('rec-valor').value = r.valor     || '');
  $('rec-data')  && ($('rec-data').value  = r.data      || '');
  _populateRecCat(r.categoria || '');
  const selSt = $('rec-status');
  if (selSt) selSt.value = r.status || 'previsto';

  openModal('modal-receita');
}

// ── Salvar Receita ────────────────────────────────────────────
export async function salvarReceita() {
  const desc   = $('rec-desc')?.value?.trim();
  const valor  = parseFloat($('rec-valor')?.value || 0);
  const data   = $('rec-data')?.value;
  const cat    = $('rec-cat')?.value;
  const status = $('rec-status')?.value || 'previsto';

  if (!desc)  return showToast('Informe a descrição.', 'err');
  if (!valor) return showToast('Informe o valor.', 'err');
  if (!data)  return showToast('Informe a data.', 'err');

  // ── Modo edição ──────────────────────────────────────────
  if (editingRecId) {
    await fbUpdate('receitas', editingRecId, { descricao: desc, valor, data, categoria: cat, status });
    showToast('Receita atualizada ✅');
    editingRecId = null;
    const recWrap = $('rec-rec-wrap');
    if (recWrap) recWrap.style.display = '';
    closeModal('modal-receita');
    return;
  }

  const recorrencia = document.querySelector('#rec-rec-opts .rec-opt.active')?.dataset?.rec || 'unico';

  if (recorrencia === 'fixo') {
    const inicio = $('rec-inicio')?.value;
    const fim    = $('rec-fim')?.value;
    if (!inicio || !fim) return showToast('Informe início e fim da recorrência.', 'err');
    const [yI, mI] = inicio.split('-').map(Number);
    const [yF, mF] = fim.split('-').map(Number);
    const dia      = new Date(data).getDate();
    const promises = [];
    for (let y = yI, m = mI; y < yF || (y === yF && m <= mF); ) {
      const d = `${y}-${String(m).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
      promises.push(fbAdd('receitas', { descricao: desc, valor, data: d, categoria: cat, status, recorrencia: 'fixo' }));
      m++; if (m > 12) { m = 1; y++; }
    }
    await Promise.all(promises);
    showToast(`${promises.length} receitas fixas criadas ✅`);
  } else {
    await fbAdd('receitas', { descricao: desc, valor, data, categoria: cat, status, recorrencia: 'unico' });
    showToast('Receita salva ✅');
  }

  closeModal('modal-receita');
}

// ── Inicialização dos event listeners ─────────────────────────
export function initReceitas() {
  // Botão nova receita
  $('btn-nova-rec')?.addEventListener('click', openModalReceita);

  // Salvar / cancelar modal receita
  $('btn-save-rec')?.addEventListener('click', salvarReceita);
  $('btn-cancel-rec')?.addEventListener('click', () => {
    editingRecId = null;
    const recWrap = $('rec-rec-wrap');
    if (recWrap) recWrap.style.display = '';
    closeModal('modal-receita');
  });

  // Recorrência da receita
  document.querySelectorAll('#rec-rec-opts .rec-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#rec-rec-opts .rec-opt').forEach(o => o.classList.toggle('active', o === opt));
      const wrap = $('rec-fixo-wrap');
      if (wrap) wrap.style.display = opt.dataset.rec === 'fixo' ? '' : 'none';
    });
  });

  // Exportar
  $('btn-export-rec')?.addEventListener('click', () => exportXLSX('receitas', 'Receitas_Clarim'));

  // Filtros (inclui rec-conta)
  ['rec-search','rec-mes','rec-conta','rec-status-f'].forEach(id => {
    $(id)?.addEventListener('input',  renderReceitas);
    $(id)?.addEventListener('change', renderReceitas);
  });

  // ── Modal de Recebimento ──────────────────────────────────
  // Ajuste → recalcula valor recebido em tempo real
  $('receb-ajuste')?.addEventListener('input', () => {
    const ajuste = parseFloat($('receb-ajuste')?.value) || 0;
    const vf = $('receb-valor-final');
    if (vf) vf.value = (recebValorOrig + ajuste).toFixed(2);
  });
  $('btn-save-recebimento')?.addEventListener('click',   confirmarRecebimento);
  $('btn-cancel-recebimento')?.addEventListener('click', () => {
    recebId        = null;
    recebValorOrig = 0;
    closeModal('modal-recebimento');
  });
}
