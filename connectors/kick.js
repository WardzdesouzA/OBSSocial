// Conector de chat do Kick.
// O chat do Kick e distribuido por um servico publico (Pusher). Para entrar na sala
// precisamos do numero interno do chat (chatroom id), que buscamos na API do site.
const WebSocket = require('ws');
const http = require('http');
const https = require('https');
const { execFile } = require('child_process');

// Chaves publicas do Pusher usadas pelo site do Kick (a mais nova primeiro).
const PUSHER_KEYS = ['32cbd69e4b950bf97679', 'eb1d5f283081a78b932c'];
const PUSHER_CLUSTER = 'us2';
// Gancho de teste: um Pusher de mentira (ws://127.0.0.1:...) no lugar do real
const PUSHER_BASE = process.env.OBS_TESTE_KICK_PUSHER || `wss://ws-${PUSHER_CLUSTER}.pusher.com`;

// Quantas páginas de histórico buscar (o Kick devolve 25 por página).
// 8 páginas = até 200 comentários recuperados de uma vez.
const MAX_PAGINAS_HISTORICO = 8;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// ---------------------------------------------------------------------------
// 🟢 v0.169.3: como falar com a API do site do Kick (kick.com/api/...)
//
// O Cloudflare do Kick barra pedidos pela «assinatura» do TLS/HTTP de quem
// pergunta, não pelo que se pergunta: o fetch do Node levava 403 de vez em
// quando — e passou a levar quase sempre. Só que o id do chat (chatroom) só
// vem por essa API, então há caminhos de reserva, tentados nesta ordem:
//   1. fetch do Node (como sempre);
//   2. https do Node com as cifras e os cabeçalhos do Chrome (outra assinatura);
//   3. o curl do próprio sistema (o Windows 10+ traz o curl.exe; Mac e Linux idem);
//   4. o PowerShell (Windows): o Invoke-WebRequest usa o TLS do próprio Windows;
//   5. um navegador aberto neste computador (painel, configurações ou a tela
//      no OBS): a página faz a consulta e devolve a resposta ao servidor.
// O caminho que funcionou fica lembrado para os próximos pedidos (avatares,
// audiência, histórico) e, de meia em meia hora, o programa volta a testar o
// fetch — o bloqueio costuma ser passageiro.
// ---------------------------------------------------------------------------
const KICK_API = process.env.OBS_SOCIAL_KICK_API || 'https://kick.com/api/';
const KICK_TEMPO_MS = Number(process.env.OBS_TESTE_KICK_TEMPO_MS) || 12000;
const KICK_SONDA_MS = 30 * 60 * 1000;   // de quanto em quanto tempo volta a testar o fetch
const KICK_PAUSA_EXTRAS_MS = 60 * 1000; // tudo barrado: os extras (avatar, audiência) esperam
const KICK_VIAS = ['fetch', 'tls', 'curl', 'powershell', 'navegador'];
// Gancho de teste: só estes caminhos, nesta ordem (ex.: «curl,tls»)
const KICK_VIAS_PERMITIDAS = process.env.OBS_TESTE_KICK_VIAS
  ? String(process.env.OBS_TESTE_KICK_VIAS).split(',').map((v) => v.trim()).filter((v) => KICK_VIAS.includes(v))
  : null;
const KICK_VIA_NOME = {
  fetch: 'pelo Node', tls: 'pelo Node com a assinatura do Chrome', curl: 'pelo curl do sistema',
  powershell: 'pelo PowerShell', navegador: 'pelo navegador aberto neste computador',
};
// O Cloudflare barrou (ou pediu verificação): vale tentar o próximo caminho
const KICK_BARRADO = new Set([403, 429, 503]);
const KICK_MARCA = '__OBS_SOCIAL_STATUS__';
// Cifras na ordem do Chrome (TLS 1.3 + 1.2), curvas e assinaturas idem
const CHROME_CIPHERS = 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:'
  + 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:'
  + 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:'
  + 'ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA';
const CHROME_HEADERS = {
  ...BROWSER_HEADERS,
  'Referer': 'https://kick.com/',
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Connection': 'close',
};
let agenteChrome = null;

