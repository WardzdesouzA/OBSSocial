// ===========================================================================
// 🧪 Extrator opcional da 🎞️ Mídia direta (v0.134) — o yt-dlp baixado sob
// demanda, do mesmo jeito que o whisper.cpp da transcrição.
//
// A sonda do v0.133 lê as metatags da página e resolve a maioria dos sites.
// Alguns (Instagram, TikTok e companhia) não publicam o arquivo em lugar
// nenhum: a página vem só com a casca. Para esses, quem sabe achar é o
// yt-dlp — um programa livre e famoso que NÃO vem embutido no OBS Social:
// quem quiser liga em 🧪 Labs e baixa em 🔌 Conexões, com um clique.
//
// Aqui só se descobre o ENDEREÇO do arquivo (nada é gravado no disco): o
// vídeo continua tocando direto da fonte, agora dentro do nosso player — com
// play, régua, volume, velocidade, 🔁 e tela cheia.
//
// ⚖️ Cada site tem os seus termos, e mostrar conteúdo de terceiros na live é
// responsabilidade de quem transmite. O programa não decide isso por ninguém.
// ===========================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync } = require('child_process');

// Os executáveis prontos do projeto (um arquivo só, sem instalador)
const BASE_YTDLP = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const ARQUIVOS = { win32: 'yt-dlp.exe', darwin: 'yt-dlp_macos', linux: 'yt-dlp_linux' };
const LIMITE_BYTES = 60 * 1024 * 1024;   // o executável tem ~30 MB
const LIMITE_SAIDA = 8 * 1024 * 1024;    // o JSON de um vídeo cabe folgado
const TEMPO_MAX_MS = 45 * 1000;          // o site demora? paciência tem limite
const CACHE_MS = 8 * 60 * 1000;          // o endereço achado vale por um tempo
const MAX_CACHE = 40;

const nomeDoArquivo = () => ARQUIVOS[process.platform] || 'yt-dlp';

class Extrator {
  // opcoes: { dir, aoEvento(evento), ehPublico(hostname)->Promise<bool>, base? }
  constructor(opcoes = {}) {
    this.dir = opcoes.dir;
    this.base = opcoes.base || BASE_YTDLP;
    this.aoEvento = typeof opcoes.aoEvento === 'function' ? opcoes.aoEvento : () => {};
    this.ehPublico = typeof opcoes.ehPublico === 'function' ? opcoes.ehPublico : async () => true;
    this.download = null;      // { pct, req, cancelado }
    this.cache = new Map();    // url da página → { em, achado }
    this.falhas = new Map();   // 🧭 v0.166: url da página → { motivo, detalhe } da última tentativa
    this.rodando = 0;
    this._sistema = undefined; // caminho do yt-dlp instalado na máquina (uma busca só)
    this._versao = null;
  }

  // ---------- onde está o programa ----------
  _temArquivo(p) { try { return fs.statSync(p).size > 0; } catch { return false; } }

