// ---------------------------------------------------------------------------
// 🎛️ vMix pelo painel (Labs) — cliente da API TCP do vMix, que já vem ligada
// no vMix (porta 8099, Settings → Web Controller/TCP). Conversa 100% local:
// nada disso passa pela internet. É o irmão do 🎬 OBS Studio: o servidor
// conversa com o vMix por aqui e as telas só recebem o retrato (vmixResumo).
//
// O protocolo é de linhas (\r\n):
//   → FUNCTION Cut Input=2          ← FUNCTION OK Cut   |  FUNCTION ER motivo
//   → XML                           ← XML 1234\r\n<vmix>…</vmix>
//   → SUBSCRIBE TALLY / ACTS        ← TALLY OK 0120…  /  ACTS OK Input 2 1
//   (ao conectar o vMix manda "VERSION OK 27.0.0.73")
// Os eventos (TALLY/ACTS) chegam sozinhos; a cada um o cliente relê o XML
// (com contenção) para as telas verem SEMPRE o retrato completo e honesto.
// ---------------------------------------------------------------------------
const net = require('net');

function desescapar(v) {
  return String(v || '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // 🔒 v0.127.1: fora da faixa Unicode o fromCodePoint estoura — vira nada
    .replace(/&#(\d+);/g, (_, n) => { const c = Number(n); return c >= 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''; })
    .replace(/&amp;/g, '&');
}
// 🔒 v0.127.1: teto do XML anunciado pelo vMix (um retrato real tem uns KB)
const LIMITE_XML = 32 * 1024 * 1024;
function atributos(s) {
  const o = {};
  String(s || '').replace(/([A-Za-z0-9_:-]+)="([^"]*)"/g, (_, k, v) => { o[k] = desescapar(v); return ''; });
  return o;
}
// <nome ...>conteúdo</nome> ou <nome .../> — devolve { atrib, texto } ou null
function bloco(xml, nome) {
  const re = new RegExp('<' + nome + '(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</' + nome + '>)');
  const m = re.exec(xml);
  if (!m) return null;
  return { atrib: atributos(m[1]), texto: m[2] === undefined ? '' : m[2] };
}
const verdade = (v) => String(v || '').toLowerCase() === 'true';
const numero = (v, padrao = 0) => { const n = Number(v); return Number.isFinite(n) ? n : padrao; };

// O XML do vMix vira o retrato que as telas usam
function lerXml(xml) {
  const r = {
    versao: desescapar(bloco(xml, 'version')?.texto || '').trim() || null,
    edicao: desescapar(bloco(xml, 'edition')?.texto || '').trim() || null,
    preset: desescapar(bloco(xml, 'preset')?.texto || '').trim() || null,
    entradas: [], overlays: [], transicoes: [],
    programa: numero(bloco(xml, 'active')?.texto, 0) || null,
    preview: numero(bloco(xml, 'preview')?.texto, 0) || null,
    escurecido: verdade(bloco(xml, 'fadeToBlack')?.texto),
    gravando: false, transmitindo: false, externa: false, playlist: false, multiCorder: false, telaCheia: false,
    saidas: {}, master: { volume: 100, mudo: false },
  };
  for (const chave of ['recording', 'streaming', 'external', 'playList', 'multiCorder', 'fullscreen']) {
    const b = bloco(xml, chave);
    const ligado = !!b && verdade(b.texto.trim());
    const alvo = { recording: 'gravando', streaming: 'transmitindo', external: 'externa', playList: 'playlist', multiCorder: 'multiCorder', fullscreen: 'telaCheia' }[chave];
    r[alvo] = ligado;
    // Versões novas trazem detalhes como atributos (duração, arquivo, canais)
    if (b && Object.keys(b.atrib).length) r.saidas[alvo] = b.atrib;
  }
  const entradas = bloco(xml, 'inputs');
  if (entradas) {
    const re = /<input(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/input>)/g;
    let m;
    while ((m = re.exec(entradas.texto)) !== null && r.entradas.length < 200) {
      const a = atributos(m[1]);
      const dentro = m[2] || '';
      const campos = [];
      const reTexto = /<text(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/text>)/g;
      let t;
      while ((t = reTexto.exec(dentro)) !== null && campos.length < 40) {
        const ta = atributos(t[1]);
        campos.push({ nome: String(ta.name || ta.index || ''), texto: desescapar(t[2] || '') });
      }
      const itens = (dentro.match(/<item[\s>]/g) || []).length;
      r.entradas.push({
        numero: numero(a.number, 0),
        chave: String(a.key || ''),
        titulo: String(a.title || desescapar(dentro.replace(/<[\s\S]*$/, '')).trim() || ''),
        curto: String(a.shortTitle || a.title || ''),
        tipo: String(a.type || ''),
        estado: String(a.state || ''),
        posicao: numero(a.position, 0),
        duracao: numero(a.duration, 0),
        loop: verdade(a.loop),
        temAudio: 'muted' in a || 'volume' in a,
        mudo: verdade(a.muted),
        volume: 'volume' in a ? Math.round(numero(a.volume, 100)) : null,
        solo: verdade(a.solo),
        campos,
        itens,
      });
    }
  }
  const overlays = bloco(xml, 'overlays');
  if (overlays) {
    const re = /<overlay(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/overlay>)/g;
    let m;
    while ((m = re.exec(overlays.texto)) !== null && r.overlays.length < 8) {
      const a = atributos(m[1]);
      const n = numero(String(m[2] || '').trim(), 0);
      r.overlays.push({ canal: numero(a.number, r.overlays.length + 1), entrada: n || null, preview: verdade(a.preview) });
    }
  }
  const transicoes = bloco(xml, 'transitions');
  if (transicoes) {
    const re = /<transition(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/transition>)/g;
    let m;
    while ((m = re.exec(transicoes.texto)) !== null && r.transicoes.length < 8) {
      const a = atributos(m[1]);
      r.transicoes.push({ numero: numero(a.number, r.transicoes.length + 1), efeito: String(a.effect || ''), duracao: numero(a.duration, 0) });
    }
  }
  const master = bloco(xml, 'master');
  if (master) r.master = { volume: Math.round(numero(master.atrib.volume, 100)), mudo: verdade(master.atrib.muted) };
  return r;
}

// Monta a linha FUNCTION: parâmetros no formato de query (o mesmo da API web)
function linhaFuncao(nome, params) {
  const partes = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null || v === '') continue;
    // 🖥️ v0.159: ':' '\' '/' ficam como estão — um caminho de arquivo
    // (Snapshot Value=C:\…) chega inteiro ao vMix, decodifique ele ou não
    partes.push(k + '=' + encodeURIComponent(String(v)).replace(/%20/g, ' ').replace(/%3A/gi, ':').replace(/%5C/gi, '\\').replace(/%2F/gi, '/'));
  }
  return 'FUNCTION ' + nome + (partes.length ? ' ' + partes.join('&') : '');
}

