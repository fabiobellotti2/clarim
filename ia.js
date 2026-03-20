// ============================================================
// CLARIM — ia.js
// Assistente IA com Function Calling para criar lançamentos
// ============================================================

import { $, fmt, showToast } from './utils.js';
import { state, fbAdd } from './firebase.js';
import { atualizarSaldoConta } from './contas.js';

// ── Chips de sugestão ─────────────────────────────────────────
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

// ── Retrocompat de valor total ─────────────────────────────────
function _vt(l) {
  if (l.valorTotal !== undefined && l.valorTotal !== null && l.valorTotal !== '') return Number(l.valorTotal);
  if (l.valorOriginal !== undefined) return Number(l.valorOriginal || 0) + Number(l.valorAjuste || 0);
  return Number(l.valor || 0);
}

// ── Confirmações pendentes (Map evita problemas com btoa/chars) ─
const _pending = new Map();

// ── Renderizador de markdown mínimo para bolhas da IA ─────────
// Subconjunto permitido: **negrito**, listas com "- " ou "• ", quebras de linha.
// Pipeline de segurança:
//   1. Guard de tipo (rejeita não-string)
//   2. Escape completo de HTML (5 entidades) — primeira linha contra XSS
//   3. Substituição de negrito apenas no conteúdo já escapado
//   4. Regex de negrito com limite de 120 chars — evita backtracking catastrófico
// Nenhuma tag HTML da IA chega ao DOM — apenas <div> e <strong> gerados aqui.
function _renderMd(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return '';

  // 1. Escape completo de HTML — nenhum char especial vaza para o DOM
  const esc = s => s
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');

  // 2. Negrito: aplicado DEPOIS do escape, conteúdo limitado a 120 chars
  //    O $1 já está escapado — <strong> é o único HTML que inserimos aqui
  const bold = s => s.replace(/\*\*(.{1,120}?)\*\*/g, '<strong>$1</strong>');

  return raw
    .split('\n')
    .map(line => {
      const trimmed = line.trimEnd();

      // Linha vazia → espaçador visual
      if (trimmed.trim() === '') return '<div class="ai-md-gap"></div>';

      // Linha de lista: aceita "- " e "• " (bullet já inserido pelo prompt)
      if (/^\s*[-•]\s/.test(trimmed)) {
        const content = bold(esc(trimmed.replace(/^\s*[-•]\s/, '')));
        return `<div class="ai-md-item">• ${content}</div>`;
      }

      // Linha de texto normal
      return `<div class="ai-md-line">${bold(esc(trimmed))}</div>`;
    })
    .join('');
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  LANÇAMENTOS POR LINGUAGEM NATURAL — máquina de estados     ║
// ╚══════════════════════════════════════════════════════════════╝

// ── Normalização e match flexível ─────────────────────────────
function _normalizarStr(s) {
  return (s || '').trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Retorna { tipo: 'unico'|'multiplo'|'nenhum', resultado, opcoes }
function _matchFlexivel(lista, input) {
  if (!input || !lista?.length) return { tipo: 'nenhum', resultado: null, opcoes: [] };
  const q = _normalizarStr(input);
  const exatos = lista.filter(c => _normalizarStr(c.nome) === q);
  if (exatos.length === 1) return { tipo: 'unico', resultado: exatos[0], opcoes: exatos };
  if (exatos.length > 1)  return { tipo: 'multiplo', resultado: null, opcoes: exatos };
  const parciais = lista.filter(c => {
    const n = _normalizarStr(c.nome);
    return n.includes(q) || q.includes(n);
  });
  if (parciais.length === 1) return { tipo: 'unico', resultado: parciais[0], opcoes: parciais };
  if (parciais.length > 1)  return { tipo: 'multiplo', resultado: null, opcoes: parciais };
  return { tipo: 'nenhum', resultado: null, opcoes: [] };
}

// ── Validação de campos obrigatórios ──────────────────────────
const _CAMPOS_OBR = ['tipo', 'descricao', 'valor', 'conta', 'categoria', 'status'];

function _camposAusentes(draft) {
  return _CAMPOS_OBR.filter(campo => {
    if (campo === 'valor')     return !draft.valor || isNaN(draft.valor) || Number(draft.valor) <= 0;
    if (campo === 'conta')     return !draft.contaId;
    if (campo === 'categoria') return !draft.categoriaId;
    return draft[campo] === null || draft[campo] === undefined || draft[campo] === '';
  });
}

// Validação final dupla antes do fbAdd
function _validarFinal(draft) {
  const erros = [];
  if (!draft.tipo)                          erros.push('tipo não definido');
  if (!draft.descricao?.trim())             erros.push('descrição ausente');
  if (!draft.valor || draft.valor <= 0)     erros.push('valor inválido');
  if (!draft.contaId)                       erros.push('conta não vinculada');
  if (!draft.categoriaId)                   erros.push('categoria não vinculada');
  if (!draft.status)                        erros.push('status não definido');
  if (!draft.data)                          erros.push('data ausente');
  if (!state.allContas.find(c => c.id === draft.contaId))
                                            erros.push('conta não encontrada no sistema');
  if (!state.allCategorias.find(c => c.nome === draft.categoria))
                                            erros.push('categoria não encontrada no sistema');
  return { ok: erros.length === 0, erros };
}

// ── Estado e draft ─────────────────────────────────────────────
const ESTADO = { IDLE: 'IDLE', PERGUNTANDO: 'PERGUNTANDO', PREVIA: 'PREVIA' };
let _draft = null;
let _guardPendente = null;
let _listaInterativa  = []; // opções do campo interativo atualmente exibido
let _previaCardEl     = null; // referência ao card de prévia no DOM (para remover ao re-renderizar)
let _consultaPendente = null; // { pergunta, candidatos } — aguardando confirmação de série

function _initDraft() {
  return {
    estado: ESTADO.IDLE, tipo: null, descricao: null, valor: null,
    data: null, dataSugerida: false, contaId: null, conta: null,
    categoriaId: null, categoria: null, status: null, recorrencia: 'unico',
    turno: 0, campoPerguntando: null, _opcoesMultiplas: null,
    campoEditando: null, // campo sendo editado inline na prévia (null = fora do modo edição)
  };
}

function _logDraft(acao) {
  console.group(`[Clarim IA] 📋 DRAFT — ${acao}`);
  if (_draft) {
    console.log('Estado          :', _draft.estado);
    console.log('Tipo            :', _draft.tipo);
    console.log('Campos pendentes:', _camposAusentes(_draft));
    console.log('Campo perguntando:', _draft.campoPerguntando);
    console.log('Turno           :', _draft.turno);
    console.log('Draft           :', JSON.stringify({ ..._draft, estado: undefined, _opcoesMultiplas: undefined }, null, 2));
  } else { console.log('Draft: null'); }
  console.groupEnd();
}

// ── Detecção de intenção de lançamento ────────────────────────
// Regex 1: frases com evidência concreta de transação já ocorrida ou específica
const _REGEX_LANCAMENTO = /\b(paguei|gastei|comprei|recebi|ganhei|transferi|vou pagar|a pagar|quero registrar|quero lançar|quero anotar|lancamento|lançamento|despesa de|receita de|custou|debitou|creditou)\b/i;

// Regex 2: intenção genérica de início de fluxo.
// \b após as formas conjugadas (lança, cadastra, registra) é adicionado DEPOIS
// da letra final ASCII — isso funciona porque em "lançamentos" o char após "lança"
// é "m" (\w → sem boundary), enquanto em "lança uma despesa" é " " (\W → boundary).
const _REGEX_INICIO_FLUXO = /(lançar|lança\b|cadastrar|cadastra\b|registrar|registra\b)/i;

// Regex de intenção analítica: detecta frases de consulta/entendimento que NÃO devem
// acionar o fluxo de cadastro mesmo quando contêm "lançar" ou "lançamentos".
// Propositalmente sem \b — as palavras são específicas o suficiente para o contexto.
const _REGEX_ANALISE = /(analise|análise|avaliar|entender|melhorar|economizar|estrategia|estratégia|dicas?|recomenda|comparar|relatorio|relatório|histórico|historico|recentes|últimos|ultimos)/i;

function _ehIntencaoAnalise(q) {
  return _REGEX_ANALISE.test(q);
}

function _ehIntencaoLancamento(q) {
  // Frases analíticas sem verbo concreto de transação (paguei, gastei, recebi...)
  // devem ir para a IA, mesmo que contenham "lançar" ou "lançamentos".
  // Verbos concretos (_REGEX_LANCAMENTO) têm prioridade e sobrepõem essa guarda.
  if (_ehIntencaoAnalise(q) && !_REGEX_LANCAMENTO.test(q)) return false;
  return _REGEX_LANCAMENTO.test(q) || _REGEX_INICIO_FLUXO.test(q);
}

// ── Inferência de tipo a partir da frase inicial ───────────────
// Usada para pré-preencher _draft.tipo antes de chamar Gemini,
// evitando uma pergunta desnecessária quando o tipo está explícito.
const _REGEX_TIPO_RECEITA = /\b(receita|entrada|recebimento|ganho|salário|salario|renda|crédito|credito|rendimento)\b/i;
const _REGEX_TIPO_DESPESA = /\b(despesa|gasto|custo|pagamento|débito|debito|conta a pagar|saída|saida|compra)\b/i;

function _inferirTipoDaFrase(q) {
  if (_REGEX_TIPO_RECEITA.test(q)) return 'receita';
  if (_REGEX_TIPO_DESPESA.test(q)) return 'despesa';
  return null;
}

// ── Detecção de consulta sobre série/parcelamento por descrição ─
// Detecta perguntas que dependem de identificar uma despesa pelo nome
// para que o sistema pergunte de qual despesa se trata antes de responder.
const _REGEX_CONSULTA_SERIE = /(parcelas?\s+falt|quanto\s+(ainda\s+)?falt[ao]\s+(pagar|quitar|terminar|acabar)|quando\s+(termina|acaba|quita|vai\s+(acabar|terminar))|qual\s+(a\s+)?previs[aã]o|até\s+quando\s+(vou\s+)?pagar|faltam\s+(pagar|quantas?)|quanto\s+falta\s+pr[ao]\s+(acabar|terminar|quitar)|quando\s+(vai\s+)?terminar\s+de\s+pagar|quantas\s+parcelas)/i;

function _ehConsultaSerie(q) {
  return _REGEX_CONSULTA_SERIE.test(q);
}

// Remove os verbos de intenção da frase, deixando apenas o termo de busca (descrição da despesa)
function _extrairTermoBusca(q) {
  return q
    .replace(_REGEX_CONSULTA_SERIE, '')
    .replace(/\b(do|da|de|dos|das|esse|essa|esses|essas|o|a|os|as|um|uma|que|para|pra|ainda|mais|essa|aquele|aquela)\b/gi, ' ')
    .replace(/[?!.,]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Busca candidatos de série em allLancamentos por similaridade de descrição.
 * Agrupa lançamentos com a mesma descrição normalizada (= mesma série).
 * Retorna array de { desc, score, items } ordenado por relevância, máximo 5.
 */
function _buscarCandidatosSerie(q) {
  const termo = _extrairTermoBusca(q);
  const termNorm = _normalizarStr(termo);
  if (!termNorm || termNorm.length < 2) return [];

  const scored = state.allLancamentos
    .filter(l => l.descricao)
    .map(l => {
      const descNorm = _normalizarStr(l.descricao);
      let score = 0;
      if (descNorm === termNorm) score = 100;
      else if (descNorm.includes(termNorm)) score = 80;
      else if (termNorm.includes(descNorm) && descNorm.length > 3) score = 60;
      else {
        const qWords = termNorm.split(/\s+/).filter(w => w.length > 2);
        const dWords = new Set(descNorm.split(/\s+/));
        const overlap = qWords.filter(w => dWords.has(w)).length;
        if (overlap > 0) score = overlap * 20;
      }
      return { l, score, descNorm };
    })
    .filter(x => x.score > 0);

  // Agrupa pelo mesmo descNorm (= mesma série)
  const grupos = new Map();
  scored.forEach(({ l, score, descNorm }) => {
    if (!grupos.has(descNorm)) grupos.set(descNorm, { desc: l.descricao, score, items: [] });
    const g = grupos.get(descNorm);
    if (score > g.score) g.score = score;
    g.items.push(l);
  });

  return [...grupos.values()]
    .sort((a, b) => b.score - a.score || b.items.length - a.items.length)
    .slice(0, 5);
}

// ── Inferência de status (só com evidência clara) ──────────────
const _EV_PAGO = /\b(paguei|já paguei|efetuei|quitei|liquidei|debitou)\b/i;
const _EV_REC  = /\b(recebi|já recebi|creditou)\b/i;
const _EV_PEND = /\b(vou pagar|a pagar|pendente|previsto|devo|vence|vai vencer|aberto)\b/i;

function _inferirStatus(q, tipo) {
  if (tipo === 'receita') {
    if (_EV_REC.test(q))  return 'recebido';
    if (_EV_PEND.test(q)) return 'previsto';
  } else {
    if (_EV_PAGO.test(q)) return 'pago';
    if (_EV_PEND.test(q)) return 'pendente';
  }
  return null;
}

// ── Extratores JS simples ──────────────────────────────────────
function _extrairNumero(q) {
  const n = q.replace(/\./g, '').replace(',', '.').match(/\d+(?:\.\d{1,2})?/);
  return n ? Number(n[0]) : null;
}

function _extrairData(q) {
  let m = q.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = q.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[0];
  if (/\bhoje\b/i.test(q)) return new Date().toISOString().slice(0, 10);
  if (/\bontem\b/i.test(q)) {
    const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10);
  }
  return null;
}

function _parseJson(text) {
  try { const m = text.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : null; }
  catch { return null; }
}

// ── Extração de campos via Gemini (retorna JSON) ───────────────
async function _extrairCamposGemini(q) {
  const hoje   = new Date().toISOString().slice(0, 10);
  const contas = state.allContas.map(c => c.nome).join(', ') || '(nenhuma)';
  const cats   = state.allCategorias.map(c => c.nome).join(', ') || '(nenhuma)';

  const sys = 'Você é um extrator de dados JSON. Retorne APENAS JSON válido, sem texto adicional.';
  const usr = `Extraia informações de lançamento financeiro do texto abaixo.
Para campos não mencionados explicitamente, use null. Nunca invente valores.

Texto: "${q}"
Data de hoje: ${hoje}
Contas disponíveis: ${contas}
Categorias disponíveis: ${cats}

Retorne exatamente este JSON:
{"tipo":"despesa"|"receita"|null,"descricao":string|null,"valor":number|null,"data":"YYYY-MM-DD"|null,"conta":string|null,"categoria":string|null,"status":"pago"|"recebido"|"pendente"|"previsto"|null}

REGRAS: status pago/recebido APENAS com evidência clara. data null se não mencionada. Retorne APENAS o JSON.`;

  const result = await _callGemini(sys, usr);
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  console.log('[Clarim IA] 📥 Extração bruta Gemini:', text);
  return _parseJson(text);
}

// ── Perguntas por campo ────────────────────────────────────────
const PERGUNTAS_CAMPO = {
  tipo:      ()     => 'Esse lançamento é uma despesa ou uma receita?',
  valor:     ()     => 'Qual o valor do lançamento?',
  conta:     ()     => `Qual conta usar? Contas: ${state.allContas.map(c => c.nome).join(', ') || '(nenhuma cadastrada)'}`,
  categoria: ()     => `Qual categoria? Categorias: ${state.allCategorias.map(c => c.nome).join(', ') || '(nenhuma cadastrada)'}`,
  descricao: ()     => 'Como quer descrever esse lançamento?',
  status:    (tipo) => tipo === 'receita' ? 'Esse valor já foi recebido ou ainda está previsto?' : 'Essa despesa já foi paga ou ainda está pendente?',
  data: () => {
    const tipo   = _draft?.tipo;
    const status = _draft?.status;
    if (tipo === 'despesa' && status === 'pago')     return 'Qual a data do pagamento? (ex: hoje, DD/MM/AAAA)';
    if (tipo === 'despesa' && status === 'pendente') return 'Qual a data de vencimento? (ex: hoje, amanhã, DD/MM/AAAA — pode ser passada)';
    if (tipo === 'receita' && status === 'recebido') return 'Qual a data do recebimento? (ex: hoje, DD/MM/AAAA)';
    if (tipo === 'receita' && status === 'previsto') return 'Qual a data prevista de recebimento? (ex: DD/MM/AAAA)';
    return 'Qual a data do lançamento? (ex: hoje, ontem, DD/MM/AAAA)';
  },
};
const _PRIORIDADE_CAMPOS = ['tipo', 'valor', 'descricao', 'conta', 'categoria', 'status', 'data'];

function _proximoCampoPendente(ausentes) {
  for (const c of _PRIORIDADE_CAMPOS) { if (ausentes.includes(c)) return c; }
  return ausentes[0];
}

// ── Helpers de UI ──────────────────────────────────────────────
function _addBotBubble(msgs, text) {
  const el = document.createElement('div');
  el.className = 'ai-bubble-bot';
  el.textContent = text;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
  return el;
}

function _perguntarCampo(campo, msgs, repetindo = false) {
  const fn  = PERGUNTAS_CAMPO[campo];
  const txt = fn ? fn(_draft?.tipo) : `Informe o valor de "${campo}".`;
  _addBotBubble(msgs, (repetindo ? 'Não consegui identificar. ' : '') + txt);
}

function _exibirOpcoes(campo, opcoes, msgs) {
  const lista = opcoes.map((o, i) => `${i + 1}. ${o.nome}`).join('\n');
  _addBotBubble(msgs, `Encontrei mais de uma opção para ${campo}. Qual delas?\n${lista}`);
}

// ── Componentes interativos de coleta de campo ─────────────────
// Renderiza 2 botões para escolha de tipo (despesa/receita)
function _renderBotoesTipo(msgs) {
  const el = document.createElement('div');
  el.className = 'ai-bubble-bot ai-field-prompt';
  el.innerHTML = `
    <div class="ai-field-label">Esse lançamento é uma despesa ou uma receita?</div>
    <div class="ai-field-opts">
      <button class="ai-field-btn" onclick="window.selecionarOpcaoIA('tipo','despesa',this)">💸 Despesa</button>
      <button class="ai-field-btn ai-field-btn-rec" onclick="window.selecionarOpcaoIA('tipo','receita',this)">💰 Receita</button>
    </div>`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

// Renderiza chips clicáveis a partir de uma lista {id, nome}
// Armazena a lista em _listaInterativa para lookup por índice no handler
function _renderChipsSel(campo, lista, msgs) {
  _listaInterativa = lista.slice();
  const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const label = campo === 'categoria' ? 'Qual categoria?' : 'Qual conta?';
  const chips = lista
    .map((item, i) => `<button class="ai-chip-opt" onclick="window.selecionarOpcaoIA('${campo}',${i},this)">${esc(item.nome)}</button>`)
    .join('');
  const el = document.createElement('div');
  el.className = 'ai-bubble-bot ai-field-prompt';
  el.innerHTML = `<div class="ai-field-label">${label}</div><div class="ai-field-chips">${chips}</div>`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

// Dispatcher: decide se usa componente interativo ou pergunta em texto
// Campos desta etapa: tipo, categoria, conta → interativo
// Demais campos (valor, descricao, status, data) → texto (fallback)
function _renderInputCampo(campo, msgs, repetindo = false) {
  if (campo === 'tipo') {
    _renderBotoesTipo(msgs);
    return;
  }
  if (campo === 'categoria' && state.allCategorias.length > 0) {
    _renderChipsSel('categoria', state.allCategorias, msgs);
    return;
  }
  if (campo === 'conta' && state.allContas.length > 0) {
    _renderChipsSel('conta', state.allContas, msgs);
    return;
  }
  // Fallback: campos não interativos nesta etapa ou listas vazias
  _perguntarCampo(campo, msgs, repetindo);
}

// Handler global: chamado pelo onclick dos chips e botões de campo
// campo: 'tipo' | 'categoria' | 'conta'
// idx:   string com o valor (para tipo) ou number com índice em _listaInterativa
// btn:   referência ao botão clicado, para feedback visual
export function selecionarOpcaoIA(campo, idx, btn) {
  // Desabilita toda a bolha para evitar duplo clique
  const bubble = btn?.closest('.ai-field-prompt');
  if (bubble) {
    bubble.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (btn) btn.classList.add('ai-chip-sel');
  }

  // Resolve o valor: tipo usa string direta; outros usam índice em _listaInterativa
  const valor = campo === 'tipo' ? idx : _listaInterativa[Number(idx)]?.nome;
  if (valor == null) {
    console.warn('[Clarim IA] selecionarOpcaoIA: valor não encontrado', { campo, idx });
    return;
  }

  console.log(`[Clarim IA] 🖱️ Chip selecionado: campo="${campo}" valor="${valor}"`);
  const msgs = $('ai-msgs');
  if (!msgs) return;
  _processarRespostaCampo(valor, msgs, null);
}

// ── Avança na máquina de estados ──────────────────────────────
async function _avancarFluxo(msgs) {
  const ausentes = _camposAusentes(_draft);
  _logDraft('Avançando fluxo');

  if (ausentes.length === 0) {
    if (!_draft.data) { _draft.data = new Date().toISOString().slice(0, 10); _draft.dataSugerida = true; }
    _draft.estado = ESTADO.PREVIA;
    _renderPreviaCard(msgs);
    return;
  }
  if (_draft.turno >= 3) {
    // Cancela apenas quando o usuário deu 3 respostas inválidas consecutivas para o mesmo campo
    const faltam = ausentes.join(', ');
    _addBotBubble(msgs, `Não consegui identificar o campo "${_draft.campoPerguntando}" após 3 tentativas. Lançamento cancelado.\nCampos que ainda faltavam: ${faltam}.\nTente novamente descrevendo com mais detalhes.`);
    console.warn('[Clarim IA] ⚠️ Draft cancelado: 3 falhas consecutivas no campo', _draft.campoPerguntando, '| Faltavam:', faltam);
    _draft = null; return;
  }

  _draft.estado = ESTADO.PERGUNTANDO;
  const proximo = _proximoCampoPendente(ausentes);
  _draft.campoPerguntando = proximo;
  _logDraft(`Perguntando: ${proximo}`);
  _renderInputCampo(proximo, msgs);
}

// ── Processa resposta do usuário para um campo pendente ────────
async function _processarRespostaCampo(q, msgs, inp) {
  const campo = _draft.campoPerguntando;
  console.log(`[Clarim IA] 🎤 Ação: resposta para campo "${campo}" | Valor: "${q}"`);

  const userBubble = document.createElement('div');
  userBubble.className = 'ai-bubble-user';
  userBubble.textContent = q;
  msgs.appendChild(userBubble);
  msgs.scrollTop = msgs.scrollHeight;
  if (inp) inp.value = '';

  let resolvido = false;

  switch (campo) {
    case 'valor': {
      const n = _extrairNumero(q);
      if (n && n > 0) { _draft.valor = n; resolvido = true; }
      break;
    }
    case 'conta': {
      const idx = parseInt(q.trim()) - 1;
      if (!isNaN(idx) && _draft._opcoesMultiplas?.[idx]) {
        const e = _draft._opcoesMultiplas[idx];
        _draft.contaId = e.id; _draft.conta = e.nome;
        _draft._opcoesMultiplas = null; resolvido = true;
      } else {
        const m = _matchFlexivel(state.allContas, q);
        if (m.tipo === 'unico') { _draft.contaId = m.resultado.id; _draft.conta = m.resultado.nome; resolvido = true; }
        else if (m.tipo === 'multiplo') { _draft._opcoesMultiplas = m.opcoes; _exibirOpcoes('conta', m.opcoes, msgs); return; }
      }
      break;
    }
    case 'categoria': {
      const idx = parseInt(q.trim()) - 1;
      if (!isNaN(idx) && _draft._opcoesMultiplas?.[idx]) {
        const e = _draft._opcoesMultiplas[idx];
        _draft.categoriaId = e.id; _draft.categoria = e.nome;
        _draft._opcoesMultiplas = null; resolvido = true;
      } else {
        const m = _matchFlexivel(state.allCategorias, q);
        if (m.tipo === 'unico') { _draft.categoriaId = m.resultado.id; _draft.categoria = m.resultado.nome; resolvido = true; }
        else if (m.tipo === 'multiplo') { _draft._opcoesMultiplas = m.opcoes; _exibirOpcoes('categoria', m.opcoes, msgs); return; }
      }
      break;
    }
    case 'status': {
      const s = _inferirStatus(q, _draft.tipo);
      if (s) { _draft.status = s; resolvido = true; break; }
      if (/\b(pago|já pago)\b/i.test(q))                     { _draft.status = 'pago';     resolvido = true; }
      else if (/\brecebido\b/i.test(q))                       { _draft.status = 'recebido'; resolvido = true; }
      else if (/\b(pendente|não pago|nao pago)\b/i.test(q))   { _draft.status = 'pendente'; resolvido = true; }
      else if (/\bprevisto\b/i.test(q))                        { _draft.status = 'previsto'; resolvido = true; }
      break;
    }
    case 'descricao': { if (q.trim().length >= 1) { _draft.descricao = q.trim(); resolvido = true; } break; }
    case 'tipo': {
      if (/\b(despesa|gasto|compra|débito|debito)\b/i.test(q))      { _draft.tipo = 'despesa'; resolvido = true; }
      else if (/\b(receita|recebimento|entrada|ganho)\b/i.test(q))  { _draft.tipo = 'receita'; resolvido = true; }
      break;
    }
    case 'data': { const d = _extrairData(q); if (d) { _draft.data = d; _draft.dataSugerida = false; resolvido = true; } break; }
  }

  if (!resolvido) { _draft.turno++; _renderInputCampo(campo, msgs, true); return; }
  _draft.turno = 0; // campo preenchido com sucesso → zera o contador de falhas consecutivas

  if (_draft.campoEditando) {
    // Modo edição inline: campo corrigido → volta para a prévia sem pedir outros campos
    console.log(`[Clarim IA] ✏️ Campo "${campo}" editado. Voltando para prévia.`);
    _draft.campoEditando = null;
    _draft.estado = ESTADO.PREVIA;
    _renderPreviaCard(msgs);
  } else {
    await _avancarFluxo(msgs);
  }
}

// Retorna o rótulo semântico da data conforme tipo + status do lançamento
function _labelData(tipo, status) {
  if (tipo === 'despesa' && status === 'pago')     return 'Pagamento';
  if (tipo === 'despesa' && status === 'pendente') return 'Vencimento';
  if (tipo === 'receita' && status === 'recebido') return 'Recebimento';
  if (tipo === 'receita' && status === 'previsto') return 'Previsto para';
  return 'Data';
}

// ── Card de prévia (exibe todos os campos antes da gravação) ───
// Pode ser chamado mais de uma vez (edição inline): remove o card anterior
// antes de renderizar o novo, limpando também o cid expirado de _pending.
function _renderPreviaCard(msgs) {
  // Cleanup de re-renderização pós-edição
  if (_previaCardEl) {
    const oldCid = _previaCardEl.dataset.cid;
    if (oldCid) _pending.delete(oldCid);
    _previaCardEl.remove();
    _previaCardEl = null;
  }

  const d    = _draft;
  const hoje = new Date().toISOString().slice(0, 10);
  const [ano, mes, dia] = (d.data || hoje).split('-');
  const dataFmt = `${dia}/${mes}/${ano}`;
  const dataSuf = d.dataSugerida ? ' (sugerida)' : '';

  // statusLabel com onclick para edição inline — usa template literal para evitar
  // conflito de aspas entre a string JS e o atributo HTML
  const statusLabel =
    d.status === 'pago'     ? `<span class="ai-tag-pago ai-tag-edit" onclick="window.editarCampo('status')">✅ Pago<span class="ai-edit-ico">✏️</span></span>` :
    d.status === 'recebido' ? `<span class="ai-tag-pago ai-tag-edit" onclick="window.editarCampo('status')">✅ Recebido<span class="ai-edit-ico">✏️</span></span>` :
    d.status === 'previsto' ? `<span class="ai-tag-pend ai-tag-edit" onclick="window.editarCampo('status')">⏳ Previsto<span class="ai-edit-ico">✏️</span></span>` :
                              `<span class="ai-tag-pend ai-tag-edit" onclick="window.editarCampo('status')">⏳ Pendente<span class="ai-edit-ico">✏️</span></span>`;

  const payload = {
    tipo: d.tipo, descricao: d.descricao, valor: d.valor,
    categoria: d.categoria, categoriaId: d.categoriaId,
    contaId: d.contaId, conta: d.conta,
    data: d.data || hoje, status: d.status,
    dataPagamento: (d.status === 'pago' || d.status === 'recebido') ? hoje : '',
    recorrencia: d.recorrencia,
  };

  const cid = `ia_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  _pending.set(cid, payload);

  const card = document.createElement('div');
  card.className = 'ai-bubble-bot ai-confirm-card';
  card.dataset.cid = cid;
  card.innerHTML = `
    <div class="ai-confirm-header">
      <span class="ai-confirm-icon">${d.tipo === 'receita' ? '💰' : '💸'}</span>
      <div class="ai-confirm-info">
        <div class="ai-confirm-type">${d.tipo === 'receita' ? 'Receita' : 'Despesa'} — prévia</div>
        <div class="ai-confirm-desc ai-tag-edit" onclick="window.editarCampo('descricao')">${d.descricao}<span class="ai-edit-ico">✏️</span></div>
      </div>
      <div class="ai-confirm-valor ${d.tipo === 'receita' ? 'c-green' : 'c-red'} ai-tag-edit" onclick="window.editarCampo('valor')">${fmt(d.valor)}<span class="ai-edit-ico">✏️</span></div>
    </div>
    <div class="ai-confirm-details">
      <span class="ai-confirm-tag ai-tag-edit" onclick="window.editarCampo('data')">📅 ${_labelData(d.tipo, d.status)}: ${dataFmt}${dataSuf}<span class="ai-edit-ico">✏️</span></span>
      <span class="ai-confirm-tag ai-tag-edit" onclick="window.editarCampo('categoria')">🏷️ ${d.categoria}<span class="ai-edit-ico">✏️</span></span>
      <span class="ai-confirm-tag ai-tag-edit" onclick="window.editarCampo('conta')">🏦 ${d.conta}<span class="ai-edit-ico">✏️</span></span>
      ${statusLabel}
      <span class="ai-confirm-tag">🔁 ${d.recorrencia}</span>
    </div>
    <div class="ai-confirm-hint">Confira os dados — toque em qualquer campo para editar.</div>
    <div class="ai-confirm-actions">
      <button class="ai-confirm-btn" onclick="window.confirmarLancamentoIA('${cid}', this)">✅ Confirmar</button>
      <button class="ai-confirm-cancel" onclick="window.cancelarLancamentoIA('${cid}', this)">❌ Cancelar</button>
    </div>`;
  _previaCardEl = card;
  msgs.appendChild(card);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Guard: draft ativo ao iniciar novo lançamento ─────────────
function _exibirGuardDraft(novaFala, msgs) {
  const d = _draft;
  const ausentes = _camposAusentes(d);
  const resumo = [
    d.tipo ? (d.tipo === 'despesa' ? '💸' : '💰') + ' ' + (d.descricao || '(sem descrição)') : '(tipo indefinido)',
    d.valor ? fmt(d.valor) : null,
    ausentes.length ? `falta: ${ausentes.join(', ')}` : 'aguardando confirmação',
  ].filter(Boolean).join(' — ');

  _guardPendente = { novaFala, msgsEl: msgs };
  const card = document.createElement('div');
  card.className = 'ai-bubble-bot ai-confirm-card';
  card.innerHTML = `
    <div class="ai-confirm-hint" style="margin-bottom:.5rem">Você tem um lançamento em andamento:</div>
    <div class="ai-confirm-desc" style="margin:.4rem 0;font-size:.9rem">${resumo}</div>
    <div class="ai-confirm-actions">
      <button class="ai-confirm-btn" onclick="window.continuarDraft()">Continuar este</button>
      <button class="ai-confirm-cancel" onclick="window.descartarDraftIniciarNovo()">Cancelar e começar novo</button>
    </div>`;
  msgs.appendChild(card);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Inicia um novo lançamento a partir da fala do usuário ──────
async function _iniciarLancamento(q, msgs, inp) {
  _draft = _initDraft();

  // Pré-preenche tipo se detectável na frase, antes de chamar Gemini
  const tipoInferido = _inferirTipoDaFrase(q);
  if (tipoInferido) {
    _draft.tipo = tipoInferido;
    console.log(`[Clarim IA] 🎯 Tipo pré-inferido da frase: ${tipoInferido}`);
  }

  _logDraft('Iniciando novo lançamento');

  const userBubble = document.createElement('div');
  userBubble.className = 'ai-bubble-user';
  userBubble.textContent = q;
  msgs.appendChild(userBubble);
  if (inp) inp.value = '';

  const thinking = document.createElement('div');
  thinking.className = 'ai-bubble-bot ai-bubble-thinking';
  thinking.textContent = 'Identificando lançamento…';
  msgs.appendChild(thinking);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const extraido = await _extrairCamposGemini(q);
    thinking.remove();

    if (!extraido) {
      _addBotBubble(msgs, 'Não consegui identificar os dados do lançamento. Tente descrever novamente.');
      _draft = null; return;
    }

    if (extraido.tipo)        _draft.tipo      = extraido.tipo;
    if (extraido.descricao)   _draft.descricao = extraido.descricao;
    if (Number(extraido.valor) > 0) _draft.valor = Number(extraido.valor);
    if (extraido.data)        { _draft.data = extraido.data; _draft.dataSugerida = false; }

    const status = extraido.status ?? _inferirStatus(q, extraido.tipo);
    if (status) _draft.status = status;

    if (extraido.conta) {
      const m = _matchFlexivel(state.allContas, extraido.conta);
      if (m.tipo === 'unico')    { _draft.contaId = m.resultado.id; _draft.conta = m.resultado.nome; }
      else if (m.tipo === 'multiplo') { _draft._opcoesMultiplas = m.opcoes; }
    }
    if (extraido.categoria) {
      const m = _matchFlexivel(state.allCategorias, extraido.categoria);
      if (m.tipo === 'unico')    { _draft.categoriaId = m.resultado.id; _draft.categoria = m.resultado.nome; }
      else if (m.tipo === 'multiplo') { _draft._opcoesMultiplas = m.opcoes; }
    }

    _logDraft('Após extração Gemini');
    await _avancarFluxo(msgs);
  } catch (err) {
    thinking.remove();
    console.error('[Clarim IA] ❌ Falha na extração:', err);
    _addBotBubble(msgs, 'Tive um problema ao processar seu lançamento. Tente novamente.');
    _draft = null;
  }
}

// ── Edição inline de campo na prévia ──────────────────────────
// Chamado pelo onclick dos campos clicáveis do card de prévia.
// Não reinicia o draft: apenas muda estado para PERGUNTANDO e pede o campo.
// Após _processarRespostaCampo resolver, campoEditando é lido e o fluxo
// retorna à prévia em vez de seguir para _avancarFluxo.
export function editarCampo(campo) {
  if (!_draft || _draft.estado !== ESTADO.PREVIA) {
    console.warn('[Clarim IA] editarCampo chamado fora do estado PREVIA — ignorado.');
    return;
  }
  console.log(`[Clarim IA] ✏️ Iniciando edição inline do campo: "${campo}"`);
  _draft.campoEditando    = campo;
  _draft.campoPerguntando = campo;
  _draft.estado           = ESTADO.PERGUNTANDO;
  const msgs = $('ai-msgs');
  if (!msgs) return;
  _renderInputCampo(campo, msgs);
}

// ── Funções de guard exportadas para window ────────────────────
export function continuarDraft() {
  if (!_guardPendente) return;
  const { msgsEl } = _guardPendente;
  _guardPendente = null;
  console.log('[Clarim IA] ▶️ Ação: continuar draft existente');
  _logDraft('Continuando draft');
  if (_draft?.estado === ESTADO.PERGUNTANDO && _draft.campoPerguntando) {
    _perguntarCampo(_draft.campoPerguntando, msgsEl);
  } else if (_draft?.estado === ESTADO.PREVIA) {
    _renderPreviaCard(msgsEl);
  }
}

export async function descartarDraftIniciarNovo() {
  if (!_guardPendente) return;
  const { novaFala, msgsEl } = _guardPendente;
  _guardPendente = null;
  _draft = null;
  console.log('[Clarim IA] 🗑️ Ação: draft descartado, iniciando novo lançamento');
  await _iniciarLancamento(novaFala, msgsEl, null);
}

// ── Chave da API Google AI Studio ─────────────────────────────
// Obtenha gratuitamente em: https://aistudio.google.com/app/apikey
const GEMINI_API_KEY = 'AIzaSyAx_P-RYw7_Pfg0Mzhf89_1OgJdgCZqm88';

// ── Base do endpoint ──────────────────────────────────────────
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// ── Preferências de modelo — Flash primeiro, Pro nunca por padrão ─
// Modelos Pro têm cota muito limitada no tier gratuito (limit: 0).
// Só serão usados se ALLOW_PRO_MODEL = true.
const ALLOW_PRO_MODEL = false;

const MODEL_PREFS_FLASH = [
  'gemini-2.5-flash',
  'gemini-2.0-flash',
  'gemini-flash-latest',
  'gemini-2.0-flash-001',
  'gemini-2.0-flash-lite',
  'gemini-1.5-flash-latest',
  'gemini-1.5-flash-002',
  'gemini-1.5-flash-001',
  'gemini-1.5-flash',
];

const MODEL_PREFS_PRO = [
  'gemini-1.5-pro-latest',
  'gemini-1.5-pro',
  'gemini-pro-latest',
  'gemini-pro',
];

function _isPro(name) {
  return /\bpro\b/i.test(name);
}

// ── Auto-descoberta: consulta ListModels e escolhe o melhor Flash ─
let _resolvedModel = null;

async function _resolveModel() {
  if (_resolvedModel) return _resolvedModel;

  console.log('[Clarim IA] 🔍 Consultando modelos disponíveis para esta chave…');
  const res = await fetch(`${GEMINI_BASE}/models?key=${GEMINI_API_KEY}`);
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(`ListModels falhou (${res.status}): ${e.error?.message ?? ''}`);
  }

  const { models = [] } = await res.json();

  const capazes = models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''));

  const flash = capazes.filter(m => !_isPro(m));
  const pro   = capazes.filter(m =>  _isPro(m));

  console.log('[Clarim IA] 📋 Modelos Flash disponíveis:', flash);
  console.log('[Clarim IA] 📋 Modelos Pro disponíveis (não usados por padrão):', pro);

  // Tenta selecionar Flash pela lista de preferências
  for (const pref of MODEL_PREFS_FLASH) {
    const hit = flash.find(m => m === pref || m.startsWith(pref));
    if (hit) {
      _resolvedModel = hit;
      console.log('[Clarim IA] ✅ Modelo Flash selecionado:', _resolvedModel);
      return _resolvedModel;
    }
  }

  // Fallback: qualquer Flash disponível
  if (flash.length) {
    _resolvedModel = flash[0];
    console.log('[Clarim IA] ⚠️ Fallback: usando primeiro Flash disponível:', _resolvedModel);
    return _resolvedModel;
  }

  // Pro só entra se explicitamente permitido
  if (ALLOW_PRO_MODEL && pro.length) {
    for (const pref of MODEL_PREFS_PRO) {
      const hit = pro.find(m => m === pref || m.startsWith(pref));
      if (hit) { _resolvedModel = hit; break; }
    }
    if (!_resolvedModel) _resolvedModel = pro[0];
    console.warn('[Clarim IA] ⚠️ Nenhum Flash disponível — usando Pro (ALLOW_PRO_MODEL=true):', _resolvedModel);
    return _resolvedModel;
  }

  throw new Error(
    ALLOW_PRO_MODEL
      ? 'Nenhum modelo Gemini disponível para generateContent.'
      : 'Nenhum modelo Flash disponível. Para usar Pro, defina ALLOW_PRO_MODEL = true em ia.js.'
  );
}

// ── Diagnóstico manual: chame window.diagnosIA() no console ──
export async function diagnosIA() {
  console.group('[Clarim IA] ══ DIAGNÓSTICO ══');
  console.log('Chave (últimos 6):', GEMINI_API_KEY.slice(-6));
  console.log('Base URL:', GEMINI_BASE);
  console.log('ALLOW_PRO_MODEL:', ALLOW_PRO_MODEL);
  _resolvedModel = null; // força re-seleção para o diagnóstico ver a lista completa
  try {
    const model = await _resolveModel();
    const url   = `${GEMINI_BASE}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
    console.log('─── Teste mínimo ───────────────────────────');
    console.log('Modelo testado :', model);
    console.log('Endpoint       :', url.replace(GEMINI_API_KEY, '***'));

    const res  = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Responda apenas: OK' }] }] }),
    });
    const json = await res.json();

    console.log('HTTP status    :', res.status, res.statusText);
    console.log('Resposta crua  :', json);

    if (res.ok) {
      const txt = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '(sem texto)';
      console.log('✅ Chamada mínima OK! Resposta:', txt);
    } else {
      console.error('❌ Chamada mínima falhou');
      console.error('   Código HTTP :', res.status);
      console.error('   Mensagem API:', json.error?.message ?? JSON.stringify(json.error));
    }
  } catch (e) {
    console.error('❌ Diagnóstico falhou:', e.message);
  }
  console.groupEnd();
}

// ── FASE 1 — Agente textual (system prompt, sem tools) ────────
// Tools/function calling ficam para Fase 2, após o agente
// textual estar estável. Não remova o FUNC_DECLARATION abaixo —
// ele será reativado na próxima etapa.
async function _callGemini(systemPrompt, q) {
  if (!GEMINI_API_KEY || GEMINI_API_KEY === 'COLE_SUA_CHAVE_AQUI') {
    throw new Error('CHAVE_NAO_CONFIGURADA');
  }

  const model = await _resolveModel();
  const url   = `${GEMINI_BASE}/models/${model}:generateContent?key=${GEMINI_API_KEY}`;

  // Fase 1: apenas system_instruction + contents (sem tools)
  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: q }] }],
  };

  console.log('[Clarim IA] 🤖 Modelo   :', model);
  console.log('[Clarim IA] 🌐 Endpoint :', url.replace(GEMINI_API_KEY, '***'));
  console.log('[Clarim IA] 📤 Payload  :', JSON.stringify({ system_instruction: '(omitido)', contents: payload.contents }));

  const res  = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  const json = await res.json();
  console.log('[Clarim IA] 📥 Resposta :', json);

  if (!res.ok) {
    throw new Error(json.error?.message || `HTTP ${res.status}`);
  }

  console.log('[Clarim IA] ✅ Gemini respondeu com sucesso.');
  return json;
}

