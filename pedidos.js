// 🙋 Pedidos — o núcleo: a fila da live (pagos e grátis na mesma fila), as
// regras de quantidade, a leitura de cada mensagem que chega, as operações do
// streamer, a gravação em data/pedidos/pedidos.json e o que cada papel vê.
//
// O servidor chama; o núcleo não conhece WebSocket nem o state:
//   criarPedidos({ baseDir, catalogos, configuracao: () => settings.pedidos,
//     agora: () => Date.now(), aoMudar: (motivo) => {}, apelidoDeTelefone,
//     pareceTelefone, converter })
//
// O que manda no desenho:
// • pagamento nunca se perde: o que cita o catálogo mas não fecha (pagos
//   fechados, valor curto, acima do máximo, fila cheia…) vai para ⚠ Revisar,
//   e a idade não descarta pagamento — vale se os pagos estavam abertos NA
//   HORA do pagamento (os intervalos ficam gravados);
// • a fila é sempre por ordem de chegada (hora do pagamento/da mensagem;
//   empate pelo nº do pedido), pago e grátis juntos;
// • o pedido nasce sem telefone (nome e texto tapados) e o contato para
//   responder fica só aqui dentro: nenhuma projeção o leva;
// • o «message» do servidor nunca é mexido: lerEntrada copia o que precisa;
// • arquivo que não abre ganha cópia e trava a gravação até o streamer
//   escolher «começar do zero»; o nº do pedido (seq) nunca volta para trás;
// • chave vinda de fora nunca vira propriedade de objeto (Map, Set e listas
//   fechadas): __proto__ e companhia não entram.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gravarAtomico, lerJsonSeguro, limparTemporarios } = require('./pedidos-arquivos');
const { criarLeitor, normalizar: normalizarFrase, PALAVRAS_VAZIAS } = require('./pedidos-leitor');
const { nomeParaMostrar, IDIOMAS } = require('./pedidos-catalogo');

// ── 📏 Limites e tempos ────────────────────────────────────────────────────
const VERSAO = 1;
const TETOS = Object.freeze({
  ativos: 2000,      // fila + revisar + pulados + agora (acima disso, pago vai para ⚠ Revisar)
  atendidos: 500, vistos: 5000, intervalos: 1000, registro: 200, creditos: 5000, gratisNaLive: 20000,
  texto: 600, nome: 60, itens: 30, duvidas: 12, opcoes: 12, partidas: 99, feitosNoPainel: 50,
});
const ATRASO_GRAVACAO_MS = 300;  // pedidos do chat: a rajada vira uma gravação só
const VIVO_MS = 5 * 60 * 1000;   // com algo aberto, o arquivo anota «ainda no ar» (vivoEm)
const REPETIDO_MS = 3000;        // o mesmo toque do controle externo antes disso = repetido
const ATRASADO_MS = 60 * 1000;   // pago há mais que isso e só chegou agora = atrasado (a janela do painel)

// ── 📚 Listas fechadas ─────────────────────────────────────────────────────
const ESTADOS_ATIVOS = Object.freeze(['fila', 'agora', 'revisar', 'pulado']);
const FONTES = Object.freeze(['livepix', 'pixgg', 'pix', 'superchat', 'resgate', 'chat', 'telegram', 'whatsapp', 'manual', 'teste']);
const FONTES_PAGAS = new Set(['livepix', 'pixgg', 'pix', 'superchat']);
const PLATAFORMAS = Object.freeze(['youtube', 'twitch', 'kick', 'bilibili', 'telegram', 'whatsapp', 'livepix', 'pixgg', 'pix', 'manual']);
// Marcas do pedido: as de cima mandam para ⚠ Revisar; as de baixo só informam
const MARCAS = Object.freeze([
  'pagosFechados', 'abaixoDoPreco', 'semMensagem', 'naoPareceEmPedido', 'sinalizada', 'acimaDoMaximo',
  'cheio', 'moedaSemCotacao', 'itemEmDuvida', 'gratisEmDuvida', 'semItem',
  'valorConvertido', 'atrasado', 'intercalado', 'naoTenho', 'moderacao', 'creditoUsado', 'reenviado', 'virado', 'manual',
]);
const MARCAS_VALIDAS = new Set(MARCAS);
const ORIGENS_EXTERNAS = new Set(['controle', 'externo']);

// 🗣️ «Parece pedido»: palavras e expressões já na forma do leitor (sem acento,
// gírias trocadas: «pfv» chega como «por favor», «builda» como «build»).
// Ampliável aqui. Mais de um item do catálogo também conta como pedido.
const PALAVRAS_PEDIDO = new Set((
  'manda mande mandar mandem quero queria queremos joga jogue jogar joguem jogando pede pedir pedido pedindo ' +
  'faz faca fazer facam bota bote botar coloca coloque colocar usa use usar usando de com build ' +
  'play please pf porfa porfavor with want wanna ' +
  'quiero juega juegue jugar pon haz con'
).split(' '));
const EXPRESSOES_PEDIDO = Object.freeze(['vai de', 'vamo de', 'vamos de', 'bora de', 'por favor', 'can you', 'could you', 'go with', 'por fa']);
const VAZIAS = new Set(PALAVRAS_VAZIAS);