  _noSistema() {
    if (this._sistema === undefined) {
      this._sistema = null;
      try {
        const r = spawnSync('yt-dlp', ['--version'], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
        if (!r.error && r.status === 0) this._sistema = 'yt-dlp';
      } catch { /* não tem: sem problema */ }
    }
    return this._sistema;
  }

  // 1) o que baixamos aqui  2) o que já estava instalado na máquina
  onde() {
    const baixado = path.join(this.dir, nomeDoArquivo());
    if (this._temArquivo(baixado)) return { comando: baixado, origem: 'baixado' };
    const s = this._noSistema();
    if (s) return { comando: s, origem: 'sistema' };
    return null;
  }

  versao() {
    const onde = this.onde();
    if (!onde) { this._versao = null; return null; }
    if (this._versao && this._versao.comando === onde.comando) return this._versao.texto;
    let texto = null;
    try {
      const r = spawnSync(onde.comando, ['--version'], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
      if (!r.error && r.status === 0) texto = String(r.stdout || '').trim().slice(0, 40) || null;
    } catch { /* não respondeu */ }
    this._versao = { comando: onde.comando, texto };
    return texto;
  }

  estado() {
    const onde = this.onde();
    return {
      pronto: !!onde,
      origem: onde ? onde.origem : null,
      versao: onde ? this.versao() : null,
      baixandoPct: this.download ? this.download.pct : null,
      trabalhando: this.rodando > 0,
      arquivo: nomeDoArquivo(),
      // 🍪 v0.166: só o RESUMO — o conteúdo dos cookies nunca sai daqui
      cookies: { arquivo: this._temArquivo(this.arquivoCookies()), sites: this.sitesDosCookies() },
    };
  }

  // ---------- 🍪 v0.166: cookies para os sites que só entregam logado ----------
  // Um cookies.txt (formato Netscape, o que as extensões «Get cookies.txt»
  // exportam) fica em data/ytdlp/cookies.txt, só neste computador, e vai
  // com o yt-dlp (--cookies). Alternativa: o navegador em que a pessoa
  // está logada (--cookies-from-browser). Nenhum dos dois é gravado em
  // outro lugar nem mandado para o painel — o painel só vê a contagem.
  arquivoCookies() { return path.join(this.dir, 'cookies.txt'); }

  sitesDosCookies() {
    let texto = '';
    try { texto = fs.readFileSync(this.arquivoCookies(), 'utf8'); } catch { return 0; }
    return contarSitesDosCookies(texto);
  }

  guardarCookies(texto) {
    const conferido = conferirCookiesNetscape(texto);
    if (!conferido.ok) return conferido;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.arquivoCookies(), conferido.texto, { mode: 0o600 });
    } catch (err) { return { ok: false, erro: 'não consegui gravar o arquivo: ' + (err && err.message) }; }
    this.esquecer();
    this._avisaEstado();
    return { ok: true, sites: conferido.sites };
  }

  apagarCookies() {
    this._limpar(this.arquivoCookies());
    this.esquecer();
    this._avisaEstado();
  }

  // cookies mudaram (ou o navegador escolhido): o que falhou pode passar agora
  esquecer() { this.cache.clear(); this.falhas.clear(); }

  // 🧭 v0.166: por que a última tentativa nessa página não deu — para o
  // painel explicar em vez de ficar quieto
  porque(pagina) {
    let chave = String(pagina || '');
    try { chave = new URL(pagina).toString(); } catch { /* fica como veio */ }
    return this.falhas.get(chave) || null;
  }

  _anotarFalha(chave, motivo, detalhe) {
    if (this.falhas.size >= MAX_CACHE) this.falhas.delete(this.falhas.keys().next().value);
    this.falhas.set(chave, { motivo, detalhe: String(detalhe || '').slice(0, 300) });
  }

  _avisaEstado() { this.aoEvento({ type: 'ytdlpEstado', estado: this.estado() }); }

  // ---------- baixar sob demanda ----------
  baixar() {
    if (this.download) return;
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch { /* já existe */ }
    this.download = { pct: 0, req: null, cancelado: false };
    this._avisaEstado();
    const destino = path.join(this.dir, nomeDoArquivo());
    const part = destino + '.part';
    this._buscar(this.base + nomeDoArquivo(), part, () => {
      if (this.download && this.download.cancelado) { this._limpar(part); this._fim(); return; }
      try {
        fs.renameSync(part, destino);
        if (process.platform !== 'win32') { try { fs.chmodSync(destino, 0o755); } catch { /* sem permissão */ } }
        this._versao = null;
        this._fim();
      } catch (err) { this._limpar(part); this._fim(err); }
    }, (err) => {
      this._limpar(part);
      this._fim(this.download && this.download.cancelado ? null : err);
    });
  }

  _limpar(p) { try { fs.unlinkSync(p); } catch { /* nem chegou a existir */ } }

