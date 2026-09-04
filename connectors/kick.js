// Conector de chat do Kick.
// O chat do Kick e distribuido por um servico publico (Pusher). Para entrar na sala
// precisamos do numero interno do chat (chatroom id), que buscamos na API do site.
const WebSocket = require('ws');

// Chaves publicas do Pusher usadas pelo site do Kick (a mais nova primeiro).
const PUSHER_KEYS = ['32cbd69e4b950bf97679', 'eb1d5f283081a78b932c'];
const PUSHER_CLUSTER = 'us2';

// Quantas páginas de histórico buscar (o Kick devolve 25 por página).
// 8 páginas = até 200 comentários recuperados de uma vez.
const MAX_PAGINAS_HISTORICO = 8;

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Emotes do Kick vem no texto como [emote:12345:nomeDoEmote]
function buildRuns(content) {
  const runs = [];
  const regex = /\[emote:(\d+):([^\]]*)\]/g;
  let cursor = 0;
  let match;
  while ((match = regex.exec(content)) !== null) {
    if (match.index > cursor) runs.push({ type: 'text', text: content.slice(cursor, match.index) });
    runs.push({
      type: 'emote',
      alt: match[2] || 'emote',
      url: `https://files.kick.com/emotes/${match[1]}/fullsize`,
    });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) runs.push({ type: 'text', text: content.slice(cursor) });
  return runs.length ? runs : [{ type: 'text', text: content }];
}

// Cargos que o painel já desenha bonito por conta própria
const CARGOS_KICK = {
  broadcaster: 'dono', moderator: 'mod', subscriber: 'sub',
  vip: 'vip', og: 'og', founder: 'founder', verified: 'verificado',
  bot: 'bot', // a Kick marca os robôs oficiais do chat (Botrix...)
};

// Endereço de imagem só entra se for https (nada de javascript: e afins)
const soHttps = (url) => (typeof url === 'string' && url.startsWith('https://') ? url : null);

// A Kick já mudou o nome dessa chave mais de uma vez ("type" e "name"),
// então aceitamos as duas — o distintivo aparece de qualquer jeito.
const chaveDoSelo = (b) => String(b?.type || b?.name || '');

// A arte que a Kick manda no distintivo pode vir em nomes diferentes
const arteDoSelo = (b) => soHttps(b?.image_url) || soHttps(b?.src)
  || soHttps(b?.image?.src) || soHttps(b?.badge_image?.src);

// Junta os dois formatos de distintivo da Kick num só, com imagem quando existe.
// `arteDoCanal` são os desenhos de assinante que o próprio canal desenhou
// (1 mês, 3 meses, 6 meses...), buscados uma vez ao conectar.
function selosDaKick(badges, badgesV2, arteDoCanal) {
  const imagens = new Map();
  for (const b of badgesV2 || []) {
    const chave = chaveDoSelo(b);
    const url = arteDoSelo(b);
    if (chave && url) imagens.set(chave, url);
  }
  const selos = [];
  const jaTem = new Set();
  const entrar = (b) => {
    const chave = chaveDoSelo(b);
    if (!chave || jaTem.has(chave)) return;
    jaTem.add(chave);
    let img = imagens.get(chave) || arteDoSelo(b);
    // Assinante: usa o desenho que o canal fez para aquele tempo de assinatura
    if (!img && chave === 'subscriber' && arteDoCanal) img = arteDoCanal(Number(b?.count) || 0);
    selos.push({
      id: 'kick:' + chave,
      cargo: (Object.hasOwn(CARGOS_KICK, chave) && CARGOS_KICK[chave]) || null,
      nome: b?.text || chave.replace(/[-_]/g, ' '),
      img: img || null,
    });
  };
  for (const b of badges || []) entrar(b);
  // Os que só existem na versão nova (nível, eventos) entram também
  for (const b of badgesV2 || []) entrar(b);
  return selos;
}

// Monta a busca "quantos meses de assinatura -> qual desenho" a partir da
// lista que o canal publica. Escolhe sempre o maior nível já alcançado.
function arteDeAssinante(lista) {
  const niveis = (Array.isArray(lista) ? lista : [])
    .map((b) => ({ meses: Number(b?.months) || 0, img: arteDoSelo(b) }))
    .filter((n) => n.img)
    .sort((a, b) => a.meses - b.meses);
  if (!niveis.length) return null;
  return (meses) => {
    let escolhido = niveis[0].img;
    for (const n of niveis) { if (n.meses <= meses) escolhido = n.img; }
    return escolhido;
  };
}

