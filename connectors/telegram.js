// Conector de chat do Telegram (Labs v0.65) — 100% pela Bot API OFICIAL.
// O streamer cria um bot no @BotFather, coloca o bot no grupo da live e cola
// aqui o token + o grupo. O conector busca as mensagens por LONG POLLING
// (getUpdates com espera de ~25s): atualizações chegam na hora e nada de
// endereço público — o mesmo modelo local dos outros chats do OBS Social.
//
// Mídia dos inscritos (foto, áudio, vídeo, documento) é baixada pela própria
// Bot API (até 20 MB por arquivo) e guardada em quarentena local pelo
// servidor (handlers.salvarMidia) — as telas só a veem quando o apresentador
// manda. Timeout e banimento usam os recursos NATIVOS do grupo
// (restrictChatMember / banChatMember): o bot precisa ser admin do grupo.
'use strict';

const https = require('https');
const http = require('http');
// ✍️ v0.145: a formatação — as «entities» que o Telegram manda ao lado do
// texto na entrada, e os marcadores do painel virando HTML na saída
const formato = require('./formato.js');

const LIMITE_ARQUIVO = 20 * 1024 * 1024; // o teto de download da própria Bot API
const LIMITE_TEXTO_MSG = 4000;           // sendMessage aceita 4096; folga para a assinatura

function requisicao(urlTexto, { method = 'GET', body = null, timeoutMs = 35000, contentType = '' } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlTexto); } catch { reject(new Error('endereço inválido')); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const headers = {};
    // 📎 v0.75: corpo cru (Buffer) para multipart de arquivos; JSON no resto
    const cru = Buffer.isBuffer(body);
    if (body) headers['Content-Type'] = cru ? (contentType || 'application/octet-stream') : 'application/json';
    if (cru) headers['Content-Length'] = body.length;
    const req = mod.request(u, { method, headers, timeout: timeoutMs }, (res) => {
      const partes = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        // 🔒 v0.127.1: passou do teto? Derruba a resposta na hora, em vez de
        // continuar recebendo (e descartando) bytes até o fim
        if (total > LIMITE_ARQUIVO + 1024) { res.destroy(new Error('resposta maior que o limite')); return; }
        partes.push(c);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, corpo: Buffer.concat(partes) }));
    });
    req.on('timeout', () => req.destroy(new Error('o Telegram demorou demais para responder')));
    req.on('error', reject);
    if (body) req.write(Buffer.isBuffer(body) ? body : JSON.stringify(body));
    req.end();
  });
}

// O texto pode vir com entidades (negrito, links...) — para o painel basta o
// texto puro; emojis chegam prontos no próprio texto.
// ✍️ v0.145: o Telegram manda o texto puro e, ao lado, a lista de trechos
// formatados (negrito, itálico, sublinhado, tachado, código). Sem ela, tudo
// chegava sem formatação nenhuma ao painel.
function runsDaMensagem(m) {
  const texto = String(m.text || m.caption || '');
  const entidades = m.entities || m.caption_entities;
  return formato.runsDeEntidades(texto, entidades);
}

function runsDoTexto(texto) {
  return [{ type: 'text', text: String(texto || '') }];
}

