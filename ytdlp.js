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
    };
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

  // Devolve { url, tipo, titulo, proporcao, duracao } ou null.
  async extrair(pagina) {
    const onde = this.onde();
    if (!onde) return null;
    let u;
    try { u = new URL(pagina); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    // 🔒 o yt-dlp não vai bisbilhotar a rede de casa por causa de uma URL colada
    if (!(await this.ehPublico(u.hostname))) return null;
    const chave = u.toString();
    const guardado = this._doCache(chave);
    if (guardado !== undefined) return guardado;
    if (this.rodando >= 2) return null; // um site lento não segura a live inteira
    this.rodando++;
    this._avisaEstado();
    try {
      const bruto = await this._rodar(onde.comando, [
        '--ignore-config',    // um arquivo de configuração perdido não muda nada
        '--no-playlist',      // o link de um vídeo é um vídeo, não uma lista
        '--no-warnings', '--no-progress', '--no-call-home',
        '--socket-timeout', '15', '--retries', '1',
        '-J',                 // só conta o que achou; não baixa nada
        '--', chave,
      ]);
      const achado = escolherFormato(bruto);
      this._guardar(chave, achado);
      return achado;
    } catch { return null; } finally {
      this.rodando--;
      this._avisaEstado();
    }
  }

  _rodar(comando, args) {
    return new Promise((resolve) => {
      let saida = '';
      let acabou = false;
      let proc;
      const fim = (texto) => { if (!acabou) { acabou = true; clearTimeout(relogio); resolve(texto); } };
      try {
        proc = spawn(comando, args, { windowsHide: true });
      } catch { resolve(''); return; }
      const relogio = setTimeout(() => { try { proc.kill(); } catch { /* já saiu */ } fim(''); }, TEMPO_MAX_MS);
      proc.stdout.on('data', (d) => {
        if (saida.length < LIMITE_SAIDA) saida += d;
        else { try { proc.kill(); } catch { /* já saiu */ } }
      });
      proc.stderr.on('data', () => {});
      proc.on('error', () => fim(''));
      proc.on('close', (codigo) => fim(codigo === 0 ? saida : ''));
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
    formatos.push({ url: info.url, ext: info.ext, vcodec: info.vcodec, acodec: info.acodec, protocol: info.protocol, width: info.width, height: info.height });
  }
  const direto = (f) => {
    const p = String(f.protocol || 'https');
    return /^https?$/.test(p) && /^https?:\/\//i.test(String(f.url || ''));
  };
  const temVideo = (f) => f.vcodec && f.vcodec !== 'none';
  const temSom = (f) => f.acodec && f.acodec !== 'none';
  const nota = (f) => {
    const alt = Number(f.height) || 0;
    // acima de 1080 o navegador só sofre numa live: fica atrás de qualquer
    // outro (mas ainda serve, se for o único que existe)
    if (alt > 1080) return -100000 + alt;
    // quanto maior, melhor; no empate ganha o mp4, que toca em todo lugar
    return alt * 10 + (String(f.ext || '') === 'mp4' ? 3 : 0);
  };
  const completos = formatos.filter((f) => direto(f) && temVideo(f) && temSom(f));
  completos.sort((a, b) => nota(b) - nota(a));
  const escolhido = completos[0]
    || formatos.filter((f) => direto(f) && temSom(f) && !temVideo(f)).pop();
  if (!escolhido || !escolhido.url) return null;
  const tipo = temVideo(escolhido) ? 'video' : 'audio';
  const l = Number(escolhido.width) || 0;
  const a = Number(escolhido.height) || 0;
  return {
    url: String(escolhido.url),
    tipo,
    titulo: String(info.title || '').slice(0, 120),
    proporcao: l > 0 && a > 0 ? l / a : null,
    duracao: Number(info.duration) > 0 ? Number(info.duration) : null,
  };
}

module.exports = { Extrator, escolherFormato, nomeDoArquivo, BASE_YTDLP };