// Id curto e sempre igual para o mesmo texto (para o histórico sem id próprio)
function idEstavel(texto) {
  let hash = 0;
  for (const ch of String(texto)) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0;
  return hash.toString(36);
}

async function fetchChannelInfo(slug) {
  const urls = [
    `https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`,
    `https://kick.com/api/v1/channels/${encodeURIComponent(slug)}`,
  ];
  let lastError = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15000) });
      if (res.status === 404) throw new Error(`Canal "${slug}" não encontrado no Kick.`);
      if (!res.ok) { lastError = new Error(`Kick respondeu com erro ${res.status}.`); continue; }
      const data = await res.json();
      const chatroomId = data?.chatroom?.id;
      // O id numerico do canal e necessario para o historico de mensagens
      // (o endpoint /messages nao aceita o slug)
      // O id numérico do canal é o que o histórico aceita. Vem em data.id e,
      // como reserva, dentro do próprio chatroom (channel_id).
      if (chatroomId) {
        return {
          chatroomId,
          channelId: data?.id || data?.chatroom?.channel_id || null,
          // Os desenhos de assinante do canal (1 mês, 3 meses, 6 meses...)
          arteAssinante: arteDeAssinante(data?.subscriber_badges),
        };
      }
      lastError = new Error('Resposta do Kick não trouxe o id do chat.');
    } catch (err) {
      lastError = err;
      if (String(err.message).includes('não encontrado')) throw err;
    }
  }
  throw new Error(
    (lastError ? lastError.message + ' ' : '') +
    'O Kick pode estar bloqueando consultas automáticas (proteção Cloudflare). Tente de novo em instantes.'
  );
}

class KickConnector {
  constructor(channel, handlers) {
    this.channel = channel.trim().toLowerCase().replace(/^@/, '');
    this.handlers = handlers;
    this.ws = null;
    this.stopped = false;
    this.retryMs = 2000;
    this.keyIndex = 0;
    this.chatroomId = null;
    this.channelId = null;
    this.arteAssinante = null;  // desenhos de assinante do canal
    this.jaBuscouHistorico = false; // a 1ª busca vai fundo; as seguintes, só o recente
    this.buscando = false;          // nunca duas buscas ao mesmo tempo
  }

  async start() {
    this.handlers.onStatus('connecting', `Buscando o chat de ${this.channel} no Kick...`);
    try {
      const info = await fetchChannelInfo(this.channel);
      this.chatroomId = info.chatroomId;
      this.channelId = info.channelId;
      this.arteAssinante = info.arteAssinante || null;
      this.connectRetryMs = 0; // conectou: zera a espera
    } catch (err) {
      if (this.stopped) return;
      // Canal inexistente e permanente; o resto (Cloudflare 403 etc.) e
      // passageiro: insiste sozinho com espera crescente, sem o streamer
      // precisar clicar em reconectar no meio da live
      if (String(err.message).includes('não encontrado')) {
        this.handlers.onStatus('error', err.message);
        return;
      }
      this.connectRetryMs = Math.min((this.connectRetryMs || 15000) * 2, 300000);
      const s = Math.round(this.connectRetryMs / 1000);
      this.handlers.onStatus('error', `${err.message} Nova tentativa sozinha em ${s}s.`);
      this.connectTimer = setTimeout(() => { if (!this.stopped) this.start(); }, this.connectRetryMs);
      return;
    }
    if (this.stopped) return;
    this.open();
  }

  open() {
    if (this.stopped) return;
    const key = PUSHER_KEYS[this.keyIndex % PUSHER_KEYS.length];
    const url = `wss://ws-${PUSHER_CLUSTER}.pusher.com/app/${key}?protocol=7&client=js&version=8.4.0&flash=false`;
    const ws = new WebSocket(url, { headers: { Origin: 'https://kick.com' } });
    this.ws = ws;
    let established = false;

    ws.on('message', (raw) => {
      // 🔒 v0.127.1: um pacote fora do padrão não pode derrubar o programa —
      // avisa uma vez no console e segue
      try {
        const acao = this.handlePusher(raw);
        if (acao === 'estabelecida') {
          established = true;
          this.retryMs = 2000;
          ws.send(JSON.stringify({
            event: 'pusher:subscribe',
            data: { auth: '', channel: `chatrooms.${this.chatroomId}.v2` },
          }));
          this.handlers.onStatus('connected', `Lendo o chat de ${this.channel}`);
          this.fetchHistory();
        } else if (acao === 'ping') {
          ws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
        } else if (acao === 'erro' && !established) {
          // Chave do app pode ter mudado; tenta a proxima.
          this.keyIndex++;
          try { ws.close(); } catch {}
        }
      } catch (err) {
        if (!this.avisouPacote) {
          this.avisouPacote = true;
          console.log('  ⚠️ Kick: pacote fora do padrão ignorado (' + String(err && err.message || err).slice(0, 80) + ').');
        }
      }
    });

    // Só o socket ATUAL manda reconectar: um socket antigo caindo depois
    // não pode disparar uma segunda conexão em paralelo
    ws.on('close', () => { if (this.ws === ws) this.scheduleReconnect(); });
    ws.on('error', () => { /* o evento close cuida da reconexao */ });
  }

