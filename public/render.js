// Funcoes compartilhadas entre o painel e o overlay.
'use strict';

const PLATFORMS = {
  twitch: {
    name: 'Twitch',
    color: '#9146ff',
    icon: 'M4 2 2 6v14h5v3h3l3-3h4l5-5V2H4zm16 11-3 3h-4l-3 3v-3H6V4h14v9zM13 7h2v5h-2V7zm-5 0h2v5H8V7z',
  },
  youtube: {
    name: 'YouTube',
    color: '#ff0033',
    icon: 'M23 7.5s-.2-1.6-.9-2.3c-.9-.9-1.9-.9-2.4-1C16.4 4 12 4 12 4s-4.4 0-7.7.2c-.5.1-1.5.1-2.4 1-.7.7-.9 2.3-.9 2.3S.8 9.4.8 11.3v1.4c0 1.9.2 3.8.2 3.8s.2 1.6.9 2.3c.9.9 2 .9 2.5 1 1.9.2 7.6.2 7.6.2s4.4 0 7.7-.2c.5-.1 1.5-.1 2.4-1 .7-.7.9-2.3.9-2.3s.2-1.9.2-3.8v-1.4c0-1.9-.2-3.8-.2-3.8zM9.8 15.3V8.7l6.2 3.3-6.2 3.3z',
  },
  kick: {
    name: 'Kick',
    color: '#53fc18',
    icon: 'M3 2h6v6h2V6h2V4h2V2h6v6h-2v2h-2v2h2v2h2v6h-6v-2h-2v-2h-2v2H9v6H3V2z',
  },
  bilibili: {
    name: 'Bilibili',
    color: '#00a1d6',
    icon: 'M17.8 4.6 15.4 2l-1.1 1 1.6 1.8H8.1L9.7 3 8.6 2 6.2 4.6H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h1c0 .8.7 1.4 1.5 1.4S8 20.4 8 19.6h8c0 .8.7 1.4 1.5 1.4s1.5-.6 1.5-1.4h1a2 2 0 0 0 2-2v-11a2 2 0 0 0-2-2h-2.2zM20 17.6H4V6.6h16v11zM8.5 9.5 12 11l3.5-1.5.7 1.4L12.7 12.5v2h-1.4v-2L7.8 10.9l.7-1.4z',
  },
  telegram: {
    name: 'Telegram',
    color: '#26a5e4',
    icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm4.9 6.9-1.7 8c-.1.6-.5.7-1 .5l-2.6-1.9-1.3 1.2c-.1.1-.3.3-.5.3l.2-2.7 4.9-4.4c.2-.2 0-.3-.3-.1l-6.1 3.8-2.6-.8c-.6-.2-.6-.6.1-.9l10.1-3.9c.5-.2.9.1.8.9z',
  },
  whatsapp: {
    name: 'WhatsApp',
    color: '#25d366',
    icon: 'M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 2a8 8 0 1 1-4.1 14.9l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 0 1 12 4zm-3 3.8c-.2 0-.5.1-.7.3-.2.3-.9.9-.9 2.1s.9 2.4 1 2.6c.1.2 1.8 2.8 4.4 3.8 2.2.9 2.6.7 3.1.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.2-.2-.5-.3l-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.3-.1-1.1-.4-2.1-1.3-.8-.7-1.3-1.5-1.4-1.8-.1-.2 0-.4.1-.5l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5L9.6 8.2c-.2-.4-.4-.4-.6-.4z',
  },
  doacao: {
    name: 'Doação',
    color: '#e91e63',
    icon: 'M12 21.3 10.5 20C5.4 15.4 2 12.3 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.8-3.4 6.9-8.5 11.5L12 21.3z',
  },
};

// ✍️ v0.109/v0.110: a formatação de TEXTO de uma peça, como declarações CSS —
// fonte, negrito/itálico/sublinhado/maiúsculas ('auto' = como a peça é de
// fábrica), alinhamento (também na caixa flex centrada), contorno da letra e
// espaçamento. Vive aqui porque vale para TODO texto dos overlays: as peças
// do destaque (cartão padrão, molde com arte ou em peças), as dos widgets
// (nos presets ou soltas), o aviso e o chat fixo — todos usam a mesma régua.
function formatoDaPeca(p) {
  const d = [];
  if (!p) return d;
  const fonte = String(p.fonte || '').replace(/["'\\;{}<>]/g, '').trim();
  if (fonte) d.push(`font-family: '${fonte}', 'Segoe UI', system-ui, sans-serif`);
  if (p.negrito === 'sim') d.push('font-weight: 800'); else if (p.negrito === 'nao') d.push('font-weight: 400');
  if (p.italico === 'sim') d.push('font-style: italic'); else if (p.italico === 'nao') d.push('font-style: normal');
  if (p.sublinhado === 'sim') d.push('text-decoration: underline'); else if (p.sublinhado === 'nao') d.push('text-decoration: none');
  if (p.maiusculas === 'sim') d.push('text-transform: uppercase'); else if (p.maiusculas === 'nao') d.push('text-transform: none');
  if (['left', 'center', 'right'].includes(p.alinhar)) {
    d.push(`text-align: ${p.alinhar}`);
    d.push(`justify-content: ${p.alinhar === 'left' ? 'flex-start' : p.alinhar === 'right' ? 'flex-end' : 'center'}`);
  }
  const cont = Number(p.contorno) || 0;
  if (cont > 0) {
    const cor = /^#[0-9a-f]{6}$/i.test(String(p.contornoCor || '')) ? p.contornoCor : '#000000';
    d.push(`-webkit-text-stroke: ${cont}px ${cor}`, 'paint-order: stroke fill');
  }
  const esp = Number(p.espacamento) || 0;
  if (esp) d.push(`letter-spacing: ${esp}px`);
  return d;
}
// A mesma formatação aplicada direto num elemento (mais a cor própria da
// peça, quando escolhida) — para os textos que não passam por folha de estilo
function aplicarFormatoInline(el, p) {
  if (!el || !p) return;
  for (const decl of formatoDaPeca(p)) {
    const i = decl.indexOf(':');
    el.style.setProperty(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
  }
  if (/^#[0-9a-f]{6}$/i.test(String(p.cor || ''))) el.style.color = p.cor;
}

// 🎁 v0.116 — lista de PALAVRAS DE ENTRADA do sorteio: fichas (chips) com ✖,
// caixa de texto + ➕ (ou Enter), contador n/30. O painel e as configurações
// montam a mesma lista; quem grava é o chamador (opts.gravar recebe a lista
// já limpa: sem vazia, sem repetida, no máximo 30).
const SORTEIO_MAX_PALAVRAS = 30;
function limparPalavrasSorteio(lista) {
  const out = [];
  const vistas = new Set();
  for (const p of (Array.isArray(lista) ? lista : [])) {
    const s = String(p || '').replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!s) continue;
    const k = s.toLowerCase();
    if (vistas.has(k)) continue;
    vistas.add(k);
    out.push(s);
    if (out.length >= SORTEIO_MAX_PALAVRAS) break;
  }
  return out;
}
function montarPalavrasSorteio(container, opts) {
  const t = (s) => (opts.t ? opts.t(s) : (typeof OBS_I18N !== 'undefined' && OBS_I18N ? OBS_I18N.t(s) : s));
  container.innerHTML = '';
  container.classList.add('palavras-sorteio');
  const lista = document.createElement('div');
  lista.className = 'palavras-lista';
  const linha = document.createElement('div');
  linha.className = 'palavras-nova';
  const inp = document.createElement('input');
  inp.type = 'text';
  inp.maxLength = 40;
  inp.className = 'palavras-input';
  inp.placeholder = t('ex.: sorteio');
  inp.setAttribute('aria-label', t('Nova palavra do sorteio'));
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'icon-btn palavras-add';
  add.textContent = '➕';
  add.title = t('Adicionar esta palavra');
  const cont = document.createElement('span');
  cont.className = 'palavras-contador';
  linha.append(inp, add, cont);
  container.append(lista, linha);
  const atualLimpa = () => limparPalavrasSorteio(opts.ler());
  const adicionar = () => {
    const atual = atualLimpa();
    const s = inp.value.replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!s) return;
    if (atual.some((p) => p.toLowerCase() === s.toLowerCase())) { inp.value = ''; pintar(); return; }
    if (atual.length >= SORTEIO_MAX_PALAVRAS) return;
    inp.value = '';
    const nova = [...atual, s];
    opts.gravar(nova);
    pintar(nova);
    inp.focus();
  };
  add.addEventListener('click', adicionar);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); adicionar(); } });
  function pintar(forcar) {
    const atual = limparPalavrasSorteio(forcar || opts.ler());
    lista.innerHTML = '';
    for (const p of atual) {
      const chip = document.createElement('span');
      chip.className = 'palavra-chip';
      chip.dataset.palavra = p;
      const txt = document.createElement('span');
      txt.textContent = p;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'palavra-tirar';
      x.textContent = '✖';
      x.title = t('Tirar esta palavra');
      x.addEventListener('click', () => {
        const resto = atualLimpa().filter((q) => q.toLowerCase() !== p.toLowerCase());
        opts.gravar(resto);
        pintar(resto);
      });
      chip.append(txt, x);
      lista.appendChild(chip);
    }
    if (!atual.length) {
      const v = document.createElement('span');
      v.className = 'palavras-vazio';
      v.textContent = t('Nenhuma palavra — todo mundo que fala no chat entra.');
      lista.appendChild(v);
    }
    const cheio = atual.length >= SORTEIO_MAX_PALAVRAS;
    cont.textContent = atual.length + '/' + SORTEIO_MAX_PALAVRAS;
    inp.disabled = cheio;
    add.disabled = cheio;
    inp.placeholder = cheio ? t('limite de 30 palavras') : t('ex.: sorteio');
  }
  pintar();
  return { pintar: () => pintar(), input: inp };
}

function platformIcon(platform, size = 16) {
  const meta = PLATFORMS[platform];
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.classList.add('platform-icon');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', meta ? meta.icon : 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z');
  path.setAttribute('fill', meta ? meta.color : '#999');
  svg.appendChild(path);
  return svg;
}

function platformColor(platform) {
  return PLATFORMS[platform] ? PLATFORMS[platform].color : '#999';
}

// Cor estavel derivada do nome (para avatares de iniciais).
function colorForName(name) {
  let hash = 0;
  for (const ch of String(name || '?')) hash = ((hash * 31) + ch.codePointAt(0)) >>> 0;
  return `hsl(${hash % 360}, 60%, 45%)`;
}

// Avatar: foto real quando existe, senao um circulo colorido com a inicial.
// Versão mais nítida (256px) das fotos do YouTube: o CDN costuma aceitar
// trocar o "=sNN" do endereço. Se recusar, o onerror volta ao original.
// Pede ao CDN de cada rede a foto mais nítida que ele entrega. "alta" é usada
// no destaque da live (o avatar pode ficar grande); as listas do painel e o
// chat fixo continuam no tamanho de sempre, mais leve.
function avatarNitido(url, alta) {
  if (!url || typeof url !== 'string') return url;
  // Twitch: ...-profile_image-70x70.png → 300x300 (só quando precisa de alta)
  if (/jtvnw\.net/.test(url)) return alta ? url.replace(/-(\d+)x(\d+)(\.\w+)$/, '-300x300$3') : url;
  // Kick: ...-medium.webp → -fullsize.webp
  if (/kick\.com/.test(url)) return alta ? url.replace(/-medium(\.\w+)$/i, '-fullsize$1') : url;
  // YouTube (e parecidos): o sufixo =sNNN é o tamanho pedido
  return url.replace(/=s\d+(-[^=]*)?$/, (alta ? '=s512' : '=s256') + '$1');
}

// 🖼️ v0.121: foto de verdade = a https do serviço OU a guardada pelo próprio
// programa (avatar do Telegram/WhatsApp na quarentena local e as fotos das
// amostras 🧪). Sem isto, a foto do Telegram/WhatsApp virava as iniciais.
function avatarUrlOk(url) {
  return typeof url === 'string'
    && (url.startsWith('https://') || url.startsWith('/midia-inscritos/') || url.startsWith('/amostras/'));
}
// 🔒 v0.127.1: a cor do Super Chat vem da rede — só entra no CSS se for um
// hex de verdade (#rrggbb ou #rrggbbaa); qualquer outra coisa vira '' e o
// lugar usa a cor padrão dele
function corHexOk(v) {
  return typeof v === 'string' && /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v) ? v : '';
}
// 🔒 v0.127.1: o JSON da figurinha animada (.tgs do Telegram) é de terceiros —
// antes de o lottie-web desenhar ficam só os vetores: sem fontes, sem camadas
// de texto/imagem e sem imagem de fora (só a embutida em data:image/...)
const LOTTIE_MAX_TEXTO = 4 * 1024 * 1024;
function limparLottie(dados) {
  if (!dados || typeof dados !== 'object') return null;
  const semTextoNemImagem = (lista) => (Array.isArray(lista)
    ? lista.filter((c) => c && typeof c === 'object' && c.ty !== 2 && c.ty !== 5)
    : []);
  delete dados.fonts;
  delete dados.chars;
  if (Array.isArray(dados.assets)) {
    dados.assets = dados.assets.filter((a) => {
      if (!a || typeof a !== 'object') return false;
      if (Array.isArray(a.layers)) { a.layers = semTextoNemImagem(a.layers); return true; } // precomp
      return a.e === 1 && typeof a.p === 'string' && /^data:image\//.test(a.p);
    });
  }
  dados.layers = semTextoNemImagem(dados.layers);
  return dados;
}
// Destrói as animações lottie que moram dentro de um nó (antes de apagá-lo),
// senão o reprodutor continua desenhando no vazio
function destruirLotties(raiz) {
  if (!raiz || raiz.nodeType !== 1) return;
  const caixas = raiz.matches && raiz.matches('.figurinha-animada') ? [raiz] : [];
  if (raiz.querySelectorAll) caixas.push(...raiz.querySelectorAll('.figurinha-animada'));
  for (const c of caixas) {
    if (c._anim) { try { c._anim.destroy(); } catch {} c._anim = null; }
  }
}
// A foto em si, com as várias chances de carregar.
// v0.53: a foto tem MAIS DE UMA CHANCE. 1ª falha: o CDN recusou o tamanho
// maior — volta ao endereço original. 2ª: tenta o original de novo depois de
// um instante (tropeço de rede passa). Só então as iniciais entram — quem
// desenha as iniciais de reserva é quem chamou (assim elas voltam com as
// mesmas classes e marcas que o avatar tinha).
function fotoDoAvatar(url, alta, iniciaisDeReserva) {
  const img = document.createElement('img');
  img.className = 'avatar';
  const original = url;
  const nitido = avatarNitido(original, alta);
  img.src = nitido;
  img.loading = 'lazy';
  let tentativa = 0;
  img.onerror = () => {
    tentativa += 1;
    if (tentativa === 1 && nitido !== original) { img.src = original; return; }
    if (tentativa <= 2) {
      setTimeout(() => { if (img.isConnected) img.src = original; }, 1500);
      return;
    }
    img.onerror = null;
    img.replaceWith(iniciaisDeReserva());
  };
  return img;
}

