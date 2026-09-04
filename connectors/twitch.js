// Conector de chat da Twitch.
// Usa a conexao IRC anonima (justinfan) via WebSocket — nao precisa de login nem API key.
const WebSocket = require('ws');

const IRC_URL = 'wss://irc-ws.chat.twitch.tv:443';

// ---------------------------------------------------------------------------
// 🏷️ Catálogo de distintivos da Twitch
//
// O chat manda só "moderator/1", "subscriber/12", "bits/1000"... A imagem e o
// nome de cada um vêm da mesma consulta pública que o site da Twitch usa (sem
// login). Buscamos uma vez por canal e guardamos por 1 hora: são os selos
// globais (moderador, VIP, Prime, Turbo, bits, presentes...) MAIS os do canal
// (as artes próprias de cada nível de assinatura).
const TWITCH_CLIENT_ID_PUBLICO = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const BADGES_QUERY = `query Selos($login: String!) {
  badges { setID version title image1x: imageURL(size: NORMAL) image2x: imageURL(size: DOUBLE) }
  user(login: $login) {
    broadcastBadges { setID version title image1x: imageURL(size: NORMAL) image2x: imageURL(size: DOUBLE) }
  }
}`;

const catalogoSelos = new Map(); // canal -> { em, mapa }
const buscandoSelos = new Map();

async function catalogoDeSelos(canal, clientId) {
  const guardado = catalogoSelos.get(canal);
  if (guardado && Date.now() - guardado.em < 60 * 60 * 1000) return guardado.mapa;
  if (buscandoSelos.has(canal)) return buscandoSelos.get(canal);
  const promessa = (async () => {
    const mapa = new Map();
    try {
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': clientId || TWITCH_CLIENT_ID_PUBLICO,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({ query: BADGES_QUERY, variables: { login: canal } }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        const bloco = data?.data || {};
        // Os do canal entram DEPOIS para sobrescrever os globais do mesmo nível
        for (const lista of [bloco.badges, bloco.user?.broadcastBadges]) {
          for (const b of lista || []) {
            if (!b?.setID) continue;
            mapa.set(`${b.setID}/${b.version}`, {
              titulo: b.title || b.setID,
              img: typeof b.image2x === 'string' && b.image2x.startsWith('https://') ? b.image2x : null,
            });
          }
        }
      }
    } catch { /* sem catálogo: os selos aparecem só com o nome */ }
    catalogoSelos.set(canal, { em: Date.now(), mapa });
    return mapa;
  })();
  buscandoSelos.set(canal, promessa);
  try { return await promessa; } finally { buscandoSelos.delete(canal); }
}

// Cargos que o painel já desenha bonito por conta própria
const CARGOS_TWITCH = {
  broadcaster: 'dono',
  moderator: 'mod',
  vip: 'vip',
  subscriber: 'sub',
  founder: 'founder',
  partner: 'verificado',
};

function parseTags(raw) {
  const tags = {};
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) { tags[part] = ''; continue; }
    const key = part.slice(0, eq);
    const value = part.slice(eq + 1)
      .replace(/\\s/g, ' ')
      .replace(/\\:/g, ';')
      .replace(/\\\\/g, '\\');
    tags[key] = value;
  }
  return tags;
}

// A tag "emotes" da Twitch usa offsets em code points, nao em unidades UTF-16.
function buildRuns(text, emotesTag) {
  const chars = Array.from(text);
  if (!emotesTag) return [{ type: 'text', text }];
  const spots = [];
  for (const group of emotesTag.split('/')) {
    const [id, ranges] = group.split(':');
    if (!id || !ranges) continue;
    for (const range of ranges.split(',')) {
      const [start, end] = range.split('-').map(Number);
      if (Number.isFinite(start) && Number.isFinite(end)) spots.push({ id, start, end });
    }
  }
  if (!spots.length) return [{ type: 'text', text }];
  spots.sort((a, b) => a.start - b.start);
  const runs = [];
  let cursor = 0;
  for (const spot of spots) {
    if (spot.start > cursor) runs.push({ type: 'text', text: chars.slice(cursor, spot.start).join('') });
    const name = chars.slice(spot.start, spot.end + 1).join('');
    runs.push({
      type: 'emote',
      alt: name,
      url: `https://static-cdn.jtvnw.net/emoticons/v2/${spot.id}/default/dark/2.0`,
    });
    cursor = spot.end + 1;
  }
  if (cursor < chars.length) runs.push({ type: 'text', text: chars.slice(cursor).join('') });
  return runs;
}

