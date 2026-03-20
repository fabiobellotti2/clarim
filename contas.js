// ============================================================
// CLARIM — contas.js
// Contas bancárias, cartões de crédito, ajuste de saldo e
// pagamento de fatura
// ============================================================

import { $, fmt, fmtDate, showToast, MONTHS, bankDot } from './utils.js';
import { state, fbAdd, fbUpdate, fbDelete, fbTransact } from './firebase.js';
import { openModal, closeModal, badgeStatus } from './ui.js';

// ── Estado local ──────────────────────────────────────────────
let ajusteContaId = null;
let pfCartaoId    = null;
let pfFaturaRef   = null;

// ══════════════════════════════════════════════════════════════
// HELPERS DE SALDO / LIMITE
// ══════════════════════════════════════════════════════════════

/**
 * Atualiza o saldo de uma conta bancária no Firestore.
 * @param {string} contaId
 * @param {number} valor
 * @param {'soma'|'subtracao'} tipo
 */
export async function atualizarSaldoConta(contaId, valor, tipo) {
  if (!contaId) return false;
  // Transação atômica: lê o saldo diretamente do Firestore antes de calcular,
  // evitando race conditions em lançamentos simultâneos (ex: dois usuários da família).
  await fbTransact('contas', contaId, (data) => {
    const saldoAtual = parseFloat(data.saldo) || 0;
    const delta      = parseFloat(valor)      || 0;
    const novoSaldo  = tipo === 'soma' ? saldoAtual + delta : saldoAtual - delta;
    return { saldo: novoSaldo };
  });
  showToast('Saldo da conta atualizado.');
  return true;
}

/**
 * Atualiza o limiteDisponivel de um cartão no Firestore.
 * @param {string} cartaoId
 * @param {number} valor
 * @param {'soma'|'subtracao'} tipo
 */
export async function atualizarLimiteCartao(cartaoId, valor, tipo) {
  if (!cartaoId) return false;
  // Transação atômica: mesmo motivo — múltiplos lançamentos no cartão
  // no mesmo instante não devem sobrescrever o cálculo um do outro.
  await fbTransact('cartoes', cartaoId, (data) => {
    const limiteAtual = parseFloat(data.limiteDisponivel ?? data.limite) || 0;
    const delta       = parseFloat(valor) || 0;
    const novoLimite  = tipo === 'soma' ? limiteAtual + delta : limiteAtual - delta;
    return { limiteDisponivel: novoLimite };
  });
  return true;
}

// ══════════════════════════════════════════════════════════════
// CONTAS BANCÁRIAS
// ══════════════════════════════════════════════════════════════

export function renderContas() {
  const grid = $('contas-grid');
  if (!grid) return;

  if (!state.allContas.length) {
    grid.innerHTML = '<div style="color:var(--text3);font-size:.85rem;grid-column:1/-1">Nenhuma conta cadastrada.</div>';
    return;
  }

  const TIPO_LABEL = { corrente:'Conta Corrente', digital:'Conta Digital', poupanca:'Poupança', carteira:'Carteira', investimento:'Investimento' };
  grid.innerHTML = state.allContas.map(c => `
    <div class="scard">
      <div style="display:flex;align-items:center;gap:.65rem;margin-bottom:.6rem">
        ${bankDot(c.banco)}
        <div>
          <div style="font-weight:600;font-size:.9rem;line-height:1.2">${c.nome}</div>
          <div style="font-size:.65rem;color:var(--text3)">${TIPO_LABEL[c.tipo] || c.tipo || ''}</div>
        </div>
      </div>
      <div style="font-size:.6rem;color:var(--text3);text-transform:uppercase;letter-spacing:.8px">Saldo Atual</div>
      <div class="sc-value c-green" style="margin:.2rem 0">${fmt(c.saldo)}</div>
      <div style="display:flex;gap:.4rem;margin-top:.5rem">
        <button class="btn-action" onclick="window.abrirAjusteSaldo('${c.id}')">✏️ Ajuste</button>
        <button class="btn-action btn-del" onclick="window.deletarConta('${c.id}')">🗑 Remover</button>
      </div>
    </div>`).join('');
}

export async function deletarConta(id) {
  const conta = state.allContas.find(c => c.id === id);

  const vinculados = [
    ...state.allLancamentos.filter(l => l.contaId === id || l.conta === conta?.nome),
    ...state.allReceitas.filter(r => r.contaId === id || r.conta === conta?.nome),
  ];

  if (vinculados.length) {
    console.warn(`[Clarim] Exclusão bloqueada — ${vinculados.length} lançamento(s) vinculado(s) à conta "${conta?.nome}"`, vinculados);
    const navegar = confirm(
      `"${conta?.nome}" possui ${vinculados.length} lançamento(s) vinculado(s) e não pode ser removida.\n\n` +
      `Deseja ir para Despesas filtrado por esta conta para conciliá-los?`
    );
    if (navegar) {
      document.dispatchEvent(new CustomEvent('clarim:navegar-conta', { detail: { contaId: id } }));
    }
    return;
  }

  if (!confirm('Remover esta conta?')) return;
  await fbDelete('contas', id);
  showToast('Conta removida.');
}