class VmixCliente {
  // aoRetrato(retrato) a cada XML lido; aoConexao(conectado, motivo) nas mudanças;
  // aoTally(texto) a cada tally ("0120…": 0 fora, 1 programa, 2 preview)
  constructor(opcoes) {
    this.host = String(opcoes.host || '127.0.0.1');
    this.port = Number(opcoes.port) || 8099;
    this.aoRetrato = opcoes.aoRetrato || (() => {});
    this.aoConexao = opcoes.aoConexao || (() => {});
    this.aoTally = opcoes.aoTally || (() => {});
    this.aoEvento = opcoes.aoEvento || (() => {});
    this.socket = null;
    this.conectado = false;
    this.versao = null;
    this.buffer = Buffer.alloc(0);
    this.esperandoXml = 0;
    this.filaFuncoes = [];   // { resolve, timer } na ordem de envio (o vMix responde na ordem)
    this.filaXml = [];       // { resolve, timer }
    this.timerReler = null;
    this.tally = '';
  }

  conectar() {
    if (this.socket) return;
    const s = net.createConnection({ host: this.host, port: this.port });
    this.socket = s;
    s.setNoDelay(true);
    s.setTimeout(0);
    const timerAbrir = setTimeout(() => { if (!this.conectado) this.fechar('tempo esgotado ao abrir a conexão'); }, 6000);
    s.on('connect', () => {
      clearTimeout(timerAbrir);
      this.conectado = true;
      this.enviar('SUBSCRIBE TALLY');
      this.enviar('SUBSCRIBE ACTS');
      this.aoConexao(true, null);
      this.lerXml().catch(() => {});
    });
    s.on('data', (chunk) => { this.buffer = Buffer.concat([this.buffer, chunk]); this.processar(); });
    s.on('error', (err) => { this.ultimoErro = err; });
    s.on('close', () => {
      clearTimeout(timerAbrir);
      if (this.socket !== s) return;
      const err = this.ultimoErro;
      this.ultimoErro = null;
      const motivo = err ? (err.code === 'ECONNREFUSED' ? 'recusou a conexão' : err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH' ? 'não respondeu' : err.code === 'ENOTFOUND' ? 'endereço não encontrado' : String(err.message || 'erro de rede')) : null;
      this.fechar(motivo, true);
    });
  }

  enviar(linha) {
    if (!this.socket || this.socket.destroyed) return false;
    try { this.socket.write(linha + '\r\n'); return true; } catch { return false; }
  }

  // Fecha a conexão (motivo = texto amigável do problema, null = a pedido)
  fechar(motivo, jaFechou) {
    const s = this.socket;
    this.socket = null;
    if (s && !jaFechou) { try { s.destroy(); } catch { /* já caiu */ } }
    const estava = this.conectado;
    this.conectado = false;
    this.buffer = Buffer.alloc(0);
    this.esperandoXml = 0;
    if (this.timerReler) { clearTimeout(this.timerReler); this.timerReler = null; }
    for (const p of this.filaFuncoes) { clearTimeout(p.timer); p.resolve({ ok: false, erro: 'desconectado' }); }
    for (const p of this.filaXml) { clearTimeout(p.timer); p.resolve(null); }
    this.filaFuncoes = []; this.filaXml = [];
    if (estava || motivo) this.aoConexao(false, motivo || null);
  }

  // Um pedido FUNCTION; devolve { ok, erro }
  // 🖥️ v0.159: opts.silencioso — a função não muda nada no vMix (um print,
  // por exemplo): a resposta dela não dispara a releitura do XML
  funcao(nome, params, opts) {
    return new Promise((resolve) => {
      if (!this.conectado || !this.enviar(linhaFuncao(nome, params))) return resolve({ ok: false, erro: 'desconectado' });
      const p = { resolve, timer: null, silencioso: !!(opts && opts.silencioso) };
      p.timer = setTimeout(() => {
        const i = this.filaFuncoes.indexOf(p);
        if (i >= 0) this.filaFuncoes.splice(i, 1);
        resolve({ ok: false, erro: 'o vMix não respondeu' });
      }, 5000);
      this.filaFuncoes.push(p);
    });
  }

  // Pede o XML inteiro; devolve o retrato lido (ou null)
  lerXml() {
    return new Promise((resolve) => {
      if (!this.conectado || !this.enviar('XML')) return resolve(null);
      const p = { resolve, timer: null };
      p.timer = setTimeout(() => {
        const i = this.filaXml.indexOf(p);
        if (i >= 0) this.filaXml.splice(i, 1);
        resolve(null);
      }, 5000);
      this.filaXml.push(p);
    });
  }

  // Um evento chegou: relê o XML daqui a pouco (uma releitura para uma
  // saraivada de eventos — um fader arrastado manda dezenas por segundo)
  relerLogo() {
    if (this.timerReler) return;
    this.timerReler = setTimeout(() => { this.timerReler = null; this.lerXml().catch(() => {}); }, 150);
    if (this.timerReler.unref) this.timerReler.unref();
  }

  processar() {
    for (;;) {
      if (this.esperandoXml > 0) {
        if (this.buffer.length < this.esperandoXml) return;
        const xml = this.buffer.subarray(0, this.esperandoXml).toString('utf8');
        this.buffer = this.buffer.subarray(this.esperandoXml);
        this.esperandoXml = 0;
        this.entregarXml(xml.trim());
        continue;
      }
      const fim = this.buffer.indexOf('\r\n');
      if (fim === -1) return;
      const linha = this.buffer.subarray(0, fim).toString('utf8');
      this.buffer = this.buffer.subarray(fim + 2);
      if (!linha.trim()) continue;
      this.tratarLinha(linha);
    }
  }

  entregarXml(xml) {
    let retrato = null;
    try { retrato = lerXml(xml); } catch { retrato = null; }
    const p = this.filaXml.shift();
    if (p) { clearTimeout(p.timer); p.resolve(retrato); }
    if (retrato) {
      if (retrato.versao) this.versao = retrato.versao;
      this.aoRetrato(retrato);
    }
  }

  tratarLinha(linha) {
    const partes = linha.split(' ');
    const cmd = partes[0];
    const status = partes[1] || '';
    const resto = partes.slice(2).join(' ');
    switch (cmd) {
      case 'VERSION':
        if (status === 'OK') this.versao = resto.trim() || this.versao;
        break;
      case 'XML': {
        // "XML 1234" = os próximos 1234 bytes são o XML (a resposta do pedido)
        const n = Number(status);
        if (Number.isFinite(n) && n > 0 && n <= LIMITE_XML) this.esperandoXml = n;
        else if (Number.isFinite(n) && n > LIMITE_XML) {
          // 🔒 v0.127.1: tamanho absurdo — não vale guardar; derruba e recomeça
          this.fechar('o vMix anunciou um XML grande demais');
        }
        else if (status === 'ER') { const p = this.filaXml.shift(); if (p) { clearTimeout(p.timer); p.resolve(null); } }
        break;
      }
      case 'FUNCTION': {
        const p = this.filaFuncoes.shift();
        if (p) { clearTimeout(p.timer); p.resolve(status === 'OK' ? { ok: true } : { ok: false, erro: resto.trim() || 'o vMix recusou' }); }
        // Toda função muda alguma coisa: as telas veem o retrato novo
        // (fora as silenciosas — um print a cada segundo não é motivo para reler)
        if (!p || !p.silencioso) this.relerLogo();
        break;
      }
      case 'TALLY':
        if (status === 'OK') { this.tally = resto.trim(); this.aoTally(this.tally); this.relerLogo(); }
        break;
      case 'ACTS':
        // "ACTS OK Input 2 1" = ativador, entrada, valor
        if (status === 'OK') {
          const [ativador, entrada, ...valor] = resto.trim().split(' ');
          this.aoEvento({ ativador: String(ativador || ''), entrada: Number(entrada) || 0, valor: valor.join(' ') });
          this.relerLogo();
        }
        break;
      default:
        break; // SUBSCRIBE OK, XMLTEXT... nada a fazer
    }
  }
}

module.exports = { VmixCliente, lerXml, linhaFuncao };
