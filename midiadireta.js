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

function criarSonda({ classifyAddress, tipoMidiaDiretaPorNome }) {
  const MD_SONDA_BYTES = 512 * 1024;  // o cabeçalho da página basta
  const MD_SONDA_MS = 8000;
  const MD_SONDA_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

  // 🔒 Só endereços da internet: o servidor não vai buscar nada em 127.0.0.1,
  // na rede local nem no 169.254.169.254 dos provedores de nuvem — senão uma
  // URL colada no painel viraria uma sonda de dentro da máquina para fora
  function hostPublicoDaSonda(hostname) {
    return new Promise((resolve) => {
      const h = String(hostname || '').replace(/^\[|\]$/g, '');
      if (!h) return resolve(false);
      if (net.isIP(h)) return resolve(classifyAddress(h) === 'remote');
      dns.lookup(h, { all: true }, (err, enderecos) => {
        if (err || !Array.isArray(enderecos) || !enderecos.length) return resolve(false);
        resolve(enderecos.every((e) => classifyAddress(e.address) === 'remote'));
      });
    });
  }

  // Uma busca curta e vigiada: só http(s), só host público, no máximo 3 saltos
  // (cada um conferido de novo), 8 s e meio mega
  async function buscarDaSonda(alvo, { metodo = 'GET', saltos = 0 } = {}) {
    let u;
    try { u = new URL(alvo); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    if (!(await hostPublicoDaSonda(u.hostname))) return null;
    return new Promise((resolve) => {
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request(u, {
        method: metodo,
        timeout: MD_SONDA_MS,
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

  return { hostPublicoDaSonda, buscarDaSonda, candidatosDeVideo, tipoPelaUrl, sondarVideoDireto, recusaSerQuadro };
}

module.exports = { criarSonda };
