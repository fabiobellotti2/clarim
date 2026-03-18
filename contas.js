// ============================================================
// CLARIM — contas.js
// Contas bancárias e cartões de crédito (renderização e CRUD)
// ============================================================

import { $, fmt, fmtDate, showToast } from './utils.js';
import { state, fbAdd, fbDelete } from './firebase.js';
import { openModal, closeModal, badgeStatus } from './ui.js';

// ── CONTAS BANCÁRIAS ──────────────────────────────────────────

export function renderContas() {
  const grid = $('contas-grid');
  if (!grid) return;

  if (!state.allContas.length) {
    grid.innerHTML = '<div style="color:var(--text3);font-size:.85rem;grid-column:1/-1">Nenhuma conta cadastrada.</div>';
    return;
  }

  const icons = { corrente: '🏦', digital: '📱', poupanca: '💰', carteira: '👛', investimento: '📈' };
  grid.innerHTML = state.allContas.map(c => `
    <div class="scard">
      <div class="sc-label">${icons[c.tipo] || '🏦'} ${c.nome}</div>
      <div class="sc-value c-green">${fmt(c.saldo)}</div>
      <div style="font-size:.72rem;color:var(--text3);margin-top:.3rem">${c.tipo || ''}</div>
      <button class="btn-action btn-del" style="margin-top:.5rem" onclick="window.deletarConta('${c.id}')">🗑 Remover</button>
    </div>`).join('');
}

export async function deletarConta(id) {
  if (!confirm('Remover esta conta?')) return;
  await fbDelete('contas', id);
  showToast('Conta removida.');
}

export async function salvarConta() {
  const nome  = $('cnt-nome')?.value?.trim();
  const tipo  = $('cnt-tipo')?.value  || 'corrente';
  const saldo = parseFloat($('cnt-saldo')?.value || 0);
  if (!nome) return showToast('Informe o nome da conta.', 'err');
  await fbAdd('contas', { nome, tipo, saldo });
  showToast('Conta salva ✅');
  closeModal('modal-conta');
}

export function populateContaSel() {
  const sel = $('b-conta');
  if (!sel) return;
  sel.innerHTML = state.allContas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('')
    || '<option value="">Nenhuma conta</option>';
}

// ── CARTÕES DE CRÉDITO ────────────────────────────────────────

export function renderCartoes() {
  const grid = $('cartoes-grid');
  if (!grid) return;

  if (!state.allCartoes.length) {
    grid.innerHTML = '<div style="color:var(--text3);font-size:.85rem;grid-column:1/-1">Nenhum cartão cadastrado. Clique em "+ Novo Cartão".</div>';
    return;
  }

  grid.innerHTML = state.allCartoes.map(c => {
    const gasto = state.allLancamentos
      .filter(l => l.cartaoId === c.id)
      .reduce((s, l) => s + Number(l.valor || 0), 0);
    const pct = c.limite ? Math.min(Math.round((gasto / c.limite) * 100), 100) : 0;
    return `
    <div class="scard" style="cursor:pointer" onclick="window.verFatura('${c.id}')">
      <div class="sc-label">💳 ${c.nome}</div>
      <div class="sc-value">${fmt(gasto)}<span style="font-size:.7rem;color:var(--text3)"> / ${fmt(c.limite)}</span></div>
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
  await fbAdd('cartoes', { nome, limite, fechamento, vencimento });
  showToast('Cartão salvo ✅');
  closeModal('modal-cartao');
}

export function verFatura(id) {
  const cartao = state.allCartoes.find(c => c.id === id);
  if (!cartao) return;
  const panel = $('panel-fatura');
  const title = $('fatura-title');
  const body  = $('fatura-body');
  if (!panel || !body) return;

  const faturas = state.allLancamentos.filter(l => l.cartaoId === id);
  title.textContent = `Fatura — ${cartao.nome}`;

  if (!faturas.length) {
    body.innerHTML = '<div style="padding:1rem;color:var(--text3)">Sem lançamentos neste cartão.</div>';
  } else {
    body.innerHTML = faturas.map(l => `
      <div style="display:flex;align-items:center;gap:10px;padding:.6rem .5rem;border-bottom:1px solid var(--border)">
        <div style="flex:1">
          <div style="font-size:.85rem">${l.descricao}</div>
          <div style="font-size:.72rem;color:var(--text3)">${fmtDate(l.data)}</div>
        </div>
        <div style="font-weight:600">${fmt(l.valor)}</div>
        ${badgeStatus(l.status)}
      </div>`).join('');
  }
  panel.style.display = '';
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
}
