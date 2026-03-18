// ============================================================
// CLARIM — ui.js
// Navegação, modais, dashboard, relatórios e assistente IA
// ============================================================

import { $, showEl, hideEl, fmt, fmtDate, MONTHS } from './utils.js';
import { state } from './firebase.js';

// ── Páginas ──────────────────────────────────────────────────
export const PAGES = [
  'dashboard','despesas','receitas','cartoes',
  'contas','categorias','relatorios','configuracoes'
];

// Mapa de render functions preenchido pelo app.js (evita dependência circular)
const pageRenderers = {};

export function setPageRenderers(map) {
  Object.assign(pageRenderers, map);
}

export function navigateTo(page) {
  PAGES.forEach(p => {
    const pg = $('page-' + p);
    const nb = $('nav-'  + p);
    if (pg) pg.classList.toggle('active', p === page);
    if (nb) nb.classList.toggle('active', p === page);
  });
  pageRenderers[page]?.();
}

// ── Saudação ─────────────────────────────────────────────────
export function updateGreeting() {
  const h      = new Date().getHours();
  const period = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name   = state.currentUser?.displayName
    || state.currentUser?.email?.split('@')[0]
    || 'você';
  const el = $('dash-greeting');
  if (el) el.textContent = `${period}, ${name}! 👋`;
  const sbName = $('sb-name');
  if (sbName) sbName.textContent = name;
}

// ── Telas ────────────────────────────────────────────────────
export function showLogin() {
  hideEl('app');
  showEl('login-screen');
}

export function showDashboard() {
  hideEl('login-screen');
  showEl('app');
  updateGreeting();
  navigateTo('dashboard');
}

// ── Modais ───────────────────────────────────────────────────
export function openModal(id)  { const m = $(id); if (m) m.classList.add('open'); }
export function closeModal(id) { const m = $(id); if (m) m.classList.remove('open'); }

// ── Helpers de UI compartilhados ─────────────────────────────
export function badgeStatus(st) {
  const map = {
    pago:     '<span class="badge b-pago">✅ Pago</span>',
    pendente: '<span class="badge b-previsto">⏳ Pendente</span>',
    avencer:  '<span class="badge b-previsto">⏳ À Vencer</span>',
    atrasado: '<span class="badge b-atrasado">❌ Atrasado</span>',
    recebido: '<span class="badge b-pago">✅ Recebido</span>',
    previsto: '<span class="badge b-previsto">⏳ Previsto</span>',
  };
  return map[st] || `<span class="badge">${st || '—'}</span>`;
}

