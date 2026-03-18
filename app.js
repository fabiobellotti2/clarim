// ============================================================
// CLARIM — app.js  (orquestrador principal)
// Importa todos os módulos, inicializa a aplicação e
// registra funções globais usadas pelos atributos onclick no HTML.
// ============================================================

import { $ } from './utils.js';
import {
  state, setupAuth, loadAllData,
  realLogin, realSignUp, realLogout
} from './firebase.js';
import {
  PAGES, setPageRenderers, navigateTo,
  showLogin, showDashboard,
  closeModal,
  renderDashboard, renderRelatorios,
  renderAIChips, sendAI
} from './ui.js';
import {
  renderDespesas, initDespesas,
  marcarPago, deletarLancamento,
  populateCartaoSel, exportXLSX
} from './despesas.js';
import {
  renderReceitas, initReceitas,
  deletarReceita
} from './receitas.js';
import {
  renderContas, initContas,
  renderCartoes, deletarConta, deletarCartao, verFatura,
  populateContaSel
} from './contas.js';
import {
  renderCategorias, initCategorias,
  deletarCategoria
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
  configuracoes: () => {},
});

// ── Funções globais (usadas em onclick no HTML) ───────────────
window.realLogin          = realLogin;
window.realSignUp         = realSignUp;
window.realLogout         = realLogout;
window.closeModal         = closeModal;
window.sendAI             = sendAI;
window.marcarPago         = marcarPago;
window.deletarLancamento  = deletarLancamento;
window.deletarReceita     = deletarReceita;
window.deletarConta       = deletarConta;
window.deletarCartao      = deletarCartao;
window.deletarCategoria   = deletarCategoria;
window.verFatura          = verFatura;
window.exportXLSX         = exportXLSX;

// ── Autenticação ──────────────────────────────────────────────
setupAuth(
  () => { showDashboard(); loadAllData(); },
  () => { showLogin(); }
);

// ── Reação a atualizações de dados (disparadas pelo firebase.js) ─
document.addEventListener('clarim:lancamentos', () => {
  renderDashboard();
  renderDespesas();
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
});

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

  // Assistente IA
  $('btn-ai')?.addEventListener('click', sendAI);
  $('ai-inp')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendAI(); });
  renderAIChips();

  // Inicializar módulos (registram seus próprios event listeners)
  initDespesas();
  initReceitas();
  initContas();
  initCategorias();
});
