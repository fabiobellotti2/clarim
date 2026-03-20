// ============================================================
// CLARIM — relatorios.js
// Painel de Relatórios: Eficiência de Pagamentos + Resumo Geral
// ============================================================

import { $, fmt, MONTHS } from './utils.js';
import { state } from './firebase.js';

// Instância do gráfico de saúde (Chart.js)
let _saudeChartInst = null;

// ── Estado local: período selecionado ─────────────────────────
let relatMes = new Date().getMonth() + 1; // 1-12
let relatAno = new Date().getFullYear();

// ── Helper retrocompat (mesmo padrão de despesas.js / ui.js) ──
function _vt(l) {
  if (l.valorTotal !== undefined && l.valorTotal !== null && l.valorTotal !== '') return Number(l.valorTotal);
  if (l.valorOriginal !== undefined) return Number(l.valorOriginal || 0) + Number(l.valorAjuste || 0);
  return Number(l.valor || 0);
}

// ── Anos disponíveis para o seletor ───────────────────────────
function _anosDisponiveis() {
  const anos = new Set([relatAno, relatAno - 1]);
  state.allLancamentos.forEach(l => { if (l.data) anos.add(parseInt(l.data.slice(0, 4))); });
  state.allReceitas.forEach(r  => { if (r.data) anos.add(parseInt(r.data.slice(0, 4))); });
  return [...anos].sort((a, b) => b - a);
}

// ── SVG do medidor circular (gauge) ───────────────────────────
function _gauge(pct, cor) {
  const r = 36;
  const circ = +(2 * Math.PI * r).toFixed(2);
  const dash  = +((Math.min(pct, 100) / 100) * circ).toFixed(2);
  return `
    <svg class="gauge-svg" width="90" height="90" viewBox="0 0 90 90" aria-label="${pct.toFixed(0)}%">
      <circle cx="45" cy="45" r="${r}" fill="none" stroke="var(--bg3)" stroke-width="8"/>
      <circle cx="45" cy="45" r="${r}" fill="none" stroke="${cor}" stroke-width="8"
        stroke-dasharray="${dash} ${circ}" stroke-linecap="round"
        transform="rotate(-90 45 45)"/>
      <text x="45" y="50" text-anchor="middle" fill="${cor}"
        font-size="15" font-weight="700" font-family="var(--fd)">${pct.toFixed(0)}%</text>
    </svg>`;
}

// ── Cor da pontualidade conforme limiar ───────────────────────
function _pontCor(pct) {
  if (pct >= 90) return 'var(--green)';
  if (pct >= 70) return 'var(--yellow)';
  return 'var(--red)';
}

// ── Cálculo dos KPIs de eficiência ───────────────────────────
/**
 * Percorre os lançamentos do mês/ano informado e retorna:
 * - pontualidade (%): pagas com dataPagamento ≤ dataVencimento / total pagas
 * - juros (R$): soma de valorAjuste > 0 (acréscimos)
 * - descontos (R$): soma de |valorAjuste| < 0 (abatimentos)
 */
export function calcularEficiencia(mes, ano) {
  const prefix  = `${ano}-${String(mes).padStart(2, '0')}`;
  const periodo = state.allLancamentos.filter(l => (l.data || '').slice(0, 7) === prefix);
  const pagas   = periodo.filter(l => l.status === 'pago');
  const total   = pagas.length;

  const emDia = pagas.filter(l =>
    l.dataPagamento && l.data && l.dataPagamento <= l.data
  ).length;

  const pontualidade = total > 0 ? (emDia / total) * 100 : null;

  const juros = periodo
    .filter(l => (Number(l.valorAjuste) || 0) > 0)
    .reduce((s, l) => s + Number(l.valorAjuste), 0);

  const descontos = periodo
    .filter(l => (Number(l.valorAjuste) || 0) < 0)
    .reduce((s, l) => s + Math.abs(Number(l.valorAjuste)), 0);

  return { pontualidade, juros, descontos, total, emDia };
}

// ── Dados dos últimos 6 meses ─────────────────────────────────
function _calcUltimos6Meses() {
  const labels  = [];
  const receitas = [];
  const despesas = [];

  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const mes = d.getMonth() + 1;
    const ano = d.getFullYear();
    const prefix = `${ano}-${String(mes).padStart(2, '0')}`;

    labels.push(`${MONTHS[mes - 1].slice(0, 3)} ${String(ano).slice(2)}`);

    receitas.push(
      state.allReceitas
        .filter(r => (r.data || '').slice(0, 7) === prefix)
        .reduce((s, r) => s + Number(r.valor || 0), 0)
    );
    despesas.push(
      state.allLancamentos
        .filter(l => (l.data || '').slice(0, 7) === prefix)
        .reduce((s, l) => s + _vt(l), 0)
    );
  }
  return { labels, receitas, despesas };
}

