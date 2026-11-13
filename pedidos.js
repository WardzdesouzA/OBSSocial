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
//   HORA do pagamento (os intervalos ficam gravados); o que chega com o
//   arquivo travado espera (na memória e em pedidos.espera.json) e é decidido
//   quando o arquivo abre;
// • a fila é sempre por ordem de chegada (hora do pagamento/da mensagem;
//   empate pelo nº do pedido), pago e grátis juntos;
// • o pedido nasce sem telefone (nome e texto tapados) e o contato para
//   responder fica só aqui dentro: nenhuma projeção o leva;
// • o «message» do servidor nunca é mexido: lerEntrada copia o que precisa;
// • arquivo que não abre ganha cópia e trava a gravação até o streamer
//   consertar o arquivo ou escolher «começar do zero»; nada grava por cima
//   sem a cópia; o nº do pedido (seq) nunca volta para trás;
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
  atendidos: 500, vistos: 5000, intervalos: 1000, registro: 200, creditos: 5000, gratisNaLive: 20000, espera: 5000,
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
  'cheio', 'moedaSemCotacao', 'itemEmDuvida', 'gratisEmDuvida', 'semItem', 'semCatalogo',
  'valorConvertido', 'atrasado', 'intercalado', 'naoTenho', 'moderacao', 'creditoUsado', 'reenviado', 'virado', 'manual',
]);
const MARCAS_VALIDAS = new Set(MARCAS);
const ORIGENS_EXTERNAS = new Set(['controle', 'externo']);
const OPERACOES_DE_PARTIDA = new Set(['partida', 'vitoria', 'derrota', 'jogada']);
// nome que não identifica ninguém: o conector põe «Anônimo» para quem não digitou nome
const NOMES_ANONIMOS = new Set(['anonimo', 'anonima', 'anonymous', 'anonyme', 'anonym']);
// o que os conectores põem no lugar do nome que não veio (connectors/youtube.js, kick.js, bilibili.js)
const ANONIMO_DOS_CONECTORES = 'anônimo';

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
    // Telegram/WhatsApp: só a conversa direta com o robô/número (grupo não pede);
    // com «só inscritos», mod, VIP e o dono do canal pedem também
    soConversaDireta: false, cargosTambem: true,
  },
  entrarDireto: 'alta', itemEmDuvida: 'fila', pular: 'fica', seguidas: true, chamarProximoAoTerminar: false,
  // 👆 v0.192.1: a «Espera entre toques» do painel (ms): depois do toque, o botão fica apagado
  // por isto, e o que mudou de lugar com a lista também (só os valores de ESPERAS_TOQUE_MS)
  esperaToqueMs: 1000,
  testeViraPedido: false, robosPodem: false, sinalizadaRevisar: true,
  // o pedido cuja mensagem a moderação apagou (ou de quem foi banido): fica na fila
  // marcado, vai para ⚠ Revisar ou é recusado (o pago nunca: vai para ⚠ Revisar)
  moderacao: 'manter',
  nomePix: 'primeiro', nomeNaTela: true, valorNaTela: false, idioma: 'auto',
  palavrasBloqueadas: [],
  // ocultarTipos: os tipos sem imagem, «jogo:tipo» (ex.: só os retratos, sem os ícones de perk)
  imagens: { painel: true, tela: true, pagos: true, baixarDoSiteOficial: true, ocultarTipos: [] },
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
// 👆 as escolhas da «Espera entre toques» (sem espera, 0,5 s, 1 s, 1,5 s, 2 s): um número
// da lista fechada; o resto (texto, 700, NaN) fica com o padrão, como as outras listas
const ESPERAS_TOQUE_MS = Object.freeze([0, 500, 1000, 1500, 2000]);
function umNumeroDe(v, lista, padrao) { return typeof v === 'number' && lista.includes(v) ? v : padrao; }
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
// os tipos sem imagem: «jogo:tipo», sem repetir, com teto (lista fechada pelo formato)
const RE_JOGO_TIPO = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;
function tiposSemImagem(v, padrao) {
  if (!Array.isArray(v)) return padrao.slice();
  const out = [];
  const fim = Math.min(v.length, 5000);
  for (let i = 0; i < fim && out.length < 500; i++) {
    const t = v[i];
    if (typeof t !== 'string' || t.length > 92 || !RE_JOGO_TIPO.test(t)) continue;
    const [jogo, tipo] = t.split(':');
    if (jogo.length > 60 || tipo.length > 30 || out.includes(t)) continue;
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
      soConversaDireta: simNao(proprio(g, 'soConversaDireta'), p.gratis.soConversaDireta),
      cargosTambem: simNao(proprio(g, 'cargosTambem'), p.gratis.cargosTambem),
    },
    entrarDireto: umDe(proprio(b, 'entrarDireto'), ['alta', 'media'], p.entrarDireto),
    itemEmDuvida: umDe(proprio(b, 'itemEmDuvida'), ['fila', 'revisar'], p.itemEmDuvida),
    pular: umDe(proprio(b, 'pular'), ['fica', 'sai'], p.pular),
    seguidas: simNao(proprio(b, 'seguidas'), p.seguidas),
    chamarProximoAoTerminar: simNao(proprio(b, 'chamarProximoAoTerminar'), p.chamarProximoAoTerminar),
    esperaToqueMs: umNumeroDe(proprio(b, 'esperaToqueMs'), ESPERAS_TOQUE_MS, p.esperaToqueMs),
    testeViraPedido: simNao(proprio(b, 'testeViraPedido'), p.testeViraPedido),
    robosPodem: simNao(proprio(b, 'robosPodem'), p.robosPodem),
    sinalizadaRevisar: simNao(proprio(b, 'sinalizadaRevisar'), p.sinalizadaRevisar),
    moderacao: umDe(proprio(b, 'moderacao'), ['manter', 'revisar', 'recusar'], p.moderacao),
    nomePix: umDe(proprio(b, 'nomePix'), ['primeiro', 'completo', 'anonimo'], p.nomePix),
    nomeNaTela: simNao(proprio(b, 'nomeNaTela'), p.nomeNaTela),
    valorNaTela: simNao(proprio(b, 'valorNaTela'), p.valorNaTela),
    idioma: umDe(idioma, IDIOMAS_NOMES, p.idioma),
    palavrasBloqueadas: listaDeTextos(proprio(b, 'palavrasBloqueadas'), 300, 60, p.palavrasBloqueadas),
    imagens: {
      ...booleanos(img, { painel: p.imagens.painel, tela: p.imagens.tela, pagos: p.imagens.pagos, baixarDoSiteOficial: p.imagens.baixarDoSiteOficial }),
      ocultarTipos: tiposSemImagem(proprio(img, 'ocultarTipos'), p.imagens.ocultarTipos),
    },
    avisoBehaviour: simNao(proprio(b, 'avisoBehaviour'), p.avisoBehaviour),
    fecharAbertosDepoisDeHoras: inteiro(proprio(b, 'fecharAbertosDepoisDeHoras'), 0, 168, p.fecharAbertosDepoisDeHoras),
    viewerVeValores: simNao(proprio(b, 'viewerVeValores'), p.viewerVeValores),
    fullVeValores: simNao(proprio(b, 'fullVeValores'), p.fullVeValores),
  };
}