export function abrirAjusteSaldo(id) {
  const conta = state.allContas.find(c => c.id === id);
  if (!conta) return;

  ajusteContaId = id;

  const box = $('ajuste-info-box');
  if (box) box.innerHTML = `
    <div class="baixa-row"><span>Conta</span><span>${conta.nome}</span></div>
    <div class="baixa-row"><span>Tipo</span><span>${conta.tipo || '—'}</span></div>
    <div class="baixa-row"><span>Saldo atual</span><span style="font-weight:600;color:var(--green)">${fmt(parseFloat(conta.saldo) || 0)}</span></div>`;

  const inp = $('ajuste-novo-saldo');
  if (inp) inp.value = (parseFloat(conta.saldo) || 0).toFixed(2);

  const cb = $('ajuste-criar-lanc');
  if (cb) cb.checked = true;

  openModal('modal-ajuste-saldo');
}

async function confirmarAjuste() {
  const conta = state.allContas.find(c => c.id === ajusteContaId);
  if (!conta) return;

  const novoSaldo = parseFloat($('ajuste-novo-saldo')?.value);
  if (isNaN(novoSaldo)) return showToast('Informe o novo saldo.', 'err');

  const saldoAtual = parseFloat(conta.saldo) || 0;
  const diferenca  = novoSaldo - saldoAtual;

  if (diferenca === 0) {
    showToast('Saldo não foi alterado.');
    closeModal('modal-ajuste-saldo');
    ajusteContaId = null;
    return;
  }

  if (diferenca > 0) {
    await atualizarSaldoConta(ajusteContaId, diferenca, 'soma');
  } else {
    await atualizarSaldoConta(ajusteContaId, Math.abs(diferenca), 'subtracao');
  }

  if ($('ajuste-criar-lanc')?.checked) {
    const hoje = new Date().toISOString().slice(0, 10);
    await fbAdd('lancamentos', {
      descricao:     `Ajuste de Saldo — ${conta.nome}`,
      categoria:     'Ajuste de Saldo',
      conta:         conta.nome,
      contaId:       ajusteContaId,
      valor:         Math.abs(diferenca),
      data:          hoje,
      status:        'pago',
      tipo:          diferenca > 0 ? 'entrada' : 'debito',
      recorrencia:   'unico',
      valorPago:     Math.abs(diferenca),
      dataPagamento: hoje,
    });
  }

  closeModal('modal-ajuste-saldo');
  ajusteContaId = null;
}

export async function salvarConta() {
  const nome  = $('cnt-nome')?.value?.trim();
  const banco = $('cnt-banco')?.value  || '';
  const tipo  = $('cnt-tipo')?.value   || 'corrente';
  const saldo = parseFloat($('cnt-saldo')?.value || 0);
  if (!nome) return showToast('Informe o nome da conta.', 'err');
  await fbAdd('contas', { nome, banco, tipo, saldo });
  showToast('Conta salva ✅');
  closeModal('modal-conta');
}

export function populateContaSel() {
  const sel = $('b-conta');
  if (!sel) return;
  sel.innerHTML = state.allContas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')
    || '<option value="">Nenhuma conta</option>';
}

// ══════════════════════════════════════════════════════════════
// CARTÕES DE CRÉDITO
// ══════════════════════════════════════════════════════════════

export function renderCartoes() {
  const grid = $('cartoes-grid');
  if (!grid) return;

  if (!state.allCartoes.length) {
    grid.innerHTML = '<div style="color:var(--text3);font-size:.85rem;grid-column:1/-1">Nenhum cartão cadastrado. Clique em "+ Novo Cartão".</div>';
    return;
  }

  grid.innerHTML = state.allCartoes.map(c => {
    const limiteTotal = parseFloat(c.limite) || 0;
    // Usa limiteDisponivel salvo ou computa a partir dos lançamentos (retrocompat.)
    const limiteDisp = c.limiteDisponivel !== undefined
      ? parseFloat(c.limiteDisponivel)
      : limiteTotal - state.allLancamentos
          .filter(l => l.cartaoId === c.id && l.status !== 'pago')
          .reduce((s, l) => s + Number(l.valor || 0), 0);
    const gasto = limiteTotal - limiteDisp;
    const pct   = limiteTotal ? Math.min(Math.round((gasto / limiteTotal) * 100), 100) : 0;

    return `
    <div class="scard" style="cursor:pointer" onclick="window.verFatura('${c.id}')">
      <div class="sc-label">💳 ${c.nome}</div>
      <div class="sc-value">${fmt(Math.max(limiteDisp, 0))}<span style="font-size:.7rem;color:var(--text3)"> disponível</span></div>
      <div style="font-size:.68rem;color:var(--text3);margin:.2rem 0">Limite total: ${fmt(limiteTotal)}</div>
      <div style="height:4px;background:var(--bg3);border-radius:4px;margin:.5rem 0">
        <div style="height:100%;width:${pct}%;background:${pct > 80 ? 'var(--red)' : 'var(--green)'};border-radius:4px"></div>
      </div>
      <div style="font-size:.72rem;color:var(--text3)">Fecha dia ${c.fechamento} · Vence dia ${c.vencimento}</div>
      <button class="btn-action btn-del" style="margin-top:.5rem" onclick="event.stopPropagation();window.deletarCartao('${c.id}')">🗑 Remover</button>
    </div>`;
  }).join('');
}

