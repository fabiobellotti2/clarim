// ============================================================
// CLARIM — app.js  (orquestrador principal)
// Importa todos os módulos, inicializa a aplicação e
// registra funções globais usadas pelos atributos onclick no HTML.
// ============================================================

import { $, showToast } from './utils.js';
import {
  state, setupAuth, loadAllData,
  realLogin, realSignUp, realLogout,
  fbBatch
} from './firebase.js';
import {
  PAGES, setPageRenderers, navigateTo,
  showLogin, showDashboard,
  closeModal,
  renderDashboard,
} from './ui.js';
import {
  sendAI, renderAIChips,
  confirmarLancamentoIA, cancelarLancamentoIA,
  diagnosIA, continuarDraft, descartarDraftIniciarNovo,
  selecionarOpcaoIA, editarCampo,
  confirmarConsultaSerie, cancelarConsultaSerie, verOutrasOpcoesSerie,
} from './ia.js';
import { renderRelatorios, initRelatorios } from './relatorios.js';
import {
  renderDespesas, initDespesas,
  marcarPago, deletarLancamento,
  reverterPago, abrirDetalhesDespesa, abrirBaixa,
  populateCartaoSel, exportXLSX,
  patchRowDespesa,
} from './despesas.js';
import {
  renderReceitas, initReceitas,
  deletarReceita, abrirRecebimento,
  reverterReceita, abrirDetalheReceita
} from './receitas.js';
import {
  renderContas, initContas,
  renderCartoes, deletarConta, deletarCartao, verFatura,
  populateContaSel, abrirAjusteSaldo, abrirPagarFatura
} from './contas.js';
import {
  renderCategorias, initCategorias,
  deletarCategoria, abrirModalCategoria
} from './categorias.js';

// ── Registrar renders de página (evita dep. circular em ui.js) ─
setPageRenderers({
  dashboard:     renderDashboard,
  despesas:      renderDespesas,
  receitas:      renderReceitas,
  cartoes:       renderCartoes,
  contas:        renderContas,
  categorias:    renderCategorias,
  relatorios:    renderRelatorios,
  ia:            renderAIChips,
  configuracoes: () => {},
});

// ── Funções globais (usadas em onclick no HTML) ───────────────
window.realLogin          = realLogin;
window.realSignUp         = realSignUp;
window.realLogout         = realLogout;
window.closeModal         = closeModal;
window.sendAI                 = sendAI;
window.confirmarLancamentoIA  = confirmarLancamentoIA;
window.cancelarLancamentoIA   = cancelarLancamentoIA;
window.diagnosIA              = diagnosIA;
window.continuarDraft            = continuarDraft;
window.descartarDraftIniciarNovo = descartarDraftIniciarNovo;
window.selecionarOpcaoIA         = selecionarOpcaoIA;
window.editarCampo               = editarCampo;
window.confirmarConsultaSerie    = confirmarConsultaSerie;
window.cancelarConsultaSerie     = cancelarConsultaSerie;
window.verOutrasOpcoesSerie      = verOutrasOpcoesSerie;
window.marcarPago            = marcarPago;
window.deletarLancamento     = deletarLancamento;
window.reverterPago          = reverterPago;
window.abrirDetalhesDespesa  = abrirDetalhesDespesa;
window.abrirBaixa            = abrirBaixa;
window.deletarReceita        = deletarReceita;
window.abrirRecebimento      = abrirRecebimento;
window.reverterReceita       = reverterReceita;
window.abrirDetalheReceita   = abrirDetalheReceita;
window.deletarConta       = deletarConta;
window.deletarCartao      = deletarCartao;
window.deletarCategoria      = deletarCategoria;
window.abrirModalCategoria   = abrirModalCategoria;
window.verFatura          = verFatura;
window.abrirAjusteSaldo   = abrirAjusteSaldo;
window.abrirPagarFatura   = abrirPagarFatura;
window.exportXLSX         = exportXLSX;

// ── Autenticação ──────────────────────────────────────────────
setupAuth(
  () => { showDashboard(); loadAllData(); },
  () => { showLogin(); }
);

