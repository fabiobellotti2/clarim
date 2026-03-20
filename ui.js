// ============================================================
// CLARIM — ui.js
// Navegação, modais, dashboard, relatórios e assistente IA
// ============================================================

import { $, showEl, hideEl, fmt, fmtDate, MONTHS, bankDot } from './utils.js';
import { state } from './firebase.js';

// ── Helper retrocompat de valor efetivo ─────────────────────
// Prioridade: valorTotal → (valorOriginal + valorAjuste) → valor legado
function _vt(l) {
  if (l.valorTotal !== undefined && l.valorTotal !== null && l.valorTotal !== '') return Number(l.valorTotal);
  if (l.valorOriginal !== undefined) return Number(l.valorOriginal || 0) + Number(l.valorAjuste || 0);
  return Number(l.valor || 0);
}

// ── Páginas ──────────────────────────────────────────────────
export const PAGES = [
  'dashboard','despesas','receitas','cartoes',
  'contas','categorias','relatorios','ia','configuracoes'
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
  if (page === 'ia') setTimeout(() => $('ai-inp')?.focus(), 50);
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
    avencer:  '<span class="badge b-avencer">⏳ À Vencer</span>',
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

// Retorna o ícone salvo no state para uma categoria (sem importar categorias.js)
function _catIcon(nome) {
  if (!nome) return '🏷️';
  return state.allCategorias.find(c => c.nome === nome)?.icon || '🏷️';
}

export function populateCatFiltro(selId, arr) {
  const sel = $(selId);
  if (!sel) return;
  const cats    = [...new Set(arr.map(l => l.categoria).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas categorias</option>' +
    cats.map(c => `<option value="${c}" ${c === current ? 'selected' : ''}>${_catIcon(c)} ${c}</option>`).join('');
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

  // Separa despesas cash (não-cartão) de gastos no cartão
  const despCash    = desp.filter(l => l.tipo !== 'cartao');
  const totalDesp   = despCash.reduce((s, l) => s + _vt(l), 0);
  const totalRec    = recs.reduce((s, r)     => s + Number(r.valor || 0), 0);
  const saldo       = totalRec - totalDesp;
  const emAtraso    = despCash.filter(l => l.status === 'atrasado' || (l.status === 'pendente' && l.data < hoje));
  const totalAtraso = emAtraso.reduce((s, l) => s + _vt(l), 0);

  // Faturas em aberto (todos os cartões, todos os meses)
  const faturasAbertas = state.allLancamentos.filter(l => l.tipo === 'cartao' && l.status !== 'pago');
  const totalFaturas   = faturasAbertas.reduce((s, l) => s + _vt(l), 0);

  // ── Cashflow Header: visão completa (cash + cartão do mês) ──
  const totalDespFull = desp.reduce((s, l) => s + _vt(l), 0);
  const saldoFull     = totalRec - totalDespFull;

  const cfSaldoEl = $('cf-saldo');
  if (cfSaldoEl) {
    cfSaldoEl.innerHTML   = saldoFull >= 0
      ? fmt(saldoFull)
      : `<span class="cf-alert">⚠️</span> ${fmt(saldoFull)}`;
    cfSaldoEl.className   = 'cf-value ' + (saldoFull >= 0 ? 'c-green' : 'c-red');
  }
  const cfRec   = $('cf-rec');   if (cfRec)   cfRec.textContent   = fmt(totalRec);
  const cfDesp  = $('cf-desp');  if (cfDesp)  cfDesp.textContent  = fmt(totalDespFull);
  const cfRecS  = $('cf-rec-s'); if (cfRecS)  cfRecS.textContent  = `${recs.length} recebimento(s)`;
  const cfDespS = $('cf-desp-s');if (cfDespS) cfDespS.textContent = `${desp.length} lanç. · incl. cartão`;
  const cfSaldoS= $('cf-saldo-s');if(cfSaldoS) cfSaldoS.textContent = saldoFull >= 0 ? 'Superávit do mês' : 'Déficit do mês';

  // Barra de proporção: % de despesas sobre receitas (0–100)
  const cfPct = totalRec > 0
    ? Math.min(Math.round((totalDespFull / totalRec) * 100), 100)
    : (totalDespFull > 0 ? 100 : 0);
  const cfBar = $('cf-progress');
  if (cfBar) {
    cfBar.style.width      = cfPct + '%';
    cfBar.style.background = cfPct >= 100 ? 'var(--red)' : cfPct > 79 ? 'var(--yellow)' : 'var(--green)';
  }

  const set = (id, val) => { const e = $(id); if (e) e.textContent = val; };
  set('d-rec',    fmt(totalRec));
  set('d-desp',   fmt(totalDesp));
  set('d-saldo',  fmt(saldo));
  set('d-atraso', fmt(totalAtraso));
  set('d-faturas', fmt(totalFaturas));

  const saldoEl = $('d-saldo');
  if (saldoEl) saldoEl.className = 'sc-value ' + (saldo >= 0 ? 'c-green' : 'c-red');

  set('d-rec-s',     `${recs.length} lançamento(s)`);
  set('d-desp-s',    `${despCash.length} lanç. · excl. cartão`);
  set('d-saldo-s',   saldo >= 0 ? 'Superávit' : 'Déficit');
  set('d-atraso-s',  `${emAtraso.length} em atraso`);
  set('d-faturas-s', `${faturasAbertas.length} lançamento(s)`);

  _renderProxVenc(despCash);
  _renderCatChart(despCash);
  _renderFaturasAbertas();
  _renderContasSaldos();
}

function _renderContasSaldos() {
  const el = $('dash-contas-list');
  if (!el) return;

  if (!state.allContas.length) {
    el.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;text-align:center">Nenhuma conta cadastrada</div>';
    $('d-contas-total').textContent = '';
    return;
  }

  const totalSaldo = state.allContas.reduce((s, c) => s + (parseFloat(c.saldo) || 0), 0);
  const totalEl = $('d-contas-total');
  if (totalEl) totalEl.textContent = fmt(totalSaldo);

  el.innerHTML = state.allContas.map((c, i) => {
    const saldo = parseFloat(c.saldo) || 0;
    const last  = i === state.allContas.length - 1;
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:.65rem .4rem;${last ? '' : 'border-bottom:1px solid var(--border)'}">
      ${bankDot(c.banco)}
      <div style="flex:1;min-width:0">
        <div style="font-size:.85rem;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${c.nome}</div>
        <div style="font-size:.68rem;color:var(--text3)">${c.tipo || 'Conta'}</div>
      </div>
      <div style="font-family:var(--fd);font-weight:700;${saldo >= 0 ? 'color:var(--green)' : 'color:var(--red)'}">${fmt(saldo)}</div>
    </div>`;
  }).join('');
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
      <div style="font-family:var(--fd);font-weight:600;color:var(--red)">${fmt(_vt(l))}</div>
    </div>`).join('');
}

function _renderFaturasAbertas() {
  const el = $('faturas-abertas-list');
  if (!el) return;

  // Agrupa todos os lançamentos de cartão não pagos por cartão
  const byCartao = {};
  state.allLancamentos
    .filter(l => l.tipo === 'cartao' && l.status !== 'pago')
    .forEach(l => {
      const id = l.cartaoId || '__sem_cartao__';
      if (!byCartao[id]) byCartao[id] = { total: 0, count: 0 };
      byCartao[id].total += _vt(l);
      byCartao[id].count++;
    });

  const entries = Object.entries(byCartao);
  if (!entries.length) {
    el.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;text-align:center">Nenhuma fatura em aberto 🎉</div>';
    return;
  }

  el.innerHTML = entries.map(([cartaoId, { total, count }]) => {
    const cartao = state.allCartoes.find(c => c.id === cartaoId);
    const nome   = cartao?.nome || 'Cartão sem vínculo';
    const venc   = cartao?.vencimento ? ` · Vence dia ${cartao.vencimento}` : '';
    return `
    <div style="display:flex;align-items:center;gap:10px;padding:.7rem .5rem;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:500">💳 ${nome}</div>
        <div style="font-size:.72rem;color:var(--text3)">${count} lançamento(s)${venc}</div>
      </div>
      <div style="font-family:var(--fd);font-weight:600;color:var(--red)">${fmt(total)}</div>
      ${cartaoId !== '__sem_cartao__'
        ? `<button class="btn-action" onclick="window.abrirPagarFatura('${cartaoId}','')">Pagar</button>`
        : ''}
    </div>`;
  }).join('');
}

// Paleta fixa de cores para as categorias (funciona em dark e light)
const CAT_PALETTE = [
  '#4FFFB0','#60A5FA','#FFD166','#FF6B6B','#A78BFA',
  '#FB923C','#34D399','#F472B6','#38BDF8','#E879F9',
];

// Instância persistente do Chart.js (evita recriar a cada render)
let _catChartInst = null;

function _renderCatChart(desp) {
  const el = $('cat-list');
  if (!el) return;

  // ── Agrupamento e ordenação ──────────────────────────────────
  const bycat = {};
  desp.forEach(l => {
    const c = l.categoria || 'Outros';
    bycat[c] = (bycat[c] || 0) + _vt(l);
  });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const total  = sorted.reduce((s, [, v]) => s + v, 0);

  // ── Sem dados ────────────────────────────────────────────────
  if (!sorted.length) {
    if (_catChartInst) { _catChartInst.destroy(); _catChartInst = null; }
    el.innerHTML = '<div style="padding:1.5rem;color:var(--text3);font-size:.82rem;text-align:center">Sem despesas no período</div>';
    return;
  }

  // ── Chart.js Doughnut ────────────────────────────────────────
  const canvas = $('chart-categorias');
  if (canvas && typeof Chart !== 'undefined') {
    const isLight  = document.documentElement.classList.contains('theme-light');
    const bgColor  = isLight ? '#ffffff' : '#111827';
    const tipBg    = isLight ? '#ffffff' : '#1a2234';
    const tipTitle = isLight ? '#1e2533' : '#ffffff';
    const tipBody  = isLight ? '#475569' : 'rgba(255,255,255,.75)';
    const tipBorder= isLight ? 'rgba(30,37,51,.12)' : 'rgba(255,255,255,.08)';

    // Plugin: texto central "Total Gastos / valor"
    const centerPlugin = {
      id: 'clarimCenter',
      afterDraw(chart) {
        if (!chart.chartArea) return;
        const { ctx, chartArea: { left, right, top, bottom } } = chart;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const light = document.documentElement.classList.contains('theme-light');
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = '500 10px "DM Sans", sans-serif';
        ctx.fillStyle = light ? 'rgba(30,37,51,.42)' : 'rgba(255,255,255,.38)';
        ctx.fillText('Total Gastos', cx, cy - 11);
        ctx.font = '700 13px "DM Sans", sans-serif';
        ctx.fillStyle = light ? '#1e2533' : '#ffffff';
        ctx.fillText(fmt(total), cx, cy + 8);
        ctx.restore();
      },
    };

    const chartData = {
      labels: sorted.map(([cat]) => cat),
      datasets: [{
        data:            sorted.map(([, v]) => v),
        backgroundColor: sorted.map((_, i) => CAT_PALETTE[i % CAT_PALETTE.length]),
        borderColor:     bgColor,
        borderWidth:     3,
        hoverOffset:     10,
      }],
    };

    if (_catChartInst) {
      _catChartInst.destroy();
      _catChartInst = null;
    }

    _catChartInst = new Chart(canvas, {
      type: 'doughnut',
      data: chartData,
      options: {
        cutout: '64%',
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 450 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: tipBg,
            titleColor:      tipTitle,
            bodyColor:       tipBody,
            borderColor:     tipBorder,
            borderWidth:     1,
            padding:         10,
            callbacks: {
              label: ctx => {
                const pct = total ? Math.round((ctx.parsed / total) * 100) : 0;
                return `  ${fmt(ctx.parsed)}  (${pct}%)`;
              },
            },
          },
        },
        onClick: (_evt, elements) => {
          if (!elements.length) return;
          const catName = sorted[elements[0].index][0];
          document.dispatchEvent(
            new CustomEvent('clarim:filtrar-cat', { detail: { cat: catName } })
          );
        },
      },
      plugins: [centerPlugin],
    });
  }

  // ── Legenda customizada (clicável) ───────────────────────────
  el.innerHTML = sorted.map(([cat, val], i) => {
    const catData = state.allCategorias.find(c => c.nome === cat);
    const color   = CAT_PALETTE[i % CAT_PALETTE.length];
    const catEsc  = cat.replace(/'/g, "\\'");
    const onClick = `document.dispatchEvent(new CustomEvent('clarim:filtrar-cat',{detail:{cat:'${catEsc}'}}))`;

    // ── Modo Budget ─────────────────────────────────────────────
    if (catData?.limiteAtivo && catData.valorLimite > 0) {
      const rawPct     = (val / catData.valorLimite) * 100;
      const budgetPct  = Math.round(rawPct);
      const barWidth   = Math.min(rawPct, 100).toFixed(1);
      const colorClass = rawPct >= 100 ? 'budget-over' : rawPct >= 70 ? 'budget-warn' : 'budget-ok';
      const remaining  = catData.valorLimite - val;
      const infoRight  = remaining >= 0
        ? `${fmt(remaining)} restam`
        : `<span style="color:var(--red)">${fmt(Math.abs(remaining))} excedido</span>`;
      return `
      <div class="chart-leg-item" onclick="${onClick}" title="Filtrar: ${cat}">
        <span class="leg-dot" style="background:${color}"></span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.22rem">
            <span>${_catIcon(cat)} ${cat}</span>
            <span style="color:var(--text3)">${fmt(val)}<span style="opacity:.45"> / ${fmt(catData.valorLimite)}</span></span>
          </div>
          <div class="budget-track"><div class="budget-fill ${colorClass}" style="width:${barWidth}%"></div></div>
          <div class="budget-info"><span>${budgetPct}% utilizado</span><span>${infoRight}</span></div>
        </div>
      </div>`;
    }

    // ── Modo Proporção ──────────────────────────────────────────
    const pct = total ? Math.round((val / total) * 100) : 0;
    return `
    <div class="chart-leg-item" onclick="${onClick}" title="Filtrar: ${cat}">
      <span class="leg-dot" style="background:${color}"></span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.28rem">
          <span>${_catIcon(cat)} ${cat}</span>
          <span style="color:var(--text3)">${fmt(val)} (${pct}%)</span>
        </div>
        <div style="height:3px;background:var(--bar-track);border-radius:4px">
          <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width .5s"></div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ── Assistente IA: movido para ia.js ──────────────────────────
// renderAIChips e sendAI são exportados por ia.js e importados em app.js