// 🖼️ v0.138: a foto pode chegar DEPOIS do comentário. Twitch, Kick e Bilibili
// não mandam a foto junto com o chat: o programa procura num serviço público e
// isso leva alguns segundos — quem escreveu primeiro (o robô do canal, por
// exemplo) aparecia com as iniciais e ficava assim. Agora cada avatar
// desenhado leva marcado de quem ele é, e qualquer tela sabe trocar as
// iniciais pela foto quando ela chega (avatarFix).
function marcarDonoDoAvatar(el, message, alta) {
  // ☎️ v0.64 continua valendo: no WhatsApp o identificador É o telefone, e ele
  // não vai para a tela nem escondido numa marca (vale também para qualquer
  // nome que pareça um número). Sem marca esse avatar fica de fora da troca —
  // e não faz falta: essas fotos vêm do próprio conector, junto com a mensagem.
  const semRastro = message.platform === 'whatsapp' || pareceTelefone(message.author);
  const seguro = (v) => (semRastro ? '' : String(v || '').toLowerCase());
  el.dataset.avPlat = message.platform || '';
  el.dataset.avDono = seguro(message.authorLogin);
  el.dataset.avNome = seguro(message.author);
  if (alta) el.dataset.avAlta = '1';
  return el;
}
// A foto herda as classes extras (w-avatar do pódio, por exemplo) e as marcas
// do avatar que ela substitui — só a marca "initials" fica para trás.
function herdarMarcasDoAvatar(novo, velho) {
  novo.className = String(velho.className || '').split(/\s+/).filter((c) => c && c !== 'initials').join(' ');
  if (!novo.classList.contains('avatar')) novo.classList.add('avatar');
  for (const marca of ['avPlat', 'avDono', 'avNome', 'avAlta']) {
    if (velho.dataset[marca] !== undefined) novo.dataset[marca] = velho.dataset[marca];
  }
  if (velho.title) novo.title = velho.title;
  return novo;
}
// Troca, dentro de "raiz", as iniciais dessa pessoa pela foto recém-descoberta.
// Devolve quantos avatares mudaram (0 = não havia nenhum dela na tela).
function aplicarFotoQueChegou(raiz, platform, chave, url) {
  if (!raiz || !avatarUrlOk(url)) return 0;
  const alvo = String(chave || '').toLowerCase();
  if (!alvo) return 0;
  let trocados = 0;
  for (const ini of Array.from(raiz.querySelectorAll('.avatar.initials'))) {
    if (ini.dataset.avPlat !== platform) continue;
    if (ini.dataset.avDono !== alvo && ini.dataset.avNome !== alvo) continue;
    const reserva = ini.cloneNode(true); // se a foto não abrir, as iniciais voltam iguais
    const img = herdarMarcasDoAvatar(fotoDoAvatar(url, ini.dataset.avAlta === '1', () => reserva), ini);
    ini.replaceWith(img);
    trocados += 1;
  }
  return trocados;
}

function avatarElement(message, alta) {
  const iniciais = () => marcarDonoDoAvatar(initialsAvatar(message.author), message, alta);
  if (message.avatar && avatarUrlOk(message.avatar)) {
    return marcarDonoDoAvatar(fotoDoAvatar(message.avatar, alta, iniciais), message, alta);
  }
  return iniciais();
}

// ☎️ v0.64 — proteção de telefone nas TELAS (overlay e chat fixo): qualquer
// autor que remotamente lembre um número de telefone (chats de WhatsApp e
// afins) é obrigatoriamente mascarado no que vai ao ar. O número real só
// aparece no PAINEL, para o apresentador. O apelido é determinístico (mesma
// pessoa = mesmo apelido) e não revela nenhum dígito do número.
function pareceTelefone(nome) {
  const t = String(nome || '').trim();
  if (!t) return false;
  const digitos = t.replace(/\D/g, '');
  if (digitos.length < 8) return false;
  // além dos dígitos, só o que telefone costuma ter: + ( ) - . espaço
  return /^[+()\-.\s\d]+$/.test(t);
}
function nomeParaTela(nome) {
  const t = String(nome || '').trim();
  if (!pareceTelefone(t)) return t;
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
  return '📱 Convidado ' + h.toString(36).slice(-3).toUpperCase();
}
// Uma mensagem pronta para a TELA: o autor mascarado quando for telefone
// (cópia rasa — o painel continua vendo a mensagem original)
function mensagemParaTela(message) {
  if (!message || !pareceTelefone(message.author)) return message;
  return { ...message, author: nomeParaTela(message.author) };
}

function initialsAvatar(name) {
  const div = document.createElement('div');
  div.className = 'avatar initials';
  const first = Array.from(String(name || '?').trim())[0] || '?';
  div.textContent = first.toUpperCase();
  div.style.background = colorForName(name);
  return div;
}

// Selos de cargo com destaque: cor própria e rótulo curto; o nome completo
// aparece na dica ao repousar o mouse. Usado pelo painel, chat fixo e destaque.
const BADGE_STYLES = {
  dono: { rotulo: '👑 DONO', cor: '#e91916', texto: '#fff', nome: 'Dono do canal (streamer)' },
  mod: { rotulo: '🛡️ MOD', cor: '#00ad03', texto: '#fff', nome: 'Moderador do chat' },
  vip: { rotulo: '💎 VIP', cor: '#e005b9', texto: '#fff', nome: 'VIP do canal' },
  sub: { rotulo: '⭐ SUB', cor: '#9146ff', texto: '#fff', nome: 'Assinante do canal' },
  membro: { rotulo: '🎖️ MEMBRO', cor: '#0f9d58', texto: '#fff', nome: 'Membro do canal (YouTube)' },
  founder: { rotulo: '🏆 FUNDADOR', cor: '#ff9500', texto: '#000', nome: 'Fundador — um dos primeiros assinantes do canal (Twitch e Kick)' },
  og: { rotulo: '🏅 OG', cor: '#00e5c3', texto: '#000', nome: 'OG — membro antigo da comunidade (Kick)' },
  verificado: { rotulo: '✔️', cor: '#1d9bf0', texto: '#fff', nome: 'Conta verificada' },
  bot: { rotulo: '🤖 BOT', cor: '#5c6bc0', texto: '#fff', nome: 'Robô do chat (Nightbot, StreamElements, Botrix...)' },
};

const SUB_TIER_NOMES = {
  t1: 'Assinante Tier 1 (Twitch)',
  t2: 'Assinante Tier 2 (Twitch)',
  t3: 'Assinante Tier 3 (Twitch)',
  prime: 'Assinante Prime (Twitch)',
  kick: 'Assinante do canal (Kick)',
  kickFounder: 'Fundador do canal (Kick)',
};

// ---------------------------------------------------------------------------
// 🏷️ Distintivos
//
// Cada plataforma manda os seus (moderador, VIP, assinante, Prime, bits,
// presentes, níveis de membro com arte do canal...). Os CARGOS principais o
// painel desenha do próprio jeito, colorido e traduzido; os demais entram com
// a arte original da plataforma. Tudo pode ser desligado nas configurações.
const CARGOS_CONHECIDOS = ['dono', 'mod', 'vip', 'sub', 'membro', 'founder', 'og', 'verificado', 'bot'];

function confSelos() {
  const s = (typeof settings === 'object' && settings && settings.selos) || {};
  return s;
}

// Um cargo/selo pode aparecer? (respeita os liga/desliga das configurações)
function seloLigado(cargo) {
  const conf = confSelos();
  if (conf.mostrar === false) return false;
  if (cargo && CARGOS_CONHECIDOS.includes(cargo)) return conf[cargo] !== false;
  return conf.outros !== false;
}

// Monta a fileira de distintivos de uma mensagem, já filtrada. Junta os selos
// ricos (com imagem) que o conector trouxe com os cargos simples de sempre.
function ehEtiquetaDeValor(nome) {
  const n = String(nome);
  return n.startsWith('superchat') || n.startsWith('doação');
}

function badgeRow(message, aoAdicionar, opcoes) {
  // As etiquetas de valor (Super Chat, doação) não são distintivos de cargo:
  // elas mostram quanto a pessoa mandou, então aparecem sempre — EXCETO onde
  // o valor já tem peça própria (o cartão em peças passa semValor: true,
  // senão o Super Chat apareceria duas vezes)
  const semValor = !!(opcoes && opcoes.semValor);
  for (const nome of message?.badges || []) {
    if (semValor) break;
    if (!ehEtiquetaDeValor(nome)) continue;
    const el = badgeElement(nome, message);
    if (el) aoAdicionar(el);
  }
  const ricos = Array.isArray(message?.selos) ? message.selos : null;
  if (ricos && ricos.length) {
    const jaFoi = new Set();
    for (const selo of ricos) {
      if (!selo || jaFoi.has(selo.id)) continue;
      jaFoi.add(selo.id);
      if (!seloLigado(selo.cargo)) continue;
      const el = badgeElement(selo.cargo || selo.nome, message, selo);
      if (el) aoAdicionar(el);
    }
    return;
  }
  // Mensagem antiga (ou plataforma sem selos ricos): os cargos de sempre
  for (const nome of message?.badges || []) {
    if (nome === 'teste' || ehEtiquetaDeValor(nome)) continue;
    const cargo = CARGOS_CONHECIDOS.includes(String(nome)) ? String(nome) : null;
    if (!seloLigado(cargo)) continue;
    const el = badgeElement(nome, message);
    if (el) aoAdicionar(el);
  }
}

function badgeElement(badgeName, message, selo) {
  const span = document.createElement('span');
  span.className = 'badge';
  const nome = String(badgeName);
  // Super Chats e doações mantêm a cor da própria mensagem
  if ((nome.startsWith('superchat') || nome.startsWith('doação')) && message?.superchat?.color) {
    span.textContent = nome;
    span.classList.add('sc');
    span.style.background = corHexOk(message.superchat.color) || '#ffb300';
    return span;
  }
  const imagens = confSelos().imagens !== false;
  const arte = imagens && selo && typeof selo.img === 'string' && selo.img.startsWith('https://') ? selo.img : null;
  const estilo = BADGE_STYLES[nome];
  if (!estilo) {
    // Selo sem cargo conhecido (bits, presentes, eventos, arte do canal):
    // mostra a imagem original da plataforma, num quadrinho discreto
    if (arte) {
      span.classList.add('badge-img');
      const img = document.createElement('img');
      img.src = arte;
      img.alt = selo?.nome || nome;
      img.loading = 'lazy';
      span.appendChild(img);
      span.title = selo?.nome || nome;
      return span;
    }
    // Sem arte: um contorno na cor da rede, para ele não virar texto solto
    span.classList.add('badge-extra');
    span.textContent = selo?.nome || nome;
    if (selo?.nome) span.title = selo.nome;
    if (message?.platform) span.style.setProperty('--selo-cor', platformColor(message.platform));
    return span;
  }
  span.classList.add('badge-role');
  let rotulo = estilo.rotulo;
  let completo = estilo.nome;
  let cor = estilo.cor;
  let texto = estilo.texto;
  if (nome === 'sub') {
    const tier = message?.subTier;
    if (tier === 't2') rotulo = '⭐ SUB T2';
    else if (tier === 't3') rotulo = '⭐ SUB T3';
    else if (tier === 'prime') rotulo = '⭐ PRIME';
    if (tier && SUB_TIER_NOMES[tier]) completo = SUB_TIER_NOMES[tier];
    if (tier === 'kick' || tier === 'kickFounder') { cor = '#53fc18'; texto = '#000'; }
  }
  if (nome === 'membro' && message?.memberLevel) {
    completo = `Membro do canal (YouTube) — nível: ${message.memberLevel}`;
  }
  // Com a arte da plataforma, ela entra ANTES do rótulo — o selo fica com a
  // cara da rede e continua legível e colorido como você pediu
  if (arte) {
    span.classList.add('badge-com-arte');
    const img = document.createElement('img');
    img.src = arte;
    img.alt = '';
    img.loading = 'lazy';
    span.appendChild(img);
    span.appendChild(document.createTextNode(rotulo));
  } else {
    span.textContent = rotulo;
  }
  span.title = selo?.nome ? `${completo} — ${selo.nome}` : completo;
  span.style.background = cor;
  span.style.color = texto;
  span.style.fontWeight = '800';
  span.style.letterSpacing = '0.3px';
  return span;
}

function isSuperchat(message) {
  return !!message.superchat || (message.badges || []).some((b) => String(b).startsWith('superchat'));
}

function isMemberMessage(message) {
  return (message.badges || []).includes('membro');
}

// Renderiza o conteudo da mensagem (texto + emotes) de forma segura,
// sempre usando textContent — nunca HTML vindo do chat.
function renderRuns(runs) {
  const fragment = document.createDocumentFragment();
  for (const run of runs || []) {
    // (🧪 v0.121: o emoji de canal das amostras mora em /amostras/, no programa)
    if (run.type === 'emote' && typeof run.url === 'string' && (run.url.startsWith('https://') || run.url.startsWith('/amostras/'))) {
      const img = document.createElement('img');
      img.src = run.url;
      img.alt = run.alt || '';
      // 🎟️ v0.118: Super Sticker do YouTube — a figurinha é grande, não emote
      img.className = run.figurinha === true ? 'emote figurinha' : 'emote';
      img.loading = 'lazy';
      fragment.appendChild(img);
    } else if (run.type === 'text' || typeof run.text === 'string') {
      fragment.appendChild(pedacoDeTexto(run));
    }
  }
  return fragment;
}

// ✍️ v0.145: o pedaço de texto com a formatação que a pessoa usou. As marcas
// chegam do conector (marcadores do WhatsApp, entities do Telegram) como
// bandeiras simples — nunca HTML: o texto entra por textContent, como sempre.
const MARCAS_DE_ESTILO = [['b', 'b'], ['i', 'i'], ['s', 's'], ['u', 'u'], ['mono', 'code']];
function pedacoDeTexto(run) {
  const texto = document.createTextNode(run.text || '');
  const marcas = MARCAS_DE_ESTILO.filter(([bandeira]) => run[bandeira] === true);
  if (!marcas.length) return texto;
  let no = texto;
  for (const [, tag] of marcas.reverse()) {
    const caixa = document.createElement(tag);
    caixa.appendChild(no);
    no = caixa;
  }
  return no;
}

