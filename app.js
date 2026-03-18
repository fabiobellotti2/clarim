// ============================================================
// CLARIM — app.js  (Firebase Modular SDK v10)
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
  browserLocalPersistence,
  setPersistence
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  doc,
  setDoc,
  serverTimestamp,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Configuração Firebase ────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDrVIFXcwXDiXXOutUPPECpytky6QEaK30",
  authDomain: "clarim-3cbed.firebaseapp.com",
  projectId: "clarim-3cbed",
  storageBucket: "clarim-3cbed.firebasestorage.app",
  messagingSenderId: "122672980843",
  appId: "1:122672980843:web:a4bcbb9625fbce2070e22e",
  measurementId: "G-EKKNN0JJVE"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);

// ── Estado Global ────────────────────────────────────────────
let currentUser   = null;
let userFamilyId  = null;

// Dados em memória (carregados via onSnapshot)
let allLancamentos = [];
let allReceitas    = [];
let allCartoes     = [];
let allContas      = [];
let allCategorias  = [];

// Controle de mês ativo no dashboard
let currentMonth = new Date().getMonth(); // 0-11
let currentYear  = new Date().getFullYear();

// Listeners ativos (para cancelar ao fazer logout)
const activeListeners = [];

// ── Helpers de UI ────────────────────────────────────────────
const $ = id => document.getElementById(id);

function showEl(id) {
  const e = $(id);
  if (!e) return;

  if (id === 'login-screen') {
    e.style.display = 'flex';
  } else if (id === 'app') {
    e.style.display = 'block';
  } else {
    e.style.display = '';
  }
}

function hideEl(id) {
  const e = $(id);
  if (e) e.style.display = 'none';
}

function setAuthError(msg) {
  const el = $('auth-error');
  if (!el) return;
  if (msg) { el.textContent = msg; el.style.display = ''; }
  else     { el.style.display = 'none'; }
}

function showToast(msg, type = 'ok') {
  const t = $('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast ' + (type === 'err' ? 'toast-err' : '');
  t.classList.add('show');
  setTimeout(() => { t.classList.remove('show'); }, 3000);
}

function fmt(val) {
  return 'R$ ' + Number(val || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(str) {
  if (!str) return '';
  const [y, m, d] = str.split('-');
  return `${d}/${m}/${y}`;
}

// ── Mostrar / Ocultar telas principais ───────────────────────
function showLogin() {
  hideEl('app');
  showEl('login-screen');
}

function showDashboard() {
  hideEl('login-screen');
  showEl('app');
  updateGreeting();
  navigateTo('dashboard');
}

// ── Navegação entre páginas ──────────────────────────────────
const PAGES = ['dashboard','despesas','receitas','cartoes','contas','categorias','relatorios','configuracoes'];

function navigateTo(page) {
  PAGES.forEach(p => {
    const pg = $('page-' + p);
    const nb = $('nav-' + p);
    if (pg) pg.classList.toggle('active', p === page);
    if (nb) nb.classList.toggle('active', p === page);
  });
  if (page === 'dashboard')   renderDashboard();
  if (page === 'despesas')    renderDespesas();
  if (page === 'receitas')    renderReceitas();
  if (page === 'cartoes')     renderCartoes();
  if (page === 'contas')      renderContas();
  if (page === 'categorias')  renderCategorias();
  if (page === 'relatorios')  renderRelatorios();
}

// ── Saudação ─────────────────────────────────────────────────
function updateGreeting() {
  const h = new Date().getHours();
  const period = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const name   = currentUser?.displayName || currentUser?.email?.split('@')[0] || 'você';
  const el = $('dash-greeting');
  if (el) el.textContent = `${period}, ${name}! 👋`;
  const sbName = $('sb-name');
  if (sbName) sbName.textContent = name;
}

// ── AUTENTICAÇÃO ─────────────────────────────────────────────

// Manter sessão entre reloads
setPersistence(auth, browserLocalPersistence).then(() => {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      currentUser  = user;
      userFamilyId = user.uid;
      showDashboard();
      loadAllData();
    } else {
      currentUser  = null;
      userFamilyId = null;
      activeListeners.forEach(unsub => unsub());
      activeListeners.length = 0;
      showLogin();
    }
  });
}).catch(console.error);

// Cadastro (chamado pelo botão #btn-signup via onclick="realSignUp()")
window.realSignUp = async function() {
  setAuthError('');
  const name   = $('login-name')?.value?.trim()  || '';
  const email  = $('login-email')?.value?.trim() || '';
  const pass   = $('login-pass')?.value          || '';
  const pass2  = $('login-pass2')?.value         || '';
  const phone  = $('login-tel')?.value           || '';
  const gender = $('login-sexo')?.value          || '';

  if (!name)               return setAuthError('Informe seu nome completo.');
  if (!email)              return setAuthError('Informe um e-mail válido.');
  if (pass.length < 6)     return setAuthError('A senha precisa ter no mínimo 6 caracteres.');
  if (pass !== pass2)      return setAuthError('As senhas não coincidem.');

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const user = cred.user;

    await setDoc(doc(db, 'users_profile', user.uid), {
      name,
      email,
      phone,
      gender,
      familyId:  user.uid,
      createdAt: serverTimestamp(),
      plan: 'free'
    });

    await sendEmailVerification(user);
    showToast('Conta criada! Verifique seu e-mail 📧');
  } catch (err) {
    setAuthError(translateAuthError(err.code));
  }
};

