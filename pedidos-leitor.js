// 🙋 Pedidos — o leitor local: acha na frase de quem pediu os itens do
// catálogo do jogo da vez (personagens, perks, add-ons…).
//
// Puro: não lê arquivo, não usa rede nem IA. Recebe o catálogo já carregado,
// monta o índice UMA vez (criarLeitor) e cada leitura custa o tamanho do texto,
// que é cortado em 600 caracteres — uma mensagem de 100 mil caracteres custa o
// mesmo que uma de 600.
//
// A ordem de casamento, cada etapa só com as palavras que sobraram da anterior:
//   1. nome inteiro (qualquer idioma), nome antigo ou apelido inteiro, de uma ou
//      várias palavras → alta. O mais longo ganha; um trecho é de um item só.
//   2. palavra significativa do nome que aponta para UM item só → alta
//      (para vários itens → dúvida com as opções)
//   3. erro de digitação (Damerau-Levenshtein) → média
//   4. som parecido (chave fonética simples PT/EN) → média
// Duas exceções na ordem, ambas pelo «trecho mais longo ganha»: a cor de
// raridade perto de «addon» e o erro de digitação numa expressão de várias
// palavras («trap fixs») são vistos antes da palavra solta.
// Se «média» entra direto ou vira dúvida é decisão do núcleo (pedidos.js).
'use strict';

// ── 📏 limites ───────────────────────────────────────────────────────────
const LIMITE_TEXTO = 600;     // a entrada é cortada aqui: o custo nunca cresce com o texto
const MAX_PALAVRAS = 8;       // expressão mais longa que casa como sequência de palavras
const MAX_OPCOES = 6;         // opções de uma dúvida
const MAX_OPCOES_COR = 12;    // add-ons de uma cor (um killer tem ~5 por raridade; «verde» junta duas)
const MAX_APROX = 32;         // palavra mais longa que entra na busca aproximada
const ORCAMENTO = 1500000;    // passos da busca aproximada por leitura: segura o pior caso
const MAX_COMPARACOES = 6000; // contas de distância por leitura (idem)
const MAX_TEXTO_ITEM = 240;   // nome/apelido mais longo lido do catálogo (120 caracteres = até 240 unidades UTF-16)
const MAX_CJK = 40;           // nome japonês/chinês mais longo procurado no texto
const MAX_INTERSECAO = 1000;  // palavra ambígua em mais itens que isso não se junta à vizinha
const MAX_TEXTOS_ITEM = 100;  // nomes/apelidos lidos por item

// ── 📚 listas (já na forma normalizada: minúsculas, sem acento) ───────────
// Palavras vazias: nunca casam sozinhas, nunca são «palavra significativa».
const VAZIAS = new Set((
  'a o as os um uma uns umas de do da dos das d em no na nos nas num numa com e ou para pra pro pras pros ' +
  'por pelo pela pelos pelas ao aos que se me te eu tu ele ela eles elas seu sua seus suas meu minha teu tua ' +
  'isso esse essa este esta isto mas so ja la ai aqui nao sim ta to ne tem ter ser foi era sao estou pode quer ' +
  'qual quem cade ' +
  'the an of and or to in on at for with by from as is it its this that my your his her our their i you he she ' +
  'we they be are was not can could would will just too very do does did have has had what which who how why ' +
  'when where if then than there here now also only into over about get got let lets us them him all any some ' +
  'more most one s t m re ve ll ' +
  'el los las un una uno unos unas del y con en mi su al lo le les es muy sin pero si ya hay ' +
  'l une des du et avec pour au aux qui ce cette mon ma mes ton ta ses je il nous vous ne pas est ' +
  'der die das den dem ein eine einen einem einer und oder mit von zu zum zur im am auf fur ist ' +
  'и в на с со по к но или для от из у об ve ile bir bu'
).split(' '));

// Artigo no começo do nome («The Trapper», «O Caçador»): o nome sem ele também
// vale como nome inteiro — ninguém pede «the trapper», pede «trapper».
const ARTIGOS = new Set('the a an o os as um uma el la los las lo le les l un une der die das ein eine'.split(' '));

// Palavras comuns nos pedidos e no chat: sozinhas não dizem qual item é, então
// não contam como palavra significativa nem entram na busca aproximada (senão
// «build» acharia «Bloody» pelo som e «play» acharia «Play with Your Food»).
// O nome inteiro continua casando normalmente.
const COMUNS = new Set((
  'manda mandar mande quero queria queremos joga jogar jogue joguei jogando pede pedir pedido pedidos pedindo ' +
  'faz faca fazer faco bota botar coloca colocar coloque usa usar use usando vai vamos bora build builds ' +
  'play plays playing jugar juega quiero please favor gracias ' +
  'partida partidas partidinha partidinhas jogo jogos jogada jogadas rodada rodadas vez vezes veces game games ' +
  'match matches round rounds run runs juego juegos ' +
  'dois duas tres quatro cinco seis sete oito nove dez two three four five six seven eight nine ten ' +
  'cuatro siete ocho nueve diez ' +
  'killer killers assassino survivor survivors surv survs sobrevivente sobreviventes perk perks addon item itens ' +
  'items oferenda oferendas offering offerings mapa mapas map maps poder poderes power powers personagem personagens ' +
  'marrom marrons marron amarelo amarela amarelos amarelas amarillo verde verdes azul azuis azules roxo roxa roxos ' +
  'roxas morado rosa rosas vermelho vermelha vermelhos vermelhas rojo laranja laranjas naranja iridescente ' +
  'iridescentes brown yellow green blue purple pink red orange iridescent ' +
  'live lives stream streamer canal chat salve ola opa eae eai fala boa bom noite tarde dia hoje agora depois ' +
  'ontem amanha obrigado obrigada valeu tmj mano mana irmao brother bro gente galera amigo amiga voce voces ' +
  'porque quando como onde tambem muito pouco mesmo beleza legal top haha hahaha rsrs lol tipo cara deus amor teste'
).split(' '));

// Gírias conhecidas (de → para, já normalizadas; até 3 palavras de cada lado).
// Ampliável: criarLeitor(catalogo, { girias: { 'de': 'para' } }).
const GIRIAS = Object.freeze({
  'pa nois': 'pra nos', 'pa noix': 'pra nos', 'nois': 'nos', 'noix': 'nos',
  'builda': 'build', 'buildar': 'build', 'bilda': 'build', 'bildar': 'build',
  'add on': 'addon', 'add ons': 'addon', 'addons': 'addon', 'adon': 'addon', 'adons': 'addon',
  'add': 'addon', 'adds': 'addon',
  'vc': 'voce', 'vcs': 'voces', 'tb': 'tambem', 'tbm': 'tambem', 'pq': 'porque', 'blz': 'beleza',
  'mt': 'muito', 'mto': 'muito', 'msm': 'mesmo', 'hj': 'hoje', 'dps': 'depois', 'obg': 'obrigado',
  'vlw': 'valeu', 'pfv': 'por favor', 'pfvr': 'por favor', 'plz': 'please', 'pls': 'please', 'q': 'que',
});

// 🎨 cor de raridade (modelo dbd) → raridades. «Verde» é ambíguo: incomum hoje,
// raro até maio de 2025 — as duas entram, na ordem.
const CORES = new Map();
for (const [palavras, raridades] of [
  ['marrom marrons marron brown', ['comum']],
  ['amarelo amarela amarelos amarelas amarillo yellow', ['incomum']],
  ['verde verdes green', ['incomum', 'raro']],
  ['azul azuis azules blue', ['raro']],
  ['roxo roxa roxos roxas morado purple', ['muitoRaro']],
  ['rosa rosas pink vermelho vermelha vermelhos vermelhas rojo red iridescente iridescentes iridescent', ['visceral']],
  ['laranja laranjas naranja orange', ['evento']],
]) for (const p of palavras.split(' ')) CORES.set(p, Object.freeze(raridades));

// 🔢 quantas partidas a pessoa pediu na frase
const NUMEROS = new Map([
  ['um', 1], ['uma', 1], ['dois', 2], ['duas', 2], ['tres', 3], ['quatro', 4], ['cinco', 5], ['seis', 6],
  ['sete', 7], ['oito', 8], ['nove', 9], ['dez', 10],
  ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6], ['seven', 7], ['eight', 8],
  ['nine', 9], ['ten', 10],
  ['uno', 1], ['una', 1], ['un', 1], ['dos', 2], ['cuatro', 4], ['siete', 7], ['ocho', 8], ['nueve', 9], ['diez', 10],
]);
// Número por extenso que vale sozinho («joga duas»). Fora: «um/uma/one/un/uno/una»
// (artigo: «um trapper») e «dos» (em português é «de + os»).
const NUMEROS_SOZINHOS = new Set('dois duas tres quatro cinco seis sete oito nove dez two three four five six seven eight nine ten cuatro siete ocho nueve diez'.split(' '));
const PALAVRAS_PARTIDA = new Set('partida partidas partidinha partidinhas jogo jogos jogada jogadas rodada rodadas game games match matches round rounds run runs vez vezes veces times juego juegos'.split(' '));
// «dos» só é «dois» (espanhol) antes destas: «dos partidas», «dos veces». «Um dos jogos»
// é «de + os» — e o português nunca diz «dos» antes de palavra feminina ou espanhola.
const DEPOIS_DE_DOS = new Set('partida partidas juego juegos veces'.split(' '));
// «duas perks», «tres addons»: o número fala de outra coisa
const COISAS = new Set((
  'perk perks addon item itens items oferenda oferendas offering offerings killer killers survivor survivors ' +
  'surv survs sobrevivente sobreviventes personagem personagens build builds poder poderes power powers mapa mapas ' +
  'map maps gen gens gerador geradores generator generators hook hooks gancho ganchos real reais conto contos pila ' +
  'pilas dolar dolares dollar dollars minuto minutos minute minutes min segundo segundos hora horas kill kills hit ' +
  'hits totem totens totems token tokens pessoa pessoas amigo amigos'
).split(' '));

const COMOS = ['nome', 'antigo', 'apelido', 'seu'];
// o que se sabe de cada palavra do índice (marcas, por número da palavra)
const P_VAZIA = 1, P_ANCORA = 2, P_SIGNIFICATIVA = 4;
const COMO_NOME = 0, COMO_ANTIGO = 1, COMO_APELIDO = 2, COMO_SEU = 3;

// ── ✂️ texto ──────────────────────────────────────────────────────────────
function paraTexto(x) {
  if (typeof x === 'string') return x;
  if (typeof x === 'number' || typeof x === 'boolean') return String(x);
  return ''; // null, objeto, função: nada a ler
}

