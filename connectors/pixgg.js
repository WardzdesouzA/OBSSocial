// 💚 v0.175: conector da PixGG — NÃO OFICIAL (Labs), pelo canal do widget.
//
// A PixGG não tem API pública. O widget de alertas dela (a URL que o
// streamer coloca na fonte de navegador do OBS) assina um canal PÚBLICO no
// Pusher — o nome do canal é a chave da API do streamer, sem autenticação
// extra — e recebe por ele cada doação (evento «messages») e os comandos do
// painel da PixGG («pause», «skip-alert», «clear-queue»). Este conector
// assina o MESMO canal, com uma conexão só, e apenas lê: não chama endpoint
// nenhum da PixGG, não marca nada como lido, não dispara nada. É o mesmo
// tráfego de um widget aberto.
//
// Por ser mecanismo interno deles, pode mudar sem aviso — o streamer liga
// isto no Labs depois de ler os avisos, e o OBS Social pediu permissão à
// PixGG por e-mail (docs/estudo-livepix-pixgg.md). Se ela responder com uma
// API, este arquivo é trocado e o painel não muda.
const WebSocket = require('ws');
const https = require('https');
const http = require('http');

// A chave pública do app do Pusher que o widget usa, e o cluster
const PUSHER_KEY = '787e05d557a8480c3ee7';
const PUSHER_CLUSTER = 'mt1';
// Gancho de teste: um Pusher de mentira no lugar do real
const PUSHER_BASE = process.env.OBS_TESTE_PIXGG_PUSHER || `wss://ws-${PUSHER_CLUSTER}.pusher.com`;
const CHAVE_OK = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AUDIO_MAX = 8 * 1024 * 1024;

// A chave pode vir como a URL inteira do widget (api.pixgg.com/?apikey=...)
function extrairChave(texto) {
  const s = String(texto || '').trim();
  const m = s.match(/apikey=([0-9a-f-]{36})/i);
  const chave = (m ? m[1] : s).toLowerCase();
  return CHAVE_OK.test(chave) ? chave : null;
}

// «7.5» / «7,50» / 750? A PixGG manda o total em reais; aceita número ou texto
function valorReais(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s) return 0;
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : 0;
}
const valorTexto = (reais, moeda) => (!moeda || moeda === 'BRL' ? 'R$ ' + reais.toFixed(2).replace('.', ',') : `${moeda} ${reais.toFixed(2)}`);

