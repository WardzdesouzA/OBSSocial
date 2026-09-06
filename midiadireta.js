// ===========================================================================
// 🎬 «Pegar só o vídeo» — a sonda da 🎞️ Mídia direta (v0.133)
//
// Muitos sites publicam o ARQUIVO do vídeo nas próprias metatags (og:video,
// twitter:player:stream, o contentUrl do JSON-LD) — é daí que o WhatsApp e o
// Discord tiram a prévia deles. Quando dá para achar, a mídia direta deixa de
// ser um quadro do site e vira um vídeo NOSSO: play, régua, volume,
// velocidade, 🔁 e tela cheia comandados pelo painel.
//
// O YouTube fica de fora de propósito: o quadro dele já obedece a tudo pela
// API oficial. O Instagram e o TikTok não publicam o arquivo (a página vem só
// com a casca e o muro de login), então continuam como quadro do site.
//
// Mora num arquivo à parte para poder ser testado sozinho: quem usa injeta o
// classifyAddress (a classificação de IP do servidor, que é quem sabe o que é
// «rede de casa») e o tipoMidiaDiretaPorNome (as extensões que a tela abre).
// ===========================================================================
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const path = require('path');

function criarSonda({ classifyAddress, tipoMidiaDiretaPorNome, remotoMs }) {
  const MD_SONDA_BYTES = 512 * 1024;  // o cabeçalho da página basta
  const MD_SONDA_MS = 8000;
  const MD_SONDA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  // 🔒 v0.165: as formas disfarçadas do mesmo endereço de casa — 0.0.0.0,
  // «::», o ::1 por extenso, IPv4 mapeado em IPv6 (::ffff:7f00:1), a faixa
  // CGNAT (100.64/10), multicast — viram a forma canônica ANTES de perguntar
  // ao classifyAddress, que só conhece as formas de sempre.
  function ipCanonico(bruto) {
    const h = String(bruto || '').replace(/^\[|\]$/g, '').toLowerCase();
    if (net.isIPv4(h)) return h;
    if (!net.isIPv6(h)) return null;
    let s = h.split('%')[0]; // a zona (%eth0) não conta
    const misto = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
    if (misto) { // ::ffff:1.2.3.4 → ::ffff:0102:0304
      const p = misto[2].split('.').map(Number);
      s = misto[1] + (((p[0] << 8) | p[1]).toString(16)) + ':' + (((p[2] << 8) | p[3]).toString(16));
    }
    const [esq, dir = ''] = s.split('::');
    const a = esq ? esq.split(':') : [];
    const b = dir ? dir.split(':') : [];
    const grupos = s.includes('::') ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
    if (grupos.length !== 8) return null;
    let n = 0n;
    for (const g of grupos) n = (n << 16n) | BigInt(parseInt(g || '0', 16) || 0);
    if (n === 0n) return '0.0.0.0';
    if (n === 1n) return '127.0.0.1';
    const alto = n >> 32n;
    if (alto === 0xffffn || alto === 0n) { // IPv4 mapeado (::ffff:a.b.c.d) ou «compatível» (::a.b.c.d)
      const baixo = Number(n & 0xffffffffn);
      return [baixo >>> 24, (baixo >>> 16) & 255, (baixo >>> 8) & 255, baixo & 255].join('.');
    }
    return grupos.map((g) => (parseInt(g || '0', 16) || 0).toString(16)).join(':'); // expandido, sem zeros à esquerda
  }
  function ehPublico(bruto) {
    const ip = ipCanonico(bruto);
    if (!ip) return false;
    if (net.isIPv4(ip)) {
      const p = ip.split('.').map(Number);
      if (p[0] === 0 || p[0] >= 224) return false;                 // 0.0.0.0/8, multicast, reservado, broadcast
      if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return false; // CGNAT (100.64/10): rede da operadora, não a internet
    }
    return classifyAddress(ip) === 'remote';
  }

  // 🔒 Só endereços da internet: o servidor não vai buscar nada em 127.0.0.1,
  // na rede local nem no 169.254.169.254 dos provedores de nuvem — senão uma
  // URL colada no painel viraria uma sonda de dentro da máquina para fora.
  // Devolve a lista de endereços CONFERIDOS (ou null): a conexão vai usar
  // exatamente esses, sem uma segunda consulta de DNS que pudesse responder
  // outra coisa (o «rebinding»).
  function enderecosPublicos(hostname) {
    return new Promise((resolve) => {
      const h = String(hostname || '').replace(/^\[|\]$/g, '');
      if (!h) return resolve(null);
      if (net.isIP(h)) return resolve(ehPublico(h) ? [{ address: h, family: net.isIPv6(h) ? 6 : 4 }] : null);
      dns.lookup(h, { all: true }, (err, enderecos) => {
        if (err || !Array.isArray(enderecos) || !enderecos.length) return resolve(null);
        resolve(enderecos.every((e) => ehPublico(e.address)) ? enderecos.map((e) => ({ address: e.address, family: e.family })) : null);
      });
    });
  }
  async function hostPublicoDaSonda(hostname) { return !!(await enderecosPublicos(hostname)); }
  // o «lookup» que o http.request vai usar: a lista já conferida, e só ela
  function pinar(conferidos) {
    return (host, opcoes, cb) => {
      if (typeof opcoes === 'function') { cb = opcoes; opcoes = {}; }
      if (opcoes && opcoes.all) return cb(null, conferidos.map((e) => ({ address: e.address, family: e.family })));
      cb(null, conferidos[0].address, conferidos[0].family);
    };
  }

  // Uma busca curta e vigiada: só http(s), só host público, no máximo 3 saltos
  // (cada um conferido de novo), 8 s e meio mega
  async function buscarDaSonda(alvo, { metodo = 'GET', saltos = 0 } = {}) {
    let u;
    try { u = new URL(alvo); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const conferidos = await enderecosPublicos(u.hostname);
    if (!conferidos) return null;
    return new Promise((resolve) => {
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, {
        method: metodo,
        timeout: MD_SONDA_MS,
        lookup: pinar(conferidos),
        headers: {
          // vários sites só devolvem as metatags para um navegador de verdade
          'User-Agent': MD_SONDA_UA,
          Accept: metodo === 'GET' ? 'text/html,application/xhtml+xml,*/*;q=0.8' : '*/*',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
        },
      }, (res) => {
        const status = res.statusCode || 0;
        const destino = res.headers.location;
        if (status >= 300 && status < 400 && destino && saltos < 3) {
          res.resume();
          let prox;
          try { prox = new URL(destino, u).toString(); } catch { return resolve(null); }
          return buscarDaSonda(prox, { metodo, saltos: saltos + 1 }).then(resolve, () => resolve(null));
        }
        if (status < 200 || status >= 300) { res.resume(); return resolve(null); }
        const tipo = String(res.headers['content-type'] || '');
        const cabecalhos = res.headers;
        if (metodo !== 'GET') { res.resume(); return resolve({ tipo, url: u.toString(), cabecalhos }); }
        let bytes = 0;
        const partes = [];
        res.on('data', (c) => {
          const cabe = Math.max(0, MD_SONDA_BYTES - bytes);
          if (cabe > 0) partes.push(c.length > cabe ? c.subarray(0, cabe) : c);
          bytes += c.length;
          if (bytes >= MD_SONDA_BYTES) res.destroy();
        });
        const fim = () => resolve({ tipo, url: u.toString(), cabecalhos, texto: Buffer.concat(partes).toString('utf8') });
        res.on('end', fim);
        res.on('close', fim);
        res.on('error', () => resolve(null));
      });
      req.on('timeout', () => req.destroy());
      req.on('error', () => resolve(null));
      req.end();
    });
  }

  const desescaparHtml = (s) => String(s)
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

  // Os endereços que a página publica apontando para o arquivo do vídeo
  function candidatosDeVideo(html) {
    const querem = ['og:video:secure_url', 'og:video:url', 'og:video', 'twitter:player:stream',
      'og:audio:secure_url', 'og:audio:url', 'og:audio'];
    const achados = new Map();
    for (const tag of String(html).match(/<meta\b[^>]*>/gi) || []) {
      const chave = ((/(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1] || '').toLowerCase();
      const valor = (/content\s*=\s*["']([^"']+)["']/i.exec(tag) || [])[1];
      if (chave && valor && querem.includes(chave) && !achados.has(chave)) achados.set(chave, desescaparHtml(valor));
    }
    const lista = querem.map((k) => achados.get(k)).filter(Boolean);
    // JSON-LD: o contentUrl de um VideoObject
    for (const bloco of String(html).match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]{0,40000}?<\/script>/gi) || []) {
      for (const m of bloco.matchAll(/"contentUrl"\s*:\s*"([^"]{5,800})"/g)) lista.push(m[1].replace(/\\\//g, '/'));
    }
    return [...new Set(lista)].slice(0, 8);
  }

  // 🚫 v0.135: o site diz «não me abra dentro de um quadro»?
  //
  // Dois cabeçalhos mandam nisso, e o navegador obedece: o antigo
  // x-frame-options (DENY / SAMEORIGIN) e o frame-ancestors da CSP, que é
  // quem vale hoje. O X, o Reddit e o Facebook usam isso — por isso a página
  // deles aparecia como aquela caixa cinza de «bloqueado». Não dá para furar
  // (nem deveria): o que dá é AVISAR, em vez de mandar a caixa para a live.
  function recusaSerQuadro(cabecalhos) {
    const cab = cabecalhos || {};
    const pega = (nome) => {
      const v = cab[nome];
      return String(Array.isArray(v) ? v.join(',') : (v || ''));
    };
    if (/\b(deny|sameorigin|allow-from)\b/i.test(pega('x-frame-options'))) return true;
    const csp = pega('content-security-policy');
    const m = /(?:^|;)\s*frame-ancestors([^;]*)/i.exec(csp);
    if (!m) return false;                        // não falou nada: pode embutir
    const quem = m[1].trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!quem.length || quem.includes("'none'")) return true;
    // só passa quem libera qualquer origem — uma lista de sites nunca inclui a
    // tela do OBS Social, que roda no computador de quem transmite
    return !quem.some((q) => q === '*' || q === 'http:' || q === 'https:' || q === 'http://*' || q === 'https://*');
  }

  // A extensão do endereço (sem a query), para quando o servidor não diz o tipo
  function tipoPelaUrl(endereco) {
    try { return tipoMidiaDiretaPorNome(path.posix.basename(new URL(endereco).pathname)); } catch { return null; }
  }

  // Procura o arquivo do vídeo de uma página. Devolve { url, tipo } ou null.
  async function sondarVideoDireto(paginaUrl) {
    const pagina = await buscarDaSonda(paginaUrl);
    if (!pagina) return null;
    // o endereço já era o próprio arquivo (um redirecionamento para .mp4)
    if (/^video\//i.test(pagina.tipo)) return { url: pagina.url, tipo: 'video' };
    if (/^audio\//i.test(pagina.tipo)) return { url: pagina.url, tipo: 'audio' };
    if (!pagina.texto || !/^(text\/html|application\/xhtml)/i.test(pagina.tipo)) return null;
    for (const bruto of candidatosDeVideo(pagina.texto)) {
      let alvo;
      try { alvo = new URL(bruto, pagina.url).toString(); } catch { continue; }
      // 🚫 listas HLS/DASH não tocam num <video> comum, e um endereço de PÁGINA
      // de player (…/embed/…) é outro quadro, não o arquivo
      if (/\.(m3u8|mpd)(\?|$)/i.test(alvo)) continue;
      if (/\/(embed|player|watch)(\/|\?|$)/i.test(alvo) && !tipoPelaUrl(alvo)) continue;
      const cab = await buscarDaSonda(alvo, { metodo: 'HEAD' });
      const tipo = String((cab && cab.tipo) || '');
      if (/^video\//i.test(tipo)) return { url: alvo, tipo: 'video' };
      if (/^audio\//i.test(tipo)) return { url: alvo, tipo: 'audio' };
      // servidor que recusa HEAD: vale a extensão do endereço
      if (!cab) {
        const t = tipoPelaUrl(alvo);
        if (t === 'video' || t === 'audio') return { url: alvo, tipo: t };
      }
    }
    return null;
  }

  // 📡 v0.165: o arquivo achado (pela sonda ou pelo extrator) passa a ser
  // RETRANSMITIDO pelo OBS Social, em vez de o navegador ir buscar no CDN do
  // site. Motivo real, visto num Edge: o mesmo bloqueador de rastreamento
  // que escondia o widget do X barrava o video.twimg.com, e a prévia do
  // painel ficava preta com a régua andando. Vindo de localhost, nem
  // bloqueador, nem checagem de origem, nem CORS têm o que barrar — e os
  // cabeçalhos que o yt-dlp pediu (User-Agent, Referer…) vão junto.
  //
  // Abre a conexão com a fonte e devolve a RESPOSTA (um fluxo), seguindo até
  // 3 redirecionamentos — cada salto conferido de novo: só host público.
  const MD_REMOTO_MS = Number(remotoMs) > 0 ? Number(remotoMs) : 15000;
  const CAB_QUE_NAO_VAO = new Set(['host', 'range', 'connection', 'content-length', 'accept-encoding', 'transfer-encoding', 'te', 'upgrade', 'proxy-connection', 'keep-alive']);
  const CAB_SO_DO_MESMO_HOST = /^(cookie|authorization|proxy-authorization)$/i;
  function abrirRemoto(alvo, { metodo = 'GET', cabecalhos = {}, saltos = 0 } = {}) {
    return new Promise(async (resolve) => {
      let u;
      try { u = new URL(alvo); } catch { return resolve(null); }
      if (!/^https?:$/.test(u.protocol)) return resolve(null);
      const conferidos = await enderecosPublicos(u.hostname);
      if (!conferidos) return resolve(null);
      const lib = u.protocol === 'https:' ? https : http;
      let req;
      let respondeu = false;
      try {
        req = lib.request(u, { method: metodo, timeout: MD_REMOTO_MS, lookup: pinar(conferidos), headers: cabecalhos }, (res) => {
          // o limite de tempo vale até a fonte RESPONDER: depois, o fluxo
          // pode ficar parado à vontade (o player pausa a leitura quando o
          // buffer enche — 15 s parado num vídeo longo é o normal)
          respondeu = true;
          try { req.setTimeout(0); if (res.socket) res.socket.setTimeout(0); } catch { /* sem socket */ }
          const status = res.statusCode || 0;
          const destino = res.headers.location;
          if (status >= 300 && status < 400 && destino && saltos < 3) {
            res.resume();
            let prox;
            try { prox = new URL(destino, u); } catch { return resolve(null); }
            // 🔒 credenciais (Cookie, Authorization) não seguem para OUTRO host
            let cab = cabecalhos;
            if (prox.hostname !== u.hostname) {
              cab = {};
              for (const [k, v] of Object.entries(cabecalhos)) if (!CAB_SO_DO_MESMO_HOST.test(k)) cab[k] = v;
            }
            return abrirRemoto(prox.toString(), { metodo, cabecalhos: cab, saltos: saltos + 1 }).then(resolve, () => resolve(null));
          }
          resolve(res);
        });
      } catch { return resolve(null); }
      req.on('timeout', () => { if (!respondeu) req.destroy(); });
      req.on('error', () => resolve(null));
      req.end();
    });
  }

  // Serve /midia-direta/remota/<id>: a faixa (Range) que o player pediu vai
  // para a fonte, e a resposta dela (200/206/416, tipo, tamanho, faixa) volta
  // como veio — o seek do player continua funcionando. Sem cache, sem
  // gravar nada em disco: o vídeo continua vindo da fonte, só que por aqui.
  async function servirRemoto(req, res, entrada) {
    const metodo = req.method === 'HEAD' ? 'HEAD' : 'GET';
    const cab = { 'User-Agent': MD_SONDA_UA, Accept: '*/*', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' };
    for (const [k, v] of Object.entries((entrada && entrada.cabecalhos) || {})) {
      if (typeof v === 'string' && v && !CAB_QUE_NAO_VAO.has(k.toLowerCase())) cab[k] = v;
    }
    if (req.headers.range) cab.Range = String(req.headers.range);
    // o player pode desistir ENQUANTO a fonte ainda nem respondeu (um seek
    // atrás do outro): a busca na fonte é derrubada assim que ela abrir
    let fonte = null;
    let desistiu = false;
    res.on('close', () => { desistiu = true; if (fonte) { try { fonte.destroy(); } catch { /* já morreu */ } } });
    fonte = await abrirRemoto(entrada.url, { metodo, cabecalhos: cab });
    if (desistiu || res.destroyed) { if (fonte) { try { fonte.resume(); fonte.destroy(); } catch { /* já morreu */ } } return; }
    const recusa = (texto) => {
      if (fonte) { try { fonte.resume(); fonte.destroy(); } catch { /* já morreu */ } }
      if (res.headersSent) { try { res.destroy(); } catch { /* já fechou */ } return; }
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(texto);
    };
    if (!fonte) return recusa('A fonte da mídia não respondeu.');
    const status = fonte.statusCode || 0;
    if (status !== 200 && status !== 206 && status !== 416) return recusa('A fonte da mídia recusou o pedido (HTTP ' + status + ').');
    const tipoFonte = String(fonte.headers['content-type'] || '');
    const tipo = /^(video|audio|image)\//i.test(tipoFonte) ? tipoFonte
      : (entrada.tipo === 'audio' ? 'audio/mpeg' : entrada.tipo === 'imagem' ? 'image/jpeg' : 'video/mp4');
    const saida = {
      'Content-Type': tipo,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    };
    for (const nome of ['content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
      if (fonte.headers[nome]) saida[nome] = fonte.headers[nome];
    }
    if (status === 206 && !saida['accept-ranges']) saida['accept-ranges'] = 'bytes';
    res.writeHead(status, saida);
    if (metodo === 'HEAD' || status === 416) { fonte.resume(); fonte.destroy(); res.end(); return; }
    fonte.on('error', () => { try { res.destroy(); } catch { /* já fechou */ } });
    fonte.pipe(res);
  }

  return { hostPublicoDaSonda, enderecosPublicos, ipCanonico, buscarDaSonda, candidatosDeVideo, tipoPelaUrl, sondarVideoDireto, recusaSerQuadro, abrirRemoto, servirRemoto };
}

module.exports = { criarSonda };
