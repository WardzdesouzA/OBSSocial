// Conector de chat do WhatsApp (Labs v0.68) — via gateway Whapi.Cloud.
// ⚠️ IMPORTANTE: o Whapi NÃO é oficial da Meta (é engenharia reversa do
// protocolo). Funciona muito bem — grupos, mídia, respostas — mas existe
// risco real de banimento do número usado. O card do Labs avisa com todas
// as letras: usar um número SECUNDÁRIO dedicado à live, nunca o pessoal.
//
// Como funciona: o streamer cria um canal no Whapi, escaneia o QR com o
// número da live e cola aqui o token. O conector CONSULTA as mensagens por
// polling (GET /messages/list) — sem webhook e sem endereço público, no
// mesmo espírito local dos outros chats do OBS Social. Mídia é baixada do
// gateway e guardada em quarentena local (handlers.salvarMidia).
//
// Moderação: o WhatsApp não tem timeout nativo — o ⏳ castigo vale pelo
// filtro do próprio OBS Social (silenciar aqui é um no-op de propósito).
// O 🚫 banimento tenta também a blacklist do número no gateway (bloqueia a
// pessoa de falar com o número da live), além do filtro local de sempre.
'use strict';

// ✍️ v0.145: os marcadores de formatação do WhatsApp viram estilo de verdade
const formato = require('./formato.js');

const https = require('https');
const http = require('http');

const LIMITE_ARQUIVO = 20 * 1024 * 1024; // mesmo teto de mídia do Telegram
const LIMITE_TEXTO_MSG = 60000;          // WhatsApp aceita ~65 mil; folga
const JANELA_SOBREPOSICAO_S = 90;        // relê um pouquinho do passado (dedupe pelo id)

