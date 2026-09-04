// Conector de chat do WhatsApp — modo BIBLIOTECA LOCAL (Labs v0.69).
// A segunda forma aprovada: em vez do gateway pago (Whapi), uma biblioteca
// de código aberto (Baileys) rodando 100% NO COMPUTADOR do streamer — sem
// gateway, sem mensalidade e sem webhook. A biblioteca é instalada SOB
// DEMANDA (npm) numa pasta própria dentro de data/ — nada vem embutido.
//
// ⚠️ O risco é o MESMO do Whapi: é o protocolo não autorizado pela Meta,
// e o número usado pode ser banido. Número SECUNDÁRIO dedicado à live.
//
// Pareamento: a biblioteca entrega um código QR — o servidor o transforma
// em imagem no card de Conexões e o streamer escaneia com o WhatsApp do
// número da live (Aparelhos conectados). A sessão fica guardada em
// data/whatsapp-sessao e sobrevive a reinícios.
'use strict';

const fs = require('fs');
const path = require('path');
// ✍️ v0.145: os marcadores de formatação do WhatsApp (*negrito*, _itálico_,
// ~tachado~, `mono`) viram estilo de verdade no painel e nas telas
const formato = require('./formato.js');

const LIMITE_ARQUIVO = 20 * 1024 * 1024;
// 🔒 v0.127.1: códigos de desconexão que NÃO adiantam reconectar sozinho
// (sessão encerrada, proibido, versão recusada, outro aparelho assumiu)
const CODIGOS_TERMINAIS = new Set([401, 403, 411, 440]);
const LIMITE_TEXTO_MSG = 60000;

function runsDoTexto(texto) {
  return formato.runsDoTexto(texto);
}

// 📏 v0.142: nem todo número do protocolo é um número de JavaScript. A
// biblioteca entrega os inteiros grandes como um objeto {low, high} — e
// `Number()` neles dá NaN. Serve para o tamanho do arquivo, para a data de um
// evento e para o preço de um produto do catálogo.
function numeroDoProtocolo(valor) {
  if (valor == null) return 0;
  if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;
  if (typeof valor === 'bigint') return Number(valor);
  if (typeof valor === 'string') return Number(valor) || 0;
  if (typeof valor === 'object') {
    if (typeof valor.toNumber === 'function') { try { return Number(valor.toNumber()) || 0; } catch { /* segue na conta à mão */ } }
    const alto = Number(valor.high) || 0;
    const baixo = Number(valor.low) || 0;
    if (alto || baixo) return alto * 4294967296 + (baixo >>> 0);
  }
  return 0;
}

// 🧹 v0.142: o recado do erro vai para a tela — endereço de arquivo vira só o
// nome do servidor, para o cartão não carregar um link enorme e sem serventia
function motivoLimpo(err) {
  return String(err && err.message ? err.message : err)
    .replace(/https?:\/\/([^/\s]+)\S*/g, '$1')
    .slice(0, 160);
}

// 💵 v0.143: o catálogo manda o preço multiplicado por mil, com o código da
// moeda ao lado. O preço é escrito no jeito do PAÍS DA MOEDA — R$ 4.500,00 e
// não R$4,500.00 —, que é como o WhatsApp mostra e como o vendedor anunciou.
// Seguir o idioma do computador do streamer trocaria o ponto pela vírgula num
// preço que não é dele. Moeda de fora da lista: o código na frente do número.
const PAIS_DA_MOEDA = {
  BRL: 'pt-BR', PTE: 'pt-PT', AOA: 'pt-AO', MZN: 'pt-MZ',
  USD: 'en-US', CAD: 'en-CA', GBP: 'en-GB', AUD: 'en-AU',
  EUR: 'de-DE', CHF: 'de-CH', JPY: 'ja-JP', KRW: 'ko-KR', CNY: 'zh-CN',
  ARS: 'es-AR', CLP: 'es-CL', COP: 'es-CO', MXN: 'es-MX', PEN: 'es-PE',
  PYG: 'es-PY', UYU: 'es-UY', BOB: 'es-BO', RUB: 'ru-RU', TRY: 'tr-TR',
};
function dinheiro(valor1000, moeda) {
  const n = numeroDoProtocolo(valor1000) / 1000;
  if (!n) return '';
  const cod = String(moeda || '').trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(cod)) return n.toFixed(2);
  const onde = PAIS_DA_MOEDA[cod];
  if (onde) {
    try { return new Intl.NumberFormat(onde, { style: 'currency', currency: cod }).format(n); } catch { /* segue no formato simples */ }
  }
  return `${cod} ${n.toFixed(2)}`;
}