// ── Gráfico de saúde mensal (Chart.js bar) ────────────────────
function _renderSaudeChart() {
  const canvas = document.getElementById('chart-saude');
  if (!canvas) return;

  // Destroy instância anterior se existir
  if (_saudeChartInst) { _saudeChartInst.destroy(); _saudeChartInst = null; }

  const { labels, receitas, despesas } = _calcUltimos6Meses();

  // Lê variáveis CSS do tema atual
  const style   = getComputedStyle(document.documentElement);
  const green   = style.getPropertyValue('--green').trim()   || '#22c55e';
  const red     = style.getPropertyValue('--red').trim()     || '#ef4444';
  const text3   = style.getPropertyValue('--text3').trim()   || '#888';
  const bg3     = style.getPropertyValue('--bg3').trim()     || '#2a2a2a';
  const textCol = style.getPropertyValue('--text').trim()    || '#e2e8f0';

  _saudeChartInst = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Receitas',
          data: receitas,
          backgroundColor: green + 'cc',
          borderColor: green,
          borderWidth: 1.5,
          borderRadius: 6,
        },
        {
          label: 'Despesas',
          data: despesas,
          backgroundColor: red + 'cc',
          borderColor: red,
          borderWidth: 1.5,
          borderRadius: 6,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: textCol, font: { size: 12 }, boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${ctx.dataset.label}: R$ ${ctx.parsed.y.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: text3, font: { size: 11 } },
          grid:  { color: bg3 },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: text3,
            font: { size: 11 },
            callback: v => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 0 }),
          },
          grid: { color: bg3 },
        },
      },
    },
  });
}

