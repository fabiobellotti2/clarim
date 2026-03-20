// ============================================================
// CLARIM — firebase.js
// Configuração Firebase, estado global, CRUD e autenticação
// ============================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
  browserLocalPersistence,
  setPersistence
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  doc,
  setDoc,
  runTransaction,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import { showToast, setAuthError } from './utils.js';

// ── Configuração ─────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDrVIFXcwXDiXXOutUPPECpytky6QEaK30",
  authDomain: "clarim-3cbed.firebaseapp.com",
  projectId: "clarim-3cbed",
  storageBucket: "clarim-3cbed.firebasestorage.app",
  messagingSenderId: "122672980843",
  appId: "1:122672980843:web:a4bcbb9625fbce2070e22e",
  measurementId: "G-EKKNN0JJVE"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);

// ── Estado Global ────────────────────────────────────────────
// Objeto mutável compartilhado entre todos os módulos
export const state = {
  currentUser:     null,
  userFamilyId:    null,
  allLancamentos:  [],
  allReceitas:     [],
  allCartoes:      [],
  allContas:       [],
  allCategorias:   [],
  currentMonth:    new Date().getMonth(),   // 0-11
  currentYear:     new Date().getFullYear(),
  activeListeners: [],
};

// ── CRUD ─────────────────────────────────────────────────────
export async function fbAdd(colName, data) {
  if (!state.userFamilyId) return null;
  try {
    const ref = await addDoc(collection(db, colName), {
      ...data,
      familyId:  state.userFamilyId,
      createdBy: state.currentUser?.uid ?? null,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return ref.id;
  } catch (e) {
    console.error(`[Clarim] fbAdd('${colName}') falhou:`, e);
    showToast('Ops! Não conseguimos salvar. Verifique sua conexão ou tente novamente.', 'err');
    return null;
  }
}

export async function fbUpdate(colName, docId, data) {
  if (!state.userFamilyId) return;
  try {
    await updateDoc(doc(db, colName, docId), {
      ...data,
      familyId:  state.userFamilyId,
      updatedAt: serverTimestamp(),
    });
  } catch (e) {
    console.error(`[Clarim] fbUpdate('${colName}', '${docId}') falhou:`, e);
    showToast('Ops! Não conseguimos atualizar. Verifique sua conexão ou tente novamente.', 'err');
    throw e; // re-throw para permitir rollback otimista no chamador
  }
}

export async function fbDelete(colName, docId) {
  if (!state.userFamilyId) return;
  try {
    await deleteDoc(doc(db, colName, docId));
  } catch (e) {
    console.error(`[Clarim] fbDelete('${colName}', '${docId}') falhou:`, e);
    showToast('Ops! Não conseguimos remover. Verifique sua conexão ou tente novamente.', 'err');
  }
}

/**
 * Atualização em lote: aplica o mesmo payload a vários documentos numa única
 * operação de writeBatch (máximo 500 docs por chamada — suficiente para o uso
 * doméstico do Clarim).
 *
 * @param {string} colName  — coleção Firestore
 * @param {Array<{id: string, data: object}>} updates — pares {id, data}
 */
export async function fbBatch(colName, updates) {
  if (!state.userFamilyId || !updates.length) return;
  try {
    const batch = writeBatch(db);
    updates.forEach(({ id, data }) => batch.update(doc(db, colName, id), data));
    await batch.commit();
  } catch (e) {
    console.error(`[Clarim] fbBatch('${colName}') falhou:`, e);
    showToast('Ops! Não conseguimos salvar em lote. Verifique sua conexão.', 'err');
    throw e;   // re-throw para que o chamador saiba que falhou
  }
}

/**
 * Transação atômica: lê o documento, aplica updateFn(data) → { campos novos },
 * e escreve o resultado num único lock do Firestore.
 * Garante integridade mesmo com múltiplos usuários escrevendo simultaneamente.
 *
 * @param {string}   colName  — coleção Firestore
 * @param {string}   docId    — id do documento
 * @param {Function} updateFn — recebe data atual, retorna objeto com campos a atualizar
 */
export async function fbTransact(colName, docId, updateFn) {
  if (!state.userFamilyId) return;
  try {
    await runTransaction(db, async (txn) => {
      const ref  = doc(db, colName, docId);
      const snap = await txn.get(ref);
      if (!snap.exists()) throw new Error(`Documento não encontrado: ${colName}/${docId}`);
      const patch = updateFn(snap.data());
      if (patch && typeof patch === 'object') {
        txn.update(ref, { ...patch, familyId: state.userFamilyId, updatedAt: serverTimestamp() });
      }
    });
  } catch (e) {
    console.error(`[Clarim] fbTransact('${colName}', '${docId}') falhou:`, e);
    showToast('Ops! Não conseguimos salvar. Verifique sua conexão ou tente novamente.', 'err');
    throw e; // re-throw para rollback otimista
  }
}

// ── Carregamento de Dados (onSnapshot) ───────────────────────
// Após cada atualização, dispara um CustomEvent para o app.js
export function loadAllData() {
  if (!state.userFamilyId) return;

  const cols = [
    { name: 'lancamentos', key: 'allLancamentos', event: 'clarim:lancamentos' },
    { name: 'receitas',    key: 'allReceitas',    event: 'clarim:receitas'    },
    { name: 'cartoes',     key: 'allCartoes',     event: 'clarim:cartoes'     },
    { name: 'contas',      key: 'allContas',      event: 'clarim:contas'      },
    { name: 'categorias',  key: 'allCategorias',  event: 'clarim:categorias'  },
  ];

  cols.forEach(({ name, key, event }) => {
    const q = query(
      collection(db, name),
      where('familyId', '==', state.userFamilyId)
    );
    const unsub = onSnapshot(q, snap => {
      state[key] = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      const changes = snap.docChanges().map(c => ({ type: c.type, id: c.doc.id }));
      document.dispatchEvent(new CustomEvent(event, { detail: { changes } }));
    }, err => console.error(`Erro ao carregar ${name}:`, err));
    state.activeListeners.push(unsub);
  });
}

// ── Autenticação ─────────────────────────────────────────────
export function setupAuth(onLogin, onLogout) {
  setPersistence(auth, browserLocalPersistence).then(() => {
    onAuthStateChanged(auth, async (user) => {
      if (user) {
        state.currentUser  = user;
        state.userFamilyId = user.uid;
        onLogin(user);
      } else {
        state.currentUser  = null;
        state.userFamilyId = null;
        state.activeListeners.forEach(unsub => unsub());
        state.activeListeners.length = 0;
        onLogout();
      }
    });
  }).catch(console.error);
}

export async function realSignUp() {
  setAuthError('');
  const name   = document.getElementById('login-name')?.value?.trim()  || '';
  const email  = document.getElementById('login-email')?.value?.trim() || '';
  const pass   = document.getElementById('login-pass')?.value          || '';
  const pass2  = document.getElementById('login-pass2')?.value         || '';
  const phone  = document.getElementById('login-tel')?.value           || '';
  const gender = document.getElementById('login-sexo')?.value          || '';

  if (!name)           return setAuthError('Informe seu nome completo.');
  if (!email)          return setAuthError('Informe um e-mail válido.');
  if (pass.length < 6) return setAuthError('A senha precisa ter no mínimo 6 caracteres.');
  if (pass !== pass2)  return setAuthError('As senhas não coincidem.');

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    const user = cred.user;
    await setDoc(doc(db, 'users_profile', user.uid), {
      name, email, phone, gender,
      familyId:  user.uid,
      createdAt: serverTimestamp(),
      plan: 'free'
    });
    await sendEmailVerification(user);
    showToast('Conta criada! Verifique seu e-mail 📧');
  } catch (err) {
    setAuthError(translateAuthError(err.code));
  }
}

export async function realLogin() {
  setAuthError('');
  const email = document.getElementById('login-email')?.value?.trim() || '';
  const pass  = document.getElementById('login-pass')?.value          || '';
  if (!email) return setAuthError('Informe o e-mail.');
  if (!pass)  return setAuthError('Informe a senha.');
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    setAuthError(translateAuthError(err.code));
  }
}

export function realLogout() {
  return signOut(auth);
}

export function translateAuthError(code) {
  const map = {
    'auth/user-not-found':       'Usuário não encontrado.',
    'auth/wrong-password':       'Senha incorreta.',
    'auth/email-already-in-use': 'E-mail já cadastrado.',
    'auth/invalid-email':        'E-mail inválido.',
    'auth/weak-password':        'Senha muito fraca.',
    'auth/too-many-requests':    'Muitas tentativas. Tente novamente em breve.',
    'auth/invalid-credential':   'E-mail ou senha incorretos.',
  };
  return map[code] || 'Erro: ' + code;
}