  _fim(erro) {
    this.download = null;
    if (erro) this.aoEvento({ type: 'ytdlpAviso', erro: String(erro.message || erro) });
    this._avisaEstado();
  }

  cancelar() {
    if (!this.download) return;
    this.download.cancelado = true;
    try { this.download.req?.destroy(new Error('cancelado')); } catch { /* já morreu */ }
  }

  apagar() {
    this._limpar(path.join(this.dir, nomeDoArquivo()));
    this._versao = null;
    this.cache.clear();
    this._avisaEstado();
  }

  // Baixa seguindo redirecionamentos (o /releases/latest/ é um deles), com
  // teto de tamanho e o mesmo cuidado do downloader da transcrição
  _buscar(url, destinoPart, aoPronto, aoErroBruto, saltos = 0) {
    let avisou = false;
    const aoErro = (err) => { if (avisou) return; avisou = true; aoErroBruto(err); };
    if (saltos > 5) { aoErro(new Error('redirecionamento demais')); return; }
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        let prox;
        try { prox = new URL(res.headers.location, url); } catch { aoErro(new Error('redirecionamento inválido')); return; }
        if (prox.protocol !== 'http:' && prox.protocol !== 'https:') { aoErro(new Error('redirecionamento para um endereço não permitido')); return; }
        if (url.startsWith('https://') && prox.protocol === 'http:') { aoErro(new Error('redirecionamento de https para http recusado')); return; }
        this._buscar(prox.toString(), destinoPart, aoPronto, aoErro, saltos + 1);
        return;
      }
      if (status !== 200) { res.resume(); aoErro(new Error('HTTP ' + status)); return; }
      const total = Number(res.headers['content-length']) || 0;
      if (total > LIMITE_BYTES) { res.resume(); aoErro(new Error('arquivo maior que o limite')); return; }
      let lidos = 0;
      let ultimoAviso = 0;
      const escrita = fs.createWriteStream(destinoPart);
      if (this.download) this.download.req = req;
      res.on('data', (peca) => {
        lidos += peca.length;
        if (lidos > LIMITE_BYTES) { req.destroy(new Error('arquivo maior que o limite')); return; }
        if (this.download) {
          this.download.pct = total ? Math.min(99, Math.floor((lidos / total) * 100)) : null;
          const agora = Date.now();
          if (agora - ultimoAviso > 900) { ultimoAviso = agora; this._avisaEstado(); }
        }
      });
      res.pipe(escrita);
      escrita.on('finish', () => aoPronto(destinoPart));
      escrita.on('error', aoErro);
      res.on('error', aoErro);
    });
    if (this.download) this.download.req = req;
    req.on('error', aoErro);
  }

  // ---------- achar o arquivo de uma página ----------
  _doCache(url) {
    const c = this.cache.get(url);
    if (!c) return undefined;
    if (Date.now() - c.em > CACHE_MS) { this.cache.delete(url); return undefined; }
    return c.achado;
  }

  _guardar(url, achado) {
    if (this.cache.size >= MAX_CACHE) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(url, { em: Date.now(), achado });
  }

  // Devolve { url, tipo, titulo, proporcao, duracao, cabecalhos } ou null
  // (e, no null, porque(pagina) conta o motivo).
  // opcoes.cookiesNavegador: 'firefox' | 'chrome' | 'edge' | … (vazio = nenhum)
  async extrair(pagina, opcoes = {}) {
    const onde = this.onde();
    let u;
    try { u = new URL(pagina); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const chave = u.toString();
    if (!onde) { this._anotarFalha(chave, 'semPrograma'); return null; }
    // 🔒 o yt-dlp não vai bisbilhotar a rede de casa por causa de uma URL colada
    if (!(await this.ehPublico(u.hostname))) return null;
    const guardado = this._doCache(chave);
    if (guardado !== undefined) return guardado;
    if (this.rodando >= 2) { this._anotarFalha(chave, 'ocupado'); return null; } // um site lento não segura a live inteira
    this.rodando++;
    this._avisaEstado();
    try {
      const args = [
        '--ignore-config',    // um arquivo de configuração perdido não muda nada
        '--no-playlist',      // o link de um vídeo é um vídeo, não uma lista
        '--no-warnings', '--no-progress',
        '--socket-timeout', '15', '--retries', '1',
        '-J',                 // só conta o que achou; não baixa nada
      ];
      // 🍪 v0.166: o arquivo manda; sem arquivo, o navegador escolhido
      const navegador = String(opcoes.cookiesNavegador || '').toLowerCase();
      if (this._temArquivo(this.arquivoCookies())) args.push('--cookies', this.arquivoCookies());
      else if (NAVEGADORES_COOKIES.includes(navegador)) args.push('--cookies-from-browser', navegador);
      args.push('--', chave);
      const r = await this._rodar(onde.comando, args);
      const achado = r.ok ? escolherFormato(r.saida) : null;
      if (!achado) {
        const f = r.demorou ? { motivo: 'demorou', detalhe: '' } : r.ok ? { motivo: 'semFormato', detalhe: '' } : classificarFalha(r.erro);
        this._anotarFalha(chave, f.motivo, f.detalhe);
      } else this.falhas.delete(chave);
      this._guardar(chave, achado);
      return achado;
    } catch { this._anotarFalha(chave, 'erro'); return null; } finally {
      this.rodando--;
      this._avisaEstado();
    }
  }

  // Devolve { ok, saida, erro, demorou } — o erro é o que o yt-dlp escreveu
  _rodar(comando, args) {
    return new Promise((resolve) => {
      let saida = '';
      let erro = '';
      let acabou = false;
      let demorou = false;
      let proc;
      const fim = (codigo) => {
        if (acabou) return;
        acabou = true;
        clearTimeout(relogio);
        resolve({ ok: codigo === 0 && !demorou, saida: codigo === 0 ? saida : '', erro, demorou });
      };
      try {
        proc = spawn(comando, args, { windowsHide: true });
      } catch { resolve({ ok: false, saida: '', erro: 'não consegui iniciar o programa', demorou: false }); return; }
      const relogio = setTimeout(() => { demorou = true; try { proc.kill(); } catch { /* já saiu */ } fim(-1); }, TEMPO_MAX_MS);
      proc.stdout.on('data', (d) => {
        if (saida.length < LIMITE_SAIDA) saida += d;
        else { try { proc.kill(); } catch { /* já saiu */ } }
      });
      proc.stderr.on('data', (d) => { if (erro.length < 64 * 1024) erro += d; });
      proc.on('error', (e) => { erro = erro || String(e && e.message || 'erro'); fim(-1); });
      proc.on('close', (codigo) => fim(codigo));
    });
  }

  parar() {
    this.cancelar();
    this.cache.clear();
  }
}

