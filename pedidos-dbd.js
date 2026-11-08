// 🙋 Pedidos — adaptador do Dead by Daylight: o catálogo lido do site oficial.
//
// Lê deadbydaylight.com do jeito que uma pessoa leria, e só quando o servidor
// pede (clique em «🔄 Atualizar pelo site oficial», ou ao ligar os Pedidos com o
// DBD escolhido): nada roda sozinho em segundo plano. Lê o robots.txt (de novo a
// cada rodada, e obedece), o sitemap que ele indica e as páginas de personagem em
// inglês, português, francês, alemão e japonês. De cada página: o JSON-LD
// «Person» (nome traduzido, retrato, papel) e, do HTML servido, o poder e as
// perks (nome e ícone). Nada de dados internos do Gatsby (page-data), API não
// documentada, wiki ou central de ajuda; nada de descrição de perk ou de poder.
//
// O que manda no desenho:
// • uma requisição por vez, com pausa entre elas (também entre o fim de uma rodada e
//   o começo da seguinte), um User-Agent que diz quem é e o que faz, 20 s de tempo,
//   e a rodada PARA no primeiro 403/429/5xx: o site pediu para parar, então não
//   insiste nem contorna (com Retry-After, nenhuma rodada volta antes do prazo);
// • os idiomas se casam pelo hreflang da própria página (o slug muda: the-trapper
//   em inglês é o-cacador em português) e, de reserva, pelo arquivo do retrato;
//   poder e perks se casam pelo arquivo do ícone, que é o mesmo em todo idioma;
// • o catálogo é do streamer: tudo entra pelo mesclar (item travado e apelidos
//   «seus» ficam como estão); quem saiu da loja não está no site e não é inventado;
// • imagem só png/jpeg/webp/gif com a assinatura certa, até 5 MB (para de ler
//   acima), uma por vez, e nunca por cima de imagem que o streamer escolheu
//   (conferido de novo logo antes de gravar: a fase das imagens leva minutos);
// • o site é publicado inteiro de uma vez: sitemap igual (304, GET condicional)
//   quer dizer site igual, e a rodada não relê ~500 páginas à toa — desde que a
//   leitura anterior tenha lido todas as páginas e o robots seja o mesmo; sitemap
//   novo → relê tudo e compara os nomes (o mesclar conta o que mudou de verdade);
// • o que já foi lido nunca se perde: parou no meio (teto de páginas, 429,
//   cancelamento), o que chegou inteiro entra no catálogo e a rodada seguinte
//   começa de onde esta parou;
// • nada de regex que volta atrás sem limite: robots, sitemap e página são lidos
//   em tempo linear (o que vem do site pode estar quebrado ou ser hostil).
'use strict';
const crypto = require('crypto');
const { performance } = require('perf_hooks');
const { slug, tipoDaImagem, TETOS } = require('./pedidos-catalogo');

const SITE = 'https://deadbydaylight.com';
const HOST_SITE = 'deadbydaylight.com';
// imagens só destes dois: o próprio site (/static/ do Gatsby) e o CDN que o HTML aponta
const HOSTS_IMAGEM = new Set([HOST_SITE, 'assets.deadbydaylight.com']);
// Os idiomas que o site tem, com o caminho das páginas de personagem (conferido no
// sitemap). Espanhol, russo, turco, coreano e chinês não têm página: ficam sem nome
// próprio e o leitor cai no inglês.
const IDIOMAS_SITE = Object.freeze([
  Object.freeze({ codigo: 'en', hreflang: 'en', prefixo: '/game/characters/' }),
  Object.freeze({ codigo: 'pt', hreflang: 'pt-br', prefixo: '/pt-br/jogo/personagens/' }),
  Object.freeze({ codigo: 'fr', hreflang: 'fr', prefixo: '/fr/jeu/personnages/' }),
  Object.freeze({ codigo: 'de', hreflang: 'de', prefixo: '/de/spiel/charaktere/' }),
  Object.freeze({ codigo: 'ja', hreflang: 'ja', prefixo: '/ja/game/characters/' }),
]);
// inglês e português primeiro: se a rodada parar no meio, os mais usados já entraram
const ORDEM_IDIOMAS = Object.freeze(IDIOMAS_SITE.map((i) => i.codigo));

const PAUSA_PADRAO_MS = 1500;
const PAUSA_MINIMA_MS = 500;   // vale para a rede de verdade (fetch injetado é teste)
const PAUSA_MAXIMA_MS = 60000;
const TEMPO_MS = 20000;
const TETO_PAGINAS = 600;      // robots, sitemap e páginas de personagem, por rodada
const TETO_IMAGENS = 600;
const TETO_IMAGEM_BYTES = TETOS.imagemBytes; // 5 MB, o mesmo teto do catálogo
const TETO_HTML_BYTES = 4 * 1024 * 1024;     // a página de personagem tem ~600 KB
const TETO_SITEMAP_BYTES = 10 * 1024 * 1024;
const TETO_ROBOTS_BYTES = 512 * 1024;        // o que os buscadores leem; o resto é ignorado
const TETO_SITEMAPS = 10;
const TETO_SLIDES = 8;                       // poder + 3 perks; folga para página diferente
// Muda quando a leitura da página muda: a rodada seguinte relê tudo mesmo com sitemap igual
// (2: nomes sem caractere de formatação, chave só do mesmo dono)
const VERSAO_LEITURA = 2;
const TIPOS_IMAGEM = new Map([['image/png', 'png'], ['image/jpeg', 'jpg'], ['image/webp', 'webp'], ['image/gif', 'gif']]);
const ROBO = 'obs-social'; // o nome deste programa num «User-agent:» do robots.txt
const ACEITAR_HTML = 'text/html,application/xhtml+xml;q=0.9';
const ACEITAR_IMAGEM = 'image/png,image/jpeg,image/webp,image/gif';

const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*:[a-z0-9]+(?:-[a-z0-9]+)*$/;
// Controles e separadores de linha viram espaço. Os caracteres de formatação (Unicode «Cf»:
// marcas de direção — U+061C inclusive —, hífen invisível U+00AD, larguras zero, BOM, «tags»)
// somem: não aparecem na página, na tela viram truque e no meio da palavra a partem em duas
const RE_CONTROLES = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const RE_INVISIVEIS = /\p{Cf}/gu;
// o sufixo que o CMS do site põe no nome do arquivo (K01_The_Trapper_bd1ca1a3dc.png)
const RE_SUFIXO_CMS = /_[0-9a-f]{10}$/i;

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const hashCurto = (texto) => crypto.createHash('sha1').update(String(texto), 'utf8').digest('hex').slice(0, 12);

// ── 🔤 Texto do HTML ───────────────────────────────────────────────────────
// O React escapa só & < > " ' no texto servido; o resto vem literal.
const ENTIDADES = new Map([['amp', '&'], ['lt', '<'], ['gt', '>'], ['quot', '"'], ['apos', "'"], ['nbsp', ' '],
  ['lsquo', '‘'], ['rsquo', '’'], ['ldquo', '“'], ['rdquo', '”'], ['ndash', '–'], ['mdash', '—'], ['hellip', '…']]);
function decodificar(texto) {
  return String(texto).replace(/&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      if (!Number.isInteger(n) || n <= 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return m;
      return String.fromCodePoint(n);
    }
    const v = ENTIDADES.get(e.toLowerCase());
    return v === undefined ? m : v;
  });
}
// Nome que entra no catálogo: sem tag, sem invisível, um espaço só, até 120 (o teto do catálogo).
// A tag acaba no «>» ou no próximo «<» («<[^>]*>» lia até o fim do texto a cada «<» sem «>»:
// quadrático, e isso roda antes do corte de 120).
function limparNome(bruto, { html = false } = {}) {
  if (typeof bruto !== 'string') return '';
  let t = html ? decodificar(bruto.replace(/<[^<>]*>/g, ' ')) : bruto;
  t = t.replace(RE_INVISIVEIS, '').replace(RE_CONTROLES, ' ').replace(/\s+/g, ' ').trim();
  return t.length > 120 ? '' : t;
}
// Atributos de uma tag (<link rel=… hrefLang=…>): nomes em minúsculas, valores decodificados.
// O «=valor» é opcional no padrão para o nome ser lido inteiro uma vez só (exigir o «=» fazia
// o motor recuar letra por letra num nome comprido sem valor: quadrático numa tag enorme).
function atributos(tag) {
  const saida = new Map();
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let m;
  while ((m = re.exec(tag))) {
    const valor = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
    if (valor === undefined) continue; // nome sem valor (o da própria tag, «async»…)
    const nome = m[1].toLowerCase();
    if (!saida.has(nome)) saida.set(nome, decodificar(valor));
  }
  return saida;
}