export async function deletarCartao(id) {
  if (!confirm('Remover este cartão?')) return;
  await fbDelete('cartoes', id);
  showToast('Cartão removido.');
}

export async function salvarCartao() {
  const nome       = $('cc-nome')?.value?.trim();
  const limite     = parseFloat($('cc-limite')?.value     || 0);
  const fechamento = parseInt($('cc-fechamento')?.value   || 1);
  const vencimento = parseInt($('cc-vencimento')?.value   || 10);
  if (!nome) return showToast('Informe o nome do cartão.', 'err');
  // limiteDisponivel começa igual ao limite total
  await fbAdd('cartoes', { nome, limite, fechamento, vencimento, limiteDisponivel: limite });
  showToast('Cartão salvo ✅');
  closeModal('modal-cartao');
}

// ── Visualização de Fatura (agrupada por mês de competência) ─
export function verFatura(id) {
  const cartao = state.allCartoes.find(c => c.id === id);
  if (!cartao) return;
  const panel = $('panel-fatura');
  const title = $('fatura-title');
  const body  = $('fatura-body');
  if (!panel || !body) return;

  const todos = state.allLancamentos.filter(l => l.cartaoId === id);
  title.textContent = `Fatura — ${cartao.nome}`;

  if (!todos.length) {
    body.innerHTML = '<div style="padding:1rem;color:var(--text3)">Sem lançamentos neste cartão.</div>';
    panel.style.display = '';
    return;
  }

  // Agrupa por faturaRef (fallback para mês da data para registros legados)
  const grupos = {};
  todos.forEach(l => {
    const ref = l.faturaRef || (l.data || '').slice(0, 7);
    if (!grupos[ref]) grupos[ref] = [];
    grupos[ref].push(l);
  });

  const refs = Object.keys(grupos).sort().reverse();

  body.innerHTML = refs.map(ref => {
    const itens     = grupos[ref];
    const total     = itens.reduce((s, l) => s + Number(l.valor || 0), 0);
    const naoPagas  = itens.filter(l => l.status !== 'pago');
    const [y, m]    = ref.split('-');
    const mesLabel  = `${MONTHS[parseInt(m) - 1]} ${y}`;

    return `
    <div style="margin-bottom:1.2rem">
      <div style="display:flex;align-items:center;justify-content:space-between;
                  padding:.5rem .6rem;background:var(--bg3);border-radius:8px;margin-bottom:.3rem">
        <div style="font-size:.8rem;font-weight:600;color:var(--text2)">${mesLabel}</div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span style="font-weight:600">${fmt(total)}</span>
          ${naoPagas.length > 0
            ? `<button class="btn-action" style="font-size:.7rem;padding:.2rem .5rem"
                onclick="window.abrirPagarFatura('${id}','${ref}')">Pagar</button>`
            : '<span class="badge b-pago" style="font-size:.65rem">✅ Pago</span>'}
        </div>
      </div>
      ${itens.map(l => `
        <div style="display:flex;align-items:center;gap:10px;padding:.5rem .5rem;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-size:.82rem">${l.descricao || '—'}</div>
            <div style="font-size:.68rem;color:var(--text3)">${fmtDate(l.data)}</div>
          </div>
          <div style="font-weight:600;font-size:.9rem">${fmt(l.valor)}</div>
          ${badgeStatus(l.status)}
        </div>`).join('')}
    </div>`;
  }).join('');

  panel.style.display = '';
}

// ── Pagamento de Fatura ───────────────────────────────────────
/**
 * Abre o modal de pagamento de fatura.
 * @param {string} cartaoId
 * @param {string} faturaRef - 'YYYY-MM' ou '' para todas as faturas em aberto
 */