  // Um pacote do Pusher. Devolve o que o socket precisa fazer em seguida
  // ('estabelecida', 'ping', 'erro') ou null quando ja foi tudo tratado aqui.
  handlePusher(raw) {
    let packet;
    try { packet = JSON.parse(raw.toString()); } catch { return null; }
    if (!packet || typeof packet !== 'object') return null;

    if (packet.event === 'pusher:connection_established') return 'estabelecida';
    if (packet.event === 'pusher:ping') return 'ping';
    if (packet.event === 'pusher:error') return 'erro';
    if (packet.event === 'App\\Events\\ChatMessageEvent') {
      let data;
      try { data = JSON.parse(packet.data); } catch { return null; }
      if (!data || typeof data !== 'object') return null;
      this.emitChat(data, false);
      return null;
    }
    // 🗑️ Moderação: mensagem apagada, pessoa banida/silenciada, chat limpo.
    // Sem isto, o que o mod tirou do chat continuava na tela da live.
    if (!this.handlers.onRemove) return null;
    let dados = null;
    try { dados = JSON.parse(packet.data); } catch { return null; }
    if (packet.event === 'App\\Events\\MessageDeletedEvent') {
      const id = dados?.message?.id || dados?.id;
      if (id) this.handlers.onRemove({ platform: 'kick', ids: [String(id)] });
    } else if (packet.event === 'App\\Events\\UserBannedEvent') {
      const quem = dados?.user?.slug || dados?.user?.username;
      if (quem) this.handlers.onRemove({ platform: 'kick', autor: String(quem) });
    } else if (packet.event === 'App\\Events\\ChatroomClearEvent') {
      this.handlers.onRemove({ platform: 'kick', tudo: true });
    }
    return null;
  }

  emitChat(data, fromHistory) {
    if (!data || typeof data !== 'object') return; // 🔒 v0.127.1
    const ts = data.created_at ? Date.parse(data.created_at) || Date.now() : Date.now();
    // ATENÇÃO: aqui existia "do histórico, só o que for mais novo que a última
    // mensagem já emitida". Como o histórico do Kick é justamente o passado
    // recente, isso jogava fora TODAS as mensagens sempre que a conexão caía e
    // voltava — o buraco nunca era recuperado. Quem barra repetição é o
    // servidor, pelo id da mensagem, que o Kick fornece.
    const sender = (data.sender && typeof data.sender === 'object') ? data.sender : {};
    // 🔒 v0.127.1: formas conferidas — a Kick já mudou o formato mais de uma vez
    const brutos = Array.isArray(sender.identity?.badges) ? sender.identity.badges : [];
    const brutosV2 = Array.isArray(sender.identity?.badges_v2) ? sender.identity.badges_v2 : [];
    const badges = brutos
      .map((b) => (b && typeof b === 'object' ? b.type : null))
      .filter((t) => typeof t === 'string' && t)
      .map((t) => (Object.hasOwn(CARGOS_KICK, t) ? CARGOS_KICK[t] : t));
    this.handlers.onMessage({
      platform: 'kick',
      channel: this.channel,
      // Sem id próprio (raro), monta um id estável a partir do conteúdo: assim
      // a mesma mensagem do histórico não entra duas vezes
      id: data.id || (fromHistory
        ? `kick-h-${ts}-${idEstavel(`${(data.sender || {}).username}|${data.content}`)}`
        : `kick-${Date.now()}-${Math.random().toString(36).slice(2)}`),
      author: sender.username || 'anônimo',
      authorLogin: String(sender.slug || sender.username || '').toLowerCase() || null,
      authorColor: sender.identity?.color || null,
      avatar: null,
      badges,
      // Kick: founder (fundador, primeiros assinantes) tem nivel proprio;
      // os demais subs entram como 'kick'
      subTier: badges.includes('founder') ? 'kickFounder'
        : badges.includes('sub') ? 'kick' : null,
      // 🏷️ Distintivos com a arte da própria Kick. Os "badges_v2" trazem a
      // imagem (nível do canal, assinatura, eventos); os "badges" trazem o
      // cargo e o nome curto. Juntamos os dois pelo nome.
      selos: selosDaKick(brutos, brutosV2, this.arteAssinante),
      runs: buildRuns(String(data.content || '')),
      timestamp: ts,
    });
  }

