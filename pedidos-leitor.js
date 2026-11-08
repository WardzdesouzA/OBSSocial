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
const MAX_TEXTO_ITEM = 200;   // nome/apelido mais longo lido do catálogo
const MAX_TEXTOS_ITEM = 100;  // nomes/apelidos lidos por item

// ── 📚 listas (já na forma normalizada: minúsculas, sem acento) ───────────
// Palavras vazias: nunca casam sozinhas, nunca são «palavra significativa».
const VAZIAS = new Set((
  'a o as os um uma uns umas de do da dos das d em no na nos nas num numa com e ou para pra pro pras pros ' +
  'por pelo pela pelos pelas ao aos que se me te eu tu ele ela eles elas seu sua seus suas meu minha teu tua ' +
  'isso esse essa este esta isto mas so ja la ai aqui nao sim ' +
  'the an of and or to in on at for with by from as is it its this that my your his her our their i you he she ' +
  'we they be are was not ' +
  'el los las unos del y con en mi su al lo le les es muy sin ' +
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
  ['uno', 1], ['un', 1], ['dos', 2], ['cuatro', 4], ['siete', 7], ['ocho', 8], ['nueve', 9], ['diez', 10],
]);
// Número por extenso que vale sozinho («joga duas»). Fora: «um/uma/one/un/uno»
// (artigo: «um trapper») e «dos» (em português é «de + os»).
const NUMEROS_SOZINHOS = new Set('dois duas tres quatro cinco seis sete oito nove dez two three four five six seven eight nine ten cuatro siete ocho nueve diez'.split(' '));
const PALAVRAS_PARTIDA = new Set('partida partidas partidinha partidinhas jogo jogos jogada jogadas rodada rodadas game games match matches round rounds run runs vez vezes veces times juego juegos'.split(' '));
// «duas perks», «tres addons»: o número fala de outra coisa
const COISAS = new Set((
  'perk perks addon item itens items oferenda oferendas offering offerings killer killers survivor survivors ' +
  'surv survs sobrevivente sobreviventes personagem personagens build builds poder poderes power powers mapa mapas ' +
  'map maps gen gens gerador geradores generator generators hook hooks gancho ganchos real reais conto contos pila ' +
  'pilas dolar dolares dollar dollars minuto minutos minute minutes min segundo segundos hora horas kill kills hit ' +
  'hits totem totens totems token tokens pessoa pessoas amigo amigos'
).split(' '));

const COMOS = ['nome', 'antigo', 'apelido', 'seu'];
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

// 📱 telefone escrito nunca sai daqui (trecho e sobra podem ir para o painel)
const RE_TELEFONE = /\+?\d[\d\s().-]{6,}\d/g;
function taparTelefones(t) {
  if (!/\d/.test(t)) return t;
  return t.replace(RE_TELEFONE, (m) => (m.replace(/\D/g, '').length >= 8 ? ' 📱 ' : m));
}

const RE_ASCII = /^[\x00-\x7f]*$/;
function prepararBase(texto) {
  let t = cortar(paraTexto(texto));
  if (!RE_ASCII.test(t)) t = t.normalize('NFC'); // «e + acento» digitado separado vira uma letra só
  return taparTelefones(t);
}