// ── Reação a atualizações de dados (disparadas pelo firebase.js) ─
document.addEventListener('clarim:lancamentos', ({ detail }) => {
  const changes = detail?.changes ?? [];
  const onlyModified = changes.length > 0 && changes.every(c => c.type === 'modified');

  if (onlyModified) {
    // Atualização cirúrgica: apenas as linhas alteradas, sem re-render completo
    changes.forEach(c => patchRowDespesa(c.id));
    renderDashboard(); // saldos e gráfico sempre precisam refletir a mudança
  } else {
    // Adições ou exclusões exigem re-render completo da tabela
    renderDashboard();
    renderDespesas();
  }
});
document.addEventListener('clarim:receitas', () => {
  renderDashboard();
  renderReceitas();
});
document.addEventListener('clarim:cartoes', () => {
  renderCartoes();
  populateCartaoSel();
});
document.addEventListener('clarim:contas', () => {
  renderContas();
  populateContaSel();
});
document.addEventListener('clarim:categorias', () => {
  renderCategorias();
  renderDespesas();
  renderReceitas();
  renderDashboard();
});

// ── Atalho de conciliação: Contas → Despesas filtrado ─────────
document.addEventListener('clarim:navegar-conta', ({ detail }) => {
  navigateTo('despesas');
  const sel = $('desp-conta');
  if (sel) {
    sel.value = detail.contaId;
    renderDespesas();
  }
});

// ── Atalho do gráfico: clique na fatia → Despesas filtrado ────
document.addEventListener('clarim:filtrar-cat', ({ detail }) => {
  navigateTo('despesas');
  const sel = $('desp-cat');
  if (sel) {
    sel.value = detail.cat;
    renderDespesas();
  }
});

// ── Verificação de Integridade de Categorias ──────────────────
/**
 * Percorre allLancamentos e allReceitas em busca de dois tipos de
 * inconsistência:
 *
 * 1. NOME DESATUALIZADO — o documento tem `categoriaId` apontando para uma
 *    categoria existente, mas o campo `categoria` (texto) diverge do nome
 *    atual (ocorre quando a categoria foi renomeada via "Opção B").
 *    → Corrige: atualiza `categoria` para o nome atual.
 *
 * 2. SEM ÂNCORA — o documento não tem `categoriaId` mas o texto `categoria`
 *    corresponde a um nome válido em allCategorias.
 *    → Enriquece: salva o `categoriaId` correspondente para uso futuro.
 *
 * Registros sem `categoriaId` E com nome não reconhecido (legado de selects
 * hardcoded removidos) são reportados como "órfãos" — não podem ser
 * corrigidos automaticamente sem input do usuário.
 */
