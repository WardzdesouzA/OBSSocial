// ---------------------------------------------------------------------------
// 🎙️ Transcrição local (Labs) — whisper.cpp rodando NO COMPUTADOR do streamer.
// Nada de nuvem: o áudio/vídeo que o inscrito mandou não sai da máquina.
// TUDO é baixado sob demanda (nada vem embutido no programa):
//   • os modelos GGML (tiny → large) direto do Hugging Face oficial;
//   • o motor (whisper-cli) do release oficial do whisper.cpp (Windows x64,
//     32 bits ou ARM64, conforme a arquitetura — ver MOTOR_WIN);
//   • o conversor ffmpeg (para voz do Telegram/opus e vídeos) do build
//     estável do projeto BtbN (x64 ou ARM64 — ver FFMPEG_WIN), também só se
//     precisar.
// Em outros sistemas o motor/ffmpeg instalados na máquina são usados
// automaticamente (ou um caminho que o streamer configurar).
// A fila processa UM arquivo por vez para não derrubar a live.
// ---------------------------------------------------------------------------
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const integridade = require('./integridade');

// Modelos oficiais do whisper.cpp (ggerganov) — «mb» só para mostrar na UI.
// 🛟 v0.189: «bytes» e «sha256» são o tamanho e o «oid» do LFS que a API do
// Hugging Face publica para cada arquivo no commit fixado abaixo
// (api/models/ggerganov/whisper.cpp/paths-info/<commit>) — o download só
// vira modelo se a soma bater; o teto de bytes corta um servidor que mande mais
const MODELOS = {
  tiny: { arquivo: 'ggml-tiny.bin', mb: 75, bytes: 77691713, sha256: 'be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21' },
  base: { arquivo: 'ggml-base.bin', mb: 142, bytes: 147951465, sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe' },
  small: { arquivo: 'ggml-small.bin', mb: 466, bytes: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  medium: { arquivo: 'ggml-medium.bin', mb: 1463, bytes: 1533763059, sha256: '6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208' },
  large: { arquivo: 'ggml-large-v3-turbo.bin', mb: 1550, bytes: 1624555275, sha256: '1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69' }, // large-v3-turbo: o mais preciso que ainda roda bem
};
// 🛟 v0.189: um commit fixo no lugar de «main» — o «main» pode trocar um
// arquivo e a soma fixada deixaria de bater; o commit não muda nunca
const COMMIT_MODELOS = '5359861c739e955e79d9a303bcbc70fb988958b1';
const BASE_MODELOS = `https://huggingface.co/ggerganov/whisper.cpp/resolve/${COMMIT_MODELOS}/`;
// 🛟 v0.189: a soma SHA-256 dos zips da versão FIXADA do motor (o «digest» dos
// arquivos do release v1.8.2 no GitHub). Outra tag (o «Atualizar» do
// inventário) busca o digest na API do GitHub na hora; o ffmpeg «latest»
// lê o checksums.sha256 do mesmo release.
const SOMAS_FIXAS = {
  'v1.8.2/whisper-bin-x64.zip': 'b1514ebc099765e39fa37eb780b92a140a94c86bb0b3b3d98226b38825979732',
  'v1.8.2/whisper-bin-Win32.zip': '49244b4d13cc95f2f27a0098809a8514a835929fa0d24d1a8db6b9073650ba96',
};
const API_GITHUB = 'https://api.github.com';
// Motor e conversor prontos para Windows (a maioria dos streamers do OBS), por
// arquitetura (v0.184) — um zip x64 não serve num Windows de 32 bits:
//   • o whisper.cpp publica x64 e Win32 (32 bits); não publica ARM64 — o
//     Windows 11 ARM (build 22000+) roda o x64 pela emulação dele; o Windows
//     10 ARM só emula x86, então ali vai o de 32 bits;
//   • o ffmpeg (BtbN) publica win64 e winarm64; não publica 32 bits — aí o
//     ffmpeg tem que vir instalado no sistema (null = sem download pronto).
const WHISPER_X64 = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-x64.zip';
const WHISPER_WIN32 = 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.8.2/whisper-bin-Win32.zip';
const WIN_BUILD = process.platform === 'win32' ? Number(String(os.release()).split('.')[2]) || 0 : 0;
const MOTOR_WIN = {
  x64: WHISPER_X64,
  arm64: WIN_BUILD >= 22000 ? WHISPER_X64 : WHISPER_WIN32,
  ia32: WHISPER_WIN32,
};
const FFMPEG_WIN = {
  x64: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  arm64: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-winarm64-gpl.zip',
};
// Fora do Windows não há zip pronto (null): o motor e o ffmpeg vêm do sistema
const URL_MOTOR_WIN = process.platform === 'win32' ? MOTOR_WIN[process.arch] || null : null;
const URL_FFMPEG_WIN = process.platform === 'win32' ? FFMPEG_WIN[process.arch] || null : null;
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
  //           baseModelos?, urlMotor?, urlFfmpeg?, somas?, apiGithub? }
  //           (os 5 últimos p/ testes — somas: { 'ggml-tiny.bin' | '<tag>/<zip>': sha256 })
  constructor(opcoes = {}) {
    this.dirModelos = opcoes.dirModelos;
    this.dirMotor = opcoes.dirMotor;
    this.dirTmp = opcoes.dirTmp;
    this.baseModelos = opcoes.baseModelos || BASE_MODELOS;
    this.urlMotor = opcoes.urlMotor || URL_MOTOR_WIN;
    this.urlFfmpeg = opcoes.urlFfmpeg || URL_FFMPEG_WIN;
    // 🛟 v0.189: as somas oficiais fixadas (modelos pelo nome do arquivo, zips
    // por «tag/arquivo»); um teste com servidor de mentira declara as dele
    this.somas = { ...SOMAS_FIXAS, ...Object.fromEntries(Object.values(MODELOS).map((m) => [m.arquivo, m.sha256])) };
    for (const [k, v] of Object.entries(opcoes.somas || {})) if (integridade.somaValida(String(v).toLowerCase())) this.somas[k] = String(v).toLowerCase();
    this.apiGithub = String(opcoes.apiGithub || API_GITHUB).replace(/\/$/, '');
    this.aoEvento = typeof opcoes.aoEvento === 'function' ? opcoes.aoEvento : () => {};
    // 🛟 v0.189: vigiar(proc) anota cada programa aberto (whisper-cli, ffmpeg)
    // no registro do servidor, que os encerra quando o OBS Social fecha
    this.vigiar = typeof opcoes.vigiar === 'function' ? opcoes.vigiar : null;
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
      // v0.184: baixavel = existe um zip pronto para este sistema/arquitetura
      // 🛟 v0.189: semConferencia = há uma cópia baixada antes da conferência
      // de integridade; ela não roda e o painel oferece baixar de novo
      motor: { pronto: !!motor, origem: motor ? motor.origem : null, baixandoPct: dm ? dm.pct : null, baixavel: !!this.urlMotor, semConferencia: this._semConferencia('motor') },
      ffmpeg: { pronto: !!ffmpeg, origem: ffmpeg ? ffmpeg.origem : null, baixandoPct: df ? df.pct : null, baixavel: !!this.urlFfmpeg, semConferencia: this._semConferencia('ffmpeg') },
      plataformaWin: process.platform === 'win32',
      arquitetura: process.arch,
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
    // 🛟 v0.189: o baixado só roda se passou pela conferência (_pecaConferida)
    if (this._temArquivo(baixado) && this._pecaConferida('motor')) return { comando: baixado, origem: 'baixado' };
    for (const nome of ['whisper-cli', 'whisper-cpp']) {
      const s = this._noSistema(nome);
      if (s) return { comando: s, origem: 'sistema' };
    }
    return null;
  }

  _ondeFfmpeg() {
    const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
    const baixado = path.join(this.dirMotor, exe);
    if (this._temArquivo(baixado) && this._pecaConferida('ffmpeg')) return { comando: baixado, origem: 'baixado' }; // 🛟 v0.189
    const s = this._noSistema('ffmpeg');
    if (s) return { comando: s, origem: 'sistema' };
    return null;
  }

  // 🛟 v0.189: só vale o motor/ffmpeg baixado E conferido (v0.189 em diante):
  // o download anota em versoes.json cada arquivo tirado do zip conferido, com
  // o tamanho — o executável e todos esses arquivos têm de estar lá, iguais.
  // Uma cópia de antes (sem a anotação) fica no disco, mas não roda.
  _exe(chave) { return (chave === 'ffmpeg' ? 'ffmpeg' : 'whisper-cli') + (process.platform === 'win32' ? '.exe' : ''); }
  _pecaConferida(chave) {
    const v = this.versoes()[chave];
    const arquivos = v && v.arquivos && typeof v.arquivos === 'object' ? v.arquivos : null;
    if (!arquivos || !arquivos[this._exe(chave)]) return false;
    return Object.entries(arquivos).every(([nome, a]) => {
      try { return !!a && fs.statSync(path.join(this.dirMotor, path.basename(nome))).size === a.bytes; } catch { return false; }
    });
  }
  _semConferencia(chave) { return this._temArquivo(path.join(this.dirMotor, this._exe(chave))) && !this._pecaConferida(chave); }

  // 🛟 v0.189: a soma oficial do zip ANTES do download:
  //   • tag fixada no programa → SOMAS_FIXAS (no código);
  //   • ffmpeg «latest» → o checksums.sha256 do MESMO release (mesma pasta);
  //   • outra tag do whisper.cpp → o «digest» do arquivo na API do GitHub.
  async _somaOficial(chave, url) {
    const p = /\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/]+)$/.exec(new URL(url).pathname);
    if (!p) throw new Error('endereço fora do padrão dos releases');
    const [, dono, repo, tagUrl, arquivoUrl] = p;
    const arquivo = decodeURIComponent(arquivoUrl);
    const fixa = this.somas[`${decodeURIComponent(tagUrl)}/${arquivo}`];
    if (fixa) return fixa;
    if (chave === 'ffmpeg') {
      const r = await integridade.buscarTexto(new URL('checksums.sha256', url).toString());
      if (r.status !== 200) throw new Error('o arquivo de somas respondeu ' + r.status);
      const soma = integridade.lerSomas(r.texto).get(arquivo);
      if (!soma) throw new Error('o arquivo de somas do release não traz ' + arquivo);
      return soma;
    }
    const r = await integridade.buscarTexto(`${this.apiGithub}/repos/${dono}/${repo}/releases/tags/${tagUrl}`,
      { cabecalhos: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (r.status !== 200) throw new Error('a API do GitHub respondeu ' + r.status);
    let rel = null;
    try { rel = JSON.parse(r.texto); } catch { throw new Error('a API do GitHub não respondeu JSON'); }
    const item = (Array.isArray(rel && rel.assets) ? rel.assets : []).find((a) => a && a.name === arquivo);
    if (!item) throw new Error('o release não traz ' + arquivo);
    const soma = integridade.somaDoDigest(item.digest);
    if (!soma) throw new Error('o GitHub não publicou a soma desse arquivo');
    return soma;
  }

  // 🛟 v0.189: o modelo baixado nesta versão já nasce anotado (conferidos.json);
  // o de antes é conferido UMA vez, em fluxo, contra a soma oficial — bateu,
  // fica anotado; não bateu, é apagado e o painel avisa
  async _modeloConferido(nome) {
    const m = MODELOS[nome];
    const esperada = this.somas[m.arquivo];
    const anot = integridade.lerConferidos(this.dirModelos)[m.arquivo];
    if (anot && anot.sha256 === esperada && integridade.estaConferido(this.dirModelos, m.arquivo)) return true;
    const caminho = path.join(this.dirModelos, m.arquivo);
    let soma = null;
    try { soma = await integridade.somaDoArquivo(caminho); } catch { return false; }
    if (soma === esperada) {
      let bytes = 0;
      try { bytes = fs.statSync(caminho).size; } catch { /* sumiu no meio: a próxima vez confere de novo */ }
      integridade.anotarConferido(this.dirModelos, m.arquivo, { sha256: soma, bytes });
      return true;
    }
    console.warn(`  🛟 Integridade: o modelo ${m.arquivo} já baixado não confere com a soma SHA-256 oficial (esperada ${esperada}, veio ${soma}) — apagado.`);
    try { fs.unlinkSync(caminho); } catch { /* já saiu */ }
    integridade.anotarConferido(this.dirModelos, m.arquivo, null);
    this.aoEvento({ type: 'transcricaoAviso', chave: 'modelo:' + nome, integridade: true,
      erro: `o modelo ${m.arquivo}, baixado antes, não confere com a soma SHA-256 oficial — foi apagado; baixe de novo.` });
    this._avisaEstado();
    return false;
  }

  _avisaEstado() { this.aoEvento({ type: 'transcricaoEstado', estado: this.estado() }); }

  // 🧩 v0.185: para o inventário de componentes — onde estão o motor e o ffmpeg
  caminhos() { return { motor: this._ondeMotor(''), ffmpeg: this._ondeFfmpeg() }; }
  // …e o que o programa mesmo baixou (tag do whisper.cpp, data do download):
  // o whisper-cli não diz a própria versão, então ela fica anotada aqui
  _arquivoVersoes() { return path.join(this.dirMotor, 'versoes.json'); }
  versoes() { try { return JSON.parse(fs.readFileSync(this._arquivoVersoes(), 'utf8')) || {}; } catch { return {}; } }
  _anotarVersao(chave, dados) {
    try {
      const atual = this.versoes();
      atual[chave] = { ...dados, em: new Date().toISOString() };
      fs.mkdirSync(this.dirMotor, { recursive: true });
      fs.writeFileSync(this._arquivoVersoes(), JSON.stringify(atual, null, 2) + '\n');
    } catch { /* sem anotação: o inventário mostra «?» */ }
  }

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
      // 🛟 v0.189: a soma SHA-256 sai daqui, pedaço a pedaço, enquanto o arquivo
      // chega (sem ler de novo do disco); quem chama compara com a oficial
      const conta = crypto.createHash('sha256');
      res.on('data', (peca) => {
        lidos += peca.length;
        if (limiteBytes && lidos > limiteBytes) {
          // 🔒 v0.127.1: o servidor mandou mais do que anunciou — corta aqui
          req.destroy(new Error('arquivo maior que o limite de ' + Math.round(limiteBytes / 1048576) + ' MB'));
          return;
        }
        conta.update(peca);
        const dd = this.downloads.get(chave);
        if (dd) {
          dd.pct = total ? Math.min(99, Math.floor((lidos / total) * 100)) : null;
          const agora = Date.now();
          if (agora - ultimoAviso > 900) { ultimoAviso = agora; this._avisaEstado(); }
        }
      });
      res.pipe(escrita);
      escrita.on('finish', () => aoPronto(destinoPart, { sha256: conta.digest('hex'), bytes: lidos }));
      escrita.on('error', aoErro);
      res.on('error', aoErro);
    });
    const d0 = this.downloads.get(chave);
    if (d0) d0.req = req;
    req.on('error', aoErro);
  }

  _terminaDownload(chave, erro) {
    this.downloads.delete(chave);
    // 🛟 v0.189: integridade = a soma não bateu — o painel deixa esse recado na tela
    if (erro) this.aoEvento({ type: 'transcricaoAviso', erro: String(erro.message || erro), chave, ...(erro.integridade ? { integridade: true } : {}) });
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
    this._baixar(chave, this.baseModelos + m.arquivo, part, (p, conta) => {
      if (this.downloads.get(chave)?.cancelado) { try { fs.unlinkSync(part); } catch {} this._terminaDownload(chave); return; }
      // 🛟 v0.189: só vira modelo se a soma bater com a oficial; senão sai do disco
      if (conta.sha256 !== this.somas[m.arquivo]) {
        try { fs.unlinkSync(part); } catch {}
        this._terminaDownload(chave, integridade.erroNaoConfere(m.arquivo, this.somas[m.arquivo], conta.sha256));
        return;
      }
      try {
        fs.renameSync(part, destino);
        integridade.anotarConferido(this.dirModelos, m.arquivo, { sha256: conta.sha256, bytes: conta.bytes });
        this._terminaDownload(chave);
      } catch (err) { this._terminaDownload(chave, err); }
    }, (err) => {
      try { fs.unlinkSync(part); } catch {}
      this._terminaDownload(chave, this.downloads.get(chave)?.cancelado ? null : err);
    }, 0, m.bytes);
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
    integridade.anotarConferido(this.dirModelos, m.arquivo, null); // 🛟 v0.189
    this._avisaEstado();
  }

  // Motor (whisper-cli) e ffmpeg para Windows (o zip da arquitetura, ver
  // MOTOR_WIN/FFMPEG_WIN): só os executáveis/DLLs necessários caem em dirMotor
  // opcoes.tag (só o motor): baixa essa versão do whisper.cpp em vez da fixada
  // no programa — é o botão «Atualizar» do inventário de componentes (v0.185)
  baixarMotor(alvo, opcoes = {}) {
    const chave = alvo === 'ffmpeg' ? 'ffmpeg' : 'motor';
    if (this.downloads.has(chave)) return;
    let url = chave === 'ffmpeg' ? this.urlFfmpeg : this.urlMotor;
    const tag = chave === 'motor' && /^v\d+\.\d+\.\d+$/.test(String(opcoes.tag || '')) ? String(opcoes.tag) : null;
    if (chave === 'motor' && opcoes.tag && !tag) {
      // uma tag fora do padrão não vira um download silencioso da versão fixada
      this.aoEvento({ type: 'transcricaoAviso', chave, erro: `versão pedida fora do padrão (${String(opcoes.tag).slice(0, 30)})` });
      return;
    }
    if (url && tag) url = url.replace(/\/releases\/download\/v\d+\.\d+\.\d+\//, `/releases/download/${tag}/`);
    if (!url) {
      // v0.184: sem zip pronto para esta arquitetura (ex.: ffmpeg no Windows de 32 bits)
      this.aoEvento({ type: 'transcricaoAviso', chave, erro: `não existe um ${chave === 'ffmpeg' ? 'ffmpeg' : 'whisper.cpp'} pronto para baixar neste sistema (${process.platform}/${process.arch}); instale-o você mesmo e o OBS Social o encontra sozinho` });
      return;
    }
    fs.mkdirSync(this.dirMotor, { recursive: true });
    this.downloads.set(chave, { pct: 0, req: null });
    this._avisaEstado();
    const part = path.join(this.dirMotor, chave + '.zip.part');
    const arquivoZip = decodeURIComponent(new URL(url).pathname.split('/').pop() || chave + '.zip');
    // 🛟 v0.189: primeiro a soma oficial (_somaOficial); sem ela, nada é baixado
    this._somaOficial(chave, url).then((esperada) => {
      if (this.downloads.get(chave)?.cancelado) { this._terminaDownload(chave); return; }
      this._baixar(chave, url, part, async (p, conta) => {
        if (this.downloads.get(chave)?.cancelado) { try { fs.unlinkSync(part); } catch {} this._terminaDownload(chave); return; }
        let confere = conta.sha256 === esperada;
        if (!confere && chave === 'ffmpeg') {
          // 🛟 v0.189: o «latest» do BtbN é republicado todo dia — se a soma
          // publicada mudou durante o download e o arquivo bate com a NOVA,
          // era o build novo chegando no meio do caminho: vale
          try { confere = (await this._somaOficial(chave, url)) === conta.sha256; } catch { confere = false; }
        }
        if (!confere) {
          // 🛟 v0.189: não bateu — o zip sai do disco ANTES de abrir qualquer coisa
          try { fs.unlinkSync(part); } catch {}
          this._terminaDownload(chave, integridade.erroNaoConfere(arquivoZip, esperada, conta.sha256));
          return;
        }
        try {
          const zip = fs.readFileSync(part);
          const quer = chave === 'ffmpeg'
            ? (nome) => (nome.endsWith('/ffmpeg.exe') ? 'ffmpeg.exe' : null)
            : (nome) => {
              const base = nome.split('/').pop();
              return (base === 'whisper-cli.exe' || base.endsWith('.dll')) ? base : null;
            };
          // 🛟 v0.189: cada arquivo tirado do zip conferido fica anotado (soma e
          // tamanho) — é essa anotação que libera o executável (_pecaConferida)
          const arquivos = {};
          const tirados = zipExtrair(zip, quer, this.dirMotor, (nome, dados) => {
            arquivos[nome] = { sha256: integridade.somaDoBuffer(dados), bytes: dados.length };
          });
          fs.unlinkSync(part);
          if (tirados) {
            // 🧩 v0.185: anota a versão baixada (a tag da URL) para o inventário
            const mTag = /\/releases\/download\/([^/]+)\//.exec(url);
            const conferido = { url, sha256: conta.sha256, arquivos };
            this._anotarVersao(chave, chave === 'motor' ? { tag: mTag ? decodeURIComponent(mTag[1]) : null, ...conferido } : conferido);
          }
          this._terminaDownload(chave, tirados ? null : new Error('o zip não trouxe o executável esperado'));
        } catch (err) {
          try { fs.unlinkSync(part); } catch {}
          this._terminaDownload(chave, err);
        }
      }, (err) => {
        try { fs.unlinkSync(part); } catch {}
        this._terminaDownload(chave, this.downloads.get(chave)?.cancelado ? null : err);
      }, 0, LIMITE_ZIP);
    }).catch((err) => {
      this._terminaDownload(chave, this.downloads.get(chave)?.cancelado ? null : integridade.erroSemSoma(arquivoZip, err && err.message));
    });
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
    // 🛟 v0.189: o modelo só vai para o motor conferido (o de antes, uma vez)
    if (!(await this._modeloConferido(nomeModelo))) {
      this._resultado(job.url, { estado: 'erro', erro: 'modelo-nao-confere' });
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
      if (this.vigiar) this.vigiar(proc); // 🛟 v0.189
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
// 🛟 v0.189: aoGravar(nome, dados), se vier, ouve cada arquivo gravado
function zipExtrair(buf, quer, dirDestino, aoGravar) {
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
    if (aoGravar) aoGravar(path.basename(alvo), dados);
    tirados++;
  }
  return tirados;
}

module.exports = { Transcritor, MODELOS, idiomaOk };