const kickVia = {
  boa: 'fetch',            // o último caminho que funcionou
  sondaEm: 0,              // quando voltar a testar o fetch (se a boa não for ele)
  tudoBarradoEm: 0,        // a última vez em que NENHUM caminho passou
  indisponiveis: new Set(), // curl/PowerShell que não existem nesta máquina
};
// Gancho do servidor para o caminho 5: { disponivel(): bool, pedir(url): Promise<{status, texto}> }
let navegadorKick = null;
function kickApiConfigurar(op) {
  navegadorKick = op && op.navegador && typeof op.navegador.pedir === 'function' ? op.navegador : null;
}
function kickApiEstado() { return { via: kickVia.boa, tudoBarradoEm: kickVia.tudoBarradoEm }; }

function viaDisponivel(via) {
  if (KICK_VIAS_PERMITIDAS && !KICK_VIAS_PERMITIDAS.includes(via)) return false;
  if (kickVia.indisponiveis.has(via)) return false;
  if (via === 'powershell') return process.platform === 'win32' || !!process.env.OBS_TESTE_KICK_PS;
  if (via === 'navegador') return !!(navegadorKick && navegadorKick.disponivel());
  return true;
}

// Um pedido de verdade não pode virar outra coisa quando passa pelo curl ou
// pelo PowerShell: só endereços http(s) com caracteres comuns.
const ENDERECO_SEGURO = /^https?:\/\/[A-Za-z0-9._\-\/?=&%:~+]+$/;

async function viaFetch(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(KICK_TEMPO_MS) });
  return { status: res.status, texto: await res.text() };
}