// Do relatório do yt-dlp, o formato que o nosso player toca sozinho: um
// arquivo por HTTP com imagem E som juntos (nada de HLS/DASH em pedaços).
function escolherFormato(bruto) {
  let info;
  try { info = JSON.parse(String(bruto || '')); } catch { return null; }
  if (!info || typeof info !== 'object') return null;
  // um link de lista/canal vem com «entries»: o primeiro vídeo é o que importa
  if (Array.isArray(info.entries) && info.entries.length) info = info.entries[0] || {};
  const formatos = Array.isArray(info.formats) ? info.formats.slice() : [];
  if (info.url && !formatos.length) {
    formatos.push({ url: info.url, ext: info.ext, vcodec: info.vcodec, acodec: info.acodec, protocol: info.protocol, width: info.width, height: info.height, http_headers: info.http_headers });
  }
  const direto = (f) => {
    const p = String(f.protocol || 'https');
    return /^https?$/.test(p) && /^https?:\/\//i.test(String(f.url || ''));
  };
  // 🐦 v0.164.1: o X (e outros sites) entregam o arquivo mp4 sem dizer os
  // codecs — o yt-dlp só anota vcodec/acodec quando SABE. «Não disse» não é
  // «não tem»: um arquivo inteiro por http, com largura e altura, é um vídeo,
  // e vídeo inteiro vem com o som junto. Quando o site sabe que não vem, o
  // yt-dlp manda 'none', e aí sim o formato é recusado. Antes, esses arquivos
  // eram descartados e o extrator parecia nem ter sido chamado.
  const sabe = (v) => typeof v === 'string' && v !== '';
  const EXT_DE_VIDEO = /^(mp4|m4v|webm|mov|mkv|ogv|3gp)$/i;
  // (o video_ext que o yt-dlp deriva só vale como NÃO: fora do 'none' ele é
  // a mera extensão do arquivo — um podcast .mp3 sem codecs vem com
  // video_ext 'mp3', e isso não faz dele um vídeo)
  const temVideo = (f) => (sabe(f.vcodec) ? f.vcodec !== 'none'
    : f.video_ext === 'none' ? false
      : (Number(f.width) > 0 || Number(f.height) > 0 || EXT_DE_VIDEO.test(String(f.ext || ''))));
  const temSom = (f) => (sabe(f.acodec) ? f.acodec !== 'none' : true);
  // a «linha» de qualidade é o lado MENOR: um vídeo em pé de 1080×1920 é um
  // 1080p, não um 1920p (senão todo vídeo de celular ia para o fim da fila)
  const linha = (f) => {
    const l = Number(f.width) || 0;
    const a = Number(f.height) || 0;
    return l && a ? Math.min(l, a) : (a || l);
  };
  const nota = (f) => {
    const alt = linha(f);
    // acima de 1080 o navegador só sofre numa live: fica atrás de qualquer
    // outro (mas ainda serve, se for o único que existe)
    if (alt > 1080) return -100000 + alt;
    // quanto maior, melhor; no empate ganha o mp4, que toca em todo lugar, e
    // depois quem tem os codecs conhecidos
    return alt * 10 + (String(f.ext || '') === 'mp4' ? 3 : 0) + (sabe(f.vcodec) && sabe(f.acodec) ? 1 : 0);
  };
  const completos = formatos.filter((f) => direto(f) && temVideo(f) && temSom(f));
  completos.sort((a, b) => nota(b) - nota(a));
  const escolhido = completos[0]
    || formatos.filter((f) => direto(f) && temSom(f) && !temVideo(f)).pop();
  if (!escolhido || !escolhido.url) return null;
  const tipo = temVideo(escolhido) ? 'video' : 'audio';
  const l = Number(escolhido.width) || 0;
  const a = Number(escolhido.height) || 0;
  // 📡 v0.165: os cabeçalhos que o yt-dlp diz que a fonte espera (User-Agent,
  // Referer, às vezes Cookie) — quem retransmite o arquivo manda os mesmos
  const cabecalhos = {};
  for (const [k, v] of Object.entries(escolhido.http_headers || {})) {
    if (typeof v === 'string' && v && Object.keys(cabecalhos).length < 20) cabecalhos[String(k).slice(0, 80)] = v.slice(0, 4000);
  }
  return {
    url: String(escolhido.url),
    tipo,
    titulo: String(info.title || '').slice(0, 120),
    proporcao: l > 0 && a > 0 ? l / a : null,
    duracao: Number(info.duration) > 0 ? Number(info.duration) : null,
    cabecalhos: Object.keys(cabecalhos).length ? cabecalhos : null,
  };
}