// ── ✂️ Texto ────────────────────────────────────────────────────────────────
// controle, separadores de linha e marcadores de direção (viram truque na tela)
const RE_CONTROLE = /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
// invisíveis que não fazem nada na tela, só escondem o que está no meio
// («11<U+200B>98765<U+200B>4321» parece telefone e «Pala<U+200B>vrao», uma palavra só).
// O ZWJ/ZWNJ e os seletores de variação ficam: montam emoji e escritas.
const RE_INVISIVEL = /[\u00ad\u17b4\u17b5\u180e\u200b\u2060-\u2064\u206a-\u206f\ufeff]/g;
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
  return cortar(cortar(s, max * 4).replace(RE_CONTROLE, ' ').replace(RE_INVISIVEL, '').replace(/\s+/g, ' ').trim(), max).trim();
}
// 🔤 Os nomes do item em cada idioma, guardados no pedido: se o item sair do catálogo
// (apagado, jogo recriado, catálogo que não abre), cada tela ainda mostra o nome no
// idioma dela (senão em inglês) — e não o nome que o leitor usou. Só os 10 códigos.
function nomesGuardados(v) {
  if (!ehObjeto(v)) return null;
  const out = {};
  for (const k of IDIOMAS) {
    if (!Object.hasOwn(v, k)) continue;
    const n = limparLinha(v[k], 120);
    if (n) out[k] = n;
  }
  return Object.keys(out).length ? out : null;
}

// 📱 telefone escrito nunca entra no pedido: 8+ dígitos com espaço, ponto, traço
// ou parênteses no meio. Dígito de qualquer escrita (os largos do teclado
// japonês e chinês, os arábicos…) e o que vira dígito na forma compatível
// (①, ², 𝟗); separador também é traço de qualquer tipo, o ponto e os parênteses
// largos, o branco que ocupa lugar (U+3164, U+2800) e o que não aparece (marca
// sobre o dígito, U+200C…).
const RE_TELEFONE = /\+?\d[\d\s().-]{6,}\d/g; // o caso comum (só ASCII), direto
const RE_TALVEZ_DIGITO = /[\p{Nd}\p{No}]/u;
const RE_SEPARADOR_FONE = /^[\s().\-\p{Pd}\p{Cf}\p{M}\u00b7\u115f\u1160\u2024\u2027\u2212\u2800\u30fb\u30fc\u3164\uff08\uff09\uff0e\uff65\uff70\uffa0]$/u;
const ehMais = (ch) => ch === '+' || ch === '\uff0b';
function digitosDoCaractere(ch) {
  if (ch >= '0' && ch <= '9') return 1;
  if (ch.length === 1 && ch.charCodeAt(0) < 0x80) return 0;
  if (/^\p{Nd}$/u.test(ch)) return 1;
  if (/^\p{No}$/u.test(ch)) { const k = ch.normalize('NFKC'); return /^[0-9]{1,2}$/.test(k) ? k.length : 0; }
  return 0;
}
function taparTelefones(t) {
  if (typeof t !== 'string' || !RE_TALVEZ_DIGITO.test(t)) return t;
  if (!/[^\x00-\x7f]/.test(t)) return t.replace(RE_TELEFONE, (m) => (m.replace(/\D/g, '').length >= 8 ? '📱' : m));
  // fora do ASCII: cada caractere vira uma letra de «sombra» (d dígito, s separador,
  // m marca, + mais, x o resto), a mesma regra roda nela e devolve os pedaços
  const cps = Array.from(t);
  const pesos = new Array(cps.length);
  let sombra = '';
  for (let i = 0; i < cps.length; i++) {
    const ch = cps[i];
    pesos[i] = digitosDoCaractere(ch);
    sombra += pesos[i] ? 'd' : ehMais(ch) ? '+' : /^\p{M}$/u.test(ch) ? 'm' : RE_SEPARADOR_FONE.test(ch) ? 's' : 'x';
  }
  let out = '';
  let ult = 0;
  for (const m of sombra.matchAll(/\+?d[dsm]{6,}dm*/g)) {
    let n = 0;
    for (let i = m.index; i < m.index + m[0].length; i++) n += pesos[i];
    if (n < 8) continue;
    out += cps.slice(ult, m.index).join('') + '📱';
    ult = m.index + m[0].length;
  }
  return ult ? out + cps.slice(ult).join('') : t;
}

// Para comparar: minúsculas, sem acento nem risco sobre a letra (o «Zalgo»
// também), sem o que não aparece na tela, pontuação vira espaço. O NFC no fim
// recompõe o japonês (カ + ゛ = ガ) e o coreano, que o NFKD tinha separado.
const RE_MARCAS_LATINAS = /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/g;
const RE_INVISIVEL_COMPARAR = /[\p{Cf}\u034f\u17b4\u17b5\u180b-\u180f\ufe00-\ufe0f\u{e0100}-\u{e01ef}]/gu;
function normalizarBase(s) {
  return String(s).normalize('NFKD').replace(RE_MARCAS_LATINAS, '').replace(RE_INVISIVEL_COMPARAR, '')
    .replace(/[\u115f\u1160]/g, ' ') // o branco coreano ocupa lugar na tela: separa como espaço
    .normalize('NFC').toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
}
// nomes e recompensas (chave da pessoa, listas sem repetir): letra repetida 3+ vezes vira uma
function normalizarNome(s) {
  return normalizarBase(s).replace(/(\p{L})\1{2,}/gu, '$1');
}
const semNome = (s) => { const n = normalizarNome(s || ''); return !n || NOMES_ANONIMOS.has(n); };