// 📅 v0.143: a data do evento chega em segundos (e como número grande do
// protocolo). Vai para o cartão escrita como o computador do streamer escreve.
function dataDoProtocolo(segundos) {
  const s = numeroDoProtocolo(segundos);
  if (!s) return '';
  try { return new Date(s * 1000).toLocaleString(); } catch { return ''; }
}

// 💬 v0.143: os cartões especiais do WhatsApp (muitos deles do WhatsApp
// Business) que o painel não conhecia e deixava cair no vazio: contato,
// evento, enquete, produto do catálogo, pedido e convite de grupo.
//
// ☎️ Regra da casa desde a v0.64: telefone NUNCA entra. O cartão de contato
// carrega um vCard com o número dentro — daqui sai só o nome.
const RESUMO_ESPECIAL = {
  contactMessage: (v) => `👤 Contato: ${String(v.displayName || '').trim() || 'sem nome'}`,
  contactsArrayMessage: (v) => {
    const nomes = (v.contacts || []).map((c) => String(c.displayName || '').trim()).filter(Boolean);
    const titulo = String(v.displayName || '').trim();
    if (!nomes.length) return `👤 Contatos${titulo ? `: ${titulo}` : ''}`;
    const mostra = nomes.slice(0, 5).join(', ');
    return `👤 Contatos: ${mostra}${nomes.length > 5 ? ` e mais ${nomes.length - 5}` : ''}`;
  },
  eventMessage: (v) => {
    const partes = [`📅 Evento: ${String(v.name || '').trim() || 'sem nome'}`];
    const inicio = dataDoProtocolo(v.startTime);
    const fim = dataDoProtocolo(v.endTime);
    if (inicio) partes.push(fim ? `${inicio} até ${fim}` : inicio);
    const onde = String(v.location?.name || v.location?.address || '').trim();
    if (onde) partes.push(`📍 ${onde}`);
    const desc = String(v.description || '').trim();
    if (desc) partes.push(desc);
    if (v.isCanceled) partes.push('(cancelado)');
    return partes.join(' — ');
  },
  pollCreationMessage: (v) => {
    const nome = String(v.name || '').trim() || 'sem pergunta';
    const opcoes = (v.options || []).map((o) => String(o.optionName || '').trim()).filter(Boolean);
    return `📊 Enquete: ${nome}${opcoes.length ? ` — ${opcoes.join(' · ')}` : ''}`;
  },
  productMessage: (v) => {
    const p = v.product || {};
    const partes = [`🛍️ ${String(p.title || '').trim() || 'produto do catálogo'}`];
    const preco = dinheiro(p.salePriceAmount1000 || p.priceAmount1000, p.currencyCode);
    if (preco) partes.push(preco);
    const desc = String(p.description || v.body || '').trim();
    if (desc) partes.push(desc);
    return partes.join(' — ');
  },
  orderMessage: (v) => {
    const partes = [`🧾 Pedido: ${String(v.orderTitle || '').trim() || 'sem título'}`];
    const itens = Number(v.itemCount) || 0;
    if (itens) partes.push(`${itens} ${itens === 1 ? 'item' : 'itens'}`);
    const total = dinheiro(v.totalAmount1000, v.totalCurrencyCode);
    if (total) partes.push(total);
    const recado = String(v.message || '').trim();
    if (recado) partes.push(recado);
    return partes.join(' — ');
  },
  liveLocationMessage: (v) => {
    const coords = Number.isFinite(Number(v.degreesLatitude))
      ? ` (${Number(v.degreesLatitude).toFixed(5)}, ${Number(v.degreesLongitude).toFixed(5)})` : '';
    const legenda = String(v.caption || '').trim();
    return `📍 Localização ao vivo${coords}${legenda ? ` — ${legenda}` : ''}`;
  },
  groupInviteMessage: (v) => {
    const nome = String(v.groupName || '').trim();
    const legenda = String(v.caption || '').trim();
    return `👥 Convite de grupo${nome ? `: ${nome}` : ''}${legenda ? ` — ${legenda}` : ''}`;
  },
};
// As enquetes trocam de versão de tempos em tempos; o desenho é o mesmo.
for (const v of ['pollCreationMessageV2', 'pollCreationMessageV3', 'pollCreationMessageV4', 'pollCreationMessageV5']) {
  RESUMO_ESPECIAL[v] = RESUMO_ESPECIAL.pollCreationMessage;
}