async function verificarIntegridade() {
  const btn = $('btn-integridade');
  const previewEl = $('integridade-preview');
  if (btn) { btn.disabled = true; btn.textContent = '🔍 Verificando…'; }

  // Mapas de consulta rápida
  const idParaNome = new Map(state.allCategorias.map(c => [c.id, c.nome]));
  const nomeParaId = new Map(state.allCategorias.map(c => [c.nome, c.id]));
  const nomesValidos = new Set(state.allCategorias.map(c => c.nome));

  const lancFixes    = [];  // { id, data } — nome desatualizado (tipo 1)
  const lancEnrich   = [];  // { id, data } — sem categoriaId mas nome válido (tipo 2)
  const lancOrphans  = [];  // ids sem fix possível

  const recFixes   = [];
  const recEnrich  = [];
  const recOrphans = [];

  function classify(items, fixes, enrichList, orphans) {
    for (const item of items) {
      const nomeAtual = idParaNome.get(item.categoriaId);
      if (item.categoriaId && nomeAtual) {
        // Tipo 1: tem âncora, verifica se o texto está desatualizado
        if (item.categoria !== nomeAtual) {
          fixes.push({ id: item.id, data: { categoria: nomeAtual } });
        }
      } else if (!item.categoriaId && item.categoria) {
        const catId = nomeParaId.get(item.categoria);
        if (catId) {
          // Tipo 2: nome válido, enriquece com o ID
          enrichList.push({ id: item.id, data: { categoriaId: catId } });
        } else if (!nomesValidos.has(item.categoria)) {
          // Órfão: nome não existe mais nas categorias cadastradas
          orphans.push(item.id);
        }
      }
    }
  }

  classify(state.allLancamentos, lancFixes,  lancEnrich,  lancOrphans);
  classify(state.allReceitas,    recFixes,   recEnrich,   recOrphans);

  const totalFixes   = lancFixes.length   + recFixes.length;
  const totalEnrich  = lancEnrich.length  + recEnrich.length;
  const totalOrphans = lancOrphans.length + recOrphans.length;

  // Exibe preview com o diagnóstico antes de executar
  if (previewEl) {
    previewEl.style.display = '';
    if (totalFixes === 0 && totalEnrich === 0 && totalOrphans === 0) {
      previewEl.innerHTML = '✅ Nenhuma inconsistência encontrada.';
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Verificar & Sincronizar'; }
      showToast('✅ Integridade OK — tudo sincronizado.');
      return;
    }
    previewEl.innerHTML = [
      totalFixes   > 0 ? `🔧 <b>${totalFixes}</b> lançamento(s) com nome de categoria desatualizado` : '',
      totalEnrich  > 0 ? `🔗 <b>${totalEnrich}</b> lançamento(s) sem categoriaId (serão enriquecidos)` : '',
      totalOrphans > 0 ? `⚠️ <b>${totalOrphans}</b> lançamento(s) órfão(s) — categoria não reconhecida (sem correção automática)` : '',
    ].filter(Boolean).join('<br>');
  }

  if (totalFixes === 0 && totalEnrich === 0) {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Verificar & Sincronizar'; }
    if (totalOrphans > 0) {
      showToast(`⚠️ ${totalOrphans} lançamento(s) órfãos encontrados. Edite-os manualmente para reassociar a categoria.`, 'err');
    }
    return;
  }

  const msg = `Serão corrigidos ${totalFixes} nome(s) e enriquecidos ${totalEnrich} registro(s). Continuar?`;
  if (!confirm(msg)) {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Verificar & Sincronizar'; }
    return;
  }

  try {
    if (lancFixes.length)   await fbBatch('lancamentos', lancFixes);
    if (recFixes.length)    await fbBatch('receitas',    recFixes);
    if (lancEnrich.length)  await fbBatch('lancamentos', lancEnrich);
    if (recEnrich.length)   await fbBatch('receitas',    recEnrich);

    // Re-renderização imediata (o onSnapshot também dispara, mas força resposta visual)
    renderDashboard();
    renderDespesas();
    renderReceitas();

    let toastMsg = `✅ Sincronização concluída!`;
    if (totalFixes  > 0) toastMsg += ` ${totalFixes} nome(s) atualizado(s).`;
    if (totalEnrich > 0) toastMsg += ` ${totalEnrich} registro(s) enriquecidos.`;
    if (totalOrphans > 0) toastMsg += ` ⚠️ ${totalOrphans} órfão(s) não corrigidos.`;
    showToast(toastMsg);

    if (previewEl) previewEl.style.display = 'none';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔍 Verificar & Sincronizar'; }
  }
}

window.verificarIntegridade = verificarIntegridade;

// ── Inicialização do DOM ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Navegação na sidebar
  PAGES.forEach(p => {
    const btn = $('nav-' + p);
    if (btn) btn.addEventListener('click', () => navigateTo(p));
  });

  // Logout
  $('btn-logout')?.addEventListener('click', realLogout);

  // Navegação de meses no dashboard
  $('btn-prev')?.addEventListener('click', () => {
    state.currentMonth--;
    if (state.currentMonth < 0) { state.currentMonth = 11; state.currentYear--; }
    renderDashboard();
  });
  $('btn-next')?.addEventListener('click', () => {
    state.currentMonth++;
    if (state.currentMonth > 11) { state.currentMonth = 0; state.currentYear++; }
    renderDashboard();
  });

  // Fechar modais clicando no overlay
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function (e) {
      if (e.target === this) this.classList.remove('open');
    });
  });

  // Assistente IA (page-ia)
  $('btn-ai')?.addEventListener('click', sendAI);
  $('ai-inp')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendAI(); });

  // ── Tema ──────────────────────────────────────────────────
  const themeToggle = $('theme-toggle');
  if (themeToggle) {
    // Sincroniza o estado do toggle com o tema atual
    themeToggle.checked = document.documentElement.classList.contains('theme-light');
    themeToggle.addEventListener('change', () => {
      const light = themeToggle.checked;
      document.documentElement.classList.toggle('theme-light', light);
      localStorage.setItem('clarim-theme', light ? 'light' : 'dark');
    });
  }

  // Inicializar módulos (registram seus próprios event listeners)
  initDespesas();
  initReceitas();
  initContas();
  initCategorias();
  initRelatorios();
});