function messageText(message) {
  return (message.runs || []).map((r) => (r.type === 'emote' ? (r.alt || '') : (r.text || ''))).join('');
}

// 🎙️ v0.140: a pessoa escreveu alguma coisa junto do áudio/vídeo? Um emote
// sozinho também conta como recado. É o que decide, no painel, se a
// transcrição chega aberta ou recolhida — e, na tela do público, se vale a
// pena anunciar «[mensagem de áudio]» num cartão que já tem o que ler.
function temComentarioEscrito(message) {
  return (message?.runs || []).some((r) => r.type === 'emote' || String(r.text || '').trim());
}

// Conexao WebSocket com reconexao automatica.
// 🔊 v0.77: motor dos áudios dos overlays (entrada / saída / tempo de tela /
// finalização). Cada widget+momento tem o SEU próprio Audio (podem tocar
// juntos); confDe(chave, momento) devolve {url, desloc, repetir, duracao}
// ou null — é onde cada página decide o que toca nela ("onde"). Os Audio
// ficam pendurados no body (escondidos) para os testes e o depurar verem.
function criarMotorAudioOv(confDe) {
  const ativos = new Map(); // 'chave:momento' -> {el, timers}
  function parar(id) {
    const reg = ativos.get(id);
    if (!reg) return;
    reg.timers.forEach(clearTimeout);
    try { reg.el.pause(); } catch { /* já parado */ }
    try { reg.el.remove(); } catch { /* já fora */ }
    ativos.delete(id);
  }
  function tocar(chave, momento) {
    const conf = confDe(chave, momento);
    if (!conf || !conf.url) return;
    const id = chave + ':' + momento;
    parar(id);
    const el = new Audio(conf.url);
    el.preload = 'auto';
    // 🔉 v0.155: volume por som (0 a 100). Som sem volume gravado toca cheio,
    // como sempre tocou; os que vieram do timer/dado antigos trazem o deles.
    const vol = Number(conf.volume);
    el.volume = (Number.isFinite(vol) ? Math.max(0, Math.min(100, vol)) : 100) / 100;
    el.style.display = 'none';
    el.dataset.audioOv = id;
    document.body.appendChild(el);
    const reg = { el, timers: [] };
    const desloc = Math.max(-10, Math.min(10, Number(conf.desloc) || 0));
    const comecar = () => {
      // desloc NEGATIVO adianta o áudio (pula o começo do arquivo);
      // POSITIVO atrasa o início (espera antes de tocar)
      if (desloc < 0) {
        const pular = () => { try { el.currentTime = -desloc; } catch { /* formato sem pulo */ } };
        if (el.readyState >= 1) pular();
        else el.addEventListener('loadedmetadata', pular, { once: true });
      }
      el.loop = conf.repetir === true && momento !== 'saida';
      const p = el.play();
      if (p && p.catch) p.catch(() => { /* navegador sem toque ainda */ });
      const dur = Number(conf.duracao) || 0;
      if (dur > 0) reg.timers.push(setTimeout(() => parar(id), dur * 1000));
      if (!el.loop) el.addEventListener('ended', () => parar(id), { once: true });
    };
    if (desloc > 0) reg.timers.push(setTimeout(comecar, desloc * 1000));
    else comecar();
    ativos.set(id, reg);
  }
  // Presença: apareceu = entrada + tempo de tela; sumiu = cala os dois e
  // toca a saída (a saída nunca fica em loop — o widget já foi embora)
  function presenca(chave, visivel) {
    if (visivel) { tocar(chave, 'entrada'); tocar(chave, 'tempo'); }
    else {
      parar(chave + ':entrada');
      parar(chave + ':tempo');
      tocar(chave, 'saida');
    }
  }
  return { tocar, parar, presenca };
}

// 🔊 v0.155: o primeiro som dos overlays que toque DESTE lado (o filtro diz
// qual lado) serve de chave para destravar o áudio do navegador — depois de
// um, o navegador confia na página e toca todos os outros
function obsPrimeiroSomOv(audios, filtro) {
  for (const conf of Object.values(audios || {})) {
    for (const s of Object.values(conf || {})) {
      if (s && s.url && filtro(s)) return s.url;
    }
  }
  return '';
}