class TelegramConnector {
  constructor(channel, handlers, options = {}) {
    // O "canal" é o grupo: @nomedogrupo, o id numérico (-100...), ou vazio =
    // aceitar qualquer conversa em que o bot esteja (grupos e privados)
    this.grupo = String(channel || '').trim().replace(/^\*$/, '');
    this.handlers = handlers || {};
    this.token = String(options.token || '').trim();
    // Nos testes, a API pode ser um Telegram de mentira na própria máquina.
    // 🔒 v0.127.1: só pela variável de ambiente (gancho de teste) — nunca
    // pelas opções, que chegam do painel (o token iria para outro servidor)
    this.apiBase = String(process.env.OBS_TESTE_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
    this.parado = false;
    this.offset = 0;
    this.botUsername = '';
    // chat_id do grupo por autor (para moderar/responder sem redescobrir)
    this.chatDoAutor = new Map();
    // 🖼️ v0.72: foto de perfil por autor — buscada UMA vez por pessoa.
    // undefined = nunca buscado · string = achada · null = sem foto/privada
    this.avatares = new Map();
    this.avataresPend = new Set();
  }

  async api(metodo, params) {
    const r = await requisicao(`${this.apiBase}/bot${this.token}/${metodo}`, {
      method: 'POST', body: params || {},
      timeoutMs: metodo === 'getUpdates' ? 40000 : 20000,
    });
    let json;
    try { json = JSON.parse(r.corpo.toString('utf8')); } catch { throw new Error(`resposta estranha do Telegram (HTTP ${r.status})`); }
    if (!json.ok) throw new Error(json.description || `o Telegram recusou ${metodo} (HTTP ${r.status})`);
    return json.result;
  }

  aceitaChat(chat) {
    if (!chat) return false;
    // 💬 v0.65.1: conversa DIRETA com o bot (chat privado) entra SEMPRE —
    // quem procurou o bot quer falar com a live. O filtro de grupo abaixo
    // vale só para grupos/canais: dá para ter grupo E privado juntos.
    if (chat.type === 'private') return true;
    // 👥 v0.141: grupo, supergrupo e canal ficam de fora quando o streamer
    // só quer conversa direta (seletor no card do Telegram, em Conexões)
    if (this.handlers.aceitaGrupos && this.handlers.aceitaGrupos() === false) return false;
    if (!this.grupo) return true; // sem grupo definido: tudo em que o bot está
    const alvo = this.grupo.toLowerCase();
    if (alvo.startsWith('@')) return ('@' + String(chat.username || '').toLowerCase()) === alvo;
    return String(chat.id) === this.grupo;
  }

  // Nome para o painel: nome > @usuário > "Telegram" (a preferência pedida)
  autorDe(from) {
    const nome = [from?.first_name, from?.last_name].filter(Boolean).join(' ').trim();
    if (nome) return nome;
    if (from?.username) return '@' + from.username;
    return 'Telegram';
  }

  async baixar(fileId, nomeSugerido) {
    if (typeof this.handlers.salvarMidia !== 'function') return null;
    try {
      const info = await this.api('getFile', { file_id: fileId });
      if (!info?.file_path || (info.file_size || 0) > LIMITE_ARQUIVO) return null;
      const r = await requisicao(`${this.apiBase}/file/bot${this.token}/${info.file_path}`, { timeoutMs: 60000 });
      if (r.status !== 200 || !r.corpo.length || r.corpo.length > LIMITE_ARQUIVO) return null;
      const ext = (info.file_path.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1]
        || (nomeSugerido.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || 'bin';
      return this.handlers.salvarMidia(r.corpo, ext.toLowerCase(), nomeSugerido);
    } catch { return null; }
  }

  // A mídia da mensagem, já baixada para a quarentena local
  async midiaDe(m) {
    if (Array.isArray(m.photo) && m.photo.length) {
      const maior = m.photo[m.photo.length - 1];
      const url = await this.baixar(maior.file_id, 'foto.jpg');
      return url ? { tipo: 'imagem', url, nome: 'foto' } : null;
    }
    if (m.voice) {
      const url = await this.baixar(m.voice.file_id, 'audio.ogg');
      return url ? { tipo: 'audio', url, nome: 'mensagem de voz', duracao: m.voice.duration } : null;
    }
    if (m.audio) {
      const url = await this.baixar(m.audio.file_id, m.audio.file_name || 'audio.mp3');
      return url ? { tipo: 'audio', url, nome: m.audio.title || m.audio.file_name || 'áudio', duracao: m.audio.duration } : null;
    }
    if (m.video) {
      const url = await this.baixar(m.video.file_id, m.video.file_name || 'video.mp4');
      return url ? { tipo: 'video', url, nome: m.video.file_name || 'vídeo', duracao: m.video.duration } : null;
    }
    if (m.video_note) {
      const url = await this.baixar(m.video_note.file_id, 'video.mp4');
      return url ? { tipo: 'video', url, nome: 'vídeo curto', duracao: m.video_note.duration } : null;
    }
    if (m.document) {
      const mime = String(m.document.mime_type || '');
      const url = await this.baixar(m.document.file_id, m.document.file_name || 'arquivo.bin');
      if (!url) return null;
      const tipo = mime.startsWith('image/') ? 'imagem' : mime.startsWith('video/') ? 'video'
        : mime.startsWith('audio/') ? 'audio' : 'arquivo';
      return { tipo, url, nome: m.document.file_name || 'arquivo' };
    }
    // 🩹 v0.70: figurinhas — estáticas (.webp) e de vídeo (.webm) entram
    // inteiras. 🌀 v0.74: as ANIMADAS (.tgs, Lottie compactado) agora entram
    // de verdade — as telas reproduzem a animação; a miniatura vira reserva.
    if (m.sticker) {
      if (m.sticker.is_animated) {
        const url = await this.baixar(m.sticker.file_id, 'figurinha.tgs');
        if (url) return { tipo: 'lottie', url, nome: 'figurinha' };
        if (!m.sticker.thumbnail) return null;
        const capa = await this.baixar(m.sticker.thumbnail.file_id, 'figurinha.jpg');
        return capa ? { tipo: 'imagem', url: capa, nome: 'figurinha' } : null;
      }
      const url = await this.baixar(m.sticker.file_id, m.sticker.is_video ? 'figurinha.webm' : 'figurinha.webp');
      if (!url) return null;
      return { tipo: m.sticker.is_video ? 'video' : 'imagem', url, nome: 'figurinha' };
    }
    return null;
  }

  // 🖼️ v0.72: foto de perfil do autor pela própria Bot API. Quem esconde a
  // foto nas privacidades do Telegram fica com as iniciais (photos vem vazio).
  // A foto é baixada para a quarentena local; quando chega DEPOIS da primeira
  // mensagem, o servidor espalha retroativamente (handlers.onAvatar).
  async buscarAvatar(from) {
    const id = String(from?.id || '');
    if (!id || this.avatares.has(id) || this.avataresPend.has(id)) return;
    this.avataresPend.add(id);
    try {
      const r = await this.api('getUserProfilePhotos', { user_id: from.id, limit: 1 });
      const tamanhos = (r && Array.isArray(r.photos) && r.photos[0]) || [];
      const foto = tamanhos[tamanhos.length - 1]; // o maior tamanho disponível
      const url = foto ? await this.baixar(foto.file_id, 'avatar.jpg') : null;
      this.avatares.set(id, url || null);
      if (url) this.handlers.onAvatar?.(from.username ? '@' + from.username : this.autorDe(from), url);
    } catch { this.avatares.set(id, null); } finally { this.avataresPend.delete(id); }
  }

  // 📍 v0.70: localização/lugar vira texto no cartão (nome, endereço e as
  // coordenadas) — o apresentador pode mandar para a tela como comentário
  textoDeLocal(m) {
    const loc = m.venue?.location || m.location;
    if (!loc || !Number.isFinite(Number(loc.latitude))) return '';
    const partes = [m.venue?.title, m.venue?.address].filter(Boolean);
    const coords = `${Number(loc.latitude).toFixed(5)}, ${Number(loc.longitude).toFixed(5)}`;
    return '📍 ' + (partes.length ? partes.join(' — ') + ` (${coords})` : `Localização: ${coords}`);
  }

  // 💬 v0.143: os cartões especiais do Telegram que caíam no vazio — a
  // enquete, o contato e o dadinho. Sem texto e sem anexo, a mensagem inteira
  // era descartada e o apresentador nunca sabia que alguém tinha mandado algo.
  //
  // ☎️ Regra da casa desde a v0.64: o telefone do cartão de contato NÃO entra
  // — do contato sai só o nome.
  textoEspecial(m) {
    if (m.poll) {
      const pergunta = String(m.poll.question || '').trim() || 'sem pergunta';
      const opcoes = (m.poll.options || []).map((o) => String(o.text || '').trim()).filter(Boolean);
      return `📊 Enquete: ${pergunta}${opcoes.length ? ` — ${opcoes.join(' · ')}` : ''}`;
    }
    if (m.contact) {
      const nome = [m.contact.first_name, m.contact.last_name].filter(Boolean).join(' ').trim();
      return `👤 Contato: ${nome || 'sem nome'}`;
    }
    if (m.dice) return `🎲 ${String(m.dice.emoji || '🎲')} tirou ${Number(m.dice.value) || '?'}`;
    if (m.game) return `🎮 Jogo: ${String(m.game.title || '').trim() || 'sem nome'}`;
    return '';
  }

  async processar(m) {
    if (!m || !m.chat || !this.aceitaChat(m.chat)) return;
    if (m.from?.is_bot) return; // bots (inclusive o nosso) não entram no painel
    let texto = String(m.text || m.caption || '');
    if (!texto && (m.location || m.venue)) texto = this.textoDeLocal(m); // 📍 v0.70
    if (!texto) texto = this.textoEspecial(m); // 💬 v0.143: enquete, contato...
    const midia = await this.midiaDe(m);
    if (!texto && !midia) return; // entradas/saídas de membros, pins etc.
    const from = m.from || {};
    this.chatDoAutor.set(String(from.id), { id: m.chat.id, privado: m.chat.type === 'private' });
    // 🖼️ v0.72: foto já conhecida entra junto; desconhecida é buscada em
    // paralelo (sem atrasar a mensagem) e chega depois via onAvatar
    const avatarPronto = this.avatares.get(String(from.id));
    if (from.id && avatarPronto === undefined) this.buscarAvatar(from);
    this.handlers.onMessage({
      platform: 'telegram',
      channel: String(m.chat.title || m.chat.username || m.chat.id),
      id: `tg-${m.chat.id}-${m.message_id}`,
      author: this.autorDe(from),
      authorId: String(from.id || ''),
      authorLogin: from.username ? '@' + from.username : '',
      authorColor: null,
      avatar: typeof avatarPronto === 'string' ? avatarPronto : null,
      badges: [],
      // ✍️ v0.145: o que a pessoa escreveu vai com a formatação dela; o
      // rótulo do anexo é texto simples nosso
      runs: (m.text || m.caption) ? runsDaMensagem(m) : runsDoTexto(texto || (midia ? `[${midia.nome}]` : '')),
      midia: midia || undefined,
      // para responder e moderar direto do painel
      tgChatId: m.chat.id,
      tgMessageId: m.message_id,
      timestamp: (Number(m.date) || Math.floor(Date.now() / 1000)) * 1000,
    });
  }

  async loop() {
    while (!this.parado) {
      try {
        const updates = await this.api('getUpdates', {
          offset: this.offset, timeout: 25, allowed_updates: ['message'],
        });
        for (const up of updates || []) {
          this.offset = Math.max(this.offset, (up.update_id || 0) + 1);
          if (!this.parado && up.message) await this.processar(up.message);
        }
        if (this.errou) { this.errou = false; this.handlers.onStatus?.('connected', ''); }
      } catch (err) {
        if (this.parado) return;
        // Token inválido = erro de verdade (derruba); resto = tenta de novo
        const texto = String(err.message || err);
        if (/unauthorized|not found/i.test(texto)) {
          this.handlers.onStatus?.('error', 'O Telegram recusou o token do bot — confira no @BotFather.');
          return;
        }
        this.errou = true;
        this.handlers.onStatus?.('connecting', 'Sem resposta do Telegram — tentando de novo... (' + texto.slice(0, 80) + ')');
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  }

  async start() {
    if (!this.token) {
      this.handlers.onStatus?.('error', 'Cole o token do bot (o @BotFather entrega ao criar o bot).');
      return;
    }
    try {
      const eu = await this.api('getMe', {});
      this.botUsername = eu?.username || '';
      this.handlers.onStatus?.('connected', '');
    } catch (err) {
      this.handlers.onStatus?.('error', 'Não consegui falar com o Telegram: ' + String(err.message || err).slice(0, 120));
      return;
    }
    this.loop();
  }

  stop() { this.parado = true; }

  infoDoAutor(autorId) {
    return this.chatDoAutor.get(String(autorId))
      ?? (this.grupo && !this.grupo.startsWith('@') ? { id: this.grupo, privado: false } : null);
  }

  // 🛡️ Moderação nativa do grupo (o bot precisa ser admin). No chat PRIVADO
  // não existe castigo nativo do Telegram — e nem precisa: o filtro local do
  // OBS Social já segura tudo. Então no privado a gente sai calado.
  async silenciar(autorId, ateSegundos) {
    const alvo = this.infoDoAutor(autorId);
    if (!alvo) throw new Error('ainda não vi mensagem dessa pessoa nesta sessão');
    if (alvo.privado) return;
    await this.api('restrictChatMember', {
      chat_id: alvo.id, user_id: Number(autorId),
      permissions: { can_send_messages: false, can_send_audios: false, can_send_photos: false, can_send_videos: false, can_send_other_messages: false },
      until_date: ateSegundos,
    });
  }

  async banir(autorId) {
    const alvo = this.infoDoAutor(autorId);
    if (!alvo) throw new Error('ainda não vi mensagem dessa pessoa nesta sessão');
    if (alvo.privado) return;
    await this.api('banChatMember', { chat_id: alvo.id, user_id: Number(autorId) });
  }

  async liberar(autorId) {
    const alvo = this.infoDoAutor(autorId);
    if (!alvo || alvo.privado) return;
    try { await this.api('unbanChatMember', { chat_id: alvo.id, user_id: Number(autorId), only_if_banned: true }); } catch {}
    try {
      await this.api('restrictChatMember', {
        chat_id: alvo.id, user_id: Number(autorId),
        permissions: { can_send_messages: true, can_send_audios: true, can_send_photos: true, can_send_videos: true, can_send_other_messages: true, can_add_web_page_previews: true },
      });
    } catch {}
  }

  // 📎 v0.75: envia um arquivo pela Bot API (multipart montado à mão) —
  // respostas com foto/áudio/vídeo/documento
  async apiArquivo(metodo, campos, campoArquivo, arq) {
    const divisa = '----obsSocial' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const partes = [];
    for (const [k, v] of Object.entries(campos)) {
      partes.push(Buffer.from(`--${divisa}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${String(v)}\r\n`));
    }
    const nome = String(arq.nome || 'arquivo').replace(/["\r\n]/g, '');
    partes.push(Buffer.from(`--${divisa}\r\nContent-Disposition: form-data; name="${campoArquivo}"; filename="${nome}"\r\nContent-Type: ${arq.mime || 'application/octet-stream'}\r\n\r\n`));
    partes.push(arq.buffer, Buffer.from(`\r\n--${divisa}--\r\n`));
    const r = await requisicao(`${this.apiBase}/bot${this.token}/${metodo}`, {
      method: 'POST', body: Buffer.concat(partes), timeoutMs: 120000,
      contentType: 'multipart/form-data; boundary=' + divisa,
    });
    let json;
    try { json = JSON.parse(r.corpo.toString('utf8')); } catch { throw new Error(`resposta estranha do Telegram (HTTP ${r.status})`); }
    if (!json.ok) throw new Error(json.description || `o Telegram recusou ${metodo} (HTTP ${r.status})`);
    return json.result;
  }

  // 📎 v0.75: resposta com arquivo — foto/áudio/vídeo têm método próprio;
  // se o Telegram recusar (foto grande demais etc.), vai como documento
  async responderMidia(chatId, arq, replyTo) {
    const campos = { chat_id: chatId };
    if (replyTo) campos.reply_parameters = JSON.stringify({ message_id: Number(replyTo), allow_sending_without_reply: true });
    const porTipo = { imagem: ['sendPhoto', 'photo'], audio: ['sendAudio', 'audio'], video: ['sendVideo', 'video'] };
    const [metodo, campo] = porTipo[arq.tipo] || ['sendDocument', 'document'];
    try {
      await this.apiArquivo(metodo, campos, campo, arq);
    } catch (err) {
      if (metodo === 'sendDocument') throw err;
      await this.apiArquivo('sendDocument', campos, 'document', arq);
    }
  }

  // 💬 Resposta do apresentador (texto sem limite: dividimos em blocos)
  // ✍️ v0.145: a resposta sai do painel com os marcadores do WhatsApp
  // (*negrito*, _itálico_, ~tachado~, `mono`), que é o que a barra de
  // formatação insere. O WhatsApp entende esses marcadores sozinho; o
  // Telegram não — lá vai HTML, com tudo escapado antes para nada do que foi
  // escrito virar marcação por acidente. Sem formatação, vai texto puro,
  // exatamente como antes.
  async responder(chatId, texto, replyTo) {
    const inteiro = String(texto || '');
    const comFormato = formato.temFormatacao(inteiro);
    for (let i = 0; i < inteiro.length; i += LIMITE_TEXTO_MSG) {
      const pedaco = inteiro.slice(i, i + LIMITE_TEXTO_MSG);
      await this.api('sendMessage', {
        chat_id: chatId,
        text: comFormato ? formato.paraHtmlTelegram(pedaco) : pedaco,
        ...(comFormato ? { parse_mode: 'HTML' } : {}),
        ...(i === 0 && replyTo ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {}),
      });
    }
  }
}

module.exports = { TelegramConnector };
