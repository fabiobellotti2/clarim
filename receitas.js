// ============================================================
// CLARIM — receitas.js
// Renderização, CRUD e modal de receitas
// ============================================================

import { $, fmt, fmtDate, showToast } from './utils.js';
import { state, fbAdd, fbDelete } from './firebase.js';
import { openModal, closeModal, badgeStatus, populateMesFiltro } from './ui.js';

// ── Renderização ──────────────────────────────────────────────
export function renderReceitas() {
  const body = $('rec-body');
  if (!body) return;

  const cols = '90px 1fr 110px 85px 110px 130px';
  const head = $('rec-head');
  if (head) head.style.gridTemplateColumns = cols;

  let data = [...state.allReceitas];
  const searchTerm = $('rec-search')?.value?.toLowerCase() || '';
  const mesFil     = $('rec-mes')?.value      || '';
  const stFil      = $('rec-status-f')?.value || '';

  if (searchTerm) data = data.filter(r => (r.descricao || '').toLowerCase().includes(searchTerm));
  if (mesFil)     data = data.filter(r => (r.data || '').slice(0, 7) === mesFil);
  if (stFil)      data = data.filter(r => r.status === stFil);
  data.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  if (!data.length) {
    body.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text3)">Nenhuma receita encontrada.</div>`;
    return;
  }

  body.innerHTML = data.map(r => `
    <div class="tbl-row" style="grid-template-columns:${cols}">
      <div>${fmtDate(r.data)}</div>
      <div>${r.descricao || '—'}</div>
      <div>${r.categoria || '—'}</div>
      <div style="text-align:right;font-weight:600;color:var(--green)">${fmt(r.valor)}</div>
      <div style="text-align:center">${badgeStatus(r.status)}</div>
      <div style="display:flex;gap:.4rem;justify-content:flex-end">
        <button class="btn-action btn-del" onclick="window.deletarReceita('${r.id}')">🗑</button>
      </div>
    </div>`).join('');

  populateMesFiltro('rec-mes', state.allReceitas);
}

// ── Ações ─────────────────────────────────────────────────────
export async function deletarReceita(id) {
  if (!confirm('Deseja excluir esta receita?')) return;
  await fbDelete('receitas', id);
  showToast('Receita excluída.');
}

// ── Modal Nova Receita ────────────────────────────────────────
export function openModalReceita() {
  ['rec-desc','rec-valor','rec-data','rec-inicio','rec-fim'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  $('rec-status') && ($('rec-status').value = 'recebido');
  $('modal-rec-title') && ($('modal-rec-title').textContent = 'Nova Receita');
  const wrap = $('rec-fixo-wrap');
  if (wrap) wrap.style.display = 'none';
  openModal('modal-receita');
}

// ── Salvar Receita ────────────────────────────────────────────
export async function salvarReceita() {
  const desc   = $('rec-desc')?.value?.trim();
  const valor  = parseFloat($('rec-valor')?.value || 0);
  const data   = $('rec-data')?.value;
  const cat    = $('rec-cat')?.value;
  const status = $('rec-status')?.value || 'recebido';

  if (!desc)  return showToast('Informe a descrição.', 'err');
  if (!valor) return showToast('Informe o valor.', 'err');
  if (!data)  return showToast('Informe a data.', 'err');

  const recorrencia = document.querySelector('#rec-rec-opts .rec-opt.active')?.dataset?.rec || 'unico';

  if (recorrencia === 'fixo') {
    const inicio = $('rec-inicio')?.value;
    const fim    = $('rec-fim')?.value;
    if (!inicio || !fim) return showToast('Informe início e fim da recorrência.', 'err');
    const [yI, mI] = inicio.split('-').map(Number);
    const [yF, mF] = fim.split('-').map(Number);
    const dia       = new Date(data).getDate();
    const promises  = [];
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
  $('btn-save-rec')?.addEventListener('click',   salvarReceita);
  $('btn-cancel-rec')?.addEventListener('click', () => closeModal('modal-receita'));

  // Recorrência da receita
  document.querySelectorAll('#rec-rec-opts .rec-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#rec-rec-opts .rec-opt').forEach(o => o.classList.toggle('active', o === opt));
      const wrap = $('rec-fixo-wrap');
      if (wrap) wrap.style.display = opt.dataset.rec === 'fixo' ? '' : 'none';
    });
  });

  // Exportar
  $('btn-export-rec')?.addEventListener('click', () => {
    // reutiliza exportXLSX de despesas via importação dinâmica ou window
    window.exportXLSX?.('receitas', 'Receitas_Clarim');
  });

  // Filtros
  ['rec-search','rec-mes','rec-status-f'].forEach(id => {
    $(id)?.addEventListener('input',  renderReceitas);
    $(id)?.addEventListener('change', renderReceitas);
  });
}
