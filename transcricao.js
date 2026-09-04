// ---------------------------------------------------------------------------
// 🎙️ Transcrição local (Labs) — whisper.cpp rodando NO COMPUTADOR do streamer.
// Nada de nuvem: o áudio/vídeo que o inscrito mandou não sai da máquina.
// TUDO é baixado sob demanda (nada vem embutido no programa):
//   • os modelos GGML (tiny → large) direto do Hugging Face oficial;
//   • o motor (whisper-cli) do release oficial do whisper.cpp (Windows x64);
//   • o conversor ffmpeg (para voz do Telegram/opus e vídeos) do build
//     estável do projeto BtbN — também só se precisar.
// Em outros sistemas o motor/ffmpeg instalados na máquina são usados
// automaticamente (ou um caminho que o streamer configurar).
// A fila processa UM arquivo por vez para não derrubar a live.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { spawn, spawnSync } = require('child_process');

// Modelos oficiais do whisper.cpp (ggerganov) — tamanho só para mostrar na UI
const MODELOS = {
  tiny: { arquivo: 'ggml-tiny.bin', mb: 75 },
  base: { arquivo: 'ggml-base.bin', mb: 142 },
  small: { arquivo: 'ggml-small.bin', mb: 466 },
  medium: { arquivo: 'ggml-medium.bin', mb: 1463 },
  large: { arquivo: 'ggml-large-v3-turbo.bin', mb: 1550 }, // large-v3-turbo: o mais preciso que ainda roda bem
};
const BASE_MODELOS = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/';
// Motor e conversor para Windows x64 (a maioria dos streamers do OBS)
const URL_MOTOR_WIN = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip';
const URL_FFMPEG_WIN = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip';
// Formatos que o whisper-cli lê sozinho; o resto passa antes pelo ffmpeg
const EXT_DIRETA = new Set(['wav', 'mp3', 'flac']);
const LIMITE_TEXTO = 20000;      // rascunho não precisa ser um livro
// 🔒 v0.127.1: o zip do motor/ffmpeg é lido inteiro na memória — teto
const LIMITE_ZIP = 400 * 1024 * 1024;
const TEMPO_MAX_MS = 10 * 60 * 1000; // 10 min por arquivo e a fila anda

function idiomaOk(v) {
  return /^[a-z]{2,5}$/.test(String(v || '')) ? String(v) : 'auto';
}

class Transcritor {
  // opcoes: { dirModelos, dirMotor, dirTmp, aoEvento(evento),
  //           baseModelos?, urlMotor?, urlFfmpeg? }  (os 3 últimos p/ testes)
  constructor(opcoes = {}) {
    this.dirModelos = opcoes.dirModelos;
    this.dirMotor = opcoes.dirMotor;
    this.dirTmp = opcoes.dirTmp;
    this.baseModelos = opcoes.baseModelos || BASE_MODELOS;
    this.urlMotor = opcoes.urlMotor || URL_MOTOR_WIN;
    this.urlFfmpeg = opcoes.urlFfmpeg || URL_FFMPEG_WIN;
    this.aoEvento = typeof opcoes.aoEvento === 'function' ? opcoes.aoEvento : () => {};
    this.downloads = new Map();  // chave → { pct, mb, req, cancelado }
    this.fila = [];              // [{ url, arquivo, conf }]
    this.rodando = null;
    this.procCorrente = null;
    this._sistemaCache = new Map(); // exe → caminho|null (busca no PATH, uma vez)
  }