// 🧭 v0.166: o que o yt-dlp escreveu vira um motivo que o painel sabe
// explicar. Só a ÚLTIMA linha de erro conta (as outras são rastro).
//   login       → o site só entrega para quem está logado (cookies resolvem)
//   privado     → conteúdo privado / restrito
//   naoExiste   → apagado, link errado, indisponível
//   naoSuportado→ o yt-dlp não conhece o site
//   semFormato  → achou, mas nada que um <video> toque direto (só HLS/DASH)
//   demorou     → o site não respondeu a tempo
//   ocupado     → já tem duas procuras rodando
//   semPrograma → o yt-dlp não está baixado
//   erro        → outra coisa (o detalhe vai junto)
function classificarFalha(stderr) {
  const linhas = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const erros = linhas.filter((l) => /^ERROR:/i.test(l));
  const linha = erros[erros.length - 1] || linhas[linhas.length - 1] || '';
  const detalhe = linha.replace(/^ERROR:\s*/i, '').replace(/\s*;?\s*please report this issue on.*$/i, '').slice(0, 300);
  const t = linha.toLowerCase();
  if (/login required|login_required|rate-limit reached|requires? (a )?login|sign in to confirm|not logged in|use --cookies|cookies-from-browser|logged.in|authentication/.test(t)) return { motivo: 'login', detalhe };
  if (/private|restricted|only available to|age.restricted|members.only/.test(t)) return { motivo: 'privado', detalhe };
  if (/unsupported url|no suitable extractor|is not a valid url/.test(t)) return { motivo: 'naoSuportado', detalhe };
  if (/404|not found|does not exist|no longer available|unavailable|has been removed|deleted|no video/.test(t)) return { motivo: 'naoExiste', detalhe };
  if (/requested format is not available|no video formats found/.test(t)) return { motivo: 'semFormato', detalhe };
  if (/timed? ?out|timeout/.test(t)) return { motivo: 'demorou', detalhe };
  return { motivo: 'erro', detalhe };
}

