// Conector de chat (danmaku) da Bilibili — EXPERIMENTAL.
// Usa o WebSocket publico das salas de live da Bilibili. Sem login, a Bilibili
// pode abreviar os nomes dos usuarios ou recusar a conexao; um cookie SESSDATA
// opcional melhora o resultado.
const WebSocket = require('ws');
const zlib = require('zlib');

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Referer': 'https://live.bilibili.com/',
  'Accept': 'application/json',
};

// 🔒 v0.127.1: teto do pacote descompactado — um frame "bomba" não pode
// estourar a memória (o chat real fica na casa dos KB)
const LIMITE_INFLADO = 4 * 1024 * 1024;

const OP_HEARTBEAT = 2;
const OP_MESSAGE = 5;
const OP_AUTH = 7;
const OP_AUTH_REPLY = 8;

function packet(op, bodyStr) {
  const body = Buffer.from(bodyStr, 'utf8');
  const header = Buffer.alloc(16);
  header.writeUInt32BE(16 + body.length, 0);
  header.writeUInt16BE(16, 4);
  header.writeUInt16BE(1, 6);
  header.writeUInt32BE(op, 8);
  header.writeUInt32BE(1, 12);
  return Buffer.concat([header, body]);
}

function* parsePackets(buffer) {
  let offset = 0;
  while (offset + 16 <= buffer.length) {
    const packLen = buffer.readUInt32BE(offset);
    if (packLen < 16 || offset + packLen > buffer.length) return;
    const protoVer = buffer.readUInt16BE(offset + 6);
    const op = buffer.readUInt32BE(offset + 8);
    const body = buffer.subarray(offset + 16, offset + packLen);
    if (op === OP_MESSAGE && (protoVer === 2 || protoVer === 3)) {
      let dentro = null;
      try {
        dentro = protoVer === 2
          ? zlib.inflateSync(body, { maxOutputLength: LIMITE_INFLADO })
          : zlib.brotliDecompressSync(body, { maxOutputLength: LIMITE_INFLADO });
      } catch { dentro = null; /* passou do teto ou veio corrompido: descarta o frame */ }
      if (dentro) yield* parsePackets(dentro);
    } else {
      yield { op, body };
    }
    offset += packLen;
  }
}

class BilibiliConnector {
  constructor(roomInput, handlers, options = {}) {
    this.roomInput = roomInput.trim();
    this.handlers = handlers;
    // Quebra de linha num cookie viraria outro cabeçalho na requisição
    this.cookie = String(options.cookie || '').replace(/[\r\n]/g, '').trim().slice(0, 4000);
    this.ws = null;
    this.stopped = false;
    this.heartbeat = null;
    this.retryMs = 3000;
    this.roomId = null;
    this.uid = 0;
  }

  async start() {
    this.handlers.onStatus('connecting', 'Buscando a sala na Bilibili...');
    const idMatch = this.roomInput.match(/live\.bilibili\.com\/(\d+)/) || this.roomInput.match(/^(\d+)$/);
    if (!idMatch) {
      this.handlers.onStatus('error', 'Informe o número da sala da Bilibili (ex.: 21452505) ou o link da live.');
      return;
    }
    try {
      await this.resolveRoom(Number(idMatch[1]));
    } catch (err) {
      this.handlers.onStatus('error', err.message);
      return;
    }
    if (this.stopped) return;
    this.open();
  }

  headers() {
    const headers = { ...BROWSER_HEADERS };
    if (this.cookie) headers.Cookie = this.cookie.includes('=') ? this.cookie : `SESSDATA=${this.cookie}`;
    return headers;
  }

  async resolveRoom(shortId) {
    const initRes = await fetch(`https://api.live.bilibili.com/room/v1/Room/room_init?id=${shortId}`, { headers: this.headers(), signal: AbortSignal.timeout(15000) });
    if (!initRes.ok) throw new Error(`A Bilibili respondeu com erro ${initRes.status} ao buscar a sala ${shortId}.`);
    const init = await initRes.json();
    if (init.code !== 0 || !init.data?.room_id) throw new Error(`Sala ${shortId} não encontrada na Bilibili.`);
    this.roomId = init.data.room_id;

    if (this.cookie) {
      const uidMatch = this.cookie.match(/DedeUserID=(\d+)/);
      if (uidMatch) this.uid = Number(uidMatch[1]);
    }

    const danmuRes = await fetch(
      `https://api.live.bilibili.com/xlive/web-room/v1/index/getDanmuInfo?id=${this.roomId}&type=0`,
      { headers: this.headers(), signal: AbortSignal.timeout(15000) }
    );
    if (!danmuRes.ok) throw new Error(`A Bilibili respondeu com erro ${danmuRes.status} ao pedir o acesso ao chat da sala.`);
    const danmu = await danmuRes.json();
    if (danmu.code !== 0 || !danmu.data?.token) {
      throw new Error(
        'A Bilibili recusou a conexão anônima (controle de risco deles). ' +
        'Espere alguns minutos e tente conectar de novo.'
      );
    }
    this.token = danmu.data.token;
    const host = danmu.data.host_list?.[0];
    this.wsUrl = host ? `wss://${host.host}:${host.wss_port}/sub` : 'wss://broadcastlv.chat.bilibili.com:443/sub';
  }

