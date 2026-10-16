// ===========================================================================
// 🧩 Componentes (v0.185) — o inventário do que o OBS Social usa para
// funcionar: versão e arquitetura em uso, de onde cada um veio (incluído no
// ZIP, instalado no sistema, baixado pelo programa, cópia portátil) e, 1x por
// dia junto com a busca da versão nova do programa, a versão mais recente
// publicada pelos desenvolvedores de cada um — para nada ficar defasado sem
// ninguém saber.
//
// De onde vem a versão nova de cada componente:
//   • Node.js — o motor. A mais nova da MESMA linha em
//     nodejs.org/dist/latest-vN.x/SHASUMS256.txt (3 KB) e o calendário de
//     suporte oficial (schedule.json do projeto Node). Atualiza-se pelo site
//     oficial (ou trocando a pasta node-portable/).
//   • ws, qrcode-generator, lottie-web — vêm no ZIP; a versão nova é lida no
//     registro do npm, mas elas só mudam numa atualização do OBS Social.
//   • yt-dlp e whisper.cpp — baixados sob demanda; a versão nova vem do
//     redirecionamento «releases/latest» do GitHub (sem a API, sem limite).
//   • ffmpeg — build rolante do BtbN: «mais nova» é um build publicado depois
//     do que foi baixado (Last-Modified do arquivo).
//   • Biblioteca do WhatsApp (Baileys) — registro do npm, só a mesma linha
//     maior (uma linha maior nova entra depois de testada, com o programa).
//   • curl — do sistema; só informa versão e arquitetura.
// Nada aqui baixa programa nenhum: só lê versões. Os downloads continuam nos
// módulos de cada componente (ytdlp.js, transcricao.js e o WhatsApp em
// server.js), acionados pelo botão «Atualizar» da tela ℹ️ Sobre.
// ===========================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawnSync } = require('child_process');

const URLS = {
  nodeDist: 'https://nodejs.org/dist/',
  nodeSchedule: 'https://raw.githubusercontent.com/nodejs/Release/main/schedule.json',
  npm: 'https://registry.npmjs.org/',
  ytdlpLatest: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS',
  whisperLatest: 'https://github.com/ggml-org/whisper.cpp/releases/latest/download/whisper-bin-x64.zip',
};
const TEMPO_MS = 15 * 1000;
const TETO_BYTES = 3 * 1024 * 1024;   // o packument abreviado do Baileys é o maior (centenas de KB)
const CACHE_CMD_MS = 60 * 1000;       // «ffmpeg -version» e companhia não precisam rodar a cada clique
const ARQUIVO = 'componentes.json';   // em data/: só o que veio da internet (o local é relido sempre)

// 🧪 Gancho de teste: OBS_TESTE_COMPONENTES_BASE=http://127.0.0.1:porta faz todo
// endereço virar http://127.0.0.1:porta/<host><caminho> — um servidor de mentira
// local responde por nodejs.org, registry.npmjs.org e github.com.
function reescrever(url) {
  const base = process.env.OBS_TESTE_COMPONENTES_BASE;
  if (!base) return url;
  if (String(url).startsWith(base.replace(/\/$/, ''))) return url; // já aponta para o servidor de mentira
  const u = new URL(url);
  return base.replace(/\/$/, '') + '/' + u.host + u.pathname + u.search;
}
// A tag do whisper.cpp tem a forma «v1.8.2» — a mesma que baixarMotor() aceita
const TAG_WHISPER = /^v\d+\.\d+\.\d+$/;

