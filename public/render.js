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
    // 🖥️ v0.159: pedidos que não valem a pena guardar (o monitor pede a
    // imagem a cada segundo) só saem com a conexão aberta — nada de encher
    // a fila de reconexão com pedidos velhos
    aberto() { return !!(ws && ws.readyState === 1); },
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
  clima: { w: 19, h: 11 }, // 🌤️ v0.167
};

// ===========================================================================
// 🌤️ v0.167: os ícones animados do Clima — SVG desenhado aqui mesmo, sem
// biblioteca, com as animações em CSS (param sozinhas no ♿ «reduzir
// animações» e no prefers-reduced-motion). Usados na tela do público, na
// prévia do editor e no botão do painel.
// ===========================================================================
const CLIMA_CONDICOES = ['sol', 'lua', 'parcial', 'nublado', 'nevoa', 'chuvisco', 'chuva', 'chuvaForte', 'trovoada', 'neve', 'granizo'];
const CLIMA_DESCRICAO = {
  sol: 'Céu limpo', lua: 'Céu limpo', parcial: 'Parcialmente nublado', nublado: 'Nublado',
  nevoa: 'Névoa', chuvisco: 'Chuvisco', chuva: 'Chuva', chuvaForte: 'Chuva forte',
  trovoada: 'Trovoada', neve: 'Neve', granizo: 'Granizo',
};
const CLIMA_EMOJI = { sol: '☀️', lua: '🌙', parcial: '⛅', nublado: '☁️', nevoa: '🌫️', chuvisco: '🌦️', chuva: '🌧️', chuvaForte: '🌧️', trovoada: '⛈️', neve: '🌨️', granizo: '🌨️' };
const CLIMA_ICONES_CSS = `
.clima-ico { width: 1em; height: 1em; display: block; overflow: visible; }
.clima-ico * { transform-box: fill-box; transform-origin: center; }
.clima-ico .cl-raios { animation: climaGira 28s linear infinite; }
.clima-ico .cl-nucleo { animation: climaPulsa 3.2s ease-in-out infinite; }
.clima-ico .cl-halo { animation: climaHalo 3.2s ease-in-out infinite; }
.clima-ico .cl-nuvem { animation: climaBoia 4.5s ease-in-out infinite; }
.clima-ico .cl-nuvem2 { animation: climaBoia 6s ease-in-out infinite reverse; }
.clima-ico .cl-gota { animation: climaCai 1.1s linear infinite; }
.clima-ico .cl-gota.cl-forte { animation-duration: 0.65s; }
.clima-ico .cl-floco { animation: climaNeva 2.6s ease-in-out infinite; }
.clima-ico .cl-pedra { animation: climaQuica 1.3s ease-in infinite; }
.clima-ico .cl-raio { animation: climaRelampago 2.8s ease-out infinite; }
.clima-ico .cl-estrela { animation: climaPisca 2.2s ease-in-out infinite; }
.clima-ico .cl-neblina { animation: climaDesliza 3.6s ease-in-out infinite; }
.clima-ico .cl-lua { animation: climaBalanca 6s ease-in-out infinite; }
@keyframes climaGira { to { transform: rotate(360deg); } }
@keyframes climaPulsa { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.14); } }
@keyframes climaHalo { 0%, 100% { transform: scale(0.9); opacity: 0.18; } 50% { transform: scale(1.35); opacity: 0.45; } }
@keyframes climaBoia { 0%, 100% { transform: translateX(0); } 50% { transform: translateX(4px); } }
@keyframes climaCai { 0% { transform: translateY(-4px); opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } 100% { transform: translateY(14px); opacity: 0; } }
@keyframes climaNeva { 0% { transform: translate(0, -4px); opacity: 0; } 25% { opacity: 1; } 50% { transform: translate(3px, 5px); } 75% { opacity: 1; } 100% { transform: translate(-2px, 14px); opacity: 0; } }
@keyframes climaQuica { 0% { transform: translateY(-4px); opacity: 0; } 15% { opacity: 1; } 70% { transform: translateY(12px); } 85% { transform: translateY(8px); } 100% { transform: translateY(12px); opacity: 0; } }
@keyframes climaRelampago { 0%, 84%, 100% { opacity: 0; } 86%, 90% { opacity: 1; } 88% { opacity: 0.2; } 92% { opacity: 0; } 94% { opacity: 1; } 97% { opacity: 0; } }
@keyframes climaPisca { 0%, 100% { opacity: 0.25; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.1); } }
@keyframes climaDesliza { 0%, 100% { transform: translateX(-4px); } 50% { transform: translateX(4px); } }
@keyframes climaBalanca { 0%, 100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
@media (prefers-reduced-motion: reduce) { .clima-ico * { animation: none !important; } }
body.a11y-sem-animacao .clima-ico * { animation: none !important; }
`;
let climaCssPosto = false;
function climaGarantirCss() {
  if (climaCssPosto || typeof document === 'undefined') return;
  climaCssPosto = true;
  const s = document.createElement('style');
  s.id = 'obs-clima-css';
  s.textContent = CLIMA_ICONES_CSS;
  document.head.appendChild(s);
}
// O SVG de uma condição (viewBox 0 0 100 100). Cores fixas de propósito: um
// sol é amarelo em qualquer tema; o «traço» acompanha a cor do texto.
function climaIconeSvg(condicao, dia) {
  const cond = CLIMA_CONDICOES.includes(condicao) ? condicao : null;
  const SOL = '#ffb703', LUA = '#f4e9b8', NUVEM = '#e8eef6', NUVEM_ESCURA = '#9aa8bd', CHUVA = '#6cb6ff', NEVE = '#ffffff', RAIO = '#ffd23f', NEBLINA = '#cfd8e3';
  const raios = (cx, cy, r) => {
    let s = '<g class="cl-raios">';
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      const x1 = cx + Math.cos(a) * (r + 7), y1 = cy + Math.sin(a) * (r + 7);
      const x2 = cx + Math.cos(a) * (r + 16), y2 = cy + Math.sin(a) * (r + 16);
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${SOL}" stroke-width="6" stroke-linecap="round"/>`;
    }
    return s + '</g>';
  };
  // o Sol: os raios giram, um halo respira e o núcleo pulsa — todos em volta do próprio centro
  const sol = (cx, cy, r) => `<g class="cl-sol">${raios(cx, cy, r)}<circle class="cl-halo" cx="${cx}" cy="${cy}" r="${r + 5}" fill="${SOL}" opacity="0.3"/><circle class="cl-nucleo" cx="${cx}" cy="${cy}" r="${r}" fill="${SOL}"/></g>`;
  const lua = (cx, cy, r) => `<path class="cl-lua" d="M${cx + r * 0.2} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.9} ${r * 1.55} a${r * 0.78} ${r * 0.78} 0 0 1 -${r * 0.9} -${r * 1.55}z" fill="${LUA}"/>`;
  const estrelas = (pts) => pts.map(([x, y, d]) => `<circle class="cl-estrela" cx="${x}" cy="${y}" r="2.6" fill="${LUA}" style="animation-delay:${d}s"/>`).join('');
  const nuvem = (x, y, esc, fill, classe) => `<path class="${classe || 'cl-nuvem'}" transform="translate(${x} ${y}) scale(${esc})" d="M14 40 h44 a13 13 0 0 0 1 -26 a19 19 0 0 0 -36 -4 a13 13 0 0 0 -9 30z" fill="${fill}" stroke="rgba(0,0,0,0.12)" stroke-width="1.5"/>`;
  const gotas = (xs, y, forte) => xs.map((x, i) => `<line class="cl-gota${forte ? ' cl-forte' : ''}" x1="${x}" y1="${y}" x2="${x - 3}" y2="${y + 9}" stroke="${CHUVA}" stroke-width="4" stroke-linecap="round" style="animation-delay:${(i * 0.23).toFixed(2)}s"/>`).join('');
  const flocos = (xs, y) => xs.map((x, i) => `<circle class="cl-floco" cx="${x}" cy="${y}" r="3.4" fill="${NEVE}" style="animation-delay:${(i * 0.6).toFixed(2)}s"/>`).join('');
  const pedras = (xs, y) => xs.map((x, i) => `<circle class="cl-pedra" cx="${x}" cy="${y}" r="3" fill="${NEVE}" stroke="${CHUVA}" stroke-width="1.5" style="animation-delay:${(i * 0.35).toFixed(2)}s"/>`).join('');
  const raio = (x, y) => `<path class="cl-raio" d="M${x} ${y} l-8 16 h7 l-5 14 l14 -20 h-7 l6 -10z" fill="${RAIO}"/>`;
  const neblina = (ys) => ys.map((y, i) => `<line class="cl-neblina" x1="18" y1="${y}" x2="${82 - i * 8}" y2="${y}" stroke="${NEBLINA}" stroke-width="6" stroke-linecap="round" style="animation-delay:${(i * 0.7).toFixed(1)}s"/>`).join('');
  let corpo;
  switch (cond) {
    case 'sol': corpo = sol(50, 50, 20); break;
    case 'lua': corpo = lua(46, 48, 22) + estrelas([[78, 24, 0], [84, 46, 0.8], [70, 74, 1.5]]); break;
    case 'parcial': corpo = (dia === false ? lua(40, 34, 16) : sol(38, 34, 15)) + nuvem(26, 30, 0.95, NUVEM); break;
    case 'nublado': corpo = nuvem(30, 16, 0.75, NUVEM_ESCURA, 'cl-nuvem2') + nuvem(18, 34, 1, NUVEM); break;
    case 'nevoa': corpo = nuvem(22, 8, 0.85, NUVEM) + neblina([66, 78, 90]); break;
    case 'chuvisco': corpo = nuvem(18, 10, 1, NUVEM) + gotas([38, 58], 66, false); break;
    case 'chuva': corpo = nuvem(18, 10, 1, NUVEM) + gotas([32, 50, 68], 66, false); break;
    case 'chuvaForte': corpo = nuvem(18, 8, 1, NUVEM_ESCURA) + gotas([26, 38, 50, 62, 74], 64, true); break;
    case 'trovoada': corpo = nuvem(18, 6, 1, NUVEM_ESCURA) + gotas([30, 70], 62, true) + raio(54, 58); break;
    case 'neve': corpo = nuvem(18, 8, 1, NUVEM) + flocos([32, 50, 68], 66); break;
    case 'granizo': corpo = nuvem(18, 8, 1, NUVEM_ESCURA) + pedras([32, 50, 68], 66); break;
    default: corpo = `<rect x="42" y="14" width="16" height="52" rx="8" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="50" cy="76" r="11" fill="#ff5c5c"/><rect class="cl-nucleo" x="46" y="34" width="8" height="34" fill="#ff5c5c"/>`;
  }
  return `<svg class="clima-ico clima-ico-${cond || 'x'}" viewBox="0 0 100 100" aria-hidden="true">${corpo}</svg>`;
}
// Temperatura pronta para a tela: «23°» ou «73°» (a fonte entrega em °C)
function climaTemp(c, unidade) {
  if (c === null || c === undefined || !Number.isFinite(Number(c))) return '--°';
  const v = unidade === 'F' ? Math.round((Number(c) * 9) / 5 + 32) : Math.round(Number(c));
  return v + '°';
}
// ===========================================================================
// 🗺️ v0.169: a lista do rodízio nas telas. Com «cidades soltas» (ou uma
// lista que cabe, ≤ 27) o servidor manda as cidades prontas, com o tempo de
// cada uma. Com o Brasil inteiro / um estado grande, a tela baixa
// municipios-br.json uma vez (o mesmo arquivo do servidor, na MESMA ordem) e
// pega o tempo de cada cidade em «retratos» (por id).
// ===========================================================================
const CLIMA_MAX_CIDADES = 27;
let climaMunicipiosCache = null;   // [[codigo, nome, uf, lat, lon, capital], …]
let climaMunicipiosPromessa = null;
let climaMunicipiosProximaTentativa = 0; // depois de uma falha, espera antes de baixar de novo
const climaMunicipiosOuvintes = new Set(); // um ouvinte por função (os pintores chamam a cada tique)
function climaCarregarMunicipios(aoChegar) {
  if (typeof aoChegar === 'function') { if (climaMunicipiosCache) aoChegar(climaMunicipiosCache); else climaMunicipiosOuvintes.add(aoChegar); }
  if (climaMunicipiosCache) return Promise.resolve(climaMunicipiosCache);
  if (!climaMunicipiosPromessa && Date.now() >= climaMunicipiosProximaTentativa) {
    climaMunicipiosPromessa = fetch('/municipios-br.json').then((r) => r.json()).then((j) => {
      climaMunicipiosCache = Array.isArray(j && j.municipios) ? j.municipios : [];
      const ouvintes = [...climaMunicipiosOuvintes];
      climaMunicipiosOuvintes.clear();
      for (const fn of ouvintes) { try { fn(climaMunicipiosCache); } catch { /* ouvinte quebrado não derruba os outros */ } }
      return climaMunicipiosCache;
    }).catch(() => { climaMunicipiosPromessa = null; climaMunicipiosProximaTentativa = Date.now() + 20000; return null; });
  }
  return climaMunicipiosPromessa || Promise.resolve(null);
}
let climaListaCache = { chave: '', lista: [] };
// As cidades do rodízio (sem o tempo): a lista pronta do servidor ou os
// municípios filtrados. Null enquanto o arquivo ainda não chegou.
function climaCidadesDoRodizio(estado) {
  if (!estado) return [];
  const lista = estado.lista || { modo: 'cidades', uf: '', total: Array.isArray(estado.cidades) ? estado.cidades.length : 0 };
  if (lista.modo !== 'brasil' && lista.modo !== 'uf') return Array.isArray(estado.cidades) ? estado.cidades : [];
  if (lista.total <= CLIMA_MAX_CIDADES && Array.isArray(estado.cidades) && estado.cidades.length) return estado.cidades;
  if (!climaMunicipiosCache) { climaCarregarMunicipios(); return null; }
  const chave = lista.modo + ':' + (lista.uf || '');
  if (climaListaCache.chave !== chave) {
    const uf = lista.modo === 'uf' ? lista.uf : '';
    const out = [];
    for (const m of climaMunicipiosCache) {
      if (!Array.isArray(m) || m.length < 5 || (uf && m[2] !== uf)) continue;
      out.push({ id: 'm' + m[0], nome: String(m[1]), uf: String(m[2]), pais: 'BR', lat: Number(m[3]), lon: Number(m[4]) });
    }
    climaListaCache = { chave, lista: out };
  }
  return climaListaCache.lista;
}
// O tempo de uma cidade: o que veio nela (lista pronta) ou em «retratos»
function climaRetratoDe(estado, cidade) {
  if (!cidade) return { retrato: null, erro: null, em: 0 };
  if (cidade.retrato || cidade.erro) return { retrato: cidade.retrato || null, erro: cidade.erro || null, em: cidade.em || 0 };
  const r = estado && estado.retratos && estado.retratos[cidade.id];
  return r ? { retrato: r.retrato || null, erro: r.erro || null, em: r.em || 0 } : { retrato: null, erro: null, em: 0 };
}
// O rodízio que VALE (a mesma regra do clima.js): com o Brasil inteiro / um
// estado ele está sempre ligado e com no mínimo 15 s por cidade
function climaRodizioEfetivo(conf) {
  const c = conf || {};
  const modo = c.lista && c.lista.modo;
  const lista = modo === 'brasil' || modo === 'uf';
  const seg = Math.max(5, Number(c.rodizioSegundos) || 15);
  return { rodizio: lista || c.rodizio === true, rodizioSegundos: lista ? Math.max(15, seg) : seg };
}
// Em que cidade o rodízio está (a mesma conta do servidor)
function climaIndiceRodizio(estado, conf, n, agora) {
  if (!n) return 0;
  const base = ((Math.round(Number(estado && estado.indice) || 0) % n) + n) % n;
  const ef = climaRodizioEfetivo(conf);
  if (!ef.rodizio || n < 2) return base;
  const per = ef.rodizioSegundos * 1000;
  const decorrido = Math.max(0, Math.floor(((agora || Date.now()) - (Number(estado && estado.desde) || 0)) / per));
  return ((base + decorrido) % n + n) % n;
}
function climaNomeCidade(c) {
  if (!c) return '';
  return c.nome + (c.uf && (!c.pais || c.pais === 'BR') ? ' · ' + c.uf : c.pais && c.pais !== 'BR' ? ' · ' + c.pais : '');
}