// Id curto e sempre igual para o mesmo texto (para histórico sem id próprio)
function idEstavel(texto) {
  let hash = 0;
  for (const ch of String(texto)) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0;
  return hash.toString(36);
}

class TwitchConnector {
  constructor(channel, handlers) {
    // O nome vai dentro de um comando do chat (JOIN #canal), que é um
    // protocolo de linhas: quebra de linha ali viraria outro comando.
    this.channel = channel.trim().toLowerCase()
      .replace(/^#/, '').replace(/^@/, '')
      .replace(/[^a-z0-9_]/g, '')
      .slice(0, 40);
    this.handlers = handlers;
    this.ws = null;
    this.stopped = false;
    this.retryMs = 2000;
    this.selos = new Map(); // catálogo de distintivos deste canal
  }

  async carregarSelos() {
    try {
      const clientId = this.handlers.twitchClientId ? await this.handlers.twitchClientId() : null;
      this.selos = await catalogoDeSelos(this.channel, clientId);
    } catch { /* sem catálogo, os selos aparecem só com o nome */ }
  }

  start() {
    this.handlers.onStatus('connecting', `Conectando ao chat de ${this.channel}...`);
    this.open();
  }

  open() {
    if (this.stopped) return;
    const ws = new WebSocket(IRC_URL);
    this.ws = ws;

    ws.on('open', () => {
      // "commands" traz os avisos de moderação (CLEARMSG / CLEARCHAT)
      ws.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      const nick = 'justinfan' + Math.floor(10000 + Math.random() * 80000);
      ws.send(`NICK ${nick}`);
      ws.send(`JOIN #${this.channel}`);
    });

    ws.on('message', (data) => {
      for (const line of data.toString().split('\r\n')) {
        if (line) this.handleLine(line);
      }
    });

    // Só o socket ATUAL manda reconectar: um socket antigo caindo depois
    // não pode disparar uma segunda conexão em paralelo
    ws.on('close', () => { if (this.ws === ws) this.scheduleReconnect(); });
    ws.on('error', () => { /* o evento close cuida da reconexao */ });
  }

  scheduleReconnect() {
    if (this.stopped) return;
    this.handlers.onStatus('connecting', 'Conexão caiu, reconectando...');
    setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  // Recupera mensagens enviadas enquanto estavamos fora do ar, pelo servico
  // publico recent-messages (o mesmo usado por apps como o Chatterino).
  // Sem login: so o nome do canal e consultado. As linhas vem no formato IRC
  // original, entao passam pelo mesmo parser do tempo real.
  async fetchHistory() {
    if (this.handlers.recoverEnabled && !this.handlers.recoverEnabled()) return;
    try {
      const res = await fetch(
        `https://recent-messages.robotty.de/api/v2/recent-messages/${encodeURIComponent(this.channel)}?limit=300&hide_moderation_messages=true`,
        { signal: AbortSignal.timeout(15000) }
      );
      if (!res.ok) return;
      const data = await res.json();
      const lines = Array.isArray(data?.messages) ? data.messages : [];
      for (const line of lines) {
        if (this.stopped) return;
        // 🔒 v0.127.1: só linhas que SÃO um PRIVMSG (não basta conter a palavra)
        if (typeof line === 'string' && /^(@\S+ )?:\S+ PRIVMSG /.test(line)) this.handleLine(line, true);
      }
    } catch { /* historico e um extra: sem ele, segue so o tempo real */ }
  }

  handleLine(line, fromHistory = false) {
    if (line.startsWith('PING')) {
      this.ws.send('PONG :tmi.twitch.tv');
      return;
    }

    let tags = {};
    let rest = line;
    if (rest.startsWith('@')) {
      const space = rest.indexOf(' ');
      tags = parseTags(rest.slice(1, space));
      rest = rest.slice(space + 1);
    }
    // 🔒 v0.127.1: o histórico vem de um serviço de terceiros — os cargos
    // com poder (dono, mod, VIP, fundador, assinante) só valem ao vivo, direto
    // da Twitch; do histórico entra a mensagem, sem privilégio
    if (fromHistory) {
      tags.badges = String(tags.badges || '').split(',')
        .filter((b) => b && !/^(broadcaster|moderator|vip|founder|subscriber)\//.test(b)).join(',');
      if (tags.mod === '1') tags.mod = '0';
    }

    if (/\sJOIN\s/.test(rest) && rest.includes('justinfan')) {
      this.retryMs = 2000;
      this.handlers.onStatus('connected', `Lendo o chat de ${this.channel}`);
      this.carregarSelos().then(() => this.fetchHistory());
      return;
    }

    // 🗑️ Moderação: sem isto, o que o mod apagou continuava na tela da live.
    if (this.handlers.onRemove) {
      // CLEARMSG: uma mensagem específica foi apagada
      if (/\sCLEARMSG\s/.test(rest)) {
        const alvo = tags['target-msg-id'];
        if (alvo) this.handlers.onRemove({ platform: 'twitch', ids: [String(alvo)] });
        return;
      }
      // CLEARCHAT: com nome = pessoa banida/silenciada; sem nome = chat limpo
      const limpeza = rest.match(/\sCLEARCHAT\s#\S+(?:\s:(\S+))?/);
      if (limpeza) {
        if (limpeza[1]) this.handlers.onRemove({ platform: 'twitch', autor: limpeza[1] });
        else this.handlers.onRemove({ platform: 'twitch', tudo: true });
        return;
      }
    }

    const match = rest.match(/^:(\S+)!\S+ PRIVMSG #(\S+) :(.*)$/);
    if (!match) return;
    let text = match[3];
    // Mensagens de /me chegam embrulhadas em \x01ACTION ...\x01
    const action = text.match(/^ACTION (.*)$/);
    if (action) text = action[1];

    const badgesTag = tags.badges || '';
    const badges = [];
    if (badgesTag.includes('broadcaster')) badges.push('dono');
    if (tags.mod === '1') badges.push('mod');
    if (badgesTag.includes('subscriber')) badges.push('sub');
    if (badgesTag.includes('vip')) badges.push('vip');

    // 🏷️ TODOS os distintivos que a Twitch manda, com a imagem original de
    // cada um (moderador, VIP, Prime, Turbo, bits, presentes, eventos, artes
    // próprias do canal...). Os cargos principais o painel desenha do seu
    // jeito; o resto aparece com a arte da própria Twitch.
    const selos = [];
    for (const parte of badgesTag.split(',')) {
      if (!parte) continue;
      const barra = parte.lastIndexOf('/');
      const conjunto = barra === -1 ? parte : parte.slice(0, barra);
      const versao = barra === -1 ? '1' : parte.slice(barra + 1);
      const info = this.selos.get(`${conjunto}/${versao}`) || this.selos.get(`${conjunto}/1`) || null;
      selos.push({
        id: 'twitch:' + conjunto,
        cargo: (Object.hasOwn(CARGOS_TWITCH, conjunto) && CARGOS_TWITCH[conjunto]) || null,
        nome: info?.titulo || conjunto.replace(/[-_]/g, ' '),
        img: info?.img || null,
      });
    }

    // Nivel do sub pelo selo publico: a versao do selo "subscriber" carrega o
    // tier (3000+ = Tier 3, 2000+ = Tier 2, resto = Tier 1); "premium" = Prime.
    let subTier = null;
    const subBadge = badgesTag.match(/subscriber\/(\d+)/);
    if (subBadge) {
      const version = Number(subBadge[1]);
      subTier = version >= 3000 ? 't3' : version >= 2000 ? 't2' : 't1';
    }
    if (badgesTag.includes('premium') && (subTier === null || subTier === 't1')) {
      subTier = 'prime';
    }
    // Fundador: os primeiros assinantes trocam o selo "subscriber" pelo
    // "founder" — sem isto, fundador valia 1 ficha no sorteio
    if (badgesTag.includes('founder/')) {
      subTier = 'twitchFounder';
    }

    const sentTs = Number(tags['tmi-sent-ts']) || Date.now();
    // ATENÇÃO: aqui existia "do histórico, só o que for mais novo que a última
    // já emitida". Como o histórico É o passado recente, isso descartava tudo
    // depois de qualquer reconexão. Quem barra repetição é o servidor, pelo id.

    this.handlers.onMessage({
      platform: 'twitch',
      channel: this.channel,
      // Sem id próprio, um id estável pelo conteúdo evita repetir o histórico
      id: tags.id || (fromHistory
        ? `tw-h-${sentTs}-${idEstavel(`${match[1]}|${text}`)}`
        : `tw-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      author: tags['display-name'] || match[1],
      authorLogin: match[1],
      authorColor: tags.color || null,
      avatar: null,
      badges,
      selos,
      subTier,
      runs: buildRuns(text, tags.emotes),
      timestamp: sentTs,
      ...(fromHistory ? { fromHistory: true } : {}),
    });
  }

  stop() {
    this.stopped = true;
    if (this.ws) try { this.ws.close(); } catch {}
  }
}

module.exports = { TwitchConnector };