// Baixa o áudio da mensagem (o link público que a PixGG entrega) para a
// quarentena local de mídia — só https, até 8 MB
function baixarAudio(url, salvarMidia) {
  return new Promise((resolve) => {
    if (typeof salvarMidia !== 'function' || !/^https?:\/\//i.test(String(url || ''))) return resolve(null);
    let u; try { u = new URL(url); } catch { return resolve(null); }
    if (u.protocol === 'http:' && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return resolve(null); // fora daqui, só https
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const tipo = String(res.headers['content-type'] || '').toLowerCase();
      const daUrl = ((u.pathname.match(/\.(mp3|ogg|wav|m4a|webm|opus)$/i) || [])[1] || '').toLowerCase();
      const ext = tipo.includes('mpeg') || tipo.includes('mp3') ? 'mp3' : tipo.includes('ogg') ? 'ogg' : tipo.includes('wav') ? 'wav' : tipo.includes('mp4') || tipo.includes('m4a') ? 'm4a' : (daUrl || 'mp3');
      const pedacos = []; let total = 0;
      res.on('data', (c) => { total += c.length; if (total <= AUDIO_MAX) pedacos.push(c); else res.destroy(); });
      res.on('end', () => {
        if (total > AUDIO_MAX || !total) return resolve(null);
        const salvo = salvarMidia(Buffer.concat(pedacos), ext, 'mensagem-pixgg.' + ext);
        resolve(salvo ? { tipo: 'audio', url: salvo, nome: 'Mensagem de voz (PixGG)' } : null);
      });
      res.on('error', () => resolve(null));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
  });
}

class PixGGConnector {
  constructor(channel, handlers, options = {}) {
    this.chave = extrairChave(options.token || channel);
    this.handlers = handlers;
    this.vistos = options.vistos instanceof Set ? options.vistos : new Set();
    this.salvarVistos = typeof options.salvarVistos === 'function' ? options.salvarVistos : () => {};
    this.ws = null;
    this.stopped = false;
    this.retryMs = 2000;
    this.dados = { pausado: null, pulos: 0, limpezas: 0, eventos: 0, ultimoEventoEm: null };
  }

  start() {
    if (!this.chave) {
      this.handlers.onStatus('error', 'Cole a chave da API do widget da PixGG (ou a URL inteira do widget, api.pixgg.com/?apikey=...).');
      return;
    }
    this.handlers.onStatus('connecting', 'Ligando no canal do widget da PixGG (não oficial)...');
    this.open();
  }

  open() {
    if (this.stopped) return;
    const url = `${PUSHER_BASE}/app/${PUSHER_KEY}?protocol=7&client=js&version=7.2.0&flash=false`;
    const ws = new WebSocket(url, { headers: { Origin: 'https://api.pixgg.com' } });
    this.ws = ws;
    ws.on('message', (raw) => {
      try { this.tratar(raw, ws); } catch (err) {
        if (!this.avisouPacote) { this.avisouPacote = true; console.log('  ⚠️ PixGG: pacote fora do padrão ignorado (' + String(err && err.message || err).slice(0, 80) + ').'); }
      }
    });
    ws.on('close', () => { if (this.ws === ws) this.scheduleReconnect(); });
    ws.on('error', () => { /* o close cuida da reconexão */ });
  }

  tratar(raw, ws) {
    let p; try { p = JSON.parse(raw.toString()); } catch { return; }
    if (!p || typeof p !== 'object') return;
    if (p.event === 'pusher:connection_established') {
      ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: this.chave } }));
      return;
    }
    if (p.event === 'pusher_internal:subscription_succeeded') {
      this.retryMs = 2000;
      this.handlers.onStatus('connected', 'Escutando o canal do widget da PixGG (não oficial)');
      this.emitirDados();
      return;
    }
    if (p.event === 'pusher:ping') { ws.send(JSON.stringify({ event: 'pusher:pong', data: {} })); return; }
    if (p.event === 'pusher:error') {
      const msg = (p.data && p.data.message) || 'erro do Pusher';
      this.handlers.onStatus('error', `O canal do widget da PixGG recusou a conexão (${String(msg).slice(0, 120)}). Nova tentativa sozinha em 30s.`, { insiste: true });
      return;
    }
    let dados = p.data;
    if (typeof dados === 'string') { try { dados = JSON.parse(dados); } catch { dados = {}; } }
    if (!dados || typeof dados !== 'object') dados = {};
    this.dados.eventos += 1;
    this.dados.ultimoEventoEm = Date.now();
    if (p.event === 'messages') { this.doacao(dados); return; }
    if (p.event === 'pause') { this.dados.pausado = dados.pause === true; this.emitirDados(); return; }
    if (p.event === 'skip-alert') { this.dados.pulos += 1; this.emitirDados(); return; }
    if (p.event === 'clear-queue') { this.dados.limpezas += 1; this.emitirDados(); return; }
    this.emitirDados();
  }

  emitirDados() {
    if (this.handlers.onDados) this.handlers.onDados('pixgg', { ...this.dados, atualizadoEm: Date.now() });
  }

  // O evento «messages» é a doação. Ele chega de novo quando o streamer manda
  // «tocar» pelo painel da PixGG (ForceToPlay): o id da transação impede repetir.
  doacao(d) {
    const tx = String(d.TransactionId || '').trim();
    const nome = String(d.DonatorNickname || '').trim().slice(0, 60) || 'Anônimo';
    const texto = String(d.DonatorMessage || '').slice(0, 500);
    const reais = valorReais(d.TotalAmount);
    const chave = tx || `${nome}|${reais}|${texto}|${String(d.Date || '').slice(0, 16)}`;
    if (this.vistos.has(chave)) return;
    this.vistos.add(chave);
    this.salvarVistos(this.vistos);
    const moeda = String(d.Currency || 'BRL').toUpperCase();
    const valor = valorTexto(reais, 'BRL');
    const badges = ['pixgg ' + valor];
    const original = d.OriginalAmount != null && moeda !== 'BRL' ? valorTexto(valorReais(d.OriginalAmount), moeda) : null;
    const runs = [{ type: 'text', text: texto }];
    const video = typeof d.YouTubeVideo === 'string' && /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(d.YouTubeVideo) ? d.YouTubeVideo : null;
    if (video) runs.push({ type: 'text', text: (texto ? ' ' : '') + '▶️ ' + video });
    const mensagem = {
      platform: 'pixgg',
      channel: 'pixgg',
      id: 'pg-' + (tx || Buffer.from(chave).toString('base64url').slice(0, 24)),
      author: nome,
      authorLogin: nome.toLowerCase(),
      authorColor: null,
      avatar: null,
      badges,
      superchat: { amount: valor, color: '#10b981', headerColor: '#047857', textColor: '#ffffff' },
      runs,
      timestamp: Date.parse(d.Date) || Date.now(),
      pixgg: {
        transactionId: tx || null, moeda, original, video,
        audioDuracao: Number(d.AudioDuration) || null,
        sobDemanda: Number(d.PlayOnDemand) === 1, forcado: d.ForceToPlay === true, mostrarAlerta: d.showAlert !== false,
      },
    };
    const audio = typeof d.AWSPublicLink === 'string' ? d.AWSPublicLink : null;
    if (audio) {
      baixarAudio(audio, this.handlers.salvarMidia).then((midia) => {
        if (this.stopped) return;
        if (midia) { if (mensagem.pixgg.audioDuracao) midia.duracao = mensagem.pixgg.audioDuracao; mensagem.midia = midia; }
        this.handlers.onMessage(mensagem);
      });
      return;
    }
    this.handlers.onMessage(mensagem);
  }

  scheduleReconnect() {
    if (this.stopped) return;
    this.handlers.onStatus('connecting', 'A conexão com o canal do widget da PixGG caiu, reconectando...');
    setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  stop() {
    this.stopped = true;
    if (this.ws) try { this.ws.close(); } catch {}
  }
}

module.exports = { PixGGConnector, extrairChave, PUSHER_KEY, PUSHER_CLUSTER };