// ===========================================================================
// 🗂️ v0.169: o cartão completo — o tempo agora com tudo, as próximas horas e
// os próximos dias. O MESMO desenho na tela do público e na janela do painel.
// ===========================================================================
const CLIMA_COMPLETO_CSS = `
.clc { --clc-size: 18px; font-size: var(--clc-size); font-family: var(--clc-font, inherit); color: var(--clc-fg, #fff);
  background: var(--clc-bg, rgba(11,26,46,0.92)); border-radius: var(--clc-radius, 22px); padding: 1.1em 1.4em;
  display: flex; flex-direction: column; gap: 0.8em; box-shadow: 0 18px 60px rgba(0,0,0,0.45); box-sizing: border-box; min-width: 0; }
.clc, .clc * { line-height: 1.2; }
.clc-topo { display: flex; align-items: center; gap: 1em; }
.clc-icone { font-size: 4.6em; line-height: 1; flex: none; filter: drop-shadow(0 3px 8px rgba(0,0,0,0.35)); }
.clc-icone .clima-ico { width: 1em; height: 1em; }
.clc-agora { display: flex; flex-direction: column; gap: 0.15em; min-width: 0; }
.clc-temp { font-size: 3.2em; font-weight: 800; letter-spacing: -1px; font-variant-numeric: tabular-nums; }
.clc-desc { font-size: 1.05em; opacity: 0.92; }
.clc-lugar { margin-left: auto; text-align: right; display: flex; flex-direction: column; gap: 0.2em; align-items: flex-end; }
.clc-cidade { color: var(--clc-accent, #ffb703); font-weight: 800; text-transform: uppercase; letter-spacing: 1px; font-size: 1.35em; }
.clc-quando { font-size: 0.8em; opacity: 0.7; }
.clc-chips { display: flex; flex-wrap: wrap; gap: 0.4em 0.5em; }
.clc-chip { background: rgba(255,255,255,0.09); border-radius: 999px; padding: 0.3em 0.75em; font-size: 0.9em; white-space: nowrap; font-variant-numeric: tabular-nums; }
.clc-secao { font-size: 0.72em; text-transform: uppercase; letter-spacing: 1.5px; opacity: 0.6; margin-top: 0.2em; }
.clc-horas { display: flex; gap: 0.35em; overflow: hidden; }
.clc-hora { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 0.2em; padding: 0.45em 0.2em; border-radius: 0.7em; background: rgba(255,255,255,0.06); font-size: 0.85em; }
.clc-hora .clima-ico { width: 1.8em; height: 1.8em; }
.clc-hora-h { opacity: 0.75; }
.clc-hora-t { font-weight: 700; }
.clc-hora-c, .clc-dia-c { font-size: 0.85em; color: var(--clc-agua, #6cb6ff); }
.clc-dias { display: grid; grid-template-columns: repeat(var(--clc-ndias, 7), minmax(0, 1fr)); gap: 0.4em; }
.clc-dia { display: flex; flex-direction: column; align-items: center; gap: 0.25em; padding: 0.6em 0.3em; border-radius: 0.8em; background: rgba(255,255,255,0.07); min-width: 0; }
.clc-dia.clc-hoje { background: rgba(255,255,255,0.14); box-shadow: inset 0 0 0 1px var(--clc-accent, #ffb703); }
.clc-dia-n { font-weight: 800; text-transform: capitalize; }
.clc-dia-d { font-size: 0.75em; opacity: 0.7; }
.clc-dia .clima-ico { width: 2.4em; height: 2.4em; }
.clc-dia-t { font-variant-numeric: tabular-nums; }
.clc-dia-t b { font-weight: 800; }
.clc-dia-t span { opacity: 0.65; }
.clc-rodape { font-size: 0.7em; opacity: 0.55; display: flex; justify-content: space-between; gap: 1em; flex-wrap: wrap; }
.clc-aviso { font-size: 0.9em; opacity: 0.8; padding: 0.4em 0; }
.clc-compacto .clc-icone { font-size: 3.4em; }
.clc-compacto .clc-temp { font-size: 2.4em; }
`;
let climaCompletoCssPosto = false;
function climaCompletoGarantirCss() {
  if (climaCompletoCssPosto || typeof document === 'undefined') return;
  climaCompletoCssPosto = true;
  climaGarantirCss();
  const s = document.createElement('style');
  s.id = 'obs-clima-completo-css';
  s.textContent = CLIMA_COMPLETO_CSS;
  document.head.appendChild(s);
}
function climaIdioma() {
  try {
    const l = (typeof document !== 'undefined' && document.documentElement.lang) || (typeof navigator !== 'undefined' && navigator.language) || 'pt-BR';
    return l;
  } catch { return 'pt-BR'; }
}
// «dom», «seg»… no idioma da página; a data como dd/mm
function climaNomeDia(data, hoje) {
  const [a, m, d] = String(data).split('-').map(Number);
  const dt = new Date(a, (m || 1) - 1, d || 1, 12);
  let nome = '';
  try { nome = new Intl.DateTimeFormat(climaIdioma(), { weekday: 'short' }).format(dt).replace(/\.$/, ''); } catch { nome = String(data).slice(5); }
  return { nome: String(data) === String(hoje) ? (typeof OBS_I18N !== 'undefined' ? OBS_I18N.t('hoje') : 'hoje') : nome, dia: String(d).padStart(2, '0') + '/' + String(m).padStart(2, '0') };
}
// Monta o cartão completo dentro de «alvo».
//   completo: { cidade, previsao, erro, em }      atual: { retrato, erro }
//   conf: settings.clima (unidade, completoDias)   opcoes: { compacto }
function climaPintarCompleto(alvo, completo, atual, conf, opcoes) {
  if (!alvo) return;
  climaCompletoGarantirCss();
  const t = (s) => (typeof OBS_I18N !== 'undefined' ? OBS_I18N.t(s) : s);
  const cc = conf || {};
  const o = opcoes || {};
  const cidade = completo && completo.cidade;
  const p = completo && completo.previsao;
  const r = (atual && atual.retrato) || null;
  const ndias = Math.max(3, Math.min(7, Number(cc.completoDias) || 7));
  const el = (tag, cls, texto) => { const e = document.createElement(tag); if (cls) e.className = cls; if (texto !== undefined && texto !== null) e.textContent = String(texto); return e; };
  alvo.innerHTML = '';
  alvo.classList.add('clc');
  alvo.classList.toggle('clc-compacto', !!o.compacto);
  alvo.style.setProperty('--clc-ndias', String(ndias));
  alvo.dataset.noI18n = '1';
  // — o tempo agora —
  const topo = el('div', 'clc-topo');
  const icone = el('div', 'clc-icone');
  const condAgora = r ? r.condicao : (p && p.dias[0] ? p.dias[0].condicao : null);
  icone.innerHTML = climaIconeSvg(condAgora, r ? r.dia : true);
  topo.appendChild(icone);
  const agora = el('div', 'clc-agora');
  agora.appendChild(el('div', 'clc-temp', r ? climaTemp(r.temp, cc.unidade) : '--°'));
  agora.appendChild(el('div', 'clc-desc', r ? (r.descricao || CLIMA_DESCRICAO[r.condicao] || '') : (atual && atual.erro ? t('sem dados') : t('buscando…'))));
  topo.appendChild(agora);
  const lugar = el('div', 'clc-lugar');
  lugar.appendChild(el('div', 'clc-cidade', climaNomeCidade(cidade)));
  if (r && r.atualizadoEm) {
    const d = new Date(r.atualizadoEm);
    if (!Number.isNaN(d.getTime())) lugar.appendChild(el('div', 'clc-quando', t('agora') + ' · ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')));
  }
  topo.appendChild(lugar);
  alvo.appendChild(topo);
  // — os detalhes do momento —
  const ex = (p && p.extras) || {};
  const chips = [];
  const n = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
  if (r && n(r.sensacao) !== null) chips.push(['🌡️', climaTemp(r.sensacao, cc.unidade), t('Sensação térmica')]);
  if (r && n(r.umidade) !== null) chips.push(['💧', r.umidade + '%', t('Umidade')]);
  if (r && n(r.vento) !== null) chips.push(['💨', Math.round(r.vento) + ' km/h', t('Vento')]);
  if (n(ex.pressao) !== null) chips.push(['🔽', Math.round(ex.pressao) + ' hPa', t('Pressão')]);
  if (n(ex.uv) !== null) chips.push(['☀️', 'UV ' + Math.round(ex.uv), t('Índice UV')]);
  if (n(ex.nuvens) !== null) chips.push(['☁️', ex.nuvens + '%', t('Nuvens')]);
  if (n(ex.visibilidade) !== null) chips.push(['👁️', (Math.round(ex.visibilidade * 10) / 10) + ' km', t('Visibilidade')]);
  if (n(ex.orvalho) !== null) chips.push(['💦', climaTemp(ex.orvalho, cc.unidade), t('Ponto de orvalho')]);
  if (n(ex.precipitacao) !== null && ex.precipitacao > 0) chips.push(['🌧️', ex.precipitacao + ' mm', t('Chuva agora')]);
  if (ex.nascer) chips.push(['🌅', ex.nascer, t('Nascer do sol')]);
  if (ex.por) chips.push(['🌇', ex.por, t('Pôr do sol')]);
  if (chips.length) {
    const box = el('div', 'clc-chips');
    for (const [emoji, valor, titulo] of chips) { const c = el('span', 'clc-chip', emoji + ' ' + valor); c.title = titulo; box.appendChild(c); }
    alvo.appendChild(box);
  }
  // — as próximas horas —
  if (p && Array.isArray(p.horas) && p.horas.length) {
    const passo = Math.max(1, Math.ceil(p.horas.length / 8));
    const horas = p.horas.filter((_, i) => i % passo === 0).slice(0, 8);
    alvo.appendChild(el('div', 'clc-secao', t('Próximas horas')));
    const box = el('div', 'clc-horas');
    for (const h of horas) {
      const c = el('div', 'clc-hora');
      c.appendChild(el('div', 'clc-hora-h', String(h.hora).slice(11, 16)));
      const ic = el('div'); ic.innerHTML = climaIconeSvg(h.condicao, !/^(lua)$/.test(h.condicao || '')); c.appendChild(ic);
      c.appendChild(el('div', 'clc-hora-t', climaTemp(h.temp, cc.unidade)));
      if (n(h.chuvaPct) !== null) c.appendChild(el('div', 'clc-hora-c', '💧' + h.chuvaPct + '%'));
      box.appendChild(c);
    }
    alvo.appendChild(box);
  }
  // — os próximos dias —
  if (p && Array.isArray(p.dias) && p.dias.length) {
    alvo.appendChild(el('div', 'clc-secao', t('Próximos dias')));
    const box = el('div', 'clc-dias');
    const hoje = p.dias[0].data;
    for (const d of p.dias.slice(0, ndias)) {
      const c = el('div', 'clc-dia' + (d.data === hoje ? ' clc-hoje' : ''));
      const nd = climaNomeDia(d.data, hoje);
      c.appendChild(el('div', 'clc-dia-n', nd.nome));
      c.appendChild(el('div', 'clc-dia-d', nd.dia));
      const ic = el('div'); ic.innerHTML = climaIconeSvg(d.condicao, true); ic.title = d.descricao || ''; c.appendChild(ic);
      const tt = el('div', 'clc-dia-t');
      const bx = el('b', '', climaTemp(d.tmax, cc.unidade)); tt.appendChild(bx);
      tt.appendChild(document.createTextNode(' '));
      tt.appendChild(el('span', '', climaTemp(d.tmin, cc.unidade)));
      c.appendChild(tt);
      if (n(d.chuvaPct) !== null) c.appendChild(el('div', 'clc-dia-c', '💧' + d.chuvaPct + '%'));
      box.appendChild(c);
    }
    alvo.appendChild(box);
  } else if (completo && completo.erro && !p) {
    alvo.appendChild(el('div', 'clc-aviso', '⚠️ ' + t('sem previsão') + ' — ' + completo.erro));
  } else if (!p) {
    alvo.appendChild(el('div', 'clc-aviso', t('buscando a previsão…')));
  }
  // — o rodapé —
  const rod = el('div', 'clc-rodape');
  const fontes = (o.fontes) || {};
  const nomeFonte = (f) => (f && fontes[f] && fontes[f].nome) || f || '';
  const partes = [];
  if (r && r.fonte) partes.push(t('agora') + ': ' + nomeFonte(r.fonte));
  if (p && p.fonte) partes.push(t('previsão') + ': ' + nomeFonte(p.fonte));
  rod.appendChild(el('span', '', partes.join(' · ')));
  if (p && p.atualizadoEm) { const d = new Date(p.atualizadoEm); if (!Number.isNaN(d.getTime())) rod.appendChild(el('span', '', t('previsão atualizada às') + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'))); }
  alvo.appendChild(rod);
}
if (typeof window !== 'undefined') Object.assign(window, { CLIMA_CONDICOES, CLIMA_DESCRICAO, CLIMA_EMOJI, CLIMA_MAX_CIDADES, climaGarantirCss, climaIconeSvg, climaTemp, climaCarregarMunicipios, climaCidadesDoRodizio, climaRetratoDe, climaIndiceRodizio, climaRodizioEfetivo, climaNomeCidade, climaPintarCompleto, climaCompletoGarantirCss, climaNomeDia });
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
  // 🪟 v0.168: opacidade dos painéis (--panel: colunas, barras, caixas) e,
  // v0.168.1, dos cartões (--panel2: cards e comentários) — cada uma no seu
  // seletor; abaixo de 100 % a superfície fica translúcida e a animação de
  // fundo aparece em qualquer lugar (o padrão é 100 %: opaco, como sempre foi)
  {
    for (const [chave, cssVar, campo, cssPct] of [['corPainel', '--panel', 'painelOpacidade', '--tema-painel-opacidade'], ['corPainel2', '--panel2', 'cartaoOpacidade', '--tema-cartao-opacidade']]) {
      const pct = num(t[campo], 20, 100, 100);
      raiz.style.setProperty(cssPct, String(pct / 100));
      if (pct >= 100) continue; // a cor sólida já foi posta (ou tirada) acima
      const base = typeof t[chave] === 'string' && /^#[0-9a-f]{6}$/i.test(t[chave]) ? t[chave] : (getComputedStyle(raiz).getPropertyValue(cssVar).trim() || '');
      const m = /^#([0-9a-f]{6})$/i.exec(base);
      if (!m) continue;
      const n = parseInt(m[1], 16);
      raiz.style.setProperty(cssVar, `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${pct / 100})`);
    }
    // v0.168.2: as colunas do painel (Unificado, YouTube, Twitch…) pintam o
    // fundo da página (--bg) por cima da animação — elas seguem a opacidade
    // dos painéis por --bg-painel (sem o ajuste, a variável nem existe)
    const pctCol = num(t.painelOpacidade, 20, 100, 100);
    if (pctCol >= 100) raiz.style.removeProperty('--bg-painel');
    else {
      const base = typeof t.corFundo === 'string' && /^#[0-9a-f]{6}$/i.test(t.corFundo) ? t.corFundo : (getComputedStyle(raiz).getPropertyValue('--bg').trim() || '');
      const m = /^#([0-9a-f]{6})$/i.exec(base);
      if (m) { const n = parseInt(m[1], 16); raiz.style.setProperty('--bg-painel', `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${pctCol / 100})`); }
    }
  }

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
  aplicarAnimacaoDoTema(t);
}

// 🎬 v0.164: o fundo animado do tema (painel + configurações) — o mesmo
// motor do mini Mesa, num <canvas> atrás de tudo (por cima da imagem de
// fundo). Sem animação, o canvas nem é criado.
function aplicarAnimacaoDoTema(t) {
  if (typeof document === 'undefined' || !document.body || typeof criarAnimadorFundo !== 'function') return;
  const anim = typeof TEMA_ANIMACOES !== 'undefined' && TEMA_ANIMACOES.some((a) => a.id === t.animacao) ? t.animacao : 'nenhuma';
  let canvas = document.getElementById('obs-tema-anim');
  if (anim === 'nenhuma') {
    // o canvas fica (escondido) — criar e jogar fora a cada troca vazava
    // ouvintes de resize/visibilidade e um bitmap do tamanho da tela
    if (aplicarAnimacaoDoTema.motor) aplicarAnimacaoDoTema.motor.aplicar('nenhuma', 60, {});
    if (canvas) canvas.hidden = true;
    return;
  }
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = 'obs-tema-anim';
    canvas.style.cssText = 'position:fixed;inset:0;z-index:-1;pointer-events:none;';
    document.body.appendChild(canvas);
    aplicarAnimacaoDoTema.motor = null;
  }
  canvas.hidden = false;
  if (!aplicarAnimacaoDoTema.motor) aplicarAnimacaoDoTema.motor = criarAnimadorFundo(canvas);
  const cs = getComputedStyle(document.documentElement);
  const cor = (v, padrao) => { const x = cs.getPropertyValue(v).trim(); return /^#[0-9a-f]{6}$/i.test(x) ? x : padrao; };
  const op = temaAnimOpcoes(t);
  // 🪟 v0.168: a camada — atrás de tudo (o de sempre) ou por cima de tudo
  // (sem pegar o mouse); a opacidade da camada é do motor (canvas.style.opacity)
  canvas.style.zIndex = op.camada === 'frente' ? '2147483000' : '-1';
  canvas.dataset.camada = op.camada;
  aplicarAnimacaoDoTema.motor.aplicar(anim, op.intensidade, { destaque: cor('--accent', '#7c3aed'), texto: cor('--text', '#e6edf3'), fundo: cor('--bg', '#0d1117') }, op);
}

function garantirCssTema() {
  if (document.getElementById('obs-tema-css')) return;
  const style = document.createElement('style');
  style.id = 'obs-tema-css';
  style.textContent = `
    #obs-tema-fundo {
      position: fixed; inset: 0; z-index: -2; pointer-events: none; /* 🎬 v0.164: atrás do canvas da animação (-1) */
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
        // 🎵 v0.162: a nova só começa DEPOIS do fade da antiga — e o «desde»
        // (o instante em que o servidor mandou tocar, usado para uma tela que
        // chega atrasada entrar no ponto certo) anda junto com essa espera.
        // Sem isso, comecarBase achava que a trilha já tocava há N segundos
        // e pulava o começo dela (o tamanho do fade) — «comia» a introdução.
        const esperaDesde = Date.now();
        rampa(0, Math.min(Math.max(0, Number(velha.fade) || 0), 3), () => {
          try { el.pause(); } catch {}
          comecarBase(trilha, desde ? desde + (Date.now() - esperaDesde) : desde);
        });
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
  // 🎙️ v0.156: era «🔇 Mudo do áudio» — o 🔇 parecia o ESTADO (já mudo) e
  // «mudo do áudio» confundia; agora o nome diz as duas direções
  { id: 'audioMudo', emoji: '🎙️', rotulo: 'Silenciar/liberar o áudio', grupo: 'Fontes', fonte: 'audio',
    modos: [['alternar', 'Alternar'], ['mudo', 'Silenciar'], ['som', 'Liberar o som']] },
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
  { id: 'audioMudo', emoji: '🎙️', rotulo: 'Silenciar/liberar a entrada', grupo: 'Áudio', entrada: 'audio',
    modos: [['alternar', 'Alternar'], ['mudo', 'Silenciar'], ['som', 'Liberar o som']] },
  { id: 'audioVolume', emoji: '🔊', rotulo: 'Volume da entrada', grupo: 'Áudio', entrada: 'audio', volume: true,
    modos: [['definir', 'Deixar em'], ['ajustar', 'Somar/tirar']] },
  { id: 'audioSolo', emoji: '🎧', rotulo: 'Solo da entrada', grupo: 'Áudio', entrada: 'audio',
    modos: [['alternar', 'Alternar'], ['ligar', 'Ligar'], ['desligar', 'Desligar']] },
  { id: 'masterMudo', emoji: '🔈', rotulo: 'Silenciar/liberar o master', grupo: 'Áudio',
    modos: [['alternar', 'Alternar'], ['mudo', 'Silenciar'], ['som', 'Liberar o som']] },
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

// 🎭 v0.156: o ESTADO de uma tecla 🎬/🎛️ tem três cores — o que
// obsTeclaEstado/vmixTeclaEstado (painel) devolvem:
//   'verde'    = ligado: no ar, gravando, fonte visível, som ATIVO...
//   'vermelho' = no PREVIEW (modo estúdio / preview do vMix) ou áudio MUDO
//   false      = apagado · null = desconhecido (programa desconectado)
// A tecla ganha o contorno da cor; e a cara (emoji) pode mudar junto: o
// trio automático de cada ação mora aqui. «vermelho» só existe para quem
// tem preview ou mudo.
const ESTADO_EMOJI_AUTO = {
  obs: {
    transmitir: { verde: '🔴', apagado: '📡' }, gravar: { verde: '⏺', apagado: '⏹' }, gravarPausa: { verde: '⏸', apagado: '⏺' },
    camVirtual: { verde: '📹', apagado: '📷' }, replay: { verde: '⏪', apagado: '⏹' }, estudio: { verde: '🎭', apagado: '🎬' },
    cena: { verde: '🔴', vermelho: '👁', apagado: '🎬' }, colecao: { verde: '📂', apagado: '🗂' }, perfil: { verde: '✅', apagado: '👤' },
    transicao: { verde: '✅', apagado: '🔀' }, fonte: { verde: '👁', apagado: '🙈' }, filtro: { verde: '🎚', apagado: '⚪' },
    audioMudo: { verde: '🎙️', vermelho: '🔇', apagado: '🎙️' }, midia: { verde: '▶️', apagado: '⏸' },
  },
  vmix: {
    transmitir: { verde: '🔴', apagado: '📡' }, gravar: { verde: '⏺', apagado: '⏹' }, externa: { verde: '📤', apagado: '⚪' },
    multiCorder: { verde: '⏺', apagado: '⏹' }, telaCheia: { verde: '⛶', apagado: '⚪' }, playlist: { verde: '📃', apagado: '⚪' },
    escurecer: { verde: '⬛', apagado: '🟦' }, entrada: { verde: '🔴', vermelho: '👁', apagado: '📺' }, overlay: { verde: '🧩', apagado: '⚪' },
    audioMudo: { verde: '🎙️', vermelho: '🔇', apagado: '🎙️' }, audioSolo: { verde: '🎧', apagado: '⚪' },
    masterMudo: { verde: '🔊', vermelho: '🔇', apagado: '🔈' }, midia: { verde: '▶️', apagado: '⏸' },
  },
};
// Esta ação tem o estado vermelho (preview ou mudo)?
function acaoTemVermelho(tipo, acao) {
  const p = (ESTADO_EMOJI_AUTO[tipo] || {})[acao];
  return !!(p && p.vermelho);
}
// O trio que vale para esta tecla: null = cara fixa (o emoji escolhido)
function trilhaEmojiEstado(t) {
  const conf = (t && t.estadoEmoji) || {};
  const acao = t.tipo === 'vmix' ? t.vmixAcao : t.tipo === 'obs' ? t.obsAcao : '';
  if (!acao) return null;
  if (conf.modo === 'manual') {
    if (!conf.verde && !conf.vermelho && !conf.apagado) return null;
    return { verde: conf.verde || '', vermelho: conf.vermelho || '', apagado: conf.apagado || '' };
  }
  if (conf.modo === 'auto') {
    const p = (ESTADO_EMOJI_AUTO[t.tipo] || {})[acao];
    return p ? { verde: p.verde || '', vermelho: p.vermelho || '', apagado: p.apagado || '' } : null;
  }
  return null;
}

// 🎭 v0.156 · 📱 v0.163: o estado de uma tecla do OBS/vMix a partir do resumo
// que o servidor manda ({ type: 'obs' } / { type: 'vmix' }). Vale no painel
// e no mini Mesa do celular — a MESMA conta nos dois. Sem conexão a
// resposta é null (desconhecido): a tecla não acende e mostra a cara de
// sempre, não a de «desligado».
function vmixTeclaLigadaDe(t, o) {
  o = o || {};
  if (!o.conectado || !t.vmixAcao) return null;
  const a = t.vmixAlvo || {};
  const ent = (ref) => (o.entradas || []).find((e) => String(e.numero) === String(ref) || e.chave === ref || e.titulo === ref) || null;
  switch (t.vmixAcao) {
    case 'transmitir': return o.transmitindo === true;
    case 'gravar': return o.gravando === true;
    case 'externa': return o.externa === true;
    case 'multiCorder': return o.multiCorder === true;
    case 'telaCheia': return o.telaCheia === true;
    case 'playlist': return o.playlist === true;
    case 'escurecer': return o.escurecido === true;
    case 'entrada': {
      const e = ent(a.entrada);
      if (!e) return false;
      return a.modo === 'preview' ? e.numero === o.preview : e.numero === o.programa;
    }
    case 'overlay': {
      const ov = (o.overlays || []).find((x) => x.canal === Number(a.canal || 1));
      if (!ov || !ov.entrada) return false;
      const e = ent(a.entrada);
      return e ? ov.entrada === e.numero : true;
    }
    case 'audioMudo': { const e = ent(a.entrada); return !!e && e.mudo === true; }
    case 'audioSolo': { const e = ent(a.entrada); return !!e && e.solo === true; }
    case 'masterMudo': return !!(o.master && o.master.mudo);
    case 'midia': { const e = ent(a.entrada); return !!e && /running|playing/i.test(e.estado || ''); }
    default: return false;
  }
}
function obsTeclaLigadaDe(t, o) {
  o = o || {};
  if (!o.conectado || !t.obsAcao) return null;
  const a = t.obsAlvo || {};
  switch (t.obsAcao) {
    case 'transmitir': return o.transmitindo === true;
    case 'gravar': return o.gravando === true;
    case 'gravarPausa': return o.gravandoPausado === true;
    case 'camVirtual': return o.camVirtual === true;
    case 'replay': return o.replay === true;
    case 'estudio': return o.estudio === true;
    // A tecla que escolhe o PREVIEW acende pela cena do preview, não pela
    // que está no ar
    case 'cena': {
      if (!a.nome) return false;
      const noPreview = a.modo === 'preview' || (a.modo !== 'programa' && o.estudio === true);
      return noPreview ? a.nome === o.cenaPreview : a.nome === o.cenaPrograma;
    }
    case 'colecao': return !!a.nome && a.nome === o.colecaoAtual;
    case 'perfil': return !!a.nome && a.nome === o.perfilAtual;
    case 'transicao': return !!a.nome && a.nome === o.transicaoAtual;
    case 'fonte': {
      const cena = a.cena || o.cenaPrograma;
      const i = a.id
        ? (o.itens || []).find((x) => x.cena === cena && x.id === a.id)
        : (o.itens || []).find((x) => x.cena === cena && x.nome === a.fonte);
      return !!i && i.ligado === true;
    }
    case 'filtro': {
      const f = (o.filtros || []).find((x) => x.fonte === a.fonte && x.nome === a.filtro);
      return !!f && f.ligado === true;
    }
    // Mudo aceso = está mudo mesmo (é o que a tecla 🔇 mostra)
    case 'audioMudo': {
      const f = (o.fontesAudio || []).find((x) => x.nome === a.fonte);
      return !!f && f.mudo === true;
    }
    case 'midia': {
      const m = (o.midias || []).find((x) => x.nome === a.fonte);
      return !!m && m.estado === 'playing';
    }
    default: return false;
  }
}
// O estado em TRÊS cores (o contorno da tecla e a cara dela):
//   'verde'    = ligado — no ar, gravando, fonte visível, som ATIVO
//   'vermelho' = no PREVIEW (modo estúdio / preview do vMix) ou áudio MUDO
//   false      = apagado · null = desconhecido (programa desconectado)
function obsTeclaEstadoDe(t, o) {
  o = o || {};
  if (!o.conectado || !t.obsAcao) return null;
  const a = t.obsAlvo || {};
  switch (t.obsAcao) {
    case 'cena': {
      if (!a.nome) return false;
      if (a.nome === o.cenaPrograma) return 'verde';
      return o.estudio === true && a.nome === o.cenaPreview ? 'vermelho' : false;
    }
    case 'audioMudo': {
      const f = (o.fontesAudio || []).find((x) => x.nome === a.fonte);
      return f ? (f.mudo === true ? 'vermelho' : 'verde') : false;
    }
    default: return obsTeclaLigadaDe(t, o) ? 'verde' : false;
  }
}
function vmixTeclaEstadoDe(t, o) {
  o = o || {};
  if (!o.conectado || !t.vmixAcao) return null;
  const a = t.vmixAlvo || {};
  const ent = (ref) => (o.entradas || []).find((e) => String(e.numero) === String(ref) || e.chave === ref || e.titulo === ref) || null;
  switch (t.vmixAcao) {
    case 'entrada': {
      const e = ent(a.entrada);
      if (!e) return false;
      return e.numero === o.programa ? 'verde' : e.numero === o.preview ? 'vermelho' : false;
    }
    // entrada sem áudio (mudo não é booleano) fica apagada — não «som ativo»
    case 'audioMudo': { const e = ent(a.entrada); return e && typeof e.mudo === 'boolean' ? (e.mudo ? 'vermelho' : 'verde') : false; }
    case 'masterMudo': return o.master && typeof o.master.mudo === 'boolean' ? (o.master.mudo ? 'vermelho' : 'verde') : false;
    default: return vmixTeclaLigadaDe(t, o) ? 'verde' : false;
  }
}

function montarBotaoTrilha(t, opts = {}) {
  const b = document.createElement('button');
  b.type = 'button';
  const ehPasta = trilhaEhPasta(t);
  const ehVmix = t.tipo === 'vmix'; // 🎛️ v0.122: veste o mesmo visual da tecla do OBS
  const ehObs = t.tipo === 'obs' || ehVmix;
  const ehMidia = t.tipo === 'imagem' || t.tipo === 'video'; // 🖼️🎞️ v0.86
  // 🎭 v0.156: o estado em três cores (opts.estado); opts.ligado (true/false)
  // continua valendo para quem só conhece ligado/desligado
  const estado = opts.estado !== undefined ? opts.estado
    : opts.ligado === true ? 'verde' : opts.ligado === false ? false : undefined;
  b.className = 'trilha-tecla'
    + (ehPasta ? ' trilha-pasta' : '')
    + (t.tipo === 'pastaSimples' ? ' trilha-pasta-simples' : '')
    + (ehObs ? ' trilha-obs' : '')
    + (opts.tocando ? ' tocando' : '')
    + (estado === 'verde' ? ' obs-ligado' : estado === 'vermelho' ? ' obs-preview' : '')
    + (ehVmix ? ' trilha-vmix' : '')
    // 🔗 v0.161: tecla apontada para um arquivo que sumiu também fica «pendente»
    + (!ehPasta && (ehVmix ? !t.vmixAcao : ehObs ? !t.obsAcao : (!t.url || t.localSumiu === true)) ? ' pendente' : '');
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
  const emojiBase = t.emoji || (t.tipo === 'pastaSimples' ? '📁' : ehPasta ? '🎛️'
    : ehVmix ? ((vmixAcaoInfo(t.vmixAcao) || {}).emoji || '🎛️')
      : ehObs ? ((obsAcaoInfo(t.obsAcao) || {}).emoji || '🎬')
      : t.tipo === 'imagem' ? '🖼️' : t.tipo === 'video' ? '🎞️' : '🎵');
  // 🎭 v0.156: com o estado conhecido (verde/vermelho/false — null e
  // undefined = sem conexão) e um trio configurado, a cara é a do estado;
  // trocou de estado → um pulinho
  const trio = ehObs ? trilhaEmojiEstado(t) : null;
  const emojiEstado = trio && (estado === 'verde' || estado === 'vermelho' || estado === false)
    ? ((estado === 'verde' ? trio.verde : estado === 'vermelho' ? trio.vermelho : trio.apagado) || '') // caixa vazia = emoji de sempre
    : '';
  if (cara) {
    const img = document.createElement('div');
    img.className = 'trilha-fundo';
    img.style.backgroundImage = `url("${cara}")`;
    b.appendChild(img);
    if (emojiEstado) {
      // com imagem, o estado vira um selo no canto — a arte continua inteira
      const selo = document.createElement('span');
      selo.className = 'trilha-estado' + (opts.trocou ? ' estado-trocou' : '');
      selo.textContent = emojiEstado;
      b.appendChild(selo);
    }
  } else {
    const em = document.createElement('span');
    em.className = 'trilha-emoji' + (emojiEstado && opts.trocou ? ' estado-trocou' : '');
    em.textContent = emojiEstado || emojiBase;
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
  /* 📱 v0.163: o realce de passar o mouse só onde existe mouse — no toque ele
     grudava na tecla tocada e tapava o contorno de estado (tocando/verde/vermelho) */
  @media (hover: hover) { .trilha-tecla:hover { border-color: var(--accent, #7c4dff); box-shadow: 0 0 0 2px var(--accent, #7c4dff) inset; } }
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
  /* 🎭 v0.156: o mesmo contorno em VERMELHO = no preview (modo estúdio) ou áudio mudo */
  .trilha-obs.obs-preview {
    border-color: #e53935;
    box-shadow: inset 0 0 0 1px rgba(229, 57, 53, 0.6), 0 0 0 2px rgba(229, 57, 53, 0.55);
  }
  .trilha-obs.obs-preview .trilha-emoji { filter: drop-shadow(0 0 4px rgba(229, 57, 53, 0.9)); }
  .trilha-qtd {
    position: absolute; top: 4px; right: 6px; font-size: 10px; font-weight: 700;
    background: var(--accent, #7c4dff); color: #fff; border-radius: 8px;
    padding: 1px 5px; min-width: 14px; text-align: center;
  }
  .trilha-fundo { position: absolute; inset: 0; background-size: cover; background-position: center; }
  .trilha-emoji { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: clamp(18px, 42%, 34px); }
  /* 🎭 v0.156: o emoji do estado sobre uma tecla com imagem (selo no canto)
     e o pulinho de quem acabou de trocar de estado */
  .trilha-estado { position: absolute; right: 4px; top: 4px; font-size: clamp(13px, 26%, 22px); line-height: 1;
    padding: 2px 3px; border-radius: 8px; background: rgba(0, 0, 0, 0.55); pointer-events: none; }
  .estado-trocou { animation: trilhaEstadoPulo 0.55s cubic-bezier(0.2, 1.4, 0.4, 1) 1; }
  @keyframes trilhaEstadoPulo { 0% { transform: scale(0.6); opacity: 0.4; } 60% { transform: scale(1.25); opacity: 1; } 100% { transform: scale(1); } }
  body.a11y-sem-animacao .estado-trocou { animation: none; }
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
// 🎬 v0.168: as opções da animação de fundo — TUDO ajustável na aba 🎨 Temas.
// Os padrões valem para quem nunca mexeu (e são o que «↺ Padrão» devolve).
const TEMA_ANIM_PADROES = {
  animIntensidade: 60,      // 10–100: a força geral (o seletor de sempre)
  animVelocidade: 100,      // 10–300 %
  animQuantidade: 100,      // 10–300 % de partículas/estrelas/faixas
  animTamanho: 100,         // 30–300 %
  animBrilho: 60,           // 0–100: halo/glow (nas estrelas, o brilho James Webb)
  animRastro: 0,            // 0–100: rastro de movimento (o quadro anterior fica sumindo)
  animVento: 0,             // -100–100: deriva horizontal (neve, confete, bolhas, cadentes)
  animOpacidade: 100,       // 0–100: opacidade da camada animada
  animCamada: 'atras',      // atras (fundo) | frente (por cima de tudo, sem pegar o mouse)
  painelOpacidade: 100,     // 20–100: opacidade dos painéis (colunas, barras, caixas — --panel)
  cartaoOpacidade: 100,     // 20–100: opacidade dos cartões (cards e comentários — --panel2) — abaixo de 100 a animação atravessa
  animCores: 'tema',        // tema | personalizadas
  animCor1: '#ffffff', animCor2: '#7c3aed', animCor3: '#ffb300',
  // ✨ estrelas
  animPontas: 6,            // 0 | 4 | 6 (James Webb) | 8 pontas de difração
  animCintilacao: 70,       // 0–100
  animCadentes: 30,         // 0–100: estrelas cadentes
  animNebulosa: 40,         // 0–100: nuvens coloridas ao fundo
  // 🌌 aurora
  animFaixas: 4,            // 1–8 cortinas
  // ❄️ neve
  animFlocos: 'cristais',   // pontos | cristais
  // 🫧 bolhas
  animReflexo: true,        // reflexo de luz e borda iridescente
  // 🕹️ grade
  animHorizonte: 42,        // 20–70 % da altura
  animSol: true,            // o sol listrado no horizonte
  // 🎉 confete
  animFormas: 'mistas',     // mistas | retangulos | circulos | estrelas | fitas
};
const TEMA_ANIM_CHAVES = Object.keys(TEMA_ANIM_PADROES);
// Lê um tema e devolve as opções já dentro dos limites (o motor confia nisto)
function temaAnimOpcoes(t) {
  const o = t && typeof t === 'object' ? t : {};
  const num = (v, min, max, d) => { const n = Number(v); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : d; };
  const hex = (v, d) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : d);
  const P = TEMA_ANIM_PADROES;
  return {
    intensidade: num(o.animIntensidade, 10, 100, P.animIntensidade),
    velocidade: num(o.animVelocidade, 10, 300, P.animVelocidade),
    quantidade: num(o.animQuantidade, 10, 300, P.animQuantidade),
    tamanho: num(o.animTamanho, 30, 300, P.animTamanho),
    brilho: num(o.animBrilho, 0, 100, P.animBrilho),
    rastro: num(o.animRastro, 0, 100, P.animRastro),
    vento: num(o.animVento, -100, 100, P.animVento),
    opacidade: num(o.animOpacidade, 0, 100, P.animOpacidade),
    camada: o.animCamada === 'frente' ? 'frente' : 'atras',
    painelOpacidade: num(o.painelOpacidade, 20, 100, P.painelOpacidade),
    cartaoOpacidade: num(o.cartaoOpacidade, 20, 100, P.cartaoOpacidade),
    cores: o.animCores === 'personalizadas' ? 'personalizadas' : 'tema',
    cor1: hex(o.animCor1, P.animCor1), cor2: hex(o.animCor2, P.animCor2), cor3: hex(o.animCor3, P.animCor3),
    pontas: [0, 4, 6, 8].includes(Number(o.animPontas)) ? Number(o.animPontas) : P.animPontas,
    cintilacao: num(o.animCintilacao, 0, 100, P.animCintilacao),
    cadentes: num(o.animCadentes, 0, 100, P.animCadentes),
    nebulosa: num(o.animNebulosa, 0, 100, P.animNebulosa),
    faixas: Math.round(num(o.animFaixas, 1, 8, P.animFaixas)),
    flocos: o.animFlocos === 'pontos' ? 'pontos' : 'cristais',
    reflexo: o.animReflexo !== false && o.animReflexo !== 'false' && o.animReflexo !== 0,
    horizonte: num(o.animHorizonte, 20, 70, P.animHorizonte),
    sol: o.animSol !== false && o.animSol !== 'false' && o.animSol !== 0,
    formas: ['mistas', 'retangulos', 'circulos', 'estrelas', 'fitas'].includes(o.animFormas) ? o.animFormas : P.animFormas,
  };
}
// hex → [r,g,b] e hsl de volta a hex — para a aurora inventar as cores irmãs
// da cor de destaque (e para as bolhas iridescentes)
function corHexRgb(h) { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); const n = m ? parseInt(m[1], 16) : 0x7c4dff; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function corGirar(hex, graus, satMais = 0, luzMais = 0) {
  let [r, g, b] = corHexRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0; const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  h = (h + graus / 360 + 1) % 1;
  s = Math.max(0, Math.min(1, s + satMais));
  const l2 = Math.max(0, Math.min(1, l + luzMais));
  const k = (n) => (n + h * 12) % 12;
  const a = s * Math.min(l2, 1 - l2);
  const f = (n) => l2 - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + to(f(0)) + to(f(8)) + to(f(4));
}

// ---------------------------------------------------------------------------
// 🎨 v0.164: os temas prontos do OBS Social — UMA lista para o painel, as
// configurações e o mini Mesa do celular (/deck). Cada tema traz as cores
// (campo vazio = a cor de fábrica do modo claro/escuro), cantos/fonte e a
// animação de fundo que combina com ele ('nenhuma' nos parados). Os seis
// animados nasceram no mini Mesa (v0.163) e agora vestem o programa inteiro.
const TEMAS_PRONTOS = [
  // 🌙 O Padrão não guarda cores (ele LIMPA as suas, e o programa volta às
  // de fábrica) — «amostra» existe só para o cartão mostrar quais são elas,
  // as mesmas do :root do painel e das configurações
  { id: 'padrao', nome: '🌙 Padrão', tema: {}, amostra: {
    corFundo: '#0d1117', corPainel: '#161b22', corPainel2: '#1c2330', corDestaque: '#7c3aed', corTexto: '#e6edf3' } },
  { id: 'roxo', nome: '🟣 Roxo profundo', tema: {
    corFundo: '#140b1f', corPainel: '#1e1030', corPainel2: '#2a1743', corTexto: '#f0e7ff',
    corSuave: '#a992c9', corBorda: '#3d2359', corDestaque: '#a855f7', cantos: 18 } },
  { id: 'oceano', nome: '🌊 Oceano', tema: {
    corFundo: '#08131f', corPainel: '#0e2033', corPainel2: '#132c45', corTexto: '#e3f2fd',
    corSuave: '#8bb0cc', corBorda: '#1d3d5c', corDestaque: '#22a6f0', cantos: 16 } },
  { id: 'floresta', nome: '🌲 Floresta', tema: {
    corFundo: '#0b1712', corPainel: '#12241c', corPainel2: '#1a3327', corTexto: '#e6f5ec',
    corSuave: '#95bda6', corBorda: '#234634', corDestaque: '#2ecc71', cantos: 14 } },
  { id: 'fogo', nome: '🔥 Brasa', tema: {
    corFundo: '#1a0d08', corPainel: '#2a150d', corPainel2: '#3a1d12', corTexto: '#ffeee4',
    corSuave: '#d0a48e', corBorda: '#4d2718', corDestaque: '#ff6b35', cantos: 12 } },
  { id: 'rosa', nome: '🌸 Rosa neon', tema: {
    corFundo: '#160a14', corPainel: '#241021', corPainel2: '#33172e', corTexto: '#ffe9f7',
    corSuave: '#c795b7', corBorda: '#482240', corDestaque: '#ff2d95', cantos: 20 } },
  { id: 'claro', nome: '☀️ Claro suave', tema: {
    corFundo: '#f4f6fb', corPainel: '#ffffff', corPainel2: '#eef1f7', corTexto: '#1a2330',
    corSuave: '#5c6b7f', corBorda: '#dde3ec', corDestaque: '#4f46e5', cantos: 16 } },
  { id: 'papel', nome: '📜 Papel', tema: {
    corFundo: '#f5efe2', corPainel: '#fffaf0', corPainel2: '#efe6d5', corTexto: '#2f2a22',
    corSuave: '#7a6f5d', corBorda: '#ddd0b8', corDestaque: '#b8860b', fonte: 'Georgia', cantos: 8 } },
  { id: 'contraste', nome: '⚡ Alto contraste', tema: {
    corFundo: '#000000', corPainel: '#0d0d0d', corPainel2: '#1a1a1a', corTexto: '#ffffff',
    corSuave: '#cccccc', corBorda: '#555555', corDestaque: '#ffe600', tamTexto: 110, cantos: 4 } },
  { id: 'retro8bit', nome: '👾 Retrô', tema: {
    corFundo: '#0b0f0b', corPainel: '#111a11', corPainel2: '#16241a', corTexto: '#9dff9d',
    corSuave: '#5fa05f', corBorda: '#1f3a24', corDestaque: '#39ff14', fonte: 'Courier New', cantos: 2 } },
  // 🎬 os animados: o fundo se mexe (a animação pode ser trocada ou desligada)
  { id: 'aurora', nome: '🌌 Aurora', tema: {
    corFundo: '#070b1a', corPainel: '#0e1530', corPainel2: '#131b3a', corTexto: '#eaf0ff',
    corSuave: '#8fa0d0', corBorda: '#2b3a70', corDestaque: '#4dd0e1', cantos: 16, animacao: 'aurora', animIntensidade: 70, animFaixas: 5, animBrilho: 70 } },
  { id: 'estrelas', nome: '✨ Céu estrelado', tema: {
    corFundo: '#05070f', corPainel: '#0c1020', corPainel2: '#12172a', corTexto: '#f0f2ff',
    corSuave: '#8890b0', corBorda: '#2c3350', corDestaque: '#ffd166', cantos: 14, animacao: 'estrelas', animIntensidade: 75, animBrilho: 80, animPontas: 6, animCintilacao: 80, animCadentes: 40, animNebulosa: 50 } },
  { id: 'natal', nome: '🎄 Natal', tema: {
    corFundo: '#0f2a1a', corPainel: '#163a24', corPainel2: '#1d4a2e', corTexto: '#fff8f0',
    corSuave: '#9fc7ac', corBorda: '#2f6b43', corDestaque: '#e53935', cantos: 14, animacao: 'neve', animIntensidade: 65, animFlocos: 'cristais', animTamanho: 120, animBrilho: 50 } },
  { id: 'bolhas', nome: '🫧 Bolhas', tema: {
    corFundo: '#062a3a', corPainel: '#0a3a50', corPainel2: '#0f4a66', corTexto: '#e8fbff',
    corSuave: '#86bfd0', corBorda: '#1f6f8f', corDestaque: '#38bdf8', cantos: 20, animacao: 'bolhas', animIntensidade: 65, animReflexo: true, animBrilho: 60 } },
  { id: 'retro', nome: '🕹️ Anos 80', tema: {
    corFundo: '#12021f', corPainel: '#1c0530', corPainel2: '#2a0a4a', corTexto: '#ffe9ff',
    corSuave: '#c58fd6', corBorda: '#6a1f9a', corDestaque: '#ff2fb9', cantos: 10, animacao: 'grade', animIntensidade: 70, animSol: true, animBrilho: 75, animHorizonte: 45 } },
  { id: 'festa', nome: '🎉 Festa', tema: {
    corFundo: '#17111f', corPainel: '#221a2e', corPainel2: '#2c2140', corTexto: '#fff4e0',
    corSuave: '#b8a5c9', corBorda: '#4d3a66', corDestaque: '#ffb300', cantos: 16, animacao: 'confete', animIntensidade: 70, animFormas: 'mistas', animBrilho: 60 } },
];
// As animações de fundo (a mesma lista no card 🎨 Temas e no mini Mesa)
const TEMA_ANIMACOES = [
  { id: 'nenhuma', nome: '⏹ Nenhuma' },
  { id: 'aurora', nome: '🌌 Aurora' },
  { id: 'estrelas', nome: '✨ Estrelas' },
  { id: 'neve', nome: '❄️ Neve' },
  { id: 'bolhas', nome: '🫧 Bolhas' },
  { id: 'grade', nome: '🕹️ Grade retrô' },
  { id: 'confete', nome: '🎉 Confete' },
];
const temaAnimacaoOk = (id) => TEMA_ANIMACOES.some((a) => a.id === id);
// 📱 o mini Mesa: 'tema' = a animação que o tema traz
const DECK_ANIMACOES = [{ id: 'tema', nome: '✨ A do tema' }, ...TEMA_ANIMACOES];
// A mesma lista, na forma que o mini Mesa desenha (fundo/barra/tecla...).
// As cores de fábrica entram onde o tema não define (o 🌙 Padrão).
const DECK_TEMAS = TEMAS_PRONTOS.map((p) => {
  const t = p.tema || {};
  return {
    id: p.id, nome: p.nome, anim: t.animacao || 'nenhuma',
    fundo: t.corFundo || '#0d1117', barra: t.corPainel || '#161b22', tecla: t.corPainel2 || '#1c2330',
    texto: t.corTexto || '#e6edf3', suave: t.corSuave || '#8b98a8', borda: t.corBorda || '#2d3748',
    destaque: t.corDestaque || '#7c3aed', cantos: Number.isFinite(Number(t.cantos)) ? Number(t.cantos) : 14, fonte: t.fonte || '',
    opcoes: Object.fromEntries(Object.entries(t).filter(([k]) => TEMA_ANIM_CHAVES.includes(k))), // 🎬 v0.168
  };
});
// os nomes que o mini Mesa usava antes da lista única (v0.163)
const DECK_TEMAS_ANTIGOS = { grafite: 'padrao', neon: 'rosa', brasa: 'fogo' };
const deckTemaInfo = (id) => DECK_TEMAS.find((t) => t.id === (DECK_TEMAS_ANTIGOS[id] || id)) || DECK_TEMAS[0];

// Do bloco deck das configurações (mais, opcionalmente, o ajuste só deste
// aparelho) para a cara efetiva: cores, animação, intensidade, cantos e fonte.
// No modo 'obs' a cara é a cópia do tema pessoal do OBS Social gravada pelas
// configurações (temaObs — animação inclusa); no 'proprio', um tema da lista
// com as cores extras por cima. A animação 'tema' é a que o tema traz.
function deckResolverTema(conf, ajuste) {
  const d = { ...(conf || {}), ...(ajuste || {}) };
  const hex = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v : '');
  const extra = (conf && conf.cores) || {};
  let cores, animBase, cantos = 14, fonte = '', nome = '', intensidadeBase = null, opcoesBase = {};
  if (d.tema === 'proprio') {
    const t = deckTemaInfo(d.temaProprio);
    nome = t.nome;
    opcoesBase = t.opcoes || {}; // 🎬 v0.168: o tema pronto traz a afinação da animação dele
    cores = { fundo: t.fundo, barra: t.barra, tecla: t.tecla, texto: t.texto, suave: t.suave, borda: t.borda, destaque: t.destaque };
    animBase = t.anim;
    cantos = t.cantos;
    fonte = t.fonte;
  } else {
    const o = (conf && conf.temaObs) || {};
    nome = o.nome || '';
    cores = {
      fundo: hex(o.corFundo) || '#0d1117', barra: hex(o.corPainel) || '#161b22', tecla: hex(o.corPainel2) || '#1c2330',
      texto: hex(o.corTexto) || '#e6edf3', suave: hex(o.corSuave) || '#8b98a8', borda: hex(o.corBorda) || '#2d3748',
      destaque: hex(o.corDestaque) || '#7c3aed',
    };
    animBase = temaAnimacaoOk(o.animacao) ? o.animacao : 'nenhuma';
    const ni = Number(o.animIntensidade);
    if (Number.isFinite(ni)) intensidadeBase = Math.max(10, Math.min(100, ni));
    opcoesBase = o; // 🎬 v0.168: velocidade, brilho, pontas… vêm na cópia
    const c = Number(o.cantos);
    if (Number.isFinite(c)) cantos = Math.max(0, Math.min(28, c));
    fonte = typeof o.fonte === 'string' ? o.fonte : '';
  }
  // as cores extras são do tema escolhido nas configurações: um aparelho que
  // escolheu a própria cara («só neste aparelho») fica com o tema puro
  if (d.tema === 'proprio' && !ajuste) {
    if (hex(extra.fundo)) cores.fundo = extra.fundo;
    if (hex(extra.tecla)) cores.tecla = extra.tecla;
    if (hex(extra.texto)) cores.texto = extra.texto;
    if (hex(extra.destaque)) cores.destaque = extra.destaque;
  }
  const segueTema = !d.animacao || d.animacao === 'tema';
  const animacao = segueTema ? animBase : d.animacao;
  const n = Number(d.intensidade);
  return {
    modo: d.tema === 'proprio' ? 'proprio' : 'obs', nome, cores,
    animacao: temaAnimacaoOk(animacao) ? animacao : 'nenhuma',
    // no modo «igual ao OBS Social» seguindo o tema, a intensidade também é a dele
    intensidade: segueTema && intensidadeBase !== null ? intensidadeBase : (Number.isFinite(n) ? Math.max(10, Math.min(100, n)) : 60),
    cantos, fonte,
    // 🎬 v0.168: as opções da animação (a intensidade efetiva entra nelas)
    opcoes: temaAnimOpcoes({ ...opcoesBase, animIntensidade: segueTema && intensidadeBase !== null ? intensidadeBase : (Number.isFinite(n) ? n : 60) }),
  };
}

// ---------------------------------------------------------------------------
// 🎬 v0.164/v0.168: o fundo animado (aurora, estrelas, neve, bolhas, grade,
// confete) desenhado num <canvas> — o mesmo motor no painel, nas configurações
// e no mini Mesa. ~30 quadros por segundo, meia resolução nos efeitos pesados,
// para com a aba escondida e com ♿ «reduzir animações» / prefers-reduced-motion.
// v0.168: tudo tem opção (velocidade, quantidade, tamanho, brilho, rastro,
// vento, cores…), as estrelas ganharam o brilho com pontas de difração do
// James Webb, cintilação, cadentes e nebulosa, e cada efeito ficou mais vivo.
function criarAnimadorFundo(canvas) {
  const ctx = canvas.getContext('2d');
  let efeito = 'nenhuma';
  let forca = 0.6;
  let op = temaAnimOpcoes({});
  let cores = { destaque: '#7c4dff', texto: '#ffffff', fundo: '#14161c', particula: '#ffffff' };
  let claro = false; // fundo claro: partículas na cor de destaque, aurora escurecendo
  let itens = [];
  let extras = { poeira: [], nebulosa: [], cadentes: [], estouros: [] };
  let rodando = false;
  let ultimo = 0;
  let W = 0, H = 0, escala = 1;
  const reduzido = () => document.body.classList.contains('a11y-sem-animacao')
    || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hexRgb = corHexRgb;
  const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${Math.max(0, Math.min(1, a))})`; };
  const rnd = Math.random;
  // as cores da vez: do tema (destaque + irmãs) ou as três personalizadas
  function paleta() {
    if (op.cores === 'personalizadas') return [op.cor1, op.cor2, op.cor3];
    return [cores.particula, cores.destaque, corGirar(cores.destaque, 40, 0.1, 0.1)];
  }
  // ✨ as cores das estrelas: brancas, azuladas, douradas e alaranjadas (como
  // nas fotos do James Webb), com a cor de destaque do tema entre elas
  function paletaEstrelas() {
    if (op.cores === 'personalizadas') return [op.cor1, op.cor1, op.cor2, op.cor3, op.cor1];
    return ['#ffffff', '#bcd2ff', '#fff3c4', '#ffc98a', claro ? cores.destaque : corGirar(cores.destaque, 0, 0, 0.2)];
  }
  // 💡 halos: um sprite por cor (gradiente radial), desenhado escalado — muito
  // mais barato que shadowBlur a cada quadro
  const sprites = new Map();
  function halo(cor) {
    let s = sprites.get(cor);
    if (s) return s;
    s = document.createElement('canvas'); s.width = s.height = 64;
    const c = s.getContext('2d');
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, rgba('#ffffff', 1)); g.addColorStop(0.18, rgba(cor, 0.9)); g.addColorStop(0.45, rgba(cor, 0.25)); g.addColorStop(1, rgba(cor, 0));
    c.fillStyle = g; c.fillRect(0, 0, 64, 64);
    sprites.set(cor, s);
    return s;
  }
  const desenharHalo = (x, y, r, cor, a) => { if (r < 0.5 || a <= 0) return; ctx.globalAlpha = Math.min(1, a); ctx.drawImage(halo(cor), x - r, y - r, r * 2, r * 2); ctx.globalAlpha = 1; };
  function medirCanvas() {
    escala = Math.min(1.5, window.devicePixelRatio || 1);
    // os efeitos pesados desenham em meia resolução: barato na bateria
    if (efeito === 'aurora') escala = Math.min(escala, 0.5);
    W = Math.max(1, Math.round(innerWidth * escala));
    H = Math.max(1, Math.round(innerHeight * escala));
    canvas.width = W; canvas.height = H;
    // o canvas é fixo em inset:0 — em % ele acompanha até o 🔍 zoom do painel
    // (body.style.zoom), em que um tamanho em px cobriria só parte da tela
    canvas.style.width = '100%'; canvas.style.height = '100%';
  }
  const tam = () => op.tamanho / 100;
  const vel = () => op.velocidade / 100;
  function semear() {
    itens = [];
    extras = { poeira: [], nebulosa: [], cadentes: [], estouros: [] };
    const n = Math.round((20 + forca * 90) * (op.quantidade / 100));
    if (efeito === 'estrelas') {
      for (let i = 0; i < n; i++) itens.push({ x: rnd(), y: rnd(), r: 0.7 + Math.pow(rnd(), 2.2) * 2.6, f: rnd() * 6.28, v: 0.5 + rnd() * 1.6, c: Math.floor(rnd() * 5), fl: 0, dx: (rnd() - 0.5) });
      for (let i = 0; i < n * 3; i++) extras.poeira.push({ x: rnd(), y: rnd(), r: 0.3 + rnd() * 0.6, f: rnd() * 6.28, v: 0.3 + rnd() * 0.8 });
      for (let i = 0; i < 3; i++) extras.nebulosa.push({ x: rnd(), y: rnd(), r: 0.25 + rnd() * 0.3, f: rnd() * 6.28, f2: rnd() * 6.28, c: i });
    }
    if (efeito === 'neve') for (let i = 0; i < n; i++) { const p = rnd(); itens.push({ x: rnd(), y: rnd(), r: 1 + p * 3.2, v: 0.02 + p * 0.05, s: rnd() * 6.28, rot: rnd() * 6.28, vr: (rnd() - 0.5) * 2, p }); }
    if (efeito === 'bolhas') for (let i = 0; i < n * 0.5; i++) itens.push({ x: rnd(), y: rnd(), r: 3 + rnd() * 16, v: 0.02 + rnd() * 0.05, s: rnd() * 6.28, w: rnd() * 6.28, c: i % 3 });
    if (efeito === 'confete') {
      const formas = op.formas === 'mistas' ? ['ret', 'circ', 'estrela', 'fita'] : [{ retangulos: 'ret', circulos: 'circ', estrelas: 'estrela', fitas: 'fita' }[op.formas]];
      for (let i = 0; i < n; i++) itens.push({ x: rnd(), y: rnd(), w: 4 + rnd() * 7, h: 2 + rnd() * 5, v: 0.04 + rnd() * 0.08, a: rnd() * 6.28, va: (rnd() - 0.5) * 5, b: rnd() * 6.28, vb: 2 + rnd() * 4, c: i % 5, forma: formas[i % formas.length], brilha: rnd() < 0.25 });
    }
    if (efeito === 'aurora') {
      for (let i = 0; i < op.faixas; i++) itens.push({ f: rnd() * 6.28, f2: rnd() * 6.28, f3: rnd() * 6.28, k: 1.5 + rnd() * 2.5, k2: 3 + rnd() * 4, y: 0.08 + (i / Math.max(1, op.faixas)) * 0.45 + rnd() * 0.08, alt: 0.28 + rnd() * 0.25, c: i % 3 });
      for (let i = 0; i < 60; i++) extras.poeira.push({ x: rnd(), y: rnd() * 0.7, r: 0.3 + rnd() * 0.7, f: rnd() * 6.28, v: 0.3 + rnd() * 0.8 });
    }
    if (efeito === 'grade') for (let i = 0; i < 70; i++) extras.poeira.push({ x: rnd(), y: rnd(), r: 0.3 + rnd() * 0.8, f: rnd() * 6.28, v: 0.3 + rnd() * 0.8 });
  }
  const PALETA_CONFETE = ['#ff5c5c', '#ffb300', '#4da3ff', '#43a047', '#ec407a'];
  function poeira(seg, cor, base, limiteY) {
    // as estrelinhas de fundo (bem pequenas, piscando devagar)
    for (const p of extras.poeira) {
      if (limiteY !== undefined && p.y > limiteY) continue;
      const a = base * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(seg * p.v * (0.5 + op.cintilacao / 100) + p.f)));
      ctx.fillStyle = rgba(cor, a);
      ctx.beginPath(); ctx.arc(p.x * W, p.y * H, p.r * escala * tam(), 0, 6.28); ctx.fill();
    }
  }
  // ✨ uma estrela do James Webb: núcleo, halo e as pontas de difração (6
  // grandes em hexágono + 2 curtas na horizontal — a assinatura do telescópio)
  function estrelaWebb(x, y, r, cor, a, brilhoExtra) {
    const b = op.brilho / 100;
    desenharHalo(x, y, r * (4 + b * 9) * (1 + brilhoExtra), cor, a * (0.35 + b * 0.5));
    ctx.fillStyle = rgba('#ffffff', Math.min(1, a));
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.28); ctx.fill();
    if (!op.pontas || r < 1.1 * escala) return;
    const L = r * (6 + b * 16) * (1 + brilhoExtra * 1.6);
    const desenharPonta = (ang, comp, largura) => {
      const g = ctx.createLinearGradient(x, y, x + Math.cos(ang) * comp, y + Math.sin(ang) * comp);
      g.addColorStop(0, rgba('#ffffff', a * 0.9)); g.addColorStop(0.25, rgba(cor, a * 0.55)); g.addColorStop(1, rgba(cor, 0));
      ctx.strokeStyle = g; ctx.lineWidth = largura;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * comp, y + Math.sin(ang) * comp); ctx.stroke();
    };
    const n = op.pontas;
    const base = n === 6 ? -Math.PI / 2 : n === 4 ? 0 : -Math.PI / 8;
    for (let i = 0; i < n; i++) desenharPonta(base + (i * 2 * Math.PI) / n, L, Math.max(0.6, r * 0.35));
    if (n === 6) { desenharPonta(0, L * 0.45, Math.max(0.5, r * 0.25)); desenharPonta(Math.PI, L * 0.45, Math.max(0.5, r * 0.25)); }
  }
  function desenhar(t, dt) {
    const seg = t / 1000;
    const v = vel();
    // rastro: em vez de limpar, apaga só um pouco do quadro anterior
    if (op.rastro > 0 && efeito !== 'aurora' && efeito !== 'grade') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = `rgba(0,0,0,${1 - (op.rastro / 100) * 0.92})`;
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    } else ctx.clearRect(0, 0, W, H);
    const P = paleta();
    const vento = (op.vento / 100) * 0.00012 * v;
    if (efeito === 'aurora') {
      // 🌌 cortinas de luz ondulando (cada faixa numa cor irmã), com
      // estrelinhas atrás e um brilho respirando
      ctx.globalCompositeOperation = claro ? 'multiply' : 'lighter';
      poeira(seg, cores.particula, 0.7 * forca, 0.75);
      const passo = Math.max(2, Math.round(4 * escala));
      const coresAurora = op.cores === 'personalizadas' ? P : [corGirar(cores.destaque, -40, 0.15, 0.05), cores.destaque, corGirar(cores.destaque, 60, 0.1, 0.1)];
      itens.forEach((a, i) => {
        const cor = coresAurora[a.c % coresAurora.length];
        const alt = a.alt * H * tam() * (0.85 + 0.15 * Math.sin(seg * 0.4 * v + a.f3));
        const alfa = (0.14 + 0.32 * forca) * (0.6 + op.brilho / 100 * 0.6);
        for (let x = 0; x <= W; x += passo) {
          const u = x / W;
          const onda = Math.sin(u * a.k * 6.28 + seg * 0.35 * v + a.f) * 0.5 + Math.sin(u * a.k2 * 6.28 - seg * 0.6 * v + a.f2) * 0.25;
          const y0 = (a.y + onda * 0.08) * H;
          const brilhoCol = 0.55 + 0.45 * Math.sin(u * 9 + seg * 1.3 * v + a.f2 + i);
          const g = ctx.createLinearGradient(0, y0, 0, y0 + alt);
          g.addColorStop(0, rgba(cor, 0)); g.addColorStop(0.18, rgba(cor, alfa * brilhoCol)); g.addColorStop(0.5, rgba(cor, alfa * 0.6 * brilhoCol)); g.addColorStop(1, rgba(cor, 0));
          ctx.fillStyle = g;
          ctx.fillRect(x, y0, passo, alt);
        }
      });
      ctx.globalCompositeOperation = 'source-over';
    } else if (efeito === 'estrelas') {
      ctx.globalCompositeOperation = claro ? 'source-over' : 'lighter';
      const PE = paletaEstrelas();
      // nebulosa: nuvens coloridas bem suaves, à deriva
      if (op.nebulosa > 0) {
        for (const nb of extras.nebulosa) {
          const cx = (nb.x + 0.06 * Math.sin(seg * 0.05 * v + nb.f)) * W, cy = (nb.y + 0.05 * Math.cos(seg * 0.04 * v + nb.f2)) * H;
          const r = nb.r * Math.max(W, H) * tam();
          const cor = op.cores === 'personalizadas' ? P[nb.c % 3] : [cores.destaque, corGirar(cores.destaque, 120, 0.1, 0), corGirar(cores.destaque, -100, 0.1, 0)][nb.c];
          const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          g.addColorStop(0, rgba(cor, (op.nebulosa / 100) * (claro ? 0.12 : 0.22) * forca)); g.addColorStop(1, rgba(cor, 0));
          ctx.fillStyle = g; ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }
      }
      poeira(seg, claro ? cores.destaque : '#ffffff', (0.25 + forca * 0.5), undefined);
      const cint = op.cintilacao / 100;
      for (const s of itens) {
        // deriva lenta (paralaxe: as maiores andam mais) e a cintilação
        s.x += s.dx * 0.000004 * dt * v * s.r + vento * 0.2 * dt;
        if (s.x > 1.02) s.x -= 1.04; if (s.x < -0.02) s.x += 1.04;
        if (s.fl > 0) s.fl = Math.max(0, s.fl - dt * 0.0012 * v); else if (rnd() < 0.00025 * dt * v * (0.3 + cint)) s.fl = 1;
        const tw = 0.55 + 0.45 * Math.sin(seg * s.v * (0.4 + cint * 2.6) + s.f);
        const a = tw * (0.45 + forca * 0.55);
        estrelaWebb(s.x * W, s.y * H, s.r * escala * tam(), PE[s.c % PE.length], claro ? a * 0.9 : a, s.fl * (0.5 + cint));
      }
      // ☄️ estrelas cadentes
      if (op.cadentes > 0 && rnd() < (op.cadentes / 100) * 0.0008 * dt * v) {
        const dir = op.vento < -30 ? -1 : 1;
        extras.cadentes.push({ x: dir > 0 ? rnd() * 0.7 : 0.3 + rnd() * 0.7, y: rnd() * 0.4, vx: dir * (0.00055 + rnd() * 0.0004), vy: 0.00035 + rnd() * 0.0003, vida: 0, c: Math.floor(rnd() * PE.length) });
      }
      extras.cadentes = extras.cadentes.filter((m) => m.vida < 1);
      for (const m of extras.cadentes) {
        m.x += m.vx * dt * v; m.y += m.vy * dt * v; m.vida += dt * 0.0011 * v;
        const a = Math.sin(m.vida * Math.PI) * (0.5 + forca * 0.5);
        const comp = 90 * escala * tam() * (0.8 + op.brilho / 100);
        const x = m.x * W, y = m.y * H, nx = m.vx / Math.hypot(m.vx, m.vy), ny = m.vy / Math.hypot(m.vx, m.vy);
        const g = ctx.createLinearGradient(x, y, x - nx * comp, y - ny * comp);
        g.addColorStop(0, rgba('#ffffff', a)); g.addColorStop(0.3, rgba(PE[m.c], a * 0.6)); g.addColorStop(1, rgba(PE[m.c], 0));
        ctx.strokeStyle = g; ctx.lineWidth = Math.max(1, 1.6 * escala * tam());
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - nx * comp, y - ny * comp); ctx.stroke();
        desenharHalo(x, y, 7 * escala * tam(), PE[m.c], a);
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (efeito === 'neve') {
      // ❄️ três profundidades (os flocos grandes caem mais rápido e giram),
      // cristais de seis braços, vento e um halo suave
      const cor = op.cores === 'personalizadas' ? op.cor1 : cores.particula;
      for (const f of itens) {
        f.y += f.v * dt * (0.5 + forca) * 0.06 * v; f.s += dt * 0.001 * v; f.rot += f.vr * dt * 0.0006 * v;
        f.x += vento * dt * (0.5 + f.p);
        if (f.y > 1.05) { f.y = -0.05; f.x = rnd(); }
        if (f.x > 1.03) f.x -= 1.06; if (f.x < -0.03) f.x += 1.06;
        const x = (f.x + Math.sin(f.s) * 0.02) * W, y = f.y * H;
        const r = f.r * escala * tam();
        const a = (0.45 + forca * 0.45) * (0.5 + f.p * 0.5);
        if (op.brilho > 0) desenharHalo(x, y, r * (1.5 + op.brilho / 100 * 2.5), cor, a * 0.35 * (op.brilho / 100 + 0.2));
        if (op.flocos === 'cristais' && f.p > 0.45) {
          ctx.strokeStyle = rgba(cor, a); ctx.lineWidth = Math.max(0.8, r * 0.28);
          ctx.save(); ctx.translate(x, y); ctx.rotate(f.rot);
          for (let k = 0; k < 6; k++) {
            ctx.rotate(Math.PI / 3);
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -r * 1.6); ctx.moveTo(0, -r * 0.9); ctx.lineTo(r * 0.45, -r * 1.25); ctx.moveTo(0, -r * 0.9); ctx.lineTo(-r * 0.45, -r * 1.25); ctx.stroke();
          }
          ctx.restore();
        } else {
          ctx.fillStyle = rgba(cor, a);
          ctx.beginPath(); ctx.arc(x, y, r * 0.8, 0, 6.28); ctx.fill();
        }
      }
    } else if (efeito === 'bolhas') {
      // 🫧 bolhas com borda iridescente, reflexo de luz, balanço e estouro
      const [c1, c2, c3] = P;
      ctx.lineWidth = 1.3 * escala;
      for (const b of itens) {
        b.y -= b.v * dt * (0.5 + forca) * 0.05 * v; b.s += dt * 0.0015 * v; b.w += dt * 0.004 * v;
        b.x += vento * dt;
        if (b.x > 1.05) b.x -= 1.1; if (b.x < -0.05) b.x += 1.1;
        if (b.y < -0.08 || (b.y < 0.25 && rnd() < 0.0004 * dt * v)) {
          if (b.y >= -0.08) extras.estouros.push({ x: b.x, y: b.y, r: b.r, vida: 0, c: b.c });
          b.y = 1.08; b.x = rnd();
        }
        const x = (b.x + Math.sin(b.s) * 0.015) * W, y = b.y * H;
        const r = b.r * escala * tam();
        const sx = 1 + 0.06 * Math.sin(b.w), sy = 1 - 0.06 * Math.sin(b.w);
        ctx.save(); ctx.translate(x, y); ctx.scale(sx, sy);
        const cor = [c2, c1, c3][b.c % 3];
        const g = ctx.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.1, 0, 0, r);
        g.addColorStop(0, rgba(cor, 0.02 + forca * 0.05)); g.addColorStop(0.85, rgba(cor, 0.06 + forca * 0.12)); g.addColorStop(1, rgba(cor, 0.3 + forca * 0.4));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.28); ctx.fill();
        if (op.reflexo) {
          const anel = ctx.createLinearGradient(-r, -r, r, r);
          anel.addColorStop(0, rgba(c1, 0.55 + forca * 0.35)); anel.addColorStop(0.5, rgba(cor, 0.35 + forca * 0.4)); anel.addColorStop(1, rgba(c3, 0.55 + forca * 0.35));
          ctx.strokeStyle = anel; ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.28); ctx.stroke();
          ctx.fillStyle = rgba('#ffffff', 0.35 + forca * 0.45);
          ctx.beginPath(); ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.22, r * 0.12, -0.7, 0, 6.28); ctx.fill();
          if (op.brilho > 0) desenharHalo(0, 0, r * (1.2 + op.brilho / 100), cor, 0.12 * (op.brilho / 100) * forca);
        } else {
          ctx.strokeStyle = rgba(cor, 0.3 + forca * 0.5); ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.28); ctx.stroke();
        }
        ctx.restore();
      }
      extras.estouros = extras.estouros.filter((e) => e.vida < 1);
      for (const e of extras.estouros) {
        e.vida += dt * 0.004 * v;
        const r = e.r * escala * tam() * (1 + e.vida * 0.8);
        ctx.strokeStyle = rgba([c2, c1, c3][e.c % 3], (1 - e.vida) * 0.7); ctx.lineWidth = 1.5 * escala;
        ctx.beginPath(); ctx.arc(e.x * W, e.y * H, r, 0, 6.28); ctx.stroke();
        for (let k = 0; k < 6; k++) { const ang = (k / 6) * 6.28; ctx.beginPath(); ctx.arc(e.x * W + Math.cos(ang) * r * 1.2, e.y * H + Math.sin(ang) * r * 1.2, Math.max(0, 1.2 * escala * (1 - e.vida)), 0, 6.28); ctx.fillStyle = rgba(c1, 1 - e.vida); ctx.fill(); }
      }
    } else if (efeito === 'grade') {
      // 🕹️ sintetizador anos 80: sol listrado no horizonte, grade neon
      // correndo para a pessoa, estrelas em cima e o brilho do horizonte
      const horizonte = H * (op.horizonte / 100);
      const [c1, c2, c3] = op.cores === 'personalizadas' ? P : [cores.destaque, corGirar(cores.destaque, 45, 0.15, 0.1), corGirar(cores.destaque, -50, 0.1, 0.05)];
      poeira(seg, cores.particula, 0.5 + forca * 0.4, op.horizonte / 100 - 0.02);
      if (op.sol) {
        const R = H * 0.22 * tam();
        const cx = W / 2, cy = horizonte;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, W, horizonte); ctx.clip();
        desenharHalo(cx, cy, R * (1.6 + op.brilho / 100), c2, 0.35 * forca + 0.1);
        const g = ctx.createLinearGradient(0, cy - R, 0, cy);
        g.addColorStop(0, rgba(c3, 0.95)); g.addColorStop(1, rgba(c2, 0.95));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, Math.PI, 0); ctx.fill();
        // as listras do sol sobem devagar
        ctx.globalCompositeOperation = 'destination-out';
        const desloc = (seg * 0.08 * v) % 1;
        for (let i = 0; i < 7; i++) {
          const f = ((i + desloc) / 7);
          const yy = cy - R * (1 - f * f);
          const alt = R * 0.035 * (0.4 + f);
          ctx.fillRect(cx - R, yy, R * 2, alt);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.restore();
      }
      const brilhoH = ctx.createLinearGradient(0, horizonte - H * 0.08, 0, horizonte + H * 0.12);
      brilhoH.addColorStop(0, rgba(c1, 0)); brilhoH.addColorStop(0.4, rgba(c1, 0.18 * forca + 0.05)); brilhoH.addColorStop(1, rgba(c1, 0));
      ctx.fillStyle = brilhoH; ctx.fillRect(0, horizonte - H * 0.08, W, H * 0.2);
      const chao = ctx.createLinearGradient(0, horizonte, 0, H);
      chao.addColorStop(0, rgba(c1, 0.03)); chao.addColorStop(1, rgba(c1, 0.14 * forca + 0.04));
      ctx.fillStyle = chao; ctx.fillRect(0, horizonte, W, H - horizonte);
      ctx.globalCompositeOperation = claro ? 'source-over' : 'lighter';
      const passo = (seg * (0.3 + forca * 0.8) * v) % 1;
      const linha = (x1, y1, x2, y2, a) => {
        if (op.brilho > 0) { ctx.strokeStyle = rgba(c1, a * 0.35 * (op.brilho / 100)); ctx.lineWidth = 5 * escala; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); }
        ctx.strokeStyle = rgba(c1, a); ctx.lineWidth = 1.2 * escala; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      };
      const nLinhas = Math.round(12 * Math.max(0.5, op.quantidade / 100));
      for (let i = 0; i < nLinhas; i++) {
        const f = ((i + passo) / nLinhas);
        const y = horizonte + (H - horizonte) * f * f;
        linha(0, y, W, y, (0.2 + f * 0.8) * (0.3 + forca * 0.6));
      }
      const nCol = Math.round(8 * Math.max(0.5, op.quantidade / 100));
      for (let i = -nCol; i <= nCol; i++) linha(W / 2 + i * W * 0.04, horizonte, W / 2 + i * W * (0.28 * (8 / nCol)), H, 0.25 + forca * 0.5);
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = rgba(cores.particula, 0.3); ctx.lineWidth = 1 * escala;
      ctx.beginPath(); ctx.moveTo(0, horizonte); ctx.lineTo(W, horizonte); ctx.stroke();
    } else if (efeito === 'confete') {
      // 🎉 formas variadas girando em dois eixos, fitas ondulando, brilhinhos
      const paletaC = op.cores === 'personalizadas' ? [op.cor1, op.cor2, op.cor3, corGirar(op.cor2, 40), corGirar(op.cor3, -40)] : PALETA_CONFETE;
      for (const c of itens) {
        c.y += c.v * dt * (0.4 + forca) * 0.05 * v; c.a += c.va * dt * 0.001 * v; c.b += c.vb * dt * 0.001 * v;
        c.x += vento * dt + Math.sin(c.b) * 0.00004 * dt;
        if (c.y > 1.06) { c.y = -0.06; c.x = rnd(); }
        if (c.x > 1.03) c.x -= 1.06; if (c.x < -0.03) c.x += 1.06;
        const cor = paletaC[c.c % paletaC.length];
        const x = (c.x + Math.sin(c.a) * 0.01) * W, y = c.y * H;
        const w = c.w * escala * tam(), h = c.h * escala * tam();
        const a = 0.6 + forca * 0.4;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(c.a);
        ctx.scale(Math.max(0.15, Math.abs(Math.cos(c.b))), 1); // o giro no outro eixo
        ctx.fillStyle = rgba(cor, a);
        if (c.forma === 'circ') { ctx.beginPath(); ctx.arc(0, 0, w / 2, 0, 6.28); ctx.fill(); }
        else if (c.forma === 'estrela') {
          ctx.beginPath();
          for (let k = 0; k < 10; k++) { const rr = k % 2 ? w * 0.28 : w * 0.6; const ang = (k / 10) * 6.28 - Math.PI / 2; ctx.lineTo(Math.cos(ang) * rr, Math.sin(ang) * rr); }
          ctx.closePath(); ctx.fill();
        } else if (c.forma === 'fita') {
          ctx.strokeStyle = rgba(cor, a); ctx.lineWidth = Math.max(1, h * 0.6);
          ctx.beginPath();
          for (let k = -3; k <= 3; k++) ctx.lineTo(k * w * 0.5, Math.sin(k * 1.3 + c.b) * h * 0.9);
          ctx.stroke();
        } else ctx.fillRect(-w / 2, -h / 2, w, h);
        ctx.restore();
        if (c.brilha && op.brilho > 0) { ctx.globalCompositeOperation = 'lighter'; desenharHalo(x, y, w * (0.8 + op.brilho / 100), cor, 0.25 * (op.brilho / 100) * (0.5 + 0.5 * Math.sin(c.b * 2))); ctx.globalCompositeOperation = 'source-over'; }
      }
    }
  }
  let raf = 0; // o quadro pendente — desligar cancela de verdade (sem dois laços ao mesmo tempo)
  function laco(t) {
    if (!rodando) return;
    raf = requestAnimationFrame(laco);
    // ~30 quadros por segundo bastam (e poupam a bateria)
    if (t - ultimo < 32) return;
    const dt = Math.min(100, t - ultimo || 16);
    ultimo = t;
    desenhar(t, dt);
  }
  function ligar() {
    if (rodando) return;
    if (efeito === 'nenhuma' || reduzido() || document.hidden) return;
    rodando = true;
    ultimo = 0;
    raf = requestAnimationFrame(laco);
  }
  function desligar() {
    rodando = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    ctx.clearRect(0, 0, W, H);
  }
  function aplicar(novoEfeito, intensidade, novasCores, opcoes) {
    // o servidor manda «settings» por qualquer ajuste do painel: só um efeito
    // NOVO (ou uma quantidade/forma nova) re-sorteia as partículas — o resto
    // muda no que já está na tela (a prévia do slider escala em vez de piscar)
    const mudou = (novoEfeito || 'nenhuma') !== efeito;
    efeito = novoEfeito || 'nenhuma';
    forca = Math.max(0.1, Math.min(1, (Number(intensidade) || 60) / 100));
    const novaOp = opcoes && opcoes.velocidade !== undefined ? opcoes : temaAnimOpcoes({ ...(opcoes || {}), animIntensidade: intensidade });
    novaOp.intensidade = Math.round(forca * 100);
    const resemear = novaOp.quantidade !== op.quantidade || novaOp.formas !== op.formas || novaOp.faixas !== op.faixas;
    op = novaOp;
    cores = { ...cores, ...(novasCores || {}) };
    // 🎨 v0.164: num tema CLARO (Papel, Claro suave) a neve e as estrelas na
    // cor do texto viravam sujeira preta — nesses, as partículas usam a cor
    // de destaque e a aurora escurece em vez de clarear
    {
      const [r, g, b] = hexRgb(cores.fundo);
      claro = 0.299 * r + 0.587 * g + 0.114 * b >= 140;
      cores.particula = claro ? cores.destaque : cores.texto;
    }
    if (mudou || resemear || !itens.length) { medirCanvas(); semear(); }
    canvas.style.opacity = String(op.opacidade / 100);
    if (efeito === 'nenhuma' || reduzido()) { desligar(); return; }
    if (mudou) desligar();
    ligar();
  }
  window.addEventListener('resize', () => { if (efeito !== 'nenhuma') { medirCanvas(); } });
  document.addEventListener('visibilitychange', () => { if (document.hidden) desligar(); else ligar(); });
  // ♿ o «reduzir movimento» do sistema mudou com a página aberta: obedece na hora
  try { const mq = matchMedia('(prefers-reduced-motion: reduce)'); if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (reduzido()) desligar(); else ligar(); }); } catch { /* sem matchMedia */ }
  return { aplicar, ligar, desligar, get efeito() { return efeito; }, get rodando() { return rodando; }, get opcoes() { return op; }, get itens() { return itens.length; } };
}

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