// GET pequeno com tempo limite e teto; `seguir` = quantos redirecionamentos
// acompanhar (0 = devolve o 3xx com o Location, que é o que interessa no
// «releases/latest» do GitHub).
function pedir(url, opcoes = {}) {
  const { seguir = 3, headers = {}, metodo = 'GET' } = opcoes;
  return new Promise((resolve, reject) => {
    const alvo = reescrever(url);
    const mod = alvo.startsWith('http:') ? http : https;
    const req = mod.request(alvo, { method: metodo, headers: { 'User-Agent': 'OBS-Social', ...headers } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        if (seguir <= 0) { res.resume(); resolve({ status, headers: res.headers, texto: '' }); return; }
        let prox;
        try { prox = new URL(res.headers.location, alvo); } catch { res.resume(); reject(new Error('redirecionamento inválido')); return; }
        if (!/^https?:$/.test(prox.protocol)) { res.resume(); reject(new Error('redirecionamento para fora do http')); return; }
        res.resume();
        // o destino já veio reescrito pelo servidor de mentira (ou é real): não reescreve de novo
        resolve(pedirBruto(prox.toString(), { ...opcoes, seguir: seguir - 1 }));
        return;
      }
      const pedacos = []; let total = 0;
      res.on('data', (c) => { total += c.length; if (total > TETO_BYTES) { req.destroy(new Error('resposta maior que o esperado')); return; } pedacos.push(c); });
      res.on('end', () => resolve({ status, headers: res.headers, texto: Buffer.concat(pedacos).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(TEMPO_MS, () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end();
  });
}
// Igual a pedir(), mas sem reescrever o endereço (continuação de um redirecionamento)
function pedirBruto(url, opcoes) {
  const guarda = process.env.OBS_TESTE_COMPONENTES_BASE;
  if (!guarda) return pedir(url, opcoes);
  delete process.env.OBS_TESTE_COMPONENTES_BASE;
  try { return pedir(url, opcoes); } finally { process.env.OBS_TESTE_COMPONENTES_BASE = guarda; }
}

// ---------- versões ----------
// «v24.22.0», «2025.10.14», «6.7.24», «1.8.2» — compara número a número; um
// sufixo («-rc14») conta como menor que a versão sem sufixo.
function numeros(v) { return String(v || '').trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0); }
function temSufixo(v) { return /-/.test(String(v || '').trim().replace(/^v/i, '')); }
function cmpVersoes(a, b) {
  const pa = numeros(a); const pb = numeros(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (temSufixo(a) !== temSufixo(b)) return temSufixo(a) ? -1 : 1;
  return 0;
}
const versaoValida = (v) => /^v?\d+(\.\d+){1,3}(-[0-9A-Za-z.]+)?$/.test(String(v || '').trim());
const hoje = () => new Date().toISOString().slice(0, 10);

function lerJson(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } }
function temArquivo(p) { try { return fs.statSync(p).size > 0; } catch { return false; } }

class Componentes {
  // opcoes: { appDir, dataDir, extrator, transcritor, waLibDir, waVersaoPadrao }
  constructor(opcoes = {}) {
    this.appDir = opcoes.appDir;
    this.dataDir = opcoes.dataDir;
    this.extrator = opcoes.extrator || null;
    this.transcritor = opcoes.transcritor || null;
    this.waLibDir = opcoes.waLibDir || null;
    this.waVersaoPadrao = opcoes.waVersaoPadrao || '';
    this._cmd = new Map();     // comando → { em, texto }
    this._remoto = null;       // { em, itens: { id: { maisNova, extra } } } — o que veio da internet
    this.verificando = null;   // Promise em andamento (duas verificações não se atropelam)
  }

  // ---------- leitura local ----------
  _rodar(comando, args) {
    const chave = comando + ' ' + args.join(' ');
    const c = this._cmd.get(chave);
    if (c && Date.now() - c.em < CACHE_CMD_MS) return c.texto;
    let texto = '';
    try {
      const r = spawnSync(comando, args, { timeout: 4000, windowsHide: true, encoding: 'utf8' });
      if (!r.error) texto = String(r.stdout || '') + '\n' + String(r.stderr || '');
    } catch { /* não respondeu */ }
    this._cmd.set(chave, { em: Date.now(), texto });
    return texto;
  }
  _versaoPacote(raiz, nome) {
    const p = lerJson(path.join(raiz, 'node_modules', nome, 'package.json'));
    return p && typeof p.version === 'string' ? p.version : null;
  }
  _versaoLottie() {
    try {
      const m = /version\s*[=:]\s*"(\d+\.\d+\.\d+)"/.exec(fs.readFileSync(path.join(this.appDir, 'public', 'vendor', 'lottie.min.js'), 'utf8'));
      return m ? m[1] : null;
    } catch { return null; }
  }
  _nodeOrigem() {
    const portatil = path.join(this.appDir, 'node-portable');
    try { if (fs.realpathSync(process.execPath).startsWith(fs.realpathSync(portatil))) return 'portatil'; } catch { /* sem pasta portátil */ }
    return 'sistema';
  }

  // Cada componente com o que se sabe SEM internet. `remoto` (do último
  // verificar) completa com a versão mais nova e a situação.
  inventario() {
    const arq = `${process.platform}/${process.arch}`;
    const itens = [];
    // Node.js
    itens.push({ id: 'node', nome: 'Node.js (motor do programa)', categoria: 'motor', versao: process.versions.node, arquitetura: arq, origem: this._nodeOrigem(), acao: 'site' });
    // incluídos no ZIP
    for (const [id, nome, pacote] of [['ws', 'ws (WebSocket)', 'ws'], ['qrcode', 'qrcode-generator (QR codes)', 'qrcode-generator']]) {
      itens.push({ id, nome, categoria: 'incluso', versao: this._versaoPacote(this.appDir, pacote), arquitetura: null, origem: 'incluso', acao: 'programa' });
    }
    itens.push({ id: 'lottie', nome: 'lottie-web (animações)', categoria: 'incluso', versao: this._versaoLottie(), arquitetura: null, origem: 'incluso', acao: 'programa' });
    // opcionais, baixados sob demanda
    const yd = this.extrator ? this.extrator.estado() : null;
    itens.push({
      id: 'ytdlp', nome: 'yt-dlp (extrator da mídia direta)', categoria: 'opcional',
      versao: yd && yd.pronto ? (yd.versao || null) : null, arquitetura: yd && yd.arquivo ? yd.arquivo : arq,
      origem: yd && yd.pronto ? yd.origem : 'nao', acao: yd && yd.pronto ? (yd.origem === 'baixado' ? 'atualizar' : 'sistema') : null,
    });
    const tr = this.transcritor ? this.transcritor.estado() : null;
    const versoes = (this.transcritor && typeof this.transcritor.versoes === 'function') ? this.transcritor.versoes() : {};
    const cam = (this.transcritor && typeof this.transcritor.caminhos === 'function') ? this.transcritor.caminhos() : { motor: null, ffmpeg: null };
    const motorPronto = !!(tr && tr.motor && tr.motor.pronto);
    // Um motor baixado por uma versão anterior à 0.185 não tem a tag anotada:
    // o programa só baixava a versão fixada na URL — é ela, então.
    const tagFixada = this.transcritor && this.transcritor.urlMotor ? (/\/releases\/download\/([^/]+)\//.exec(this.transcritor.urlMotor) || [])[1] || null : null;
    const whisperVersao = motorPronto && tr.motor.origem === 'baixado' ? ((versoes.motor && versoes.motor.tag) || tagFixada) : null;
    itens.push({
      id: 'whisper', nome: 'whisper.cpp (transcrição)', categoria: 'opcional',
      versao: whisperVersao,
      arquitetura: arq, origem: motorPronto ? tr.motor.origem : 'nao',
      acao: motorPronto ? (tr.motor.origem === 'baixado' ? 'atualizar' : 'sistema') : null,
      nota: motorPronto && tr.motor.origem !== 'baixado' ? 'semVersao' : null,
    });
    const ffPronto = !!(tr && tr.ffmpeg && tr.ffmpeg.pronto);
    let ffVersao = null; let ffBaixadoEm = null;
    if (ffPronto && cam.ffmpeg) {
      const m = /ffmpeg version (\S+)/.exec(this._rodar(cam.ffmpeg.comando, ['-version'])); ffVersao = m ? m[1] : null;
      if (tr.ffmpeg.origem === 'baixado') {
        // a data do download: a anotada; sem anotação (download anterior à 0.185), a do arquivo
        ffBaixadoEm = (versoes.ffmpeg && versoes.ffmpeg.em) || null;
        if (!ffBaixadoEm) { try { ffBaixadoEm = fs.statSync(cam.ffmpeg.comando).mtime.toISOString(); } catch { /* fica sem data */ } }
      }
    }
    itens.push({
      id: 'ffmpeg', nome: 'ffmpeg (conversor de áudio/vídeo)', categoria: 'opcional',
      versao: ffVersao, arquitetura: arq, origem: ffPronto ? tr.ffmpeg.origem : 'nao',
      acao: ffPronto ? (tr.ffmpeg.origem === 'baixado' ? 'atualizar' : 'sistema') : null,
      baixadoEm: ffBaixadoEm,
    });
    const baileys = this.waLibDir ? this._versaoPacote(this.waLibDir, '@whiskeysockets/baileys') : null;
    itens.push({ id: 'baileys', nome: 'Biblioteca do WhatsApp (Baileys)', categoria: 'opcional', versao: baileys, arquitetura: null, origem: baileys ? 'baixado' : 'nao', acao: baileys ? 'atualizar' : null });
    // do sistema
    const curl = /curl (\S+)(?: \(([^)]+)\))?/.exec(this._rodar(process.platform === 'win32' ? 'curl.exe' : 'curl', ['--version']));
    itens.push({ id: 'curl', nome: 'curl (caminho de reserva)', categoria: 'sistema', versao: curl ? curl[1] : null, arquitetura: curl && curl[2] ? curl[2] : null, origem: curl ? 'sistema' : 'nao', acao: null });
    return itens;
  }

  // ---------- o que veio da internet ----------
  _arquivoRemoto() { return path.join(this.dataDir, ARQUIVO); }
  _carregarRemoto() {
    if (this._remoto === null) {
      // só a forma esperada entra; um arquivo estranho (editado à mão, truncado) é ignorado
      const j = lerJson(this._arquivoRemoto());
      const ok = j && typeof j === 'object' && !Array.isArray(j) && j.itens && typeof j.itens === 'object' && !Array.isArray(j.itens);
      this._remoto = ok ? { em: typeof j.em === 'string' ? j.em : null, itens: j.itens } : { em: null, itens: {} };
    }
    return this._remoto;
  }
  _salvarRemoto() {
    try { fs.mkdirSync(this.dataDir, { recursive: true }); fs.writeFileSync(this._arquivoRemoto(), JSON.stringify(this._remoto, null, 2) + '\n'); } catch { /* sem disco: fica só em memória */ }
  }

  // A situação de cada item, juntando o local (agora) com o remoto (último verificar)
  atual() {
    const remoto = this._carregarRemoto();
    const itens = this.inventario().map((it) => {
      const r = remoto.itens && remoto.itens[it.id] && typeof remoto.itens[it.id] === 'object' ? remoto.itens[it.id] : null;
      const saida = { ...it, maisNova: r ? r.maisNova || null : null, extra: r && r.extra && typeof r.extra === 'object' ? r.extra : null, estado: 'naoVerificado', avisar: false };
      if (it.origem === 'nao') { saida.estado = 'naoInstalado'; return saida; }
      if (!r) return saida;
      if (r.erro) { saida.estado = 'desconhecido'; return saida; }
      if (it.id === 'node' && r.extra && r.extra.semSuporte) {
        // a linha inteira acabou: o que vale é a LTS atual, não o último remendo da linha morta
        saida.estado = 'semSuporte'; saida.avisar = true; saida.maisNova = null;
        return saida;
      }
      if (it.id === 'ffmpeg') {
        // build rolante (o BtbN republica quase todo dia): só vale avisar quando o
        // download já tem mais de 60 dias em relação ao build publicado
        const pub = r.extra && r.extra.publicadoEm ? Date.parse(r.extra.publicadoEm) : NaN;
        const baix = it.baixadoEm ? Date.parse(it.baixadoEm) : NaN;
        if (it.origem !== 'baixado') { saida.estado = 'ok'; return saida; }
        if (!Number.isFinite(pub) || !Number.isFinite(baix)) { saida.estado = 'desconhecido'; return saida; }
        saida.estado = pub > baix + 60 * 24 * 3600 * 1000 ? 'nova' : 'ok';
        saida.maisNova = saida.estado === 'nova' ? new Date(pub).toISOString().slice(0, 10) : null;
        return saida;
      }
      if (it.id === 'whisper' && r.extra && r.extra.semZip) {
        // existe tag mais nova, mas sem o zip pronto para este sistema: fica como está
        saida.estado = 'ok'; saida.nota = 'semZip'; saida.maisNova = null;
        return saida;
      }
      if (!saida.maisNova || !it.versao) { saida.estado = 'desconhecido'; return saida; }
      saida.estado = cmpVersoes(saida.maisNova, it.versao) > 0 ? 'nova' : 'ok';
      // o painel avisa do que importa de verdade: motor, extrator (os sites mudam) e a biblioteca do WhatsApp
      saida.avisar = saida.estado === 'nova' && ['node', 'ytdlp', 'baileys'].includes(it.id);
      return saida;
    });
    return { em: remoto.em, itens };
  }

  avisos() {
    return this.atual().itens.filter((it) => it.avisar).map((it) => ({
      id: it.id, nome: it.nome, versao: it.versao, maisNova: it.maisNova, estado: it.estado,
      ltsAtual: it.extra && it.extra.ltsAtual ? it.extra.ltsAtual : null,
    }));
  }

  // Consulta os desenvolvedores de cada componente (uma vez por dia, ou a
  // pedido). Falha de um não derruba os outros; o que falhou fica «desconhecido».
  verificar() {
    if (this.verificando) return this.verificando;
    this.verificando = this._verificar().finally(() => { this.verificando = null; });
    return this.verificando;
  }
  async _verificar() {
    const local = this.inventario();
    const resultado = {};
    const tarefas = [];
    const anota = (id, fn) => tarefas.push(fn().then((r) => { resultado[id] = r; }).catch((err) => { resultado[id] = { maisNova: null, erro: String(err && err.message || err).slice(0, 120) }; }));
    // Node.js: a mais nova da mesma linha + calendário de suporte
    anota('node', async () => {
      const major = numeros(process.versions.node)[0];
      const [sums, agenda] = await Promise.all([
        pedir(`${URLS.nodeDist}latest-v${major}.x/SHASUMS256.txt`),
        pedir(URLS.nodeSchedule).catch(() => null),
      ]);
      const m = sums.status === 200 ? /node-v(\d+\.\d+\.\d+)/.exec(sums.texto) : null;
      const extra = {};
      if (agenda && agenda.status === 200) {
        let cal = null; try { cal = JSON.parse(agenda.texto); } catch { cal = null; }
        if (cal) {
          const linha = cal['v' + major];
          const h = hoje();
          if (linha && linha.end) { extra.fimSuporte = linha.end; extra.semSuporte = linha.end < h; }
          // a LTS atual: a linha mais alta já em LTS e ainda com suporte
          let lts = null;
          for (const [k, v] of Object.entries(cal)) {
            const n = Number(String(k).replace(/^v/, ''));
            if (!Number.isFinite(n) || !v || !v.lts || !v.end) continue;
            if (v.lts <= h && v.end > h && (lts === null || n > lts)) lts = n;
          }
          if (lts !== null) extra.ltsAtual = 'v' + lts;
        }
      }
      if (!m && !Object.keys(extra).length) throw new Error('nodejs.org respondeu ' + sums.status);
      return { maisNova: m ? m[1] : null, extra };
    });
    // incluídos no ZIP: o registro do npm («latest» é pequeno)
    for (const [id, pacote] of [['ws', 'ws'], ['qrcode', 'qrcode-generator'], ['lottie', 'lottie-web']]) {
      anota(id, async () => {
        const r = await pedir(`${URLS.npm}${pacote}/latest`);
        if (r.status !== 200) throw new Error('npm respondeu ' + r.status);
        const v = JSON.parse(r.texto).version;
        if (!versaoValida(v)) throw new Error('versão estranha');
        return { maisNova: v, extra: null };
      });
    }
    // yt-dlp e whisper.cpp: o «latest» do GitHub redireciona para a tag
    const tagDoRedirecionamento = async (url) => {
      const r = await pedir(url, { seguir: 0 });
      const loc = String(r.headers && r.headers.location || '');
      const m = /\/releases\/download\/([^/]+)\//.exec(loc);
      if (!m) throw new Error('GitHub respondeu ' + r.status);
      return decodeURIComponent(m[1]);
    };
    if (local.find((i) => i.id === 'ytdlp').origem !== 'nao') {
      anota('ytdlp', async () => ({ maisNova: await tagDoRedirecionamento(URLS.ytdlpLatest), extra: null }));
    }
    const whisperLocal = local.find((i) => i.id === 'whisper');
    if (whisperLocal.origem === 'baixado' && this.transcritor && this.transcritor.urlMotor) {
      anota('whisper', async () => {
        const tag = await tagDoRedirecionamento(URLS.whisperLatest);
        if (!TAG_WHISPER.test(tag)) throw new Error('tag estranha');
        // O redirecionamento diz a tag, não que o zip exista para ela (o
        // whisper.cpp já deixou de publicar o zip do Windows em versões
        // novas): confere o arquivo desta arquitetura antes de oferecer
        const candidata = this.transcritor.urlMotor.replace(/\/releases\/download\/v\d+\.\d+\.\d+\//, `/releases/download/${tag}/`);
        const r = await pedir(candidata, { metodo: 'HEAD', seguir: 4 });
        if (r.status !== 200) return { maisNova: null, extra: { semZip: tag } };
        return { maisNova: tag, extra: null };
      });
    }
    // ffmpeg (build rolante): a data do arquivo publicado
    const ffLocal = local.find((i) => i.id === 'ffmpeg');
    if (ffLocal.origem === 'baixado' && this.transcritor && this.transcritor.urlFfmpeg) {
      anota('ffmpeg', async () => {
        const r = await pedir(this.transcritor.urlFfmpeg, { metodo: 'HEAD', seguir: 5 });
        const lm = r.headers && r.headers['last-modified'];
        const t = lm ? Date.parse(lm) : NaN;
        if (!Number.isFinite(t)) throw new Error('sem data de publicação');
        return { maisNova: null, extra: { publicadoEm: new Date(t).toISOString() } };
      });
    }
    // Baileys: só a mesma linha maior (o packument abreviado lista as versões)
    const bLocal = local.find((i) => i.id === 'baileys');
    if (bLocal.origem !== 'nao' && bLocal.versao) {
      anota('baileys', async () => {
        const r = await pedir(`${URLS.npm}@whiskeysockets%2Fbaileys`, { headers: { Accept: 'application/vnd.npm.install-v1+json' } });
        if (r.status !== 200) throw new Error('npm respondeu ' + r.status);
        // Fora: pré-lançamentos («-rc») e versões marcadas como «deprecated» no
        // npm (há uma 6.17.16 publicada por engano, com alerta de segurança)
        const versoes = Object.entries(JSON.parse(r.texto).versions || {})
          .filter(([v, meta]) => versaoValida(v) && !temSufixo(v) && !(meta && meta.deprecated))
          .map(([v]) => v);
        // a «mesma linha» é a linha testada com o programa (a instalada pode ser outra, à mão)
        const major = numeros(this.waVersaoPadrao || bLocal.versao)[0];
        let mesma = null; let maior = null;
        for (const v of versoes) {
          if (numeros(v)[0] === major) { if (!mesma || cmpVersoes(v, mesma) > 0) mesma = v; }
          else if (numeros(v)[0] > major) { if (!maior || cmpVersoes(v, maior) > 0) maior = v; }
        }
        return { maisNova: mesma, extra: maior ? { majorNovo: maior } : null };
      });
    }
    await Promise.all(tarefas);
    this._remoto = { em: new Date().toISOString(), itens: resultado };
    this._salvarRemoto();
    return this.atual();
  }
}

module.exports = { Componentes, cmpVersoes, versaoValida, URLS };