export function populateMesFiltro(selId, arr) {
  const sel = $(selId);
  if (!sel) return;
  const meses   = [...new Set(arr.map(l => (l.data || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os meses</option>' +
    meses.map(m => {
      const [y, mo] = m.split('-');
      return `<option value="${m}" ${m === current ? 'selected' : ''}>${MONTHS[parseInt(mo) - 1]} ${y}</option>`;
    }).join('');
}

export function populateCatFiltro(selId, arr) {
  const sel = $(selId);
  if (!sel) return;
  const cats    = [...new Set(arr.map(l => l.categoria).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas categorias</option>' +
    cats.map(c => `<option value="${c}" ${c === current ? 'selected' : ''}>${c}</option>`).join('');
}

// ── Dashboard ────────────────────────────────────────────────
export function updateMonthLabel() {
  const el = $('month-label');
  if (el) el.textContent = `${MONTHS[state.currentMonth]} ${state.currentYear}`;
}

export function lancamentosDoMes() {
  return state.allLancamentos.filter(l => {
    if (!l.data) return false;
    const [y, m] = l.data.split('-');
    return parseInt(m) - 1 === state.currentMonth && parseInt(y) === state.currentYear;
  });
}

export function receitasDoMes() {
  return state.allReceitas.filter(r => {
    if (!r.data) return false;
    const [y, m] = r.data.split('-');
    return parseInt(m) - 1 === state.currentMonth && parseInt(y) === state.currentYear;
  });
}

export function renderDashboard() {
  updateMonthLabel();

  const desp  = lancamentosDoMes();
  const recs  = receitasDoMes();
  const hoje  = new Date().toISOString().slice(0, 10);

  const totalDesp   = desp.reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalRec    = recs.reduce((s, r) => s + Number(r.valor || 0), 0);
  const saldo       = totalRec - totalDesp;
  const emAtraso    = desp.filter(l => l.status === 'atrasado' || (l.status === 'pendente' && l.data < hoje));
  const totalAtraso = emAtraso.reduce((s, l) => s + Number(l.valor || 0), 0);

  const set = (id, val) => { const e = $(id); if (e) e.textContent = val; };
  set('d-rec',    fmt(totalRec));
  set('d-desp',   fmt(totalDesp));
  set('d-saldo',  fmt(saldo));
  set('d-atraso', fmt(totalAtraso));

  const saldoEl = $('d-saldo');
  if (saldoEl) saldoEl.className = 'sc-value ' + (saldo >= 0 ? 'c-green' : 'c-red');

  set('d-rec-s',    `${recs.length} lançamento(s)`);
  set('d-desp-s',   `${desp.length} lançamento(s)`);
  set('d-saldo-s',  saldo >= 0 ? 'Superávit' : 'Déficit');
  set('d-atraso-s', `${emAtraso.length} em atraso`);

  _renderProxVenc(desp);
  _renderCatChart(desp);
}

function _renderProxVenc(desp) {
  const el = $('prox-list');
  if (!el) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const prox = [...desp]
    .filter(l => l.status !== 'pago' && l.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, 5);

  if (!prox.length) {
    el.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;text-align:center">Nenhum vencimento próximo 🎉</div>';
    return;
  }
  el.innerHTML = prox.map(l => `
    <div style="display:flex;align-items:center;gap:10px;padding:.7rem .5rem;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:500">${l.descricao || '—'}</div>
        <div style="font-size:.72rem;color:var(--text3)">${fmtDate(l.data)} · ${l.categoria || ''}</div>
      </div>
      <div style="font-family:var(--fd);font-weight:600;color:var(--red)">${fmt(l.valor)}</div>
    </div>`).join('');
}

function _renderCatChart(desp) {
  const el = $('cat-list');
  if (!el) return;
  const bycat = {};
  desp.forEach(l => { const c = l.categoria || 'Outros'; bycat[c] = (bycat[c] || 0) + Number(l.valor || 0); });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total  = sorted.reduce((s, [, v]) => s + v, 0);

  if (!sorted.length) {
    el.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;text-align:center">Sem dados</div>';
    return;
  }
  el.innerHTML = sorted.map(([cat, val]) => {
    const pct = total ? Math.round((val / total) * 100) : 0;
    return `
    <div style="margin-bottom:.75rem">
      <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.3rem">
        <span>${cat}</span><span style="color:var(--text3)">${fmt(val)} (${pct}%)</span>
      </div>
      <div style="height:5px;background:var(--bg3);border-radius:4px">
        <div style="height:100%;width:${pct}%;background:var(--green);border-radius:4px;transition:width .4s"></div>
      </div>
    </div>`;
  }).join('');
}

// ── Relatórios ────────────────────────────────────────────────
export function renderRelatorios() {
  const el = $('relat-content');
  if (!el) return;

  const totalDesp = state.allLancamentos.reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalRec  = state.allReceitas.reduce((s, r)   => s + Number(r.valor || 0), 0);
  const saldo     = totalRec - totalDesp;
  const pagos     = state.allLancamentos
    .filter(l => l.status === 'pago')
    .reduce((s, l) => s + Number(l.valor || 0), 0);

  el.innerHTML = `
    <div class="cards4" style="margin-bottom:1.5rem">
      <div class="scard"><div class="sc-label">Total Receitas</div><div class="sc-value c-green">${fmt(totalRec)}</div></div>
      <div class="scard"><div class="sc-label">Total Despesas</div><div class="sc-value c-red">${fmt(totalDesp)}</div></div>
      <div class="scard"><div class="sc-label">Saldo Geral</div><div class="sc-value ${saldo >= 0 ? 'c-green' : 'c-red'}">${fmt(saldo)}</div></div>
      <div class="scard"><div class="sc-label">Total Pago</div><div class="sc-value c-green">${fmt(pagos)}</div></div>
    </div>
    <div class="panel">
      <div class="panel-hd"><div class="panel-title">Gastos por Categoria (todos os períodos)</div></div>
      <div id="relat-cat"></div>
    </div>`;

  const bycat  = {};
  state.allLancamentos.forEach(l => {
    const c = l.categoria || 'Outros';
    bycat[c] = (bycat[c] || 0) + Number(l.valor || 0);
  });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]);
  const total  = sorted.reduce((s, [, v]) => s + v, 0);
  const catEl  = $('relat-cat');
  if (catEl) {
    catEl.innerHTML = sorted.length
      ? sorted.map(([cat, val]) => {
          const pct = total ? Math.round((val / total) * 100) : 0;
          return `
          <div style="margin-bottom:.75rem">
            <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.3rem">
              <span>${cat}</span><span style="color:var(--text3)">${fmt(val)} (${pct}%)</span>
            </div>
            <div style="height:6px;background:var(--bg3);border-radius:4px">
              <div style="height:100%;width:${pct}%;background:var(--green);border-radius:4px"></div>
            </div>
          </div>`;
        }).join('')
      : '<div style="padding:1rem;color:var(--text3)">Sem dados.</div>';
  }
}

// ── Assistente IA ─────────────────────────────────────────────
const AI_CHIPS = [
  'Como está meu saldo?',
  'Qual minha maior despesa?',
  'Dicas para economizar',
  'Resumo do mês',
];

export function renderAIChips() {
  const el = $('ai-chips');
  if (!el) return;
  el.innerHTML = AI_CHIPS.map(c =>
    `<div class="ai-chip" onclick="document.getElementById('ai-inp').value='${c}';window.sendAI()">${c}</div>`
  ).join('');
}

export async function sendAI() {
  const inp  = $('ai-inp');
  const msgs = $('ai-msgs');
  if (!inp || !msgs) return;
  const q = inp.value.trim();
  if (!q) return;

  const totalDesp = state.allLancamentos.reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalRec  = state.allReceitas.reduce((s, r)   => s + Number(r.valor || 0), 0);
  const context   = `Dados financeiros do usuário: Total despesas = R$ ${totalDesp.toFixed(2)}, Total receitas = R$ ${totalRec.toFixed(2)}, Saldo = R$ ${(totalRec - totalDesp).toFixed(2)}.`;

  msgs.innerHTML += `<div style="text-align:right;margin:.4rem 0"><span style="background:var(--bg3);padding:.4rem .8rem;border-radius:10px;font-size:.82rem;display:inline-block">${q}</span></div>`;
  inp.value = '';

  const thinking = document.createElement('div');
  thinking.style.cssText = 'font-size:.82rem;color:var(--text3);margin:.4rem 0';
  thinking.textContent = 'Analisando...';
  msgs.appendChild(thinking);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 400,
        system: `Você é um assistente financeiro do app CLARIM. Responda de forma breve e direta. ${context}`,
        messages: [{ role: 'user', content: q }]
      })
    });
    const data   = await resp.json();
    const answer = data?.content?.[0]?.text || 'Sem resposta.';
    thinking.style.cssText = 'font-size:.82rem;color:var(--text2);margin:.4rem 0;line-height:1.5;background:rgba(79,255,176,.06);padding:.6rem .8rem;border-radius:10px;border-left:2px solid var(--green)';
    thinking.textContent = answer;
  } catch {
    thinking.textContent = 'Erro ao conectar com o assistente.';
  }
  msgs.scrollTop = msgs.scrollHeight;
}