const EXT_POR_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm',
  'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav',
  'application/pdf': 'pdf', 'text/plain': 'txt',
};

class WhatsAppLocalConnector {
  // options: { dirEstado, carregarBaileys() → módulo|null, aoQr(qrTexto) }
  constructor(channel, handlers, options = {}) {
    this.grupo = String(channel || '').trim().replace(/^\*$/, '');
    this.handlers = handlers || {};
    this.dirEstado = options.dirEstado;
    this.carregarBaileys = options.carregarBaileys;
    this.aoQr = typeof options.aoQr === 'function' ? options.aoQr : () => {};
    this.parado = false;
    this.sock = null;
    this.vistos = new Set();
    this.abriuUmaVez = false;
    // 🖼️ v0.72: foto de perfil por autor — buscada UMA vez por pessoa.
    // undefined = nunca buscado · string = achada · null = sem foto/privada
    this.avatares = new Map();
    this.avataresPend = new Set();
    // 💬 v0.144: as últimas mensagens recebidas, guardadas inteiras. A
    // biblioteca precisa da mensagem ORIGINAL (não só do id dela) para
    // marcar a resposta do apresentador como resposta àquela mensagem —
    // era por isso que a citação saía no modo gateway e não saía aqui.
    this.recentes = new Map();
  }

  // Guarda só o necessário para citar depois, e não deixa a memória crescer
  lembrarParaCitar(msg) {
    const id = String(msg?.key?.id || '');
    if (!id || !msg.message) return;
    this.recentes.set(id, { key: msg.key, message: msg.message });
    while (this.recentes.size > 150) this.recentes.delete(this.recentes.keys().next().value);
  }

  // A mensagem que o apresentador está respondendo, se ainda a temos
  citada(replyTo) {
    const id = String(replyTo || '').trim();
    if (!id || !/^[A-Za-z0-9._:-]{1,120}$/.test(id)) return null;
    return this.recentes.get(id) || null;
  }

  // 👥 v0.141: conversa direta é só ela mesma. Grupo e comunidade são
  // «@g.us», canal é «@newsletter» e lista de transmissão é «@broadcast» —
  // esses dois últimos passavam por privados e entravam sem ninguém pedir.
  ehPrivado(jid) { return !/@(g\.us|newsletter|broadcast)$/i.test(String(jid || '')); }

  aceitaChat(jid) {
    if (!jid) return false;
    if (this.ehPrivado(jid)) return true; // conversa direta entra SEMPRE
    // 👥 v0.141: quem só quer conversa direta desliga isso nas Conexões
    if (this.handlers.aceitaGrupos && this.handlers.aceitaGrupos() === false) return false;
    if (!this.grupo) return true;
    return String(jid).toLowerCase() === this.grupo.toLowerCase();
  }

  autorDe(msg, autorJid) {
    const nome = String(msg.pushName || '').trim();
    if (nome) return nome;
    const fone = String(autorJid || '').replace(/@.*$/, '').replace(/:.*$/, '');
    return fone ? '+' + fone.replace(/^\+/, '') : 'WhatsApp';
  }

  // 🖼️ v0.72: foto de perfil do autor pela própria biblioteca
  // (profilePictureUrl). Quem esconde a foto fica com as iniciais (a
  // biblioteca recusa e cai no catch). A foto é baixada para a quarentena
  // local; quando chega DEPOIS da primeira mensagem, o servidor espalha
  // retroativamente (handlers.onAvatar).
  async buscarAvatar(autorJid, chave) {
    const id = String(autorJid || '');
    if (!id || !this.sock || typeof this.sock.profilePictureUrl !== 'function') return;
    if (this.avatares.has(id) || this.avataresPend.has(id)) return;
    this.avataresPend.add(id);
    try {
      const link = await this.sock.profilePictureUrl(id, 'image');
      let url = null;
      if (typeof link === 'string' && /^https?:\/\//.test(link) && typeof this.handlers.salvarMidia === 'function') {
        const r = await fetch(link, { signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length && buf.length <= LIMITE_ARQUIVO) url = this.handlers.salvarMidia(buf, 'jpg', 'avatar.jpg');
        }
      }
      this.avatares.set(id, url || null);
      if (url) this.handlers.onAvatar?.(chave, url);
    } catch { this.avatares.set(id, null); } finally { this.avataresPend.delete(id); }
  }