function connectHub(onEvent) {
  let ws;
  // Comandos enviados durante uma reconexão (ex.: logo após o programa
  // reiniciar) não podem se perder: ficam na fila e saem quando reconectar.
  const fila = [];
  const open = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}/ws`);
    ws.onopen = () => { while (fila.length) ws.send(fila.shift()); };
    ws.onmessage = (event) => {
      // v0.127: um erro tratando UMA mensagem não derruba a conexão, mas
      // também não pode sumir calado — fica no console para achar a causa
      try { onEvent(JSON.parse(event.data)); } catch (e) { console.error('Erro tratando uma mensagem do servidor:', e); }
    };
    ws.onclose = () => setTimeout(open, 1500);
  };
  open();
  return {
    send(payload) {
      const raw = JSON.stringify(payload);
      if (ws && ws.readyState === 1) ws.send(raw);
      else if (fila.length < 100) fila.push(raw);
    },
  };
}

// Versão em alta resolução de um avatar, para o zoom (🔍): os CDNs aceitam
// pedir tamanhos maiores trocando o sufixo do endereço
// 🔍 v0.53: ao AMPLIAR, a melhor qualidade possível. Cada serviço guarda a
// foto grande num endereço parecido com o da pequena — trocando o pedaço do
// tamanho dá para pedir a original. A lista vem da melhor para a pior e
// termina sempre no endereço original: se a melhor não existir, a tela desce
// um degrau sozinha, e a foto NUNCA some.
function avatarCandidatos(url) {
  if (!url || typeof url !== 'string') return [];
  const fora = [];
  const junta = (u) => { if (u && u !== url && !fora.includes(u)) fora.push(u); };
  // YouTube/Google (ggpht): o sufixo =sNNN manda no tamanho; s0 = original
  if (/=s\d+/.test(url)) {
    junta(url.replace(/=s\d+/, '=s0'));
    junta(url.replace(/=s\d+/, '=s800'));
  }
  // Twitch: ...profile_image-300x300.png → 600x600 (o maior que ela guarda)
  if (/profile_image-\d+x\d+\./.test(url)) junta(url.replace(/profile_image-\d+x\d+\./, 'profile_image-600x600.'));
  // Kick: as conversões vêm em -thumb/-medium/-small; -fullsize é a original
  if (/-(thumb|thumbnail|medium|small)\.(webp|jpe?g|png)/i.test(url)) {
    junta(url.replace(/-(thumb|thumbnail|medium|small)\.(webp|jpe?g|png)/i, '-fullsize.$2'));
  }
  // Bilibili (e outros CDNs chineses): o @ no fim corta a imagem; sem ele
  // vem a original
  if (url.includes('@')) junta(url.split('@')[0]);
  fora.push(url); // o endereço que já veio pronto é sempre o último degrau
  return fora;
}
// Compatível com quem só quer um endereço (a melhor aposta)
function avatarGrande(url) {
  const lista = avatarCandidatos(url);
  return lista.length ? lista[0] : url;
}
// Põe a foto no <img> descendo a lista de qualidades até uma carregar; se
// nenhuma carregar, chama o plano B (as iniciais coloridas)
function avatarComQualidade(img, url, aoFalharTudo) {
  const lista = avatarCandidatos(url);
  if (!lista.length) { if (aoFalharTudo) aoFalharTudo(); return; }
  let i = 0;
  img.onerror = () => {
    i += 1;
    if (i < lista.length) { img.src = lista[i]; return; }
    img.onerror = null;
    if (aoFalharTudo) aoFalharTudo();
  };
  img.src = lista[0];
}

// ---------------------------------------------------------------------------
// 💬 Diálogos do OBS Social (substituem alert/confirm/prompt do navegador).
// Mesma cara do resto do programa, com suporte a idioma, teclado (Enter/Esc)
// e níveis de gravidade — inclusive o crítico, que exige digitar a palavra.
const OBS_DIALOG_CSS = `
.obs-dialog-fundo {
  position: fixed; inset: 0; z-index: 9998; display: flex;
  align-items: center; justify-content: center; padding: 20px;
  background: rgba(0,0,0,0.55); backdrop-filter: blur(2px);
  animation: obsDlgFundo 0.15s ease-out;
}
@keyframes obsDlgFundo { from { opacity: 0; } }
.obs-dialog {
  background: var(--panel2, #1a2233); color: var(--text, #fff);
  border: 1px solid var(--border, #2c3850); border-radius: 16px;
  padding: 20px 22px; width: min(94vw, 460px);
  box-shadow: 0 18px 60px rgba(0,0,0,0.5);
  font-family: var(--font-family, 'Segoe UI', system-ui, sans-serif);
  animation: obsDlgPop 0.22s cubic-bezier(0.2, 1.2, 0.4, 1);
}
@keyframes obsDlgPop { from { opacity: 0; transform: translateY(12px) scale(0.97); } }
.obs-dialog .obs-dlg-titulo {
  display: flex; align-items: center; gap: 9px;
  font-size: 17px; font-weight: 800; margin-bottom: 10px;
}
.obs-dialog .obs-dlg-texto { font-size: 14px; line-height: 1.5; opacity: 0.92; white-space: pre-line; }
.obs-dialog .obs-dlg-texto b { opacity: 1; }
.obs-dialog .obs-dlg-lista {
  margin: 10px 0 0; padding: 10px 12px; border-radius: 10px;
  background: var(--panel, rgba(0,0,0,0.18)); font-size: 13px; line-height: 1.6;
  white-space: pre-line; max-height: 40vh; overflow-y: auto;
}
.obs-dialog input.obs-dlg-campo {
  width: 100%; margin-top: 12px; padding: 9px 11px; font-size: 14px;
  border-radius: 10px; border: 1px solid var(--border, #2c3850);
  background: var(--bg, #0f1420); color: var(--text, #fff); box-sizing: border-box;
}
.obs-dialog input.obs-dlg-campo:focus { outline: none; border-color: var(--accent, #7c3aed); }
.obs-dialog .obs-dlg-botoes { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; flex-wrap: wrap; }
.obs-dialog .obs-dlg-botoes button {
  padding: 9px 16px; font-size: 14px; font-weight: 700; border-radius: 10px;
  border: 1px solid var(--border, #2c3850); background: var(--panel, #141a28);
  color: var(--text, #fff); cursor: pointer;
}
.obs-dialog .obs-dlg-botoes button:hover { border-color: var(--accent, #7c3aed); }
.obs-dialog .obs-dlg-botoes button.obs-dlg-ok {
  background: var(--accent, #7c3aed); border-color: var(--accent, #7c3aed); color: #fff;
}
.obs-dialog.perigo .obs-dlg-botoes button.obs-dlg-ok { background: #c62828; border-color: #c62828; }
.obs-dialog.critico { border-color: #c62828; box-shadow: 0 18px 60px rgba(198,40,40,0.35); }
.obs-dialog.critico .obs-dlg-botoes button.obs-dlg-ok { background: #b71c1c; border-color: #b71c1c; }
.obs-dialog .obs-dlg-botoes button.obs-dlg-ok:disabled { opacity: 0.45; cursor: not-allowed; }
`;

function obsDialogGarantirCss() {
  if (document.getElementById('obs-dialog-css')) return;
  const style = document.createElement('style');
  style.id = 'obs-dialog-css';
  style.textContent = OBS_DIALOG_CSS;
  document.head.appendChild(style);
}

// Tradução curta (o motor de idiomas cuida do resto quando presente)
function obsDlgT(texto) {
  return (window.OBS_I18N && typeof OBS_I18N.t === 'function') ? OBS_I18N.t(texto) : texto;
}

// opcoes: { titulo, texto, icone, lista[], nivel: 'info'|'perigo'|'critico',
//           ok, cancelar, confirmarPalavra, somenteOk }
// Devolve uma promessa: true (confirmou) ou false (cancelou).
function obsDialog(opcoes) {
  obsDialogGarantirCss();
  const o = opcoes || {};
  return new Promise((resolve) => {
    const fundo = document.createElement('div');
    fundo.className = 'obs-dialog-fundo';
    const caixa = document.createElement('div');
    caixa.className = 'obs-dialog' + (o.nivel ? ' ' + o.nivel : '');
    fundo.appendChild(caixa);

    const titulo = document.createElement('div');
    titulo.className = 'obs-dlg-titulo';
    titulo.textContent = (o.icone ? o.icone + ' ' : '') + obsDlgT(o.titulo || 'OBS Social');
    caixa.appendChild(titulo);

    if (o.texto) {
      const texto = document.createElement('div');
      texto.className = 'obs-dlg-texto';
      texto.textContent = obsDlgT(o.texto);
      caixa.appendChild(texto);
    }
    if (o.lista && o.lista.length) {
      const lista = document.createElement('div');
      lista.className = 'obs-dlg-lista';
      lista.textContent = o.lista.map((l) => '• ' + obsDlgT(l)).join('\n');
      caixa.appendChild(lista);
    }

    // 🧩 v0.94: conteúdo próprio do chamador (listas de escolha, seletores...)
    // entre o texto e os botões — quem monta decide tudo o que vai aí dentro
    if (typeof o.montarExtra === 'function') {
      const extra = document.createElement('div');
      extra.className = 'obs-dlg-extra';
      extra.style.cssText = 'margin-top:12px;text-align:left';
      try { o.montarExtra(extra); } catch {}
      if (extra.childNodes.length) caixa.appendChild(extra);
    }

    let campo = null;
    if (o.confirmarPalavra) {
      const aviso = document.createElement('div');
      aviso.className = 'obs-dlg-texto';
      aviso.style.marginTop = '12px';
      aviso.textContent = obsDlgT('Para confirmar, digite:') + ' ' + o.confirmarPalavra;
      caixa.appendChild(aviso);
      campo = document.createElement('input');
      campo.className = 'obs-dlg-campo';
      campo.type = 'text';
      campo.autocomplete = 'off';
      caixa.appendChild(campo);
    }

    const botoes = document.createElement('div');
    botoes.className = 'obs-dlg-botoes';
    const fechar = (valor) => {
      document.removeEventListener('keydown', aoTeclar, true);
      fundo.remove();
      resolve(valor);
    };
    let btnCancelar = null;
    if (!o.somenteOk) {
      btnCancelar = document.createElement('button');
      btnCancelar.textContent = obsDlgT(o.cancelar || 'Cancelar');
      btnCancelar.onclick = () => fechar(false);
      botoes.appendChild(btnCancelar);
    }
    const btnOk = document.createElement('button');
    btnOk.className = 'obs-dlg-ok';
    btnOk.textContent = obsDlgT(o.ok || (o.somenteOk ? 'Entendi' : 'Confirmar'));
    btnOk.onclick = () => { if (!btnOk.disabled) fechar(true); };
    botoes.appendChild(btnOk);
    caixa.appendChild(botoes);

    if (campo) {
      btnOk.disabled = true;
      const conferir = () => {
        btnOk.disabled = campo.value.trim().toUpperCase() !== String(o.confirmarPalavra).toUpperCase();
      };
      campo.addEventListener('input', conferir);
      conferir();
    }

    function aoTeclar(e) {
      if (e.key === 'Escape') { e.preventDefault(); fechar(false); }
      else if (e.key === 'Enter' && !btnOk.disabled && document.activeElement !== btnCancelar) {
        e.preventDefault(); fechar(true);
      }
    }
    document.addEventListener('keydown', aoTeclar, true);
    fundo.addEventListener('mousedown', (e) => { if (e.target === fundo) fechar(false); });

    document.body.appendChild(fundo);
    setTimeout(() => (campo || btnOk).focus(), 30);
  });
}

// Atalhos no espírito do alert()/confirm(), mas com a cara do OBS Social
const obsAviso = (texto, titulo, icone) =>
  obsDialog({ titulo: titulo || 'Aviso', texto, icone: icone || 'ℹ️', somenteOk: true });
const obsConfirmar = (texto, opcoes) =>
  obsDialog({ titulo: 'Confirmar', icone: '❓', ...(opcoes || {}), texto });

// ---------------------------------------------------------------------------
// 🎨 Tema do programa: cores, imagem de fundo, tamanhos e cantos.
// Só mexe na aparência do painel e das configurações (o overlay do OBS tem a
// personalização própria). O "Tamanho da interface" (🔍) é outra coisa e
// continua funcionando por cima disto.
const TEMA_VARS = {
  corFundo: '--bg',
  corPainel: '--panel',
  corPainel2: '--panel2',
  corTexto: '--text',
  corSuave: '--muted',
  corBorda: '--border',
  corDestaque: '--accent',
};

// 📐 v0.52: tamanho estimado de cada item do 🖱️ Organizar a tela, em % da
// tela (na escala 100). A MESMA conta vale para o editor e para o /overlay:
// o overlay ancora o widget real pelo CENTRO desta caixinha, então mesmo um
// conteúdo de tamanho dinâmico (mensagem longa, pódio cheio) cresce para os
// lados sem sair do lugar que a pessoa escolheu.
const OBS_TAMANHOS_ITEM = {
  featured: { w: 32, h: 12 },
  qr: { w: 11, h: 22 },
  raffle: { w: 20, h: 34 },
  likemeter: { w: 17, h: 10 },
  winstreak: { w: 13, h: 8 },
  audience: { w: 12, h: 14 },
  aviso: { w: 34, h: 10 },
  relogio: { w: 14, h: 9 },
};
function obsTamanhoItemPct(kind, s, telaW, telaH, escalaPct) {
  s = s || {};
  if (kind === 'featured') {
    const esc = (Number(s.scale) || 100) / 100;
    // 📐 v0.102: com ARTE escolhida o cartão também é a caixa fixa (a arte
    // liga o modo peças sozinha) — só o 🧩 era considerado, e a âncora do
    // centro saía 13 px para o lado: o Destaque solto no mapa "andava" ao cair
    if (destaqueEmPecas(s)) {
      // Modo peças soltas: o cartão é uma caixa de tamanho REAL conhecido
      return {
        w: (Number(s.maxWidth) || 640) * esc / telaW * 100,
        h: (Number(s.cardAlturaEm) || 4.6) * (Number(s.fontSize) || 26) * esc / telaH * 100,
      };
    }
    const t = OBS_TAMANHOS_ITEM.featured;
    return { w: t.w * esc, h: t.h * esc };
  }
  const wc = (s.widgets || {})[kind] || {};
  const esc = (escalaPct != null ? Number(escalaPct) || 100 : Number(wc.scale) || 100) / 100;
  if (wc.pecasLivre === true) {
    // Widget desmontado: a caixa das peças também tem tamanho real
    return {
      w: (Number(wc.pecasLargura) || 300) * esc / telaW * 100,
      h: (Number(wc.pecasAltura) || 200) * esc / telaH * 100,
    };
  }
  const t = OBS_TAMANHOS_ITEM[kind] || { w: 12, h: 10 };
  return { w: t.w * esc, h: t.h * esc };
}

// A MEIA-caixa do item em unidades CSS vivas (vw/vh para estimativas em % da
// tela; px para tamanhos reais em pixels) — usada pelo /overlay no transform
// da âncora central: left fica no canto (x%), e o translate empurra o centro
// do item para o centro da caixinha SEM encolher a largura disponível
// (shrink-to-fit usa o left, não o transform) e SEM congelar no resize.
// comEscala=false deixa a escala de fora: nos widgets o zoom do elemento
// multiplica o transform sozinho (centro final = left + zoom × meiaCaixa).
function obsMeiaCaixaCss(kind, s, comEscala) {
  s = s || {};
  if (kind === 'featured') {
    const esc = comEscala ? (Number(s.scale) || 100) / 100 : 1;
    if (destaqueEmPecas(s)) { // 📐 v0.102: arte escolhida = caixa fixa também
      return {
        x: ((Number(s.maxWidth) || 640) * esc / 2) + 'px',
        y: ((Number(s.cardAlturaEm) || 4.6) * (Number(s.fontSize) || 26) * esc / 2) + 'px',
      };
    }
    const t = OBS_TAMANHOS_ITEM.featured;
    return { x: (t.w * esc / 2) + 'vw', y: (t.h * esc / 2) + 'vh' };
  }
  const wc = (s.widgets || {})[kind] || {};
  const esc = comEscala ? (Number(wc.scale) || 100) / 100 : 1;
  if (wc.pecasLivre === true) {
    return {
      x: ((Number(wc.pecasLargura) || 300) * esc / 2) + 'px',
      y: ((Number(wc.pecasAltura) || 200) * esc / 2) + 'px',
    };
  }
  const t = OBS_TAMANHOS_ITEM[kind] || { w: 12, h: 10 };
  return { x: (t.w * esc / 2) + 'vw', y: (t.h * esc / 2) + 'vh' };
}

// 📐 v0.52.1: onde CADA UM deixou as janelinhas e os cartões do painel é
// pessoal — como o tema e o idioma, mora neste navegador (localStorage) e
// volta igualzinho depois de recarregar, reiniciar ou fechar o programa.
// A posição salva é sempre trazida de volta para dentro da tela: mudou de
// monitor (ou de resolução), nada fica perdido lá fora.
function geoLer(chave) {
  try {
    const s = localStorage.getItem('obsSocialGeo:' + chave);
    const g = s ? JSON.parse(s) : null;
    return g && typeof g === 'object' ? g : null;
  } catch { return null; }
}
function geoGravar(chave, g) {
  try { localStorage.setItem('obsSocialGeo:' + chave, JSON.stringify(g || {})); } catch {}
}
// 🪟 v0.91: apaga o que foi guardado de UMA janela — é o ↺ «voltar ao lugar
// padrão», a saída para quando alguém arrastou algo para um canto ruim
function geoEsquecer(chave) {
  try { localStorage.removeItem('obsSocialGeo:' + chave); } catch {}
}
// Guarda de uma vez onde a janela está e o tamanho que ela tem. Lê do ESTILO
// (é o lugar pretendido); só cai no retângulo medido quando o estilo ainda
// não foi escrito.
function geoGravarPos(el, chave, extra) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  const num = (v, alt) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : alt);
  const g = { ...(geoLer(chave) || {}), ...(extra || {}) };
  g.x = Math.round(num(el.style.left, r.left));
  g.y = Math.round(num(el.style.top, r.top));
  if (r.width > 40) g.w = Math.round(num(el.style.width, r.width));
  if (r.height > 40) g.h = Math.round(num(el.style.height, r.height));
  geoGravar(chave, g);
}
// 🪟 v0.91: coloca uma janela FLUTUANTE (position:fixed, criada na hora) no
// lugar e no tamanho em que foi deixada. Sem nada guardado, usa o padrão que
// a janela pediu. O que volta é sempre trazido para dentro da tela — trocar
// de monitor não some com nada.
function geoAplicarJanela(el, chave, padrao) {
  if (!el) return null;
  const g = geoLer(chave) || {};
  const p = padrao || {};
  const larg = Math.min(Math.max(Number(g.w) || Number(p.w) || 480, Number(p.minW) || 240), window.innerWidth - 16);
  const alt = Math.min(Math.max(Number(g.h) || Number(p.h) || 320, Number(p.minH) || 160), window.innerHeight - 16);
  const xPadrao = Number.isFinite(Number(p.x)) ? Number(p.x) : (window.innerWidth - larg) / 2;
  const yPadrao = Number.isFinite(Number(p.y)) ? Number(p.y) : (window.innerHeight - alt) / 2;
  const x = Math.max(0, Math.min(window.innerWidth - 80, Number.isFinite(Number(g.x)) ? Number(g.x) : xPadrao));
  const y = Math.max(0, Math.min(window.innerHeight - 48, Number.isFinite(Number(g.y)) ? Number(g.y) : yPadrao));
  el.style.left = Math.round(x) + 'px';
  el.style.top = Math.round(y) + 'px';
  el.style.right = 'auto';
  el.style.bottom = 'auto';
  el.style.transform = 'none';
  if (p.tamanho !== false) {
    el.style.width = Math.round(larg) + 'px';
    el.style.height = Math.round(alt) + 'px';
    // Marca o que NÓS pusemos: um tamanho apertado pela tela pequena não pode
    // voltar para o disco como se fosse a escolha da pessoa
    el.dataset.geoAplicado = Math.round(larg) + 'x' + Math.round(alt);
  }
  return g;
}
// Devolve o que aplicar: posição só quando ela foi movida de propósito
function geoAplicar(el, chave, opts) {
  if (!el) return;
  const g = geoLer(chave);
  if (!g) return;
  const larguraMin = 160, alturaMin = 80;
  if (Number(g.w) > 0) el.style.width = Math.min(window.innerWidth - 20, Math.max(larguraMin, Number(g.w))) + 'px';
  if (Number(g.h) > 0) el.style.height = Math.min(window.innerHeight - 20, Math.max(alturaMin, Number(g.h))) + 'px';
  if ((opts || {}).mover !== false && Number.isFinite(Number(g.x)) && Number.isFinite(Number(g.y))) {
    el.style.position = 'absolute';
    el.style.margin = '0';
    el.style.left = Math.max(0, Math.min(window.innerWidth - 80, Number(g.x))) + 'px';
    el.style.top = Math.max(0, Math.min(window.innerHeight - 60, Number(g.y))) + 'px';
  }
  geoMarcarEsticada(el);
  // Marca o que NÓS acabamos de pôr: se o navegador reportar exatamente isso,
  // não é escolha da pessoa e não volta para o disco (senão um clamp de tela
  // pequena viraria o tamanho "escolhido" para sempre)
  el.dataset.geoAplicado = Math.round(el.getBoundingClientRect().width) + 'x'
    + Math.round(el.getBoundingClientRect().height);
}
// 📐 v0.127.3: janela com tamanho escolhido pela pessoa (width/height no
// estilo, pela setinha ↘ ou pelo tamanho guardado) ganha a marca
// .geo-esticada — o CSS solta os tetos de 92% da tela só para ela. Sem a
// marca (tamanho de fábrica), o teto segue valendo e nada nasce vazando.
function geoMarcarEsticada(el) {
  if (!el || !el.classList) return;
  el.classList.toggle('geo-esticada', !!(el.style.width || el.style.height));
}
// Guarda o tamanho a cada esticada (a posição é gravada por quem arrasta)
function geoObservarTamanho(el, chave) {
  if (!el || el.dataset.geoObs === '1' || typeof ResizeObserver !== 'function') return;
  el.dataset.geoObs = '1';
  let timer = null;
  const obs = new ResizeObserver(() => {
    geoMarcarEsticada(el);
    clearTimeout(timer);
    timer = setTimeout(() => {
      // só grava o que a pessoa esticou de verdade (largura/altura no estilo)
      if (!el.style.width && !el.style.height) return;
      // Fechado/minimizado o retângulo é zero: gravar isso APAGARIA o tamanho
      // guardado. Nada de medir o que não está na tela.
      if (!el.offsetParent) return;
      const r = el.getBoundingClientRect();
      if (r.width < 40 || r.height < 40) return;
      const w = Math.round(r.width), h = Math.round(r.height);
      if (el.dataset.geoAplicado === w + 'x' + h) return; // fomos nós, não a pessoa
      const g = geoLer(chave) || {};
      if (el.style.width) g.w = w;
      // Altura espremida pelo teto medido na abertura (max-height) não é
      // escolha: guardaria um cartão cada vez menor a cada vez que abre
      const teto = parseFloat(getComputedStyle(el).maxHeight);
      if (el.style.height && !(Number.isFinite(teto) && h >= teto - 1)) g.h = h;
      geoGravar(chave, g);
    }, 250);
  });
  obs.observe(el);
}

// 🔒 v0.50: o tema da INTERFACE é pessoal — vive neste navegador/máquina
// (localStorage), não nas configurações sincronizadas. Quem nunca escolheu
// segue o tema salvo nas configurações (o "tema da casa", de antes).
// 🧹 Campos de tema que o OBS Social já teve e não usa mais. Ficaram gravados
// no navegador de quem usou uma versão antiga: são varridos na leitura, para
// que a exportação do tema também saia limpa.
const TEMA_CAMPOS_MORTOS = ['painel', 'marchDia'];

function temaLocalLer() {
  try {
    const s = localStorage.getItem('obsSocialTemaLocal');
    if (!s) return null;
    const t = JSON.parse(s);
    if (!t || typeof t !== 'object') return t;
    let sujo = false;
    for (const c of TEMA_CAMPOS_MORTOS) if (c in t) { delete t[c]; sujo = true; }
    if (sujo) temaLocalGravar(t); // grava uma vez só: na próxima já vem limpo
    return t;
  } catch { return null; }
}
function temaLocalGravar(t) {
  try { localStorage.setItem('obsSocialTemaLocal', JSON.stringify(t || {})); } catch {}
}

function aplicarTema(tema) {
  const t = tema || {};
  const raiz = document.documentElement;
  // Cores: cada uma vale só se estiver preenchida (senão fica a do tema
  // claro/escuro padrão)
  for (const [chave, cssVar] of Object.entries(TEMA_VARS)) {
    const cor = typeof t[chave] === 'string' && /^#[0-9a-f]{6}$/i.test(t[chave]) ? t[chave] : '';
    if (cor) raiz.style.setProperty(cssVar, cor);
    else raiz.style.removeProperty(cssVar);
  }
  // Os widgets nativos (lista do dropdown, setinhas de número, calendário)
  // acompanham o claro/escuro do fundo do tema — nada de janela clara do
  // navegador pulando no meio de um tema escuro (nem o contrário).
  {
    const m = /^#([0-9a-f]{6})$/i.exec(getComputedStyle(raiz).getPropertyValue('--bg').trim());
    let escuro = true;
    if (m) {
      const n = parseInt(m[1], 16);
      escuro = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 140;
    }
    raiz.style.colorScheme = escuro ? 'dark' : 'light';
  }
  const num = (v, min, max, padrao) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
  };
  raiz.style.setProperty('--tema-texto', num(t.tamTexto, 80, 130, 100) / 100);
  raiz.style.setProperty('--tema-icone', num(t.tamIcone, 70, 160, 100) / 100);
  raiz.style.setProperty('--tema-cantos', num(t.cantos, 0, 28, 14) + 'px');
  raiz.style.setProperty('--tema-densidade', num(t.densidade, 80, 130, 100) / 100);
  raiz.style.setProperty('--tema-fonte', t.fonte ? `'${String(t.fonte).replace(/['"\\]/g, '')}', 'Segoe UI', system-ui, sans-serif` : '');

  // Imagem de fundo do programa (só das mídias enviadas)
  let camada = document.getElementById('obs-tema-fundo');
  const img = typeof t.fundoImagem === 'string' && t.fundoImagem.startsWith('/uploads/') ? t.fundoImagem : '';
  if (img) {
    if (!camada) {
      camada = document.createElement('div');
      camada.id = 'obs-tema-fundo';
      document.body.appendChild(camada);
    }
    const ajuste = ['cover', 'contain', 'tile'].includes(t.fundoAjuste) ? t.fundoAjuste : 'cover';
    // encodeURI: aspas no nome do arquivo não podem virar outra regra de CSS
    camada.style.backgroundImage = `url("${encodeURI(img).replace(/"/g, '%22')}")`;
    camada.style.backgroundSize = ajuste === 'tile' ? 'auto' : ajuste;
    camada.style.backgroundRepeat = ajuste === 'tile' ? 'repeat' : 'no-repeat';
    camada.style.backgroundPosition = 'center';
    camada.style.opacity = String(num(t.fundoOpacidade, 0, 1, 0.35));
    camada.style.filter = num(t.fundoDesfoque, 0, 20, 0) ? `blur(${num(t.fundoDesfoque, 0, 20, 0)}px)` : '';
  } else if (camada) {
    camada.remove();
  }
  garantirCssTema();
}

function garantirCssTema() {
  if (document.getElementById('obs-tema-css')) return;
  const style = document.createElement('style');
  style.id = 'obs-tema-css';
  style.textContent = `
    #obs-tema-fundo {
      position: fixed; inset: 0; z-index: -1; pointer-events: none;
      background-color: transparent;
    }
    body { font-family: var(--tema-fonte, var(--font-family, 'Segoe UI', system-ui, sans-serif)); }
    /* Tamanho dos textos e ícones do programa (independente do 🔍) */
    body { font-size: calc(1rem * var(--tema-texto, 1)); }
    .card, .chat-item, .conn-chip, .tool-pop, .obs-dialog { border-radius: var(--tema-cantos, 14px); }
    .icon-btn, .tab, button { font-size: calc(1em * var(--tema-icone, 1)); }
    .platform-icon, .avatar { transform: scale(var(--tema-icone, 1)); }
    .card { padding: calc(16px * var(--tema-densidade, 1)); }
    .chat-item { padding: calc(10px * var(--tema-densidade, 1)); }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// 🏆 Marcos do winstreak: 1 = dezenas, 2 = grandes (50/100/200...),
// 3 = dobras (10, 20, 40, 80, 160...). O efeito FICA enquanto o número
// estiver no marco e só sai quando ele passa dali.
function nivelDoMarco(n) {
  const v = Math.floor(Number(n) || 0);
  if (v < 10) return 0;
  // dobras: 10, 20, 40, 80, 160, 320, 640...
  for (let d = 10; d <= v; d *= 2) {
    if (d === v) return 3;
  }
  // grandes: 50 e as centenas redondas
  if (v === 50 || (v >= 100 && v % 100 === 0)) return 2;
  // dezenas
  if (v % 10 === 0) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// 🔊 Destravador do áudio da página
//
// Navegadores modernos (Chrome, Edge, Safari, e os do tablet/celular) só
// deixam uma página tocar áudio depois que a pessoa encostou nela pelo menos
// uma vez. Sem isso o som simplesmente não sai — sem erro, sem aviso.
//
// Para resolver, guardamos UM único elemento de áudio e o "liberamos" no
// primeiro clique/toque/tecla que acontecer na página: tocamos um arquivo com
// volume zero e paramos na hora. Depois disso o navegador confia na página e
// os sons dos overlays (motor v0.77) tocam sozinhos na hora certa.
//
// Quando mesmo assim o navegador bloquear, avisamos a página (aoMudar) para
// ela mostrar um convite discreto de "toque para ativar o som".
//
// v0.155.2: quem tocava o alerta antigo do timer/dado por aqui (tocar/parar)
// saiu — todo som de overlay passa pelo motor. Ficou só o destravador.
const OBS_SOM = (() => {
  let elemento = null;
  let liberado = false;
  let bloqueado = false;
  let urlPreferida = '';
  let aoMudar = null;
  let urlNoElemento = '';
  // Chave de reserva: vem com o programa. Se o arquivo escolhido pela pessoa
  // sumiu do disco (apagado à mão), o destravamento não pode ficar preso nele
  const SOM_RESERVA = '/sons/timer-padrao.wav';

  function audio() {
    if (!elemento) {
      elemento = new Audio();
      elemento.preload = 'auto';
    }
    return elemento;
  }

  function avisar() {
    if (typeof aoMudar === 'function') {
      try { aoMudar({ liberado, bloqueado }); } catch { /* a página que decide */ }
    }
  }

  // Tenta destravar em silêncio, usando o próprio arquivo do alerta
  function liberar() {
    if (liberado || !urlPreferida) return Promise.resolve(liberado);
    const el = audio();
    const volumeAntes = el.volume;
    try {
      if (urlNoElemento !== urlPreferida) { el.src = urlPreferida; urlNoElemento = urlPreferida; }
      el.volume = 0;
      const p = el.play();
      if (!p || typeof p.then !== 'function') {
        liberado = true; bloqueado = false; el.pause(); el.volume = volumeAntes; avisar();
        return Promise.resolve(true);
      }
      return p.then(() => {
        el.pause();
        try { el.currentTime = 0; } catch { /* alguns navegadores não deixam voltar */ }
        el.volume = volumeAntes;
        liberado = true; bloqueado = false; avisar();
        return true;
      }).catch((err) => {
        el.volume = volumeAntes;
        // v0.155.2: só o bloqueio de autoplay (NotAllowedError) é bloqueio.
        // Arquivo morto ou formato que o navegador não abre não acende o
        // convite: troca a chave pela de reserva e tenta de novo
        if (!(err && err.name === 'NotAllowedError') && urlPreferida !== SOM_RESERVA) {
          urlPreferida = SOM_RESERVA;
          return liberar();
        }
        bloqueado = true; avisar();
        return false;
      });
    } catch {
      bloqueado = true; avisar();
      return Promise.resolve(false);
    }
  }

  // A página chama isto na abertura e sempre que o arquivo do alerta mudar
  function preparar(url, callback) {
    if (typeof callback === 'function') aoMudar = callback;
    // Basta destravar UMA vez: o navegador passa a confiar no elemento, e
    // depois ele toca qualquer arquivo. Por isso o primeiro som configurado
    // serve de chave para todos os outros (timer, dado...).
    if (url && !urlPreferida) urlPreferida = url;
    if (!urlPreferida || liberado) return;
    liberar(); // no OBS isso já funciona de primeira; no navegador espera o toque
    if (!OBS_SOM._ouvindo) {
      OBS_SOM._ouvindo = true;
      const noToque = () => { liberar(); };
      for (const evento of ['pointerdown', 'touchstart', 'keydown', 'click']) {
        document.addEventListener(evento, noToque, { passive: true, capture: true });
      }
    }
  }

  return {
    preparar, liberar,
    estaLiberado: () => liberado,
    estaBloqueado: () => bloqueado && !liberado,
  };
})();

// ---------------------------------------------------------------------------
// 🎵 Tocador da Mesa de trilhas (Labs) — uma trilha por vez, como no fluxo de
// live de verdade: apertar outra troca com fade, BGM pode repetir (loop), e o
// ⏹ para tudo. Overlay e painel usam este mesmo tocador; cada página decide
// SE toca olhando o destino da trilha (live, painel ou ambos).
// ---------------------------------------------------------------------------
const TRILHA_PLAYER = (() => {
  // Canal de BASE: uma trilha por vez (modos solo e loop — a BGM da live).
  let el = null;
  let rampaTimer = null;
  let atual = null;          // a trilha de base tocando
  // Canal de SOBREPOSIÇÃO: efeitos/vinhetas por cima da base (modos
  // sobrepor e recomeçar) — cada um no próprio <audio>, sem derrubar a BGM.
  const porCima = new Map(); // trilha.id -> { el, trilha, timer }
  let pendente = null;       // { trilha, desde } esperando o navegador liberar
  let aoBloquear = null;     // callback da página (mostra o convite 🔇)

  function audio() {
    if (!el) { el = new Audio(); el.preload = 'auto'; }
    return el;
  }
  const fadeEntrada = (t) => t.fadeTipo === 'entrada' || t.fadeTipo === 'ambos' || t.fadeTipo === undefined;
  const fadeSaida = (t) => t.fadeTipo === 'saida' || t.fadeTipo === 'ambos' || t.fadeTipo === undefined;
  const volumeDe = (t) => Math.max(0, Math.min(100, Number(t.volume ?? 70))) / 100;

  // Leva o volume de UM elemento até o alvo em `seg` segundos (passos de 50ms)
  function rampaEm(alvoEl, alvo, seg, aoFim) {
    const dur = Math.max(0, Number(seg) || 0) * 1000;
    if (dur < 60) {
      alvoEl.volume = alvo;
      if (aoFim) aoFim();
      return null;
    }
    const de = alvoEl.volume;
    const inicio = Date.now();
    const timer = setInterval(() => {
      const f = Math.min(1, (Date.now() - inicio) / dur);
      alvoEl.volume = de + (alvo - de) * f;
      if (f >= 1) { clearInterval(timer); if (aoFim) aoFim(); }
    }, 50);
    return timer;
  }
  function pararRampa() { if (rampaTimer) { clearInterval(rampaTimer); rampaTimer = null; } }
  function rampa(alvo, seg, aoFim) {
    pararRampa();
    rampaTimer = rampaEm(audio(), alvo, seg, aoFim);
  }

  function bloqueou(trilha, desde) {
    pendente = { trilha, desde };
    if (typeof aoBloquear === 'function') { try { aoBloquear(true); } catch {} }
  }

  // ---- canal de base (solo / loop) ----
  function comecarBase(trilha, desde) {
    const a = audio();
    atual = trilha;
    pendente = null;
    a.src = trilha.url;
    a.loop = trilha.modo === 'loop' || trilha.loop === true;
    const alvo = volumeDe(trilha);
    a.volume = fadeEntrada(trilha) ? 0 : alvo;
    const atrasoS = desde ? Math.max(0, (Date.now() - desde) / 1000) : 0;
    const aoSaberDuracao = () => {
      if (atrasoS > 0.5 && Number.isFinite(a.duration) && a.duration > 0) {
        if (!a.loop && atrasoS >= a.duration) { pararBaseJa(); return; }
        try { a.currentTime = atrasoS % a.duration; } catch { /* alguns formatos não deixam */ }
      }
      const p = a.play();
      const fadeIn = () => { if (fadeEntrada(trilha)) rampa(alvo, trilha.fade); else a.volume = alvo; };
      if (p && typeof p.then === 'function') {
        p.then(fadeIn).catch(() => { atual = null; bloqueou(trilha, desde); });
      } else {
        fadeIn();
      }
    };
    if (Number.isFinite(a.duration) && a.duration > 0) aoSaberDuracao();
    else a.addEventListener('loadedmetadata', aoSaberDuracao, { once: true });
  }
  function pararBaseJa() {
    pararRampa();
    if (el) { try { el.pause(); } catch { /* já parou */ } }
    atual = null;
  }
  function pararBase() {
    if (!atual || !el || el.paused) { pararBaseJa(); return; }
    const t = atual;
    atual = null;
    if (fadeSaida(t)) rampa(0, Math.min(Math.max(0, Number(t.fade) || 0), 3), () => { try { el.pause(); } catch {} });
    else pararBaseJa();
  }

  // ---- canal de sobreposição (sobrepor / recomeçar) ----
  function tocarPorCima(trilha) {
    // recomeçar: se a MESMA trilha já está no ar, volta do zero
    const vivo = porCima.get(trilha.id);
    if (vivo && trilha.modo === 'recomecar' && !vivo.el.paused) {
      try { vivo.el.currentTime = 0; } catch {}
      return;
    }
    if (porCima.size >= 6) return; // teto de efeitos simultâneos
    const a = new Audio();
    a.preload = 'auto';
    a.src = trilha.url;
    const alvo = volumeDe(trilha);
    a.volume = fadeEntrada(trilha) ? 0 : alvo;
    const entrada = { el: a, trilha, timer: null };
    const chave = trilha.modo === 'recomecar' ? trilha.id : trilha.id + ':' + Math.random().toString(36).slice(2, 6);
    porCima.set(chave, entrada);
    a.addEventListener('ended', () => { porCima.delete(chave); });
    const p = a.play();
    const fadeIn = () => { if (fadeEntrada(trilha)) entrada.timer = rampaEm(a, alvo, trilha.fade); else a.volume = alvo; };
    if (p && typeof p.then === 'function') {
      p.then(fadeIn).catch(() => { porCima.delete(chave); bloqueou(trilha, null); });
    } else {
      fadeIn();
    }
  }
  function pararPorCima() {
    for (const [chave, e] of porCima) {
      if (e.timer) clearInterval(e.timer);
      if (fadeSaida(e.trilha) && !e.el.paused) {
        rampaEm(e.el, 0, Math.min(Math.max(0, Number(e.trilha.fade) || 0), 3), () => { try { e.el.pause(); } catch {} });
      } else {
        try { e.el.pause(); } catch {}
      }
      porCima.delete(chave);
    }
  }

  // Toca esta trilha agora, cada modo do seu jeito
  function tocar(trilha, desde) {
    if (!trilha || !trilha.url) return;
    if (trilha.modo === 'sobrepor' || trilha.modo === 'recomecar') {
      tocarPorCima(trilha);
      return;
    }
    // solo/loop: troca a base com o fade da própria trilha
    if (atual && el && !el.paused) {
      const velha = atual;
      atual = null;
      if (fadeSaida(velha)) {
        rampa(0, Math.min(Math.max(0, Number(velha.fade) || 0), 3), () => { try { el.pause(); } catch {} comecarBase(trilha, desde); });
      } else {
        try { el.pause(); } catch {}
        comecarBase(trilha, desde);
      }
    } else {
      comecarBase(trilha, desde);
    }
  }

  // ⏹ Para TUDO: a base e o que estiver por cima
  function parar() {
    pendente = null;
    pararBase();
    pararPorCima();
  }

  // No primeiro toque da pessoa, o que ficou preso toca
  for (const evento of ['pointerdown', 'touchstart', 'keydown']) {
    document.addEventListener(evento, () => {
      if (pendente) { const p = pendente; pendente = null; tocar(p.trilha, p.desde); }
      if (typeof aoBloquear === 'function') { try { aoBloquear(false); } catch {} }
    }, { passive: true, capture: true });
  }

  return {
    tocar, parar,
    tocando: () => atual,
    temPendente: () => !!pendente,
    quandoBloquear: (fn) => { aoBloquear = fn; },
  };
})();

// ---------------------------------------------------------------------------
// 🎵 O botão quadrado da Mesa de trilhas (o mesmo desenho no painel e nas
// configurações, como uma tecla do Stream Deck): imagem OU emoji de fundo,
// texto na posição escolhida e a fonte global do streamer.
const TRILHAS_GRADES = [4, 6, 8, 12, 15];
const TRILHAS_COLUNAS = { 4: 2, 6: 3, 8: 4, 12: 4, 15: 5 };

function trilhasGradeDe(conf) {
  const g = Number(conf && conf.trilhasGrade);
  return TRILHAS_GRADES.includes(g) ? g : 15;
}

// Aplica a fonte global dos botões como variáveis CSS num contêiner
function aplicarFonteTrilhas(el, conf) {
  const tx = (conf && conf.trilhasTexto) || {};
  el.style.setProperty('--trilha-txt-tam', (Number(tx.tam) || 11) + 'px');
  el.style.setProperty('--trilha-txt-peso', tx.negrito === false ? '400' : '700');
  el.style.setProperty('--trilha-txt-cor', /^#[0-9a-f]{6}$/i.test(tx.cor || '') ? tx.cor : 'inherit');
}

// ⏱ A espera é digitada: "12" (segundos), "2.5", "1:30" (min:seg) ou
// "1:00:00" (h:min:seg). Devolve segundos (0 a 24h) ou null se não entender.
function lerEspera(texto) {
  const s = String(texto || '').trim().replace(',', '.');
  if (!s) return 0;
  let seg = null;
  if (/^\d+(\.\d+)?$/.test(s)) seg = Number(s);
  else {
    const m = s.match(/^(?:(\d+):)?([0-5]?\d):([0-5]\d(?:\.\d+)?)$/);
    if (m) seg = (Number(m[1] || 0) * 3600) + (Number(m[2]) * 60) + Number(m[3]);
  }
  if (seg === null || !Number.isFinite(seg)) return null;
  return Math.min(86400, Math.max(0, Math.round(seg * 10) / 10));
}
// O caminho de volta: segundos → texto amigável para a caixinha
function mostrarEspera(seg) {
  const n = Math.max(0, Number(seg) || 0);
  if (n < 60) return String(Math.round(n * 10) / 10);
  const h = Math.floor(n / 3600), m = Math.floor((n % 3600) / 60), r = Math.round((n % 60) * 10) / 10;
  const dois = (x) => String(x).padStart(2, '0');
  return h ? `${h}:${dois(m)}:${dois(r)}` : `${m}:${dois(r)}`;
}

// Monta UM botão quadrado. opts: { tocando: bool, filhos: número (pastas) }
// 📁 v0.51: 'pasta' é o Botão de multi ação (clique toca em fila; segurar
// abre) e 'pastaSimples' é a pasta comum (clique só abre). O predicado vale
// para "guarda outras teclas dentro".
function trilhaEhPasta(t) {
  return !!t && (t.tipo === 'pasta' || t.tipo === 'pastaSimples');
}

// 🎛️ v0.52.1: LUGAR LIVRE na grade (como no Stream Deck). Cada tecla guarda
// a CÉLULA em que mora dentro da sua visão (raiz ou pasta), no campo `pos` —
// então dá para deixar buracos: a tecla 7 existe sem as 1 a 6. A página de
// uma célula é floor(pos / porPag), o que sobrevive à troca de grade.
// Dentro de uma pasta, a célula 0 é sempre o ⬅ voltar.
function trilhasDaVisao(lista, dentro) {
  return (lista || []).filter((t) => (dentro ? t.pastaId === dentro : !t.pastaId));
}
// v0.89: a célula 0 é útil em TODA visão — o voltar/fechar saiu da grade e
// virou botão independente na barra (config e painel)
function primeiraCelulaDaVisao() { return 0; }

// v0.89: aninhamento livre — pastas dentro de pastas. Os helpers abaixo
// barram o único movimento proibido: o CICLO (uma pasta dentro dela mesma
// ou de uma descendente dela).
function trilhaAncestrais(lista, id) {
  const porId = new Map(lista.map((t) => [t.id, t]));
  const acima = [];
  const vistos = new Set();
  let atual = porId.get(id);
  while (atual && atual.pastaId && !vistos.has(atual.pastaId)) {
    vistos.add(atual.pastaId);
    acima.push(atual.pastaId);
    atual = porId.get(atual.pastaId);
  }
  return acima;
}
function podeMorarEm(lista, tecla, destinoId) {
  if (!destinoId) return true; // a raiz aceita qualquer um
  if (!tecla) return false;
  if (tecla.id === destinoId) return false; // dentro de si mesma, não
  const destino = lista.find((t) => t.id === destinoId);
  if (!destino || !trilhaEhPasta(destino)) return false;
  // pasta não entra numa pasta que mora DENTRO dela (ciclo)
  if (trilhaEhPasta(tecla) && trilhaAncestrais(lista, destinoId).includes(tecla.id)) return false;
  return true;
}
function trilhaNaCelula(lista, dentro, celula) {
  return trilhasDaVisao(lista, dentro).find((t) => Number(t.pos) === celula) || null;
}
function celulaLivre(lista, dentro, apartirDe) {
  const usadas = new Set(trilhasDaVisao(lista, dentro).map((t) => Number(t.pos)));
  let c = Math.max(primeiraCelulaDaVisao(dentro), Number(apartirDe) || 0);
  while (usadas.has(c)) c++;
  return c;
}
function paginasDaVisao(lista, dentro, porPag) {
  const maior = trilhasDaVisao(lista, dentro)
    .reduce((m, t) => Math.max(m, Number(t.pos) || 0), 0);
  return Math.max(1, Math.floor(maior / porPag) + 1);
}
// Dá um lugar a quem não tem (dados antigos, importados) e desfaz empates,
// sempre respeitando quem JÁ tinha um lugar válido.
function normalizarPosTrilhas(lista) {
  const grupos = new Map();
  for (const t of lista || []) {
    const k = t.pastaId || '';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(t);
  }
  for (const [k, itens] of grupos) {
    const min = primeiraCelulaDaVisao(k);
    const usadas = new Set();
    const semLugar = [];
    for (const t of itens) {
      const p = Math.floor(Number(t.pos));
      if (Number.isFinite(p) && p >= min && p <= 9999 && !usadas.has(p)) { t.pos = p; usadas.add(p); }
      else semLugar.push(t);
    }
    let livre = min;
    for (const t of semLugar) {
      while (usadas.has(livre)) livre++;
      t.pos = livre;
      usadas.add(livre);
    }
  }
  return lista;
}

// ↔️ Move uma tecla para a página pedida: ela cai na primeira célula livre de
// lá (a grade tem lugar fixo agora). Se a página estiver LOTADA, ela toma a
// última casa e quem morava lá fica com a casa dela — trocam, ninguém some.
// Devolve a página de pouso, ou -1 se não deu para mover.
function moverTrilhaParaPagina(lista, dentro, porPag, id, pagina) {
  const eu = (lista || []).find((t) => t.id === id);
  if (!eu || !(pagina >= 0)) return -1;
  const vizinhas = trilhasDaVisao(lista, dentro).filter((t) => t.id !== id);
  const usadas = new Set(vizinhas.map((t) => Number(t.pos)));
  const primeira = Math.max(pagina * porPag, primeiraCelulaDaVisao(dentro));
  const fim = (pagina + 1) * porPag - 1;
  if (primeira > fim) return -1; // página que nem existe para esta visão
  for (let c = primeira; c <= fim; c++) {
    if (!usadas.has(c)) { eu.pos = c; return pagina; }
  }
  // Lotada: troca com quem está na última casa da página
  const ultima = vizinhas.find((t) => Number(t.pos) === fim);
  if (!ultima) return -1;
  const meu = Number(eu.pos);
  eu.pos = fim;
  ultima.pos = meu;
  return pagina;
}

// ---------------------------------------------------------------------------
// 🕒 v0.53: o lugar de cada comentário na linha do tempo.
// O servidor decide isso UMA VEZ, na chegada (campo 'ordem'), justamente
// porque o YouTube entrega em LOTES com o horário de alguns segundos atrás —
// ordenar pelo horário fazia as redes se atropelarem no unificado. Aqui as
// telas só obedecem ao número que veio junto. Mensagens salvas antes da v0.53
// não têm 'ordem': para elas o horário real continua valendo.
const posicaoNaLinha = (m) => {
  const o = Number((m || {}).ordem);
  return Number.isFinite(o) ? o : (Number((m || {}).timestamp) || 0);
};
// a chegou DEPOIS de b? (a chegada manda; o número de sequência desempata)
function chegouDepois(a, b) {
  const pa = posicaoNaLinha(a), pb = posicaoNaLinha(b);
  return pa > pb || (pa === pb && (Number((a || {}).seq) || 0) > (Number((b || {}).seq) || 0));
}

// ---------------------------------------------------------------------------
// 🎬 v0.53: o catálogo de ações do OBS que viram botão — o MESMO nas
// configurações (editor da tecla) e no painel (controle do OBS). Cada ação diz
// que alvo precisa; a tela monta os seletores a partir daqui, com as listas
// que o próprio OBS mandou (cenas, fontes, filtros, transições...).
// ---------------------------------------------------------------------------
const OBS_ACOES_INFO = [
  // — Saídas —
  { id: 'transmitir', emoji: '📡', rotulo: 'Transmitir (live)', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Iniciar'], ['parar', 'Encerrar']] },
  { id: 'gravar', emoji: '⏺', rotulo: 'Gravar', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Começar'], ['parar', 'Parar']] },
  { id: 'gravarPausa', emoji: '⏸', rotulo: 'Pausar a gravação', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['pausar', 'Pausar'], ['continuar', 'Continuar']] },
  { id: 'capitulo', emoji: '🔖', rotulo: 'Marcador de capítulo', grupo: 'Saídas', texto: 'Nome do capítulo (opcional)' },
  { id: 'camVirtual', emoji: '📷', rotulo: 'Câmera virtual', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Ligar'], ['parar', 'Desligar']] },
  { id: 'replay', emoji: '⏪', rotulo: 'Replay buffer', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Ligar'], ['parar', 'Desligar']] },
  { id: 'salvarReplay', emoji: '💾', rotulo: 'Salvar o replay', grupo: 'Saídas' },
  { id: 'captura', emoji: '📸', rotulo: 'Print da tela', grupo: 'Saídas', fonte: 'cenasEFontes' },
  // — Cenas e transições —
  { id: 'cena', emoji: '🎬', rotulo: 'Trocar de cena', grupo: 'Cenas', nome: 'cenas',
    modos: [['auto', 'Como o OBS está'], ['programa', 'Direto no ar'], ['preview', 'No preview 👁']] },
  { id: 'estudio', emoji: '🎭', rotulo: 'Modo estúdio', grupo: 'Cenas',
    modos: [['alternar', 'Alternar'], ['ligar', 'Ligar'], ['desligar', 'Desligar']] },
  { id: 'transicaoEstudio', emoji: '✨', rotulo: 'Mandar o preview ao ar', grupo: 'Cenas' },
  { id: 'transicao', emoji: '🔀', rotulo: 'Escolher a transição', grupo: 'Cenas', nome: 'transicoes', duracao: true },
  { id: 'transicaoCena', emoji: '🔁', rotulo: 'Transição só desta cena', grupo: 'Cenas', cena: true, nome: 'transicoes', duracao: true },
  // — Fontes, áudio e mídia —
  { id: 'fonte', emoji: '👁', rotulo: 'Mostrar/esconder fonte', grupo: 'Fontes', cena: true, fonte: 'daCena',
    modos: [['alternar', 'Alternar'], ['mostrar', 'Mostrar'], ['esconder', 'Esconder']] },
  { id: 'filtro', emoji: '🎚', rotulo: 'Ligar/desligar filtro', grupo: 'Fontes', fonte: 'comFiltro', filtro: true,
    modos: [['alternar', 'Alternar'], ['ligar', 'Ligar'], ['desligar', 'Desligar']] },
  { id: 'audioMudo', emoji: '🔇', rotulo: 'Mudo do áudio', grupo: 'Fontes', fonte: 'audio',
    modos: [['alternar', 'Alternar'], ['mudo', 'Deixar mudo'], ['som', 'Devolver o som']] },
  { id: 'audioVolume', emoji: '🔊', rotulo: 'Volume do áudio', grupo: 'Fontes', fonte: 'audio', db: true,
    modos: [['definir', 'Deixar em'], ['ajustar', 'Somar/tirar']] },
  { id: 'midia', emoji: '⏯', rotulo: 'Controle de mídia', grupo: 'Fontes', fonte: 'midia',
    modos: [['alternar', 'Tocar/pausar'], ['tocar', 'Tocar'], ['pausar', 'Pausar'], ['parar', 'Parar'],
      ['recomecar', 'Recomeçar'], ['proxima', 'Próxima'], ['anterior', 'Anterior']] },
  // — Coleções e perfis —
  { id: 'colecao', emoji: '🗂', rotulo: 'Coleção de cenas', grupo: 'Coleções', nome: 'colecoes' },
  { id: 'perfil', emoji: '👤', rotulo: 'Perfil', grupo: 'Coleções', nome: 'perfis' },
  // — ⌨️ v0.84: o coringa — qualquer atalho do OBS vira tecla —
  { id: 'atalho', emoji: '⌨️', rotulo: 'Disparar atalho do OBS', grupo: 'Atalhos', nome: 'atalhos' },
];
const obsAcaoInfo = (id) => OBS_ACOES_INFO.find((a) => a.id === id) || null;

// Traduz um pedaço solto (o dicionário guarda cada rótulo inteiro). Junto
// numa frase colada nada bateria com as chaves — por isso peça a peça.
const obsT = (s) => (typeof OBS_I18N !== 'undefined' ? OBS_I18N.t(s) : s);

// Como a ação aparece por escrito ("👁 Mostrar/esconder fonte · Câmera")
function obsAcaoTexto(acao, alvo) {
  const info = obsAcaoInfo(acao);
  if (!info) return '';
  const a = alvo || {};
  const partes = [];
  const modo = (info.modos || []).find((m) => m[0] === a.modo);
  if (modo && info.modos.length > 1 && a.modo !== info.modos[0][0]) partes.push(obsT(modo[1]));
  if (a.nome) partes.push(a.nome);
  if (a.cena && a.cena !== a.nome) partes.push(a.cena);
  if (a.fonte) partes.push(a.fonte);
  if (a.filtro) partes.push(a.filtro);
  if (info.db && Number.isFinite(Number(a.db))) partes.push((a.modo === 'ajustar' && a.db > 0 ? '+' : '') + a.db + ' dB');
  return obsT(info.emoji + ' ' + info.rotulo) + (partes.length ? ' · ' + partes.join(' · ') : '');
}

// ---------------------------------------------------------------------------
// 🎛️ v0.122: o catálogo de ações do vMix — o espelho do catálogo do OBS, com o
// vocabulário do vMix (entradas, 4 botões de transição, overlays 1-4, saída
// externa, MultiCorder, títulos...). `entrada` diz de que lista a sugestão
// vem ('audio', 'midia', 'titulo' ou true = qualquer entrada).
// ---------------------------------------------------------------------------
const VMIX_ACOES_INFO = [
  // — Entradas e transições —
  { id: 'entrada', emoji: '📺', rotulo: 'Mandar uma entrada', grupo: 'Entradas', entrada: true, duracao: true,
    modos: [['transicao', 'Com o botão de transição 1'], ['cortar', 'Corte seco'], ['fundir', 'Fade'], ['preview', 'Só no preview 👁'], ['direto', 'Direto ao vivo']] },
  { id: 'transicao', emoji: '🔀', rotulo: 'Transição (preview → ao vivo)', grupo: 'Entradas', duracao: true,
    modos: [['transicao1', 'Botão 1'], ['transicao2', 'Botão 2'], ['transicao3', 'Botão 3'], ['transicao4', 'Botão 4'], ['cortar', 'Corte'], ['fundir', 'Fade'], ['stinger1', 'Stinger 1'], ['stinger2', 'Stinger 2']] },
  { id: 'escurecer', emoji: '⬛', rotulo: 'Fade to black', grupo: 'Entradas' },
  // — Saídas —
  { id: 'transmitir', emoji: '📡', rotulo: 'Transmitir (live)', grupo: 'Saídas', canal: 'transmissao',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Iniciar'], ['parar', 'Encerrar']] },
  { id: 'gravar', emoji: '⏺', rotulo: 'Gravar', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Começar'], ['parar', 'Parar']] },
  { id: 'externa', emoji: '📤', rotulo: 'Saída externa', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Ligar'], ['parar', 'Desligar']] },
  { id: 'multiCorder', emoji: '🎞', rotulo: 'MultiCorder', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['iniciar', 'Começar'], ['parar', 'Parar']] },
  { id: 'telaCheia', emoji: '⛶', rotulo: 'Tela cheia', grupo: 'Saídas',
    modos: [['alternar', 'Alternar'], ['ligar', 'Ligar'], ['desligar', 'Desligar']] },
  { id: 'playlist', emoji: '📃', rotulo: 'Playlist', grupo: 'Saídas', modos: [['iniciar', 'Iniciar'], ['parar', 'Parar']] },
  { id: 'captura', emoji: '📸', rotulo: 'Snapshot (print no vMix)', grupo: 'Saídas', texto: 'Nome do arquivo (opcional)' },
  { id: 'marcador', emoji: '🔖', rotulo: 'Marcador no log da gravação', grupo: 'Saídas' },
  // — Overlays —
  { id: 'overlay', emoji: '🧩', rotulo: 'Overlay', grupo: 'Overlays', canal: 'overlay', entrada: true,
    modos: [['alternar', 'Alternar'], ['entrar', 'Entrar'], ['sair', 'Sair'], ['desligar', 'Desligar']] },
  { id: 'overlaysDesligar', emoji: '🧹', rotulo: 'Desligar todos os overlays', grupo: 'Overlays' },
  // — Áudio —
  { id: 'audioMudo', emoji: '🔇', rotulo: 'Mudo da entrada', grupo: 'Áudio', entrada: 'audio',
    modos: [['alternar', 'Alternar'], ['mudo', 'Deixar mudo'], ['som', 'Devolver o som']] },
  { id: 'audioVolume', emoji: '🔊', rotulo: 'Volume da entrada', grupo: 'Áudio', entrada: 'audio', volume: true,
    modos: [['definir', 'Deixar em'], ['ajustar', 'Somar/tirar']] },
  { id: 'audioSolo', emoji: '🎧', rotulo: 'Solo da entrada', grupo: 'Áudio', entrada: 'audio',
    modos: [['alternar', 'Alternar'], ['ligar', 'Ligar'], ['desligar', 'Desligar']] },
  { id: 'masterMudo', emoji: '🔇', rotulo: 'Mudo do master', grupo: 'Áudio',
    modos: [['alternar', 'Alternar'], ['mudo', 'Deixar mudo'], ['som', 'Devolver o som']] },
  { id: 'masterVolume', emoji: '🔊', rotulo: 'Volume do master', grupo: 'Áudio', volume: true,
    modos: [['definir', 'Deixar em'], ['ajustar', 'Somar/tirar']] },
  // — Conteúdo —
  { id: 'midia', emoji: '⏯', rotulo: 'Controle de mídia', grupo: 'Conteúdo', entrada: 'midia',
    modos: [['alternar', 'Tocar/pausar'], ['tocar', 'Tocar'], ['pausar', 'Pausar'], ['recomecar', 'Recomeçar'], ['proximo', 'Próximo'], ['anterior', 'Anterior']] },
  { id: 'titulo', emoji: '🔤', rotulo: 'Texto de um título', grupo: 'Conteúdo', entrada: 'titulo', campo: true, texto: 'O texto novo' },
  { id: 'tituloAnimar', emoji: '✨', rotulo: 'Animar o título', grupo: 'Conteúdo', entrada: 'titulo',
    modos: [['TransitionIn', 'Entrar'], ['TransitionOut', 'Sair'], ['Page1', 'Página 1'], ['Page2', 'Página 2'], ['Continuous', 'Contínua']] },
  // — 🧰 Avançado —
  { id: 'replay', emoji: '⏪', rotulo: 'Replay', grupo: 'Avançado', segundos: true,
    modos: [['marcarInicio', 'Marcar início'], ['marcarFim', 'Marcar fim'], ['marcarUltimos', 'Marcar os últimos segundos'], ['tocarUltimo', 'Tocar o último evento'], ['gravar', 'Gravar'], ['pararGravar', 'Parar de gravar']] },
  { id: 'preset', emoji: '🗂', rotulo: 'Preset', grupo: 'Avançado', modos: [['ultimo', 'Abrir o último'], ['salvar', 'Salvar o atual']] },
  { id: 'script', emoji: '📜', rotulo: 'Script do vMix', grupo: 'Avançado', nome: 'Nome do script', modos: [['iniciar', 'Iniciar'], ['parar', 'Parar']] },
  { id: 'tecla', emoji: '⌨️', rotulo: 'Tecla de atalho do vMix', grupo: 'Avançado', nome: 'Tecla (ex.: F1, CTRL+F2)' },
  { id: 'funcao', emoji: '🧰', rotulo: 'Função livre do vMix', grupo: 'Avançado', nome: 'Nome da função (ex.: OverlayInput1)', entrada: true, texto: 'Value (opcional)', duracao: true },
];
const vmixAcaoInfo = (id) => VMIX_ACOES_INFO.find((a) => a.id === id) || null;

// Como a ação do vMix aparece por escrito ("📺 Mandar uma entrada · Corte seco · 2")
function vmixAcaoTexto(acao, alvo) {
  const info = vmixAcaoInfo(acao);
  if (!info) return '';
  const a = alvo || {};
  const partes = [];
  const modo = (info.modos || []).find((m) => m[0] === a.modo);
  if (modo && info.modos.length > 1 && a.modo !== info.modos[0][0]) partes.push(obsT(modo[1]));
  if (info.canal && a.canal > 0) partes.push((info.canal === 'overlay' ? 'overlay ' : 'canal ') + a.canal);
  if (a.nome) partes.push(a.nome);
  if (a.entrada) partes.push(a.entrada);
  if (a.campo) partes.push(a.campo);
  if (a.texto) partes.push('"' + String(a.texto).slice(0, 30) + '"');
  if (info.volume && Number.isFinite(Number(a.volume))) partes.push((a.modo === 'ajustar' && a.volume > 0 ? '+' : '') + a.volume + '%');
  if (info.segundos && a.modo === 'marcarUltimos' && Number.isFinite(Number(a.segundos))) partes.push(a.segundos + ' s');
  return obsT(info.emoji + ' ' + info.rotulo) + (partes.length ? ' · ' + partes.join(' · ') : '');
}

function montarBotaoTrilha(t, opts = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  const ehPasta = trilhaEhPasta(t);
  const ehVmix = t.tipo === 'vmix'; // 🎛️ v0.122: veste o mesmo visual da tecla do OBS
  const ehObs = t.tipo === 'obs' || ehVmix;
  const ehMidia = t.tipo === 'imagem' || t.tipo === 'video'; // 🖼️🎞️ v0.86
  b.className = 'trilha-tecla'
    + (ehPasta ? ' trilha-pasta' : '')
    + (t.tipo === 'pastaSimples' ? ' trilha-pasta-simples' : '')
    + (ehObs ? ' trilha-obs' : '')
    + (opts.tocando ? ' tocando' : '')
    + (opts.ligado ? ' obs-ligado' : '')
    + (ehVmix ? ' trilha-vmix' : '')
    + (!ehPasta && (ehVmix ? !t.vmixAcao : ehObs ? !t.obsAcao : !t.url) ? ' pendente' : '');
  if (t.cor) b.style.setProperty('--trilha-cor', t.cor);
  b.dataset.trilha = t.id;
  const MODO_DICA = { solo: 'toca/para', sobrepor: 'toca por cima', recomecar: 'recomeça por cima', loop: '🔁 repete' };
  if (t.tipo === 'pastaSimples') {
    b.title = `📁 ${t.nome || '(sem nome)'} — pasta simples: o clique abre (nada toca)`;
  } else if (ehPasta) {
    b.title = `🎛️ ${t.nome || '(sem nome)'} — botão de multi ação: clique toca tudo em fila; segure para abrir`;
  } else if (ehVmix) {
    b.title = `${t.nome || obsT('(sem nome)')} — ${t.vmixAcao ? vmixAcaoTexto(t.vmixAcao, t.vmixAlvo) : obsT('escolha a ação do vMix no editor')}`;
  } else if (ehObs) {
    b.title = `${t.nome || obsT('(sem nome)')} — ${t.obsAcao ? obsAcaoTexto(t.obsAcao, t.obsAlvo) : obsT('escolha a ação do OBS no editor')}`;
  } else if (ehMidia) {
    // 🖼️🎞️ v0.86: a tecla mostra a mídia nas telas (painel + overlay)
    b.title = `${t.nome || t.origem || '(sem nome)'} — ${t.tipo === 'video' ? '🎞️ vídeo' : '🖼️ imagem'} na tela: `
      + (t.telaModo === 'cheia' ? 'tela cheia' : 'janela redimensionável')
      + (t.tipo === 'video' && t.modo === 'loop' ? ' · 🔁 repete' : '');
  } else {
    b.title = `${t.nome || t.origem || '(sem nome)'} — ${MODO_DICA[t.modo] || 'toca/para'}`
      + (t.destino === 'painel' ? ' · só no painel' : t.destino === 'ambos' ? ' · painel + live' : ' · na live');
  }
  // 🖼️ v0.86: a tecla de IMAGEM sem cara própria usa a própria mídia de cara
  const cara = t.imagem || (t.tipo === 'imagem' ? t.url : '');
  if (cara) {
    const img = document.createElement('div');
    img.className = 'trilha-fundo';
    img.style.backgroundImage = `url("${cara}")`;
    b.appendChild(img);
  } else {
    const em = document.createElement('span');
    em.className = 'trilha-emoji';
    em.textContent = t.emoji || (t.tipo === 'pastaSimples' ? '📁' : ehPasta ? '🎛️'
      : ehVmix ? ((vmixAcaoInfo(t.vmixAcao) || {}).emoji || '🎛️')
        : ehObs ? ((obsAcaoInfo(t.obsAcao) || {}).emoji || '🎬')
        : t.tipo === 'imagem' ? '🖼️' : t.tipo === 'video' ? '🎞️' : '🎵');
    b.appendChild(em);
  }
  if (ehPasta && Number.isFinite(opts.filhos)) {
    const qt = document.createElement('span');
    qt.className = 'trilha-qtd';
    qt.textContent = String(opts.filhos);
    b.appendChild(qt);
  }
  if (t.textoPos !== 'oculto' && (t.nome || t.origem)) {
    const nm = document.createElement('span');
    nm.className = 'trilha-rotulo pos-' + (t.textoPos || 'baixo');
    nm.textContent = t.nome || t.origem;
    b.appendChild(nm);
  }
  return b;
}

// O CSS das teclas, injetado uma vez por página (painel e configurações usam
// o mesmíssimo visual — mudar aqui muda nos dois)
(() => {
  if (typeof document === 'undefined') return;
  const css = document.createElement('style');
  css.textContent = `
  .trilhas-teclado { display: grid; gap: 8px; }
  .trilha-tecla {
    --trilha-cor: rgba(255, 255, 255, 0.16);
    position: relative; aspect-ratio: 1 / 1; width: 100%;
    touch-action: none; /* no toque, arrastar a tecla não vira rolagem */
    border: 1px solid var(--trilha-cor); border-radius: 12px;
    background: linear-gradient(160deg, rgba(255,255,255,0.06), rgba(0,0,0,0.25));
    color: inherit; cursor: pointer; overflow: hidden; padding: 0;
  }
  .trilha-tecla:hover { border-color: var(--accent, #7c4dff); box-shadow: 0 0 0 2px var(--accent, #7c4dff) inset; }
  .trilha-tecla.tocando { border-color: var(--accent, #7c4dff); box-shadow: 0 0 0 2px var(--accent, #7c4dff); animation: trilhaTeclaPulsa 1.6s ease-in-out infinite; }
  body.a11y-sem-animacao .trilha-tecla.tocando { animation: none; }
  @keyframes trilhaTeclaPulsa { 0%, 100% { opacity: 1; } 50% { opacity: 0.72; } }
  .trilha-tecla.pendente { opacity: 0.45; }
  .trilha-tecla.selecionada { outline: 2px solid var(--accent, #7c4dff); outline-offset: 2px; }
  .trilha-tecla.arrastando { opacity: 0.4; }
  .trilha-tecla.alvo { outline: 2px dashed var(--accent, #7c4dff); outline-offset: 2px; }
  .trilha-pasta { border-style: dashed; }
  /* v0.52: os espaços vazios da grade — com ➕ nas telas de edição e
     quietinhos (inertes) na Mesa do painel */
  .trilha-slot-vazio { border-style: dashed; opacity: 0.45; background: none; }
  button.trilha-slot-vazio:hover { opacity: 1; border-color: var(--accent, #7c4dff); box-shadow: none; }
  .trilha-slot-vazio.inerte { pointer-events: none; opacity: 0.22; cursor: default; }
  /* 📁 pasta simples: guarda teclas mas nada toca — borda sólida dupla */
  .trilha-pasta-simples { border-style: double; border-width: 3px; }
  /* 🎬 v0.53: a tecla que comanda o OBS tem cara própria — e acende quando o
     que ela controla está LIGADO (gravando, no ar, fonte visível...) */
  .trilha-obs { border-style: solid; box-shadow: inset 0 0 0 1px rgba(124, 77, 255, 0.35); }
  .trilha-obs.obs-ligado {
    border-color: #43a047;
    box-shadow: inset 0 0 0 1px rgba(67, 160, 71, 0.6), 0 0 0 2px rgba(67, 160, 71, 0.55);
  }
  .trilha-obs.obs-ligado .trilha-emoji { filter: drop-shadow(0 0 4px rgba(67, 160, 71, 0.9)); }
  .trilha-qtd {
    position: absolute; top: 4px; right: 6px; font-size: 10px; font-weight: 700;
    background: var(--accent, #7c4dff); color: #fff; border-radius: 8px;
    padding: 1px 5px; min-width: 14px; text-align: center;
  }
  .trilha-fundo { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .trilha-emoji { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: clamp(18px, 42%, 34px); }
  .trilha-rotulo {
    position: absolute; left: 3px; right: 3px; text-align: center;
    font-size: var(--trilha-txt-tam, 11px); font-weight: var(--trilha-txt-peso, 700);
    color: var(--trilha-txt-cor, inherit); line-height: 1.15;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.9);
    /* v0.52.1: o nome aceita quantas quebras de linha a pessoa quiser; na
       tecla (um quadradinho) cabe o que couber — o corte é em linha INTEIRA,
       com reticência, nunca no meio de uma letra */
    overflow: hidden; max-height: calc(100% - 8px);
    display: -webkit-box; -webkit-line-clamp: 12; -webkit-box-orient: vertical;
    white-space: pre-line;
    pointer-events: none;
  }
  .trilha-rotulo.pos-baixo { bottom: 4px; }
  .trilha-rotulo.pos-cima { top: 4px; }
  .trilha-rotulo.pos-meio { top: 50%; transform: translateY(-50%); }
  `;
  document.head && document.head.appendChild(css);
})();

// ---------------------------------------------------------------------------
// ♿ Acessibilidade da interface (painel + configurações)
//
// Cada recurso vira uma classe no <body>; o CSS de cada página faz o resto.
// Os overlays do OBS (conteúdo para o público) não entram: eles são a arte
// que o streamer desenhou para a live.
function aplicarAcessibilidade(a) {
  const b = document.body;
  if (!b) return;
  const conf = a || {};
  b.classList.toggle('a11y-contraste', conf.altoContraste === true);
  b.classList.toggle('a11y-sem-animacao', conf.reduzirAnimacoes === true);
  b.classList.toggle('a11y-foco', conf.focoVisivel === true);
  b.classList.toggle('a11y-formas', conf.formasNoStatus === true);
  // Quem desenha estado por forma (▶/■ dos chips das telinhas) redesenha já
  if (typeof window.renderTelinhaChips === 'function') window.renderTelinhaChips();
}

// ---------------------------------------------------------------------------
// 🎭 Perfis de overlay (v0.54)
//
// 🎭 v0.55: um perfil é um "molde" completo do cartão de destaque, salvo com
// um nome. Com o 🎭 automático ligado, cada comentário destacado veste o
// molde certo: Super Chats e doações pela MAIOR faixa de valor (em reais)
// alcançada, e os comentários comuns pelo perfil escolhido para eles.
// Estas funções rodam igualzinho no /overlay e no editor (prévia real).

// Qual perfil vale para o destaque atual? (null = fica o visual de sempre)
// 🎨 v0.56: os 7 tons oficiais do Super Chat do YouTube (corpo e cabeçalho,
// com as variações que o YouTube já usou) — a faixa por COR casa por aqui
const CORES_SUPERCHAT_YT = {
  azul: ['#1565c0', '#1e88e5'],
  ciano: ['#00b8d4', '#00e5ff'],
  verde: ['#00bfa5', '#1de9b6', '#0f9d58'],
  amarelo: ['#ffb300', '#ffca28', '#ffb800'],
  laranja: ['#e65100', '#f57c00'],
  magenta: ['#c2185b', '#e91e63'],
  vermelho: ['#d00000', '#e62117'],
};

// Qual tom do YouTube este Super Chat tem? (null = cor fora da tabela)
function corDoSuperchat(sc) {
  if (!sc) return null;
  const cores = [sc.color, sc.headerColor]
    .filter(Boolean).map((c) => String(c).trim().toLowerCase());
  for (const [nome, lista] of Object.entries(CORES_SUPERCHAT_YT)) {
    if (cores.some((c) => lista.includes(c))) return nome;
  }
  return null;
}

// 🔤 A palavra aparece no ESPAÇO DO NOME? (o nome em si + os selos ao lado —
// é onde o YouTube mostra "Membro", o nome do nível e afins)
// 🎯 v0.121: palavra começando com "@" é um IDENTIFICADOR (o @ do YouTube, o
// @usuário do Telegram, o login da Twitch/Kick): casa só quando é EXATAMENTE
// aquela pessoa — pelo login que a rede mandou ou pelo nome de exibição
// inteiro — nunca por um pedaço. "@fulano" veste o fulano e mais ninguém
// (nem "fulano2", nem "fulano de tal", nem "@fulanofake").
function palavraNoNome(destaque, palavra) {
  const p = String(palavra || '').trim().toLowerCase();
  if (!p || !destaque) return false;
  if (p.startsWith('@')) {
    const alvo = p.slice(1).trim();
    if (!alvo) return false;
    const limpa = (v) => String(v || '').trim().toLowerCase().replace(/^@/, '');
    return limpa(destaque.authorLogin) === alvo || limpa(destaque.author) === alvo;
  }
  const partes = [String(destaque.author || '')];
  for (const s of (Array.isArray(destaque.selos) ? destaque.selos : [])) {
    if (s && s.nome) partes.push(String(s.nome));
  }
  for (const b of (Array.isArray(destaque.badges) ? destaque.badges : [])) partes.push(String(b));
  return partes.some((t) => t.toLowerCase().includes(p));
}

function perfilDoDestaque(perfis, auto, destaque) {
  if (!auto || auto.ligado !== true || !destaque) return null;
  if (!Array.isArray(perfis) || !perfis.length) return null;
  // 📺 v0.61: molde com rede marcada (YouTube, Twitch, Kick ou Bilibili) não
  // veste comentário de outra rede — o automático segue para a próxima regra
  // e, sem nada que sirva, fica o visual de sempre. Sem rede = compartilhado.
  // (soYouTube era a chave da v0.60; um cliente com dados antigos ainda a lê)
  const achar = (nome) => {
    const p = perfis.find((q) => q && q.nome === nome) || null;
    const rede = p && p.snap ? (p.snap.plataforma || (p.snap.soYouTube === true ? 'youtube' : '')) : '';
    if (rede && destaque.platform !== rede) return null;
    return p;
  };
  const faixas = Array.isArray(auto.faixas) ? auto.faixas : [];
  // Faixa antiga (sem tipo) é por valor — nada muda para quem já configurou
  const tipoDe = (fx) => (fx && ['cor', 'palavra', 'membro'].includes(fx.tipo) ? fx.tipo : 'valor');
  // 🕒 v0.118: TEMPO de membro (meses) — vale a MAIOR faixa alcançada, como o
  // valor; quem não é membro (ou o serviço não disse o tempo) não casa
  const porMembro = () => {
    const meses = Number(destaque.membroMeses);
    if (!Number.isFinite(meses) || meses < 0) return null;
    let melhor = null;
    for (const fx of faixas) {
      if (!valida(fx) || tipoDe(fx) !== 'membro') continue;
      const min = Number(fx.meses);
      if (!Number.isFinite(min) || meses < min) continue;
      if (!melhor || min > Number(melhor.meses)) melhor = fx;
    }
    return melhor ? achar(melhor.perfil) : null;
  };
  const valida = (fx) => fx && typeof fx.perfil === 'string' && fx.perfil;
  // Pago = tem o bloco superchat, como no resto do programa (uma doação que
  // chega sem valor ainda é paga — ela cai na faixa "a partir de R$ 0", se
  // existir, e nunca no perfil dos comentários comuns)
  const pago = !!destaque.superchat;
  if (pago) {
    // 1º a COR do Super Chat (o casamento mais específico: é o tom que o
    // próprio YouTube pintou na mensagem)
    const tom = corDoSuperchat(destaque.superchat);
    if (tom) {
      const porCor = faixas.find((fx) => valida(fx) && tipoDe(fx) === 'cor' && fx.cor === tom);
      if (porCor) { const p = achar(porCor.perfil); if (p) return p; }
    }
    // 2º o VALOR em reais, carimbado pelo servidor (valorBRL); sem carimbo
    // (moeda sem cotação), vale 0 — a faixa nunca chuta para cima
    const valor = Number.isFinite(Number(destaque.valorBRL)) ? Number(destaque.valorBRL) : 0;
    let melhor = null;
    for (const fx of faixas) {
      if (!valida(fx) || tipoDe(fx) !== 'valor') continue;
      const min = Number(fx.min);
      if (!Number.isFinite(min) || valor < min) continue;
      if (!melhor || min > Number(melhor.min)) melhor = fx;
    }
    if (melhor) { const p = achar(melhor.perfil); if (p) return p; }
  }
  // 3º a PALAVRA no espaço do nome (membro, nível, um apelido...) — vale
  // para comentário comum e como reserva de um pago sem faixa própria
  const porPalavra = faixas.find((fx) => valida(fx) && tipoDe(fx) === 'palavra' && palavraNoNome(destaque, fx.palavra));
  if (porPalavra) { const p = achar(porPalavra.perfil); if (p) return p; }
  // 3º½ o TEMPO DE MEMBRO (🕒 v0.118) — comum ou pago sem faixa própria
  { const p = porMembro(); if (p) return p; }
  // 4º o COMUM DA REDE (📺 v0.113): cada rede pode ter o seu molde de
  // comentário comum — '' segue o comum geral e ':nenhum' deixa esta rede no
  // visual ao vivo. Caso real: moldes só do YouTube e a Twitch/Kick caindo
  // num visual ao vivo com arte fora da tela.
  const comumDaRede = () => {
    const porRede = auto.comumPorRede && typeof auto.comumPorRede === 'object' ? auto.comumPorRede[destaque.platform] : '';
    if (typeof porRede === 'string' && porRede) return porRede === ':nenhum' ? null : achar(porRede);
    return auto.comum ? achar(auto.comum) : null;
  };
  if (pago) {
    // Pago sem faixa: por padrão veste o comum da rede (':comum'); '' deixa
    // o visual ao vivo; um nome de molde veste aquele molde
    const sf = typeof auto.semFaixa === 'string' ? auto.semFaixa : ':comum';
    if (sf === ':comum') return comumDaRede();
    return sf ? achar(sf) : null;
  }
  return comumDaRede();
}

// Veste o molde: devolve as settings com o snap do perfil por cima (só as
// chaves do destaque; as peças se fundem uma a uma para um molde antigo ou
// parcial nunca apagar o resto)
function aplicarPerfilNoDestaque(settings, perfil) {
  const snap = perfil && perfil.snap;
  if (!snap || typeof snap !== 'object' || !settings) return settings;
  const out = { ...settings, ...snap };
  out.pecas = { ...(settings.pecas || {}) };
  if (snap.pecas && typeof snap.pecas === 'object') {
    for (const [chave, valor] of Object.entries(snap.pecas)) {
      if (valor && typeof valor === 'object') out.pecas[chave] = { ...out.pecas[chave], ...valor };
    }
  }
  return out;
}

// 🖼️ v0.56.1 — arte escolhida = substituição TOTAL, sempre: com uma arte no
// destaque, o cartão padrão do OBS Social é DESLIGADO e o destaque vira só a
// arte + as peças posicionadas (modo livre), mesmo com o 🧩 geral desligado.
// Não existe mais o modo "arte de fundo atrás da montagem padrão".
function destaqueEmPecas(s) {
  return !!(s && (s.destaqueLivre === true || s.mediaCard));
}