// Palavra = letras/números/marcas, com apóstrofo no meio («nurse's»). O ponto
// do katakana fica dentro («ザ・トラッパー») e some na normalização.
const RE_PALAVRA = /[\p{L}\p{M}\p{N}・･]+(?:['’‘ʼ`´][\p{L}\p{M}\p{N}・･]+)*/gu;
const RE_TEM_CJK = /[々-〇぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿･-ﾟ]|[\ud840-\ud884][\udc00-\udfff]/;
function cpCjk(cp) {
  return (cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x4e00 && cp <= 0x9fff) || (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0x3005 && cp <= 0x3007) || (cp >= 0x31f0 && cp <= 0x31ff) || (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xff65 && cp <= 0xff9f) || (cp >= 0x20000 && cp <= 0x3134f);
}

const ESPECIAIS = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ı': 'i', 'þ': 'th', 'ð': 'd', 'ŀ': 'l' };
const RE_ESPECIAIS = /[ßæœøđłıþðŀ]/g;
const RE_REPETIDA_ASCII = /([a-z])\1\1+/g;
const RE_REPETIDA = /(\p{L})\1\1+/gu;
const RE_NAO_PALAVRA = /[^\p{L}\p{M}\p{N}]+/gu;

// minúsculas, sem acento, sem apóstrofo, letra repetida 3+ vezes vira uma
// («trapperrrr» → «trapper»). Caminho curto para texto só ASCII (o comum).
function normalizarPalavra(bruto) {
  let s;
  if (RE_ASCII.test(bruto)) {
    s = bruto.toLowerCase();
    if (s.indexOf("'") >= 0 || s.indexOf('`') >= 0) s = s.replace(/['`]/g, '');
    return s.replace(RE_REPETIDA_ASCII, '$1');
  }
  s = bruto.normalize('NFKC').toLowerCase().replace(RE_ESPECIAIS, (c) => ESPECIAIS[c]);
  // tira só os acentos latinos (0300–036F): o «゛» do japonês e o hangul se recompõem no NFC
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '').normalize('NFC');
  return s.replace(RE_NAO_PALAVRA, '').replace(RE_REPETIDA, '$1');
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
  const juntar = (de, para) => {
    if (typeof de !== 'string' || typeof para !== 'string') return;
    const d = palavrasSimples(de), p = palavrasSimples(para);
    if (!d.length || d.length > 3 || p.length > 3) return;
    const lista = mapa.get(d[0]) || [];
    const igual = lista.findIndex((g) => g.de.join(' ') === d.join(' '));
    if (igual >= 0) lista.splice(igual, 1); // a do streamer troca a padrão
    lista.push({ de: d, para: p });
    mapa.set(d[0], lista);
  };
  for (const [de, para] of Object.entries(GIRIAS)) juntar(de, para);
  if (extra && typeof extra === 'object') {
    const pares = Array.isArray(extra) ? extra : Object.entries(extra);
    for (const par of pares.slice(0, 500)) if (Array.isArray(par)) juntar(par[0], par[1]);
  }
  for (const lista of mapa.values()) lista.sort((a, b) => b.de.length - a.de.length);
  return mapa;
}

function aplicarGirias(lista, girias) {
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

const GIRIAS_PADRAO = montarGirias(null);

// Texto normalizado (o mesmo que o leitor usa): para o núcleo comparar
// palavras de pedido, apelidos e palavras bloqueadas do mesmo jeito.
function normalizar(texto, opcoes) {
  const girias = opcoes && opcoes.girias ? montarGirias(opcoes.girias) : GIRIAS_PADRAO;
  return tokenizar(prepararBase(texto), girias).map((t) => t.n).join(' ');
}

// ── 🔤 aproximação ────────────────────────────────────────────────────────
// Damerau-Levenshtein (transposição de vizinhas conta 1) com teto: para
// assim que a linha inteira passa do máximo. Linhas reaproveitadas.
let linhaA = new Int32Array(80), linhaB = new Int32Array(80), linhaC = new Int32Array(80);
function distancia(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (lb + 1 > linhaA.length) { const t = lb + 80; linhaA = new Int32Array(t); linhaB = new Int32Array(t); linhaC = new Int32Array(t); }
  let ant2 = linhaA, ant = linhaB, cur = linhaC;
  for (let j = 0; j <= lb; j++) ant[j] = j;
  for (let i = 1; i <= la; i++) {
    const ca = a.charCodeAt(i - 1), caAnt = i > 1 ? a.charCodeAt(i - 2) : -1;
    cur[0] = i;
    let menor = i;
    for (let j = 1; j <= lb; j++) {
      const cb = b.charCodeAt(j - 1);
      let v = ant[j - 1] + (ca === cb ? 0 : 1);
      if (ant[j] + 1 < v) v = ant[j] + 1;
      if (cur[j - 1] + 1 < v) v = cur[j - 1] + 1;
      if (j > 1 && ca === b.charCodeAt(j - 2) && caAnt === cb && ant2[j - 2] + 1 < v) v = ant2[j - 2] + 1;
      cur[j] = v;
      if (v < menor) menor = v;
    }
    if (menor > max) return max + 1;
    const t = ant2; ant2 = ant; ant = cur; cur = t;
  }
  return ant[lb];
}

// Erro aceito: 1 até 7 letras, 2 a partir de 8 (pela palavra menor), e nada
// abaixo de 4 letras.
function errosAceitos(la, lb) {
  const menor = la < lb ? la : lb;
  return menor < 4 ? -1 : menor >= 8 ? 2 : 1;
}

// Trigramas com duas bordas de cada lado, como número (cabe em 48 bits).
function trigramas(p, saida) {
  saida.length = 0;
  let a = 1, b = 1;
  for (let i = 0; i < p.length + 2; i++) {
    const c = i < p.length ? p.charCodeAt(i) : 1;
    saida.push(a * 4294967296 + b * 65536 + c);
    a = b; b = c;
  }
  return saida;
}

// 🔊 chave fonética simples PT/EN: consoantes com os dígrafos dos dois idiomas
// (ph→f, th→t, sh/ch→x, lh, nh, qu→k, c→s/k, g→j antes de e/i, gh mudo…), cada
// grupo de vogais vira «*», e o fim que some na fala (vogal final, «r» final)
// sai. «trapper» e «trépa» dão «tr*p»; «nightmare» e «naitmer» dão «n*tm».
// Só palavras latinas de 4+ letras e chaves com 3+ consoantes (menos que isso
// junta palavras demais).
const RE_LATINA = /^[a-z]+$/;
function chaveFonetica(p, hComoR) {
  if (p.length < 4 || p.length > MAX_APROX || !RE_LATINA.test(p)) return null;
  let s = p;
  if (s.length > 4 && s[0] === 'e' && s[1] === 's' && 'aeiouy'.indexOf(s[2]) < 0) s = s.slice(1); // «espirit» ≈ «spirit»
  let out = '', ult = '';
  const emite = (c) => { if (c !== ult) { out += c; ult = c; } };
  for (let i = 0; i < s.length; i++) {
    const c = s[i], d = s[i + 1] || '', d2 = s[i + 2] || '';
    switch (c) {
      case 'a': case 'e': case 'i': case 'o': case 'u': case 'y': emite('*'); break;
      case 'w': if (i === 0 && d === 'r') break; emite('*'); break;
      case 'h': if (i === 0 && hComoR) emite('r'); break; // mudo (o «h» inglês soa como «r» para quem fala português)
      case 'p': if (d === 'h') { emite('f'); i++; } else emite('p'); break;
      case 't': if (d === 'h') i++; emite('t'); break;
      case 's': if (d === 'h') { emite('x'); i++; } else emite('s'); break;
      case 'c':
        if (d === 'h') { emite('x'); i++; } else if (d === 'k') { emite('k'); i++; } else if (d === 'e' || d === 'i' || d === 'y') emite('s'); else emite('k');
        break;
      case 'q': emite('k'); if (d === 'u') i++; break;
      case 'k': if (i === 0 && d === 'n') break; emite('k'); break;
      case 'g':
        if (d === 'h') { if (i === 0) emite('g'); i++; } else if (i === 0 && d === 'n') { /* «gn» inicial: mudo */ } else if (d === 'e' || d === 'i' || d === 'y') emite('j'); else if (d === 'u' && (d2 === 'e' || d2 === 'i')) { emite('g'); i++; } else emite('g');
        break;
      case 'l': if (d === 'h') i++; emite('l'); break;
      case 'n': if (d === 'h') i++; emite('n'); break;
      case 'm': emite(!d || 'aeiouy'.indexOf(d) < 0 ? 'n' : 'm'); break; // nasal antes de consoante e no fim
      case 'z': emite('s'); break;
      default: emite(c);
    }
  }
  if (out.endsWith('*')) out = out.slice(0, -1);
  if (out.length > 2 && out.endsWith('r') && out[out.length - 2] === '*') out = out.slice(0, -2);
  let consoantes = 0;
  for (let i = 0; i < out.length; i++) if (out[i] !== '*') consoantes++;
  return consoantes >= 3 ? out : null;
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

const arred = (n) => Math.round(n * 100) / 100;

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
  // termo exato (palavras normalizadas, separadas por espaço) → { p, k, x: [itens], c: [como] }
  // p = prioridade: 0 «seus» (o streamer ensinou), 1 nome/antigo/apelido,
  // 2 variante (sem artigo, depois dos dois-pontos, palavras juntas)
  const exatos = new Map();
  const maxPalavras = new Map(); // primeira palavra → maior expressão que começa com ela
  const palavras = new Map();    // palavra significativa → itens que a têm no nome
  const cjkExatos = new Map();   // nome japonês/chinês (sem espaço) → como em `exatos`
  const cjkInicio = new Map();   // dois primeiros caracteres → nomes CJK

  function registrar(mapa, chave, k, x, como, p) {
    const e = mapa.get(chave);
    if (e === undefined) {
      mapa.set(chave, { p, k, x: [x], c: [como] });
      if (k > 1) { const prim = chave.slice(0, chave.indexOf(' ')); if ((maxPalavras.get(prim) || 1) < k) maxPalavras.set(prim, k); }
      return true;
    }
    if (p > e.p) return false;
    if (p < e.p) { e.p = p; e.x = [x]; e.c = [como]; return false; }
    if (e.x.indexOf(x) < 0) { e.x.push(x); e.c.push(como); }
    return false;
  }
  function registrarSeq(ns, x, como, p) {
    if (!ns.length || ns.length > MAX_PALAVRAS) return;
    if (ns.every((n) => VAZIAS.has(n))) return; // palavra vazia nunca casa sozinha
    registrar(exatos, ns.join(' '), ns.length, x, como, p);
  }
  function registrarJunto(ns, x, como) { // «ghost face» também como «ghostface»
    if (ns.length < 2 || ns.length > 3) return;
    const j = ns.join('');
    if (j.length >= 4) registrar(exatos, j, 1, x, como, 2);
  }
  function registrarCjk(ts, x, como, p) {
    const termo = ts.map((t) => t.n).join('');
    if (Array.from(termo).length < 2) return; // 2+ caracteres
    if (registrar(cjkExatos, termo, 1, x, como, p)) {
      const ini = termo.slice(0, 2);
      const l = cjkInicio.get(ini);
      if (l) l.push(termo); else cjkInicio.set(ini, [termo]);
    }
  }
  function significativas(ns, x) {
    for (const n of ns) {
      if (n.length < 3 || VAZIAS.has(n) || COMUNS.has(n) || !/\p{L}/u.test(n)) continue;
      const l = palavras.get(n);
      if (!l) palavras.set(n, [x]); else if (l[l.length - 1] !== x) l.push(x);
    }
  }
  function indexarNome(texto, x, como) {
    const ts = tokenizar(texto, girias);
    if (!ts.length) return;
    if (ts.some((t) => t.cjk)) { registrarCjk(ts, x, como, 1); return; }
    const ns = ts.map((t) => t.n);
    registrarSeq(ns, x, como, 1);
    significativas(ns, x);
    const bases = [ns];
    if (/['’‘ʼ`´]/.test(texto)) { // «L'Infirmière» também como «l infirmiere» (e, sem artigo, «infirmiere»)
      const alt = tokenizar(texto.replace(/['’‘ʼ`´]/g, ' '), girias).filter((t) => !t.cjk).map((t) => t.n);
      if (alt.length && alt.join(' ') !== ns.join(' ')) { bases.push(alt); registrarSeq(alt, x, como, 2); significativas(alt, x); }
    }
    const dp = texto.lastIndexOf(':');
    if (dp >= 0) { // «Scourge Hook: Pain Resonance» também como «pain resonance»
      const depois = tokenizar(texto.slice(dp + 1), girias).filter((t) => !t.cjk).map((t) => t.n);
      if (depois.length && depois.length < ns.length) { bases.push(depois); registrarSeq(depois, x, como, 2); }
    }
    for (const b of bases) {
      const semArtigo = b.length >= 2 && ARTIGOS.has(b[0]) ? b.slice(1) : null;
      if (semArtigo) registrarSeq(semArtigo, x, como, 2);
      registrarJunto(b, x, como);
      if (semArtigo) registrarJunto(semArtigo, x, como);
    }
  }
  function indexarApelido(texto, x, como, p) {
    const ts = tokenizar(texto, girias);
    if (!ts.length) return;
    if (ts.some((t) => t.cjk)) { registrarCjk(ts, x, como, p); return; }
    const ns = ts.map((t) => t.n);
    registrarSeq(ns, x, como, p);
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

  // 🔤 vocabulário da busca aproximada: palavras soltas que já identificam algo
  // (nome/apelido de uma palavra só e palavras significativas), com 4+ letras.
  const vocab = [], vocabTermo = [], vocabSignif = [];
  const vocabIdx = new Map();
  const noVocab = (w) => {
    let v = vocabIdx.get(w);
    if (v === undefined) { v = vocab.length; vocabIdx.set(w, v); vocab.push(w); vocabTermo.push(null); vocabSignif.push(null); }
    return v;
  };
  for (const [chave, e] of exatos) {
    if (e.k !== 1 || chave.length < 4 || chave.length > MAX_APROX || COMUNS.has(chave) || VAZIAS.has(chave)) continue;
    vocabTermo[noVocab(chave)] = e.x;
  }
  for (const [p, xs] of palavras) if (p.length >= 4 && p.length <= MAX_APROX) vocabSignif[noVocab(p)] = xs;
  const vocabLen = new Uint8Array(vocab.length);
  const postagens = new Map(); // trigrama → palavras do vocabulário
  const fonetica = new Map();  // chave fonética → palavras do vocabulário
  const buf = [];
  for (let v = 0; v < vocab.length; v++) {
    const w = vocab[v];
    vocabLen[v] = w.length;
    for (const c of trigramas(w, buf)) { const l = postagens.get(c); if (l) l.push(v); else postagens.set(c, [v]); }
    const k1 = chaveFonetica(w, false);
    if (k1) { const l = fonetica.get(k1); if (l) l.push(v); else fonetica.set(k1, [v]); }
    if (w[0] === 'h') {
      const k2 = chaveFonetica(w, true);
      if (k2 && k2 !== k1) { const l = fonetica.get(k2); if (l) l.push(v); else fonetica.set(k2, [v]); }
    }
  }
  const contagem = new Uint16Array(vocab.length);
  const itensDoVocab = (v) => vocabTermo[v] || vocabSignif[v] || [];

  // Âncoras dos nomes de várias palavras: «arrogance» na posição 1 de um
  // nome de 2 palavras → «dark arrogance». O erro de digitação numa expressão
  // é procurado só onde uma das palavras bate certinho.
  const ancoras = new Map();
  for (const [chave, e] of exatos) {
    if (e.k < 2) continue;
    const ps = chave.split(' ');
    for (let j = 0; j < ps.length; j++) {
      const p = ps[j];
      if (p.length < 3 || VAZIAS.has(p)) continue;
      const a = p + '\u0001' + ps.length + '\u0001' + j;
      const l = ancoras.get(a);
      if (l) l.push(chave); else ancoras.set(a, [chave]);
    }
  }

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
      if (e.x.length === 1) return novoItem(e.x[0], ini, fim, 'alta', COMOS[e.c[0]], a, b);
      const apelido = e.c.some((c) => c >= COMO_APELIDO);
      novaDuvida(e.x, e.x.length, ini, fim, apelido ? 'apelido em mais de um item' : 'nome em mais de um item', a, b);
    }
    function deAproximado(xs, ini, fim, como, motivo) {
      if (xs.length === 1) novoItem(xs[0], ini, fim, 'media', como);
      else if (xs.length > 1 && xs.length <= MAX_OPCOES) novaDuvida(xs, xs.length, ini, fim, motivo);
      // mais que isso é vago demais: a palavra fica na sobra
    }

    // 1) 🈶 japonês e chinês: sem espaço entre palavras → o nome inteiro como pedaço do texto
    if (cjkExatos.size) {
      for (let i = 0; i < N; i++) {
        const t = tokens[i];
        if (!t.cjk) continue;
        const s = t.n, cands = [];
        for (let p = 0; p + 1 < s.length; p++) {
          const l = cjkInicio.get(s.slice(p, p + 2));
          if (l) for (const termo of l) if (s.startsWith(termo, p)) cands.push([p, termo.length, termo]);
        }
        if (!cands.length) continue;
        cands.sort((u, v) => v[1] - u[1] || u[0] - v[0]);
        const ocupado = new Uint8Array(s.length);
        const mapeia = t.e - t.s === s.length; // dá para apontar o pedaço no texto original
        const usos = [];
        for (const [p, len, termo] of cands) {
          let livre = true;
          for (let k = p; k < p + len; k++) if (ocupado[k]) { livre = false; break; }
          if (!livre) continue;
          ocupado.fill(1, p, p + len);
          usos.push([p, p + len]);
          deExato(cjkExatos.get(termo), i, i + 1, mapeia ? t.s + p : t.s, mapeia ? t.s + p + len : t.e);
        }
        cjkUsos.set(i, usos);
      }
    }

    // 2) 📛 nome/apelido inteiro: todas as sequências de 1 a 8 palavras, a mais longa primeiro
    {
      const cands = [];
      for (let i = 0; i < N; i++) {
        const t = tokens[i];
        if (t.cjk) continue;
        const max = Math.min(maxPalavras.get(t.n) || 1, N - i);
        let chave = t.n;
        for (let L = 1; L <= max; L++) {
          const u = tokens[i + L - 1];
          if (u.cjk) break;
          if (L > 1) chave += ' ' + u.n;
          const e = exatos.get(chave);
          if (e !== undefined) cands.push({ i, L, e, junto: 0 });
        }
        // «ghost face» escrito separado de um nome de uma palavra só («Ghostface»)
        let junto = t.n;
        for (let L = 2; L <= 3 && i + L <= N; L++) {
          const u = tokens[i + L - 1];
          if (u.cjk) break;
          junto += u.n;
          if (junto.length < 4) continue;
          const e = exatos.get(junto);
          if (e !== undefined && e.k === 1) cands.push({ i, L, e, junto: 1 });
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

    // 4) 🔑 palavra significativa que aponta para UM item só
    for (let i = 0; i < N; i++) {
      const t = tokens[i];
      if (usado[i] >= 0 || t.cjk || t.n.length < 3) continue;
      const xs = palavras.get(t.n);
      if (xs && xs.length === 1) novoItem(xs[0], i, i + 1, 'alta', 'palavra');
    }

    const elegivel = (i) => {
      const t = tokens[i];
      return usado[i] < 0 && !t.cjk && t.n.length >= 4 && t.n.length <= MAX_APROX && !VAZIAS.has(t.n) &&
        !COMUNS.has(t.n) && !vocabIdx.has(t.n) && !/^\d+$/.test(t.n);
    };

    // 5) ✏️ erro de digitação numa expressão de várias palavras (ancorada numa palavra certa)
    if (ancoras.size) {
      const grupos = new Map(); // início/tamanho → { i, L, d, xs }
      for (let i = 0; i < N && estado.comparacoes < MAX_COMPARACOES; i++) {
        if (usado[i] >= 0 || tokens[i].cjk) continue;
        let q = tokens[i].n;
        for (let L = 2; L <= MAX_PALAVRAS && i + L <= N; L++) {
          const u = tokens[i + L - 1];
          if (usado[i + L - 1] >= 0 || u.cjk) break;
          q += ' ' + u.n;
          const letrasQ = q.length - (L - 1);
          if (letrasQ < 4) continue;
          const vistos = new Set();
          for (let j = 0; j < L; j++) {
            const p = tokens[i + j].n;
            if (p.length < 3 || VAZIAS.has(p)) continue;
            const l = ancoras.get(p + '\u0001' + L + '\u0001' + j);
            if (!l) continue;
            for (const termo of l) {
              if (vistos.has(termo)) continue;
              vistos.add(termo);
              const k = errosAceitos(letrasQ, termo.length - (L - 1));
              if (k < 0 || Math.abs(q.length - termo.length) > k) continue;
              if (++estado.comparacoes > MAX_COMPARACOES) break;
              const d = distancia(q, termo, k);
              if (d === 0 || d > k) continue;
              const chaveG = i * 16 + L;
              const g = grupos.get(chaveG);
              const xs = exatos.get(termo).x;
              if (!g || d < g.d) grupos.set(chaveG, { i, L, d, xs: xs.slice() });
              else if (d === g.d) for (const x of xs) if (g.xs.indexOf(x) < 0) g.xs.push(x);
            }
          }
        }
      }
      const cands = [...grupos.values()].sort((u, v) => v.L - u.L || u.d - v.d || u.i - v.i);
      for (const c of cands) if (livres(c.i, c.i + c.L)) deAproximado(c.xs, c.i, c.i + c.L, 'digitacao', 'erro de digitação');
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
    if (fonetica.size) {
      for (let i = 0; i < N; i++) {
        if (!elegivel(i)) continue;
        const k = chaveFonetica(tokens[i].n, false);
        const l = k && fonetica.get(k);
        if (!l) continue;
        const xs = [];
        for (const v of l) for (const x of itensDoVocab(v)) if (xs.indexOf(x) < 0) xs.push(x);
        deAproximado(xs, i, i + 1, 'som', 'som parecido');
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
          if (lado < 0) continue;
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
        const xs = usado[i] < 0 && !t.cjk && t.n.length >= 3 ? palavras.get(t.n) : undefined;
        if (!xs || xs.length < 2) { fechar(); continue; }
        if (grupo && grupo.fim === i) {
          const conj = new Set(xs);
          const comum = grupo.xs.filter((x) => conj.has(x));
          if (comum.length) { grupo.xs = comum; grupo.total = comum.length; grupo.fim = i + 1; continue; }
        }
        fechar();
        grupo = { ini: i, fim: i + 1, xs: xs.slice(), total: xs.length };
      }
      fechar();
    }

    // 🎨 opções das cores: os add-ons daquela raridade dos killers do pedido
    if (cores.length) {
      const killers = [];
      for (const a of achados) if (!a.duvida && tipos[a.x] === 'killer' && killers.indexOf(a.x) < 0) killers.push(a.x);
      for (const idx of cores) {
        const a = achados[idx], xs = [];
        for (const r of a.cor) for (const k of killers) for (const x of addonsPorKiller.get(k) || []) if (raridades[x] === r && xs.indexOf(x) < 0) xs.push(x);
        a.xs = xs.slice(0, MAX_OPCOES_COR);
        a.total = a.xs.length;
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
      if (!a.cor && a.xs.every((x) => posItem.has(x))) continue; // todas as opções já estão nos itens
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
        const l = postagens.get(c);
        if (!l) continue;
        estado.gasto += l.length;
        for (let k = 0; k < l.length; k++) {
          const v = l[k], lv = vocabLen[v];
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
        for (const v of vs) for (const x of itensDoVocab(v)) if (xs.indexOf(x) < 0) xs.push(x);
        r = { d: melhor, xs };
      }
    }
    cache.set(p, r);
    return r;
  }

  return { ler, total: ids.length, modelo };
}

// 🔢 «2x», «x3», «3 partidas», «duas partidas», «tres vezes»; sozinho, só o
// número por extenso de 2 a 10 que não fala de outra coisa («duas perks»).
function valorNumero(n) {
  if (/^\d{1,2}$/.test(n)) { const v = Number(n); return v >= 1 ? v : null; }
  return NUMEROS.has(n) ? NUMEROS.get(n) : null;
}
function lerPartidas(tokens, usado) {
  let fraco = null;
  for (let i = 0; i < tokens.length; i++) {
    if (usado[i] >= 0 || tokens[i].cjk) continue;
    const n = tokens[i].n;
    const m = /^(\d{1,2})x$/.exec(n) || /^x(\d{1,2})$/.exec(n);
    if (m) { const v = Number(m[1]); if (v >= 1) return v; continue; }
    const v = valorNumero(n);
    if (v === null) continue;
    const prox = i + 1 < tokens.length ? tokens[i + 1].n : '';
    if (PALAVRAS_PARTIDA.has(prox)) return v;
    if (prox === 'x' && !(i + 2 < tokens.length && valorNumero(tokens[i + 2].n) !== null)) return v; // «2 x», mas não «2 x 1»
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