// Corta ANTES de qualquer outra coisa (é o que mantém o custo linear) e não
// deixa meio emoji no fim.
function cortar(t) {
  if (t.length <= LIMITE_TEXTO) return t;
  let c = t.slice(0, LIMITE_TEXTO);
  const u = c.charCodeAt(c.length - 1);
  if (u >= 0xd800 && u <= 0xdbff) c = c.slice(0, -1);
  return c;
}

// 📱 telefone escrito nunca sai daqui (trecho e sobra podem ir para o painel): 8+
// dígitos de qualquer escrita — os de largura total do teclado japonês viram ASCII
// na normalização e passariam — separados por espaço, ponto, parênteses, hífen ou
// travessão, barra, sublinhado ou caractere invisível («11–98765–4321», «11/98765/4321»,
// «11\u200b98765…»)
const RE_TELEFONE = /[+\uff0b]?\p{Nd}[\p{Nd}\p{Cf}\s().\-\u2010-\u2015\u2212/_\uff08\uff09\uff0d\uff0e\uff0f\uff3f]{6,}\p{Nd}/gu;
const RE_DIGITO = /\p{Nd}/u;
const RE_NAO_DIGITO = /\P{Nd}/gu;
function taparTelefones(t) {
  if (!RE_DIGITO.test(t)) return t;
  return t.replace(RE_TELEFONE, (m) => (m.replace(RE_NAO_DIGITO, '').length >= 8 ? ' 📱 ' : m));
}

const RE_ASCII = /^[\x00-\x7f]*$/;
function prepararBase(texto) {
  let t = cortar(paraTexto(texto));
  if (!RE_ASCII.test(t)) t = t.normalize('NFC'); // «e + acento» digitado separado vira uma letra só
  return taparTelefones(t);
}

// Palavra = letras/números/marcas; o resto é pontuação e vira espaço — o apóstrofo
// também («trapper's» → «trapper s»: o nome inteiro continua casando). O ponto do
// katakana fica dentro («ザ・トラッパー») e some na normalização.
const RE_PALAVRA = /[\p{L}\p{M}\p{N}\u30fb\uff65]+/gu;
const RE_TEM_CJK = /[\u3005-\u3007\u3040-\u30ff\u31f0-\u31ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff65-\uff9f]|[\ud840-\ud884][\udc00-\udfff]/;
// O que pode separar as partes de um nome japonês/chinês sem acabar com ele: espaço,
// dois-pontos («呪術：破滅»), pontos do meio («德怀特·费尔菲尔德»), ponto, hífens e
// traços, sublinhado, «=»/«゠» (nomes ocidentais em katakana), «&» e apóstrofo.
// Vírgula, «、», «。», «！», «？», parênteses e aspas separam frases: não entram.
const RE_PONTE_CJK = /^[\s:\uff1a\u00b7\u30fb\uff65\u2027\u2022\u2219\u22c5.\uff0e\-\u2010-\u2015\u2212\uff0d_\uff3f=\uff1d\u30a0&\uff06'\u2019\uff07]*$/u;
function cpCjk(cp) {
  return (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x3005 && cp <= 0x3007) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff65 && cp <= 0xff9f) || (cp >= 0x20000 && cp <= 0x3134f);
}