  // 📦 v0.140.4: o conteúdo nem sempre vem na mão — o WhatsApp EMBRULHA a
  // mensagem quando ela é temporária, «ver uma vez» ou editada. Sem
  // desembrulhar, o programa não achava nem a mídia nem o texto e a mensagem
  // sumia inteira. A própria biblioteca sabe abrir esses embrulhos; a versão
  // manual aqui embaixo é a rede de segurança.
  conteudoDe(msg) {
    const bruto = (msg && msg.message) || {};
    try {
      const abrir = this.lib && this.lib.extractMessageContent;
      if (typeof abrir === 'function') {
        const aberto = abrir(bruto);
        if (aberto && typeof aberto === 'object') return aberto;
      }
    } catch { /* segue no desembrulho manual */ }
    let dentro = bruto;
    for (let volta = 0; volta < 4; volta++) {
      const proximo = dentro.ephemeralMessage?.message
        || dentro.viewOnceMessage?.message
        || dentro.viewOnceMessageV2?.message
        || dentro.viewOnceMessageV2Extension?.message
        || dentro.documentWithCaptionMessage?.message
        || dentro.editedMessage?.message;
      if (!proximo) break;
      dentro = proximo;
    }
    return dentro;
  }

  async midiaDe(msg) {
    if (typeof this.handlers.salvarMidia !== 'function' || !this.lib) return null;
    const c = this.conteudoDe(msg);
    // 🛍️ v0.143: o produto do catálogo traz a foto dentro dele. A biblioteca
    // não sabe baixar um «productMessage» (ela procura o endereço no lugar
    // errado), então a foto é entregue a ela como a imagem que de fato é.
    const fotoDoProduto = c.productMessage?.product?.productImage;
    const alvo = c.imageMessage ? ['imagem', c.imageMessage, 'foto.jpg']
      : c.stickerMessage ? ['imagem', c.stickerMessage, 'figurinha.webp']
      : c.audioMessage ? ['audio', c.audioMessage, c.audioMessage.ptt ? 'voz.ogg' : 'audio.ogg']
      : c.videoMessage ? ['video', c.videoMessage, 'video.mp4']
      : c.documentMessage ? [null, c.documentMessage, c.documentMessage.fileName || 'arquivo.bin']
      : fotoDoProduto ? ['imagem', fotoDoProduto, 'produto.jpg']
      : null;
    if (!alvo) return null;
    const [tipoBase, conteudo, nomeSugerido] = alvo;
    // Quando o alvo está embrulhado no produto, a biblioteca recebe a foto
    // solta (a chave e o endereço são os dela) com a mesma identidade da
    // mensagem original — é o que o pedido de reenvio precisa.
    const msgParaBaixar = fotoDoProduto && conteudo === fotoDoProduto
      ? { ...msg, message: { imageMessage: fotoDoProduto } }
      : msg;
    // 📦 v0.140.4: o nome do anexo já vale mesmo quando o arquivo não vem —
    // é o que aparece no cartão para o apresentador saber o que chegou
    const rotulo = c.audioMessage?.ptt ? 'mensagem de voz'
      : c.documentMessage ? (c.documentMessage.fileName || 'arquivo')
      : c.stickerMessage ? 'figurinha'
      : c.imageMessage ? 'foto' : c.videoMessage ? 'vídeo'
      : c.productMessage ? 'foto do produto' : 'anexo';
    // 🧾 v0.142: a ficha técnica do anexo — o retrato do que chegou, sem
    // nada de pessoal (não entra texto, nome nem telefone). É ela que
    // aparece no cartão quando o arquivo não vem, para o problema poder
    // ser contado a quem cuida do programa em vez de morrer no console.
    const ficha = this.fichaDoAnexo(c, conteudo, tipoBase);
    const naoVeio = (motivo) => {
      console.error(`  ⚠️ WhatsApp: não consegui baixar «${rotulo}» de uma mensagem — ${motivo}. [${ficha}]`);
      return { nome: rotulo, falhou: motivo, ficha };
    };
    if (numeroDoProtocolo(conteudo.fileLength) > LIMITE_ARQUIVO) return naoVeio('passa do tamanho máximo');
    const baixar = this.lib.downloadMediaMessage;
    if (typeof baixar !== 'function') return naoVeio('a biblioteca não sabe baixar mídia');
    // 🧭 v0.142: sem endereço utilizável, a biblioteca monta uma URL sem pé
    // nem cabeça e o erro que sai não explica nada. Melhor dizer logo.
    // (a biblioteca também sabe usar o caminho da miniatura quando é só o que
    // veio — por isso ele conta como endereço válido aqui)
    const temUrl = /^https:\/\/mmg\.whatsapp\.net\//.test(String(conteudo.url || ''));
    if (!temUrl && !conteudo.directPath && !conteudo.thumbnailDirectPath) {
      return naoVeio('a mensagem chegou sem o endereço do arquivo');
    }
    if (!conteudo.mediaKey) return naoVeio('a mensagem chegou sem a chave para abrir o arquivo');
    // 📦 v0.140.4: a descriptografia e o CDN do WhatsApp falham de vez em
    // quando; uma segunda tentativa resolve o tropeço e não custa nada
    for (let tentativa = 1; tentativa <= 2; tentativa++) {
      try {
        // 🔄 v0.142: na segunda tentativa, PEDE ao celular para subir o
        // arquivo de novo antes de baixar. A biblioteca só faz esse pedido
        // sozinha quando o CDN responde 404/410 — e o caso comum (o arquivo
        // que já saiu do CDN, ou a descriptografia que falhou) não é nenhum
        // dos dois. É por isso que uma figurinha baixava e a outra não.
        if (tentativa === 2) await this.pedirReenvio(msgParaBaixar);
        // 🔒 v0.127.1: o fileLength é declarado por quem mandou — baixa em
        // FLUXO, contando os bytes, e corta na hora ao passar do teto
        const fluxo = await baixar(msgParaBaixar, 'stream', {}, {
          logger: this.loggerMudo(),
          reuploadRequest: (m) => (this.sock?.updateMediaMessage
            ? this.sock.updateMediaMessage(m)
            : Promise.reject(new Error('a conexão caiu no meio do download'))),
        });
        if (!fluxo || typeof fluxo[Symbol.asyncIterator] !== 'function') throw new Error('a biblioteca não devolveu o arquivo');
        const partes = [];
        let total = 0;
        for await (const peca of fluxo) {
          const parte = Buffer.isBuffer(peca) ? peca : Buffer.from(peca);
          total += parte.length;
          if (total > LIMITE_ARQUIVO) { try { fluxo.destroy(); } catch {} return naoVeio('passa do tamanho máximo'); }
          partes.push(parte);
        }
        const buffer = Buffer.concat(partes);
        if (!buffer.length) throw new Error('veio vazio');
        return this.guardarMidia(buffer, conteudo, nomeSugerido, tipoBase, rotulo) || naoVeio('não deu para guardar no disco');
      } catch (err) {
        if (tentativa === 2) return naoVeio(motivoLimpo(err));
        await new Promise((r) => setTimeout(r, 700));
      }
    }
    return naoVeio('desisti depois de duas tentativas');
  }