// Login (chamado pelo botão #btn-login via onclick="realLogin()")
window.realLogin = async function() {
  setAuthError('');
  const email = $('login-email')?.value?.trim() || '';
  const pass  = $('login-pass')?.value          || '';

  if (!email) return setAuthError('Informe o e-mail.');
  if (!pass)  return setAuthError('Informe a senha.');

  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    setAuthError(translateAuthError(err.code));
  }
};

// Logout
window.realLogout = () => signOut(auth);

function translateAuthError(code) {
  const map = {
    'auth/user-not-found':      'Usuário não encontrado.',
    'auth/wrong-password':      'Senha incorreta.',
    'auth/email-already-in-use':'E-mail já cadastrado.',
    'auth/invalid-email':       'E-mail inválido.',
    'auth/weak-password':       'Senha muito fraca.',
    'auth/too-many-requests':   'Muitas tentativas. Tente novamente em breve.',
    'auth/invalid-credential':  'E-mail ou senha incorretos.',
  };
  return map[code] || 'Erro: ' + code;
}

// ── CARREGAR DADOS (onSnapshot multi-tenant) ─────────────────
function loadAllData() {
  if (!userFamilyId) return;

  const cols = [
    { name: 'lancamentos', setter: d => { allLancamentos = d; renderDashboard(); renderDespesas(); } },
    { name: 'receitas',    setter: d => { allReceitas    = d; renderDashboard(); renderReceitas(); } },
    { name: 'cartoes',     setter: d => { allCartoes     = d; renderCartoes();   populateCartaoSel(); } },
    { name: 'contas',      setter: d => { allContas      = d; renderContas();    populateContaSel(); } },
    { name: 'categorias',  setter: d => { allCategorias  = d; renderCategorias();} },
  ];

  cols.forEach(({ name, setter }) => {
    const q = query(
      collection(db, name),
      where('familyId', '==', userFamilyId)
    );
    const unsub = onSnapshot(q, snap => {
      setter(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, err => console.error(`Erro ao carregar ${name}:`, err));
    activeListeners.push(unsub);
  });
}

// ── SALVAR / ATUALIZAR / DELETAR ─────────────────────────────
window.fbAdd = async function(colName, data) {
  if (!userFamilyId) return null;
  try {
    const ref = await addDoc(collection(db, colName), {
      ...data,
      familyId:  userFamilyId,
      updatedAt: serverTimestamp()
    });
    return ref.id;
  } catch (e) {
    console.error('Erro ao salvar:', e);
    showToast('Erro ao salvar. Verifique o console.', 'err');
    return null;
  }
};

window.fbUpdate = async function(colName, docId, data) {
  if (!userFamilyId) return;
  try {
    await updateDoc(doc(db, colName, docId), {
      ...data,
      familyId:  userFamilyId,
      updatedAt: serverTimestamp()
    });
  } catch (e) {
    console.error('Erro ao atualizar:', e);
    showToast('Erro ao atualizar.', 'err');
  }
};

window.fbDelete = async function(colName, docId) {
  if (!userFamilyId) return;
  try {
    await deleteDoc(doc(db, colName, docId));
  } catch (e) {
    console.error('Erro ao deletar:', e);
    showToast('Erro ao deletar.', 'err');
  }
};

// ── HELPERS DE MESES ─────────────────────────────────────────
const MONTHS = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function updateMonthLabel() {
  const el = $('month-label');
  if (el) el.textContent = `${MONTHS[currentMonth]} ${currentYear}`;
}

function lancamentosDoMes() {
  return allLancamentos.filter(l => {
    if (!l.data) return false;
    const [y, m] = l.data.split('-');
    return parseInt(m) - 1 === currentMonth && parseInt(y) === currentYear;
  });
}

function receitasDoMes() {
  return allReceitas.filter(r => {
    if (!r.data) return false;
    const [y, m] = r.data.split('-');
    return parseInt(m) - 1 === currentMonth && parseInt(y) === currentYear;
  });
}

// ── DASHBOARD ────────────────────────────────────────────────
function renderDashboard() {
  updateMonthLabel();

  const desp  = lancamentosDoMes();
  const recs  = receitasDoMes();
  const hoje  = new Date().toISOString().slice(0, 10);

  const totalDesp   = desp.reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalRec    = recs.reduce((s, r) => s + Number(r.valor || 0), 0);
  const saldo       = totalRec - totalDesp;
  const emAtraso    = desp.filter(l => l.status === 'atrasado' || (l.status === 'pendente' && l.data < hoje));
  const totalAtraso = emAtraso.reduce((s, l) => s + Number(l.valor || 0), 0);

  function set(id, val) { const e = $(id); if (e) e.textContent = val; }
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

  renderProxVenc(desp);
  renderCatChart(desp);
}

function renderProxVenc(desp) {
  const el = $('prox-list');
  if (!el) return;
  const hoje = new Date().toISOString().slice(0, 10);
  const prox = [...desp]
    .filter(l => l.status !== 'pago' && l.data >= hoje)
    .sort((a, b) => a.data.localeCompare(b.data))
    .slice(0, 5);

  if (!prox.length) { el.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;text-align:center">Nenhum vencimento próximo 🎉</div>'; return; }

  el.innerHTML = prox.map(l => `
    <div style="display:flex;align-items:center;gap:10px;padding:.7rem .5rem;border-bottom:1px solid var(--border)">
      <div style="flex:1">
        <div style="font-size:.85rem;font-weight:500">${l.descricao || '—'}</div>
        <div style="font-size:.72rem;color:var(--text3)">${fmtDate(l.data)} · ${l.categoria || ''}</div>
      </div>
      <div style="font-family:var(--fd);font-weight:600;color:var(--red)">${fmt(l.valor)}</div>
    </div>`).join('');
}

function renderCatChart(desp) {
  const el = $('cat-list');
  if (!el) return;
  const bycat = {};
  desp.forEach(l => { const c = l.categoria || 'Outros'; bycat[c] = (bycat[c] || 0) + Number(l.valor || 0); });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const total  = sorted.reduce((s, [, v]) => s + v, 0);

  if (!sorted.length) { el.innerHTML = '<div style="padding:1rem;color:var(--text3);font-size:.82rem;text-align:center">Sem dados</div>'; return; }

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

// ── DESPESAS ─────────────────────────────────────────────────
function renderDespesas() {
  const body = $('desp-body');
  if (!body) return;

  const cols = '120px 1fr 160px 85px 120px 130px';
  const head = $('desp-head');
  if (head) head.style.gridTemplateColumns = cols;

  const searchTerm = $('desp-search')?.value?.toLowerCase() || '';
  const mesFil     = $('desp-mes')?.value || '';
  const catFil     = $('desp-cat')?.value || '';
  const stFil      = $('desp-status')?.value || '';

  let data = [...allLancamentos];
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
        ${l.status !== 'pago' ? `<button class="btn-action" onclick="marcarPago('${l.id}')">✓ Pagar</button>` : ''}
        <button class="btn-action btn-del" onclick="deletarLancamento('${l.id}')">🗑</button>
      </div>
    </div>`).join('');

  // Popular filtro de meses
  populateMesFiltro('desp-mes', allLancamentos);
  populateCatFiltro('desp-cat', allLancamentos);
}

function renderTransactions(data) {
  // Alias para compatibilidade — chama renderDespesas
  allLancamentos = data;
  renderDespesas();
}

function badgeStatus(st) {
  const map = {
    pago:      '<span class="badge b-pago">✅ Pago</span>',
    pendente:  '<span class="badge b-previsto">⏳ Pendente</span>',
    avencer:   '<span class="badge b-previsto">⏳ À Vencer</span>',
    atrasado:  '<span class="badge b-atrasado">❌ Atrasado</span>',
    recebido:  '<span class="badge b-pago">✅ Recebido</span>',
    previsto:  '<span class="badge b-previsto">⏳ Previsto</span>',
  };
  return map[st] || `<span class="badge">${st || '—'}</span>`;
}

function populateMesFiltro(selId, arr) {
  const sel = $(selId);
  if (!sel) return;
  const meses = [...new Set(arr.map(l => (l.data || '').slice(0, 7)).filter(Boolean))].sort().reverse();
  const current = sel.value;
  sel.innerHTML = '<option value="">Todos os meses</option>' +
    meses.map(m => { const [y, mo] = m.split('-'); return `<option value="${m}" ${m===current?'selected':''}>${MONTHS[parseInt(mo)-1]} ${y}</option>`; }).join('');
}

function populateCatFiltro(selId, arr) {
  const sel = $(selId);
  if (!sel) return;
  const cats = [...new Set(arr.map(l => l.categoria).filter(Boolean))].sort();
  const current = sel.value;
  sel.innerHTML = '<option value="">Todas categorias</option>' +
    cats.map(c => `<option value="${c}" ${c===current?'selected':''}>${c}</option>`).join('');
}

window.marcarPago = async (id) => {
  const hoje = new Date().toISOString().slice(0, 10);
  await fbUpdate('lancamentos', id, { status: 'pago', dataPagamento: hoje });
  showToast('Marcado como pago ✅');
};

window.deletarLancamento = async (id) => {
  if (!confirm('Deseja excluir este lançamento?')) return;
  await fbDelete('lancamentos', id);
  showToast('Lançamento excluído.');
};

// ── RECEITAS ─────────────────────────────────────────────────
function renderReceitas() {
  const body = $('rec-body');
  if (!body) return;

  const cols = '90px 1fr 110px 85px 110px 130px';
  const head = $('rec-head');
  if (head) head.style.gridTemplateColumns = cols;

  let data = [...allReceitas];
  const searchTerm = $('rec-search')?.value?.toLowerCase() || '';
  const mesFil     = $('rec-mes')?.value || '';
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
        <button class="btn-action btn-del" onclick="deletarReceita('${r.id}')">🗑</button>
      </div>
    </div>`).join('');

  populateMesFiltro('rec-mes', allReceitas);
}

window.deletarReceita = async (id) => {
  if (!confirm('Deseja excluir esta receita?')) return;
  await fbDelete('receitas', id);
  showToast('Receita excluída.');
};

// ── CARTÕES ───────────────────────────────────────────────────
function renderCartoes() {
  const grid = $('cartoes-grid');
  if (!grid) return;
  if (!allCartoes.length) {
    grid.innerHTML = '<div style="color:var(--text3);font-size:.85rem;grid-column:1/-1">Nenhum cartão cadastrado. Clique em "+ Novo Cartão".</div>';
    return;
  }
  grid.innerHTML = allCartoes.map(c => {
    const gasto = allLancamentos
      .filter(l => l.cartaoId === c.id)
      .reduce((s, l) => s + Number(l.valor || 0), 0);
    const pct = c.limite ? Math.min(Math.round((gasto / c.limite) * 100), 100) : 0;
    return `
    <div class="scard" style="cursor:pointer" onclick="verFatura('${c.id}')">
      <div class="sc-label">💳 ${c.nome}</div>
      <div class="sc-value">${fmt(gasto)}<span style="font-size:.7rem;color:var(--text3)"> / ${fmt(c.limite)}</span></div>
      <div style="height:4px;background:var(--bg3);border-radius:4px;margin:.5rem 0">
        <div style="height:100%;width:${pct}%;background:${pct > 80 ? 'var(--red)' : 'var(--green)'};border-radius:4px"></div>
      </div>
      <div style="font-size:.72rem;color:var(--text3)">Fecha dia ${c.fechamento} · Vence dia ${c.vencimento}</div>
      <button class="btn-action btn-del" style="margin-top:.5rem" onclick="event.stopPropagation();deletarCartao('${c.id}')">🗑 Remover</button>
    </div>`;
  }).join('');
}

window.deletarCartao = async (id) => {
  if (!confirm('Remover este cartão?')) return;
  await fbDelete('cartoes', id);
  showToast('Cartão removido.');
};

window.verFatura = (id) => {
  const cartao = allCartoes.find(c => c.id === id);
  if (!cartao) return;
  const panel = $('panel-fatura');
  const title = $('fatura-title');
  const body  = $('fatura-body');
  if (!panel || !body) return;
  const faturas = allLancamentos.filter(l => l.cartaoId === id);
  title.textContent = `Fatura — ${cartao.nome}`;
  if (!faturas.length) { body.innerHTML = '<div style="padding:1rem;color:var(--text3)">Sem lançamentos neste cartão.</div>'; }
  else {
    body.innerHTML = faturas.map(l => `
      <div style="display:flex;align-items:center;gap:10px;padding:.6rem .5rem;border-bottom:1px solid var(--border)">
        <div style="flex:1"><div style="font-size:.85rem">${l.descricao}</div><div style="font-size:.72rem;color:var(--text3)">${fmtDate(l.data)}</div></div>
        <div style="font-weight:600">${fmt(l.valor)}</div>
        ${badgeStatus(l.status)}
      </div>`).join('');
  }
  panel.style.display = '';
};

function populateCartaoSel() {
  const sel = $('f-cartao-id');
  if (!sel) return;
  sel.innerHTML = allCartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('') || '<option value="">Nenhum cartão</option>';
}

// ── CONTAS ────────────────────────────────────────────────────
function renderContas() {
  const grid = $('contas-grid');
  if (!grid) return;
  if (!allContas.length) {
    grid.innerHTML = '<div style="color:var(--text3);font-size:.85rem;grid-column:1/-1">Nenhuma conta cadastrada.</div>';
    return;
  }
  const icons = { corrente:'🏦', digital:'📱', poupanca:'💰', carteira:'👛', investimento:'📈' };
  grid.innerHTML = allContas.map(c => `
    <div class="scard">
      <div class="sc-label">${icons[c.tipo] || '🏦'} ${c.nome}</div>
      <div class="sc-value c-green">${fmt(c.saldo)}</div>
      <div style="font-size:.72rem;color:var(--text3);margin-top:.3rem">${c.tipo || ''}</div>
      <button class="btn-action btn-del" style="margin-top:.5rem" onclick="deletarConta('${c.id}')">🗑 Remover</button>
    </div>`).join('');
}

window.deletarConta = async (id) => {
  if (!confirm('Remover esta conta?')) return;
  await fbDelete('contas', id);
  showToast('Conta removida.');
};

function populateContaSel() {
  const sel = $('b-conta');
  if (!sel) return;
  sel.innerHTML = allContas.map(c => `<option value="${c.id}">${c.nome}</option>`).join('') || '<option value="">Nenhuma conta</option>';
}

// ── CATEGORIAS ────────────────────────────────────────────────
const DEFAULT_CATS = [
  { nome: 'Contas de Casa', icon: '🏠', cor: '#60A5FA', tipo: 'despesa' },
  { nome: 'Alimentação',    icon: '🍽️', cor: '#4FFFB0', tipo: 'despesa' },
  { nome: 'Transporte',     icon: '🚗', cor: '#FFD166', tipo: 'despesa' },
  { nome: 'Saúde',          icon: '❤️', cor: '#FF6B6B', tipo: 'despesa' },
  { nome: 'Educação',       icon: '📚', cor: '#A78BFA', tipo: 'despesa' },
  { nome: 'Lazer',          icon: '🎮', cor: '#F472B6', tipo: 'despesa' },
  { nome: 'Salário',        icon: '💼', cor: '#4FFFB0', tipo: 'receita' },
];

function renderCategorias() {
  const grid = $('cats-grid');
  if (!grid) return;
  const cats = allCategorias.length ? allCategorias : DEFAULT_CATS;
  grid.innerHTML = cats.map(c => `
    <div class="scard" style="text-align:center;border-top:3px solid ${c.cor || 'var(--green)'}">
      <div style="font-size:1.8rem;margin-bottom:.4rem">${c.icon || '🏷️'}</div>
      <div style="font-size:.82rem;font-weight:600">${c.nome}</div>
      <div style="font-size:.7rem;color:var(--text3);margin-top:.2rem">${c.tipo || ''}</div>
      ${c.id ? `<button class="btn-action btn-del" style="margin-top:.6rem" onclick="deletarCategoria('${c.id}')">🗑</button>` : ''}
    </div>`).join('');
}

window.deletarCategoria = async (id) => {
  if (!confirm('Remover esta categoria?')) return;
  await fbDelete('categorias', id);
  showToast('Categoria removida.');
};

// ── RELATÓRIOS ────────────────────────────────────────────────
function renderRelatorios() {
  const el = $('relat-content');
  if (!el) return;

  const totalDesp = allLancamentos.reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalRec  = allReceitas.reduce((s, r) => s + Number(r.valor || 0), 0);
  const saldo     = totalRec - totalDesp;
  const pagos     = allLancamentos.filter(l => l.status === 'pago').reduce((s, l) => s + Number(l.valor || 0), 0);

  el.innerHTML = `
    <div class="cards4" style="margin-bottom:1.5rem">
      <div class="scard"><div class="sc-label">Total Receitas</div><div class="sc-value c-green">${fmt(totalRec)}</div></div>
      <div class="scard"><div class="sc-label">Total Despesas</div><div class="sc-value c-red">${fmt(totalDesp)}</div></div>
      <div class="scard"><div class="sc-label">Saldo Geral</div><div class="sc-value ${saldo>=0?'c-green':'c-red'}">${fmt(saldo)}</div></div>
      <div class="scard"><div class="sc-label">Total Pago</div><div class="sc-value c-green">${fmt(pagos)}</div></div>
    </div>
    <div class="panel"><div class="panel-hd"><div class="panel-title">Gastos por Categoria (todos os períodos)</div></div>
      <div id="relat-cat"></div>
    </div>`;

  // Gráfico de categorias
  const bycat = {};
  allLancamentos.forEach(l => { const c = l.categoria || 'Outros'; bycat[c] = (bycat[c] || 0) + Number(l.valor || 0); });
  const sorted = Object.entries(bycat).sort((a, b) => b[1] - a[1]);
  const total  = sorted.reduce((s, [, v]) => s + v, 0);
  const catEl  = $('relat-cat');
  if (catEl) {
    catEl.innerHTML = sorted.length ? sorted.map(([cat, val]) => {
      const pct = total ? Math.round((val / total) * 100) : 0;
      return `<div style="margin-bottom:.75rem">
        <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.3rem">
          <span>${cat}</span><span style="color:var(--text3)">${fmt(val)} (${pct}%)</span>
        </div>
        <div style="height:6px;background:var(--bg3);border-radius:4px">
          <div style="height:100%;width:${pct}%;background:var(--green);border-radius:4px"></div>
        </div></div>`;
    }).join('') : '<div style="padding:1rem;color:var(--text3)">Sem dados.</div>';
  }
}

// ── MODAIS ─────────────────────────────────────────────────────
function openModal(id)  { const m = $(id); if (m) m.classList.add('open'); }
function closeModal(id) { const m = $(id); if (m) m.classList.remove('open'); }
window.closeModal = closeModal;

// ── MODAL DESPESA ─────────────────────────────────────────────
let currentTipo = 'debito';
let currentRec  = 'unico';

function openModalDespesa() {
  // Resetar campos
  ['f-desc','f-valor','f-data','fx-valor','fx-dia','fx-inicio','fx-fim',
   'pc-qtd','pc-v1','pc-vn','pc-data1','pc-dia'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  $('f-status') && ($('f-status').value = 'pendente');
  $('modal-title') && ($('modal-title').textContent = 'Nova Despesa');
  switchRecOpt('unico');
  openModal('modal-lancamento');
}

function switchRecOpt(rec) {
  currentRec = rec;
  ['unico','fixo','parcelado'].forEach(r => {
    const wrap = $('wrap-' + r);
    if (wrap) wrap.style.display = r === rec ? '' : 'none';
    const opt = document.querySelector(`.rec-opt[data-rec="${r}"]`);
    if (opt) opt.classList.toggle('active', r === rec);
  });
}

// ── MODAL RECEITA ─────────────────────────────────────────────
function openModalReceita() {
  ['rec-desc','rec-valor','rec-data','rec-inicio','rec-fim'].forEach(id => {
    const el = $(id); if (el) el.value = '';
  });
  $('rec-status') && ($('rec-status').value = 'recebido');
  $('modal-rec-title') && ($('modal-rec-title').textContent = 'Nova Receita');
  $('rec-fixo-wrap') && ($('rec-fixo-wrap').style.display = 'none');
  openModal('modal-receita');
}

// ── SALVAR DESPESA ────────────────────────────────────────────
async function salvarDespesa() {
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
    const valor   = parseFloat($('fx-valor')?.value || 0);
    const dia     = parseInt($('fx-dia')?.value || 1);
    const inicio  = $('fx-inicio')?.value;
    const fim     = $('fx-fim')?.value;
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
    const qtd  = parseInt($('pc-qtd')?.value || 0);
    const v1   = parseFloat($('pc-v1')?.value || 0);
    const vn   = parseFloat($('pc-vn')?.value || v1);
    const data1 = $('pc-data1')?.value;
    if (!qtd || !v1 || !data1) return showToast('Preencha todos os campos do parcelamento.', 'err');

    const [y0, m0, d0] = data1.split('-').map(Number);
    const promises = [];
    for (let i = 0; i < qtd; i++) {
      let m = m0 + i, y = y0;
      while (m > 12) { m -= 12; y++; }
      const data = `${y}-${String(m).padStart(2,'0')}-${String(d0).padStart(2,'0')}`;
      const valor = i === 0 ? v1 : vn;
      promises.push(fbAdd('lancamentos', { descricao: `${desc} (${i+1}/${qtd})`, categoria: cat, conta, valor, data, status: 'pendente', tipo, recorrencia: 'parcelado', parcela: i+1, totalParcelas: qtd }));
    }
    await Promise.all(promises);
    showToast(`${qtd} parcelas criadas ✅`);
  }

  closeModal('modal-lancamento');
}

// ── SALVAR RECEITA ────────────────────────────────────────────
async function salvarReceita() {
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
    const dia = new Date(data).getDate();
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

// ── SALVAR CARTÃO ─────────────────────────────────────────────
async function salvarCartao() {
  const nome       = $('cc-nome')?.value?.trim();
  const limite     = parseFloat($('cc-limite')?.value || 0);
  const fechamento = parseInt($('cc-fechamento')?.value || 1);
  const vencimento = parseInt($('cc-vencimento')?.value || 10);
  if (!nome) return showToast('Informe o nome do cartão.', 'err');
  await fbAdd('cartoes', { nome, limite, fechamento, vencimento });
  showToast('Cartão salvo ✅');
  closeModal('modal-cartao');
}

// ── SALVAR CONTA ──────────────────────────────────────────────
async function salvarConta() {
  const nome  = $('cnt-nome')?.value?.trim();
  const tipo  = $('cnt-tipo')?.value || 'corrente';
  const saldo = parseFloat($('cnt-saldo')?.value || 0);
  if (!nome) return showToast('Informe o nome da conta.', 'err');
  await fbAdd('contas', { nome, tipo, saldo });
  showToast('Conta salva ✅');
  closeModal('modal-conta');
}

// ── SALVAR CATEGORIA ──────────────────────────────────────────
let selectedCor = '#4FFFB0';
async function salvarCategoria() {
  const nome = $('cat-nome')?.value?.trim();
  const icon = $('cat-icon')?.value?.trim() || '🏷️';
  const tipo = $('cat-tipo')?.value || 'despesa';
  if (!nome) return showToast('Informe o nome da categoria.', 'err');
  await fbAdd('categorias', { nome, icon, cor: selectedCor, tipo });
  showToast('Categoria salva ✅');
  closeModal('modal-cat');
}

// ── ASSISTENTE IA ─────────────────────────────────────────────
async function sendAI() {
  const inp = $('ai-inp');
  const msgs = $('ai-msgs');
  if (!inp || !msgs) return;
  const q = inp.value.trim();
  if (!q) return;

  const totalDesp = allLancamentos.reduce((s, l) => s + Number(l.valor || 0), 0);
  const totalRec  = allReceitas.reduce((s, r) => s + Number(r.valor || 0), 0);
  const context = `Dados financeiros do usuário: Total despesas = R$ ${totalDesp.toFixed(2)}, Total receitas = R$ ${totalRec.toFixed(2)}, Saldo = R$ ${(totalRec - totalDesp).toFixed(2)}.`;

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
    const data = await resp.json();
    const answer = data?.content?.[0]?.text || 'Sem resposta.';
    thinking.style.cssText = 'font-size:.82rem;color:var(--text2);margin:.4rem 0;line-height:1.5;background:rgba(79,255,176,.06);padding:.6rem .8rem;border-radius:10px;border-left:2px solid var(--green)';
    thinking.textContent = answer;
  } catch {
    thinking.textContent = 'Erro ao conectar com o assistente.';
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── CHIPS DO ASSISTENTE ───────────────────────────────────────
const AI_CHIPS = [
  'Como está meu saldo?',
  'Qual minha maior despesa?',
  'Dicas para economizar',
  'Resumo do mês',
];

function renderAIChips() {
  const el = $('ai-chips');
  if (!el) return;
  el.innerHTML = AI_CHIPS.map(c =>
    `<div class="ai-chip" onclick="$('ai-inp').value='${c}';sendAI()">${c}</div>`
  ).join('');
}

function converterValorBR(valor) {
  if (valor === null || valor === undefined) return 0;

  if (typeof valor === "number") {
    return isNaN(valor) ? 0 : valor;
  }

  let texto = String(valor).trim();

  if (!texto) return 0;

  texto = texto
    .replace(/\s/g, "")
    .replace(/R\$/gi, "")
    .replace(/[^\d,.-]/g, "");

  if (texto.includes(",") && texto.includes(".")) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (texto.includes(",")) {
    texto = texto.replace(",", ".");
  }

  const numero = parseFloat(texto);

  return isNaN(numero) ? 0 : numero;
}

let categoriasCache = null;

async function carregarCategorias() {
  if (categoriasCache) return categoriasCache;

  const snap = await fbGetAll('categorias');
  categoriasCache = snap.map(c => c.nome.toLowerCase());

  return categoriasCache;
}

async function garantirCategoria(nome) {

  if (!nome) return;

  const normalizada = nome.toLowerCase().trim();

  const existe = allCategorias.some(
    c => (c.nome || '').toLowerCase() === normalizada
  );

  if (!existe) {

    await fbAdd('categorias', { nome });

    allCategorias.push({ nome });

    console.log('Categoria criada automaticamente:', nome);

  }

}

let contasCache = null;

async function carregarContas() {
  if (contasCache) return contasCache;

  const snap = await fbGetAll('contas');
  contasCache = snap.map(c => c.nome.toLowerCase());

  return contasCache;
}

async function garantirConta(nome) {

  if (!nome) return;

  const normalizada = nome.toLowerCase().trim();

  const existe = allContas.some(
    c => (c.nome || '').toLowerCase() === normalizada
  );

  if (!existe) {

    await fbAdd('contas', { nome });

    allContas.push({ nome });

    console.log('Conta criada automaticamente:', nome);

  }

}

function importarDespesasExcel(file) {
  if (typeof XLSX === 'undefined') {
    showToast('Biblioteca XLSX não carregada.', 'err');
    return;
  }

  const reader = new FileReader();

  reader.onload = async (evt) => {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      console.log('Rows importadas:', rows);

      for (const row of rows) {
        const payload = {
          descricao: row.descricao || row.Descricao || row['Descrição'] || '',
          categoria: row.categoria || row.Categoria || row['Categoria'] || 'Outros',
          conta: row.conta || row.Conta || row['Conta'] || 'Conta Geral',
          valor: Math.abs(converterValorBR(row.valor || row.Valor || row['Valor'] || 0)),
          data: normalizarDataExcel(row.data || row.Data || row['Data']),
          status: String(row.status || row.Status || row['Status'] || 'pendente').toLowerCase(),
          tipoPagamento: row.tipoPagamento || row.TipoPagamento || 'debito',
          tipoRecorrencia: row.tipoRecorrencia || row.TipoRecorrencia || 'unico',
          ajuste: converterValorBR(row.ajuste || row.Ajuste || 0),
          dataPagamento: normalizarDataExcel(row.dataPagamento || row.DataPagamento || '')
        };

        console.log('Payload:', payload);

        if (!payload.descricao || !payload.data) continue;

        if (payload.categoria) {
        await garantirCategoria(payload.categoria);
        }

        if (payload.conta) {
        await garantirConta(payload.conta);
        }
        
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

function normalizarDataExcel(valor) {
  if (!valor) return '';

  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) {
    return valor;
  }

  if (typeof valor === 'string' && /^\d{2}\/\d{2}\/\d{4}$/.test(valor)) {
    const [d, m, y] = valor.split('/');
    return `${y}-${m}-${d}`;
  }

  if (typeof valor === 'number') {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const date = new Date(excelEpoch.getTime() + valor * 86400000);
    return date.toISOString().slice(0, 10);
  }

  return '';
}

// ── INICIALIZAÇÃO DOM ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Navegação sidebar
  PAGES.forEach(p => {
    const btn = $('nav-' + p);
    if (btn) btn.addEventListener('click', () => navigateTo(p));
  });

  // Logout
  const btnLogout = $('btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', window.realLogout);


// Importar despesas
const btnImportDesp = document.getElementById('btn-import-desp');
const fileImportDesp = document.getElementById('file-import-desp');

if (btnImportDesp && fileImportDesp) {
  btnImportDesp.addEventListener('click', () => {
    fileImportDesp.click();
  });

  fileImportDesp.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    importarDespesasExcel(file);
    e.target.value = '';
  });
}

  // Navegação de meses
  $('btn-prev')?.addEventListener('click', () => {
    currentMonth--;
    if (currentMonth < 0) { currentMonth = 11; currentYear--; }
    renderDashboard();
  });
  $('btn-next')?.addEventListener('click', () => {
    currentMonth++;
    if (currentMonth > 11) { currentMonth = 0; currentYear++; }
    renderDashboard();
  });

  // Botão Nova Despesa
  $('btn-nova-desp')?.addEventListener('click', openModalDespesa);
  $('btn-nova-desp-cc')?.addEventListener('click', () => {
    openModalDespesa();
    // Selecionar aba cartão
    currentTipo = 'cartao';
    document.querySelectorAll('.tipo-tab').forEach(t => t.classList.toggle('active', t.dataset.tipo === 'cartao'));
    const frCartao = $('fr-cartao-sel');
    if (frCartao) frCartao.style.display = '';
  });

  // Botão Nova Receita
  $('btn-nova-rec')?.addEventListener('click', openModalReceita);

  // Botão Novo Cartão
  $('btn-novo-cartao')?.addEventListener('click', () => openModal('modal-cartao'));

  // Botão Nova Conta
  $('btn-nova-conta')?.addEventListener('click', () => openModal('modal-conta'));

  // Botão Nova Categoria
  $('btn-nova-cat')?.addEventListener('click', () => {
    selectedCor = '#4FFFB0';
    $('cat-nome') && ($('cat-nome').value = '');
    $('cat-icon') && ($('cat-icon').value = '');
    openModal('modal-cat');
  });

  // Cancelar modais
  $('btn-cancel-lanc')?.addEventListener('click', () => closeModal('modal-lancamento'));
  $('btn-cancel-rec')?.addEventListener('click',  () => closeModal('modal-receita'));
  $('btn-cancel-cc')?.addEventListener('click',   () => closeModal('modal-cartao'));
  $('btn-cancel-conta')?.addEventListener('click',() => closeModal('modal-conta'));
  $('btn-cancel-cat')?.addEventListener('click',  () => closeModal('modal-cat'));
  $('btn-fechar-fatura')?.addEventListener('click',() => { const p = $('panel-fatura'); if (p) p.style.display = 'none'; });

  // Salvar modais
  $('btn-save-lanc')?.addEventListener('click', salvarDespesa);
  $('btn-save-rec')?.addEventListener('click',  salvarReceita);
  $('btn-save-cc')?.addEventListener('click',   salvarCartao);
  $('btn-save-conta')?.addEventListener('click',salvarConta);
  $('btn-save-cat')?.addEventListener('click',  salvarCategoria);

  // Tipo de pagamento (débito / cartão)
  document.querySelectorAll('.tipo-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentTipo = tab.dataset.tipo;
      document.querySelectorAll('.tipo-tab').forEach(t => t.classList.toggle('active', t === tab));
      const frCartao = $('fr-cartao-sel');
      if (frCartao) frCartao.style.display = currentTipo === 'cartao' ? '' : 'none';
    });
  });

  // Opções de recorrência na despesa
  document.querySelectorAll('#rec-opts .rec-opt').forEach(opt => {
    opt.addEventListener('click', () => switchRecOpt(opt.dataset.rec));
  });

  // Opções de recorrência na receita
  document.querySelectorAll('#rec-rec-opts .rec-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      document.querySelectorAll('#rec-rec-opts .rec-opt').forEach(o => o.classList.toggle('active', o === opt));
      const isFixo = opt.dataset.rec === 'fixo';
      const wrap = $('rec-fixo-wrap');
      if (wrap) wrap.style.display = isFixo ? '' : 'none';
    });
  });

  // Status pagamento — mostrar/ocultar campo data pagamento
  $('f-status')?.addEventListener('change', function() {
    const fr = $('fr-datapag');
    if (fr) fr.style.display = this.value === 'pago' ? '' : 'none';
  });

  // Seletor de cores em categorias
  document.querySelectorAll('.cor-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      selectedCor = opt.dataset.cor;
      document.querySelectorAll('.cor-opt').forEach(o => o.style.border = '2px solid transparent');
      opt.style.border = '2px solid white';
    });
  });

  // Fechar modal ao clicar fora
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', function(e) {
      if (e.target === this) this.classList.remove('open');
    });
  });

  // Filtros de despesa
  ['desp-search','desp-mes','desp-cat','desp-status'].forEach(id => {
    $(id)?.addEventListener('input', renderDespesas);
    $(id)?.addEventListener('change', renderDespesas);
  });

  // Filtros de receita
  ['rec-search','rec-mes','rec-status-f'].forEach(id => {
    $(id)?.addEventListener('input', renderReceitas);
    $(id)?.addEventListener('change', renderReceitas);
  });

  // Assistente IA
  $('btn-ai')?.addEventListener('click', sendAI);
  $('ai-inp')?.addEventListener('keydown', e => { if (e.key === 'Enter') sendAI(); });
  renderAIChips();

  // Exportar (básico com XLSX)
  $('btn-export-desp')?.addEventListener('click', () => exportXLSX('lancamentos', 'Despesas_Clarim'));
  $('btn-export-rec')?.addEventListener('click',  () => exportXLSX('receitas',    'Receitas_Clarim'));
  $('btn-cancel-export')?.addEventListener('click', () => closeModal('modal-export'));
});

// ── EXPORTAR XLSX ─────────────────────────────────────────────
function exportXLSX(tipo, filename) {
  if (typeof XLSX === 'undefined') { showToast('Biblioteca XLSX não carregada.', 'err'); return; }
  const data = tipo === 'lancamentos' ? allLancamentos : allReceitas;
  const rows = data.map(l => ({
    Descrição: l.descricao || '',
    Categoria: l.categoria || '',
    Valor: Number(l.valor || 0),
    Data: l.data || '',
    Status: l.status || '',
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Dados');
  XLSX.writeFile(wb, `${filename}_${new Date().toISOString().slice(0,10)}.xlsx`);
}