  // ---------- estado para a UI ----------
  estado() {
    const modelos = {};
    for (const [nome, m] of Object.entries(MODELOS)) {
      const d = this.downloads.get('modelo:' + nome);
      modelos[nome] = {
        mb: m.mb,
        baixado: this._temArquivo(path.join(this.dirModelos, m.arquivo)),
        baixandoPct: d ? d.pct : null,
      };
    }
    const motor = this._ondeMotor('');
    const ffmpeg = this._ondeFfmpeg();
    const dm = this.downloads.get('motor');
    const df = this.downloads.get('ffmpeg');
    return {
      modelos,
      motor: { pronto: !!motor, origem: motor ? motor.origem : null, baixandoPct: dm ? dm.pct : null },
      ffmpeg: { pronto: !!ffmpeg, origem: ffmpeg ? ffmpeg.origem : null, baixandoPct: df ? df.pct : null },
      plataformaWin: process.platform === 'win32',
      fila: this.fila.length + (this.rodando ? 1 : 0),
    };
  }

  _temArquivo(p) { try { return fs.statSync(p).size > 0; } catch { return false; } }

  _noSistema(exe) {
    if (!this._sistemaCache.has(exe)) {
      let achou = null;
      try {
        const r = spawnSync(exe, ['-h'], { timeout: 4000, windowsHide: true, stdio: 'ignore' });
        if (!r.error) achou = exe;
      } catch { /* não tem */ }
      this._sistemaCache.set(exe, achou);
    }
    return this._sistemaCache.get(exe);
  }

  // De onde vem o motor: 1) comando configurado 2) baixado 3) instalado no sistema
  _ondeMotor(comandoConf) {
    const conf = String(comandoConf || '').trim();
    if (conf && this._temArquivo(conf)) return { comando: conf, origem: 'config' };
    const exe = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
    const baixado = path.join(this.dirMotor, exe);
    if (this._temArquivo(baixado)) return { comando: baixado, origem: 'baixado' };
    for (const nome of ['whisper-cli', 'whisper-cpp']) {
      const s = this._noSistema(nome);
      if (s) return { comando: s, origem: 'sistema' };
    }
    return null;
  }

  _ondeFfmpeg() {
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const baixado = path.join(this.dirMotor, exe);
    if (this._temArquivo(baixado)) return { comando: baixado, origem: 'baixado' };
    const s = this._noSistema('ffmpeg');
    if (s) return { comando: s, origem: 'sistema' };
    return null;
  }

  _avisaEstado() { this.aoEvento({ type: 'transcricaoEstado', estado: this.estado() }); }