  // 🔄 v0.142: pede ao celular pareado para subir o arquivo de novo. É o que
  // salva a mídia que já saiu do CDN do WhatsApp — o caso clássico de «uma
  // figurinha veio e a outra não». Falhar aqui não é problema: a tentativa
  // de baixar segue mesmo assim, com o endereço que já tínhamos.
  async pedirReenvio(msg) {
    if (!this.sock?.updateMediaMessage) return;
    try { await this.sock.updateMediaMessage(msg); } catch { /* segue com o endereço antigo */ }
  }

  // 🧾 v0.142: o retrato técnico do anexo, para o cartão poder contar o que
  // aconteceu. Só campos da PLATAFORMA — nada de texto, nome ou telefone.
  fichaDoAnexo(conteudoAberto, midia, tipoBase) {
    const qual = Object.keys(conteudoAberto || {}).find((k) => k.endsWith('Message')) || 'desconhecido';
    if (conteudoAberto?.productMessage?.product?.productImage === midia) tipoBase = tipoBase || 'imagem';
    const partes = [
      qual,
      String(midia.mimetype || 'sem mimetype').split(';')[0],
      tipoBase || 'sem tipo',
      `${numeroDoProtocolo(midia.fileLength)}B`,
    ];
    if (midia.isAnimated) partes.push('animada');
    if (midia.isAvatar) partes.push('avatar');
    if (midia.isLottie) partes.push('lottie');
    partes.push(midia.url ? 'url' : 'sem url');
    partes.push(midia.directPath ? 'directPath' : 'sem directPath');
    partes.push(midia.mediaKey ? 'chave' : 'sem chave');
    return partes.join(' · ');
  }