  // Recupera as mensagens que o proprio site do Kick ainda guarda.
  //
  // O endpoint devolve 25 por vez E um "cursor" para continuar mais para tras.
  // Antes so a primeira pagina era lida, entao o maximo que voltava eram 25
  // comentarios, por mais longo que fosse o buraco. Agora seguimos o cursor.
  async fetchHistory() {
    if (this.handlers.recoverEnabled && !this.handlers.recoverEnabled()) return;
    // O Pusher reconecta sozinho de vez em quando; sem esta trava, cada
    // reconexão dispararia a busca inteira de novo, uma em cima da outra.
    if (this.buscando) return;
    this.buscando = true;
    try {
      await this.buscarHistorico();
    } finally {
      this.buscando = false;
      this.jaBuscouHistorico = true;
    }
  }

  async buscarHistorico() {
    // O endpoint de mensagens usa o ID NUMERICO do canal (com o slug ele
    // responde erro e o historico nunca vinha). Tentamos o id primeiro e o
    // slug como reserva, caso o formato mude de novo.
    const alvos = [];
    if (this.channelId) alvos.push(String(this.channelId));
    alvos.push(encodeURIComponent(this.channel));
    for (const alvo of alvos) {
      // Na 1ª vez (ou num 🔄 pedido por você) vale a pena ir fundo; numa
      // reconexão automática o buraco costuma ser de segundos.
      const paginas = this.jaBuscouHistorico ? 3 : MAX_PAGINAS_HISTORICO;
      const recolhidas = await this.buscarPaginas(alvo, paginas);
      if (recolhidas === null) continue; // esse alvo nao respondeu: tenta o outro
      if (recolhidas.length) {
        // Do mais antigo para o mais novo, para a linha do tempo ficar certa
        recolhidas.sort((a, b) => (Date.parse(a.created_at) || 0) - (Date.parse(b.created_at) || 0));
        for (const m of recolhidas) {
          if (this.stopped) return;
          this.emitChat(m, true);
        }
        console.log(`  🕘 Kick: histórico com ${recolhidas.length} mensagens (o servidor descarta as repetidas).`);
      }
      return;
    }
    // Historico e um extra: sem ele, segue so o tempo real.
  }

  // Le ate MAX_PAGINAS_HISTORICO paginas seguindo o cursor. Devolve null se o
  // endereco nem respondeu (para o chamador tentar o outro formato).
  async buscarPaginas(alvo, maxPaginas = MAX_PAGINAS_HISTORICO) {
    const juntas = [];
    const vistos = new Set();
    let cursor = '';
    let respondeu = false;
    for (let pagina = 0; pagina < maxPaginas; pagina++) {
      if (this.stopped) break;
      const url = `https://kick.com/api/v2/channels/${alvo}/messages`
        + (cursor ? `?cursor=${encodeURIComponent(cursor)}` : '');
      let payload;
      try {
        const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(15000) });
        if (!res.ok) break;
        payload = await res.json();
      } catch { break; }
      respondeu = true;
      const brutaLista = payload?.data?.messages || payload?.messages;
      const lista = Array.isArray(brutaLista) ? brutaLista : [];
      if (!lista.length) break;
      let novas = 0;
      for (const m of lista) {
        // "reply" é uma resposta a outra mensagem: também é comentário e antes
        // era descartada. Só ficam de fora os avisos que não têm texto.
        if (!m || !m.content) continue;
        if (m.type && m.type !== 'message' && m.type !== 'reply') continue;
        const chave = m.id || `${m.created_at}|${m.sender?.username}|${m.content}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        juntas.push(m);
        novas += 1;
      }
      if (!novas) break; // a mesma página de novo: não há mais o que buscar
      const proximo = payload?.data?.cursor;
      if (!proximo || String(proximo) === cursor) break;
      cursor = String(proximo);
      // Um respiro entre as páginas para não parecer robô apressado
      await new Promise((r) => setTimeout(r, 250));
    }
    return respondeu ? juntas : null;
  }

  scheduleReconnect() {
    if (this.stopped) return;
    this.handlers.onStatus('connecting', 'Conexão caiu, reconectando...');
    setTimeout(() => this.open(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30000);
  }

  stop() {
    this.stopped = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    if (this.ws) try { this.ws.close(); } catch {}
  }
}

module.exports = { KickConnector };