// ── Helpers de match contra dados reais ───────────────────────
function _matchConta(nome) {
  if (!nome) return null;
  const q = nome.toLowerCase().trim();
  return (
    state.allContas.find(c => c.nome?.toLowerCase() === q) ||
    state.allContas.find(c => c.nome?.toLowerCase().includes(q)) ||
    state.allContas.find(c => q.includes(c.nome?.toLowerCase()))
  ) || null;
}

function _matchCategoria(nome) {
  if (!nome) return null;
  const q = nome.toLowerCase().trim();
  const hit =
    state.allCategorias.find(c => c.nome?.toLowerCase() === q) ||
    state.allCategorias.find(c => c.nome?.toLowerCase().includes(q)) ||
    state.allCategorias.find(c => q.includes(c.nome?.toLowerCase()));
  return hit?.nome || null;
}

// ── Declaração da função (Gemini / Firebase Vertex AI format) ──
// Diferença do Claude: usa `parameters` (não `input_schema`);
// tipos são strings lowercase JSON Schema padrão.
const FUNC_DECLARATION = {
  name: 'registrar_lancamento',
  description: 'Cria um lançamento financeiro (despesa ou receita) no Clarim. Use quando o usuário deseja registrar um gasto, pagamento, compra ou recebimento de dinheiro.',
  parameters: {
    type: 'object',
    properties: {
      tipo: {
        type: 'string',
        enum: ['despesa', 'receita'],
        description: 'Tipo do lançamento',
      },
      descricao: {
        type: 'string',
        description: 'Descrição sucinta do lançamento (ex: Gasolina Posto Shell)',
      },
      valor: {
        type: 'number',
        description: 'Valor numérico em reais (ex: 50.00)',
      },
      categoria: {
        type: 'string',
        description: 'Categoria mais adequada — escolha uma das categorias cadastradas no sistema',
      },
      conta: {
        type: 'string',
        description: 'Nome da conta bancária ou carteira mencionada pelo usuário',
      },
      data: {
        type: 'string',
        description: 'Data no formato YYYY-MM-DD. Use a data de hoje se não especificada.',
      },
      status: {
        type: 'string',
        enum: ['pendente', 'pago', 'previsto', 'recebido'],
        description: "Use 'pago'/'recebido' se o usuário indicar que já efetuou (ex: 'paguei', 'gastei', 'recebi'). Caso contrário, use 'pendente'/'previsto'.",
      },
    },
    required: ['tipo', 'descricao', 'valor'],
  },
};