  open() {
    if (this.stopped) return;
    const ws = new WebSocket(this.wsUrl, { headers: { Origin: 'https://live.bilibili.com' } });
    this.ws = ws;

    ws.on('open', () => {
      ws.send(packet(OP_AUTH, JSON.stringify({
        uid: this.uid,
        roomid: this.roomId,
        protover: 3,
        platform: 'web',
        type: 2,
        key: this.token,
      })));
    });

    ws.on('message', (raw) => {
      let buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
      try {
        for (const { op, body } of parsePackets(buffer)) {
          if (op === OP_AUTH_REPLY) {
            this.retryMs = 3000;
            this.handlers.onStatus('connected', `Lendo o chat da sala ${this.roomId} (experimental)`);
            this.fetchHistory();
            if (this.heartbeat) clearInterval(this.heartbeat); // 🔒 v0.127.1: nunca dois relógios
            this.heartbeat = setInterval(() => {
              try { ws.send(packet(OP_HEARTBEAT, '')); } catch {}
            }, 30000);
            try { ws.send(packet(OP_HEARTBEAT, '')); } catch {}
          } else if (op === OP_MESSAGE) {
            this.handleMessage(body);
          }
        }
      } catch { /* pacote malformado: ignora */ }
    });

    ws.on('close', () => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      // Só o socket ATUAL manda reconectar (um antigo caindo depois não pode
      // abrir uma segunda conexão em paralelo)
      if (this.ws !== ws) return;
      this.scheduleReconnect();
    });
    ws.on('error', () => { /* o evento close cuida da reconexao */ });
  }

  scheduleReconnect() {
    if (this.stopped) return;
    this.handlers.onStatus('connecting', 'Conexão caiu, reconectando...');
    setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  handleMessage(body) {
    let data;
    try { data = JSON.parse(body.toString('utf8')); } catch { return; }
    const cmd = String(data.cmd || '');

    if (cmd.startsWith('DANMU_MSG')) {
      const info = data.info || [];
      const text = info[1];
      const user = info[2] || [];
      if (typeof text !== 'string') return;
      this.emit(user[1] || 'anônimo', text, [], null, { login: user[0] ? String(user[0]) : null });
    } else if (cmd === 'SUPER_CHAT_MESSAGE') {
      const d = data.data || {};
      const amount = `CN¥ ${d.price || ''}`;
      this.emit(d.user_info?.uname || 'anônimo', d.message || '', [`superchat ${amount}`], {
        amount,
        color: d.background_bottom_color || '#00a1d6',
        headerColor: d.background_color || '#00a1d6',
        textColor: '#000000',
      });
    }
  }

  emit(author, text, badges = [], superchat = null, extra = {}) {
    const ts = extra.timestamp || Date.now();
    this.handlers.onMessage({
      platform: 'bilibili',
      channel: String(this.roomId),
      id: extra.id || `bili-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author,
      authorLogin: extra.login || null,
      authorColor: null,
      avatar: null,
      badges,
      superchat,
      runs: [{ type: 'text', text }],
      timestamp: ts,
    });
  }

  // Recupera as ultimas mensagens que a propria Bilibili disponibiliza
  // (poucas — e o limite publico deles), enviadas enquanto estavamos fora.
  async fetchHistory() {
    if (this.handlers.recoverEnabled && !this.handlers.recoverEnabled()) return;
    try {
      const res = await fetch(
        `https://api.live.bilibili.com/xlive/web-room/v1/dM/gethistory?roomid=${this.roomId}`,
        { headers: this.headers(), signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return;
      const data = await res.json();
      const list = data?.data?.room || [];
      for (const item of list) {
        if (this.stopped) return;
        if (!item || typeof item.text !== 'string') continue;
        // check_info.ts vem em segundos; timeline vem no fuso da China (UTC+8)
        let ts = Number(item.check_info?.ts) || 0;
        if (ts && ts < 1e12) ts *= 1000;
        if (!ts) ts = Date.parse(String(item.timeline || '').replace(' ', 'T') + '+08:00') || 0;
        // (antes havia aqui um "só o que for mais novo que a última emitida",
        // que descartava o histórico inteiro depois de uma reconexão; o id
        // estável montado logo abaixo já impede repetição)
        if (!ts) continue;
        const uid = item.uid ? String(item.uid) : null;
        // Sem id proprio no historico: um id estavel (tempo + autor + texto)
        // evita duplicar caso o historico seja consultado de novo
        let hash = 0;
        for (const ch of `${item.nickname}|${item.text}`) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0;
        this.emit(item.nickname || 'anônimo', item.text, [], null, { id: `bili-h-${ts}-${hash}`, timestamp: ts, login: uid });
      }
    } catch { /* historico e um extra: sem ele, segue so o tempo real */ }
  }

  stop() {
    this.stopped = true;
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.ws) try { this.ws.close(); } catch {}
  }
}

module.exports = { BilibiliConnector };