function viaTls(url) {
  return new Promise((resolve, reject) => {
    const alvo = new URL(url);
    const mod = alvo.protocol === 'http:' ? http : https;
    const opcoes = { method: 'GET', headers: CHROME_HEADERS, timeout: KICK_TEMPO_MS };
    if (mod === https) {
      if (!agenteChrome) {
        agenteChrome = new https.Agent({
          keepAlive: false, ciphers: CHROME_CIPHERS, ecdhCurve: 'X25519:prime256v1:secp384r1', minVersion: 'TLSv1.2',
          sigalgs: 'ECDSA+SHA256:RSA-PSS+SHA256:RSA+SHA256:ECDSA+SHA384:RSA-PSS+SHA384:RSA+SHA384:RSA-PSS+SHA512:RSA+SHA512',
        });
      }
      opcoes.agent = agenteChrome;
    }
    const req = mod.request(alvo, opcoes, (res) => {
      let corpo = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { if (corpo.length < 4e6) corpo += c; });
      res.on('end', () => resolve({ status: res.statusCode || 0, texto: corpo }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end();
  });
}

function rodarPrograma(exe, args) {
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: KICK_TEMPO_MS + 5000, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') { const e = new Error(`${exe} não encontrado`); e.code = 'ENOENT'; return reject(e); }
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

async function viaCurl(url) {
  if (!ENDERECO_SEGURO.test(url)) throw new Error('endereço fora do padrão');
  const exe = process.env.OBS_TESTE_KICK_CURL || (process.platform === 'win32' ? 'curl.exe' : 'curl');
  const { err, stdout, stderr } = await rodarPrograma(exe, [
    '-sS', '-L', '--max-time', String(Math.ceil(KICK_TEMPO_MS / 1000)),
    '-A', BROWSER_HEADERS['User-Agent'], '-H', 'Accept: application/json', '-H', 'Accept-Language: en-US,en;q=0.9',
    // «\n» aqui é o escape do próprio curl (vira quebra de linha na saída)
    '-o', '-', '-w', '\\n' + KICK_MARCA + '%{http_code}', url,
  ]);
  const i = stdout.lastIndexOf('\n' + KICK_MARCA);
  const status = i >= 0 ? Number(stdout.slice(i + KICK_MARCA.length + 1).trim()) : 0;
  if (!status) throw new Error(stderr.trim() || (err && err.message) || 'o curl não conseguiu conectar');
  return { status, texto: stdout.slice(0, i) };
}

async function viaPowerShell(url) {
  if (!ENDERECO_SEGURO.test(url)) throw new Error('endereço fora do padrão');
  const exe = process.env.OBS_TESTE_KICK_PS || 'powershell.exe';
  const seg = Math.ceil(KICK_TEMPO_MS / 1000);
  // Primeira linha: o status; o resto: o corpo. Só aspas simples lá dentro
  // (o endereço já foi conferido), para o comando não virar outra coisa.
  // O corpo sai dos bytes crus decodificados como UTF-8: o Kick manda o JSON
  // sem «charset», e o PowerShell antigo leria como Latin-1 (João → JoÃ£o).
  const script = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
    + `$h=@{'User-Agent'='${BROWSER_HEADERS['User-Agent']}';'Accept'='application/json';'Accept-Language'='en-US,en;q=0.9'};`
    + `try{$r=Invoke-WebRequest -UseBasicParsing -Uri '${url}' -Headers $h -TimeoutSec ${seg};`
    + '$t=$r.Content;try{$t=[Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())}catch{};'
    + '[Console]::Out.Write([string]$r.StatusCode+[char]10+$t)}'
    + 'catch{$c=0;try{$c=[int]$_.Exception.Response.StatusCode}catch{};[Console]::Out.Write([string]$c+[char]10+$_.Exception.Message)}';
  const { err, stdout, stderr } = await rodarPrograma(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script]);
  const quebra = stdout.indexOf('\n');
  const status = Number((quebra >= 0 ? stdout.slice(0, quebra) : stdout).trim());
  if (!status) throw new Error((quebra >= 0 ? stdout.slice(quebra + 1) : stderr).trim() || (err && err.message) || 'o PowerShell não conseguiu conectar');
  return { status, texto: quebra >= 0 ? stdout.slice(quebra + 1) : '' };
}

async function viaNavegador(url) {
  if (!navegadorKick) { const e = new Error('nenhum navegador aberto neste computador'); e.semNavegador = true; throw e; }
  return navegadorKick.pedir(url);
}

const KICK_PEDIDORES = { fetch: viaFetch, tls: viaTls, curl: viaCurl, powershell: viaPowerShell, navegador: viaNavegador };

// Falha de rede pura (sem resposta HTTP nenhuma) num caminho do Node: os
// outros caminhos usam a mesma internet e vão cair igual — não vale a espera.
// Só as falhas claras (DNS, conexão recusada, sem rota): tempo esgotado e
// conexão derrubada podem ser o próprio Cloudflare segurando o Node — aí os
// outros caminhos ainda valem a pena.
function redeFora(err) {
  const causa = err && (err.cause || err);
  const code = String((causa && causa.code) || '');
  return /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/.test(code);
}

function lembrarVia(via) {
  if (via === kickVia.boa) return;
  if (via === 'fetch') console.log('  🟢 Kick: o caminho normal (fetch do Node) voltou a passar pelo Cloudflare.');
  else console.log(`  🟢 Kick: o Cloudflare barrou o caminho ${KICK_VIA_NOME[kickVia.boa]}; a consulta passou a ser feita ${KICK_VIA_NOME[via]}.`);
  kickVia.boa = via;
}

// Tenta os caminhos na ordem; devolve a resposta do primeiro que passou ou
// null. `est` acumula o que aconteceu (para a mensagem final).
async function tentarVias(url, vias, est) {
  for (const via of vias) {
    if (est.parou || !viaDisponivel(via)) continue;
    est.tentadas.push(via);
    let r;
    try {
      r = await KICK_PEDIDORES[via](url);
    } catch (err) {
      est.ultimoErro = err;
      if (err && err.code === 'ENOENT') kickVia.indisponiveis.add(via);
      // O navegador está com a fila cheia: não é um caminho barrado — o
      // pedido extra desiste sem aprender nada disso
      if (err && err.ocupado && est.extra) { est.parou = true; est.ocupado = true; }
      // A página tentou e o pedido «falhou» sem status: é a cara do desafio
      // do Cloudflare (a resposta 403 vem sem os cabeçalhos CORS, e o
      // navegador esconde o status). Se algum caminho levou 403 nesta rodada,
      // conta como o navegador barrado — a dica certa é passar pela verificação
      if (via === 'navegador' && err && err.corsBarrado) est.navegadorCors = true;
      // Rede fora num caminho do Node, sem NENHUMA resposta HTTP até agora:
      // os outros caminhos vão cair igual
      if ((via === 'fetch' || via === 'tls') && !est.barrado && redeFora(err)) est.parou = true;
      continue;
    }
    if (KICK_BARRADO.has(r.status)) {
      est.barrado = { status: r.status, via };
      if (via === 'navegador') est.navegadorBarrado = true;
      continue;
    }
    lembrarVia(via);
    kickVia.tudoBarradoEm = 0; // passou por algum caminho: os extras voltam na hora
    let json = null;
    try { json = JSON.parse(r.texto); } catch { /* não era JSON: quem pediu confere */ }
    return { status: r.status, ok: r.status >= 200 && r.status < 300, texto: r.texto, json, via };
  }
  return null;
}

// Os pedidos extras (avatar, audiência, histórico) não podem virar uma
// enxurrada de curl/PowerShell quando chegam 50 comentários de uma vez:
// eles usam só o caminho lembrado e, se ele falhar, UM de cada vez percorre
// a cadeia inteira — os outros desistem na hora (a foto volta na varredura).
let extraNaCadeia = false;

// Devolve { status, ok, texto, json, via }. Lança erro quando nenhum caminho
// respondeu — com .barrado (todos levaram 403/429/503), .status, .vias
// (os caminhos tentados), .semNavegador (não havia página aberta para o 5)
// e .navegadorBarrado (a página foi consultada e também levou 403).
// `extra: true` = pedido que não é essencial (avatar, audiência): quando
// tudo acabou de ser barrado, desiste na hora em vez de insistir.
async function kickApi(caminho, opcoes = {}) {
  const url = /^https?:\/\//.test(caminho) ? caminho : KICK_API + caminho;
  const extra = opcoes.extra === true;
  const erroRapido = (msg) => { const e = new Error(msg); e.barrado = true; e.status = 403; e.vias = []; e.rapido = true; return e; };
  if (extra && kickVia.tudoBarradoEm && Date.now() - kickVia.tudoBarradoEm < KICK_PAUSA_EXTRAS_MS) {
    throw erroRapido('Kick barrado agora há pouco; este pedido pode esperar.');
  }
  const ordem = [kickVia.boa, ...KICK_VIAS.filter((v) => v !== kickVia.boa)];
  if (kickVia.boa !== 'fetch' && !extra && Date.now() >= kickVia.sondaEm) {
    kickVia.sondaEm = Date.now() + KICK_SONDA_MS;
    ordem.splice(ordem.indexOf('fetch'), 1);
    ordem.unshift('fetch');
  }
  const est = { extra, tentadas: [], barrado: null, navegadorBarrado: false, navegadorCors: false, ultimoErro: null, parou: false, ocupado: false };
  let r;
  if (!extra) {
    r = await tentarVias(url, ordem, est);
  } else {
    r = await tentarVias(url, ordem.slice(0, 1), est); // só o caminho lembrado
    if (!r && !est.parou) {
      if (extraNaCadeia) throw erroRapido('Outro pedido já está procurando um caminho para o Kick; este pode esperar.');
      extraNaCadeia = true;
      try { r = await tentarVias(url, ordem.slice(1), est); } finally { extraNaCadeia = false; }
    }
  }
  if (r) return r;
  if (est.ocupado) throw erroRapido('O navegador já tem consultas demais na fila; este pedido pode esperar.');
  if (est.barrado && est.navegadorCors) est.navegadorBarrado = true;
  const e = new Error(est.barrado
    ? `Kick respondeu com erro ${est.barrado.status}.`
    : (est.ultimoErro && est.ultimoErro.message) || 'O Kick não respondeu.');
  e.barrado = !!est.barrado;
  e.status = est.barrado ? est.barrado.status : 0;
  e.vias = est.tentadas;
  e.semNavegador = !est.tentadas.includes('navegador');
  e.navegadorBarrado = est.navegadorBarrado;
  if (est.barrado) kickVia.tudoBarradoEm = Date.now();
  throw e;
}

// A frase para o apresentador quando o Cloudflare barrou todos os caminhos
function explicacaoBarrado(err) {
  if (err.navegadorBarrado) {
    return 'O Cloudflare do Kick barrou até o navegador deste computador. Abra kick.com neste mesmo navegador, passe pela verificação «sou humano» e clique em 🔄 aqui.';
  }
  return 'O Cloudflare do Kick barrou o programa. Abra o painel ou as configurações num navegador deste computador e deixe aberto: a consulta passa a ser feita por ele.';
}

// Emotes do Kick vem no texto como [emote:12345:nomeDoEmote]
function buildRuns(content) {
  const runs = [];
  const regex = /\[emote:(\d+):([^\]]*)\]/g;
  let cursor = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > cursor) runs.push({ type: 'text', text: content.slice(cursor, match.index) });
    runs.push({
      type: 'emote',
      alt: match[2] || 'emote',
      url: `https://files.kick.com/emotes/${match[1]}/fullsize`,
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) runs.push({ type: 'text', text: content.slice(cursor) });
  return runs.length ? runs : [{ type: 'text', text: content }];
}

// Cargos que o painel já desenha bonito por conta própria
const CARGOS_KICK = {
  broadcaster: 'dono', moderator: 'mod', subscriber: 'sub',
  vip: 'vip', og: 'og', founder: 'founder', verified: 'verificado',
  bot: 'bot', // a Kick marca os robôs oficiais do chat (Botrix...)
};

// Endereço de imagem só entra se for https (nada de javascript: e afins)
const soHttps = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

// A Kick já mudou o nome dessa chave mais de uma vez ("type" e "name"),
// então aceitamos as duas — o distintivo aparece de qualquer jeito.
const chaveDoSelo = (b) => String(b?.type || b?.name || '');

// A arte que a Kick manda no distintivo pode vir em nomes diferentes
const arteDoSelo = (b) => soHttps(b?.image_url) || soHttps(b?.src)
  || soHttps(b?.image?.src) || soHttps(b?.badge_image?.src);

// Junta os dois formatos de distintivo da Kick num só, com imagem quando existe.
// `arteDoCanal` são os desenhos de assinante que o próprio canal desenhou
// (1 mês, 3 meses, 6 meses...), buscados uma vez ao conectar.
function selosDaKick(badges, badgesV2, arteDoCanal) {
  const imagens = new Map();
  for (const b of badgesV2 || []) {
    const chave = chaveDoSelo(b);
    const url = arteDoSelo(b);
    if (chave && url) imagens.set(chave, url);
  }
  const selos = [];
  const jaTem = new Set();
  const entrar = (b) => {
    const chave = chaveDoSelo(b);
    if (!chave || jaTem.has(chave)) return;
    jaTem.add(chave);
    let img = imagens.get(chave) || arteDoSelo(b);
    // Assinante: usa o desenho que o canal fez para aquele tempo de assinatura
    if (!img && chave === 'subscriber' && arteDoCanal) img = arteDoCanal(Number(b?.count) || 0);
    selos.push({
      id: 'kick:' + chave,
      cargo: (Object.hasOwn(CARGOS_KICK, chave) && CARGOS_KICK[chave]) || null,
      nome: b?.text || chave.replace(/[-_]/g, ' '),
      img: img || null,
    });
  };
  for (const b of badges || []) entrar(b);
  // Os que só existem na versão nova (nível, eventos) entram também
  for (const b of badgesV2 || []) entrar(b);
  return selos;
}

// Monta a busca "quantos meses de assinatura -> qual desenho" a partir da
// lista que o canal publica. Escolhe sempre o maior nível já alcançado.
function arteDeAssinante(lista) {
  const niveis = (Array.isArray(lista) ? lista : [])
    .map((b) => ({ meses: Number(b?.months) || 0, img: arteDoSelo(b) }))
    .filter((n) => n.img)
    .sort((a, b) => a.meses - b.meses);
  if (!niveis.length) return null;
  return (meses) => {
    let escolhido = niveis[0].img;
    for (const n of niveis) { if (n.meses <= meses) escolhido = n.img; }
    return escolhido;
  };
}

// Id curto e sempre igual para o mesmo texto (para o histórico sem id próprio)
function idEstavel(texto) {
  let hash = 0;
  for (const ch of String(texto)) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0;
  return hash.toString(36);
}

async function fetchChannelInfo(slug) {
  const caminhos = [
    `v2/channels/${encodeURIComponent(slug)}`,
    `v1/channels/${encodeURIComponent(slug)}`,
  ];
  let lastError = null;
  for (const caminho of caminhos) {
    try {
      const res = await kickApi(caminho);
      if (res.status === 404) throw new Error(`Canal "${slug}" não encontrado no Kick.`);
      if (!res.ok) { lastError = new Error(`Kick respondeu com erro ${res.status}.`); continue; }
      const data = res.json;
      const chatroomId = data?.chatroom?.id;
      // O id numerico do canal e necessario para o historico de mensagens
      // (o endpoint /messages nao aceita o slug)
      // O id numérico do canal é o que o histórico aceita. Vem em data.id e,
      // como reserva, dentro do próprio chatroom (channel_id).
      if (chatroomId) {
        return {
          chatroomId,
          channelId: data?.id || data?.chatroom?.channel_id || null,
          // Os desenhos de assinante do canal (1 mês, 3 meses, 6 meses...)
          arteAssinante: arteDeAssinante(data?.subscriber_badges),
        };
      }
      lastError = new Error('Resposta do Kick não trouxe o id do chat.');
    } catch (err) {
      lastError = err;
      if (String(err.message).includes('não encontrado')) throw err;
      // 🟢 v0.169.3: todos os caminhos barrados pelo Cloudflare — o v1 levaria
      // o mesmo 403, e cada rodada custa (curl, PowerShell, navegador)
      if (err.barrado) break;
    }
  }
  if (lastError && lastError.barrado) {
    throw new Error(`${lastError.message} ${explicacaoBarrado(lastError)}`);
  }
  throw new Error(
    (lastError ? lastError.message + ' ' : '') +
    'O Kick pode estar bloqueando consultas automáticas (proteção Cloudflare). Tente de novo em instantes.'
  );
}

class KickConnector {
  constructor(channel, handlers) {
    this.channel = channel.trim().toLowerCase().replace(/^@/, '');
    this.handlers = handlers;
    this.ws = null;
    this.stopped = false;
    this.retryMs = 2000;
    this.keyIndex = 0;
    this.chatroomId = null;
    this.channelId = null;
    this.arteAssinante = null;  // desenhos de assinante do canal
    this.jaBuscouHistorico = false; // a 1ª busca vai fundo; as seguintes, só o recente
    this.buscando = false;          // nunca duas buscas ao mesmo tempo
  }

  async start() {
    this.handlers.onStatus('connecting', `Buscando o chat de ${this.channel} no Kick...`);
    try {
      const info = await fetchChannelInfo(this.channel);
      this.chatroomId = info.chatroomId;
      this.channelId = info.channelId;
      this.arteAssinante = info.arteAssinante || null;
      this.connectRetryMs = 0; // conectou: zera a espera
    } catch (err) {
      if (this.stopped) return;
      // Canal inexistente e permanente; o resto (Cloudflare 403 etc.) e
      // passageiro: insiste sozinho com espera crescente, sem o streamer
      // precisar clicar em reconectar no meio da live
      if (String(err.message).includes('não encontrado')) {
        this.handlers.onStatus('error', err.message);
        return;
      }
      this.connectRetryMs = Math.min((this.connectRetryMs || 15000) * 2, 300000);
      const s = Math.round(this.connectRetryMs / 1000);
      // 🟢 v0.169.3: «insiste» avisa o servidor para NÃO desligar este
      // conector — antes ele era desligado no erro, e a nova tentativa
      // prometida nunca acontecia (só clicando em 🔄)
      this.handlers.onStatus('error', `${err.message} Nova tentativa sozinha em ${s}s.`, { insiste: true });
      this.connectTimer = setTimeout(() => { this.connectTimer = null; if (!this.stopped) this.start(); }, this.connectRetryMs);
      return;
    }
    if (this.stopped) return;
    this.open();
  }

  // 🟢 v0.169.3: apareceu um jeito novo de consultar o Kick (uma página
  // abriu neste computador): se está só esperando a próxima tentativa,
  // tenta agora em vez de esperar os minutos combinados.
  acordar() {
    if (this.stopped || !this.connectTimer) return;
    clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.start();
  }

  open() {
    if (this.stopped) return;
    const key = PUSHER_KEYS[this.keyIndex % PUSHER_KEYS.length];
    const url = `${PUSHER_BASE}/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`;
    const ws = new WebSocket(url, { headers: { Origin: 'https://kick.com' } });
    this.ws = ws;
    let established = false;

    ws.on('message', (raw) => {
      // 🔒 v0.127.1: um pacote fora do padrão não pode derrubar o programa —
      // avisa uma vez no console e segue
      try {
        const acao = this.handlePusher(raw);
        if (acao === 'estabelecida') {
          established = true;
          this.retryMs = 2000;
          ws.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: { auth: '', channel: `chatrooms.${this.chatroomId}.v2` },
          }));
          this.handlers.onStatus('connected', `Lendo o chat de ${this.channel}`);
          this.fetchHistory();
        } else if (acao === 'ping') {
          ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        } else if (acao === 'erro' && !established) {
          // Chave do app pode ter mudado; tenta a proxima.
          this.keyIndex++;
          try { ws.close(); } catch {}
        }
      } catch (err) {
        if (!this.avisouPacote) {
          this.avisouPacote = true;
          console.log('  ⚠️ Kick: pacote fora do padrão ignorado (' + String(err && err.message || err).slice(0, 80) + ').');
        }
      }
    });

    // Só o socket ATUAL manda reconectar: um socket antigo caindo depois
    // não pode disparar uma segunda conexão em paralelo
    ws.on('close', () => { if (this.ws === ws) this.scheduleReconnect(); });
    ws.on('error', () => { /* o evento close cuida da reconexao */ });
  }

  // Um pacote do Pusher. Devolve o que o socket precisa fazer em seguida
  // ('estabelecida', 'ping', 'erro') ou null quando ja foi tudo tratado aqui.
  handlePusher(raw) {
    let packet;
    try { packet = JSON.parse(raw.toString()); } catch { return null; }
    if (!packet || typeof packet !== 'object') return null;

    if (packet.event === 'pusher:connection_established') return 'estabelecida';
    if (packet.event === 'pusher:ping') return 'ping';
    if (packet.event === 'pusher:error') return 'erro';
    if (packet.event === 'App\\Events\\ChatMessageEvent') {
      let data;
      try { data = JSON.parse(packet.data); } catch { return null; }
      if (!data || typeof data !== 'object') return null;
      this.emitChat(data, false);
      return null;
    }
    // 🗑️ Moderação: mensagem apagada, pessoa banida/silenciada, chat limpo.
    // Sem isto, o que o mod tirou do chat continuava na tela da live.
    if (!this.handlers.onRemove) return null;
    let dados = null;
    try { dados = JSON.parse(packet.data); } catch { return null; }
    if (packet.event === 'App\\Events\\MessageDeletedEvent') {
      const id = dados?.message?.id || dados?.id;
      if (id) this.handlers.onRemove({ platform: 'kick', ids: [String(id)] });
    } else if (packet.event === 'App\\Events\\UserBannedEvent') {
      const quem = dados?.user?.slug || dados?.user?.username;
      if (quem) this.handlers.onRemove({ platform: 'kick', autor: String(quem) });
    } else if (packet.event === 'App\\Events\\ChatroomClearEvent') {
      this.handlers.onRemove({ platform: 'kick', tudo: true });
    }
    return null;
  }

  emitChat(data, fromHistory) {
    if (!data || typeof data !== 'object') return; // 🔒 v0.127.1
    const ts = data.created_at ? Date.parse(data.created_at) || Date.now() : Date.now();
    // ATENÇÃO: aqui existia "do histórico, só o que for mais novo que a última
    // mensagem já emitida". Como o histórico do Kick é justamente o passado
    // recente, isso jogava fora TODAS as mensagens sempre que a conexão caía e
    // voltava — o buraco nunca era recuperado. Quem barra repetição é o
    // servidor, pelo id da mensagem, que o Kick fornece.
    const sender = (data.sender && typeof data.sender === 'object') ? data.sender : {};
    // 🔒 v0.127.1: formas conferidas — a Kick já mudou o formato mais de uma vez
    const brutos = Array.isArray(sender.identity?.badges) ? sender.identity.badges : [];
    const brutosV2 = Array.isArray(sender.identity?.badges_v2) ? sender.identity.badges_v2 : [];
    const badges = brutos
      .map((b) => (b && typeof b === 'object' ? b.type : null))
      .filter((t) => typeof t === 'string' && t)
      .map((t) => (Object.hasOwn(CARGOS_KICK, t) ? CARGOS_KICK[t] : t));
    this.handlers.onMessage({
      platform: 'kick',
      channel: this.channel,
      // Sem id próprio (raro), monta um id estável a partir do conteúdo: assim
      // a mesma mensagem do histórico não entra duas vezes
      id: data.id || (fromHistory
        ? `kick-h-${ts}-${idEstavel(`${(data.sender || {}).username}|${data.content}`)}`
        : `kick-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      author: sender.username || 'anônimo',
      authorLogin: String(sender.slug || sender.username || '').toLowerCase() || null,
      authorColor: sender.identity?.color || null,
      avatar: null,
      badges,
      // Kick: founder (fundador, primeiros assinantes) tem nivel proprio;
      // os demais subs entram como 'kick'
      subTier: badges.includes('founder') ? 'kickFounder'
        : badges.includes('sub') ? 'kick' : null,
      // 🏷️ Distintivos com a arte da própria Kick. Os "badges_v2" trazem a
      // imagem (nível do canal, assinatura, eventos); os "badges" trazem o
      // cargo e o nome curto. Juntamos os dois pelo nome.
      selos: selosDaKick(brutos, brutosV2, this.arteAssinante),
      runs: buildRuns(String(data.content || '')),
      timestamp: ts,
    });
  }

  // Recupera as mensagens que o proprio site do Kick ainda guarda.
  //
  // O endpoint devolve 25 por vez E um "cursor" para continuar mais para tras.
  // Antes so a primeira pagina era lida, entao o maximo que voltava eram 25
  // comentarios, por mais longo que fosse o buraco. Agora seguimos o cursor.
  async fetchHistory() {
    if (this.handlers.recoverEnabled && !this.handlers.recoverEnabled()) return;
    // O Pusher reconecta sozinho de vez em quando; sem esta trava, cada
    // reconexão dispararia a busca inteira de novo, uma em cima da outra.
    if (this.buscando) return;
    this.buscando = true;
    try {
      await this.buscarHistorico();
    } finally {
      this.buscando = false;
      this.jaBuscouHistorico = true;
    }
  }

  async buscarHistorico() {
    // O endpoint de mensagens usa o ID NUMERICO do canal (com o slug ele
    // responde erro e o historico nunca vinha). Tentamos o id primeiro e o
    // slug como reserva, caso o formato mude de novo.
    const alvos = [];
    if (this.channelId) alvos.push(String(this.channelId));
    alvos.push(encodeURIComponent(this.channel));
    for (const alvo of alvos) {
      // Na 1ª vez (ou num 🔄 pedido por você) vale a pena ir fundo; numa
      // reconexão automática o buraco costuma ser de segundos.
      const paginas = this.jaBuscouHistorico ? 3 : MAX_PAGINAS_HISTORICO;
      const recolhidas = await this.buscarPaginas(alvo, paginas);
      if (recolhidas === null) continue; // esse alvo nao respondeu: tenta o outro
      if (recolhidas.length) {
        // Do mais antigo para o mais novo, para a linha do tempo ficar certa
        recolhidas.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
        for (const m of recolhidas) {
          if (this.stopped) return;
          this.emitChat(m, true);
        }
        console.log(`  🕘 Kick: histórico com ${recolhidas.length} mensagens (o servidor descarta as repetidas).`);
      }
      return;
    }
    // Historico e um extra: sem ele, segue so o tempo real.
  }

  // Le ate MAX_PAGINAS_HISTORICO paginas seguindo o cursor. Devolve null se o
  // endereco nem respondeu (para o chamador tentar o outro formato).
  async buscarPaginas(alvo, maxPaginas = MAX_PAGINAS_HISTORICO) {
    const juntas = [];
    const vistos = new Set();
    let cursor = '';
    let respondeu = false;
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      if (this.stopped) break;
      const caminho = `v2/channels/${alvo}/messages`
        + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
      let payload;
      try {
        const res = await kickApi(caminho, { extra: true });
        if (!res.ok || !res.json) break;
        payload = res.json;
      } catch { break; }
      respondeu = true;
      const brutaLista = payload?.data?.messages || payload?.messages;
      const lista = Array.isArray(brutaLista) ? brutaLista : [];
      if (!lista.length) break;
      let novas = 0;
      for (const m of lista) {
        // "reply" é uma resposta a outra mensagem: também é comentário e antes
        // era descartada. Só ficam de fora os avisos que não têm texto.
        if (!m || !m.content) continue;
        if (m.type && m.type !== 'message' && m.type !== 'reply') continue;
        const chave = m.id || `${m.created_at}|${m.sender?.username}|${m.content}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        juntas.push(m);
        novas += 1;
      }
      if (!novas) break; // a mesma página de novo: não há mais o que buscar
      const proximo = payload?.data?.cursor;
      if (!proximo || String(proximo) === cursor) break;
      cursor = String(proximo);
      // Um respiro entre as páginas para não parecer robô apressado
      await new Promise((r) => setTimeout(r, 250));
    }
    return respondeu ? juntas : null;
  }

  scheduleReconnect() {
    if (this.stopped) return;
    this.handlers.onStatus('connecting', 'Conexão caiu, reconectando...');
    setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  stop() {
    this.stopped = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.ws) try { this.ws.close(); } catch {}
  }
}

module.exports = { KickConnector, kickApi, kickApiConfigurar, kickApiEstado };