// ── ⚙️ Configurações (settings.pedidos) ────────────────────────────────────
// JSON puro e nada sensível: vai no init de todas as telas.
const IDIOMAS_NOMES = Object.freeze(['auto', 'ambos', ...IDIOMAS]);
function congelar(o) {
  if (o && typeof o === 'object') { for (const v of Object.values(o)) congelar(v); Object.freeze(o); }
  return o;
}
const CONFIG_PADRAO = congelar({
  jogo: 'dead-by-daylight',
  fontesPagas: { livepix: true, pixgg: true, pix: true, superchat: true, bilibili: false },
  precoCentavos: 1000, precoPorMoeda: {}, maximoPartidas: 5, quantidade: 'valor', sobra: 'gorjeta',
  gratis: {
    caminhos: { resgate: true, chat: false, telegram: false, whatsapp: false },
    recompensas: [], porPessoa: 'live', soInscritos: false, quantidade: 1, emDuvida: 'revisar', manterNaProximaLive: true,
  },
  entrarDireto: 'alta', itemEmDuvida: 'fila', pular: 'fica', seguidas: true, chamarProximoAoTerminar: false,
  testeViraPedido: false, robosPodem: false, sinalizadaRevisar: true,
  nomePix: 'primeiro', nomeNaTela: true, valorNaTela: false, idioma: 'auto',
  palavrasBloqueadas: [],
  imagens: { painel: true, tela: true, pagos: true, baixarDoSiteOficial: true },
  avisoBehaviour: true,
  // da integração: reinício longo fecha o que ficou aberto; quem vê valores pela rede
  fecharAbertosDepoisDeHoras: 6, viewerVeValores: false, fullVeValores: true,
});

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// só a propriedade do próprio objeto (a herdada, inclusive de __proto__, não vale)
const proprio = (o, k) => (ehObjeto(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const RE_JOGO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const jogoValido = (v) => typeof v === 'string' && v.length <= 60 && RE_JOGO.test(v);
const temValor = (v) => v !== undefined && v !== null && v !== '';

function simNao(v, padrao) { return typeof v === 'boolean' ? v : padrao; }
function umDe(v, lista, padrao) { return typeof v === 'string' && lista.includes(v) ? v : padrao; }
// número (ou texto de número, como chega pela URL do controle) dentro da faixa
function inteiro(v, min, max, padrao) {
  let n = NaN;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string' && /^\s*-?\d{1,15}(?:\.\d+)?\s*$/.test(v)) n = Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(max, Math.max(min, Math.round(n)));
}
function booleanos(v, padrao) {
  const out = {};
  for (const k of Object.keys(padrao)) out[k] = simNao(proprio(v, k), padrao[k]);
  return out;
}
// lista de textos curtos, sem repetir (comparando normalizado), com teto
function listaDeTextos(v, maxItens, maxLen, padrao) {
  if (!Array.isArray(v)) return padrao.slice();
  const out = [];
  const vistos = new Set();
  const fim = Math.min(v.length, maxItens * 10); // lista gigante: não percorre tudo
  for (let i = 0; i < fim && out.length < maxItens; i++) {
    const t = typeof v[i] === 'string' ? limparLinha(v[i], maxLen) : '';
    const k = t && normalizarNome(t);
    if (!k || vistos.has(k)) continue;
    vistos.add(k);
    out.push(t);
  }
  return out;
}
// preço por moeda estrangeira, em centavos dela («USD»: 200 = US$ 2,00 por partida)
function precosPorMoeda(v, padrao) {
  const fonte = ehObjeto(v) ? v : padrao;
  const out = {};
  let n = 0;
  for (const k of Object.keys(fonte)) {
    if (n >= 50) break; // teto: 50 moedas
    if (!/^[A-Za-z]{3}$/.test(k)) continue;
    const moeda = k.toUpperCase();
    if (moeda === 'BRL' || Object.hasOwn(out, moeda)) continue; // real é o precoCentavos
    const c = inteiro(fonte[k], 1, 1e9, null);
    if (c === null) continue;
    out[moeda] = c;
    n++;
  }
  return out;
}

// Cada campo com tipo, faixa e lista fechada; o que não se conhece fica de fora.
// O `padrao` (opcional) também é limpo: campo ruim nele cai no CONFIG_PADRAO.
function sanitizarConfiguracao(bruto, padrao) {
  const p = padrao === undefined || padrao === CONFIG_PADRAO || !ehObjeto(padrao) ? CONFIG_PADRAO : sanitizarConfiguracao(padrao);
  const b = ehObjeto(bruto) ? bruto : {};
  const g = ehObjeto(proprio(b, 'gratis')) ? b.gratis : {};
  const img = proprio(b, 'imagens');
  let idioma = proprio(b, 'idioma');
  if (idioma === 'programa') idioma = 'auto'; // o nome usado no mapa da tela
  return {
    jogo: jogoValido(proprio(b, 'jogo')) ? b.jogo : p.jogo,
    fontesPagas: booleanos(proprio(b, 'fontesPagas'), p.fontesPagas),
    precoCentavos: inteiro(proprio(b, 'precoCentavos'), 1, 1e7, p.precoCentavos),
    precoPorMoeda: precosPorMoeda(proprio(b, 'precoPorMoeda'), p.precoPorMoeda),
    maximoPartidas: inteiro(proprio(b, 'maximoPartidas'), 1, TETOS.partidas, p.maximoPartidas),
    quantidade: umDe(proprio(b, 'quantidade'), ['valor', 'texto'], p.quantidade),
    sobra: umDe(proprio(b, 'sobra'), ['gorjeta', 'credito'], p.sobra),
    gratis: {
      caminhos: booleanos(proprio(g, 'caminhos'), p.gratis.caminhos),
      recompensas: listaDeTextos(proprio(g, 'recompensas'), 50, 100, p.gratis.recompensas),
      porPessoa: umDe(proprio(g, 'porPessoa'), ['live', 'vez'], p.gratis.porPessoa),
      soInscritos: simNao(proprio(g, 'soInscritos'), p.gratis.soInscritos),
      quantidade: inteiro(proprio(g, 'quantidade'), 1, 10, p.gratis.quantidade),
      // (as «Decisões finas» chamam de gratisEmDuvida: o nome solto também vale)
      emDuvida: umDe(proprio(g, 'emDuvida') !== undefined ? g.emDuvida : proprio(b, 'gratisEmDuvida'), ['revisar', 'fila'], p.gratis.emDuvida),
      manterNaProximaLive: simNao(proprio(g, 'manterNaProximaLive'), p.gratis.manterNaProximaLive),
    },
    entrarDireto: umDe(proprio(b, 'entrarDireto'), ['alta', 'media'], p.entrarDireto),
    itemEmDuvida: umDe(proprio(b, 'itemEmDuvida'), ['fila', 'revisar'], p.itemEmDuvida),
    pular: umDe(proprio(b, 'pular'), ['fica', 'sai'], p.pular),
    seguidas: simNao(proprio(b, 'seguidas'), p.seguidas),
    chamarProximoAoTerminar: simNao(proprio(b, 'chamarProximoAoTerminar'), p.chamarProximoAoTerminar),
    testeViraPedido: simNao(proprio(b, 'testeViraPedido'), p.testeViraPedido),
    robosPodem: simNao(proprio(b, 'robosPodem'), p.robosPodem),
    sinalizadaRevisar: simNao(proprio(b, 'sinalizadaRevisar'), p.sinalizadaRevisar),
    nomePix: umDe(proprio(b, 'nomePix'), ['primeiro', 'completo', 'anonimo'], p.nomePix),
    nomeNaTela: simNao(proprio(b, 'nomeNaTela'), p.nomeNaTela),
    valorNaTela: simNao(proprio(b, 'valorNaTela'), p.valorNaTela),
    idioma: umDe(idioma, IDIOMAS_NOMES, p.idioma),
    palavrasBloqueadas: listaDeTextos(proprio(b, 'palavrasBloqueadas'), 300, 60, p.palavrasBloqueadas),
    imagens: booleanos(img, p.imagens),
    avisoBehaviour: simNao(proprio(b, 'avisoBehaviour'), p.avisoBehaviour),
    fecharAbertosDepoisDeHoras: inteiro(proprio(b, 'fecharAbertosDepoisDeHoras'), 0, 168, p.fecharAbertosDepoisDeHoras),
    viewerVeValores: simNao(proprio(b, 'viewerVeValores'), p.viewerVeValores),
    fullVeValores: simNao(proprio(b, 'fullVeValores'), p.fullVeValores),
  };
}

// ── ✂️ Texto ────────────────────────────────────────────────────────────────
// controle, separadores de linha e marcadores de direção (viram truque na tela)
const RE_CONTROLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
function cortar(s, max) {
  if (s.length <= max) return s;
  let c = s.slice(0, max);
  const u = c.charCodeAt(c.length - 1);
  if (u >= 0xd800 && u <= 0xdbff) c = c.slice(0, -1); // não deixa meio emoji
  return c;
}
// uma linha limpa: corta ANTES de tudo (o custo não cresce com a entrada)
function limparLinha(v, max) {
  let s = v;
  if (typeof s === 'number' && Number.isFinite(s)) s = String(s);
  if (typeof s !== 'string') return '';
  return cortar(cortar(s, max * 4).replace(RE_CONTROLE, ' ').replace(/\s+/g, ' ').trim(), max).trim();
}
// 📱 telefone escrito nunca entra no pedido (8+ dígitos com espaço, ponto, traço, parênteses)
const RE_TELEFONE = /\+?\d[\d\s().-]{6,}\d/g;
function taparTelefones(t) {
  if (!/\d/.test(t)) return t;
  return t.replace(RE_TELEFONE, (m) => (m.replace(/\D/g, '').length >= 8 ? '📱' : m));
}
// para comparar nomes e palavras bloqueadas: minúsculas, sem acento, letra
// repetida 3+ vezes vira uma, pontuação vira espaço
function normalizarNome(s) {
  return String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/(\p{L})\1{2,}/gu, '$1').trim();
}
// nome bloqueado: palavra inteira, ou pedaço de um nome colado («XxPalavraxX»;
// só palavra de 4+ letras, senão «cu» acharia «Lucas»)
function nomeBloqueado(nome, bloqueadas) {
  if (!bloqueadas.length) return false;
  const n = normalizarNome(nome);
  if (!n) return false;
  const palavras = n.split(' ');
  const cercado = ` ${n} `;
  for (const b of bloqueadas) {
    if (b.includes(' ')) { if (cercado.includes(` ${b} `)) return true; continue; }
    if (palavras.includes(b)) return true;
    if (b.length >= 4 && palavras.some((p) => p.length > b.length && p.includes(b))) return true;
  }
  return false;
}
// nome civil do Pix do banco (muitas vezes em MAIÚSCULAS): primeiro nome com só a inicial maiúscula
function capitalizar(s) {
  return s.toLocaleLowerCase('pt-BR').replace(/(^|[\s'’-])(\p{L})/gu, (m, a, l) => a + l.toLocaleUpperCase('pt-BR'));
}
function nomeCivil(nome, modo) {
  if (modo === 'anonimo') return 'Anônimo';
  const limpo = String(nome).trim();
  if (modo === 'completo') return limpo === limpo.toLocaleUpperCase('pt-BR') && /\p{Lu}/u.test(limpo) ? capitalizar(limpo) : limpo;
  return capitalizar(limpo.split(/\s+/)[0] || limpo);
}

// 💰 «R$ 1.234,56» → 123456 (reserva quando não há o conversor do servidor)
function centavosDeReais(t) {
  const m = /R\$\s*([\d][\d.,\s]*)/.exec(String(t || ''));
  if (!m) return null;
  let s = m[1].replace(/\s/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const v = Number(s);
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) : null;
}
function formatarCentavos(c, moeda) {
  const v = Math.abs(Math.round(Number(c) || 0));
  const sinal = Number(c) < 0 ? '-' : '';
  const dec = String(v % 100).padStart(2, '0');
  if (!moeda || moeda === 'BRL') return `${sinal}R$ ${String(Math.floor(v / 100)).replace(/\B(?=(\d{3})+$)/g, '.')},${dec}`;
  return `${sinal}${moeda} ${Math.floor(v / 100)}.${dec}`;
}

// 📱 as mesmas regras do servidor, para quando ele não injeta as dele (testes)
function pareceTelefonePadrao(nome) {
  const t = String(nome || '').trim();
  if (!t) return false;
  if (t.replace(/\D/g, '').length < 8) return false;
  return /^[+()\-.\s\d]+$/.test(t);
}
function apelidoDeTelefonePadrao(nome) {
  const t = String(nome || '').trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return '📱 Convidado ' + h.toString(36).slice(-3).toUpperCase();
}

// ── 🔢 Ordem da fila ────────────────────────────────────────────────────────
// hora de chegada (ou a vez nova de quem foi intercalado); empate pelo nº
const ordemDe = (p) => (typeof p.vez === 'number' ? p.vez : p.chegada);
const compara = (a, b) => ordemDe(a) - ordemDe(b) || a.seq - b.seq;

// ── 🧱 O núcleo ─────────────────────────────────────────────────────────────
function criarPedidos(opcoes) {
  const o = ehObjeto(opcoes) ? opcoes : {};
  if (typeof o.baseDir !== 'string' || !o.baseDir.trim()) throw new TypeError('criarPedidos: falta a pasta base (data/pedidos)');
  const arquivo = path.join(o.baseDir, 'pedidos.json');
  const catalogos = o.catalogos && typeof o.catalogos === 'object' ? o.catalogos : null;
  const lerConfiguracao = typeof o.configuracao === 'function' ? o.configuracao : () => o.configuracao;
  const relogio = typeof o.agora === 'function' ? o.agora : Date.now;
  const aoMudar = typeof o.aoMudar === 'function' ? o.aoMudar : null;
  const apelidoDeTelefone = typeof o.apelidoDeTelefone === 'function' ? o.apelidoDeTelefone : apelidoDeTelefonePadrao;
  const pareceTelefone = typeof o.pareceTelefone === 'function' ? o.pareceTelefone : pareceTelefonePadrao;
  const converter = typeof o.converter === 'function' ? o.converter : null;
  const agora = () => { const t = Number(relogio()); return Number.isFinite(t) ? t : Date.now(); };

  let E = null;              // os dados (o que vai para o arquivo)
  let travado = null;        // null | 'ilegivel' (estragado) | 'preso' (outro programa segura o arquivo)
  let copia = null;          // a cópia do arquivo que não abriu
  let ultimaLeitura = 0;
  let timerGravar = null, timerRetentar = null, timerVivo = null;
  let pendente = false, gravacoes = 0, avisouGravacao = false;
  const toques = new Map();  // operação do controle externo → hora do último toque aceito
  let leitorCache = { cat: null, leitor: null };
  let confCache = { bruto: undefined, conf: null, der: null };
  const papeisPorCatalogo = new WeakMap();

  // ── ⚙️ configuração (o servidor troca o objeto inteiro a cada ajuste) ──
  function atualizarConf() {
    let b;
    try { b = lerConfiguracao(); } catch { b = undefined; }
    if (confCache.conf && b === confCache.bruto) return;
    const conf = sanitizarConfiguracao(b);
    confCache = {
      bruto: b,
      conf,
      der: {
        bloqueadas: conf.palavrasBloqueadas.map(normalizarNome).filter(Boolean),
        recompensas: new Set(conf.gratis.recompensas.map(normalizarNome).filter(Boolean)),
      },
    };
  }
  const cfg = () => { atualizarConf(); return confCache.conf; };
  const derivada = () => { atualizarConf(); return confCache.der; };

  // ── 🔐 chaves de pessoa: hash com sal guardado no arquivo (o número do
  // WhatsApp, que mora no id do autor, não dá para refazer a partir dela) ──
  const hash = (texto) => crypto.createHash('sha256').update(`${E.sal}|${texto}`, 'utf8').digest('hex').slice(0, 16);
  const hashesDoAutor = (plataforma, autor) => new Set((plataforma ? [plataforma] : PLATAFORMAS).map((pl) => hash(`${pl}|m:${autor}`)));

  // ── 💾 dados novos, gravação e leitura ──
  function dadosNovos(jogo) {
    return {
      versao: VERSAO, seq: 0, jogo: jogoValido(jogo) ? jogo : null, sal: crypto.randomBytes(16).toString('hex'), vivoEm: null,
      abertos: { pagos: false, gratis: false, intervalosPagos: [], gratisDesde: null },
      pedidos: [], aDevolver: [], vistos: new Set(), atendidos: [],
      creditos: new Map(), gratisNaLive: new Set(), registro: [],
    };
  }
  function serializar() {
    E.vivoEm = agora();
    return JSON.stringify({
      versao: VERSAO, seq: E.seq, jogo: E.jogo, sal: E.sal, vivoEm: E.vivoEm, abertos: E.abertos,
      pedidos: E.pedidos, aDevolver: E.aDevolver, vistos: [...E.vistos], atendidos: E.atendidos,
      creditos: [...E.creditos].map(([k, c]) => [k, c.centavos, c.em]), gratisNaLive: [...E.gratisNaLive], registro: E.registro,
    });
  }
  function gravarAgora() {
    if (timerGravar) { clearTimeout(timerGravar); timerGravar = null; }
    if (travado) return false; // arquivo que não abriu: nada grava por cima
    try {
      gravarAtomico(arquivo, serializar(), { privado: true });
      gravacoes++;
      pendente = false;
      avisouGravacao = false;
      return true;
    } catch (err) {
      pendente = true;
      if (!avisouGravacao) console.error('  ⚠️ 🙋 Pedidos: não consegui gravar a fila (tento de novo sozinho):', (err && (err.code || err.message)) || err);
      avisouGravacao = true;
      if (!timerRetentar) {
        timerRetentar = setTimeout(() => { timerRetentar = null; if (pendente) gravarAgora(); }, 2000);
        if (timerRetentar.unref) timerRetentar.unref();
      }
      return false;
    }
  }
  // pedidos vindos do chat: a primeira mudança marca a gravação e as próximas
  // pegam carona (uma rajada de 50 vira uma gravação, e nada espera mais que 300 ms)
  function agendarGravacao() {
    if (travado) return;
    pendente = true;
    if (timerGravar) return;
    timerGravar = setTimeout(() => { timerGravar = null; gravarAgora(); }, ATRASO_GRAVACAO_MS);
    if (timerGravar.unref) timerGravar.unref();
  }
  function guardarCopia() {
    const copiaNome = path.join(path.dirname(arquivo), `pedidos.ilegivel-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    try { fs.copyFileSync(arquivo, copiaNome); return semCopiaRepetida(copiaNome); } catch { return null; }
  }
  // abrir de novo com o mesmo arquivo estragado não empilha cópias iguais
  function semCopiaRepetida(nova) {
    if (!nova) return nova;
    try {
      const conteudo = fs.readFileSync(nova);
      const dir = path.dirname(arquivo);
      for (const f of fs.readdirSync(dir).sort()) {
        if (!/^pedidos\.ilegivel-.+\.json$/.test(f)) continue;
        const outra = path.join(dir, f);
        if (outra === nova || fs.statSync(outra).size !== conteudo.length) continue;
        if (fs.readFileSync(outra).equals(conteudo)) { fs.unlinkSync(nova); return outra; }
      }
    } catch { /* fica a nova */ }
    return nova;
  }
  function carregarArquivo() {
    try { limparTemporarios(arquivo); } catch { /* segue */ }
    ultimaLeitura = Date.now();
    const r = lerJsonSeguro(arquivo);
    if (r.ok) {
      const n = dadosDoArquivo(r.dados);
      if (n) {
        E = n.dados;
        travado = null;
        copia = null;
        if (n.descartados) {
          const c = guardarCopia();
          console.error(`  ⚠️ 🙋 Pedidos: ${n.descartados} entrada(s) estragada(s) do arquivo ficaram de fora.`);
          console.error(c ? `    O arquivo como estava ficou guardado em ${path.basename(c)}.` : '    E não consegui guardar uma cópia do arquivo como estava.');
          agendarGravacao();
        }
        fecharSeFicouParadoDemais();
        return;
      }
      // abre, mas não é a fila (ou foi gravado por uma versão mais nova): não grava por cima
      copia = guardarCopia();
      travado = 'ilegivel';
      E = dadosNovos(cfg().jogo);
      console.error('  ⚠️ 🙋 Pedidos: o arquivo da fila não tem o formato esperado; nada grava por cima até você escolher «começar do zero».');
      return;
    }
    if (r.faltando) { E = dadosNovos(cfg().jogo); travado = null; copia = null; return; }
    // erro de leitura vem com o código do sistema (EBUSY, EPERM…): preso, não estragado
    const preso = typeof r.erro === 'string' && /^E[A-Z]+$/.test(r.erro);
    if (travado !== (preso ? 'preso' : 'ilegivel')) {
      console.error(preso
        ? `  ⚠️ 🙋 Pedidos: o arquivo da fila está preso por outro programa (${r.erro}); tento de novo sozinho, sem gravar por cima.`
        : `  ⚠️ 🙋 Pedidos: o arquivo da fila não abre (${r.erro}); ${r.copia ? `a cópia ficou em ${path.basename(r.copia)}` : 'não consegui guardar uma cópia'} e nada grava por cima até você escolher «começar do zero».`);
    }
    travado = preso ? 'preso' : 'ilegivel';
    copia = semCopiaRepetida(r.copia) || copia;
    if (!E) E = dadosNovos(cfg().jogo);
  }
  // arquivo preso (antivírus, OneDrive) é lido de novo a cada segundo: não trava a live
  function pronto() {
    if (travado === 'preso' && Date.now() - ultimaLeitura >= 1000) {
      carregarArquivo();
      if (!travado) avisar('destravado');
    }
    return !travado;
  }

  // ── 🧹 o que vem do arquivo é conferido campo a campo ──
  const num = (v, padrao) => (typeof v === 'number' && Number.isFinite(v) ? v : padrao);
  const ehHash = (v) => typeof v === 'string' && /^[0-9a-f]{16}$/.test(v);
  function valorDoArquivo(v) {
    if (!ehObjeto(v)) return null;
    const moeda = typeof v.moeda === 'string' && /^[A-Z]{3}$/.test(v.moeda) ? v.moeda : null;
    const out = {
      centavos: typeof v.centavos === 'number' && Number.isFinite(v.centavos) ? Math.max(0, Math.round(v.centavos)) : null,
      moeda, original: limparLinha(v.original, 40), aproximado: v.aproximado === true,
    };
    if (typeof v.moedaOriginal === 'string' && /^[A-Z]{3}$/.test(v.moedaOriginal)) out.moedaOriginal = v.moedaOriginal;
    return out;
  }
  function itemDoArquivo(b) {
    if (!ehObjeto(b) || typeof b.id !== 'string' || !b.id || b.id.length > 100) return null;
    const it = {
      id: b.id, tipo: limparLinha(b.tipo, 30), nome: limparLinha(b.nome, 120) || b.id, trecho: limparLinha(b.trecho, 120),
      certeza: umDe(b.certeza, ['alta', 'media'], 'alta'), como: limparLinha(b.como, 20),
    };
    if (b.naoTenho === true) it.naoTenho = true;
    return it;
  }
  function opcaoDoArquivo(b) {
    if (!ehObjeto(b) || typeof b.id !== 'string' || !b.id || b.id.length > 100) return null;
    return { id: b.id, tipo: limparLinha(b.tipo, 30), nome: limparLinha(b.nome, 120) || b.id, certeza: Math.min(1, Math.max(0, num(b.certeza, 0.5))) };
  }
  const listaLimpa = (v, fn, max) => (Array.isArray(v) ? v.slice(0, max).map(fn).filter(Boolean) : []);
  function contatoDoArquivo(c) {
    if (!ehObjeto(c)) return null;
    const out = {};
    for (const k of ['tgChatId', 'tgMessageId', 'waChatId', 'waMessageId']) { const v = limparLinha(c[k], 120); if (v) out[k] = v; }
    return Object.keys(out).length ? out : null;
  }
  function pedidoDoArquivo(b, estados) {
    if (!ehObjeto(b)) return null;
    const seq = b.seq;
    if (!Number.isInteger(seq) || seq < 1 || seq > 1e12 || !estados.includes(b.estado)) return null;
    const or = ehObjeto(b.origem) ? b.origem : {};
    const q = ehObjeto(b.quem) ? b.quem : {};
    const pt = ehObjeto(b.partidas) ? b.partidas : {};
    const total = inteiro(pt.total, 0, TETOS.partidas, 0);
    const p = {
      id: 'p' + seq, seq, jogo: jogoValido(b.jogo) ? b.jogo : null, estado: b.estado,
      origem: {
        fonte: umDe(or.fonte, FONTES, 'manual'), plataforma: limparLinha(or.plataforma, 20) || 'manual',
        msgId: limparLinha(or.msgId, 200) || null, chave: limparLinha(or.chave, 260) || null,
        hora: num(or.hora, 0), atrasado: or.atrasado === true,
      },
      quem: {
        nome: taparTelefones(limparLinha(q.nome, TETOS.nome)) || 'Anônimo', chave: ehHash(q.chave) ? q.chave : '',
        hashes: (Array.isArray(q.hashes) ? q.hashes : []).filter(ehHash).slice(0, 3), contato: contatoDoArquivo(q.contato),
        telefone: q.telefone === true, civil: q.civil === true, sinalizada: q.sinalizada === true, liberado: q.liberado === true,
      },
      texto: taparTelefones(limparLinha(b.texto, TETOS.texto)), pago: b.pago === true, valor: valorDoArquivo(b.valor),
      partidas: { total, faltam: inteiro(pt.faltam, 0, total, total) },
      sobraCentavos: inteiro(b.sobraCentavos, 0, 1e11, 0),
      itens: listaLimpa(b.itens, itemDoArquivo, TETOS.itens),
      duvidas: listaLimpa(b.duvidas, (d) => (ehObjeto(d) ? { trecho: limparLinha(d.trecho, 120), motivo: limparLinha(d.motivo, 60), opcoes: listaLimpa(d.opcoes, opcaoDoArquivo, TETOS.opcoes) } : null), TETOS.duvidas),
      marcas: [...new Set((Array.isArray(b.marcas) ? b.marcas : []).filter((m) => MARCAS_VALIDAS.has(m)))],
      chegada: num(b.chegada, num(or.hora, 0)), teste: b.teste === true, daLiveAnterior: b.daLiveAnterior === true,
      vitorias: inteiro(b.vitorias, 0, 1e6, 0), derrotas: inteiro(b.derrotas, 0, 1e6, 0), jogadas: inteiro(b.jogadas, 0, 1e6, 0),
      criadoEm: num(b.criadoEm, num(b.chegada, 0)),
    };
    if (Number.isInteger(pt.pagas) && pt.pagas > total) p.partidas.pagas = Math.min(pt.pagas, 1e6);
    if (typeof b.vez === 'number' && Number.isFinite(b.vez)) p.vez = b.vez;
    for (const k of ['chamadoEm', 'partidaEm', 'atendidoEm', 'recusadoEm']) if (typeof b[k] === 'number' && Number.isFinite(b[k])) p[k] = b[k];
    if (typeof b.motivoRecusa === 'string') p.motivoRecusa = limparLinha(b.motivoRecusa, 30);
    if (Number.isInteger(b.creditoUsadoCentavos) && b.creditoUsadoCentavos > 0) p.creditoUsadoCentavos = b.creditoUsadoCentavos;
    if (ehObjeto(b.midia) && typeof b.midia.url === 'string' && b.midia.url.startsWith('/midia-inscritos/')) {
      p.midia = { tipo: limparLinha(b.midia.tipo, 20), url: limparLinha(b.midia.url, 300) };
    }
    if (ehObjeto(b.resgate)) p.resgate = { titulo: limparLinha(b.resgate.titulo, 100) };
    return p;
  }
  function dadosDoArquivo(d) {
    if (!ehObjeto(d) || typeof d.versao !== 'number' || d.versao > VERSAO || !Array.isArray(d.pedidos)) return null;
    let descartados = 0;
    const vistosSeq = new Set();
    const lista = (v, estados) => {
      const out = [];
      for (const b of Array.isArray(v) ? v : []) {
        const p = pedidoDoArquivo(b, estados);
        if (!p || vistosSeq.has(p.seq)) { descartados++; continue; } // nº repetido (mexido à mão): fica o primeiro
        vistosSeq.add(p.seq);
        out.push(p);
      }
      return out;
    };
    const dados = dadosNovos(jogoValido(d.jogo) ? d.jogo : cfg().jogo);
    if (typeof d.sal === 'string' && /^[0-9a-f]{32}$/.test(d.sal)) dados.sal = d.sal;
    dados.pedidos = lista(d.pedidos, ESTADOS_ATIVOS).sort(compara);
    let viuAgora = false; // só um «agora»
    for (const p of dados.pedidos) if (p.estado === 'agora') { if (viuAgora) p.estado = 'fila'; viuAgora = true; }
    dados.aDevolver = lista(d.aDevolver, ['recusado']);
    dados.atendidos = lista(d.atendidos, ['atendido']).slice(-TETOS.atendidos);
    let maior = 0;
    for (const s of vistosSeq) if (s > maior) maior = s;
    dados.seq = Math.max(maior, Number.isInteger(d.seq) && d.seq > 0 && d.seq <= 1e12 ? d.seq : 0);
    for (const k of (Array.isArray(d.vistos) ? d.vistos : []).slice(-TETOS.vistos)) if (typeof k === 'string' && k && k.length <= 300) dados.vistos.add(k);
    const a = ehObjeto(d.abertos) ? d.abertos : {};
    dados.abertos.pagos = a.pagos === true;
    dados.abertos.gratis = a.gratis === true;
    dados.abertos.gratisDesde = typeof a.gratisDesde === 'number' && Number.isFinite(a.gratisDesde) ? a.gratisDesde : null;
    for (const iv of (Array.isArray(a.intervalosPagos) ? a.intervalosPagos : []).slice(-TETOS.intervalos)) {
      if (!ehObjeto(iv) || typeof iv.de !== 'number' || !Number.isFinite(iv.de)) continue;
      const ate = typeof iv.ate === 'number' && Number.isFinite(iv.ate) && iv.ate >= iv.de ? iv.ate : null;
      dados.abertos.intervalosPagos.push({ de: iv.de, ate });
    }
    dados.vivoEm = typeof d.vivoEm === 'number' && Number.isFinite(d.vivoEm) ? d.vivoEm : null;
    // o interruptor e os intervalos andam juntos: só o último pode estar aberto
    const ivs = dados.abertos.intervalosPagos;
    const fechaEm = dados.vivoEm || agora();
    for (let i = 0; i < ivs.length - 1; i++) if (ivs[i].ate === null) ivs[i].ate = Math.max(ivs[i].de, Math.min(ivs[i + 1].de, fechaEm));
    const ultimo = ivs[ivs.length - 1];
    if (dados.abertos.pagos && (!ultimo || ultimo.ate !== null)) ivs.push({ de: fechaEm, ate: null });
    if (!dados.abertos.pagos && ultimo && ultimo.ate === null) ultimo.ate = Math.max(ultimo.de, fechaEm);
    if (dados.abertos.gratis && dados.abertos.gratisDesde === null) dados.abertos.gratisDesde = fechaEm;
    for (const c of (Array.isArray(d.creditos) ? d.creditos : []).slice(-TETOS.creditos)) {
      if (Array.isArray(c) && ehHash(c[0]) && Number.isInteger(c[1]) && c[1] > 0 && c[1] <= 1e11) dados.creditos.set(c[0], { centavos: c[1], em: num(c[2], 0) });
    }
    for (const k of (Array.isArray(d.gratisNaLive) ? d.gratisNaLive : []).slice(-TETOS.gratisNaLive)) if (ehHash(k)) dados.gratisNaLive.add(k);
    for (const r of (Array.isArray(d.registro) ? d.registro : []).slice(-TETOS.registro)) {
      if (!ehObjeto(r)) continue;
      dados.registro.push({
        hora: num(r.hora, 0), tipo: limparLinha(r.tipo, 30), motivo: limparLinha(r.motivo, 40) || null,
        n: Number.isInteger(r.n) ? r.n : null, nome: taparTelefones(limparLinha(r.nome, TETOS.nome)) || null, pago: r.pago === true,
      });
    }
    return { dados, descartados };
  }
  // Integração: o programa ficou fechado mais que N horas (0 = sempre) com
  // pagos/grátis abertos → fecha na hora da última atividade gravada. Pagamento
  // feito durante uma parada curta continua valendo pelo intervalo.
  function fecharSeFicouParadoDemais() {
    const A = E.abertos;
    if (!A.pagos && !A.gratis) return;
    const horas = cfg().fecharAbertosDepoisDeHoras;
    const t = agora();
    const vivo = E.vivoEm;
    if (horas !== 0 && !(typeof vivo === 'number' && t - vivo > horas * 3600 * 1000)) return;
    const quando = typeof vivo === 'number' ? Math.min(vivo, t) : t;
    fecharIntervalo(quando);
    A.pagos = false;
    A.gratis = false;
    registrar('fechadoAoAbrir', null, 'programaParado');
    agendarGravacao();
  }

  // ── 📝 registro (o que saiu sem virar pedido ou deixou a fila) ──
  function registrar(tipo, p, motivo) {
    E.registro.push({ hora: agora(), tipo, motivo: motivo || null, n: p && p.seq ? p.seq : null, nome: p && p.nome !== undefined ? p.nome : (p && p.quem ? p.quem.nome : null), pago: !!(p && p.pago) });
    if (E.registro.length > TETOS.registro) E.registro.splice(0, E.registro.length - TETOS.registro);
  }
  function avisar(motivo) {
    if (!aoMudar) return;
    try { aoMudar(motivo); } catch (err) { console.error('  ⚠️ 🙋 Pedidos: o aviso de mudança falhou:', (err && err.message) || err); }
  }
  function lembrar(k) {
    if (!k) return;
    E.vistos.delete(k);
    E.vistos.add(k);
    while (E.vistos.size > TETOS.vistos) E.vistos.delete(E.vistos.values().next().value);
  }
  const jaVisto = (e) => !!((e.chavePagamento && E.vistos.has(e.chavePagamento)) || (e.chaveMsg && E.vistos.has(e.chaveMsg)));

  // ── 📚 catálogo e leitor ──
  function catalogoDe(jogo) {
    if (!catalogos || !jogo || typeof catalogos.carregar !== 'function') return null;
    let c = null;
    try { c = catalogos.carregar(jogo); } catch { c = null; }
    return ehObjeto(c) && c.ok !== false && Array.isArray(c.itens) && ehObjeto(c.jogo) ? c : null;
  }
  function acharItem(jogo, id) {
    if (!catalogos || typeof catalogos.acharItem !== 'function' || typeof id !== 'string') return null;
    try { return catalogos.acharItem(jogo, id) || null; } catch { return null; }
  }
  // o índice é montado uma vez por catálogo: o catálogo novo (outro objeto) remonta
  function leitorAtual() {
    const cat = catalogoDe(E.jogo);
    if (!cat) return null;
    if (leitorCache.cat !== cat) {
      try { leitorCache = { cat, leitor: criarLeitor(cat, { idioma: 'pt' }) }; } catch (err) {
        console.error('  ⚠️ 🙋 Pedidos: não consegui montar o leitor do catálogo:', (err && err.message) || err);
        return null;
      }
    }
    return leitorCache.leitor;
  }
  const LEITURA_VAZIA = Object.freeze({ itens: [], duvidas: [], citaCatalogo: false, sobra: '', partidasPedidas: null, normalizado: '' });
  function ler(texto) {
    const l = texto ? leitorAtual() : null;
    if (!l) return LEITURA_VAZIA;
    try { return l.ler(texto); } catch (err) {
      console.error('  ⚠️ 🙋 Pedidos: o leitor falhou numa mensagem:', (err && err.message) || err);
      return LEITURA_VAZIA;
    }
  }
  // tipo → papel (personagem, perk, addon…) de cada catálogo, montado uma vez
  function papeis(cat) {
    let m = papeisPorCatalogo.get(cat);
    if (!m) {
      m = new Map((Array.isArray(cat.tipos) ? cat.tipos : []).filter(ehObjeto).map((t) => [t.id, t.papel]));
      papeisPorCatalogo.set(cat, m);
    }
    return m;
  }
  const papelDoTipo = (cat, tipo) => papeis(cat).get(tipo) || null;
  const temPapelPersonagem = (cat) => [...papeis(cat).values()].includes('personagem');

  // ── 📥 lerEntrada: a mensagem do servidor → um objeto NOVO, sem telefone ──
  function textoDaMensagem(m, plataforma) {
    const runs = Array.isArray(m.runs) ? m.runs : [];
    let s;
    // a PixGG acrescenta o link do vídeo pedido como outro pedaço: não é o pedido
    if (plataforma === 'pixgg') s = runs[0] && typeof runs[0].text === 'string' ? runs[0].text : '';
    else s = runs.slice(0, 300).map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('');
    if (!s && typeof m.text === 'string') s = m.text;
    return taparTelefones(limparLinha(s, TETOS.texto));
  }
  function fonteDe(m, plataforma) {
    if (plataforma === 'livepix' || plataforma === 'pixgg' || plataforma === 'pix') return plataforma;
    if (ehObjeto(m.superchat)) return 'superchat';
    if (ehObjeto(m.resgate)) return 'resgate';
    if (plataforma === 'telegram' || plataforma === 'whatsapp') return plataforma;
    return 'chat';
  }
  function ehInscrito(m, plataforma, badges) {
    const tier = typeof m.subTier === 'string' ? m.subTier : '';
    // Twitch: o «prime» sozinho vem do selo global, não é inscrição no canal
    if (plataforma === 'twitch') return badges.includes('sub') || tier === 'twitchFounder';
    if (plataforma === 'kick') return tier === 'kick' || tier === 'kickFounder' || badges.includes('sub') || badges.includes('founder');
    if (plataforma === 'youtube') return badges.includes('membro') || tier === 'member';
    return false;
  }
  const moedaValida = (v) => (typeof v === 'string' && /^[A-Za-z]{3}$/.test(v) ? v.toUpperCase() : null);
  const centavosValidos = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1e11;
  const exato = (centavos, original) => ({ valor: { centavos: Math.round(centavos), moeda: 'BRL', original, aproximado: false }, semCotacao: false });
  // moeda estrangeira: preço próprio na moeda, ou a cotação do dia CONGELADA aqui
  function estrangeira(valor, moeda, original, brl, conf) {
    if (Object.hasOwn(conf.precoPorMoeda, moeda)) return { valor: { centavos: Math.round(valor * 100), moeda, original, aproximado: false }, semCotacao: false };
    let b = brl;
    if (b === undefined && converter) {
      try { const c = converter(original); b = ehObjeto(c) ? c.brl : null; } catch { b = null; }
    }
    b = Number(b);
    if (Number.isFinite(b) && b > 0) return { valor: { centavos: Math.round(b * 100), moeda: 'BRL', original, aproximado: true, moedaOriginal: moeda }, semCotacao: false };
    return { valor: { centavos: Math.round(valor * 100), moeda, original, aproximado: false }, semCotacao: true };
  }
  function valorDoTexto(texto, conf) {
    if (!texto) return { valor: null, semCotacao: true };
    let c = null;
    if (converter) { try { c = converter(texto); } catch { c = null; } }
    if (ehObjeto(c)) {
      const moeda = moedaValida(c.moeda !== undefined ? c.moeda : c.currency);
      const v = Number(c.valor !== undefined ? c.valor : c.value);
      if (moeda && Number.isFinite(v) && v >= 0) {
        if (moeda === 'BRL') return exato(v * 100, texto);
        return estrangeira(v, moeda, texto, c.brl === undefined ? null : c.brl, conf);
      }
    }
    const reais = centavosDeReais(texto);
    if (reais !== null) return exato(reais, texto);
    return { valor: { centavos: null, moeda: null, original: texto, aproximado: false }, semCotacao: true };
  }
  function valorDe(m, fonte, conf) {
    const sc = ehObjeto(m.superchat) ? m.superchat : null;
    const texto = sc ? limparLinha(sc.amount, 40) : '';
    if (fonte === 'livepix') {
      const lp = ehObjeto(m.livepix) ? m.livepix : null;
      if (lp && centavosValidos(lp.centavos)) {
        const moeda = moedaValida(lp.moeda) || 'BRL';
        if (moeda === 'BRL') return exato(lp.centavos, texto);
        return estrangeira(lp.centavos / 100, moeda, texto || `${moeda} ${(lp.centavos / 100).toFixed(2)}`, undefined, conf);
      }
      return valorDoTexto(texto, conf);
    }
    if (fonte === 'pixgg' || fonte === 'pix') {
      // a PixGG já entrega em reais (o original estrangeiro só como texto)
      const b = ehObjeto(m[fonte]) ? m[fonte] : null;
      if (b && centavosValidos(b.centavos)) return exato(b.centavos, (fonte === 'pixgg' && limparLinha(b.original, 40)) || texto);
      return valorDoTexto(texto, conf);
    }
    if (fonte === 'superchat') return valorDoTexto(texto, conf);
    return { valor: null, semCotacao: false };
  }
  function chaveDePagamento(m, fonte, plataforma, msgId) {
    if (fonte === 'livepix') {
      const comp = ehObjeto(m.livepix) ? limparLinha(m.livepix.comprovante, 120) : '';
      return comp || msgId ? `livepix:${comp || msgId}` : null;
    }
    if (fonte === 'pixgg') {
      const tx = ehObjeto(m.pixgg) ? limparLinha(m.pixgg.transactionId, 80) : '';
      return tx || msgId ? `pixgg:${tx || msgId}` : null;
    }
    // Pix do banco: só o endToEndId é estável (o id «don-<agora>» muda a cada entrega)
    if (fonte === 'pix') { const e2e = ehObjeto(m.pix) ? limparLinha(m.pix.endToEndId, 120) : ''; return e2e ? `pix:${e2e}` : null; }
    if (fonte === 'superchat' && plataforma === 'youtube' && msgId) return `youtube:${msgId}`;
    return null;
  }
  function lerEntrada(message) {
    if (!ehObjeto(message)) return null;
    const conf = cfg();
    let plataforma = limparLinha(message.platform, 20).toLowerCase() || 'chat';
    if (plataforma === 'doacao') plataforma = 'pix'; // o nome antigo do Pix nos logs
    const msgId = limparLinha(message.id, 200);
    const badges = Array.isArray(message.badges) ? message.badges.slice(0, 60).filter((b) => typeof b === 'string') : [];
    const fonte = fonteDe(message, plataforma);
    const t = agora();
    let hora = Number(message.timestamp);
    if (!Number.isFinite(hora) || hora <= 0) hora = t;
    const atrasado = t - hora > ATRASADO_MS;
    if (hora > t) hora = t; // relógio da plataforma adiantado
    // quem: telefone vira o apelido; número no meio do nome também sai
    const nomeBruto = limparLinha(message.author, 200);
    let nome = cortar(nomeBruto, TETOS.nome).trim() || 'Anônimo';
    let telefone = false;
    if (pareceTelefone(nome) || pareceTelefone(nomeBruto)) {
      // o mesmo texto que o servidor usa: o apelido bate com o do chat
      nome = String(apelidoDeTelefone(typeof message.author === 'string' ? message.author : nomeBruto)).slice(0, TETOS.nome);
      telefone = true;
    } else {
      const tapado = taparTelefones(nome);
      if (tapado !== nome) { nome = tapado; telefone = true; }
    }
    const idAutor = limparLinha(message.authorId, 200) || limparLinha(message.authorLogin, 200);
    const chave = hash(`${plataforma}|${idAutor ? `id:${idAutor.toLowerCase()}` : `nome:${normalizarNome(nomeBruto)}`}`);
    // para a moderação achar o pedido pelo login, id ou nome (o mesmo critério do servidor)
    const hashes = [...new Set([message.authorLogin, message.authorId, message.author]
      .filter((v) => typeof v === 'string' && v).map((v) => hash(`${plataforma}|m:${v.slice(0, 200).toLowerCase()}`)))];
    let contato = null;
    let privado = false; // conversa direta com o robô/número (as mesmas regras dos conectores)
    if (plataforma === 'telegram' && temValor(message.tgChatId)) {
      contato = { tgChatId: limparLinha(String(message.tgChatId), 120), tgMessageId: limparLinha(String(message.tgMessageId ?? ''), 120) };
      privado = Number(message.tgChatId) > 0;
    } else if (plataforma === 'whatsapp' && temValor(message.waChatId)) {
      contato = { waChatId: limparLinha(String(message.waChatId), 120), waMessageId: limparLinha(String(message.waMessageId ?? ''), 120) };
      privado = !/@(g\.us|newsletter|broadcast)$/i.test(String(message.waChatId));
    }
    const pago = FONTES_PAGAS.has(fonte);
    const v = pago ? valorDe(message, fonte, conf) : { valor: null, semCotacao: false };
    const r = ehObjeto(message.resgate) ? message.resgate : null;
    const midia = ehObjeto(message.midia) && typeof message.midia.url === 'string' && message.midia.url.startsWith('/midia-inscritos/')
      ? { tipo: limparLinha(message.midia.tipo, 20), url: limparLinha(message.midia.url, 300) } : null;
    return {
      fonte, plataforma, msgId: msgId || null, chaveMsg: msgId ? `msg:${plataforma}:${msgId}` : null,
      chavePagamento: pago ? chaveDePagamento(message, fonte, plataforma, msgId) : null,
      hora, atrasado, pago, valor: v.valor, semCotacao: !!(pago && v.semCotacao),
      texto: textoDaMensagem(message, plataforma),
      quem: { nome, chave, hashes, contato, telefone, civil: plataforma === 'pix' },
      teste: msgId.startsWith('test-') || badges.includes('teste') || message.teste === true,
      historico: message.fromHistory === true, sinalizada: badges.includes('sinalizada'), robo: badges.includes('bot'), privado,
      inscrito: ehInscrito(message, plataforma, badges),
      resgate: r ? { id: limparLinha(r.id, 100) || null, titulo: limparLinha(r.titulo, 100) } : null,
      midia, reenviado: plataforma === 'pixgg' && ehObjeto(message.pixgg) && message.pixgg.forcado === true,
    };
  }

  // ── 🧮 regras ──
  function fonteLigada(e, conf) {
    if (e.fonte === 'superchat') return e.plataforma === 'bilibili' ? conf.fontesPagas.bilibili : conf.fontesPagas.superchat;
    return conf.fontesPagas[e.fonte] === true;
  }
  function pagosAbertosEm(hora) {
    for (const iv of E.abertos.intervalosPagos) if (hora >= iv.de && (iv.ate === null || hora <= iv.ate)) return true;
    return false;
  }
  function fecharIntervalo(quando) {
    const ivs = E.abertos.intervalosPagos;
    const u = ivs[ivs.length - 1];
    if (u && u.ate === null) u.ate = Math.max(u.de, quando);
  }
  const creditoDe = (chave) => { const c = E.creditos.get(chave); return c ? c.centavos : 0; };
  function guardarCredito(chave, centavos) {
    E.creditos.delete(chave);
    if (centavos > 0) E.creditos.set(chave, { centavos, em: agora() });
    while (E.creditos.size > TETOS.creditos) E.creditos.delete(E.creditos.keys().next().value);
  }
  // Quantidade = floor(centavos ÷ preço). Acima do máximo, o excedente fica no
  // pedido (partidas.pagas) e nunca vira gorjeta sozinho.
  function contarPartidas(e, conf, leitura) {
    const v = e.valor;
    const nada = { semCotacao: true, pagas: 0, partidas: 0, sobra: 0, creditoUsado: 0, acima: false };
    if (!v || e.semCotacao || typeof v.centavos !== 'number') return nada;
    const preco = v.moeda === 'BRL' ? conf.precoCentavos : (Object.hasOwn(conf.precoPorMoeda, v.moeda) ? conf.precoPorMoeda[v.moeda] : 0);
    if (!preco) return nada;
    const credito = conf.sobra === 'credito' && v.moeda === 'BRL' ? creditoDe(e.quem.chave) : 0;
    const total = v.centavos + credito;
    const pagas = Math.floor(total / preco);
    // «o que a pessoa escrever, até o pago»: sem número na frase, vale o pago
    const desejadas = conf.quantidade === 'texto' && leitura.partidasPedidas ? Math.min(pagas, leitura.partidasPedidas) : pagas;
    const acima = desejadas > conf.maximoPartidas;
    const partidas = Math.min(desejadas, conf.maximoPartidas);
    return { semCotacao: false, pagas: desejadas, partidas, sobra: total - desejadas * preco, creditoUsado: credito, acima };
  }
  // `leniente`: quem pagou ou escreveu direto para o robô/número — aí só o nome do
  // item («trapper», «o trapper») já é pedido; no chat aberto, não («TRAPPER!» é torcida)
  function parecePedido(leitura, leniente) {
    if (leitura.itens.length + leitura.duvidas.length >= 2) return true;
    if (leitura.partidasPedidas) return true;
    const sobra = leitura.sobra ? normalizarFrase(leitura.sobra) : '';
    const palavras = sobra ? sobra.split(' ') : [];
    if (leniente && palavras.every((p) => VAZIAS.has(p))) return true;
    if (palavras.some((p) => PALAVRAS_PEDIDO.has(p))) return true;
    const cercado = ` ${sobra} `;
    return EXPRESSOES_PEDIDO.some((x) => cercado.includes(` ${x} `));
  }
  // itens que entram direto e dúvidas (a certeza «média» vira dúvida com a opção «alta»)
  function separar(leitura, conf) {
    const itens = [];
    const duvidas = [];
    for (const it of leitura.itens.slice(0, TETOS.itens)) {
      const base = { id: it.id, tipo: it.tipo, nome: limparLinha(it.nome, 120) || it.id, trecho: limparLinha(it.trecho, 120), certeza: it.certeza === 'media' ? 'media' : 'alta', como: limparLinha(it.como, 20) };
      if (it.naoTenho) base.naoTenho = true;
      if (base.certeza === 'media' && conf.entrarDireto === 'alta') {
        duvidas.push({ trecho: base.trecho, motivo: it.como === 'som' ? 'som parecido' : 'erro de digitação', opcoes: [{ id: it.id, tipo: it.tipo, nome: base.nome, certeza: 0.5 }] });
      } else itens.push(base);
    }
    for (const d of leitura.duvidas.slice(0, TETOS.duvidas)) {
      duvidas.push({
        trecho: limparLinha(d.trecho, 120), motivo: limparLinha(d.motivo, 60),
        opcoes: (Array.isArray(d.opcoes) ? d.opcoes : []).slice(0, TETOS.opcoes).map((x) => ({ id: x.id, tipo: x.tipo, nome: limparLinha(x.nome, 120) || x.id, certeza: num(x.certeza, 0.5) })),
      });
    }
    return { itens, duvidas: duvidas.slice(0, TETOS.duvidas) };
  }
  // grátis «em dúvida»: nenhum personagem com certeza alta
  function temPersonagemCerto(itens) {
    const cat = catalogoDe(E.jogo);
    if (!cat) return false;
    const comPapel = temPapelPersonagem(cat);
    return itens.some((i) => i.certeza === 'alta' && (!comPapel || papelDoTipo(cat, i.tipo) === 'personagem'));
  }
  const ativosGratisDe = (chave) => E.pedidos.some((p) => !p.pago && p.quem.chave === chave);
  const nao = (motivo, extra) => Object.assign({ virou: false, motivo }, extra);
  const revisarPor = (marcas, conf) => marcas.some((m) => {
    if (m === 'sinalizada') return conf.sinalizadaRevisar;
    if (m === 'gratisEmDuvida' || m === 'semItem') return conf.gratis.emDuvida === 'revisar';
    return ['pagosFechados', 'abaixoDoPreco', 'semMensagem', 'naoPareceEmPedido', 'acimaDoMaximo', 'cheio', 'moedaSemCotacao', 'itemEmDuvida'].includes(m);
  });

  // Pago. `forcado` = o streamer mandou virar pedido (as regras viram marcas).
  function decidirPago(e, conf, forcado) {
    if (!forcado && !fonteLigada(e, conf)) return nao('fonteDesligada');
    const leitura = ler(e.texto);
    const aberto = pagosAbertosEm(e.hora);
    const q = contarPartidas(e, conf, leitura);
    const marcas = [];
    if (!leitura.citaCatalogo && !forcado) {
      if (e.texto) return nao('apoio'); // apoio comum: não vira pedido
      // sem mensagem: só com os pagos abertos e alcançando uma partida
      if (!aberto || q.semCotacao || q.pagas < 1) return nao('apoio');
      marcas.push('semMensagem');
    }
    if (!aberto) marcas.push('pagosFechados');
    if (e.texto && leitura.citaCatalogo && !parecePedido(leitura, true)) marcas.push('naoPareceEmPedido');
    if (q.semCotacao) marcas.push('moedaSemCotacao');
    else if (q.pagas < 1) marcas.push('abaixoDoPreco');
    if (q.acima) marcas.push('acimaDoMaximo');
    if (e.sinalizada) marcas.push('sinalizada');
    const { itens, duvidas } = separar(leitura, conf);
    if (duvidas.length && conf.itemEmDuvida === 'revisar') marcas.push('itemEmDuvida');
    if (E.pedidos.length >= TETOS.ativos) marcas.push('cheio');
    if (e.valor && e.valor.aproximado) marcas.push('valorConvertido');
    if (q.creditoUsado) marcas.push('creditoUsado');
    if (e.reenviado) marcas.push('reenviado');
    const vaiRevisar = forcado ? marcas.includes('cheio') : revisarPor(marcas, conf);
    return {
      virou: true, estado: vaiRevisar ? 'revisar' : 'fila', partidas: forcado ? Math.max(1, q.partidas) : q.partidas,
      pagas: q.pagas, sobra: q.semCotacao ? 0 : Math.max(0, q.sobra), creditoUsado: q.creditoUsado,
      novoCredito: !vaiRevisar && conf.sobra === 'credito' && e.valor && e.valor.moeda === 'BRL' ? Math.max(0, q.sobra) : null,
      itens, duvidas, marcas,
    };
  }
  // Grátis: interruptor, hora, caminho, robô, inscritos, recompensa, um por pessoa
  function decidirGratis(e, conf, forcado) {
    const g = conf.gratis;
    const marcas = [];
    if (!forcado) {
      if (!E.abertos.gratis) return nao('gratisFechados');
      if (e.historico) return nao('historico');
      if (E.abertos.gratisDesde === null || e.hora < E.abertos.gratisDesde) return nao('antiga');
      if (!Object.hasOwn(g.caminhos, e.fonte) || !g.caminhos[e.fonte]) return nao('caminhoDesligado');
      if (e.robo && !conf.robosPodem) return nao('robo');
      if (g.soInscritos && !e.inscrito) return nao('soInscritos');
      if (e.fonte === 'resgate') {
        if (!e.texto) return nao('semTexto');
        if (g.recompensas.length && !recompensaAceita(e.resgate)) return nao('recompensa');
      }
    }
    const leitura = ler(e.texto);
    if (!leitura.citaCatalogo) {
      // resgate de uma recompensa dos pedidos sem item reconhecido: o streamer decide
      if (!forcado && !(e.fonte === 'resgate' && g.recompensas.length)) return nao('naoCita');
      if (!forcado || e.texto) marcas.push('semItem');
    } else if (!forcado && e.fonte !== 'resgate' && !parecePedido(leitura, e.privado)) return nao('naoPedido');
    if (!forcado) {
      if (g.porPessoa === 'live' && E.gratisNaLive.has(e.quem.chave)) return nao('umPorPessoa');
      if (g.porPessoa === 'vez' && ativosGratisDe(e.quem.chave)) return nao('umPorPessoa');
    }
    if (E.pedidos.length >= TETOS.ativos) return nao('cheio', { registrar: true }); // grátis com a fila cheia: recusado com registro
    const { itens, duvidas } = separar(leitura, conf);
    if (leitura.citaCatalogo && !temPersonagemCerto(itens)) marcas.push('gratisEmDuvida');
    if (duvidas.length && conf.itemEmDuvida === 'revisar') marcas.push('itemEmDuvida');
    if (e.sinalizada) marcas.push('sinalizada');
    const vaiRevisar = !forcado && revisarPor(marcas, conf);
    const partidas = Math.max(1, Math.min(leitura.partidasPedidas || 1, g.quantidade));
    return { virou: true, estado: vaiRevisar ? 'revisar' : 'fila', partidas, pagas: partidas, sobra: 0, creditoUsado: 0, novoCredito: null, itens, duvidas, marcas };
  }
  function recompensaAceita(r) {
    if (!r) return false;
    const der = derivada();
    return (r.id && der.recompensas.has(normalizarNome(r.id))) || (r.titulo && der.recompensas.has(normalizarNome(r.titulo)));
  }

  // ── ➕ criar ──
  function inserir(p) {
    const l = E.pedidos;
    let lo = 0, hi = l.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (compara(l[m], p) <= 0) lo = m + 1; else hi = m; }
    l.splice(lo, 0, p);
  }
  function tirar(p) {
    const i = E.pedidos.indexOf(p);
    if (i >= 0) E.pedidos.splice(i, 1);
  }
  function criarPedido(e, d) {
    const seq = ++E.seq;
    const t = agora();
    const marcas = [...new Set(d.marcas)];
    if (e.atrasado && !marcas.includes('atrasado')) marcas.push('atrasado');
    if (d.itens.some((i) => i.naoTenho)) marcas.push('naoTenho');
    const p = {
      id: 'p' + seq, seq, jogo: E.jogo, estado: d.estado,
      origem: { fonte: e.fonte, plataforma: e.plataforma, msgId: e.msgId, chave: e.chavePagamento || null, hora: e.hora, atrasado: e.atrasado },
      quem: { nome: e.quem.nome, chave: e.quem.chave, hashes: e.quem.hashes, contato: e.quem.contato, telefone: e.quem.telefone, civil: e.quem.civil, sinalizada: !!e.sinalizada, liberado: false },
      texto: e.texto, pago: e.pago, valor: e.valor ? { ...e.valor } : null,
      partidas: { total: d.partidas, faltam: d.partidas }, sobraCentavos: d.sobra || 0,
      itens: d.itens, duvidas: d.duvidas, marcas,
      chegada: Math.min(e.hora, t), teste: !!e.teste, daLiveAnterior: false,
      vitorias: 0, derrotas: 0, jogadas: 0, criadoEm: t,
    };
    if (d.pagas > d.partidas) p.partidas.pagas = d.pagas;
    if (d.creditoUsado) { p.creditoUsadoCentavos = d.creditoUsado; guardarCredito(e.quem.chave, 0); }
    if (d.novoCredito !== null && d.novoCredito !== undefined) guardarCredito(e.quem.chave, d.novoCredito);
    if (e.midia) p.midia = e.midia;
    if (e.resgate) p.resgate = { titulo: e.resgate.titulo };
    inserir(p);
    lembrar(e.chaveMsg);
    lembrar(e.chavePagamento);
    if (!e.pago && e.fonte !== 'manual') {
      E.gratisNaLive.add(e.quem.chave);
      while (E.gratisNaLive.size > TETOS.gratisNaLive) E.gratisNaLive.delete(E.gratisNaLive.values().next().value);
    }
    return p;
  }

  // ── 👀 observar: cada mensagem do onChatMessage ──
  function observar(message) {
    if (!pronto()) return nao('travado');
    const e = lerEntrada(message);
    if (!e) return nao('invalida');
    const conf = cfg();
    if (e.teste && !conf.testeViraPedido) return nao('teste');
    if (jaVisto(e)) return nao('repetido');
    const d = e.pago ? decidirPago(e, conf, false) : decidirGratis(e, conf, false);
    if (!d.virou) {
      if (d.registrar) { registrar('recusado', { nome: e.quem.nome, pago: e.pago }, d.motivo); agendarGravacao(); }
      return nao(d.motivo);
    }
    const p = criarPedido(e, d);
    agendarGravacao();
    avisar('novo');
    return { virou: true, id: p.id, n: p.seq, estado: p.estado, marcas: p.marcas.slice(), pedido: projetarLocal(p) };
  }

  // ── 🎛️ operações do streamer (gravam na hora) ──
  const erro = (codigo, motivo, extra) => Object.assign({ ok: false, erro: codigo, motivo }, extra);
  const erroTravado = () => (travado === 'preso'
    ? erro('preso', 'O arquivo dos pedidos está preso por outro programa: espere ele soltar.')
    : erro('travado', 'O arquivo dos pedidos não abre: nada é gravado até você escolher «começar do zero».'));
  const naoAchou = () => erro('pedido-inexistente', 'Esse pedido não está mais na lista.');
  function refPedido(ref) {
    if (typeof ref === 'number' && Number.isInteger(ref) && ref > 0) return ref;
    if (typeof ref === 'string') {
      const s = ref.trim().slice(0, 40);
      if (/^\d{1,12}$/.test(s)) return Number(s);
      if (/^p\d{1,12}$/.test(s)) return Number(s.slice(1));
    }
    return null;
  }
  function acharPedido(ref, listas) {
    const seq = refPedido(ref);
    if (!seq) return null;
    for (const l of listas || [E.pedidos]) for (const p of l) if (p.seq === seq) return p;
    return null;
  }
  const pedidoAgora = () => E.pedidos.find((p) => p.estado === 'agora') || null;
  function feito(motivo, extra) {
    gravarAgora();
    avisar(motivo);
    return Object.assign({ ok: true }, extra);
  }

  function abrir(tipo, sim) {
    if (!pronto()) return erroTravado();
    if (tipo !== 'pagos' && tipo !== 'gratis') return erro('tipo-invalido', 'Escolha pagos ou grátis.');
    const A = E.abertos;
    let ligar;
    if (!temValor(sim)) ligar = !A[tipo]; // sem valor: alterna
    else if (sim === true || sim === 1 || sim === '1' || sim === 'true' || sim === 'sim') ligar = true;
    else if (sim === false || sim === 0 || sim === '0' || sim === 'false' || sim === 'nao' || sim === 'não') ligar = false;
    else return erro('valor-invalido', 'Use 1 para abrir e 0 para fechar.');
    const comoFicou = () => ({ abertos: { pagos: A.pagos, gratis: A.gratis } });
    if (A[tipo] === ligar) return Object.assign({ ok: true, mudou: false }, comoFicou());
    const t = agora();
    if (tipo === 'pagos') {
      if (ligar) {
        A.intervalosPagos.push({ de: t, ate: null });
        if (A.intervalosPagos.length > TETOS.intervalos) A.intervalosPagos.splice(0, A.intervalosPagos.length - TETOS.intervalos);
      } else fecharIntervalo(t);
      A.pagos = ligar;
    } else {
      A.gratis = ligar;
      if (ligar) A.gratisDesde = t; // o que foi escrito antes disso não vale
    }
    return feito('abrir', Object.assign({ mudou: true }, comoFicou()));
  }

  // chama o mais antigo da fila (nunca pula por item em dúvida); o «agora» com
  // partidas faltando volta para o mesmo lugar e o próximo é OUTRO
  function chamarProximo() {
    const atual = pedidoAgora();
    const prox = E.pedidos.find((p) => p.estado === 'fila' && p !== atual);
    if (!prox) return null;
    if (atual) atual.estado = 'fila';
    prox.estado = 'agora';
    prox.chamadoEm = agora();
    return prox;
  }
  function proximo() {
    if (!pronto()) return erroTravado();
    const p = chamarProximo();
    if (!p) return erro('fila-vazia', 'Não há ninguém esperando na fila.');
    return feito('proximo', { pedido: projetarLocal(p) });
  }

  function partida(dados) {
    if (!pronto()) return erroTravado();
    const d = ehObjeto(dados) ? dados : {};
    let resultado = 'jogada';
    if (temValor(d.resultado)) {
      const r = normalizarNome(String(d.resultado)).replace(/ /g, '');
      resultado = r === 'vitoria' || r === 'win' ? 'vitoria' : r === 'derrota' || r === 'loss' ? 'derrota' : r === 'jogada' || r === 'partida' ? 'jogada' : null;
      if (!resultado) return erro('resultado-invalido', 'Resultado: vitória, derrota ou jogada.');
    }
    const p = pedidoAgora();
    if (!p) return erro('sem-pedido-agora', 'Nenhum pedido sendo jogado agora.');
    // o toque leva o nº do pedido e quantas faltavam: toque velho (repetido,
    // reconexão) não baixa outra partida
    const nOk = !temValor(d.n) || Number(d.n) === p.seq;
    const fOk = !temValor(d.faltavam) || Number(d.faltavam) === p.partidas.faltam;
    if (!nOk || !fOk) return erro('desatualizado', 'O pedido mudou antes do toque: confira e toque de novo.', { desatualizado: true, n: p.seq, faltam: p.partidas.faltam });
    const conf = cfg();
    p.partidas.faltam = Math.max(0, p.partidas.faltam - 1);
    if (resultado === 'vitoria') p.vitorias++;
    else if (resultado === 'derrota') p.derrotas++;
    else p.jogadas++;
    p.partidaEm = agora();
    let terminou = false;
    let chamado = null;
    if (p.partidas.faltam === 0) {
      terminou = true;
      tirar(p);
      p.estado = 'atendido';
      p.atendidoEm = agora();
      E.atendidos.push(p);
      if (E.atendidos.length > TETOS.atendidos) E.atendidos.splice(0, E.atendidos.length - TETOS.atendidos);
    } else if (!conf.seguidas) {
      // intercalar: volta para o fim da fila e o «agora» fica vazio
      tirar(p);
      p.estado = 'fila';
      let fim = agora(); // a vez nova fica depois de todo mundo que já está na fila
      for (const x of E.pedidos) fim = Math.max(fim, ordemDe(x) + 1);
      p.vez = fim;
      if (!p.marcas.includes('intercalado')) p.marcas.push('intercalado');
      inserir(p);
    }
    if (!pedidoAgora() && conf.chamarProximoAoTerminar) chamado = chamarProximo();
    return feito('partida', { pedido: projetarLocal(p), terminou, proximo: chamado ? projetarLocal(chamado) : null });
  }

  function sair(p, motivo) {
    tirar(p);
    p.estado = 'recusado';
    p.recusadoEm = agora();
    p.motivoRecusa = motivo;
    if (p.pago) {
      // o crédito usado volta para a pessoa; o pagamento vai para «a devolver»
      if (p.creditoUsadoCentavos && p.quem.chave) guardarCredito(p.quem.chave, creditoDe(p.quem.chave) + p.creditoUsadoCentavos);
      E.aDevolver.push(p);
    } else registrar('recusado', p, motivo);
  }
  function pular(ref) {
    if (!pronto()) return erroTravado();
    const p = acharPedido(ref);
    if (!p) return naoAchou();
    if (p.estado !== 'fila' && p.estado !== 'agora') return erro('estado-invalido', 'Só dá para pular quem está na fila ou jogando agora.');
    if (cfg().pular === 'sai') sair(p, 'pulado'); // sai da fila: pago → a devolver
    else p.estado = 'pulado'; // fica no lugar; o ⏩ Próximo passa por cima
    return feito('pular', { pedido: projetarLocal(p) });
  }
  function retomar(ref) {
    if (!pronto()) return erroTravado();
    const p = acharPedido(ref);
    if (!p) return naoAchou();
    if (p.estado !== 'pulado') return erro('estado-invalido', 'Esse pedido não está pulado.');
    p.estado = 'fila'; // pela hora de chegada: continua no mesmo lugar
    return feito('retomar', { pedido: projetarLocal(p) });
  }
  function recusar(ref) {
    if (!pronto()) return erroTravado();
    const p = acharPedido(ref);
    if (!p) return naoAchou();
    sair(p, 'recusado');
    return feito('recusar', { pedido: projetarLocal(p), aDevolver: p.pago });
  }
  // ⚠ Revisar: «era só apoio» (pago que citou o catálogo sem ser pedido) sai
  // sem ir para «a devolver»; fica no registro
  function ignorar(ref) {
    if (!pronto()) return erroTravado();
    const p = acharPedido(ref);
    if (!p) return naoAchou();
    if (p.estado !== 'revisar') return erro('estado-invalido', 'Só dá para ignorar o que está no ⚠ Revisar.');
    tirar(p);
    if (p.creditoUsadoCentavos && p.quem.chave) guardarCredito(p.quem.chave, creditoDe(p.quem.chave) + p.creditoUsadoCentavos);
    registrar('ignorado', p, 'apoio');
    return feito('ignorar', { n: p.seq });
  }
  function devolvido(ref) {
    if (!pronto()) return erroTravado();
    const p = acharPedido(ref, [E.aDevolver]);
    if (!p) return erro('pedido-inexistente', 'Esse pedido não está na lista «a devolver».');
    E.aDevolver.splice(E.aDevolver.indexOf(p), 1);
    registrar('devolvido', p, p.motivoRecusa || 'recusado');
    return feito('devolvido', { n: p.seq });
  }
  function liberarNome(ref) {
    if (!pronto()) return erroTravado();
    const p = acharPedido(ref, [E.pedidos, E.atendidos, E.aDevolver]);
    if (!p) return naoAchou();
    if (p.quem.liberado) return { ok: true, mudou: false };
    p.quem.liberado = true;
    return feito('liberarNome', { pedido: projetarLocal(p) });
  }

  // ✔ confirmar (Revisar → fila; o trecho confirmado vira apelido «seu») e ✏ corrigir
  function itensDoStreamer(p, brutos) {
    if (!Array.isArray(brutos) || brutos.length > TETOS.itens) return { erro: erro('itens-invalidos', 'Mande a lista de itens do pedido (até 30).') };
    if (brutos.length && !catalogoDe(p.jogo)) return { erro: erro('catalogo-indisponivel', 'O catálogo deste jogo não está disponível.') };
    const out = [];
    const vistos = new Set();
    for (const x of brutos) {
      const id = typeof x === 'string' ? x : (ehObjeto(x) && typeof x.id === 'string' ? x.id : null);
      if (!id || id.length > 100) return { erro: erro('itens-invalidos', 'Mande a lista de itens do pedido (até 30).') };
      const item = acharItem(p.jogo, id);
      if (!item) return { erro: erro('item-inexistente', 'Um dos itens não existe no catálogo.') };
      if (vistos.has(id)) continue;
      vistos.add(id);
      const dado = ehObjeto(x) ? taparTelefones(limparLinha(x.trecho, 60)) : '';
      const it = { id, tipo: item.tipo, nome: nomeParaMostrar(item, 'pt'), trecho: dado || trechoVisto(p, id) || '', certeza: 'alta', como: 'confirmado' };
      if (item.naoTenho) it.naoTenho = true;
      out.push({ it, ensinar: dado || trechoParaEnsinar(p, id) });
    }
    return { itens: out };
  }
  function trechoVisto(p, id) {
    const it = p.itens.find((i) => i.id === id);
    if (it) return it.trecho;
    const d = p.duvidas.find((x) => x.opcoes.some((o) => o.id === id));
    return d ? d.trecho : '';
  }
  // só o que o streamer resolveu vira apelido: dúvida (menos a cor do add-on,
  // que depende do killer) e certeza média; o que já casou com certeza fica
  function trechoParaEnsinar(p, id) {
    const d = p.duvidas.find((x) => x.motivo !== 'cor da raridade' && x.opcoes.some((o) => o.id === id));
    if (d) return d.trecho;
    const it = p.itens.find((i) => i.id === id && i.certeza === 'media');
    return it ? it.trecho : '';
  }
  function resolver(ref, brutos, extra, ensinar) {
    if (!pronto()) return erroTravado();
    const p = acharPedido(ref);
    if (!p) return naoAchou();
    const r = itensDoStreamer(p, brutos);
    if (r.erro) return r.erro;
    const novoTotal = ehObjeto(extra) && temValor(extra.partidas) ? inteiro(extra.partidas, 1, TETOS.partidas, null) : null;
    if (ehObjeto(extra) && temValor(extra.partidas) && novoTotal === null) return erro('partidas-invalidas', 'Partidas: um número de 1 a 99.');
    const ensinados = [];
    if (ensinar && catalogos && typeof catalogos.ensinarApelido === 'function') {
      for (const { it, ensinar: trecho } of r.itens) {
        if (!trecho || !normalizarNome(trecho)) continue;
        try {
          const res = catalogos.ensinarApelido(p.jogo, it.id, trecho);
          if (res && res.ok && res.novo) ensinados.push({ id: it.id, apelido: trecho });
        } catch { /* apelido que não entra não atrapalha a confirmação */ }
      }
    }
    p.itens = r.itens.map((x) => x.it);
    p.duvidas = [];
    p.marcas = p.marcas.filter((m) => m !== 'naoTenho');
    if (p.itens.some((i) => i.naoTenho)) p.marcas.push('naoTenho');
    if (ensinar && p.estado === 'revisar') p.estado = 'fila';
    const feitas = p.partidas.total - p.partidas.faltam;
    if (novoTotal !== null) {
      const total = Math.max(novoTotal, feitas + 1);
      p.partidas.total = total;
      p.partidas.faltam = total - feitas;
    } else if (p.partidas.faltam < 1) {
      // valor curto, sem cotação…: aceito pelo streamer, joga ao menos uma
      p.partidas.total = feitas + 1;
      p.partidas.faltam = 1;
    }
    return feito(ensinar ? 'confirmar' : 'corrigir', { pedido: projetarLocal(p), ensinados });
  }
  const confirmar = (ref, itens, extra) => resolver(ref, itens, extra, true);
  const corrigir = (ref, itens, extra) => resolver(ref, itens, extra, false);

  // ＋ pedido à mão (o streamer digita)
  function novo(dados) {
    if (!pronto()) return erroTravado();
    const d = ehObjeto(dados) ? dados : {};
    if (E.pedidos.length >= TETOS.ativos) return erro('cheio', 'A fila chegou ao teto de 2000 pedidos.');
    const texto = taparTelefones(limparLinha(d.texto, TETOS.texto));
    const bruto = limparLinha(typeof d.quem === 'string' ? d.quem : proprio(d.quem, 'nome'), 200);
    let nome = cortar(bruto, TETOS.nome).trim();
    let telefone = false;
    if (nome && pareceTelefone(nome)) { nome = String(apelidoDeTelefone(nome)).slice(0, TETOS.nome); telefone = true; } else {
      const tapado = taparTelefones(nome);
      if (tapado !== nome) { nome = tapado; telefone = true; }
    }
    const partidas = temValor(d.partidas) ? inteiro(d.partidas, 1, TETOS.partidas, null) : 1;
    if (partidas === null) return erro('partidas-invalidas', 'Partidas: um número de 1 a 99.');
    const conf = cfg();
    const { itens, duvidas } = separar(ler(texto), conf);
    const t = agora();
    const e = {
      fonte: 'manual', plataforma: 'manual', msgId: null, chaveMsg: null, chavePagamento: null, hora: t, atrasado: false,
      pago: false, valor: null, semCotacao: false, texto,
      quem: { nome, chave: hash(`manual|nome:${normalizarNome(bruto)}`), hashes: [], contato: null, telefone, civil: false },
      teste: false, sinalizada: false,
    };
    const p = criarPedido(e, { estado: 'fila', partidas, pagas: partidas, sobra: 0, creditoUsado: 0, novoCredito: null, itens, duvidas, marcas: ['manual'] });
    return feito('novo', { pedido: projetarLocal(p) });
  }

  // ➕ comentário → pedido (o servidor acha a mensagem que ELE guardou)
  function acharPorOrigem(e) {
    for (const l of [E.pedidos, E.atendidos, E.aDevolver]) {
      for (const p of l) {
        if (e.chavePagamento && p.origem.chave === e.chavePagamento) return p;
        if (e.msgId && p.origem.msgId === e.msgId && p.origem.plataforma === e.plataforma) return p;
      }
    }
    return null;
  }
  function virar(message) {
    if (!pronto()) return erroTravado();
    const e = lerEntrada(message);
    if (!e) return erro('mensagem-invalida', 'Não achei essa mensagem.');
    const ja = acharPorOrigem(e);
    if (ja || jaVisto(e)) return erro('ja-e-pedido', 'Essa mensagem já virou pedido.', { n: ja ? ja.seq : null });
    const conf = cfg();
    const d = e.pago ? decidirPago(e, conf, true) : decidirGratis(e, conf, true);
    if (!d.virou) return d.motivo === 'cheio' ? erro('cheio', 'A fila chegou ao teto de 2000 pedidos.') : erro('nao-virou', 'Essa mensagem não pode virar pedido.');
    d.marcas.push('virado');
    const p = criarPedido(e, d);
    return feito('novo', { pedido: projetarLocal(p) });
  }

  function escolherJogo(jogoId) {
    if (!pronto()) return erroTravado();
    if (!jogoValido(jogoId)) return erro('jogo-inexistente', 'Esse jogo não existe nos catálogos.');
    let c = null;
    try { c = catalogos && typeof catalogos.carregar === 'function' ? catalogos.carregar(jogoId) : null; } catch { c = null; }
    if (!c) return erro('jogo-inexistente', 'Esse jogo não existe nos catálogos.');
    if (c.ok === false) return erro('catalogo-ilegivel', 'O catálogo desse jogo não abre: confira na página dos Pedidos.');
    if (E.jogo === jogoId) return { ok: true, jogo: jogoId, mudou: false };
    E.jogo = jogoId;
    return feito('jogo', { jogo: jogoId, mudou: true });
  }

  // 🏁 fim da live: os pagos ficam (da live anterior, pela hora); os grátis
  // conforme a opção; o «um por live» zera
  function fimDaLive() {
    if (!pronto()) return erroTravado();
    const conf = cfg();
    let ficaram = 0, sairam = 0;
    for (const p of E.pedidos.slice()) {
      if (p.estado === 'agora') p.estado = 'fila';
      if (!p.pago && !conf.gratis.manterNaProximaLive) {
        tirar(p);
        registrar('saiu', p, 'fimDaLive');
        sairam++;
        continue;
      }
      p.daLiveAnterior = true;
      ficaram++;
    }
    E.gratisNaLive.clear();
    return feito('fimDaLive', { ficaram, sairam });
  }

  // 🧪 testes saem de todas as listas
  function tirarTestes(filtro) {
    let removidos = 0;
    const limpa = (l) => { for (let i = l.length - 1; i >= 0; i--) if (l[i].teste && filtro(l[i])) { l.splice(i, 1); removidos++; } };
    limpa(E.pedidos);
    limpa(E.aDevolver);
    limpa(E.atendidos);
    if (!removidos) return { ok: true, removidos: 0 };
    return feito('limparTestes', { removidos });
  }
  function limparTestes() {
    if (!pronto()) return erroTravado();
    return tirarTestes(() => true);
  }
  // 🛡️ aviso de remoção do chat: limpeza geral nunca tira pedido; mensagem
  // apagada ou autor banido ganha a marca (pago nunca é recusado sozinho);
  // a limpeza dos 🧪 leva só os pedidos de teste
  function remocao(dados) {
    if (!pronto()) return erroTravado();
    const d = ehObjeto(dados) ? dados : {};
    const plataforma = typeof d.platform === 'string' && d.platform ? d.platform.slice(0, 20) : null;
    if (d.teste === true) return tirarTestes((p) => !plataforma || p.origem.plataforma === plataforma);
    if (d.tudo === true) return { ok: true, marcados: 0 };
    const alvos = new Set((Array.isArray(d.ids) ? d.ids : []).slice(0, 5000).map((x) => String(x).slice(0, 200)));
    const autores = typeof d.autor === 'string' && d.autor ? hashesDoAutor(plataforma, d.autor.slice(0, 200).toLowerCase()) : null;
    if (!alvos.size && !autores) return { ok: true, marcados: 0 };
    let marcados = 0;
    for (const p of E.pedidos) {
      if (plataforma && p.origem.plataforma !== plataforma) continue;
      const porId = alvos.size && p.origem.msgId && alvos.has(p.origem.msgId);
      const porAutor = autores && p.quem.hashes.some((h) => autores.has(h));
      if ((porId || porAutor) && !p.marcas.includes('moderacao')) { p.marcas.push('moderacao'); marcados++; }
    }
    if (!marcados) return { ok: true, marcados: 0 };
    return feito('moderacao', { marcados });
  }

  // «começar do zero» com o arquivo que não abre: a cópia já ficou guardada
  // e o nº continua de onde dá para saber (o seq nunca volta)
  function resgatarSeq() {
    let maior = 0;
    try {
      const st = fs.statSync(arquivo);
      if (st.size > 64 * 1024 * 1024) return 0;
      const txt = fs.readFileSync(arquivo, 'utf8');
      for (const m of txt.matchAll(/"(?:seq|n)"\s*:\s*(\d{1,12})|"id"\s*:\s*"p(\d{1,12})"/g)) {
        const v = Number(m[1] || m[2]);
        if (v > maior) maior = v;
      }
    } catch { /* sem arquivo: zero */ }
    return maior;
  }
  function recomecar() {
    if (travado === 'preso') pronto();
    if (!travado) return erro('nao-travado', 'O arquivo dos pedidos abre normalmente: não há o que recomeçar.');
    if (travado === 'preso') return erro('preso', 'O arquivo dos pedidos está preso por outro programa: espere ele soltar (nada foi apagado).');
    if (!copia && fs.existsSync(arquivo)) copia = guardarCopia(); // a cópia antes de tudo
    const seq = Math.max(resgatarSeq(), E ? E.seq : 0);
    E = dadosNovos(cfg().jogo);
    E.seq = seq;
    travado = null;
    const copiaFeita = copia;
    copia = null;
    gravarAgora();
    avisar('recomecar');
    return { ok: true, seq, copia: copiaFeita ? path.basename(copiaFeita) : null };
  }

  // ── 🕹️ operar: a porta única das ações (painel, Mini Mesa, controle externo) ──
  const OPERACOES = {
    abrir: (a) => abrir(a.tipo, a.sim !== undefined ? a.sim : a.ligar),
    proximo: () => proximo(),
    partida: (a) => partida(a),
    vitoria: (a) => partida({ resultado: 'vitoria', n: a.n, faltavam: a.faltavam }),
    derrota: (a) => partida({ resultado: 'derrota', n: a.n, faltavam: a.faltavam }),
    jogada: (a) => partida({ resultado: 'jogada', n: a.n, faltavam: a.faltavam }),
    pular: (a) => pular(temValor(a.id) ? a.id : a.n),
    retomar: (a) => retomar(temValor(a.id) ? a.id : a.n),
    recusar: (a) => recusar(temValor(a.id) ? a.id : a.n),
    ignorar: (a) => ignorar(temValor(a.id) ? a.id : a.n),
    devolvido: (a) => devolvido(temValor(a.id) ? a.id : a.n),
    liberarNome: (a) => liberarNome(temValor(a.id) ? a.id : a.n),
    confirmar: (a) => confirmar(temValor(a.id) ? a.id : a.n, a.itens, a),
    corrigir: (a) => corrigir(temValor(a.id) ? a.id : a.n, a.itens, a),
    novo: (a) => novo(a),
    virar: (a) => virar(a.message !== undefined ? a.message : a.mensagem),
    escolherJogo: (a) => escolherJogo(a.jogo),
    jogo: (a) => escolherJogo(a.jogo),
    fimDaLive: () => fimDaLive(),
    limparTestes: () => limparTestes(),
    remocao: (a) => remocao(a),
    recomecar: () => recomecar(),
  };
  // assinatura estável dos argumentos (sem o token n/faltavam) para «a mesma operação»
  function assinatura(a) {
    const partes = [];
    for (const k of Object.keys(a).sort().slice(0, 20)) {
      if (k === 'n' || k === 'faltavam') continue;
      const v = a[k];
      partes.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`.slice(0, 200));
    }
    return partes.join('&');
  }
  function operar(nome, args, contexto) {
    if (typeof nome !== 'string' || !Object.hasOwn(OPERACOES, nome)) return erro('operacao-desconhecida', 'Operação desconhecida dos pedidos.');
    const a = ehObjeto(args) ? args : {};
    const origem = ehObjeto(contexto) && typeof contexto.origem === 'string' ? contexto.origem : '';
    // Stream Deck e reconexões repetem o toque: sem o token, o igual em menos de 3 s é ignorado
    if (ORIGENS_EXTERNAS.has(origem) && !temValor(a.n) && !temValor(a.faltavam)) {
      const t = agora();
      for (const [k, quando] of toques) if (t - quando >= REPETIDO_MS || quando > t) toques.delete(k);
      const chave = `${nome}|${assinatura(a)}`;
      if (toques.has(chave)) return erro('repetido', 'Toque repetido, ignorado.', { repetido: true });
      toques.set(chave, t);
    }
    return OPERACOES[nome](a);
  }

  // ── 🪟 projeções: o que cada papel e a tela recebem ──
  function nomeDoItem(item, conf, idioma) {
    if (conf.idioma === 'ambos') {
      const en = item.nomes && item.nomes.en, pt = item.nomes && item.nomes.pt;
      if (en && pt && en !== pt) return `${en} / ${pt}`;
      return en || pt || nomeParaMostrar(item, 'en');
    }
    return nomeParaMostrar(item, conf.idioma === 'auto' ? idioma : conf.idioma);
  }
  const urlImagem = (jogo, item) => (item && ehObjeto(item.imagem) && item.imagem.ocultar !== true && typeof item.imagem.arquivo === 'string' && /^[a-z0-9-]+\.(?:png|jpg|webp|gif)$/.test(item.imagem.arquivo)
    ? `/pedidos-img/${jogo}/${item.imagem.arquivo}` : null);
  function itemVisto(it, jogo, ctx, comImagem, completo) {
    const c = acharItem(jogo, it.id);
    const out = { id: it.id, tipo: c ? c.tipo : it.tipo, nome: c ? nomeDoItem(c, ctx.conf, ctx.idioma) : (it.nome || it.id) };
    if (completo) {
      if (it.trecho !== undefined) out.trecho = it.trecho;
      if (it.certeza !== undefined) out.certeza = it.certeza;
      if (it.naoTenho || (c && c.naoTenho)) out.naoTenho = true;
    }
    const img = comImagem ? urlImagem(jogo, c) : null;
    if (img) { out.imagem = img; ctx.comImagens = true; }
    return out;
  }
  function personagemDe(p, ctx, comImagem) {
    const cat = catalogoDe(p.jogo);
    if (!cat) return null;
    const comPapel = temPapelPersonagem(cat);
    const it = p.itens.find((i) => (comPapel ? papelDoTipo(cat, (acharItem(p.jogo, i.id) || i).tipo) === 'personagem' : false));
    if (!it) return null;
    const v = itemVisto(it, p.jogo, ctx, comImagem, false);
    const out = { id: v.id, nome: v.nome };
    if (v.imagem) out.imagem = v.imagem;
    return out;
  }
  // o nome na tela (e para quem só assiste): palavra bloqueada ou mensagem
  // sinalizada = «Anônimo» até liberar; Pix do banco pela opção; telefone já é apelido
  function nomeNaTela(p, conf, der, ignorarOpcao) {
    if (!ignorarOpcao && !conf.nomeNaTela) return { quem: null, anonimo: false, segurado: false };
    const q = p.quem;
    if (!q.liberado && (q.sinalizada || nomeBloqueado(q.nome, der.bloqueadas))) return { quem: 'Anônimo', anonimo: true, segurado: true };
    if (q.civil && !q.telefone) return { quem: nomeCivil(q.nome, conf.nomePix), anonimo: conf.nomePix === 'anonimo', segurado: false };
    return { quem: q.nome, anonimo: false, segurado: false };
  }
  const segurado = (p, der) => !p.quem.liberado && (p.quem.sinalizada || nomeBloqueado(p.quem.nome, der.bloqueadas));
  function valorVisto(p) {
    const v = p.valor;
    const out = { centavos: v.centavos, moeda: v.moeda, texto: v.centavos === null ? v.original : formatarCentavos(v.centavos, v.moeda), original: v.original, aproximado: v.aproximado };
    if (v.moedaOriginal) out.moedaOriginal = v.moedaOriginal;
    return out;
  }
  function projetar(p, ctx) {
    const comImagem = ctx.imagens && (!p.pago || ctx.conf.imagens.pagos);
    const viewer = ctx.papel === 'viewer';
    const seg = segurado(p, ctx.der);
    const out = {
      id: p.id, n: p.seq, estado: p.estado, fonte: p.origem.fonte, platform: p.origem.plataforma,
      author: viewer ? nomeNaTela(p, ctx.conf, ctx.der, true).quem : p.quem.nome,
      hora: p.chegada, atrasado: p.origem.atrasado, pago: p.pago, jogo: p.jogo,
      partidas: { ...p.partidas }, vitorias: p.vitorias, derrotas: p.derrotas, jogadas: p.jogadas,
      // texto da mensagem sinalizada: só o painel local e o de senha, até liberar
      texto: viewer && seg && p.quem.sinalizada ? '' : p.texto,
      itens: p.itens.map((it) => itemVisto(it, p.jogo, ctx, comImagem, true)),
      duvidas: p.duvidas.map((d) => ({ trecho: d.trecho, motivo: d.motivo, opcoes: d.opcoes.map((x) => itemVisto(x, p.jogo, ctx, comImagem, true)) })),
      marcas: p.marcas.slice(), teste: p.teste, daLiveAnterior: p.daLiveAnterior,
      personagem: personagemDe(p, ctx, comImagem), nomeSegurado: seg, liberado: p.quem.liberado,
    };
    for (const k of ['chamadoEm', 'atendidoEm', 'recusadoEm', 'motivoRecusa']) if (p[k] !== undefined) out[k] = p[k];
    if (p.resgate) out.resgate = { titulo: p.resgate.titulo };
    if (!viewer) {
      out.msgId = p.origem.msgId;
      out.chave = p.quem.chave;
      out.chavePagamento = p.origem.chave;
      if (p.midia) out.midia = { ...p.midia };
    }
    if (ctx.valores && p.pago && p.valor) {
      out.valor = valorVisto(p);
      out.sobraCentavos = p.sobraCentavos;
      if (p.creditoUsadoCentavos) out.creditoUsadoCentavos = p.creditoUsadoCentavos;
    }
    return out;
  }
  function contexto(papel, opcoes, imagens) {
    const conf = cfg();
    const idioma = ehObjeto(opcoes) && typeof opcoes.idioma === 'string' && IDIOMAS.includes(opcoes.idioma) ? opcoes.idioma : null;
    const valores = papel === 'local' || (papel === 'full' ? conf.fullVeValores : papel === 'viewer' ? conf.viewerVeValores : false);
    return { papel, conf, der: derivada(), idioma, valores, imagens, comImagens: false };
  }
  const projetarLocal = (p) => projetar(p, contexto('local', null, cfg().imagens.painel));
  function jogoVisto(jogo) {
    const cat = catalogoDe(jogo);
    if (cat) return { id: jogo, nome: cat.jogo.nome, modelo: cat.jogo.modelo };
    return jogo ? { id: jogo, nome: jogo, modelo: null, indisponivel: true } : null;
  }
  function precoVisto(conf) { return { centavos: conf.precoCentavos, texto: formatarCentavos(conf.precoCentavos, 'BRL') }; }
  function paraPainel(papel, opcoes) {
    const pp = papel === 'local' || papel === 'full' ? papel : 'viewer';
    const ctx = contexto(pp, opcoes, cfg().imagens.painel);
    const conf = ctx.conf;
    const A = E.abertos;
    const vazio = { fila: [], revisar: [], feitos: [] };
    const out = {
      ligado: true, travado: travado || null, jogo: jogoVisto(E.jogo),
      abertos: { pagos: A.pagos, gratis: A.gratis, gratisDesde: A.gratisDesde, preco: precoVisto(conf) },
      valores: ctx.valores, agora: null,
    };
    if (travado) {
      if (pp === 'local' && copia) out.copia = path.basename(copia);
      Object.assign(out, vazio, pp === 'viewer' && !conf.viewerVeValores ? {} : { aDevolver: [] });
      out.contagem = { fila: 0, pulados: 0, revisar: 0, feitos: 0 };
      return out;
    }
    const verDevolver = pp !== 'viewer' || conf.viewerVeValores;
    const a = pedidoAgora();
    out.agora = a ? projetar(a, ctx) : null;
    out.fila = E.pedidos.filter((p) => p.estado === 'fila' || p.estado === 'pulado').map((p) => projetar(p, ctx));
    out.revisar = E.pedidos.filter((p) => p.estado === 'revisar').map((p) => projetar(p, ctx));
    if (verDevolver) out.aDevolver = E.aDevolver.map((p) => projetar(p, ctx));
    out.feitos = E.atendidos.slice(-TETOS.feitosNoPainel).reverse().map((p) => projetar(p, ctx));
    out.contagem = {
      fila: E.pedidos.filter((p) => p.estado === 'fila').length, pulados: E.pedidos.filter((p) => p.estado === 'pulado').length,
      revisar: out.revisar.length, feitos: E.atendidos.length,
    };
    if (verDevolver) out.contagem.aDevolver = E.aDevolver.length;
    out.avisoBehaviour = !!(conf.avisoBehaviour && ctx.comImagens && out.jogo && out.jogo.modelo === 'dbd');
    if (pp === 'local') {
      out.creditos = E.creditos.size;
      // o que saiu sem virar pedido ou deixou a fila (grátis recusado, fila cheia…), o mais novo primeiro
      out.registro = E.registro.slice(-30).reverse().map((r) => ({ ...r }));
    }
    return out;
  }
  function naTela(p, ctx, completo) {
    const comImagem = ctx.imagens && (!p.pago || ctx.conf.imagens.pagos);
    const nome = nomeNaTela(p, ctx.conf, ctx.der, false);
    const out = { n: p.seq, quem: nome.quem, anonimo: nome.anonimo, personagem: personagemDe(p, ctx, comImagem) };
    if (!completo) return out;
    // só o confirmado (as dúvidas ficam no painel); nada de texto cru, contato, chave
    out.itens = p.itens.map((it) => itemVisto(it, p.jogo, ctx, comImagem, false));
    out.partidas = { faltam: p.partidas.faltam, total: p.partidas.total };
    out.pago = p.pago;
    out.teste = p.teste;
    out.daLiveAnterior = p.daLiveAnterior;
    if (ctx.conf.valorNaTela && p.pago && p.valor && typeof p.valor.centavos === 'number') {
      out.valor = { texto: formatarCentavos(p.valor.centavos, p.valor.moeda), aproximado: p.valor.aproximado };
    }
    return out;
  }
  function paraTela(opcoes) {
    const ctx = contexto('tela', opcoes, cfg().imagens.tela);
    const conf = ctx.conf;
    const A = E.abertos;
    const jogo = jogoVisto(E.jogo);
    const out = {
      jogo: jogo ? { id: jogo.id, nome: jogo.nome } : null,
      abertos: { pagos: A.pagos, gratis: A.gratis, fechados: !A.pagos && !A.gratis, preco: A.pagos ? formatarCentavos(conf.precoCentavos, 'BRL') : null },
      agora: null, proximos: [], avisoBehaviour: false,
    };
    if (travado) return out;
    const a = pedidoAgora();
    out.agora = a ? naTela(a, ctx, true) : null;
    out.proximos = E.pedidos.filter((p) => p.estado === 'fila').slice(0, 5).map((p) => naTela(p, ctx, false));
    out.avisoBehaviour = !!(conf.avisoBehaviour && ctx.comImagens && jogo && jogo.modelo === 'dbd');
    return out;
  }
  // para o estado do controle externo: sem valor e sem mensagem
  function resumo() {
    const a = pedidoAgora();
    let per = null;
    if (a) { const v = personagemDe(a, contexto('tela', null, false), false); per = v ? v.nome : null; }
    return {
      travado: travado || null, pagos: E.abertos.pagos, gratis: E.abertos.gratis, jogo: E.jogo,
      agora: a ? { n: a.seq, personagem: per, quem: a.quem.nome, faltam: a.partidas.faltam, total: a.partidas.total } : null,
      fila: E.pedidos.filter((p) => p.estado === 'fila').length, revisar: E.pedidos.filter((p) => p.estado === 'revisar').length,
    };
  }
  function diagnostico() {
    return { travado: travado || null, copia: copia ? path.basename(copia) : null, gravacoes, pendente, ativos: E.pedidos.length, seq: E.seq, arquivo };
  }
  // grava o que estiver pendente (fechar o programa, ♻️, atualização)
  function fechar() {
    if (timerGravar) { clearTimeout(timerGravar); timerGravar = null; }
    if (timerRetentar) { clearTimeout(timerRetentar); timerRetentar = null; }
    if (timerVivo) { clearInterval(timerVivo); timerVivo = null; }
    if (pendente && !travado) gravarAgora();
    return { ok: true, gravado: !pendente };
  }

  carregarArquivo();
  timerVivo = setInterval(() => { if (!travado && (E.abertos.pagos || E.abertos.gratis)) gravarAgora(); }, VIVO_MS);
  if (timerVivo.unref) timerVivo.unref();

  // Nenhuma função derruba o servidor: erro inesperado vira resposta de erro
  const api = {
    lerEntrada, observar, abrir, proximo, partida, pular, retomar, confirmar, corrigir, recusar, ignorar, devolvido,
    novo, virar, escolherJogo, fimDaLive, limparTestes, remocao, liberarNome, recomecar,
    paraPainel, paraTela, resumo, operar, fechar, diagnostico,
  };
  const reservas = {
    lerEntrada: () => null,
    observar: () => nao('erro'),
    paraPainel: () => ({ ligado: true, travado: 'erro', agora: null, fila: [], revisar: [], feitos: [] }),
    paraTela: () => ({ jogo: null, abertos: { pagos: false, gratis: false, fechados: true, preco: null }, agora: null, proximos: [], avisoBehaviour: false }),
  };
  for (const nome of Object.keys(api)) {
    const fn = api[nome];
    api[nome] = (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        console.error(`  ⚠️ 🙋 Pedidos: erro inesperado em ${nome}:`, (err && err.stack) || err);
        return reservas[nome] ? reservas[nome]() : erro('erro-interno', 'Erro inesperado nos pedidos.');
      }
    };
  }
  return api;
}

module.exports = { criarPedidos, sanitizarConfiguracao, CONFIG_PADRAO, MARCAS, TETOS };