  // ---------- downloads sob demanda ----------
  // Baixa uma URL (seguindo redirecionamentos) para um arquivo .part e avisa
  // o progresso; no fim chama aoPronto(caminhoPart).
  // limiteBytes > 0 = teto do arquivo (anunciado ou contado): passou, aborta
  _baixar(chave, url, destinoPart, aoPronto, aoErroBruto, redirecionos = 0, limiteBytes = 0) {
    // 🔒 v0.127.1: req e res avisam erro cada um — o chamador ouve UMA vez
    let avisou = false;
    const aoErro = (err) => { if (avisou) return; avisou = true; aoErroBruto(err); };
    if (redirecionos > 5) { aoErro(new Error('redirecionamento demais')); return; }
    const mod = url.startsWith('http://') ? http : https;
    const req = mod.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        // 🔒 v0.127.1: destino conferido — só http(s) e sem cair de https
        // para http no meio do caminho
        let proxima;
        try { proxima = new URL(res.headers.location, url); } catch { aoErro(new Error('redirecionamento inválido')); return; }
        if (proxima.protocol !== 'http:' && proxima.protocol !== 'https:') { aoErro(new Error('redirecionamento para um endereço não permitido')); return; }
        if (url.startsWith('https://') && proxima.protocol === 'http:') { aoErro(new Error('redirecionamento de https para http recusado')); return; }
        this._baixar(chave, proxima.toString(), destinoPart, aoPronto, aoErro, redirecionos + 1, limiteBytes);
        return;
      }
      if (res.statusCode !== 200) { res.resume(); aoErro(new Error('HTTP ' + res.statusCode)); return; }
      const total = Number(res.headers['content-length']) || 0;
      if (limiteBytes && total > limiteBytes) { res.resume(); aoErro(new Error('arquivo maior que o limite de ' + Math.round(limiteBytes / 1048576) + ' MB')); return; }
      let lidos = 0;
      let ultimoAviso = 0;
      const escrita = fs.createWriteStream(destinoPart);
      const d = this.downloads.get(chave);
      if (d) d.req = req;
      res.on('data', (peca) => {
        lidos += peca.length;
        if (limiteBytes && lidos > limiteBytes) {
          // 🔒 v0.127.1: o servidor mandou mais do que anunciou — corta aqui
          req.destroy(new Error('arquivo maior que o limite de ' + Math.round(limiteBytes / 1048576) + ' MB'));
          return;
        }
        const dd = this.downloads.get(chave);
        if (dd) {
          dd.pct = total ? Math.min(99, Math.floor((lidos / total) * 100)) : null;
          const agora = Date.now();
          if (agora - ultimoAviso > 900) { ultimoAviso = agora; this._avisaEstado(); }
        }
      });
      res.pipe(escrita);
      escrita.on('finish', () => aoPronto(destinoPart));
      escrita.on('error', aoErro);
      res.on('error', aoErro);
    });
    const d0 = this.downloads.get(chave);
    if (d0) d0.req = req;
    req.on('error', aoErro);
  }

  _terminaDownload(chave, erro) {
    this.downloads.delete(chave);
    if (erro) this.aoEvento({ type: 'transcricaoAviso', erro: String(erro.message || erro), chave });
    this._avisaEstado();
  }

  baixarModelo(nome) {
    const m = MODELOS[nome];
    if (!m || this.downloads.has('modelo:' + nome)) return;
    fs.mkdirSync(this.dirModelos, { recursive: true });
    const destino = path.join(this.dirModelos, m.arquivo);
    if (this._temArquivo(destino)) return;
    const chave = 'modelo:' + nome;
    this.downloads.set(chave, { pct: 0, mb: m.mb, req: null });
    this._avisaEstado();
    const part = destino + '.part';
    this._baixar(chave, this.baseModelos + m.arquivo, part, () => {
      if (this.downloads.get(chave)?.cancelado) { try { fs.unlinkSync(part); } catch {} this._terminaDownload(chave); return; }
      try { fs.renameSync(part, destino); this._terminaDownload(chave); }
      catch (err) { this._terminaDownload(chave, err); }
    }, (err) => {
      try { fs.unlinkSync(part); } catch {}
      this._terminaDownload(chave, this.downloads.get(chave)?.cancelado ? null : err);
    });
  }

  cancelarDownload(chave) {
    const d = this.downloads.get(chave);
    if (!d) return;
    d.cancelado = true;
    try { d.req?.destroy(new Error('cancelado')); } catch {}
  }

  apagarModelo(nome) {
    const m = MODELOS[nome];
    if (!m) return;
    try { fs.unlinkSync(path.join(this.dirModelos, m.arquivo)); } catch {}
    this._avisaEstado();
  }

  // Motor (whisper-cli) e ffmpeg para Windows x64: zip oficial → só os
  // executáveis/DLLs necessários caem em dirMotor
  baixarMotor(alvo) {
    const chave = alvo === 'ffmpeg' ? 'ffmpeg' : 'motor';
    if (this.downloads.has(chave)) return;
    fs.mkdirSync(this.dirMotor, { recursive: true });
    this.downloads.set(chave, { pct: 0, req: null });
    this._avisaEstado();
    const part = path.join(this.dirMotor, chave + '.zip.part');
    const url = chave === 'ffmpeg' ? this.urlFfmpeg : this.urlMotor;
    this._baixar(chave, url, part, () => {
      if (this.downloads.get(chave)?.cancelado) { try { fs.unlinkSync(part); } catch {} this._terminaDownload(chave); return; }
      try {
        const zip = fs.readFileSync(part);
        const quer = chave === 'ffmpeg'
          ? (nome) => (nome.endsWith('/ffmpeg.exe') ? 'ffmpeg.exe' : null)
          : (nome) => {
            const base = nome.split('/').pop();
            return (base === 'whisper-cli.exe' || base.endsWith('.dll')) ? base : null;
          };
        const tirados = zipExtrair(zip, quer, this.dirMotor);
        fs.unlinkSync(part);
        this._terminaDownload(chave, tirados ? null : new Error('o zip não trouxe o executável esperado'));
      } catch (err) {
        try { fs.unlinkSync(part); } catch {}
        this._terminaDownload(chave, err);
      }
    }, (err) => {
      try { fs.unlinkSync(part); } catch {}
      this._terminaDownload(chave, this.downloads.get(chave)?.cancelado ? null : err);
    }, 0, LIMITE_ZIP);
  }

  // ---------- a fila de transcrição ----------
  // conf: { modelo, idioma, comando } (settings.transcricao do momento)
  transcrever(url, arquivo, conf) {
    if (!url || !arquivo) return;
    if (this.fila.some((j) => j.url === url) || this.rodando?.url === url) return;
    if (this.fila.length >= 20) return; // fila cheia: os próximos ficam sem rascunho
    this.fila.push({ url, arquivo, conf: { ...conf } });
    this.aoEvento({ type: 'transcricao', url, estado: 'fila' });
    this._processa();
  }

  _resultado(url, dados) { this.aoEvento({ type: 'transcricao', url, ...dados }); }

  _processa() {
    if (this.rodando || !this.fila.length) return;
    const job = this.fila.shift();
    this.rodando = job;
    this._roda(job).catch((err) => {
      this._resultado(job.url, { estado: 'erro', erro: String(err.message || err) });
    }).finally(() => {
      this.rodando = null;
      this.procCorrente = null;
      this._avisaEstado();
      this._processa();
    });
    this._avisaEstado();
  }

  async _roda(job) {
    const conf = job.conf || {};
    const nomeModelo = MODELOS[conf.modelo] ? conf.modelo : 'base';
    const modeloArq = path.join(this.dirModelos, MODELOS[nomeModelo].arquivo);
    if (!this._temArquivo(modeloArq)) {
      this._resultado(job.url, { estado: 'erro', erro: 'modelo-nao-baixado' });
      return;
    }
    const motor = this._ondeMotor(conf.comando);
    if (!motor) {
      this._resultado(job.url, { estado: 'erro', erro: 'motor-nao-encontrado' });
      return;
    }
    if (!this._temArquivo(job.arquivo)) {
      this._resultado(job.url, { estado: 'erro', erro: 'arquivo-sumiu' });
      return;
    }
    this._resultado(job.url, { estado: 'processando' });

    // Voz do Telegram (opus) e vídeos passam pelo ffmpeg antes
    let entrada = job.arquivo;
    let tmpWav = null;
    const ext = path.extname(job.arquivo).slice(1).toLowerCase();
    if (!EXT_DIRETA.has(ext)) {
      const ffmpeg = this._ondeFfmpeg();
      if (!ffmpeg) {
        this._resultado(job.url, { estado: 'erro', erro: 'precisa-ffmpeg' });
        return;
      }
      fs.mkdirSync(this.dirTmp, { recursive: true });
      tmpWav = path.join(this.dirTmp, 'transcricao-' + Date.now().toString(36) + '.wav');
      const conv = await this._executa(ffmpeg.comando,
        ['-y', '-i', job.arquivo, '-vn', '-ar', '16000', '-ac', '1', tmpWav], 3 * 60 * 1000);
      if (conv.codigo !== 0 || !this._temArquivo(tmpWav)) {
        try { if (tmpWav) fs.unlinkSync(tmpWav); } catch {}
        this._resultado(job.url, { estado: 'erro', erro: 'conversao-falhou' });
        return;
      }
      entrada = tmpWav;
    }

    try {
      const idioma = idiomaOk(conf.idioma) === 'auto' ? 'auto' : idiomaOk(conf.idioma);
      const r = await this._executa(motor.comando,
        ['-m', modeloArq, '-f', entrada, '-l', idioma, '-nt', '-np'], TEMPO_MAX_MS);
      if (r.codigo !== 0) {
        this._resultado(job.url, { estado: 'erro', erro: 'motor-falhou' });
        return;
      }
      const texto = String(r.saida || '')
        .split('\n').map((l) => l.trim()).filter(Boolean).join('\n')
        .slice(0, LIMITE_TEXTO).trim();
      if (!texto) { this._resultado(job.url, { estado: 'erro', erro: 'sem-fala' }); return; }
      this._resultado(job.url, { estado: 'ok', texto });
    } finally {
      try { if (tmpWav) fs.unlinkSync(tmpWav); } catch {}
    }
  }

  _executa(comando, args, tempoMax) {
    return new Promise((resolve) => {
      let saida = '';
      let acabou = false;
      const fim = (codigo) => { if (!acabou) { acabou = true; clearTimeout(relogio); resolve({ codigo, saida }); } };
      let proc;
      try {
        proc = spawn(comando, args, { windowsHide: true });
      } catch (err) { resolve({ codigo: -1, saida: '' }); return; }
      this.procCorrente = proc;
      const relogio = setTimeout(() => { try { proc.kill(); } catch {} fim(-2); }, tempoMax);
      proc.stdout.on('data', (d) => { if (saida.length < 2 * LIMITE_TEXTO) saida += d; });
      proc.stderr.on('data', () => {});
      proc.on('error', () => fim(-1));
      proc.on('close', (codigo) => fim(codigo ?? -1));
    });
  }

  parar() {
    this.fila = [];
    try { this.procCorrente?.kill(); } catch {}
    for (const chave of [...this.downloads.keys()]) this.cancelarDownload(chave);
  }
}