  // Grava o arquivo baixado e devolve o bloco de mídia da mensagem
  guardarMidia(buffer, conteudo, nomeSugerido, tipoBase, rotulo) {
    try {
      const mime = String(conteudo.mimetype || '').split(';')[0];
      const ext = EXT_POR_MIME[String(conteudo.mimetype || '')] || EXT_POR_MIME[mime]
        || (nomeSugerido.match(/\.([A-Za-z0-9]{1,8})$/) || [])[1] || 'bin';
      const url = this.handlers.salvarMidia(buffer, ext.toLowerCase(), nomeSugerido);
      if (!url) return null;
      const mimeTipo = mime.startsWith('image/') ? 'imagem' : mime.startsWith('video/') ? 'video'
        : mime.startsWith('audio/') ? 'audio' : 'arquivo';
      const tipo = tipoBase || mimeTipo;
      const duracao = conteudo.seconds;
      return { tipo, url, nome: rotulo, ...(duracao ? { duracao } : {}) };
    } catch { return null; }
  }

  textoDe(msg) {
    const c = this.conteudoDe(msg);
    const texto = String(
      c.conversation
      || c.extendedTextMessage?.text
      || c.imageMessage?.caption || c.videoMessage?.caption || c.documentMessage?.caption
      || '',
    );
    if (texto) return texto;
    // 📍 v0.70: localização vira texto no cartão
    const loc = c.locationMessage;
    if (loc && Number.isFinite(Number(loc.degreesLatitude))) {
      const partes = [loc.name, loc.address].filter(Boolean);
      const coords = `${Number(loc.degreesLatitude).toFixed(5)}, ${Number(loc.degreesLongitude).toFixed(5)}`;
      return '📍 ' + (partes.length ? partes.join(' — ') + ` (${coords})` : `Localização: ${coords}`);
    }
    // 💬 v0.143: contato, evento, enquete, produto do catálogo, pedido...
    // Antes nenhum deles tinha texto nem anexo, então a mensagem inteira era
    // descartada e o apresentador nunca sabia que algo tinha chegado.
    for (const [chave, resumir] of Object.entries(RESUMO_ESPECIAL)) {
      if (c[chave]) {
        try { return String(resumir(c[chave]) || '').slice(0, LIMITE_TEXTO_MSG); } catch { return ''; }
      }
    }
    return '';
  }