function requisicao(urlTexto, { method = 'GET', body = null, token = '', timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlTexto); } catch { reject(new Error('endereço inválido')); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`; // 🔒 v0.127.1: sem token, sem cabeçalho
    if (body) headers['Content-Type'] = 'application/json';
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
    req.on('timeout', () => req.destroy(new Error('o WhatsApp (gateway) demorou demais para responder')));
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function runsDoTexto(texto) {
  return formato.runsDoTexto(texto);
}

const EXT_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'm4a', 'audio/wav': 'wav',
  'application/pdf': 'pdf', 'text/plain': 'txt',
};

class WhatsAppConnector {
  constructor(channel, handlers, options = {}) {
    // O "canal" é o grupo da live: id (…@g.us) ou nome exato do grupo.
    // Vazio = aceitar tudo (conversas diretas E qualquer grupo do número).
    // Conversa DIRETA (privada) entra SEMPRE, como no Telegram.
    this.grupo = String(channel || '').trim().replace(/^\*$/, '');
    this.handlers = handlers || {};
    this.token = String(options.token || '').trim();
    // Nos testes, o gateway pode ser um Whapi de mentira na própria máquina.
    // 🔒 v0.127.1: só pela variável de ambiente (gancho de teste) — nunca
    // pelas opções, que chegam do painel (o token iria para outro servidor)
    this.apiBase = String(process.env.OBS_TESTE_API_BASE || 'https://gate.whapi.cloud').replace(/\/$/, '');
    // Intervalo do polling: piso de 1s; só o gancho de teste passa por baixo
    const intervaloTeste = Number(process.env.OBS_TESTE_INTERVALO_MS) || 0;
    this.intervaloMs = intervaloTeste > 0 ? intervaloTeste : Math.max(1000, Number(options.intervaloMs) || 6000);
    this.parado = false;
    this.vistos = new Set();
    // Só mensagens NOVAS interessam: começa do agora (menos a sobreposição)
    this.desde = Math.floor(Date.now() / 1000) - 5;
    // chat de cada autor (para responder/moderar sem redescobrir)
    this.chatDoAutor = new Map();
    // 🖼️ v0.72: foto de perfil por autor — buscada UMA vez por pessoa.
    // undefined = nunca buscado · string = achada · null = sem foto/privada
    this.avatares = new Map();
    this.avataresPend = new Set();
  }

  async api(caminho, { method = 'GET', body = null, timeoutMs = 25000 } = {}) {
    const r = await requisicao(`${this.apiBase}${caminho}`, { method, body, token: this.token, timeoutMs });
    if (r.status === 401) throw new Error('TOKEN_RECUSADO');
    let json = null;
    try { json = JSON.parse(r.corpo.toString('utf8')); } catch { /* algumas rotas devolvem bytes */ }
    if (r.status < 200 || r.status >= 300) {
      throw new Error((json && (json.error?.message || json.message)) || `o gateway recusou ${caminho} (HTTP ${r.status})`);
    }
    return json;
  }

  // 👥 v0.141: grupo e comunidade são «@g.us», canal é «@newsletter» e lista
  // de transmissão é «@broadcast» — nenhum deles é conversa direta.
  ehPrivado(chatId) { return !/@(g\.us|newsletter|broadcast)$/i.test(String(chatId || '')); }

  aceitaChat(m) {
    const chatId = String(m.chat_id || '');
    if (!chatId) return false;
    // Conversa direta com o número da live entra SEMPRE
    if (this.ehPrivado(chatId)) return true;
    // 👥 v0.141: quem só quer conversa direta desliga isso nas Conexões
    if (this.handlers.aceitaGrupos && this.handlers.aceitaGrupos() === false) return false;
    if (!this.grupo) return true; // sem grupo definido: qualquer grupo do número
    const alvo = this.grupo.toLowerCase();
    return chatId.toLowerCase() === alvo
      || String(m.chat_name || '').trim().toLowerCase() === alvo;
  }

  // Nome para o painel: nome (pushname) > telefone. A máscara no overlay é
  // aplicada pelas telas (pareceTelefone), como sempre.
  autorDe(m) {
    const nome = String(m.from_name || '').trim();
    if (nome) return nome;
    const fone = String(m.phone || m.from || '').replace(/@.*$/, '');
    return fone ? '+' + fone.replace(/^\+/, '') : 'WhatsApp';
  }

  async baixar(arquivo, nomeSugerido) {
    if (typeof this.handlers.salvarMidia !== 'function' || !arquivo) return null;
    try {
      if ((arquivo.file_size || 0) > LIMITE_ARQUIVO) return null;
      // O gateway costuma mandar o link direto; sem ele, busca pelo id
      const url = arquivo.link
        ? String(arquivo.link)
        : `${this.apiBase}/media/${encodeURIComponent(String(arquivo.id || ''))}`;
      if (!arquivo.link && !arquivo.id) return null;
      // 🔒 v0.127.1: o Bearer só vai junto quando o arquivo mora no próprio
      // gateway (como em buscarAvatar) — um link externo não pode ver o token
      const token = url.startsWith(this.apiBase + '/') ? this.token : '';
      const r = await requisicao(url, { token, timeoutMs: 60000 });
      if (r.status !== 200 || !r.corpo.length || r.corpo.length > LIMITE_ARQUIVO) return null;
      const ext = EXT_POR_MIME[String(arquivo.mime_type || '').split(';')[0]]
        || (String(arquivo.file_name || nomeSugerido || '').match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || 'bin';
      return this.handlers.salvarMidia(r.corpo, ext.toLowerCase(), arquivo.file_name || nomeSugerido);
    } catch { return null; }
  }

  // 🖼️ v0.72: foto de perfil do autor pelo gateway (GET /contacts/{id}/profile
  // devolve o campo icon com a URL da foto). Quem esconde a foto fica com as
  // iniciais. A foto é baixada para a quarentena local; quando chega DEPOIS
  // da primeira mensagem, o servidor espalha retroativamente (onAvatar).
  async buscarAvatar(m) {
    const id = String(m.from || m.phone || '').replace(/@.*$/, '').trim();
    if (!id || this.avatares.has(id) || this.avataresPend.has(id)) return;
    this.avataresPend.add(id);
    try {
      const perfil = await this.api(`/contacts/${encodeURIComponent(id)}/profile`);
      const link = String(perfil?.icon_full || perfil?.icon || '');
      let url = null;
      if (/^https?:\/\//.test(link) && typeof this.handlers.salvarMidia === 'function') {
        // O Bearer só vai junto quando a foto mora no próprio gateway
        const token = link.startsWith(this.apiBase + '/') ? this.token : '';
        const r = await requisicao(link, { token, timeoutMs: 30000 });
        if (r.status === 200 && r.corpo.length && r.corpo.length <= LIMITE_ARQUIVO) {
          url = this.handlers.salvarMidia(r.corpo, 'jpg', 'avatar.jpg');
        }
      }
      this.avatares.set(id, url || null);
      if (url) this.handlers.onAvatar?.(String(m.phone || '').replace(/@.*$/, '') || this.autorDe(m), url);
    } catch { this.avatares.set(id, null); } finally { this.avataresPend.delete(id); }
  }

  // A mídia da mensagem, já baixada para a quarentena local
  async midiaDe(m) {
    if (m.image) {
      const url = await this.baixar(m.image, 'foto.jpg');
      return url ? { tipo: 'imagem', url, nome: m.image.file_name || 'foto' } : null;
    }
    if (m.sticker) {
      const url = await this.baixar(m.sticker, 'figurinha.webp');
      return url ? { tipo: 'imagem', url, nome: 'figurinha' } : null;
    }
    if (m.voice) {
      const url = await this.baixar(m.voice, 'voz.ogg');
      return url ? { tipo: 'audio', url, nome: 'mensagem de voz', duracao: m.voice.seconds } : null;
    }
    if (m.audio) {
      const url = await this.baixar(m.audio, m.audio.file_name || 'audio.mp3');
      return url ? { tipo: 'audio', url, nome: m.audio.file_name || 'áudio', duracao: m.audio.seconds } : null;
    }
    if (m.video || m.gif) {
      const v = m.video || m.gif;
      const url = await this.baixar(v, v.file_name || 'video.mp4');
      return url ? { tipo: 'video', url, nome: v.file_name || 'vídeo', duracao: v.seconds } : null;
    }
    if (m.document) {
      const mime = String(m.document.mime_type || '');
      const url = await this.baixar(m.document, m.document.file_name || 'arquivo.bin');
      if (!url) return null;
      const tipo = mime.startsWith('image/') ? 'imagem' : mime.startsWith('video/') ? 'video'
        : mime.startsWith('audio/') ? 'audio' : 'arquivo';
      return { tipo, url, nome: m.document.file_name || 'arquivo' };
    }
    return null;
  }

  // 💬 v0.143: os cartões especiais (enquete, contato, evento, produto do
  // catálogo, pedido) que o gateway entrega num bloco com o nome do tipo.
  // Cada gateway nomeia os campos do seu jeito, então aqui se lê o que houver
  // e, no pior caso, o cartão ao menos ANUNCIA o que chegou — em vez de a
  // mensagem sumir sem deixar rastro, que era o que acontecia.
  //
  // ☎️ Regra da casa desde a v0.64: do contato sai só o nome, nunca o número.
  textoEspecial(m) {
    const tipo = String(m.type || '').toLowerCase();
    const corpo = (tipo && m[tipo] && typeof m[tipo] === 'object') ? m[tipo] : {};
    const lista = (v) => (Array.isArray(v) ? v : []).map((o) => String(o?.name || o?.title || o?.text || o || '').trim()).filter(Boolean);
    if (tipo === 'poll' || corpo.options) {
      const pergunta = String(corpo.title || corpo.name || corpo.question || '').trim() || 'sem pergunta';
      const opcoes = lista(corpo.options);
      return `📊 Enquete: ${pergunta}${opcoes.length ? ` — ${opcoes.join(' · ')}` : ''}`;
    }
    if (tipo === 'contact' || tipo === 'contact_list' || tipo === 'contacts') {
      const nomes = lista(corpo.contacts || corpo.list);
      const nome = String(corpo.name || corpo.display_name || '').trim();
      if (nomes.length) return `👤 Contatos: ${nomes.slice(0, 5).join(', ')}${nomes.length > 5 ? ` e mais ${nomes.length - 5}` : ''}`;
      return `👤 Contato: ${nome || 'sem nome'}`;
    }
    if (tipo === 'event') {
      const nome = String(corpo.name || corpo.title || '').trim() || 'sem nome';
      const desc = String(corpo.description || '').trim();
      return `📅 Evento: ${nome}${desc ? ` — ${desc}` : ''}`;
    }
    if (tipo === 'product' || tipo === 'catalog' || tipo === 'order') {
      const nome = String(corpo.title || corpo.name || corpo.order_title || '').trim();
      const preco = String(corpo.price || corpo.total || '').trim();
      const rotulo = tipo === 'order' ? '🧾 Pedido' : '🛍️ Produto';
      return `${rotulo}: ${nome || 'sem título'}${preco ? ` — ${preco}` : ''}`;
    }
    if (tipo === 'live_location') return '📍 Localização ao vivo';
    if (tipo === 'group_invite') return `👥 Convite de grupo${corpo.name ? `: ${String(corpo.name).trim()}` : ''}`;
    // Tipo que este conector ainda não sabe desenhar: anuncia em vez de sumir
    if (tipo && !['text', 'image', 'video', 'audio', 'voice', 'document', 'sticker', 'gif', 'location', 'system', 'action'].includes(tipo)) {
      return `[mensagem do tipo «${tipo}»]`;
    }
    return '';
  }

  async processar(m) {
    if (!m || !m.id || m.from_me) return;
    if (this.vistos.has(m.id)) return;
    this.vistos.add(m.id);
    if (this.vistos.size > 2000) {
      for (const v of this.vistos) { this.vistos.delete(v); if (this.vistos.size <= 1500) break; }
    }
    if (!this.aceitaChat(m)) return;
    let texto = String(
      m.text?.body
      || m.image?.caption || m.video?.caption || m.gif?.caption || m.document?.caption
      || '',
    );
    // 📍 v0.70: localização vira texto no cartão
    if (!texto && m.location && Number.isFinite(Number(m.location.latitude))) {
      const partes = [m.location.name, m.location.address].filter(Boolean);
      const coords = `${Number(m.location.latitude).toFixed(5)}, ${Number(m.location.longitude).toFixed(5)}`;
      texto = '📍 ' + (partes.length ? partes.join(' — ') + ` (${coords})` : `Localização: ${coords}`);
    }
    if (!texto) texto = this.textoEspecial(m); // 💬 v0.143
    const midia = await this.midiaDe(m);
    if (!texto && !midia) return; // avisos de sistema do próprio WhatsApp
    const autorId = String(m.from || m.phone || '').trim();
    if (autorId) this.chatDoAutor.set(autorId, { id: m.chat_id, privado: this.ehPrivado(m.chat_id) });
    // 🖼️ v0.72: foto já conhecida entra junto; desconhecida é buscada em
    // paralelo (sem atrasar a mensagem) e chega depois via onAvatar
    const avatarPronto = this.avatares.get(autorId.replace(/@.*$/, ''));
    if (avatarPronto === undefined) this.buscarAvatar(m);
    this.handlers.onMessage({
      platform: 'whatsapp',
      channel: String(m.chat_name || m.chat_id || ''),
      id: 'wa-' + String(m.id).replace(/[^A-Za-z0-9._-]/g, ''),
      author: this.autorDe(m),
      authorId: autorId,
      authorLogin: String(m.phone || '').replace(/@.*$/, ''),
      authorColor: null,
      avatar: typeof avatarPronto === 'string' ? avatarPronto : null,
      badges: [],
      runs: runsDoTexto(texto || (midia ? `[${midia.nome}]` : '')),
      midia: midia || undefined,
      // para responder e moderar direto do painel
      waChatId: m.chat_id,
      waMessageId: m.id,
      timestamp: (Number(m.timestamp) || Math.floor(Date.now() / 1000)) * 1000,
    });
  }

  async loop() {
    while (!this.parado) {
      try {
        const lista = await this.api(`/messages/list?count=100&time_from=${this.desde}`);
        const mensagens = Array.isArray(lista?.messages) ? lista.messages.slice() : [];
        // A lista vem do mais novo para o mais velho: processa em ordem real
        mensagens.sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
        let maisNova = this.desde;
        for (const m of mensagens) {
          maisNova = Math.max(maisNova, Number(m.timestamp) || 0);
          if (!this.parado) await this.processar(m);
        }
        // Avança com sobreposição: repetidas caem no dedupe por id
        this.desde = Math.max(this.desde, maisNova - JANELA_SOBREPOSICAO_S);
        if (this.errou) { this.errou = false; this.handlers.onStatus?.('connected', ''); }
      } catch (err) {
        if (this.parado) return;
        const texto = String(err.message || err);
        if (texto === 'TOKEN_RECUSADO') {
          this.handlers.onStatus?.('error', 'O gateway recusou o token — confira o token do canal no painel do Whapi.');
          return;
        }
        this.errou = true;
        this.handlers.onStatus?.('connecting', 'Sem resposta do WhatsApp (gateway) — tentando de novo... (' + texto.slice(0, 80) + ')');
      }
      // Polling educado: uma consulta a cada poucos segundos
      await new Promise((r) => setTimeout(r, this.intervaloMs));
    }
  }

  async start() {
    if (!this.token) {
      this.handlers.onStatus?.('error', 'Cole o token do canal do Whapi (o painel do Whapi entrega ao criar o canal).');
      return;
    }
    try {
      await this.api('/health?wakeup=true');
      this.handlers.onStatus?.('connected', '');
    } catch (err) {
      const texto = String(err.message || err);
      this.handlers.onStatus?.('error', texto === 'TOKEN_RECUSADO'
        ? 'O gateway recusou o token — confira o token do canal no painel do Whapi.'
        : 'Não consegui falar com o gateway do WhatsApp: ' + texto.slice(0, 120));
      return;
    }
    this.loop();
  }

  stop() { this.parado = true; }

  infoDoAutor(autorId) { return this.chatDoAutor.get(String(autorId)) ?? null; }

  // ⏳ Timeout: o WhatsApp não tem castigo nativo com prazo — o filtro local
  // do OBS Social já segura tudo, então aqui é um silêncio de propósito
  // (sem tentativa falha e sem aviso de erro no painel).
  async silenciar() { /* filtro local resolve */ }

  // 🚫 Banimento: além do filtro local, coloca o número na blacklist do
  // gateway (a pessoa não consegue mais falar com o número da live).
  async banir(autorId) {
    const id = String(autorId || '').trim();
    if (!id) return;
    await this.api(`/blacklist/${encodeURIComponent(id)}`, { method: 'PUT' });
  }

  async liberar(autorId) {
    const id = String(autorId || '').trim();
    if (!id) return;
    try { await this.api(`/blacklist/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch {}
  }

  // 📎 v0.75: resposta com arquivo — o gateway aceita a mídia em base64
  // (foto/áudio/vídeo têm rota própria; o resto vai como documento)
  async responderMidia(chatId, arq) {
    const rota = { imagem: '/messages/image', audio: '/messages/audio', video: '/messages/video' }[arq.tipo] || '/messages/document';
    const nome = String(arq.nome || 'arquivo').replace(/[^\w.\- À-ÿ]+/g, '_');
    const media = `data:${arq.mime || 'application/octet-stream'};name=${encodeURIComponent(nome)};base64,${arq.buffer.toString('base64')}`;
    await this.api(rota, { method: 'POST', body: { to: String(chatId), media }, timeoutMs: 120000 });
  }

  // 💬 Resposta do apresentador (texto sem limite: dividimos em blocos).
  // A primeira parte vai citando a mensagem original (quoted), quando o id
  // tem a cara que o gateway aceita.
  async responder(chatId, texto, replyTo) {
    const inteiro = String(texto || '');
    const quoted = /^[A-Za-z0-9._-]{4,120}$/.test(String(replyTo || '')) ? String(replyTo) : null;
    for (let i = 0; i < inteiro.length; i += LIMITE_TEXTO_MSG) {
      await this.api('/messages/text', {
        method: 'POST',
        body: {
          to: String(chatId),
          body: inteiro.slice(i, i + LIMITE_TEXTO_MSG),
          ...(i === 0 && quoted ? { quoted } : {}),
        },
      });
    }
  }
}

module.exports = { WhatsAppConnector };