// ── Render do card de confirmação ─────────────────────────────
function _renderConfirmCard(input, msgs) {
  const conta     = _matchConta(input.conta);
  const categoria = _matchCategoria(input.categoria) || input.categoria || '—';
  const hoje      = new Date().toISOString().slice(0, 10);
  const data      = input.data || hoje;
  const valor     = Number(input.valor);
  const tipo      = input.tipo === 'receita' ? 'receita' : 'despesa';

  // Resolve status com base no que o Gemini extraiu
  let status;
  if (tipo === 'receita') {
    status = input.status === 'recebido' ? 'recebido' : 'previsto';
  } else {
    status = input.status === 'pago' ? 'pago' : 'pendente';
  }

  const payload = {
    tipo,
    descricao:     input.descricao,
    valor,
    categoria,
    contaId:       conta?.id   || '',
    conta:         conta?.nome || input.conta || '',
    data,
    status,
    dataPagamento: (status === 'pago' || status === 'recebido') ? hoje : '',
  };

  // Armazena e gera chave única para o onclick
  const cid = `ia_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  _pending.set(cid, payload);

  const [ano, mes, dia] = data.split('-');
  const dataFmt = `${dia}/${mes}/${ano}`;
  const statusLabel =
    status === 'pago'      ? '<span class="ai-tag-pago">✅ Pago</span>'     :
    status === 'recebido'  ? '<span class="ai-tag-pago">✅ Recebida</span>' :
    status === 'previsto'  ? '<span class="ai-tag-pend">⏳ Prevista</span>' :
                             '<span class="ai-tag-pend">⏳ Pendente</span>';

  const card = document.createElement('div');
  card.className = 'ai-bubble-bot ai-confirm-card';
  card.dataset.cid = cid;
  card.innerHTML = `
    <div class="ai-confirm-header">
      <span class="ai-confirm-icon">${tipo === 'receita' ? '💰' : '💸'}</span>
      <div class="ai-confirm-info">
        <div class="ai-confirm-type">${tipo === 'receita' ? 'Receita' : 'Despesa'} identificada</div>
        <div class="ai-confirm-desc">${payload.descricao}</div>
      </div>
      <div class="ai-confirm-valor ${tipo === 'receita' ? 'c-green' : 'c-red'}">${fmt(valor)}</div>
    </div>
    <div class="ai-confirm-details">
      <span class="ai-confirm-tag">📅 ${dataFmt}</span>
      ${categoria !== '—' ? `<span class="ai-confirm-tag">🏷️ ${categoria}</span>` : ''}
      ${conta
        ? `<span class="ai-confirm-tag">🏦 ${conta.nome}</span>`
        : input.conta
          ? `<span class="ai-confirm-tag" style="opacity:.6">🏦 ${input.conta}</span>`
          : ''}
      ${statusLabel}
    </div>
    <div class="ai-confirm-hint">Posso criar este lançamento para você?</div>
    <div class="ai-confirm-actions">
      <button class="ai-confirm-btn" onclick="window.confirmarLancamentoIA('${cid}', this)">
        ✅ Confirmar Lançamento
      </button>
      <button class="ai-confirm-cancel" onclick="window.cancelarLancamentoIA('${cid}', this)">
        Cancelar
      </button>
    </div>`;

  msgs.appendChild(card);
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Confirmação (global via window) ───────────────────────────
export async function confirmarLancamentoIA(cid, btn) {
  const payload = _pending.get(cid);
  if (!payload) {
    showToast('Confirmação expirada. Repita a pergunta.', 'err');
    return;
  }
  _pending.delete(cid);

  const card = btn?.closest('.ai-confirm-card');
  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    // ── Validação final dupla antes de gravar ──────────────────
    const validacao = _validarFinal(payload);
    if (!validacao.ok) {
      console.error('[Clarim IA] ❌ Validação final falhou:', validacao.erros);
      if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar'; }
      showToast(`Não foi possível salvar: ${validacao.erros.join(', ')}`, 'err');
      return;
    }
    console.log('[Clarim IA] ✅ Ação: confirmação aprovada na validação final');

    const colecao = payload.tipo === 'receita' ? 'receitas' : 'lancamentos';

    const lancDoc = payload.tipo === 'receita'
      ? {
          descricao:   payload.descricao,
          categoria:   payload.categoria,
          conta:       payload.conta,
          contaId:     payload.contaId,
          valor:       payload.valor,
          data:        payload.data,
          status:      payload.status,
          recorrencia: 'unico',
          obs:         'Criado pelo Clarim IA',
        }
      : {
          descricao:     payload.descricao,
          categoria:     payload.categoria,
          conta:         payload.conta,
          contaId:       payload.contaId,
          valor:         payload.valor,
          valorOriginal: payload.valor,
          valorAjuste:   0,
          valorTotal:    payload.valor,
          data:          payload.data,
          status:        payload.status,
          dataPagamento: payload.dataPagamento || '',
          tipo:          'debito',
          recorrencia:   'unico',
          obs:           'Criado pelo Clarim IA',
        };

    const id = await fbAdd(colecao, lancDoc);
    if (!id) throw new Error('fbAdd retornou null');

    // ── Atualiza saldo da conta se status for pago/recebido ─────
    if (payload.contaId) {
      if (payload.tipo !== 'receita' && payload.status === 'pago') {
        await atualizarSaldoConta(payload.contaId, payload.valor, 'subtracao');
      } else if (payload.tipo === 'receita' && payload.status === 'recebido') {
        await atualizarSaldoConta(payload.contaId, payload.valor, 'soma');
      }
    }

    // ── Sincronização imediata de estado (sem F5) ───────────────
    // Antecipa o onSnapshot: injeta o doc em state e dispara render
    if (payload.tipo === 'receita') {
      state.allReceitas.push({ id, ...lancDoc });
      document.dispatchEvent(new CustomEvent('clarim:receitas', {
        detail: { changes: [{ type: 'added', id }] },
      }));
    } else {
      state.allLancamentos.push({ id, ...lancDoc });
      document.dispatchEvent(new CustomEvent('clarim:lancamentos', {
        detail: { changes: [{ type: 'added', id }] },
      }));
    }

    // ── Substitui o card pela mensagem de comemoração ───────────
    if (card) {
      card.className = 'ai-bubble-bot ai-confirm-success-card';
      card.innerHTML = `
        <div class="ai-confirm-success">
          Prontinho! Lançamento de <strong>${payload.descricao}</strong> · ${fmt(payload.valor)} registrado com sucesso. ✅
        </div>`;
    }
    showToast(`${payload.tipo === 'receita' ? 'Receita' : 'Despesa'} criada pelo Clarim IA ✅`);
    _draft = null;
    _previaCardEl = null;
  } catch (err) {
    console.error('[Clarim IA] ❌ Falha ao confirmar lançamento:', err);
    if (btn) { btn.disabled = false; btn.textContent = '✅ Confirmar Lançamento'; }
    showToast('Erro ao criar lançamento. Tente novamente.', 'err');
  }
}

// ── Cancelar (global via window) ──────────────────────────────
export function cancelarLancamentoIA(cid, btn) {
  _draft = null;
  _previaCardEl = null;
  _pending.delete(cid);
  const card    = btn?.closest('.ai-confirm-card');
  const hint    = card?.querySelector('.ai-confirm-hint');
  const actions = card?.querySelector('.ai-confirm-actions');
  if (hint)    hint.textContent = 'Lançamento cancelado.';
  if (actions) actions.remove();
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  CAMADA DE CONTEXTO — cálculos 100% em JS, IA só interpreta ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * Calcula e estrutura todos os dados financeiros antes de enviar à IA.
 * A IA nunca deve calcular, estimar ou inferir valores.
 * @returns {object} ctx — schema padronizado com números e strings formatadas
 */
function _buildContexto() {
  const hoje      = new Date();
  const mesAtual  = hoje.getMonth();
  const anoAtual  = hoje.getFullYear();
  const prefixMes = `${anoAtual}-${String(mesAtual + 1).padStart(2, '0')}`;
  const MESES     = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                     'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

  // ── Totais globais (números brutos para cálculo) ──────────────
  const totalDesp = state.allLancamentos.reduce((s, l) => s + _vt(l), 0);
  const totalRec  = state.allReceitas.reduce((s, r) => s + Number(r.valor || 0), 0);
  const saldo     = totalRec - totalDesp;

  // ── Mês corrente ───────────────────────────────────────────────
  const lancMes = state.allLancamentos.filter(l => (l.data || '').startsWith(prefixMes));
  const recMes  = state.allReceitas.filter(r => (r.data || '').startsWith(prefixMes));
  const despMesVal = lancMes.reduce((s, l) => s + _vt(l), 0);
  const recMesVal  = recMes.reduce((s, r) => s + Number(r.valor || 0), 0);
  const saldoMes   = recMesVal - despMesVal;

  // ── Maior despesa individual ───────────────────────────────────
  const maiorLanc = state.allLancamentos.length
    ? state.allLancamentos.reduce((max, l) => (_vt(l) > _vt(max) ? l : max))
    : null;

  // ── Top 5 categorias por valor ─────────────────────────────────
  const porCat = {};
  state.allLancamentos.forEach(l => {
    const cat = l.categoria || 'Sem categoria';
    porCat[cat] = (porCat[cat] || 0) + _vt(l);
  });
  const topCategorias = Object.entries(porCat)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([nome, val]) => ({
      nome,
      valorNum: val,
      valor: fmt(val),
      percentual: totalDesp > 0 ? `${((val / totalDesp) * 100).toFixed(1)}%` : '0%',
    }));

  // ── Saldos por conta ───────────────────────────────────────────
  const saldosContas = state.allContas.map(c => ({
    nome:     c.nome,
    saldoNum: Number(c.saldo || 0),
    saldo:    fmt(Number(c.saldo || 0)),
  }));

  // ── Pendências ─────────────────────────────────────────────────
  const pendentes = state.allLancamentos.filter(
    l => l.status === 'pendente' || l.status === 'previsto'
  );
  const valorPendente = pendentes.reduce((s, l) => s + _vt(l), 0);

  // ── Schema final (formatado para o prompt) ─────────────────────
  const ctx = {
    // Meta
    dataHoje:    hoje.toISOString().slice(0, 10),
    mesNome:     MESES[mesAtual],
    anoAtual,

    // Totais globais
    totalReceitas:  fmt(totalRec),
    totalDespesas:  fmt(totalDesp),
    saldoLiquido:   fmt(saldo),
    saldoPositivo:  saldo >= 0,

    // Mês atual
    receitasMes:  fmt(recMesVal),
    despesasMes:  fmt(despMesVal),
    saldoMes:     fmt(saldoMes),
    saldoMesPositivo: saldoMes >= 0,

    // Destaques
    maiorDespesa: maiorLanc
      ? { descricao: maiorLanc.descricao, valor: fmt(_vt(maiorLanc)), categoria: maiorLanc.categoria || '—' }
      : null,

    // Categorias
    topCategorias,
    totalCategorias: Object.keys(porCat).length,

    // Contas
    saldosContas,
    contasNomes: state.allContas.map(c => c.nome).join(', ') || '(nenhuma cadastrada)',

    // Pendências
    lancamentosPendentes: pendentes.length,
    valorPendente: fmt(valorPendente),

    // Listas para lançamentos futuros
    categoriasNomes: state.allCategorias.map(c => c.nome).join(', ') || '(nenhuma cadastrada)',

    // Números brutos para cálculos de corte nos prompts analíticos (nunca enviados à IA diretamente)
    saldoMesNum: saldoMes,   // negativo = déficit mensal
    despMesNum:  despMesVal, // total de despesas do mês como número
  };

  console.log('[Clarim IA] 📊 Contexto calculado (schema):', JSON.stringify(ctx, null, 2));
  return ctx;
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  DETECÇÃO DE INTENÇÃO — roteamento por keywords, sem IA     ║
// ╚══════════════════════════════════════════════════════════════╝

const INTENCOES = {
  saldo:         /saldo|quanto (tenho|sobrou|resta|tenho disponível)|situação financeira|posição financeira/i,
  maior_despesa: /maior (despesa|gasto|conta|débito)|gasto mais alto|mais caro|mais gastei/i,
  resumo_mes:    /resumo|balanço|fechamento|como foi (o mês|esse mês|este mês)|resultado do mês/i,
  categorias:    /categori|onde (mais )?gastei|por categoria|gastos por tipo|distribuição/i,
  contas:        /\bconta(s)?\b|banco|carteira|saldo (da|das|por) conta/i,
  pendencias:    /pendente|atraso|a pagar|vencimento|devo|inadimpl|aberto/i,
  dicas:         /dica|economizar|reduzir|cortar gasto|sugestão|como melhorar/i,
};

/**
 * Detecta a intenção da pergunta por keywords.
 * Retorna uma string como 'saldo', 'resumo_mes', etc.
 * Retorna 'geral' se nenhuma intenção específica for detectada.
 */
function _detectarIntencao(q) {
  for (const [intencao, regex] of Object.entries(INTENCOES)) {
    if (regex.test(q)) return intencao;
  }
  return 'geral';
}

// ╔══════════════════════════════════════════════════════════════╗
// ║  PROMPTS POR INTENÇÃO — foco no que o usuário realmente quer║
// ╚══════════════════════════════════════════════════════════════╝

const _REGRAS_BASE = `
REGRAS OBRIGATÓRIAS:
- Use EXCLUSIVAMENTE os dados fornecidos neste prompt. Nunca invente ou estime valores.
- Todos os valores já estão calculados e formatados em R$. Use-os exatamente como estão.
- Se uma informação não estiver nos dados, diga: "Não tenho essa informação disponível."
- Responda em português do Brasil.
- Chame o usuário de "Fábio" quando apropriado.
- PROIBIDO dar conselhos genéricos como "revise seus gastos" ou "crie um orçamento" sem citar valores reais.
- Toda recomendação deve citar o R$ concreto envolvido (ex: "reduzir Alimentação em R$ 200 liberaria R$ 200/mês").
- Se o saldo do mês for negativo, sinalize isso com urgência antes de qualquer outra coisa.

FORMATO OBRIGATÓRIO DA RESPOSTA:
- Use **negrito** para títulos de seção (ex: **Diagnóstico**)
- Use "- " no início de cada item de lista
- Máximo 1 informação por linha
- Separe seções com uma linha em branco
- Sem parágrafos longos — respostas escaneáveis
- Não use tabelas, não use asteriscos triplos, não use cabeçalhos com #
`.trim();

function _promptParaIntencao(intencao, ctx) {
  const base = `Você é o Clarim IA, assistente financeiro do Fábio.\n${_REGRAS_BASE}\n\n`;

  const blocoGlobal = `
DADOS GLOBAIS (calculados pelo sistema em ${ctx.dataHoje}):
  Total de receitas : ${ctx.totalReceitas}
  Total de despesas : ${ctx.totalDespesas}
  Saldo líquido     : ${ctx.saldoLiquido} (${ctx.saldoPositivo ? 'positivo' : 'negativo'})
`.trim();

  const blocoMes = `
MÊS ATUAL (${ctx.mesNome} ${ctx.anoAtual}):
  Receitas  : ${ctx.receitasMes}
  Despesas  : ${ctx.despesasMes}
  Saldo     : ${ctx.saldoMes} (${ctx.saldoMesPositivo ? 'positivo' : 'negativo'})
`.trim();

  const blocoContas = ctx.saldosContas.length
    ? `SALDOS POR CONTA:\n${ctx.saldosContas.map(c => `  ${c.nome}: ${c.saldo}`).join('\n')}`
    : 'CONTAS: nenhuma cadastrada.';

  const blocoCats = ctx.topCategorias.length
    ? `TOP CATEGORIAS POR GASTO:\n${ctx.topCategorias.map(c => `  ${c.nome}: ${c.valor} (${c.percentual} do total)`).join('\n')}`
    : 'CATEGORIAS: nenhum dado disponível.';

  const blocoMaior = ctx.maiorDespesa
    ? `MAIOR DESPESA INDIVIDUAL:\n  ${ctx.maiorDespesa.descricao} — ${ctx.maiorDespesa.valor} (${ctx.maiorDespesa.categoria})`
    : 'MAIOR DESPESA: nenhuma despesa registrada.';

  const blocoPend = `PENDÊNCIAS:\n  ${ctx.lancamentosPendentes} lançamento(s) pendente(s) — total de ${ctx.valorPendente}`;

  // Sugestões de corte calculadas em JS (15% da maior categoria, mínimo R$ 50)
  const blocoSugestoes = (() => {
    if (!ctx.topCategorias.length) return 'SUGESTÕES: dados insuficientes para calcular.';
    const linhas = ctx.topCategorias.slice(0, 3).map(c => {
      const corte = Math.max(50, Math.round(c.valorNum * 0.15));
      return `  ${c.nome}: ${c.valor} → corte sugerido de ${fmt(corte)}/mês`;
    });
    return `SUGESTÕES DE CORTE (15% das maiores categorias):\n${linhas.join('\n')}`;
  })();

  const prompts = {
    saldo: `${base}
${blocoGlobal}
${blocoMes}
${blocoContas}

Tarefa: Responda no formato abaixo. Substitua com os dados reais.

**Situação financeira — ${ctx.dataHoje}**

- Saldo líquido: ${ctx.saldoLiquido}
- Total de receitas: ${ctx.totalReceitas}
- Total de despesas: ${ctx.totalDespesas}

**${ctx.mesNome} ${ctx.anoAtual}**

- Receitas do mês: ${ctx.receitasMes}
- Despesas do mês: ${ctx.despesasMes}
- Saldo do mês: ${ctx.saldoMes}

**Contas**

(liste cada conta com seu saldo)

**Análise**

(1 a 3 observações curtas sobre a situação — use os dados acima, sem inventar)`,

    maior_despesa: `${base}
${blocoMaior}
${blocoCats}
${blocoGlobal}

Tarefa: Responda no formato abaixo.

**Maior despesa registrada**

- Descrição: (nome da despesa)
- Valor: (valor)
- Categoria: (categoria)

**Gastos por categoria**

(liste cada categoria com valor e percentual — máximo 5)

**Análise**

(1 a 2 observações sobre concentração de gastos)`,

    resumo_mes: `${base}
${blocoMes}
${blocoGlobal}
${blocoCats}
${blocoPend}
${blocoSugestoes}

Tarefa: Responda no formato abaixo.

**Diagnóstico — ${ctx.mesNome} ${ctx.anoAtual}**

- Receitas: ${ctx.receitasMes}
- Despesas: ${ctx.despesasMes}
- Saldo do mês: ${ctx.saldoMes} (${ctx.saldoMesPositivo ? 'positivo' : '⚠️ DÉFICIT'})

**Impacto**

(avalie o saldo do mês: se negativo, quanto falta cobrir e qual categoria mais pesou)

**Plano objetivo**

(1 ação concreta com valor real, ex: "cortar R$ X em [categoria] zeraria o déficit")

**Ações específicas**

(liste 2 a 3 ajustes com R$ real — use os dados de sugestões de corte fornecidos)

**Conclusão**

- Pendências em aberto: ${ctx.lancamentosPendentes} itens — ${ctx.valorPendente}
- (1 frase direta sobre a prioridade do mês)`,

    categorias: `${base}
${blocoCats}
${blocoGlobal}
${blocoSugestoes}

Tarefa: Responda no formato abaixo.

**Diagnóstico — gastos por categoria**

(liste cada categoria no formato "- Nome: R$ valor (X% do total)")

**Impacto**

- Categoria dominante: (nome da maior) com (percentual) do total
- (avalie se essa concentração é saudável ou representa risco)

**Plano objetivo**

(1 ação com valor concreto, ex: "reduzir [categoria] em R$ X liberaria R$ X/mês")

**Ações específicas**

(use os dados de sugestões de corte — cite os valores calculados)

**Conclusão**

(1 frase com o principal ajuste que mais impactaria o saldo)`,

    contas: `${base}
${blocoContas}
${blocoGlobal}

Tarefa: Responda no formato abaixo.

**Saldos por conta**

(liste cada conta no formato "- Nome da conta: R$ valor")

**Saldo líquido total**

- Total: ${ctx.saldoLiquido}

**Análise**

(mencione contas com saldo zerado ou negativo, se houver)`,

    pendencias: `${base}
${blocoPend}
${blocoMes}

Tarefa: Responda no formato abaixo.

**Pendências em aberto**

- Lançamentos pendentes: ${ctx.lancamentosPendentes}
- Valor total em aberto: ${ctx.valorPendente}

**Impacto no saldo**

- Saldo do mês atual: ${ctx.saldoMes}
- (avalie se as pendências comprometem o saldo)

**Recomendação**

(1 orientação objetiva sobre as pendências)`,

    dicas: `${base}
${blocoGlobal}
${blocoMes}
${blocoCats}
${blocoSugestoes}

Tarefa: Responda no formato abaixo. Toda recomendação deve citar um valor real em R$.

**Diagnóstico**

- Saldo do mês: ${ctx.saldoMes} (${ctx.saldoMesPositivo ? 'positivo' : '⚠️ déficit'})
- Maior categoria: ${ctx.topCategorias[0]?.nome ?? '—'} — ${ctx.topCategorias[0]?.valor ?? '—'} (${ctx.topCategorias[0]?.percentual ?? '—'} do total)

**Impacto**

(avalie o que está pesando mais no orçamento — cite categoria e valor real)

**Plano objetivo**

(1 meta clara e mensurável, ex: "reduzir [categoria] de R$ X para R$ Y em 30 dias")

**Ações específicas**

- (ação 1 com R$ concreto — use os dados de sugestões de corte)
- (ação 2 com R$ concreto)
- (ação 3 com R$ concreto)

**Conclusão**

(1 frase motivacional baseada nos dados reais — cite o ganho esperado em R$)`,

    geral: `${base}
${blocoGlobal}
${blocoMes}
${blocoContas}
${blocoCats}
${blocoMaior}
${blocoPend}
${blocoSugestoes}

Tarefa: Responda à pergunta do Fábio usando exclusivamente os dados acima.
Se a resposta envolver análise ou recomendação, use obrigatoriamente esta estrutura:

**Diagnóstico** — o que os dados mostram
**Impacto** — consequência financeira concreta (cite R$)
**Plano objetivo** — 1 ação mensurável
**Ações específicas** — lista com R$ real por item
**Conclusão** — 1 frase direta com resultado esperado

Se for uma pergunta factual simples (ex: "qual meu saldo?"), responda diretamente sem usar a estrutura acima.
Máximo 1 informação por linha.`,
  };

  return prompts[intencao] ?? prompts.geral;
}

// ── Helpers de UI — escape HTML (compartilhado pelas UIs interativas) ─
const _esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ╔══════════════════════════════════════════════════════════════╗
// ║  CONSULTA DE SÉRIE — desambiguação antes de chamar a IA     ║
// ╚══════════════════════════════════════════════════════════════╝

/**
 * Exibe bolha de confirmação para o candidato principal (posição 0).
 * Se houver mais candidatos, oferece o botão "Ver outras opções".
 */
function _exibirConfirmacaoSerie(pergunta, candidatos, msgs) {
  _consultaPendente = { pergunta, candidatos };

  const c    = candidatos[0];
  const pago = c.items.filter(l => l.status === 'pago' || l.status === 'recebido').length;
  const pend = c.items.filter(l => l.status === 'pendente' || l.status === 'previsto').length;

  const verOutrasBtn = candidatos.length > 1
    ? `<button class="ai-field-btn" onclick="window.verOutrasOpcoesSerie(this)">🔍 Ver outras opções</button>`
    : '';

  const el = document.createElement('div');
  el.className = 'ai-bubble-bot ai-field-prompt';
  el.innerHTML = `
    <div class="ai-field-label">Para te responder com precisão, preciso confirmar a despesa. É esta aqui?</div>
    <div class="ai-serie-preview">
      <strong>${_esc(c.desc)}</strong>
      <span>${c.items.length} lançamento(s) — ${pago} pago(s), ${pend} pendente(s)</span>
    </div>
    <div class="ai-field-opts">
      <button class="ai-field-btn" onclick="window.confirmarConsultaSerie(0,this)">✅ Confirmar</button>
      ${verOutrasBtn}
      <button class="ai-field-btn ai-field-btn-cancel" onclick="window.cancelarConsultaSerie(this)">✕ Cancelar</button>
    </div>`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

/**
 * Exibe lista completa de candidatos como chips clicáveis.
 * Chamado ao clicar em "Ver outras opções".
 */
function _exibirListaOpcoesSerie(msgs) {
  if (!_consultaPendente) return;
  const { candidatos } = _consultaPendente;

  const chips = candidatos.map((c, i) => {
    const pago = c.items.filter(l => l.status === 'pago' || l.status === 'recebido').length;
    const pend = c.items.filter(l => l.status === 'pendente' || l.status === 'previsto').length;
    return `<button class="ai-chip-opt" onclick="window.confirmarConsultaSerie(${i},this)">${_esc(c.desc)} — ${pago}p / ${pend} pendente(s)</button>`;
  }).join('');

  const el = document.createElement('div');
  el.className = 'ai-bubble-bot ai-field-prompt';
  el.innerHTML = `
    <div class="ai-field-label">Qual dessas despesas você quer consultar?</div>
    <div class="ai-field-chips">${chips}</div>
    <div class="ai-field-opts" style="margin-top:.5rem">
      <button class="ai-field-btn ai-field-btn-cancel" onclick="window.cancelarConsultaSerie(this)">✕ Cancelar</button>
    </div>`;
  msgs.appendChild(el);
  msgs.scrollTop = msgs.scrollHeight;
}

/**
 * Monta o contexto da série confirmada em texto puro (JS, sem IA)
 * e chama Gemini para gerar o resumo de parcelas/status.
 */
async function _gerarResumaSerie(candidato, pergunta, msgs) {
  const { desc, items } = candidato;

  // Ordena por data e separa por status
  const sorted  = [...items].sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  const pagos   = sorted.filter(l => l.status === 'pago' || l.status === 'recebido');
  const pend    = sorted.filter(l => l.status === 'pendente' || l.status === 'previsto');
  const totalPago = pagos.reduce((s, l) => s + _vt(l), 0);
  const totalPend = pend.reduce((s, l) => s + _vt(l), 0);

  // Intervalo médio entre lançamentos (em dias) para estimar padrão de frequência
  let intervaloTexto = '';
  if (sorted.length > 1) {
    const datas = sorted.map(l => new Date(l.data)).filter(d => !isNaN(d));
    if (datas.length > 1) {
      const diffs = [];
      for (let i = 1; i < datas.length; i++) diffs.push((datas[i] - datas[i - 1]) / 86400000);
      const media = Math.round(diffs.reduce((s, v) => s + v, 0) / diffs.length);
      intervaloTexto = `Intervalo médio entre lançamentos: ~${media} dias`;
    }
  }

  const primeiraData = sorted[0]?.data ?? '—';
  const ultimaData   = sorted[sorted.length - 1]?.data ?? '—';

  const linhasPagos = pagos.slice(-3).map(l => `  ${l.data} — ${fmt(_vt(l))} — ${l.status}`).join('\n') || '  (nenhum)';
  const linhasPend  = pend.map(l => `  ${l.data} — ${fmt(_vt(l))} — ${l.status}`).join('\n') || '  (nenhuma)';

  const blocoSerie = [
    `SÉRIE CONFIRMADA: "${desc}"`,
    `  Total de lançamentos  : ${items.length}`,
    `  Pagos / recebidos     : ${pagos.length} — total ${fmt(totalPago)}`,
    `  Pendentes / previstos : ${pend.length} — total ${fmt(totalPend)}`,
    `  Total geral da série  : ${fmt(totalPago + totalPend)}`,
    `  Primeiro lançamento   : ${primeiraData}`,
    `  Último lançamento     : ${ultimaData}`,
    intervaloTexto,
    '',
    'ÚLTIMOS PAGAMENTOS (até 3):',
    linhasPagos,
    '',
    'PENDÊNCIAS RESTANTES:',
    linhasPend,
  ].filter(l => l !== undefined).join('\n');

  const systemPrompt = `Você é o Clarim IA, assistente financeiro do Fábio.\n${_REGRAS_BASE}\n\n${blocoSerie}

Tarefa: Responda à pergunta do Fábio sobre esta série usando exclusivamente os dados acima.

**Situação da série: ${_esc(desc)}**

- Lançamentos pagos: ${pagos.length} — ${fmt(totalPago)}
- Pendentes restantes: ${pend.length} — ${fmt(totalPend)}
- Total geral: ${fmt(totalPago + totalPend)}

**O que falta**

(responda objetivamente: quantos pagamentos restam, quanto em R$ ainda falta pagar, data do último registrado)

**Conclusão**

(1 frase direta sobre a situação atual da série)`;

  const thinking = document.createElement('div');
  thinking.className = 'ai-bubble-bot ai-bubble-thinking';
  thinking.textContent = 'Analisando…';
  msgs.appendChild(thinking);
  msgs.scrollTop = msgs.scrollHeight;

  try {
    const result   = await _callGemini(systemPrompt, pergunta);
    const parts    = result.candidates?.[0]?.content?.parts ?? [];
    const textPart = parts.find(p => typeof p.text === 'string');
    thinking.classList.remove('ai-bubble-thinking');
    thinking.innerHTML = _renderMd(textPart?.text || 'Sem resposta.');
  } catch (err) {
    thinking.classList.remove('ai-bubble-thinking');
    thinking.classList.add('ai-bubble-err');
    thinking.textContent = '✨ Fábio, tive um problema ao analisar a série. Tente novamente.';
    console.error('[Clarim IA] ❌ Falha no resumo da série:', err);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── Exports globais — confirmação/cancelamento de série ────────
export function confirmarConsultaSerie(idx, btn) {
  if (!_consultaPendente) return;
  const { pergunta, candidatos } = _consultaPendente;
  const candidato = candidatos[Number(idx)];
  if (!candidato) return;

  const bubble = btn?.closest('.ai-field-prompt');
  if (bubble) {
    bubble.querySelectorAll('button').forEach(b => { b.disabled = true; });
    if (btn) btn.classList.add('ai-chip-sel');
  }

  _consultaPendente = null;
  const msgs = $('ai-msgs');
  if (!msgs) return;
  _gerarResumaSerie(candidato, pergunta, msgs);
}

export function cancelarConsultaSerie(btn) {
  _consultaPendente = null;
  const bubble = btn?.closest('.ai-field-prompt');
  if (bubble) bubble.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const msgs = $('ai-msgs');
  if (msgs) _addBotBubble(msgs, 'Consulta cancelada.');
}

export function verOutrasOpcoesSerie(btn) {
  if (!_consultaPendente) return;
  const bubble = btn?.closest('.ai-field-prompt');
  if (bubble) bubble.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const msgs = $('ai-msgs');
  if (!msgs) return;
  _exibirListaOpcoesSerie(msgs);
}

// ── sendAI principal ──────────────────────────────────────────
export async function sendAI() {
  const inp  = $('ai-inp');
  const msgs = $('ai-msgs');
  if (!inp || !msgs) return;
  const q = inp.value.trim();
  if (!q) return;

  // Oculta estado vazio
  const emptyEl = document.getElementById('ai-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  // ── Roteamento: draft ativo ou intenção de lançamento ─────────
  if (_draft?.estado === ESTADO.PERGUNTANDO) {
    await _processarRespostaCampo(q, msgs, inp);
    return;
  }

  // ── Roteamento: consulta de série (desambiguação antes de chamar a IA) ─
  if (_ehConsultaSerie(q)) {
    const ub = document.createElement('div'); ub.className = 'ai-bubble-user'; ub.textContent = q;
    msgs.appendChild(ub); msgs.scrollTop = msgs.scrollHeight; inp.value = '';
    const candidatos = _buscarCandidatosSerie(q);
    if (!candidatos.length) {
      _addBotBubble(msgs, 'Não encontrei nenhuma despesa correspondente. Tente descrever com outras palavras.');
      return;
    }
    _exibirConfirmacaoSerie(q, candidatos, msgs);
    return;
  }

  if (_ehIntencaoLancamento(q)) {
    console.log('[Clarim IA] 🎯 Ação: intenção de lançamento detectada');
    if (_draft && _draft.estado !== ESTADO.IDLE) {
      const ub = document.createElement('div'); ub.className = 'ai-bubble-user'; ub.textContent = q;
      msgs.appendChild(ub); msgs.scrollTop = msgs.scrollHeight; inp.value = '';
      _exibirGuardDraft(q, msgs);
      return;
    }
    await _iniciarLancamento(q, msgs, inp);
    return;
  }

  // ── 1. Calcular contexto (JS puro, nunca a IA) ────────────────
  const ctx = _buildContexto();

  // ── 2. Detectar intenção por keywords ─────────────────────────
  const intencao    = _detectarIntencao(q);
  const systemPrompt = _promptParaIntencao(intencao, ctx);

  console.log('[Clarim IA] 🎯 Intenção detectada:', intencao);

  // Bolha do usuário
  const userBubble = document.createElement('div');
  userBubble.className = 'ai-bubble-user';
  userBubble.textContent = q;
  msgs.appendChild(userBubble);
  inp.value = '';

  // Bolha "analisando..."
  const thinking = document.createElement('div');
  thinking.className = 'ai-bubble-bot ai-bubble-thinking';
  thinking.textContent = 'Analisando…';
  msgs.appendChild(thinking);
  msgs.scrollTop = msgs.scrollHeight;

  const t0 = performance.now();

  try {
    const result = await _callGemini(systemPrompt, q);
    const ms = (performance.now() - t0).toFixed(0);
    console.log(`[Clarim IA] ⏱️ Tempo de resposta: ${ms}ms | Modelo: ${_resolvedModel} | Intenção: ${intencao}`);

    // Gemini REST retorna candidates direto (sem wrapper .response)
    const parts    = result.candidates?.[0]?.content?.parts ?? [];
    const funcPart = parts.find(p => p.functionCall);
    const textPart = parts.find(p => typeof p.text === 'string');

    if (funcPart?.functionCall?.name === 'registrar_lancamento') {
      if (textPart?.text) {
        thinking.classList.remove('ai-bubble-thinking');
        thinking.textContent = textPart.text;
      } else {
        thinking.remove();
      }
      _renderConfirmCard(funcPart.functionCall.args, msgs);
    } else {
      const answer = textPart?.text || 'Sem resposta.';
      thinking.classList.remove('ai-bubble-thinking');
      thinking.innerHTML = _renderMd(answer);
    }
  } catch (err) {
    thinking.classList.remove('ai-bubble-thinking');
    thinking.classList.add('ai-bubble-err');

    // Log detalhado no console para diagnóstico
    const msg = err?.message ?? String(err);
    console.error('[Clarim IA] ❌ Gemini falhou. Modelo:', _resolvedModel ?? '(não resolvido)', '| Mensagem:', msg);
    console.error('[Clarim IA]    Detalhes:', err);

    // Mensagens de erro contextuais e amigáveis na bolha do chat
    if (msg.includes('CHAVE_NAO_CONFIGURADA')) {
      console.error('[Clarim IA]    → Chave de API não configurada. Abra ia.js e substitua COLE_SUA_CHAVE_AQUI pela chave do Google AI Studio.');
      thinking.textContent = '⚙️ Fábio, a chave da IA ainda não foi configurada. Abra o arquivo ia.js e cole sua chave do Google AI Studio na variável GEMINI_API_KEY.';
    } else if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
      console.error('[Clarim IA]    → Chave inválida. Verifique em aistudio.google.com/app/apikey');
      thinking.textContent = '🔑 Fábio, a chave da API está inválida. Gere uma nova em aistudio.google.com/app/apikey e atualize o ia.js.';
    } else if (msg.includes('QUOTA') || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
      thinking.textContent = '✨ Fábio, atingimos o limite de requisições por agora. Aguarde alguns segundos e tente novamente.';
    } else if (msg.includes('NETWORK') || msg.includes('Failed to fetch') || msg.includes('ERR_NETWORK')) {
      thinking.textContent = '✨ Fábio, estou sem conexão com a internet. Verifique sua rede e tente novamente.';
    } else {
      thinking.textContent = '✨ Fábio, tive um problema de conexão com a IA. Verifique o console para mais detalhes.';
    }
  }
  msgs.scrollTop = msgs.scrollHeight;
}