// ── 🏷️ Tags sem regex que volta atrás ──────────────────────────────────────
// Cada «<nome» é achado uma vez e o «>» (ou o «</nome>») que o fecha também: linear no
// tamanho da página, que pode ter até 4 MB e vir quebrada. Sem fechamento, a busca acaba
// (depois dele não há outro fechado). O conteúdo de cada tag não é revisitado.
const abertura = (nome) => new RegExp(`<${nome}(?=[\\s/>])`, 'gi');
// O «</nome>» a partir de «de» → { inicio, fim } · null
function fechamento(texto, nome, de) {
  const re = new RegExp(`</${nome}\\s*>`, 'gi');
  re.lastIndex = de;
  const m = re.exec(texto);
  return m ? { inicio: m.index, fim: m.index + m[0].length } : null;
}
// As tags de abertura «<nome …>», em ordem: { inicio, fim (depois do «>»), tag }
function* tagsDe(texto, nome) {
  const re = abertura(nome);
  let m;
  while ((m = re.exec(texto))) {
    const fim = texto.indexOf('>', m.index + nome.length + 1);
    if (fim < 0) return;
    yield { inicio: m.index, fim: fim + 1, tag: texto.slice(m.index, fim + 1) };
    re.lastIndex = fim + 1;
  }
}
// Os blocos «<nome …>…</nome>» inteiros, em ordem
function blocosDe(texto, nome) {
  const saida = [];
  const re = abertura(nome);
  let m;
  while ((m = re.exec(texto))) {
    const f = fechamento(texto, nome, m.index + nome.length + 1);
    if (!f) break;
    saida.push(texto.slice(m.index, f.fim));
    re.lastIndex = f.fim;
  }
  return saida;
}
// O texto sem os blocos «<nome …>…</nome>» (bloco sem fechamento fica como está)
function semBlocos(texto, nome) {
  const partes = [];
  const re = abertura(nome);
  let pos = 0;
  let m;
  while ((m = re.exec(texto))) {
    const f = fechamento(texto, nome, m.index + nome.length + 1);
    if (!f) break;
    partes.push(texto.slice(pos, m.index));
    pos = f.fim;
    re.lastIndex = f.fim;
  }
  partes.push(texto.slice(pos));
  return partes.join('');
}
// O conteúdo do primeiro «<nome …>…</nome>» · null
function conteudoDe(texto, nome) {
  for (const t of tagsDe(texto, nome)) {
    const f = fechamento(texto, nome, t.fim);
    return f ? texto.slice(t.fim, f.inicio) : null;
  }
  return null;
}
function urlAbsoluta(valor, base) {
  if (typeof valor !== 'string' || !valor.trim() || /^data:/i.test(valor.trim())) return null;
  try {
    const u = new URL(valor.trim(), base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
  } catch { return null; }
}
// «…/K01_The_Trapper_bd1ca1a3dc.png» → «K01_The_Trapper»: igual em todo idioma, é a chave
function chaveDoArquivo(url) {
  if (!url) return null;
  let nome;
  try { nome = decodeURIComponent(new URL(url).pathname.split('/').pop() || ''); } catch { return null; }
  nome = nome.replace(RE_INVISIVEIS, '').replace(RE_CONTROLES, '').replace(/\.[a-z0-9]{2,5}$/i, '').replace(RE_SUFIXO_CMS, '').trim();
  return nome && nome.length <= 200 ? nome : null;
}

// ── 🤖 robots.txt ──────────────────────────────────────────────────────────
// Parser simples (RFC 9309): grupos de User-agent com Allow/Disallow; a regra mais
// longa vence e, no empate, Allow. Grupos do mesmo agente se somam (o robots do DBD
// repete «User-agent: *» a cada linha). Vale o grupo «*» E o de «OBS-Social», se
// houver: o caminho precisa passar nos dois. Crawl-delay, se houver, alonga a pausa.
function lerRobots(texto) {
  const grupos = [];
  const sitemaps = [];
  let atual = null;
  let lendoAgentes = false;
  for (const bruta of String(texto == null ? '' : texto).split(/\r\n|\r|\n/)) {
    const linha = bruta.replace(/#.*/, '').trim();
    const m = /^([A-Za-z][A-Za-z-]*)\s*:\s*(.*)$/.exec(linha);
    if (!m) continue;
    const campo = m[1].toLowerCase();
    const valor = m[2].trim();
    if (campo === 'user-agent') {
      if (!lendoAgentes) { atual = { agentes: [], regras: [], espera: null }; grupos.push(atual); lendoAgentes = true; }
      atual.agentes.push(valor.toLowerCase().split('/')[0].trim()); // «OBS-Social/1.0» vale como «OBS-Social»
    } else if (campo === 'allow' || campo === 'disallow') {
      lendoAgentes = false;
      // «Disallow:» vazio libera tudo; regra antes de qualquer User-agent não vale
      if (atual && valor) atual.regras.push({ permite: campo === 'allow', padrao: valor, ...compilarPadrao(valor) });
    } else if (campo === 'crawl-delay') {
      lendoAgentes = false;
      const n = Number(valor);
      if (atual && Number.isFinite(n) && n >= 0) atual.espera = n;
    } else if (campo === 'sitemap') {
      if (valor) sitemaps.push(valor);
    }
  }
  const juntar = (gs) => {
    if (!gs.length) return null;
    const esperas = gs.map((g) => g.espera).filter((n) => n !== null);
    return { regras: gs.flatMap((g) => g.regras), espera: esperas.length ? Math.max(...esperas) : null };
  };
  return {
    todos: juntar(grupos.filter((g) => g.agentes.includes('*'))),
    nosso: juntar(grupos.filter((g) => g.agentes.includes(ROBO))),
    sitemaps,
  };
}
const SEM_REGRAS = Object.freeze({ todos: null, nosso: null, sitemaps: Object.freeze([]) });

// RFC 9309 §2.2.2: caminho e padrão se comparam codificados. Fora do ASCII (e espaço,
// controle, aspas, < > \ ^ ` { | }) vira %XX do UTF-8; %xx fica em maiúsculas; %XX de letra,
// dígito ou -._~ volta a ser o caractere (é o mesmo endereço). Os dois lados passam pela
// mesma conta: o «Í» escrito no robots casa com o «%C3%8D» que o URL traz.
const ASCII_CODIFICADO = new Set(Array.from('"\'<>\\^`{|}', (c) => c.charCodeAt(0)));
const RE_PRECISA_CODIFICAR = /[^\x21-\x7e]|["'<>\\^`{|}%]/;
const ehHex = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);
const naoReservado = (b) => (b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 45 || b === 46 || b === 95 || b === 126;
function codificarCaminho(texto) {
  if (!RE_PRECISA_CODIFICAR.test(texto)) return texto;
  let saida = '';
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c === 37 && ehHex(texto.charCodeAt(i + 1)) && ehHex(texto.charCodeAt(i + 2))) {
      const b = parseInt(texto.slice(i + 1, i + 3), 16);
      saida += naoReservado(b) ? String.fromCharCode(b) : '%' + texto.slice(i + 1, i + 3).toUpperCase();
      i += 2;
    } else if (c > 32 && c < 127 && !ASCII_CODIFICADO.has(c)) {
      saida += texto[i];
    } else {
      const cp = texto.codePointAt(i);
      for (const b of Buffer.from(String.fromCodePoint(cp), 'utf8')) saida += '%' + (b < 16 ? '0' : '') + b.toString(16).toUpperCase();
      if (cp > 0xffff) i++;
    }
  }
  return saida;
}
// Padrão do robots → { partes (entre os «*»), fim («$»), tamanho (para «a mais longa vence») }
function compilarPadrao(padrao) {
  const cod = codificarCaminho(String(padrao));
  const fim = cod.endsWith('$');
  return { partes: (fim ? cod.slice(0, -1) : cod).split('*'), fim, tamanho: cod.length };
}
// Sem regex: a 1ª parte é o começo do caminho e cada parte seguinte é achada (indexOf) depois
// da anterior, na primeira vez que aparece — com só «*» de curinga, a mais à esquerda deixa
// mais espaço para as outras, então é a resposta certa. Linear por parte; a regex «.*»
// voltava atrás em cada estrela (5 estrelas e 100 letras: segundos; 10: não terminava).
function casaPadrao(p, caminho) {
  const { partes, fim } = p;
  if (!caminho.startsWith(partes[0])) return false;
  if (partes.length === 1) return !fim || caminho.length === partes[0].length;
  let pos = partes[0].length;
  for (let i = 1; i < partes.length - 1; i++) {
    if (!partes[i]) continue;
    const k = caminho.indexOf(partes[i], pos);
    if (k < 0) return false;
    pos = k + partes[i].length;
  }
  const ultima = partes[partes.length - 1];
  if (!fim) return !ultima || caminho.indexOf(ultima, pos) >= 0;
  return caminho.length - ultima.length >= pos && caminho.endsWith(ultima);
}
function permitePor(conjunto, caminho) {
  if (!conjunto) return true;
  let melhor = null;
  for (const r of conjunto.regras) {
    const p = Array.isArray(r.partes) ? r : compilarPadrao(r.padrao); // regra montada fora do lerRobots
    if (!casaPadrao(p, caminho)) continue;
    const n = p.tamanho;
    if (!melhor || n > melhor.n || (n === melhor.n && r.permite)) melhor = { n, permite: r.permite };
  }
  return !melhor || melhor.permite;
}
// robotsPermite(lerRobots(texto), url) → true/false
function robotsPermite(robots, url) {
  let u;
  try { u = url instanceof URL ? url : new URL(url); } catch { return false; }
  const r = robots || SEM_REGRAS;
  const caminho = codificarCaminho(u.pathname + u.search);
  return permitePor(r.todos, caminho) && permitePor(r.nosso, caminho);
}
// O que o robots decide sobre as páginas (as regras que valem para nós): se mudou, a leitura
// anterior pode ter deixado de fora o que agora é permitido, e o GET condicional não vale
function assinaturaRobots(r) {
  const regras = (c) => (c ? c.regras.map((x) => [x.permite ? 1 : 0, x.padrao]) : null);
  return hashCurto(JSON.stringify([regras(r.todos), regras(r.nosso)]));
}

// ── 🗺️ Sitemap ─────────────────────────────────────────────────────────────
function decodificarXml(t) { return decodificar(t).trim(); }
// { indice: true|false, locs: [...] } · null se não for sitemap
function lerSitemap(xml) {
  const texto = String(xml == null ? '' : xml);
  const indice = /<sitemapindex[\s>]/i.test(texto);
  if (!indice && !/<urlset[\s>]/i.test(texto)) return null;
  const locs = [];
  // «[^<]*» sozinho (os espaços das pontas saem no trim): «\s*([^<]*?)\s*» disputava os
  // mesmos espaços em três trechos e um «<loc>» sem «</loc>» custava tempo cúbico
  const re = /<loc>([^<]*)<\/loc>/gi;
  let m;
  while ((m = re.exec(texto))) locs.push(decodificarXml(m[1]));
  return { indice, locs };
}
// Uma URL do sitemap → { idioma, slug, url } se for página de personagem (só https do
// site, sem query; o slug só a-z, 0-9 e -): o resto do sitemap (notícias, capítulos, a
// entrada estranha «/[...]/») fica de fora.
function paginaDePersonagem(loc) {
  let u;
  try { u = new URL(loc); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== HOST_SITE || u.port || u.search || u.hash || u.username || u.password) return null;
  for (const idi of IDIOMAS_SITE) {
    if (!u.pathname.startsWith(idi.prefixo)) continue;
    const resto = u.pathname.slice(idi.prefixo.length).replace(/\/$/, '');
    if (resto.length > 100 || !RE_SLUG.test(resto)) return null;
    return { idioma: idi.codigo, slug: resto, url: u.href };
  }
  return null;
}
// As páginas de personagem de cada idioma, na ordem do sitemap e sem repetir
function paginasDasUrls(locs) {
  const saida = {};
  for (const c of ORDEM_IDIOMAS) saida[c] = [];
  const vistas = new Set();
  for (const loc of locs) {
    const p = paginaDePersonagem(loc);
    if (!p || vistas.has(`${p.idioma}:${p.slug}`)) continue;
    vistas.add(`${p.idioma}:${p.slug}`);
    saida[p.idioma].push(p);
  }
  return saida;
}
// paginasDoSitemap(xml) → { en: [{ idioma, slug, url }], pt: […], fr, de, ja } · null se não for sitemap
function paginasDoSitemap(xml) {
  const s = lerSitemap(xml);
  return s ? paginasDasUrls(s.locs) : null;
}

// ── 📄 Página de personagem ────────────────────────────────────────────────
// JSON-LD: o nó «Person» (dentro de @graph ou solto). É dado de SEO da própria página.
// Cada <script> é pulado inteiro até o </script> dele (o JavaScript de dentro não tem tag).
function acharPessoa(html) {
  const re = abertura('script');
  let m;
  while ((m = re.exec(html))) {
    const gt = html.indexOf('>', m.index + 7);
    if (gt < 0) return null;
    const f = fechamento(html, 'script', gt + 1);
    if (!f) return null;
    re.lastIndex = f.fim;
    const tipo = (atributos(html.slice(m.index, gt + 1)).get('type') || '').split(';')[0].trim().toLowerCase();
    if (tipo !== 'application/ld+json') continue;
    let dados;
    try { dados = JSON.parse(html.slice(gt + 1, f.inicio)); } catch { continue; } // JSON-LD quebrado: a página não serve
    const fila = [dados];
    for (let i = 0; i < fila.length && i < 200; i++) {
      const no = fila[i];
      if (Array.isArray(no)) { fila.push(...no.slice(0, 50)); continue; }
      if (!ehObjeto(no)) continue;
      const tipo = no['@type'];
      if (tipo === 'Person' || (Array.isArray(tipo) && tipo.includes('Person'))) return no;
      if (Array.isArray(no['@graph'])) fila.push(...no['@graph'].slice(0, 50));
    }
  }
  return null;
}
function primeiraImagem(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) { for (const x of v) { const s = primeiraImagem(x); if (s) return s; } return null; }
  if (ehObjeto(v)) return typeof v.url === 'string' ? v.url : typeof v.contentUrl === 'string' ? v.contentUrl : null;
  return null;
}
// «Role»: killer | survivor (o valor vem em inglês em todos os idiomas)
function papelDe(pessoa) {
  const props = Array.isArray(pessoa.additionalProperty) ? pessoa.additionalProperty : [];
  for (const p of props) {
    if (!ehObjeto(p) || typeof p.name !== 'string' || p.name.toLowerCase() !== 'role') continue;
    const v = typeof p.value === 'string' ? p.value.trim().toLowerCase() : '';
    if (v === 'killer') return 'killer';
    if (v === 'survivor') return 'survivor';
  }
  return null;
}
// <link rel="alternate" hrefLang="pt-br" href="https://deadbydaylight.com/pt-br/o-cacador">:
// o slug da mesma página em cada idioma (é o que casa the-trapper com o-cacador)
function lerAlternativos(html) {
  const saida = new Map();
  for (const t of tagsDe(html, 'link')) {
    const a = atributos(t.tag);
    if ((a.get('rel') || '').toLowerCase() !== 'alternate' || !a.has('hreflang')) continue;
    const lingua = a.get('hreflang').toLowerCase();
    if (saida.has(lingua)) continue;
    let u;
    try { u = new URL(a.get('href') || ''); } catch { continue; }
    if (u.hostname !== HOST_SITE) continue;
    const s = u.pathname.split('/').filter(Boolean).pop() || '';
    if (s.length <= 100 && RE_SLUG.test(s)) saida.set(lingua, s);
  }
  return saida;
}
// Corta um trecho nas aberturas de <div class="… swiper-slide …">
function fatias(trecho) {
  const inicios = [];
  for (const t of tagsDe(trecho, 'div')) {
    const cls = atributos(t.tag).get('class');
    if (cls && cls.split(/\s+/).includes('swiper-slide')) inicios.push(t.inicio);
  }
  return inicios.map((ini, i) => trecho.slice(ini, i + 1 < inicios.length ? inicios[i + 1] : trecho.length));
}
// O ícone de uma miniatura: a imagem principal do Gatsby (data-src: a página carrega
// depois) ou um <img> comum (os GIFs de poder vêm direto do CDN); nunca o data: de espera
function iconeDaFatia(fatia, base) {
  const semNoscript = semBlocos(fatia, 'noscript');
  const imgs = Array.from(tagsDe(semNoscript, 'img'), (t) => t.tag);
  for (const tag of imgs) {
    if (!/\sdata-main-image(?=[\s=/>])/i.test(tag)) continue;
    const a = atributos(tag);
    const u = urlAbsoluta(a.get('data-src'), base) || urlAbsoluta(a.get('src'), base);
    if (u) return u;
  }
  for (const tag of imgs) {
    const a = atributos(tag);
    if (a.get('aria-hidden') === 'true' || a.get('role') === 'presentation') continue;
    const u = urlAbsoluta(a.get('data-src'), base) || urlAbsoluta(a.get('src'), base);
    if (u) return u;
  }
  for (const t of tagsDe(fatia, 'img')) { // reserva: o <noscript>
    const u = urlAbsoluta(atributos(t.tag).get('src'), base);
    if (u) return u;
  }
  return null;
}
// O texto do rótulo (<div class="carousel-subtitle">…</div>) de um slide · null
function subtituloDe(fatia) {
  const i = fatia.search(/class="carousel-subtitle"/i);
  const gt = i >= 0 ? fatia.indexOf('>', i) : -1;
  if (gt < 0) return null;
  const f = fechamento(fatia, 'div', gt + 1);
  return f ? fatia.slice(gt + 1, f.inicio) : null;
}
// O carrossel «Power and perks» (killer) ou «Perks» (sobrevivente): as miniaturas
// (ícones) e as descrições vêm na mesma ordem; do texto só o rótulo e o nome (h3).
function lerCarrossel(html, base, papel) {
  let classe = null;
  let inicio = -1;
  for (const t of tagsDe(html, 'section')) {
    const cls = (atributos(t.tag).get('class') || '').split(/\s+/);
    if (cls.includes('powerperks-slider')) classe = 'powerperks-slider';
    else if (cls.includes('perks-slider')) classe = 'perks-slider';
    if (classe) { inicio = t.inicio; break; }
  }
  if (!classe) return [];
  const fimSecao = html.indexOf('</section>', inicio);
  const secao = html.slice(inicio, fimSecao > 0 ? fimSecao : undefined);
  const iMini = secao.indexOf('carousel-thumbs');
  const iDesc = secao.indexOf('carousel-description');
  const iPrev = secao.indexOf('carousel-preview');
  const desc = iDesc >= 0 ? secao.slice(iDesc, iPrev > iDesc ? iPrev : undefined) : secao;
  const minis = iMini >= 0 ? fatias(secao.slice(iMini, iDesc > iMini ? iDesc : undefined)) : [];
  let textos = fatias(desc);
  if (!textos.length) textos = blocosDe(desc, 'h3');
  const slides = [];
  textos.slice(0, TETO_SLIDES).forEach((f, k) => {
    const h3 = conteudoDe(f, 'h3');
    const nome = h3 !== null ? limparNome(h3, { html: true }) : '';
    const rot = subtituloDe(f);
    const icone = minis[k] ? iconeDaFatia(minis[k], base) : null;
    slides.push({ k, nome, rotulo: rot !== null ? limparNome(rot, { html: true }) : '', icone, chave: chaveDoArquivo(icone) });
  });
  // Poder × perk sem depender da língua: as perks dividem o mesmo rótulo (o do último
  // slide); o que tem rótulo diferente num killer é o poder. Sem rótulo: o 1º é o poder.
  const rotulos = slides.map((s) => s.rotulo);
  const comRotulos = rotulos.length > 1 && rotulos.every(Boolean) && new Set(rotulos).size > 1;
  const daPerk = rotulos[rotulos.length - 1];
  for (const s of slides) {
    let tipo = 'perk';
    if (papel === 'killer') {
      if (comRotulos) tipo = s.rotulo !== daPerk ? 'poder' : 'perk';
      else if (classe === 'powerperks-slider' && s.k === 0) tipo = 'poder';
    }
    s.tipo = tipo;
  }
  return slides.filter((s) => s.nome).map(({ tipo, nome, icone, chave }) => ({ tipo, nome, icone, chave }));
}