export function abrirPagarFatura(cartaoId, faturaRef = '') {
  const cartao = state.allCartoes.find(c => c.id === cartaoId);
  if (!cartao) return;

  const itens = _itensFatura(cartaoId, faturaRef);
  if (!itens.length) {
    showToast('Sem lançamentos em aberto para esta fatura.', 'err');
    return;
  }

  pfCartaoId  = cartaoId;
  pfFaturaRef = faturaRef;

  const total    = itens.reduce((s, l) => s + Number(l.valor || 0), 0);
  const mesLabel = faturaRef
    ? (() => { const [y, m] = faturaRef.split('-'); return `${MONTHS[parseInt(m) - 1]} ${y}`; })()
    : 'Todos os meses em aberto';

  const box = $('pf-box');
  if (box) box.innerHTML = `
    <div class="baixa-row"><span>Cartão</span><span>💳 ${cartao.nome}</span></div>
    <div class="baixa-row"><span>Competência</span><span>${mesLabel}</span></div>
    <div class="baixa-row"><span>Lançamentos</span><span>${itens.length} item(s)</span></div>
    <div class="baixa-row"><span>Total a Pagar</span>
      <span style="font-weight:700;color:var(--red)">${fmt(total)}</span></div>`;

  const sel = $('pf-conta');
  if (sel) {
    sel.innerHTML = state.allContas.length
      ? state.allContas.map(c =>
          `<option value="${c.id}">${c.nome} — ${fmt(parseFloat(c.saldo) || 0)}</option>`
        ).join('')
      : '<option value="">Nenhuma conta cadastrada</option>';
  }

  $('pf-data') && ($('pf-data').value = new Date().toISOString().slice(0, 10));
  openModal('modal-pagar-fatura');
}

/** Filtra os lançamentos da fatura a pagar. */
function _itensFatura(cartaoId, faturaRef) {
  return state.allLancamentos.filter(l => {
    if (l.cartaoId !== cartaoId) return false;
    if (l.status === 'pago')     return false;
    if (faturaRef) {
      return (l.faturaRef || (l.data || '').slice(0, 7)) === faturaRef;
    }
    return true; // todas em aberto
  });
}

async function confirmarPagarFatura() {
  const contaId = $('pf-conta')?.value;
  const dataPag = $('pf-data')?.value;

  if (!contaId) return showToast('Selecione a conta de débito.', 'err');
  if (!dataPag) return showToast('Informe a data do pagamento.', 'err');

  const itens = _itensFatura(pfCartaoId, pfFaturaRef);
  if (!itens.length) {
    showToast('Nenhum lançamento em aberto encontrado.', 'err');
    closeModal('modal-pagar-fatura');
    return;
  }

  const total = itens.reduce((s, l) => s + Number(l.valor || 0), 0);

  // 1. Debita da conta bancária
  await atualizarSaldoConta(contaId, total, 'subtracao');

  // 2. Restaura o limite disponível do cartão
  await atualizarLimiteCartao(pfCartaoId, total, 'soma');

  // 3. Marca todos os lançamentos da fatura como pagos
  await Promise.all(itens.map(l =>
    fbUpdate('lancamentos', l.id, { status: 'pago', dataPagamento: dataPag, contaId })
  ));

  pfCartaoId  = null;
  pfFaturaRef = null;
  closeModal('modal-pagar-fatura');
  showToast(`Fatura de ${fmt(total)} paga com sucesso ✅`);
}

// ── Inicialização dos event listeners ─────────────────────────
export function initContas() {
  // Cartões
  $('btn-novo-cartao')?.addEventListener('click', () => openModal('modal-cartao'));
  $('btn-save-cc')?.addEventListener('click',     salvarCartao);
  $('btn-cancel-cc')?.addEventListener('click',   () => closeModal('modal-cartao'));
  $('btn-fechar-fatura')?.addEventListener('click', () => {
    const p = $('panel-fatura');
    if (p) p.style.display = 'none';
  });

  // Contas
  $('btn-nova-conta')?.addEventListener('click',   () => openModal('modal-conta'));
  $('btn-save-conta')?.addEventListener('click',   salvarConta);
  $('btn-cancel-conta')?.addEventListener('click', () => closeModal('modal-conta'));

  // Ajuste de saldo
  $('btn-save-ajuste')?.addEventListener('click', confirmarAjuste);
  $('btn-cancel-ajuste')?.addEventListener('click', () => {
    ajusteContaId = null;
    closeModal('modal-ajuste-saldo');
  });

  // Pagamento de fatura
  $('btn-save-pagar-fatura')?.addEventListener('click',   confirmarPagarFatura);
  $('btn-cancel-pagar-fatura')?.addEventListener('click', () => {
    pfCartaoId  = null;
    pfFaturaRef = null;
    closeModal('modal-pagar-fatura');
  });
}
