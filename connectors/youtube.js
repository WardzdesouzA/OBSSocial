// Conector de chat ao vivo do YouTube.
// Le o chat da mesma forma que o navegador: abre a pagina publica do chat da live
// e fica consultando as mensagens novas. Nao precisa de chave de API.

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  // Evita a tela de consentimento em algumas regioes
  Cookie: 'CONSENT=YES+cb; SOCS=CAI',
};

// Versao de reserva quando a pagina nao traz a versao do cliente.
// O YouTube aceita versoes antigas sem problema.
const FALLBACK_CLIENT_VERSION = '2.20250101.00.00';

// Extrai o objeto JSON que comeca logo depois do marcador, contando chaves.
// Bem mais resistente a mudancas de formato do que uma expressao regular.
function extractJsonAfter(html, markers) {
  for (const marker of markers) {
    const at = html.indexOf(marker);
    if (at === -1) continue;
    const start = html.indexOf('{', at + marker.length);
    if (start === -1) continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < html.length; i++) {
      const ch = html[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
      } else if (ch === '"') {
        inString = true;
      } else if (ch === '{') {
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(html.slice(start, i + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

function extractVideoId(input) {
  const value = input.trim();
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) return match[1];
  }
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;
  return null;
}

async function resolveHandleToVideoId(input) {
  let handle = input.trim();
  const urlMatch = handle.match(/youtube\.com\/(@[\w.-]+|c\/[\w.-]+|channel\/[\w-]+)/);
  if (urlMatch) handle = urlMatch[1];
  if (!handle.startsWith('@') && !handle.startsWith('c/') && !handle.startsWith('channel/')) {
    handle = '@' + handle;
  }
  const res = await fetch(`https://www.youtube.com/${handle}/live`, { headers: BROWSER_HEADERS, redirect: 'follow', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Não achei o canal "${handle}" no YouTube (erro ${res.status}).`);
  const html = await res.text();
  const canonical = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([A-Za-z0-9_-]{11})"/);
  if (canonical) return canonical[1];
  const anyId = html.match(/"videoId":"([A-Za-z0-9_-]{11})"/);
  if (anyId) return anyId[1];
  throw new Error(`O canal "${handle}" não parece estar ao vivo agora.`);
}

function findFirstContinuation(obj) {
  const continuations = obj?.continuationContents?.liveChatContinuation?.continuations
    || obj?.contents?.liveChatRenderer?.continuations;
  if (!continuations) return null;
  for (const cont of continuations) {
    const data = cont.invalidationContinuationData || cont.timedContinuationData || cont.reloadContinuationData;
    if (data?.continuation) {
      return { continuation: data.continuation, timeoutMs: data.timeoutMs || 2000 };
    }
  }
  return null;
}

// O YouTube manda as cores do Super Chat como um inteiro ARGB.
function argbToHex(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return '#' + (n & 0xffffff).toString(16).padStart(6, '0');
}

// 🕒 v0.118: quantos MESES de membro a dica do selo diz? "New member" → 0,
// "Member (6 months)" → 6, "Member (1 year)" → 12, "Membro (2 anos)" → 24,
// "Member (1 year, 6 months)" → 18. Sem número reconhecível → null.
function mesesDeMembro(dica) {
  const s = String(dica || '').toLowerCase();
  if (!s) return null;
  if (/\bnew\b|\bnovo\b|\bnova\b|\bnuevo\b|\bneu\b|\bnouveau\b|新/.test(s) && !/\d/.test(s)) return 0;
  let meses = 0;
  let achou = false;
  const anos = s.match(/(\d+)\s*(?:years?|anos?|años?|ans?|jahre?|年)/);
  if (anos) { meses += Number(anos[1]) * 12; achou = true; }
  const ms = s.match(/(\d+)\s*(?:months?|mes(?:es)?|mês|mois|monate?|个月|ヶ月|か月)/);
  if (ms) { meses += Number(ms[1]); achou = true; }
  return achou ? meses : null;
}

// 🎟️ v0.119: a figurinha do Super Sticker vai para a quarentena local do
// servidor (handlers.salvarMidia), como as figurinhas do Telegram/WhatsApp —
// é assim que ela aparece GRANDE na tela pelo bloco 📎 Mídia do inscrito
// (escala, tela cheia) e com prévia/zoom no painel. A extensão vem do
// content-type (webp/gif/png/jpg); animada ou não, o <img> toca sozinho.
async function baixarFigurinha(url, salvarMidia) {
  if (typeof salvarMidia !== 'function' || !/^https?:\/\//i.test(String(url || ''))) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: 'follow', signal: ctl.signal });
    if (!res.ok) return null;
    // 🔒 v0.127.1: tamanho anunciado acima do teto? Nem começa a baixar
    const anunciado = Number(res.headers.get('content-length')) || 0;
    if (anunciado > 8 * 1024 * 1024) return null;
    const tipo = String(res.headers.get('content-type') || '').toLowerCase();
    const daUrl = ((String(url).match(/\.(webp|gif|png|jpe?g)(?:[?#]|$)/i) || [])[1] || '').toLowerCase();
    const ext = tipo.includes('webp') ? 'webp' : tipo.includes('gif') ? 'gif' : tipo.includes('png') ? 'png'
      : (tipo.includes('jpeg') || tipo.includes('jpg')) ? 'jpg' : (daUrl === 'jpeg' ? 'jpg' : daUrl || 'webp');
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 8 * 1024 * 1024) return null;
    const salvo = salvarMidia(buf, ext, 'super-sticker.' + ext);
    return salvo ? { tipo: 'imagem', url: salvo, nome: 'Super Sticker', figurinha: true } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function runsFromMessage(message) {
  const runs = [];
  for (const run of message?.runs || []) {
    if (typeof run.text === 'string') {
      runs.push({ type: 'text', text: run.text });
    } else if (run.emoji) {
      const emoji = run.emoji;
      if (emoji.isCustomEmoji) {
        const thumbs = emoji.image?.thumbnails || [];
        const url = thumbs[thumbs.length - 1]?.url;
        if (url) runs.push({ type: 'emote', alt: emoji.shortcuts?.[0] || 'emoji', url });
      } else {
        runs.push({ type: 'text', text: emoji.emojiId || emoji.shortcuts?.[0] || '' });
      }
    }
  }
  return runs.length ? runs : [{ type: 'text', text: '' }];
}

class YouTubeConnector {
  constructor(input, handlers) {
    this.input = input;
    this.handlers = handlers;
    this.stopped = false;
    this.videoId = null;
    this.apiKey = null;
    this.clientVersion = null;
    this.continuation = null;
    this.timer = null;
    this.seen = new Set();
    // 🔒 v0.127.1: o stop() aborta a consulta em andamento — um conector
    // trocado não pode continuar consultando o YouTube
    this.abortCtl = new AbortController();
  }

  // Sinal que aborta por tempo (15s) OU quando o conector é parado
  sinal(ms = 15000) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), ms);
    if (timer.unref) timer.unref();
    const parar = () => { clearTimeout(timer); ctl.abort(); };
    if (this.abortCtl.signal.aborted) parar();
    else this.abortCtl.signal.addEventListener('abort', parar, { once: true });
    ctl.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      this.abortCtl.signal.removeEventListener('abort', parar);
    }, { once: true });
    return ctl.signal;
  }

  async start() {
    this.handlers.onStatus('connecting', 'Procurando a live no YouTube...');
    try {
      this.videoId = extractVideoId(this.input) || await resolveHandleToVideoId(this.input);
      await this.initChat();
    } catch (err) {
      if (!this.stopped) this.handlers.onStatus('error', err.message);
      return;
    }
    if (this.stopped) return;
    this.handlers.onStatus('connected', `Lendo o chat da live ${this.videoId}`);
    this.poll();
  }

  async initChat() {
    const res = await fetch(`https://www.youtube.com/live_chat?is_popout=1&v=${this.videoId}`, { headers: BROWSER_HEADERS, signal: this.sinal() });
    if (!res.ok) throw new Error(`O YouTube respondeu com erro ${res.status} ao abrir o chat.`);
    const html = await res.text();

    // A chave interna sumiu de algumas paginas do YouTube — os endpoints
    // internos funcionam sem ela, entao ela agora e opcional.
    const keyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const versionMatch = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)
      || html.match(/"clientVersion":"(2\.[^"]+)"/);
    this.apiKey = keyMatch ? keyMatch[1] : null;
    this.clientVersion = versionMatch ? versionMatch[1] : FALLBACK_CLIENT_VERSION;

    const initialData = extractJsonAfter(html, ['window["ytInitialData"]', 'var ytInitialData', 'ytInitialData =']);
    if (!initialData) throw new Error('Não consegui ler os dados do chat. O vídeo está ao vivo e com chat ativado?');

    const cont = findFirstContinuation(initialData);
    if (!cont) throw new Error('Este vídeo não tem chat ao vivo disponível (a live acabou ou o chat está desativado).');
    this.continuation = cont.continuation;

    // A pagina inicial do chat ja traz as ultimas dezenas de mensagens — e o
    // que o YouTube disponibiliza do que foi enviado enquanto estavamos fora.
    // O conjunto "seen" garante que nada entre duas vezes nas reconexoes.
    if (!this.handlers.recoverEnabled || this.handlers.recoverEnabled()) {
      const backlog = initialData?.contents?.liveChatRenderer?.actions || [];
      for (const action of backlog) {
        try { this.handleAction(action.replayChatItemAction?.actions?.[0] || action); } catch { /* item fora do padrao */ }
      }
    }
  }

  async poll() {
    if (this.stopped) return;
    let timeoutMs = 2000;
    try {
      const keyParam = this.apiKey ? `key=${this.apiKey}&` : '';
      const res = await fetch(`https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?${keyParam}prettyPrint=false`, {
        method: 'POST',
        headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: this.clientVersion, hl: 'en', gl: 'US' } },
          continuation: this.continuation,
        }),
        signal: this.sinal(),
      });
      if (!res.ok) throw new Error(`erro ${res.status}`);
      const data = await res.json();
      const chat = data?.continuationContents?.liveChatContinuation;
      if (!chat) {
        this.handlers.onStatus('error', 'O chat ao vivo terminou (a live acabou?).');
        return;
      }
      const cont = findFirstContinuation(data);
      if (cont) {
        this.continuation = cont.continuation;
        // Piso de 1s: mais rapido que isso o YouTube pode bloquear o acesso.
        timeoutMs = Math.max(1000, Math.min(cont.timeoutMs || 2000, 10000));
      }
      for (const action of chat.actions || []) {
        // 🔒 v0.127.1: um item fora do padrão não derruba a consulta inteira
        try { this.handleAction(action); } catch { /* item fora do padrao */ }
      }
    } catch (err) {
      if (this.stopped) return;
      // Tenta reabrir o chat do zero; se falhar, reporta e tenta de novo depois.
      try {
        await this.initChat();
      } catch (reinitErr) {
        this.handlers.onStatus('error', `Perdi a conexão com o chat do YouTube: ${reinitErr.message}`);
        timeoutMs = 15000;
      }
    }
    if (!this.stopped) this.timer = setTimeout(() => this.poll(), timeoutMs);
  }

  handleAction(action) {
    // 🗑️ Moderação: sem isto, o que o mod apagou continuava na tela da live.
    if (this.handlers.onRemove) {
      const apagada = action?.markChatItemAsDeletedAction?.targetItemId;
      if (apagada) {
        this.handlers.onRemove({ platform: 'youtube', ids: [String(apagada)] });
        return;
      }
      const doAutor = action?.markChatItemsByAuthorAsDeletedAction?.externalChannelId;
      if (doAutor) {
        this.handlers.onRemove({ platform: 'youtube', autor: String(doAutor) });
        return;
      }
    }
    const item = action?.addChatItemAction?.item;
    if (!item) return;
    // 🎟️ v0.118: o Super Sticker (figurinha paga, estática ou animada) entra
    // como um Super Chat cujo "texto" é a imagem da figurinha
    const figurinha = item.liveChatPaidStickerRenderer || null;
    const renderer = item.liveChatTextMessageRenderer || item.liveChatPaidMessageRenderer || figurinha;
    if (!renderer) return;
    const id = renderer.id;
    if (id && this.seen.has(id)) return;
    if (id) {
      this.seen.add(id);
      if (this.seen.size > 3000) {
        // Evita crescer sem limite em lives longas.
        this.seen = new Set(Array.from(this.seen).slice(-1500));
      }
    }

    const badges = [];
    const selos = [];
    let memberLevel = null;
    let membroMeses = null;
    for (const badge of renderer.authorBadges || []) {
      const r = badge.liveChatAuthorBadgeRenderer;
      if (!r) continue;
      const icon = r.icon?.iconType;
      const dica = typeof r.tooltip === 'string' ? r.tooltip : (r.accessibility?.accessibilityData?.label || '');
      if (icon === 'OWNER') {
        badges.push('dono');
        selos.push({ id: 'youtube:dono', cargo: 'dono', nome: dica || 'Dono do canal', img: null });
      } else if (icon === 'MODERATOR') {
        badges.push('mod');
        selos.push({ id: 'youtube:mod', cargo: 'mod', nome: dica || 'Moderador', img: null });
      } else if (icon === 'VERIFIED') {
        badges.push('verificado');
        selos.push({ id: 'youtube:verificado', cargo: 'verificado', nome: dica || 'Verificado', img: null });
      } else if (r.customThumbnail) {
        badges.push('membro');
        // O nome do nivel de membro (que o canal cria a vontade) vem na
        // dica do selo — usado pelas fichas do sorteio por nivel.
        if (dica) memberLevel = dica.slice(0, 80);
        // 🕒 v0.118: o TEMPO de membro tambem mora na dica ("Member (6 months)",
        // "New member", "Membro (1 ano)") — vira meses para o 🎭 automatico
        const meses = mesesDeMembro(dica);
        if (meses !== null) membroMeses = meses;
        // 🏷️ A arte do nível de membro é do próprio canal: vem aqui dentro
        const miniaturas = r.customThumbnail.thumbnails || [];
        const url = miniaturas[miniaturas.length - 1]?.url;
        selos.push({
          id: 'youtube:membro',
          cargo: 'membro',
          nome: dica || 'Membro do canal',
          img: typeof url === 'string' && url.startsWith('https://') ? url : null,
        });
      } else if (icon) {
        // Qualquer selo novo que o YouTube inventar entra assim mesmo
        selos.push({ id: 'youtube:' + String(icon).toLowerCase(), cargo: null, nome: dica || String(icon), img: null });
      }
    }

    let runs = runsFromMessage(renderer.message);
    let superchat = null;
    if (figurinha) {
      // 🎟️ Super Sticker: a figurinha vira uma "emote" grande no lugar do
      // texto (o endereço costuma vir sem protocolo: //lh3.googleusercontent...)
      const thumbs = figurinha.sticker?.thumbnails || [];
      let url = thumbs[thumbs.length - 1]?.url || '';
      if (url.startsWith('//')) url = 'https:' + url;
      const rotulo = figurinha.sticker?.accessibility?.accessibilityData?.label || 'Super Sticker';
      runs = /^https?:\/\//i.test(url) ? [{ type: 'emote', alt: rotulo, url, figurinha: true }] : [{ type: 'text', text: rotulo }];
      const amount = figurinha.purchaseAmountText?.simpleText || '';
      superchat = {
        amount,
        color: argbToHex(figurinha.backgroundColor) || argbToHex(figurinha.moneyChipBackgroundColor) || '#ffb300',
        headerColor: argbToHex(figurinha.moneyChipBackgroundColor) || argbToHex(figurinha.backgroundColor) || '#ffb300',
        textColor: argbToHex(figurinha.moneyChipTextColor) || '#000000',
        figurinha: true,
      };
      badges.push(amount ? `superchat ${amount}` : 'superchat');
    } else if (item.liveChatPaidMessageRenderer) {
      const amount = renderer.purchaseAmountText?.simpleText || '';
      superchat = {
        amount,
        color: argbToHex(renderer.bodyBackgroundColor) || '#ffb300',
        headerColor: argbToHex(renderer.headerBackgroundColor) || argbToHex(renderer.bodyBackgroundColor) || '#ffb300',
        textColor: argbToHex(renderer.bodyTextColor) || '#000000',
      };
      badges.push(amount ? `superchat ${amount}` : 'superchat');
    }

    const photos = renderer.authorPhoto?.thumbnails || [];
    const mensagem = {
      platform: 'youtube',
      channel: this.videoId,
      id: id || `yt-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      author: renderer.authorName?.simpleText || 'anônimo',
      authorColor: null,
      // Emite o endereço ORIGINAL da foto (o maior que o chat oferece).
      // A versão ampliada/nítida é tentada no navegador, com volta garantida
      // para este endereço se o CDN recusar o tamanho maior.
      avatar: photos[photos.length - 1]?.url || null,
      // Id do canal de quem falou: é por ele que o YouTube avisa "apaguei
      // tudo desta pessoa" (o nome de exibição não serve para isso)
      authorId: renderer.authorExternalChannelId || null,
      badges,
      selos,
      subTier: badges.includes('membro') ? 'member' : null,
      memberLevel,
      membroMeses,
      superchat,
      runs,
      timestamp: renderer.timestampUsec ? Math.floor(Number(renderer.timestampUsec) / 1000) : Date.now(),
    };
    // 🎟️ v0.119: Super Sticker — baixa a figurinha para a quarentena local e
    // só então entrega a mensagem, já com a mídia (como uma figurinha do
    // Telegram). Se o download falhar, ela segue com a figurinha em linha.
    if (figurinha && runs[0] && runs[0].figurinha === true) {
      baixarFigurinha(runs[0].url, this.handlers.salvarMidia).then((midia) => {
        if (midia) {
          mensagem.midia = midia;
          mensagem.runs = [{ type: 'text', text: '' }];
        }
        this.handlers.onMessage(mensagem);
      });
      return;
    }
    this.handlers.onMessage(mensagem);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    try { this.abortCtl.abort(); } catch {}
  }
}

module.exports = { YouTubeConnector, mesesDeMembro, baixarFigurinha };