// lerPaginaPersonagem(html, url) → { nome, papel, retrato, chave, idLd, alternativos, slides } · null
// null = não é página de personagem (personagem que saiu da loja, página vazia, sem
// JSON-LD «Person» com nome, papel desconhecido): não se inventa nada a partir dela.
function lerPaginaPersonagem(html, url) {
  if (typeof html !== 'string' || !html) return null;
  const pessoa = acharPessoa(html);
  if (!pessoa) return null;
  const nome = limparNome(pessoa.name);
  if (!nome) return null;
  let papel = papelDe(pessoa);
  if (!papel) {
    // sem «Role»: o carrossel diz (killer tem poder e perks; sobrevivente, só perks)
    if (/\bclass="[^"]*\bpowerperks-slider\b/.test(html)) papel = 'killer';
    else if (/\bclass="(?:[^"]*\s)?perks-slider\b/.test(html)) papel = 'survivor';
    else return null;
  }
  const retrato = urlAbsoluta(primeiraImagem(pessoa.image), url);
  return {
    nome,
    papel,
    retrato,
    chave: chaveDoArquivo(retrato),
    idLd: typeof pessoa['@id'] === 'string' && RE_SLUG.test(pessoa['@id']) ? pessoa['@id'] : null,
    alternativos: lerAlternativos(html),
    slides: lerCarrossel(html, url, papel),
  };
}

