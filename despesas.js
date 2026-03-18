// ============================================================
// CLARIM — despesas.js
// Renderização, CRUD, modais e importação de despesas
// ============================================================

import { $, fmt, fmtDate, showToast, converterValorBR, normalizarDataExcel } from './utils.js';
import { state, fbAdd, fbUpdate, fbDelete } from './firebase.js';
import { openModal, closeModal, badgeStatus, populateMesFiltro, populateCatFiltro } from './ui.js';

// ── Estado local ──────────────────────────────────────────────
let currentTipo = 'debito';
let currentRec  = 'unico';

// ── Renderização ──────────────────────────────────────────────
export function renderDespesas() {
  const body = $('desp-body');
  if (!body) return;

  const cols = '120px 1fr 160px 85px 120px 130px';
  const head = $('desp-head');
  if (head) head.style.gridTemplateColumns = cols;

  const searchTerm = $('desp-search')?.value?.toLowerCase() || '';
  const mesFil     = $('desp-mes')?.value    || '';
  const catFil     = $('desp-cat')?.value    || '';
  const stFil      = $('desp-status')?.value || '';

  let data = [...state.allLancamentos];
  if (searchTerm) data = data.filter(l => (l.descricao || '').toLowerCase().includes(searchTerm));
  if (mesFil)     data = data.filter(l => (l.data || '').slice(0, 7) === mesFil);
  if (catFil)     data = data.filter(l => l.categoria === catFil);
  if (stFil)      data = data.filter(l => l.status === stFil);
  data.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  if (!data.length) {
    body.innerHTML = `<div style="padding:2rem;text-align:center;color:var(--text3)">Nenhuma despesa encontrada.</div>`;
    return;
  }

  body.innerHTML = data.map(l => `
    <div class="tbl-row" style="grid-template-columns:${cols}">
      <div style="padding-right:12px;">${fmtDate(l.data)}</div>
      <div>${l.descricao || '—'}</div>
      <div style="white-space:nowrap;">${l.categoria || '-'}</div>
      <div style="text-align:right;font-weight:600">${fmt(l.valor)}</div>
      <div style="text-align:center">${badgeStatus(l.status)}</div>
      <div style="display:flex;gap:.4rem;justify-content:flex-end">
        ${l.status !== 'pago' ? `<button class="btn-action" onclick="window.marcarPago('${l.id}')">✓ Pagar</button>` : ''}
        <button class="btn-action btn-del" onclick="window.deletarLancamento('${l.id}')">🗑</button>
      </div>
    </div>`).join('');

  populateMesFiltro('desp-mes', state.allLancamentos);
  populateCatFiltro('desp-cat', state.allLancamentos);
}

// ── Ações ─────────────────────────────────────────────────────
export async function marcarPago(id) {
  const hoje = new Date().toISOString().slice(0, 10);
  await fbUpdate('lancamentos', id, { status: 'pago', dataPagamento: hoje });
  showToast('Marcado como pago ✅');
}

export async function deletarLancamento(id) {
  if (!confirm('Deseja excluir este lançamento?')) return;
  await fbDelete('lancamentos', id);
  showToast('Lançamento excluído.');
}

// ── Modal Nova Despesa ────────────────────────────────────────
export function openModalDespesa() {
  ['f-desc','f-valor','f-data','fx-valor','fx-dia','fx-inicio','fx-fim',
   'pc-qtd','pc-v1','pc-vn','pc-data1','pc-dia'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  $('f-status') && ($('f-status').value = 'pendente');
  $('modal-title') && ($('modal-title').textContent = 'Nova Despesa');
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
  const desc  = $('f-desc')?.value?.trim();
  const cat   = $('f-cat')?.value;
  const conta = $('f-conta')?.value;

  if (!desc) return showToast('Informe a descrição.', 'err');

  const tipo = currentTipo;
  const rec  = currentRec;

  if (rec === 'unico') {
    const valor  = parseFloat($('f-valor')?.value || 0);
    const data   = $('f-data')?.value;
    const status = $('f-status')?.value || 'pendente';
    if (!data)  return showToast('Informe a data.', 'err');
    if (!valor) return showToast('Informe o valor.', 'err');
    const payload = { descricao: desc, categoria: cat, conta, valor, data, status, tipo, recorrencia: 'unico' };
    if (tipo === 'cartao') payload.cartaoId = $('f-cartao-id')?.value;
    await fbAdd('lancamentos', payload);
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
      promises.push(fbAdd('lancamentos', { descricao: desc, categoria: cat, conta, valor, data, status: 'pendente', tipo, recorrencia: 'fixo' }));
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
        descricao: `${desc} (${i+1}/${qtd})`, categoria: cat, conta, valor, data,
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
  const rows = data.map(l => ({
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
  $('btn-cancel-lanc')?.addEventListener('click', () => closeModal('modal-lancamento'));

  // Importar
  const btnImport  = $('btn-import-desp');
  const fileImport = $('file-import-desp');
  if (btnImport && fileImport) {
    btnImport.addEventListener('click', () => fileImport.click());
    fileImport.addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file) return;
      importarDespesasExcel(file);
      e.target.value = '';
    });
  }

  // Exportar
  $('btn-export-desp')?.addEventListener('click', () => exportXLSX('lancamentos', 'Despesas_Clarim'));

  // Filtros
  ['desp-search','desp-mes','desp-cat','desp-status'].forEach(id => {
    $(id)?.addEventListener('input',  renderDespesas);
    $(id)?.addEventListener('change', renderDespesas);
  });
}