// ── Render principal ──────────────────────────────────────────
export function renderRelatorios() {
  const el = $('relat-content');
  if (!el) return;

  const ef       = calcularEficiencia(relatMes, relatAno);
  const mesLabel = `${MONTHS[relatMes - 1]} ${relatAno}`;

  // Gauge de pontualidade
  const semDados = ef.pontualidade === null;
  const pontCor  = semDados ? 'var(--text3)' : _pontCor(ef.pontualidade);
  const gauge    = semDados
    ? `<div class="gauge-empty">—</div>`
    : _gauge(ef.pontualidade, pontCor);

  // Resumo geral (todos os períodos)
  const totalDesp = state.allLancamentos.reduce((s, l) => s + _vt(l), 0);
  const totalRec  = state.allReceitas.reduce((s, r) => s + Number(r.valor || 0), 0);
  const saldo     = totalRec - totalDesp;
  const pagos     = state.allLancamentos
    .filter(l => l.status === 'pago')
    .reduce((s, l) => s + _vt(l), 0);

  el.innerHTML = `
    <!-- ── Seletor de período ── -->
    <div class="relat-header">
      <span class="relat-period-lbl">📅 Período analisado:</span>
      <div class="relat-period-controls">
        <select id="relat-mes-sel" class="relat-sel">
          ${MONTHS.map((m, i) => `<option value="${i + 1}"${i + 1 === relatMes ? ' selected' : ''}>${m}</option>`).join('')}
        </select>
        <select id="relat-ano-sel" class="relat-sel">
          ${_anosDisponiveis().map(a => `<option value="${a}"${a === relatAno ? ' selected' : ''}>${a}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- ── Cards de Performance ── -->
    <div class="perf-cards">

      <!-- Card 1: Pontualidade -->
      <div class="perf-card">
        <span class="perf-icon">⏰</span>
        <div class="perf-gauge">${gauge}</div>
        <div class="perf-title">Pontualidade</div>
        <div class="perf-sub">${semDados
          ? 'Sem pagamentos registrados'
          : `${ef.emDia} de ${ef.total} conta(s) paga(s) em dia`}</div>
        ${!semDados ? (ef.pontualidade >= 100
          ? `<div class="perf-ok">✅ Perfeito! Todas pagas em dia</div>`
          : ef.pontualidade >= 90
            ? `<div class="perf-ok">✅ Excelente! Falta ${(100 - ef.pontualidade).toFixed(0)}% para a perfeição</div>`
            : ef.pontualidade >= 70
              ? `<div class="perf-alert">⚠️ Falta ${(100 - ef.pontualidade).toFixed(0)}% para a perfeição</div>`
              : `<div class="perf-danger">🔴 Falta ${(100 - ef.pontualidade).toFixed(0)}% para a perfeição</div>`)
          : ''}
      </div>

      <!-- Card 2: Juros -->
      <div class="perf-card">
        <span class="perf-icon">💸</span>
        <div class="perf-kpi perf-kpi-red">${fmt(ef.juros)}</div>
        <div class="perf-title">Juros Pagos</div>
        <div class="perf-sub">Dinheiro que saiu a mais em <strong>${mesLabel}</strong></div>
        ${ef.juros > 0
          ? `<div class="perf-alert">⚠️ Pague antes do vencimento para evitar acréscimos</div>`
          : `<div class="perf-ok">✅ Nenhum juro registrado em ${mesLabel}</div>`}
      </div>

      <!-- Card 3: Descontos -->
      <div class="perf-card">
        <span class="perf-icon">🏷️</span>
        <div class="perf-kpi perf-kpi-green">${fmt(ef.descontos)}</div>
        <div class="perf-title">Economia com Descontos</div>
        <div class="perf-sub">Você economizou negociando em <strong>${mesLabel}</strong></div>
        ${ef.descontos > 0
          ? `<div class="perf-ok">🎉 Parabéns! Continue negociando</div>`
          : `<div class="perf-hint">💡 Pergunte sobre desconto à vista</div>`}
      </div>

    </div>

    <!-- ── Cards de Resumo Geral ── -->
    <div class="section-divider">Resumo Geral (todos os períodos)</div>
    <div class="cards4" style="margin-bottom:1.5rem">
      <div class="scard"><div class="sc-label">Total Receitas</div><div class="sc-value c-green">${fmt(totalRec)}</div></div>
      <div class="scard"><div class="sc-label">Total Despesas</div><div class="sc-value c-red">${fmt(totalDesp)}</div></div>
      <div class="scard"><div class="sc-label">Saldo Geral</div><div class="sc-value ${saldo >= 0 ? 'c-green' : 'c-red'}">${fmt(saldo)}</div></div>
      <div class="scard"><div class="sc-label">Total Pago</div><div class="sc-value c-green">${fmt(pagos)}</div></div>
    </div>

    <!-- ── Gráfico de Saúde Mensal ── -->
    <div class="section-divider">Saúde Financeira — Últimos 6 Meses</div>
    <div class="panel" style="margin-bottom:1.5rem">
      <div class="panel-hd"><div class="panel-title">Receitas vs. Despesas</div></div>
      <div style="padding:.75rem 1rem;position:relative;height:260px">
        <canvas id="chart-saude"></canvas>
      </div>
    </div>

    <!-- ── Gastos por Categoria ── -->
    <div class="section-divider">Gastos por Categoria (todos os períodos)</div>
    <div class="panel">
      <div class="panel-hd"><div class="panel-title">Distribuição por categoria</div></div>
      <div id="relat-cat" style="padding:.75rem 1rem"></div>
    </div>`;

  // Listeners dos selects (criados após o innerHTML)
  $('relat-mes-sel')?.addEventListener('change', function () {
    relatMes = parseInt(this.value);
    renderRelatorios();
  });
  $('relat-ano-sel')?.addEventListener('change', function () {
    relatAno = parseInt(this.value);
    renderRelatorios();
  });

  // Breakdown por categoria
  const bycat  = {};
  state.allLancamentos.forEach(l => {
    const c = l.categoria || 'Outros';
    bycat[c] = (bycat[c] || 0) + _vt(l);
  });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]);
  const catTotal = sorted.reduce((s, [, v]) => s + v, 0);
  const catEl    = $('relat-cat');
  // Renderiza o gráfico de saúde (após o canvas estar no DOM)
  _renderSaudeChart();

  if (!catEl) return;
  catEl.innerHTML = sorted.length
    ? sorted.map(([cat, val]) => {
        const pct = catTotal ? Math.round((val / catTotal) * 100) : 0;
        return `
        <div style="margin-bottom:.8rem">
          <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.3rem">
            <span>${cat}</span>
            <span style="color:var(--text3)">${fmt(val)} <span style="opacity:.6">(${pct}%)</span></span>
          </div>
          <div style="height:6px;background:var(--bg3);border-radius:4px">
            <div style="height:100%;width:${pct}%;background:var(--green);border-radius:4px;transition:width .4s ease"></div>
          </div>
        </div>`;
      }).join('')
    : '<div style="padding:1rem;color:var(--text3);text-align:center">Sem dados de despesas.</div>';
}

export function initRelatorios() {
  // Listeners permanentes são criados dentro de renderRelatorios()
  // após cada innerHTML. Nada a inicializar aqui no momento.
}