// 🙈 Palavras bloqueadas. Cada texto vira o esqueleto (cada sequência de letras
// iguais vira uma) com quantas vezes cada letra apareceu; a bloqueada bate
// quando cada letra dela aparece AO MENOS tantas vezes no nome: «spammer» acha
// «Spammmer» e «palavrao» acha «Palavraaao», mas «ass» não acha «As».
function esqueleto(texto) {
  let s = '';
  const c = []; // uma contagem por unidade do texto (letra fora do BMP ocupa duas)
  let ant = null;
  for (const ch of texto) {
    if (ch === ant) { for (let k = 1; k <= ch.length; k++) c[c.length - k]++; continue; }
    s += ch;
    for (let k = 0; k < ch.length; k++) c.push(1);
    ant = ch;
  }
  return { s, c };
}
// em volta de palavra curta colada, só enfeite: x e números («XxFdpxX», «fdp123»)
const RE_ENFEITE = /^[x\p{N}]*$/u;
function contem(N, B, soComEnfeite) {
  for (let i = N.s.indexOf(B.s); i >= 0; i = N.s.indexOf(B.s, i + 1)) {
    let ok = true;
    for (let k = 0; k < B.s.length && ok; k++) ok = N.c[i + k] >= B.c[k];
    if (ok && soComEnfeite) {
      const ini = N.s.lastIndexOf(' ', i) + 1;
      let fim = N.s.indexOf(' ', i + B.s.length);
      if (fim < 0) fim = N.s.length;
      ok = RE_ENFEITE.test(N.s.slice(ini, i)) && RE_ENFEITE.test(N.s.slice(i + B.s.length, fim));
    }
    if (ok) return true;
  }
  return false;
}
// Achada como palavra inteira e, colada num nome, pelo «peso»: chinês, japonês e
// coreano escrevem sem espaço e cada caractere vale por 2 letras («广告» acha
// «广告机器人»); peso 4+ colada em qualquer lugar; 2 ou 3 só com enfeite em volta
// («cu» não acha «Lucas», «pau» não acha «Paulo»); 1, só a palavra inteira.
const RE_ESCRITA_SEM_ESPACO = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
function prepararBloqueada(texto) {
  const w = normalizarBase(texto);
  if (!w) return null;
  if (w.includes(' ')) return { inteira: esqueleto(` ${w} `), colada: null, modo: 'nunca' }; // frase: só inteira
  let peso = 0;
  for (const ch of w) peso += RE_ESCRITA_SEM_ESPACO.test(ch) ? 2 : 1;
  return { inteira: esqueleto(` ${w} `), colada: esqueleto(w), modo: peso >= 4 ? 'sempre' : peso >= 2 ? 'enfeite' : 'nunca' };
}
// `der` = as bloqueadas preparadas da configuração e o cache dos nomes já vistos
// (o painel projeta milhares de pedidos a cada mudança)
function nomeBloqueado(nome, der) {
  if (!der.bloqueadas.length) return false;
  const k = String(nome);
  const visto = der.cacheBloqueio.get(k);
  if (visto !== undefined) return visto;
  const n = normalizarBase(k);
  let sim = false;
  if (n) {
    const N = esqueleto(` ${n} `);
    sim = der.bloqueadas.some((b) => contem(N, b.inteira, false) || (b.modo !== 'nunca' && contem(N, b.colada, b.modo === 'enfeite')));
  }
  if (der.cacheBloqueio.size >= 5000) der.cacheBloqueio.clear();
  der.cacheBloqueio.set(k, sim);
  return sim;
}
// nome civil do Pix do banco (muitas vezes em MAIÚSCULAS): primeiro nome com só a inicial maiúscula
function capitalizar(s) {
  return s.toLocaleLowerCase('pt-BR').replace(/(^|[\s'’-])(\p{L})/gu, (m, a, l) => a + l.toLocaleUpperCase('pt-BR'));
}
// o nome que era só um telefone já virou o apelido: não há nome civil nele
const RE_APELIDO_TELEFONE = /^📱 Convidado [0-9A-Z]{1,7}$/u;
function nomeCivil(nome, modo) {
  if (modo === 'anonimo') return 'Anônimo';
  const limpo = String(nome).trim();
  if (RE_APELIDO_TELEFONE.test(limpo)) return limpo;
  if (modo === 'completo') return limpo === limpo.toLocaleUpperCase('pt-BR') && /\p{Lu}/u.test(limpo) ? capitalizar(limpo) : limpo;
  // o primeiro nome de verdade: a conta de MEI chega com o CNPJ ou o CPF no nome
  // («12.345.678 MARIA DA SILVA», já tapado com 📱), e o 📱 e o que não tem letra ficam de fora
  for (const palavra of limpo.split(/\s+/)) {
    const p = palavra.replace(/📱/gu, '');
    if (/\p{L}/u.test(p)) return capitalizar(p);
  }
  return 'Anônimo';
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

// 📱 as regras do servidor, também com os dígitos e traços de qualquer escrita:
// o nome que é só um telefone (8+ dígitos e separadores) vira o apelido
function pareceTelefonePadrao(nome) {
  const t = String(nome || '').trim();
  if (!t || !RE_TALVEZ_DIGITO.test(t)) return false;
  let n = 0;
  for (const ch of t) {
    const d = digitosDoCaractere(ch);
    if (d) n += d;
    else if (!ehMais(ch) && !RE_SEPARADOR_FONE.test(ch)) return false;
  }
  return n >= 8;
}
function apelidoDeTelefonePadrao(nome) {
  const t = String(nome || '').trim();
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return '📱 Convidado ' + h.toString(36).slice(-3).toUpperCase();
}

// 📨 O id do comentário do Telegram é «tg-<conversa>-<mensagem>», e no privado a
// conversa É o id da pessoa: nas projeções vai um resumo dele, que o painel refaz
// do id do comentário para ligar os dois (a mesma conta mora no dashboard.html)
function resumoDoId(s) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const msgIdVisto = (o) => (o.plataforma === 'telegram' && typeof o.msgId === 'string' && o.msgId.startsWith('tg-') ? 'tg-h' + resumoDoId(o.msgId) : o.msgId);

// ── 🔢 Ordem da fila ────────────────────────────────────────────────────────
// hora de chegada (ou a vez nova de quem foi intercalado); empate pelo nº
const ordemDe = (p) => (typeof p.vez === 'number' ? p.vez : p.chegada);
const compara = (a, b) => ordemDe(a) - ordemDe(b) || a.seq - b.seq;

// ── 🧱 O núcleo ─────────────────────────────────────────────────────────────
function criarPedidos(opcoes) {
  const o = ehObjeto(opcoes) ? opcoes : {};
  if (typeof o.baseDir !== 'string' || !o.baseDir.trim()) throw new TypeError('criarPedidos: falta a pasta base (data/pedidos)');
  const arquivo = path.join(o.baseDir, 'pedidos.json');
  const arquivoEspera = path.join(o.baseDir, 'pedidos.espera.json');
  const catalogos = o.catalogos && typeof o.catalogos === 'object' ? o.catalogos : null;
  const lerConfiguracao = typeof o.configuracao === 'function' ? o.configuracao : () => o.configuracao;
  const relogio = typeof o.agora === 'function' ? o.agora : Date.now;
  const aoMudar = typeof o.aoMudar === 'function' ? o.aoMudar : null;
  const apelidoDoServidor = typeof o.apelidoDeTelefone === 'function' ? o.apelidoDeTelefone : null;
  const telefoneDoServidor = typeof o.pareceTelefone === 'function' ? o.pareceTelefone : null;
  const converter = typeof o.converter === 'function' ? o.converter : null;
  // a versão do arquivo de cada imagem (o servidor sabe quando ela mudou): vai na
  // URL, e a imagem trocada com o mesmo nome aparece nova (sem o cache da velha)
  const versaoDaImagem = typeof o.versaoDaImagem === 'function' ? o.versaoDaImagem : null;
  // função do servidor com erro nunca derruba a mensagem: cai na regra própria
  const agora = () => {
    let t = NaN;
    try { t = Number(relogio()); } catch { /* relógio do servidor com erro: o do sistema */ }
    return Number.isFinite(t) ? t : Date.now();
  };
  // 📱 as regras do servidor (o apelido bate com o do chat) somadas às do núcleo
  function pareceTelefone(nome) {
    if (pareceTelefonePadrao(nome)) return true;
    if (!telefoneDoServidor) return false;
    try { return !!telefoneDoServidor(nome); } catch { return false; }
  }
  function apelidoDeTelefone(nome) {
    let a = null;
    if (apelidoDoServidor) { try { a = apelidoDoServidor(nome); } catch { a = null; } }
    if (typeof a !== 'string' || !a.trim()) a = apelidoDeTelefonePadrao(nome);
    return taparTelefones(limparLinha(a, TETOS.nome)) || apelidoDeTelefonePadrao(nome);
  }

  let E = null;              // os dados (o que vai para o arquivo)
  let travado = null;        // null | 'ilegivel' (estragado) | 'preso' (outro programa segura o arquivo)
  let copia = null;          // a cópia do arquivo que não abriu
  let assinaturaIlegivel = null; // como o arquivo ilegível estava no disco (mudou = o streamer consertou)
  let copiaDevida = false;   // entrada descartada sem cópia: o arquivo só é regravado depois dela
  let espera = [];           // pagamentos que chegaram com o arquivo travado: { em, m }
  let esperaAtrasada = false, avisouEspera = false;
  let ultimaLeitura = 0, ultimoErro = null;
  let vivoAoAbrir = null;    // a última atividade gravada quando o arquivo abriu (o servidor sabe desde quando o programa ficou parado)
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
        bloqueadas: conf.palavrasBloqueadas.map(prepararBloqueada).filter(Boolean), cacheBloqueio: new Map(),
        recompensas: new Set(conf.gratis.recompensas.map(normalizarNome).filter(Boolean)),
        semImagem: new Set(conf.imagens.ocultarTipos), // «jogo:tipo»
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
    if (copiaDevida) {
      // a entrada descartada só existe no arquivo do disco: sem a cópia dele, regravar a apagaria
      const c = guardarCopia();
      if (!c) { pendente = true; retentarDepois(); return false; }
      copiaDevida = false;
      console.error(`  ⚠️ 🙋 Pedidos: o arquivo como estava ficou guardado em ${path.basename(c)}; a fila volta a ser gravada.`);
    }
    try {
      gravarAtomico(arquivo, serializar(), { privado: true });
      gravacoes++;
      pendente = false;
      avisouGravacao = false;
      if (esperaAtrasada) { esperaAtrasada = false; gravarEspera(); } // o que esperava já está na fila gravada
      return true;
    } catch (err) {
      pendente = true;
      if (!avisouGravacao) console.error('  ⚠️ 🙋 Pedidos: não consegui gravar a fila (tento de novo sozinho):', (err && (err.code || err.message)) || err);
      avisouGravacao = true;
      retentarDepois();
      return false;
    }
  }
  function retentarDepois() {
    if (timerRetentar) return;
    timerRetentar = setTimeout(() => { timerRetentar = null; if (pendente) gravarAgora(); }, 2000);
    if (timerRetentar.unref) timerRetentar.unref();
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
  // cópia do arquivo como está no disco agora (nunca por cima de outra cópia)
  function guardarCopia() {
    const base = path.join(path.dirname(arquivo), `pedidos.ilegivel-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    for (let i = 0; i < 20; i++) {
      const nome = i ? `${base}-${i}.json` : `${base}.json`;
      try { fs.copyFileSync(arquivo, nome, fs.constants.COPYFILE_EXCL); return semCopiaRepetida(nome); } catch (err) {
        if (!err || err.code !== 'EEXIST') return null;
      }
    }
    return null;
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
  // como o arquivo está no disco (outro conteúdo = outra assinatura)
  function assinaturaDoDisco() {
    try { const st = fs.statSync(arquivo); return `${st.ino}|${st.size}|${st.mtimeMs}`; } catch { return null; }
  }
  function carregarArquivo() {
    try { limparTemporarios(arquivo); } catch { /* segue */ }
    ultimaLeitura = Date.now();
    const r = lerJsonSeguro(arquivo);
    if (r.ok) {
      const n = dadosDoArquivo(r.dados);
      if (n) {
        E = n.dados;
        vivoAoAbrir = E.vivoEm;
        travado = null;
        copia = null;
        assinaturaIlegivel = null;
        ultimoErro = null;
        copiaDevida = false;
        if (n.descartados) {
          const c = guardarCopia();
          console.error(`  ⚠️ 🙋 Pedidos: ${n.descartados} entrada(s) estragada(s) do arquivo ficaram de fora.`);
          if (c) console.error(`    O arquivo como estava ficou guardado em ${path.basename(c)}.`);
          else {
            // sem a cópia, regravar apagaria a entrada para sempre: a gravação espera a cópia dar certo
            copiaDevida = true;
            console.error('    Não consegui guardar uma cópia do arquivo como estava: ele só é regravado quando a cópia der certo.');
          }
          agendarGravacao();
        }
        fecharSeFicouParadoDemais();
        return;
      }
      // abre, mas não é a fila (ou foi gravado por uma versão mais nova): não grava por cima
      copia = guardarCopia() || copia;
      travado = 'ilegivel';
      assinaturaIlegivel = assinaturaDoDisco();
      ultimoErro = 'formato';
      E = dadosNovos(cfg().jogo);
      console.error('  ⚠️ 🙋 Pedidos: o arquivo da fila não tem o formato esperado; nada grava por cima até você consertar o arquivo ou escolher «começar do zero».');
      return;
    }
    if (r.faltando) { E = dadosNovos(cfg().jogo); travado = null; copia = null; assinaturaIlegivel = null; ultimoErro = null; return; }
    // erro de leitura vem com o código do sistema (EBUSY, EPERM…): preso, não estragado
    const preso = typeof r.erro === 'string' && /^E[A-Z]+$/.test(r.erro);
    if (travado !== (preso ? 'preso' : 'ilegivel')) {
      console.error(preso
        ? `  ⚠️ 🙋 Pedidos: o arquivo da fila está preso por outro programa (${r.erro}); tento de novo sozinho, sem gravar por cima (os pagamentos que chegarem esperam).`
        : `  ⚠️ 🙋 Pedidos: o arquivo da fila não abre (${r.erro}); ${r.copia ? `a cópia ficou em ${path.basename(r.copia)}` : 'não consegui guardar uma cópia'} e nada grava por cima até você consertar o arquivo ou escolher «começar do zero».`);
    }
    travado = preso ? 'preso' : 'ilegivel';
    assinaturaIlegivel = preso ? null : assinaturaDoDisco();
    ultimoErro = r.erro;
    copia = semCopiaRepetida(r.copia) || copia;
    if (!E) E = dadosNovos(cfg().jogo);
  }
  // Arquivo preso (antivírus, OneDrive) é lido de novo a cada segundo; o ilegível,
  // assim que muda no disco (o streamer devolveu o arquivo bom): nada trava a live
  // à toa. `forcar` relê o preso na hora (o «começar do zero» confere antes de apagar).
  function pronto(forcar) {
    if (!travado) return true;
    let reler;
    if (travado === 'preso') reler = forcar === true || Date.now() - ultimaLeitura >= 1000;
    else { const a = assinaturaDoDisco(); reler = a !== null && a !== assinaturaIlegivel; }
    if (reler) {
      carregarArquivo();
      if (!travado) { reprocessarEspera(); avisar('destravado'); }
    }
    return !travado;
  }

  // ── ⏳ espera: o pagamento que chega com o arquivo travado não se perde ──
  // Fica na memória e em pedidos.espera.json (fechar o programa não o perde) e é
  // decidido quando o arquivo abre, com o sal, os intervalos e a dedupe dele.
  // Só o que o lerEntrada lê, numa cópia JSON enxuta: a mensagem do servidor
  // nunca é guardada nem mexida.
  const CAMPOS_DA_MENSAGEM = Object.freeze(['platform', 'id', 'author', 'authorId', 'authorLogin', 'badges', 'timestamp', 'text', 'superchat',
    'resgate', 'livepix', 'pixgg', 'pix', 'teste', 'fromHistory', 'subTier', 'midia', 'tgChatId', 'tgMessageId', 'waChatId', 'waMessageId']);
  function copiaRasa(v, nivel) {
    if (typeof v === 'string') return v.slice(0, TETOS.texto * 4);
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'boolean' || v === null) return v;
    if (nivel > 1) return undefined;
    if (Array.isArray(v)) return v.slice(0, 60).map((x) => copiaRasa(x, nivel + 1)).filter((x) => x !== undefined);
    if (!ehObjeto(v)) return undefined;
    const out = {};
    for (const k of Object.keys(v).slice(0, 40)) {
      if (k === '__proto__') continue;
      const x = copiaRasa(v[k], nivel + 1);
      if (x !== undefined) out[k] = x;
    }
    return out;
  }
  function copiaDaMensagem(m) {
    const c = {};
    for (const k of CAMPOS_DA_MENSAGEM) { const x = m[k] === undefined ? undefined : copiaRasa(m[k], 0); if (x !== undefined) c[k] = x; }
    if (Array.isArray(m.runs)) {
      let resta = TETOS.texto * 4; // os pedaços do texto até onde o lerEntrada lê (a PixGG usa só o 1º)
      c.runs = m.runs.slice(0, 300).map((r) => {
        const s = r && typeof r.text === 'string' ? r.text.slice(0, Math.max(0, resta)) : '';
        resta -= s.length;
        return { text: s };
      });
    }
    return c;
  }
  function plataformaDe(m) {
    const p = limparLinha(m.platform, 20).toLowerCase() || 'chat';
    return p === 'doacao' ? 'pix' : p; // o nome antigo do Pix nos logs
  }
  // só pagamento espera (o grátis que chega com o arquivo travado não vira pedido)
  function guardarNaEspera(message) {
    if (!ehObjeto(message) || !FONTES_PAGAS.has(fonteDe(message, plataformaDe(message)))) return false;
    espera.push({ em: agora(), m: copiaDaMensagem(message) });
    if (espera.length > TETOS.espera) espera.splice(0, espera.length - TETOS.espera);
    gravarEspera();
    avisar('espera');
    return true;
  }
  function gravarEspera() {
    try {
      if (espera.length) gravarAtomico(arquivoEspera, JSON.stringify({ versao: VERSAO, mensagens: espera }), { privado: true });
      else fs.rmSync(arquivoEspera, { force: true });
      avisouEspera = false;
    } catch (err) {
      if (!avisouEspera) console.error('  ⚠️ 🙋 Pedidos: não consegui guardar no disco o pagamento que espera o arquivo (fica na memória):', (err && (err.code || err.message)) || err);
      avisouEspera = true;
    }
  }
  function carregarEspera() {
    try { limparTemporarios(arquivoEspera); } catch { /* segue */ }
    const r = lerJsonSeguro(arquivoEspera);
    if (!r.ok) {
      if (!r.faltando) console.error(`  ⚠️ 🙋 Pedidos: o arquivo dos pagamentos em espera não abre (${r.erro})${r.copia ? `; a cópia ficou em ${path.basename(r.copia)}` : ''}.`);
      return;
    }
    const lista = ehObjeto(r.dados) && Array.isArray(r.dados.mensagens) ? r.dados.mensagens : [];
    for (const x of lista.slice(-TETOS.espera)) {
      if (ehObjeto(x) && ehObjeto(x.m) && typeof x.em === 'number' && Number.isFinite(x.em)) espera.push({ em: x.em, m: x.m });
    }
  }
  // o arquivo abriu (soltou, foi consertado ou recomeçado): cada pagamento que
  // esperava é decidido agora, pela hora em que chegou
  function reprocessarEspera() {
    if (travado || !espera.length) return 0;
    const lista = espera;
    espera = [];
    let entraram = 0;
    for (const x of lista) {
      try {
        if (observarEm(x.m, x.em).virou) entraram++;
      } catch (err) {
        espera.push(x); // erro inesperado: continua esperando (e no disco)
        console.error('  ⚠️ 🙋 Pedidos: um pagamento em espera não entrou (fica guardado):', (err && err.message) || err);
      }
    }
    esperaAtrasada = true; // o arquivo da espera só muda depois que a fila foi gravada
    gravarAgora();
    return entraram;
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
    const nomes = nomesGuardados(b.nomes);
    if (nomes) it.nomes = nomes;
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
    if (Number.isInteger(b.creditoGeradoCentavos) && b.creditoGeradoCentavos > 0 && b.creditoGeradoCentavos <= 1e11) p.creditoGeradoCentavos = b.creditoGeradoCentavos;
    if (b.estado === 'revisar' && Number.isInteger(b.creditoAoConfirmar) && b.creditoAoConfirmar > 0 && b.creditoAoConfirmar <= 1e11) p.creditoAoConfirmar = b.creditoAoConfirmar;
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
      // (o nome que o leitor guarda é o de reserva: em inglês, o que toda tela aceita)
      try { leitorCache = { cat, leitor: criarLeitor(cat, { idioma: 'en' }) }; } catch (err) {
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
  // `t` = quando a mensagem chegou (o pagamento que esperou o arquivo é lido depois)
  function lerEntradaEm(message, t) {
    if (!ehObjeto(message)) return null;
    const conf = cfg();
    const plataforma = plataformaDe(message);
    const msgId = limparLinha(message.id, 200);
    const badges = Array.isArray(message.badges) ? message.badges.slice(0, 60).filter((b) => typeof b === 'string') : [];
    const fonte = fonteDe(message, plataforma);
    const pago = FONTES_PAGAS.has(fonte);
    // o Pix do banco traz a hora em que caiu no banco num campo próprio: o
    // timestamp dele é a chegada (o lugar na linha do tempo das telas)
    const horaDoBanco = fonte === 'pix' && ehObjeto(message.pix) && typeof message.pix.horario === 'number' ? message.pix.horario : NaN;
    let hora = Number.isFinite(horaDoBanco) && horaDoBanco > 0 ? horaDoBanco : Number(message.timestamp);
    if (!Number.isFinite(hora) || hora <= 0) hora = t;
    const atrasado = t - hora > ATRASADO_MS;
    if (hora > t) hora = t; // relógio da plataforma adiantado
    // quem: telefone vira o apelido; número no meio do nome também sai
    const nomeBruto = limparLinha(message.author, 200);
    let nome = cortar(nomeBruto, TETOS.nome).trim();
    // sem nome, os conectores (YouTube, Kick, Bilibili) mandam «anônimo»: é rótulo
    // do programa, não o nome de alguém — vira o «Anônimo» que as telas traduzem
    if (!nome || nome === ANONIMO_DOS_CONECTORES) nome = 'Anônimo';
    let telefone = false;
    if (pareceTelefone(nome) || pareceTelefone(nomeBruto)) {
      // o mesmo texto que o servidor usa: o apelido bate com o do chat
      nome = apelidoDeTelefone(typeof message.author === 'string' ? message.author : nomeBruto);
      telefone = true;
    } else {
      const tapado = taparTelefones(nome);
      if (tapado !== nome) { nome = tapado; telefone = true; }
    }
    const chaveMsg = msgId ? `msg:${plataforma}:${msgId}` : null;
    const chavePagamento = pago ? chaveDePagamento(message, fonte, plataforma, msgId) : null;
    // A chave da pessoa: o id do autor, ou o nome. Sem nome digitado («Anônimo»,
    // e o login da LivePix/PixGG é o nome em minúsculas) não há pessoa: cada
    // mensagem é uma (dois anônimos não dividem crédito nem o «um por pessoa»).
    const authorId = limparLinha(message.authorId, 200);
    const login = limparLinha(message.authorLogin, 200);
    // o Pix do banco que chegou sem o nome de quem pagou leva o rótulo do servidor
    // («Apoiador Pix»), que não é ninguém: cada pagamento desses é uma pessoa
    const pixSemNome = fonte === 'pix' && ehObjeto(message.pix) && message.pix.semNome === true;
    const anonimo = pixSemNome || (!authorId && semNome(nomeBruto) && (!login || semNome(login)));
    const idAutor = authorId || login;
    const chave = anonimo
      ? hash(`${plataforma}|anonimo:${chavePagamento || chaveMsg || crypto.randomBytes(8).toString('hex')}`)
      : hash(`${plataforma}|${idAutor ? `id:${idAutor.toLowerCase()}` : `nome:${normalizarNome(nomeBruto)}`}`);
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
    const v = pago ? valorDe(message, fonte, conf) : { valor: null, semCotacao: false };
    const r = ehObjeto(message.resgate) ? message.resgate : null;
    const midia = ehObjeto(message.midia) && typeof message.midia.url === 'string' && message.midia.url.startsWith('/midia-inscritos/')
      ? { tipo: limparLinha(message.midia.tipo, 20), url: limparLinha(message.midia.url, 300) } : null;
    return {
      fonte, plataforma, msgId: msgId || null, chaveMsg, chavePagamento,
      hora, atrasado, pago, valor: v.valor, semCotacao: !!(pago && v.semCotacao),
      texto: textoDaMensagem(message, plataforma),
      quem: { nome, chave, hashes, contato, telefone, civil: plataforma === 'pix' && !pixSemNome, anonimo },
      teste: msgId.startsWith('test-') || badges.includes('teste') || message.teste === true,
      historico: message.fromHistory === true, sinalizada: badges.includes('sinalizada'), robo: badges.includes('bot'), privado,
      inscrito: ehInscrito(message, plataforma, badges),
      // mod, VIP e o dono do canal (os mesmos rótulos dos conectores da Twitch, Kick e YouTube)
      cargo: ['twitch', 'kick', 'youtube'].includes(plataforma) && (badges.includes('mod') || badges.includes('vip') || badges.includes('dono')),
      resgate: r ? { id: limparLinha(r.id, 100) || null, titulo: limparLinha(r.titulo, 100) } : null,
      midia, reenviado: plataforma === 'pixgg' && ehObjeto(message.pixgg) && message.pixgg.forcado === true,
    };
  }
  const lerEntrada = (message) => lerEntradaEm(message, agora());

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
  // crédito só com a opção, em reais e para quem tem nome (o anônimo não é reconhecido depois)
  const usaCredito = (e, conf) => conf.sobra === 'credito' && !!e.valor && e.valor.moeda === 'BRL' && !e.quem.anonimo;
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
    const credito = usaCredito(e, conf) ? creditoDe(e.quem.chave) : 0;
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
      const doCatalogo = acharItem(E.jogo, it.id);
      const nomes = doCatalogo ? nomesGuardados(doCatalogo.nomes) : null;
      if (nomes) base.nomes = nomes;
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
    return ['pagosFechados', 'abaixoDoPreco', 'semMensagem', 'naoPareceEmPedido', 'acimaDoMaximo', 'cheio', 'moedaSemCotacao', 'itemEmDuvida', 'semCatalogo'].includes(m);
  });

  // Pago. `forcado` = o streamer mandou virar pedido (as regras viram marcas).
  function decidirPago(e, conf, forcado) {
    if (!forcado && !fonteLigada(e, conf)) return nao('fonteDesligada');
    const leitura = ler(e.texto);
    const aberto = pagosAbertosEm(e.hora);
    const q = contarPartidas(e, conf, leitura);
    const marcas = [];
    if (!leitura.citaCatalogo && !forcado) {
      // o jogo da vez sem catálogo (não criado ainda, apagado, que não abre): o
      // leitor não reconhece nada, e com os pagos abertos o pagamento com texto
      // vai para ⚠ Revisar — nunca some como apoio sem ninguém ver
      if (e.texto && aberto && !catalogoDe(E.jogo)) marcas.push('semCatalogo');
      else if (e.texto) return nao('apoio'); // apoio comum: não vira pedido
      // sem mensagem: só com os pagos abertos e alcançando uma partida
      else if (!aberto || q.semCotacao || q.pagas < 1) return nao('apoio');
      else marcas.push('semMensagem');
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
    const credito = usaCredito(e, conf);
    const sobra = q.semCotacao ? 0 : Math.max(0, q.sobra);
    return {
      virou: true, estado: vaiRevisar ? 'revisar' : 'fila', partidas: forcado ? Math.max(1, q.partidas) : q.partidas,
      pagas: q.pagas, sobra, creditoUsado: q.creditoUsado,
      novoCredito: !vaiRevisar && credito ? sobra : null,
      // no ⚠ Revisar o crédito usado já saiu da carteira: a sobra volta a ela se o
      // streamer confirmar (como com os pagos abertos); recusado ou ignorado, volta o usado.
      // Sem uma partida paga, a partida que o streamer aceitar gasta a sobra.
      creditoAoConfirmar: vaiRevisar && credito && q.pagas >= 1 ? sobra : 0,
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
      if (g.soConversaDireta && (e.fonte === 'telegram' || e.fonte === 'whatsapp') && !e.privado) return nao('conversaDeGrupo');
      if (e.robo && !conf.robosPodem) return nao('robo');
      if (g.soInscritos && !e.inscrito && !(g.cargosTambem && e.cargo)) return nao('soInscritos');
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
    // o crédito que a sobra DESTE pagamento criou (sai da carteira se ele for devolvido)
    if (d.novoCredito > 0) p.creditoGeradoCentavos = d.novoCredito;
    if (d.creditoAoConfirmar > 0 && p.estado === 'revisar') p.creditoAoConfirmar = d.creditoAoConfirmar;
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
  // Com o arquivo travado, o pagamento espera e é decidido quando ele abrir
  // (`espera: true`); o grátis não vira pedido.
  function observar(message) {
    if (!pronto()) return guardarNaEspera(message) ? nao('travado', { espera: true }) : nao('travado');
    return observarEm(message, agora());
  }
  function observarEm(message, quando) {
    const e = lerEntradaEm(message, quando);
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

  // O pagamento saiu da conta (vai para «a devolver», ou era de 🧪 teste): o crédito
  // que ele usou volta para a pessoa e o que a sobra DELE criou sai da carteira —
  // senão o dinheiro devolvido continuava valendo partida
  function desfazerCredito(p) {
    const k = p.quem.chave;
    const gerado = p.creditoGeradoCentavos || 0;
    const usado = p.creditoUsadoCentavos || 0;
    delete p.creditoGeradoCentavos;
    if (!k || (!gerado && !usado)) return;
    guardarCredito(k, Math.max(0, creditoDe(k) - gerado) + usado);
  }
  function sair(p, motivo) {
    tirar(p);
    p.estado = 'recusado';
    p.recusadoEm = agora();
    p.motivoRecusa = motivo;
    delete p.creditoAoConfirmar; // não confirmado: a sobra não vira crédito
    if (p.pago) {
      // o pagamento inteiro vai para «a devolver»
      desfazerCredito(p);
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
    delete p.creditoAoConfirmar;
    desfazerCredito(p);
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
      const it = { id, tipo: item.tipo, nome: nomeParaMostrar(item, 'en'), trecho: dado || trechoVisto(p, id) || '', certeza: 'alta', como: 'confirmado' };
      if (item.naoTenho) it.naoTenho = true;
      const nomes = nomesGuardados(item.nomes);
      if (nomes) it.nomes = nomes;
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
    if (ensinar && p.estado === 'revisar') {
      p.estado = 'fila';
      // o pago aceito faz a conta de quem chegou com os pagos abertos: a sobra vira crédito
      if (p.creditoAoConfirmar && p.quem.chave) {
        guardarCredito(p.quem.chave, creditoDe(p.quem.chave) + p.creditoAoConfirmar);
        p.creditoGeradoCentavos = (p.creditoGeradoCentavos || 0) + p.creditoAoConfirmar;
      }
      delete p.creditoAoConfirmar;
    }
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
    // sem nome, «Anônimo» como no lerEntrada e no arquivo (o mesmo antes e depois de reabrir)
    let nome = cortar(bruto, TETOS.nome).trim() || 'Anônimo';
    let telefone = false;
    if (pareceTelefone(nome)) { nome = apelidoDeTelefone(nome); telefone = true; } else {
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

  // 🧪 testes saem de todas as listas, e o dinheiro de ensaio sai da carteira: o
  // crédito que a sobra deles criou vai embora e o que eles usaram volta (do mais
  // novo para o mais velho; os de «a devolver» já fizeram essa conta ao sair)
  function tirarTestes(filtro) {
    let removidos = 0;
    const saem = [];
    const limpa = (l, desfazer) => {
      for (let i = l.length - 1; i >= 0; i--) {
        if (!l[i].teste || !filtro(l[i])) continue;
        const [p] = l.splice(i, 1);
        removidos++;
        if (desfazer) saem.push(p);
      }
    };
    limpa(E.pedidos, true);
    limpa(E.aDevolver, false);
    limpa(E.atendidos, true);
    saem.sort((a, b) => b.seq - a.seq);
    for (const p of saem) desfazerCredito(p);
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
    // o streamer escolhe: fica na fila marcado, vai para ⚠ Revisar ou é recusado. O
    // pedido da vez (▶ Agora) só ganha a marca; o pago nunca é recusado sozinho
    const regra = cfg().moderacao;
    let marcados = 0;
    for (const p of E.pedidos.slice()) {
      if (plataforma && p.origem.plataforma !== plataforma) continue;
      const porId = alvos.size && p.origem.msgId && alvos.has(p.origem.msgId);
      const porAutor = autores && p.quem.hashes.some((h) => autores.has(h));
      if (!(porId || porAutor) || p.marcas.includes('moderacao')) continue;
      p.marcas.push('moderacao');
      marcados++;
      if (p.estado !== 'fila' && p.estado !== 'pulado' && p.estado !== 'revisar') continue;
      if (regra === 'recusar' && !p.pago) sair(p, 'moderacao');
      else if (regra !== 'manter') p.estado = 'revisar';
    }
    if (!marcados) return { ok: true, marcados: 0 };
    return feito('moderacao', { marcados });
  }

  // «começar do zero» com o arquivo que não abre: o nº continua de onde dá para
  // saber, no arquivo e nas cópias dele (o seq nunca volta)
  function resgatarSeq(qual) {
    let maior = 0;
    if (!qual) return 0;
    try {
      const st = fs.statSync(qual);
      if (st.size > 64 * 1024 * 1024) return 0;
      const txt = fs.readFileSync(qual, 'utf8');
      for (const m of txt.matchAll(/"(?:seq|n)"\s*:\s*(\d{1,12})|"id"\s*:\s*"p(\d{1,12})"/g)) {
        const v = Number(m[1] || m[2]);
        if (v > maior) maior = v;
      }
    } catch { /* sem arquivo: zero */ }
    return maior;
  }
  function recomecar() {
    pronto(true); // relê antes: o preso que soltou e o ilegível que foi consertado abrem sem apagar nada
    if (!travado) return erro('nao-travado', 'O arquivo dos pedidos abre normalmente: não há o que recomeçar.');
    if (travado === 'preso') return erro('preso', 'O arquivo dos pedidos está preso por outro programa: espere ele soltar (nada foi apagado).');
    // a cópia do que está no disco AGORA (pode ter mudado desde que travou), antes de
    // tudo; sem ela, nada grava por cima
    let copiaFeita = null;
    if (fs.existsSync(arquivo)) {
      copiaFeita = guardarCopia();
      if (!copiaFeita) return erro('sem-copia', 'Não consegui guardar uma cópia do arquivo dos pedidos (disco cheio ou sem permissão): nada foi apagado.');
    }
    const seq = Math.max(resgatarSeq(arquivo), resgatarSeq(copia), resgatarSeq(copiaFeita), E ? E.seq : 0);
    E = dadosNovos(cfg().jogo);
    E.seq = seq;
    travado = null;
    copia = null;
    assinaturaIlegivel = null;
    ultimoErro = null;
    gravarAgora();
    // os pagamentos que esperavam entram na fila nova (sem os intervalos antigos: ⚠ Revisar)
    const entraram = reprocessarEspera();
    avisar('recomecar');
    return { ok: true, seq, copia: copiaFeita ? path.basename(copiaFeita) : null, entraram };
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
  // assinatura estável dos argumentos para «a mesma operação» (o nº faz parte:
  // «pular 5» e «pular 6» são toques diferentes)
  function assinatura(a) {
    const partes = [];
    for (const k of Object.keys(a).sort().slice(0, 20)) {
      const v = a[k];
      partes.push(`${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`.slice(0, 200));
    }
    return partes.join('&');
  }
  function operar(nome, args, contexto) {
    if (typeof nome !== 'string' || !Object.hasOwn(OPERACOES, nome)) return erro('operacao-desconhecida', 'Operação desconhecida dos pedidos.');
    const a = ehObjeto(args) ? args : {};
    const origem = ehObjeto(contexto) && typeof contexto.origem === 'string' ? contexto.origem : '';
    // Stream Deck e reconexões repetem o toque: o igual em menos de 3 s é ignorado.
    // Só a partida com o nº E o «faltavam» dispensa a trava, porque ela mesma recusa
    // o toque velho. Um dos dois sozinho continua batendo no toque repetido: o nº
    // baixaria outra partida do mesmo pedido, e o «faltavam» terminaria o pedido
    // seguinte que o «chamar o próximo sozinho» acabou de chamar (com as mesmas faltando).
    const comToken = OPERACOES_DE_PARTIDA.has(nome) && temValor(a.faltavam) && temValor(a.n);
    if (ORIGENS_EXTERNAS.has(origem) && !comToken) {
      const t = agora();
      for (const [k, quando] of toques) if (t - quando >= REPETIDO_MS || quando > t) toques.delete(k);
      const chave = `${nome}|${assinatura(a)}`;
      if (toques.has(chave)) return erro('repetido', 'Toque repetido, ignorado.', { repetido: true });
      toques.set(chave, t);
    }
    return OPERACOES[nome](a);
  }

  // ── 🪟 projeções: o que cada papel e a tela recebem ──
  // 🔤 O idioma dos nomes nunca passa por cima do idioma da tela (cada pessoa vê o
  // dela): «ambos» é o inglês junto do idioma da tela (em português, inglês +
  // português, como sempre); um idioma escolhido vale na tela desse idioma, e o
  // inglês (o nome de reserva de todos) em qualquer tela. Sem idioma de tela (o
  // núcleo chamado sem `idioma`), vale a escolha como está.
  function nomeDoItem(item, conf, idioma) {
    const n = item && ehObjeto(item.nomes) ? item.nomes : {};
    if (conf.idioma === 'ambos') {
      const tela = idioma || 'pt';
      const en = n.en || '';
      const outro = tela !== 'en' ? n[tela] || '' : '';
      if (en && outro && en !== outro) return `${en} / ${outro}`;
      return en || outro || nomeParaMostrar(item, tela);
    }
    if (conf.idioma === 'auto') return nomeParaMostrar(item, idioma);
    return nomeParaMostrar(item, !idioma || conf.idioma === 'en' || conf.idioma === idioma ? conf.idioma : idioma);
  }
  function urlImagem(jogo, item) {
    if (!item || !ehObjeto(item.imagem) || item.imagem.ocultar === true || typeof item.imagem.arquivo !== 'string' || !/^[a-z0-9-]+\.(?:png|jpg|webp|gif)$/.test(item.imagem.arquivo)) return null;
    const url = `/pedidos-img/${jogo}/${item.imagem.arquivo}`;
    let v = null;
    if (versaoDaImagem) { try { v = versaoDaImagem(jogo, item.imagem.arquivo); } catch { v = null; } }
    return typeof v === 'string' && /^[a-z0-9]{1,24}$/.test(v) ? `${url}?v=${v}` : url;
  }
  const ehJogoDbd = (jogo) => { const cat = catalogoDe(jogo); return !!(cat && cat.jogo && cat.jogo.modelo === 'dbd'); };
  // `semTrecho`: o pedaço da frase também é a frase (sinalizada para quem só assiste)
  function itemVisto(it, jogo, ctx, comImagem, completo, semTrecho) {
    const c = acharItem(jogo, it.id);
    const tipo = c ? c.tipo : it.tipo;
    // fora do catálogo: os nomes guardados no pedido (e vão junto, para cada tela
    // escolher o do idioma dela); sem eles, o nome de reserva (inglês)
    const guardados = !c && ehObjeto(it.nomes) ? it.nomes : null;
    const out = { id: it.id, tipo, nome: c ? nomeDoItem(c, ctx.conf, ctx.idioma) : guardados ? nomeDoItem({ id: it.id, nomes: guardados }, ctx.conf, ctx.idioma) : (it.nome || it.id) };
    if (guardados) out.nomes = { ...guardados };
    if (completo) {
      if (it.trecho !== undefined) out.trecho = semTrecho ? '' : it.trecho;
      if (it.certeza !== undefined) out.certeza = it.certeza;
      if (it.naoTenho || (c && c.naoTenho)) out.naoTenho = true;
    }
    // o tipo que o streamer deixou sem imagem (ex.: os ícones de perk) não leva a dele
    const img = comImagem && !ctx.der.semImagem.has(`${jogo}:${tipo}`) ? urlImagem(jogo, c) : null;
    if (img) {
      out.imagem = img;
      ctx.comImagens = true;
      // o aviso de direitos vale onde houver imagem do Dead by Daylight (o jogo do
      // PEDIDO, que pode não ser o da vez)
      if (!ctx.comImagensDbd && ehJogoDbd(jogo)) ctx.comImagensDbd = true;
    }
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
  // sinalizada = «Anônimo» até liberar; Pix do banco pela opção (também o da conta
  // de MEI, que chega com o número tapado no nome); telefone já é apelido
  function nomeNaTela(p, conf, der, ignorarOpcao) {
    if (!ignorarOpcao && !conf.nomeNaTela) return { quem: null, anonimo: false, segurado: false };
    const q = p.quem;
    if (!q.liberado && (q.sinalizada || nomeBloqueado(q.nome, der))) return { quem: 'Anônimo', anonimo: true, segurado: true };
    if (q.civil) return { quem: nomeCivil(q.nome, conf.nomePix), anonimo: conf.nomePix === 'anonimo', segurado: false };
    return { quem: q.nome, anonimo: false, segurado: false };
  }
  const segurado = (p, der) => !p.quem.liberado && (p.quem.sinalizada || nomeBloqueado(p.quem.nome, der));
  // fora do painel local (painel pela rede, controle externo) o nome civil do Pix
  // do banco vai pela opção: o completo fica só no local
  const nomeForaDoLocal = (p, conf) => (p.quem.civil ? nomeCivil(p.quem.nome, conf.nomePix) : p.quem.nome);
  function nomeDoPapel(p, ctx) {
    if (ctx.papel === 'local') return p.quem.nome;
    if (ctx.papel === 'viewer') return nomeNaTela(p, ctx.conf, ctx.der, true).quem;
    return nomeForaDoLocal(p, ctx.conf);
  }
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
    // texto da mensagem sinalizada: só o painel local e o de senha, até liberar
    // (os trechos dos itens e das dúvidas são pedaços dele: saem junto)
    const semTexto = viewer && seg && p.quem.sinalizada;
    const out = {
      id: p.id, n: p.seq, estado: p.estado, fonte: p.origem.fonte, platform: p.origem.plataforma,
      author: nomeDoPapel(p, ctx),
      hora: p.chegada, atrasado: p.origem.atrasado, pago: p.pago, jogo: p.jogo,
      // (quantas foram pagas, acima do máximo, diz o valor: só para quem vê os valores)
      partidas: { total: p.partidas.total, faltam: p.partidas.faltam, ...(ctx.valores && p.partidas.pagas ? { pagas: p.partidas.pagas } : {}) },
      vitorias: p.vitorias, derrotas: p.derrotas, jogadas: p.jogadas,
      texto: semTexto ? '' : p.texto,
      itens: p.itens.map((it) => itemVisto(it, p.jogo, ctx, comImagem, true, semTexto)),
      duvidas: p.duvidas.map((d) => ({ trecho: semTexto ? '' : d.trecho, motivo: d.motivo, opcoes: d.opcoes.map((x) => itemVisto(x, p.jogo, ctx, comImagem, true, semTexto)) })),
      marcas: p.marcas.slice(), teste: p.teste, daLiveAnterior: p.daLiveAnterior,
      personagem: personagemDe(p, ctx, comImagem), nomeSegurado: seg, liberado: p.quem.liberado,
    };
    for (const k of ['chamadoEm', 'atendidoEm', 'recusadoEm', 'motivoRecusa']) if (p[k] !== undefined) out[k] = p[k];
    if (p.resgate) out.resgate = { titulo: p.resgate.titulo };
    if (!viewer) {
      out.msgId = msgIdVisto(p.origem);
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
    return { papel, conf, der: derivada(), idioma, valores, imagens, comImagens: false, comImagensDbd: false };
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
      if (pp !== 'viewer') out.esperando = espera.length; // pagamentos guardados, que entram quando o arquivo abrir
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
    out.avisoBehaviour = !!(conf.avisoBehaviour && ctx.comImagensDbd);
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
    out.avisoBehaviour = !!(conf.avisoBehaviour && ctx.comImagensDbd);
    return out;
  }
  // para o estado do controle externo: sem valor e sem mensagem (e o nome civil pela
  // opção); o personagem no idioma do programa (`opcoes.idioma`), como no painel
  function resumo(opcoes) {
    const a = pedidoAgora();
    let per = null;
    if (a) { const v = personagemDe(a, contexto('tela', opcoes, false), false); per = v ? v.nome : null; }
    return {
      travado: travado || null, pagos: E.abertos.pagos, gratis: E.abertos.gratis, jogo: E.jogo,
      agora: a ? { n: a.seq, personagem: per, quem: nomeForaDoLocal(a, cfg()), faltam: a.partidas.faltam, total: a.partidas.total } : null,
      fila: E.pedidos.filter((p) => p.estado === 'fila').length, revisar: E.pedidos.filter((p) => p.estado === 'revisar').length,
    };
  }
  function diagnostico() {
    return {
      travado: travado || null, copia: copia ? path.basename(copia) : null, gravacoes, pendente, ativos: E.pedidos.length, seq: E.seq, arquivo,
      espera: espera.length, copiaDevida, erroLeitura: ultimoErro, vivoAoAbrir,
    };
  }
  // grava o que estiver pendente (fechar o programa, ♻️, atualização)
  function fechar() {
    if (timerGravar) { clearTimeout(timerGravar); timerGravar = null; }
    if (timerRetentar) { clearTimeout(timerRetentar); timerRetentar = null; }
    if (timerVivo) { clearInterval(timerVivo); timerVivo = null; }
    if (pendente && !travado) gravarAgora();
    return { ok: true, gravado: !pendente };
  }
  // grava já o que estiver adiado, sem parar nada (o backup copia o arquivo em
  // seguida; a atualização ainda pode falhar e o programa segue no ar)
  function gravar() {
    if (pendente && !travado) gravarAgora();
    return { ok: true, gravado: !pendente };
  }

  carregarArquivo();
  carregarEspera();
  reprocessarEspera(); // pagamento que esperava quando o programa fechou entra agora (se o arquivo abriu)
  timerVivo = setInterval(() => {
    try {
      if (travado) pronto(); // sem mensagem nem toque, o arquivo que soltou destrava assim mesmo
      else if (E.abertos.pagos || E.abertos.gratis) gravarAgora();
    } catch (err) { console.error('  ⚠️ 🙋 Pedidos: erro na conferência periódica:', (err && err.message) || err); }
  }, VIVO_MS);
  if (timerVivo.unref) timerVivo.unref();

  // Nenhuma função derruba o servidor: erro inesperado vira resposta de erro
  const api = {
    lerEntrada, observar, abrir, proximo, partida, pular, retomar, confirmar, corrigir, recusar, ignorar, devolvido,
    novo, virar, escolherJogo, fimDaLive, limparTestes, remocao, liberarNome, recomecar,
    paraPainel, paraTela, resumo, operar, fechar, gravar, diagnostico,
  };
  const reservas = {
    lerEntrada: () => null,
    // pagamento com erro inesperado não some: espera (no disco) e é tentado de novo ao abrir o programa
    observar: (message) => {
      try { if (guardarNaEspera(message)) return nao('erro', { espera: true }); } catch { /* segue */ }
      return nao('erro');
    },
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
        return reservas[nome] ? reservas[nome](...args) : erro('erro-interno', 'Erro inesperado nos pedidos.');
      }
    };
  }
  return api;
}

module.exports = { criarPedidos, sanitizarConfiguracao, nomeCivil, CONFIG_PADRAO, MARCAS, TETOS };