// ---------- unzip mínimo (diretório central) ----------
// quer(nomeEntrada) → nome do arquivo de destino (ou null para pular)
function zipExtrair(buf, quer, dirDestino) {
  // acha o End Of Central Directory de trás pra frente
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 70000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('zip sem diretório central');
  const qtd = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  // zips de release cabem no formato clássico; um delta (auto-extrator) é
  // compensado procurando a primeira assinatura de entrada central
  if (pos >= buf.length || buf.readUInt32LE(pos) !== 0x02014b50) {
    pos = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    if (pos === -1) throw new Error('zip sem entradas');
  }
  let tirados = 0;
  for (let n = 0; n < qtd && pos + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(pos + 10);
    const tamComp = buf.readUInt32LE(pos + 20);
    const nomeTam = buf.readUInt16LE(pos + 28);
    const extraTam = buf.readUInt16LE(pos + 30);
    const comentTam = buf.readUInt16LE(pos + 32);
    const offsetLocal = buf.readUInt32LE(pos + 42);
    const nome = buf.toString('utf8', pos + 46, pos + 46 + nomeTam);
    pos += 46 + nomeTam + extraTam + comentTam;
    const destinoNome = quer(nome);
    if (!destinoNome || nome.endsWith('/')) continue;
    // cabeçalho local: os campos de nome/extra podem diferir do central
    if (buf.readUInt32LE(offsetLocal) !== 0x04034b50) continue;
    const nomeTamL = buf.readUInt16LE(offsetLocal + 26);
    const extraTamL = buf.readUInt16LE(offsetLocal + 28);
    const inicio = offsetLocal + 30 + nomeTamL + extraTamL;
    const comp = buf.subarray(inicio, inicio + tamComp);
    const dados = metodo === 8 ? zlib.inflateRawSync(comp) : metodo === 0 ? comp : null;
    if (!dados) continue;
    const alvo = path.join(dirDestino, path.basename(destinoNome));
    fs.writeFileSync(alvo, dados);
    if (process.platform !== 'win32' && /\.(exe|dll)$/i.test(alvo) === false) {
      try { fs.chmodSync(alvo, 0o755); } catch {}
    }
    tirados++;
  }
  return tirados;
}

module.exports = { Transcritor, MODELOS, idiomaOk };