  async processar(msg) {
    if (!msg?.key || msg.key.fromMe) return;
    const idMsg = String(msg.key.id || '');
    if (!idMsg || this.vistos.has(idMsg)) return;
    this.vistos.add(idMsg);
    if (this.vistos.size > 2000) {
      for (const v of this.vistos) { this.vistos.delete(v); if (this.vistos.size <= 1500) break; }
    }
    const jid = String(msg.key.remoteJid || '');
    if (!this.aceitaChat(jid)) return;
    const autorJid = String(msg.key.participant || jid);
    // 💬 v0.144: guarda a mensagem inteira ANTES de qualquer coisa poder
    // falhar — é dela que sai a citação quando o apresentador responder
    this.lembrarParaCitar(msg);
    const texto = this.textoDe(msg);
    const anexo = await this.midiaDe(msg);
    // 📦 v0.140.4: o arquivo não veio, mas a MENSAGEM veio. Antes, sem texto
    // junto, ela era descartada aqui e o apresentador nunca ficava sabendo
    // que alguém tinha escrito — sumia sem deixar rastro. Agora o cartão
    // aparece dizendo o que era, e o motivo fica no console do programa.
    const anexoFalhou = !!(anexo && anexo.falhou);
    const midia = anexoFalhou ? null : anexo;
    if (!texto && !anexo) return;
    // 🖼️ v0.72: foto já conhecida entra junto; desconhecida é buscada em
    // paralelo (sem atrasar a mensagem) e chega depois via onAvatar
    const fone = autorJid.replace(/@.*$/, '').replace(/:.*$/, '');
    const avatarPronto = this.avatares.get(autorJid);
    if (avatarPronto === undefined) this.buscarAvatar(autorJid, fone || this.autorDe(msg, autorJid));
    this.handlers.onMessage({
      platform: 'whatsapp',
      channel: jid,
      id: 'wa-' + idMsg.replace(/[^A-Za-z0-9._-]/g, ''),
      author: this.autorDe(msg, autorJid),
      authorId: autorJid,
      authorLogin: fone,
      authorColor: null,
      avatar: typeof avatarPronto === 'string' ? avatarPronto : null,
      badges: [],
      runs: runsDoTexto(texto
        || (anexoFalhou ? `[${anexo.nome} que não chegou]` : midia ? `[${midia.nome}]` : '')),
      midia: midia || undefined,
      // 🧾 v0.142: o arquivo não veio — o cartão do painel mostra o porquê e
      // deixa copiar a ficha. Antes isso morria no console, que ninguém lê.
      anexoErro: anexoFalhou ? { nome: anexo.nome, motivo: anexo.falhou, ficha: anexo.ficha || '' } : undefined,
      waChatId: jid,
      waMessageId: idMsg,
      timestamp: (Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000)) * 1000,
    });
  }

  loggerMudo() {
    const nada = () => {};
    const l = { level: 'silent', trace: nada, debug: nada, info: nada, warn: nada, error: nada, fatal: nada };
    l.child = () => l;
    return l;
  }

  async start() {
    const lib = typeof this.carregarBaileys === 'function' ? this.carregarBaileys() : null;
    if (!lib) {
      this.handlers.onStatus?.('error', 'A biblioteca local ainda não está instalada — baixe no card do WhatsApp em 🔌 Conexões.');
      return;
    }
    this.lib = lib;
    const makeWASocket = lib.makeWASocket || lib.default;
    const useMultiFileAuthState = lib.useMultiFileAuthState;
    if (typeof makeWASocket !== 'function' || typeof useMultiFileAuthState !== 'function') {
      this.handlers.onStatus?.('error', 'A biblioteca local veio incompleta — tente baixar de novo no card do WhatsApp.');
      return;
    }
    try {
      const { state: auth, saveCreds } = await useMultiFileAuthState(this.dirEstado);
      // 🔒 v0.127.1: as chaves da sessão são só do dono (0700/0600; no
      // Windows as permissões POSIX não existem — fica como está)
      this.protegerSessao();
      const sock = makeWASocket({
        auth,
        printQRInTerminal: false,
        logger: this.loggerMudo(),
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });
      this.sock = sock;
      sock.ev.on('creds.update', () => {
        Promise.resolve().then(() => saveCreds()).then(() => this.protegerSessao(), () => {});
      });
      sock.ev.on('connection.update', (up) => {
        // 🔒 v0.127.1: socket antigo (já trocado por uma reconexão) não manda
        // mais nada — senão duas conexões nasciam em paralelo
        if (this.parado || this.sock !== sock) return;
        if (up.qr) {
          // 📱 QR novo: o card de Conexões mostra para escanear
          this.aoQr(String(up.qr));
          this.handlers.onStatus?.('connecting', 'Escaneie o QR no card do WhatsApp (WhatsApp → Aparelhos conectados).');
        }
        if (up.connection === 'open') {
          this.abriuUmaVez = true;
          this.retryMs = 4000; // conectou: a espera volta ao início
          this.aoQr('');
          this.handlers.onStatus?.('connected', '');
        }
        if (up.connection === 'close') {
          const codigo = Number(up.lastDisconnect?.error?.output?.statusCode) || 0;
          // 401 = sessão encerrada no celular: precisa parear de novo.
          // 🔒 v0.127.1: 403/411/440 também são o fim da linha — reconectar
          // em loop só iria martelar o WhatsApp
          if (CODIGOS_TERMINAIS.has(codigo)) {
            this.aoQr('');
            this.handlers.onStatus?.('error', codigo === 401
              ? 'A sessão foi encerrada no celular — apague a sessão no card e escaneie o QR de novo.'
              : codigo === 440
                ? 'Outro aparelho assumiu esta sessão do WhatsApp (código 440) — reconecte pelo card quando quiser.'
                : `O WhatsApp recusou a conexão (código ${codigo}) — apague a sessão no card e escaneie o QR de novo.`);
            return;
          }
          if (!this.parado) {
            // 🔒 v0.127.1: espera crescente (4s → 8s → ... → 60s)
            const espera = this.retryMs || 4000;
            this.retryMs = Math.min(espera * 2, 60000);
            this.handlers.onStatus?.('connecting', `Conexão caiu — reconectando em ${Math.round(espera / 1000)}s...`);
            setTimeout(() => { if (!this.parado && this.sock === sock) this.start(); }, espera);
          }
        }
      });
      sock.ev.on('messages.upsert', ({ messages, type }) => {
        if (type !== 'notify' || this.parado || this.sock !== sock) return;
        for (const m of messages || []) this.processar(m).catch(() => {});
      });
    } catch (err) {
      this.handlers.onStatus?.('error', 'A biblioteca local não conseguiu iniciar: ' + String(err.message || err).slice(0, 120));
    }
  }

  // 🔒 v0.127.1: pasta da sessão 0700 e arquivos 0600 (no-op no Windows)
  protegerSessao() {
    if (process.platform === 'win32' || !this.dirEstado) return;
    try { fs.chmodSync(this.dirEstado, 0o700); } catch {}
    try {
      for (const nome of fs.readdirSync(this.dirEstado)) {
        try { fs.chmodSync(path.join(this.dirEstado, nome), 0o600); } catch {}
      }
    } catch {}
  }

  stop() {
    this.parado = true;
    try { this.sock?.end?.(); } catch {}
    try { this.sock?.ws?.close?.(); } catch {}
  }

  // ⏳ Timeout: sem castigo nativo — o filtro local do OBS Social segura
  async silenciar() { /* filtro local resolve */ }

  // 🚫 Banimento: além do filtro local, bloqueia o contato no WhatsApp
  async banir(autorId) {
    const jid = String(autorId || '').trim();
    if (!jid || !this.sock?.updateBlockStatus) return;
    await this.sock.updateBlockStatus(jid, 'block');
  }

  async liberar(autorId) {
    const jid = String(autorId || '').trim();
    if (!jid || !this.sock?.updateBlockStatus) return;
    try { await this.sock.updateBlockStatus(jid, 'unblock'); } catch {}
  }

  // 📎 v0.75: resposta com arquivo pela biblioteca local
  // 💬 v0.144: citando a mensagem original, como no modo gateway
  async responderMidia(chatId, arq, replyTo) {
    if (!this.sock?.sendMessage) throw new Error('a conexão local ainda não está pronta');
    const conteudo = arq.tipo === 'imagem' ? { image: arq.buffer }
      : arq.tipo === 'audio' ? { audio: arq.buffer, mimetype: arq.mime || 'audio/mpeg' }
      : arq.tipo === 'video' ? { video: arq.buffer }
      : { document: arq.buffer, fileName: String(arq.nome || 'arquivo'), mimetype: arq.mime || 'application/octet-stream' };
    const quoted = this.citada(replyTo);
    await this.sock.sendMessage(String(chatId), conteudo, quoted ? { quoted } : undefined);
  }

  // 💬 Resposta do apresentador (dividida em blocos, como sempre).
  // 💬 v0.144: o primeiro bloco vai CITANDO a mensagem original — é o que
  // faz a resposta chegar grudada nela no WhatsApp de quem escreveu. Sem a
  // mensagem guardada (reinício do programa, conversa antiga), a resposta
  // sai do mesmo jeito, só que solta: melhor isso do que não sair.
  async responder(chatId, texto, replyTo) {
    if (!this.sock?.sendMessage) throw new Error('a conexão local ainda não está pronta');
    const quoted = this.citada(replyTo);
    const inteiro = String(texto || '');
    for (let i = 0; i < inteiro.length; i += LIMITE_TEXTO_MSG) {
      const bloco = { text: inteiro.slice(i, i + LIMITE_TEXTO_MSG) };
      const opcoes = i === 0 && quoted ? { quoted } : undefined;
      await this.sock.sendMessage(String(chatId), bloco, opcoes);
    }
  }
}

module.exports = { WhatsAppLocalConnector };