const ESPECIAIS = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ı': 'i', 'þ': 'th', 'ð': 'd', 'ŀ': 'l' };
const RE_APOSTROFO = /['\u2019\u2018\u02bc`\u00b4]/;
const RE_APOSTROFOS = /['\u2019\u2018\u02bc`\u00b4]/g;
const RE_ESPECIAIS = /[ßæœøđłıþðŀ]/g;
const RE_REPETIDA_ASCII = /([a-z])\1\1+/g;
const RE_REPETIDA = /(\p{L})\1\1+/gu;
const RE_NAO_PALAVRA = /[^\p{L}\p{M}\p{N}]+/gu;
const RE_ACENTOS = /[\u0300-\u036f]/g;
// escritas que a normalização deixa como estão: hiragana, katakana (sem as ligaduras
// ゟ/ヿ e sem a meia largura), ideogramas CJK e sílabas hangul
const RE_ESTAVEL = /^[\u3041-\u3096\u309d\u309e\u30a1-\u30fa\u30fc-\u30fe\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7a3]+$/;
const RE_REPETIDA_TESTE = /(\p{L})\1\1/u;

// O caminho geral (qualquer escrita): NFKD já separa os acentos (NFKC e depois NFD
// davam o mesmo com uma volta a mais); tira só os latinos (0300–036F): o «゛» do
// japonês e o hangul se recompõem no NFC.
function normalizarGeral(bruto) {
  const s = bruto.normalize('NFKD').toLowerCase().replace(RE_ESPECIAIS, (c) => ESPECIAIS[c]);
  return s.replace(RE_ACENTOS, '').normalize('NFC').replace(RE_NAO_PALAVRA, '');
}
// Letras (latinas com acento, gregas, cirílicas) cuja forma normalizada não depende da
// vizinha: a tabela é feita pelo próprio caminho geral, letra a letra, então dá o mesmo
// resultado — sem as três passadas de normalização Unicode por palavra, que pesavam na
// montagem de um catálogo grande em vários idiomas. O que vira «Σ» fica de fora (a
// minúscula é σ ou ς conforme a posição) e qualquer outra coisa vai pelo caminho geral.
const LETRA_SIMPLES = new Array(0x500).fill(undefined);
for (let cp = 0; cp < 0x500; cp++) {
  const c = String.fromCharCode(cp);
  if (!/^[\p{L}\p{N}]$/u.test(c) || c.normalize('NFKD').includes('\u03a3')) continue;
  const r = normalizarGeral(c);
  if (/^[a-z0-9\u03b1-\u03c9\u0430-\u045f]+$/.test(r)) LETRA_SIMPLES[cp] = r;
}
const pedacos = [];

// minúsculas, sem acento, letra repetida 3+ vezes vira uma («trapperrrr» →
// «trapper»). Caminho curto para texto só ASCII (o comum).
function normalizarPalavra(bruto) {
  let s;
  if (RE_ASCII.test(bruto)) {
    s = bruto.toLowerCase();
    for (let i = 2; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === s.charCodeAt(i - 1) && c === s.charCodeAt(i - 2)) return s.replace(RE_REPETIDA_ASCII, '$1');
    }
    return s;
  }
  // kana, ideogramas e hangul já estão na forma final (NFKC, minúsculas e sem acento
  // não mudam nada): só a letra repetida — e são boa parte das palavras de um catálogo
  // em japonês, chinês e coreano
  if (RE_ESTAVEL.test(bruto)) return RE_REPETIDA_TESTE.test(bruto) ? bruto.replace(RE_REPETIDA, '$1') : bruto;
  // latino com acento, grego e cirílico: letra por letra, pela tabela
  let n = 0;
  for (let i = 0; i < bruto.length; i++) {
    const cp = bruto.charCodeAt(i);
    const m = cp < LETRA_SIMPLES.length ? LETRA_SIMPLES[cp] : undefined;
    if (m === undefined) { n = -1; break; }
    pedacos[n++] = m;
  }
  if (n >= 0) {
    pedacos.length = n;
    s = pedacos.join('');
    return RE_REPETIDA_TESTE.test(s) ? s.replace(RE_REPETIDA, '$1') : s;
  }
  return normalizarGeral(bruto).replace(RE_REPETIDA, '$1');
}

function empurrar(lista, bruto, s, cjk) {
  const n = normalizarPalavra(bruto);
  if (n) lista.push({ n, s, e: s + bruto.length, cjk });
}

// Palavras do texto, cada uma com a posição no texto original (s, e) para o
// trecho. Japonês/chinês e o resto ficam em palavras separadas («trapperで»).
function tokenizar(base, girias) {
  const lista = [];
  RE_PALAVRA.lastIndex = 0;
  let m;
  while ((m = RE_PALAVRA.exec(base)) !== null) {
    const bruto = m[0];
    if (!RE_TEM_CJK.test(bruto)) { empurrar(lista, bruto, m.index, false); continue; }
    let i = 0;
    while (i < bruto.length) {
      const cjk = cpCjk(bruto.codePointAt(i));
      let j = i;
      while (j < bruto.length) {
        const cp = bruto.codePointAt(j);
        if (cpCjk(cp) !== cjk) break;
        j += cp > 0xffff ? 2 : 1;
      }
      empurrar(lista, bruto.slice(i, j), m.index + i, cjk);
      i = j;
    }
  }
  return girias && girias.size ? aplicarGirias(lista, girias) : lista;
}

function palavrasSimples(texto) {
  return tokenizar(String(texto).slice(0, MAX_TEXTO_ITEM), null).filter((t) => !t.cjk).map((t) => t.n);
}

// Mapa: primeira palavra → [{ de: [...], para: [...] }], as mais longas primeiro.
function montarGirias(extra) {
  const mapa = new Map();
  const incluir = (de, para) => {
    if (typeof de !== 'string' || typeof para !== 'string') return;
    const d = palavrasSimples(de), p = palavrasSimples(para);
    if (!d.length || d.length > 3 || p.length > 3) return;
    const lista = mapa.get(d[0]) || [];
    const igual = lista.findIndex((g) => g.de.join(' ') === d.join(' '));
    if (igual >= 0) lista.splice(igual, 1); // a do streamer troca a padrão
    lista.push({ de: d, para: p });
    mapa.set(d[0], lista);
  };
  for (const [de, para] of Object.entries(GIRIAS)) incluir(de, para);
  if (extra && typeof extra === 'object') {
    const pares = Array.isArray(extra) ? extra : Object.entries(extra);
    for (const par of pares.slice(0, 500)) if (Array.isArray(par)) incluir(par[0], par[1]);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => b.de.length - a.de.length);
  return mapa;
}

function aplicarGirias(lista, girias) {
  let alguma = false; // quase sempre nenhuma: devolve a mesma lista sem copiar
  for (let i = 0; i < lista.length && !alguma; i++) alguma = !lista[i].cjk && girias.has(lista[i].n);
  if (!alguma) return lista;
  const saida = [];
  for (let i = 0; i < lista.length;) {
    const t = lista[i];
    const opcoes = t.cjk ? null : girias.get(t.n);
    let trocou = false;
    if (opcoes) {
      for (const g of opcoes) {
        const L = g.de.length;
        if (i + L > lista.length) continue;
        let ok = true;
        for (let k = 1; k < L; k++) { const u = lista[i + k]; if (u.cjk || u.n !== g.de[k]) { ok = false; break; } }
        if (!ok) continue;
        // as palavras novas apontam para o trecho original inteiro («add-on»)
        const s = t.s, e = lista[i + L - 1].e;
        for (const n of g.para) saida.push({ n, s, e, cjk: false });
        i += L;
        trocou = true;
        break;
      }
    }
    if (!trocou) { saida.push(t); i++; }
  }
  return saida;
}

// O mesmo, numa lista só de palavras (o índice: nome sem japonês/chinês)
function aplicarGiriasNasPalavras(ns, girias) {
  let alguma = false;
  for (let i = 0; i < ns.length && !alguma; i++) alguma = girias.has(ns[i]);
  if (!alguma) return ns;
  const saida = [];
  for (let i = 0; i < ns.length;) {
    const opcoes = girias.get(ns[i]);
    let trocou = false;
    if (opcoes) {
      for (const g of opcoes) {
        const L = g.de.length;
        if (i + L > ns.length) continue;
        let ok = true;
        for (let k = 1; k < L; k++) if (ns[i + k] !== g.de[k]) { ok = false; break; }
        if (!ok) continue;
        for (const n of g.para) saida.push(n);
        i += L;
        trocou = true;
        break;
      }
    }
    if (!trocou) { saida.push(ns[i]); i++; }
  }
  return saida;
}

// Palavras de um nome do catálogo sem japonês/chinês (o índice não precisa da posição
// no texto): uma lista de textos em vez de um objeto por palavra — são centenas de
// milhares de palavras num catálogo grande.
function palavrasDoNome(texto, girias) {
  const brutos = texto.match(RE_PALAVRA);
  if (!brutos) return [];
  const ns = [];
  for (const b of brutos) { const n = normalizarPalavra(b); if (n) ns.push(n); }
  return girias && girias.size ? aplicarGiriasNasPalavras(ns, girias) : ns;
}

const GIRIAS_PADRAO = montarGirias(null);

// Texto normalizado (o mesmo que o leitor usa): para o núcleo comparar
// palavras de pedido, apelidos e palavras bloqueadas do mesmo jeito.
function normalizar(texto, opcoes) {
  const girias = opcoes && opcoes.girias ? montarGirias(opcoes.girias) : GIRIAS_PADRAO;
  return tokenizar(prepararBase(texto), girias).map((t) => t.n).join(' ');
}

// ── 🔤 aproximação ────────────────────────────────────────────────────────
// Damerau-Levenshtein (transposição de vizinhas conta 1) com teto. Só a faixa
// |i − j| ≤ max da tabela é calculada (fora dela a distância já passa do teto):
// uma expressão de 119 letras custa 119 × 5 contas, não 119 × 119 — o teto de
// comparações por leitura segura quantas, e a faixa, o preço de cada uma. Para
// assim que a faixa inteira passa do máximo. Linhas reaproveitadas.
let linhaA = new Int32Array(80), linhaB = new Int32Array(80), linhaC = new Int32Array(80);
function distancia(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (lb + 2 > linhaA.length) { const t = lb + 80; linhaA = new Int32Array(t); linhaB = new Int32Array(t); linhaC = new Int32Array(t); }
  const fora = max + 1; // qualquer valor acima do teto vale o mesmo
  let ant2 = linhaA, ant = linhaB, cur = linhaC;
  for (let j = 0; j <= lb; j++) ant[j] = j <= max ? j : fora;
  ant[lb + 1] = fora;
  for (let i = 1; i <= la; i++) {
    const ca = a.charCodeAt(i - 1), caAnt = i > 1 ? a.charCodeAt(i - 2) : -1;
    const j0 = i - max > 1 ? i - max : 1, j1 = i + max < lb ? i + max : lb;
    cur[0] = i <= max ? i : fora;
    if (j0 > 1) cur[j0 - 1] = fora; // a borda da faixa: a próxima linha lê daqui
    let menor = cur[0];
    for (let j = j0; j <= j1; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = ant[j - 1] + (ca === cb ? 0 : 1);
      if (ant[j] + 1 < v) v = ant[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (j > 1 && ca === b.charCodeAt(j - 2) && caAnt === cb && ant2[j - 2] + 1 < v) v = ant2[j - 2] + 1;
      if (v > fora) v = fora;
      cur[j] = v;
      if (v < menor) menor = v;
    }
    if (j1 < lb) cur[j1 + 1] = fora;
    if (menor > max) return fora;
    const t = ant2; ant2 = ant; ant = cur; cur = t;
  }
  return ant[lb] > max ? fora : ant[lb];
}

// Erro aceito: 1 até 7 letras, 2 a partir de 8 (pela palavra menor), e nada
// abaixo de 4 letras.
function errosAceitos(la, lb) {
  const menor = la < lb ? la : lb;
  return menor < 4 ? -1 : menor >= 8 ? 2 : 1;
}

// Trigramas com duas bordas de cada lado, como inteiro pequeno (30 bits: 10 por
// letra). Letra acima de 1023 (coreano, por exemplo) dobra e pode coincidir
// com outra: isso só traz candidato a mais, que a distância confere depois —
// nunca faz perder um acerto. Inteiro pequeno não aloca (número grande alocava
// um objeto por trigrama e o índice de 20 mil itens passava metade do tempo
// coletando lixo).
function trigramas(p, saida) {
  saida.length = 0;
  let a = 1, b = 1;
  for (let i = 0; i < p.length + 2; i++) {
    const c = i < p.length ? p.charCodeAt(i) & 1023 : 1;
    saida.push((a << 20) | (b << 10) | c);
    a = b; b = c;
  }
  return saida;
}

// 🔊 chave fonética simples PT/EN: consoantes com os dígrafos dos dois idiomas
// (ph→f, th→t, sh/ch→x, lh, nh, qu→k, c→s/k, g→j antes de e/i, gh mudo…), cada
// grupo de vogais vira «*», e o fim que some na fala sai: o «e» mudo depois de
// consoante («nightmare», «plague») e o «r» depois de vogal («trapper» soa
// «trépa»). «trapper» e «trépa» dão «tr*p*» (e «trap» fica «tr*p»);
// «nightmare» e «naitmer» dão «n*tm*». Só palavras latinas de 4+ letras e
// chaves com 3+ consoantes (menos que isso junta palavras demais).
const RE_LATINA = /^[a-z]+$/;
// (por código de letra num buffer reaproveitado: montar a chave letra a letra num
// texto criava um texto novo por letra, e são ~250 mil chaves num catálogo grande)
const VOGAL = new Uint8Array(128);
for (const c of 'aeiouy') VOGAL[c.charCodeAt(0)] = 1;
const ASTERISCO = 42;
const fonBuf = [];
let fonN = 0, fonUlt = 0;
function fonEmite(c) { if (c !== fonUlt) { fonBuf[fonN++] = c; fonUlt = c; } }
// deixa a chave em fonBuf[0..fonN); false quando não há chave
function emitirFonetica(p, hComoR) {
  const L = p.length;
  if (L < 4 || L > MAX_APROX || !RE_LATINA.test(p)) return false;
  // «espirit» ≈ «spirit»: o «e» de apoio antes de «s» + consoante não conta
  const ini = L > 4 && p.charCodeAt(0) === 101 && p.charCodeAt(1) === 115 && !VOGAL[p.charCodeAt(2)] ? 1 : 0;
  fonN = 0; fonUlt = 0;
  for (let i = ini; i < L; i++) {
    const c = p.charCodeAt(i), d = i + 1 < L ? p.charCodeAt(i + 1) : 0, d2 = i + 2 < L ? p.charCodeAt(i + 2) : 0;
    if (c === 101 && !d && fonUlt && fonUlt !== ASTERISCO) continue; // «e» mudo no fim
    switch (c) {
      case 97: case 101: case 105: case 111: case 117: case 121: fonEmite(ASTERISCO); break; // vogais
      case 119: if (i === ini && d === 114) break; fonEmite(ASTERISCO); break; // w («wr» no começo: mudo)
      case 104: if (i === ini && hComoR) fonEmite(114); break; // h: mudo (o «h» inglês soa como «r» para quem fala português)
      case 112: if (d === 104) { fonEmite(102); i++; } else fonEmite(112); break; // p, ph → f
      case 116: if (d === 104) i++; fonEmite(116); break; // t, th → t
      case 115: if (d === 104) { fonEmite(120); i++; } else fonEmite(115); break; // s, sh → x
      case 99: // c: ch → x, ck → k, ce/ci/cy → s
        if (d === 104) { fonEmite(120); i++; } else if (d === 107) { fonEmite(107); i++; } else if (d === 101 || d === 105 || d === 121) fonEmite(115); else fonEmite(107);
        break;
      case 113: fonEmite(107); if (d === 117) i++; break; // q(u) → k
      case 107: if (i === ini && d === 110) break; fonEmite(107); break; // k («kn» no começo: mudo)
      case 103: // g: gh, «gn» no começo, ge/gi/gy → j, gue/gui → g
        if (d === 104) { if (i === ini) fonEmite(103); i++; } else if (i === ini && d === 110) { /* mudo */ } else if (d === 101 || d === 105 || d === 121) fonEmite(106); else if (d === 117 && (d2 === 101 || d2 === 105)) { fonEmite(103); i++; } else fonEmite(103);
        break;
      case 108: if (d === 104) i++; fonEmite(108); break; // l, lh
      case 110: if (d === 104) i++; fonEmite(110); break; // n, nh
      case 109: fonEmite(!d || !VOGAL[d] ? 110 : 109); break; // nasal antes de consoante e no fim
      case 122: fonEmite(115); break; // z → s
      default: fonEmite(c);
    }
  }
  if (fonN > 2 && fonBuf[fonN - 1] === 114 && fonBuf[fonN - 2] === ASTERISCO) fonN--; // «r» depois de vogal no fim
  let consoantes = 0;
  for (let i = 0; i < fonN; i++) if (fonBuf[i] !== ASTERISCO) consoantes++;
  return consoantes >= 3;
}
function chaveFonetica(p, hComoR) {
  if (!emitirFonetica(p, hComoR)) return null;
  fonBuf.length = fonN;
  return String.fromCharCode.apply(null, fonBuf);
}
// A mesma chave como inteiro de 29 bits (FNV-1a), sem montar o texto: o índice agrupa
// por ele (lista corrida, sem um Map de ~140 mil textos) e confere a chave de verdade
// só nos candidatos — dois sons diferentes com o mesmo inteiro não se misturam.
function somFonetico(p, hComoR) {
  if (!emitirFonetica(p, hComoR)) return -1;
  let h = 0x811c9dc5 | 0;
  for (let i = 0; i < fonN; i++) h = Math.imul(h ^ fonBuf[i], 0x01000193);
  return h >>> 3;
}

// ── 🏷️ nomes ─────────────────────────────────────────────────────────────
function nomeParaMostrar(nomes, idioma, reserva) {
  if (nomes && typeof nomes === 'object') {
    for (const k of [idioma, 'en', 'pt']) if (typeof nomes[k] === 'string' && nomes[k].trim()) return nomes[k].trim();
    for (const v of Object.values(nomes)) if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return reserva;
}

function textosDe(v, max) {
  if (!Array.isArray(v)) return [];
  const saida = [];
  for (const s of v) { if (typeof s === 'string' && s.trim()) saida.push(s.slice(0, MAX_TEXTO_ITEM)); if (saida.length >= max) break; }
  return saida;
}

// certeza de uma opção com duas casas; nunca 0 (é uma opção, só que entre muitas)
const arred = (n) => Math.max(0.01, Math.round(n * 100) / 100);

// As palavras significativas guardam o item sozinho e só viram lista no segundo:
// quase toda palavra aponta para uma coisa só (economiza ~100 mil listas).
const listaDe = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

// Termo exato com um item só (quase todos) fica num inteiro: item, «como», nº de
// palavras e prioridade, sem uma lista por termo — são centenas de milhares, e as
// listas pesavam na montagem (memória e coleta de lixo). Dois itens ou mais:
// [p, k, item, como, item, como…].
const UNICO_MAX = 1 << 21; // item acima disso (catálogo muito além do teto) fica na lista
const empacotar = (p, k, x, como) => (x < UNICO_MAX ? x * 256 + como * 64 + k * 4 + p : [p, k, x, como]);
const kDe = (e) => (typeof e === 'number' ? (e >> 2) & 15 : e[1]);

// Junta itens numa lista sem repetir. Na busca aproximada, passar de MAX_OPCOES
// já é vago demais (a palavra fica na sobra): para de crescer ali, o que segura
// o custo num catálogo com milhares de itens de nome parecido.
function unirLimitado(xs, novos) {
  for (let i = 0; i < novos.length && xs.length <= MAX_OPCOES; i++) if (xs.indexOf(novos[i]) < 0) xs.push(novos[i]);
}
function unirDoTermo(xs, e) {
  if (typeof e === 'number') { const x = e >> 8; if (xs.length <= MAX_OPCOES && xs.indexOf(x) < 0) xs.push(x); return; }
  for (let i = 2; i < e.length && xs.length <= MAX_OPCOES; i += 2) if (xs.indexOf(e[i]) < 0) xs.push(e[i]);
}
function soDigitos(n) {
  for (let i = 0; i < n.length; i++) { const c = n.charCodeAt(i); if (c < 48 || c > 57) return false; }
  return true;
}

// ── 🧭 o leitor ───────────────────────────────────────────────────────────
function criarLeitor(catalogo, opcoes) {
  const op = opcoes && typeof opcoes === 'object' ? opcoes : {};
  const idioma = typeof op.idioma === 'string' ? op.idioma : 'pt';
  const cat = catalogo && typeof catalogo === 'object' && !catalogo.erro ? catalogo : {};
  const jogoOp = op.jogo && typeof op.jogo === 'object' ? op.jogo : null;
  const modelo = String((jogoOp && jogoOp.modelo) || (cat.jogo && cat.jogo.modelo) || 'generico');
  const girias = op.girias ? montarGirias(op.girias) : GIRIAS_PADRAO;
  const lista = Array.isArray(cat.itens) ? cat.itens : [];

  // os itens, por número interno
  const ids = [], tipos = [], mostrar = [], donos = [], raridades = [], naoTem = [];
  const porId = new Map();
  // termo exato (palavras normalizadas, separadas por espaço) → inteiro empacotado (um
  // item) ou [p, k, item, como, item, como…] (vários); veja empacotar()
  // p = prioridade: 0 «seus» (o streamer ensinou), 1 nome/antigo/apelido,
  // 2 variante (sem artigo, depois dos dois-pontos, palavras juntas); k = nº de palavras
  const exatos = new Map();
  const cjkExatos = new Map();   // nome japonês/chinês (sem espaço) → como em `exatos`
  const cjkTamanhos = new Set(); // tamanhos que existem: a busca tenta só esses em cada posição
  // Palavras dos nomes por número: o mesmo número serve às palavras significativas, às
  // âncoras e ao começo das expressões — uma consulta por palavra, não uma por mapa, e
  // o que se sabe de cada palavra (vazia, comum…) é visto uma vez só.
  const dic = new Map();         // palavra → número
  const textoDe = [];            // número → palavra
  const palItens = [];           // número → item (número) ou itens (lista) que a têm como palavra significativa
  const ordemSig = [];           // as palavras significativas, na ordem em que apareceram
  const crescer = (arr, min) => { const novo = new arr.constructor(Math.max(min + 1, arr.length * 2)); novo.set(arr); return novo; };
  let marcas = new Uint8Array(4096); // número → P_VAZIA | P_ANCORA | P_SIGNIFICATIVA
  let maxPal = new Uint8Array(4096); // número → maior expressão que começa com a palavra
  function numPalavra(p) {
    let w = dic.get(p);
    if (w !== undefined) return w;
    w = textoDe.length;
    dic.set(p, w);
    textoDe.push(p);
    palItens.push(undefined);
    if (w >= marcas.length) { marcas = crescer(marcas, w); maxPal = crescer(maxPal, w); }
    const vazia = VAZIAS.has(p), cheia = p.length >= 3 && !vazia;
    marcas[w] = (vazia ? P_VAZIA : 0) | (cheia ? P_ANCORA : 0) | (cheia && !COMUNS.has(p) && !soDigitos(p) ? P_SIGNIFICATIVA : 0);
    return w;
  }
  const numeros = (ns) => { const ws = new Array(ns.length); for (let i = 0; i < ns.length; i++) ws[i] = numPalavra(ns[i]); return ws; };
  const palDe = (p) => { const w = dic.get(p); return w === undefined ? undefined : palItens[w]; };
  // Âncoras dos nomes de várias palavras: «arrogance» na posição 1 de um nome
  // de 2 palavras → «dark arrogance». O erro de digitação numa expressão é
  // procurado só onde uma das palavras bate certinho.
  // Ficam em listas corridas (palavra, código = nº de palavras × 9 + posição, termo),
  // agrupadas uma vez no fim: meio milhão de inserções num Map grande eram a parte
  // mais cara da montagem.
  const termos = [];             // termos de várias palavras, por número
  let ancN = 0, ancW = new Int32Array(4096), ancC = new Uint8Array(4096), ancT = new Int32Array(4096);

  function registrar(mapa, chave, k, x, como, p) {
    const e = mapa.get(chave);
    if (e === undefined) {
      mapa.set(chave, empacotar(p, k, x, como));
      return true;
    }
    if (typeof e === 'number') {
      const pe = e & 3, xe = e >> 8;
      if (p > pe || (p === pe && xe === x)) return false;
      mapa.set(chave, p < pe ? empacotar(p, k, x, como) : [p, k, xe, (e >> 6) & 3, x, como]);
      return false;
    }
    if (p > e[0]) return false;
    if (p < e[0]) { e.length = 2; e[0] = p; e.push(x, como); return false; }
    for (let i = 2; i < e.length; i += 2) if (e[i] === x) return false;
    e.push(x, como);
    return false;
  }
  // primeira vez que um termo de várias palavras aparece: âncoras (ws = os números
  // das palavras, se já foram vistos; senão, vê agora)
  function novoTermo(chave, ns, ws) {
    const k = ns.length;
    if (k === 1) return;
    if (!ws) ws = numeros(ns);
    const w0 = ws[0];
    if (maxPal[w0] < k) maxPal[w0] = k;
    const t = termos.length;
    termos.push(chave);
    for (let j = 0; j < k; j++) {
      const w = ws[j];
      if (!(marcas[w] & P_ANCORA)) continue;
      if (ancN === ancW.length) { ancW = crescer(ancW, ancN); ancC = crescer(ancC, ancN); ancT = crescer(ancT, ancN); }
      ancW[ancN] = w;
      ancC[ancN] = k * 9 + j; // k ≤ 8, j < k: cabe em 0–80
      ancT[ancN] = t;
      ancN++;
    }
  }
  function registrarSeq(ns, x, como, p, ws) {
    if (!ns.length || ns.length > MAX_PALAVRAS) return;
    if (ns.every((n) => VAZIAS.has(n))) return; // palavra vazia nunca casa sozinha
    const chave = ns.length === 1 ? ns[0] : ns.join(' ');
    if (registrar(exatos, chave, ns.length, x, como, p)) novoTermo(chave, ns, ws);
  }
  function registrarJunto(ns, x, como) { // «ghost face» também como «ghostface»
    if (ns.length < 2 || ns.length > 3 || ns.every((n) => VAZIAS.has(n))) return;
    const j = ns.join('');
    if (j.length >= 4) registrar(exatos, j, 1, x, como, 2);
  }
  function registrarCjk(ts, x, como, p) {
    const termo = ts.map((t) => t.n).join('');
    if (Array.from(termo).length < 2 || termo.length > MAX_CJK) return; // 2+ caracteres
    if (registrar(cjkExatos, termo, 1, x, como, p)) cjkTamanhos.add(termo.length);
  }
  function significativas(ws, x) {
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      if (!(marcas[w] & P_SIGNIFICATIVA)) continue;
      const l = palItens[w];
      if (l === undefined) { palItens[w] = x; ordemSig.push(w); }
      else if (typeof l === 'number') { if (l !== x) palItens[w] = [l, x]; }
      else if (l[l.length - 1] !== x) l.push(x);
    }
  }
  // nome sem japonês/chinês: só as palavras; com, as palavras com a escrita de cada uma
  function palavras(texto) {
    if (!RE_TEM_CJK.test(texto)) return palavrasDoNome(texto, girias);
    return tokenizar(texto, girias).filter((t) => !t.cjk).map((t) => t.n);
  }
  function indexarNome(texto, x, como) {
    let ns;
    if (RE_TEM_CJK.test(texto)) {
      const ts = tokenizar(texto, girias);
      if (!ts.length) return;
      if (ts.some((t) => t.cjk)) { registrarCjk(ts, x, como, 1); return; }
      ns = ts.map((t) => t.n);
    } else {
      ns = palavrasDoNome(texto, girias);
      if (!ns.length) return;
    }
    const ws = numeros(ns);
    registrarSeq(ns, x, como, 1, ws);
    significativas(ws, x);
    const bases = [ns], numerosDe = [ws];
    if (RE_APOSTROFO.test(texto)) { // «Nurse's Calling» também como «nurses calling» (quem não digita o apóstrofo)
      const alt = palavras(texto.replace(RE_APOSTROFOS, ''));
      if (alt.length && alt.join(' ') !== ns.join(' ')) {
        const wa = numeros(alt);
        bases.push(alt); numerosDe.push(wa);
        registrarSeq(alt, x, como, 2, wa);
        significativas(wa, x);
      }
    }
    const dp = texto.lastIndexOf(':');
    if (dp >= 0) { // «Scourge Hook: Pain Resonance» também como «pain resonance»
      const depois = palavras(texto.slice(dp + 1));
      if (depois.length && depois.length < ns.length) { bases.push(depois); numerosDe.push(null); registrarSeq(depois, x, como, 2, null); }
    }
    for (let i = 0; i < bases.length; i++) {
      const b = bases[i], wb = numerosDe[i];
      const semArtigo = b.length >= 2 && ARTIGOS.has(b[0]) ? b.slice(1) : null;
      if (semArtigo) registrarSeq(semArtigo, x, como, 2, wb && wb.slice(1));
      registrarJunto(b, x, como);
      if (semArtigo) registrarJunto(semArtigo, x, como);
    }
  }
  function indexarApelido(texto, x, como, p) {
    let ns;
    if (RE_TEM_CJK.test(texto)) {
      const ts = tokenizar(texto, girias);
      if (!ts.length) return;
      if (ts.some((t) => t.cjk)) { registrarCjk(ts, x, como, p); return; }
      ns = ts.map((t) => t.n);
    } else {
      ns = palavrasDoNome(texto, girias);
      if (!ns.length) return;
    }
    registrarSeq(ns, x, como, p, null);
    registrarJunto(ns, x, como);
  }

  for (const it of lista) {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || !it.id || porId.has(it.id)) continue;
    const x = ids.length;
    porId.set(it.id, x);
    ids.push(it.id);
    tipos.push(typeof it.tipo === 'string' ? it.tipo : '');
    mostrar.push(nomeParaMostrar(it.nomes, idioma, it.id));
    donos.push(typeof it.dono === 'string' ? it.dono : null);
    raridades.push(typeof it.raridade === 'string' ? it.raridade : null);
    naoTem.push(it.naoTenho === true);
    const nomes = it.nomes && typeof it.nomes === 'object' ? textosDe(Object.values(it.nomes), 20) : [];
    for (const s of nomes) indexarNome(s, x, COMO_NOME);
    for (const s of textosDe(it.antigos, MAX_TEXTOS_ITEM)) indexarNome(s, x, COMO_ANTIGO);
    for (const s of textosDe(it.apelidos, MAX_TEXTOS_ITEM)) indexarApelido(s, x, COMO_APELIDO, 1);
    for (const s of textosDe(it.seus, MAX_TEXTOS_ITEM)) indexarApelido(s, x, COMO_SEU, 0);
  }

  // ⚓ âncoras agrupadas por palavra e, dentro dela, por código, na ordem em que
  // entraram (duas contagens estáveis: pelo código, depois pela palavra)
  const nPal = textoDe.length;
  const ancIni = new Int32Array(nPal + 1);
  const ancCod = new Uint8Array(ancN), ancTermo = new Int32Array(ancN);
  {
    const porCod = new Int32Array(82);
    for (let i = 0; i < ancN; i++) porCod[ancC[i] + 1]++;
    for (let c = 0; c < 81; c++) porCod[c + 1] += porCod[c];
    const ordem = new Int32Array(ancN);
    for (let i = 0; i < ancN; i++) ordem[porCod[ancC[i]]++] = i;
    for (let i = 0; i < ancN; i++) ancIni[ancW[i] + 1]++;
    for (let w = 0; w < nPal; w++) ancIni[w + 1] += ancIni[w];
    const cursor = ancIni.slice(0, nPal);
    for (let r = 0; r < ancN; r++) { const i = ordem[r], d = cursor[ancW[i]]++; ancCod[d] = ancC[i]; ancTermo[d] = ancT[i]; }
  }
  ancW = ancC = ancT = null; // as listas de montagem já não servem

  // 🔤 vocabulário da busca aproximada: palavras soltas que já identificam algo
  // (nome/apelido de uma palavra só e palavras significativas), com 4+ letras.
  const aproximavel = (w) => w.length >= 4 && w.length <= MAX_APROX && !COMUNS.has(w) && !VAZIAS.has(w);
  // nome/apelido inteiro de uma palavra só (o termo exato de 1 palavra)
  const termoSolto = (w) => { const e = exatos.get(w); return e !== undefined && kDe(e) === 1 && aproximavel(w); };
  const vocab = [];
  exatos.forEach((e, w) => { if (kDe(e) === 1 && aproximavel(w)) vocab.push(w); });
  for (const w of ordemSig) { const p = textoDe[w]; if (p.length >= 4 && p.length <= MAX_APROX && !termoSolto(p)) vocab.push(p); }
  // trigrama → palavras do vocabulário, numa lista corrida só: `postIni[f]` é onde começa
  // a fatia do trigrama f em `postLista`. Duas passadas (conta, depois preenche) em vez
  // de milhões de push em milhares de listas que crescem — com 20 mil itens em 10
  // idiomas são ~3 milhões de entradas, e as listas pesavam na memória e na coleta de lixo.
  const vocabLen = new Uint8Array(vocab.length);
  let totalTri = 0;
  for (let v = 0; v < vocab.length; v++) { vocabLen[v] = vocab[v].length; totalTri += vocab[v].length + 2; }
  // trigrama → nº da fatia: tabela de espalhamento própria, de inteiros (endereçamento
  // aberto) — são ~3 milhões de consultas na montagem, e um Map pesava
  let triBits = 12, triChave = new Int32Array(1 << triBits).fill(-1), triFatia = new Int32Array(1 << triBits);
  function fatiaDoTri(t) {
    const masc = (1 << triBits) - 1;
    for (let i = Math.imul(t, 0x9e3779b1) >>> (32 - triBits); ; i = (i + 1) & masc) {
      const k = triChave[i];
      if (k === t) return triFatia[i];
      if (k === -1) return -1;
    }
  }
  function guardarTri(t, f) { // t ainda não está na tabela
    if ((f + 1) * 2 > triChave.length) { // metade cheia: dobra e espalha de novo
      const ck = triChave, cf = triFatia;
      triBits++;
      triChave = new Int32Array(1 << triBits).fill(-1);
      triFatia = new Int32Array(1 << triBits);
      for (let i = 0; i < ck.length; i++) if (ck[i] !== -1) guardarTri(ck[i], cf[i]);
    }
    const masc = (1 << triBits) - 1;
    let i = Math.imul(t, 0x9e3779b1) >>> (32 - triBits);
    while (triChave[i] !== -1) i = (i + 1) & masc;
    triChave[i] = t;
    triFatia[i] = f;
  }
  const fatiaDe = new Int32Array(totalTri); // a fatia de cada trigrama do vocabulário, em ordem
  const contas = [];
  for (let v = 0, q = 0; v < vocab.length; v++) {
    const w = vocab[v];
    let a = 1, b = 1; // como em trigramas()
    for (let i = 0; i < w.length + 2; i++) {
      const c = i < w.length ? w.charCodeAt(i) & 1023 : 1;
      const tri = (a << 20) | (b << 10) | c;
      a = b; b = c;
      let f = fatiaDoTri(tri);
      if (f < 0) { f = contas.length; guardarTri(tri, f); contas.push(0); }
      contas[f]++;
      fatiaDe[q++] = f;
    }
  }
  const postIni = new Int32Array(contas.length + 1);
  for (let f = 0; f < contas.length; f++) postIni[f + 1] = postIni[f] + contas[f];
  const postLista = new Int32Array(totalTri);
  {
    const cursor = postIni.slice(0, contas.length);
    for (let v = 0, q = 0; v < vocab.length; v++) {
      for (let i = vocabLen[v] + 2; i > 0; i--) postLista[cursor[fatiaDe[q++]]++] = v;
    }
  }
  // 🔊 som → palavras do vocabulário: pares (som, palavra) numa lista corrida em ordem
  // de som e, dentro do mesmo som, de palavra (contagem estável em 3 passadas de 10 bits)
  let somN = 0, somH = new Int32Array(4096), somV = new Int32Array(4096);
  const poeSom = (h, v) => {
    if (somN === somH.length) { somH = crescer(somH, somN); somV = crescer(somV, somN); }
    somH[somN] = h; somV[somN] = v; somN++;
  };
  for (let v = 0; v < vocab.length; v++) {
    const w = vocab[v];
    const h1 = somFonetico(w, false);
    if (h1 >= 0) poeSom(h1, v);
    if (w.charCodeAt(0) === 104) { // começa com «h»
      const h2 = somFonetico(w, true);
      if (h2 >= 0 && h2 !== h1) poeSom(h2, v);
    }
  }
  const somChave = new Int32Array(somN), somPal = new Int32Array(somN);
  {
    let ord = new Int32Array(somN), aux = new Int32Array(somN);
    for (let i = 0; i < somN; i++) ord[i] = i;
    const cont = new Int32Array(1025);
    for (let desl = 0; desl < 29; desl += 10) {
      cont.fill(0);
      for (let i = 0; i < somN; i++) cont[((somH[ord[i]] >>> desl) & 1023) + 1]++;
      for (let b = 0; b < 1024; b++) cont[b + 1] += cont[b];
      for (let i = 0; i < somN; i++) { const e = ord[i]; aux[cont[(somH[e] >>> desl) & 1023]++] = e; }
      const t = ord; ord = aux; aux = t;
    }
    for (let i = 0; i < somN; i++) { somChave[i] = somH[ord[i]]; somPal[i] = somV[ord[i]]; }
  }
  somH = somV = null; // as listas de montagem já não servem
  const contagem = new Uint16Array(vocab.length);
  // itens de uma palavra do vocabulário: o nome/apelido inteiro vale mais que a palavra do nome
  const unirDoVocab = (xs, v) => {
    const w = vocab[v];
    if (termoSolto(w)) unirDoTermo(xs, exatos.get(w));
    else unirLimitado(xs, listaDe(palDe(w)));
  };

  // 🎨 add-ons de cada killer, com raridade (o dono pode ser o killer ou o poder dele)
  const addonsPorKiller = new Map();
  if (modelo === 'dbd') {
    for (let x = 0; x < ids.length; x++) {
      if (tipos[x] !== 'addon' || !raridades[x]) continue;
      let d = donos[x] !== null ? porId.get(donos[x]) : undefined;
      if (d !== undefined && tipos[d] === 'poder') d = donos[d] !== null ? porId.get(donos[d]) : undefined;
      if (d === undefined || tipos[d] !== 'killer') continue;
      const l = addonsPorKiller.get(d);
      if (l) l.push(x); else addonsPorKiller.set(d, [x]);
    }
  }

  // ── 📖 leitura ──
  function ler(texto) {
    const base = prepararBase(texto);
    const tokens = tokenizar(base, girias);
    const N = tokens.length;
    const usado = new Int32Array(N).fill(-1); // achado que ficou com a palavra (-1 = livre)
    const achados = [];
    const cjkUsos = new Map(); // palavra CJK → pedaços usados [[a, b], …]
    const estado = { gasto: 0, comparacoes: 0 };
    const cache = new Map();

    const livres = (ini, fim) => {
      for (let k = ini; k < fim; k++) if (usado[k] >= 0 || tokens[k].cjk) return false;
      return true;
    };
    const marcar = (ini, fim, idx) => { for (let k = ini; k < fim; k++) usado[k] = idx; };
    const inicio = (a) => (a.a !== undefined ? a.a : tokens[a.ini].s);

    function novoItem(x, ini, fim, certeza, como, a, b) {
      // palavra vizinha do mesmo item («pain resonanse») vira um trecho só
      if (a === undefined && ini > 0 && usado[ini - 1] >= 0) {
        const viz = achados[usado[ini - 1]];
        if (!viz.duvida && viz.x === x && viz.fim === ini && viz.a === undefined) {
          viz.fim = fim;
          if (certeza === 'alta') viz.certeza = 'alta';
          marcar(ini, fim, usado[ini - 1]);
          return;
        }
      }
      const idx = achados.length;
      achados.push({ duvida: false, x, ini, fim, certeza, como, a, b });
      if (a === undefined) marcar(ini, fim, idx);
    }
    function novaDuvida(xs, total, ini, fim, motivo, a, b) {
      const idx = achados.length;
      achados.push({ duvida: true, xs, total, ini, fim, motivo, a, b });
      if (a === undefined) marcar(ini, fim, idx);
    }
    function deExato(e, ini, fim, a, b) {
      if (typeof e === 'number') return novoItem(e >> 8, ini, fim, 'alta', COMOS[(e >> 6) & 3], a, b);
      if (e.length === 4) return novoItem(e[2], ini, fim, 'alta', COMOS[e[3]], a, b);
      // dúvida: guarda só as opções que vão sair (o total entra na certeza)
      let apelido = false;
      const xs = [];
      for (let i = 2; i < e.length; i += 2) {
        if (e[i + 1] >= COMO_APELIDO) apelido = true;
        if (xs.length < MAX_OPCOES) xs.push(e[i]);
      }
      novaDuvida(xs, (e.length - 2) / 2, ini, fim, apelido ? 'apelido em mais de um item' : 'nome em mais de um item', a, b);
    }
    function deAproximado(xs, ini, fim, como, motivo) {
      if (xs.length === 1) novoItem(xs[0], ini, fim, 'media', como);
      else if (xs.length > 1 && xs.length <= MAX_OPCOES) novaDuvida(xs, xs.length, ini, fim, motivo);
      // mais que isso é vago demais: a palavra fica na sobra
    }

    // 1) 🈶 japonês e chinês: sem espaço entre palavras → o nome inteiro como pedaço do
    //    texto. O índice guarda o nome sem a pontuação («呪術：破滅» → «呪術破滅»), então
    //    a busca corre por um trecho seguido do texto: as palavras vizinhas ligadas só
    //    por espaço ou pontuação de nome («：», «·», «・», hífen…) entram juntas, e as
    //    latinas e os números grudados também («DJボックス», «箱子7号») — esses só
    //    inteiros («7号» não casa dentro de «17号»). Em cada posição tenta só os
    //    tamanhos de nome que existem (no máximo 40): o custo não cresce com quantos
    //    nomes começam igual.
    if (cjkExatos.size) {
      for (let i = 0; i < N;) {
        let j = i + 1, temCjk = tokens[i].cjk;
        while (j < N && RE_PONTE_CJK.test(base.slice(tokens[j - 1].e, tokens[j].s))) { if (tokens[j].cjk) temCjk = true; j++; }
        if (temCjk) acharCjk(i, j);
        i = j;
      }
    }
    function acharCjk(i, j) {
      // o trecho como um texto só, sabendo de que palavra veio cada posição
      let s = '';
      const ini = [];
      for (let k = i; k < j; k++) { ini.push(s.length); s += tokens[k].n; }
      ini.push(s.length);
      const de = new Int32Array(s.length);
      for (let k = 0; k < j - i; k++) de.fill(k, ini[k], ini[k + 1]);
      const cands = [];
      for (let p = 0; p + 1 < s.length; p++) {
        if (!tokens[i + de[p]].cjk && p !== ini[de[p]]) continue; // latina/número só do começo
        for (const L of cjkTamanhos) {
          const q = p + L;
          if (q > s.length) continue;
          const k2 = de[q - 1];
          if (!tokens[i + k2].cjk && q !== ini[k2 + 1]) continue; // … até o fim
          const termo = s.slice(p, q);
          if (cjkExatos.has(termo)) cands.push([p, L, termo]);
        }
      }
      if (!cands.length) return;
      cands.sort((u, v) => v[1] - u[1] || u[0] - v[0]);
      const ocupado = new Uint8Array(s.length);
      // posição no texto original: exata dentro da palavra japonesa/chinesa que a
      // normalização não mudou de tamanho; senão, a palavra inteira
      const mapeia = (t) => t.cjk && t.e - t.s === t.n.length;
      for (const [p, len, termo] of cands) {
        let livre = true;
        for (let k = p; k < p + len; k++) if (ocupado[k]) { livre = false; break; }
        if (!livre) continue;
        ocupado.fill(1, p, p + len);
        const k1 = de[p], k2 = de[p + len - 1];
        const t1 = tokens[i + k1], t2 = tokens[i + k2];
        const idx = achados.length;
        deExato(cjkExatos.get(termo), i + k1, i + k2 + 1,
          mapeia(t1) ? t1.s + p - ini[k1] : t1.s, mapeia(t2) ? t2.s + p + len - ini[k2] : t2.e);
        for (let k = k1; k <= k2; k++) { // o que ficou com o achado: pedaço da japonesa/chinesa, latina inteira
          const t = tokens[i + k];
          if (!t.cjk) { usado[i + k] = idx; continue; }
          let usos = cjkUsos.get(i + k);
          if (!usos) cjkUsos.set(i + k, (usos = []));
          usos.push([Math.max(p, ini[k]) - ini[k], Math.min(p + len, ini[k + 1]) - ini[k]]);
        }
      }
    }

    // 2) 📛 nome/apelido inteiro: todas as sequências de 1 a 8 palavras, a mais longa primeiro
    {
      const cands = [];
      for (let i = 0; i < N; i++) {
        const t = tokens[i];
        if (t.cjk) continue;
        const w = dic.get(t.n);
        const max = Math.min((w !== undefined && maxPal[w]) || 1, N - i);
        let chave = t.n;
        for (let L = 1; L <= max; L++) {
          const u = tokens[i + L - 1];
          if (u.cjk) break;
          if (L > 1) chave += ' ' + u.n;
          const e = exatos.get(chave);
          if (e !== undefined) cands.push({ i, L, e, junto: 0 });
        }
        // «ghost face» escrito separado de um nome de uma palavra só («Ghostface»);
        // só palavras vazias juntas («com um» → «comum») não valem
        let junto = t.n, cheia = !VAZIAS.has(t.n);
        for (let L = 2; L <= 3 && i + L <= N; L++) {
          const u = tokens[i + L - 1];
          if (u.cjk) break;
          junto += u.n;
          if (!VAZIAS.has(u.n)) cheia = true;
          if (junto.length < 4 || !cheia) continue;
          const e = exatos.get(junto);
          if (e !== undefined && kDe(e) === 1) cands.push({ i, L, e, junto: 1 });
        }
      }
      cands.sort((u, v) => v.L - u.L || u.junto - v.junto || u.i - v.i);
      for (const c of cands) if (livres(c.i, c.i + c.L)) deExato(c.e, c.i, c.i + c.L);
    }

    // 🔢 quantas partidas (as palavras de um item achado não contam: «No One…»)
    const partidasPedidas = lerPartidas(tokens, usado);

    // 3) 🎨 cor de raridade perto de «addon» (as opções saem depois, quando se sabe o killer)
    const cores = [];
    if (modelo === 'dbd') {
      const posAddon = [];
      for (let i = 0; i < N; i++) if (tokens[i].n === 'addon') posAddon.push(i);
      if (posAddon.length) {
        for (let i = 0; i < N; i++) {
          if (usado[i] >= 0 || tokens[i].cjk) continue;
          const rar = CORES.get(tokens[i].n);
          if (!rar) continue;
          let perto = -1;
          for (const p of posAddon) { const d = Math.abs(p - i); if (d <= 3 && (perto < 0 || d < Math.abs(perto - i))) perto = p; }
          if (perto < 0) continue;
          let ini = Math.min(perto, i), fim = Math.max(perto, i) + 1;
          if (!livres(ini, fim)) { ini = i; fim = i + 1; } // o meio já é de outro item: fica só a cor
          const idx = achados.length;
          achados.push({ duvida: true, xs: [], total: 0, ini, fim, motivo: 'cor da raridade', cor: rar });
          marcar(ini, fim, idx);
          cores.push(idx);
        }
      }
    }

    const elegivel = (i) => {
      const t = tokens[i];
      // (já no vocabulário = já casou exato antes: nome de uma palavra ou palavra do nome)
      return usado[i] < 0 && !t.cjk && aproximavel(t.n) && !termoSolto(t.n) && palDe(t.n) === undefined && !soDigitos(t.n);
    };

    // 4) ✏️ erro de digitação numa expressão de várias palavras, ancorada numa
    //    palavra certa. Vem antes da palavra solta porque o trecho mais longo
    //    ganha: «trap fixs» é o apelido «trap fixa», não o «trap» de «Bear Trap».
    if (ancN) {
      const cands = [];
      const porExpressao = new Map(); // a mesma expressão repetida no texto é conferida uma vez
      for (let i = 0; i < N; i++) {
        if (usado[i] >= 0 || tokens[i].cjk) continue;
        let q = tokens[i].n;
        for (let L = 2; L <= MAX_PALAVRAS && i + L <= N; L++) {
          const u = tokens[i + L - 1];
          if (usado[i + L - 1] >= 0 || u.cjk) break;
          q += ' ' + u.n;
          if (q.length - (L - 1) < 4) continue;
          let r = porExpressao.get(q);
          if (r === undefined) {
            r = expressaoAproximada(tokens, i, L, q, estado);
            porExpressao.set(q, r);
          }
          if (r) cands.push({ i, L, d: r.d, xs: r.xs });
        }
      }
      cands.sort((u, v) => v.L - u.L || u.d - v.d || u.i - v.i);
      for (const c of cands) {
        if (!livres(c.i, c.i + c.L)) continue;
        // com uma palavra do trecho que só existe nesse item («pain resonanse»), é alta
        let certa = false;
        if (c.xs.length === 1) for (let k = c.i; k < c.i + c.L && !certa; k++) certa = palDe(tokens[k].n) === c.xs[0];
        if (certa) novoItem(c.xs[0], c.i, c.i + c.L, 'alta', 'palavra');
        else deAproximado(c.xs, c.i, c.i + c.L, 'digitacao', 'erro de digitação');
      }
    }

    // 5) 🔑 palavra significativa que aponta para UM item só
    for (let i = 0; i < N; i++) {
      const t = tokens[i];
      if (usado[i] >= 0 || t.cjk || t.n.length < 3) continue;
      const x = palDe(t.n);
      if (typeof x === 'number') novoItem(x, i, i + 1, 'alta', 'palavra');
    }

    // 6) ✏️ erro de digitação numa palavra solta
    if (vocab.length) {
      for (let i = 0; i < N; i++) {
        if (!elegivel(i)) continue;
        const r = aproximada(tokens[i].n, cache, estado);
        if (r && r.xs.length) deAproximado(r.xs, i, i + 1, 'digitacao', 'erro de digitação');
      }
    }

    // 7) 🔊 som parecido
    if (somN) {
      const porSom = new Map();
      for (let i = 0; i < N; i++) {
        if (!elegivel(i)) continue;
        let xs = porSom.get(tokens[i].n);
        if (xs === undefined) {
          xs = [];
          const k = chaveFonetica(tokens[i].n, false);
          if (k) {
            const h = somFonetico(tokens[i].n, false);
            let j = 0;
            for (let b = somN; j < b;) { const m = (j + b) >> 1; if (somChave[m] < h) j = m + 1; else b = m; }
            for (; j < somN && somChave[j] === h && xs.length <= MAX_OPCOES; j++) {
              const v = somPal[j], w = vocab[v];
              if (chaveFonetica(w, false) === k || (w.charCodeAt(0) === 104 && chaveFonetica(w, true) === k)) unirDoVocab(xs, v);
            }
          }
          porSom.set(tokens[i].n, xs);
        }
        if (xs.length) deAproximado(xs, i, i + 1, 'som', 'som parecido');
      }
    }

    // 8) 🔑 palavra significativa de vários itens → dúvida. Vizinhas se juntam
    //    (o que têm em comum); grudada num item que está nas opções, vira dele
    //    («hook pain» → Pain Resonance, sem dúvida à toa).
    {
      let grupo = null;
      const fechar = () => {
        if (!grupo) return;
        const g = grupo;
        grupo = null;
        const esq = g.ini > 0 ? usado[g.ini - 1] : -1, dir = g.fim < N ? usado[g.fim] : -1;
        for (const lado of [esq, dir]) {
          if (lado < 0 || g.xs.length > MAX_INTERSECAO) continue;
          const viz = achados[lado];
          if (viz.duvida || viz.a !== undefined || g.xs.indexOf(viz.x) < 0) continue;
          if (lado === esq && viz.fim === g.ini) { viz.fim = g.fim; marcar(g.ini, g.fim, lado); return; }
          if (lado === dir && viz.ini === g.fim) { viz.ini = g.ini; marcar(g.ini, g.fim, lado); return; }
        }
        if (g.xs.length === 1) novoItem(g.xs[0], g.ini, g.fim, 'alta', 'palavra');
        else novaDuvida(g.xs, g.total, g.ini, g.fim, 'palavra em mais de um item');
      };
      for (let i = 0; i < N; i++) {
        const t = tokens[i];
        const xs = usado[i] < 0 && !t.cjk && t.n.length >= 3 ? palDe(t.n) : undefined;
        if (!Array.isArray(xs)) { fechar(); continue; } // lista = palavra de 2+ itens
        // vizinhas se juntam pelo que têm em comum (palavra em itens demais fica sozinha: custo)
        if (grupo && grupo.fim === i && xs.length <= MAX_INTERSECAO && grupo.xs.length <= MAX_INTERSECAO) {
          const conj = new Set(xs);
          const comum = grupo.xs.filter((x) => conj.has(x));
          if (comum.length) { grupo.xs = comum; grupo.total = comum.length; grupo.fim = i + 1; continue; }
        }
        fechar();
        grupo = { ini: i, fim: i + 1, xs, total: xs.length }; // a lista do índice: só é lida, nunca alterada
      }
      fechar();
    }

    // 🎨 opções das cores: os add-ons daquela raridade dos killers do pedido
    if (cores.length) {
      const killers = [];
      for (const a of achados) if (!a.duvida && tipos[a.x] === 'killer' && killers.indexOf(a.x) < 0) killers.push(a.x);
      const porCor = new Map(); // a mesma cor repetida usa a mesma lista
      for (const idx of cores) {
        const a = achados[idx];
        let xs = porCor.get(a.cor);
        if (xs === undefined) {
          xs = [];
          for (const r of a.cor) {
            for (const k of killers) {
              for (const x of addonsPorKiller.get(k) || []) {
                if (xs.length >= MAX_OPCOES_COR) break;
                if (raridades[x] === r && xs.indexOf(x) < 0) xs.push(x);
              }
            }
          }
          porCor.set(a.cor, xs);
        }
        a.xs = xs;
        a.total = xs.length;
      }
    }

    // ── 📤 resultado ──
    const ordem = achados.map((a, idx) => idx).sort((u, v) => inicio(achados[u]) - inicio(achados[v]) || u - v);
    const trecho = (a) => base.slice(a.a !== undefined ? a.a : tokens[a.ini].s, a.b !== undefined ? a.b : tokens[a.fim - 1].e).slice(0, 120);
    const itens = [], posItem = new Map();
    for (const idx of ordem) {
      const a = achados[idx];
      if (a.duvida) continue;
      const saida = { id: ids[a.x], tipo: tipos[a.x], nome: mostrar[a.x], trecho: trecho(a), certeza: a.certeza, como: a.como };
      if (naoTem[a.x]) saida.naoTenho = true;
      const ja = posItem.get(a.x);
      if (ja === undefined) { posItem.set(a.x, itens.length); itens.push(saida); } // o mesmo item duas vezes: fica um
      else if (a.certeza === 'alta' && itens[ja].certeza !== 'alta') itens[ja] = saida;
    }
    const duvidas = [];
    for (const idx of ordem) {
      const a = achados[idx];
      if (!a.duvida) continue;
      if (!a.cor && a.total <= a.xs.length && a.xs.every((x) => posItem.has(x))) continue; // todas as opções já estão nos itens
      const parte = a.cor ? 1 / Math.max(1, a.xs.length) : 1 / Math.max(1, a.total);
      const lim = a.cor ? MAX_OPCOES_COR : MAX_OPCOES;
      duvidas.push({
        trecho: trecho(a),
        opcoes: a.xs.slice(0, lim).map((x) => ({ id: ids[x], tipo: tipos[x], nome: mostrar[x], certeza: arred(parte) })),
        motivo: a.motivo,
      });
    }

    // sobra: as palavras do texto que não foram para item nem dúvida
    const partes = [];
    let ultS = -1, ultE = -1;
    for (let i = 0; i < N; i++) {
      const t = tokens[i];
      if (t.s === ultS && t.e === ultE) continue; // gíria que virou duas palavras («pfv» → «por favor»)
      ultS = t.s; ultE = t.e;
      if (t.cjk) {
        const usos = cjkUsos.get(i);
        if (!usos || !usos.length) { partes.push(base.slice(t.s, t.e)); continue; }
        if (t.e - t.s !== t.n.length) continue;
        usos.sort((u, v) => u[0] - v[0]);
        let p = 0;
        for (const [a, b] of usos) { if (a > p) partes.push(base.slice(t.s + p, t.s + a)); p = b; }
        if (p < t.n.length) partes.push(base.slice(t.s + p, t.e));
      } else if (usado[i] < 0) partes.push(base.slice(t.s, t.e));
    }

    return {
      itens,
      duvidas,
      citaCatalogo: itens.length > 0 || duvidas.length > 0,
      sobra: partes.join(' '),
      partidasPedidas,
      normalizado: tokens.map((t) => t.n).join(' '),
    };
  }

  // Erro de digitação de uma palavra: candidatos pelos trigramas em comum (o
  // mínimo que uma palavra com até k erros tem de ter), confirmados pela distância.
  function aproximada(p, cache, estado) {
    if (cache.has(p)) return cache.get(p);
    let r = null;
    const lq = p.length;
    if (estado.gasto <= ORCAMENTO) {
      const tocados = [];
      for (const c of trigramas(p, [])) {
        const f = fatiaDoTri(c);
        if (f < 0) continue;
        const ini = postIni[f], fim = postIni[f + 1];
        estado.gasto += fim - ini;
        for (let k = ini; k < fim; k++) {
          const v = postLista[k], lv = vocabLen[v];
          if (lv > lq + 2 || lv + 2 < lq) continue;
          if (contagem[v]++ === 0) tocados.push(v);
        }
      }
      let melhor = 3, vs = [];
      for (const v of tocados) {
        const lv = vocabLen[v], k = errosAceitos(lq, lv);
        if (k >= 0 && Math.abs(lq - lv) <= k && contagem[v] >= Math.max(lq, lv) + 2 - 4 * k && estado.comparacoes < MAX_COMPARACOES) {
          estado.comparacoes++;
          const d = distancia(p, vocab[v], Math.min(k, melhor));
          if (d > 0 && d <= k) {
            if (d < melhor) { melhor = d; vs = [v]; } else if (d === melhor) vs.push(v);
          }
        }
        contagem[v] = 0;
      }
      if (vs.length) {
        const xs = [];
        for (let i = 0; i < vs.length && xs.length <= MAX_OPCOES; i++) unirDoVocab(xs, vs[i]);
        r = { d: melhor, xs };
      }
    }
    cache.set(p, r);
    return r;
  }

  // Erro de digitação numa expressão de L palavras: só os nomes de L palavras com
  // uma palavra igual na mesma posição (a âncora); a menor distância ganha.
  function expressaoAproximada(tokens, i, L, q, estado) {
    if (estado.gasto > ORCAMENTO || estado.comparacoes >= MAX_COMPARACOES) return null;
    const letrasQ = q.length - (L - 1);
    const vistos = new Set();
    let melhor = 3, xs = null;
    for (let j = 0; j < L; j++) {
      const p = tokens[i + j].n;
      if (p.length < 3 || VAZIAS.has(p)) continue;
      const w = dic.get(p);
      if (w === undefined) continue;
      // a fatia da palavra está em ordem de código: busca binária pelo código (L, j)
      const cod = L * 9 + j;
      let a = ancIni[w], b = ancIni[w + 1];
      while (a < b) { const m = (a + b) >> 1; if (ancCod[m] < cod) a = m + 1; else b = m; }
      let fim = a;
      for (let c = ancIni[w + 1]; fim < c;) { const m = (fim + c) >> 1; if (ancCod[m] <= cod) fim = m + 1; else c = m; }
      estado.gasto += fim - a;
      for (let r = a; r < fim; r++) {
        const termo = termos[ancTermo[r]];
        if (vistos.has(termo)) continue;
        vistos.add(termo);
        const k = errosAceitos(letrasQ, termo.length - (L - 1));
        if (k < 0 || Math.abs(q.length - termo.length) > k) continue;
        if (++estado.comparacoes > MAX_COMPARACOES) break;
        const d = distancia(q, termo, Math.min(k, melhor));
        if (d === 0 || d > k || d > melhor) continue;
        if (d < melhor) { melhor = d; xs = []; }
        unirDoTermo(xs, exatos.get(termo));
      }
    }
    return xs && xs.length ? { d: melhor, xs } : null;
  }

  return { ler, total: ids.length, modelo };
}

// 🔢 «2x», «x3», «3 partidas», «duas partidas», «tres vezes»; sozinho, só o
// número por extenso de 2 a 10 que não fala de outra coisa («duas perks»).
function valorNumero(n) {
  if (/^\d{1,2}$/.test(n)) { const v = Number(n); return v >= 1 ? v : null; }
  return NUMEROS.has(n) ? NUMEROS.get(n) : null;
}
// qualquer número, zero inclusive: o outro lado de um placar («2 x 0», «2x 1»)
const ehNumero = (n) => /^\d+$/.test(n) || NUMEROS.has(n) || n === 'zero' || n === 'cero';
function lerPartidas(tokens, usado) {
  let fraco = null;
  for (let i = 0; i < tokens.length; i++) {
    if (usado[i] >= 0 || tokens[i].cjk) continue;
    const n = tokens[i].n;
    const prox = i + 1 < tokens.length ? tokens[i + 1].n : '';
    const m = /^(\d{1,2})x$/.exec(n) || /^x(\d{1,2})$/.exec(n);
    if (m) {
      const v = Number(m[1]);
      if (v >= 1 && !(n.endsWith('x') && ehNumero(prox))) return v; // «2x», mas não o placar «2x 1»
      continue;
    }
    const v = valorNumero(n);
    if (v === null) continue;
    if (n === 'dos' && !DEPOIS_DE_DOS.has(prox)) continue; // «um dos jogos» (pt) não é 2
    if (PALAVRAS_PARTIDA.has(prox)) return v;
    if (prox === 'x' && !(i + 2 < tokens.length && ehNumero(tokens[i + 2].n))) return v; // «2 x», mas não «2 x 1» nem «2 x 0»
    if (fraco === null && NUMEROS_SOZINHOS.has(n) && !COISAS.has(prox)) fraco = v;
  }
  return fraco;
}

// ── 🧩 regras de build (modelo dbd) ───────────────────────────────────────
// killer: até 4 perks, até 2 add-ons diferentes do poder dele, 1 oferenda;
// sobrevivente: até 4 perks, 1 item, até 2 add-ons desse item, 1 oferenda;
// perk só de um lado; add-on de outro killer é erro. Genérico: sem regra.
function validarBuild(itens, catalogo) {
  const problemas = [];
  const cat = catalogo && typeof catalogo === 'object' ? catalogo : {};
  if (!cat.jogo || cat.jogo.modelo !== 'dbd') return { ok: true, problemas };
  const lista = Array.isArray(itens) ? itens : (itens && Array.isArray(itens.itens) ? itens.itens : []);
  const pedidos = [];
  for (const it of lista.slice(0, 100)) {
    const id = typeof it === 'string' ? it : (it && typeof it.id === 'string' ? it.id : null);
    if (id) pedidos.push(id);
  }
  // acha no catálogo só o que precisa: os itens e os donos deles (add-on → poder → killer)
  const todos = Array.isArray(cat.itens) ? cat.itens : [];
  const achou = new Map();
  let procura = new Set(pedidos);
  for (let volta = 0; volta < 3 && procura.size; volta++) {
    for (const it of todos) if (it && procura.has(it.id) && !achou.has(it.id)) achou.set(it.id, it);
    const proxima = new Set();
    for (const id of procura) { const it = achou.get(id); if (it && typeof it.dono === 'string' && !achou.has(it.dono)) proxima.add(it.dono); }
    procura = proxima;
  }
  const add = (tipo, lista2, motivo) => problemas.push({ tipo, ids: [...new Set(lista2.map((it) => (typeof it === 'string' ? it : it.id)))], motivo });

  const desconhecidos = pedidos.filter((id) => !achou.has(id));
  if (desconhecidos.length) add('desconhecido', desconhecidos, 'item fora do catálogo');
  const vistos = new Set(), repetidos = [];
  for (const id of pedidos) { if (vistos.has(id)) repetidos.push(id); vistos.add(id); }
  if (repetidos.length) add('repetido', repetidos, 'o mesmo item aparece mais de uma vez');

  const unicos = [...vistos].filter((id) => achou.has(id)).map((id) => achou.get(id));
  const doTipo = (t) => unicos.filter((it) => it.tipo === t);
  const killers = doTipo('killer'), survs = doTipo('sobrevivente'), perks = doTipo('perk');
  const addons = doTipo('addon'), objetos = doTipo('item'), oferendas = doTipo('oferenda'), poderes = doTipo('poder');
  const donoDe = (it) => (it && typeof it.dono === 'string' ? achou.get(it.dono) : undefined);
  const ladoDaPerk = (p) => {
    if (p.lado === 'killer' || p.lado === 'sobrevivente') return p.lado;
    const d = donoDe(p);
    return d && (d.tipo === 'killer' || d.tipo === 'sobrevivente') ? d.tipo : null;
  };
  const donoDoAddon = (a) => { // o killer (direto ou pelo poder) ou o item de sobrevivente
    let d = donoDe(a);
    if (d && d.tipo === 'poder') d = donoDe(d);
    return d && (d.tipo === 'killer' || d.tipo === 'item') ? d : null;
  };

  if (killers.length && survs.length) add('lados', [...killers, ...survs], 'killer e sobrevivente no mesmo pedido');
  if (killers.length > 1) add('personagens', killers, 'mais de um killer no mesmo pedido');
  if (survs.length > 1) add('personagens', survs, 'mais de um sobrevivente no mesmo pedido');
  let lado = killers.length && !survs.length ? 'killer' : survs.length && !killers.length ? 'sobrevivente' : null;
  if (!killers.length && !survs.length) { // sem personagem: o lado pelo que veio
    if (objetos.length) lado = 'sobrevivente';
    else if (poderes.length || addons.some((a) => { const d = donoDoAddon(a); return d && d.tipo === 'killer'; })) lado = 'killer';
  }

  // perks
  if (perks.length > 4) add('perks', perks, 'mais de 4 perks');
  const perksK = perks.filter((p) => ladoDaPerk(p) === 'killer'), perksS = perks.filter((p) => ladoDaPerk(p) === 'sobrevivente');
  if (lado === 'killer' && perksS.length) add('perkLado', perksS, 'perk de sobrevivente com killer');
  else if (lado === 'sobrevivente' && perksK.length) add('perkLado', perksK, 'perk de killer com sobrevivente');
  else if (!lado && perksK.length && perksS.length) add('perkLado', [...perksK, ...perksS], 'perks dos dois lados');

  // add-ons
  if (addons.length > 2) add('addons', addons, 'mais de 2 add-ons');
  const deOutroKiller = [], doOutroLado = [], deOutroItem = [];
  for (const a of addons) {
    const d = donoDoAddon(a);
    if (!d) continue;
    if (lado === 'killer') {
      if (d.tipo === 'killer' && killers.length && !killers.includes(d)) deOutroKiller.push(a);
      else if (d.tipo === 'item') doOutroLado.push(a);
    } else if (lado === 'sobrevivente') {
      if (d.tipo === 'killer') doOutroLado.push(a);
      else if (objetos.length && !objetos.includes(d)) deOutroItem.push(a);
    }
  }
  if (deOutroKiller.length) add('addonDeOutroKiller', deOutroKiller, 'add-on de outro killer');
  if (!killers.length && lado === 'killer') { // sem killer no pedido: add-ons de dois killers não fecham
    const ks = new Set(addons.map((a) => donoDoAddon(a)).filter((d) => d && d.tipo === 'killer'));
    if (ks.size > 1) add('addonDeOutroKiller', addons, 'add-ons de killers diferentes');
  }
  if (doOutroLado.length) add('addonLado', doOutroLado, lado === 'killer' ? 'add-on de item de sobrevivente com killer' : 'add-on de killer com sobrevivente');
  if (deOutroItem.length) add('addonDeOutroItem', deOutroItem, 'add-on de outro item');
  if (lado === 'sobrevivente' && addons.length && !objetos.length) add('addonSemItem', addons, 'add-on sem o item');

  // item, oferenda, poder
  if (lado === 'killer' && objetos.length) add('itemNoKiller', objetos, 'killer não leva item');
  if (objetos.length > 1) add('itens', objetos, 'mais de 1 item');
  if (oferendas.length > 1) add('oferendas', oferendas, 'mais de 1 oferenda');
  const poderErrado = poderes.filter((p) => { const d = donoDe(p); return lado === 'sobrevivente' || (killers.length && d && d.tipo === 'killer' && !killers.includes(d)); });
  if (poderErrado.length) add('poderDeOutroKiller', poderErrado, lado === 'sobrevivente' ? 'poder de killer com sobrevivente' : 'poder de outro killer');

  return { ok: problemas.length === 0, problemas };
}

module.exports = {
  criarLeitor,
  normalizar,
  validarBuild,
  LIMITE_TEXTO,
  PALAVRAS_VAZIAS: Object.freeze([...VAZIAS]),
  GIRIAS,
};