const NAVEGADORES_COOKIES = ['firefox', 'chrome', 'edge', 'brave', 'chromium', 'opera', 'vivaldi', 'safari', 'whale'];

// 🍪 O formato Netscape: linhas de 7 campos separados por TAB (domínio,
// flag, caminho, seguro, validade, nome, valor); «#» é comentário. O
// arquivo é aceito se a maioria das linhas úteis tiver essa cara.
function conferirCookiesNetscape(texto) {
  const s = String(texto || '').replace(/^﻿/, '');
  if (s.length > 2 * 1024 * 1024) return { ok: false, erro: 'arquivo grande demais para ser um cookies.txt' };
  if (/\0/.test(s)) return { ok: false, erro: 'isso não é um arquivo de texto' };
  const linhas = s.split(/\r?\n/);
  let uteis = 0, boas = 0;
  for (const l of linhas) {
    const t = l.trim();
    if (!t || (t.startsWith('#') && !/^#HttpOnly_/.test(t))) continue;
    uteis++;
    if (t.split('\t').length >= 7) boas++;
  }
  if (!uteis || boas < Math.ceil(uteis * 0.8)) return { ok: false, erro: 'não parece um cookies.txt no formato Netscape (o que as extensões «Get cookies.txt» exportam)' };
  return { ok: true, texto: s.endsWith('\n') ? s : s + '\n', sites: contarSitesDosCookies(s) };
}

function contarSitesDosCookies(texto) {
  const sites = new Set();
  for (const l of String(texto || '').split(/\r?\n/)) {
    const t = l.trim();
    if (!t || (t.startsWith('#') && !/^#HttpOnly_/.test(t))) continue;
    const campos = t.split('\t');
    if (campos.length < 7) continue;
    const dominio = campos[0].replace(/^#HttpOnly_/, '').replace(/^\./, '').toLowerCase();
    // agrupa por site (instagram.com, não www.instagram.com / i.instagram.com)
    const partes = dominio.split('.');
    if (partes.length >= 2) sites.add(partes.slice(-2).join('.'));
  }
  return sites.size;
}

module.exports = { Extrator, escolherFormato, nomeDoArquivo, BASE_YTDLP, classificarFalha, conferirCookiesNetscape, contarSitesDosCookies, NAVEGADORES_COOKIES };