// ── 🧱 Itens ──────────────────────────────────────────────────────────────
// Artigo na frente do nome do killer vira apelido sem ele («The Trapper» → «Trapper»)
const ARTIGOS = Object.freeze([['en', /^the\s+/i], ['pt', /^(?:o|a|os|as)\s+/i], ['fr', /^(?:(?:le|la|les)\s+|l['’]\s*)/i], ['de', /^(?:der|die|das)\s+/i]]);
function apelidosDoKiller(nomes) {
  const saida = [];
  const vistos = new Set(Object.values(nomes).map((n) => n.toLowerCase()));
  for (const [idioma, re] of ARTIGOS) {
    const n = nomes[idioma];
    if (!n) continue;
    const curto = n.replace(re, '').trim();
    if (curto === n || curto.length < 3 || curto.length > 60 || curto.includes('|') || vistos.has(curto.toLowerCase())) continue;
    vistos.add(curto.toLowerCase());
    saida.push(curto);
  }
  return saida;
}

// Grupo de cada leitura: o slug inglês que a página aponta (hreflang en / x-default).
// Sem ele, o próprio slug (inglês) ou idioma:slug; de reserva, o retrato junta os grupos.
function chaveDoGrupo(l) {
  const alt = l.pagina.alternativos;
  const en = alt.get('en') || alt.get('x-default');
  if (en) return en;
  if (l.idioma === 'en') return l.slug;
  return `${l.idioma}:${l.slug}`;
}
function agrupar(leituras) {
  const grupos = new Map();
  for (const l of leituras) {
    const k = chaveDoGrupo(l);
    let g = grupos.get(k);
    if (!g) { g = new Map(); grupos.set(k, g); }
    // duas páginas do mesmo personagem no mesmo idioma: vale a mais completa (no empate, a primeira)
    const atual = g.get(l.idioma);
    if (!atual || l.pagina.slides.length > atual.pagina.slides.length) g.set(l.idioma, l);
  }
  // reserva: grupo que não tem os idiomas do outro e mostra o mesmo retrato é o mesmo personagem
  const lista = Array.from(grupos.values());
  const porRetrato = new Map();
  const saida = [];
  for (const g of lista) {
    const ret = Array.from(g.values()).map((l) => l.pagina.chave).find(Boolean);
    const alvo = ret ? porRetrato.get(ret) : null;
    if (alvo && Array.from(g.keys()).every((i) => !alvo.has(i))) {
      for (const [i, l] of g) alvo.set(i, l);
      continue;
    }
    if (ret && !porRetrato.has(ret)) porRetrato.set(ret, g);
    saida.push(g);
  }
  return saida;
}
// Poder e perks dos outros idiomas casam com os da página base pelo ícone (mesmo arquivo
// em todo idioma); o que sobrar casa pela posição entre os do mesmo tipo.
function juntarSlides(porIdioma) {
  const base = [];
  for (const idioma of ORDEM_IDIOMAS) {
    const l = porIdioma.get(idioma);
    if (!l) continue;
    const slides = l.pagina.slides;
    if (!base.length) {
      for (const s of slides) base.push({ tipo: s.tipo, nomes: { [idioma]: s.nome }, chave: s.chave, url: s.icone });
      continue;
    }
    const usados = new Set();
    const sobra = [];
    for (const s of slides) {
      const alvo = s.chave ? base.find((b, i) => !usados.has(i) && b.tipo === s.tipo && b.chave === s.chave && !b.nomes[idioma]) : null;
      if (alvo) { usados.add(base.indexOf(alvo)); alvo.nomes[idioma] = s.nome; } else sobra.push(s);
    }
    for (const s of sobra) {
      const i = base.findIndex((b, j) => !usados.has(j) && b.tipo === s.tipo && !b.nomes[idioma]);
      if (i >= 0) {
        usados.add(i);
        base[i].nomes[idioma] = s.nome;
        if (!base[i].chave) base[i].chave = s.chave;
        if (!base[i].url) base[i].url = s.icone;
      } else {
        base.push({ tipo: s.tipo, nomes: { [idioma]: s.nome }, chave: s.chave, url: s.icone });
      }
    }
  }
  return base;
}
// montarEntradas(leituras) → [{ tipo, nomes, chave, url, apelidos, donoDe }] na ordem:
// cada personagem seguido do poder e das perks dele (donoDe = posição do personagem)
function montarEntradas(leituras) {
  const entradas = [];
  for (const porIdioma of agrupar(leituras)) {
    const ls = ORDEM_IDIOMAS.map((i) => porIdioma.get(i)).filter(Boolean);
    const papel = ls.map((l) => l.pagina.papel).find(Boolean);
    if (!papel) continue;
    const tipo = papel === 'killer' ? 'killer' : 'sobrevivente';
    const nomes = {};
    for (const l of ls) nomes[l.idioma] = l.pagina.nome;
    const comRetrato = ls.find((l) => l.pagina.retrato);
    const comChave = ls.find((l) => l.pagina.chave);
    const pos = entradas.length;
    entradas.push({
      tipo, nomes,
      chave: comChave ? comChave.pagina.chave : null,
      url: comRetrato ? comRetrato.pagina.retrato : null,
      apelidos: tipo === 'killer' ? apelidosDoKiller(nomes) : [],
      donoDe: null,
    });
    for (const s of juntarSlides(porIdioma)) {
      if (s.tipo === 'poder' && tipo !== 'killer') continue; // poder é só de killer
      entradas.push({ tipo: s.tipo, nomes: s.nomes, chave: s.chave, url: s.url, apelidos: [], donoDe: pos });
    }
  }
  return entradas;
}

// O id do item como o catálogo faz (<tipo>:<slug do nome em inglês, ou do primeiro que
// houver>), mas antes procura a chave no catálogo: o arquivo do retrato/ícone não muda
// quando o nome muda, então o item continua o mesmo.
const ORDEM_PRIMEIRO_NOME = ['en', 'pt', 'es', 'fr', 'de', 'ru', 'tr', 'ja', 'ko', 'zh'];
function idPorNome(tipo, nomes) {
  const n = ORDEM_PRIMEIRO_NOME.map((k) => nomes[k]).find(Boolean) || '';
  const s = slug(n) || crypto.createHash('sha1').update(String(n).normalize('NFC'), 'utf8').digest('hex').slice(0, 8);
  return `${tipo}:${s}`;
}
function resolverIds(entradas, cat) {
  const k = (tipo, chave) => `${tipo}\u0000${chave}`;
  // a mesma chave em dois itens diferentes desta leitura não serve para casar nenhum deles
  const contagem = new Map();
  for (const e of entradas) if (e.chave) contagem.set(k(e.tipo, e.chave), (contagem.get(k(e.tipo, e.chave)) || 0) + 1);
  for (const e of entradas) if (e.chave && contagem.get(k(e.tipo, e.chave)) > 1) e.chave = null;
  // A chave guardada por leituras anteriores só casa com item do MESMO dono: o CMS tira o
  // sufixo do arquivo e o site já usa ícone genérico por capítulo (…_CHAPTER_Power_Icons),
  // então dois killers podem dividir a chave e, numa rodada que só lê o segundo, o poder
  // dele viraria o do primeiro (nome e dono trocados). Mais de um candidato: não chuta.
  const porChave = new Map();
  for (const it of cat.itens) {
    if (!it.chave) continue;
    const l = porChave.get(k(it.tipo, it.chave));
    if (l) l.push(it); else porChave.set(k(it.tipo, it.chave), [it]);
  }
  const noCatalogo = new Set(cat.itens.map((it) => it.id));
  const vistos = new Map();
  const saida = [];
  for (const e of entradas) {
    // o dono vem antes na lista (cada personagem seguido do poder e das perks dele)
    e.dono = e.donoDe === null ? null : (entradas[e.donoDe].repetido || entradas[e.donoDe]).id;
    const comChave = e.chave ? porChave.get(k(e.tipo, e.chave)) || [] : [];
    const mesmoDono = comChave.filter((it) => (it.dono || null) === e.dono);
    e.id = mesmoDono.length === 1 ? mesmoDono[0].id : idPorNome(e.tipo, e.nomes);
    // item novo com uma chave que o catálogo já dá a outro: o mesclar casaria pela chave e
    // trocaria aquele item; aqui ela não identifica nada (entra quando o item já existir)
    if (comChave.length && !noCatalogo.has(e.id)) e.chave = null;
    const igual = vistos.get(e.id);
    if (igual) { // o mesmo item duas vezes (perk repetida): o primeiro fica, ganha os idiomas que faltarem
      for (const [idioma, v] of Object.entries(e.nomes)) if (!igual.nomes[idioma]) igual.nomes[idioma] = v;
      e.repetido = igual;
      continue;
    }
    vistos.set(e.id, e);
    saida.push(e);
  }
  return saida.filter((e) => RE_ID.test(e.id) && (e.dono === null || RE_ID.test(e.dono)));
}

// ── 💾 O que fica guardado em jogo.fontes.siteOficial ──────────────────────
// lidoEm/paginas/idiomas (para o painel), os validadores do sitemap e a assinatura do robots
// (GET condicional), os itens da última leitura completa, a página onde a próxima rodada
// retoma (a anterior parou no meio) e a URL de cada imagem (para não baixar de novo).
function mapaDeTextos(v, max) {
  const m = new Map();
  if (!ehObjeto(v)) return m;
  for (const [k, x] of Object.entries(v)) {
    if (m.size >= max) break;
    if (RE_ID.test(k) && typeof x === 'string' && x.length <= 2000) m.set(k, x);
  }
  return m;
}
function lerEstado(bruto) {
  const b = ehObjeto(bruto) ? bruto : {};
  const num = (v) => (Number.isFinite(v) && v >= 0 ? v : 0);
  const lista = (v, ok) => (Array.isArray(v) ? v.filter(ok) : []);
  let sitemap = null;
  if (ehObjeto(b.sitemap) && typeof b.sitemap.url === 'string' && (typeof b.sitemap.etag === 'string' || typeof b.sitemap.modificado === 'string')) {
    sitemap = { url: b.sitemap.url, etag: typeof b.sitemap.etag === 'string' ? b.sitemap.etag : null, modificado: typeof b.sitemap.modificado === 'string' ? b.sitemap.modificado : null };
  }
  return {
    versao: num(b.versao),
    lidoEm: num(b.lidoEm),
    verificadoEm: num(b.verificadoEm),
    paginas: num(b.paginas),
    idiomas: lista(b.idiomas, (x) => ORDEM_IDIOMAS.includes(x)),
    pedidos: lista(b.pedidos, (x) => ORDEM_IDIOMAS.includes(x)),
    completo: b.completo === true,
    sitemap,
    robots: typeof b.robots === 'string' && /^[0-9a-f]{12}$/.test(b.robots) ? b.robots : null,
    retomar: typeof b.retomar === 'string' && b.retomar.length <= 300 && paginaDePersonagem(b.retomar) ? b.retomar : null,
    itens: lista(b.itens, (x) => typeof x === 'string' && RE_ID.test(x)).slice(0, 2000),
    urls: mapaDeTextos(b.urls, 2000),
    baixadas: mapaDeTextos(b.baixadas, 2000),
  };
}
function estadoParaGravar(e) {
  const obj = (m) => { const o = {}; for (const [k, v] of m) o[k] = v; return o; };
  return {
    versao: e.versao, lidoEm: e.lidoEm, verificadoEm: e.verificadoEm, paginas: e.paginas,
    idiomas: e.idiomas, pedidos: e.pedidos, completo: e.completo, sitemap: e.sitemap,
    robots: e.robots, retomar: e.retomar,
    itens: e.itens, urls: obj(e.urls), baixadas: obj(e.baixadas),
  };
}

// ── 🌐 Rede ───────────────────────────────────────────────────────────────
function dormir(ms, sinal) {
  return new Promise((resolve) => {
    if (sinal.aborted || !(ms > 0)) { resolve(); return; }
    const fim = () => { clearTimeout(t); sinal.removeEventListener('abort', fim); resolve(); };
    const t = setTimeout(fim, ms);
    sinal.addEventListener('abort', fim, { once: true });
  });
}
function erroAbortado() {
  const e = new Error('abortado');
  e.name = 'AbortError';
  return e;
}
// Espera a promessa, mas solta na hora do cancelamento/tempo (um fetch que ignore o sinal
// não prende a rodada); resposta que chegar depois é descartada.
function comAborto(promessa, sinal) {
  return new Promise((resolve, reject) => {
    if (sinal.aborted) {
      Promise.resolve(promessa).then((v) => descartar(v), () => {});
      reject(erroAbortado());
      return;
    }
    const aoAbortar = () => reject(erroAbortado());
    sinal.addEventListener('abort', aoAbortar, { once: true });
    Promise.resolve(promessa).then((v) => {
      sinal.removeEventListener('abort', aoAbortar);
      if (sinal.aborted) descartar(v);
      resolve(v);
    }, (e) => {
      sinal.removeEventListener('abort', aoAbortar);
      reject(e);
    });
  });
}
function cabecalho(res, nome) {
  try { return res && res.headers && typeof res.headers.get === 'function' ? res.headers.get(nome) : null; } catch { return null; }
}
const tipoDoConteudo = (v) => (typeof v === 'string' ? v.split(';')[0].trim().toLowerCase() : '');
// Corpo que não vamos ler: solta a conexão sem baixar o resto
function descartar(res) {
  try { if (res && res.body && typeof res.body.cancel === 'function') res.body.cancel().catch(() => {}); } catch { /* já fechado */ }
}
// Lê o corpo até o teto: passou, para de ler na hora (não baixa os 50 MB de uma imagem errada)
async function lerCorpo(res, teto, sinal, cortar) {
  const corpo = res.body;
  if (corpo && typeof corpo.getReader === 'function') {
    const leitor = corpo.getReader();
    const partes = [];
    let total = 0;
    let soltar;
    const abortou = new Promise((resolve) => {
      soltar = () => resolve({ abortado: true });
      if (sinal.aborted) soltar(); else sinal.addEventListener('abort', soltar, { once: true });
    });
    try {
      for (;;) {
        const leitura = leitor.read();
        leitura.catch(() => {}); // abandonada pelo cancelamento: o erro dela não vaga solto
        const r = await Promise.race([leitura, abortou]);
        if (r.abortado) throw erroAbortado();
        if (r.done) break;
        const v = r.value;
        const pedaco = Buffer.isBuffer(v) ? v : v instanceof Uint8Array ? Buffer.from(v.buffer, v.byteOffset, v.byteLength) : Buffer.from(String(v));
        if (total + pedaco.length > teto) {
          if (cortar) { partes.push(pedaco.subarray(0, teto - total)); total = teto; break; }
          return { grande: true };
        }
        partes.push(pedaco);
        total += pedaco.length;
      }
    } finally {
      sinal.removeEventListener('abort', soltar);
      try { leitor.cancel().catch(() => {}); } catch { /* já terminou */ }
    }
    return { buf: Buffer.concat(partes, total) };
  }
  // reserva: um fetch sem corpo em fluxo (não dá para parar no meio)
  if (res && typeof res.arrayBuffer === 'function') {
    const ab = Buffer.from(await comAborto(res.arrayBuffer(), sinal));
    if (ab.length > teto) return cortar ? { buf: ab.subarray(0, teto) } : { grande: true };
    return { buf: ab };
  }
  return { buf: Buffer.alloc(0) };
}
// «Retry-After»: segundos ou data HTTP → segundos (até um dia)
function esperaPedida(valor) {
  if (typeof valor !== 'string' || !valor.trim()) return null;
  let s = /^\d+$/.test(valor.trim()) ? Number(valor.trim()) : Math.ceil((Date.parse(valor) - Date.now()) / 1000);
  if (!Number.isFinite(s)) return null;
  s = Math.max(0, Math.min(86400, s));
  return s;
}
// 403, 429 e 5xx: o site pediu para parar. A rodada para e devolve o motivo.
function paradaPorStatus(status, res, url) {
  let caminho = null;
  try { caminho = new URL(url).pathname; } catch { /* sem caminho */ }
  if (status === 403) return { motivo: 'bloqueado', status, pagina: caminho, detalhe: 'o site recusou o acesso (HTTP 403): a rodada parou e não insiste' };
  if (status === 429 || (status >= 500 && status <= 599)) {
    const espera = esperaPedida(cabecalho(res, 'retry-after'));
    const p = status === 429
      ? { motivo: 'muitas-requisicoes', status, pagina: caminho, detalhe: 'o site pediu para esperar (HTTP 429): tente de novo mais tarde' }
      : { motivo: 'site-indisponivel', status, pagina: caminho, detalhe: `o site está com problema (HTTP ${status}): tente de novo mais tarde` };
    if (espera !== null) p.esperarSegundos = espera;
    return p;
  }
  return null;
}
const CANCELADO = Object.freeze({ motivo: 'cancelado', detalhe: 'rodada cancelada' });
// Uma rodada por vez no processo inteiro (não só por adaptador): a regra «uma requisição
// por vez» é com o site, e o site é um só.
let rodadaNoProcesso = null;
// O relógio do site, que passa de uma rodada para a outra (clique duplo, cancelar e
// recomeçar): quando acabou a última requisição e com que pausa, e até quando o site pediu
// para ninguém voltar (Retry-After). Com a rede de verdade é um só no processo, como a
// trava; com fetch injetado (teste) o «site» é outro, e cada adaptador tem o seu.
const novoRelogio = () => ({ fim: -Infinity, pausa: 0, esperarAte: 0, parada: null });
const RELOGIO_DO_SITE = novoRelogio();

// ── 🔄 O adaptador ────────────────────────────────────────────────────────
// criarDbd({ catalogos, versao, fetch? }) → { atualizar, cancelar, estado }
// fetch injetado é para teste: com ele a pausa mínima de 500 ms não vale e «tempoMs»
// encurta os 20 s (sem ele, os dois ficam como combinado).
function criarDbd(opcoes) {
  const o = ehObjeto(opcoes) ? opcoes : {};
  const catalogos = o.catalogos;
  for (const f of ['carregar', 'mesclar', 'acharItem', 'guardarImagem', 'caminhoImagem', 'registrarFonte']) {
    if (!catalogos || typeof catalogos[f] !== 'function') throw new TypeError(`criarDbd: falta o catálogo (criarCatalogos) com ${f}()`);
  }
  const injetado = typeof o.fetch === 'function';
  const buscar = injetado ? o.fetch : (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : null);
  const relogio = injetado ? novoRelogio() : RELOGIO_DO_SITE;
  const pausaMinima = injetado ? 0 : PAUSA_MINIMA_MS;
  const tempoMs = injetado && Number.isFinite(o.tempoMs) && o.tempoMs > 0 ? Math.min(o.tempoMs, TEMPO_MS) : TEMPO_MS;
  const versao = typeof o.versao === 'string' && /^[0-9A-Za-z.+_-]{1,40}$/.test(o.versao) ? o.versao : '0';
  // Sem acento de propósito: cabeçalho HTTP é ASCII (o «á» viajaria como byte solto)
  const agente = `OBS-Social/${versao} (+https://github.com/WardzdesouzA/OBSSocial; leitura do catalogo pedida pelo usuario)`;

  let rodada = null; // a rodada em curso (uma por vez)
  let ultimo = null; // o último progresso, para o painel que abrir no meio

  function estado() {
    if (!rodada) return { rodando: false, ultimo: ultimo ? { ...ultimo } : null };
    return { rodando: true, jogo: rodada.jogoId, desde: rodada.desde, ...rodada.progresso };
  }

  function cancelar() {
    if (!rodada) return false;
    rodada.controle.abort();
    return true;
  }

  async function atualizar(jogoId, opcoesRodada) {
    const zero = { novos: 0, atualizados: 0, iguais: 0, imagens: 0, paginas: 0 };
    if (rodada || rodadaNoProcesso) return { ok: false, motivo: 'ocupado', detalhe: 'já há uma leitura do site em andamento', ...zero };
    const op = ehObjeto(opcoesRodada) ? opcoesRodada : {};
    const controle = new AbortController();
    const externo = op.sinal && typeof op.sinal.addEventListener === 'function' ? op.sinal : null;
    const aoAbortarFora = () => controle.abort();
    if (externo) { if (externo.aborted) controle.abort(); else externo.addEventListener('abort', aoAbortarFora, { once: true }); }
    let pausa = Number(op.pausaMs);
    if (!Number.isFinite(pausa)) pausa = PAUSA_PADRAO_MS;
    pausa = Math.min(PAUSA_MAXIMA_MS, Math.max(pausaMinima, pausa));
    const pedidos = Array.isArray(op.idiomas) ? ORDEM_IDIOMAS.filter((c) => op.idiomas.includes(c)) : [];
    const ctx = {
      jogoId, controle, sinal: controle.signal, desde: Date.now(),
      imagens: op.imagens !== false,
      idiomas: pedidos.length ? pedidos : ORDEM_IDIOMAS.slice(),
      pausa, requisicoes: 0, paginasPedidas: 0,
      robots: new Map(), parada: null, aviso: null,
      aoProgresso: typeof op.aoProgresso === 'function' ? op.aoProgresso : null,
      progresso: { fase: 'inicio', feitas: 0, total: 0, mensagem: '' },
      res: { ...zero, personagens: 0, ignoradas: 0, proibidas: 0, recusadas: 0 },
    };
    rodada = ctx;
    rodadaNoProcesso = ctx;
    try {
      return await rodar(ctx);
    } catch (err) {
      console.error('  ⚠️ 🙋 DBD: erro inesperado na leitura do site oficial:', (err && err.stack) || err);
      return { ok: false, motivo: 'erro-interno', detalhe: `erro inesperado (${(err && err.message) || err})`, ...ctx.res, requisicoes: ctx.requisicoes };
    } finally {
      if (externo) externo.removeEventListener('abort', aoAbortarFora);
      ultimo = { jogo: jogoId, fim: Date.now(), ...ctx.progresso };
      rodada = null;
      if (rodadaNoProcesso === ctx) rodadaNoProcesso = null;
    }
  }

  function avisar(ctx, fase, feitas, total, mensagem) {
    ctx.progresso = { fase, feitas, total, mensagem: mensagem || '' };
    if (!ctx.aoProgresso) return;
    try {
      const r = ctx.aoProgresso({ ...ctx.progresso });
      // callback async que falha: a promessa rejeitada ficaria sem dono (e o Node ≥15
      // derruba o processo por isso); a leitura não espera o painel
      if (r && typeof r.then === 'function') Promise.resolve(r).catch(() => {});
    } catch { /* o painel não derruba a leitura */ }
  }

  // Uma requisição do jeito combinado: robots, a vez (pausa), User-Agent, 20 s,
  // sem seguir redirecionamento (o sitemap já dá o endereço certo) e com teto de tamanho.
  // → { status, res, buf } · { proibida } · { recusada } · { falha } · { cancelado }
  async function pedir(ctx, url, o2) {
    if (ctx.sinal.aborted) return { cancelado: true };
    if (!o2.semRobots) {
      const ok = await permitido(ctx, url);
      if (ok === null) return ctx.parada === CANCELADO ? { cancelado: true } : { parou: true };
      if (!ok) return { proibida: true };
    }
    // A vez: a pausa conta do fim da última requisição ao site, desta rodada ou da anterior,
    // e vale a maior entre a de então e a de agora — o prazo é calculado na hora de esperar,
    // então o Crawl-delay que o robots acabou de pedir já vale para a requisição seguinte.
    // Relógio contínuo e confere de novo ao acordar: o timer do Node pode disparar um
    // tiquinho antes, e a pausa combinada é um mínimo, não uma média.
    const falta = () => relogio.fim + Math.max(relogio.pausa, ctx.pausa) - performance.now();
    for (let f = falta(); f > 0 && !ctx.sinal.aborted; f = falta()) await dormir(Math.ceil(f), ctx.sinal);
    if (ctx.sinal.aborted) return { cancelado: true };
    if (!buscar) return { falha: 'rede', detalhe: 'este Node não tem fetch' };
    ctx.requisicoes++;
    const ctl = new AbortController();
    const repassar = () => ctl.abort();
    ctx.sinal.addEventListener('abort', repassar, { once: true });
    let porTempo = false;
    const limite = setTimeout(() => { porTempo = true; ctl.abort(); }, tempoMs);
    const cabecalhos = { 'User-Agent': agente, Accept: o2.aceitar || '*/*', ...(o2.cabecalhos || {}) };
    try {
      const res = await comAborto(buscar(url, { method: 'GET', headers: cabecalhos, redirect: 'manual', signal: ctl.signal }), ctl.signal);
      if (!res || typeof res.status !== 'number') return { falha: 'rede', detalhe: 'resposta inválida' };
      if (res.status !== 200) { descartar(res); return { status: res.status, res }; }
      if (o2.tipos && !o2.tipos(tipoDoConteudo(cabecalho(res, 'content-type')))) { descartar(res); return { status: 200, res, recusada: 'tipo' }; }
      const tamanho = Number(cabecalho(res, 'content-length'));
      if (!o2.cortar && Number.isFinite(tamanho) && tamanho > o2.teto) { descartar(res); return { status: 200, res, recusada: 'grande' }; }
      const corpo = await lerCorpo(res, o2.teto, ctl.signal, o2.cortar);
      if (corpo.grande) return { status: 200, res, recusada: 'grande' };
      return { status: 200, res, buf: corpo.buf };
    } catch (err) {
      if (ctx.sinal.aborted) return { cancelado: true };
      if (porTempo) return { falha: 'tempo-esgotado', detalhe: `o site não respondeu em ${tempoMs / 1000} s` };
      return { falha: 'rede', detalhe: `sem conexão com o site (${(err && (err.cause && err.cause.code)) || (err && err.message) || err})` };
    } finally {
      clearTimeout(limite);
      ctx.sinal.removeEventListener('abort', repassar);
      relogio.fim = performance.now();
      relogio.pausa = ctx.pausa;
    }
  }
  // A rodada para com o motivo. Com Retry-After (429/5xx), o prazo fica no relógio do site:
  // a rodada seguinte não volta antes dele (o site pediu para parar, não só esta rodada).
  function parar(ctx, p) {
    ctx.parada = p;
    if (p && Number.isFinite(p.esperarSegundos) && p.esperarSegundos > 0) {
      relogio.esperarAte = Math.max(relogio.esperarAte, performance.now() + p.esperarSegundos * 1000);
      relogio.parada = { motivo: p.motivo, status: p.status };
    }
  }
  // Resultado de pedir() que encerra a rodada → grava ctx.parada e devolve true
  function encerra(ctx, r, url) {
    if (r.cancelado) { ctx.parada = CANCELADO; return true; }
    if (r.parou) return true;
    if (r.falha) { ctx.parada = { motivo: r.falha, detalhe: r.detalhe }; return true; }
    const p = typeof r.status === 'number' ? paradaPorStatus(r.status, r.res, url) : null;
    if (p) { parar(ctx, p); return true; }
    return false;
  }

  // O robots.txt de um host, uma vez por rodada. O do site é obrigatório (sem ele, nada);
  // o do CDN de imagens segue a RFC 9309: 4xx = sem regras (o CDN responde 403 para
  // arquivo que não existe); 429/5xx para a rodada.
  async function robotsDe(ctx, origem, principal) {
    if (ctx.robots.has(origem)) return ctx.robots.get(origem);
    ctx.paginasPedidas++;
    const url = origem + '/robots.txt';
    const r = await pedir(ctx, url, { semRobots: true, teto: TETO_ROBOTS_BYTES, cortar: true, aceitar: 'text/plain,*/*;q=0.5' });
    let regras = null;
    if (r.status === 200 && r.buf) regras = lerRobots(r.buf.toString('utf8'));
    else if (r.cancelado || r.falha) { encerra(ctx, r, url); return null; }
    else if (principal) {
      parar(ctx, paradaPorStatus(r.status, r.res, url) || { motivo: 'robots', status: r.status, detalhe: `não consegui ler o robots.txt do site (HTTP ${r.status})` });
      return null;
    } else if (r.status === 429 || r.status >= 500) { encerra(ctx, r, url); return null; } else regras = SEM_REGRAS;
    const esperas = [regras.todos, regras.nosso].map((c) => (c ? c.espera : null)).filter((n) => n !== null);
    if (esperas.length) {
      const espera = Math.max(...esperas) * 1000;
      // pausa maior que 1 min faria a leitura levar horas: melhor parar e dizer
      if (espera > PAUSA_MAXIMA_MS) {
        ctx.parada = { motivo: 'robots', detalhe: `o robots.txt pede ${Math.round(espera / 1000)} s entre requisições: longo demais para uma leitura pedida na hora` };
        return null;
      }
      ctx.pausa = Math.max(ctx.pausa, espera);
    }
    ctx.robots.set(origem, regras);
    return regras;
  }
  // true/false; null = a rodada parou lendo o robots do host
  async function permitido(ctx, url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    const regras = await robotsDe(ctx, u.origin, false);
    if (!regras) return null;
    return robotsPermite(regras, u);
  }

  // ── a rodada ──
  async function rodar(ctx) {
    const { jogoId } = ctx;
    const fim = (extra) => {
      avisar(ctx, 'fim', 1, 1, extra.ok ? 'pronto' : extra.motivo);
      return { ...extra, ...ctx.res, requisicoes: ctx.requisicoes };
    };
    const falhou = (p) => fim({ ok: false, ...p });

    const cat0 = catalogos.carregar(jogoId);
    if (!cat0) return falhou({ motivo: 'jogo-inexistente', detalhe: 'jogo não encontrado' });
    if (cat0.ok === false || !Array.isArray(cat0.itens)) return falhou({ motivo: 'catalogo-ilegivel', detalhe: 'o catálogo deste jogo não abre: nada foi lido do site' });
    if (!cat0.jogo || cat0.jogo.modelo !== 'dbd') return falhou({ motivo: 'modelo-errado', detalhe: 'a leitura do site oficial é só para o modelo Dead by Daylight' });
    if (ctx.sinal.aborted) return falhou(CANCELADO);
    // o site pediu para esperar (Retry-After) há pouco: nenhuma requisição antes do prazo
    const espera = relogio.esperarAte - performance.now();
    if (espera > 0) {
      const s = Math.ceil(espera / 1000);
      const p = relogio.parada || { motivo: 'muitas-requisicoes' };
      return falhou({ motivo: p.motivo, status: p.status, esperarSegundos: s, detalhe: `o site pediu para esperar${p.status ? ` (HTTP ${p.status})` : ''}: tente de novo daqui a ${s} s (nada foi pedido agora)` });
    }
    const antes = lerEstado(cat0.jogo.fontes && cat0.jogo.fontes.siteOficial);

    // 1) robots.txt, relido a cada rodada
    avisar(ctx, 'robots', 0, 1, '/robots.txt');
    const robots = await robotsDe(ctx, SITE, true);
    if (!robots) return falhou(ctx.parada || { motivo: 'robots', detalhe: 'não consegui ler o robots.txt do site' });

    // 2) o sitemap que o robots indica (só do próprio site)
    const sitemaps = [];
    for (const s of robots.sitemaps) {
      const u = (() => { try { return new URL(s); } catch { return null; } })();
      if (u && u.protocol === 'https:' && u.hostname === HOST_SITE && !u.port && !sitemaps.includes(u.href)) sitemaps.push(u.href);
    }
    if (!sitemaps.length) return falhou({ motivo: 'sem-sitemap', detalhe: 'o robots.txt do site não indica o sitemap' });
    // GET condicional só quando a leitura anterior foi completa (todas as páginas lidas), com
    // a mesma leitura de página, o mesmo robots (o que ele proibia pode ter sido liberado), os
    // mesmos idiomas (ou menos) e todos os itens dela ainda no catálogo
    const assinatura = assinaturaRobots(robots);
    const ids0 = new Set(cat0.itens.map((it) => it.id));
    const atalho = antes.sitemap && antes.completo && antes.versao === VERSAO_LEITURA && antes.robots === assinatura &&
      sitemaps.length === 1 && antes.sitemap.url === sitemaps[0] &&
      ctx.idiomas.every((c) => antes.pedidos.includes(c)) && antes.itens.every((id) => ids0.has(id)) ? antes.sitemap : null;
    const locs = [];
    let semMudanca = false;
    let validadores = null;
    const fila = sitemaps.slice(0, TETO_SITEMAPS);
    const naFila = new Set(fila);
    for (let n = 0; n < fila.length; n++) {
      const url = fila[n];
      avisar(ctx, 'sitemap', n, fila.length, new URL(url).pathname);
      const cond = atalho && url === atalho.url ? atalho : null;
      const cab = {};
      if (cond && cond.etag) cab['If-None-Match'] = cond.etag;
      if (cond && cond.modificado) cab['If-Modified-Since'] = cond.modificado;
      ctx.paginasPedidas++;
      const r = await pedir(ctx, url, { teto: TETO_SITEMAP_BYTES, aceitar: 'application/xml,text/xml;q=0.9,*/*;q=0.5', cabecalhos: cab });
      if (r.proibida) return falhou({ motivo: 'robots', detalhe: 'o robots.txt não deixa ler o sitemap' });
      if (encerra(ctx, r, url)) return falhou(ctx.parada);
      if (r.status === 304 && cond) { semMudanca = true; break; }
      if (r.status !== 200 || !r.buf) return falhou({ motivo: 'sem-sitemap', status: r.status, detalhe: `o sitemap não abriu (HTTP ${r.status})` });
      const s = lerSitemap(r.buf.toString('utf8'));
      if (!s) return falhou({ motivo: 'sitemap-quebrado', detalhe: 'o sitemap veio num formato que não entendo' });
      if (s.indice) {
        // só cabem TETO_SITEMAPS na fila (os outros nem seriam lidos): o índice para de ser
        // olhado quando ela enche, e o Set evita o includes() — quadrático com 50 mil entradas
        for (const loc of s.locs) {
          if (fila.length >= TETO_SITEMAPS) break;
          const u = (() => { try { return new URL(loc); } catch { return null; } })();
          if (u && u.protocol === 'https:' && u.hostname === HOST_SITE && !u.port && !naFila.has(u.href)) { naFila.add(u.href); fila.push(u.href); }
        }
        continue;
      }
      for (const loc of s.locs) locs.push(loc); // push(...locs) com 150 mil argumentos estoura a pilha
      if (sitemaps.length === 1 && fila.length === 1) {
        const etag = cabecalho(r.res, 'etag');
        const modificado = cabecalho(r.res, 'last-modified');
        if (etag || modificado) validadores = { url, etag: etag || null, modificado: modificado || null };
      }
    }

    const estadoNovo = { ...antes, versao: VERSAO_LEITURA, urls: new Map(antes.urls), baixadas: new Map(antes.baixadas) };
    let alvosImagem = [];
    if (semMudanca) {
      // site igual desde a última leitura completa: nada de reler páginas; só as imagens que faltam
      ctx.res.semMudanca = true;
      for (const id of antes.itens) { const u = antes.urls.get(id); if (u) alvosImagem.push({ id, url: u }); }
    } else {
      // 3) as páginas de personagem, idioma por idioma (en, pt, fr, de, ja)
      const porIdioma = paginasDasUrls(locs);
      let paginas = ctx.idiomas.flatMap((c) => porIdioma[c]);
      if (!paginas.length) return falhou({ motivo: 'sem-personagens', detalhe: 'o sitemap não lista nenhuma página de personagem' });
      // A rodada anterior parou no meio (teto de páginas, 429, cancelamento): esta começa de
      // onde ela parou e dá a volta (as do começo vêm no fim). Recomeçar sempre do início
      // pararia sempre no mesmo ponto, e o resto nunca seria lido.
      const k = antes.retomar ? paginas.findIndex((p) => p.url === antes.retomar) : -1;
      if (k > 0) paginas = paginas.slice(k).concat(paginas.slice(0, k));
      const leituras = [];
      let feitas = 0;
      let parouEm = -1; // a primeira página que esta rodada deixou de ler por ter parado
      for (let i = 0; i < paginas.length; i++) {
        const p = paginas[i];
        if (ctx.sinal.aborted) { ctx.parada = CANCELADO; parouEm = i; break; }
        if (ctx.paginasPedidas >= TETO_PAGINAS) { ctx.aviso = 'teto-paginas'; parouEm = i; break; }
        avisar(ctx, 'paginas', feitas, paginas.length, `${p.idioma}: ${p.slug}`);
        ctx.paginasPedidas++;
        const r = await pedir(ctx, p.url, { teto: TETO_HTML_BYTES, aceitar: ACEITAR_HTML, tipos: (t) => !t || t === 'text/html' || t === 'application/xhtml+xml' });
        feitas++;
        if (r.proibida) { ctx.paginasPedidas--; ctx.res.proibidas++; continue; }
        // cancelada: a próxima começa por ela; recusada pelo site: ela fica para o fim da volta
        if (encerra(ctx, r, p.url)) { parouEm = r.cancelado ? i : i + 1; break; }
        if (r.status !== 200 || !r.buf) { ctx.res.ignoradas++; continue; } // 404, redirecionada, grande demais, tipo errado
        let pagina = null;
        try { pagina = lerPaginaPersonagem(r.buf.toString('utf8'), p.url); } catch { pagina = null; } // página quebrada não derruba
        if (!pagina) { ctx.res.ignoradas++; continue; }
        ctx.res.paginas++;
        leituras.push({ idioma: p.idioma, slug: p.slug, url: p.url, pagina });
      }
      avisar(ctx, 'paginas', feitas, paginas.length, '');
      if (!leituras.length && !ctx.parada) return falhou({ motivo: 'sem-personagens', detalhe: 'nenhuma página de personagem pôde ser lida' });
      // parou sem ler nada: segue só para guardar onde a próxima retoma
      estadoNovo.retomar = parouEm >= 0 && parouEm < paginas.length ? paginas[parouEm].url : null;

      let entradas = [];
      if (leituras.length) {
        // 4) o catálogo: tudo de uma vez pelo mesclar (travado e «seus» respeitados)
        avisar(ctx, 'catalogo', 0, 1, '');
        const cat1 = catalogos.carregar(jogoId); // pode ter mudado durante a leitura
        if (!cat1 || cat1.ok === false || !Array.isArray(cat1.itens)) {
          return falhou({ motivo: cat1 ? 'catalogo-ilegivel' : 'jogo-inexistente', detalhe: 'o catálogo sumiu ou não abre mais: o que foi lido não entrou' });
        }
        entradas = resolverIds(montarEntradas(leituras), cat1);
        ctx.res.personagens = entradas.filter((e) => e.dono === null).length;
        const r = catalogos.mesclar(jogoId, entradas.map((e) => {
          const item = { id: e.id, tipo: e.tipo, nomes: e.nomes, chave: e.chave, fonte: 'site-oficial' };
          if (e.dono) item.dono = e.dono;
          if (e.apelidos.length) item.apelidos = e.apelidos;
          return item;
        }), { fonte: 'site-oficial' });
        if (!r || r.ok === false) {
          return falhou({ motivo: 'catalogo', detalhe: `o catálogo não aceitou a leitura (${(r && (r.motivo || r.erro)) || 'erro'})` });
        }
        ctx.res.novos = r.novos || 0;
        ctx.res.atualizados = r.atualizados || 0;
        ctx.res.iguais = r.iguais || 0;
        if (Array.isArray(r.erros) && r.erros.length) ctx.res.erros = r.erros.length;
        avisar(ctx, 'catalogo', 1, 1, '');
        estadoNovo.lidoEm = Date.now();
        estadoNovo.paginas = ctx.res.paginas;
        estadoNovo.idiomas = ORDEM_IDIOMAS.filter((c) => leituras.some((l) => l.idioma === c));
      }

      // Completa = todas as páginas desta rodada lidas. A que falhou (404 passageiro, quebrada,
      // tipo errado, grande demais) deixa a leitura incompleta: com o validador guardado, o 304
      // da próxima a esconderia até o site publicar outro sitemap. A proibida pelo robots não
      // conta: o robots igual (assinatura) dá o mesmo resultado; mudou, relê tudo.
      const completa = !ctx.parada && !ctx.aviso && ctx.res.ignoradas === 0;
      if (completa) {
        estadoNovo.completo = true;
        estadoNovo.pedidos = ctx.idiomas.slice();
        estadoNovo.sitemap = validadores;
        estadoNovo.robots = assinatura;
        estadoNovo.itens = entradas.map((e) => e.id);
        // leitura completa: só as URLs de agora, e o registro das baixadas só de quem ainda existe
        const daLeitura = new Set(estadoNovo.itens);
        estadoNovo.urls = new Map();
        estadoNovo.baixadas = new Map(Array.from(estadoNovo.baixadas).filter(([id]) => daLeitura.has(id)));
      } else {
        estadoNovo.completo = false;
        estadoNovo.sitemap = null; // a próxima rodada relê tudo
        estadoNovo.robots = null;
      }
      for (const e of entradas) if (e.url) estadoNovo.urls.set(e.id, e.url);
      alvosImagem = entradas.filter((e) => e.url).map((e) => ({ id: e.id, url: e.url }));
    }

    // 5) as imagens (opcionais), uma por vez, depois do catálogo
    if (ctx.imagens && !ctx.parada) await baixarImagens(ctx, alvosImagem, estadoNovo);

    estadoNovo.verificadoEm = Date.now();
    const gravar = estadoParaGravar(estadoNovo);
    let g = catalogos.registrarFonte(jogoId, 'site-oficial', gravar);
    // ~200 bytes por item: o teto de 256 KB só chega com milhares; se chegar, vai sem as
    // URLs (a próxima rodada com site igual não rebaixa imagem sumida, mas o resto vale)
    if (g && g.ok === false && g.erro === 'dados-grandes') g = catalogos.registrarFonte(jogoId, 'site-oficial', { ...gravar, urls: {} });
    if (!g || g.ok === false) {
      // sem o registro a próxima rodada só relê tudo: não é motivo para dar a leitura por perdida
      ctx.res.registro = (g && g.erro) || 'erro';
    }
    if (ctx.parada) return falhou(ctx.parada);
    const ok = { ok: true };
    if (ctx.aviso === 'teto-paginas') { ok.aviso = ctx.aviso; ok.detalhe = `parei no teto de ${TETO_PAGINAS} páginas por rodada: o resto fica para a próxima`; }
    if (ctx.aviso === 'teto-imagens') { ok.aviso = ctx.aviso; ok.detalhe = `parei no teto de ${TETO_IMAGENS} imagens por rodada: o resto fica para a próxima`; }
    return fim(ok);
  }

  // Imagem só se o item precisa: sem imagem do streamer (importada/sua) e sem esta mesma
  // imagem do site já guardada (o arquivo some quando o backup volta sem as imagens). Item
  // travado (editado à mão ou vindo de planilha) só ganha imagem onde nunca houve uma do
  // site: sem imagem e fora do registro das baixadas — se baixamos e ela sumiu, o streamer tirou.
  function precisaImagem(ctx, item, url, estadoNovo) {
    if (!item) return false;
    const img = item.imagem;
    if (item.travado) return !img && !estadoNovo.baixadas.has(item.id);
    if (!img) return true;
    if (img.origem !== 'site-oficial') return false;
    if (estadoNovo.baixadas.get(item.id) !== hashCurto(url)) return true;
    return !catalogos.caminhoImagem(ctx.jogoId, img.arquivo);
  }
  async function baixarImagens(ctx, alvos, estadoNovo) {
    const precisa = (id, url) => precisaImagem(ctx, catalogos.acharItem(ctx.jogoId, id), url, estadoNovo);
    const porUrl = new Map(); // a mesma imagem para dois itens: baixa uma vez
    for (const a of alvos) {
      if (!precisa(a.id, a.url)) continue;
      const ids = porUrl.get(a.url);
      if (ids) ids.push(a.id); else porUrl.set(a.url, [a.id]);
    }
    const lista = Array.from(porUrl.entries());
    if (lista.length > TETO_IMAGENS) { lista.length = TETO_IMAGENS; ctx.aviso = ctx.aviso || 'teto-imagens'; }
    let feitas = 0;
    for (const [url, ids] of lista) {
      if (ctx.sinal.aborted) { ctx.parada = CANCELADO; break; }
      // A fase leva minutos (uma por vez, com pausa) e o streamer pode pôr a imagem dele
      // nesse meio-tempo (enviada ou da pasta importada): confere de novo antes de pedir
      if (!ids.some((id) => precisa(id, url))) { feitas++; continue; }
      avisar(ctx, 'imagens', feitas, lista.length, chaveDoArquivo(url) || '');
      const r = await baixarImagem(ctx, url);
      feitas++;
      if (r.parar) break;
      if (r.proibida) continue; // já contada em «proibidas»
      if (!r.buf) { if (r.recusada) ctx.res.recusadas++; else ctx.res.ignoradas++; continue; }
      for (const id of ids) {
        // e de novo antes de gravar, sem await no meio: nada do streamer cabe entre as duas
        if (!precisa(id, url)) continue;
        const g = catalogos.guardarImagem(ctx.jogoId, id, r.buf, r.ext, 'site-oficial');
        if (g && g.ok && !g.ignorada) { ctx.res.imagens++; estadoNovo.baixadas.set(id, hashCurto(url)); } else if (g && g.ok === false) ctx.res.recusadas++;
      }
    }
    avisar(ctx, 'imagens', feitas, lista.length, '');
  }
  // → { buf, ext } · { recusada } · { ignorada } · { proibida } · { parar }
  async function baixarImagem(ctx, url) {
    let u;
    try { u = new URL(url); } catch { return { recusada: 'url' }; }
    if (u.protocol !== 'https:' || !HOSTS_IMAGEM.has(u.hostname) || u.port || u.username || u.password) return { recusada: 'host' };
    const r = await pedir(ctx, u.href, { teto: TETO_IMAGEM_BYTES, aceitar: ACEITAR_IMAGEM, tipos: (t) => TIPOS_IMAGEM.has(t) });
    if (r.proibida) { ctx.res.proibidas++; return { proibida: true }; }
    if (encerra(ctx, r, u.href)) return { parar: true };
    if (r.recusada) return { recusada: r.recusada };
    if (r.status !== 200 || !r.buf) return { ignorada: true };
    // a assinatura dos bytes manda (o tipo do cabeçalho já passou, mas pode mentir)
    const ext = tipoDaImagem(r.buf);
    if (!ext) return { recusada: 'assinatura' };
    return { buf: r.buf, ext };
  }

  return { atualizar, cancelar, estado };
}

module.exports = {
  criarDbd,
  // auxiliares puros (sem rede): o teste e quem mais quiser conferir a leitura
  lerRobots, robotsPermite, lerSitemap, paginasDoSitemap, lerPaginaPersonagem,
  IDIOMAS_SITE, PAUSA_PADRAO_MS, PAUSA_MINIMA_MS, TEMPO_MS, TETO_PAGINAS, TETO_IMAGENS,
};
