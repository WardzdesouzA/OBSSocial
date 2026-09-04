// OBS Social — servidor central.
// Sobe o painel de controle (http://localhost:3000) e o overlay para o OBS
// (http://localhost:3000/overlay), e gerencia as conexoes com os chats.
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns');
const net = require('net');
const zlib = require('zlib');
// WebSocket (cliente) fala com o obs-websocket do OBS; WebSocketServer atende as telas
const { WebSocket, WebSocketServer } = require('ws');

const APP_VERSION = (() => {
  try { return require('./package.json').version; } catch { return '0.0.0'; }
})();

// Endereco do computador na rede local (para o co-apresentador acessar o painel)
function lanAddress() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const ni of interfaces || []) {
      if (ni.family === 'IPv4' && !ni.internal) return ni.address;
    }
  }
  return null;
}

// 🌐 Idioma da janela preta (console): segue o idioma escolhido nas
// configurações; no "auto", o idioma do próprio computador. As telas do
// navegador têm o motor completo (i18n.js) — aqui só as frases que o
// usuário vê ao abrir o programa.
const CONSOLE_IDIOMAS = ['pt', 'en', 'es', 'fr', 'de', 'ru', 'tr', 'ja', 'ko', 'zh'];
function idiomaDoSistema() {
  let bruto = String(
    process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG || process.env.LANGUAGE || ''
  ).split(/[.:@]/)[0].replace('_', '-');
  if (!bruto) {
    try { bruto = String(Intl.DateTimeFormat().resolvedOptions().locale || ''); } catch {}
  }
  const baixo = bruto.toLowerCase();
  if (!baixo || baixo === 'c' || baixo === 'posix') return 'pt';
  if (baixo.startsWith('pt')) return 'pt';
  const base = baixo.slice(0, 2);
  return CONSOLE_IDIOMAS.includes(base) ? base : 'en';
}
const CONSOLE_TEXTOS = {
  en: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta is running!',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': 'Open in your browser (Chrome, Edge, Firefox...):',
    'Painel de controle:': 'Control panel:',
    'Overlay (destaque):': 'Overlay (featured):',
    'Chat ao vivo (fixo):': 'Live chat (docked):',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': 'On your phone or another device on the same WiFi (local network):',
    'Deixe esta janela aberta enquanto estiver fazendo live.': 'Keep this window open while you are live.',
    'Para parar, feche esta janela ou aperte Ctrl+C.': 'To stop, close this window or press Ctrl+C.',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 New version available: v$1 (you are on v$2). Update in Settings → ℹ️ About.',
  },
  es: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ ¡OBS Social v$1 Beta está funcionando!',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': 'Abre en tu navegador (Chrome, Edge, Firefox...):',
    'Painel de controle:': 'Panel de control:',
    'Overlay (destaque):': 'Overlay (destacado):',
    'Chat ao vivo (fixo):': 'Chat en vivo (fijo):',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': 'En el celular u otro aparato del mismo WiFi (red local):',
    'Deixe esta janela aberta enquanto estiver fazendo live.': 'Deja esta ventana abierta mientras estés en vivo.',
    'Para parar, feche esta janela ou aperte Ctrl+C.': 'Para detener, cierra esta ventana o presiona Ctrl+C.',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 Nueva versión disponible: v$1 (estás en la v$2). Actualiza en Configuración → ℹ️ Acerca de.',
  },
  fr: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta est en marche !',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': 'Ouvrez dans votre navigateur (Chrome, Edge, Firefox...) :',
    'Painel de controle:': 'Panneau de contrôle :',
    'Overlay (destaque):': 'Overlay (mise en avant) :',
    'Chat ao vivo (fixo):': 'Chat en direct (fixe) :',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': 'Sur le téléphone ou un autre appareil du même WiFi (réseau local) :',
    'Deixe esta janela aberta enquanto estiver fazendo live.': 'Laissez cette fenêtre ouverte pendant votre live.',
    'Para parar, feche esta janela ou aperte Ctrl+C.': 'Pour arrêter, fermez cette fenêtre ou appuyez sur Ctrl+C.',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 Nouvelle version disponible : v$1 (vous êtes en v$2). Mettez à jour dans Paramètres → ℹ️ À propos.',
  },
  de: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta läuft!',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': 'Im Browser öffnen (Chrome, Edge, Firefox...):',
    'Painel de controle:': 'Kontrollpanel:',
    'Overlay (destaque):': 'Overlay (Highlight):',
    'Chat ao vivo (fixo):': 'Live-Chat (fest):',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': 'Am Handy oder einem anderen Gerät im selben WLAN (lokales Netzwerk):',
    'Deixe esta janela aberta enquanto estiver fazendo live.': 'Lassen Sie dieses Fenster während des Livestreams geöffnet.',
    'Para parar, feche esta janela ou aperte Ctrl+C.': 'Zum Beenden dieses Fenster schließen oder Strg+C drücken.',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 Neue Version verfügbar: v$1 (Sie haben v$2). Aktualisieren unter Einstellungen → ℹ️ Über.',
  },
  ru: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta запущен!',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': 'Откройте в браузере (Chrome, Edge, Firefox...):',
    'Painel de controle:': 'Панель управления:',
    'Overlay (destaque):': 'Оверлей (выделение):',
    'Chat ao vivo (fixo):': 'Живой чат (закреплённый):',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': 'На телефоне или другом устройстве в той же WiFi-сети (локальной):',
    'Deixe esta janela aberta enquanto estiver fazendo live.': 'Держите это окно открытым во время эфира.',
    'Para parar, feche esta janela ou aperte Ctrl+C.': 'Чтобы остановить, закройте это окно или нажмите Ctrl+C.',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 Доступна новая версия: v$1 (у вас v$2). Обновите в Настройки → ℹ️ О программе.',
  },
  tr: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta çalışıyor!',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': 'Tarayıcınızda açın (Chrome, Edge, Firefox...):',
    'Painel de controle:': 'Kontrol paneli:',
    'Overlay (destaque):': 'Overlay (öne çıkan):',
    'Chat ao vivo (fixo):': 'Canlı sohbet (sabit):',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': 'Aynı WiFi ağındaki (yerel ağ) telefon veya başka bir cihazda:',
    'Deixe esta janela aberta enquanto estiver fazendo live.': 'Yayın sırasında bu pencereyi açık tutun.',
    'Para parar, feche esta janela ou aperte Ctrl+C.': 'Durdurmak için bu pencereyi kapatın veya Ctrl+C tuşlarına basın.',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 Yeni sürüm mevcut: v$1 (siz v$2 sürümündesiniz). Ayarlar → ℹ️ Hakkında bölümünden güncelleyin.',
  },
  ja: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta が起動しました！',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': 'ブラウザで開いてください（Chrome、Edge、Firefoxなど）:',
    'Painel de controle:': 'コントロールパネル:',
    'Overlay (destaque):': 'オーバーレイ（注目）:',
    'Chat ao vivo (fixo):': 'ライブチャット（固定）:',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': '同じWiFi（ローカルネットワーク）のスマホや他の端末からは:',
    'Deixe esta janela aberta enquanto estiver fazendo live.': '配信中はこのウィンドウを開いたままにしてください。',
    'Para parar, feche esta janela ou aperte Ctrl+C.': '停止するには、このウィンドウを閉じるか Ctrl+C を押してください。',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 新しいバージョンがあります: v$1（現在は v$2）。設定 → ℹ️ このアプリについて から更新してください。',
  },
  ko: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta 실행 중!',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': '브라우저에서 여세요 (Chrome, Edge, Firefox...):',
    'Painel de controle:': '컨트롤 패널:',
    'Overlay (destaque):': '오버레이 (하이라이트):',
    'Chat ao vivo (fixo):': '라이브 채팅 (고정):',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': '같은 WiFi(로컬 네트워크)의 휴대폰이나 다른 기기에서는:',
    'Deixe esta janela aberta enquanto estiver fazendo live.': '방송 중에는 이 창을 열어 두세요.',
    'Para parar, feche esta janela ou aperte Ctrl+C.': '중지하려면 이 창을 닫거나 Ctrl+C를 누르세요.',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 새 버전이 있습니다: v$1 (현재 v$2). 설정 → ℹ️ 정보에서 업데이트하세요.',
  },
  zh: {
    '✅ OBS Social v$1 Beta está rodando!': '✅ OBS Social v$1 Beta 正在运行！',
    'Abra no seu navegador (Chrome, Edge, Firefox...):': '请在浏览器中打开（Chrome、Edge、Firefox 等）:',
    'Painel de controle:': '控制面板:',
    'Overlay (destaque):': '叠加层（精选）:',
    'Chat ao vivo (fixo):': '直播聊天（固定）:',
    'No celular ou em outro aparelho do mesmo WiFi (rede local):': '在同一 WiFi（局域网）的手机或其他设备上:',
    'Deixe esta janela aberta enquanto estiver fazendo live.': '直播期间请保持此窗口打开。',
    'Para parar, feche esta janela ou aperte Ctrl+C.': '要停止，请关闭此窗口或按 Ctrl+C。',
    '🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.': '🎉 有新版本: v$1（当前为 v$2）。请在 设置 → ℹ️ 关于 中更新。',
  },
};
function idiomaDoConsole() {
  const escolha = state?.settings?.idioma;
  if (escolha && escolha !== 'auto' && CONSOLE_IDIOMAS.includes(escolha)) return escolha;
  return idiomaDoSistema();
}
function tcons(texto, ...args) {
  const dic = CONSOLE_TEXTOS[idiomaDoConsole()];
  const t = (dic && dic[texto]) || texto;
  return t.replace(/\$(\d)/g, (tudo, i) => String(args[Number(i) - 1] ?? ''));
}

const qrcodeFactory = require('qrcode-generator');
const currency = require('./currency');
// 🧲 v0.154: a lista de ferramentas/abas/colunas do painel é a MESMA que as
// páginas usam — o sanitizador só aceita o que existe, e o que existe mora
// num lugar só (nunca mais um botão novo sumindo da ordem salva)
const PAINEL_ORDEM = require('./public/painel-ordem');

const { TwitchConnector } = require('./connectors/twitch');
const { KickConnector } = require('./connectors/kick');
const { YouTubeConnector, baixarFigurinha: baixarFigurinhaYouTube } = require('./connectors/youtube');
const { BilibiliConnector } = require('./connectors/bilibili');
const { TelegramConnector } = require('./connectors/telegram');
const { WhatsAppConnector } = require('./connectors/whatsapp');
const { WhatsAppLocalConnector } = require('./connectors/whatsapp-local');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SAVED_FILE = path.join(DATA_DIR, 'saved.json');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

// 🔒 v0.127.1: arquivos com segredo (senha, tokens, chave) nascem e ficam
// legíveis só pelo dono — num computador com mais de um usuário, os outros
// não leem. (No Windows o modo não se aplica; não faz mal.)
function gravarPrivado(arquivo, conteudo) {
  fs.writeFileSync(arquivo, conteudo, { mode: 0o600 });
  try { fs.chmodSync(arquivo, 0o600); } catch { /* sistema sem esse controle */ }
}
const MAX_RECENT = 300;
// A memória de exibição era UMA lista de 300 para todas as redes juntas. Numa
// live com o YouTube a mil, os comentários da Kick eram empurrados para fora
// dessa janela e a coluna dela aparecia quase vazia — mesmo com o contador
// mostrando o total certo. Agora cada rede tem a SUA janela.
const MAX_RECENT_REDE = 300;
const MAX_SAVED = 500;
const MAX_UPLOAD_BYTES = 300 * 1024 * 1024;

// Uma peça (do destaque ou de um widget desmontado): posição em % da caixa
// e o ajuste fino completo — escala, rotação, opacidade, cor própria, sombra
// e espelhar. Campos extras (larg/alt/ajuste, borda do avatar) entram por cima.
// 📐 v0.98: TODA peça tem largura e altura próprias. 0 = automático (a peça
// fica do tamanho do conteúdo dela), que é como todas elas sempre nasceram —
// quem quiser passa a poder fixar a caixa de qualquer uma, não só das poucas
// que já tinham (a arte, o nome e o texto).
// ✍️ v0.109: toda peça carrega a formatação de texto (vale nas peças com
// texto — nome, texto, valor e as dos widgets): fonte, negrito/itálico/
// sublinhado/maiúsculas em três estados ('auto' = como a peça é de fábrica),
// alinhamento, contorno (px + cor) e espaçamento entre letras (px).
const PECA = (x, y, extra = {}) => ({
  mostrar: true, x, y, escala: 100, rotacao: 0, opacidade: 100,
  cor: '', sombra: false, espelhar: false, z: 0, larg: 0, alt: 0,
  fonte: '', negrito: 'auto', italico: 'auto', sublinhado: 'auto', maiusculas: 'auto',
  alinhar: 'auto', contorno: 0, contornoCor: '#000000', espacamento: 0, ...extra,
});

const DEFAULT_SETTINGS = {
  // Comentario em destaque (/overlay)
  position: 'bottom-center',
  accentMode: 'platform',
  accentColor: '#7c3aed',
  bgColor: '#111827',
  bgOpacity: 0.92,
  textColor: '#ffffff',
  // ✍️ v0.100: a cor do NOME de quem comentou, independente da cor do texto.
  // 'padrao' = como sempre foi (a mesma cor de destaque do cartão);
  // 'platform' = a cor da rede social; 'author' = a cor que o PRÓPRIO SERVIÇO
  // manda (Twitch e Kick mandam; quem não manda cai na cor da rede);
  // 'custom' = uma cor só, escolhida por você.
  nameColorMode: 'padrao',
  nameColor: '#ffffff',
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  fontSize: 26,
  maxWidth: 640,
  borderRadius: 16,
  paddingScale: 100,
  accentBarWidth: 6,
  showAvatar: true,
  avatarShape: 'circle',
  showPlatformIcon: true,
  showBadges: false,
  textShadow: false,
  cardShadow: true,
  animation: 'fade',     // 🎬 v0.81: padrão único de entrada = o fade do relógio
  animationOut: 'fade',  // animacao de saida do destaque
  animationSeconds: 0,     // velocidade da entrada (0 = padrao rapido; 1-15s)
  animationOutSeconds: 0,  // velocidade da saida (0 = padrao; 1-15s)
  loopAnimation: 'none',   // animacao em loop enquanto esta na tela
  loopSeconds: 3,          // duracao de cada ciclo do loop (1-15s)
  loopDurationSeconds: 0,  // repetir por quanto tempo (0 = sem parar; max 3600)
  autoHideSeconds: 0,    // tempo de tela (0 = fica ate tirar; max 3600 = 1h)
  scale: 100,   // tamanho geral do cartao em destaque (%)
  mediaUrl: '',      // legado (migrado para mediaCard/mediaFullscreen)
  mediaMode: 'card', // legado
  mediaCard: '',       // midia usada como fundo do cartao do destaque
  mediaCardAjuste: 'cobrir', // como a arte entra no cartao: cobrir | esticar | caber
  cartaoSoArte: false, // 🖼️ a arte É o cartao: some o fundo padrao, a barrinha e a sombra
  mediaFullscreen: '', // midia usada como moldura de tela inteira
  mediaOpacity: 1,
  mediaX: 0,        // posicao/tamanho da moldura em tela inteira (%),
  mediaY: 0,        // ajustados livremente no editor de tela (🖱️)
  mediaScale: 100,
  customCSS: '',
  feedDirection: 'top',  // sentido do feed do painel: mais novos em cima (padrão)
  feedPageSize: 20,         // comentarios por pagina no painel (5-100)
  posX: 4,   // usados quando position === 'custom' (arrastado no editor)
  posY: 78,
  // 🎭 v0.54: troca automática de perfil do destaque — cada comentário
  // destacado pode vestir um "molde" salvo: um para os comentários comuns e
  // faixas por valor em reais para Super Chats e doações
  perfilAuto: {
    ligado: false,
    comum: '',    // nome do perfil dos comentários comuns ('' = o visual atual)
    faixas: [],   // [{ min: valor em reais, perfil: nome }] — vale a MAIOR faixa alcançada
    // 📺 v0.113: cada rede pode ter o SEU molde de comentário comum — o caso
    // real: moldes exclusivos do YouTube e a Twitch/Kick caindo no visual ao
    // vivo (que carregava uma arte fora da tela). '' = segue o comum geral;
    // ':nenhum' = esta rede fica no visual ao vivo mesmo com comum geral
    comumPorRede: { youtube: '', twitch: '', kick: '', bilibili: '' },
    // 💰 Pago (Super Chat, doação, bits...) que não casa com faixa nenhuma:
    // ':comum' = veste o mesmo dos comentários comuns da rede (padrão);
    // '' = visual ao vivo; ou o nome de um molde
    semFaixa: ':comum',
  },
  // Modo de tela dos overlays: 'normal' | 'horizontal' | 'vertical' | 'ambos'.
  // No 'ambos', o conteúdo é o mesmo (linkado) e só as POSIÇÕES são
  // independentes — o perfil vertical fica em layoutV
  screenMode: 'normal',
  layoutV: {},  // posições do overlay vertical: { featured, media, widgets: {chave: {position,x,y}} }
  // Idioma da interface: 'auto' segue o navegador de quem abre cada página
  idioma: 'auto',
  logRetentionDays: 30, // 0 = nunca apagar; maximo 365
  // Sorteio: fichas por nivel de sub/membro (lidas dos selos publicos do chat)
  raffle: {
    extraTokens: true,  // desligado = sorteio aberto: 1 ficha para todos
    weights: {
      prime: 2,   // Twitch Prime
      subT1: 2,   // Twitch Tier 1
      subT2: 3,   // Twitch Tier 2
      subT3: 4,   // Twitch Tier 3
      // 👑 v0.116: fundador esta ACIMA de todo tier — o maior peso padrao
      twitchFounder: 5, // Fundador da Twitch (selo founder — primeiros assinantes)
      kickSub: 2,     // Sub da Kick
      kickFounder: 5, // Founder da Kick (fundador — primeiros assinantes)
      ytMember: 2, // Membro do YouTube (qualquer nivel)
    },
    // (founderAjustado: a marca da migracao v0.116 — 3 → 5 nos fundadores
    // intocados — NAO entra no padrao de proposito: e a ausencia dela que diz
    // "ainda nao migrou"; o servidor grava a marca ao carregar/ajustar)
    // 🔑 v0.116: palavras de entrada — com a lista cheia, so entra no sorteio
    // quem digitar UMA delas no chat (palavra inteira, sem caixa); vazia =
    // todo mundo que fala entra, como sempre. Ate 30 palavras.
    palavras: [],
    ytLevels: '', // avancado: "Nome do nivel=fichas" por linha (niveis nomeados do YouTube)
    // 📨/💬 Redes de mensagem (Labs): entram no sorteio SO se o streamer ligar
    telegramSorteio: false,
    whatsappSorteio: false,
    telegramFichas: 1, // fichas de quem participa pelo Telegram (1 a 100)
    whatsappFichas: 1, // fichas de quem participa pelo WhatsApp (1 a 100)
    // 🎲 O dado rodando antes de mostrar o podio
    dadoSegundos: 3,     // 0 = vai direto para o podio; ate 15
    somUrl: '/sons/dado-padrao.wav', // vem junto com o programa; trocavel por um seu
    somVolume: 70,       // 0 a 100
    somOnde: 'ambos',    // 'painel' | 'live' | 'ambos' — onde o som do dado toca
    // 💬 A primeira resposta de cada ganhador depois do sorteio
    respostaPainel: true,  // mostra a resposta no modal do painel
    respostaTela: true,    // mostra a resposta no podio da tela (publico)
    respostaTimer: false,  // liga o ⏱ tempo de resposta
    respostaModo: 'um',    // 'um' = um prêmio (a chance desce a fila) | 'varios' = todos premiados
    respostaSegundos: 60,  // tempo de cada colocado (5 a 600s)
  },
  // Labs: funcoes experimentais que podem ser ligadas/desligadas
  // 🧪 Regra da casa: TUDO no Labs começa DESLIGADO — liga quem quiser usar
  labs: {
    donations: false, // URL generica de doacoes (/doacao) e aba Apoios
    // 💠 Pix direto do banco do streamer (API Pix do Bacen): cada Pix
    // recebido vira um apoio na aba Apoios, com a mensagem do pagador
    pix: false,
    // Ao (re)conectar, puxa as mensagens enviadas enquanto o programa estava
    // fora do ar — dentro do que cada servico disponibiliza publicamente
    recoverHistory: false,
    // Bilibili e experimental: comeca desligada; ativa aqui para usar
    bilibili: false,
    // 📨 Telegram (bot oficial no grupo da live) — experimental
    telegram: false,
    // 🎙️ Transcrição local dos áudios/vídeos dos inscritos (whisper.cpp);
    // motor e modelos baixados sob demanda — nada sai do computador
    transcricao: false,
    // 💬 WhatsApp via gateway Whapi (NÃO oficial da Meta — risco de
    // banimento do número; use um número secundário dedicado à live)
    whatsapp: false,
    // 🎬 Controle do OBS Studio pelo painel: cenas, transição de estúdio,
    // mudo e live/gravação — via obs-websocket, que já vem no OBS 28+
    obs: false,
    // 🎛️ v0.122: controle do vMix pelo painel (experimental): entradas,
    // transições, overlays, saídas e áudio — pela API TCP que o vMix já traz
    vmix: false,
    // 🎵 Mesa de trilhas: músicas e efeitos tocados pelo painel, com o som
    // saindo no overlay (a live), no painel, ou nos dois
    trilhas: false,
    // 🕹️ v0.126: controle externo — Stream Deck, Loupedeck, Companion, Touch
    // Portal, atalhos do celular... comandam o OBS Social por HTTP com token
    controle: false,
    // 🎬 v0.134: extrator opcional da 🎞️ Mídia direta (yt-dlp) — baixado sob
    // demanda em 🔌 Conexões, para os sites que não publicam o arquivo
    ytdlp: false,
  },
  // 👥 v0.141: de onde as mensagens do WhatsApp/Telegram podem vir. Grupo,
  // canal e comunidade são a mesma família: quem só quer a conversa direta
  // desliga aqui e o resto nem entra no painel. De fábrica tudo entra, como
  // sempre foi.
  chats: {
    whatsappGrupos: true, // grupos, comunidades e canais do WhatsApp
    telegramGrupos: true, // grupos, supergrupos e canais do Telegram
  },
  // 📎 Mídia do inscrito na tela do público: escala e tela cheia
  midiaTela: {
    escala: 45,       // altura máxima da mídia, em % da tela (20 a 100)
    telaCheia: false, // true = a mídia toma a tela inteira (fundo escurecido)
  },
  // ✨ v0.86: a sombra que contorna os overlays flutuantes (avatar, mídias,
  // cartão de destaque, pílula de áudio) — o padrão é a do 🔍 mostrar avatar
  sombra: {
    tipo: 'suave',  // suave (a do avatar) | contorno | nenhuma
    opacidade: 55,  // 0 a 100 (55 = o rgba(0,0,0,0.55) do avatar)
  },
  // 🔊 v0.77: áudios dos overlays — por widget, sons de entrada, saída,
  // tempo de tela e finalização (vazio = nenhum som configurado)
  audiosOverlay: {},
  // 🪟 v0.79: opções das janelas (compartilhadas entre os navegadores)
  janelas: {
    avatarMulti: false, // várias instâncias do 🔍 avatar ao mesmo tempo
  },
  // 🎙️ Transcrição local (Labs): qual modelo usar e em que idioma
  transcricao: {
    modelo: 'base',  // tiny | base | small | medium | large (large = o mais preciso)
    idioma: 'auto',  // 'auto' detecta; ou um código tipo 'pt', 'en'...
    comando: '',     // avançado: caminho de um whisper-cli seu (vazio = automático)
  },
  // 🎵 A cara da Mesa de trilhas (vale nas configurações E no painel):
  // quantos botões por página e a fonte global do texto dos botões
  trilhasGrade: 15,          // 4 | 6 | 8 | 12 | 15 (como as telas do Stream Deck)
  trilhasTexto: {
    tam: 11,                 // px do texto do botão (8 a 20)
    cor: '',                 // '' = a cor do tema; ou um #hex
    negrito: true,
  },
  // 🎬 Experimental: cada cena do OBS vira uma tecla na Mesa do painel
  // (precisa da conexão 🎬 OBS Studio do Labs configurada e conectada)
  trilhasCenas: false,
  // 🎬 v0.53: o que aparece no controle do OBS dentro do painel. Cada bloco
  // tem o seu liga/desliga — quem só troca de cena não precisa ver mixer,
  // filtros e perfis ocupando a tela.
  obsPainel: {
    saidas: true,      // 📡 transmitir, ⏺ gravar, ⏸ pausa, 📷 câmera virtual, ⏪ replay
    cenas: true,       // a lista de cenas (+ 🎬 transição do modo estúdio)
    audio: true,       // 🔊 mixer: mudo e volume de cada fonte
    fontes: true,      // 👁 visibilidade das fontes da cena no ar
    midias: true,      // ⏯ controle de mídia (vídeos e playlists)
    filtros: true,     // 🎚 ligar/desligar filtros
    estudio: true,     // 🎭 modo estúdio e transições
    perfis: false,     // 🗂 coleções de cenas e perfis (troca pesada: vem desligado)
    captura: true,     // 📸 print da cena direto para as mídias do programa
    stats: true,       // 📊 v0.83: saúde do OBS (fps, cpu, disco, quadros perdidos, tempos)
    atalhos: false,    // ⌨️ v0.83: disparar atalhos do OBS por nome (vem desligado)
  },
  // 🎛️ v0.122: os blocos do controle do vMix no painel (cada um com o seu
  // liga/desliga, como os do OBS)
  vmixPainel: {
    saidas: true,      // ⏺ gravar, 📡 transmitir, 📤 saída externa, 🎞 MultiCorder, ⛶ tela cheia
    entradas: true,    // 📺 entradas: preview / ao vivo (com o tally)
    transicoes: true,  // 🎬 os 4 botões de transição, corte, fade, fade to black
    overlays: true,    // 🧩 overlays 1 a 4
    audio: true,       // 🔊 master + mudo/volume por entrada
    midias: true,      // ⏯ play/pause/reiniciar das entradas de vídeo/lista
    titulos: true,     // 🔤 textos dos títulos (GT/XAML) editáveis
    stats: true,       // 📊 versão, edição, preset, tempo de gravação/transmissão
    avancado: false,   // 🧰 replay, presets, scripts, tecla e função livre (vem desligado)
  },
  // 📁 Segurar a tecla de uma pasta por este tempo (segundos, 0 a 5) abre a
  // pasta; soltar antes toca tudo de dentro em fila. 0 = abre no toque.
  trilhasSegurar: 0.6,
  // ♿ Acessibilidade da interface (painel + configurações). Cada recurso é um
  // liga/desliga próprio; os overlays do OBS (conteúdo para o público) ficam
  // como o streamer desenhou.
  acessibilidade: {
    altoContraste: false,    // contraste reforçado (textos e bordas mais firmes)
    reduzirAnimacoes: false, // corta animações e transições da interface
    focoVisivel: false,      // anel de foco grosso para navegação por teclado
    formasNoStatus: false,   // 🚦 formas além de cor na bolinha (✓ ! ✕) — daltonismo
  },
  // 💾 Backup: pasta à escolha do usuário e a frequência de cada item.
  // 'manual' | 'temporeal' | '1s'..'60s' | '1min'..'60min' | '6h' | '12h' | '24h'
  backup: {
    pasta: '',   // vazio = data/ do próprio programa (sempre em obs-social-backup/)
    itens: {
      configuracoes: 'manual', logs: 'manual', midias: 'manual', marcas: 'manual',
      participantes: 'manual', conexoes: 'manual', ferramentas: 'manual',
    },
  },
  // Painel de controle
  panel: {
    accentColor: '#7c3aed',
    // ✍️ v0.100: cores dos comentários NO PAINEL. 'padrao' = como sempre foi
    // (a cor que o serviço manda quando vem, senão a cor do tema); as outras
    // opções são as mesmas do destaque e do chat fixo. textColor vazio = a
    // cor do tema, que é o padrão de fábrica.
    nameColorMode: 'padrao',
    nameColor: '#7c3aed',
    textColor: '',
    customCSS: '',
    refreshSeconds: 1,  // fluxo do chat: 0 = manual, 1 = tempo real, até 60s
    dripSeconds: 0,     // espaço entre cada mensagem ao aparecer: 0 = automático, até 5s
    dripPerColumn: false, // 🌊 "Por coluna": cada coluna escolhe o próprio ritmo
    colDrip: {},        // ritmo individual por rede (segundos; ausente/0 = na hora)
    textoAoLado: false, // aba Ao vivo: texto do comentário ao lado do nome (em vez de embaixo)
    comentGap: 1,       // respiro entre um comentário e outro nas colunas (0 a 30px)
    faixaDupla: false,  // faixa colorida da plataforma nos DOIS lados do comentário
    // 🔄 Recarregar os chats sozinho de tempos em tempos (minutos).
    // 0 = nunca (só no botão de cada coluna). Máximo 60.
    recarregarMin: 0,
    liveView: 'unificado',  // aba Ao vivo: 'unificado' ou 'colunas' (uma por rede)
    columnsShowAll: false,  // no modo colunas, incluir a coluna do chat unificado
    // 🔇 v0.147: a coluna de uma rede só aparece quando ela recebe o primeiro
    // comentário. Ligado aqui, as redes conectadas mas caladas voltam a
    // aparecer (é por elas que se alcança o 🔄 de uma rede que travou).
    columnsShowEmpty: false,
    columnsOrder: [],   // ordem das colunas arrastadas ([] = padrão)
    toolOrder: [],      // ordem dos ícones de ferramentas ([] = padrão)
    tabOrder: [],       // ordem das abas
    toolbarPos: 'top',  // ferramentas acima ('top') ou abaixo ('bottom') das abas
    // 🫧 Animação de chegada dos comentários no painel
    anim: { estilo: 'deslizar', duracao: 0.5 },
    previewW: 1920,     // tamanho de tela da pré-visualização (Organizar a tela)
    previewH: 1080,
  },
  // 🏷️ Distintivos (selos de cargo) que aparecem ao lado do nome
  selos: {
    mostrar: true,          // desligado = nenhum selo aparece
    imagens: true,          // usar a arte original de cada plataforma
    outros: true,           // selos fora dos cargos principais (bits, presentes, eventos...)
    // Cada cargo pode ser desligado por conta própria
    dono: true, mod: true, vip: true, sub: true, membro: true,
    founder: true, og: true, verificado: true, bot: true,
  },
  // 🪟 Camadas da tela (🖱️ Organizar a tela): a ordem de empilhamento no
  // overlay, de baixo para cima. O padrão reproduz o comportamento de sempre:
  // a moldura do usuário embaixo, o destaque sobre ela, os widgets por cima.
  layers: {
    ordem: ['media', 'featured', 'qr', 'raffle', 'likemeter', 'winstreak', 'audience', 'aviso', 'relogio'],
  },
  // 🧩 Modo peças soltas do destaque: cada parte do cartão em posição própria
  // (arrastadas no 🖱️ Organizar a tela). x/y em % do cartão; escala em %.
  // O nome e o texto têm caixa própria (larg/alt em %) e um "ajuste" que decide
  // o que acontece quando o conteúdo não cabe: 'encolher' a letra até caber,
  // 'cortar' na borda, ou 'vazar' (o cartão ainda recorta o que sair dele).
  destaqueLivre: false,
  cardAlturaEm: 4.6, // altura do cartão no modo livre (em "em", acompanha a fonte)
  // 📺 Rede deste visual/molde: '' = compartilhado (veste comentário de
  // qualquer rede); 'youtube'/'twitch'/'kick'/'bilibili' = exclusivo dela —
  // o 🎭 automático pula o molde quando o comentário vem de outra rede
  plataforma: '',
  pecas: {
    // 🖼️ A arte enviada — também é uma peça: dá para arrastar, esticar,
    // girar e regular no 🖱️ Organizar a tela. v0.102: ela nasce no TAMANHO
    // REAL do arquivo (largura e altura no automático = 0), como qualquer
    // outra peça nasce do tamanho do próprio conteúdo — nada de esticar na
    // caixa do cartão padrão. Um lado escolhido segue a proporção; os dois
    // escolhidos esticam para a caixa.
    arte: PECA(0, 0),
    avatar: PECA(2, 21, { borda: 0, bordaCor: '#ffffff' }),
    icone: PECA(15, 12),
    nome: PECA(20, 8, { larg: 52, ajuste: 'encolher' }),
    selos: PECA(20, 58),
    // 💰 v0.98: o valor ganhou "encaixe" próprio. Ele era encolhido À FORÇA
    // até caber no cartão, e por isso o Tamanho escolhido no editor não valia
    // de nada. Agora nasce em "vazar" — o tamanho é o que o streamer pediu —
    // e quem quiser o encolhimento de antes escolhe "encolher" no editor.
    // 💰 v0.109: 'pilula' = a etiqueta colorida de sempre; 'texto' = só o
    // número, como o nome e o texto (cabe melhor no espaço reservado na arte)
    valor: PECA(74, 8, { ajuste: 'vazar', estilo: 'pilula' }),
    texto: PECA(20, 34, { larg: 76, alt: 32, ajuste: 'encolher' }),
  },
  // 🕐 Relógio: fuso horário e opções do timer
  relogio: {
    fuso: 'auto',            // 'auto' (do computador) ou um fuso IANA (America/Sao_Paulo...)
    // Timer: quando o tempo acaba
    somUrl: '/sons/timer-padrao.wav', // vem junto com o programa; trocável por um seu
    somVolume: 70,           // 0 a 100
    somOnde: 'ambos',        // 'painel' | 'live' | 'ambos' — onde o alerta toca
    mostrarDataNoPainel: true, // mostrador do cabeçalho: só a hora ou hora + data
    tirarAvisoNoFim: true,   // timer + Avisos trabalhando juntos
    // ⏳ Reta final: o numero pisca ANTES de zerar
    piscarFinal: true,
    piscarFinalSegundos: 10, // quantos segundos antes do fim (1 a 60)
    piscarFinalCor: '#ffd23f',
    // 🔴 Fim: o numero pisca QUANDO zera
    piscarNoFim: true,
    piscarNoFimSegundos: 0,  // por quanto tempo pisca depois de zerar (0 = sem parar; ate 300)
    piscarNoFimCor: '#ff5c5c',
    // 📢 O Aviso pisca junto na reta final
    piscarAvisoNoFinal: true,
    piscarAvisoSegundos: 10, // quantos segundos antes do fim (1 a 60)
    piscarAvisoCor: '',      // vazio = so a opacidade (mantem a cor do texto)
  },
  // 🎨 Tema do programa (painel + configurações). Vazio = cores do tema
  // claro/escuro padrão. O "Tamanho da interface" (🔍 do painel) é outra
  // coisa e continua independente disto.
  tema: {
    nome: '',           // nome do tema carregado (só para mostrar)
    corFundo: '',       // fundo geral
    corPainel: '',      // cartões e caixas
    corPainel2: '',     // caixas internas
    corTexto: '',
    corSuave: '',       // textos secundários
    corBorda: '',
    corDestaque: '',    // botões e realces (o antigo accentColor)
    fundoImagem: '',    // /uploads/... (imagem de fundo do programa)
    fundoAjuste: 'cover',   // cover | contain | tile
    fundoOpacidade: 0.35,   // 0 a 1
    fundoDesfoque: 0,       // 0 a 20 px
    fonte: '',          // família de fonte da interface
    tamTexto: 100,      // % do tamanho dos textos (80 a 130)
    tamIcone: 100,      // % do tamanho dos ícones (70 a 160)
    cantos: 14,         // arredondamento dos cantos (0 a 28 px)
    densidade: 100,     // espaçamento interno (80 a 130 %)
  },
  // Widgets do overlay (cada um totalmente personalizavel)
  widgets: {
    qr: {
      pecasLivre: false, pecasLargura: 260, pecasAltura: 310,
      pecas: { codigo: PECA(10, 6), titulo: PECA(10, 78) },
      position: 'top-right', scale: 100, bgColor: '#ffffff', bgOpacity: 1,
      textColor: '#111111', accentColor: '#7c3aed', borderRadius: 14,
      // 📱 v0.139: a pintura do código. A matriz é sempre a mesma — o que muda
      // aqui é só o desenho, então nada disto interfere no que o QR carrega.
      // bgColor/bgOpacity acima são do CARTÃO do widget; estes são do CÓDIGO.
      // Os padrões reproduzem EXATAMENTE o QR de sempre (preto no branco,
      // quadradinho, margem de 2 módulos): quem atualiza não vê nada mudar.
      qrModulo: 'quadrado',      // quadrado | arredondado | ponto | losango
      qrOlho: 'quadrado',        // os três cantos: quadrado | arredondado | circulo
      qrCorModulo: '#000000',
      qrOlhoIgual: true,         // os cantos usam a cor dos módulos
      qrCorOlho: '#000000',      // só vale com qrOlhoIgual desligado
      qrCorFundo: '#ffffff',
      qrFundoOpacidade: 1,       // 0 = sem fundo (o cenário aparece atrás)
      qrMargem: 2,               // zona de silêncio, em módulos (a norma pede 4)
      qrRespiro: 0,              // folga entre módulos, em % do módulo
      x: 4, y: 8, animation: 'fade', animationOut: 'fade', animationSeconds: 0, animationOutSeconds: 0, loopAnimation: 'none', loopSeconds: 3, loopDurationSeconds: 0, screenSeconds: 0, mediaUrl: '', customCSS: '',
    },
    raffle: {
      pecasLivre: false, pecasLargura: 480, pecasAltura: 560,
      pecas: { titulo: PECA(18, 3), podio: PECA(8, 12) },
      position: 'center', scale: 100, layout: 'vertical', bgColor: '#111827', bgOpacity: 0.92,
      textColor: '#ffffff', accentColor: '#ffd700', borderRadius: 22,
      x: 4, y: 8, animation: 'fade', animationOut: 'fade', animationSeconds: 0, animationOutSeconds: 0, loopAnimation: 'none', loopSeconds: 3, loopDurationSeconds: 0, screenSeconds: 0, mediaUrl: '', customCSS: '',
    },
    likemeter: {
      pecasLivre: false, pecasLargura: 380, pecasAltura: 140,
      pecas: { numeros: PECA(6, 10), barra: PECA(6, 48, { larg: 88 }), rotulo: PECA(6, 72) },
      position: 'top-center', scale: 100, bgColor: '#111827', bgOpacity: 0.92,
      textColor: '#ffffff', accentColor: '#7c3aed', viewersColor: '#ff5c5c', likesColor: '#4da3ff',
      borderRadius: 16, x: 4, y: 8, animation: 'fade', animationOut: 'fade', animationSeconds: 0, animationOutSeconds: 0, loopAnimation: 'none', loopSeconds: 3, loopDurationSeconds: 0, screenSeconds: 0, mediaUrl: '', customCSS: '',
    },
    winstreak: {
      pecasLivre: false, pecasLargura: 250, pecasAltura: 110,
      pecas: { icone: PECA(8, 26), rotulo: PECA(32, 10), numeros: PECA(32, 46) },
      position: 'top-left', scale: 100, bgColor: '#111827', bgOpacity: 0.92,
      textColor: '#ffffff', accentColor: '#ffd700', borderRadius: 16,
      x: 4, y: 8, animation: 'fade', animationOut: 'fade', animationSeconds: 0, animationOutSeconds: 0, loopAnimation: 'none', loopSeconds: 3, loopDurationSeconds: 0, screenSeconds: 0, mediaUrl: '', customCSS: '',
    },
    audience: {
      pecasLivre: false, pecasLargura: 280, pecasAltura: 230,
      pecas: { total: PECA(8, 5), redes: PECA(8, 28) },
      position: 'top-left', scale: 100, mode: 'perPlatform', numbersSide: 'right', showIcon: true, bgColor: '#111827', bgOpacity: 0.92,
      textColor: '#ffffff', accentColor: '#ff5c5c', borderRadius: 16,
      x: 4, y: 8, animation: 'fade', animationOut: 'fade', animationSeconds: 0, animationOutSeconds: 0, loopAnimation: 'none', loopSeconds: 3, loopDurationSeconds: 0, screenSeconds: 0, mediaUrl: '', customCSS: '',
    },
    // 📢 Avisos: texto na tela com formatação completa
    aviso: {
      position: 'top-center', scale: 100, bgColor: '#111827', bgOpacity: 0.92,
      textColor: '#ffffff', accentColor: '#ffcc00', borderRadius: 16,
      x: 4, y: 8, animation: 'fade', animationOut: 'fade', animationSeconds: 0, animationOutSeconds: 0,
      loopAnimation: 'none', loopSeconds: 3, loopDurationSeconds: 0, screenSeconds: 0, mediaUrl: '', customCSS: '',
      // ✍️ v0.110: o texto do aviso é uma peça de texto como as outras (só a
      // formatação vale — o aviso não tem modo solto)
      pecas: { texto: PECA(0, 0) },
      fontFamily: '', fontSize: 30, bold: true, italic: false, underline: false,
      align: 'center', maxWidth: 900, lineHeight: 1.3, textShadow: true, uppercase: false,
    },
    // 🕐 Relógio / cronômetro / timer
    relogio: {
      pecasLivre: false, pecasLargura: 300, pecasAltura: 150,
      pecas: { hora: PECA(8, 16), legenda: PECA(8, 64) },
      position: 'top-right', scale: 100, bgColor: '#111827', bgOpacity: 0.92,
      textColor: '#ffffff', accentColor: '#7c3aed', borderRadius: 16,
      x: 4, y: 8, animation: 'fade', animationOut: 'fade', animationSeconds: 0, animationOutSeconds: 0,
      loopAnimation: 'none', loopSeconds: 3, loopDurationSeconds: 0, screenSeconds: 0, mediaUrl: '', customCSS: '',
      fontFamily: '', fontSize: 44, bold: true,
      mostrarData: true, mostrarSegundos: true, formato24h: true, mostrarRotulo: true, mostrarDecimos: true,
    },
  },
  // Chat ao vivo fixo (/chat)
  chat: {
    align: 'left',
    direction: 'top',    // mais novas em cima (padrao) ou embaixo
    width: 380,
    // 📺 Posição livre pelo 🖱️ Organizar a tela: x/y em % (null = pelo lado
    // de sempre) e altura própria em px (0 = tela inteira)
    x: null,
    y: null,
    height: 0,
    maxMessages: 12,
    fontFamily: "'Segoe UI', system-ui, sans-serif",
    fontSize: 18,
    // ✍️ v0.110: o nome e o texto do chat são peças de texto (formatação)
    pecas: { nome: PECA(0, 0), texto: PECA(0, 0) },
    textColor: '#ffffff',
    msgStyle: 'bubbles',
    bgColor: '#111827',
    bgOpacity: 0.85,
    nameColorMode: 'platform',
    nameColor: '#7c3aed',
    showAvatar: true,
    avatarShape: 'circle',
    showPlatformIcon: true,
    showBadges: true,
    accentBar: true,
    borderRadius: 10,
    spacing: 6,
    textoAbaixo: true,    // texto do comentario embaixo do nome (padrao; desligado = ao lado)
    // 🗑️ Tirar da tela (painel e live) o que os moderadores apagarem
    apagarRemovidas: true,
    animation: 'slide-up',
    animationOut: 'fade',  // animacao de saida das mensagens
    animationSeconds: 0,     // velocidade da entrada (0 = padrao; 1-15s)
    animationOutSeconds: 0,  // velocidade da saida (0 = padrao; 1-15s)
    loopAnimation: 'none',   // loop da caixa inteira do chat
    loopSeconds: 3,
    loopDurationSeconds: 0,
    fadeAfterSeconds: 0,   // tempo de tela de cada mensagem (0 = fica; max 3600)
    textShadow: true,
    superchatColors: true,
    platforms: { youtube: true, twitch: true, kick: true, bilibili: true, doacao: true, telegram: true, whatsapp: true },
    customCSS: '',
  },
};

// 🥞 O z padrão de cada peça (quem fica por cima de quem, dentro da caixa)
// segue a ordem em que elas foram declaradas acima
for (const grupo of [DEFAULT_SETTINGS.pecas,
  ...Object.values(DEFAULT_SETTINGS.widgets).map((w) => w.pecas).filter(Boolean)]) {
  let zi = 0;
  for (const p of Object.values(grupo)) { p.z = zi; zi += 1; }
}

// Nomes antigos das animações do chat, de antes da padronização: viram os
// nomes novos para o seletor continuar mostrando a escolha certa.
const ANIM_CHAT_ANTIGA = { slide: 'slide-up', 'slide-side': 'slide-left' };

let migrarArteDosPerfis = false; // 🖼️ v0.102: os moldes passam pela mesma migração da arte
function mergeSettings(base) {
  const src = base || {};
  const widgets = {};
  for (const key of Object.keys(DEFAULT_SETTINGS.widgets)) {
    widgets[key] = { ...DEFAULT_SETTINGS.widgets[key], ...((src.widgets || {})[key] || {}) };
  }
  // Migracao: o antigo mediaUrl+mediaMode vira um dos dois "encaixes" novos
  if (src.mediaUrl && src.mediaCard === undefined && src.mediaFullscreen === undefined) {
    if ((src.mediaMode || 'card') === 'fullscreen') src.mediaFullscreen = src.mediaUrl;
    else src.mediaCard = src.mediaUrl;
  }
  // 🎬 v0.81: padrão ÚNICO de entrada/saída em todos os overlays — o fade do
  // relógio. Quem ainda estava nos padrões antigos (destaque slide-up e
  // aviso slide-down) muda junto; escolha personalizada no editor fica como está.
  if (src.animation === 'slide-up') src.animation = 'fade';
  if (widgets.aviso && ((src.widgets || {}).aviso || {}).animation === 'slide-down') widgets.aviso.animation = 'fade';
  // 🖼️ v0.102: a arte deixa de ser esticada na caixa do cartão. Quem estava
  // no padrão antigo (100% × 100% = "preenche o cartão") passa para o tamanho
  // real (automático) UMA vez; uma escolha feita de propósito depois disso
  // fica como está. Os moldes salvos fazem a mesma passagem (loadPerfisOverlay).
  if (src.arteTamanhoReal !== true) {
    const a = src.pecas && src.pecas.arte;
    if (a && Number(a.larg) === 100 && Number(a.alt) === 100) { a.larg = 0; a.alt = 0; }
    src.arteTamanhoReal = true;
    migrarArteDosPerfis = true;
  }
  return {
    ...DEFAULT_SETTINGS,
    ...src,
    chat: {
      ...DEFAULT_SETTINGS.chat,
      ...(src.chat || {}),
      animation: ANIM_CHAT_ANTIGA[(src.chat || {}).animation] || (src.chat || {}).animation || DEFAULT_SETTINGS.chat.animation,
      animationOut: ANIM_CHAT_ANTIGA[(src.chat || {}).animationOut] || (src.chat || {}).animationOut || DEFAULT_SETTINGS.chat.animationOut,
      platforms: { ...DEFAULT_SETTINGS.chat.platforms, ...((src.chat || {}).platforms || {}) },
    },
    panel: { ...DEFAULT_SETTINGS.panel, ...(src.panel || {}) },
    tema: { ...DEFAULT_SETTINGS.tema, ...(src.tema || {}) },
    relogio: { ...DEFAULT_SETTINGS.relogio, ...(src.relogio || {}) },
    selos: { ...DEFAULT_SETTINGS.selos, ...(src.selos || {}) },
    layers: { ...DEFAULT_SETTINGS.layers, ...(src.layers || {}) },
    pecas: Object.fromEntries(Object.keys(DEFAULT_SETTINGS.pecas).map((k) => (
      [k, { ...DEFAULT_SETTINGS.pecas[k], ...((src.pecas || {})[k] || {}) }]
    ))),
    labs: { ...DEFAULT_SETTINGS.labs, ...(src.labs || {}) },
    perfilAuto: { ...DEFAULT_SETTINGS.perfilAuto, ...(src.perfilAuto || {}) },
    acessibilidade: { ...DEFAULT_SETTINGS.acessibilidade, ...(src.acessibilidade || {}) },
    trilhasTexto: { ...DEFAULT_SETTINGS.trilhasTexto, ...(src.trilhasTexto || {}) },
    transcricao: { ...DEFAULT_SETTINGS.transcricao, ...(src.transcricao || {}) },
    chats: { ...DEFAULT_SETTINGS.chats, ...(src.chats || {}) }, // 👥 v0.141
    midiaTela: { ...DEFAULT_SETTINGS.midiaTela, ...(src.midiaTela || {}) },
    sombra: { ...DEFAULT_SETTINGS.sombra, ...(src.sombra || {}) }, // ✨ v0.86
    audiosOverlay: sanitizeAudiosOverlay(src.audiosOverlay || {}), // 🔊 v0.77
    janelas: { avatarMulti: (src.janelas || {}).avatarMulti === true }, // 🪟 v0.79
    backup: {
      ...DEFAULT_SETTINGS.backup,
      ...(src.backup || {}),
      itens: { ...DEFAULT_SETTINGS.backup.itens, ...((src.backup || {}).itens || {}) },
    },
    raffle: ajustarSorteio({
      ...DEFAULT_SETTINGS.raffle,
      ...(src.raffle || {}),
      weights: { ...DEFAULT_SETTINGS.raffle.weights, ...((src.raffle || {}).weights || {}) },
    }),
    widgets,
  };
}

// 🎁 v0.116 — limpeza do sorteio que vale na carga E em cada ajuste:
// as palavras de entrada (ate 30, sem repetida, sem quebra de linha) e a
// migracao do peso dos fundadores (quem ficou no 3 de fabrica sobe para 5,
// o maior de todos; quem mexeu no numero fica como esta)
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
function ajustarSorteio(r) {
  r.palavras = limparPalavrasSorteio(r.palavras);
  if (r.founderAjustado !== true) {
    r.weights = { ...(r.weights || {}) };
    if (Number(r.weights.twitchFounder) === 3) r.weights.twitchFounder = 5;
    if (Number(r.weights.kickFounder) === 3) r.weights.kickFounder = 5;
    r.founderAjustado = true;
  }
  return r;
}
// O texto plano de uma mensagem (text, ou os runs colados)
function textoDaMensagem(m) {
  if (typeof m.text === 'string' && m.text) return m.text;
  return (Array.isArray(m.runs) ? m.runs : []).map((r) => (r && typeof r.text === 'string' ? r.text : '')).join('');
}
// A mensagem traz uma das palavras do sorteio? Palavra inteira, sem caixa;
// «#sorteio» e «sorteio» valem o mesmo; uma palavra com espaco (frase) casa
// como trecho.
function mensagemTemPalavraDoSorteio(message, palavras) {
  const texto = textoDaMensagem(message).toLowerCase();
  if (!texto) return false;
  const tokens = texto.split(/[^\p{L}\p{N}_#@]+/u).map((x) => x.replace(/^[#@]+/, '')).filter(Boolean);
  for (const p of palavras) {
    const q = String(p || '').toLowerCase().trim();
    if (!q) continue;
    if (/\s/.test(q)) { if (texto.includes(q)) return true; continue; }
    if (tokens.includes(q.replace(/^[#@]+/, ''))) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Estado

// 📋 v0.90.1: estas constantes moram ANTES do state de propósito. O state
// chama loadClipboard() na hora de nascer, e uma const declarada depois
// ainda está na "zona morta" nesse instante: a leitura estourava um
// ReferenceError que o try/catch engolia — o histórico voltava vazio a cada
// reinício e a primeira gravação apagava o arquivo salvo.
const CLIPBOARD_FILE = path.join(DATA_DIR, 'clipboard.json');
const CLIPBOARD_TXT_ANTIGO = path.join(DATA_DIR, 'clipboard.txt');
const CLIP_DIR = path.join(DATA_DIR, 'clipboard-arquivos');
const CLIP_MAX_ITENS = 200;   // entradas no histórico (as mais velhas saem)
const CLIP_PREVIA = 1500;     // o pedaço do texto que viaja para as telas

// 🔑 A chave que abre os segredos guardados (senha do OBS, tokens de bot,
// segredos do Pix). Nasce nesta máquina e viaja junto no backup do item 🔌
// conexões — sem ela, o backup restaurado noutra instalação não abre.
// Mora aqui em cima pelo MESMO motivo das constantes do clipboard: o state
// carrega as conexões (e decifra os tokens) na hora de nascer, bem antes da
// metade do arquivo.
const CHAVE_LOCAL_FILE = path.join(DATA_DIR, 'chave-local.key');

const state = {
  settings: loadSettings(),
  featured: null,
  // 🎛️ v0.71: player REMOTO da mídia do inscrito na tela — o overlay nunca
  // toca sozinho; quem dá play/pause/posição/volume é o painel
  // 🚀 v0.87: velocidade (0.05× a 32×) e distorção de voz também são remotas
  midiaPlayer: { estado: 'pausado', posicao: 0, em: Date.now(), volume: 100, velocidade: 1, semDistorcao: true },
  // 🔍 Avatar em destaque: botão direito num avatar do painel amplia a foto
  // na tela (overlay) e no próprio painel; size em vmin (10-70)
  avatarZoom: { visible: false, url: null, author: '', size: 30 },
  // 🪟 v0.79: instâncias EXTRAS do 🔍 avatar (com «várias instâncias» ligado)
  avatarZooms: [],
  recent: [],
  recentByPlatform: {}, // janela de exibição de CADA rede (a coluna dela)
  saved: loadSaved(),       // comentarios guardados para mostrar depois
  connectors: {},           // plataforma -> instancia do conector
  status: {},               // plataforma -> { state, detail, channel }
  qrs: loadQrs(),           // QR codes: o principal + adicionais
  raffle: null,             // { winners: [...], visible }
  participants: new Map(),  // chave plataforma:autor -> { author, platform, avatar, weight }
  likemeter: { enabled: false, viewers: null, likes: null, error: null, updatedAt: null },
  winstreaks: loadWinstreaks(), // winstreaks: o principal + adicionais
  audience: { visible: false, platforms: {} },  // plataforma -> { count, updatedAt }
  // 📢 Aviso na tela: texto livre (até 1000 caracteres) com formatação própria
  // ⏰ v0.80: «sumir» = o aviso sai sozinho quando o relógio bater na
  // data/hora marcada OU quando faltar no timer o tempo marcado (campos em
  // zero são padrão e não fazem nada; disparou, voltam a zero)
  // 📢 v0.128: virou lista — o principal + adicionais (cada um com texto,
  // «sumir sozinho», posição e estilo próprios)
  avisos: loadAvisos(),
  // 🕐 v0.80: relógio, cronômetro e timer INDEPENDENTES — cada um com o
  // próprio «mostrar na tela»; trocar de aba no painel não para nada
  relogio: {
    relogio: { visible: false },
    // cronômetro: conta para cima; timer: conta para baixo
    cronometro: { visible: false, rodando: false, inicio: 0, acumulado: 0 },
    timer: { visible: false, rodando: false, inicio: 0, acumulado: 0, duracao: 300000, tocouFim: 0 },
  },
  clipboard: loadClipboard(), // 📋 v0.90: HISTÓRICO da área de transferência (lista de entradas)
  connections: loadConnections(), // memoria das conexoes: plataforma -> { channel, active }
  readIds: loadRead(),      // ids de comentarios que ja foram para a tela ("lidos")
  // 🎵 Mesa de trilhas (Labs): botões de som; quem toca são as telas (overlay/
  // painel). Carregada mais abaixo (loadTrilhas depende das regras de mídia,
  // que ainda não existem neste ponto do arquivo).
  trilhas: [],
  trilhaTocando: null,      // { id, desde } — uma trilha por vez, como no fluxo real
  // 🖼️🎞️ v0.86: a tecla de mídia da Mesa que está NA TELA (painel e overlay)
  trilhaTela: null,         // { id, tipo, url, modo, escala, volume, loop } | null
  // 🎞️ v0.129: mídia direta — imagem/vídeo/áudio de uma URL ou de um arquivo
  // do computador, mostrada ao público sem passar pela biblioteca
  midiaDireta: midiaDiretaInicial(),
};

const CONNECTIONS_FILE = path.join(DATA_DIR, 'connections.json');
const READ_FILE = path.join(DATA_DIR, 'read.json');
const MAX_READ_IDS = 2000;
// Teto para os "adicionar mais...": sem isso, uma sequência de cliques (ou uma
// máquina da rede repetindo o comando) enchia a memória e o disco.
const MAX_INSTANCIAS = 30;

function loadConnections() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'connections.json'), 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    // 🔑 v0.90: o token de bot é gravado cifrado — abre aqui (texto puro de
    // versões antigas passa direto e é cifrado na próxima gravação)
    for (const conn of Object.values(raw)) {
      if (conn && typeof conn === 'object' && typeof conn.token === 'string') conn.token = abrirSegredo(conn.token);
    }
    return raw;
  } catch { return {}; }
}

// 🔒 O que os clientes veem das conexões lembradas: o CANAL e um aviso de
// que existe token guardado — o token em si nunca sai da máquina
function conexoesPublicas() {
  const pub = {};
  for (const [rede, conn] of Object.entries(state.connections || {})) {
    const { token, ...resto } = conn || {};
    pub[rede] = { ...resto, ...(token ? { temToken: true } : {}) };
  }
  return pub;
}

function persistConnections() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // 🔑 v0.90: no disco o token vai cifrado (AES-256-GCM, chave local)
    const gravavel = {};
    for (const [rede, conn] of Object.entries(state.connections || {})) {
      gravavel[rede] = conn && typeof conn === 'object' && conn.token
        ? { ...conn, token: guardarSegredo(conn.token) }
        : conn;
    }
    gravarPrivado(CONNECTIONS_FILE, JSON.stringify(gravavel, null, 2));
  } catch {}
}

function loadRead() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'read.json'), 'utf8'));
    // Formato novo: { id: horario }; formato antigo: [id, id, ...] (sem horario)
    if (Array.isArray(raw)) return new Map(raw.slice(-MAX_READ_IDS).map((id) => [String(id), null]));
    if (raw && typeof raw === 'object') return new Map(Object.entries(raw).slice(-MAX_READ_IDS));
    return new Map();
  } catch { return new Map(); }
}

function persistRead() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(READ_FILE, JSON.stringify(Object.fromEntries([...state.readIds].slice(-MAX_READ_IDS))));
  } catch {}
}

// Marca um comentario como "lido" (ja foi para a tela), com o horario
function markRead(id) {
  if (!id || state.readIds.has(id)) return;
  const at = Date.now();
  state.readIds.set(id, at);
  if (state.readIds.size > MAX_READ_IDS) {
    state.readIds = new Map([...state.readIds].slice(-MAX_READ_IDS));
  }
  persistRead();
  broadcast({ type: 'read', id, at });
}

// 📋 v0.90: a Área de transferência virou um HISTÓRICO compartilhado: cada
// texto enviado (sem limite de tamanho) e cada arquivo (qualquer tipo e
// qualquer tamanho) vira uma entrada, paginada no painel. O texto inteiro
// mora aqui (data/clipboard.json) e para as telas viaja só uma prévia — o
// completo sai por /clip-texto na hora de copiar. Arquivos moram em
// data/clipboard-arquivos/ e saem por /clip-arquivo (download puro).
// (As constantes deste bloco moram lá em cima, antes do state — veja o
// comentário delas: o state carrega o histórico na hora de nascer.)

function loadClipboard() {
  try {
    const lista = JSON.parse(fs.readFileSync(CLIPBOARD_FILE, 'utf8'));
    if (Array.isArray(lista)) {
      return lista.slice(0, CLIP_MAX_ITENS).map((e) => ({
        id: String((e && e.id) || newInstanceId('clip')).slice(0, 40),
        tipo: e && e.tipo === 'arquivo' ? 'arquivo' : 'texto',
        texto: e && typeof e.texto === 'string' ? e.texto : '',
        nome: String((e && e.nome) || '').slice(0, 140),
        // Só um NOME de arquivo (nada de caminho) aponta para o clip-arquivos
        arquivo: /^[\w][\w.\-()\[\] À-ÿ]*$/.test(String((e && e.arquivo) || '')) ? String(e.arquivo) : '',
        tamanho: Math.max(0, Number(e && e.tamanho) || 0),
        em: Number(e && e.em) || Date.now(),
      }))
        // Entrada de arquivo cujo arquivo sumiu do disco não vira link morto
        .filter((e) => e.tipo !== 'arquivo' || (e.arquivo && fs.existsSync(path.join(CLIP_DIR, e.arquivo))));
    }
  } catch (err) {
    // Arquivo que existe mas não abre é problema de verdade: avisa em vez de
    // sumir com o histórico caladinho (o silêncio escondeu o bug da v0.90.0)
    if (err.code !== 'ENOENT') console.error('Não consegui ler o histórico da área de transferência:', err.message);
  }
  // Migração v0.90: o texto único antigo (clipboard.txt) vira a 1ª entrada
  try {
    const antigo = fs.readFileSync(CLIPBOARD_TXT_ANTIGO, 'utf8');
    if (antigo.trim()) {
      return [{ id: newInstanceId('clip'), tipo: 'texto', texto: antigo, nome: '', arquivo: '', tamanho: antigo.length, em: Date.now() }];
    }
  } catch {}
  return [];
}

// 💾 v0.90.1: a válvula de segurança do disco. O histórico aceita arquivo de
// qualquer tamanho — o que ele NÃO pode é deixar a máquina sem espaço no meio
// de uma live (o OBS grava vídeo no mesmo disco). Menos que a reserva livre,
// nada novo entra. Não é um limite por arquivo: é o chão do disco.
const CLIP_RESERVA_DISCO = 512 * 1024 * 1024;   // 512 MB sempre livres
const CLIP_CHECA_DISCO_A_CADA = 64 * 1024 * 1024; // reconfere a cada 64 MB
function espacoLivreAbaixoDaReserva() {
  try {
    const st = fs.statfsSync(DATA_DIR);
    return st.bsize * st.bavail < CLIP_RESERVA_DISCO;
  } catch { return false; } // sem statfs (sistema antigo): segue como antes
}

// 🧹 v0.90.1: arquivo do histórico que ficou órfão (entrada apagada com o
// programa fechado, ou a falha da v0.90.0) some na próxima subida — senão
// ele ocupa disco para sempre sem aparecer para ninguém.
function limparOrfaosDoClipboard() {
  try {
    const vivos = new Set((state.clipboard || []).map((e) => e.arquivo).filter(Boolean));
    for (const nome of fs.readdirSync(CLIP_DIR)) {
      if (!vivos.has(nome)) { try { fs.unlinkSync(path.join(CLIP_DIR, nome)); } catch {} }
    }
  } catch { /* pasta ainda não existe: nada a limpar */ }
}

// 💾 v0.90.1: o histórico inteiro vira um arquivo só, então gravar a cada
// mensagem custa caro (200 entradas grandes = dezenas de MB por tecla). Agora
// a gravação é ASSÍNCRONA e agrupada: uma rajada de mensagens vira uma
// gravação só, e a linha principal (painel, overlay, OBS) não trava.
let clipGravaTimer = null;
function persistClipboard() {
  if (clipGravaTimer) return;
  clipGravaTimer = setTimeout(() => {
    clipGravaTimer = null;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFile(CLIPBOARD_FILE, JSON.stringify(state.clipboard), (err) => {
        if (err) console.error('Não consegui salvar o histórico da área de transferência:', err.message);
      });
    } catch {}
  }, 250);
  if (clipGravaTimer.unref) clipGravaTimer.unref();
}
// Na saída do programa (e antes de apagar tudo) a gravação pendente vai já
function persistClipboardAgora() {
  if (clipGravaTimer) { clearTimeout(clipGravaTimer); clipGravaTimer = null; }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(CLIPBOARD_FILE, JSON.stringify(state.clipboard));
  } catch {}
}

// O que as telas veem: a prévia do texto (o inteiro sai por /clip-texto) e o
// endereço de download dos arquivos
function clipboardPublico() {
  return (state.clipboard || []).map((e) => ({
    id: e.id,
    tipo: e.tipo,
    em: e.em,
    tamanho: e.tamanho,
    nome: e.nome,
    previa: e.tipo === 'texto' ? String(e.texto || '').slice(0, CLIP_PREVIA) : '',
    completo: e.tipo !== 'texto' || String(e.texto || '').length <= CLIP_PREVIA,
    url: e.tipo === 'arquivo' && e.arquivo ? '/clip-arquivo/' + encodeURIComponent(e.arquivo) : '',
  }));
}

// 🔒 v0.90.1: quem está no modo restrito COM o seletor 📋 desligado não
// recebe mais o histórico. Antes o conteúdo ia para todo mundo e só o clique
// era barrado: nomes de arquivo, horários e 1500 letras de cada texto
// apareciam para quem estava proibido de usar a ferramenta.
function podeVerClipboard(ws) {
  return !(ws && ws.role === 'viewer' && !security.permissions.clipboard);
}

function clipboardAvisar() {
  const comItens = JSON.stringify({ type: 'clipboard', itens: clipboardPublico() });
  const vazio = JSON.stringify({ type: 'clipboard', itens: [] });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(podeVerClipboard(client) ? comItens : vazio);
  }
}

function clipApagarArquivoFisico(e) {
  if (e && e.tipo === 'arquivo' && e.arquivo) {
    try { fs.unlinkSync(path.join(CLIP_DIR, path.basename(e.arquivo))); } catch {}
  }
}

function clipboardJuntar(entrada) {
  state.clipboard.unshift(entrada);
  // Rotação: as entradas mais velhas saem — e arquivo que sai do histórico
  // sai do disco junto
  for (const velha of state.clipboard.splice(CLIP_MAX_ITENS)) clipApagarArquivoFisico(velha);
  persistClipboard();
  clipboardAvisar();
}
let likemeterTimer = null;

// ---------- Winstreaks e QR codes: o principal + adicionais ----------
// O usuario pode criar quantos quiser ("adicionar mais..."); todos ficam
// salvos em disco por tempo indeterminado, cada um com posicao propria.
const WINSTREAK_FILE = path.join(DATA_DIR, 'winstreak.json');
const QRS_FILE = path.join(DATA_DIR, 'qrcodes.json');
// 🎵 Mesa de trilhas (Labs): a lista de botões de som do streamer
const TRILHAS_FILE = path.join(DATA_DIR, 'trilhas.json');
// 🎬 Conexão com o OBS (Labs): porta e senha do obs-websocket — a senha fica
// SÓ neste arquivo local; ela nunca entra em settings nem em broadcast
const OBS_FILE = path.join(DATA_DIR, 'obs.json');
// 🎛️ v0.122: endereço do vMix (Labs) — a API TCP dele não tem senha
const VMIX_FILE = path.join(DATA_DIR, 'vmix.json');
const CONTROLE_FILE = path.join(DATA_DIR, 'controle.json'); // 🕹️ v0.126: o token do controle externo
// 📢 v0.128: os avisos (o principal + adicionais), nos moldes das winstreaks
const AVISOS_FILE = path.join(DATA_DIR, 'avisos.json');

function newInstanceId(prefix) {
  return prefix + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Estilo proprio de um widget adicional (cores, tamanho, animacoes...):
// aceita so valores simples e descarta chaves perigosas.
// Regra do programa: mídia e som só podem vir das pastas do próprio OBS Social.
// Sem isso, uma máquina da rede com permissão de configurações conseguia fazer
// o painel e o overlay carregarem arquivos de um site qualquer.
function urlLocalDeArquivo(valor, pastas) {
  const v = String(valor || '').trim();
  if (!v) return '';
  if (v.includes('..') || /[\r\n]/.test(v)) return '';
  // Precisa ser um endereço decodificável (um "%" solto estourava mais tarde)
  try { decodeURIComponent(v); } catch { return ''; }
  return pastas.some((pasta) => v.startsWith(pasta)) ? v.slice(0, 500) : '';
}
// 🖼️ Toda arte do overlay é do streamer: /uploads/ é o que ele enviou.
// (v0.95: a pasta /artes/ que vinha com o programa saiu — ver a limpeza
// única mais abaixo, que apaga o que tiver sobrado apontando para lá.)
const PASTAS_MIDIA = ['/uploads/'];
const PASTAS_SOM = ['/uploads/', '/sons/'];

function numeroEntre(valor, min, max, padrao) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
}

function corHex(valor, padrao) {
  return /^#[0-9a-f]{6}$/i.test(String(valor || '')) ? String(valor) : padrao;
}

// 🖼️ v0.94 — NENHUMA peça fica presa ao tamanho do cartão padrão. Começou
// pela arte (v0.93), mas o avatar, o nome, o texto e todas as outras sofriam
// do mesmo teto: cada elemento do overlay agora se move e se redimensiona por
// conta própria, e o cartão para de recortar quando alguma delas passa dele.
// 🗺️ v0.103 — a posição é em % do cartão, e o teto de −200 %/+300 % prendia
// a peça numa faixa em volta dele: num cartão de 120 px de altura a arte não
// subia mais que 240 px, e nunca chegava ao topo da tela. A faixa agora é
// larga o bastante para qualquer peça ir a QUALQUER lugar da tela (e além).
const LIMITES_PECA = { pos: [-10000, 10000], caixa: [5, 400], escala: [25, 1000] };

// Limpa uma peça (do destaque ou de um widget): só os campos que o padrão
// daquela peça conhece, cada um dentro do próprio limite.
function limparPeca(bruta, padrao, limites = LIMITES_PECA) {
  const p = { ...padrao, ...(bruta && typeof bruta === 'object' ? bruta : {}) };
  const limpa = {};
  const [posMin, posMax] = limites.pos;
  const [caixaMin, caixaMax] = limites.caixa;
  const [escMin, escMax] = limites.escala;
  for (const campo of Object.keys(padrao)) {
    if (campo === 'mostrar') limpa.mostrar = p.mostrar !== false;
    else if (campo === 'x') limpa.x = numeroEntre(p.x, posMin, posMax, padrao.x);
    else if (campo === 'y') limpa.y = numeroEntre(p.y, posMin, posMax, padrao.y);
    else if (campo === 'escala') limpa.escala = Math.round(numeroEntre(p.escala, escMin, escMax, 100));
    // 0 = automático: a peça fica do tamanho do conteúdo dela (v0.98)
    else if (campo === 'larg') limpa.larg = Number(p.larg) === 0 ? 0 : numeroEntre(p.larg, caixaMin, caixaMax, padrao.larg);
    else if (campo === 'alt') limpa.alt = Number(p.alt) === 0 ? 0 : numeroEntre(p.alt, caixaMin, caixaMax, padrao.alt);
    else if (campo === 'ajuste') limpa.ajuste = ['encolher', 'cortar', 'vazar'].includes(p.ajuste) ? p.ajuste : 'encolher';
    else if (campo === 'rotacao') limpa.rotacao = Math.round(numeroEntre(p.rotacao, -180, 180, 0));
    else if (campo === 'opacidade') limpa.opacidade = Math.round(numeroEntre(p.opacidade, 5, 100, 100));
    else if (campo === 'cor') limpa.cor = corHex(p.cor, '');
    else if (campo === 'sombra') limpa.sombra = p.sombra === true;
    else if (campo === 'espelhar') limpa.espelhar = p.espelhar === true;
    else if (campo === 'borda') limpa.borda = Math.round(numeroEntre(p.borda, 0, 12, 0));
    else if (campo === 'bordaCor') limpa.bordaCor = corHex(p.bordaCor, '#ffffff');
    else if (campo === 'z') limpa.z = Math.round(numeroEntre(p.z, 0, 30, padrao.z));
    // ✍️ v0.109: formatação de texto da peça
    else if (campo === 'fonte') limpa.fonte = String(p.fonte || '').replace(/["'\\;{}<>]/g, '').trim().slice(0, 60);
    else if (['negrito', 'italico', 'sublinhado', 'maiusculas'].includes(campo)) limpa[campo] = ['auto', 'sim', 'nao'].includes(p[campo]) ? p[campo] : 'auto';
    else if (campo === 'alinhar') limpa.alinhar = ['auto', 'left', 'center', 'right'].includes(p.alinhar) ? p.alinhar : 'auto';
    else if (campo === 'contorno') limpa.contorno = Math.round(numeroEntre(p.contorno, 0, 8, 0) * 2) / 2;
    else if (campo === 'contornoCor') limpa.contornoCor = corHex(p.contornoCor, '#000000');
    else if (campo === 'espacamento') limpa.espacamento = Math.round(numeroEntre(p.espacamento, -5, 20, 0) * 2) / 2;
    else if (campo === 'estilo') limpa.estilo = ['pilula', 'texto'].includes(p.estilo) ? p.estilo : 'pilula';
  }
  return limpa;
}

// 🔊 v0.77: áudios dos overlays — cada widget pode ter sons de entrada,
// saída, tempo de tela e finalização. Sem teto de tamanho ou de duração de
// arquivo (pedido do streamer): saneamos só a URL (uploads/sons), o
// deslocamento (±10s), o repetir, a duração de reprodução e onde toca.
const AUDIO_OV_CHAVES = new Set(['featured', 'midia', 'qr', 'raffle', 'likemeter', 'audience', 'winstreak', 'aviso', 'relogio']);
const AUDIO_OV_MOMENTOS = ['entrada', 'saida', 'tempo', 'fim'];
function sanitizeAudiosOverlay(bruto) {
  const limpo = {};
  if (!bruto || typeof bruto !== 'object') return limpo;
  for (const [chave, conf] of Object.entries(bruto)) {
    if (!AUDIO_OV_CHAVES.has(chave) || !conf || typeof conf !== 'object') continue;
    const widget = {};
    for (const momento of AUDIO_OV_MOMENTOS) {
      const s = conf[momento];
      if (!s || typeof s !== 'object') continue;
      const url = (typeof s.url === 'string'
        && (/^\/uploads\/[^/\\]+$/.test(s.url) || /^\/sons\/[a-z0-9-]+\.[a-z0-9]{2,5}$/i.test(s.url))) ? s.url : '';
      if (!url) continue;
      widget[momento] = {
        url,
        desloc: Math.max(-10, Math.min(10, Number(s.desloc) || 0)),
        repetir: s.repetir === true,
        duracao: Math.max(0, Math.min(3600, Math.round(Number(s.duracao) || 0))),
        onde: ['ambos', 'overlay', 'painel'].includes(s.onde) ? s.onde : 'ambos',
      };
    }
    if (Object.keys(widget).length) limpo[chave] = widget;
  }
  return limpo;
}

function sanitizeStyle(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    if (['string', 'number', 'boolean'].includes(typeof value)) {
      out[key] = typeof value === 'string' ? value.slice(0, 4000) : value;
    }
  }
  return out;
}

// ---------- 🎭 Perfis de overlay (v0.54) ----------
// Cada perfil é um "molde" completo do cartão de destaque — cores,
// fontes, arte, posição e as peças — salvo com um nome. O 🎭 automático veste
// o molde certo em cada comentário destacado (comum ou por valor em reais).
// O servidor só guarda o que conhece: valores simples nas chaves do card
// Aparência, peças pela régua de sempre e mídia só das pastas do programa.
const PERFIS_FILE = path.join(DATA_DIR, 'perfis-overlay.json');
const PERFIS_MAX = 40;
const PERFIL_SNAP_CHAVES = new Set([
  'position', 'accentMode', 'accentColor', 'bgColor', 'textColor', 'bgOpacity',
  'nameColorMode', 'nameColor', // ✍️ v0.100: a cor do nome viaja no molde
  'fontFamily', 'fontSize', 'maxWidth', 'borderRadius', 'accentBarWidth',
  'paddingScale', 'scale', 'animation', 'avatarShape', 'showAvatar',
  'showPlatformIcon', 'showBadges', 'cardShadow', 'textShadow',
  'animationOut', 'animationSeconds', 'animationOutSeconds',
  'loopAnimation', 'loopSeconds', 'loopDurationSeconds', 'autoHideSeconds',
  'mediaOpacity', 'destaqueLivre', 'cardAlturaEm', 'mediaCardAjuste', 'cartaoSoArte',
  'soYouTube', 'plataforma', 'posXV', 'posYV',
  'customCSS', 'mediaUrl', 'mediaCard', 'mediaFullscreen',
  'posX', 'posY', 'mediaX', 'mediaY', 'mediaScale', 'pecas',
]);

function limparSnapPerfil(bruto) {
  const b = (bruto && typeof bruto === 'object' && !Array.isArray(bruto)) ? bruto : {};
  const limpo = {};
  for (const [chave, valor] of Object.entries(b)) {
    if (!PERFIL_SNAP_CHAVES.has(chave)) continue;
    if (chave === 'pecas') {
      // As peças passam pela mesma régua do destaque (só peças e campos conhecidos)
      const pecas = {};
      for (const [nome, padrao] of Object.entries(DEFAULT_SETTINGS.pecas)) {
        const bruta = (valor && typeof valor === 'object') ? valor[nome] : null;
        if (bruta && typeof bruta === 'object') pecas[nome] = limparPeca(bruta, padrao);
      }
      if (Object.keys(pecas).length) limpo.pecas = pecas;
      continue;
    }
    if (typeof valor === 'boolean') limpo[chave] = valor;
    else if (typeof valor === 'number' && Number.isFinite(valor)) limpo[chave] = valor;
    else if (typeof valor === 'string') limpo[chave] = valor.slice(0, 20000);
    // objeto, lista, null...: fora — um molde só guarda valores simples
  }
  for (const chave of ['mediaUrl', 'mediaCard', 'mediaFullscreen']) {
    if (chave in limpo) limpo[chave] = urlLocalDeArquivo(limpo[chave], PASTAS_MIDIA);
  }
  // As chaves que o caminho de 'settings' valida passam pela MESMA régua aqui
  // (o molde é aplicado direto nas telas, sem voltar pelo servidor — sem isto
  // ele virava um desvio permanente da sanitização)
  if ('destaqueLivre' in limpo) limpo.destaqueLivre = limpo.destaqueLivre === true;
  if ('cartaoSoArte' in limpo) limpo.cartaoSoArte = limpo.cartaoSoArte === true;
  // 📺 Rede do molde: '' = compartilhado; senão o automático só o veste em
  // comentários daquela rede. O soYouTube antigo (v0.60) vira plataforma aqui,
  // então o resto do programa só precisa conhecer a chave nova.
  if (limpo.soYouTube === true && !limpo.plataforma) limpo.plataforma = 'youtube';
  delete limpo.soYouTube;
  if ('plataforma' in limpo && !['youtube', 'twitch', 'kick', 'bilibili'].includes(limpo.plataforma)) {
    delete limpo.plataforma; // '' e qualquer coisa estranha = compartilhado
  }
  // 📱 Posição própria do molde na tela VERTICAL (9:16). Sem as duas chaves,
  // o overlay vertical auto-encaixa o molde (centrado, encostado embaixo)
  for (const chave of ['posXV', 'posYV']) {
    if (chave in limpo) {
      const v = numeroEntre(limpo[chave], -20, 120, NaN);
      if (Number.isFinite(v)) limpo[chave] = v; else delete limpo[chave];
    }
  }
  if ('cardAlturaEm' in limpo) limpo.cardAlturaEm = numeroEntre(limpo.cardAlturaEm, 2, 20, 4.6);
  if ('mediaCardAjuste' in limpo && !['cobrir', 'esticar', 'caber'].includes(limpo.mediaCardAjuste)) {
    limpo.mediaCardAjuste = 'cobrir';
  }
  return limpo;
}

function sanitizePerfis(bruta) {
  if (!Array.isArray(bruta)) return [];
  const vistos = new Set();
  const limpa = [];
  // A lista INTEIRA também tem teto: ela viaja completa em cada mensagem
  // (salvar, apagar, init...) e o WebSocket corta em 512 KB — sem esta trava,
  // 40 moldes cheios de CSS derrubariam a conexão do painel no meio da live
  let tamanhoTotal = 0;
  const TOTAL_MAX = 360 * 1024;
  for (const item of bruta) {
    if (limpa.length >= PERFIS_MAX) break;
    if (!item || typeof item !== 'object') continue;
    const nome = String(item.nome || '').replace(/[\r\n]/g, ' ').trim().slice(0, 60);
    if (!nome || vistos.has(nome.toLowerCase())) continue; // sem nome ou repetido
    const snap = limparSnapPerfil(item.snap);
    const tamanho = JSON.stringify(snap).length + nome.length + 32;
    if (tamanho > 24 * 1024) continue; // um molde grande demais: fora
    if (tamanhoTotal + tamanho > TOTAL_MAX) break; // a lista encheu: para aqui
    vistos.add(nome.toLowerCase());
    tamanhoTotal += tamanho;
    limpa.push({ nome, snap });
  }
  return limpa;
}

function loadPerfisOverlay() {
  let lista;
  try {
    lista = sanitizePerfis(JSON.parse(fs.readFileSync(PERFIS_FILE, 'utf8')));
  } catch { return []; }
  // 🖼️ v0.102: a mesma passagem única das settings — o molde que guardava a
  // arte no padrão antigo (100% × 100%, esticada no cartão) passa ao tamanho
  // real. Roda só quando as settings acabaram de migrar (primeira subida na
  // versão nova); depois disso cada molde fica exatamente como o streamer deixar.
  if (migrarArteDosPerfis) {
    let mudou = false;
    for (const p of lista) {
      const a = p && p.snap && p.snap.pecas && p.snap.pecas.arte;
      if (a && Number(a.larg) === 100 && Number(a.alt) === 100) { a.larg = 0; a.alt = 0; mudou = true; }
    }
    if (mudou) {
      try { fs.writeFileSync(PERFIS_FILE, JSON.stringify(lista, null, 2)); } catch {}
    }
  }
  return lista;
}

function persistPerfisOverlay() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PERFIS_FILE, JSON.stringify(state.perfisOverlay, null, 2));
  } catch (err) { console.error('Não consegui salvar os perfis de overlay:', err.message); }
}
// Só agora, com as réguas prontas, a lista pode entrar no state
state.perfisOverlay = loadPerfisOverlay();
// 🖼️ v0.102: a passagem da arte vai para o disco JÁ — a gravação normal só
// acontece quando algo muda, e um reinício antes disso repetia a migração
// (inofensiva, mas a marca `arteTamanhoReal` precisa ficar guardada)
if (migrarArteDosPerfis) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(state.settings, null, 2));
  } catch { /* o debounce normal grava depois */ }
  migrarArteDosPerfis = false;
}

// 🧹 v0.95: as artes de fábrica saíram do programa a pedido do streamer — ele
// já tem os arquivos dele. Some com o que ficou apontando para /artes/ nos
// moldes salvos e no visual ao vivo,
// senão sobrava um fundo quebrado na tela. Roda uma vez só.
const FABRICA_MARCA_FILE = path.join(DATA_DIR, 'perfis-fabrica.json');
{
  let marca = 0;
  try { marca = Number(JSON.parse(fs.readFileSync(FABRICA_MARCA_FILE, 'utf8')).v) || 0; } catch {}
  if (marca < 4) {
    const daFabrica = (v) => typeof v === 'string' && v.startsWith('/artes/');
    // Nos MOLDES o /artes/ já sai na leitura (ele não está mais em
    // PASTAS_MIDIA, então sanitizePerfis devolve vazio) — o que falta é
    // gravar essa versão limpa, senão a URL morta ficava no arquivo para
    // sempre. Uma gravação resolve os dois casos.
    let sujo = false;
    try {
      sujo = fs.readFileSync(PERFIS_FILE, 'utf8').includes('/artes/');
    } catch { /* sem arquivo, nada a limpar */ }
    if (sujo) persistPerfisOverlay();
    let mexeuSettings = false;
    for (const chave of ['mediaUrl', 'mediaCard', 'mediaFullscreen']) {
      if (daFabrica(state.settings[chave])) { state.settings[chave] = ''; mexeuSettings = true; }
    }
    for (const w of Object.values(state.settings.widgets || {})) {
      if (w && daFabrica(w.mediaUrl)) { w.mediaUrl = ''; mexeuSettings = true; }
    }
    if (mexeuSettings) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(state.settings, null, 2));
      } catch { /* o debounce normal grava depois */ }
    }
    try { fs.writeFileSync(FABRICA_MARCA_FILE, JSON.stringify({ v: 4 })); } catch {}
  }
}
// 💰 O valor de um Super Chat ou doação em REAIS, para as faixas do 🎭
// automático. Texto já em reais sai direto; moeda estrangeira usa a mesma
// cotação da conversão mostrada no painel. Sem moeda conhecida (ou sem
// cotação baixada ainda) = null — a faixa não chuta valor.
function valorEmReais(texto) {
  const direto = currency.parseAmount(String(texto || ''));
  if (direto && direto.currency === 'BRL') return direto.value;
  const convertido = currency.toBRL(String(texto || ''));
  if (convertido) {
    const p = currency.parseAmount(convertido);
    if (p) return p.value;
  }
  return null;
}

function defaultWinstreak() {
  return { id: newInstanceId('ws'), label: 'Solo', wins: 0, record: 0, visible: false, x: null, y: null, style: {} };
}

function loadWinstreaks() {
  try {
    // Caminho direto: esta funcao roda na criacao do state, antes das constantes
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'winstreak.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : [raw]; // formato antigo: um so objeto
    const out = list.filter((w) => w && typeof w === 'object').map((w) => ({
      id: String(w.id || newInstanceId('ws')),
      label: String(w.label || 'Solo').slice(0, 30),
      wins: Math.max(0, Number(w.wins) || 0),
      record: Math.max(0, Number(w.record) || 0),
      visible: !!w.visible,
      x: Number.isFinite(Number(w.x)) && w.x !== null ? Number(w.x) : null,
      y: Number.isFinite(Number(w.y)) && w.y !== null ? Number(w.y) : null,
      style: sanitizeStyle(w.style),
    }));
    return out.length ? out : [defaultWinstreak()];
  } catch {
    return [defaultWinstreak()];
  }
}

function persistWinstreaks() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(WINSTREAK_FILE, JSON.stringify(state.winstreaks, null, 2));
  } catch (err) {
    console.error('Não consegui salvar o winstreak:', err.message);
  }
}

function findWinstreak(id) {
  return state.winstreaks.find((w) => w.id === id) || state.winstreaks[0];
}

function updateWinstreak(id, patch) {
  const inst = findWinstreak(id);
  if (!inst) return;
  Object.assign(inst, patch);
  // O recorde acompanha as vitórias automaticamente.
  if (inst.wins > inst.record) inst.record = inst.wins;
  persistWinstreaks();
  broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
}

// ---------- 📢 v0.128: Avisos — o principal + adicionais ----------
// Cada aviso tem texto, «sumir sozinho», posição e estilo próprios; o
// primeiro da lista é o principal (nunca sai). O arquivo antigo (um só
// objeto) vira a lista com um item.
function defaultAviso() {
  return { id: newInstanceId('av'), label: 'Aviso', texto: '', visible: false, sumir: sumirPadrao(), x: null, y: null, style: {} };
}

function sanitizeSumir(s) {
  const num = (v, max) => Math.max(0, Math.min(max, Math.round(Number(v) || 0)));
  const rel = (s && s.relogio) || {};
  const tim = (s && s.timer) || {};
  return {
    relogio: { dia: num(rel.dia, 31), mes: num(rel.mes, 12), ano: num(rel.ano, 9999), hora: num(rel.hora, 23), min: num(rel.min, 59), seg: num(rel.seg, 59) },
    timer: { dias: num(tim.dias, 999), horas: num(tim.horas, 23), min: num(tim.min, 59), seg: num(tim.seg, 59) },
  };
}

function loadAvisos() {
  try {
    // Caminho direto: roda na criação do state, antes das constantes
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'avisos.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : [raw];
    const out = list.filter((a) => a && typeof a === 'object').map((a) => ({
      id: String(a.id || newInstanceId('av')),
      label: String(a.label || 'Aviso').slice(0, 30),
      texto: String(a.texto || '').slice(0, 1000),
      visible: !!a.visible,
      sumir: sanitizeSumir(a.sumir),
      x: Number.isFinite(Number(a.x)) && a.x !== null ? Number(a.x) : null,
      y: Number.isFinite(Number(a.y)) && a.y !== null ? Number(a.y) : null,
      vx: Number.isFinite(Number(a.vx)) && a.vx !== null && a.vx !== undefined ? Number(a.vx) : undefined,
      vy: Number.isFinite(Number(a.vy)) && a.vy !== null && a.vy !== undefined ? Number(a.vy) : undefined,
      style: sanitizeStyle(a.style),
    })).slice(0, 30); // = MAX_INSTANCIAS (declarada depois do state)
    return out.length ? out : [defaultAviso()];
  } catch {
    return [defaultAviso()];
  }
}

function persistAvisos() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(AVISOS_FILE, JSON.stringify(state.avisos, null, 2));
  } catch (err) {
    console.error('Não consegui salvar os avisos:', err.message);
  }
}

// Sem id (ou id desconhecido) = o aviso principal — assim o controle externo
// e os clientes antigos continuam funcionando como antes
function findAviso(id) {
  return (id && state.avisos.find((a) => a.id === id)) || state.avisos[0];
}

function broadcastAvisos() {
  broadcast({ type: 'aviso', avisos: state.avisos, aviso: state.avisos[0] });
}

function updateAviso(id, patch) {
  const inst = findAviso(id);
  if (!inst) return;
  Object.assign(inst, patch);
  persistAvisos();
  broadcastAvisos();
}

// 🕐 v0.80: estado dos três instrumentos como o painel/overlay precisam ver:
// o tempo já somado até agora (o cliente segue contando entre as mensagens).
function relogioPublico() {
  const r = state.relogio;
  const corridoCron = r.cronometro.acumulado + (r.cronometro.rodando ? Date.now() - r.cronometro.inicio : 0);
  const corridoTim = r.timer.acumulado + (r.timer.rodando ? Date.now() - r.timer.inicio : 0);
  return {
    relogio: { visible: r.relogio.visible },
    cronometro: { visible: r.cronometro.visible, rodando: r.cronometro.rodando, corrido: corridoCron },
    timer: {
      visible: r.timer.visible,
      rodando: r.timer.rodando,
      duracao: r.timer.duracao,
      restante: Math.max(0, r.timer.duracao - corridoTim), // quanto falta (nunca negativo)
      tocouFim: r.timer.tocouFim || 0, // quando zerou (para a piscada parar na hora certa)
    },
    agora: Date.now(), // referência para o cliente acertar o relógio dele
  };
}

// ⏰ v0.80: campos do «sumir sozinho» do Aviso — tudo em zero é o padrão e
// não faz nada; um campo preenchido vira condição de saída.
function sumirPadrao() {
  return {
    relogio: { dia: 0, mes: 0, ano: 0, hora: 0, min: 0, seg: 0 },
    timer: { dias: 0, horas: 0, min: 0, seg: 0 },
  };
}
// A data/hora de AGORA no fuso escolhido nas configurações do relógio
function partesAgoraNoFuso() {
  const fuso = state.settings.relogio?.fuso;
  const tz = (fuso && fuso !== 'auto') ? fuso : undefined;
  try {
    const partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date());
    const g = {};
    for (const p of partes) g[p.type] = p.value;
    return { dia: +g.day, mes: +g.month, ano: +g.year, hora: +g.hour, min: +g.minute, seg: +g.second };
  } catch {
    const d = new Date();
    return { dia: d.getDate(), mes: d.getMonth() + 1, ano: d.getFullYear(), hora: d.getHours(), min: d.getMinutes(), seg: d.getSeconds() };
  }
}
function msDoSumirTimer(t) {
  if (!t) return 0;
  return ((Number(t.dias) || 0) * 86400 + (Number(t.horas) || 0) * 3600
    + (Number(t.min) || 0) * 60 + (Number(t.seg) || 0)) * 1000;
}
// O Aviso sai sozinho quando o relógio BATE com os campos preenchidos
// (os zerados são curinga) ou quando falta no timer o tempo marcado.
// Disparou: os campos voltam a zero, para não derrubar o próximo aviso.
function vigiarSumirDoAviso() {
  let algum = false;
  // v0.128: cada aviso (principal e adicionais) tem o seu próprio «sumir»
  for (const a of state.avisos) {
    if (!a.visible || !a.sumir) continue;
    let sumiu = false;
    const alvoRel = a.sumir.relogio || {};
    if (Object.values(alvoRel).some((v) => v > 0)) {
      const agora = partesAgoraNoFuso();
      const bate = Object.entries(alvoRel).every(([campo, v]) => !(v > 0) || agora[campo] === v);
      if (bate) { a.sumir.relogio = sumirPadrao().relogio; sumiu = true; }
    }
    const alvoMs = msDoSumirTimer(a.sumir.timer);
    if (!sumiu && alvoMs > 0) {
      const t = state.relogio.timer;
      const corrido = t.acumulado + (t.rodando ? Date.now() - t.inicio : 0);
      // só com o timer em andamento (ou já zerado) — parado não derruba nada
      if ((t.rodando || t.tocouFim) && Math.max(0, t.duracao - corrido) <= alvoMs) {
        a.sumir.timer = sumirPadrao().timer;
        sumiu = true;
      }
    }
    if (sumiu) { a.visible = false; algum = true; }
  }
  if (algum) { persistAvisos(); broadcastAvisos(); }
}

// Vigia do timer: quando zera, avisa todo mundo (o som toca no painel) e,
// se estiver combinado, tira o aviso da tela junto. v0.80: o mesmo vigia
// cuida do «sumir sozinho» do Aviso (pelo relógio e pelo timer).
let timerFimTimer = null;
function vigiarTimer() {
  vigiarSumirDoAviso();
  const t = state.relogio.timer;
  if (!t.rodando) return;
  const corrido = t.acumulado + (Date.now() - t.inicio);
  if (corrido < t.duracao) return;
  t.rodando = false;
  t.acumulado = t.duracao;
  t.tocouFim = Date.now();
  const conf = state.settings.relogio || {};
  if (conf.tirarAvisoNoFim && state.avisos.some((a) => a.visible)) {
    for (const a of state.avisos) a.visible = false;
    persistAvisos();
    broadcastAvisos();
  }
  broadcast({ type: 'relogio', relogio: relogioPublico(), fim: true });
}
timerFimTimer = setInterval(vigiarTimer, 250);
if (timerFimTimer.unref) timerFimTimer.unref();

function emptyQr() {
  return { id: newInstanceId('qr'), name: '', url: '', matrix: null, visible: false, x: null, y: null, style: {} };
}

function loadQrs() {
  try {
    // Caminho direto: esta funcao roda na criacao do state, antes das constantes
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'qrcodes.json'), 'utf8'));
    const list = Array.isArray(raw) ? raw : [];
    const out = list.filter((q) => q && typeof q === 'object').map((q) => ({
      id: String(q.id || newInstanceId('qr')),
      name: String(q.name || '').slice(0, 60),
      url: String(q.url || '').slice(0, 1000),
      matrix: null,
      visible: !!q.visible,
      x: Number.isFinite(Number(q.x)) && q.x !== null ? Number(q.x) : null,
      y: Number.isFinite(Number(q.y)) && q.y !== null ? Number(q.y) : null,
      style: sanitizeStyle(q.style),
    }));
    for (const q of out) {
      if (q.url) { try { q.matrix = makeQrMatrix(q.url); } catch {} }
      if (!q.matrix) q.visible = false;
    }
    return out.length ? out : [emptyQr()];
  } catch {
    return [emptyQr()];
  }
}

function persistQrs() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // A matriz e recalculada na carga; nao precisa ir para o disco
    fs.writeFileSync(QRS_FILE, JSON.stringify(state.qrs.map(({ matrix, ...rest }) => rest), null, 2));
  } catch (err) {
    console.error('Não consegui salvar os QR codes:', err.message);
  }
}

function findQr(id) {
  return state.qrs.find((q) => q.id === id) || state.qrs[0];
}

// ---------- Tempo de tela dos widgets ----------
// Cada widget pode sair sozinho depois de N segundos (0 = fica para sempre).
const hideTimers = new Map();
function scheduleWidgetHide(kind, instanceId, hideFn) {
  const secs = Math.max(0, Math.min(3600, Number(state.settings.widgets?.[kind]?.screenSeconds) || 0));
  const key = kind + ':' + (instanceId || '');
  clearTimeout(hideTimers.get(key));
  hideTimers.delete(key);
  if (!secs) return;
  const timer = setTimeout(() => { hideTimers.delete(key); hideFn(); }, secs * 1000);
  if (timer.unref) timer.unref();
  hideTimers.set(key, timer);
}

function broadcastQrs() {
  persistQrs();
  broadcast({ type: 'qr', qrs: state.qrs });
}

function loadSaved() {
  try {
    const raw = JSON.parse(fs.readFileSync(SAVED_FILE, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persistSaved() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SAVED_FILE, JSON.stringify(state.saved, null, 2));
  } catch (err) {
    console.error('Não consegui salvar os comentários guardados:', err.message);
  }
}

function loadSettings() {
  try {
    return mergeSettings(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
  } catch {
    return mergeSettings(null);
  }
}

// A gravação é ADIADA (800ms): um arrasto no editor manda dezenas de mudanças
// por segundo e gravava o arquivo inteiro a cada uma, travando o event loop no
// meio do chat. A live não espera o disco — o broadcast continua imediato.
let saveSettingsTimer = null;
function saveSettings() {
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = setTimeout(saveSettingsAgora, 800);
}
function saveSettingsAgora() {
  clearTimeout(saveSettingsTimer);
  saveSettingsTimer = null;
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(state.settings, null, 2));
  } catch (err) {
    console.error('Não consegui salvar as configurações:', err.message);
  }
}
// Fechando o programa (Ctrl+C / kill), o que estiver pendente é gravado antes
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    if (saveSettingsTimer) saveSettingsAgora();
    process.exit(0);
  });
}

// ---------------------------------------------------------------------------
// Servidor HTTP (arquivos do painel e do overlay)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.ogv': 'video/ogg',
  '.mov': 'video/quicktime',
  '.m4v': 'video/x-m4v',
  // 🧰 v0.88 (auditoria): .avi/.mkv eram aceitos no upload mas ficavam SEM
  // tipo — com o nosniff o navegador recusava tocar; agora têm MIME certo
  '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska',
  '.jfif': 'image/jpeg',
  '.apng': 'image/apng',
  // 🎬 v0.101: os formatos que faltavam. Nem todos tocam no navegador (e o
  // OBS usa um navegador por dentro), mas o programa passa a ACEITAR e a
  // avisar quando o arquivo não abre — melhor que recusar sem explicação.
  '.mpeg': 'video/mpeg',
  '.mpg': 'video/mpeg',
  '.mpe': 'video/mpeg',
  '.vob': 'video/mpeg',
  '.wmv': 'video/x-ms-wmv',
  '.asf': 'video/x-ms-asf',
  '.flv': 'video/x-flv',
  '.f4v': 'video/x-f4v',
  '.3gp': 'video/3gpp',
  '.3g2': 'video/3gpp2',
  '.ts': 'video/mp2t',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.jxl': 'image/jxl',
  '.jpe': 'image/jpeg',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.wma': 'audio/x-ms-wma',
  '.amr': 'audio/amr',
  '.mka': 'audio/x-matroska',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.oga': 'audio/ogg',
  '.weba': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.opus': 'audio/opus',
};

const VIDEO_EXTS = new Set([
  '.mp4', '.webm', '.ogg', '.ogv', '.mov', '.m4v', '.avi', '.mkv',
  '.mpeg', '.mpg', '.mpe', '.vob', '.wmv', '.asf', '.flv', '.f4v',
  '.3gp', '.3g2', '.ts', '.mts', '.m2ts',
]);
const SOM_EXTS = new Set([
  '.mp3', '.wav', '.oga', '.weba', '.m4a', '.aac', '.flac', '.opus',
  '.aif', '.aiff', '.wma', '.amr', '.mka',
]);

// .ogg/.webm ficam como vídeo (ambíguos); o resto dos áudios (trilhas da Mesa,
// sons de widgets) não pode aparecer como "imagem" na lista de artes
function tipoDeMidia(ext) {
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (SOM_EXTS.has(ext)) return 'audio';
  return 'image';
}

// ---------------------------------------------------------------------------
// Overlays proprios (imagens e videos enviados pelo usuario)

// 📚 v0.88: a Mesa de Trilhas tem a PRÓPRIA biblioteca — os arquivos dela
// moram em uploads/trilhas/ e não se misturam com os dos overlays
const TRILHAS_UP_DIR = path.join(UPLOADS_DIR, 'trilhas');
function listMedia() {
  const lerPasta = (dir, prefixo) => {
    try {
      return fs.readdirSync(dir)
        .filter((name) => !name.startsWith('.'))
        .map((name) => {
          const stat = fs.statSync(path.join(dir, name));
          if (!stat.isFile()) return null;
          return {
            name: prefixo + name, // 'trilhas/…' marca a biblioteca da Mesa
            url: '/uploads/' + (prefixo ? 'trilhas/' : '') + encodeURIComponent(name),
            type: tipoDeMidia(path.extname(name).toLowerCase()),
            size: stat.size,
            mtime: stat.mtimeMs,
          };
        })
        .filter(Boolean);
    } catch { return []; }
  };
  return [...lerPasta(UPLOADS_DIR, ''), ...lerPasta(TRILHAS_UP_DIR, 'trilhas/')]
    .sort((a, b) => b.mtime - a.mtime);
}

// Só entram os tipos que o programa usa de verdade (imagem, vídeo e áudio).
// Antes qualquer extensão passava — inclusive .html, que virava uma página
// servida pelo próprio endereço do painel.
// 🎬 v0.101: a lista era curta demais — uma arte em vídeo comum (.mpeg, .wmv,
// .3gp, .ts...) batia na porta e voltava com "tipo não aceito", sem dizer
// quais servem. Agora entra todo formato de mídia de verdade; quem avisa se o
// arquivo não ABRE no navegador (que é o que o OBS usa por dentro) é o editor,
// depois do envio, com o nome do arquivo na mão.
const EXT_UPLOAD_OK = new Set([
  // imagens
  '.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.webp', '.avif', '.bmp', '.ico', '.apng',
  '.svg', '.tif', '.tiff', '.heic', '.heif', '.jxl',
  // vídeos
  '.mp4', '.webm', '.ogv', '.mov', '.m4v', '.avi', '.mkv',
  '.mpeg', '.mpg', '.mpe', '.vob', '.wmv', '.asf', '.flv', '.f4v',
  '.3gp', '.3g2', '.ts', '.mts', '.m2ts',
  // áudios
  '.mp3', '.wav', '.ogg', '.oga', '.weba', '.m4a', '.aac', '.flac', '.opus',
  '.aif', '.aiff', '.wma', '.amr', '.mka',
]);

function handleUpload(req, res) {
  const query = new URLSearchParams((req.url || '').split('?')[1] || '');
  const rawName = query.get('name') || 'arquivo';
  const safeName = path.basename(rawName).replace(/[^\w.\-()\[\] À-ÿ]+/g, '_').slice(-80) || 'arquivo';
  if (!EXT_UPLOAD_OK.has(path.extname(safeName).toLowerCase())) {
    res.writeHead(415, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: 'Tipo de arquivo não aceito: só entram imagem, vídeo e áudio'
        + ' (por exemplo PNG, JPG, GIF, WEBP, SVG, MP4, WEBM, MOV, MKV, AVI, MP3 e WAV).',
    }));
    req.resume();
    return;
  }
  const finalName = Date.now().toString(36) + '-' + safeName;
  // 📚 v0.88: ?pasta=trilhas manda o arquivo para a biblioteca da Mesa
  const daMesa = query.get('pasta') === 'trilhas';
  const dirDestino = daMesa ? TRILHAS_UP_DIR : UPLOADS_DIR;
  fs.mkdirSync(dirDestino, { recursive: true });
  const destPath = path.join(dirDestino, finalName);
  const dest = fs.createWriteStream(destPath);
  let size = 0;
  let aborted = false;

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_UPLOAD_BYTES && !aborted) {
      aborted = true;
      dest.destroy();
      fs.unlink(destPath, () => {});
      res.writeHead(413, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Arquivo grande demais (limite: 300 MB).' }));
      req.destroy();
    }
  });
  req.pipe(dest);
  dest.on('finish', () => {
    if (aborted) return;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    // 📚 v0.88: a URL devolvida carrega a biblioteca certa (trilhas/ ou geral)
    res.end(JSON.stringify({
      ok: true,
      name: (daMesa ? 'trilhas/' : '') + finalName,
      url: '/uploads/' + (daMesa ? 'trilhas/' : '') + encodeURIComponent(finalName),
    }));
    broadcast({ type: 'media', media: listMedia() });
  });
  dest.on('error', () => {
    if (aborted) return;
    fs.unlink(destPath, () => {});
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Falha ao gravar o arquivo.' }));
  });
}

// Doacao vinda de fora pela URL generica (/doacao) — e do 💠 Pix (Labs):
// os dois entram pelo MESMO cano e caem na aba Apoios do painel.
function emitDonation({ name, amountText, message, platform = 'doacao', rotulo = 'doação' }) {
  onChatMessage({
    platform,
    channel: platform,
    id: `don-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    author: String(name || 'Anônimo').slice(0, 60),
    authorColor: null,
    avatar: null,
    badges: [amountText ? `${rotulo} ${amountText}` : rotulo],
    superchat: { amount: amountText || '', color: '#32bcad', headerColor: '#32bcad', textColor: '#000000' },
    runs: [{ type: 'text', text: String(message || '').slice(0, 500) }],
    timestamp: Date.now(),
  });
}

function formatDonationValue(raw) {
  if (!raw) return '';
  const value = String(raw).trim();
  const numeric = Number(value.replace(',', '.'));
  if (Number.isFinite(numeric)) return 'R$ ' + numeric.toFixed(2).replace('.', ',');
  return value.slice(0, 20);
}

// ---------- 💠 Pix direto do banco (Labs v0.63, experimental) ----------
// Fase 1 do estudo: o programa consulta a API Pix DO BANCO DO STREAMER
// (especificação do Banco Central que todo banco implementa) de tempos em
// tempos e transforma cada Pix recebido num apoio 💝 do painel — com a
// mensagem que o pagador escreveu no app do banco (campo infoPagador).
// Sem intermediário e sem taxa de plataforma: OAuth2 + certificado (mTLS)
// direto contra o banco. Perfis prontos: Inter (PJ/MEI) e Sicoob (PF/PJ);
// o modo personalizado aceita qualquer banco que siga a especificação.
const PIX_FILE = path.join(DATA_DIR, 'pix-config.json');
const PIX_VISTOS_FILE = path.join(DATA_DIR, 'pix-vistos.json');
const PIX_BANCOS = {
  inter: {
    nome: 'Banco Inter',
    urlToken: 'https://cdpj.partners.bancointer.com.br/oauth/v2/token',
    urlPix: 'https://cdpj.partners.bancointer.com.br/pix/v2/pix',
    escopo: 'pix.read',
  },
  sicoob: {
    nome: 'Sicoob',
    urlToken: 'https://auth.sicoob.com.br/auth/realms/cooperado/protocol/openid-connect/token',
    urlPix: 'https://api.sicoob.com.br/pix/api/v2/pix',
    escopo: 'pix.read',
  },
  personalizado: { nome: 'Personalizado', urlToken: '', urlPix: '', escopo: 'pix.read' },
};

function limparPixConfig(raw) {
  const b = (raw && typeof raw === 'object') ? raw : {};
  const texto = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  return {
    banco: ['inter', 'sicoob', 'personalizado'].includes(b.banco) ? b.banco : 'inter',
    clientId: texto(b.clientId, 200),
    clientSecret: texto(b.clientSecret, 200),
    certArquivo: texto(b.certArquivo, 500),   // .crt/.pem ou .pfx/.p12
    chaveArquivo: texto(b.chaveArquivo, 500), // .key (quando separada do .crt)
    certSenha: texto(b.certSenha, 200),       // senha do .pfx, se tiver
    urlToken: texto(b.urlToken, 500),         // só no modo personalizado
    urlPix: texto(b.urlPix, 500),
    escopo: texto(b.escopo, 120) || 'pix.read',
    intervalo: Math.round(numeroEntre(b.intervalo, 5, 120, 10)),
  };
}
function loadPixConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(PIX_FILE, 'utf8'));
    // 🔑 v0.90: os segredos vêm cifrados do disco — abre ANTES da limpeza
    // (o blob cifrado é maior que o teto de 200 letras do campo)
    if (raw && typeof raw === 'object') {
      raw.clientSecret = abrirSegredo(raw.clientSecret);
      raw.certSenha = abrirSegredo(raw.certSenha);
    }
    return limparPixConfig(raw);
  } catch { return limparPixConfig(null); }
}
const pixConfig = loadPixConfig();
function savePixConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    gravarPrivado(PIX_FILE, JSON.stringify({
      ...pixConfig,
      clientSecret: guardarSegredo(pixConfig.clientSecret),
      certSenha: guardarSegredo(pixConfig.certSenha),
    }, null, 2));
  } catch (err) { console.error('Não consegui salvar a configuração do Pix:', err.message); }
}
// Pix já mostrados (endToEndId): sobrevivem ao reiniciar para não repetir
// apoio na tela — e para os recebidos com o programa fechado entrarem depois
function loadPixVistos() {
  try {
    const lista = JSON.parse(fs.readFileSync(PIX_VISTOS_FILE, 'utf8'));
    return new Set(Array.isArray(lista) ? lista.slice(-1000).map(String) : []);
  } catch { return new Set(); }
}
function savePixVistos() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(PIX_VISTOS_FILE, JSON.stringify([...pixRt.vistos].slice(-1000)));
  } catch { /* o proximo tick tenta de novo */ }
}

// Estado vivo do conector (o que as telas veem — sem nenhum segredo)
const pixRt = {
  estado: 'desligado',  // desligado | conectando | ok | erro
  detalhe: '',
  vistos: loadPixVistos(),
  primeira: true,       // 1ª consulta boa só MARCA o que já existia (não inunda o painel)
  timer: null,
  token: null,
  tokenExpira: 0,
  agent: null,
};
function pixResumo(ws) {
  // 🔒 v0.127.1: os dados de cadastro (clientId, caminhos dos certificados,
  // endereços do banco) só para o computador do streamer; a rede vê só
  // se está ligado e o estado
  const completo = !ws || ws.role === 'local';
  return {
    ligado: state.settings.labs?.pix === true,
    estado: pixRt.estado,
    detalhe: pixRt.detalhe,
    banco: pixConfig.banco,
    ...(completo ? {
      clientId: pixConfig.clientId,
      certArquivo: pixConfig.certArquivo,
      chaveArquivo: pixConfig.chaveArquivo,
      urlToken: pixConfig.urlToken,
      urlPix: pixConfig.urlPix,
      escopo: pixConfig.escopo,
      intervalo: pixConfig.intervalo,
      temSegredo: !!pixConfig.clientSecret,
      temSenhaCert: !!pixConfig.certSenha,
    } : {}),
  };
}
function broadcastPix() {
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'pix', pix: pixResumo(client) }));
  }
}
function pixStatus(estado, detalhe) {
  if (pixRt.estado === estado && pixRt.detalhe === (detalhe || '')) return;
  pixRt.estado = estado;
  pixRt.detalhe = detalhe || '';
  broadcastPix();
}
function pixUrls() {
  const perfil = PIX_BANCOS[pixConfig.banco] || PIX_BANCOS.personalizado;
  return {
    urlToken: pixConfig.banco === 'personalizado' ? pixConfig.urlToken : perfil.urlToken,
    urlPix: pixConfig.banco === 'personalizado' ? pixConfig.urlPix : perfil.urlPix,
    escopo: pixConfig.escopo || perfil.escopo,
  };
}
// Certificado do banco (mTLS): .crt+.key em PEM ou .pfx com senha
function pixAgentNovo() {
  if (!pixConfig.certArquivo) return null;
  const opts = { keepAlive: true };
  if (/\.(pfx|p12)$/i.test(pixConfig.certArquivo)) {
    opts.pfx = fs.readFileSync(pixConfig.certArquivo);
    if (pixConfig.certSenha) opts.passphrase = pixConfig.certSenha;
  } else {
    opts.cert = fs.readFileSync(pixConfig.certArquivo);
    opts.key = fs.readFileSync(pixConfig.chaveArquivo || pixConfig.certArquivo);
  }
  return new https.Agent(opts);
}
// Requisição crua (https ou http — http só serve para testar contra um
// banco de mentira na própria máquina; banco de verdade é sempre https)
function pixRequest(urlTexto, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlTexto); } catch { reject(new Error('endereço inválido: ' + urlTexto)); return; }
    const mod = u.protocol === 'http:' ? http : https;
    const opcoes = { method, headers, timeout: 15000 };
    if (u.protocol === 'https:' && pixRt.agent) opcoes.agent = pixRt.agent;
    const req = mod.request(u, opcoes, (res) => {
      let dados = '';
      res.on('data', (c) => { if (dados.length < 2 * 1024 * 1024) dados += c; });
      res.on('end', () => resolve({ status: res.statusCode, corpo: dados }));
    });
    req.on('timeout', () => { req.destroy(new Error('o banco demorou demais para responder')); });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}
async function pixToken() {
  if (pixRt.token && Date.now() < pixRt.tokenExpira - 30000) return pixRt.token;
  const { urlToken, escopo } = pixUrls();
  const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: pixConfig.clientId, scope: escopo });
  if (pixConfig.clientSecret) form.set('client_secret', pixConfig.clientSecret);
  const r = await pixRequest(urlToken, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  if (r.status !== 200) throw new Error(`o banco recusou as credenciais (HTTP ${r.status})`);
  const json = JSON.parse(r.corpo);
  if (!json.access_token) throw new Error('o banco não devolveu o token de acesso');
  pixRt.token = json.access_token;
  pixRt.tokenExpira = Date.now() + Math.max(60, Number(json.expires_in) || 300) * 1000;
  return pixRt.token;
}
async function pixConsultar() {
  const token = await pixToken();
  const { urlPix } = pixUrls();
  const fim = new Date();
  const inicio = new Date(fim.getTime() - 40 * 60 * 1000); // janela de 40 min
  const sep = urlPix.includes('?') ? '&' : '?';
  const url = `${urlPix}${sep}inicio=${encodeURIComponent(inicio.toISOString())}&fim=${encodeURIComponent(fim.toISOString())}&paginacao.itensPorPagina=100`;
  const r = await pixRequest(url, {
    headers: { Authorization: `Bearer ${token}`, client_id: pixConfig.clientId, Accept: 'application/json' },
  });
  if (r.status === 401 || r.status === 403) { pixRt.token = null; throw new Error(`o banco recusou o acesso (HTTP ${r.status})`); }
  if (r.status !== 200) throw new Error(`consulta de Pix falhou (HTTP ${r.status})`);
  const json = JSON.parse(r.corpo);
  return Array.isArray(json.pix) ? json.pix : [];
}
async function pixTick() {
  try {
    const lista = await pixConsultar();
    let novos = 0;
    for (const item of lista) {
      const id = String(item?.endToEndId || '').slice(0, 64);
      if (!id || pixRt.vistos.has(id)) continue;
      pixRt.vistos.add(id);
      if (pixRt.primeira) continue; // o que já existia antes de ligar não vira apoio
      novos += 1;
      const nome = String(item?.pagador?.nome || item?.devedor?.nome || '').trim().slice(0, 60);
      emitDonation({
        name: nome || 'Apoiador Pix',
        amountText: formatDonationValue(item?.valor),
        message: String(item?.infoPagador || '').slice(0, 500),
        rotulo: 'Pix',
      });
    }
    pixRt.primeira = false;
    if (novos || pixRt.vistos.size) savePixVistos();
    pixStatus('ok', '');
  } catch (err) {
    pixStatus('erro', String(err && err.message || err).slice(0, 200));
  }
}
// ---------- 📎 Mídia dos inscritos (Telegram/WhatsApp) — quarentena local ----------
// O que os inscritos mandam (foto, áudio, vídeo, documento) fica numa pasta
// própria dentro de data/ — FORA do public/ — com teto de espaço. O painel
// mostra a prévia; a tela só vê quando o apresentador manda de propósito.
const MIDIA_INSCRITOS_DIR = path.join(DATA_DIR, 'midia-inscritos');
const MIDIA_INSCRITOS_TETO = 500 * 1024 * 1024; // 500 MB; acima disso, os antigos saem
const MIDIA_EXT_OK = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'mp4', 'webm', 'mov',
  'ogg', 'oga', 'opus', 'mp3', 'm4a', 'wav', 'pdf', 'txt', 'bin',
  'tgs']); // 🌀 v0.74: figurinha animada do Telegram (Lottie compactado)
function salvarMidiaInscrito(buffer, ext, nomeOriginal) {
  try {
    if (!Buffer.isBuffer(buffer) || !buffer.length) return null;
    const extLimpa = MIDIA_EXT_OK.has(String(ext || '').toLowerCase()) ? String(ext).toLowerCase() : 'bin';
    fs.mkdirSync(MIDIA_INSCRITOS_DIR, { recursive: true });
    // Faxina pelo teto: os mais antigos saem primeiro
    try {
      const arquivos = fs.readdirSync(MIDIA_INSCRITOS_DIR)
        .map((n) => { const st = fs.statSync(path.join(MIDIA_INSCRITOS_DIR, n)); return { n, mtime: st.mtimeMs, tam: st.size }; })
        .sort((a, b) => a.mtime - b.mtime);
      let total = arquivos.reduce((s, a) => s + a.tam, 0) + buffer.length;
      for (const a of arquivos) {
        if (total <= MIDIA_INSCRITOS_TETO) break;
        fs.unlinkSync(path.join(MIDIA_INSCRITOS_DIR, a.n));
        total -= a.tam;
      }
    } catch { /* faxina é melhor esforço */ }
    const nome = `${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}.${extLimpa}`;
    fs.writeFileSync(path.join(MIDIA_INSCRITOS_DIR, nome), buffer);
    return '/midia-inscritos/' + nome;
  } catch (err) {
    console.error('Não consegui guardar a mídia do inscrito:', err.message);
    return null;
  }
}
const MIDIA_MIME = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg', mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav',
  pdf: 'application/pdf', txt: 'text/plain; charset=utf-8',
  tgs: 'application/octet-stream',
};

// 📎 v0.75: tipo do anexo da RESPOSTA pela extensão — decide o método certo
// de envio em cada rede (foto, áudio, vídeo ou documento)
function tipoDeAnexoResposta(ext) {
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'imagem';
  if (['mp3', 'ogg', 'oga', 'opus', 'm4a', 'wav'].includes(ext)) return 'audio';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'video';
  return 'arquivo';
}

// ---------- 🎙️ Transcrição local (Labs) ----------
// Cada áudio/vídeo que um inscrito manda vira um rascunho de texto no cartão
// do painel — transcrito NA MÁQUINA do streamer (whisper.cpp), com motor e
// modelos baixados sob demanda. O resultado fica guardado em disco para
// sobreviver a reinício do programa.
const { Transcritor, MODELOS: MODELOS_TRANSCRICAO } = require('./transcricao');
const TRANSCRICOES_FILE = path.join(DATA_DIR, 'transcricoes.json');
let transcricoes = {};
try {
  const t = JSON.parse(fs.readFileSync(TRANSCRICOES_FILE, 'utf8'));
  if (t && typeof t === 'object' && !Array.isArray(t)) transcricoes = t;
} catch { /* primeira vez */ }
function salvarTranscricoes() {
  try {
    // só as mais novas ficam (as mídias antigas também saem pelo teto da pasta)
    const entradas = Object.entries(transcricoes)
      .sort((a, b) => (b[1].em || 0) - (a[1].em || 0)).slice(0, 300);
    transcricoes = Object.fromEntries(entradas);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRANSCRICOES_FILE, JSON.stringify(transcricoes));
  } catch (err) { console.error('Não consegui guardar as transcrições:', err.message); }
}
const transcritor = new Transcritor({
  dirModelos: path.join(DATA_DIR, 'modelos-transcricao'),
  dirMotor: path.join(DATA_DIR, 'motor-transcricao'),
  dirTmp: path.join(DATA_DIR, 'tmp'),
  // Ganchos de teste: apontam os downloads para um servidor local de mentira
  baseModelos: process.env.OBS_TESTE_MODELOS_BASE || undefined,
  urlMotor: process.env.OBS_TESTE_MOTOR_URL || undefined,
  urlFfmpeg: process.env.OBS_TESTE_FFMPEG_URL || undefined,
  aoEvento: (ev) => {
    if (ev.type === 'transcricao') {
      const { type, url, ...resto } = ev;
      transcricoes[url] = { ...resto, em: Date.now() };
      if (resto.estado === 'ok' || resto.estado === 'erro') salvarTranscricoes();
    }
    broadcast(ev);
  },
});
// 🔍 v0.146: o endereço de uma foto que pode ir para a ampliação. Aceita o
// que vem das redes por https e o que o próprio programa guardou aqui dentro
// (Telegram e WhatsApp baixam a foto de perfil; as amostras 🧪 são do
// programa). O nome do arquivo local é conferido letra a letra — nada de
// «..» nem de barra no meio — pela mesma régua da transcrição.
function avatarAmpliavel(bruto) {
  const url = typeof bruto === 'string' ? bruto.trim() : '';
  if (!url) return null;
  if (url.startsWith('https://')) return url.slice(0, 500);
  const pastas = ['/midia-inscritos/', '/amostras/'];
  for (const pasta of pastas) {
    if (!url.startsWith(pasta)) continue;
    const nome = url.slice(pasta.length);
    if (/^[A-Za-z0-9._-]+$/.test(nome) && !nome.includes('..')) return url.slice(0, 500);
  }
  return null;
}

// forca = pedido manual de "tentar de novo" (ignora o tipo e o resultado velho)
function transcreverMidia(midia, forca = false) {
  if (state.settings.labs?.transcricao !== true) return;
  if (!midia || !midia.url) return;
  if (!forca && midia.tipo !== 'audio' && midia.tipo !== 'video') return;
  const nome = String(midia.url).split('/').pop();
  if (!midia.url.startsWith('/midia-inscritos/') || !/^[A-Za-z0-9.-]+$/.test(nome)) return;
  const antiga = transcricoes[midia.url];
  if (!forca && antiga && (antiga.estado === 'ok' || antiga.estado === 'erro')) {
    broadcast({ type: 'transcricao', url: midia.url, ...antiga });
    return;
  }
  transcritor.transcrever(midia.url, path.join(MIDIA_INSCRITOS_DIR, nome), state.settings.transcricao || {});
}
// 🎙️ v0.140: o rascunho do áudio/vídeo que ESTÁ na tela viaja junto do
// destaque — é o que a tela do público escreve na região do comentário.
// Só o do destaque: a lista inteira continua sem sair do computador
// (🔒 v0.127.1), e só quando já ficou pronto (fila, erro e "sem fala" não
// interessam a quem assiste — para eles a tela mostra só a marca do tipo).
function transcricaoDoDestaque() {
  const url = state.featured && state.featured.midia && state.featured.midia.url;
  const t = url ? transcricoes[url] : null;
  return t && t.estado === 'ok' && t.texto ? { url, estado: 'ok', texto: t.texto } : null;
}

// ---------- 🛡️ Timeout e banimento (Telegram/WhatsApp) ----------
// A lista mora aqui (data/moderacao.json) e vale SEMPRE, mesmo quando a rede
// não tem o recurso nativo: mensagem de quem está de castigo nem entra no
// painel. No Telegram, o castigo também é aplicado no PRÓPRIO grupo
// (restrict/ban — o bot precisa ser admin), como pedido.
const MODERACAO_FILE = path.join(DATA_DIR, 'moderacao.json');
function moderacaoVazia() { return { telegram: { timeouts: {}, bans: {} }, whatsapp: { timeouts: {}, bans: {} } }; }
function loadModeracao() {
  try {
    const raw = JSON.parse(fs.readFileSync(MODERACAO_FILE, 'utf8'));
    const base = moderacaoVazia();
    for (const rede of ['telegram', 'whatsapp']) {
      for (const tipo of ['timeouts', 'bans']) {
        const bloco = raw?.[rede]?.[tipo];
        if (bloco && typeof bloco === 'object') {
          for (const [id, v] of Object.entries(bloco)) {
            if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
            base[rede][tipo][String(id).slice(0, 40)] = {
              nome: String(v?.nome || '').slice(0, 80),
              em: Number(v?.em) || Date.now(),
              ...(tipo === 'timeouts' ? { ate: Number(v?.ate) || 0 } : {}),
            };
          }
        }
      }
    }
    return base;
  } catch { return moderacaoVazia(); }
}
const moderacao = loadModeracao();
function saveModeracao() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(MODERACAO_FILE, JSON.stringify(moderacao, null, 2));
  } catch { /* o proximo save tenta de novo */ }
}
function broadcastModeracao() { broadcast({ type: 'moderacao', moderacao }); }
// Está de castigo AGORA? (timeouts vencidos são varridos na passada)
function autorModerado(rede, autorId) {
  const bloco = moderacao[rede];
  if (!bloco || !autorId) return false;
  if (bloco.bans[autorId]) return true;
  const t = bloco.timeouts[autorId];
  if (t) {
    if (Date.now() < t.ate) return true;
    delete bloco.timeouts[autorId]; // venceu: sai sozinho da lista
    saveModeracao();
    broadcastModeracao();
  }
  return false;
}

function arrancarPix() {
  clearInterval(pixRt.timer);
  pixRt.timer = null;
  pixRt.token = null;
  pixRt.tokenExpira = 0;
  // Vistos guardados de outra sessão? Então dá para reconhecer o que é novo
  // mesmo com o programa tendo ficado fechado; sem histórico, a 1ª consulta
  // só marca o que encontrar (senão o painel inundava com Pix antigos)
  pixRt.primeira = pixRt.vistos.size === 0;
  if (state.settings.labs?.pix !== true) { pixStatus('desligado', ''); return; }
  const { urlToken, urlPix } = pixUrls();
  if (!pixConfig.clientId || !urlToken || !urlPix) {
    pixStatus('erro', 'faltam dados: preencha as credenciais do banco e salve');
    return;
  }
  try { pixRt.agent = pixAgentNovo(); } catch (err) {
    pixStatus('erro', 'não consegui ler o certificado: ' + String(err.message).slice(0, 150));
    return;
  }
  pixStatus('conectando', '');
  pixTick();
  pixRt.timer = setInterval(pixTick, pixConfig.intervalo * 1000);
}

// 🔒 v0.127.1: um arquivo apagado (ou sem permissão) NO MEIO do envio
// disparava um erro sem dono no fluxo de leitura e fechava o programa.
function entregarArquivo(res, fluxo) {
  fluxo.on('error', (err) => {
    console.error('  ⚠️ Falha lendo um arquivo para enviar:', err && err.message);
    try { res.destroy(); } catch { /* já fechou */ }
  });
  fluxo.pipe(res);
}

// Rede de proteção final: um erro sem dono (uma promessa esquecida, um
// callback que estourou) não pode fechar o programa no meio da live. Fica
// registrado no console para ser achado e corrigido.
process.on('uncaughtException', (err) => {
  console.error('  ⚠️ Erro inesperado (o programa segue no ar):', (err && err.stack) || err);
});
process.on('unhandledRejection', (err) => {
  console.error('  ⚠️ Promessa rejeitada sem tratamento (o programa segue no ar):', (err && err.stack) || err);
});

const server = http.createServer((req, res) => {
  // Endereço malformado (ex.: "/%") fazia o decodeURIComponent estourar e o
  // programa inteiro fechava no meio da live. Agora vira um 400 educado.
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Endereço inválido');
    return;
  }
  // 🔒 v0.127.1: um byte nulo no endereço (/a%00) fazia o fs estourar na
  // hora (erro síncrono, sem dono) e o programa inteiro fechava.
  if (urlPath.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Endereço inválido');
    return;
  }
  // 🔒 v0.127.1: o nome pelo qual o pedido chegou (Host) também precisa ser
  // local. Um site de fora que aponta o próprio nome para 127.0.0.1 (DNS
  // rebinding) fazia o navegador do streamer buscar /mesa-backup e afins
  // "por dentro", sem Origin. Com nome de fora, nada é servido.
  if (!hostAllowed(req.headers.host)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('O OBS Social só atende pelo endereço local (localhost ou o IP da sua rede).');
    return;
  }

  // ---------- 🔐 Portão de segurança ----------
  const role = roleFor(req);

  // Entrada por senha (rede/remoto)
  if (req.method === 'POST' && urlPath === '/auth') {
    if (role === 'blocked') { res.writeHead(403); res.end('Proibido'); return; }
    if (!authAllowed(req.socket.remoteAddress)) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'Muitas tentativas. Espere alguns minutos.' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => { if (body.length < 4096) body += chunk.toString().slice(0, 4096 - body.length); });
    req.on('end', async () => {
      let password = '';
      try { password = String(JSON.parse(body).password || ''); } catch {}
      const conferiu = security.passwordHash ? await passwordMatchesAsync(password) : false;
      if (conferiu === 'ocupado') {
        // Fila cheia: não é senha errada, é "tente daqui a pouco"
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, erro: 'Muitas tentativas ao mesmo tempo. Espere um instante.' }));
        return;
      }
      if (conferiu === true) {
        const token = createSession();
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Set-Cookie': `obssocial_auth=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`,
        });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }

  if (role === 'blocked') {
    // Conexão de fora da rede local: nada é servido. Sem exceção.
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('O OBS Social só aceita conexões da rede local.');
    return;
  }

  // 🕹️ v0.126: Controle externo (Stream Deck e afins) — GET/POST
  // /api/controle/<ação>?token=... — o token vale como a senha da rede, por
  // isso entra ANTES da tela de login (o aparelho não tem navegador)
  if (urlPath === '/api/controle' || urlPath.startsWith('/api/controle/')) {
    tratarControleHttp(req, res, urlPath);
    return;
  }

  if (role === 'login') {
    // Senha definida e ainda não autenticado: só a tela de entrada.
    res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8', 'X-Frame-Options': 'SAMEORIGIN', 'Content-Security-Policy': "frame-ancestors 'self'" });
    res.end(LOGIN_PAGE);
    return;
  }

  if (req.method === 'POST' && urlPath === '/upload') {
    // Upload pela rede restrita: só se o seletor de mídias estiver ligado
    if (role === 'viewer' && !security.permissions.media) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Modo restrito: uploads desativados pelo streamer.' }));
      return;
    }
    // Só o próprio painel (mesma máquina/rede) pode enviar arquivos — um site
    // externo aberto no navegador não consegue gravar mídia no seu computador.
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Origem não permitida.' }));
      return;
    }
    handleUpload(req, res);
    return;
  }

  // 📋 v0.90: arquivo para a Área de transferência — QUALQUER tipo e SEM
  // teto de tamanho (pedido do streamer): escorre direto para o disco
  // (data/clipboard-arquivos/) e vira uma entrada do histórico.
  if (req.method === 'POST' && urlPath === '/clip-arquivo') {
    if (role === 'viewer' && !security.permissions.clipboard) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Modo restrito: área de transferência desativada pelo streamer.' }));
      req.resume();
      return;
    }
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Origem não permitida.' }));
      req.resume();
      return;
    }
    const query = new URLSearchParams((req.url || '').split('?')[1] || '');
    const nomeCru = path.basename(query.get('name') || 'arquivo').replace(/[^\w.\-()\[\] À-ÿ]+/g, '_').slice(-100) || 'arquivo';
    const arquivo = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6) + '-' + nomeCru;
    let destino;
    try {
      fs.mkdirSync(CLIP_DIR, { recursive: true });
      destino = path.join(CLIP_DIR, arquivo);
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Não consegui preparar a pasta do histórico.' }));
      req.resume();
      return;
    }
    // 💾 v0.90.1: o "sem limite de tamanho" vale para QUEM É DONO da máquina
    // (este computador) e para quem entrou com a senha. Um aparelho anônimo
    // da rede restrita — e o seletor 📋 vem ligado de fábrica — passa pelo
    // mesmo teto dos outros envios: sem isto, uma requisição só (curl com
    // /dev/zero, sem navegador e sem Origin) enchia o disco no meio da live.
    const semTeto = role === 'local' || role === 'full';
    const teto = semTeto ? Infinity : MAX_UPLOAD_BYTES;
    // O disco tem fim mesmo para o dono: encostou na reserva, o envio para.
    if (espacoLivreAbaixoDaReserva()) {
      res.writeHead(507, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'O disco está quase cheio — libere espaço antes de compartilhar arquivos.' }));
      req.resume();
      return;
    }
    const { pipeline } = require('stream');
    let tamanho = 0;
    let semEspaco = false;
    let passouDoTeto = false;
    let proximaChecagem = CLIP_CHECA_DISCO_A_CADA;
    req.on('data', (c) => {
      tamanho += c.length;
      if (tamanho > teto && !passouDoTeto) {
        passouDoTeto = true;
        req.destroy(new Error('grande demais'));
        return;
      }
      if (tamanho >= proximaChecagem && !semEspaco) {
        proximaChecagem = tamanho + CLIP_CHECA_DISCO_A_CADA;
        if (espacoLivreAbaixoDaReserva()) { semEspaco = true; req.destroy(new Error('disco cheio')); }
      }
    });
    // pipeline fecha e destrói tudo em qualquer falha (abort, disco cheio)
    pipeline(req, fs.createWriteStream(destino), (err) => {
      if (err && (semEspaco || passouDoTeto)) {
        fs.unlink(destino, () => {});
        if (!res.headersSent) {
          res.writeHead(passouDoTeto ? 413 : 507, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: false,
            error: passouDoTeto
              ? 'Arquivo grande demais para quem entra pela rede (limite: 300 MB). No computador do streamer não há limite.'
              : 'O disco encheu durante o envio — o arquivo não foi guardado.',
          }));
        }
        return;
      }
      if (err) {
        fs.unlink(destino, () => {});
        if (!res.headersSent) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Falha ao receber o arquivo.' }));
        }
        return;
      }
      clipboardJuntar({ id: newInstanceId('clip'), tipo: 'arquivo', texto: '', nome: nomeCru, arquivo, tamanho, em: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  // 📋 Download de um arquivo do histórico: SEMPRE como anexo puro — nada
  // daqui roda como página (qualquer tipo de arquivo é aceito lá em cima)
  if (req.method === 'GET' && urlPath.startsWith('/clip-arquivo/')) {
    if (role === 'viewer' && !security.permissions.clipboard) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Modo restrito: área de transferência desativada pelo streamer.');
      return;
    }
    const nome = path.basename(urlPath);
    const cheio = path.join(CLIP_DIR, nome);
    // 🛡️ v0.90.1: UMA olhada só no disco, dentro do try. Antes era
    // existsSync + statSync: entre as duas o arquivo podia sumir (basta
    // alguém apagar a entrada nesse instante) e o statSync estourava — sem
    // ninguém para pegar a exceção, o programa inteiro caía no meio da live.
    let stat = null;
    if (/^[\w][\w.\-()\[\] À-ÿ]*$/.test(nome) && cheio.startsWith(CLIP_DIR + path.sep)) {
      try { stat = fs.statSync(cheio); } catch { stat = null; }
    }
    if (!stat || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Esse arquivo já saiu do histórico.');
      return;
    }
    const entrada = (state.clipboard || []).find((e) => e.arquivo === nome);
    const baixaCom = (entrada && entrada.nome) || nome.replace(/^[a-z0-9]+-[a-z0-9]{4}-/, '');
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(baixaCom),
    });
    const fluxo = fs.createReadStream(cheio);
    fluxo.on('error', () => { try { res.destroy(); } catch {} });
    fluxo.pipe(res);
    return;
  }

  // 📋 O texto INTEIRO de uma entrada (as telas só carregam a prévia)
  if (req.method === 'GET' && urlPath === '/clip-texto') {
    if (role === 'viewer' && !security.permissions.clipboard) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Modo restrito: área de transferência desativada pelo streamer.');
      return;
    }
    const id = new URLSearchParams((req.url || '').split('?')[1] || '').get('id') || '';
    const entrada = (state.clipboard || []).find((e) => e.id === id && e.tipo === 'texto');
    if (!entrada) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Essa entrada já saiu do histórico.');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
    res.end(entrada.texto);
    return;
  }

  // 📎 v0.75: arquivo da RESPOSTA a um inscrito — vai para a quarentena
  // local e segue pela rede (Telegram/WhatsApp) junto do envio da resposta.
  // Mesma regra do op responderInscrito: o modo restrito não responde.
  if (req.method === 'POST' && urlPath === '/resposta-arquivo') {
    if (role === 'viewer') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Modo restrito: responder é só do painel do streamer.' }));
      req.resume();
      return;
    }
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Origem não permitida.' }));
      req.resume();
      return;
    }
    const query = new URLSearchParams((req.url || '').split('?')[1] || '');
    const nomeCru = path.basename(query.get('name') || 'arquivo').replace(/[^\w.\-()\[\] À-ÿ]+/g, '_').slice(-80) || 'arquivo';
    const extAnexo = path.extname(nomeCru).slice(1).toLowerCase();
    if (!MIDIA_EXT_OK.has(extAnexo) || extAnexo === 'bin' || extAnexo === 'tgs') {
      res.writeHead(415, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Tipo de arquivo não aceito na resposta.' }));
      req.resume();
      return;
    }
    const LIMITE_RESPOSTA = 20 * 1024 * 1024; // o teto de upload dos bots do Telegram
    const partes = [];
    let total = 0;
    let estourou = false;
    req.on('data', (c) => {
      total += c.length;
      if (total > LIMITE_RESPOSTA) {
        if (!estourou) {
          estourou = true;
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'Arquivo grande demais (limite: 20 MB).' }));
          req.destroy();
        }
        return;
      }
      partes.push(c);
    });
    req.on('end', () => {
      if (estourou) return;
      const url = salvarMidiaInscrito(Buffer.concat(partes), extAnexo, nomeCru);
      if (!url) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Não consegui guardar o arquivo.' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, url, nome: nomeCru }));
    });
    return;
  }

  if (req.method === 'POST' && urlPath === '/sd-importar') {
    // 🎛️ Importar o backup do Stream Deck: operação SÓ do computador do
    // streamer (como o op do WebSocket), e sem base64 — o arquivo real do
    // programa da Elgato pode passar fácil dos 64 MB por causa das imagens.
    if (role !== 'local') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'a importação só funciona no computador do streamer' }));
      req.resume();
      return;
    }
    // Só-local de verdade: além do loopback (role), a página que dispara tem
    // de ser o PRÓPRIO painel. Assim uma página aberta noutro aparelho da rede
    // (Origin de um IP 192.168… é "local" para o resto do app) não consegue
    // mandar um backup pela porta de importação sem o streamer perceber.
    // 🛡️ v0.90.1: quem checa a origem é o originAllowed — o mesmo do resto do
    // programa. A checagem que morava aqui comparava a Origin com o Host, e
    // é EXATAMENTE o padrão que o originAllowed descarta de propósito: um
    // site de fora que aponte o próprio nome para o IP da sua máquina manda
    // Origin e Host iguais e passava batido.
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'origem não permitida' }));
      req.resume();
      return;
    }
    // O arquivo escorre para um temporário no disco — 5 GB de backup são
    // bem-vindos sem pesar na memória (o leitor só olha os manifests)
    let tmpImport;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      tmpImport = path.join(DATA_DIR, 'sd-import-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.bin');
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'falha ao gravar o arquivo temporário' }));
      req.resume();
      return;
    }
    const { Transform, pipeline } = require('stream');
    const escrita = fs.createWriteStream(tmpImport);
    let respondido = false;
    let estourou = false;
    const responde = (codigo, corpo) => {
      if (respondido) return;
      respondido = true;
      if (!res.headersSent) res.writeHead(codigo, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    const limpaTmp = () => { fs.unlink(tmpImport, () => {}); };
    let total = 0;
    const conta = new Transform({
      transform(pedaco, enc, cb) {
        total += pedaco.length;
        if (total > MAX_SD_IMPORT_BYTES) { estourou = true; return cb(new Error('grande demais')); }
        cb(null, pedaco);
      },
    });
    // pipeline destrói TODOS os fluxos (o WriteStream inclusive) em qualquer
    // falha — abort do cliente, disco cheio, estouro do teto — e o callback
    // roda uma vez só; sem vazar file descriptor nem temporário.
    pipeline(req, conta, escrita, (err) => {
      if (err) {
        limpaTmp();
        if (estourou) responde(413, { ok: false, erro: 'arquivo vazio ou grande demais' });
        else responde(400, { ok: false, erro: 'falha ao receber o arquivo' });
        return;
      }
      importarBackupArquivo(tmpImport)
        .catch(() => ({ ok: false, erro: 'não achei botões de som nesse arquivo' }))
        .then((r) => { limpaTmp(); responde(200, r); });
    });
    return;
  }

  // 💾 v0.90: backup próprio da Mesa de Trilhas — download direto (simples =
  // .json com as teclas; total = .zip com mesa.json + os arquivos). Operação
  // SÓ do computador do streamer, como o backup geral.
  if (req.method === 'GET' && urlPath === '/mesa-backup') {
    if (role !== 'local') {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('O backup da Mesa só funciona no computador do streamer.');
      return;
    }
    const modo = new URLSearchParams((req.url || '').split('?')[1] || '').get('modo') === 'total' ? 'total' : 'simples';
    const marca = marcaAgora();
    if (modo === 'simples') {
      const corpo = mesaBackupManifesto();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="obs-social-mesa-simples-${marca}.json"`,
        'Cache-Control': 'no-store',
      });
      res.end(corpo);
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="obs-social-mesa-total-${marca}.zip"`,
      'Cache-Control': 'no-store',
    });
    escreverZipParaRes(res, mesaBackupEntradas()).catch(() => { try { res.destroy(); } catch {} });
    return;
  }

  // ↩️ v0.90: restaurar um backup da Mesa — aceita o .json simples, o .zip
  // total e (compatibilidade de sempre) qualquer backup do Stream Deck.
  // Mesmas regras do /sd-importar: só o computador local, só o próprio painel.
  if (req.method === 'POST' && urlPath === '/mesa-restaurar') {
    if (role !== 'local') {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'a restauração só funciona no computador do streamer' }));
      req.resume();
      return;
    }
    // 🛡️ v0.90.1: quem checa a origem é o originAllowed — o mesmo do resto do
    // programa. A checagem que morava aqui comparava a Origin com o Host, e
    // é EXATAMENTE o padrão que o originAllowed descarta de propósito: um
    // site de fora que aponte o próprio nome para o IP da sua máquina manda
    // Origin e Host iguais e passava batido.
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'origem não permitida' }));
      req.resume();
      return;
    }
    let tmpRest;
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      tmpRest = path.join(DATA_DIR, 'mesa-rest-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.bin');
    } catch {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'falha ao gravar o arquivo temporário' }));
      req.resume();
      return;
    }
    const { Transform, pipeline } = require('stream');
    let respondido = false;
    let estourou = false;
    const responde = (codigo, corpo) => {
      if (respondido) return;
      respondido = true;
      if (!res.headersSent) res.writeHead(codigo, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corpo));
    };
    const limpaTmp = () => { fs.unlink(tmpRest, () => {}); };
    let total = 0;
    const conta = new Transform({
      transform(pedaco, enc, cb) {
        total += pedaco.length;
        if (total > MAX_SD_IMPORT_BYTES) { estourou = true; return cb(new Error('grande demais')); }
        cb(null, pedaco);
      },
    });
    pipeline(req, conta, fs.createWriteStream(tmpRest), (err) => {
      if (err) {
        limpaTmp();
        if (estourou) responde(413, { ok: false, erro: 'arquivo vazio ou grande demais' });
        else responde(400, { ok: false, erro: 'falha ao receber o arquivo' });
        return;
      }
      restaurarMesaArquivo(tmpRest)
        .catch(() => ({ ok: false, erro: 'não consegui ler esse arquivo' }))
        .then((r) => { limpaTmp(); responde(200, r); });
    });
    return;
  }

  // 📎 Mídia dos inscritos (quarentena em data/): o painel vê a prévia e a
  // tela recebe quando o apresentador manda. Só o nome do arquivo, sem
  // caminhos — nada de ../ passeando pela pasta.
  // 🎞️ v0.129: o arquivo do computador escolhido na Mídia direta é servido de
  // onde está — só o arquivo registrado pelo id (nunca um caminho da URL)
  if (urlPath.startsWith('/midia-direta/')) {
    const partes = urlPath.split('/');
    const arquivo = midiaDiretaArquivos.get(String(partes[2] || ''));
    let tamanho = 0;
    try { tamanho = arquivo ? fs.statSync(arquivo).size : -1; } catch { tamanho = -1; }
    if (!arquivo || tamanho < 0) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Essa mídia não está mais no ar.');
      return;
    }
    const cabecalhos = {
      'Content-Type': MIME[path.extname(arquivo).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      'Accept-Ranges': 'bytes', // o seek do player depende disto
    };
    const faixa = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
    if (faixa && (faixa[1] || faixa[2])) {
      const inicio = faixa[1] ? Number(faixa[1]) : Math.max(0, tamanho - Number(faixa[2]));
      const fim = faixa[1] && faixa[2] ? Math.min(Number(faixa[2]), tamanho - 1) : tamanho - 1;
      if (inicio > fim || inicio >= tamanho) {
        res.writeHead(416, { 'Content-Range': `bytes */${tamanho}` });
        res.end();
        return;
      }
      res.writeHead(206, { ...cabecalhos, 'Content-Range': `bytes ${inicio}-${fim}/${tamanho}`, 'Content-Length': fim - inicio + 1 });
      entregarArquivo(res, fs.createReadStream(arquivo, { start: inicio, end: fim }));
      return;
    }
    res.writeHead(200, { ...cabecalhos, 'Content-Length': tamanho });
    entregarArquivo(res, fs.createReadStream(arquivo));
    return;
  }

  if (urlPath.startsWith('/midia-inscritos/')) {
    const nome = path.basename(urlPath);
    const arquivo = path.join(MIDIA_INSCRITOS_DIR, nome);
    if (!/^[A-Za-z0-9.-]+$/.test(nome) || !arquivo.startsWith(MIDIA_INSCRITOS_DIR) || !fs.existsSync(arquivo)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não achei essa mídia.');
      return;
    }
    const ext = (nome.match(/\.([A-Za-z0-9]+)$/) || [])[1] || '';
    const cabecalhos = {
      'Content-Type': MIDIA_MIME[ext.toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      // 🎛️ v0.71: sem Range o navegador não deixa PULAR posição no player —
      // o seek do painel (e a barrinha da prévia) dependem disto
      'Accept-Ranges': 'bytes',
    };
    let tamanho;
    try { tamanho = fs.statSync(arquivo).size; } catch {
      // (a faxina da quarentena pode ter apagado entre o existsSync e aqui)
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não achei essa mídia.');
      return;
    }
    const faixa = String(req.headers.range || '').match(/^bytes=(\d*)-(\d*)$/);
    if (faixa && (faixa[1] || faixa[2])) {
      const inicio = faixa[1] ? Math.min(Number(faixa[1]), Math.max(0, tamanho - 1)) : Math.max(0, tamanho - Number(faixa[2]));
      const fim = faixa[1] && faixa[2] ? Math.min(Number(faixa[2]), tamanho - 1) : tamanho - 1;
      if (inicio > fim) {
        res.writeHead(416, { 'Content-Range': `bytes */${tamanho}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...cabecalhos,
        'Content-Range': `bytes ${inicio}-${fim}/${tamanho}`,
        'Content-Length': fim - inicio + 1,
      });
      entregarArquivo(res, fs.createReadStream(arquivo, { start: inicio, end: fim }));
      return;
    }
    res.writeHead(200, { ...cabecalhos, 'Content-Length': tamanho });
    entregarArquivo(res, fs.createReadStream(arquivo));
    return;
  }

  // URL generica de doacoes: qualquer ferramenta pode chamar
  // GET/POST /doacao?nome=Fulano&valor=10,50&mensagem=Oi
  if (urlPath === '/doacao') {
    // Doações pela rede restrita: só com o seletor de ferramentas ligado
    if (role === 'viewer' && !security.permissions.tools) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'Modo restrito: doações só do computador do streamer.' }));
      return;
    }
    // Sites externos abertos no navegador não podem disparar doações falsas;
    // ferramentas de automação (sem cabeçalho Origin) continuam funcionando.
    if (!originAllowed(req.headers.origin, req.headers.host)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'Origem não permitida.' }));
      return;
    }
    if (state.settings.labs?.donations !== true) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'Doações estão desativadas. Ligue em Configurações → 🧪 Labs.' }));
      return;
    }
    // 🔒 v0.127.1: um site de fora não manda Origin num <img src=...>, mas o
    // navegador conta de onde veio (Sec-Fetch-Site) — de outro site, não vale.
    // Ferramentas (curl, Stream Deck) não mandam o cabeçalho e seguem passando.
    if (!fetchSiteAllowed(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, erro: 'Origem não permitida.' }));
      return;
    }
    const query = new URLSearchParams((req.url || '').split('?')[1] || '');
    let body = '';
    req.on('data', (chunk) => { if (body.length < 65536) body += chunk.toString().slice(0, 65536 - body.length); });
    req.on('end', () => {
      let params = {};
      try { params = JSON.parse(body); } catch {
        for (const [key, value] of new URLSearchParams(body)) params[key] = value;
      }
      // "null", "1" ou "texto" são JSON válidos mas não são um objeto —
      // params.nome estourava e fechava o programa
      if (!params || typeof params !== 'object' || Array.isArray(params)) params = {};
      const name = params.nome || params.name || query.get('nome') || query.get('name');
      const value = params.valor || params.amount || query.get('valor') || query.get('amount');
      const message = params.mensagem || params.message || query.get('mensagem') || query.get('message');
      emitDonation({ name, amountText: formatDonationValue(value), message });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    return;
  }

  if (urlPath.startsWith('/uploads/')) {
    const filePath = path.join(UPLOADS_DIR, path.normalize(urlPath.slice('/uploads/'.length)));
    if (filePath !== UPLOADS_DIR && !filePath.startsWith(UPLOADS_DIR + path.sep)) {
      res.writeHead(403); res.end('Proibido'); return;
    }
    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) { res.writeHead(404); res.end('Não encontrado'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'Content-Length': stat.size,
        // Não deixa o navegador "adivinhar" outro tipo do arquivo.
        'X-Content-Type-Options': 'nosniff',
        // Um arquivo enviado, se aberto direto, não pode virar uma página de
        // ataque: sem scripts, sem nada externo — só serve como imagem/vídeo/fonte
        // embutido nas telas do próprio programa.
        'Content-Security-Policy':
          "default-src 'none'; img-src 'self'; media-src 'self'; font-src 'self'; style-src 'unsafe-inline'",
      });
      entregarArquivo(res, fs.createReadStream(filePath));
    });
    return;
  }

  if (urlPath === '/') urlPath = '/dashboard.html';
  if (urlPath === '/overlay') urlPath = '/overlay.html';
  if (urlPath === '/chat') urlPath = '/chat.html';
  if (urlPath === '/config') urlPath = '/config.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403); res.end('Proibido'); return;
  }
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(404); res.end('Não encontrado'); return; }
    // Sem estes cabeçalhos, o navegador (e o OBS!) usava cache "no chute" e
    // podia misturar arquivos novos com velhos depois de uma atualização —
    // zoom quebrado, telas piscando. no-cache = sempre confere com o
    // servidor (o 304 mantém a resposta instantânea quando nada mudou).
    let etag = null;
    try { const st = fs.statSync(filePath); etag = `"${st.size}-${Math.floor(st.mtimeMs)}"`; } catch {}
    if (etag && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { 'ETag': etag, 'Cache-Control': 'no-cache' });
      res.end();
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' };
    if (etag) headers['ETag'] = etag;
    // 🔒 v0.127.1: o painel e as configurações não entram dentro de outra
    // página (clickjacking). As telas do OBS (overlay, chat) seguem livres —
    // gente embute overlay em outros lugares.
    if (ext === '.html' && !/^\/(overlay|chat)\.html$/.test(urlPath)) {
      headers['X-Frame-Options'] = 'SAMEORIGIN';
      headers['Content-Security-Policy'] = "frame-ancestors 'self'";
    }
    res.writeHead(200, headers);
    res.end(content);
  });
});

// ---------------------------------------------------------------------------
// 🔐 Segurança de acesso: local, rede e remoto.
//
// Regras (rígidas de propósito):
// - Este computador (local): acesso total, sem senha — é o streamer.
// - Rede local SEM senha: modo "restrito" por padrão (só assistir + área de
//   transferência) ou "liberdade total", escolhido pelo streamer.
// - Com senha definida: a rede precisa da senha para TUDO; quem entra tem
//   acesso total. A senha vira hash scrypt com sal (nunca fica em texto) e
//   mora em data/security.json — fora das configurações que circulam via WS.
// - Fora da rede local: bloqueado SEMPRE — o OBS Social não tem acesso remoto.
// - Definir/trocar/remover senha e mudar estes modos: SÓ do computador local.
// - Cabeçalhos tipo X-Forwarded-For são ignorados de propósito: só o IP real
//   da conexão conta (não dá para falsificar de fora).

const SECURITY_FILE = path.join(DATA_DIR, 'security.json');

// O que a rede restrita (sem senha) pode fazer — cada chave é um seletor na
// página de configurações. Padrão: só assistir, buscar e usar a área de
// transferência; todo o resto desligado.
const NET_PERM_DEFAULTS = {
  clipboard: true,   // 📋 área de transferência
  search: true,      // 🔎 busca de comentários
  screen: false,     // 🖥️ mandar/tirar comentários da tela
  connections: false, // 🔌 conectar/desconectar redes
  tools: false,      // 🧰 ferramentas (QR, sorteio, likômetro, winstreak, audiência, doações)
  settings: false,   // ⚙️ mudar configurações e organizar a tela
  media: false,      // 🖼️ enviar/apagar mídias
  logs: false,       // 🗄️ mexer nos logs
  obs: false,        // 🎬 comandar o OBS (cenas, transição, mudo, live/gravação)
};

function sanitizePerms(raw) {
  const perms = { ...NET_PERM_DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const key of Object.keys(NET_PERM_DEFAULTS)) {
      if (typeof raw[key] === 'boolean') perms[key] = raw[key];
    }
  }
  return perms;
}

function loadSecurity() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'security.json'), 'utf8'));
    return {
      passwordHash: typeof raw.passwordHash === 'string' ? raw.passwordHash : null,
      salt: typeof raw.salt === 'string' ? raw.salt : null,
      // v0.90: o custo de scrypt com que o hash foi criado (senhas antigas
      // não têm o campo e caem no padrão histórico do Node)
      scryptN: [16384, 32768, 65536, 131072].includes(raw.scryptN) ? raw.scryptN : 0,
      networkAccess: raw.networkAccess === 'full' ? 'full' : 'restricted',
      permissions: sanitizePerms(raw.permissions),
    };
  } catch {
    return { passwordHash: null, salt: null, scryptN: 0, networkAccess: 'restricted', permissions: { ...NET_PERM_DEFAULTS } };
  }
}

const security = loadSecurity();

function persistSecurity() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    gravarPrivado(SECURITY_FILE, JSON.stringify(security, null, 2));
  } catch (err) {
    console.error('Não consegui salvar as opções de segurança:', err.message);
  }
}

// 🔐 v0.90: senhas NOVAS usam um custo de scrypt bem maior (N=65536 — cada
// tentativa gasta ~64 MB e dezenas de milissegundos, o que deixa a força
// bruta em cima de um security.json copiado MUITO mais cara). As antigas
// continuam válidas com o custo com que foram criadas, até serem trocadas.
const SCRYPT_CUSTO_NOVO = 65536;
const SCRYPT_CUSTOS_VALIDOS = [16384, 32768, 65536, 131072];

function hashPassword(password, salt, custoN) {
  const N = SCRYPT_CUSTOS_VALIDOS.includes(Number(custoN)) ? Number(custoN) : 16384;
  return crypto.scryptSync(String(password), salt, 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }).toString('hex');
}

function passwordMatches(password) {
  if (!security.passwordHash || !security.salt) return false;
  const candidate = hashPassword(password, security.salt, security.scryptN);
  return mesmoHash(candidate);
}

function mesmoHash(candidateHex) {
  const a = Buffer.from(candidateHex, 'hex');
  const b = Buffer.from(security.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 🕒 v0.90.1: a conferência da senha pela REDE roda fora da linha principal.
// O custo alto do scrypt (de propósito, contra força bruta) é ~0,4 s de CPU:
// no modo síncrono cada tentativa congelava painel, overlay e OBS junto. Aqui
// ela vai para a fila de trabalho do Node e o programa segue respondendo.
// Só duas conferências rodam por vez — nem o custo alto vira porta de DoS.
let hashesEmVoo = 0;
const HASHES_AO_MESMO_TEMPO = 2;
function passwordMatchesAsync(password) {
  return new Promise((resolve) => {
    if (!security.passwordHash || !security.salt) return resolve(false);
    if (hashesEmVoo >= HASHES_AO_MESMO_TEMPO) return resolve('ocupado');
    const N = SCRYPT_CUSTOS_VALIDOS.includes(Number(security.scryptN)) ? Number(security.scryptN) : 16384;
    hashesEmVoo++;
    crypto.scrypt(String(password), security.salt, 64, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (err, chave) => {
      hashesEmVoo--;
      if (err) return resolve(false);
      try { resolve(mesmoHash(chave.toString('hex'))); } catch { resolve(false); }
    });
  });
}

// ---------------------------------------------------------------------------
// 🔑 Cofre local (v0.90): TODO segredo que precisa ser lido de volta (senha
// do OBS, tokens de bot do Telegram/WhatsApp, segredos do Pix) é gravado em
// data/ cifrado com AES-256-GCM. A chave nasce nesta máquina (32 bytes
// aleatórios em data/chave-local.key, permissão só do dono): quem copiar
// apenas os JSONs não lê nada, e o backup da pasta data/ inteira continua
// restaurável porque a chave viaja junto. A senha de REDE nem passa por
// aqui: ela vira hash scrypt (acima) e nunca é guardada, nem cifrada.
// As funções são declaradas com function (içadas): os carregadores de
// configuração rodam antes desta linha do arquivo.

function chaveLocal() {
  if (chaveLocal.cache) return chaveLocal.cache;
  let existe = false;
  try {
    const lida = fs.readFileSync(CHAVE_LOCAL_FILE);
    existe = true;
    if (lida.length === 32) { chaveLocal.cache = lida; return lida; }
  } catch { existe = false; }
  // 🛡️ v0.90.1: chave que EXISTE mas está com o tamanho errado (disco cheio
  // ou queda no meio da primeira gravação) NÃO é substituída — sobrescrever
  // torraria de uma vez a senha do OBS, os tokens e os segredos do Pix. O
  // programa segue com uma chave de sessão e avisa alto no console.
  if (existe) {
    console.error('⚠️  A chave local (data/chave-local.key) está corrompida. Os segredos guardados não vão abrir.');
    console.error('    Guarde uma cópia do arquivo antes de mexer e redigite a senha do OBS / os tokens.');
    chaveLocal.cache = crypto.randomBytes(32);
    return chaveLocal.cache;
  }
  const nova = crypto.randomBytes(32);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    // Grava num temporário e renomeia: uma queda no meio não deixa meia chave
    const tmp = CHAVE_LOCAL_FILE + '.tmp';
    fs.writeFileSync(tmp, nova, { mode: 0o600 });
    fs.renameSync(tmp, CHAVE_LOCAL_FILE);
  } catch (err) {
    console.error('⚠️  Não consegui guardar a chave local:', err.message);
    console.error('    As senhas gravadas agora só serão legíveis enquanto o programa estiver aberto.');
  }
  chaveLocal.cache = nova;
  return nova;
}

// 🔑 v0.90.1: a restauração de backup troca o arquivo da chave por baixo do
// programa — o cache em memória tem de acompanhar, senão o que voltou do
// backup fica ilegível até reiniciar.
function recarregarChaveLocal() {
  chaveLocal.cache = null;
  // A cópia do backup chega com permissão de arquivo comum: a chave volta a
  // ser só do dono
  try { fs.chmodSync(CHAVE_LOCAL_FILE, 0o600); } catch {}
  chaveLocal();
}

// Texto -> 'enc-v1:' + base64(iv | tag | cifrado). Vazio continua vazio.
function guardarSegredo(texto) {
  const puro = String(texto || '');
  if (!puro) return '';
  try {
    const iv = crypto.randomBytes(12);
    const cifra = crypto.createCipheriv('aes-256-gcm', chaveLocal(), iv);
    const dados = Buffer.concat([cifra.update(puro, 'utf8'), cifra.final()]);
    return 'enc-v1:' + Buffer.concat([iv, cifra.getAuthTag(), dados]).toString('base64');
  } catch (err) {
    // Cifrar falhou: o dado é gravado como veio para não sumir — mas isso
    // NÃO pode acontecer em silêncio, senão o streamer acredita que está
    // protegido quando não está
    console.error('⚠️  Não consegui cifrar um segredo — ele foi guardado em texto:', err.message);
    return puro;
  }
}

// O caminho de volta — e a migração de graça: valor sem o prefixo é um
// segredo antigo em texto puro e passa direto (a próxima gravação cifra).
function abrirSegredo(valor) {
  const v = String(valor || '');
  if (!v.startsWith('enc-v1:')) return v;
  try {
    const bruto = Buffer.from(v.slice('enc-v1:'.length), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', chaveLocal(), bruto.subarray(0, 12));
    d.setAuthTag(bruto.subarray(12, 28));
    return Buffer.concat([d.update(bruto.subarray(28)), d.final()]).toString('utf8');
  } catch {
    // Chave trocada ou arquivo corrompido: devolve vazio (nunca lixo) e
    // avisa — sem o aviso, a senha do OBS e os tokens sumiam caladinhos e a
    // primeira gravação seguinte apagava o cifrado que ainda estava lá
    console.error('⚠️  Um segredo guardado não abriu com a chave local desta máquina (data/chave-local.key).');
    console.error('    Se você restaurou um backup de outro computador, redigite a senha do OBS / os tokens.');
    return '';
  }
}

// Sessões autenticadas (token aleatório em cookie HttpOnly; validade 12h)
const authSessions = new Map(); // token -> expira em (ms)

function createSession() {
  // Limpa as que já venceram antes de guardar mais uma
  const agora = Date.now();
  for (const [t, expira] of authSessions) {
    if (agora > expira) authSessions.delete(t);
  }
  const token = crypto.randomBytes(32).toString('hex');
  authSessions.set(token, Date.now() + 12 * 60 * 60 * 1000);
  return token;
}

function sessionValid(token) {
  const expiry = authSessions.get(token);
  if (!expiry) return false;
  if (Date.now() > expiry) { authSessions.delete(token); return false; }
  return true;
}

function cookieToken(req) {
  const match = /(?:^|;\s*)obssocial_auth=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  return match ? match[1] : null;
}

const EXIGIR_SENHA_LOCAL = /^(1|true|sim)$/i.test(String(process.env.OBS_SOCIAL_EXIGIR_SENHA_LOCAL || ''));

// Classifica o IP REAL da conexão: local (esta máquina), network (rede
// privada) ou remote (internet).
function classifyAddress(remoteAddress) {
  let ip = String(remoteAddress || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (ip === '127.0.0.1' || ip === '::1' || ip.startsWith('127.')) return 'local';
  if (/^10\./.test(ip)) return 'network';
  if (/^192\.168\./.test(ip)) return 'network';
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 'network';
  if (/^169\.254\./.test(ip)) return 'network';
  if (/^fe80:/i.test(ip) || /^f[cd][0-9a-f]{2}:/i.test(ip)) return 'network'; // IPv6 local (fe80::/10 e fc00::/7)
  return 'remote';
}

// Papel de um pedido: 'local' | 'full' | 'viewer' | 'login' | 'blocked'
function computeRole(addressClass, authed, sec) {
  // 🔒 v0.127.1: quem expõe o painel por um túnel/proxy (ngrok, cloudflared,
  // nginx...) faz TODO pedido chegar como 127.0.0.1 — e o computador local
  // manda em tudo sem senha. Com OBS_SOCIAL_EXIGIR_SENHA_LOCAL=1 no ambiente,
  // o próprio computador passa a valer como rede (senha e modo restrito).
  if (addressClass === 'local' && !EXIGIR_SENHA_LOCAL) return 'local';
  // Fora da rede local NUNCA entra — o OBS Social não tem acesso remoto.
  if (addressClass === 'remote') return 'blocked';
  // Rede local: liberdade total = controla tudo (a senha só vale no restrito)
  if (sec.networkAccess === 'full') return 'full';
  if (sec.passwordHash) return authed ? 'full' : 'login';
  return 'viewer';
}

function roleFor(req) {
  return computeRole(classifyAddress(req.socket.remoteAddress), sessionValid(cookieToken(req)), security);
}

// Cada operação pertence a uma categoria; no modo restrito, os seletores da
// página de configurações dizem quais categorias a rede pode usar.
const OP_CATEGORY = {
  clipboard: 'clipboard', clipboardApagar: 'clipboard', clipboardLimpar: 'clipboard',
  search: 'search',
  feature: 'screen', unfeature: 'screen', clearOverlays: 'screen', feedFlush: 'screen', feedJump: 'screen',
  midiaPlayer: 'screen', audioOverlayMomento: 'screen',
  avatarShow: 'screen', avatarHide: 'screen', avatarSize: 'screen',
  save: 'screen', unsave: 'screen', test: 'screen',
  connect: 'connections', disconnect: 'connections',
  reconnect: 'connections', reconnectAll: 'connections', recarregarColuna: 'connections',
  qrAdd: 'tools', qrHide: 'tools', qrMove: 'tools', qrRemove: 'tools', qrShow: 'tools',
  raffleDraw: 'tools', raffleHide: 'tools', raffleReset: 'tools',
  likemeter: 'tools', audienceTest: 'tools', audienceToggle: 'tools',
  winstreakAdd: 'tools', winstreakLabel: 'tools', winstreakMove: 'tools',
  winstreakNew: 'tools', winstreakRemove: 'tools', winstreakReset: 'tools',
  winstreakSub: 'tools', winstreakToggle: 'tools',
  winstreakRecord: 'tools', winstreakSet: 'tools',
  avisoSet: 'tools', avisoToggle: 'tools', relogioSet: 'tools', relogioToggle: 'tools',
  avisoNew: 'tools', avisoRemove: 'tools', avisoMove: 'tools', avisoLabel: 'tools', // 📢 v0.128
  exemploOverlay: 'tools', // 🧪 v0.99: exemplo de qualquer overlay, do editor
  cronometro: 'tools', timer: 'tools',
  settings: 'settings', qrStyle: 'settings', winstreakStyle: 'settings', avisoStyle: 'settings',
  perfisOverlaySet: 'settings', // 🎭 perfis de overlay mexem no visual = configurações
  deleteMedia: 'media',
  clearLogs: 'logs',
  // 🎵 A mesa de trilhas é uma ferramenta; 🎬 o OBS tem seletor próprio
  trilhasSet: 'tools', trilhaTocar: 'tools', trilhaParar: 'tools', pastaTocar: 'tools',
  trilhaTela: 'tools', trilhaTelaFim: 'tools', // 🖼️🎞️ v0.86: teclas de mídia
  trilhaTelaAjuste: 'tools', // 🚀 v0.87: velocidade/distorção/nitidez
  // 🎞️ v0.129: mídia direta é tela (como o destaque e o player da mídia)
  midiaDiretaUrl: 'screen', midiaDiretaArquivo: 'screen', midiaDiretaPastas: 'screen',
  midiaDiretaToggle: 'screen', midiaDiretaFechar: 'screen', midiaDiretaTela: 'screen',
  midiaDiretaCredito: 'screen', // 🏷️ v0.136: o crédito de fonte
  midiaDiretaPlayer: 'screen', midiaDiretaInfo: 'screen', midiaDiretaFim: 'screen',
  obsCena: 'obs', obsTransicao: 'obs', obsMudo: 'obs',
  obsAoVivo: 'obs', obsGravacao: 'obs', obsAtualizar: 'obs', obsAcao: 'obs',
  // 🎛️ v0.122: comandar o vMix é do MESMO seletor 🎬 (mesa de corte = mesa de corte)
  vmixAcao: 'obs', vmixAtualizar: 'obs',
};

// 🔊 v0.77: última vez que cada momento de áudio foi repassado (anti-eco)
const audioOvUltimos = new Map();

// O modo restrito só passa por aqui: operação sem categoria conhecida = negada.
function viewerOpAllowed(type, perms) {
  const category = OP_CATEGORY[type];
  return !!(category && perms[category]);
}

// 🎬 v0.53: a Mesa de Trilhas é 'tools', mas dentro dela cabem teclas que
// COMANDAM O OBS — e isso é do seletor 🎬. Quem entra pela rede no modo
// restrito só dispara essas teclas com o 🎬 liberado.
function podeObs(ws) {
  return ws.role !== 'viewer' || security.permissions.obs === true;
}

// Operações de segurança/atualização/reinício: SÓ do computador local.
const LOCAL_ONLY_OPS = new Set(['securityPassword', 'securityMode', 'securityPerms', 'updateCheck', 'updateApply', 'updateAuto', 'restartApp', 'limpar',
  // 💾 Backup mexe em arquivos do computador: só a máquina local comanda
  'backupAgora', 'backupRestaurar',
  // 🎬 A senha do OBS e 🎵 a importação/casamento por pasta leem/gravam
  // arquivos da máquina: só o computador local
  'obsConfig', 'vmixConfig', 'trilhasImportar', 'trilhasCasarPasta',
  // 🎙️ Baixar/apagar modelos e motor da transcrição mexe no disco e na
  // internet da máquina: só o computador local comanda
  'transcricaoModelo', 'transcricaoMotor',
  // 🧪 v0.134: baixar/apagar o extrator (yt-dlp) também grava no disco da
  // máquina — quem manda é o painel aberto no próprio computador
  'ytdlpMotor',
  // 🎞️ v0.129: escolher/listar arquivos do computador é do computador local
  'midiaDiretaArquivo', 'midiaDiretaPastas',
  // 💬 Instalar a biblioteca local do WhatsApp / apagar a sessão pareada
  'whatsappLib',
  // 💠 As credenciais do banco e os caminhos do certificado são da máquina
  // do streamer: só o computador local configura o Pix
  'pixConfig',
  // 🕹️ v0.126: gerar um token novo do controle externo é coisa do dono
  'controleConfig']);

function securitySummary() {
  return {
    passwordSet: !!security.passwordHash,
    networkAccess: security.networkAccess,
    permissions: { ...security.permissions },
  };
}

// Contra força bruta na senha: 8 tentativas por IP a cada 10 minutos.
const authAttempts = new Map();
function authAllowed(ip) {
  const now = Date.now();
  // Limpeza: não deixa o mapa crescer sem limite com IPs que nunca voltam
  if (authAttempts.size > 1000) {
    for (const [k, v] of authAttempts) {
      if (now > v.resetAt) authAttempts.delete(k);
    }
  }
  const entry = authAttempts.get(ip) || { count: 0, resetAt: now + 10 * 60 * 1000 };
  if (now > entry.resetAt) { entry.count = 0; entry.resetAt = now + 10 * 60 * 1000; }
  entry.count += 1;
  authAttempts.set(ip, entry);
  return entry.count <= 8;
}

const LOGIN_PAGE = `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>OBS Social — Entrar</title>
<style>body{font-family:'Segoe UI',system-ui,sans-serif;background:#0f1420;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{background:#1a2233;border:1px solid #2c3850;border-radius:16px;padding:28px;max-width:340px;text-align:center}
input{width:100%;padding:10px;border-radius:10px;border:1px solid #2c3850;background:#0f1420;color:#fff;margin:12px 0;box-sizing:border-box}
button{width:100%;padding:10px;border-radius:10px;border:none;background:#7c3aed;color:#fff;font-weight:700;cursor:pointer}
.err{color:#ff5c5c;font-size:13px;min-height:18px}</style></head><body>
<div class="box"><h2>🔐 OBS Social</h2><p>Este painel está protegido por senha.</p>
<input type="password" id="pw" placeholder="Senha" autofocus><div class="err" id="err"></div>
<button onclick="entrar()">Entrar</button></div>
<script>
async function entrar(){
  const res = await fetch('/auth', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: document.getElementById('pw').value }) });
  if (res.ok) location.reload();
  else document.getElementById('err').textContent = res.status === 429 ? 'Muitas tentativas — espere alguns minutos.' : 'Senha incorreta.';
}
document.getElementById('pw').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });
</script></body></html>`;

// ---------------------------------------------------------------------------
// Proteção contra ataques vindos de sites maliciosos (CSRF / DNS-rebinding).
// O painel escuta na rede local para o co-apresentador acessar, mas isso também
// deixaria um site aberto no navegador do streamer abrir o WebSocket e ler a
// área de transferência, configurações e canais, ou enviar comandos. O navegador
// manda um cabeçalho "Origin" que a página não consegue falsificar; aceitamos só
// origens locais (o próprio painel, localhost ou um IP da rede local) e quem não
// manda Origin (ferramentas/automação, que não são o navegador de ninguém).
function isLocalHostname(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost') return true;
  // Nomes de rede caseira que não existem na internet (o roteador costuma
  // usar um destes): pc.local, pc.lan, pc.home, pc.internal...
  if (/\.(local|lan|home|internal|intranet|localdomain|home\.arpa|fritz\.box|homenet|box)$/.test(h)) return true;
  // 🔒 v0.127.1: as faixas de IP privado só valem para um IP DE VERDADE.
  // Antes as expressões (^10\., ^192\.168\., ^127\., ^f[cd]...) eram
  // aplicadas ao NOME do host, então um site chamado 192.168.evil.com ou
  // 10.evil.com passava por "rede local" e o navegador do streamer abria
  // o WebSocket do painel para ele, com todos os poderes de quem está no
  // computador. Agora: é IP? Então a classificação é a mesma das conexões.
  if (net.isIP(h)) return classifyAddress(h) !== 'remote';
  // Nome simples de máquina na rede ("meu-pc", sem ponto): não existe na
  // internet, então nenhum site de fora consegue se passar por ele.
  if (h && !h.includes('.') && !h.includes(':')) return true;
  return false;
}

// 🔒 v0.127.1: pedidos sem Origin (GET de <img>, navegação) ainda dizem de
// onde vieram pelo Sec-Fetch-Site. "cross-site" = uma página de outro site
// disparando o pedido — recusado. Sem o cabeçalho (curl, Stream Deck, OBS)
// ou do próprio painel/endereço digitado, passa.
function fetchSiteAllowed(req) {
  const sfs = String((req.headers || {})['sec-fetch-site'] || '').toLowerCase();
  return !sfs || sfs === 'none' || sfs === 'same-origin' || sfs === 'same-site';
}

// O cabeçalho Host sem a porta: "192.168.0.10:3111" → "192.168.0.10",
// "[::1]:3111" → "::1". Sem Host (HTTP/1.0, ferramentas) passa.
function hostAllowed(hostHeader) {
  const h = String(hostHeader || '').trim();
  if (!h) return true;
  const semPorta = h.startsWith('[') ? h.slice(1, h.indexOf(']') > 0 ? h.indexOf(']') : undefined) : h.replace(/:\d+$/, '');
  return isLocalHostname(semPorta);
}

function originAllowed(origin, hostHeader) {
  if (!origin) return true; // sem Origin = não é um navegador (curl, automação, OBS)
  let u;
  try { u = new URL(origin); } catch { return false; }
  // ATENÇÃO: aqui existia um "se a Origin bate com o Host, libera". Isso
  // aceitava exatamente o ataque que esta função existe para barrar: um site
  // de fora (evil.com) que aponta o próprio nome para o IP da sua rede manda
  // Origin E Host iguais a evil.com, e passava. Agora o que vale é o endereço
  // ser mesmo da sua máquina/rede.
  void hostHeader;
  return isLocalHostname(u.hostname);
}

// ---------------------------------------------------------------------------
// WebSocket (painel e overlay)

const wss = new WebSocketServer({
  server,
  path: '/ws',
  // Nenhuma operação do painel precisa de mais que isso; sem o teto, o padrão
  // da biblioteca aceitava mensagens de 100 MB.
  maxPayload: 512 * 1024,
  verifyClient: (info) => {
    if (!originAllowed(info.origin, info.req.headers.host)) return false;
    const role = roleFor(info.req);
    if (role === 'blocked' || role === 'login') return false;
    // 🔒 v0.127.1: teto de conexões por aparelho — um cliente da rede não
    // abre milhares de sockets (cada um recebe o init inteiro)
    if (role !== 'local') {
      let ip = String(info.req.socket.remoteAddress || '');
      if (ip.startsWith('::ffff:')) ip = ip.slice(7);
      let abertas = 0;
      for (const c of wss.clients) if (c.clientIp === ip) abertas += 1;
      if (abertas >= 24) return false;
    }
    return true;
  },
});

// O mesmo cuidado para o servidor de WebSocket em si
wss.on('error', (err) => console.error('  ⚠️ Erro no servidor de WebSocket:', err && err.message));

function broadcast(payload) {
  const message = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(message);
  }
}

// O resumo de segurança só vai para quem tem controle (local/total) —
// espectadores não precisam saber como o acesso está configurado.
// 🔒 v0.127.1: apertou a segurança (senha nova, modo restrito)? Quem já
// estava conectado pela rede com mais poder do que teria agora cai na hora
// — antes o papel ficava congelado até a pessoa recarregar por conta própria.
function derrubarConexoesRebaixadas() {
  for (const client of wss.clients) {
    if (client.role === 'local') continue;
    const agora = computeRole(client.addressClass, false, security);
    if (agora !== client.role) { try { client.close(4001, 'seguranca'); } catch { /* já caiu */ } }
  }
}

function broadcastSecurity() {
  const message = JSON.stringify({ type: 'security', security: securitySummary() });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.role !== 'viewer') client.send(message);
  }
}

// ---------- 🖥️ Quem está conectado agora ----------
// Agrupa as conexões abertas por máquina (IP) para o streamer ver quem está
// acessando. O nome vem do DNS reverso da rede (quando a rede informa) e o
// aparelho é deduzido pelo navegador. Essa lista SÓ vai para o computador
// local — nem quem entrou com senha vê as outras máquinas.
function deviceLabel(ua) {
  ua = String(ua || '');
  const so = /OBS\//i.test(ua) ? 'OBS Studio'
    : /Android/i.test(ua) ? 'Android'
    : /iPhone|iPad/i.test(ua) ? 'iPhone/iPad'
    : /Windows/i.test(ua) ? 'Windows'
    : /Mac OS/i.test(ua) ? 'Mac'
    : /Linux/i.test(ua) ? 'Linux' : '';
  const nav = /OBS\//i.test(ua) ? ''
    : /Edg\//.test(ua) ? 'Edge'
    : /OPR\//.test(ua) ? 'Opera'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari' : '';
  return [so, nav].filter(Boolean).join(' · ') || 'aparelho desconhecido';
}

function clientsSummary() {
  const byIp = new Map();
  for (const c of wss.clients) {
    if (c.readyState !== 1 || !c.clientIp) continue;
    const entry = byIp.get(c.clientIp) || {
      ip: c.clientIp,
      local: c.addressClass === 'local',
      name: null,
      device: c.deviceInfo || null,
      pages: 0,
    };
    entry.pages += 1;
    if (c.deviceName && !entry.name) entry.name = c.deviceName;
    byIp.set(c.clientIp, entry);
  }
  return [...byIp.values()].sort((a, b) => (b.local ? 1 : 0) - (a.local ? 1 : 0));
}

function broadcastClients() {
  const message = JSON.stringify({ type: 'clients', clients: clientsSummary() });
  for (const client of wss.clients) {
    if (client.readyState === 1 && client.role === 'local') client.send(message);
  }
}

// ---------------------------------------------------------------------------
// 🔄 Atualização do programa (OTA) — sempre iniciada pelo streamer, nunca
// automática. Baixa o ZIP oficial do GitHub, lê a versão de dentro dele e,
// SÓ se o streamer confirmar, troca os arquivos do programa. A pasta data/
// (configurações, senha, logs, mídias) nunca é tocada.
// Um endereço só — o oficial. As duas URLs abaixo são o MESMO pacote por dois
// caminhos do GitHub: o codeload é o direto, e o /archive serve as redes que
// bloqueiam aquele domínio. Nome de repositório antigo não entra aqui: se não
// responde, cada tentativa só faz o streamer esperar o tempo limite à toa
// antes de o programa chegar no endereço que funciona.
const UPDATE_REPO = 'WardzdesouzA/OBSSocial';
const UPDATE_ZIP_URLS = process.env.OBS_SOCIAL_UPDATE_ZIP
  ? [process.env.OBS_SOCIAL_UPDATE_ZIP]
  : [
    `https://codeload.github.com/${UPDATE_REPO}/zip/refs/heads/main`,
    `https://github.com/${UPDATE_REPO}/archive/refs/heads/main.zip`,
  ];
let updateCache = null; // { buffer, latest, at }

// Preferências de atualização (data/update.json)
function loadUpdateConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'update.json'), 'utf8'));
    return { autoCheck: raw.autoCheck !== false }; // ligado por padrão
  } catch {
    return { autoCheck: true };
  }
}
const updateConfig = loadUpdateConfig();

function persistUpdateConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, 'update.json'), JSON.stringify(updateConfig, null, 2));
  } catch (err) {
    console.error('Não consegui salvar as opções de atualização:', err.message);
  }
}

// Baixa uma URL com o módulo http(s) do Node (mais tolerante que o fetch em
// redes problemáticas), seguindo redirecionamentos e com tempo limite.
function baixar(url, options = {}, redirects = 3) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('http:') ? require('http') : require('https');
    const req = mod.get(url, { ...options, headers: { 'User-Agent': 'OBS-Social', ...(options.headers || {}) } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        // Nunca aceitar sair de https para http no meio do caminho
        let destino;
        try { destino = new URL(res.headers.location, url); } catch {
          reject(new Error('redirecionamento com endereço inválido'));
          return;
        }
        if (url.startsWith('https:') && destino.protocol !== 'https:') {
          reject(new Error('a atualização tentou sair do https — recusado por segurança'));
          return;
        }
        // Redirecionamento: não repassa o token (o destino já vem com o dele)
        const next = { ...options };
        if (next.headers) { next.headers = { ...next.headers }; delete next.headers.Authorization; }
        resolve(baixar(destino.href, next, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('o GitHub respondeu ' + res.statusCode));
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(60000, () => req.destroy(new Error('tempo esgotado (60s)')));
    req.on('error', reject);
  });
}

function cmpVersions(a, b) {
  const pa = String(a || '0').split('.').map(Number);
  const pb = String(b || '0').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

// Leitor de ZIP mínimo (formato aberto): central directory + inflate do Node.
function zipEntries(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('arquivo baixado não é um ZIP válido');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compressedSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOffset = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    entries.push({ name, method, compressedSize, localOffset });
    off += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function zipRead(buf, entry) {
  const off = entry.localOffset;
  if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('entrada inválida no ZIP');
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  const data = buf.slice(start, start + entry.compressedSize);
  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error('compressão de ZIP não suportada: ' + entry.method);
}

// Quais QR codes de apoio existem em public/apoie (para a página 💖)
function listApoie() {
  try {
    return fs.readdirSync(path.join(PUBLIC_DIR, 'apoie')).filter((f) => /\.(png|jpe?g|svg)$/i.test(f));
  } catch { return []; }
}

// Certificados extras: os do sistema operacional (quando o Node oferece) e um
// PEM apontado por OBS_SOCIAL_EXTRA_CA. Resolve antivírus/firewall com
// "inspeção HTTPS", cujo certificado está no Windows mas não na lista do Node.
// A verificação TLS NUNCA é desligada — só ampliamos em quem confiar.
function extraCAs() {
  const cas = [];
  try {
    const tls = require('tls');
    if (typeof tls.getCACertificates === 'function') {
      cas.push(...tls.getCACertificates('default'), ...tls.getCACertificates('system'));
    }
  } catch {}
  try {
    if (process.env.OBS_SOCIAL_EXTRA_CA) cas.push(fs.readFileSync(process.env.OBS_SOCIAL_EXTRA_CA, 'utf8'));
  } catch {}
  return cas.length ? cas : null;
}

async function downloadUpdate() {
  // Tenta em ordem, para cada caminho do pacote: direto, IPv4 forçado (redes
  // em que o IPv6 "existe" mas não funciona) e certificados do sistema
  // (antivírus com inspeção HTTPS) — até funcionar.
  const cas = extraCAs();
  const tentativas = [];
  for (const url of UPDATE_ZIP_URLS) {
    tentativas.push([url, {}], [url, { family: 4 }]);
    if (cas) tentativas.push([url, { ca: cas }], [url, { ca: cas, family: 4 }]);
  }
  let ultimoErro = null;
  for (const [url, opts] of tentativas) {
    try {
      const buffer = await baixar(url, opts);
      const entries = zipEntries(buffer);
      const pkg = entries.find((e) => /^[^/]+\/package\.json$/.test(e.name));
      if (!pkg) throw new Error('não achei o package.json na atualização');
      const latest = JSON.parse(zipRead(buffer, pkg).toString('utf8')).version;
      updateCache = { buffer, latest, at: Date.now() };
      return updateCache;
    } catch (err) {
      ultimoErro = err;
      const causa = err?.cause?.code || err?.code || err.message;
      console.log(`  ⚠️ Atualização: falha ao baixar (${causa}) — tentando outro caminho...`);
    }
  }
  let causa = String(ultimoErro?.cause?.code || ultimoErro?.code || ultimoErro?.message || 'erro desconhecido');
  if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|DEPTH_ZERO/i.test(causa)) {
    causa += ' — parece um antivírus/firewall com "inspeção HTTPS" interceptando a conexão. Atualize o Node.js para a versão LTS mais nova em nodejs.org (aí o programa passa a confiar nos certificados do Windows) ou desative a inspeção HTTPS do antivírus para o Node.';
  } else if (/respondeu 40[134]/.test(causa)) {
    causa += ' — o pacote de atualização não está acessível agora. Tente de novo mais tarde.';
  }
  throw new Error(causa);
}

function applyUpdate(buffer) {
  const entries = zipEntries(buffer);
  let written = 0;
  for (const entry of entries) {
    if (entry.name.endsWith('/')) continue; // pastas
    // Tira a pasta raiz do ZIP e normaliza barras invertidas: no Windows,
    // "data\\x" ou "a\\..\\..\\x" driblariam as checagens feitas com "/"
    const rel = entry.name.split('/').slice(1).join('/').replace(/\\/g, '/');
    if (!rel || rel === 'data' || rel.startsWith('data/')) continue; // seus dados ficam intactos
    const target = path.join(__dirname, rel);
    if (!target.startsWith(__dirname + path.sep)) continue; // caminho malicioso: fora
    // Scripts de iniciar em execução não podem ser reescritos na hora (o cmd
    // do Windows leria bytes trocados) — ficam guardados como .novo e são
    // aplicados no momento seguro do reinício.
    if (/^Iniciar \(Windows\)\.bat$/i.test(rel) || rel === 'iniciar-mac-linux.command') {
      const conteudo = zipRead(buffer, entry);
      try {
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(conteudo)) {
          fs.writeFileSync(target + '.novo', conteudo);
        }
      } catch {}
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, zipRead(buffer, entry));
    written += 1;
  }
  return written;
}

// Troca os scripts de iniciar guardados como .novo (só em momento seguro,
// quando nenhuma janela está lendo o script).
function applyStagedLaunchers() {
  for (const nome of ['Iniciar (Windows).bat', 'iniciar-mac-linux.command']) {
    const novo = path.join(__dirname, nome + '.novo');
    try {
      if (fs.existsSync(novo)) {
        fs.copyFileSync(novo, path.join(__dirname, nome));
        fs.unlinkSync(novo);
      }
    } catch {}
  }
}

function hasStagedLaunchers() {
  return ['Iniciar (Windows).bat', 'iniciar-mac-linux.command']
    .some((nome) => fs.existsSync(path.join(__dirname, nome + '.novo')));
}

// Reabre o programa sozinho (após atualização ou pelo botão ♻️) e ENCERRA o
// processo — sem deixar janela antiga acumulada.
function relaunchApp() {
  const { spawn } = require('child_process');
  const doBat = process.env.OBS_SOCIAL_BAT === '1';
  if (doBat && !hasStagedLaunchers()) {
    // Script novo com laço: a MESMA janela reabre o programa. Nada acumula.
    process.exit(10);
  }
  // Nunca mexemos em outros processos (nem no cmd pai): antivírus tratam
  // "matar o processo pai" como comportamento de malware — e com razão.
  if (process.platform === 'win32' && fs.existsSync(path.join(__dirname, 'Iniciar (Windows).bat'))) {
    applyStagedLaunchers();
    spawn('cmd.exe', ['/c', 'start', 'OBS Social', 'Iniciar (Windows).bat'], {
      cwd: __dirname, detached: true, stdio: 'ignore',
    }).unref();
    console.log('  (Se a janela antiga pedir "pressione qualquer tecla", pode fechá-la — da próxima vez isso não acontece mais.)');
    process.exit(0);
  }
  applyStagedLaunchers();
  if (doBat) { process.exit(10); return; }
  spawn(process.execPath, [path.join(__dirname, 'server.js')], {
    cwd: __dirname, detached: true, stdio: 'ignore',
  }).unref();
  process.exit(0);
}

// 🔁 Busca automática de atualização (ao abrir e 1x por dia, opcional — só AVISA, nunca
// instala nada sozinho; o aviso vai apenas para o computador local).
function autoUpdateTick() {
  if (!updateConfig.autoCheck) return;
  downloadUpdate().then((cache) => {
    if (cmpVersions(cache.latest, APP_VERSION) > 0) {
      console.log('  ' + tcons('🎉 Versão nova disponível: v$1 (você está na v$2). Atualize em Configurações → ℹ️ Sobre.', cache.latest, APP_VERSION));
      const msg = JSON.stringify({ type: 'update', hasUpdate: true, current: APP_VERSION, latest: cache.latest, auto: true });
      for (const c of wss.clients) {
        if (c.readyState === 1 && c.role === 'local') c.send(msg);
      }
    }
  }).catch((err) => {
    console.log(`  (busca automática de atualização não conseguiu verificar: ${String(err.message).split(' — ')[0]})`);
  });
}
const autoUpdateFirst = setTimeout(autoUpdateTick, Number(process.env.OBS_SOCIAL_AUTOCHECK_DELAY_MS) || 5 * 1000);
const autoUpdateTimer = setInterval(autoUpdateTick, 24 * 60 * 60 * 1000);
if (autoUpdateFirst.unref) autoUpdateFirst.unref();
if (autoUpdateTimer.unref) autoUpdateTimer.unref();

const lastStatusLog = new Map();
function setStatus(platform, statusState, detail) {
  state.status[platform] = { ...(state.status[platform] || {}), state: statusState, detail };
  broadcast({ type: 'status', platform, status: state.status[platform] });
  // Erros de conexao tambem aparecem na janela preta (uma vez por causa),
  // para o usuario poder copiar e colar a mensagem exata.
  if (statusState === 'error' && lastStatusLog.get(platform) !== detail) {
    lastStatusLog.set(platform, detail);
    console.error(`  ⚠️ Conexão (${platform}): ${detail}`);
  }
}

// A Twitch nao manda a foto do autor junto com o chat; buscamos uma vez por
// usuario num servico publico (ivr.fi) e guardamos em cache.
// Quando um avatar e descoberto DEPOIS da primeira mensagem da pessoa, as
// mensagens que ja estao na memoria/fila ganham a foto retroativamente e os
// paineis/chat sao avisados (avatarFix) — a primeira mensagem nao fica mais
// sem foto para sempre.
function backfillAvatar(platform, chave, avatar) {
  if (!avatar || !chave) return;
  const alvo = String(chave).toLowerCase();
  const bate = (m) => m.platform === platform && !m.avatar
    && (String(m.authorLogin || '').toLowerCase() === alvo || String(m.author || '').toLowerCase() === alvo);
  for (const lista of [state.recent, feedQueue, feedReleasing]) {
    for (const m of lista) if (bate(m)) m.avatar = avatar;
  }
  if (state.featured && bate(state.featured)) state.featured.avatar = avatar;
  // 📌 v0.138: a fila guardada vai para o DISCO — sem isto, um comentário
  // mandado para a fila antes de a foto chegar ficava sem foto para sempre,
  // inclusive depois de fechar e abrir o programa
  let filaMudou = false;
  for (const m of state.saved) if (bate(m)) { m.avatar = avatar; filaMudou = true; }
  if (filaMudou) {
    persistSaved();
    broadcast({ type: 'saved', saved: state.saved });
  }
  for (const p of state.participants.values()) {
    if (p.platform === platform && !p.avatar && String(p.author || '').toLowerCase() === alvo) p.avatar = avatar;
  }
  broadcast({ type: 'avatarFix', platform, login: alvo, avatar });
}

const AVATAR_LOOKUP_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept': 'application/json',
};
function avatarCachePrune(cache) {
  if (cache.size > 5000) cache.clear(); // lives gigantes: recomeca leve
}

// 🖼️ v0.53: o cache de avatar guarda o ACHADO para sempre, mas a FALHA só por
// alguns minutos. Antes, um tropeço de rede num instante (ou um serviço fora
// do ar por 10 segundos) apagava a foto daquela pessoa pelo resto da live —
// era o "às vezes o avatar não aparece". Agora a próxima mensagem dela tenta
// de novo.
const AVATAR_FALHA_TTL = Number(process.env.OBS_TESTE_AVATAR_FALHA_MS) || 5 * 60 * 1000;
// undefined = nunca buscado (pode buscar) · string = achado · null = falhou faz pouco
function avatarEmCache(cache, chave) {
  const v = cache.get(chave);
  if (v === undefined) return undefined;
  if (typeof v === 'string') return v;
  if (v && Date.now() - v.falhouEm < AVATAR_FALHA_TTL) return null;
  cache.delete(chave); // a quarentena venceu: vale tentar de novo
  return undefined;
}
function guardarAvatar(cache, chave, url) {
  cache.set(chave, url || { falhouEm: Date.now() });
  avatarCachePrune(cache);
}
// Já foi procurado agora há pouco (ou está em andamento)?
const avatarJaTratado = (cache, pend, chave) => avatarEmCache(cache, chave) !== undefined || pend.has(chave);

const twitchAvatarCache = new Map();
const twitchAvatarPending = new Set();

// A Twitch tem duas fontes públicas conhecidas. Se a primeira falhar (fora do
// ar, limite de uso, rede tropeçando), a segunda ainda salva a foto — em vez
// de a pessoa ficar com as iniciais.
function lookupTwitchAvatar(login) {
  if (!login || avatarJaTratado(twitchAvatarCache, twitchAvatarPending, login)) return;
  twitchAvatarPending.add(login);
  const twBase = process.env.OBS_SOCIAL_TW_AVATAR_API || 'https://api.ivr.fi/v2/twitch/user?login=';
  const reserva = process.env.OBS_SOCIAL_TW_AVATAR_API2 || 'https://decapi.me/twitch/avatar/';
  const ehFoto = (u) => typeof u === 'string' && u.startsWith('https://') && !/error|not\s*found/i.test(u);
  fetch(twBase + encodeURIComponent(login), {
    headers: { 'User-Agent': 'obs-social', 'Accept': 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const logo = Array.isArray(data) ? data[0]?.logo : (data && data.logo);
      return ehFoto(logo) ? logo : null;
    })
    .catch(() => null)
    // Reserva: um serviço público que devolve só o endereço da foto, em texto
    .then((achado) => (achado || fetch(reserva + encodeURIComponent(login), { headers: { 'User-Agent': 'obs-social' }, signal: AbortSignal.timeout(10000) })
      .then((res) => (res.ok ? res.text() : ''))
      .then((txt) => { const u = String(txt || '').trim(); return ehFoto(u) ? u : null; })
      .catch(() => null)))
    .then((ok) => {
      guardarAvatar(twitchAvatarCache, login, ok);
      if (ok) backfillAvatar('twitch', login, ok);
    })
    .catch(() => guardarAvatar(twitchAvatarCache, login, null))
    .finally(() => twitchAvatarPending.delete(login));
}

// Avatar do Kick: a API publica do site traz a foto do perfil pelo slug
// (todo usuario do Kick tem um canal com o proprio nome).
const kickAvatarCache = new Map();
const kickAvatarPending = new Set();
function lookupKickAvatar(slug) {
  if (!slug || avatarJaTratado(kickAvatarCache, kickAvatarPending, slug)) return;
  kickAvatarPending.add(slug);
  const kickBase = process.env.OBS_SOCIAL_KICK_AVATAR_API || 'https://kick.com/api/v2/channels/';
  fetch(kickBase + encodeURIComponent(slug), { headers: AVATAR_LOOKUP_HEADERS, signal: AbortSignal.timeout(10000) })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const pic = data?.user?.profile_pic;
      const ok = typeof pic === 'string' && pic.startsWith('https://') ? pic : null;
      guardarAvatar(kickAvatarCache, slug, ok);
      if (ok) backfillAvatar('kick', slug, ok);
    })
    .catch(() => guardarAvatar(kickAvatarCache, slug, null))
    .finally(() => kickAvatarPending.delete(slug));
}

// Avatar da Bilibili: a API publica de cartao de usuario traz a foto pelo uid.
const biliAvatarCache = new Map();
const biliAvatarPending = new Set();
function lookupBiliAvatar(uid) {
  if (!uid || avatarJaTratado(biliAvatarCache, biliAvatarPending, uid)) return;
  biliAvatarPending.add(uid);
  const biliBase = process.env.OBS_SOCIAL_BILI_AVATAR_API || 'https://api.bilibili.com/x/web-interface/card?mid=';
  fetch(biliBase + encodeURIComponent(uid), { headers: AVATAR_LOOKUP_HEADERS })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      let face = data?.data?.card?.face;
      if (typeof face === 'string') face = face.replace(/^http:\/\//, 'https://');
      const ok = typeof face === 'string' && face.startsWith('https://') && !face.includes('noface') ? face : null;
      guardarAvatar(biliAvatarCache, uid, ok);
      if (ok) backfillAvatar('bilibili', uid, ok);
    })
    .catch(() => guardarAvatar(biliAvatarCache, uid, null))
    .finally(() => biliAvatarPending.delete(uid));
}

// 🖼️ v0.138: quem ficou sem foto ganha uma segunda chance sozinho.
// A procura só acontecia quando a pessoa escrevia. Se o serviço público
// tropeçou naquele instante (muito comum nos primeiros segundos da live,
// quando o robô do canal e a plateia chegam todos juntos), quem escreveu uma
// vez só ficava com as iniciais o resto da live. De tempos em tempos o
// programa volta a procurar a foto de quem está na tela — poucos por vez e no
// máximo três voltas por pessoa, para não pesar em nada nem insistir à toa
// numa conta que não existe mais.
const AVATAR_VARREDURA_MS = Number(process.env.OBS_TESTE_AVATAR_VARREDURA_MS) || 90 * 1000;
const AVATAR_POR_VARREDURA = 8;
const AVATAR_MAX_VOLTAS = 3;
const avatarVoltas = new Map(); // 'rede:login' -> quantas vezes ja voltamos
function varrerAvataresFaltantes() {
  const fontes = {
    twitch: [twitchAvatarCache, twitchAvatarPending, lookupTwitchAvatar],
    kick: [kickAvatarCache, kickAvatarPending, lookupKickAvatar],
    bilibili: [biliAvatarCache, biliAvatarPending, lookupBiliAvatar],
  };
  if (avatarVoltas.size > 5000) avatarVoltas.clear(); // lives gigantes: recomeca leve
  const vistos = new Set();
  let pedidos = 0;
  const listas = [state.recent, state.saved, feedQueue, feedReleasing, state.featured ? [state.featured] : []];
  for (const lista of listas) {
    for (const m of lista) {
      if (pedidos >= AVATAR_POR_VARREDURA) return;
      if (!m || m.avatar || !m.authorLogin) continue;
      const fonte = fontes[m.platform];
      if (!fonte) continue;
      const chave = m.platform + ':' + m.authorLogin;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      // achado, em andamento ou na quarentena dos 5 minutos: nao mexe
      if (avatarJaTratado(fonte[0], fonte[1], m.authorLogin)) continue;
      const voltas = avatarVoltas.get(chave) || 0;
      if (voltas >= AVATAR_MAX_VOLTAS) continue;
      avatarVoltas.set(chave, voltas + 1);
      fonte[2](m.authorLogin);
      pedidos += 1;
    }
  }
}

// Descobre o nivel de sub/membro pela mensagem (selos publicos do chat).
// Mensagens antigas (logs) podem nao ter subTier: cai para os selos genericos.
function tierFromMessage(message) {
  if (message.subTier) return message.subTier;
  const badges = message.badges || [];
  if (badges.includes('membro')) return 'member';
  if (message.platform === 'kick' && badges.includes('founder')) return 'kickFounder';
  if (badges.includes('sub') || badges.includes('founder')) {
    return message.platform === 'kick' ? 'kick' : 't1';
  }
  return null;
}

// Aviso de participantes: o total e a conta de cada rede (o painel usa o
// segundo para o 3º contador de cada coluna)
let participantesPendente = null;
function broadcastParticipantes() {
  // Em fluxo pesado isso seria uma mensagem por comentário: junta num pacote
  if (participantesPendente) return;
  participantesPendente = setTimeout(() => {
    participantesPendente = null;
    broadcast({
      type: 'participants',
      count: state.participants.size,
      porRede: participantesPorRede(),
      fichas: fichasTotais(),
    });
  }, 400);
}

// 🎁 v0.127.1: quem é quem no sorteio. O nome exibido não é único (no
// YouTube qualquer um se chama como o ganhador) — o que vale é o
// identificador que a rede dá (id do canal, login da Twitch, número...).
// Sem identificador (redes antigas/históricos), fica o nome como antes.
function chaveParticipante(message) {
  const id = message.authorId || message.authorLogin;
  return message.platform + ':' + (id ? 'id:' + String(id).toLowerCase() : String(message.author || '').toLowerCase());
}

function trackParticipant(message, notify = true) {
  // 🤖 Robôs de chat não concorrem: quem carrega o selo BOT fica de fora
  if ((message.badges || []).includes('bot')) return;
  // 📨/💬 Telegram e WhatsApp so concorrem se o seletor do sorteio estiver ligado
  const confSorteio = state.settings.raffle || {};
  if (message.platform === 'telegram' && confSorteio.telegramSorteio !== true) return;
  if (message.platform === 'whatsapp' && confSorteio.whatsappSorteio !== true) return;
  // 🔑 v0.116: com palavras de entrada definidas, so entra quem digitou uma
  const palavras = Array.isArray(confSorteio.palavras) ? confSorteio.palavras : [];
  if (palavras.length && !mensagemTemPalavraDoSorteio(message, palavras)) return;
  const key = chaveParticipante(message);
  const existing = state.participants.get(key);
  const tier = tierFromMessage(message);
  state.participants.set(key, {
    chave: key,
    author: message.author,
    platform: message.platform,
    avatar: message.avatar || (existing ? existing.avatar : null),
    subTier: tier || existing?.subTier || null,
    memberLevel: message.memberLevel || existing?.memberLevel || null,
  });
  if (notify) broadcastParticipantes();
}

// Quantas fichas cada participante vale, seguindo a configuracao do sorteio.
// Calculado na hora do sorteio, entao mudar a configuracao vale na hora.
function raffleWeightFor(p) {
  const conf = state.settings.raffle || {};
  const clampW = (v, fallback) => Math.max(1, Math.min(100, Number(v) || fallback));
  // 📨/💬 Telegram/WhatsApp: com o seletor desligado, quem ja estava na lista
  // vale 0 ficha (nao conta no total e nunca e sorteado)
  if (p.platform === 'telegram') {
    if (conf.telegramSorteio !== true) return 0;
    return conf.extraTokens === false ? 1 : clampW(conf.telegramFichas, 1);
  }
  if (p.platform === 'whatsapp') {
    if (conf.whatsappSorteio !== true) return 0;
    return conf.extraTokens === false ? 1 : clampW(conf.whatsappFichas, 1);
  }
  if (conf.extraTokens === false) return 1; // sorteio aberto: 1 ficha pra todos
  const w = conf.weights || {};
  if (!p.subTier) return 1;
  if (p.platform === 'twitch') {
    if (p.subTier === 'prime') return clampW(w.prime, 2);
    if (p.subTier === 'twitchFounder') return clampW(w.twitchFounder, 5);
    if (p.subTier === 't2') return clampW(w.subT2, 3);
    if (p.subTier === 't3') return clampW(w.subT3, 4);
    return clampW(w.subT1, 2);
  }
  if (p.platform === 'kick') {
    return p.subTier === 'kickFounder' ? clampW(w.kickFounder, 5) : clampW(w.kickSub, 2);
  }
  if (p.platform === 'youtube') {
    // Niveis nomeados do YouTube (avancado): "Nome do nivel=fichas" por linha
    const level = normSearch(p.memberLevel || '');
    if (level) {
      for (const line of String(conf.ytLevels || '').split('\n')) {
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const name = normSearch(line.slice(0, eq).trim());
        const value = line.slice(eq + 1).trim();
        if (name && level.includes(name)) return clampW(value, 2);
      }
    }
    return clampW(w.ytMember, 2);
  }
  return clampW(2, 2);
}

// ---------------------------------------------------------------------------
// Log de comentarios em disco (um arquivo por dia).
// Se o programa reiniciar, o feed e os participantes do sorteio sao
// recuperados do log do dia — nenhum comentario recebido se perde.

const LOGS_DIR = path.join(DATA_DIR, 'logs');

function todayLogPath() {
  const now = new Date();
  const name = `chat-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}.jsonl`;
  return path.join(LOGS_DIR, name);
}

let logErrorShown = false;
function appendLog(entry) {
  try {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
    fs.appendFile(todayLogPath(), JSON.stringify(entry) + '\n', (err) => {
      if (err && !logErrorShown) {
        logErrorShown = true;
        console.error('Não consegui gravar o log de comentários:', err.message);
      }
    });
  } catch (err) {
    if (!logErrorShown) {
      logErrorShown = true;
      console.error('Não consegui gravar o log de comentários:', err.message);
    }
  }
}

function logsInfo() {
  try {
    const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.jsonl'));
    let bytes = 0;
    for (const file of files) {
      try { bytes += fs.statSync(path.join(LOGS_DIR, file)).size; } catch {}
    }
    return { files: files.length, bytes };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

// Limpeza automatica: apaga logs mais antigos que o numero de dias configurado.
function cleanOldLogs() {
  const days = Math.max(0, Math.min(365, Number(state.settings.logRetentionDays) || 0));
  if (days > 0) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    try {
      for (const file of fs.readdirSync(LOGS_DIR)) {
        const match = file.match(/^chat-(\d{4})-(\d{2})-(\d{2})\.jsonl$/);
        if (!match) continue;
        const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime();
        if (fileDate < cutoff) {
          try { fs.unlinkSync(path.join(LOGS_DIR, file)); } catch {}
        }
      }
    } catch {}
  }
  broadcast({ type: 'logs', logs: logsInfo(), dados: resumoDados() });
}

function clearAllLogs() {
  try {
    for (const file of fs.readdirSync(LOGS_DIR)) {
      if (file.endsWith('.jsonl')) {
        try { fs.unlinkSync(path.join(LOGS_DIR, file)); } catch {}
      }
    }
  } catch {}
  broadcast({ type: 'logs', logs: logsInfo(), dados: resumoDados() });
}

// ---------------------------------------------------------------------------
// 🧹 Central de limpeza (Configurações → 🗄️ Logs e dados)
//
// Cada escopo apaga SO o que promete. O escopo 'tudo' é o crítico: devolve o
// programa ao estado de recém-instalado (a interface exige digitar APAGAR).
// Nada aqui toca em arquivos fora de data/ — e o programa segue rodando.
function tamanhoDaPasta(dir) {
  let bytes = 0, arquivos = 0;
  try {
    for (const nome of fs.readdirSync(dir)) {
      try {
        const st = fs.statSync(path.join(dir, nome));
        if (st.isFile()) { bytes += st.size; arquivos++; }
      } catch {}
    }
  } catch {}
  return { bytes, arquivos };
}

// Resumo mostrado nos botões da interface (o que existe para apagar)
function resumoDados() {
  const arquivo = (nome) => {
    try { return fs.statSync(path.join(DATA_DIR, nome)).size; } catch { return 0; }
  };
  const uploads = tamanhoDaPasta(UPLOADS_DIR);
  const logs = logsInfo();
  return {
    logs: { arquivos: logs.files, bytes: logs.bytes },
    midias: { arquivos: uploads.arquivos, bytes: uploads.bytes },
    marcas: { lidos: state.readIds.size, fila: state.saved.length, bytes: arquivo('read.json') + arquivo('saved.json') },
    participantes: { total: state.participants.size },
    conexoes: { total: Object.keys(state.connections || {}).length, bytes: arquivo('connections.json') },
    ferramentas: { qrs: (state.qrs || []).length, winstreaks: (state.winstreaks || []).length, avisos: (state.avisos || []).length, bytes: arquivo('qrcodes.json') + arquivo('winstreak.json') + arquivo('avisos.json') },
    // 🎭 Os perfis de overlay são configurações com nome: contam juntos
    configuracoes: { bytes: arquivo('settings.json') + arquivo('perfis-overlay.json') },
  };
}

function apagarArquivos(nomes) {
  for (const nome of nomes) {
    try { fs.unlinkSync(path.join(DATA_DIR, nome)); } catch {}
  }
}

function limparDados(escopo) {
  const feito = [];
  const tudo = escopo === 'tudo';

  if (tudo || escopo === 'logs') {
    clearAllLogs();
    // Os contadores do painel contam o dia inteiro a partir do log: sem log,
    // eles voltam a zero junto (senão mostrariam um total sem lastro)
    for (const k of Object.keys(platformTotals)) delete platformTotals[k];
    categoryTotals.superchat = 0; categoryTotals.member = 0; categoryTotals.whatsapp = 0; categoryTotals.telegram = 0; categoryTotals.apoio = 0;
    state.recent = [];
    state.recentByPlatform = {};
    feedPendingBroadcast();
    broadcast({ type: 'init-totais', feedTotals: { ...platformTotals }, categoryTotals: { ...categoryTotals } });
    feito.push('logs');
  }
  if (tudo || escopo === 'midias') {
    try {
      for (const nome of fs.readdirSync(UPLOADS_DIR)) {
        try { fs.unlinkSync(path.join(UPLOADS_DIR, nome)); } catch {}
      }
    } catch {}
    // 📚 v0.88: a biblioteca da Mesa (uploads/trilhas/) sai junto
    try { fs.rmSync(TRILHAS_UP_DIR, { recursive: true, force: true }); } catch {}
    broadcast({ type: 'media', media: listMedia() });
    feito.push('midias');
  }
  if (tudo || escopo === 'marcas') {
    // Marcas de "lido" e a fila de comentários guardados
    state.readIds = new Map();
    state.saved = [];
    persistRead();
    persistSaved();
    broadcast({ type: 'saved', saved: state.saved });
    feito.push('marcas');
  }
  if (tudo || escopo === 'participantes') {
    state.participants = new Map();
    broadcast({ type: 'raffle', raffle: { ...state.raffle, participants: 0 } });
    broadcast({ type: 'participants', count: 0, porRede: {}, fichas: 0 });
    feito.push('participantes');
  }
  if (tudo || escopo === 'conexoes') {
    for (const plataforma of Object.keys(state.connectors || {})) {
      try { disconnect(plataforma); } catch {}
    }
    state.connections = {};
    persistConnections();
    // 🎬 A conexão com o OBS também é uma conexão: esquece porta e senha
    obsConfig.host = '127.0.0.1';
    obsConfig.port = 4455;
    obsConfig.password = '';
    apagarArquivos(['obs.json']);
    desligarObs(null);
    broadcastObs();
    // 🎛️ v0.122: o vMix também
    vmixConfig.host = '127.0.0.1';
    vmixConfig.port = 8099;
    apagarArquivos(['vmix.json']);
    desligarVmix(null);
    broadcastVmix();
    feito.push('conexoes');
  }
  if (tudo || escopo === 'ferramentas') {
    state.qrs = [];
    state.winstreaks = [];
    state.trilhas = [];
    state.avisos = [defaultAviso()]; // 📢 v0.128: o principal fica (vazio)
    pararTrilha();
    persistQrs();
    persistWinstreaks();
    persistTrilhas();
    persistAvisos();
    broadcast({ type: 'qr', qrs: state.qrs });
    broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
    broadcast({ type: 'trilhas', trilhas: state.trilhas });
    broadcastAvisos();
    feito.push('ferramentas');
  }
  if (tudo) {
    // Volta às configurações de fábrica (mantém a senha da rede: quem apaga
    // não fica trancado fora, e removê-la é decisão separada em Segurança)
    state.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
    // 🎭 Os perfis de overlay são configurações com nome: zeram junto
    state.perfisOverlay = [];
    persistPerfisOverlay();
    broadcast({ type: 'perfisOverlay', perfis: [] });
    // Grava JÁ (sem o debounce): o programa vai reiniciar em seguida
    saveSettingsAgora();
    apagarArquivos(['update.json', 'clipboard.txt']);
    for (const e of state.clipboard || []) clipApagarArquivoFisico(e);
    try { fs.rmSync(CLIP_DIR, { recursive: true, force: true }); } catch {}
    state.clipboard = [];
    // Grava JÁ, como as configurações: o programa vai reiniciar em seguida
    persistClipboardAgora();
    clipboardAvisar();
    broadcast({ type: 'settings', settings: state.settings });
    feito.push('configuracoes');
  }

  broadcast({ type: 'logs', logs: logsInfo(), dados: resumoDados() });
  broadcast({ type: 'dados', dados: resumoDados() });
  console.log(`  🧹 Limpeza (${escopo}): ${feito.join(', ') || 'nada'}.`);
  return { ok: true, feito, dados: resumoDados() };
}

// ---------------------------------------------------------------------------
// 💾 Backup e restauração (Configurações → 🗄️ Logs e dados)
//
// Cada item de dados pode ser copiado para uma pasta À ESCOLHA do usuário —
// manualmente, em tempo real (assim que algo muda) ou num relógio (1s a 24h).
// Cada backup vira uma sub-pasta com data e hora; nada fora dela é tocado.
// Um backup agendado SÓ grava quando algo mudou de verdade (nada de cópias
// repetidas enchendo o disco), e os 30 mais recentes de cada item ficam.
const BACKUP_ITENS = {
  logs: { dirs: () => [LOGS_DIR] },
  midias: { dirs: () => [UPLOADS_DIR] },
  marcas: { files: () => [READ_FILE, SAVED_FILE] },
  // Participantes vivem na memória (nascem do log do dia): o backup grava uma
  // fotografia própria, e a restauração devolve a lista inteira ao sorteio
  participantes: { gerar: () => ({ 'participantes.json': JSON.stringify([...state.participants.entries()], null, 2) }) },
  // 🔑 v0.90.1: a CHAVE local viaja junto. Sem ela, restaurar este item
  // numa instalação nova traz os arquivos cifrados e nada mais — a senha do
  // OBS e os tokens voltariam vazios, sem avisar. A chave é o que abre o
  // backup do próprio streamer; ela mora na pasta de backup dele.
  conexoes: { files: () => [CONNECTIONS_FILE, OBS_FILE, CHAVE_LOCAL_FILE, VMIX_FILE, CONTROLE_FILE] },
  ferramentas: { files: () => [QRS_FILE, WINSTREAK_FILE, TRILHAS_FILE, AVISOS_FILE] },
  // O arquivo pode estar "atrasado" pelo debounce: grava antes de copiar.
  // A assinatura é o CONTEÚDO (não o relógio do arquivo): salvar sem mudar
  // nada não pode virar um backup repetido.
  configuracoes: {
    antes: () => saveSettingsAgora(),
    // 🎭 Os perfis de overlay são "configurações com nome": viajam juntos
    files: () => [SETTINGS_FILE, PERFIS_FILE],
    assinatura: () => JSON.stringify(state.settings) + JSON.stringify(state.perfisOverlay),
  },
};
const BACKUP_FREQ_RE = /^(manual|temporeal|([1-9]|[1-5][0-9]|60)s|([1-9]|[1-5][0-9]|60)min|6h|12h|24h)$/;
// 🔒 v0.127.1: teto para os textos das configurações (20 mil caracteres;
// o CSS personalizado pode ter 100 mil). Corta no lugar, sem mudar o resto.
function limitarTextos(obj, prof = 0) {
  if (!obj || typeof obj !== 'object' || prof > 8) return;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (typeof v === 'string') {
      const teto = /customcss/i.test(k) ? 100000 : 20000;
      if (v.length > teto) obj[k] = v.slice(0, teto);
    } else if (v && typeof v === 'object') limitarTextos(v, prof + 1);
  }
}

// Só itens DECLARADOS acima valem: um nome como '__proto__' devolveria o
// protótipo de Object (verdadeiro!) no acesso direto e passaria batido
const backupItemDef = (item) => (Object.prototype.hasOwnProperty.call(BACKUP_ITENS, item) ? BACKUP_ITENS[item] : null);
const backupEstado = {}; // item -> { ultimo, marca, erro, pulado, assinatura, rodouEm }

function backupBase() {
  const escolhida = String(state.settings.backup?.pasta || '').trim();
  // Sub-pasta com o nome do programa: apontar para Documentos não espalha nada
  const base = path.resolve(escolhida || DATA_DIR);
  // 🔒 v0.127.1: a pasta do backup NUNCA pode ser uma que o servidor entrega
  // pela rede (public/, uploads/) — senão as cópias das conexões (com a chave
  // que protege as senhas) viravam arquivos baixáveis por qualquer um da rede.
  // Caminhos de rede (\\servidor\pasta) também não: o backup é local.
  const proibidas = [PUBLIC_DIR, UPLOADS_DIR, __dirname];
  const dentro = (p, dir) => p === dir || p.startsWith(dir + path.sep);
  if (/^\\\\/.test(escolhida) || dentro(base, PUBLIC_DIR) || dentro(base, UPLOADS_DIR)
    || (dentro(base, __dirname) && !dentro(base, DATA_DIR))) {
    return path.join(DATA_DIR, 'obs-social-backup');
  }
  void proibidas;
  return path.join(base, 'obs-social-backup');
}

// O que existe agora, em (nome, tamanho, mtime) — muda a assinatura, muda o dado
function assinaturaDoItem(item) {
  const def = backupItemDef(item);
  if (!def) return '';
  if (def.assinatura) return def.assinatura();
  const partes = [];
  const umArquivo = (p) => {
    try { const st = fs.statSync(p); partes.push(`${path.basename(p)}:${st.size}:${Math.round(st.mtimeMs)}`); }
    catch { partes.push(`${path.basename(p)}:x`); }
  };
  for (const p of def.files ? def.files() : []) umArquivo(p);
  for (const dir of def.dirs ? def.dirs() : []) {
    try { for (const nome of fs.readdirSync(dir).sort()) umArquivo(path.join(dir, nome)); }
    catch { partes.push('dir:x'); }
  }
  if (def.gerar) {
    for (const [nome, conteudo] of Object.entries(def.gerar())) partes.push(`${nome}:${conteudo.length}`);
  }
  return partes.join('|');
}

function marcaAgora() {
  const d = new Date();
  const p2 = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
}

function fazerBackup(item, forcado = false) {
  const def = backupItemDef(item);
  if (!def) return { ok: false, erro: 'item desconhecido' };
  const est = backupEstado[item] || (backupEstado[item] = {});
  try {
    const assinatura = assinaturaDoItem(item);
    if (!forcado && assinatura === est.assinatura) { est.pulado = Date.now(); return { ok: true, semMudanca: true }; }
    if (def.antes) def.antes(); // ex.: descarrega o debounce das configurações
    const marca = marcaAgora();
    const destino = path.join(backupBase(), item, marca);
    fs.mkdirSync(destino, { recursive: true });
    let algum = false;
    for (const p of def.files ? def.files() : []) {
      try { fs.copyFileSync(p, path.join(destino, path.basename(p))); algum = true; } catch { /* item ainda sem arquivo */ }
    }
    for (const dir of def.dirs ? def.dirs() : []) {
      try {
        if (fs.readdirSync(dir).length) { fs.cpSync(dir, destino, { recursive: true }); algum = true; }
      } catch { /* pasta ainda não existe */ }
    }
    if (def.gerar) {
      for (const [nome, conteudo] of Object.entries(def.gerar())) {
        fs.writeFileSync(path.join(destino, nome), conteudo);
        algum = true;
      }
    }
    if (!algum) { try { fs.rmSync(destino, { recursive: true, force: true }); } catch {} est.assinatura = assinatura; return { ok: true, vazio: true }; }
    est.assinatura = assinatura;
    est.ultimo = Date.now();
    est.marca = marca;
    est.erro = null;
    // Rotação: os 30 mais recentes ficam, o resto sai
    try {
      const pastaItem = path.join(backupBase(), item);
      const marcas = fs.readdirSync(pastaItem).filter((n) => /^[0-9_\-]+$/.test(n)).sort().reverse();
      for (const velha of marcas.slice(30)) fs.rmSync(path.join(pastaItem, velha), { recursive: true, force: true });
    } catch {}
    return { ok: true, marca };
  } catch (err) {
    est.erro = err.message;
    return { ok: false, erro: err.message };
  }
}

function listarBackups(item) {
  try {
    return fs.readdirSync(path.join(backupBase(), item))
      .filter((n) => /^[0-9_\-]+$/.test(n)).sort().reverse().slice(0, 30);
  } catch { return []; }
}

function resumoBackup() {
  const itens = {};
  for (const item of Object.keys(BACKUP_ITENS)) {
    const est = backupEstado[item] || {};
    itens[item] = { ultimo: est.ultimo || null, marca: est.marca || null, erro: est.erro || null, marcas: listarBackups(item) };
  }
  return { pasta: backupBase(), itens };
}
// 🔒 v0.127.1: a pasta e as marcas do backup são assunto do computador do
// streamer (como no init) — não vão para quem está na rede
function broadcastBackup() {
  const mensagem = JSON.stringify({ type: 'backup', backup: resumoBackup() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.role === 'local') client.send(mensagem);
  }
}

function restaurarBackup(item, marcaBruta) {
  const def = backupItemDef(item);
  const marca = String(marcaBruta || '');
  if (!def) return { ok: false, erro: 'item desconhecido' };
  if (!/^[0-9_\-]+$/.test(marca)) return { ok: false, erro: 'marca inválida' };
  const origem = path.join(backupBase(), item, marca);
  try {
    if (!fs.statSync(origem).isDirectory()) throw new Error('não é uma pasta');
  } catch { return { ok: false, erro: 'esse backup não existe mais na pasta' }; }
  try {
    // Só os arquivos que o item CONHECE voltam para os lugares deles — nada
    // de um arquivo estranho dentro do backup parar fora de data/
    const alvosPorNome = new Map();
    for (const p of def.files ? def.files() : []) alvosPorNome.set(path.basename(p), p);
    for (const [nome, alvo] of alvosPorNome) {
      const de = path.join(origem, nome);
      try { fs.copyFileSync(de, alvo); } catch { /* o backup pode não ter esse arquivo */ }
    }
    for (const dir of def.dirs ? def.dirs() : []) {
      // Conteúdo do backup entra por cima (mesmos nomes são substituídos)
      for (const nome of fs.readdirSync(origem)) {
        const de = path.join(origem, nome);
        const para = path.join(dir, path.basename(nome));
        if (!para.startsWith(dir)) continue;
        try { fs.cpSync(de, para, { recursive: true }); } catch {}
      }
    }
    // O que dá para reviver sem reiniciar, revive agora
    if (item === 'marcas') {
      state.readIds = loadRead();
      state.saved = loadSaved();
      broadcast({ type: 'saved', saved: state.saved });
    } else if (item === 'conexoes') {
      // 🔑 v0.90.1: a chave do backup entra ANTES de reler os arquivos —
      // é ela que abre a senha do OBS e os tokens que acabaram de voltar
      recarregarChaveLocal();
      state.connections = loadConnections();
      // A configuração do OBS voltou do backup: religa com ela
      Object.assign(obsConfig, loadObsConfig());
      desligarObs(null);
      if (state.settings.labs?.obs === true) conectarObs(); else broadcastObs();
      // 🎛️ v0.122: a do vMix idem
      Object.assign(vmixConfig, loadVmixConfig());
      desligarVmix(null);
      if (state.settings.labs?.vmix === true) conectarVmix(); else broadcastVmix();
      // 💠 E a do Pix também: rearranca a consulta com o que voltou
      Object.assign(pixConfig, loadPixConfig());
      arrancarPix();
    } else if (item === 'ferramentas') {
      state.qrs = loadQrs();
      state.winstreaks = loadWinstreaks();
      state.trilhas = loadTrilhas();
      state.avisos = loadAvisos(); // 📢 v0.128
      pararTrilha();
      broadcast({ type: 'qr', qrs: state.qrs });
      broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
      broadcast({ type: 'trilhas', trilhas: state.trilhas });
      broadcastAvisos();
    } else if (item === 'participantes') {
      const bruto = JSON.parse(fs.readFileSync(path.join(origem, 'participantes.json'), 'utf8'));
      // Só entradas com cara de participante: um arquivo mexido não pode
      // deixar um "null" na lista (estourava no próximo cálculo de fichas)
      const validas = (Array.isArray(bruto) ? bruto : []).filter((e) => Array.isArray(e) && typeof e[0] === 'string'
        && e[1] && typeof e[1] === 'object' && typeof e[1].platform === 'string' && typeof e[1].author === 'string');
      state.participants = new Map(validas);
      broadcast({ type: 'participants', count: state.participants.size, porRede: participantesPorRede(), fichas: fichasTotais() });
      broadcast({ type: 'raffle', raffle: { ...state.raffle, participants: state.participants.size } });
    } else if (item === 'configuracoes') {
      const bruto = JSON.parse(fs.readFileSync(path.join(origem, path.basename(SETTINGS_FILE)), 'utf8'));
      state.settings = mergeSettings(bruto);
      saveSettingsAgora();
      broadcast({ type: 'settings', settings: state.settings });
      // 🎭 Perfis de overlay: o arquivo já voltou para o lugar; relê e avisa.
      // Backup de uma época SEM perfis (o arquivo não existe lá): a restauração
      // volta para "nenhum perfil" — senão o usuário ficava com um híbrido de
      // configurações antigas e moldes novos, sem aviso.
      if (fs.existsSync(path.join(origem, path.basename(PERFIS_FILE)))) {
        state.perfisOverlay = loadPerfisOverlay();
      } else {
        state.perfisOverlay = [];
        persistPerfisOverlay();
      }
      broadcast({ type: 'perfisOverlay', perfis: state.perfisOverlay });
    } else if (item === 'midias') {
      broadcast({ type: 'media', media: listMedia() });
    }
    broadcast({ type: 'dados', dados: resumoDados() });
    console.log(`  💾 Backup restaurado: ${item} (${marca}).`);
    // Logs restaurados só entram no painel num reinício (o dia é relido do disco)
    return { ok: true, precisaReiniciar: item === 'logs' };
  } catch (err) {
    return { ok: false, erro: err.message };
  }
}

// O relógio do backup: a cada segundo, roda o que estiver vencido.
// "temporeal" = confere a cada segundo e grava só quando algo mudou.
const BACKUP_MS = (freq) => {
  if (freq === 'temporeal') return 1000;
  let m = /^(\d+)s$/.exec(freq); if (m) return Number(m[1]) * 1000;
  m = /^(\d+)min$/.exec(freq); if (m) return Number(m[1]) * 60000;
  m = /^(\d+)h$/.exec(freq); if (m) return Number(m[1]) * 3600000;
  return null; // manual
};
const backupTimer = setInterval(() => {
  try {
    const conf = state.settings.backup || {};
    let mudou = false;
    for (const item of Object.keys(BACKUP_ITENS)) {
      let ms = BACKUP_MS(String((conf.itens || {})[item] || 'manual'));
      if (!ms) continue;
      // 🖼️ As mídias podem ter gigabytes: a cópia trava o programa enquanto
      // roda, então ela nunca repete em menos de 1 minuto
      if (item === 'midias') ms = Math.max(ms, 60000);
      const est = backupEstado[item] || (backupEstado[item] = {});
      if (est.rodouEm && Date.now() - est.rodouEm < ms) continue;
      est.rodouEm = Date.now();
      const r = fazerBackup(item);
      if (r.ok && r.marca) mudou = true;
    }
    if (mudou) broadcastBackup();
  } catch { /* o backup nunca pode derrubar a live */ }
}, 1000);
if (backupTimer.unref) backupTimer.unref();

// ---------- Busca global de comentarios ----------
// Varre os logs em disco (todos os dias guardados), nao so o que esta na
// memoria do painel — mesmo com centenas de paginas o comentario aparece.
const SEARCH_MAX_RESULTS = 300;
const SEARCH_MAX_BYTES = 40 * 1024 * 1024; // orcamento de leitura por busca

function normSearch(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function messageSearchText(message) {
  const text = (message.runs || []).map((r) => (r.type === 'emote' ? (r.alt || '') : (r.text || ''))).join('');
  return normSearch((message.author || '') + ' ' + text);
}

function searchLogs(query) {
  const q = normSearch(String(query || '').trim());
  if (!q) return { results: [], truncated: false };
  let files = [];
  try {
    files = fs.readdirSync(LOGS_DIR)
      .filter((f) => /^chat-\d{4}-\d{2}-\d{2}\.jsonl$/.test(f))
      .sort().reverse(); // dias mais novos primeiro
  } catch { return { results: [], truncated: false }; }

  const results = []; // mais novos primeiro
  const seen = new Set();
  let bytesLeft = SEARCH_MAX_BYTES;
  let truncated = false;

  for (const file of files) {
    if (results.length >= SEARCH_MAX_RESULTS || bytesLeft <= 0) { truncated = true; break; }
    let text;
    try {
      const filePath = path.join(LOGS_DIR, file);
      const stat = fs.statSync(filePath);
      if (stat.size > bytesLeft) {
        // Le so o final (a parte mais recente) que cabe no orcamento
        const fd = fs.openSync(filePath, 'r');
        const buffer = Buffer.alloc(bytesLeft);
        fs.readSync(fd, buffer, 0, bytesLeft, stat.size - bytesLeft);
        fs.closeSync(fd);
        text = buffer.toString('utf8');
        text = text.slice(text.indexOf('\n') + 1);
        truncated = true;
        bytesLeft = 0;
      } else {
        text = fs.readFileSync(filePath, 'utf8');
        bytesLeft -= stat.size;
      }
    } catch { continue; }

    const dayMatches = [];
    for (const line of text.split('\n')) {
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.t === 'chat' && entry.m && entry.m.id && !seen.has(entry.m.id)
            && messageSearchText(entry.m).includes(q)) {
          seen.add(entry.m.id);
          dayMatches.push(entry.m);
        }
      } catch {}
    }
    // Dentro do dia o log e cronologico; invertendo, os mais novos vem primeiro
    for (let i = dayMatches.length - 1; i >= 0; i--) {
      if (results.length >= SEARCH_MAX_RESULTS) { truncated = true; break; }
      results.push(dayMatches[i]);
    }
  }
  return { results, truncated };
}

function restoreFromLog() {
  try {
    const logPath = todayLogPath();
    const stat = fs.statSync(logPath);
    // O arquivo é lido INTEIRO, em pedaços, para os contadores do dia serem os
    // verdadeiros — antes só os últimos 5 MB entravam na conta e, numa live
    // grande, o total do painel ficava bem abaixo do real. Na memória de
    // exibição continua cabendo só o pedaço final (MAX_RECENT).
    const PEDACO = 2 * 1024 * 1024;
    const fd = fs.openSync(logPath, 'r');
    const buffer = Buffer.alloc(PEDACO);
    let sobra = '';
    let posicao = 0;
    let total = 0;
    const recentes = []; // janela deslizante com as últimas mensagens
    const porRede = {};  // e a janela de cada rede
    const guardar = (message) => {
      total += 1;
      trackParticipant(message, false);
      // Os contadores e o filtro de repetidas valem para o dia inteiro
      if (message.id) markSeen(message.id);
      platformTotals[message.platform] = (platformTotals[message.platform] || 0) + 1;
      contarCategorias(message);
      message.seq = ++messageSeq;
      recentes.push(message);
      if (recentes.length > MAX_RECENT * 2) recentes.splice(0, recentes.length - MAX_RECENT);
      // Cada rede também guarda a própria janela, para a coluna dela nunca
      // ficar vazia por causa do volume das outras
      const daRede = porRede[message.platform] || (porRede[message.platform] = []);
      daRede.push(message);
      if (daRede.length > MAX_RECENT_REDE * 2) daRede.splice(0, daRede.length - MAX_RECENT_REDE);
    };
    try {
      while (posicao < stat.size) {
        const lidos = fs.readSync(fd, buffer, 0, PEDACO, posicao);
        if (!lidos) break;
        posicao += lidos;
        const texto = sobra + buffer.toString('utf8', 0, lidos);
        const linhas = texto.split('\n');
        sobra = linhas.pop() || ''; // a última pode estar cortada no meio
        for (const linha of linhas) {
          if (!linha) continue;
          try {
            const entry = JSON.parse(linha);
            if (entry.t === 'chat' && entry.m) guardar(entry.m);
          } catch { /* linha estragada: pula */ }
        }
      }
      if (sobra.trim()) {
        try {
          const entry = JSON.parse(sobra);
          if (entry.t === 'chat' && entry.m) guardar(entry.m);
        } catch { /* última linha incompleta */ }
      }
    } finally {
      fs.closeSync(fd);
    }
    if (!total) return;
    // O log guarda a ordem de CHEGADA; histórico recuperado com atraso ficava
    // fora do lugar e o painel herdava a bagunça no init. Ordena pelo horário
    // real (com a chegada como desempate) antes de virar memória de exibição.
    const porHorario = (a, b) => ((a.timestamp || 0) - (b.timestamp || 0)) || ((a.seq || 0) - (b.seq || 0));
    recentes.sort(porHorario);
    state.recent = recentes.slice(-MAX_RECENT);
    state.recentByPlatform = {};
    for (const [rede, lista] of Object.entries(porRede)) {
      lista.sort(porHorario);
      state.recentByPlatform[rede] = lista.slice(-MAX_RECENT_REDE);
    }
    console.log(`  📜 Recuperei ${total} comentários do log de hoje (${path.basename(logPath)}).`);
  } catch { /* sem log de hoje: comeco limpo */ }
}

// ---------------------------------------------------------------------------
// 🕊️ Fluxo suave de mensagens
//
// As plataformas (especialmente o YouTube) entregam mensagens em rajadas.
// Em vez de despejar tudo de uma vez no painel e no chat fixo, as mensagens
// entram numa fila e saem num ritmo constante e pacífico. O intervalo vem de
// settings.panel.refreshSeconds: 0 = manual (só pelo botão 🔃), 1 = tempo
// real (o mínimo que as plataformas permitem), até 60 segundos. Em qualquer
// modo o botão 🔃 solta o que estiver na fila — também suavemente.
const FEED_QUEUE_MAX = 2000;
const feedQueue = [];      // aguardando o próximo tique (ou o botão manual)
const feedReleasing = [];  // liberadas, saindo uma a uma
let feedDripTimer = null;
let feedLastPending = '';

// Total de mensagens da live (de hoje) por rede — alimenta os contadores das
// colunas do painel, mesmo quando a memória de exibição não guarda tudo.
const platformTotals = {};
// Contagem REAL do dia por categoria — números simples que só crescem, sem
// nenhum teto. Antes as abas mostravam só o que tinha passado pela memória do
// painel (os últimos 300 comentários + o que chegou depois), então o número
// da aba "Ao vivo" ficava muito abaixo do total verdadeiro da live.
const categoryTotals = { superchat: 0, member: 0, whatsapp: 0, telegram: 0, apoio: 0 }; // 💬📨 v0.124: uma aba para cada

function ehSuperchat(message) {
  return !!message.superchat || (message.badges || []).some((b) => String(b).startsWith('superchat'));
}
function ehMembro(message) {
  return (message.badges || []).includes('membro');
}
function contarCategorias(message) {
  if (message.platform === 'doacao') categoryTotals.apoio += 1;
  else if (ehSuperchat(message)) categoryTotals.superchat += 1;
  if (ehMembro(message)) categoryTotals.member += 1;
  // 💬📨 v0.124: as abas WhatsApp e Telegram, cada uma com a sua conta
  if (message.platform === 'telegram') categoryTotals.telegram += 1;
  if (message.platform === 'whatsapp') categoryTotals.whatsapp += 1;
}

// Participantes únicos de cada rede (a chave é "plataforma:autor")
// Total de fichas em jogo (participantes × o peso do nível de cada um).
// O painel mostra esse número junto do total de participantes, para dar para
// conferir de relance se os níveis estão sendo contados.
function fichasTotais() {
  let soma = 0;
  for (const p of state.participants.values()) soma += raffleWeightFor(p);
  return soma;
}

// Janela de exibição de cada rede (cada uma com o próprio espaço)
function guardarNaRede(message) {
  const rede = message.platform;
  const lista = state.recentByPlatform[rede] || (state.recentByPlatform[rede] = []);
  let pos = lista.length;
  while (pos > 0 && depois(lista[pos - 1], message)) pos--;
  lista.splice(pos, 0, message);
  if (lista.length > MAX_RECENT_REDE) lista.splice(0, lista.length - MAX_RECENT_REDE);
}

function recentesPorRede() {
  const out = {};
  for (const [rede, lista] of Object.entries(state.recentByPlatform)) out[rede] = lista;
  return out;
}

// ---------------------------------------------------------------------------
// 🗑️ Moderação: o que o mod apagar sai da tela
//
// Antes, uma mensagem apagada pelo moderador continuava no painel E na tela da
// live — o pior lugar possível. Agora as três plataformas avisam e o programa
// tira de todo lugar: memória, fila, destaque, guardados e telas abertas.
// 🧪 v0.137: é um comentário de mentira, dos que o 💬 do painel manda? O id
// deles sempre começa com «test-» (quem põe é o sendTestMessage) e quase
// todos carregam o selo «teste» — os dois juntos não deixam escapar nenhum.
function ehMensagemDeTeste(m) {
  if (!m) return false;
  if (String(m.id || '').startsWith('test-')) return true;
  return Array.isArray(m.badges) && m.badges.includes('teste');
}

// `teste` = limpeza dos comentários de mentira, pedida pelo streamer. Não é
// moderação: por isso ela não obedece ao «espelhar o que a moderação apagou»,
// que é sobre as redes, não sobre a nossa própria bagunça de teste.
function removerMensagens({ platform, ids, autor, tudo, teste }) {
  if (!teste && state.settings.chat?.apagarRemovidas === false) return;
  const alvos = new Set((ids || []).map(String));
  const quem = autor ? String(autor).toLowerCase() : null;
  const combina = (m) => {
    if (!m || (platform && m.platform !== platform)) return false;
    if (teste) return ehMensagemDeTeste(m);
    if (tudo) return true;
    if (alvos.size && m.id && alvos.has(String(m.id))) return true;
    if (quem) {
      const login = String(m.authorLogin || '').toLowerCase();
      const id = String(m.authorId || '').toLowerCase();
      const nome = String(m.author || '').toLowerCase();
      if (login === quem || id === quem || nome === quem) return true;
    }
    return false;
  };

  const saíram = [];
  const limpar = (lista) => {
    for (let i = lista.length - 1; i >= 0; i--) {
      if (combina(lista[i])) { saíram.push(String(lista[i].id)); lista.splice(i, 1); }
    }
  };
  limpar(state.recent);
  for (const lista of Object.values(state.recentByPlatform)) limpar(lista);
  limpar(feedQueue);
  limpar(feedReleasing);
  limpar(state.saved);

  if (!saíram.length && !tudo) return;
  const idsFora = [...new Set(saíram)];
  // O comentário em destaque na tela também sai, se for um deles
  if (state.featured && (combina(state.featured) || idsFora.includes(String(state.featured.id)))) {
    state.featured = null;
    broadcast({ type: 'featured', featured: null });
  }
  persistSaved();
  broadcast({ type: 'saved', saved: state.saved });
  broadcast({ type: 'apagadas', platform: platform || null, ids: idsFora, autor: quem, tudo: !!tudo });
  feedPendingBroadcast();
  const motivo = teste ? 'comentários de teste apagados' : tudo ? 'o chat foi limpo' : quem ? `alguém foi banido/silenciado` : 'apagada pela moderação';
  console.log(`  🗑️ ${platform || 'chat'}: ${idsFora.length} mensagem(ns) fora da tela (${motivo}).`);
}

function participantesPorRede() {
  const out = {};
  for (const p of state.participants.values()) {
    out[p.platform] = (out[p.platform] || 0) + 1;
  }
  return out;
}
// Número de chegada: desempata mensagens do MESMO instante de forma estável,
// para a ordem nunca variar entre uma renderização e outra
let messageSeq = 0;

// 🕒 v0.53: a linha do tempo segue a ORDEM DE CHEGADA.
// O YouTube não entrega comentário por comentário: ele entrega em LOTES, e
// cada um vem com o horário de alguns segundos atrás. Ordenar pelo horário
// fazia o lote do YouTube furar a fila da Twitch/Kick que já tinha chegado —
// era o "atropelo" entre as redes no unificado e na coluna geral.
// Só o histórico recuperado (mensagens BEM mais velhas, de minutos atrás)
// mantém o horário real, para voltar ao lugar certo do passado em vez de
// aparecer como se fosse novidade.
const JANELA_CHEGADA_MS = 60000;
// O lugar de cada mensagem na linha do tempo, decidido UMA VEZ na chegada
function ordemDaMensagem(message) {
  const agora = Date.now();
  const ts = Number(message.timestamp);
  if (Number.isFinite(ts) && agora - ts > JANELA_CHEGADA_MS) return ts; // histórico
  return agora; // ao vivo: vale o momento em que chegou aqui
}
// Onde a mensagem mora na fila (mensagens antigas, salvas antes da v0.53,
// não têm 'ordem': o horário real continua valendo para elas)
const posicaoNaLinha = (m) => (Number.isFinite(Number(m.ordem)) ? Number(m.ordem) : (m.timestamp || 0));
// a vem depois de b na linha do tempo? (chegada; seq desempata)
function depois(a, b) {
  const pa = posicaoNaLinha(a), pb = posicaoNaLinha(b);
  return pa > pb || (pa === pb && (a.seq || 0) > (b.seq || 0));
}

// Ids já vistos: evita mensagem duplicada quando o histórico recuperado de um
// serviço traz algo que também chegou (ou vai chegar) pelo tempo real.
const seenMessageIds = new Set();
function markSeen(id) {
  seenMessageIds.add(id);
  if (seenMessageIds.size > 20000) {
    const iterator = seenMessageIds.values();
    for (let i = 0; i < 10000; i++) seenMessageIds.delete(iterator.next().value);
  }
}

function feedPendingByPlatform() {
  const byPlatform = {};
  for (const m of feedQueue) byPlatform[m.platform] = (byPlatform[m.platform] || 0) + 1;
  for (const m of feedReleasing) byPlatform[m.platform] = (byPlatform[m.platform] || 0) + 1;
  return byPlatform;
}

function feedRefreshSeconds() {
  const v = Number(state.settings?.panel?.refreshSeconds);
  if (!Number.isFinite(v)) return 1;
  return Math.max(0, Math.min(60, Math.round(v)));
}

function feedPendingBroadcast() {
  const count = feedQueue.length + feedReleasing.length;
  const totalSum = Object.values(platformTotals).reduce((a, b) => a + b, 0);
  const sig = count + '|' + totalSum;
  if (sig === feedLastPending) return;
  feedLastPending = sig;
  broadcast({
    type: 'feedPending',
    count,
    byPlatform: feedPendingByPlatform(),
    totals: { ...platformTotals },
    categoryTotals: { ...categoryTotals },
  });
}

function feedReleaseOne(message) {
  // Entra na posição do horário real: histórico recuperado que chega depois
  // das mensagens ao vivo não embaralha mais a linha do tempo
  let posR = state.recent.length;
  while (posR > 0 && depois(state.recent[posR - 1], message)) posR--;
  state.recent.splice(posR, 0, message);
  if (state.recent.length > MAX_RECENT) state.recent.splice(0, state.recent.length - MAX_RECENT);
  guardarNaRede(message);
  broadcast({ type: 'chat', message });
}

function feedDrip() {
  feedDripTimer = null;
  if (!feedReleasing.length) return;
  feedReleaseOne(feedReleasing.shift());
  feedPendingBroadcast();
  if (feedReleasing.length) {
    // Espaço escolhido pelo streamer (0,5s a 5s) ou, no automático, ritmo
    // adaptativo: fila maior sai mais rápido, mas nunca em despejo
    const gapConf = Number(state.settings?.panel?.dripSeconds);
    const ms = Number.isFinite(gapConf) && gapConf > 0
      ? Math.min(5, gapConf) * 1000
      : Math.max(35, Math.min(150, 2500 / feedReleasing.length));
    feedDripTimer = setTimeout(feedDrip, ms);
    if (feedDripTimer.unref) feedDripTimer.unref();
  }
}

function feedFlush() {
  if (feedQueue.length) {
    feedReleasing.push(...feedQueue.splice(0));
    if (feedReleasing.length > FEED_QUEUE_MAX) feedReleasing.splice(0, feedReleasing.length - FEED_QUEUE_MAX);
    feedPendingBroadcast();
  }
  if (!feedDripTimer && feedReleasing.length) feedDrip();
}

// ⏭️ Ir direto para o agora: solta TODA a fila de uma vez, sem esperar o
// ritmo — para quem quer pular para as mensagens atuais
function feedJump() {
  if (feedDripTimer) { clearTimeout(feedDripTimer); feedDripTimer = null; }
  feedReleasing.push(...feedQueue.splice(0));
  while (feedReleasing.length) feedReleaseOne(feedReleasing.shift());
  feedPendingBroadcast();
}

let feedTickTimer = null;
function armFeedTick() {
  if (feedTickTimer) clearInterval(feedTickTimer);
  feedTickTimer = null;
  const secs = feedRefreshSeconds();
  if (secs > 0) {
    feedTickTimer = setInterval(feedFlush, secs * 1000);
    if (feedTickTimer.unref) feedTickTimer.unref();
  }
}
armFeedTick();

// 🖼️ v0.138: a varredura das fotos que faltam (a fila e o feed já existem aqui)
const avatarVarreduraTimer = setInterval(varrerAvataresFaltantes, AVATAR_VARREDURA_MS);
if (avatarVarreduraTimer.unref) avatarVarreduraTimer.unref();

// 🤖 Robôs de chat conhecidos ganham o distintivo BOT. A Kick manda o selo
// "bot" nativo; YouTube e Twitch não têm um oficial — esta lista cobre os
// mais usados (o liga/desliga fica em 🏷️ Distintivos do chat).
const BOTS_CONHECIDOS = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'moobot', 'fossabot',
  'wizebot', 'botrix', 'kickbot', 'sery_bot', 'soundalerts', 'pokemoncommunitygame',
]);
function marcarRobo(message) {
  const login = String(message.authorLogin || message.author || '')
    .toLowerCase().replace(/^@/, '');
  const nativo = Array.isArray(message.badges) && message.badges.includes('bot');
  if (!nativo && !BOTS_CONHECIDOS.has(login)) return;
  if (!Array.isArray(message.badges)) message.badges = [];
  if (!message.badges.includes('bot')) message.badges.push('bot');
  if (Array.isArray(message.selos) && !message.selos.some((s) => s && s.cargo === 'bot')) {
    message.selos.push({ id: message.platform + ':bot', cargo: 'bot', nome: 'Robô do chat', img: null });
  }
}

function onChatMessage(message) {
  // 🛡️ Quem está de castigo (timeout/ban do Telegram ou WhatsApp) nem entra
  // no painel — a lista local vale mesmo se a rede não aplicou nada
  if ((message.platform === 'telegram' || message.platform === 'whatsapp')
      && autorModerado(message.platform, String(message.authorId || ''))) return;
  // Repetida (ex.: histórico recuperado que já tinha chegado ao vivo)? Ignora.
  if (message.id) {
    if (seenMessageIds.has(message.id)) return;
    markSeen(message.id);
  }
  message.seq = ++messageSeq;
  // 🕒 O lugar na linha do tempo é decidido AQUI, na chegada, e viaja junto
  // com a mensagem: painel, chat fixo e overlay usam todos o mesmo número
  message.ordem = ordemDaMensagem(message);
  platformTotals[message.platform] = (platformTotals[message.platform] || 0) + 1;
  contarCategorias(message);
  marcarRobo(message);
  // 🖼️ Foto do autor: usa a do cache; sem ela, procura (a falha de uma
  // tentativa só vale por alguns minutos, então a próxima mensagem da mesma
  // pessoa tenta de novo em vez de deixá-la sem foto para sempre)
  if (!message.avatar && message.authorLogin) {
    const fontes = {
      twitch: [twitchAvatarCache, lookupTwitchAvatar],
      kick: [kickAvatarCache, lookupKickAvatar],
      bilibili: [biliAvatarCache, lookupBiliAvatar],
    };
    const fonte = fontes[message.platform];
    if (fonte) {
      const cached = avatarEmCache(fonte[0], message.authorLogin);
      if (cached) message.avatar = cached;
      else if (cached === undefined) fonte[1](message.authorLogin);
    }
  }
  // Super Chat em moeda estrangeira? Mostra tambem o valor aproximado em reais.
  if (message.superchat && message.superchat.amount && !message.superchat.converted) {
    const converted = currency.toBRL(message.superchat.amount);
    if (converted) message.superchat.converted = converted;
  }
  trackParticipant(message);
  raffleObservarMensagem(message); // 🎁 1ª resposta de ganhador pós-sorteio
  if (message.midia) transcreverMidia(message.midia); // 🎙️ rascunho no cartão (Labs)
  appendLog({ t: 'chat', m: message }); // o log e a busca não esperam a fila
  // Chegada imediata: as colunas individuais do painel mostram na hora
  // (o fluxo suave vale só para o feed unificado e o chat fixo)
  broadcast({ type: 'chatNow', message });
  // Entra no fluxo suave (nada é despejado de uma vez no painel/chat)
  // A fila também respeita o horário real (as liberações saem em ordem)
  let posQ = feedQueue.length;
  while (posQ > 0 && depois(feedQueue[posQ - 1], message)) posQ--;
  feedQueue.splice(posQ, 0, message);
  if (feedQueue.length > FEED_QUEUE_MAX) feedQueue.splice(0, feedQueue.length - FEED_QUEUE_MAX);
  feedPendingBroadcast();
}

// ---------------------------------------------------------------------------
// QR Code

// 📺 v0.103: o QR de exemplo da prévia do editor — a matriz é calculada uma
// vez só e viaja no init (o /overlay?previa=1 mostra o QR desligado com ela)
let exemploQrCache = null;
function exemploQrMatriz() {
  if (exemploQrCache === null) {
    try { exemploQrCache = makeQrMatrix('https://obs.social/exemplo'); } catch { exemploQrCache = false; }
  }
  return exemploQrCache || null;
}

function makeQrMatrix(text) {
  // Tenta versoes automaticas com correcao M; texto longo demais gera erro.
  const qr = qrcodeFactory(0, 'M');
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const rows = [];
  for (let r = 0; r < count; r++) {
    let row = '';
    for (let c = 0; c < count; c++) row += qr.isDark(r, c) ? '1' : '0';
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Sorteio (subs e membros valem 2 entradas)

function drawWinners(count) {
  const pool = Array.from(state.participants.values())
    .map((p) => ({ ...p, weight: raffleWeightFor(p) }))
    .filter((p) => p.weight > 0); // 0 ficha = fora (rede de mensagem com seletor desligado)
  const winners = [];
  while (winners.length < count && pool.length) {
    const total = pool.reduce((sum, p) => sum + p.weight, 0);
    let ticket = Math.random() * total;
    let picked = 0;
    for (let i = 0; i < pool.length; i++) {
      ticket -= pool[i].weight;
      if (ticket <= 0) { picked = i; break; }
    }
    winners.push(pool.splice(picked, 1)[0]);
  }
  return winners;
}

// ---------------------------------------------------------------------------
// 💬⏱ A resposta dos ganhadores e o tempo de resposta.
// Duas modalidades (settings.raffle.respostaModo):
//   'um'     = UM prêmio só: o timer roda para o 1º; respondeu, acabou —
//              não respondeu, fica esmaecido e a chance DESCE para o 2º, e
//              assim até o 3º. Só a resposta de quem está na vez conta.
//   'varios' = TODOS premiados: cada colocado tem a sua vez de responder,
//              em sequência; cada um ou responde ou expira.
// Sem o timer ligado, a 1ª resposta de qualquer ganhador é capturada do
// mesmo jeito (para aparecer no pódio) — só não há prazo.
// ---------------------------------------------------------------------------
let raffleRespostaTimer = null;
function pararRespostaTimer() {
  if (raffleRespostaTimer) { clearTimeout(raffleRespostaTimer); raffleRespostaTimer = null; }
}

function raffleProximaVez(r, aPartir) {
  for (let i = aPartir; i < r.winners.length; i++) {
    if (!r.respostas[i] && !r.expirados[i]) return i;
  }
  return null;
}

// Arma o timer da vez (extraMs = espera do dado 🎲 antes do 1º prazo)
function raffleArmarVez(r, vez, extraMs = 0) {
  pararRespostaTimer();
  const conf = state.settings.raffle || {};
  if (vez === null || conf.respostaTimer !== true) {
    r.vez = null;
    r.prazoAte = null;
    return;
  }
  const seg = numeroEntre(conf.respostaSegundos, 5, 600, 60);
  r.vez = vez;
  r.prazoAte = Date.now() + extraMs + seg * 1000;
  raffleRespostaTimer = setTimeout(() => {
    raffleRespostaTimer = null;
    if (state.raffle !== r || !r.visible) return;
    r.expirados[vez] = true; // ⌛ perdeu o tempo de resposta
    raffleArmarVez(r, raffleProximaVez(r, vez + 1));
    broadcast({ type: 'raffle', raffle: state.raffle });
  }, extraMs + seg * 1000);
  if (raffleRespostaTimer.unref) raffleRespostaTimer.unref();
}

// O texto simples de uma mensagem (para o balão de resposta no pódio)
function textoDosRuns(runs) {
  return (Array.isArray(runs) ? runs : [])
    .map((r) => (r && typeof r.text === 'string' ? r.text : ''))
    .join('').replace(/\s+/g, ' ').trim();
}

// Chamada a cada mensagem do chat: é a 1ª resposta de um ganhador?
function raffleObservarMensagem(message) {
  const r = state.raffle;
  if (!r || !r.visible || !Array.isArray(r.respostas)) return;
  // ⏮️ Mensagem escrita ANTES do sorteio não vale: o polling do YouTube e os
  // históricos de reconexão (Twitch/Kick) entregam mensagens antigas com
  // atraso — sem esta trava, uma frase pré-sorteio "entregava o prêmio".
  const ts = Number(message.timestamp);
  if (Number.isFinite(ts) && ts > 0 && ts < r.drawnAt) return;
  const conf = state.settings.raffle || {};
  const modoUm = conf.respostaTimer === true && conf.respostaModo !== 'varios';
  const autor = String(message.author || '').toLowerCase();
  const chave = chaveParticipante(message);
  // 🔒 v0.127.1: o ganhador é reconhecido pela chave (id da rede), não só
  // pelo nome — outra pessoa com o mesmo nome não "responde" por ele.
  // Ganhadores de antes desta versão (sem chave) seguem pelo nome.
  const i = r.winners.findIndex((w, idx) => !r.respostas[idx] && !r.expirados[idx]
    && w.platform === message.platform
    && (w.chave ? w.chave === chave : String(w.author).toLowerCase() === autor));
  if (i === -1) return;
  // Modalidade "um premiado": SÓ a resposta de quem está NA VEZ conta — com o
  // prêmio já entregue (ou tudo expirado), nada mais entra no pódio.
  if (modoUm && i !== r.vez) return;
  const texto = textoDosRuns(message.runs);
  r.respostas[i] = { texto: texto.slice(0, 200), em: Date.now() };
  if (r.vez === i) {
    // Respondeu na vez: no modo "um" o prêmio está entregue (timer PARA);
    // no modo "vários" a vez passa para o próximo colocado
    raffleArmarVez(r, modoUm ? null : raffleProximaVez(r, i + 1));
  }
  broadcast({ type: 'raffle', raffle: r });
}

// ---------------------------------------------------------------------------
// Likometro (YouTube: assistindo agora vs. likes) — pagina publica, sem API key

const YT_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
  Cookie: 'CONSENT=YES+cb; SOCS=CAI', // evita a tela de consentimento
};

// Entende "1,234", "1.234", "1.2K", "1,2 mil", "3 mi" etc. (qualquer idioma comum)
function parseCount(text) {
  const value = String(text).replace(/ /g, ' ').trim().toUpperCase();
  const suffix = value.match(/^([\d.,]+)\s*(K|M|B|MIL|MI|MIO|MLN)\.?$/);
  if (suffix) {
    let baseStr = suffix[1];
    if (baseStr.includes(',')) baseStr = baseStr.replace(/\./g, '').replace(',', '.');
    const base = parseFloat(baseStr);
    const mult = { K: 1e3, MIL: 1e3, M: 1e6, MI: 1e6, MIO: 1e6, MLN: 1e6, B: 1e9 }[suffix[2]];
    const result = Math.round(base * mult);
    return Number.isFinite(result) ? result : null;
  }
  const digits = value.replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : null;
}

// Chave interna do YouTube: reaproveita a do conector de chat ou busca uma vez.
let ytKeyCache = null;

// A chave interna sumiu de algumas paginas do YouTube; os endpoints internos
// funcionam sem ela, entao ela e opcional — so a versao do cliente importa,
// e mesmo ela tem uma reserva fixa (o YouTube aceita versoes antigas).
const YT_FALLBACK_CLIENT_VERSION = '2.20250101.00.00';

async function getYouTubeKey() {
  const connector = state.connectors.youtube;
  if (connector?.clientVersion) {
    return { apiKey: connector.apiKey || null, clientVersion: connector.clientVersion };
  }
  if (ytKeyCache && Date.now() - ytKeyCache.at < 60 * 60 * 1000) return ytKeyCache;
  try {
    const res = await fetch('https://www.youtube.com/?hl=en', { headers: YT_HEADERS });
    const html = await res.text();
    const key = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/);
    const version = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/) || html.match(/"clientVersion":"(2\.[^"]+)"/);
    ytKeyCache = {
      apiKey: key ? key[1] : null,
      clientVersion: version ? version[1] : YT_FALLBACK_CLIENT_VERSION,
      at: Date.now(),
    };
  } catch {
    ytKeyCache = { apiKey: null, clientVersion: YT_FALLBACK_CLIENT_VERSION, at: Date.now() };
  }
  return ytKeyCache;
}

// Usa os mesmos endpoints internos que a pagina do YouTube usa para atualizar
// os numeros ao vivo — em JSON e com idioma fixo (bem mais confiavel que o HTML).
async function fetchYouTubeStats(videoId) {
  const { apiKey, clientVersion } = await getYouTubeKey();
  const body = (extra) => JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
    ...extra,
  });
  const post = async (endpoint) => {
    const keyParam = apiKey ? `key=${apiKey}&` : '';
    const res = await fetch(`https://www.youtube.com/youtubei/v1/${endpoint}?${keyParam}prettyPrint=false`, {
      method: 'POST',
      headers: { ...YT_HEADERS, 'Content-Type': 'application/json' },
      body: body({ videoId }),
    });
    if (!res.ok) throw new Error(`${endpoint}: erro ${res.status}`);
    return res.text();
  };

  let viewers = null;
  let likes = null;
  let lastError = null;

  // Espectadores: updated_metadata (o que alimenta o "watching now" da pagina)
  try {
    const text = await post('updated_metadata');
    const match = text.match(/"concurrentViewers":"(\d+)"/)
      || text.match(/([\d.,]+)\s*watching now/)
      || text.match(/"viewCount":\{"runs":\[\{"text":"([\d.,]+)"/);
    if (match) viewers = parseCount(match[1]);
  } catch (err) { lastError = err; }

  // Likes (e reserva de espectadores): endpoint next
  try {
    const text = await post('next');
    const like = text.match(/"likeCountIfIndifferent":\{"content":"([^"]+)"/)
      || text.match(/"expandedLikeCountIfIndifferent":\{"content":"([^"]+)"/)
      || text.match(/"likeCount":"(\d+)"/)
      || text.match(/"label":"([\d.,]+[KM]?)\s+likes"/i)
      || text.match(/like this video along with ([\d.,]+) other people/);
    if (like) likes = parseCount(like[1]);
    if (viewers === null) {
      const view = text.match(/"concurrentViewers":"(\d+)"/)
        || text.match(/([\d.,]+)\s*watching now/)
        || text.match(/"viewCount":\{"runs":\[\{"text":"([\d.,]+)"/);
      if (view) viewers = parseCount(view[1]);
    }
  } catch (err) { lastError = err; }

  if (viewers === null && likes === null) {
    throw new Error('YouTube não devolveu os números' + (lastError ? ` (${lastError.message})` : ''));
  }
  return { viewers, likes };
}

let likemeterPolling = false;
async function pollLikemeter() {
  if (!state.likemeter.enabled || likemeterPolling) return;
  likemeterPolling = true;
  try {
    await pollLikemeterOnce();
  } finally {
    likemeterPolling = false;
  }
}

async function pollLikemeterOnce() {
  const videoId = state.likemeter.videoId || state.connectors.youtube?.videoId;
  if (!videoId) {
    state.likemeter.error = 'Conecte o YouTube primeiro (na engrenagem).';
    broadcast({ type: 'likemeter', likemeter: state.likemeter });
    return;
  }
  state.likemeter.videoId = videoId;
  try {
    const stats = await fetchYouTubeStats(videoId);
    state.likemeter.viewers = stats.viewers;
    state.likemeter.likes = stats.likes;
    state.likemeter.error = (stats.viewers === null && stats.likes === null)
      ? 'Não consegui ler os números (a live está no ar?)' : null;
    state.likemeter.updatedAt = Date.now();
  } catch (err) {
    state.likemeter.error = err.message;
  }
  broadcast({ type: 'likemeter', likemeter: state.likemeter });
}

// ---------------------------------------------------------------------------
// Audiencia em tempo real de cada servico (sem chaves de API)

// Client-ID publico usado pelo proprio site da Twitch para consultas anonimas.
// A Twitch trocou esse valor em 2026 (o famoso ...h0ko virou ...h1ko) e pode
// trocar de novo: por isso o valor atual e lido da propria pagina da Twitch
// e este fica so de reserva.
const TWITCH_PUBLIC_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
let twitchClientIdCache = null;
async function getTwitchClientId() {
  if (twitchClientIdCache) return twitchClientIdCache;
  try {
    const res = await fetch('https://www.twitch.tv/', { headers: { 'User-Agent': YT_HEADERS['User-Agent'] } });
    if (res.ok) {
      const m = (await res.text()).match(/clientId[":= ]+"?([a-z0-9]{25,35})"/i);
      if (m) { twitchClientIdCache = m[1]; return m[1]; }
    }
  } catch { /* fica na reserva */ }
  return TWITCH_PUBLIC_CLIENT_ID;
}

async function fetchTwitchViewers(login) {
  const safe = String(login).replace(/[^a-z0-9_]/gi, '');

  // 1) Consulta anonima que o proprio site da Twitch usa
  try {
    const res = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: {
        'Client-ID': await getTwitchClientId(),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': YT_HEADERS['User-Agent'],
      },
      body: JSON.stringify([{ query: `query { user(login: "${safe}") { stream { viewersCount createdAt } } }`, variables: {} }]),
    });
    if (res.ok) {
      const data = await res.json();
      const first = Array.isArray(data) ? data[0] : data;
      const user = first?.data?.user;
      if (first?.errors?.length) throw new Error(first.errors[0].message || 'consulta recusada');
      if (user !== undefined) {
        const stream = user?.stream;
        if (!stream) return { count: null, online: false, since: null }; // canal fora do ar
        const count = stream.viewersCount;
        const since = stream.createdAt ? Date.parse(stream.createdAt) || null : null;
        return { count: Number.isFinite(count) ? count : null, online: true, since };
      }
    } else {
      // 400 = Client-ID rejeitado (a Twitch trocou de novo): esquece o cache
      // para redescobrir na página no próximo ciclo
      if (res.status === 400) twitchClientIdCache = null;
      throw new Error(`erro ${res.status}`);
    }
  } catch (err) {
    logAudienceIssue('twitch', `consulta principal falhou (${err.message}), tentando a reserva...`);
  }

  // 2) Reserva: servico publico de estatisticas da Twitch (decapi.me)
  const res = await fetch(`https://decapi.me/twitch/viewercount/${safe}`, {
    headers: { 'User-Agent': 'obs-social' },
  });
  if (!res.ok) throw new Error(`reserva respondeu com erro ${res.status}`);
  const text = (await res.text()).trim();
  if (!/^\d+$/.test(text)) throw new Error(`reserva respondeu: "${text.slice(0, 60)}"`);
  return { count: parseInt(text, 10), online: true, since: null };
}

// Mostra cada problema de audiencia uma unica vez na janela do programa.
const audienceIssuesShown = new Set();
function logAudienceIssue(platform, message) {
  const key = platform + ':' + message;
  if (audienceIssuesShown.has(key)) return;
  audienceIssuesShown.add(key);
  console.log(`  ⚠️ Audiência (${platform}): ${message}`);
}

async function fetchKickViewers(slug) {
  const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Accept': 'application/json',
    },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const ls = data?.livestream;
  if (!ls) return { count: null, online: false, since: null }; // canal fora do ar
  const count = ls.viewer_count;
  return {
    count: Number.isFinite(count) ? count : null,
    online: true,
    since: parseHoraSemFuso(ls.start_time || ls.created_at, 'Z'), // Kick manda em UTC
  };
}

// Datas "YYYY-MM-DD HH:MM:SS" sem fuso: interpreta no fuso indicado
function parseHoraSemFuso(s, fuso) {
  if (!s || typeof s !== 'string' || /^0000/.test(s)) return null;
  const iso = /[TZ+]/.test(s.slice(10)) ? s : s.replace(' ', 'T') + fuso;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

async function fetchBilibiliViewers(roomId) {
  if (!/^\d{1,12}$/.test(String(roomId))) return null;
  const res = await fetch(`https://api.live.bilibili.com/room/v1/Room/get_info?room_id=${encodeURIComponent(roomId)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://live.bilibili.com/' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const info = data?.data;
  if (!info) return null;
  const count = info.online;
  const aoVivo = info.live_status === 1; // 0 = fora do ar, 2 = reprise
  return {
    count: Number.isFinite(count) ? count : null,
    online: aoVivo,
    since: aoVivo ? parseHoraSemFuso(info.live_time, '+08:00') : null, // horário da China
  };
}

// Início e estado da live do YouTube: vem da página do vídeo (microformat),
// que é pesada — busca no máximo 1x por minuto e guarda por vídeo.
const ytLiveCache = new Map(); // videoId -> { since, online, at }
async function fetchYouTubeLiveInfo(videoId) {
  const cached = ytLiveCache.get(videoId);
  if (cached && Date.now() - cached.at < 60000) return cached;
  const novo = { since: cached?.since ?? null, online: cached?.online ?? null, at: Date.now() };
  ytLiveCache.set(videoId, novo);
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, { headers: YT_HEADERS });
    if (res.ok) {
      const html = await res.text();
      const inicio = html.match(/"startTimestamp":"([^"]+)"/);
      if (inicio) novo.since = Date.parse(inicio[1]) || null;
      const aoVivo = html.match(/"isLiveNow":(true|false)/);
      if (aoVivo) novo.online = aoVivo[1] === 'true';
      if (ytLiveCache.size > 20) ytLiveCache.clear();
    }
  } catch { /* extra: sem ele, fica o que já se sabia */ }
  return novo;
}

let audiencePolling = false;
let audiencePollTick = 0;

async function pollAudience() {
  if (audiencePolling) return;
  audiencePolling = true;
  try {
    const tasks = [];
    const set = (platform, info) => {
      // Além da contagem, guarda se a live está no ar e desde quando —
      // vira o ⏱ (tempo de live) e o 💤 (fora do ar) nos chips do painel
      state.audience.platforms[platform] = {
        count: Number.isFinite(info?.count) ? info.count : null,
        online: typeof info?.online === 'boolean' ? info.online : null,
        since: Number.isFinite(info?.since) ? info.since : null,
        updatedAt: Date.now(),
      };
      // 🚦 A bolinha da conexão também conta a história da live: conectado
      // SEM live no ar fica amarelo; verde é só com a live rolando. O campo
      // aoVivo viaja junto do status normal (null = ainda não se sabe).
      const st = state.status[platform];
      const aoVivo = typeof info?.online === 'boolean' ? info.online : null;
      if (st && st.aoVivo !== aoVivo) {
        st.aoVivo = aoVivo;
        if (st.state === 'connected') broadcast({ type: 'status', platform, status: st });
      }
    };
    const watch = (platform, promise, pick = (v) => v) => {
      tasks.push(promise
        .then((value) => {
          const info = pick(value);
          if (!info || (info.count === null && info.online !== false)) logAudienceIssue(platform, 'não consegui ler o número de espectadores (formato mudou?)');
          set(platform, info);
        })
        .catch((err) => {
          logAudienceIssue(platform, err.message);
          // Erro passageiro (ex.: Cloudflare) não apaga o último estado
          // conhecido — melhor um número de 30s atrás do que piscar 💤
          if (!state.audience.platforms[platform]) set(platform, null);
        }));
    };
    if (state.connectors.twitch?.channel) watch('twitch', fetchTwitchViewers(state.connectors.twitch.channel));
    // Kick: a cada 30s (1 em cada 3 ciclos) — o Cloudflare deles é o mais
    // sensível a consultas frequentes, e foi o que bloqueou o streamer na live
    audiencePollTick++;
    if (state.connectors.kick?.channel && audiencePollTick % 3 === 0) watch('kick', fetchKickViewers(state.connectors.kick.channel));
    if (state.connectors.youtube?.videoId) {
      const videoId = state.connectors.youtube.videoId;
      watch('youtube', Promise.all([
        fetchYouTubeStats(videoId).catch(() => ({ viewers: null })),
        fetchYouTubeLiveInfo(videoId),
      ]), ([stats, live]) => ({
        count: Number.isFinite(stats.viewers) ? stats.viewers : null,
        // Números chegando = está no ar; senão vale o que a página do vídeo diz
        online: Number.isFinite(stats.viewers) ? true : live.online,
        since: live.since,
      }));
    }
    if (state.connectors.bilibili?.roomId) watch('bilibili', fetchBilibiliViewers(state.connectors.bilibili.roomId));
    // Limpa plataformas que foram desconectadas.
    for (const platform of Object.keys(state.audience.platforms)) {
      if (!state.connectors[platform]) delete state.audience.platforms[platform];
    }
    await Promise.all(tasks);
    broadcast({ type: 'audience', audience: state.audience });
  } finally {
    audiencePolling = false;
  }
}

// 10s e o minimo seguro: mais rapido que isso as plataformas (principalmente
// o Cloudflare do Kick e o GQL da Twitch) comecam a bloquear as consultas.
const audienceTimer = setInterval(() => pollAudience().catch(() => {}), 10000);
if (audienceTimer.unref) audienceTimer.unref();

function setLikemeter(enabled) {
  state.likemeter.enabled = enabled;
  if (likemeterTimer) { clearInterval(likemeterTimer); likemeterTimer = null; }
  if (enabled) {
    state.likemeter.videoId = state.connectors.youtube?.videoId || state.likemeter.videoId || null;
    state.likemeter.error = null;
    pollLikemeter();
    likemeterTimer = setInterval(pollLikemeter, 10000); // mesmo ritmo do proprio site do YouTube
    if (likemeterTimer.unref) likemeterTimer.unref();
  }
  broadcast({ type: 'likemeter', likemeter: state.likemeter });
}

// ---------- 🧪 v0.99: exemplo de qualquer overlay ----------
// O 🧪 do editor põe um exemplo de mentira NO overlay escolhido, para dar o
// que ajustar mesmo sem live rolando. Antes de mexer, o que estava no ar fica
// guardado aqui e volta ao pé da letra quando o exemplo sai — o aviso que
// você escreveu, o seu QR e a sua winstreak não são perdidos por um teste.
const EXEMPLO_ALVOS = new Set(['relogio', 'aviso', 'qr', 'likemeter', 'raffle', 'winstreak', 'audience']);
let exemploAntes = null; // { alvo, dados }

function exemploGanhador(nome, plataforma) {
  return { author: nome, platform: plataforma, avatar: null, weight: 1 };
}

// Todo mundo precisa saber qual exemplo está no ar (o botão do editor vira
// "tirar da tela" em qualquer aba, e sobrevive a um recarregar da página)
function avisarExemplo() {
  broadcast({ type: 'exemplo', alvo: exemploAntes ? exemploAntes.alvo : null });
}

function exemploOverlayNoAr(alvo) {
  const guardar = (dados) => { exemploAntes = { alvo, dados }; };
  if (alvo === 'relogio') {
    guardar({ visible: state.relogio.relogio.visible });
    state.relogio.relogio.visible = true;
    broadcast({ type: 'relogio', relogio: relogioPublico() });
  } else if (alvo === 'aviso') {
    const inst = findAviso(null); // o exemplo mexe no aviso principal
    guardar({ visible: inst.visible, texto: inst.texto });
    inst.texto = 'Exemplo de aviso na tela 📢 — ajuste a posição e o tamanho por aqui';
    inst.visible = true;
    broadcastAvisos();
  } else if (alvo === 'qr') {
    const inst = findQr(null);
    if (!inst) return;
    guardar({ id: inst.id, name: inst.name, url: inst.url, visible: inst.visible, matrix: inst.matrix });
    inst.name = 'Exemplo';
    inst.url = 'https://obs.social/exemplo';
    try { inst.matrix = makeQrMatrix(inst.url); inst.visible = true; } catch { inst.visible = false; }
    // (sem gravar no disco: o exemplo é passageiro — um reinício no meio
    // não pode deixar o QR de mentira no lugar do seu)
    broadcast({ type: 'qr', qrs: state.qrs });
  } else if (alvo === 'likemeter') {
    guardar({ likemeter: { ...state.likemeter } });
    if (likemeterTimer) { clearInterval(likemeterTimer); likemeterTimer = null; }
    state.likemeter = { enabled: true, viewers: 1234, likes: 567, error: null, updatedAt: Date.now() };
    broadcast({ type: 'likemeter', likemeter: state.likemeter });
  } else if (alvo === 'raffle') {
    guardar({ raffle: state.raffle ? { ...state.raffle } : null });
    pararRespostaTimer();
    state.raffle = {
      winners: [
        exemploGanhador('Exemplo da Live', 'twitch'),
        exemploGanhador('Segundo Lugar', 'youtube'),
        exemploGanhador('Terceiro Lugar', 'kick'),
      ],
      visible: true,
      drawnAt: Date.now(),
      origem: 'exemplo',
      respostas: [null, null, null],
      expirados: [false, false, false],
      vez: null,
      prazoAte: null,
    };
    broadcast({ type: 'raffle', raffle: state.raffle });
  } else if (alvo === 'winstreak') {
    const inst = state.winstreaks[0];
    if (!inst) return;
    guardar({ id: inst.id, visible: inst.visible, wins: inst.wins, record: inst.record });
    inst.visible = true;
    if (!inst.wins) { inst.wins = 7; inst.record = Math.max(7, inst.record); }
    // (sem gravar: o exemplo é passageiro — um reinício no meio não pode
    // deixar o 7 de mentira no lugar do placar de verdade)
    broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
  } else if (alvo === 'audience') {
    guardar({ visible: state.audience.visible, platforms: JSON.parse(JSON.stringify(state.audience.platforms)) });
    const agora = Date.now();
    state.audience.platforms = {
      youtube: { count: 1240, updatedAt: agora },
      twitch: { count: 380, updatedAt: agora },
      kick: { count: 95, updatedAt: agora },
    };
    state.audience.visible = true;
    broadcast({ type: 'audience', audience: state.audience });
  }
}

// Devolve o que estava no ar. Sem argumento, tira o exemplo que estiver lá.
function exemploOverlayFora(alvo) {
  if (!exemploAntes) return;
  if (alvo && exemploAntes.alvo !== alvo) return;
  const { alvo: qual, dados } = exemploAntes;
  exemploAntes = null;
  if (qual === 'relogio') {
    state.relogio.relogio.visible = dados.visible === true;
    broadcast({ type: 'relogio', relogio: relogioPublico() });
  } else if (qual === 'aviso') {
    const inst = findAviso(null);
    inst.texto = dados.texto;
    inst.visible = dados.visible === true;
    broadcastAvisos();
  } else if (qual === 'qr') {
    const inst = state.qrs.find((q) => q.id === dados.id) || state.qrs[0];
    if (inst) {
      inst.name = dados.name;
      inst.url = dados.url;
      inst.matrix = dados.matrix;
      inst.visible = dados.visible === true;
    }
    broadcastQrs();
  } else if (qual === 'likemeter') {
    const antes = dados.likemeter || {};
    if (antes.enabled) setLikemeter(true);
    else {
      state.likemeter = { enabled: false, viewers: null, likes: null, error: null, updatedAt: null };
      broadcast({ type: 'likemeter', likemeter: state.likemeter });
    }
  } else if (qual === 'raffle') {
    state.raffle = dados.raffle;
    if (state.raffle) state.raffle.visible = false;
    broadcast({ type: 'raffle', raffle: state.raffle });
  } else if (qual === 'winstreak') {
    const inst = state.winstreaks.find((w) => w.id === dados.id) || state.winstreaks[0];
    if (inst) {
      inst.visible = dados.visible === true;
      inst.wins = dados.wins;
      inst.record = dados.record;
    }
    persistWinstreaks();
    broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
  } else if (qual === 'audience') {
    state.audience.platforms = dados.platforms || {};
    state.audience.visible = dados.visible === true;
    broadcast({ type: 'audience', audience: state.audience });
  }
}

// ---------- 💬 WhatsApp modo biblioteca local (Baileys sob demanda) ----------
// A biblioteca aberta é instalada pelo npm numa pasta própria de data/ —
// nada vem embutido no programa. A sessão pareada (QR) fica em data/ e
// sobrevive a reinícios; apagar a sessão = parear outro número.
const WA_LIB_DIR = path.join(DATA_DIR, 'whatsapp-lib');
const WA_SESSAO_DIR = path.join(DATA_DIR, 'whatsapp-sessao');
const waLib = { instalando: false, erro: '' };
function waLibInstalada() {
  try { return fs.existsSync(path.join(WA_LIB_DIR, 'node_modules', '@whiskeysockets', 'baileys', 'package.json')); }
  catch { return false; }
}
function waLibEstado() { return { instalada: waLibInstalada(), instalando: waLib.instalando, erro: waLib.erro }; }
function broadcastWaLib() { broadcast({ type: 'waLib', lib: waLibEstado() }); }
function waLibCarregar() {
  try {
    if (!waLibInstalada()) return null;
    return require(path.join(WA_LIB_DIR, 'node_modules', '@whiskeysockets', 'baileys'));
  } catch (err) {
    console.error('A biblioteca local do WhatsApp não carregou:', err.message);
    return null;
  }
}
// 💬 v0.140.2: o npm despeja um bloco inteiro de linhas quando falha, e o que
// aparecia no card era o RABO desse bloco — justamente o rodapé («o log
// completo está em...»), sem a linha que diz o que aconteceu. Aqui ficam as
// PRIMEIRAS linhas com conteúdo (é onde o npm explica o erro) e, no fim, o
// caminho do relatório, para quem quiser abrir.
function resumoDoErroNpm(texto) {
  const cru = String(texto || '');
  const log = (cru.match(/[A-Za-z]:\\[^\r\n"]+\.log|\/[^\s"]+\.log/) || [''])[0];
  const linhas = cru.split(/\r?\n/)
    .map((l) => l.replace(/^npm\s+(ERR!|error|WARN|warn)\s*/i, '').trim())
    .filter((l) => l && !l.endsWith('.log')
      && !/^(A complete log|This is (a|an) |Log files were not written)/i.test(l));
  // As linhas de FICHA TÉCNICA (code, syscall, path, errno...) vêm primeiro na
  // saída do npm, mas quem explica o problema é a frase solta depois delas.
  // A frase vai na frente; a ficha técnica, no que sobrar do espaço.
  const fichaTecnica = /^(code|syscall|path|dest|file|errno|stack|cwd|npm ver|node ver)\b/i;
  const inicio = [...new Set([
    ...linhas.filter((l) => !fichaTecnica.test(l)),
    ...linhas.filter((l) => fichaTecnica.test(l)),
  ])].slice(0, 4).join(' · ');
  return (inicio || 'o npm não explicou o motivo').slice(0, 300)
    + (log ? ' — o relatório completo está em ' + log : '');
}
const WA_LIB_TEMPO_MAX = Number(process.env.OBS_TESTE_NPM_TEMPO_MS) || 10 * 60 * 1000;
// 💬 v0.140.3: a Baileys pede o libsignal por um endereço de GIT
// (git+https://github.com/whiskeysockets/libsignal-node) — e o git NÃO vem
// no Windows. Sem ele o npm morre com «An unknown git error occurred», que
// foi exatamente o que apareceu no card depois da correção anterior.
// O MESMO libsignal, dos mesmos autores e do mesmo repositório, está
// publicado no npm. Este desvio manda o npm buscar de lá: a instalação
// deixa de precisar de git, e o código é o mesmo.
const WA_LIB_DESVIOS = { libsignal: '^6.0.0' };
function waLibInstalar() {
  if (waLib.instalando) return;
  waLib.instalando = true;
  waLib.erro = '';
  broadcastWaLib();
  try { fs.mkdirSync(WA_LIB_DIR, { recursive: true }); } catch {}
  // 💬 v0.140.2: o npm PRECISA de um package.json na pasta de destino. Sem
  // ele, o install com --prefix morre com ENOENT (foi o erro 4294963238 que
  // apareceu no card) — e, pior, o npm sai procurando um package.json pasta
  // acima e acaba chegando na do próprio programa. Este arquivinho resolve as
  // duas coisas de uma vez: a pasta vira um projetinho fechado, só da
  // biblioteca, e o npm para de vasculhar o computador.
  const manifesto = path.join(WA_LIB_DIR, 'package.json');
  try {
    let atual = {};
    try { atual = JSON.parse(fs.readFileSync(manifesto, 'utf8')) || {}; } catch { /* primeira vez */ }
    const faltavaDesvio = (atual.overrides || {}).libsignal !== WA_LIB_DESVIOS.libsignal;
    fs.writeFileSync(manifesto, JSON.stringify({
      name: 'obs-social-whatsapp-lib',
      version: '1.0.0',
      private: true,
      description: 'Pasta da biblioteca local do WhatsApp, baixada sob demanda. Nada aqui vem embutido no programa.',
      ...atual,
      overrides: { ...(atual.overrides || {}), ...WA_LIB_DESVIOS },
    }, null, 2) + '\n');
    // Desvio novo (ou instalação antiga que falhou por causa do git): o
    // package-lock guardado ainda aponta para o endereço de git. Ele sai da
    // frente para o npm resolver tudo de novo, agora pelo caminho sem git.
    if (faltavaDesvio) { try { fs.unlinkSync(path.join(WA_LIB_DIR, 'package-lock.json')); } catch { /* nem existia */ } }
  } catch (err) {
    waLib.instalando = false;
    waLib.erro = 'Não consegui preparar a pasta da biblioteca: ' + String(err.message || err).slice(0, 160);
    broadcastWaLib();
    return;
  }
  const { spawn: waSpawn } = require('child_process');
  // Gancho de teste: um npm de mentira valida o fio sem baixar nada
  const npmCmd = process.env.OBS_TESTE_NPM || (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  let proc;
  try {
    // No Windows o npm.cmd precisa do shell — e aí a pasta com espaço ou "&"
    // no nome (C:\Users\Ana & Bia\...) tem que ir entre aspas
    const comShell = process.platform === 'win32';
    const args = ['install', '@whiskeysockets/baileys@6.7.24', '--prefix', WA_LIB_DIR, '--no-audit', '--no-fund', '--omit=dev']
      .map((a) => (comShell && /[\s&^|<>()"]/.test(a) ? '"' + a.replace(/"/g, '') + '"' : a));
    // rodando DENTRO da pasta da biblioteca: o npm não tem para onde subir
    proc = waSpawn(npmCmd, args, { windowsHide: true, shell: comShell, cwd: WA_LIB_DIR });
  } catch (err) {
    waLib.instalando = false;
    waLib.erro = String(err.message || err).slice(0, 200);
    broadcastWaLib();
    return;
  }
  // O npm escreve o erro no stderr, mas nem sempre: as versões antigas
  // mandam parte para o stdout. As duas saídas contam a mesma história aqui.
  let saida = '';
  const juntar = (d) => { if (saida.length < 8000) saida += d; };
  proc.stderr?.on('data', juntar);
  proc.stdout?.on('data', juntar);
  // O fim da instalação chega por um caminho só, venha de onde vier — o npm
  // terminando, um erro ao chamá-lo, ou o tempo limite. O primeiro a chegar
  // manda; os outros já não têm nada a dizer.
  let acabou = false;
  const terminar = (erro) => {
    if (acabou) return;
    acabou = true;
    clearTimeout(relogio);
    waLib.instalando = false;
    waLib.erro = erro;
    broadcastWaLib();
  };
  // Um npm que trava (a rede caiu no meio) não pode deixar o card girando
  // para sempre. E o recado sai NA HORA: matar o npm não fecha na mesma hora
  // a saída dele (o processo que ele mesmo abriu ainda segura o cano), então
  // esperar o "close" para avisar deixaria o card preso do mesmo jeito.
  const relogio = setTimeout(() => {
    try { proc.kill(); } catch { /* já morreu */ }
    terminar('A instalação passou do tempo limite (' + Math.max(1, Math.round(WA_LIB_TEMPO_MAX / 60000))
      + ' min) e foi encerrada. Confira a internet e tente de novo.');
  }, WA_LIB_TEMPO_MAX);
  proc.on('error', (err) => {
    terminar('Não achei o npm neste computador (' + String(err.message || err).slice(0, 120)
      + '). O npm vem junto com o Node.js: instale em nodejs.org e abra o programa de novo.');
  });
  proc.on('close', (codigo) => {
    terminar(codigo === 0 ? '' : ('O npm não conseguiu baixar a biblioteca: ' + resumoDoErroNpm(saida)));
  });
}
// O QR do pareamento vira matriz de pontos e vai para o card de Conexões
function broadcastWaQr(qrTexto) {
  let matriz = null;
  if (qrTexto) { try { matriz = makeQrMatrix(String(qrTexto)); } catch { matriz = null; } }
  // 🔒 v0.127.1: quem escaneia o QR pareia o PRÓPRIO celular como o número
  // da live — só o computador do streamer vê
  const mensagem = JSON.stringify({ type: 'waQr', matriz });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN && client.role === 'local') client.send(mensagem);
  }
}

const CONNECTORS = {
  twitch: TwitchConnector,
  kick: KickConnector,
  youtube: YouTubeConnector,
  bilibili: BilibiliConnector,
  telegram: TelegramConnector,
  whatsapp: WhatsAppConnector,
};

function connect(platform, channel, options = {}) {
  // hasOwnProperty: sem isso, "constructor"/"toString" passavam por conector
  // válido e a tentativa de usá-los derrubava o programa.
  const Connector = Object.prototype.hasOwnProperty.call(CONNECTORS, platform) ? CONNECTORS[platform] : null;
  // 📨 No Telegram o grupo pode ficar vazio (= qualquer conversa do bot):
  // o '*' guarda o lugar para a memória de conexões funcionar como sempre
  if ((platform === 'telegram' || platform === 'whatsapp') && !String(channel || '').trim()) channel = '*';
  if (!Connector || !channel || !String(channel).trim()) return;
  // Bilibili e experimental: so conecta com o seletor do Labs ligado
  if (platform === 'bilibili' && state.settings.labs?.bilibili !== true) {
    setStatus('bilibili', 'error', 'A Bilibili é experimental — ative em Configurações → 🧪 Labs para usar.');
    return;
  }
  // 📨 Telegram também é experimental: só com o seletor do Labs ligado
  if (platform === 'telegram' && state.settings.labs?.telegram !== true) {
    setStatus('telegram', 'error', 'O Telegram é experimental — ative em Configurações → 🧪 Labs para usar.');
    return;
  }
  // 💬 WhatsApp idem — e o card do Labs carrega o aviso de risco
  if (platform === 'whatsapp' && state.settings.labs?.whatsapp !== true) {
    setStatus('whatsapp', 'error', 'O WhatsApp é experimental — ative em Configurações → 🧪 Labs para usar.');
    return;
  }
  disconnect(platform, true);

  // 🔒 v0.127.1: só as opções que o painel tem o direito de mandar. As
  // outras (apiBase, intervaloMs...) são ganchos de teste dos conectores —
  // vindas da rede, um "apiBase" apontado para fora mandava o token do bot
  // para o endereço de outra pessoa.
  {
    const o = options && typeof options === 'object' ? options : {};
    options = {};
    if (typeof o.token === 'string' && o.token.trim()) options.token = o.token.trim().slice(0, 200);
    if (o.modo === 'local' || o.modo === 'whapi') options.modo = o.modo;
    if (typeof o.cookie === 'string' && o.cookie.trim()) options.cookie = o.cookie.replace(/[\r\n]/g, '').slice(0, 4000);
  }

  const handlers = {
    onMessage: onChatMessage,
    // 🗑️ A plataforma avisou que uma mensagem (ou tudo de alguém) foi apagada
    onRemove: (aviso) => removerMensagens({ ...aviso, platform: aviso.platform || platform }),
    // A Twitch precisa do Client-ID público para buscar o catálogo de selos
    twitchClientId: getTwitchClientId,
    // Recuperar mensagens perdidas ao (re)conectar? (Labs, ligado por padrão)
    recoverEnabled: () => state.settings.labs?.recoverHistory === true,
    // 👥 v0.141: aceitar mensagens de grupo, canal e comunidade? Perguntado
    // a CADA mensagem — virar o seletor vale na hora, sem reconectar nada.
    // A conversa direta com o número/bot da live entra sempre, de qualquer jeito.
    aceitaGrupos: () => (state.settings.chats || {})[
      platform === 'telegram' ? 'telegramGrupos' : 'whatsappGrupos'
    ] !== false,
    // 📎 Mídia dos inscritos (Telegram/WhatsApp): o conector baixa e o
    // servidor guarda na quarentena local — a tela só vê quando o
    // apresentador manda
    salvarMidia: salvarMidiaInscrito,
    // 🖼️ v0.72: o conector descobriu a foto de perfil de alguém (Telegram/
    // WhatsApp) — espalha retroativamente nas mensagens já na memória e
    // avisa os painéis (avatarFix), como nos avatares das outras redes
    onAvatar: (chave, avatar) => backfillAvatar(platform, chave, avatar),
    onStatus: (statusState, detail) => {
      // Ignora eventos de um conector que ja foi trocado/desligado.
      if (state.connectors[platform] !== instance) return;
      if (statusState === 'error') {
        delete state.connectors[platform];
        instance.stop();
      }
      setStatus(platform, statusState, detail);
    },
  };
  // 🔑 v0.70.1: o token digitado da última vez fica guardado (data/) — se o
  // campo veio vazio, reusa o guardado em vez de falhar pedindo de novo
  if ((platform === 'telegram' || platform === 'whatsapp') && !options.token && state.connections[platform]?.token) {
    options = { ...options, token: state.connections[platform].token };
  }

  // 💬 WhatsApp tem DOIS modos: gateway Whapi (padrão) e biblioteca local.
  // O modo escolhido fica lembrado nas conexões para o reconectar.
  let ConnectorFinal = Connector;
  let opcoesFinal = options;
  let waModo = null;
  if (platform === 'whatsapp') {
    waModo = (options.modo === 'local' || (!options.modo && state.connections.whatsapp?.modo === 'local')) ? 'local' : 'whapi';
    if (waModo === 'local') {
      ConnectorFinal = WhatsAppLocalConnector;
      opcoesFinal = { ...options, dirEstado: WA_SESSAO_DIR, carregarBaileys: waLibCarregar, aoQr: broadcastWaQr };
    }
  }
  const instance = new ConnectorFinal(String(channel), handlers, opcoesFinal);
  state.connectors[platform] = instance;
  // Memoria: lembra o canal para preencher e reconectar na proxima vez
  state.connections[platform] = { channel: String(channel), active: true };
  // 📨 O token do bot do Telegram fica lembrado (data/, só nesta máquina)
  // para reconectar sem redigitar — como o canal das outras redes
  if ((platform === 'telegram' || platform === 'whatsapp') && options.token) state.connections[platform].token = String(options.token).slice(0, 200);
  if (waModo) state.connections[platform].modo = waModo;
  persistConnections();
  state.status[platform] = { state: 'connecting', detail: '', channel: String(channel) };
  broadcast({ type: 'status', platform, status: state.status[platform] });
  Promise.resolve(instance.start()).catch((err) => {
    if (state.connectors[platform] === instance) {
      delete state.connectors[platform];
      setStatus(platform, 'error', `Erro inesperado: ${err.message}`);
    }
  });
  // Busca a audiencia logo depois de conectar (o loop de 30s continua depois).
  setTimeout(() => pollAudience().catch(() => {}), 3000);
}

function disconnect(platform, silent = false) {
  const instance = state.connectors[platform];
  if (instance) {
    delete state.connectors[platform];
    try { instance.stop(); } catch {}
  }
  if (state.audience.platforms[platform]) {
    delete state.audience.platforms[platform];
    broadcast({ type: 'audience', audience: state.audience });
  }
  if (!silent) {
    setStatus(platform, 'disconnected', 'Desconectado');
    // Desconexao pedida pelo usuario: nao reconecta sozinho na proxima vez
    if (state.connections[platform]) {
      state.connections[platform].active = false;
      persistConnections();
    }
  }
}

let testCounter = 0;
// 🧪 v0.121: as amostras do botão de teste cobrem, rede por rede, TODOS os
// detalhes que um comentário pode trazer — cargos e selos (com a arte da
// rede quando ela existe), nível e tempo de membro, cor do nome, emotes,
// Super Chat de cada cor, Super Sticker, moeda estrangeira, @/telefone,
// foto de perfil, grupo de origem e mídia de cada tipo. Assim o destaque, os
// moldes e o 🎭 automático podem ser conferidos sem esperar a live.
//   textos  = frases que se revezam a cada envio da mesma amostra
//   midia   = arquivo de public/amostras/ que entra pela MESMA quarentena da
//             mídia real (/midia-inscritos/), como se um inscrito mandasse
//   real    = comentário que entra sem a etiqueta "teste"
const AMOSTRAS_DIR = path.join(PUBLIC_DIR, 'amostras');
const SELO_MOD_TWITCH = 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/2';
const SELO_VIP_TWITCH = 'https://static-cdn.jtvnw.net/badges/v1/b817aba4-fad8-49e2-b88a-7cc744dfa6ec/2';
const SELO_DONO_TWITCH = 'https://static-cdn.jtvnw.net/badges/v1/5527c58c-fb7d-422d-b71b-f309dcb85cc1/2';
const SELO_PRIME_TWITCH = 'https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/2';
const SELO_VERIFICADO_TWITCH = 'https://static-cdn.jtvnw.net/badges/v1/d12a2e27-16f6-41d0-ab77-b780518f00a3/2';
const EMOTE_KAPPA = 'https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0';
const TEST_SAMPLES = [
  // ---------------- 📺 YouTube ----------------
  { platform: 'youtube', author: 'João Silva', authorId: 'UCa1b2c3d4e5f6g7h8i9j0k1lm', text: 'Primeira vez na live, salve do Brasil!' },
  {
    // Sem foto embutida no programa: a amostra usa a inicial colorida, como
    // qualquer pessoa que chega sem avatar.
    platform: 'youtube', author: 'wibson', authorLogin: '@wibson', real: true,
    textos: [
      'nao se maquiou mais olha a barba show',
      'WILL, NANEETTI vcs preferem um macbook ou comprar uma bluetti',
      'NANNETTI é possivem uma globo sbt ou record uma tv qualquer não que eu va lá pagar custos home-office para um clt ?',
      'NANNETTi vc lava louças ?',
    ],
  },
  {
    platform: 'youtube', author: 'Canal do Streamer', text: 'Valeu pela presença, pessoal! Fiquem até o fim 🙌',
    badges: ['dono'], selos: [{ id: 'youtube:dono', cargo: 'dono', nome: 'Dono do canal', img: null }],
  },
  {
    platform: 'youtube', author: 'Mod Regina', text: 'Respeitem as regras do chat, por favor 🛡️',
    badges: ['mod', 'membro'], subTier: 'member', memberLevel: 'Membro (1 ano)', membroMeses: 12,
    selos: [
      { id: 'youtube:mod', cargo: 'mod', nome: 'Moderador', img: null },
      { id: 'youtube:membro', cargo: 'membro', nome: 'Membro (1 ano)', img: null },
    ],
  },
  {
    platform: 'youtube', author: 'Canal Parceiro', text: 'Parabéns pela live, colega de plataforma!',
    badges: ['verificado'], selos: [{ id: 'youtube:verificado', cargo: 'verificado', nome: 'Verificado', img: null }],
  },
  {
    platform: 'youtube', author: 'Novato Membro', text: 'Acabei de virar membro! 🎉', badges: ['membro'], subTier: 'member',
    memberLevel: 'Novo membro', membroMeses: 0,
    selos: [{ id: 'youtube:membro', cargo: 'membro', nome: 'Novo membro', img: null }],
  },
  {
    platform: 'youtube', author: 'Carlos Membro', text: 'Membro há 6 meses e cada dia melhor!', badges: ['membro'], subTier: 'member',
    // 🕒 v0.118: o selo de membro traz o tempo (para a faixa por tempo de membro)
    memberLevel: 'Member (6 months)', membroMeses: 6,
    selos: [{ id: 'youtube:membro', cargo: 'membro', nome: 'Member (6 months)', img: null }],
  },
  {
    // emoji do próprio canal no meio do texto (o YouTube manda como imagem)
    platform: 'youtube', author: 'Veterana Ouro', badges: ['membro'], subTier: 'member', memberLevel: 'Membro Ouro (2 anos)', membroMeses: 24,
    selos: [{ id: 'youtube:membro', cargo: 'membro', nome: 'Membro Ouro (2 anos)', img: null }],
    runs: [{ type: 'text', text: 'Dois anos de membro ' }, { type: 'emote', alt: ':coracao-do-canal:', url: '/amostras/emoji.png' }, { type: 'text', text: ' e contando!' }],
  },
  {
    platform: 'youtube', author: 'Apoiador Azul', text: 'Pequeno apoio, grande carinho 💙',
    superchat: { amount: 'R$ 5,00', color: '#1e88e5', headerColor: '#1565c0', textColor: '#ffffff' }, badges: ['superchat R$ 5,00'],
  },
  {
    platform: 'youtube', author: 'Apoiadora Ciano', text: 'Adoro esse quadro! 🩵',
    superchat: { amount: 'R$ 10,00', color: '#00e5ff', headerColor: '#00b8d4', textColor: '#000000' }, badges: ['superchat R$ 10,00'],
  },
  {
    platform: 'youtube', author: 'Apoiador Verde', text: 'Toma um cafezinho! ☕',
    superchat: { amount: 'R$ 20,00', color: '#1de9b6', headerColor: '#00bfa5', textColor: '#000000' }, badges: ['superchat R$ 20,00'],
  },
  {
    platform: 'youtube', author: 'Ana Apoiadora', text: 'Continua com o ótimo trabalho 💛',
    superchat: { amount: 'R$ 50,00', color: '#ffca28', headerColor: '#ffb300', textColor: '#000000' }, badges: ['superchat R$ 50,00'],
  },
  {
    platform: 'youtube', author: 'Apoiador Laranja', text: 'Pelo canal e pela comunidade! 🧡',
    superchat: { amount: 'R$ 100,00', color: '#f57c00', headerColor: '#e65100', textColor: '#ffffff' }, badges: ['superchat R$ 100,00'],
  },
  {
    platform: 'youtube', author: 'Apoiadora Magenta', text: 'Melhor live da semana 💜',
    superchat: { amount: 'R$ 250,00', color: '#e91e63', headerColor: '#c2185b', textColor: '#ffffff' }, badges: ['superchat R$ 250,00'],
  },
  {
    platform: 'youtube', author: 'Apoiador Vermelho', text: 'Presente de aniversário do canal! ❤️🎂',
    superchat: { amount: 'R$ 500,00', color: '#e62117', headerColor: '#d00000', textColor: '#ffffff' }, badges: ['superchat R$ 500,00'],
  },
  {
    // Super Chat SEM texto (o YouTube permite)
    platform: 'youtube', author: 'Apoiador Silencioso', text: '',
    superchat: { amount: 'R$ 10,00', color: '#00e5ff', headerColor: '#00b8d4', textColor: '#000000' }, badges: ['superchat R$ 10,00'],
  },
  {
    platform: 'youtube', author: 'Gringo Fan', text: 'Greetings from the US! Love the stream 🇺🇸',
    superchat: { amount: '$5.00', color: '#1e88e5', headerColor: '#1565c0', textColor: '#ffffff' }, badges: ['superchat $5.00'],
  },
  {
    platform: 'youtube', author: 'Amiga de Lisboa', text: 'Um abraço de Portugal! 🇵🇹',
    superchat: { amount: '€10,00', color: '#ffca28', headerColor: '#ffb300', textColor: '#000000' }, badges: ['superchat €10,00'],
  },
  {
    // 🎟️ v0.118: Super Sticker — a figurinha paga no lugar do texto
    platform: 'youtube', author: 'Bia Figurinha', text: 'Super Sticker',
    runs: [{ type: 'emote', alt: 'Super Sticker', url: 'https://www.gstatic.com/youtube/img/superstickers/gerbil/gerbil_super_sticker_1.png', figurinha: true }],
    superchat: { amount: 'R$ 5,00', color: '#1de9b6', headerColor: '#00bfa5', textColor: '#000000', figurinha: true },
    badges: ['superchat R$ 5,00'],
  },
  // ---------------- 🟣 Twitch ----------------
  {
    platform: 'twitch', author: 'maria_gamer', authorLogin: 'maria_gamer', authorColor: '#ff69b4',
    runs: [{ type: 'text', text: 'Esse overlay ficou muito bom! ' }, { type: 'emote', alt: 'Kappa', url: EMOTE_KAPPA }],
  },
  {
    platform: 'twitch', author: 'ZeModera', authorLogin: 'zemodera', authorColor: '#1e90ff', text: 'Sem link no chat, pessoal 😅',
    badges: ['mod', 'sub'], subTier: 't3',
    // Distintivos completos, como a Twitch manda de verdade (com a arte dela)
    selos: [
      { id: 'twitch:moderator', cargo: 'mod', nome: 'Moderador', img: SELO_MOD_TWITCH },
      { id: 'twitch:subscriber', cargo: 'sub', nome: 'Assinante há 2 anos', img: null },
    ],
  },
  {
    platform: 'twitch', author: 'CanalDoStreamer', authorLogin: 'canaldostreamer', authorColor: '#e91916', text: 'Obrigado pelo raid, galera! 💜',
    badges: ['dono'], selos: [{ id: 'twitch:broadcaster', cargo: 'dono', nome: 'Transmissor', img: SELO_DONO_TWITCH }],
  },
  {
    platform: 'twitch', author: 'Vipzinha', authorLogin: 'vipzinha', authorColor: '#9147ff', text: 'VIP presente com bits guardados 💎',
    badges: ['vip', 'sub'], subTier: 't1',
    selos: [
      { id: 'twitch:vip', cargo: 'vip', nome: 'VIP', img: SELO_VIP_TWITCH },
      { id: 'twitch:subscriber', cargo: 'sub', nome: 'Assinante há 3 meses', img: null },
      { id: 'twitch:bits', cargo: null, nome: 'Cheer 1000', img: null },
    ],
  },
  {
    platform: 'twitch', author: 'PrimeiroDaFila', authorLogin: 'primeirodafila', authorColor: '#00ff7f', text: 'Fundador desde o primeiro dia! 🏆',
    badges: ['sub'], subTier: 'twitchFounder',
    selos: [{ id: 'twitch:founder', cargo: 'founder', nome: 'Fundador', img: null }, { id: 'twitch:sub-gifter', cargo: null, nome: 'Presenteou 10 assinaturas', img: null }],
  },
  {
    platform: 'twitch', author: 'AssinantePrime', authorLogin: 'assinanteprime', authorColor: '#daa520', text: 'Sub do Prime renovada 📦',
    badges: ['sub'], subTier: 'prime',
    selos: [{ id: 'twitch:premium', cargo: null, nome: 'Prime Gaming', img: SELO_PRIME_TWITCH }, { id: 'twitch:subscriber', cargo: 'sub', nome: 'Assinante', img: null }],
  },
  {
    platform: 'twitch', author: 'TierDois', authorLogin: 'tierdois', authorColor: '#ff7f50', text: 'Tier 2 na área 🥈',
    badges: ['sub'], subTier: 't2', selos: [{ id: 'twitch:subscriber', cargo: 'sub', nome: 'Assinante há 1 ano', img: null }],
  },
  {
    platform: 'twitch', author: 'StreamerAmigo', authorLogin: 'streameramigo', authorColor: '#8a2be2', text: 'Passando pra prestigiar ✨',
    selos: [{ id: 'twitch:partner', cargo: null, nome: 'Parceiro verificado', img: SELO_VERIFICADO_TWITCH }],
  },
  { platform: 'twitch', author: 'Nightbot', authorLogin: 'nightbot', text: 'Siga o canal nas redes sociais! 🤖', badges: ['bot'] },
  // ---------------- 🟢 Kick ----------------
  { platform: 'kick', author: 'pedrinho77', authorLogin: 'pedrinho77', authorColor: '#53fc18', text: 'kkkkk melhor momento da live' },
  {
    platform: 'kick', author: 'vip_da_casa', authorLogin: 'vip_da_casa', authorColor: '#ff9f1c', text: 'Cheguei com a galera! 🎉',
    badges: ['vip'],
    selos: [
      { id: 'kick:vip', cargo: 'vip', nome: 'VIP do canal', img: null },
      { id: 'kick:sub_gifter', cargo: null, nome: 'Presenteou 5 assinaturas', img: null },
    ],
  },
  {
    platform: 'kick', author: 'Fundador_OG', authorLogin: 'fundador_og', authorColor: '#00e5ff', text: 'OG e fundador, tá ligado? 😎',
    badges: ['founder', 'og', 'verificado'], subTier: 'kickFounder',
    selos: [
      { id: 'kick:founder', cargo: 'founder', nome: 'Fundador', img: null },
      { id: 'kick:og', cargo: 'og', nome: 'OG', img: null },
      { id: 'kick:verified', cargo: 'verificado', nome: 'Verificado', img: null },
    ],
  },
  {
    platform: 'kick', author: 'ModDaKick', authorLogin: 'moddakick', authorColor: '#ff4757', text: 'Bora manter o chat em ordem 🛡️',
    badges: ['mod', 'sub'], subTier: 'kick',
    selos: [
      { id: 'kick:moderator', cargo: 'mod', nome: 'Moderador', img: null },
      { id: 'kick:subscriber', cargo: 'sub', nome: 'Assinante há 4 meses', img: null },
    ],
  },
  {
    platform: 'kick', author: 'DonoDaKick', authorLogin: 'donodakick', authorColor: '#53fc18', text: 'Valeu por estarem aqui! 🙏',
    badges: ['dono'], selos: [{ id: 'kick:broadcaster', cargo: 'dono', nome: 'Transmissor', img: null }],
  },
  { platform: 'kick', author: 'BotRix', authorLogin: 'botrix', text: 'Comandos: !discord !redes', badges: ['bot'] },
  // ---------------- 🩵 Bilibili ----------------
  { platform: 'bilibili', author: '小明', authorLogin: '4521', text: '主播好棒！' },
  {
    platform: 'bilibili', author: '小红', authorLogin: '9876', text: '来自上海的支持！🇨🇳',
    superchat: { amount: 'CN¥ 30', color: '#00a1d6', headerColor: '#00a1d6', textColor: '#000000' }, badges: ['superchat CN¥ 30'],
  },
  // ---------------- 💚 Apoios (doação / Pix) ----------------
  {
    platform: 'doacao', author: 'Fã Generoso', text: 'Toma um apoio, continua assim! 🚀',
    superchat: { amount: 'R$ 10,00', color: '#32bcad', headerColor: '#32bcad', textColor: '#000000' }, badges: ['doação R$ 10,00'],
  },
  {
    platform: 'doacao', author: 'Apoiadora Pix', text: 'Pix enviado com carinho 💚',
    superchat: { amount: 'R$ 50,00', color: '#32bcad', headerColor: '#32bcad', textColor: '#000000' }, badges: ['doação R$ 50,00'],
  },
  // ---------------- 📨 Telegram ----------------
  { platform: 'telegram', author: 'Tio do Zap', authorLogin: '@tiodozap', authorId: '10001', avatar: '/amostras/avatar-tg.png', channel: 'Grupo da Live', text: 'Mandei um salve pelo Telegram! 📨' },
  { platform: 'telegram', author: 'Tio do Zap', authorLogin: '@tiodozap', authorId: '10001', avatar: '/amostras/avatar-tg.png', channel: 'Grupo da Live', text: 'Olha a foto que tirei da tela 📸', midia: { tipo: 'imagem', nome: 'foto', arquivo: 'foto.png' } },
  { platform: 'telegram', author: 'Sobrinha do Zap', authorLogin: '', authorId: '10002', channel: 'Grupo da Live', text: '', midia: { tipo: 'audio', nome: 'mensagem de voz', arquivo: 'voz.ogg', duracao: 2 } },
  { platform: 'telegram', author: 'Tio do Zap', authorLogin: '@tiodozap', authorId: '10001', avatar: '/amostras/avatar-tg.png', channel: 'Grupo da Live', text: 'Gravei esse vídeo pra vocês 🎬', midia: { tipo: 'video', nome: 'video.mp4', arquivo: 'video.mp4', duracao: 2 } },
  { platform: 'telegram', author: 'Sobrinha do Zap', authorLogin: '', authorId: '10002', channel: 'Grupo da Live', text: '', midia: { tipo: 'imagem', nome: 'figurinha', arquivo: 'figurinha.webp' } },
  { platform: 'telegram', author: 'Sobrinha do Zap', authorLogin: '', authorId: '10002', channel: 'Grupo da Live', text: '', midia: { tipo: 'lottie', nome: 'figurinha', arquivo: 'figurinha.tgs' } },
  { platform: 'telegram', author: 'Sobrinha do Zap', authorLogin: '', authorId: '10002', channel: 'Grupo da Live', text: '', midia: { tipo: 'video', nome: 'figurinha', arquivo: 'figurinha.webm' } },
  { platform: 'telegram', author: 'Tio do Zap', authorLogin: '@tiodozap', authorId: '10001', avatar: '/amostras/avatar-tg.png', channel: 'Grupo da Live', text: 'Segue o arquivo que prometi 📎', midia: { tipo: 'arquivo', nome: 'arquivo.txt', arquivo: 'arquivo.txt' } },
  { platform: 'telegram', author: 'Tio do Zap', authorLogin: '@tiodozap', authorId: '10001', avatar: '/amostras/avatar-tg.png', channel: 'Grupo da Live', text: '📍 Praça da Sé — São Paulo, SP (-23.55052, -46.63331)' },
  // ---------------- 💬 WhatsApp ----------------
  { platform: 'whatsapp', author: 'Prima da Live', authorLogin: '5511912345678', authorId: '5511912345678', avatar: '/amostras/avatar-wa.png', channel: 'Grupo da Live', text: 'Cheguei pelo WhatsApp! 💬' },
  // número sem nome salvo: na tela vira "📱 Convidado", só o painel vê o número
  { platform: 'whatsapp', author: '+55 21 99876-5432', authorLogin: '5521998765432', authorId: '5521998765432', channel: 'Grupo da Live', text: 'Oi, é a primeira vez que mando mensagem aqui' },
  { platform: 'whatsapp', author: 'Prima da Live', authorLogin: '5511912345678', authorId: '5511912345678', avatar: '/amostras/avatar-wa.png', channel: 'Grupo da Live', text: 'Olha essa foto 😍', midia: { tipo: 'imagem', nome: 'foto', arquivo: 'foto.png' } },
  { platform: 'whatsapp', author: 'Prima da Live', authorLogin: '5511912345678', authorId: '5511912345678', avatar: '/amostras/avatar-wa.png', channel: 'Grupo da Live', text: '', midia: { tipo: 'audio', nome: 'mensagem de voz', arquivo: 'voz.ogg', duracao: 2 } },
  { platform: 'whatsapp', author: 'Prima da Live', authorLogin: '5511912345678', authorId: '5511912345678', avatar: '/amostras/avatar-wa.png', channel: 'Grupo da Live', text: 'Vídeo da festa 🎉', midia: { tipo: 'video', nome: 'video.mp4', arquivo: 'video.mp4', duracao: 2 } },
  { platform: 'whatsapp', author: 'Prima da Live', authorLogin: '5511912345678', authorId: '5511912345678', avatar: '/amostras/avatar-wa.png', channel: 'Grupo da Live', text: '', midia: { tipo: 'imagem', nome: 'figurinha', arquivo: 'figurinha.webp' } },
  { platform: 'whatsapp', author: 'Prima da Live', authorLogin: '5511912345678', authorId: '5511912345678', avatar: '/amostras/avatar-wa.png', channel: 'Grupo da Live', text: 'O documento que você pediu 📄', midia: { tipo: 'arquivo', nome: 'arquivo.txt', arquivo: 'arquivo.txt' } },
];

// A mídia de uma amostra entra pela mesma quarentena da mídia real. Guardada
// uma vez por arquivo; se a faxina do teto a levou, entra de novo.
const amostraMidiaGuardada = new Map();
function midiaDeAmostra(m) {
  if (!m || typeof m !== 'object' || !m.arquivo) return null;
  const { arquivo, ...resto } = m;
  const nome = path.basename(String(arquivo));
  const antiga = amostraMidiaGuardada.get(nome);
  if (antiga && fs.existsSync(path.join(MIDIA_INSCRITOS_DIR, path.basename(antiga)))) return { ...resto, url: antiga };
  let buffer = null;
  try { buffer = fs.readFileSync(path.join(AMOSTRAS_DIR, nome)); } catch { return null; }
  const ext = (nome.match(/\.([A-Za-z0-9]+)$/) || [])[1] || 'bin';
  const url = salvarMidiaInscrito(buffer, ext, nome);
  if (!url) return null;
  amostraMidiaGuardada.set(nome, url);
  return { ...resto, url };
}

const testVezes = new Map(); // amostra com vários textos: qual é o próximo
// 🧪 v0.137: as fichas que os comentários de mentira criaram no 🎁 sorteio.
// Guardamos a chave de cada uma para conseguir tirá-las depois sem encostar
// em ninguém de verdade — senão os nomes fakes ficavam concorrendo no sorteio.
const participantesDeTeste = new Set();
function sendTestMessage(atrasMs = 0) {
  let sample = TEST_SAMPLES[testCounter++ % TEST_SAMPLES.length];
  // Amostras de funcoes desligadas no Labs sao puladas
  for (let i = 0; i < TEST_SAMPLES.length; i++) {
    const desligada = (sample.platform === 'doacao'
        && state.settings.labs?.donations !== true && state.settings.labs?.pix !== true)
      || (sample.platform === 'bilibili' && state.settings.labs?.bilibili !== true)
      || (sample.platform === 'telegram' && state.settings.labs?.telegram !== true)
      || (sample.platform === 'whatsapp' && state.settings.labs?.whatsapp !== true);
    if (!desligada) break;
    sample = TEST_SAMPLES[testCounter++ % TEST_SAMPLES.length];
  }
  let texto = sample.text;
  if (Array.isArray(sample.textos) && sample.textos.length) {
    const vez = testVezes.get(sample) || 0;
    texto = sample.textos[vez % sample.textos.length];
    testVezes.set(sample, vez + 1);
  }
  const badges = sample.badges ? [...sample.badges] : [];
  if (sample.real !== true) badges.push('teste');
  const midia = midiaDeAmostra(sample.midia);
  const mensagem = {
    platform: sample.platform,
    channel: sample.channel || 'teste',
    id: `test-${Date.now()}-${testCounter}`,
    author: sample.author,
    authorId: sample.authorId || null,
    authorLogin: sample.authorLogin || null,
    authorColor: sample.authorColor || null,
    avatar: sample.avatar || null,
    badges,
    selos: sample.selos || null,
    subTier: sample.subTier || null,
    memberLevel: sample.memberLevel || null,
    superchat: sample.superchat || null,
    membroMeses: Number.isFinite(sample.membroMeses) ? sample.membroMeses : null, // 🕒 v0.118
    runs: Array.isArray(sample.runs) ? sample.runs : [{ type: 'text', text: String(texto || '') || (midia ? `[${midia.nome}]` : '') }],
    midia: midia || undefined,
    timestamp: Date.now() - atrasMs,
  };
  // 🧪 v0.137: fica anotado quem entrou no sorteio por causa desta amostra
  participantesDeTeste.add(chaveParticipante(mensagem));
  // 🎟️ v0.119: a amostra de Super Sticker faz o mesmo caminho da figurinha
  // real — baixa para a quarentena local e vai para a tela como mídia
  const fig = mensagem.runs[0];
  if (fig && fig.figurinha === true && typeof baixarFigurinhaYouTube === 'function') {
    baixarFigurinhaYouTube(fig.url, salvarMidiaInscrito).then((midiaFig) => {
      if (midiaFig) { mensagem.midia = midiaFig; mensagem.runs = [{ type: 'text', text: '' }]; }
      onChatMessage(mensagem);
    });
    return;
  }
  onChatMessage(mensagem);
}

// ===========================================================================
// 🎵 Mesa de trilhas (Labs) — os botões de som do streamer.
// O servidor guarda a lista e diz "toca esta agora"; quem TOCA de verdade são
// as telas: o overlay (na live, pelo áudio da fonte de navegador do OBS) e/ou
// o painel — conforme o destino de cada trilha.
// ===========================================================================
const TRILHAS_MAX = 200;
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.oga', '.weba', '.m4a', '.aac', '.flac', '.opus']);

// ---------------------------------------------------------------------------
// 🎛️ As ações do OBS, do jeito que elas viram BOTÃO. É a mesma lista que o
// plugin oficial do Stream Deck oferece: cada linha é uma ação, com o alvo
// que ela precisa (cena, fonte, filtro...) e o modo (alternar/ligar/desligar).
// O painel e a Mesa de Trilhas mandam sempre a mesma mensagem: obsAcao.
// Mora aqui em cima porque as teclas da Mesa (logo abaixo) já nascem sabendo
// comandar o OBS — a conexão em si fica lá embaixo, na seção 🎬.
// ---------------------------------------------------------------------------
const OBS_ACOES = {
  // saídas
  gravar: { modos: ['alternar', 'iniciar', 'parar'] },
  gravarPausa: { modos: ['alternar', 'pausar', 'continuar'] },
  capitulo: { texto: true },
  transmitir: { modos: ['alternar', 'iniciar', 'parar'] },
  camVirtual: { modos: ['alternar', 'iniciar', 'parar'] },
  replay: { modos: ['alternar', 'iniciar', 'parar'] },
  salvarReplay: {},
  captura: { fonte: true },
  // organização
  colecao: { nome: true },
  perfil: { nome: true },
  cena: { nome: true, modos: ['auto', 'programa', 'preview'] },
  estudio: { modos: ['alternar', 'ligar', 'desligar'] },
  transicaoEstudio: {},
  transicao: { nome: true, duracao: true },
  transicaoCena: { cena: true, nome: true, duracao: true },
  // conteúdo
  fonte: { cena: true, fonte: true, id: true, modos: ['alternar', 'mostrar', 'esconder'] },
  filtro: { fonte: true, filtro: true, modos: ['alternar', 'ligar', 'desligar'] },
  audioMudo: { fonte: true, modos: ['alternar', 'mudo', 'som'] },
  audioVolume: { fonte: true, modos: ['definir', 'ajustar'], db: true },
  midia: { fonte: true, modos: ['alternar', 'tocar', 'pausar', 'parar', 'recomecar', 'proxima', 'anterior'] },
  // ⌨️ v0.83: dispara QUALQUER atalho do OBS pelo nome — é o coringa que
  // cobre o que ainda não tem botão próprio no painel
  atalho: { nome: true },
};

// O que a tela mandou, dentro dos limites — o que não serve vira o padrão
// Object.hasOwn: sem isso, '__proto__', 'constructor' e 'toString' passariam
// por nomes de ação válidos (e o alvo de uma ação inexistente seria aceito)
const acaoConhecida = (nome) => typeof nome === 'string' && Object.hasOwn(OBS_ACOES, nome);

function sanitizeObsAlvo(acao, bruto) {
  if (!acaoConhecida(acao)) return null;
  const spec = OBS_ACOES[acao];
  const a = bruto && typeof bruto === 'object' ? bruto : {};
  const alvo = {};
  if (spec.modos) alvo.modo = spec.modos.includes(a.modo) ? a.modo : spec.modos[0];
  if (spec.nome) alvo.nome = String(a.nome || '').slice(0, 200);
  if (spec.cena) alvo.cena = String(a.cena || '').slice(0, 200);
  if (spec.fonte) alvo.fonte = String(a.fonte || '').slice(0, 200);
  if (spec.filtro) alvo.filtro = String(a.filtro || '').slice(0, 200);
  // Número do item dentro da cena (o OBS numera cada aparição da fonte)
  if (spec.id) alvo.id = Math.max(0, Math.min(1000000, Math.floor(Number(a.id) || 0)));
  if (spec.texto) alvo.texto = String(a.texto || '').slice(0, 200);
  // Volume em dB: a escala do OBS vai de -100 (mudo) a +26
  if (spec.db) alvo.db = Math.round(numeroEntre(a.db, -100, 26, 0) * 10) / 10;
  // Duração da transição em ms (0 = não mexe na que já está lá)
  if (spec.duracao) alvo.duracao = Math.round(numeroEntre(a.duracao, 0, 20000, 0));
  return alvo;
}

// ---------------------------------------------------------------------------
// 🎛️ v0.122: as ações do vMix, do jeito que elas viram BOTÃO — o espelho da
// tabela do OBS acima, com o vocabulário do vMix (entradas em vez de cenas,
// 4 botões de transição, overlays 1-4, saída externa, MultiCorder...).
// `entrada` aceita o NÚMERO, a chave (GUID) ou o título da entrada — é o que
// a API do vMix aceita em "Input=". `funcao` é o coringa: qualquer função
// do vMix pelo nome (a lista oficial é enorme e cresce a cada versão).
// ---------------------------------------------------------------------------
const VMIX_ACOES = {
  // programa / preview
  entrada: { entrada: true, modos: ['transicao', 'cortar', 'fundir', 'preview', 'direto'], duracao: true },
  transicao: { modos: ['transicao1', 'transicao2', 'transicao3', 'transicao4', 'cortar', 'fundir', 'stinger1', 'stinger2'], duracao: true },
  escurecer: { modos: ['alternar'] },
  // saídas
  gravar: { modos: ['alternar', 'iniciar', 'parar'] },
  transmitir: { modos: ['alternar', 'iniciar', 'parar'], canal: true },
  externa: { modos: ['alternar', 'iniciar', 'parar'] },
  multiCorder: { modos: ['alternar', 'iniciar', 'parar'] },
  telaCheia: { modos: ['alternar', 'ligar', 'desligar'] },
  playlist: { modos: ['iniciar', 'parar'] },
  captura: { texto: true },
  marcador: {},
  // overlays
  overlay: { canal: true, entrada: true, modos: ['alternar', 'entrar', 'sair', 'desligar'] },
  overlaysDesligar: {},
  // áudio
  audioMudo: { entrada: true, modos: ['alternar', 'mudo', 'som'] },
  audioVolume: { entrada: true, modos: ['definir', 'ajustar'], volume: true },
  audioSolo: { entrada: true, modos: ['alternar', 'ligar', 'desligar'] },
  masterMudo: { modos: ['alternar', 'mudo', 'som'] },
  masterVolume: { modos: ['definir', 'ajustar'], volume: true },
  // conteúdo
  midia: { entrada: true, modos: ['alternar', 'tocar', 'pausar', 'recomecar', 'proximo', 'anterior'] },
  titulo: { entrada: true, campo: true, texto: true },
  tituloAnimar: { entrada: true, modos: ['TransitionIn', 'TransitionOut', 'Page1', 'Page2', 'Continuous'] },
  replay: { modos: ['marcarInicio', 'marcarFim', 'marcarUltimos', 'tocarUltimo', 'gravar', 'pararGravar'], segundos: true },
  preset: { modos: ['ultimo', 'salvar'] },
  script: { nome: true, modos: ['iniciar', 'parar'] },
  tecla: { nome: true },
  funcao: { nome: true, entrada: true, texto: true, duracao: true },
};
const acaoVmixConhecida = (nome) => typeof nome === 'string' && Object.hasOwn(VMIX_ACOES, nome);

function sanitizeVmixAlvo(acao, bruto) {
  if (!acaoVmixConhecida(acao)) return null;
  const spec = VMIX_ACOES[acao];
  const a = bruto && typeof bruto === 'object' ? bruto : {};
  const alvo = {};
  if (spec.modos) alvo.modo = spec.modos.includes(a.modo) ? a.modo : spec.modos[0];
  // Número, chave ou título da entrada (vazio = a que estiver no preview)
  if (spec.entrada) alvo.entrada = String(a.entrada ?? '').replace(/[\r\n&]/g, ' ').trim().slice(0, 200);
  // Canal do overlay (1 a 4) ou da transmissão (0 = o padrão, 1 a 3)
  if (spec.canal) alvo.canal = Math.round(numeroEntre(a.canal, 0, 4, acao === 'overlay' ? 1 : 0));
  if (acao === 'overlay' && alvo.canal < 1) alvo.canal = 1;
  if (spec.volume) alvo.volume = Math.round(numeroEntre(a.volume, acao.endsWith('Volume') && a.modo === 'ajustar' ? -100 : 0, 100, 0));
  if (spec.duracao) alvo.duracao = Math.round(numeroEntre(a.duracao, 0, 20000, 0));
  if (spec.segundos) alvo.segundos = Math.round(numeroEntre(a.segundos, 0, 600, 10));
  if (spec.campo) alvo.campo = String(a.campo || '').replace(/[\r\n&]/g, ' ').trim().slice(0, 120);
  if (spec.texto) alvo.texto = String(a.texto ?? '').replace(/[\r\n]/g, ' ').slice(0, 500);
  // Nome de script/tecla/função: só letras, números e os separadores usuais
  if (spec.nome) alvo.nome = String(a.nome || '').replace(/[^A-Za-z0-9 _.+\-]/g, '').trim().slice(0, 120);
  return alvo;
}

// 📁 v0.51: dois tipos de pasta — 'pasta' é o Botão de multi ação (clique
// toca tudo em fila; segurar abre) e 'pastaSimples' só guarda teclas
// (clique abre, nada toca). O predicado vale para "guarda outras teclas".
const ehPastaTrilha = (t) => !!t && (t.tipo === 'pasta' || t.tipo === 'pastaSimples');

function sanitizeTrilha(bruta) {
  const t = bruta && typeof bruta === 'object' ? bruta : {};
  // Migração: o antigo loop:true vira o modo 'loop'
  const modo = ['solo', 'sobrepor', 'recomecar', 'loop'].includes(t.modo)
    ? t.modo
    : (t.loop === true ? 'loop' : 'solo');
  // 🖼️🎞️ v0.86: teclas de imagem e vídeo mostram mídia nas telas em vez de
  // tocar som — a url delas vem das pastas de MÍDIA (uploads/artes)
  // 🎛️ v0.122: 'vmix' = a tecla comanda o vMix (o irmão do tipo 'obs')
  const tipo = ['pasta', 'pastaSimples', 'obs', 'vmix', 'imagem', 'video'].includes(t.tipo) ? t.tipo : 'trilha';
  const ehMidia = tipo === 'imagem' || tipo === 'video';
  return {
    id: String(t.id || newInstanceId('tr')).slice(0, 40),
    // v0.52.1: o nome aceita quebras de linha SEM LIMITE de linhas (o teto é
    // só o de letras). O campo limita a 50, mas o servidor corta em 60 POR
    // PONTO DE CÓDIGO: nomes antigos de 51-60 chars sobrevivem intactos e
    // emoji não é partido ao meio pelo corte.
    nome: [...String(t.nome || '').replace(/\r\n?/g, '\n')].slice(0, 60).join(''),
    emoji: String(t.emoji || '').slice(0, 8),
    // 🖼️ O botão pode ter uma imagem no lugar do emoji (das mídias do programa)
    imagem: urlLocalDeArquivo(t.imagem, PASTAS_MIDIA),
    // Onde o texto fica no botão quadrado (como o "T" do Stream Deck)
    textoPos: ['cima', 'meio', 'baixo', 'oculto'].includes(t.textoPos) ? t.textoPos : 'baixo',
    cor: corHex(t.cor, ''),
    // 📁 A tecla pode guardar outras teclas dentro (um nível só), de dois
    // jeitos: 'pasta' = Botão de multi ação (clique toca tudo em fila;
    // segurar abre) e 'pastaSimples' = pasta comum (clique só abre).
    // 🎬 v0.53: 'obs' = a tecla comanda o OBS em vez de tocar som.
    // 🖼️🎞️ v0.86: 'imagem'/'video' = a tecla mostra mídia nas telas.
    tipo,
    // Como a tecla de mídia aparece: janela redimensionável ou tela cheia,
    // e (na janela) a altura máxima em % da tela — como a mídia do inscrito
    telaModo: ['janela', 'cheia'].includes(t.telaModo) ? t.telaModo : 'janela',
    telaEscala: Math.round(numeroEntre(t.telaEscala, 20, 100, 45)),
    // Qual ação do OBS e em quem ela manda (só vale para tipo 'obs')
    obsAcao: acaoConhecida(t.obsAcao) ? String(t.obsAcao) : '',
    obsAlvo: sanitizeObsAlvo(t.obsAcao, t.obsAlvo) || {},
    // 🎛️ v0.122: idem para o vMix (só vale para tipo 'vmix')
    vmixAcao: acaoVmixConhecida(t.vmixAcao) ? String(t.vmixAcao) : '',
    vmixAlvo: sanitizeVmixAlvo(t.vmixAcao, t.vmixAlvo) || {},
    pastaId: String(t.pastaId || '').slice(0, 40),
    // ⏱ Espera (segundos, 0 a 24h) DEPOIS desta tecla antes da próxima na fila
    espera: Math.round(numeroEntre(t.espera, 0, 86400, 0) * 10) / 10,
    url: urlLocalDeArquivo(t.url, ehMidia ? PASTAS_MIDIA : PASTAS_SOM),
    // O arquivo original do Stream Deck (só o nome) — para o casamento por pasta
    origem: String(t.origem || '').slice(0, 140),
    volume: Math.round(numeroEntre(t.volume, 0, 100, 70)),
    // Como a trilha toca (os 4 modos do fluxo real de live):
    //  solo      = para o que estiver tocando e toca (uma base por vez)
    //  sobrepor  = toca POR CIMA do que estiver tocando (efeitos/vinhetas)
    //  recomecar = como sobrepor, mas se já estiver tocando volta do zero
    //  loop      = solo + repete sem parar (BGM)
    modo,
    // Fade: onde ele age (como no Stream Deck) + a duração
    fadeTipo: ['nenhum', 'entrada', 'saida', 'ambos'].includes(t.fadeTipo) ? t.fadeTipo : 'ambos',
    fade: Math.round(numeroEntre(t.fade, 0, 10, 3) * 10) / 10,
    destino: ['live', 'painel', 'ambos'].includes(t.destino) ? t.destino : 'live',
    // 🎛️ v0.52.1: a CÉLULA da grade onde a tecla mora (lugar livre, buracos
    // valem). Sem lugar válido, o normalizador dá um logo abaixo.
    pos: Number.isFinite(Number(t.pos)) && Number(t.pos) >= 0 ? Math.min(9999, Math.floor(Number(t.pos))) : null,
  };
}

// Dá lugar a quem não tem e desfaz empates, por visão (raiz e cada pasta).
// v0.89: a célula 0 vale em toda visão — o voltar saiu da grade.
function normalizarPosTrilhas(lista) {
  const grupos = new Map();
  for (const t of lista) {
    const k = t.pastaId || '';
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(t);
  }
  for (const [k, itens] of grupos) {
    // v0.89: a célula 0 é útil também dentro das pastas (o ⬅ saiu da grade)
    const min = 0;
    void k;
    const usadas = new Set();
    const semLugar = [];
    for (const t of itens) {
      const p = Math.floor(Number(t.pos));
      if (Number.isFinite(p) && p >= min && !usadas.has(p)) { t.pos = p; usadas.add(p); }
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

// A lista inteira: além da limpeza de cada tecla, amarra as pastas —
// pastaId só vale se aponta para uma pasta que existe, e pasta não entra
// dentro de pasta (um nível, como no Stream Deck).
function sanitizeTrilhas(lista) {
  const limpa = (Array.isArray(lista) ? lista : []).slice(0, TRILHAS_MAX).map(sanitizeTrilha);
  const pastas = new Set(limpa.filter(ehPastaTrilha).map((t) => t.id));
  for (const t of limpa) {
    // Quem MUDA de visão aqui (filho de pasta apagada) perde a casa: ela
    // valia lá dentro. Sem isso o recém-chegado tomaria a casa de alguém que
    // já morava na raiz — e o antigo é que se mudava.
    if (t.pastaId && !pastas.has(t.pastaId)) { t.pastaId = ''; t.pos = null; }
  }
  // 🪆 v0.89: pastas DENTRO de pastas valem (aninhamento livre, qualquer
  // nível) — só o CICLO é proibido: quem fecharia o laço volta para a raiz
  const porId = new Map(limpa.map((t) => [t.id, t]));
  for (const t of limpa) {
    if (!ehPastaTrilha(t) || !t.pastaId) continue;
    const vistos = new Set([t.id]);
    let atual = t.pastaId;
    while (atual) {
      if (vistos.has(atual)) { t.pastaId = ''; t.pos = null; break; }
      vistos.add(atual);
      atual = (porId.get(atual) || {}).pastaId || '';
    }
  }
  // Quem mudou de visão (saiu/entrou numa pasta) pode ter herdado um lugar
  // já ocupado lá: o normalizador resolve, sempre por último
  return normalizarPosTrilhas(limpa);
}

function loadTrilhas() {
  try {
    const raw = JSON.parse(fs.readFileSync(TRILHAS_FILE, 'utf8'));
    return sanitizeTrilhas(raw);
  } catch { return []; }
}
// Agora sim: as regras de mídia já existem, a lista pode entrar no state
state.trilhas = loadTrilhas();

function persistTrilhas() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(TRILHAS_FILE, JSON.stringify(state.trilhas, null, 2));
  } catch (err) { console.error('Não consegui salvar as trilhas:', err.message); }
}

// 🖼️🎞️ v0.86: põe (ou tira) a mídia de uma tecla da Mesa nas telas —
// painel e overlay espelham o MESMO estado, como o sorteio e o avatar
function setTrilhaTela(tela) {
  state.trilhaTela = tela || null;
  broadcast({ type: 'trilhaTela', tela: state.trilhaTela });
}

// ---------- 🎞️ v0.129: Mídia direta ----------
// O apresentador mostra ao público uma imagem, um vídeo ou um áudio direto de
// uma URL (YouTube, TikTok, Instagram, anexo do Discord, arquivo solto…) ou
// de um arquivo do próprio computador — sem enviar nada para a biblioteca.
// O arquivo local é servido de onde está (/midia-direta/<id>/<nome>); o
// player é remoto como o da mídia do inscrito: o painel comanda, as telas
// espelham. Nada disto é persistido: é «o que está no ar agora».
function midiaDiretaPlayerInicial(base) {
  const b = base || {};
  return {
    estado: 'pausado', posicao: 0, em: Date.now(),
    volume: Number.isFinite(Number(b.volume)) ? b.volume : 100,
    velocidade: Number(b.velocidade) > 0 ? b.velocidade : 1,
    semDistorcao: b.semDistorcao !== false,
    loop: b.loop === true,
  };
}
function midiaDiretaInicial() {
  // 🏷️ v0.136: o crédito de fonte que vai com a mídia para a tela. O texto é
  // livre (nasce sugerido pelo próprio link) e o «mostrar» é do streamer:
  // quem credita uma vez costuma querer creditar sempre, então ele fica.
  return { item: null, visible: false, escala: 45, telaCheia: false, player: midiaDiretaPlayerInicial(), credito: { texto: '', mostrar: true } };
}

// A palavra que abre o crédito, no idioma que o streamer escolheu
const CREDITO_PREFIXO = {
  pt: 'Fonte:', en: 'Source:', es: 'Fuente:', fr: 'Source :', de: 'Quelle:',
  ru: 'Источник:', tr: 'Kaynak:', ja: '出典：', ko: '출처:', zh: '来源：',
};

// 🏷️ v0.136: o crédito que o próprio endereço já entrega. Muitos links trazem
// o perfil no caminho (x.com/fulano/status/…, tiktok.com/@fulano/video/…), e
// aí o crédito nasce pronto: «Fonte: @fulano · x.com». Sem perfil no
// endereço, fica só o site. É uma sugestão — o streamer manda no texto.
function creditoSugerido(endereco) {
  let u;
  try { u = new URL(String(endereco || '')); } catch { return ''; }
  const site = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  if (!site) return '';
  const partes = u.pathname.split('/').filter(Boolean);
  const primeiro = partes[0] || '';
  // depois do perfil vem sempre uma palavra de seção — é ela que confirma que
  // o primeiro pedaço é gente, e não uma pasta qualquer do site
  const SECOES = /^(status|statuses|p|reel|reels|tv|video|videos|clip|clips|post|posts|photo)$/i;
  let perfil = '';
  if (/^@[A-Za-z0-9._-]{1,40}$/.test(primeiro)) perfil = primeiro;
  else if (/^[A-Za-z0-9._-]{1,40}$/.test(primeiro) && SECOES.test(partes[1] || '')) perfil = '@' + primeiro;
  const prefixo = CREDITO_PREFIXO[idiomaDoConsole()] || CREDITO_PREFIXO.pt;
  return (prefixo + ' ' + (perfil ? perfil + ' · ' + site : site)).slice(0, 200);
}
function broadcastMidiaDireta() {
  broadcast({ type: 'midiaDireta', midiaDireta: state.midiaDireta });
}
const MIDIA_DIRETA_EXT = {
  imagem: ['jpg', 'jpeg', 'jfif', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp', 'svg'],
  video: ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv', 'avi', 'mpeg', 'mpg', 'wmv', 'flv', '3gp'],
  audio: ['mp3', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'wav', 'flac', 'weba'],
};
function tipoMidiaDiretaPorNome(nome) {
  const ext = (String(nome || '').toLowerCase().match(/\.([a-z0-9]{1,5})$/) || [])[1];
  if (!ext) return null;
  for (const [tipo, lista] of Object.entries(MIDIA_DIRETA_EXT)) if (lista.includes(ext)) return tipo;
  return null;
}
// Lê a URL e decide como ela vai para a tela: mídia solta (pela extensão ou
// pela dica que o painel sondou no navegador) ou um embed conhecido. Nada é
// buscado pelo servidor — quem carrega a URL é o navegador das telas.
function classificarUrlMidiaDireta(bruta, dica) {
  const texto = String(bruta || '').trim().slice(0, 2000);
  let u;
  try { u = new URL(texto); } catch { return { erro: 'Essa URL não parece válida. Cole o endereço completo, começando com https://' }; }
  if (!/^https?:$/.test(u.protocol)) return { erro: 'Só endereços http(s) podem ir para a tela.' };
  const host = u.hostname.toLowerCase().replace(/^(www|m|mobile)\./, '');
  let nomeArq = '';
  try { nomeArq = decodeURIComponent(path.posix.basename(u.pathname)); } catch { nomeArq = path.posix.basename(u.pathname); }
  // 📐 v0.132: cada site tem o formato dele — o Instagram e o TikTok são de
  // pé (retrato) e ainda põem um cabeçalho por cima; sem isso a tela mostrava
  // tudo dentro de uma caixa 16:9, com tarja preta dos lados e barra de rolagem
  const embed = (provedor, src, nome, proporcao) => ({ item: { fonte: 'url', tipo: 'embed', url: u.href, nome: String(nome || host).slice(0, 120), duracao: null, embed: { provedor, src, proporcao: proporcao || 16 / 9 } } });
  const solta = (tipo) => ({ item: { fonte: 'url', tipo, url: u.href, nome: (nomeArq || host).slice(0, 120), duracao: null, embed: null } });
  // ▶️ YouTube (watch, youtu.be, shorts, live, embed)
  let yt = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0];
  else if (/(^|\.)youtube(-nocookie)?\.com$/.test(host)) yt = u.searchParams.get('v') || (u.pathname.match(/^\/(?:shorts|live|embed|v)\/([A-Za-z0-9_-]{6,})/) || [])[1] || null;
  if (yt && /^[A-Za-z0-9_-]{6,20}$/.test(yt)) {
    const inicio = Math.max(0, parseInt(u.searchParams.get('t') || u.searchParams.get('start') || '0', 10) || 0);
    return embed('youtube', `https://www.youtube-nocookie.com/embed/${yt}?enablejsapi=1&controls=0&rel=0&modestbranding=1&playsinline=1&iv_load_policy=3${inicio ? '&start=' + inicio : ''}`, 'YouTube · ' + yt);
  }
  // 🎵 TikTok: /@alguem/video/123 ou /video/123 (o link curto vm.tiktok.com
  // precisa ser aberto antes — o servidor não segue redirecionamentos)
  if (/(^|\.)tiktok\.com$/.test(host)) {
    const id = (u.pathname.match(/\/video\/(\d{6,})/) || [])[1];
    if (id) return embed('tiktok', `https://www.tiktok.com/embed/v2/${id}`, 'TikTok · ' + id, 0.46); // de pé
    return { erro: 'Esse link do TikTok é curto: abra-o no navegador e cole a URL completa (…/video/123…).' };
  }
  // 📸 Instagram: post, reel ou IGTV
  if (/(^|\.)instagram\.com$/.test(host)) {
    const m = u.pathname.match(/^\/(?:[A-Za-z0-9_.]+\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/);
    if (m) return embed('instagram', `https://www.instagram.com/${m[1] === 'reels' ? 'reel' : m[1]}/${m[2]}/embed/`, 'Instagram · ' + m[2], 0.56); // de pé + cabeçalho
    return { erro: 'No Instagram só posts e reels vão para a tela (…/p/… ou …/reel/…).' };
  }
  // 🎬 Vimeo
  if (/(^|\.)vimeo\.com$/.test(host)) {
    const id = (u.pathname.match(/\/(\d{5,})/) || [])[1];
    if (id) return embed('vimeo', `https://player.vimeo.com/video/${id}?controls=0`, 'Vimeo · ' + id);
  }
  // 💜 Twitch: clipe ou vídeo (a tela acrescenta o «parent» exigido)
  if (host === 'clips.twitch.tv') {
    const slug = u.pathname.slice(1).split('/')[0];
    if (slug) return embed('twitch', `https://clips.twitch.tv/embed?clip=${encodeURIComponent(slug)}&autoplay=true`, 'Twitch · clipe');
  }
  if (/(^|\.)twitch\.tv$/.test(host)) {
    const clip = (u.pathname.match(/\/clip\/([A-Za-z0-9_-]+)/) || [])[1];
    if (clip) return embed('twitch', `https://clips.twitch.tv/embed?clip=${encodeURIComponent(clip)}&autoplay=true`, 'Twitch · clipe');
    const video = (u.pathname.match(/\/videos\/(\d+)/) || [])[1];
    if (video) return embed('twitch', `https://player.twitch.tv/?video=${video}&autoplay=true`, 'Twitch · vídeo');
  }
  // 🐦 v0.135: X (Twitter). A página do post RECUSA ser embutida (ela manda
  // x-frame-options e frame-ancestors só para o próprio X), e o navegador
  // obedece — era aquela caixa de «página bloqueada». Mas o X publica um
  // quadro OFICIAL do post, o mesmo que os blogs usam, e esse aceita: é para
  // ele que o link vai. Quem quiser só o vídeo, o 🎬 extrator do Labs pega.
  if (/(^|\.)(x|twitter)\.com$/.test(host)) {
    const id = (u.pathname.match(/\/status(?:es)?\/(\d{6,})/) || [])[1];
    if (id) return embed('x', `https://platform.twitter.com/embed/Tweet.html?id=${id}&theme=dark&dnt=true`, 'X · ' + id, 0.8);
    return { erro: 'No X só posts vão para a tela — cole o link de um post (…/status/123…).' };
  }
  // 📎 Arquivo solto: pela extensão (vale para anexos do Discord e afins)
  const porExt = tipoMidiaDiretaPorNome(nomeArq);
  if (porExt) return solta(porExt);
  // 🔎 Sem extensão conhecida: a dica que o painel sondou no navegador
  if (['imagem', 'video', 'audio'].includes(dica)) return solta(dica);
  // Página qualquer: vai como quadro (muitos sites recusam ser embutidos)
  return embed('outro', u.href, host);
}
// 🎬 v0.133: a sonda que descobre o ARQUIVO do vídeo de uma página (mora em
// midiadireta.js para poder ser testada sozinha)
const { sondarVideoDireto, buscarDaSonda, tipoPelaUrl, hostPublicoDaSonda, recusaSerQuadro } = require('./midiadireta')
  .criarSonda({ classifyAddress, tipoMidiaDiretaPorNome });

// 🧪 v0.134: o extrator opcional (yt-dlp). Fica DESLIGADO até alguém ligar no
// 🧪 Labs e baixar o programa em 🔌 Conexões — nada vem embutido aqui.
const { Extrator: ExtratorYtDlp } = require('./ytdlp');
const extratorYtDlp = new ExtratorYtDlp({
  dir: path.join(DATA_DIR, 'ytdlp'),
  ehPublico: hostPublicoDaSonda,
  base: process.env.OBS_TESTE_YTDLP_BASE || undefined,
  aoEvento: (ev) => broadcast(ev),
});

// Troca o item carregado — só se a pessoa não tiver mudado de mídia no meio
function trocarMidiaDireta(idDoItem, mudancas) {
  const md = state.midiaDireta;
  if (!md.item || md.item.id !== idDoItem) return false;
  md.item = { ...md.item, ...mudancas };
  md.player = midiaDiretaPlayerInicial(md.player);
  broadcastMidiaDireta();
  return true;
}

// Roda logo depois de carregar uma URL: pergunta ao site o que aquele endereço
// é DE VERDADE e acerta o que o palpite pela extensão errou.
//   • é mesmo um arquivo → só corrige o tipo, se preciso;
//   • é uma página → procura o arquivo do vídeo nas metatags e, achando,
//     troca o quadro do site pelo vídeo nosso (com todos os controles);
//   • é uma página e não tem arquivo → pelo menos vira quadro do site, em vez
//     de um «vídeo» que não toca (o caso de …/File:algumacoisa.ogv).
async function conferirMidiaDaUrl(idDoItem, endereco, tipoAtual, provedorAtual) {
  let cab = null;
  try { cab = await buscarDaSonda(endereco, { metodo: 'HEAD' }); } catch {}
  const ct = String((cab && cab.tipo) || '');
  const direto = /^video\//i.test(ct) ? 'video' : /^audio\//i.test(ct) ? 'audio' : /^image\//i.test(ct) ? 'imagem' : null;
  if (direto) {
    if (direto !== tipoAtual) trocarMidiaDireta(idDoItem, { tipo: direto, embed: null, duracao: null });
    return;
  }
  const ehPagina = /^(text\/html|application\/xhtml)/i.test(ct);
  // o servidor recusou o HEAD, mas a extensão já diz o que é: deixa quieto
  if (!cab && tipoPelaUrl(endereco)) return;
  if (cab && !ehPagina) return; // outro tipo de arquivo: não é conosco
  let host = '';
  try { host = new URL(endereco).hostname.replace(/^www\./, ''); } catch {}
  avisarSondaMidiaDireta(idDoItem, 'procurando');
  let achado = null;
  try { achado = await sondarVideoDireto(endereco); } catch {}
  // 🧪 v0.134: a página não publica o arquivo (Instagram, TikTok e cia)? Quem
  // ligou o extrator no Labs e baixou o yt-dlp tem uma segunda chance
  if (!achado && state.settings.labs?.ytdlp === true) {
    avisarSondaMidiaDireta(idDoItem, 'extraindo');
    try { achado = await extratorYtDlp.extrair(endereco); } catch {}
  }
  if (achado) {
    const titulo = String(achado.titulo || '').trim();
    trocarMidiaDireta(idDoItem, {
      tipo: achado.tipo, url: achado.url, embed: null,
      duracao: Number(achado.duracao) > 0 ? Number(achado.duracao) : null,
      nome: (achado.tipo === 'audio' ? '🎧 ' : '🎬 ') + (titulo || host || 'vídeo'),
    });
    avisarSondaMidiaDireta(idDoItem, 'achou');
    return;
  }
  // 🚫 v0.135: o site pode ter dito que não aceita ser aberto dentro de um
  // quadro. Isso só vale quando o quadro É a página dele: nos sites que têm
  // quadro oficial (YouTube, TikTok, Instagram, Vimeo, Twitch, X) quem vai
  // para a tela é o widget, e esse aceita.
  const quadroEhAPagina = provedorAtual === 'outro' || tipoAtual !== 'embed';
  const semQuadro = quadroEhAPagina && !!cab && recusaSerQuadro(cab.cabecalhos);
  // é página e não achamos o arquivo: quadro do site é melhor que nada
  if (tipoAtual !== 'embed') {
    trocarMidiaDireta(idDoItem, { tipo: 'embed', semQuadro, embed: { provedor: 'outro', src: endereco, proporcao: 16 / 9 } });
  } else if (semQuadro) {
    trocarMidiaDireta(idDoItem, { semQuadro: true });
  }
  avisarSondaMidiaDireta(idDoItem, semQuadro ? 'semQuadro' : 'nada');
}

// O painel conta para quem está olhando que a procura pelo arquivo está
// rolando — o yt-dlp pode demorar alguns segundos e silêncio parece travamento
function avisarSondaMidiaDireta(idDoItem, estado) {
  if (state.midiaDireta.item && state.midiaDireta.item.id === idDoItem) {
    broadcast({ type: 'midiaDiretaSonda', id: idDoItem, estado });
  }
}

// 📂 Arquivos do computador: cada arquivo escolhido ganha um id e é servido
// de onde está. Só o computador do programa pode escolher e listar pastas.
const midiaDiretaArquivos = new Map(); // id → caminho absoluto
function registrarArquivoMidiaDireta(caminhoBruto) {
  const caminho = path.resolve(String(caminhoBruto || '').trim().slice(0, 4096));
  if (!path.isAbsolute(caminho)) return { erro: 'Informe o caminho completo do arquivo.' };
  let st;
  try { st = fs.statSync(caminho); } catch { return { erro: 'Não achei esse arquivo no computador.' }; }
  if (!st.isFile()) return { erro: 'Isso é uma pasta, não um arquivo.' };
  const tipo = tipoMidiaDiretaPorNome(caminho);
  if (!tipo) return { erro: 'Esse arquivo não é uma imagem, um vídeo ou um áudio que o navegador abra.' };
  const id = newInstanceId('md');
  midiaDiretaArquivos.clear(); // um arquivo por vez — o anterior deixa de ser servido
  midiaDiretaArquivos.set(id, caminho);
  const nome = path.basename(caminho);
  return { item: { id, fonte: 'arquivo', tipo, url: `/midia-direta/${id}/${encodeURIComponent(nome)}`, nome: nome.slice(0, 120), duracao: null, embed: null } };
}
function raizesMidiaDireta() {
  const raizes = [];
  const home = os.homedir();
  if (process.platform === 'win32') {
    for (let c = 65; c <= 90; c++) {
      const letra = String.fromCharCode(c) + ':\\';
      try { if (fs.existsSync(letra)) raizes.push({ nome: '💽 ' + letra, caminho: letra }); } catch {}
    }
  } else {
    raizes.push({ nome: '💽 /', caminho: '/' });
  }
  raizes.push({ nome: '🏠 ' + path.basename(home), caminho: home });
  // 📁 v0.132: as pastas conhecidas + as da nuvem (OneDrive, Dropbox, Google
  // Drive). Muita gente guarda tudo lá dentro, e o Windows redireciona a Área
  // de trabalho e os Documentos para o OneDrive — sem estes atalhos, o
  // «Procurar» parecia vazio. As pastas de dentro do OneDrive também entram.
  const nuvens = [];
  for (const [nome, pastas] of [
    ['🖥️ Área de trabalho', ['Desktop', 'Área de Trabalho']],
    ['⬇️ Downloads', ['Downloads']],
    ['📄 Documentos', ['Documents', 'Documentos']],
    ['🎞️ Vídeos', ['Videos', 'Vídeos']],
    ['🖼️ Imagens', ['Pictures', 'Imagens']],
    ['🎵 Músicas', ['Music', 'Músicas']],
  ]) {
    let achou = false;
    for (const p of pastas) {
      const c = path.join(home, p);
      try { if (fs.statSync(c).isDirectory()) { raizes.push({ nome, caminho: c }); achou = true; break; } } catch {}
    }
    if (achou) continue;
    // não está na pasta do usuário? pode ter ido para dentro do OneDrive
    for (const base of ['OneDrive']) {
      for (const p of pastas) {
        const c = path.join(home, base, p);
        try { if (fs.statSync(c).isDirectory()) { raizes.push({ nome, caminho: c }); achou = true; break; } } catch {}
      }
      if (achou) break;
    }
  }
  for (const [nome, alvos] of [
    ['☁️ OneDrive', [process.env.OneDrive, process.env.OneDriveConsumer, path.join(home, 'OneDrive')]],
    ['📦 Dropbox', [path.join(home, 'Dropbox')]],
    ['🟡 Google Drive', [path.join(home, 'Google Drive'), path.join(home, 'My Drive')]],
  ]) {
    for (const c of alvos) {
      if (!c) continue;
      try { if (fs.statSync(c).isDirectory()) { nuvens.push({ nome, caminho: c }); break; } } catch {}
    }
  }
  return raizes.concat(nuvens);
}
function listarPastaMidiaDireta(caminhoBruto) {
  const raizes = raizesMidiaDireta();
  const pedido = String(caminhoBruto || '').trim().slice(0, 4096);
  if (!pedido) return { caminho: '', pai: null, raizes, pastas: [], arquivos: [] };
  const caminho = path.resolve(pedido);
  let entradas;
  try { entradas = fs.readdirSync(caminho, { withFileTypes: true }); } catch { return { erro: 'Não consegui abrir essa pasta.' }; }
  const pastas = [], arquivos = [];
  for (const e of entradas) {
    if (e.name.startsWith('.') || e.name.startsWith('$')) continue;
    if (e.name === 'System Volume Information') continue;
    const c = path.join(caminho, e.name);
    // 🔗 v0.132: Dropbox, Google Drive e OneDrive são JUNÇÕES no Windows —
    // para o readdir elas não são «pasta» nem «arquivo», e sumiam da lista.
    // Quando o tipo não vem no readdir, pergunta ao sistema (seguindo o link).
    let ehPasta = e.isDirectory(), ehArquivo = e.isFile();
    if (!ehPasta && !ehArquivo) {
      try { const st = fs.statSync(c); ehPasta = st.isDirectory(); ehArquivo = st.isFile(); } catch { continue; }
    }
    if (ehPasta) { pastas.push({ nome: e.name, caminho: c }); continue; }
    if (!ehArquivo) continue;
    const tipo = tipoMidiaDiretaPorNome(e.name);
    if (!tipo) continue;
    let bytes = 0;
    try { bytes = fs.statSync(c).size; } catch {}
    arquivos.push({ nome: e.name, caminho: c, bytes, tipo });
  }
  const ordena = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' });
  pastas.sort(ordena); arquivos.sort(ordena);
  const pai = path.dirname(caminho);
  return { caminho, pai: pai && pai !== caminho ? pai : null, raizes, pastas: pastas.slice(0, 500), arquivos: arquivos.slice(0, 500) };
}

function pararTrilha() {
  pararPasta();
  if (!state.trilhaTocando) return;
  state.trilhaTocando = null;
  broadcast({ type: 'trilhaStop' });
}

// 📁 A fila de uma pasta: toca cada tecla de dentro, na ordem, esperando o
// ⏱ de cada uma antes de disparar a próxima. Roda AQUI no servidor — segue
// mesmo com o painel fechado — e o ⏹ (trilhaParar) cancela no ato.
let pastaFila = null; // { id, timer }
function pararPasta(avisar) {
  if (!pastaFila) return;
  clearTimeout(pastaFila.timer);
  pastaFila = null;
  if (avisar !== false) broadcast({ type: 'pastaStop' });
}
function tocarTecla(t) {
  // 🎬 v0.53: dentro do Botão de multi ação cabe tecla de OBS — a fila mistura
  // som e comando (trocar de cena, mostrar uma fonte, começar a gravar...)
  if (t.tipo === 'obs') { if (t.obsAcao) obsExecutarAcao(t.obsAcao, t.obsAlvo, pastaFila && pastaFila.quem); return; }
  if (t.tipo === 'vmix') { if (t.vmixAcao) vmixExecutarAcao(t.vmixAcao, t.vmixAlvo, pastaFila && pastaFila.quem); return; }
  if (t.modo === 'solo' || t.modo === 'loop') {
    state.trilhaTocando = { id: t.id, desde: Date.now() };
  }
  broadcast({ type: 'trilhaPlay', id: t.id, desde: Date.now() });
}
// 🪆 v0.89: com pastas dentro de pastas, a fila do 🎛️ ACHATA a árvore — um
// 🎛️ filho entra na fila com todo o conteúdo dele, na ordem, e a ⏱ espera
// desse 🎛️ vale depois do ÚLTIMO item de dentro. Ciclos/profundidade têm
// freio; 📁 pasta simples continua só guardando (nada dela toca em fila).
function achatarFilaDaPasta(id, comObs, vistos = new Set(), prof = 0) {
  if (vistos.has(id) || prof > 6) return [];
  vistos.add(id);
  const filhos = state.trilhas
    .filter((t) => t.pastaId === id
      && ((t.tipo === 'trilha' && t.url) || (t.tipo === 'obs' && t.obsAcao && comObs !== false)
        || (t.tipo === 'vmix' && t.vmixAcao && comObs !== false) // 🎛️ v0.122: mesmo seletor 🎬
        // 🖼️🎞️ v0.86: teclas de mídia também entram na fila (a ⏱ espera vale)
        || ((t.tipo === 'imagem' || t.tipo === 'video') && t.url)
        || t.tipo === 'pasta'))
    .sort((a, b) => (Number(a.pos) || 0) - (Number(b.pos) || 0));
  const fila = [];
  for (const f of filhos) {
    if (f.tipo === 'pasta') {
      const sub = achatarFilaDaPasta(f.id, comObs, vistos, prof + 1);
      if (sub.length) {
        sub[sub.length - 1] = {
          t: sub[sub.length - 1].t,
          espera: sub[sub.length - 1].espera + (Number(f.espera) || 0),
        };
        fila.push(...sub);
      }
    } else fila.push({ t: f, espera: Number(f.espera) || 0 });
  }
  return fila;
}

function tocarPasta(id, comObs, quem) {
  pararPasta(false);
  // A fila segue a ordem VISUAL da grade (v0.52.1: cada tecla tem lugar fixo),
  // não a ordem em que elas foram criadas na lista.
  // comObs === false: quem mandou não tem o seletor 🎬 liberado no modo
  // restrito — a fila toca os sons e PULA os comandos do OBS
  const fila = achatarFilaDaPasta(id, comObs);
  if (!fila.length) return;
  broadcast({ type: 'pastaPlay', id });
  let i = 0;
  pastaFila = { id, timer: null, quem: quem || null };
  const passo = () => {
    if (!pastaFila || pastaFila.id !== id) return;
    const f = fila[i].t;
    if (f.tipo === 'imagem' || f.tipo === 'video') {
      // Mídia na fila: entra na tela (e fica, até a próxima mídia, o fim do
      // vídeo ou um clique — imagem não tem duração própria)
      setTrilhaTela({
        id: f.id, tipo: f.tipo, url: f.url,
        modo: f.telaModo === 'cheia' ? 'cheia' : 'janela',
        escala: f.telaEscala, volume: f.volume, loop: f.modo === 'loop',
        velocidade: 1, semDistorcao: true, qualidade: 'alta', // 🚀 v0.87
      });
    } else tocarTecla(f);
    i += 1;
    if (i >= fila.length) { pastaFila = null; broadcast({ type: 'pastaStop' }); return; }
    pastaFila.timer = setTimeout(passo, Math.max(0, fila[i - 1].espera) * 1000);
    if (pastaFila.timer.unref) pastaFila.timer.unref();
  };
  passo();
}

// ---------------------------------------------------------------------------
// 📦 Leitor de ZIP direto do DISCO (sem dependências): um backup real do
// Stream Deck pode ter vários GB (o do streamer tem 1,35 GB), então nada de
// carregar o arquivo inteiro na memória — lemos só o diretório central e os
// manifests (pequenos) e, desde a v0.90, os ícones pequenos das teclas
// (viram a arte dos botões); os áudios gigantes continuam sem ser tocados.
// Suporta zip64 (obrigatório acima de 4 GB) e entradas "store" e "deflate".
// Nunca executa nada de dentro do arquivo.
// ---------------------------------------------------------------------------
const MAX_SD_IMPORT_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB
const ZIP_MAX_ENTRADAS = 20000;
const ZIP_MAX_CENTRAL = 64 * 1024 * 1024;
const ZIP_MAX_MANIFEST = 8 * 1024 * 1024;

function zipLerTrecho(fd, base, pos, tam) {
  const b = Buffer.alloc(tam);
  let lidos = 0;
  while (lidos < tam) {
    const n = fs.readSync(fd, b, lidos, tam - lidos, base + pos + lidos);
    if (n <= 0) break;
    lidos += n;
  }
  return lidos === tam ? b : b.slice(0, lidos);
}

// Diretório central de um zip que mora em [base, base+tam) dentro do fd.
// Devolve { nome, metodo, tamComp, tamOrig, offLocal } por entrada.
function zipCentralFd(fd, base, tam) {
  if (tam < 22) return [];
  // O fim do diretório (EOCD) fica no rabo, antes de um comentário de até 64KB
  const raboTam = Math.min(tam, 65557 + 22);
  const rabo = zipLerTrecho(fd, base, tam - raboTam, raboTam);
  let eocd = -1;
  for (let i = rabo.length - 22; i >= 0; i--) {
    if (rabo.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return [];
  const eocdAbs = (tam - rabo.length) + eocd;
  let total = rabo.readUInt16LE(eocd + 10);
  let cdTam = rabo.readUInt32LE(eocd + 12);
  let cdPos = rabo.readUInt32LE(eocd + 16);
  let ehZip64 = false;
  // zip64: acima de 4 GB os campos de 32 bits saturam em 0xFFFFFFFF e os
  // valores reais moram no EOCD64, apontado por um localizador logo antes
  if (total === 0xffff || cdTam === 0xffffffff || cdPos === 0xffffffff) {
    if (eocdAbs >= 20) {
      const loc = zipLerTrecho(fd, base, eocdAbs - 20, 20);
      if (loc.length === 20 && loc.readUInt32LE(0) === 0x07064b50) {
        const e64Pos = Number(loc.readBigUInt64LE(8));
        if (Number.isSafeInteger(e64Pos) && e64Pos >= 0 && e64Pos + 56 <= tam) {
          const e64 = zipLerTrecho(fd, base, e64Pos, 56);
          if (e64.length === 56 && e64.readUInt32LE(0) === 0x06064b50) {
            total = Number(e64.readBigUInt64LE(32));
            cdTam = Number(e64.readBigUInt64LE(40));
            cdPos = Number(e64.readBigUInt64LE(48));
            ehZip64 = true;
          }
        }
      }
    }
  }
  if (!Number.isSafeInteger(cdTam) || !Number.isSafeInteger(cdPos) ||
      !(cdTam > 0) || cdTam > ZIP_MAX_CENTRAL || cdPos < 0) return [];
  // 🩹 Prefixo antes do zip (auto-extraível, ou zip concatenado a outros
  // dados): os offsets gravados são relativos ao INÍCIO DO TRECHO zip, não do
  // arquivo. Todo unzipper robusto soma o delta entre onde o diretório central
  // deveria terminar (cdPos+cdTam) e onde o EOCD realmente está. No zip64 os
  // offsets do EOCD64 já são absolutos — não se mexe.
  let delta = 0;
  if (!ehZip64) {
    const d = eocdAbs - (cdPos + cdTam);
    if (d > 0 && cdPos + d + cdTam <= tam) delta = d;
  }
  cdPos += delta;
  if (cdPos + cdTam > tam) return [];
  const cd = zipLerTrecho(fd, base, cdPos, cdTam);
  const out = [];
  let pos = 0;
  for (let n = 0; n < Math.min(total, ZIP_MAX_ENTRADAS); n++) {
    if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== 0x02014b50) break;
    const metodo = cd.readUInt16LE(pos + 10);
    let tamComp = cd.readUInt32LE(pos + 20);
    let tamOrig = cd.readUInt32LE(pos + 24);
    const nomeLen = cd.readUInt16LE(pos + 28);
    const extraLen = cd.readUInt16LE(pos + 30);
    const comentLen = cd.readUInt16LE(pos + 32);
    let offLocal = cd.readUInt32LE(pos + 42);
    const nome = cd.slice(pos + 46, pos + 46 + nomeLen).toString('utf8');
    // Extensão zip64 (id 0x0001): só os campos saturados aparecem, NESTA ordem
    const extra = cd.slice(pos + 46 + nomeLen, pos + 46 + nomeLen + extraLen);
    for (let e = 0; e + 4 <= extra.length;) {
      const id = extra.readUInt16LE(e);
      const len = extra.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let p = e + 4;
        const fimCampo = Math.min(e + 4 + len, extra.length);
        if (tamOrig === 0xffffffff && p + 8 <= fimCampo) { tamOrig = Number(extra.readBigUInt64LE(p)); p += 8; }
        if (tamComp === 0xffffffff && p + 8 <= fimCampo) { tamComp = Number(extra.readBigUInt64LE(p)); p += 8; }
        if (offLocal === 0xffffffff && p + 8 <= fimCampo) { offLocal = Number(extra.readBigUInt64LE(p)); p += 8; }
        break;
      }
      e += 4 + len;
    }
    pos += 46 + nomeLen + extraLen + comentLen;
    offLocal += delta;
    // Confinamento: só entra a entrada cujo cabeçalho e dados cabem DENTRO
    // deste trecho [base, base+tam). Barra offsets forjados (aliasing, zip64
    // gigante) que apontariam para fora ou para a mesma região mil vezes.
    if (!Number.isSafeInteger(offLocal) || !Number.isSafeInteger(tamComp) || !Number.isSafeInteger(tamOrig)) continue;
    if (offLocal < 0 || tamComp < 0 || tamOrig < 0) continue;
    if (offLocal + 30 > tam || offLocal + 30 + tamComp > tam) continue;
    out.push({ nome, metodo, tamComp, tamOrig, offLocal });
  }
  return out;
}

// Onde começam os DADOS de uma entrada (pulando o cabeçalho local). tam é o
// tamanho do trecho: os dados têm de caber dentro dele.
function zipInicioDados(fd, base, ent, tam) {
  if (ent.offLocal + 30 > tam) return -1;
  const loc = zipLerTrecho(fd, base, ent.offLocal, 30);
  if (loc.length < 30 || loc.readUInt32LE(0) !== 0x04034b50) return -1;
  const inicio = ent.offLocal + 30 + loc.readUInt16LE(26) + loc.readUInt16LE(28);
  if (inicio + ent.tamComp > tam) return -1;
  return inicio;
}

// Lê uma entrada PEQUENA (um manifest) para a memória, com teto
function zipLerPequena(fd, base, ent, tam, teto) {
  if (ent.tamOrig > teto || ent.tamComp > teto) return null;
  const inicio = zipInicioDados(fd, base, ent, tam);
  if (inicio < 0) return null;
  const comp = zipLerTrecho(fd, base, inicio, ent.tamComp);
  try {
    if (ent.metodo === 0) return comp;
    if (ent.metodo === 8) return zlib.inflateRawSync(comp, { maxOutputLength: teto });
  } catch { /* entrada corrompida: ignora */ }
  return null;
}

// Materializa uma entrada GRANDE (um perfil deflatado) num arquivo
// temporário, em FLUXO: a memória fica pequena, o disco é quem trabalha
function zipMaterializar(fd, base, ent, tam, destino, teto) {
  return new Promise((resolve) => {
    if (ent.tamOrig > teto || (ent.metodo !== 0 && ent.metodo !== 8)) return resolve(false);
    const inicio = zipInicioDados(fd, base, ent, tam);
    if (inicio < 0 || ent.tamComp <= 0) return resolve(false);
    const { Transform, pipeline } = require('stream');
    let saida = 0;
    const conta = new Transform({
      transform(pedaco, enc, cb) {
        saida += pedaco.length;
        if (saida > teto) return cb(new Error('grande demais'));
        cb(null, pedaco);
      },
    });
    const leitura = fs.createReadStream('', {
      fd, autoClose: false,
      start: base + inicio, end: base + inicio + ent.tamComp - 1,
    });
    const escrita = fs.createWriteStream(destino);
    const etapas = ent.metodo === 8
      ? [leitura, zlib.createInflateRaw(), conta, escrita]
      : [leitura, conta, escrita];
    pipeline(...etapas, (err) => resolve(!err));
  });
}

// Orçamento AGREGADO da importação inteira: um backup hostil não pode gastar
// memória/disco/tempo sem limite espalhando o custo por 20000 entradas ×
// vários zips aninhados. Cada consumo desconta daqui; zerou, para.
function novoOrcamentoZip() {
  return {
    manifestBytes: 96 * 1024 * 1024,  // total de manifests mantidos na memória
    discoBytes: 3 * 1024 * 1024 * 1024, // total materializado no disco (deflate)
    entradas: 200000,                 // entradas de diretório central varridas
    zips: 4000,                       // zips aninhados abertos
    // 🖼️ v0.90: as artes das teclas também vêm no passeio (ícones pequenos)
    imagemBytes: 48 * 1024 * 1024,
    imagens: 600,
    esgotado: false,
  };
}

// Uma arte de tecla dentro do backup: pequena e com cara de imagem
const SD_IMG_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;
const SD_IMG_MAX = 768 * 1024;

// Varre um zip juntando os manifests, agrupados por perfil. O backup real
// (.streamDeckProfilesBackup) é um zip DE zips: cada perfil vem lá dentro
// como um .streamDeckProfile — que é ELE MESMO outro zip. Perfil guardado
// (store) é lido no lugar, sem copiar; deflatado vira um temporário.
async function coletarPerfisDeZip(fd, base, tam, prof, tmpDir, orc) {
  const grupos = [];   // { nomePerfil: string|null, manifests: [{nome, dados}], imagens: [{nome, dados}] }
  const soltos = [];
  const soltosImg = [];
  const empacota = (sub, ent) => {
    const manifests = [];
    const imagens = [];
    for (const g of sub) { manifests.push(...g.manifests); imagens.push(...(g.imagens || [])); }
    if (!manifests.length) return;
    manifests.sort((a, b) => a.nome.length - b.nome.length);
    let nomePerfil = '';
    for (const m of manifests) {
      try {
        const d = JSON.parse(m.dados.toString('utf8'));
        if (d && d.Name) { nomePerfil = String(d.Name).slice(0, 40); break; }
      } catch {}
    }
    if (!nomePerfil) nomePerfil = path.basename(ent.nome).replace(/\.[^.]+$/, '').slice(0, 40) || 'Stream Deck';
    grupos.push({ nomePerfil, manifests, imagens });
  };
  const central = zipCentralFd(fd, base, tam);
  orc.entradas -= central.length;
  if (orc.entradas < 0) orc.esgotado = true;
  for (const ent of central) {
    if (orc.esgotado) break;
    if (/\.(streamdeckprofile|sdprofile)$/i.test(ent.nome) && prof < 2) {
      if (--orc.zips < 0) { orc.esgotado = true; break; }
      if (ent.metodo === 0) {
        // guardado sem compressão: o zip de dentro é um trecho deste arquivo
        const inicio = zipInicioDados(fd, base, ent, tam);
        if (inicio >= 0) {
          empacota(await coletarPerfisDeZip(fd, base + inicio, ent.tamComp, prof + 1, tmpDir, orc), ent);
        }
      } else {
        orc.discoBytes -= ent.tamOrig;
        if (orc.discoBytes < 0) { orc.esgotado = true; break; }
        // 🛡️ v0.127.1: um perfil nunca passa de 512 MB — e o orçamento
        // desconta o tamanho REAL do que saiu, não o que o zip declarou
        const TETO_PERFIL = 512 * 1024 * 1024;
        const tetoPerfil = Math.min(ent.tamOrig || TETO_PERFIL, orc.discoBytes + ent.tamOrig, TETO_PERFIL);
        const tmp = path.join(tmpDir, 'sd-perfil-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.zip');
        const ok = await zipMaterializar(fd, base, ent, tam, tmp, tetoPerfil);
        try { const real = fs.statSync(tmp).size; if (real > ent.tamOrig) orc.discoBytes -= real - ent.tamOrig; } catch {}
        if (orc.discoBytes < 0) { orc.esgotado = true; try { fs.unlinkSync(tmp); } catch {} break; }
        if (ok) {
          let fd2 = null;
          try {
            fd2 = fs.openSync(tmp, 'r');
            empacota(await coletarPerfisDeZip(fd2, 0, fs.fstatSync(fd2).size, prof + 1, tmpDir, orc), ent);
          } catch { /* perfil ilegível: ignora */ }
          if (fd2 !== null) { try { fs.closeSync(fd2); } catch {} }
        }
        try { fs.unlinkSync(tmp); } catch {}
      }
      continue;
    }
    if (ent.nome.endsWith('manifest.json') && ent.tamOrig <= ZIP_MAX_MANIFEST) {
      orc.manifestBytes -= ent.tamOrig;
      if (orc.manifestBytes < 0) { orc.esgotado = true; break; }
      const dados = zipLerPequena(fd, base, ent, tam, ZIP_MAX_MANIFEST);
      if (dados) soltos.push({ nome: ent.nome, dados });
      continue;
    }
    // 🖼️ v0.90: as artes das teclas (ícones pequenos) viajam junto — antes o
    // importador nem olhava para elas
    if (SD_IMG_RE.test(ent.nome) && ent.tamOrig > 0 && ent.tamOrig <= SD_IMG_MAX
        && orc.imagens > 0 && orc.imagemBytes >= ent.tamOrig) {
      const dados = zipLerPequena(fd, base, ent, tam, SD_IMG_MAX);
      if (dados) {
        orc.imagens--;
        orc.imagemBytes -= dados.length;
        soltosImg.push({ nome: ent.nome, dados });
      }
    }
  }
  if (soltos.length) grupos.push({ nomePerfil: null, manifests: soltos, imagens: soltosImg });
  else if (soltosImg.length && grupos.length === 1) grupos[0].imagens.push(...soltosImg);
  return grupos;
}



// Importa as teclas de um arquivo de backup do Stream Deck.
// Os botões "Tocar áudio" continuam nascendo SEM arquivo (url vazia): os
// áudios não vêm no backup — o casamento por pasta (abaixo) os encontra na
// máquina do streamer. v0.90 (auditoria dos recursos da Elgato): agora vêm
// também 🖼️ a ARTE de cada tecla (os ícones do backup entram na biblioteca
// da Mesa), 📁 as pastas do próprio Stream Deck (aninhadas como lá), 🎛️
// cada Multi Action vira um Botão de multi ação com os passos dentro (os
// passos de espera viram o ⏱ da tecla anterior), 🎬 as ações do plugin do
// OBS Studio (cena/gravação/transmissão) viram teclas da Mesa, e a POSIÇÃO
// de cada tecla na grade é preservada.
async function importarStreamDeckArquivo(caminho) {
  const achadas = [];
  const vistos = new Set();

  // 🖼️ Arte da tecla: o conteúdo vira um arquivo da biblioteca da Mesa,
  // deduplicado por conteúdo (perfis repetem muito ícone)
  const imagensSalvas = new Map();
  const salvaImagem = (img) => {
    if (!img || !img.dados || !img.dados.length) return '';
    try {
      const hash = crypto.createHash('sha1').update(img.dados).digest('hex').slice(0, 16);
      if (imagensSalvas.has(hash)) return imagensSalvas.get(hash);
      const ext = (path.extname(img.nome).toLowerCase().match(/^\.(png|jpe?g|gif|webp|bmp)$/) || ['.png'])[0];
      const nome = 'sd-' + hash + ext;
      fs.mkdirSync(TRILHAS_UP_DIR, { recursive: true });
      fs.writeFileSync(path.join(TRILHAS_UP_DIR, nome), img.dados);
      const url = '/uploads/trilhas/' + encodeURIComponent(nome);
      imagensSalvas.set(hash, url);
      return url;
    } catch { return ''; }
  };

  const tituloDe = (acao) => {
    const estados = Array.isArray(acao.States) ? acao.States : [];
    return String((estados[0] || {}).Title || '').replace(/\s*\n+\s*/g, ' ').trim();
  };

  // Os códigos seguem a ordem dos menus do Stream Deck:
  // actionType: 0 Play/Stop · 1 Play/Overlap · 2 Play/Restart · 3 Loop/Stop
  // fadeType:   0 No Fade   · 1 Fade In      · 2 Fade Out     · 3 In & Out
  const trilhaDeAudio = (acao, pastaId) => {
    const s = acao.Settings && typeof acao.Settings === 'object' ? acao.Settings : {};
    const titulo = tituloDe(acao);
    const caminhoSom = String(s.path || '').trim();
    if (!caminhoSom && !titulo) return null;
    const base = caminhoSom ? path.basename(caminhoSom.replace(/\\/g, '/')) : '';
    const chave = pastaId + '|' + (titulo || base).toLowerCase() + '|' + base.toLowerCase();
    if (vistos.has(chave)) return null;
    vistos.add(chave);
    return sanitizeTrilha({
      nome: titulo || base.replace(/\.[^.]+$/, ''),
      pastaId,
      url: '',
      origem: base,
      volume: numeroEntre(s.volume, 0, 100, 70),
      modo: ['solo', 'sobrepor', 'recomecar', 'loop'][Number(s.actionType)] || 'solo',
      fadeTipo: ['nenhum', 'entrada', 'saida', 'ambos'][Number(s.fadeType)] || 'ambos',
      fade: numeroEntre(s.fadeLen, 0, 10, 3),
    });
  };

  // 🎬 v0.90: ações do plugin oficial do OBS Studio para o Stream Deck — o
  // que a Mesa sabe fazer vira tecla 🎬 (cena, gravação, transmissão)
  const trilhaDeObs = (acao, pastaId) => {
    const uuid = String(acao.UUID || '').toLowerCase();
    if (!uuid.includes('.obsstudio.')) return null;
    const s = acao.Settings && typeof acao.Settings === 'object' ? acao.Settings : {};
    const titulo = tituloDe(acao);
    const cena = String(s.sceneName || s.scene || '').trim().slice(0, 200);
    if (uuid.includes('scene') && cena) {
      return sanitizeTrilha({ nome: titulo || cena, pastaId, tipo: 'obs', obsAcao: 'cena', obsAlvo: { nome: cena, modo: 'auto' } });
    }
    if (uuid.includes('record')) {
      return sanitizeTrilha({ nome: titulo || 'REC', pastaId, tipo: 'obs', obsAcao: 'gravar', obsAlvo: { modo: 'alternar' } });
    }
    if (uuid.includes('stream')) {
      return sanitizeTrilha({ nome: titulo || 'LIVE', pastaId, tipo: 'obs', obsAcao: 'transmitir', obsAlvo: { modo: 'alternar' } });
    }
    return null;
  };

  // 📁 Cada perfil do Stream Deck vira uma PASTA da Mesa, com os botões
  // dentro (repetiu o nome, reaproveita a pasta)
  const pastasPorNome = new Map();
  const criaPasta = (nomePerfil) => {
    let pastaId = pastasPorNome.get(nomePerfil.toLowerCase());
    if (!pastaId) {
      pastaId = newInstanceId('tr');
      pastasPorNome.set(nomePerfil.toLowerCase(), pastaId);
      achadas.push(sanitizeTrilha({ id: pastaId, nome: nomePerfil, tipo: 'pasta' }));
    }
    return pastaId;
  };

  const processaGrupo = (g) => {
    // 1) As páginas do perfil, cada uma com o diretório dela dentro do zip
    const paginas = [];
    for (const m of g.manifests) {
      let d;
      try { d = JSON.parse(m.dados.toString('utf8')); } catch { continue; }
      const dir = m.nome.replace(/\\/g, '/').replace(/\/?manifest\.json$/i, '');
      paginas.push({ dir, dados: d, nome: typeof d.Name === 'string' ? String(d.Name).slice(0, 40) : '' });
    }
    if (!paginas.length) return;
    paginas.sort((a, b) => a.dir.length - b.dir.length);
    const imagens = g.imagens || [];
    // A arte de uma tecla mora na pasta "x,y" da página dela
    const imagemDaTecla = (pagina, coord) => {
      const prefixo = (pagina.dir ? pagina.dir + '/' : '') + coord + '/';
      return imagens.find((i) => i.nome.replace(/\\/g, '/').startsWith(prefixo)) || null;
    };
    // A página filha (a "pasta" do próprio Stream Deck): o diretório dela é
    // o ProfileUUID que a ação de abrir pasta aponta
    const porUuid = new Map();
    for (const p of paginas) {
      porUuid.set(path.basename(p.dir).toLowerCase().replace(/\.sdprofile$/i, ''), p);
    }
    const paginasUsadas = new Set();

    const criaPastaTecla = (nome, pastaId, pos, imagem, tipo) => {
      const tecla = sanitizeTrilha({ id: newInstanceId('tr'), nome, tipo, pastaId, pos, imagem });
      achadas.push(tecla);
      return tecla.id;
    };

    const andaAcao = (acao, pastaId, pos, pagina, coord, prof = 0) => {
      if (!acao || typeof acao !== 'object') return;
      // 🛡️ v0.90.1: teto de profundidade. Um backup com milhares de páginas
      // encadeadas (uma abrindo a outra) estourava a pilha do programa —
      // nenhum Stream Deck real passa de alguns níveis.
      if (prof > 32) return;
      const uuid = String(acao.UUID || '');
      const imagem = pagina && coord ? salvaImagem(imagemDaTecla(pagina, coord)) : '';
      // 📁 Abrir pasta: a página apontada vira uma pasta DE VERDADE aqui,
      // aninhada onde a tecla estava (v0.89 liberou pasta dentro de pasta)
      if (/\.profile\.openchild$/i.test(uuid)) {
        const s = acao.Settings && typeof acao.Settings === 'object' ? acao.Settings : {};
        const alvo = porUuid.get(String(s.ProfileUUID || '').toLowerCase());
        if (!alvo || paginasUsadas.has(alvo)) return;
        paginasUsadas.add(alvo);
        const id = criaPastaTecla(tituloDe(acao) || alvo.nome || 'Pasta', pastaId, pos, imagem, 'pastaSimples');
        andaPagina(alvo, id, prof + 1);
        return;
      }
      if (/\.profile\.backtoparent$/i.test(uuid)) return; // o ⬅ daqui já existe
      // 🎛️ Multi Action: vira um Botão de multi ação com os passos DENTRO —
      // e os passos de espera (delay) viram o ⏱ da tecla anterior
      const passos = [];
      for (const sub of Array.isArray(acao.Actions) ? acao.Actions : []) {
        for (const a of Array.isArray(sub && sub.Actions) ? sub.Actions : []) passos.push(a);
      }
      if (passos.length) {
        const idPasta = criaPastaTecla(tituloDe(acao) || 'Multi ação', pastaId, pos, imagem, 'pasta');
        let dentroPos = 0;
        for (const passo of passos) {
          if (!passo || typeof passo !== 'object') continue;
          const pUuid = String(passo.UUID || '');
          if (/delay$/i.test(pUuid)) {
            // A espera do Stream Deck vem em milissegundos; o ⏱ é em segundos
            const sp = passo.Settings && typeof passo.Settings === 'object' ? passo.Settings : {};
            const bruto = Number(sp.delay ?? sp.Delay ?? sp.time ?? 0);
            const segundos = bruto > 100 ? bruto / 1000 : bruto;
            const anterior = achadas[achadas.length - 1];
            if (anterior && anterior.pastaId === idPasta) {
              anterior.espera = Math.round(numeroEntre(segundos, 0, 86400, 0) * 10) / 10;
            }
            continue;
          }
          const filha = /\.soundboard\.playaudio$/i.test(pUuid) ? trilhaDeAudio(passo, idPasta) : trilhaDeObs(passo, idPasta);
          if (filha) { filha.pos = dentroPos++; achadas.push(filha); }
        }
        return; // multi ação sem passo aproveitável: a pasta vazia sai no fim
      }
      const tecla = /\.soundboard\.playaudio$/i.test(uuid) ? trilhaDeAudio(acao, pastaId) : trilhaDeObs(acao, pastaId);
      if (tecla) {
        tecla.pos = pos;
        if (imagem) tecla.imagem = imagem;
        achadas.push(tecla);
      }
    };

    const andaPagina = (pagina, pastaId, prof = 0) => {
      const controles = Array.isArray(pagina.dados.Controllers) ? pagina.dados.Controllers : [];
      // A célula preserva a posição da grade: linha × colunas + coluna
      let colunas = 1;
      for (const ctl of controles) {
        const acoes = ctl && ctl.Actions && typeof ctl.Actions === 'object' ? ctl.Actions : {};
        for (const coord of Object.keys(acoes)) {
          const x = Number(String(coord).split(',')[0]);
          if (Number.isFinite(x)) colunas = Math.max(colunas, x + 1);
        }
      }
      for (const ctl of controles) {
        const acoes = ctl && ctl.Actions && typeof ctl.Actions === 'object' ? ctl.Actions : {};
        for (const [coord, acao] of Object.entries(acoes)) {
          const [x, y] = String(coord).split(',').map(Number);
          const pos = Number.isFinite(x) && Number.isFinite(y) ? y * colunas + x : null;
          andaAcao(acao, pastaId, pos, pagina, coord, prof);
        }
      }
    };

    // 2) A raiz do perfil é o manifest nomeado (ou o de caminho mais curto)
    const raiz = paginas.find((p) => p.nome) || paginas[0];
    const pastaPerfilId = criaPasta(g.nomePerfil || raiz.nome || 'Stream Deck');
    paginasUsadas.add(raiz);
    andaPagina(raiz, pastaPerfilId);
    // 3) Páginas que nenhuma tecla de abrir pasta apontou: as nomeadas viram
    // pastas irmãs (como antes) e as demais caem na pasta do perfil
    for (const p of paginas) {
      if (paginasUsadas.has(p)) continue;
      paginasUsadas.add(p);
      andaPagina(p, p.nome ? criaPasta(p.nome) : pastaPerfilId);
    }
  };

  let grupos = [];
  let fd = null;
  try {
    fd = fs.openSync(caminho, 'r');
    grupos = await coletarPerfisDeZip(fd, 0, fs.fstatSync(fd).size, 0, path.dirname(caminho), novoOrcamentoZip());
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
  for (const g of grupos) processaGrupo(g);
  // Pasta sem nenhum botão vivo dentro não entra (multi ação vazia, perfil
  // sem tecla aproveitável) — repete até estabilizar, por causa do aninhamento
  let atuais = achadas;
  for (;;) {
    const comFilhos = new Set(atuais.filter((t) => t.pastaId).map((t) => t.pastaId));
    const filtrada = atuais.filter((t) => !ehPastaTrilha(t) || comFilhos.has(t.id));
    if (filtrada.length === atuais.length) return filtrada.slice(0, TRILHAS_MAX);
    atuais = filtrada;
  }
}

// Importa um ARQUIVO de backup e devolve o resultado — o arquivo nunca entra
// inteiro na memória (5 GB de backup são bem-vindos).
async function importarBackupArquivo(caminho) {
  let tamanho = 0;
  try { tamanho = fs.statSync(caminho).size; } catch { return { ok: false, erro: 'arquivo vazio ou grande demais' }; }
  if (tamanho < 22 || tamanho > MAX_SD_IMPORT_BYTES) {
    return { ok: false, erro: 'arquivo vazio ou grande demais' };
  }
  let novas;
  try { novas = await importarStreamDeckArquivo(caminho); } catch { novas = []; }
  if (!novas.length) return { ok: false, erro: 'não achei botões de som nesse arquivo' };
  // Junta sem duplicar (mesmo nome + mesmo arquivo de origem). Uma 📁
  // pasta que já existe com o mesmo nome é reaproveitada: os botões
  // novos entram DENTRO dela, em vez de nascer uma pasta gêmea.
  const chaves = new Set(state.trilhas.map((t) => (t.nome + '|' + t.origem).toLowerCase()));
  const pastasExistentes = new Map(state.trilhas.filter(ehPastaTrilha).map((t) => [t.nome.toLowerCase(), t.id]));
  const remap = new Map();
  const pastasNovas = new Set();
  let adicionadas = 0;
  for (const t of novas) {
    // Só a pasta de PERFIL (na raiz) reaproveita uma existente com o mesmo
    // nome — as aninhadas (v0.90) são estrutura do backup e entram inteiras
    if (ehPastaTrilha(t) && !t.pastaId) {
      const jaTem = pastasExistentes.get(t.nome.toLowerCase());
      if (jaTem) { remap.set(t.id, jaTem); continue; }
    }
    if (t.pastaId && remap.has(t.pastaId)) t.pastaId = remap.get(t.pastaId);
    if (!ehPastaTrilha(t) && chaves.has((t.nome + '|' + t.origem).toLowerCase())) continue;
    if (state.trilhas.length >= TRILHAS_MAX) break;
    // 🎛️ v0.90: quem mora numa pasta NOVA guarda a posição original da grade
    // do Stream Deck. Fora disso (raiz, pasta reaproveitada), o que vem de
    // fora entra DEPOIS do que já existe, sem se espalhar pelos buracos que
    // a pessoa deixou de propósito na grade (v0.52.1)
    const pastaNova = t.pastaId && pastasNovas.has(t.pastaId);
    if (!pastaNova || t.pos == null) {
      const dentro = t.pastaId || '';
      const usadas = state.trilhas
        .filter((x) => (dentro ? x.pastaId === dentro : !x.pastaId))
        .map((x) => Number(x.pos));
      const depoisDeTudo = usadas.length ? Math.max(...usadas) + 1 : (dentro ? 1 : 0);
      t.pos = Math.max(depoisDeTudo, dentro ? 1 : 0);
    }
    if (ehPastaTrilha(t)) pastasNovas.add(t.id);
    state.trilhas.push(t);
    adicionadas++;
  }
  state.trilhas = sanitizeTrilhas(state.trilhas);
  persistTrilhas();
  broadcast({ type: 'trilhas', trilhas: state.trilhas });
  // 🖼️ v0.90: as artes das teclas entraram na biblioteca da Mesa
  broadcast({ type: 'media', media: listMedia() });
  return { ok: true, adicionadas, pendentes: state.trilhas.filter((t) => !t.url && t.origem).length };
}

// O caminho antigo (WebSocket, arquivo pequeno em base64): grava num
// temporário e usa o MESMO leitor de disco
async function importarBackupBuffer(buf) {
  if (!buf || buf.length < 22) return { ok: false, erro: 'arquivo vazio ou grande demais' };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, 'sd-import-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + '.bin');
  try {
    fs.writeFileSync(tmp, buf);
    return await importarBackupArquivo(tmp);
  } catch {
    return { ok: false, erro: 'não achei botões de som nesse arquivo' };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}


function casarTrilhasComPasta(pastaBruta) {
  const pasta = String(pastaBruta || '').trim();
  let raiz;
  try { raiz = fs.realpathSync(pasta); } catch { return { ok: false, erro: 'essa pasta não existe' }; }
  const porNome = new Map();
  let vistosArq = 0;
  const anda = (dir, prof) => {
    if (prof > 6 || vistosArq > 8000) return;
    let nomes;
    try { nomes = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of nomes) {
      if (vistosArq > 8000) return;
      const cheio = path.join(dir, ent.name);
      if (ent.isDirectory()) anda(cheio, prof + 1);
      else if (ent.isFile()) {
        vistosArq++;
        if (AUDIO_EXTS.has(path.extname(ent.name).toLowerCase()) && !porNome.has(ent.name.toLowerCase())) {
          porNome.set(ent.name.toLowerCase(), cheio);
        }
      }
    }
  };
  anda(raiz, 0);
  let casadas = 0;
  const faltando = [];
  fs.mkdirSync(TRILHAS_UP_DIR, { recursive: true });
  for (const t of state.trilhas) {
    if (t.url || !t.origem) continue;
    const de = porNome.get(t.origem.toLowerCase());
    if (!de) { faltando.push(t.origem); continue; }
    const seguro = path.basename(t.origem).replace(/[^\w.\-()\[\] À-ÿ]+/g, '_').slice(-80) || 'trilha';
    const nomeFinal = Date.now().toString(36) + '-' + seguro;
    try {
      // 📚 v0.88: som casado é da MESA — vai para a biblioteca dela
      fs.copyFileSync(de, path.join(TRILHAS_UP_DIR, nomeFinal));
      // codificado como nas outras mídias (espaços etc.): o "EM USO" da lista
      // de áudios compara com a URL da mídia, que sai de encodeURIComponent
      t.url = '/uploads/trilhas/' + encodeURIComponent(nomeFinal);
      casadas++;
    } catch { faltando.push(t.origem); }
  }
  if (casadas) {
    persistTrilhas();
    broadcast({ type: 'trilhas', trilhas: state.trilhas });
    broadcast({ type: 'media', media: listMedia() });
  }
  return { ok: true, casadas, faltando: faltando.slice(0, 50) };
}

// ===========================================================================
// 💾 v0.90: backup PRÓPRIO da Mesa de Trilhas
// - simples: um .json só com as teclas (a configuração, sem os arquivos)
// - total:   um .zip com mesa.json + a biblioteca da Mesa (uploads/trilhas)
//            e os áudios/mídias da biblioteca geral que as teclas usam
// A restauração aceita os dois — e continua aceitando QUALQUER backup do
// Stream Deck (cai no importador da Elgato, como sempre).
// ===========================================================================

// CRC-32 clássico (o do formato zip) — sem dependências, como o leitor
const CRC32_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32Passo(crc, buf) {
  let c = crc;
  for (let i = 0; i < buf.length; i++) c = CRC32_TABELA[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}
function crc32DeArquivo(caminho) {
  return new Promise((resolve, reject) => {
    let crc = 0xffffffff;
    const leitura = fs.createReadStream(caminho);
    leitura.on('data', (peda) => { crc = crc32Passo(crc, peda); });
    leitura.on('end', () => resolve((crc ^ 0xffffffff) >>> 0));
    leitura.on('error', reject);
  });
}

// Escreve um zip SEM compressão (store) direto na resposta HTTP. Cada
// arquivo do disco é lido duas vezes (uma para o CRC, outra para os dados):
// assim os cabeçalhos saem completos e QUALQUER descompactador entende.
// Tamanhos e offsets acima de 4 GB ganham os campos zip64 (o leitor daqui
// de cima já os conhece).
async function escreverZipParaRes(res, entradas) {
  const TETO32 = 0xffffffff;
  let offset = 0;
  // 🚪 v0.90.1: fechar a aba no meio do download tem de ACORDAR quem está
  // esperando o 'drain'. Sem isto a promessa nunca resolvia e a função ficava
  // pendurada para sempre a cada download cancelado.
  let cancelado = false;
  const aoFechar = () => { cancelado = true; };
  res.once('close', aoFechar);
  const manda = (buf) => new Promise((resolve, reject) => {
    if (cancelado || res.writableEnded) return reject(new Error('download cancelado'));
    if (res.write(buf, (err) => { if (err) reject(err); })) return resolve();
    const pronto = () => { res.off('close', falhou); resolve(); };
    const falhou = () => { res.off('drain', pronto); reject(new Error('download cancelado')); };
    res.once('drain', pronto);
    res.once('close', falhou);
  });
  const centrais = [];
  for (const e of entradas) {
    const nome = Buffer.from(e.nome, 'utf8');
    let tam = 0;
    let crc = 0;
    if (e.dados) {
      tam = e.dados.length;
      crc = (crc32Passo(0xffffffff, e.dados) ^ 0xffffffff) >>> 0;
    } else {
      tam = fs.statSync(e.caminho).size;
      crc = await crc32DeArquivo(e.caminho);
    }
    const zip64 = tam >= TETO32 || offset >= TETO32;
    // Extra zip64 do cabeçalho local: só os dois tamanhos (sem offset)
    let extraLocal = Buffer.alloc(0);
    if (zip64) {
      extraLocal = Buffer.alloc(20);
      extraLocal.writeUInt16LE(0x0001, 0);
      extraLocal.writeUInt16LE(16, 2);
      extraLocal.writeBigUInt64LE(BigInt(tam), 4);   // tamanho original
      extraLocal.writeBigUInt64LE(BigInt(tam), 12);  // comprimido (= store)
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(zip64 ? 45 : 20, 4);  // versão mínima
    local.writeUInt16LE(0x0800, 6);           // nomes em UTF-8
    local.writeUInt16LE(0, 8);                // store (sem compressão)
    local.writeUInt16LE(0, 10);               // hora/data: fixas (backup)
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(zip64 ? TETO32 : tam, 18);
    local.writeUInt32LE(zip64 ? TETO32 : tam, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(extraLocal.length, 28);
    const inicio = offset;
    await manda(local);
    await manda(nome);
    if (extraLocal.length) await manda(extraLocal);
    offset += 30 + nome.length + extraLocal.length;
    if (e.dados) {
      await manda(e.dados);
    } else {
      await new Promise((resolve, reject) => {
        const leitura = fs.createReadStream(e.caminho);
        const parar = () => { leitura.destroy(); reject(new Error('download cancelado')); };
        leitura.on('data', (peda) => {
          if (!res.write(peda)) { leitura.pause(); res.once('drain', () => leitura.resume()); }
        });
        leitura.on('end', () => { res.off('close', parar); resolve(); });
        leitura.on('error', (err) => { res.off('close', parar); reject(err); });
        res.once('close', parar);
      });
    }
    offset += tam;
    centrais.push({ nome, crc, tam, inicio, zip64 });
  }
  const inicioCentral = offset;
  for (const c of centrais) {
    const zip64 = c.zip64 || c.inicio >= TETO32 || c.tam >= TETO32;
    const extra = zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(24, 2);
      extra.writeBigUInt64LE(BigInt(c.tam), 4);
      extra.writeBigUInt64LE(BigInt(c.tam), 12);
      extra.writeBigUInt64LE(BigInt(c.inicio), 20);
    }
    const cab = Buffer.alloc(46);
    cab.writeUInt32LE(0x02014b50, 0);
    cab.writeUInt16LE(45, 4);                 // feito por
    cab.writeUInt16LE(zip64 ? 45 : 20, 6);    // versão mínima
    cab.writeUInt16LE(0x0800, 8);
    cab.writeUInt16LE(0, 10);
    cab.writeUInt16LE(0, 12);
    cab.writeUInt16LE(0x21, 14);
    cab.writeUInt32LE(c.crc, 16);
    cab.writeUInt32LE(zip64 ? TETO32 : c.tam, 20);
    cab.writeUInt32LE(zip64 ? TETO32 : c.tam, 24);
    cab.writeUInt16LE(c.nome.length, 28);
    cab.writeUInt16LE(extra.length, 30);
    cab.writeUInt32LE(zip64 ? TETO32 : c.inicio, 42);
    await manda(cab);
    await manda(c.nome);
    if (extra.length) await manda(extra);
    offset += 46 + c.nome.length + extra.length;
  }
  const tamCentral = offset - inicioCentral;
  const precisa64 = centrais.length > 0xfffe || inicioCentral >= TETO32 || tamCentral >= TETO32;
  if (precisa64) {
    const e64 = Buffer.alloc(56);
    e64.writeUInt32LE(0x06064b50, 0);
    e64.writeBigUInt64LE(44n, 4);
    e64.writeUInt16LE(45, 12);
    e64.writeUInt16LE(45, 14);
    e64.writeBigUInt64LE(BigInt(centrais.length), 24);
    e64.writeBigUInt64LE(BigInt(centrais.length), 32);
    e64.writeBigUInt64LE(BigInt(tamCentral), 40);
    e64.writeBigUInt64LE(BigInt(inicioCentral), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeBigUInt64LE(BigInt(offset), 8);
    loc.writeUInt32LE(1, 16);
    await manda(e64);
    await manda(loc);
    offset += 76;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Math.min(centrais.length, 0xffff), 8);
  eocd.writeUInt16LE(Math.min(centrais.length, 0xffff), 10);
  eocd.writeUInt32LE(Math.min(tamCentral, TETO32), 12);
  eocd.writeUInt32LE(Math.min(inicioCentral, TETO32), 16);
  await manda(eocd);
  res.end();
}

// O manifesto que viaja nos dois formatos de backup da Mesa
function mesaBackupManifesto() {
  return JSON.stringify({
    formato: 'obs-social-mesa',
    geradoEm: new Date().toISOString(),
    trilhas: state.trilhas,
  }, null, 2);
}

// A lista de entradas do backup TOTAL: mesa.json + a biblioteca da Mesa
// inteira + o que as teclas usam da biblioteca geral (/uploads/ raiz)
function mesaBackupEntradas() {
  const entradas = [{ nome: 'mesa.json', dados: Buffer.from(mesaBackupManifesto(), 'utf8') }];
  try {
    for (const nome of fs.readdirSync(TRILHAS_UP_DIR)) {
      const cheio = path.join(TRILHAS_UP_DIR, nome);
      try { if (fs.statSync(cheio).isFile()) entradas.push({ nome: 'arquivos/trilhas/' + nome, caminho: cheio }); } catch {}
    }
  } catch { /* biblioteca ainda vazia */ }
  const daRaiz = new Set();
  for (const t of state.trilhas || []) {
    for (const u of [t.url, t.imagem]) {
      const m = /^\/uploads\/([^/\\]+)$/.exec(String(u || ''));
      // (um % solto no nome fazia o decode estourar e o backup total cair)
      if (m) { try { daRaiz.add(decodeURIComponent(m[1])); } catch { /* nome inválido: fica de fora */ } }
    }
  }
  for (const nome of daRaiz) {
    const cheio = path.join(UPLOADS_DIR, path.basename(nome));
    try { if (fs.statSync(cheio).isFile()) entradas.push({ nome: 'arquivos/uploads/' + path.basename(nome), caminho: cheio }); } catch {}
  }
  return entradas;
}

// Aplica um manifesto da Mesa: SUBSTITUI as teclas atuais (a página de
// configurações confirma antes de mandar o arquivo)
function mesaAplicarManifesto(bruto) {
  if (!bruto || bruto.formato !== 'obs-social-mesa' || !Array.isArray(bruto.trilhas)) {
    return { ok: false, erro: 'esse arquivo não é um backup da Mesa' };
  }
  state.trilhas = sanitizeTrilhas(bruto.trilhas);
  pararTrilha();
  persistTrilhas();
  broadcast({ type: 'trilhas', trilhas: state.trilhas });
  broadcast({ type: 'media', media: listMedia() });
  return { ok: true, origem: 'mesa', teclas: state.trilhas.length, pendentes: state.trilhas.filter((t) => !t.url && t.origem).length };
}

// Restaura um arquivo mandado pela página: decide sozinho o que ele é —
// backup simples (.json), backup total (.zip com mesa.json) ou um backup
// do Stream Deck (qualquer outro zip: vai para o importador da Elgato)
async function restaurarMesaArquivo(caminho) {
  let inicio = Buffer.alloc(4);
  let fd = null;
  try {
    fd = fs.openSync(caminho, 'r');
    fs.readSync(fd, inicio, 0, 4, 0);
  } catch {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
    return { ok: false, erro: 'não consegui ler o arquivo' };
  }
  try {
    if (inicio[0] !== 0x50 || inicio[1] !== 0x4b) {
      // Não é zip: só pode ser o backup simples (.json)
      try { fs.closeSync(fd); } catch {}
      fd = null;
      const tamanho = fs.statSync(caminho).size;
      if (tamanho > 32 * 1024 * 1024) return { ok: false, erro: 'esse arquivo não é um backup da Mesa' };
      let bruto = null;
      try { bruto = JSON.parse(fs.readFileSync(caminho, 'utf8')); } catch { return { ok: false, erro: 'esse arquivo não é um backup da Mesa' }; }
      return mesaAplicarManifesto(bruto);
    }
    const tam = fs.fstatSync(fd).size;
    const central = zipCentralFd(fd, 0, tam);
    const manifesto = central.find((ent) => ent.nome.replace(/\\/g, '/') === 'mesa.json');
    if (!manifesto) {
      // Zip sem mesa.json: um backup do Stream Deck (compatibilidade mantida)
      try { fs.closeSync(fd); } catch {}
      fd = null;
      const r = await importarBackupArquivo(caminho);
      return r.ok ? { ...r, origem: 'streamdeck' } : r;
    }
    // Backup TOTAL da Mesa: devolve os arquivos e depois aplica o manifesto
    let bruto = null;
    try { bruto = JSON.parse((zipLerPequena(fd, 0, manifesto, tam, 32 * 1024 * 1024) || Buffer.alloc(0)).toString('utf8')); }
    catch { return { ok: false, erro: 'o mesa.json de dentro do backup está ilegível' }; }
    let arquivos = 0;
    fs.mkdirSync(TRILHAS_UP_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    // 🛡️ v0.90.1: orçamento AGREGADO, como no importador do Stream Deck. Sem
    // ele, um zip de poucos MB com milhares de entradas infláveis (bomba de
    // descompressão) enchia o disco — o teto antigo era por entrada.
    let orcamento = 3 * 1024 * 1024 * 1024;
    let cabem = 5000;
    for (const ent of central) {
      if (orcamento <= 0 || cabem <= 0 || espacoLivreAbaixoDaReserva()) break;
      const nome = ent.nome.replace(/\\/g, '/');
      const m = /^arquivos\/(trilhas|uploads)\/([^/]+)$/.exec(nome);
      if (!m) continue;
      const seguro = path.basename(m[2]);
      if (!seguro || seguro.startsWith('.')) continue;
      // 🛡️ v0.90.1: a biblioteca só recebe o que o programa toca de verdade —
      // a mesma régua do envio normal (EXT_UPLOAD_OK). Um "backup" preparado
      // por outra pessoa não deposita .html/.js/.exe na pasta de mídias.
      if (!EXT_UPLOAD_OK.has(path.extname(seguro).toLowerCase())) continue;
      const destino = path.join(m[1] === 'trilhas' ? TRILHAS_UP_DIR : UPLOADS_DIR, seguro);
      const teto = Math.min(MAX_SD_IMPORT_BYTES, orcamento);
      // 🛡️ v0.127.1: sai primeiro num nome provisório — um arquivo que
      // estourou o teto ou veio corrompido não fica pela metade na biblioteca
      const provisorio = destino + '.parcial-' + Date.now().toString(36);
      if (await zipMaterializar(fd, 0, ent, tam, provisorio, teto)) {
        try { fs.renameSync(provisorio, destino); } catch { try { fs.unlinkSync(provisorio); } catch {} continue; }
        arquivos++;
        cabem--;
        try { orcamento -= fs.statSync(destino).size; } catch { orcamento -= ent.tamOrig || 0; }
      } else {
        try { fs.unlinkSync(provisorio); } catch {}
      }
    }
    const r = mesaAplicarManifesto(bruto);
    return r.ok ? { ...r, origem: 'mesa-total', arquivos } : r;
  } finally {
    if (fd !== null) { try { fs.closeSync(fd); } catch {} }
  }
}

// ===========================================================================
// 🎬 OBS Studio pelo painel (Labs) — cliente do obs-websocket v5, que já vem
// embutido no OBS 28+ (Ferramentas → Configurações do Servidor WebSocket).
// Conversa 100% local: nada disso passa pela internet. A senha do OBS mora
// SÓ em data/obs.json e nunca é enviada às telas.
// ===========================================================================
// Aceita IP (v4/v6) ou nome de máquina; tira "ws://", barras e espaços que a
// pessoa possa colar sem querer. Vazio = o computador onde o programa roda.
function hostDoObs(valor) {
  let v = String(valor || '').trim();
  if (!v) return '127.0.0.1';
  v = v.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  // "192.168.0.5:4455" colado inteiro: a porta tem campo próprio
  const m = v.match(/^\[([^\]]+)\](?::\d+)?$/); // [::1]:4455
  if (m) v = m[1];
  else if (/^[^:]+:\d+$/.test(v)) v = v.split(':')[0];
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(v)) return '127.0.0.1';
  return v;
}

function loadObsConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(OBS_FILE, 'utf8'));
    return {
      // 🌐 v0.53: o OBS pode estar em OUTRO computador da rede — o endereço
      // faz parte da configuração (antes era 127.0.0.1 na marra)
      host: hostDoObs(raw.host),
      port: Math.round(numeroEntre(raw.port, 1, 65535, 4455)),
      // 🔑 v0.90: no disco a senha vai cifrada (texto puro antigo passa direto)
      password: typeof raw.password === 'string' ? abrirSegredo(raw.password).slice(0, 200) : '',
    };
  } catch { return { host: '127.0.0.1', port: 4455, password: '' }; }
}
const obsConfig = loadObsConfig();
function saveObsConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    gravarPrivado(OBS_FILE, JSON.stringify({ ...obsConfig, password: guardarSegredo(obsConfig.password) }, null, 2));
  } catch (err) { console.error('Não consegui salvar a configuração do OBS:', err.message); }
}
// 🔑 v0.90: quem chegou de versões antigas tem segredos em texto puro nos
// JSONs de data/ — a primeira subida regrava tudo já cifrado
try {
  if (obsConfig.password) saveObsConfig();
  if (pixConfig.clientSecret || pixConfig.certSenha) savePixConfig();
  if (Object.values(state.connections || {}).some((c) => c && typeof c === 'object' && c.token)) persistConnections();
} catch { /* sem drama: a próxima gravação normal cifra */ }

// Estado vivo da conexão com o OBS (o que as telas veem — sem senha)
const obsRt = {
  ws: null,             // a conexão em si
  pedidos: new Map(),   // requestId -> { resolve, timer }
  timerReconectar: null,
  seq: 0,
  conectado: false,
  erro: null,           // texto amigável do último problema
  versao: null,
  recursos: [],         // availableRequests do OBS: o que ESTA versão sabe fazer
  estudio: false,
  cenas: [],            // [{ nome }] na ordem do OBS (a de cima primeiro)
  cenaPrograma: null,
  cenaPreview: null,
  transmitindo: false,
  gravando: false,
  gravandoPausado: false,
  camVirtual: false,    // câmera virtual ligada
  replay: false,        // replay buffer ligado
  colecoes: [], colecaoAtual: null,
  perfis: [], perfilAtual: null,
  transicoes: [],       // [{ nome }]
  transicaoAtual: null, transicaoDuracao: null, transicaoFixa: false,
  fontesAudio: [],      // [{ nome, mudo, db }] — só fontes com áudio
  itens: [],            // [{ cena, nome, id, ligado }] — visibilidade das fontes
  midias: [],           // [{ nome, estado }] — fontes de mídia (vídeo/VLC)
  filtros: [],          // [{ fonte, nome, ligado }]
  atalhos: [],          // ⌨️ v0.83: nomes dos atalhos do OBS (GetHotkeyList)
  stats: null,          // 📊 v0.83: saúde do OBS (fps, cpu, disco, quadros, tempos)
};

function obsResumo() {
  return {
    ligado: state.settings.labs?.obs === true,
    conectado: obsRt.conectado,
    erro: obsRt.erro,
    versao: obsRt.versao,
    // Em vez dos ~400 nomes de pedidos (que iam para todas as telas a cada
    // atualização), só o que as telas realmente perguntam
    podeFazer: {
      capitulo: obsTem('CreateRecordChapter'),
      camVirtual: obsTem('ToggleVirtualCam'),
      replay: obsTem('ToggleReplayBuffer'),
      captura: obsTem('GetSourceScreenshot'),
      midia: obsTem('TriggerMediaInputAction'),
      atalhos: obsTem('TriggerHotkeyByName'), // ⌨️ v0.83
    },
    host: obsConfig.host,
    porta: obsConfig.port,
    senhaDefinida: !!obsConfig.password,
    estudio: obsRt.estudio,
    cenas: obsRt.cenas,
    cenaPrograma: obsRt.cenaPrograma,
    cenaPreview: obsRt.cenaPreview,
    transmitindo: obsRt.transmitindo,
    gravando: obsRt.gravando,
    gravandoPausado: obsRt.gravandoPausado,
    camVirtual: obsRt.camVirtual,
    replay: obsRt.replay,
    colecoes: obsRt.colecoes,
    colecaoAtual: obsRt.colecaoAtual,
    perfis: obsRt.perfis,
    perfilAtual: obsRt.perfilAtual,
    transicoes: obsRt.transicoes,
    transicaoAtual: obsRt.transicaoAtual,
    transicaoDuracao: obsRt.transicaoDuracao,
    transicaoFixa: obsRt.transicaoFixa,
    fontesAudio: obsRt.fontesAudio,
    itens: obsRt.itens,
    midias: obsRt.midias,
    filtros: obsRt.filtros,
    atalhos: obsRt.atalhos, // ⌨️ v0.83
    stats: obsRt.stats,     // 📊 v0.83
  };
}
// Arrastar UM fader no OBS dispara dezenas de eventos por segundo. Sem uma
// contenção, cada um deles redesenharia a ferramenta 🎬 e a Mesa inteira em
// todos os painéis abertos. Uma foto a cada 100ms é mais que suficiente para
// o olho — e o primeiro aviso sai na hora, sem atraso perceptível.
let obsAvisoTimer = null;
let obsAvisoUltimo = 0;
function broadcastObs() {
  if (obsAvisoTimer) return; // já tem uma foto a caminho
  const desde = Date.now() - obsAvisoUltimo;
  if (desde >= 100) {
    obsAvisoUltimo = Date.now();
    broadcast({ type: 'obs', obs: obsResumo() });
    return;
  }
  obsAvisoTimer = setTimeout(() => {
    obsAvisoTimer = null;
    obsAvisoUltimo = Date.now();
    broadcast({ type: 'obs', obs: obsResumo() });
  }, 100 - desde);
  if (obsAvisoTimer.unref) obsAvisoTimer.unref();
}

function obsAuthString(password, salt, challenge) {
  const secreto = crypto.createHash('sha256').update(password + salt).digest('base64');
  return crypto.createHash('sha256').update(secreto + challenge).digest('base64');
}

// Um pedido ao OBS; devolve responseData (ou null em erro/timeout — a tela
// sempre recebe o estado novo pelos eventos, então erro aqui não trava nada)
function obsPedir(tipo, dados) {
  return new Promise((resolve) => {
    if (!obsRt.ws || obsRt.ws.readyState !== 1 || !obsRt.conectado) return resolve(null);
    const id = 'p' + (++obsRt.seq);
    const timer = setTimeout(() => { obsRt.pedidos.delete(id); resolve(null); }, 5000);
    obsRt.pedidos.set(id, { resolve, timer });
    try {
      obsRt.ws.send(JSON.stringify({ op: 6, d: { requestType: tipo, requestId: id, ...(dados ? { requestData: dados } : {}) } }));
    } catch { clearTimeout(timer); obsRt.pedidos.delete(id); resolve(null); }
  });
}

// O OBS diz o que ELE sabe fazer (availableRequests): recurso que a versão
// instalada não tem simplesmente não aparece como botão, em vez de dar erro
function obsTem(pedido) {
  return !obsRt.recursos.length || obsRt.recursos.includes(pedido);
}

// Roda a mesma pergunta para uma lista, em lotes — cem perguntinhas de uma vez
// entopem a fila do OBS; oito por vez é rápido e educado
async function obsEmLotes(itens, fn, lote = 8) {
  const saida = [];
  for (let i = 0; i < itens.length; i += lote) {
    saida.push(...await Promise.all(itens.slice(i, i + lote).map(fn)));
  }
  return saida;
}

// Só a parte que muda toda hora (estado dos botões), sem varrer o OBS inteiro
async function obsAtualizarEstado() {
  if (!obsRt.conectado) return;
  const [estudio, stream, grav, cam, replay] = await Promise.all([
    obsPedir('GetStudioModeEnabled'),
    obsPedir('GetStreamStatus'),
    obsPedir('GetRecordStatus'),
    obsTem('GetVirtualCamStatus') ? obsPedir('GetVirtualCamStatus') : null,
    obsTem('GetReplayBufferStatus') ? obsPedir('GetReplayBufferStatus') : null,
  ]);
  if (estudio) obsRt.estudio = estudio.studioModeEnabled === true;
  if (stream) obsRt.transmitindo = stream.outputActive === true;
  if (grav) {
    obsRt.gravando = grav.outputActive === true;
    obsRt.gravandoPausado = grav.outputPaused === true;
  }
  if (cam) obsRt.camVirtual = cam.outputActive === true;
  if (replay) obsRt.replay = replay.outputActive === true;
}

// Busca o retrato inteiro do OBS: tudo o que vira botão ou seletor por aqui
async function obsAtualizarTudo() {
  if (!obsRt.conectado) return;
  const versao = await obsPedir('GetVersion');
  if (versao) {
    obsRt.versao = String(versao.obsVersion || '');
    obsRt.recursos = (Array.isArray(versao.availableRequests) ? versao.availableRequests : [])
      .map((x) => String(x)).slice(0, 400);
  }
  const [cenas, colecoes, perfis, trans, transAtual] = await Promise.all([
    obsPedir('GetSceneList'),
    obsPedir('GetSceneCollectionList'),
    obsPedir('GetProfileList'),
    obsPedir('GetSceneTransitionList'),
    obsPedir('GetCurrentSceneTransition'),
  ]);
  if (cenas) {
    // O OBS devolve a lista de baixo para cima; invertida, fica igual à tela dele
    obsRt.cenas = (Array.isArray(cenas.scenes) ? cenas.scenes : [])
      .slice().sort((a, b) => (b.sceneIndex ?? 0) - (a.sceneIndex ?? 0))
      .map((s) => ({ nome: String(s.sceneName || '') })).slice(0, 100);
    obsRt.cenaPrograma = String(cenas.currentProgramSceneName || '') || null;
    obsRt.cenaPreview = String(cenas.currentPreviewSceneName || '') || null;
  }
  if (colecoes) {
    obsRt.colecoes = (Array.isArray(colecoes.sceneCollections) ? colecoes.sceneCollections : [])
      .map((c) => String(c)).slice(0, 60);
    obsRt.colecaoAtual = String(colecoes.currentSceneCollectionName || '') || null;
  }
  if (perfis) {
    obsRt.perfis = (Array.isArray(perfis.profiles) ? perfis.profiles : []).map((p) => String(p)).slice(0, 60);
    obsRt.perfilAtual = String(perfis.currentProfileName || '') || null;
  }
  if (trans) {
    obsRt.transicoes = (Array.isArray(trans.transitions) ? trans.transitions : [])
      .map((t) => ({ nome: String(t.transitionName || '') })).filter((t) => t.nome).slice(0, 40);
  }
  if (transAtual) {
    obsRt.transicaoAtual = String(transAtual.transitionName || '') || null;
    obsRt.transicaoFixa = transAtual.transitionFixed === true;
    obsRt.transicaoDuracao = Number.isFinite(Number(transAtual.transitionDuration))
      ? Math.round(Number(transAtual.transitionDuration)) : null;
  }
  await obsAtualizarEstado();

  // Entradas: quem tem áudio (mudo + volume), quem é mídia (play/pause) e os
  // filtros de cada uma. Quem não tem áudio responde erro e fica de fora —
  // é assim que o protocolo separa as coisas, sem lista de tipos chumbada.
  const lista = await obsPedir('GetInputList');
  const entradas = (Array.isArray(lista?.inputs) ? lista.inputs : [])
    .map((i) => String(i.inputName || '')).filter(Boolean).slice(0, 60);
  const audio = [], midias = [];
  await obsEmLotes(entradas, async (nome) => {
    const [mudo, vol, mid] = await Promise.all([
      obsPedir('GetInputMute', { inputName: nome }),
      obsPedir('GetInputVolume', { inputName: nome }),
      obsTem('GetMediaInputStatus') ? obsPedir('GetMediaInputStatus', { inputName: nome }) : null,
    ]);
    if (mudo && typeof mudo.inputMuted === 'boolean') {
      const db = Number(vol?.inputVolumeDb);
      audio.push({ nome, mudo: mudo.inputMuted, db: Number.isFinite(db) ? Math.round(db * 10) / 10 : null });
    }
    // Quem NÃO é fonte de mídia responde erro (mid === null) e fica de fora.
    // Quem é, entra mesmo com o estado NONE (vídeo parado, playlist no fim):
    // filtrar por NONE fazia a fonte sumir do painel e não voltar mais.
    if (mid && typeof mid.mediaState === 'string') {
      midias.push({ nome, estado: String(mid.mediaState).replace('OBS_MEDIA_STATE_', '').toLowerCase() });
    }
  });
  // Ordem estável: os lotes terminam fora de ordem, e uma lista que dança
  // sozinha faria os botões piscarem de lugar a cada atualização
  const ordem = (a, b) => entradas.indexOf(a.nome) - entradas.indexOf(b.nome);
  obsRt.fontesAudio = audio.sort(ordem);
  obsRt.midias = midias.sort(ordem);

  // Fontes dentro de cada cena (a visibilidade do 👁) — o mesmo nome pode
  // aparecer em várias cenas, e cada aparição tem o seu próprio olho
  const itens = [];
  await obsEmLotes(obsRt.cenas.slice(0, 40), async (c) => {
    const r = await obsPedir('GetSceneItemList', { sceneName: c.nome });
    for (const it of (Array.isArray(r?.sceneItems) ? r.sceneItems : []).slice(0, 60)) {
      itens.push({
        cena: c.nome,
        nome: String(it.sourceName || ''),
        id: Math.floor(Number(it.sceneItemId) || 0),
        ligado: it.sceneItemEnabled === true,
      });
    }
  });
  // Ordem estável (os lotes terminam fora de ordem): cena por cena, na ordem
  // do OBS — assim a lista não dança a cada atualização. A cena que está NO AR
  // vem primeiro: com muitas cenas, o teto de 600 cortaria justamente o bloco
  // 👁 que o painel mostra.
  const posCena = (nome) => (nome === obsRt.cenaPrograma ? -1 : obsRt.cenas.findIndex((c) => c.nome === nome));
  obsRt.itens = itens.filter((i) => i.nome)
    .sort((a, b) => posCena(a.cena) - posCena(b.cena)).slice(0, 600);

  // Filtros: valem tanto para entradas quanto para cenas
  const filtros = [];
  const alvos = entradas.concat(obsRt.cenas.map((c) => c.nome)).slice(0, 100);
  await obsEmLotes(alvos, async (fonte) => {
    const r = await obsPedir('GetSourceFilterList', { sourceName: fonte });
    for (const f of (Array.isArray(r?.filters) ? r.filters : []).slice(0, 30)) {
      filtros.push({ fonte, nome: String(f.filterName || ''), ligado: f.filterEnabled === true });
    }
  });
  obsRt.filtros = filtros.filter((f) => f.nome)
    .sort((a, b) => alvos.indexOf(a.fonte) - alvos.indexOf(b.fonte)).slice(0, 300);

  // ⌨️ v0.83: a lista de atalhos do OBS — QUALQUER coisa que tenha atalho lá
  // (inclusive de plugins) vira acionável pelo painel e pela Mesa
  if (obsTem('GetHotkeyList')) {
    const atalhos = await obsPedir('GetHotkeyList');
    if (atalhos) {
      obsRt.atalhos = (Array.isArray(atalhos.hotkeys) ? atalhos.hotkeys : [])
        .map((x) => String(x)).filter(Boolean).slice(0, 300);
    }
  }
  broadcastObs();
}

// 📊 v0.83: saúde do OBS de tempos em tempos — fps, CPU, memória, disco,
// quadros perdidos e há quanto tempo transmite/grava. É o que o rodapé do
// próprio OBS mostra, agora no painel (e em qualquer aparelho da rede).
async function obsAtualizarStats() {
  if (!obsRt.conectado) return;
  const [st, stream, grav] = await Promise.all([
    obsTem('GetStats') ? obsPedir('GetStats') : null,
    obsPedir('GetStreamStatus'),
    obsPedir('GetRecordStatus'),
  ]);
  if (!obsRt.conectado) return; // caiu no meio da pergunta
  const novo = obsRt.stats && typeof obsRt.stats === 'object' ? { ...obsRt.stats } : {};
  if (st) {
    novo.fps = Math.round((Number(st.activeFps) || 0) * 10) / 10;
    novo.cpu = Math.round((Number(st.cpuUsage) || 0) * 10) / 10;
    novo.memoriaMB = Math.round(Number(st.memoryUsage) || 0);
    novo.discoLivreGB = Math.round((Number(st.availableDiskSpace) || 0) / 1024 * 10) / 10;
    novo.quadrosPerdidosRender = Math.floor(Number(st.renderSkippedFrames) || 0);
    novo.quadrosPerdidosSaida = Math.floor(Number(st.outputSkippedFrames) || 0);
  }
  if (stream) {
    obsRt.transmitindo = stream.outputActive === true;
    novo.tempoTransmissao = obsRt.transmitindo
      ? (String(stream.outputTimecode || '').split('.')[0] || null) : null;
    novo.quadrosPerdidosRede = Math.floor(Number(stream.outputSkippedFrames) || 0);
  }
  if (grav) {
    obsRt.gravando = grav.outputActive === true;
    obsRt.gravandoPausado = grav.outputPaused === true;
    novo.tempoGravacao = obsRt.gravando
      ? (String(grav.outputTimecode || '').split('.')[0] || null) : null;
  }
  obsRt.stats = novo;
  broadcastObs();
}
const obsStatsTimer = setInterval(() => {
  if (state.settings.labs?.obs === true && obsRt.conectado) obsAtualizarStats().catch(() => {});
}, 2000);
if (obsStatsTimer.unref) obsStatsTimer.unref();

function obsAviso(ok, texto) { broadcast({ type: 'obsAviso', ok: !!ok, texto: String(texto || '') }); }

const OBS_MEDIA_ACAO = {
  tocar: 'PLAY', pausar: 'PAUSE', parar: 'STOP',
  recomecar: 'RESTART', proxima: 'NEXT', anterior: 'PREVIOUS',
};

// 📸 Print de uma cena/fonte do OBS. Como o OBS pode estar em OUTRA máquina,
// nada de pedir para ele salvar no disco dele: a imagem vem pela conexão e
// entra nas mídias do programa, prontinha para virar overlay.
// ⚠️ Um print é uma FOTO DA TELA: pode pegar uma cena que não está no ar, a
// captura do desktop inteiro, uma janela de e-mail. Por isso o print grava
// arquivo e, para quem vem da rede, tem regra mais dura (ver 'captura' no
// despachante). Aqui ficam os freios que valem para todo mundo.
const PRINT_INTERVALO_MS = 3000;   // no mínimo 3s entre prints
const PRINT_MAX_ARQUIVOS = 60;     // prints guardados (o mais velho sai)
let printUltimo = 0;
function podarPrints() {
  try {
    const meus = fs.readdirSync(UPLOADS_DIR)
      .filter((n) => /^obs-.*\.png$/.test(n))
      .map((n) => ({ n, t: fs.statSync(path.join(UPLOADS_DIR, n)).mtimeMs }))
      .sort((a, b) => a.t - b.t);
    for (const velho of meus.slice(0, Math.max(0, meus.length - PRINT_MAX_ARQUIVOS))) {
      fs.unlinkSync(path.join(UPLOADS_DIR, velho.n));
    }
  } catch {}
}
async function obsCapturar(fonte) {
  const alvo = fonte || obsRt.cenaPrograma;
  if (!alvo) { obsAviso(false, 'não sei o que capturar: o OBS não tem cena no ar'); return; }
  // Sem freio, um laço de prints vira gravação de tela e enche o disco
  if (Date.now() - printUltimo < PRINT_INTERVALO_MS) {
    obsAviso(false, 'espere alguns segundos entre um print e outro');
    return;
  }
  printUltimo = Date.now();
  const r = await obsPedir('GetSourceScreenshot', { sourceName: alvo, imageFormat: 'png', imageWidth: 1920 });
  const dados = String(r?.imageData || '');
  const m = dados.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!m) { obsAviso(false, 'o OBS não conseguiu fazer o print de "' + alvo + '"'); return; }
  const bytes = Buffer.from(m[1], 'base64');
  if (!bytes.length || bytes.length > 40 * 1024 * 1024) { obsAviso(false, 'print vazio ou grande demais'); return; }
  const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const limpo = alvo.replace(/[^\w\-() À-ÿ]+/g, '_').slice(0, 40);
  const nome = `obs-${limpo}-${carimbo}.png`;
  try {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOADS_DIR, nome), bytes);
  } catch (err) {
    // A mensagem crua do sistema traz o caminho inteiro do disco do streamer,
    // e ela vai para TODAS as telas: fica só o motivo, no registro do dono
    console.error('Não consegui salvar o print do OBS:', err.message);
    obsAviso(false, 'não consegui salvar o print (veja a janela preta do programa)');
    return;
  }
  podarPrints();
  broadcast({ type: 'media', media: listMedia() });
  obsAviso(true, 'print salvo nas mídias: ' + nome);
}

// Quem está pedindo a ação: o despachante precisa saber se veio da máquina
// local (o dono) ou de alguém da rede no modo restrito
function quemPediu(ws) {
  return {
    daRede: !!(ws && ws.role === 'viewer'),
    podeMidia: security.permissions.media === true,
  };
}

// O despachante: uma ação, um alvo já limpo. Devolve quando o OBS respondeu.
async function obsExecutarAcao(acao, alvo, quem) {
  if (state.settings.labs?.obs !== true) return;
  if (!obsRt.conectado) {
    // Antes isso era um silêncio total: a tecla piscava e nada acontecia
    obsAviso(false, obsRt.erro
      ? 'o OBS não está conectado: ' + obsRt.erro
      : 'o OBS não está conectado — confira o card 🎬 em Configurações → 🧪 Labs');
    return;
  }
  const a = alvo || {};
  // Alternar é LER e depois ESCREVER: dois cliques rápidos na mesma tecla
  // leriam o mesmo estado e mandariam a mesma coisa duas vezes (o segundo
  // clique não desfaria o primeiro). Enquanto uma alternância do mesmo alvo
  // está em andamento, a próxima espera a vez.
  const chaveAlvo = acao + '|' + (a.cena || '') + '|' + (a.fonte || '') + '|' + (a.filtro || '') + '|' + (a.id || '');
  if (a.modo === 'alternar' && obsAlternando.has(chaveAlvo)) return;
  if (a.modo === 'alternar') obsAlternando.add(chaveAlvo);
  try {
    return await obsAcaoInterna(acao, a, quem);
  } finally {
    obsAlternando.delete(chaveAlvo);
  }
}
const obsAlternando = new Set();

// O corpo de verdade da ação (o de cima só cuida da vez de cada alternância)
async function obsAcaoInterna(acao, a, quem) {
  // 📸 O print vira ARQUIVO no computador e pode fotografar qualquer fonte do
  // OBS — inclusive uma captura do desktop inteiro. Quem entra pela rede no
  // modo restrito só tira print se o seletor 🖼️ das mídias também estiver
  // liberado, e mesmo assim só da cena que está NO AR.
  if (acao === 'captura' && quem && quem.daRede) {
    if (!quem.podeMidia) {
      obsAviso(false, 'o print está desligado para quem entra pela rede (libere 🖼️ em 🔒 Segurança)');
      return;
    }
    a.fonte = '';
  }
  switch (acao) {
    case 'gravar':
      await obsPedir(a.modo === 'iniciar' ? 'StartRecord' : a.modo === 'parar' ? 'StopRecord' : 'ToggleRecord');
      break;
    case 'gravarPausa':
      // Só faz sentido gravando; fora disso o OBS responde erro e nada muda
      await obsPedir(a.modo === 'pausar' ? 'PauseRecord' : a.modo === 'continuar' ? 'ResumeRecord' : 'ToggleRecordPause');
      break;
    case 'capitulo':
      if (!obsTem('CreateRecordChapter')) { obsAviso(false, 'marcador de capítulo pede OBS 30.2 ou mais novo'); return; }
      await obsPedir('CreateRecordChapter', a.texto ? { chapterName: a.texto } : undefined);
      break;
    case 'transmitir':
      await obsPedir(a.modo === 'iniciar' ? 'StartStream' : a.modo === 'parar' ? 'StopStream' : 'ToggleStream');
      break;
    case 'camVirtual':
      await obsPedir(a.modo === 'iniciar' ? 'StartVirtualCam' : a.modo === 'parar' ? 'StopVirtualCam' : 'ToggleVirtualCam');
      break;
    case 'replay':
      await obsPedir(a.modo === 'iniciar' ? 'StartReplayBuffer' : a.modo === 'parar' ? 'StopReplayBuffer' : 'ToggleReplayBuffer');
      break;
    case 'salvarReplay': {
      if (!obsRt.replay) { obsAviso(false, 'o replay buffer está desligado — ligue antes de salvar'); return; }
      // obsPedir devolve null quando o OBS recusa: anunciar "salvo" sem
      // conferir era mentira na cara do streamer
      const salvou = await obsPedir('SaveReplayBuffer');
      obsAviso(!!salvou, salvou ? 'replay salvo pelo OBS' : 'o OBS não conseguiu salvar o replay');
      break;
    }
    case 'captura':
      await obsCapturar(a.fonte);
      return; // o próprio capturar já avisa
    case 'colecao':
      if (!a.nome) return;
      await obsPedir('SetCurrentSceneCollection', { sceneCollectionName: a.nome });
      break;
    case 'perfil':
      if (!a.nome) return;
      await obsPedir('SetCurrentProfile', { profileName: a.nome });
      break;
    case 'cena': {
      if (!a.nome) return;
      // 'auto' = do jeito que o OBS está: com modo estúdio ligado a tecla
      // escolhe o PREVIEW (como no OBS de verdade), senão vai direto ao ar
      const preview = a.modo === 'preview' || (a.modo !== 'programa' && obsRt.estudio);
      if (preview && !obsRt.estudio) { obsAviso(false, 'o preview só existe com o modo estúdio ligado'); return; }
      await obsPedir(preview ? 'SetCurrentPreviewScene' : 'SetCurrentProgramScene', { sceneName: a.nome });
      break;
    }
    case 'estudio': {
      // Não existe ToggleStudioMode no protocolo: lê, inverte e manda
      const quer = a.modo === 'ligar' ? true : a.modo === 'desligar' ? false : !obsRt.estudio;
      await obsPedir('SetStudioModeEnabled', { studioModeEnabled: quer });
      break;
    }
    case 'transicaoEstudio':
      if (!obsRt.estudio) { obsAviso(false, 'a transição de estúdio pede o modo estúdio ligado'); return; }
      await obsPedir('TriggerStudioModeTransition');
      break;
    case 'transicao':
      if (a.nome) await obsPedir('SetCurrentSceneTransition', { transitionName: a.nome });
      if (a.duracao > 0) await obsPedir('SetCurrentSceneTransitionDuration', { transitionDuration: Math.max(50, a.duracao) });
      break;
    case 'transicaoCena': {
      if (!a.cena) return;
      const p = { sceneName: a.cena };
      // Sem nome = TIRA o atalho daquela cena (null explícito é o "remover")
      p.transitionName = a.nome || null;
      if (a.duracao > 0) p.transitionDuration = Math.max(50, a.duracao);
      await obsPedir('SetSceneSceneTransitionOverride', p);
      break;
    }
    case 'fonte': {
      const cena = a.cena || obsRt.cenaPrograma;
      if (!cena || !a.fonte) return;
      // A MESMA fonte pode estar duas vezes na cena (dois olhos separados no
      // OBS). Quando a tela manda o número do item, é ele que manda; só sem
      // ele é que vale a primeira aparição com aquele nome.
      const achado = a.id
        ? obsRt.itens.find((i) => i.cena === cena && i.id === a.id)
        : obsRt.itens.find((i) => i.cena === cena && i.nome === a.fonte);
      let id = achado ? achado.id : 0;
      if (!id) {
        const r = await obsPedir('GetSceneItemId', { sceneName: cena, sourceName: a.fonte });
        id = Math.floor(Number(r?.sceneItemId) || 0);
      }
      if (!id) { obsAviso(false, `não achei "${a.fonte}" na cena "${cena}"`); return; }
      // Não existe toggle de visibilidade: lê o estado de agora e inverte
      let quer;
      if (a.modo === 'mostrar') quer = true;
      else if (a.modo === 'esconder') quer = false;
      else {
        const atual = await obsPedir('GetSceneItemEnabled', { sceneName: cena, sceneItemId: id });
        quer = !(atual && atual.sceneItemEnabled === true);
      }
      await obsPedir('SetSceneItemEnabled', { sceneName: cena, sceneItemId: id, sceneItemEnabled: quer });
      break;
    }
    case 'filtro': {
      if (!a.fonte || !a.filtro) return;
      let quer;
      if (a.modo === 'ligar') quer = true;
      else if (a.modo === 'desligar') quer = false;
      else {
        const atual = await obsPedir('GetSourceFilter', { sourceName: a.fonte, filterName: a.filtro });
        if (!atual) { obsAviso(false, `não achei o filtro "${a.filtro}" em "${a.fonte}"`); return; }
        quer = !(atual.filterEnabled === true);
      }
      await obsPedir('SetSourceFilterEnabled', { sourceName: a.fonte, filterName: a.filtro, filterEnabled: quer });
      break;
    }
    case 'audioMudo': {
      if (!a.fonte) return;
      if (a.modo === 'alternar') await obsPedir('ToggleInputMute', { inputName: a.fonte });
      else await obsPedir('SetInputMute', { inputName: a.fonte, inputMuted: a.modo === 'mudo' });
      break;
    }
    case 'audioVolume': {
      if (!a.fonte) return;
      let db = a.db;
      if (a.modo === 'ajustar') {
        // Não existe "somar volume" no protocolo: lê, soma e manda o total
        const atual = await obsPedir('GetInputVolume', { inputName: a.fonte });
        const base = Number(atual?.inputVolumeDb);
        if (!Number.isFinite(base)) { obsAviso(false, `não consegui ler o volume de "${a.fonte}"`); return; }
        db = base + a.db;
      }
      db = Math.max(-100, Math.min(26, Math.round(db * 10) / 10));
      await obsPedir('SetInputVolume', { inputName: a.fonte, inputVolumeDb: db });
      break;
    }
    case 'midia': {
      if (!a.fonte) return;
      let modo = a.modo;
      if (modo === 'alternar') {
        // ▶/⏸ no mesmo botão, como no controle de mídia do Stream Deck
        const st = await obsPedir('GetMediaInputStatus', { inputName: a.fonte });
        modo = String(st?.mediaState || '') === 'OBS_MEDIA_STATE_PLAYING' ? 'pausar' : 'tocar';
      }
      const nome = OBS_MEDIA_ACAO[modo];
      if (!nome) return;
      await obsPedir('TriggerMediaInputAction', {
        inputName: a.fonte,
        mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_' + nome,
      });
      break;
    }
    case 'atalho': {
      // ⌨️ v0.83: dispara um atalho do OBS pelo nome — o coringa que cobre
      // tudo o que ainda não tem botão próprio (inclusive coisas de plugin)
      if (!a.nome) return;
      if (!obsTem('TriggerHotkeyByName')) { obsAviso(false, 'esta versão do OBS não dispara atalhos por nome'); return; }
      await obsPedir('TriggerHotkeyByName', { hotkeyName: a.nome });
      break;
    }
    default: return;
  }
  // Nem toda ação tem evento de volta (marcador de capítulo, print, mídia sem
  // fonte tocando): uma conferida rápida deixa os botões honestos
  await obsAtualizarEstado();
  broadcastObs();
}

// Trocar de coleção de cenas dispara uma saraivada de eventos; varrer o OBS
// inteiro a cada um seria desperdício. Junta tudo numa varredura só.
let obsVarrerTimer = null;
function obsVarrerLogo() {
  if (obsVarrerTimer) return;
  obsVarrerTimer = setTimeout(() => {
    obsVarrerTimer = null;
    obsAtualizarTudo();
  }, 350);
  if (obsVarrerTimer.unref) obsVarrerTimer.unref();
}

function obsTrataEvento(ev, dados) {
  switch (ev) {
    case 'CurrentProgramSceneChanged': obsRt.cenaPrograma = String(dados.sceneName || '') || null; break;
    case 'CurrentPreviewSceneChanged': obsRt.cenaPreview = String(dados.sceneName || '') || null; break;
    case 'StudioModeStateChanged':
      obsRt.estudio = dados.studioModeEnabled === true;
      if (!obsRt.estudio) obsRt.cenaPreview = null;
      break;
    case 'StreamStateChanged': obsRt.transmitindo = dados.outputActive === true; break;
    case 'RecordStateChanged':
      obsRt.gravando = dados.outputActive === true;
      // O OBS avisa a pausa pelo MESMO evento, no campo outputState
      if (dados.outputState === 'OBS_WEBSOCKET_OUTPUT_PAUSED') obsRt.gravandoPausado = true;
      else if (dados.outputState === 'OBS_WEBSOCKET_OUTPUT_RESUMED') obsRt.gravandoPausado = false;
      else if (!obsRt.gravando) obsRt.gravandoPausado = false;
      break;
    case 'VirtualcamStateChanged': obsRt.camVirtual = dados.outputActive === true; break;
    case 'ReplayBufferStateChanged': obsRt.replay = dados.outputActive === true; break;
    case 'CurrentSceneTransitionChanged':
      obsRt.transicaoAtual = String(dados.transitionName || '') || null;
      // Cada transição tem a SUA duração (e algumas são de duração fixa):
      // sem reler, o campo de ms mostraria o número da transição anterior
      obsPedir('GetCurrentSceneTransition').then((r) => {
        if (!r) return;
        obsRt.transicaoFixa = r.transitionFixed === true;
        obsRt.transicaoDuracao = Number.isFinite(Number(r.transitionDuration))
          ? Math.round(Number(r.transitionDuration)) : null;
        broadcastObs();
      });
      break;
    case 'CurrentSceneTransitionDurationChanged':
      obsRt.transicaoDuracao = Number.isFinite(Number(dados.transitionDuration))
        ? Math.round(Number(dados.transitionDuration)) : null;
      break;
    case 'CurrentProfileChanged': obsRt.perfilAtual = String(dados.profileName || '') || null; break;
    case 'InputMuteStateChanged': {
      const f = obsRt.fontesAudio.find((x) => x.nome === String(dados.inputName || ''));
      if (f) f.mudo = dados.inputMuted === true;
      break;
    }
    case 'InputVolumeChanged': {
      const f = obsRt.fontesAudio.find((x) => x.nome === String(dados.inputName || ''));
      const db = Number(dados.inputVolumeDb);
      if (f && Number.isFinite(db)) f.db = Math.round(db * 10) / 10;
      break;
    }
    case 'SceneItemEnableStateChanged': {
      const i = obsRt.itens.find((x) => x.cena === String(dados.sceneName || '')
        && x.id === Math.floor(Number(dados.sceneItemId) || 0));
      if (i) i.ligado = dados.sceneItemEnabled === true;
      break;
    }
    case 'SourceFilterEnableStateChanged': {
      const f = obsRt.filtros.find((x) => x.fonte === String(dados.sourceName || '')
        && x.nome === String(dados.filterName || ''));
      if (f) f.ligado = dados.filterEnabled === true;
      break;
    }
    case 'MediaInputPlaybackStarted': case 'MediaInputPlaybackEnded':
    case 'MediaInputActionTriggered': {
      const nome = String(dados.inputName || '');
      const m = obsRt.midias.find((x) => x.nome === nome);
      if (!m) break;
      // O estado exato vem do OBS, não de adivinhação: pergunta e avisa
      obsPedir('GetMediaInputStatus', { inputName: nome }).then((r) => {
        if (!r || typeof r.mediaState !== 'string') return;
        const novo = r.mediaState.replace('OBS_MEDIA_STATE_', '').toLowerCase();
        if (m.estado === novo) return;
        m.estado = novo;
        broadcastObs();
      });
      break;
    }
    case 'CurrentSceneCollectionChanging':
      // A coleção vai trocar: o que está na tela deixa de existir agora mesmo
      obsRt.cenas = []; obsRt.itens = []; obsRt.filtros = [];
      obsRt.fontesAudio = []; obsRt.midias = [];
      break;
    case 'CurrentSceneCollectionChanged': case 'SceneCollectionListChanged':
    case 'ProfileListChanged': case 'CurrentProfileChanging':
    case 'SceneListChanged': case 'SceneNameChanged':
    case 'SceneCreated': case 'SceneRemoved':
    case 'SceneItemCreated': case 'SceneItemRemoved': case 'SceneItemListReindexed':
    case 'SourceFilterCreated': case 'SourceFilterRemoved': case 'SourceFilterNameChanged':
    case 'InputCreated': case 'InputRemoved': case 'InputNameChanged':
      obsVarrerLogo();
      return; // a varredura já faz o broadcast
    default: return; // evento que não interessa: nem broadcast
  }
  broadcastObs();
}

function desligarObs(motivo) {
  if (obsRt.timerReconectar) { clearTimeout(obsRt.timerReconectar); obsRt.timerReconectar = null; }
  if (obsVarrerTimer) { clearTimeout(obsVarrerTimer); obsVarrerTimer = null; }
  // A foto que estava a caminho falava de um OBS que não está mais aí
  if (obsAvisoTimer) { clearTimeout(obsAvisoTimer); obsAvisoTimer = null; }
  obsAvisoUltimo = 0;
  for (const [, p] of obsRt.pedidos) { clearTimeout(p.timer); p.resolve(null); }
  obsRt.pedidos.clear();
  if (obsRt.ws) { try { obsRt.ws.close(); } catch {} try { obsRt.ws.terminate(); } catch {} obsRt.ws = null; }
  const mudou = obsRt.conectado || obsRt.erro !== (motivo || null);
  obsRt.conectado = false;
  obsRt.erro = motivo || null;
  obsRt.recursos = [];
  obsRt.cenas = []; obsRt.cenaPrograma = null; obsRt.cenaPreview = null;
  obsRt.fontesAudio = []; obsRt.transmitindo = false; obsRt.gravando = false; obsRt.estudio = false;
  obsRt.gravandoPausado = false; obsRt.camVirtual = false; obsRt.replay = false;
  obsRt.colecoes = []; obsRt.colecaoAtual = null;
  obsRt.perfis = []; obsRt.perfilAtual = null;
  obsRt.transicoes = []; obsRt.transicaoAtual = null; obsRt.transicaoDuracao = null; obsRt.transicaoFixa = false;
  obsRt.itens = []; obsRt.midias = []; obsRt.filtros = [];
  obsRt.atalhos = []; obsRt.stats = null; // ⌨️📊 v0.83
  if (mudou) broadcastObs();
}

function agendarReconexaoObs() {
  if (obsRt.timerReconectar || state.settings.labs?.obs !== true) return;
  obsRt.timerReconectar = setTimeout(() => { obsRt.timerReconectar = null; conectarObs(); }, 5000);
}

function conectarObs() {
  if (state.settings.labs?.obs !== true) { desligarObs(null); return; }
  if (obsRt.ws) return; // já conectando/conectado
  let socket;
  try {
    const alvo = obsConfig.host.includes(':') && !obsConfig.host.startsWith('[')
      ? `[${obsConfig.host}]` : obsConfig.host; // IPv6 vai entre colchetes
    socket = new WebSocket(`ws://${alvo}:${obsConfig.port}`, 'obswebsocket.json');
  } catch (err) {
    desligarObs('não consegui abrir a conexão (' + err.message + ')');
    agendarReconexaoObs();
    return;
  }
  obsRt.ws = socket;
  socket.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch { return; }
    const d = m && m.d ? m.d : {};
    if (m.op === 0) {
      // Hello: identifica (com a resposta do desafio, se o OBS tem senha)
      const ident = { rpcVersion: 1 };
      if (d.authentication) {
        if (!obsConfig.password) {
          desligarObs('o OBS pede senha — copie a senha em Ferramentas → Configurações do Servidor WebSocket');
          agendarReconexaoObs();
          return;
        }
        ident.authentication = obsAuthString(obsConfig.password, String(d.authentication.salt || ''), String(d.authentication.challenge || ''));
      }
      try { socket.send(JSON.stringify({ op: 1, d: ident })); } catch {}
    } else if (m.op === 2) {
      // Identified: conectado de verdade
      obsRt.conectado = true;
      obsRt.erro = null;
      console.log('  🎬 Conectado ao OBS Studio (' + obsConfig.host + ':' + obsConfig.port + ')');
      broadcastObs();
      obsAtualizarTudo();
    } else if (m.op === 7) {
      const p = obsRt.pedidos.get(d.requestId);
      if (p) {
        clearTimeout(p.timer);
        obsRt.pedidos.delete(d.requestId);
        p.resolve(d.requestStatus && d.requestStatus.result ? (d.responseData || {}) : null);
      }
    } else if (m.op === 5) {
      obsTrataEvento(String(d.eventType || ''), d.eventData || {});
    }
  });
  socket.on('close', (codigo) => {
    if (obsRt.ws !== socket) return;
    obsRt.ws = null;
    // Quando o OBS está em OUTRA máquina, o problema quase nunca é a senha:
    // é o firewall dela, ou o OBS sem o WebSocket ligado. A mensagem diz onde
    // procurar, com o endereço que foi tentado.
    const naRede = obsConfig.host !== '127.0.0.1' && obsConfig.host !== 'localhost' && obsConfig.host !== '::1';
    const onde = obsConfig.host + ':' + obsConfig.port;
    let motivo;
    if (codigo === 4009) motivo = 'senha do OBS errada — confira em Ferramentas → Configurações do Servidor WebSocket';
    else if (codigo === 4010) motivo = 'versão do controle remoto incompatível — atualize o OBS';
    else if (obsRt.conectado) motivo = 'o OBS fechou a conexão — ele ainda está aberto?';
    else if (obsRt.erro) motivo = obsRt.erro;
    else if (naRede) motivo = `não achei o OBS em ${onde} — confira o IP, se o OBS daquela máquina está aberto com o servidor WebSocket LIGADO, e se o firewall dela deixa a porta ${obsConfig.port} passar`;
    else motivo = `não achei o OBS em ${onde} — ele está aberto, com o servidor WebSocket ligado? (Ferramentas → Configurações do Servidor WebSocket)`;
    desligarObs(motivo);
    agendarReconexaoObs();
  });
  socket.on('error', () => { /* o close cuida do resto */ });
}

// Liga/desliga a conexão conforme o interruptor do Labs
function sincronizarObsComLabs() {
  if (state.settings.labs?.obs === true) conectarObs();
  else desligarObs(null);
  // 🎛️ v0.122: o interruptor do vMix liga/desliga a conexão dele do mesmo jeito
  if (state.settings.labs?.vmix === true) conectarVmix();
  else desligarVmix(null);
  if (state.settings.labs?.trilhas !== true) pararTrilha();
}

// ===========================================================================
// 🎛️ vMix pelo painel (Labs, v0.122) — o irmão do 🎬 OBS Studio, pela API TCP
// que o vMix já traz ligada (porta 8099, sem senha). O cliente mora em
// vmix.js; aqui fica o que é do programa: a configuração em data/vmix.json, o
// retrato que as telas veem (vmixResumo), a contenção dos avisos, a reconexão
// e o despachante das ações (as mesmas que viram tecla na Mesa de Trilhas).
// ===========================================================================
const { VmixCliente } = require('./vmix');

function loadVmixConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(VMIX_FILE, 'utf8'));
    return { host: hostDoObs(raw.host), port: Math.round(numeroEntre(raw.port, 1, 65535, 8099)) };
  } catch { return { host: '127.0.0.1', port: 8099 }; }
}
const vmixConfig = loadVmixConfig();
function saveVmixConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    gravarPrivado(VMIX_FILE, JSON.stringify(vmixConfig, null, 2));
  } catch (err) { console.error('Não consegui salvar a configuração do vMix:', err.message); }
}

// Estado vivo da conexão com o vMix (o que as telas veem)
const vmixRt = {
  cliente: null,
  timerReconectar: null,
  conectado: false,
  erro: null,
  versao: null, edicao: null, preset: null,
  entradas: [],       // [{ numero, chave, titulo, tipo, estado, temAudio, mudo, volume, campos... }]
  programa: null, preview: null,
  overlays: [],       // [{ canal, entrada }]
  transicoes: [],     // [{ numero, efeito, duracao }]
  escurecido: false,
  gravando: false, transmitindo: false, externa: false, multiCorder: false, telaCheia: false, playlist: false,
  saidas: {},         // detalhes (duração, arquivo) quando o vMix manda
  master: { volume: 100, mudo: false },
  tally: '',
  ultimoResumo: '',   // para não mandar o mesmo retrato de novo a cada leitura
};

function vmixResumo() {
  return {
    ligado: state.settings.labs?.vmix === true,
    conectado: vmixRt.conectado,
    erro: vmixRt.erro,
    host: vmixConfig.host,
    porta: vmixConfig.port,
    versao: vmixRt.versao, edicao: vmixRt.edicao, preset: vmixRt.preset,
    entradas: vmixRt.entradas,
    programa: vmixRt.programa, preview: vmixRt.preview,
    overlays: vmixRt.overlays, transicoes: vmixRt.transicoes,
    escurecido: vmixRt.escurecido,
    gravando: vmixRt.gravando, transmitindo: vmixRt.transmitindo, externa: vmixRt.externa,
    multiCorder: vmixRt.multiCorder, telaCheia: vmixRt.telaCheia, playlist: vmixRt.playlist,
    saidas: vmixRt.saidas, master: vmixRt.master, tally: vmixRt.tally,
  };
}
// A mesma contenção do OBS: no máximo uma foto a cada 100 ms para as telas
let vmixAvisoTimer = null;
let vmixAvisoUltimo = 0;
function broadcastVmix(forcar) {
  const resumo = vmixResumo();
  const chave = JSON.stringify(resumo);
  if (!forcar && chave === vmixRt.ultimoResumo) return; // nada mudou: silêncio
  vmixRt.ultimoResumo = chave;
  if (vmixAvisoTimer) return;
  const desde = Date.now() - vmixAvisoUltimo;
  if (desde >= 100) {
    vmixAvisoUltimo = Date.now();
    broadcast({ type: 'vmix', vmix: resumo });
    return;
  }
  vmixAvisoTimer = setTimeout(() => {
    vmixAvisoTimer = null;
    vmixAvisoUltimo = Date.now();
    broadcast({ type: 'vmix', vmix: vmixResumo() });
  }, 100 - desde);
  if (vmixAvisoTimer.unref) vmixAvisoTimer.unref();
}
function vmixAviso(ok, texto) { broadcast({ type: 'vmixAviso', ok: !!ok, texto: String(texto || '') }); }

// O retrato que o cliente leu do XML vira o estado vivo
function vmixAplicarRetrato(r) {
  if (!r) return;
  vmixRt.versao = r.versao || vmixRt.versao;
  vmixRt.edicao = r.edicao; vmixRt.preset = r.preset;
  vmixRt.entradas = r.entradas.slice(0, 200);
  vmixRt.programa = r.programa; vmixRt.preview = r.preview;
  vmixRt.overlays = r.overlays; vmixRt.transicoes = r.transicoes;
  vmixRt.escurecido = r.escurecido;
  vmixRt.gravando = r.gravando; vmixRt.transmitindo = r.transmitindo; vmixRt.externa = r.externa;
  vmixRt.multiCorder = r.multiCorder; vmixRt.telaCheia = r.telaCheia; vmixRt.playlist = r.playlist;
  vmixRt.saidas = r.saidas || {}; vmixRt.master = r.master || vmixRt.master;
  broadcastVmix();
}

function vmixAtualizarTudo() {
  if (!vmixRt.cliente || !vmixRt.conectado) return Promise.resolve(null);
  return vmixRt.cliente.lerXml().then((r) => { if (r) vmixAplicarRetrato(r); return r; });
}
// De tempos em tempos, o retrato inteiro (posição dos vídeos, tempo de
// gravação...) — só vira aviso às telas quando algo mudou de verdade
const vmixTimerRetrato = setInterval(() => {
  if (state.settings.labs?.vmix === true && vmixRt.conectado) vmixAtualizarTudo().catch(() => {});
}, 2000);
if (vmixTimerRetrato.unref) vmixTimerRetrato.unref();

function desligarVmix(motivo) {
  if (vmixRt.timerReconectar) { clearTimeout(vmixRt.timerReconectar); vmixRt.timerReconectar = null; }
  if (vmixAvisoTimer) { clearTimeout(vmixAvisoTimer); vmixAvisoTimer = null; }
  vmixAvisoUltimo = 0;
  const cli = vmixRt.cliente;
  vmixRt.cliente = null;
  if (cli) { try { cli.fechar(null); } catch { /* já caiu */ } }
  vmixRt.conectado = false;
  vmixRt.erro = motivo || null;
  vmixRt.versao = null; vmixRt.edicao = null; vmixRt.preset = null;
  vmixRt.entradas = []; vmixRt.programa = null; vmixRt.preview = null;
  vmixRt.overlays = []; vmixRt.transicoes = []; vmixRt.escurecido = false;
  vmixRt.gravando = false; vmixRt.transmitindo = false; vmixRt.externa = false;
  vmixRt.multiCorder = false; vmixRt.telaCheia = false; vmixRt.playlist = false;
  vmixRt.saidas = {}; vmixRt.master = { volume: 100, mudo: false }; vmixRt.tally = '';
  broadcastVmix();
}

function agendarReconexaoVmix() {
  if (vmixRt.timerReconectar || state.settings.labs?.vmix !== true) return;
  vmixRt.timerReconectar = setTimeout(() => { vmixRt.timerReconectar = null; conectarVmix(); }, 5000);
}

function conectarVmix() {
  if (state.settings.labs?.vmix !== true) { desligarVmix(null); return; }
  if (vmixRt.cliente) return; // já conectando/conectado
  const naRede = vmixConfig.host !== '127.0.0.1' && vmixConfig.host !== 'localhost' && vmixConfig.host !== '::1';
  const onde = vmixConfig.host + ':' + vmixConfig.port;
  const cli = new VmixCliente({
    host: vmixConfig.host,
    port: vmixConfig.port,
    aoConexao: (conectado, motivo) => {
      if (vmixRt.cliente !== cli) return;
      if (conectado) {
        vmixRt.conectado = true;
        vmixRt.erro = null;
        console.log('  🎛️ Conectado ao vMix (' + onde + ')');
        broadcastVmix(true);
        return;
      }
      vmixRt.cliente = null;
      let texto;
      if (vmixRt.conectado) texto = 'o vMix fechou a conexão — ele ainda está aberto?';
      else if (naRede) texto = `não achei o vMix em ${onde}${motivo ? ' (' + motivo + ')' : ''} — confira o IP, se o vMix daquela máquina está aberto e se o firewall dela deixa a porta ${vmixConfig.port} passar`;
      else texto = `não achei o vMix em ${onde}${motivo ? ' (' + motivo + ')' : ''} — ele está aberto? A API TCP vem ligada de fábrica na porta 8099 (Settings → Web Controller)`;
      desligarVmix(texto);
      agendarReconexaoVmix();
    },
    aoRetrato: (r) => { if (vmixRt.cliente === cli) vmixAplicarRetrato(r); },
    aoTally: (tally) => {
      if (vmixRt.cliente !== cli) return;
      vmixRt.tally = String(tally || '').slice(0, 400);
      // O tally já diz quem está no ar e no preview: as telas nem esperam o XML
      const programa = vmixRt.tally.indexOf('1'), preview = vmixRt.tally.indexOf('2');
      if (programa >= 0) vmixRt.programa = programa + 1;
      if (preview >= 0) vmixRt.preview = preview + 1;
      broadcastVmix();
    },
    aoEvento: (ev) => {
      if (vmixRt.cliente !== cli) return;
      // Os ativadores mais comuns entram na hora; o XML (que o cliente relê
      // logo em seguida) confirma o resto
      const ligado = ev.valor === '1';
      switch (ev.ativador) {
        case 'Recording': vmixRt.gravando = ligado; break;
        case 'Streaming': vmixRt.transmitindo = ligado; break;
        case 'External': vmixRt.externa = ligado; break;
        case 'MultiCorder': vmixRt.multiCorder = ligado; break;
        case 'Fullscreen': vmixRt.telaCheia = ligado; break;
        case 'FadeToBlack': vmixRt.escurecido = ligado; break;
        case 'Input': if (ligado && ev.entrada) vmixRt.programa = ev.entrada; break;
        case 'InputPreview': if (ligado && ev.entrada) vmixRt.preview = ev.entrada; break;
        case 'InputAudio': { const e = vmixRt.entradas.find((x) => x.numero === ev.entrada); if (e) e.mudo = !ligado; break; }
        default: return;
      }
      broadcastVmix();
    },
  });
  vmixRt.cliente = cli;
  cli.conectar();
}

const vmixAlternando = new Set();
// O despachante: uma ação, um alvo já limpo (sanitizeVmixAlvo)
async function vmixExecutarAcao(acao, alvo, quem) {
  if (state.settings.labs?.vmix !== true) return;
  if (!vmixRt.conectado || !vmixRt.cliente) {
    vmixAviso(false, vmixRt.erro
      ? 'o vMix não está conectado: ' + vmixRt.erro
      : 'o vMix não está conectado — confira o card 🎛️ em Configurações → 🧪 Labs');
    return;
  }
  const a = alvo || {};
  const chave = acao + '|' + (a.entrada || '') + '|' + (a.canal || '');
  if (a.modo === 'alternar' && vmixAlternando.has(chave)) return;
  if (a.modo === 'alternar') vmixAlternando.add(chave);
  try {
    return await vmixAcaoInterna(acao, a, quem);
  } finally {
    vmixAlternando.delete(chave);
  }
}

// A entrada que a tela pediu, no retrato atual (número, chave ou título)
function vmixEntrada(ref) {
  const v = String(ref || '').trim();
  if (!v) return null;
  const n = Number(v);
  return vmixRt.entradas.find((e) => (Number.isFinite(n) && e.numero === n) || e.chave === v || e.titulo === v) || null;
}

async function vmixAcaoInterna(acao, a, quem) {
  const cli = vmixRt.cliente;
  const F = (nome, params) => cli.funcao(nome, params);
  const entrada = a.entrada || undefined;
  let r = null;
  switch (acao) {
    case 'entrada': {
      if (!a.entrada) return;
      if (a.modo === 'preview') r = await F('PreviewInput', { Input: entrada });
      else if (a.modo === 'direto') r = await F('ActiveInput', { Input: entrada });
      else if (a.modo === 'cortar') r = await F('Cut', { Input: entrada });
      else if (a.modo === 'fundir') r = await F('Fade', { Input: entrada, Duration: a.duracao > 0 ? a.duracao : undefined });
      else r = await F('Transition1', { Input: entrada }); // o botão de transição principal do vMix
      break;
    }
    case 'transicao': {
      const nome = { transicao1: 'Transition1', transicao2: 'Transition2', transicao3: 'Transition3', transicao4: 'Transition4', cortar: 'Cut', fundir: 'Fade', stinger1: 'Stinger1', stinger2: 'Stinger2' }[a.modo] || 'Transition1';
      r = await F(nome, nome === 'Fade' && a.duracao > 0 ? { Duration: a.duracao } : undefined);
      break;
    }
    case 'escurecer': r = await F('FadeToBlack'); break;
    case 'gravar': r = await F(a.modo === 'iniciar' ? 'StartRecording' : a.modo === 'parar' ? 'StopRecording' : 'StartStopRecording'); break;
    case 'transmitir': {
      const p = a.canal > 0 ? { Value: a.canal - 1 } : undefined;
      r = await F(a.modo === 'iniciar' ? 'StartStreaming' : a.modo === 'parar' ? 'StopStreaming' : 'StartStopStreaming', p);
      break;
    }
    case 'externa': r = await F(a.modo === 'iniciar' ? 'StartExternal' : a.modo === 'parar' ? 'StopExternal' : 'StartStopExternal'); break;
    case 'multiCorder': r = await F(a.modo === 'iniciar' ? 'StartMultiCorder' : a.modo === 'parar' ? 'StopMultiCorder' : 'StartStopMultiCorder'); break;
    case 'telaCheia': r = await F(a.modo === 'ligar' ? 'FullscreenOn' : a.modo === 'desligar' ? 'FullscreenOff' : 'Fullscreen'); break;
    case 'playlist': r = await F(a.modo === 'parar' ? 'StopPlayList' : 'StartPlayList'); break;
    case 'captura':
      // O print fica NA MÁQUINA do vMix (na pasta de snapshots dele) — a API
      // não devolve a imagem; quem vem da rede no modo restrito não tira print
      if (quem && quem.daRede && !quem.podeMidia) { vmixAviso(false, 'o print está desligado para quem entra pela rede (libere 🖼️ em 🔒 Segurança)'); return; }
      r = await F('Snapshot', a.texto ? { Value: a.texto } : undefined);
      if (r && r.ok) { vmixAviso(true, 'print salvo pelo vMix, na pasta de snapshots dele'); return; }
      break;
    case 'marcador': r = await F('WriteDurationToRecordingLog'); break;
    case 'overlay': {
      const c = a.canal;
      if (a.modo === 'sair') r = await F(`OverlayInput${c}Out`);
      else if (a.modo === 'desligar') r = await F(`OverlayInput${c}Off`);
      else if (a.modo === 'entrar') { if (!a.entrada) return; r = await F(`OverlayInput${c}In`, { Input: entrada }); }
      else r = await F(`OverlayInput${c}`, entrada ? { Input: entrada } : undefined);
      break;
    }
    case 'overlaysDesligar': r = await F('OverlayInputAllOff'); break;
    case 'audioMudo':
      if (!a.entrada) return;
      r = await F(a.modo === 'mudo' ? 'AudioOff' : a.modo === 'som' ? 'AudioOn' : 'Audio', { Input: entrada });
      break;
    case 'audioVolume': {
      if (!a.entrada) return;
      let vol = a.volume;
      if (a.modo === 'ajustar') {
        const e = vmixEntrada(a.entrada);
        if (!e || e.volume === null) { vmixAviso(false, `não consegui ler o volume de "${a.entrada}"`); return; }
        vol = e.volume + a.volume;
      }
      r = await F('SetVolume', { Input: entrada, Value: Math.max(0, Math.min(100, Math.round(vol))) });
      break;
    }
    case 'audioSolo':
      if (!a.entrada) return;
      r = await F(a.modo === 'ligar' ? 'SoloOn' : a.modo === 'desligar' ? 'SoloOff' : 'Solo', { Input: entrada });
      break;
    case 'masterMudo': r = await F(a.modo === 'mudo' ? 'MasterAudioOff' : a.modo === 'som' ? 'MasterAudioOn' : 'MasterAudio'); break;
    case 'masterVolume': {
      const vol = a.modo === 'ajustar' ? (vmixRt.master.volume + a.volume) : a.volume;
      r = await F('SetMasterVolume', { Value: Math.max(0, Math.min(100, Math.round(vol))) });
      break;
    }
    case 'midia': {
      if (!a.entrada) return;
      const nome = { alternar: 'PlayPause', tocar: 'Play', pausar: 'Pause', recomecar: 'Restart', proximo: 'NextItem', anterior: 'PreviousItem' }[a.modo] || 'PlayPause';
      r = await F(nome, { Input: entrada });
      break;
    }
    case 'titulo':
      if (!a.entrada) return;
      r = await F('SetText', { Input: entrada, SelectedName: a.campo || undefined, Value: a.texto });
      break;
    case 'tituloAnimar':
      if (!a.entrada) return;
      r = await F('TitleBeginAnimation', { Input: entrada, Value: a.modo });
      break;
    case 'replay': {
      const nome = { marcarInicio: 'ReplayMarkIn', marcarFim: 'ReplayMarkOut', marcarUltimos: 'ReplayMarkInOut', tocarUltimo: 'ReplayPlayLastEvent', gravar: 'ReplayStartRecording', pararGravar: 'ReplayStopRecording' }[a.modo];
      if (!nome) return;
      r = await F(nome, nome === 'ReplayMarkInOut' ? { Value: a.segundos } : undefined);
      break;
    }
    case 'preset': r = await F(a.modo === 'salvar' ? 'SavePreset' : 'LastPreset'); break;
    case 'script':
      if (!a.nome) return;
      r = await F(a.modo === 'parar' ? 'ScriptStop' : 'ScriptStart', { Value: a.nome });
      break;
    case 'tecla':
      if (!a.nome) return;
      r = await F('KeyPress', { Value: a.nome });
      break;
    case 'funcao': {
      // 🧰 O coringa: qualquer função do vMix pelo nome (só letras e números)
      const nome = String(a.nome || '').replace(/[^A-Za-z0-9]/g, '');
      if (!nome) return;
      r = await F(nome, { Input: entrada, Value: a.texto || undefined, Duration: a.duracao > 0 ? a.duracao : undefined });
      break;
    }
    default: return;
  }
  if (r && r.ok === false && r.erro && r.erro !== 'desconectado') vmixAviso(false, 'o vMix recusou: ' + r.erro);
  // O cliente relê o XML depois de toda função; uma conferida extra deixa os
  // botões honestos mesmo quando o vMix não manda evento
  vmixAtualizarTudo().catch(() => {});
}
// Ao abrir o programa com o Labs já ligado, conecta sozinho
setTimeout(sincronizarObsComLabs, 1500);

// 🔒 v0.127.1: as configurações que um cliente da rede em modo restrito
// recebe não carregam caminhos do computador do streamer (pasta do backup,
// comando do transcritor). Ele não consegue gravá-los de volta (o servidor
// só aceita esses campos de quem está no computador), então nada se perde.
function settingsParaCliente(ws) {
  if (!ws || ws.role !== 'viewer') return state.settings;
  const s = state.settings;
  return {
    ...s,
    backup: { ...(s.backup || {}), pasta: '' },
    transcricao: { ...(s.transcricao || {}), comando: '' },
  };
}

// 🔒 v0.127.1: quem está na rede e some sem avisar (cabo, Wi-Fi) ficava
// preso na lista de conexões e o servidor seguia mandando tudo para um
// socket morto. Um ping a cada 30 s; sem resposta, a conexão cai.
const WS_PING_MS = 30000;
const wsPingTimer = setInterval(() => {
  for (const client of wss.clients) {
    if (client.vivo === false) { try { client.terminate(); } catch { /* já caiu */ } continue; }
    client.vivo = false;
    try { client.ping(); } catch { /* fechando */ }
  }
}, WS_PING_MS);
if (wsPingTimer.unref) wsPingTimer.unref();

wss.on('connection', (ws, req) => {
  // Papel calculado UMA vez, no aperto de mão — o IP não muda na conexão
  ws.role = roleFor(req);
  ws.vivo = true;
  ws.on('pong', () => { ws.vivo = true; });
  let ip = String(req.socket.remoteAddress || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  ws.clientIp = ip;
  ws.addressClass = classifyAddress(req.socket.remoteAddress);
  ws.deviceInfo = deviceLabel(req.headers['user-agent']);
  // Nome da máquina via DNS reverso (quando a rede informa) — sem travar nada
  // (só com um IP de verdade: dns.reverse('') estoura na hora)
  if (net.isIP(ip)) {
    dns.reverse(ip, (err, names) => {
      if (!err && names && names[0]) {
        ws.deviceName = String(names[0]).replace(/\.$/, '');
        broadcastClients();
      }
    });
  }
  broadcastClients();
  ws.on('close', () => broadcastClients());
  // Sem este ouvinte, QUALQUER erro de protocolo do WebSocket (um quadro
  // grande demais, texto malformado, bytes estranhos) virava um erro sem dono
  // e fechava o programa inteiro. Agora a conexão problemática cai sozinha e
  // a live continua.
  ws.on('error', (err) => {
    console.error('  ⚠️ Conexão com problema, encerrando só ela:', err && err.message);
    try { ws.terminate(); } catch { /* já caiu */ }
  });
  ws.send(JSON.stringify({
    type: 'init',
    security: { ...(ws.role === 'viewer' ? {} : securitySummary()), role: ws.role },
    ...(ws.role === 'local' ? {
      clients: clientsSummary(),
      backup: resumoBackup(),
      updateAutoCheck: updateConfig.autoCheck,
      // Aviso pendente: já sabemos que existe versão nova (busca automática)
      ...(updateCache && cmpVersions(updateCache.latest, APP_VERSION) > 0 ? { updateAvailable: updateCache.latest } : {}),
    } : {}),
    settings: settingsParaCliente(ws),
    defaults: DEFAULT_SETTINGS,
    featured: state.featured,
    midiaPlayer: state.midiaPlayer,
    avatarZoom: state.avatarZoom,
    avatarZooms: state.avatarZooms, // 🪟 v0.79: instâncias extras do 🔍
    status: state.status,
    recent: state.recent,
    recentPorRede: recentesPorRede(),
    feedPending: feedQueue.length + feedReleasing.length,
    feedPendingBy: feedPendingByPlatform(),
    feedTotals: { ...platformTotals },
    categoryTotals: { ...categoryTotals },
    participantesPorRede: participantesPorRede(),
    saved: state.saved,
    media: listMedia(),
    qrs: state.qrs,
    raffle: state.raffle,
    likemeter: state.likemeter,
    winstreaks: state.winstreaks,
    avisos: state.avisos,      // 📢 v0.128: o principal + adicionais
    aviso: state.avisos[0],    // (clientes antigos)
    relogio: relogioPublico(),
    audience: state.audience,
    exemplo: exemploAntes ? exemploAntes.alvo : null, // 🧪 v0.99
    exemploQr: exemploQrMatriz(), // 📺 v0.103: o QR de exemplo da prévia do editor
    participantCount: state.participants.size,
    fichasTotais: fichasTotais(),
    logs: logsInfo(),
    dados: resumoDados(),
    clipboard: podeVerClipboard(ws) ? clipboardPublico() : [],
    connections: conexoesPublicas(),
    trilhas: state.trilhas,
    perfisOverlay: state.perfisOverlay,
    // 🏭 v0.59: os moldes de fábrica originais viajam junto — é o botão de
    // resgate do editor ("De fábrica") para desfazer qualquer bagunça
    trilhaTocando: state.trilhaTocando,
    trilhaTela: state.trilhaTela, // 🖼️🎞️ v0.86
    midiaDireta: state.midiaDireta, // 🎞️ v0.129
    pastaTocando: pastaFila ? pastaFila.id : null,
    obs: obsResumo(),
    vmix: vmixResumo(), // 🎛️ v0.122
    controle: controleResumo(ws), // 🕹️ v0.126 (o token só para quem tem controle)
    pix: pixResumo(ws),
    // 🔒 v0.127.1: listas de banidos e as transcrições dos áudios dos
    // inscritos não vão para quem só assiste pela rede (modo restrito)
    moderacao: ws.role === 'viewer' ? {} : moderacao,
    transcricoes: ws.role === 'viewer' ? {} : transcricoes,
    // 🎙️ v0.140: a transcrição do que está NO AR vai para toda tela — inclusive
    // a do público, que a escreve na região do comentário
    transcricaoDestaque: transcricaoDoDestaque(),
    transcricaoEstado: transcritor.estado(),
    ytdlpEstado: extratorYtDlp.estado(), // 🧪 v0.134: o extrator da mídia direta
    waLib: waLibEstado(),
    readIds: Object.fromEntries([...state.readIds].slice(-MAX_READ_IDS)),
    version: APP_VERSION,
    lanUrl: lanAddress() ? `http://${lanAddress()}:${PORT}` : null,
    apoie: listApoie(),
  }));

  ws.on('message', (raw) => {
    // Rede de proteção: um erro tratando UMA mensagem não pode fechar o
    // programa inteiro (era o que acontecia — o processo morria e a live ia junto).
    try {
      tratarMensagem(ws, raw);
    } catch (err) {
      console.error('  ⚠️ Erro tratando uma mensagem do painel:', err && err.message);
    }
  });

});

// ---------------------------------------------------------------------------
// O despachante de TODAS as operações do painel. Ficava dentro do
// wss.on('connection'); v0.126 o trouxe para fora, porque o 🕹️ Controle
// externo (Stream Deck e afins) manda as MESMAS operações por HTTP — e
// passa por aqui, pelos mesmos portões, com um ws de mentira que só
// recolhe as respostas.
// ---------------------------------------------------------------------------
function tratarMensagem(ws, raw) {
  let msg;
  try { msg = JSON.parse(raw.toString()); } catch { return; }

  // ---------- 🔐 Portão de operações ----------
  // Modo restrito (rede sem senha): só o que os seletores liberarem.
  if (ws.role === 'viewer' && !viewerOpAllowed(msg.type, security.permissions)) return;
  // Operações de segurança: SÓ do computador local — nem com senha.
  if (LOCAL_ONLY_OPS.has(msg.type) && ws.role !== 'local') return;

  switch (msg.type) {
    case 'connect':
      connect(String(msg.platform || ''), String(msg.channel || ''), msg.options || {});
      break;
    case 'disconnect':
      disconnect(String(msg.platform || ''));
      break;
    case 'recarregarColuna': {
      // O 🔄 de uma coluna: devolve ao painel a janela guardada daquela rede.
      // Sem isto, o painel que já tinha perdido os comentários antigos não os
      // recuperava nunca — o servidor os tem, mas o histórico buscado de novo
      // é descartado como repetido (pelo id), então nada chegava de volta.
      const rede = String(msg.platform || '');
      const lista = rede === '__all'
        ? state.recent
        : (state.recentByPlatform[rede] || []);
      ws.send(JSON.stringify({ type: 'recarga', platform: rede, messages: lista }));
      break;
    }
    case 'reconnect': {
      // Reinicia uma conexao (se algo travou ou quebrou): derruba e conecta
      // de novo com o canal informado ou com o lembrado da ultima vez
      const platform = String(msg.platform || '');
      const channel = String(msg.channel || '').trim() || state.connections[platform]?.channel;
      if (CONNECTORS[platform] && channel) {
        console.log(`  🔄 Reiniciando a conexão ${platform} (${channel})...`);
        connect(platform, channel, state.connections[platform]?.token ? { token: state.connections[platform].token } : {});
      }
      break;
    }
    case 'securityPassword': {
      // Define/troca/remove a senha. Para trocar ou remover, exige a atual.
      if (security.passwordHash && !passwordMatches(String(msg.current || ''))) {
        ws.send(JSON.stringify({ type: 'securityError', error: 'A senha atual não confere.' }));
        break;
      }
      const nova = String(msg.password || '');
      if (nova) {
        if (nova.length < 4) {
          ws.send(JSON.stringify({ type: 'securityError', error: 'A senha precisa ter pelo menos 4 caracteres.' }));
          break;
        }
        security.salt = crypto.randomBytes(16).toString('hex');
        // v0.90: senha nova nasce com o custo forte de scrypt
        security.scryptN = SCRYPT_CUSTO_NOVO;
        security.passwordHash = hashPassword(nova, security.salt, security.scryptN);
      } else {
        security.passwordHash = null;
        security.salt = null;
        security.scryptN = 0;
      }
      authSessions.clear(); // sessões antigas caem na hora
      persistSecurity();
      broadcastSecurity();
      derrubarConexoesRebaixadas();
      break;
    }
    case 'securityMode':
      security.networkAccess = msg.networkAccess === 'full' ? 'full' : 'restricted';
      persistSecurity();
      broadcastSecurity();
      derrubarConexoesRebaixadas();
      break;
    case 'securityPerms':
      // Seletores do modo restrito: o que a rede pode usar
      security.permissions = sanitizePerms(msg.permissions);
      persistSecurity();
      broadcastSecurity();
      // 📋 v0.90.1: ligou/desligou o seletor da área de transferência? Quem
      // está na rede recebe o histórico (ou perde) na hora, sem recarregar
      clipboardAvisar();
      break;
    case 'restartApp':
      // Reinicia o programa a pedido do streamer (botão em Conexões)
      console.log('  ♻️ Reiniciando o OBS Social a pedido...');
      broadcast({ type: 'restarting' });
      setTimeout(() => {
        try { relaunchApp(); } catch (err) { console.log('  Não consegui reabrir sozinho (' + err.message + ') — feche e abra o OBS Social.'); }
      }, 800);
      break;
    case 'updateAuto':
      // Liga/desliga a busca automática (ao abrir e 1x por dia; só avisa)
      updateConfig.autoCheck = !!msg.enabled;
      persistUpdateConfig();
      ws.send(JSON.stringify({ type: 'updateAuto', enabled: updateConfig.autoCheck }));
      break;
    case 'updateCheck':
      // Verifica se existe versão nova no GitHub (só quando o streamer pede)
      (async () => {
        try {
          const cache = await downloadUpdate();
          ws.send(JSON.stringify({
            type: 'update',
            current: APP_VERSION,
            latest: cache.latest,
            hasUpdate: cmpVersions(cache.latest, APP_VERSION) > 0,
          }));
        } catch (err) {
          ws.send(JSON.stringify({ type: 'update', error: `Não consegui verificar agora (${err.message}). Confira a internet e tente de novo.` }));
        }
      })();
      break;
    case 'updateApply':
      // Instala a atualização — só depois do clique de confirmação do streamer
      (async () => {
        try {
          const fresh = updateCache && Date.now() - updateCache.at < 10 * 60 * 1000;
          const cache = fresh ? updateCache : await downloadUpdate();
          if (cmpVersions(cache.latest, APP_VERSION) <= 0) {
            ws.send(JSON.stringify({ type: 'update', current: APP_VERSION, latest: cache.latest, hasUpdate: false }));
            return;
          }
          const files = applyUpdate(cache.buffer);
          console.log(`  ⬇️ Atualização v${cache.latest} instalada (${files} arquivos). Reiniciando o OBS Social...`);
          ws.send(JSON.stringify({ type: 'update', applied: true, restarting: true, current: APP_VERSION, latest: cache.latest, files }));
          // Reabre sozinho: espera o aviso chegar às telas e renasce
          setTimeout(() => {
            try { relaunchApp(); } catch (err) { console.log('  Não consegui reabrir sozinho (' + err.message + ') — feche e abra o OBS Social.'); }
          }, 1200);
        } catch (err) {
          ws.send(JSON.stringify({ type: 'update', error: `A atualização falhou (${err.message}). Nada foi quebrado — tente de novo ou baixe o ZIP no GitHub.` }));
        }
      })();
      break;
    case 'reconnectAll':
      // Reinicia todas as redes que estavam ligadas
      for (const [platform, conn] of Object.entries(state.connections)) {
        if (conn?.active && conn.channel && CONNECTORS[platform]) {
          console.log(`  🔄 Reiniciando a conexão ${platform} (${conn.channel})...`);
          connect(platform, conn.channel, conn.token ? { token: conn.token } : {});
        }
      }
      break;
    case 'search': {
      // Busca global: responde so para quem pediu
      const query = String(msg.query || '');
      // 🔒 v0.127.1: a busca lê até 40 MB de logs de uma vez — em rajada ela
      // travava o programa inteiro. Uma por vez por conexão, com respiro.
      {
        const agora = Date.now();
        const respiro = ws.role === 'local' ? 300 : 2000;
        if (ws.ultimaBusca && agora - ws.ultimaBusca < respiro) break;
        ws.ultimaBusca = agora;
      }
      const { results, truncated } = searchLogs(query);
      ws.send(JSON.stringify({ type: 'searchResults', query, results, truncated }));
      break;
    }
    case 'feature': {
      // O comentário em destaque vai para todas as telas: só entra se for do
      // tamanho de um comentário mesmo.
      const cabe = msg.message && JSON.stringify(msg.message).length <= 64 * 1024;
      state.featured = cabe ? msg.message : null;
      // Robôs conhecidos ganham o 🤖 BOT também quando o destaque chega pronto
      if (state.featured) marcarRobo(state.featured);
      // 💰 v0.54: o valor em reais viaja carimbado pelo SERVIDOR (para as
      // faixas do 🎭 automático) — o que o painel mandou não vale
      if (state.featured) {
        delete state.featured.valorBRL;
        const sc = state.featured.superchat;
        if (sc && sc.amount) {
          const v = valorEmReais(sc.amount) ?? (sc.converted ? valorEmReais(sc.converted) : null);
          if (v !== null) state.featured.valorBRL = Math.round(v * 100) / 100;
        }
      }
      // 🎛️ mídia nova = player zerado e PAUSADO (o volume escolhido fica)
      state.midiaPlayer = { estado: 'pausado', posicao: 0, em: Date.now(), volume: state.midiaPlayer.volume, velocidade: state.midiaPlayer.velocidade || 1, semDistorcao: state.midiaPlayer.semDistorcao !== false };
      broadcast({ type: 'featured', featured: state.featured, transcricaoDestaque: transcricaoDoDestaque() });
      broadcast({ type: 'midiaPlayer', player: state.midiaPlayer });
      if (cabe && msg.message?.id) markRead(msg.message.id);
      break;
    }
    case 'unfeature':
      state.featured = null;
      state.midiaPlayer = { estado: 'pausado', posicao: 0, em: Date.now(), volume: state.midiaPlayer.volume, velocidade: state.midiaPlayer.velocidade || 1, semDistorcao: state.midiaPlayer.semDistorcao !== false };
      broadcast({ type: 'featured', featured: null });
      broadcast({ type: 'midiaPlayer', player: state.midiaPlayer });
      break;
    // 🎛️ v0.71: controle do player da mídia na tela, direto do painel.
    // O overlay é só um espelho: aplica o estado que chega daqui.
    case 'midiaPlayer': {
      const p = state.midiaPlayer;
      const acao = String(msg.acao || '');
      const posicao = Math.max(0, Math.min(24 * 3600, Number(msg.posicao) || 0));
      if (acao === 'play') {
        p.estado = 'tocando';
        if (Number.isFinite(Number(msg.posicao))) p.posicao = posicao;
        p.em = Date.now();
      } else if (acao === 'pause') {
        // congela a posição no instante do pause (o painel manda a atual)
        p.posicao = Number.isFinite(Number(msg.posicao)) ? posicao : p.posicao;
        p.estado = 'pausado';
        p.em = Date.now();
      } else if (acao === 'seek') {
        p.posicao = posicao;
        p.em = Date.now(); // tocando: o relógio recomeça deste ponto
      } else if (acao === 'reiniciar') {
        p.posicao = 0;
        p.em = Date.now();
      } else if (acao === 'volume') {
        p.volume = Math.round(numeroEntre(msg.volume, 0, 100, 100));
      } else if (acao === 'velocidade') {
        // 🚀 v0.87: mudar a velocidade não pode PULAR no tempo — congela a
        // posição no instante da troca e o relógio segue no ritmo novo
        if (p.estado === 'tocando') {
          p.posicao = Math.max(0, (Number(p.posicao) || 0)
            + ((Date.now() - (Number(p.em) || Date.now())) / 1000) * (Number(p.velocidade) || 1));
          p.em = Date.now();
        }
        p.velocidade = Math.round(numeroEntre(msg.velocidade, 0.05, 32, 1) * 100) / 100;
      } else if (acao === 'distorcao') {
        // 🎭 semDistorcao=true mantém a voz natural (preservesPitch)
        p.semDistorcao = msg.semDistorcao !== false;
      } else break;
      broadcast({ type: 'midiaPlayer', player: p });
      break;
    }
    case 'avatarShow': {
      // 🔍 v0.146: a foto pode ser https (YouTube, Twitch, Kick, Bilibili) ou
      // uma que o próprio programa baixou para a quarentena local — é o caso
      // do Telegram e do WhatsApp desde a v0.72, e das amostras 🧪.
      // Só aceitar https jogava essas fora e a ampliação caía na inicial
      // colorida, como se a pessoa não tivesse foto.
      // Sem foto de verdade, a tela mostra a inicial colorida, como sempre.
      const url = avatarAmpliavel(msg.url);
      // 🪟 v0.79: com «várias instâncias» ligado e o principal já no ar,
      // a ampliação NOVA vira uma instância extra (painel e tela)
      if (state.settings.janelas?.avatarMulti === true && state.avatarZoom.visible) {
        state.avatarZooms.push({
          id: 'az' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
          visible: true,
          url,
          author: String(msg.author || '').slice(0, 80),
          size: 30,
          em: Date.now(),
          origem: String(msg.origem || '').slice(0, 40),
        });
        if (state.avatarZooms.length > 6) state.avatarZooms.shift(); // teto
        broadcast({ type: 'avatarZooms', lista: state.avatarZooms });
        break;
      }
      state.avatarZoom = {
        visible: true,
        url,
        author: String(msg.author || '').slice(0, 80),
        size: state.avatarZoom.size || 30,
        // Carimbo de "quando": ampliar a MESMA pessoa de novo também conta
        // como avatar novo no painel (a telinha minimizada reabre)
        em: Date.now(),
        // 🪟 v0.78: qual navegador abriu — nos outros a janela chega minimizada
        origem: String(msg.origem || '').slice(0, 40),
      };
      broadcast({ type: 'avatarZoom', avatarZoom: state.avatarZoom });
      break;
    }
    case 'avatarHide':
      // 🪟 v0.79: com id fecha SÓ aquela instância extra; sem id, tudo
      if (msg.id) {
        state.avatarZooms = state.avatarZooms.filter((a) => a.id !== msg.id);
        broadcast({ type: 'avatarZooms', lista: state.avatarZooms });
        break;
      }
      state.avatarZoom = { ...state.avatarZoom, visible: false };
      if (state.avatarZooms.length) {
        state.avatarZooms = [];
        broadcast({ type: 'avatarZooms', lista: state.avatarZooms });
      }
      broadcast({ type: 'avatarZoom', avatarZoom: state.avatarZoom });
      break;
    case 'avatarSize': {
      const v = Number(msg.size);
      if (!Number.isFinite(v)) break;
      const tam = Math.max(10, Math.min(70, Math.round(v)));
      if (msg.id) { // 🪟 v0.79: régua de uma instância extra
        const extra = state.avatarZooms.find((a) => a.id === msg.id);
        if (extra) { extra.size = tam; broadcast({ type: 'avatarZooms', lista: state.avatarZooms }); }
        break;
      }
      state.avatarZoom.size = tam;
      broadcast({ type: 'avatarZoom', avatarZoom: state.avatarZoom });
      break;
    }
    case 'settings': {
      const incoming = (msg.settings && typeof msg.settings === 'object' && !Array.isArray(msg.settings)) ? msg.settings : {};
      // 🔒 v0.127.1: só entram chaves que as configurações conhecem (senão
      // cada mensagem podia plantar uma chave nova e o settings.json crescia
      // sem fim), textos com teto de tamanho, e a pasta do backup só muda
      // por quem está no computador do streamer (é para lá que vão as cópias
      // das conexões, com a chave que protege as senhas)
      for (const k of Object.keys(incoming)) {
        if (!Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, k) && !Object.prototype.hasOwnProperty.call(state.settings, k)) delete incoming[k];
      }
      limitarTextos(incoming);
      if (ws.role !== 'local' && incoming.backup && typeof incoming.backup === 'object') delete incoming.backup.pasta;
      if ('logRetentionDays' in incoming) {
        incoming.logRetentionDays = Math.max(0, Math.min(365, Number(incoming.logRetentionDays) || 0));
      }
      const widgets = { ...state.settings.widgets };
      for (const [key, value] of Object.entries(incoming.widgets || {})) {
        // Ignora chaves perigosas (evita mexer no protótipo dos objetos).
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
        const pecasAntes = (widgets[key] || {}).pecas;
        widgets[key] = { ...(widgets[key] || {}), ...value };
        // As peças do widget se fundem UMA A UMA: mexer só no x de uma peça
        // não pode apagar as posições das outras
        if (value && value.pecas && typeof value.pecas === 'object') {
          widgets[key].pecas = {
            ...pecasAntes,
            ...Object.fromEntries(Object.entries(value.pecas).map(
              ([c, v]) => [c, { ...(pecasAntes || {})[c], ...v }]
            )),
          };
        }
      }
      state.settings = mergeSettings({
        ...state.settings,
        ...incoming,
        chat: (() => {
          const c = { ...state.settings.chat, ...(incoming.chat || {}) };
          // ✍️ v0.110: as peças do chat se fundem uma a uma, como as dos widgets
          const ip = incoming.chat && incoming.chat.pecas;
          if (ip && typeof ip === 'object') {
            const antes = state.settings.chat.pecas || {};
            c.pecas = { ...antes, ...Object.fromEntries(Object.entries(ip).map(([k, v]) => [k, { ...antes[k], ...(v || {}) }])) };
          }
          return c;
        })(),
        panel: {
          ...state.settings.panel,
          ...(incoming.panel || {}),
          colDrip: { ...state.settings.panel.colDrip, ...((incoming.panel || {}).colDrip || {}) },
        },
        labs: { ...state.settings.labs, ...(incoming.labs || {}) },
        acessibilidade: { ...state.settings.acessibilidade, ...(incoming.acessibilidade || {}) },
        trilhasTexto: { ...state.settings.trilhasTexto, ...(incoming.trilhasTexto || {}) },
        // 🎙️ o comando do transcritor roda um programa da máquina: só o
        // computador local pode trocá-lo
        transcricao: {
          ...state.settings.transcricao,
          ...(incoming.transcricao || {}),
          ...(ws.role !== 'local' ? { comando: (state.settings.transcricao || {}).comando || '' } : {}),
        },
        // 👥 v0.141: de onde as mensagens do WhatsApp/Telegram podem vir
        chats: { ...state.settings.chats, ...(incoming.chats || {}) },
        midiaTela: { ...state.settings.midiaTela, ...(incoming.midiaTela || {}) },
        sombra: { ...state.settings.sombra, ...(incoming.sombra || {}) }, // ✨ v0.86
        // 🔊 v0.77: cada widget mandado substitui só a própria configuração
        audiosOverlay: sanitizeAudiosOverlay({ ...state.settings.audiosOverlay, ...(incoming.audiosOverlay || {}) }),
        // 🪟 v0.79: opções das janelas (compartilhadas)
        janelas: { avatarMulti: (incoming.janelas ? incoming.janelas.avatarMulti === true : (state.settings.janelas || {}).avatarMulti === true) },
        // 🎬 Cada bloco do controle do OBS vai e volta sozinho: mexer num
        // seletor não pode ressuscitar os outros no padrão
        obsPainel: { ...state.settings.obsPainel, ...(incoming.obsPainel || {}) },
        vmixPainel: { ...state.settings.vmixPainel, ...(incoming.vmixPainel || {}) }, // 🎛️ v0.122
        // 🎭 O automático dos perfis vai e volta em bloco (faixas inclusive)
        perfilAuto: { ...state.settings.perfilAuto, ...(incoming.perfilAuto || {}) },
        backup: {
          ...state.settings.backup,
          ...(incoming.backup || {}),
          itens: { ...(state.settings.backup || {}).itens, ...((incoming.backup || {}).itens || {}) },
        },
        selos: { ...state.settings.selos, ...(incoming.selos || {}) },
        layers: { ...state.settings.layers, ...(incoming.layers || {}) },
        pecas: {
          ...state.settings.pecas,
          ...Object.fromEntries(Object.entries(incoming.pecas || {}).map(
            ([k, v]) => [k, { ...(state.settings.pecas || {})[k], ...v }]
          )),
        },
        tema: { ...state.settings.tema, ...(incoming.tema || {}) },
        relogio: { ...state.settings.relogio, ...(incoming.relogio || {}) },
        layoutV: {
          ...state.settings.layoutV,
          ...(incoming.layoutV || {}),
          ...(incoming.layoutV?.featured
            ? { featured: { ...(state.settings.layoutV || {}).featured, ...incoming.layoutV.featured } } : {}),
          ...(incoming.layoutV?.media
            ? { media: { ...(state.settings.layoutV || {}).media, ...incoming.layoutV.media } } : {}),
          widgets: {
            ...((state.settings.layoutV || {}).widgets || {}),
            ...Object.fromEntries(Object.entries(incoming.layoutV?.widgets || {}).map(
              ([k, v]) => [k, { ...((state.settings.layoutV || {}).widgets || {})[k], ...v }]
            )),
          },
        },
        raffle: {
          ...state.settings.raffle,
          ...(incoming.raffle || {}),
          weights: { ...state.settings.raffle.weights, ...((incoming.raffle || {}).weights || {}) },
        },
        widgets,
      });
      // 🏷️ Selos: tudo aqui é liga/desliga
      {
        const sel = state.settings.selos;
        for (const chave of Object.keys(DEFAULT_SETTINGS.selos)) {
          sel[chave] = sel[chave] !== false;
        }
      }
      state.settings.chat.apagarRemovidas = state.settings.chat.apagarRemovidas !== false;
      // 🪟 Camadas: só as conhecidas, sem repetir, e as que faltarem entram
      // no fim na ordem padrão (assim uma versão antiga nunca perde camada)
      {
        const conhecidas = DEFAULT_SETTINGS.layers.ordem;
        const bruta = Array.isArray(state.settings.layers.ordem) ? state.settings.layers.ordem : [];
        const ordem = [...new Set(bruta.filter((c) => conhecidas.includes(c)))];
        for (const c of conhecidas) if (!ordem.includes(c)) ordem.push(c);
        state.settings.layers.ordem = ordem;
      }
      // 🧩 Peças do destaque: números dentro do limite, ajuste conhecido e
      // nenhuma chave estranha (nem peça inventada, nem campo inventado)
      {
        const fonte = state.settings.pecas || {};
        const pecas = {};
        for (const [chave, padrao] of Object.entries(DEFAULT_SETTINGS.pecas)) {
          pecas[chave] = limparPeca(fonte[chave], padrao);
        }
        state.settings.pecas = pecas;
        // 🧩 As peças dos widgets seguem a mesma régua, widget por widget
        for (const [kind, wdef] of Object.entries(DEFAULT_SETTINGS.widgets)) {
          if (!wdef.pecas) {
            // Widget sem peças: nada disso pode ficar guardado nele
            const wc = state.settings.widgets[kind];
            if (wc) { delete wc.pecas; delete wc.pecasLivre; delete wc.pecasLargura; delete wc.pecasAltura; }
            continue;
          }
          const wconf = state.settings.widgets[kind];
          if (wdef.pecasLargura !== undefined) {
            wconf.pecasLivre = wconf.pecasLivre === true;
            wconf.pecasLargura = Math.round(numeroEntre(wconf.pecasLargura, 80, 1400, wdef.pecasLargura));
            wconf.pecasAltura = Math.round(numeroEntre(wconf.pecasAltura, 60, 1400, wdef.pecasAltura));
          } else {
            // ✍️ v0.110: widget com peças SÓ de formatação (Aviso): sem modo solto
            delete wconf.pecasLivre; delete wconf.pecasLargura; delete wconf.pecasAltura;
          }
          const wfonte = wconf.pecas || {};
          wconf.pecas = Object.fromEntries(Object.entries(wdef.pecas).map(
            ([c, pd]) => [c, limparPeca(wfonte[c], pd)]
          ));
        }
        // ✍️ v0.110: as peças de texto do chat fixo (nome e texto) — mesma régua
        {
          const c = state.settings.chat || (state.settings.chat = {});
          const cf = (c.pecas && typeof c.pecas === 'object') ? c.pecas : {};
          c.pecas = Object.fromEntries(Object.entries(DEFAULT_SETTINGS.chat.pecas).map(
            ([k, pd]) => [k, limparPeca(cf[k], pd)]
          ));
        }
        state.settings.destaqueLivre = state.settings.destaqueLivre === true;
        state.settings.cardAlturaEm = numeroEntre(state.settings.cardAlturaEm, 2, 20, 4.6);
        // 📺 Chat fixo no Organizar: x/y em % (null = pelo lado de sempre)
        // e altura em px (0 = tela inteira)
        {
          const c = state.settings.chat || {};
          const eixo = (v) => (v === null || v === undefined || v === '' ? null : numeroEntre(v, -20, 120, null));
          c.x = eixo(c.x);
          c.y = eixo(c.y);
          c.height = Math.round(numeroEntre(c.height, 0, 2160, 0));
        }
        // ♿ Acessibilidade: só liga/desliga conhecidos
        {
          const a = state.settings.acessibilidade || {};
          const limpo = {};
          for (const chave of Object.keys(DEFAULT_SETTINGS.acessibilidade)) limpo[chave] = a[chave] === true;
          state.settings.acessibilidade = limpo;
        }
        // 🎵 A grade e a fonte dos botões da Mesa de trilhas
        state.settings.trilhasGrade = [4, 6, 8, 12, 15].includes(Number(state.settings.trilhasGrade))
          ? Number(state.settings.trilhasGrade) : 15;
        // 🎬 Experimental: cenas do OBS como teclas na Mesa (só liga/desliga)
        state.settings.trilhasCenas = state.settings.trilhasCenas === true;
        // 🎬 Os blocos do controle do OBS no painel: só liga/desliga conhecidos
        {
          const p = state.settings.obsPainel || {};
          const limpo = {};
          for (const chave of Object.keys(DEFAULT_SETTINGS.obsPainel)) {
            limpo[chave] = p[chave] === undefined ? DEFAULT_SETTINGS.obsPainel[chave] : p[chave] === true;
          }
          state.settings.obsPainel = limpo;
        }
        // 🎛️ v0.122: idem para os blocos do controle do vMix
        {
          const p = state.settings.vmixPainel || {};
          const limpo = {};
          for (const chave of Object.keys(DEFAULT_SETTINGS.vmixPainel)) {
            limpo[chave] = p[chave] === undefined ? DEFAULT_SETTINGS.vmixPainel[chave] : p[chave] === true;
          }
          state.settings.vmixPainel = limpo;
        }
        // 🎭 Automático dos perfis de overlay: liga/desliga, nome do perfil
        // dos comentários comuns e as faixas — cada uma de um TIPO:
        // 'valor' (a partir de R$ tanto), 'cor' (o tom do Super Chat que o
        // YouTube pintou) ou 'palavra' (aparece no espaço do nome). Só
        // valores de verdade, sem faixa repetida do mesmo tipo.
        {
          const a = state.settings.perfilAuto || {};
          const CORES_YT = ['azul', 'ciano', 'verde', 'amarelo', 'laranja', 'magenta', 'vermelho'];
          const faixas = [];
          const vistos = new Set();
          for (const fx of (Array.isArray(a.faixas) ? a.faixas : [])) {
            if (faixas.length >= 24) break;
            if (!fx || typeof fx !== 'object') continue;
            const perfil = String(fx.perfil || '').replace(/[\r\n]/g, ' ').trim().slice(0, 60);
            if (!perfil) continue;
            const tipo = ['cor', 'palavra', 'membro'].includes(fx.tipo) ? fx.tipo : 'valor';
            if (tipo === 'valor') {
              const min = Math.round(numeroEntre(fx.min, 0, 1000000, NaN) * 100) / 100;
              if (!Number.isFinite(min) || vistos.has('valor:' + min)) continue;
              vistos.add('valor:' + min);
              faixas.push({ tipo, min, perfil });
            } else if (tipo === 'membro') {
              // 🕒 v0.118: a partir de N meses de membro (0 = membro novo)
              const meses = Math.round(numeroEntre(fx.meses, 0, 240, NaN));
              if (!Number.isFinite(meses) || vistos.has('membro:' + meses)) continue;
              vistos.add('membro:' + meses);
              faixas.push({ tipo, meses, perfil });
            } else if (tipo === 'cor') {
              const cor = String(fx.cor || '').toLowerCase();
              if (!CORES_YT.includes(cor) || vistos.has('cor:' + cor)) continue;
              vistos.add('cor:' + cor);
              faixas.push({ tipo, cor, perfil });
            } else {
              const palavra = String(fx.palavra || '').replace(/[\r\n]/g, ' ').trim().slice(0, 40);
              if (!palavra || vistos.has('palavra:' + palavra.toLowerCase())) continue;
              vistos.add('palavra:' + palavra.toLowerCase());
              faixas.push({ tipo, palavra, perfil });
            }
          }
          // Só as faixas por VALOR se ordenam entre si (crescente); as de
          // cor e palavra ficam na ordem em que o usuário montou
          faixas.sort((x, y) => (x.tipo === 'valor' && y.tipo === 'valor' ? x.min - y.min : 0));
          const nomeMolde = (v) => String(v || '').replace(/[\r\n]/g, ' ').trim().slice(0, 60);
          // 📺 v0.113: comum por rede ('' = segue o geral; ':nenhum' = visual
          // ao vivo) e o destino do pago sem faixa (':comum' = o da rede)
          const porRede = a.comumPorRede && typeof a.comumPorRede === 'object' ? a.comumPorRede : {};
          const comumPorRede = {};
          for (const rede of ['youtube', 'twitch', 'kick', 'bilibili']) comumPorRede[rede] = nomeMolde(porRede[rede]);
          state.settings.perfilAuto = {
            ligado: a.ligado === true,
            comum: nomeMolde(a.comum),
            faixas,
            comumPorRede,
            semFaixa: a.semFaixa === undefined ? ':comum' : nomeMolde(a.semFaixa),
          };
        }
        // 📁 Tempo de segurar para abrir pasta (0 a 5s)
        state.settings.trilhasSegurar = Math.round(numeroEntre(state.settings.trilhasSegurar, 0, 5, 0.6) * 10) / 10;
        {
          const tx = state.settings.trilhasTexto || {};
          state.settings.trilhasTexto = {
            tam: Math.round(numeroEntre(tx.tam, 8, 20, 11)),
            cor: corHex(tx.cor, ''),
            negrito: tx.negrito !== false,
          };
        }
        // 💾 Backup: pasta é um caminho simples (sem quebras de linha) e a
        // frequência de cada item só aceita os valores conhecidos
        {
          const bk = state.settings.backup || {};
          bk.pasta = String(bk.pasta || '').replace(/[\r\n]/g, '').trim().slice(0, 400);
          const limpos = {};
          for (const item of Object.keys(DEFAULT_SETTINGS.backup.itens)) {
            const v = String((bk.itens || {})[item] || 'manual');
            limpos[item] = BACKUP_FREQ_RE.test(v) ? v : 'manual';
          }
          bk.itens = limpos;
          state.settings.backup = bk;
        }
        if (!['cobrir', 'esticar', 'caber'].includes(state.settings.mediaCardAjuste)) {
          state.settings.mediaCardAjuste = 'cobrir';
        }
        state.settings.cartaoSoArte = state.settings.cartaoSoArte === true;
      }
      // Idioma: só um dos que existem (o painel já valida; o servidor guarda)
      {
        const IDIOMAS = ['auto', 'pt', 'en', 'es', 'fr', 'de', 'ru', 'tr', 'ja', 'ko', 'zh'];
        if (!IDIOMAS.includes(state.settings.idioma)) state.settings.idioma = 'auto';
      }
      // 🕐 Relógio e 🎁 Sorteio: números dentro do limite, cores de verdade e
      // som só das pastas do programa (o painel já limita, mas o servidor é
      // quem manda — ele guarda e reenvia para todas as telas).
      {
        const r = state.settings.relogio;
        r.somUrl = urlLocalDeArquivo(r.somUrl, PASTAS_SOM);
        r.somVolume = Math.round(numeroEntre(r.somVolume, 0, 100, 70));
        r.somOnde = ['painel', 'live', 'ambos'].includes(r.somOnde) ? r.somOnde : 'ambos';
        r.piscarFinal = r.piscarFinal !== false;
        r.piscarFinalSegundos = Math.round(numeroEntre(r.piscarFinalSegundos, 1, 60, 10));
        r.piscarFinalCor = corHex(r.piscarFinalCor, '#ffd23f');
        r.piscarNoFim = r.piscarNoFim !== false;
        r.piscarNoFimSegundos = Math.round(numeroEntre(r.piscarNoFimSegundos, 0, 300, 0));
        r.piscarNoFimCor = corHex(r.piscarNoFimCor, '#ff5c5c');
        r.piscarAvisoNoFinal = r.piscarAvisoNoFinal !== false;
        r.piscarAvisoSegundos = Math.round(numeroEntre(r.piscarAvisoSegundos, 1, 60, 10));
        r.piscarAvisoCor = corHex(r.piscarAvisoCor, '');
        r.tirarAvisoNoFim = r.tirarAvisoNoFim !== false;
        r.mostrarDataNoPainel = r.mostrarDataNoPainel !== false;
        if (typeof r.fuso !== 'string' || r.fuso.length > 64) r.fuso = 'auto';

        const sorteio = ajustarSorteio(state.settings.raffle); // 🔑 palavras + 👑 fundador (v0.116)
        sorteio.dadoSegundos = numeroEntre(sorteio.dadoSegundos, 0, 15, 3);
        sorteio.somUrl = urlLocalDeArquivo(sorteio.somUrl, PASTAS_SOM);
        sorteio.somVolume = Math.round(numeroEntre(sorteio.somVolume, 0, 100, 70));
        sorteio.somOnde = ['painel', 'live', 'ambos'].includes(sorteio.somOnde) ? sorteio.somOnde : 'ambos';
        // 📨/💬 Telegram/WhatsApp no sorteio: liga/desliga + fichas 1..100
        sorteio.telegramSorteio = sorteio.telegramSorteio === true;
        sorteio.whatsappSorteio = sorteio.whatsappSorteio === true;
        sorteio.telegramFichas = Math.round(numeroEntre(sorteio.telegramFichas, 1, 100, 1));
        sorteio.whatsappFichas = Math.round(numeroEntre(sorteio.whatsappFichas, 1, 100, 1));
        // 💬⏱ resposta dos ganhadores
        sorteio.respostaPainel = sorteio.respostaPainel !== false;
        sorteio.respostaTela = sorteio.respostaTela !== false;
        sorteio.respostaTimer = sorteio.respostaTimer === true;
        sorteio.respostaModo = sorteio.respostaModo === 'varios' ? 'varios' : 'um';
        sorteio.respostaSegundos = Math.round(numeroEntre(sorteio.respostaSegundos, 5, 600, 60));
        // Desligou o ⏱ com uma vez armada? Desarma na hora — sem isso o
        // setTimeout vivo marcava o ganhador como "não respondeu" com a
        // função já desligada (e o countdown seguia na tela).
        if (sorteio.respostaTimer !== true && state.raffle && state.raffle.vez !== null) {
          pararRespostaTimer();
          state.raffle.vez = null;
          state.raffle.prazoAte = null;
          broadcast({ type: 'raffle', raffle: state.raffle });
        }
        // Mexeu nas regras do sorteio? O contador de fichas muda junto
        // (fichas extras, seletor do Telegram/WhatsApp, sorteio aberto...)
        if (incoming.raffle) broadcastParticipantes();

        // 📎 mídia na tela do público: escala 20..100 e tela cheia booleana
        const mt = state.settings.midiaTela;
        mt.escala = Math.round(numeroEntre(mt.escala, 20, 100, 45));
        mt.telaCheia = mt.telaCheia === true;

        // ✨ sombra dos overlays: só tipo conhecido e opacidade 0..100
        const sb = state.settings.sombra;
        sb.tipo = ['suave', 'contorno', 'nenhuma'].includes(sb.tipo) ? sb.tipo : 'suave';
        sb.opacidade = Math.round(numeroEntre(sb.opacidade, 0, 100, 55));

        // 🎙️ transcrição: só valores conhecidos
        const tr = state.settings.transcricao;
        tr.modelo = MODELOS_TRANSCRICAO[tr.modelo] ? tr.modelo : 'base';
        tr.idioma = /^([a-z]{2,5}|auto)$/.test(String(tr.idioma || '')) ? String(tr.idioma) : 'auto';
        tr.comando = typeof tr.comando === 'string' ? tr.comando.slice(0, 500) : '';
      }
      // 🖼️ Mídias: fundo do destaque, moldura, fundo de cada widget e a
      // imagem de fundo do tema — todas só das mídias que você enviou.
      for (const chave of ['mediaUrl', 'mediaCard', 'mediaFullscreen']) {
        if (chave in state.settings) state.settings[chave] = urlLocalDeArquivo(state.settings[chave], PASTAS_MIDIA);
      }
      for (const conf of Object.values(state.settings.widgets || {})) {
        if (conf && typeof conf === 'object') conf.mediaUrl = urlLocalDeArquivo(conf.mediaUrl, PASTAS_MIDIA);
      }
      state.settings.tema.fundoImagem = urlLocalDeArquivo(state.settings.tema.fundoImagem, PASTAS_MIDIA);

      // Higieniza os campos estruturados do painel: só chaves conhecidas e
      // números dentro do limite (valores estranhos quebrariam o painel de
      // todo mundo — inclusive por seletores CSS montados com essas chaves)
      {
        const p = state.settings.panel;
        // 🧲 v0.154: as chaves aceitas vêm de /public/painel-ordem.js, a mesma
        // lista que o painel e as configurações usam. Ferramenta nova entra
        // LÁ, uma vez só — aqui nada precisa mudar.
        p.toolOrder = PAINEL_ORDEM.soConhecidas(p.toolOrder, PAINEL_ORDEM.FERRAMENTAS);
        p.tabOrder = PAINEL_ORDEM.soConhecidas(p.tabOrder, PAINEL_ORDEM.ABAS);
        p.toolbarPos = p.toolbarPos === 'bottom' ? 'bottom' : 'top';
        p.comentGap = Math.max(0, Math.min(30, Math.round(numeroEntre(p.comentGap, 0, 30, 1))));
        p.faixaDupla = p.faixaDupla === true;
        p.recarregarMin = Math.max(0, Math.min(60, Math.round(Number(p.recarregarMin) || 0)));
        p.previewW = Math.max(100, Math.min(10000, Number(p.previewW) || 1920));
        p.previewH = Math.max(100, Math.min(10000, Number(p.previewH) || 1080));
        const rs = Number(p.refreshSeconds);
        p.refreshSeconds = Number.isFinite(rs) ? Math.max(0, Math.min(60, Math.round(rs))) : 1;
        const ds = Number(p.dripSeconds);
        p.dripSeconds = Number.isFinite(ds) ? Math.max(0, Math.min(5, Math.round(ds * 10) / 10)) : 0;
        p.dripPerColumn = p.dripPerColumn === true;
        {
          const bruto = (p.colDrip && typeof p.colDrip === 'object' && !Array.isArray(p.colDrip)) ? p.colDrip : {};
          const limpo = {};
          for (const k of ['youtube', 'twitch', 'kick', 'bilibili', 'doacao', 'telegram', 'whatsapp']) {
            const v = Number(bruto[k]);
            if (Number.isFinite(v) && v > 0) limpo[k] = Math.min(5, Math.round(v * 10) / 10);
          }
          p.colDrip = limpo;
        }
        const fp = Number(state.settings.feedPageSize);
        state.settings.feedPageSize = Number.isFinite(fp) ? Math.max(5, Math.min(100, Math.round(fp))) : 20;
        p.liveView = p.liveView === 'colunas' ? 'colunas' : 'unificado';
        p.columnsShowAll = p.columnsShowAll === true;
        p.columnsShowEmpty = p.columnsShowEmpty === true;
        // «__all» é a coluna «Todas», do painel — não é uma rede, por isso
        // entra aqui e não na lista compartilhada
        p.columnsOrder = PAINEL_ORDEM.soConhecidas(p.columnsOrder, ['__all', ...PAINEL_ORDEM.COLUNAS]);
        {
          // 🫧 Animação de chegada: só estilos conhecidos, duração 0.1–2s
          const ANIM_ESTILOS = ['deslizar', 'surgir', 'pop', 'zoom', 'quicar', 'nenhuma'];
          const bruto = (p.anim && typeof p.anim === 'object' && !Array.isArray(p.anim)) ? p.anim : {};
          const dur = Number(bruto.duracao);
          p.anim = {
            estilo: ANIM_ESTILOS.includes(bruto.estilo) ? bruto.estilo : 'deslizar',
            duracao: Number.isFinite(dur) ? Math.max(0.1, Math.min(2, Math.round(dur * 10) / 10)) : 0.5,
          };
        }
      }
      // Modo de tela e perfil vertical: só valores conhecidos e dentro da tela
      {
        const s2 = state.settings;
        s2.screenMode = ['normal', 'horizontal', 'vertical', 'ambos'].includes(s2.screenMode) ? s2.screenMode : 'normal';
        s2.idioma = ['auto', 'pt', 'en', 'es', 'fr', 'de', 'ru', 'tr', 'ja', 'ko', 'zh'].includes(s2.idioma) ? s2.idioma : 'auto';
        // 🕐 Relógio: fuso conhecido, som só das mídias enviadas, volume 0-100
        {
          const r = s2.relogio || (s2.relogio = {});
          r.fuso = (typeof r.fuso === 'string' && /^[A-Za-z_+\-/0-9]{3,40}$/.test(r.fuso)) ? r.fuso : 'auto';
          if (r.fuso !== 'auto') {
            // fuso inválido derruba para automático (nunca quebra a tela)
            try { new Intl.DateTimeFormat('pt-BR', { timeZone: r.fuso }); } catch { r.fuso = 'auto'; }
          }
          r.somUrl = (typeof r.somUrl === 'string'
            && (/^\/uploads\/[^/\\]+$/.test(r.somUrl) || /^\/sons\/[a-z0-9-]+\.[a-z0-9]{2,5}$/i.test(r.somUrl))) ? r.somUrl : '';
          const n = Number(r.somVolume);
          r.somVolume = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 70;
          r.somOnde = ['painel', 'live', 'ambos'].includes(r.somOnde) ? r.somOnde : 'ambos';
          r.mostrarDataNoPainel = r.mostrarDataNoPainel !== false;
          r.piscarAvisoNoFinal = r.piscarAvisoNoFinal !== false;
          r.tirarAvisoNoFim = r.tirarAvisoNoFim !== false;
          r.piscarNoFim = r.piscarNoFim !== false;
        }
        // 🎨 Tema: só cores hexadecimais, números dentro da faixa e imagem
        // vinda das mídias enviadas (nada de URL externa nem caminho solto)
        {
          const t = s2.tema || (s2.tema = {});
          const cor = (v) => (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : '');
          for (const k of ['corFundo', 'corPainel', 'corPainel2', 'corTexto', 'corSuave', 'corBorda', 'corDestaque']) t[k] = cor(t[k]);
          t.nome = String(t.nome || '').slice(0, 60);
          t.fundoImagem = (typeof t.fundoImagem === 'string' && /^\/uploads\/[^/\\]+$/.test(t.fundoImagem)) ? t.fundoImagem : '';
          t.fundoAjuste = ['cover', 'contain', 'tile'].includes(t.fundoAjuste) ? t.fundoAjuste : 'cover';
          const num = (v, min, max, padrao) => {
            const n = Number(v);
            return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : padrao;
          };
          t.fundoOpacidade = num(t.fundoOpacidade, 0, 1, 0.35);
          t.fundoDesfoque = num(t.fundoDesfoque, 0, 20, 0);
          t.fonte = /^[A-Za-z0-9 ,'\-]{0,60}$/.test(String(t.fonte || '')) ? String(t.fonte || '') : '';
          t.tamTexto = num(t.tamTexto, 80, 130, 100);
          t.tamIcone = num(t.tamIcone, 70, 160, 100);
          t.cantos = num(t.cantos, 0, 28, 14);
          t.densidade = num(t.densidade, 80, 130, 100);
        }
        const POS_RE = /^[a-z-]{2,20}$/;
        const limparPos = (o, xk, yk) => {
          const out = {};
          if (typeof o.position === 'string' && POS_RE.test(o.position)) out.position = o.position;
          for (const k of [xk, yk]) {
            const v = Number(o[k]);
            if (Number.isFinite(v)) out[k] = Math.max(0, Math.min(100, Math.round(v * 10) / 10));
          }
          return out;
        };
        const lv = (s2.layoutV && typeof s2.layoutV === 'object' && !Array.isArray(s2.layoutV)) ? s2.layoutV : {};
        const limpo = { widgets: {} };
        if (lv.featured && typeof lv.featured === 'object') limpo.featured = limparPos(lv.featured, 'posX', 'posY');
        if (lv.media && typeof lv.media === 'object') limpo.media = limparPos(lv.media, 'x', 'y');
        for (const k of Object.keys(DEFAULT_SETTINGS.widgets)) {
          const v = (lv.widgets || {})[k];
          if (v && typeof v === 'object') limpo.widgets[k] = limparPos(v, 'x', 'y');
        }
        s2.layoutV = limpo;
      }
      armFeedTick(); // o ritmo do fluxo de mensagens acompanha na hora
      // Desligou a Bilibili no Labs? Derruba a conexão e esquece o canal
      // (senão ela religaria sozinha na próxima abertura)
      if (incoming.labs && incoming.labs.bilibili === false) {
        disconnect('bilibili');
        delete state.connections.bilibili;
        persistConnections();
      }
      saveSettings();
      broadcast({ type: 'settings', settings: state.settings });
      // Mudou algo do backup (pasta/frequências)? O resumo (pasta em uso,
      // lista de backups) acompanha na hora
      if (incoming.backup) broadcastBackup();
      // 🎬🎵 O interruptor do Labs liga/desliga a conexão com o OBS na hora
      if (incoming.labs) sincronizarObsComLabs();
      if (incoming.labs) broadcastControle(); // 🕹️ v0.126: a página do controle acompanha o seletor
      // 💠 E o do Pix (re)arranca ou para a consulta ao banco na hora
      if (incoming.labs && 'pix' in incoming.labs) arrancarPix();
      // Mexer nas fichas do sorteio muda o total em jogo: o painel acompanha
      broadcast({
        type: 'participants',
        count: state.participants.size,
        porRede: participantesPorRede(),
        fichas: fichasTotais(),
      });
      if ('logRetentionDays' in incoming) cleanOldLogs();
      break;
    }
    case 'feedJump':
      feedJump();
      break;
    case 'feedFlush':
      // Botão 🔃: solta as mensagens da fila agora (também suavemente)
      feedFlush();
      break;
    case 'clearLogs':
      clearAllLogs();
      break;
    case 'dadosPedir':
      // A página de limpeza pede os números atuais ao ser aberta (eles mudam
      // durante a live, conforme os logs crescem)
      ws.send(JSON.stringify({ type: 'dados', dados: resumoDados(), logs: logsInfo() }));
      break;
    case 'limpar': {
      // Central de limpeza (Configurações → Logs e dados). Cada escopo
      // apaga só o que promete; 'tudo' devolve o programa ao estado de
      // recém-instalado. Só do computador local (LOCAL_ONLY_OPS).
      const escopo = String(msg.escopo || '');
      const resultado = limparDados(escopo);
      ws.send(JSON.stringify({ type: 'limpezaFeita', escopo, ...resultado }));
      // 💣 Apagar TUDO devolve o programa ao zero de verdade: reinicia
      // sozinho pelo MESMO caminho da atualização e do botão ♻️
      // (relaunchApp) — nada de truques que irritam antivírus.
      if (escopo === 'tudo' && resultado.ok) {
        console.log('  💣 Tudo apagado — reiniciando o OBS Social...');
        broadcast({ type: 'restarting' });
        setTimeout(() => {
          try { relaunchApp(); } catch (err) { console.log('  Não consegui reabrir sozinho (' + err.message + ') — feche e abra o OBS Social.'); }
        }, 1200);
      }
      break;
    }
    case 'backupAgora': {
      // 💾 Backup manual de um item (só do computador local)
      const item = String(msg.item || '');
      const r = fazerBackup(item, true);
      ws.send(JSON.stringify({ type: 'backupFeito', item, ...r }));
      broadcastBackup();
      break;
    }
    case 'backupRestaurar': {
      // ↩️ Restauração a partir da pasta de backup (só do computador local)
      const item = String(msg.item || '');
      const r = restaurarBackup(item, msg.marca);
      ws.send(JSON.stringify({ type: 'backupRestaurado', item, ...r }));
      broadcastBackup();
      break;
    }
    // ---------- 🎭 Perfis de overlay (v0.54) ----------
    case 'perfisOverlaySet': {
      // A lista inteira de uma vez (o card dos perfis manda tudo junto)
      state.perfisOverlay = sanitizePerfis(msg.perfis);
      persistPerfisOverlay();
      broadcast({ type: 'perfisOverlay', perfis: state.perfisOverlay });
      break;
    }
    // ---------- 🎵 Mesa de trilhas (Labs) ----------
    case 'trilhasSet': {
      // A lista inteira de uma vez (o card de edição manda tudo junto)
      state.trilhas = sanitizeTrilhas(msg.trilhas);
      persistTrilhas();
      // 🖼️🎞️ a mídia na tela é de uma tecla que sumiu (ou virou outra
      // coisa)? Sai da tela junto
      if (state.trilhaTela && !state.trilhas.some((t) => t.id === state.trilhaTela.id
          && (t.tipo === 'imagem' || t.tipo === 'video'))) setTrilhaTela(null);
      // 📁 a pasta que estava rodando em fila sumiu (ou virou outra coisa)?
      // A fila para — senão as teclas antigas seguiam disparando até o fim
      if (pastaFila && !state.trilhas.some((t) => t.id === pastaFila.id && t.tipo === 'pasta')) pararTrilha();
      broadcast({ type: 'trilhas', trilhas: state.trilhas });
      break;
    }
    case 'trilhaTocar': {
      if (state.settings.labs?.trilhas !== true) break;
      const t = state.trilhas.find((x) => x.id === String(msg.id || ''));
      if (!t) break;
      // 🎬 Tecla de OBS: em vez de som, ela comanda o OBS. A Mesa é
      // 'tools' no modo restrito, mas comandar o OBS é 🎬: quem não tem
      // esse seletor não passa pela tecla, nem por dentro da Mesa
      if (t.tipo === 'obs') { if (t.obsAcao && podeObs(ws)) obsExecutarAcao(t.obsAcao, t.obsAlvo, quemPediu(ws)); break; }
      // 🎛️ v0.122: tecla do vMix — o mesmo seletor 🎬 do modo restrito
      if (t.tipo === 'vmix') { if (t.vmixAcao && podeObs(ws)) vmixExecutarAcao(t.vmixAcao, t.vmixAlvo, quemPediu(ws)); break; }
      if (!t.url || t.tipo !== 'trilha') break;
      // Efeitos (sobrepor/recomeçar) tocam POR CIMA: a trilha de base
      // (solo/loop) continua sendo a "tocando" — como no fluxo real
      tocarTecla(t);
      break;
    }
    case 'pastaTocar': {
      // 🔊 Clique no Botão de multi ação = toca tudo de dentro em fila
      // (com as ⏱ esperas). Clicar de novo com a fila rodando = parar.
      // A 📁 pasta simples fica DE PROPÓSITO fora deste find: mesmo que um
      // cliente mande o id dela, nada toca — ela só guarda teclas.
      if (state.settings.labs?.trilhas !== true) break;
      const p = state.trilhas.find((x) => x.id === String(msg.id || '') && x.tipo === 'pasta');
      if (!p) break;
      if (pastaFila && pastaFila.id === p.id) { pararTrilha(); break; }
      tocarPasta(p.id, podeObs(ws), quemPediu(ws));
      break;
    }
    case 'trilhaParar':
      pararTrilha();
      break;
    case 'trilhaTela': {
      // 🖼️🎞️ v0.86: clicar numa tecla de imagem/vídeo mostra a mídia no
      // painel E no overlay; clicar de novo (ou msg.off) tira da tela
      if (state.settings.labs?.trilhas !== true) break;
      const t = state.trilhas.find((x) => x.id === String(msg.id || ''));
      const jaNaTela = !!(t && state.trilhaTela && state.trilhaTela.id === t.id);
      if (!t || msg.off === true || jaNaTela) { if (state.trilhaTela) setTrilhaTela(null); break; }
      if ((t.tipo !== 'imagem' && t.tipo !== 'video') || !t.url) break;
      setTrilhaTela({
        id: t.id,
        tipo: t.tipo,
        url: t.url,
        modo: t.telaModo === 'cheia' ? 'cheia' : 'janela',
        escala: t.telaEscala,
        volume: t.volume,
        loop: t.modo === 'loop', // o modo loop da tecla repete o vídeo
        // 🚀 v0.87: ajustes do player (o painel comanda, o overlay espelha)
        velocidade: 1, semDistorcao: true, qualidade: 'alta',
      });
      break;
    }
    case 'trilhaTelaAjuste': {
      // 🚀 v0.87: ajustes finos do player da tecla de mídia — velocidade
      // (0.05× a 32×, passo 0.01), 🎭 distorção de voz e nitidez de
      // exibição. Valem no painel E no overlay (estado espelhado).
      const t = state.trilhaTela;
      if (!t) break;
      if (msg.velocidade !== undefined) t.velocidade = Math.round(numeroEntre(msg.velocidade, 0.05, 32, 1) * 100) / 100;
      if (msg.semDistorcao !== undefined) t.semDistorcao = msg.semDistorcao !== false;
      if (msg.qualidade !== undefined) t.qualidade = ['alta', 'suave', 'pixelada'].includes(msg.qualidade) ? msg.qualidade : 'alta';
      broadcast({ type: 'trilhaTela', tela: t });
      break;
    }
    case 'trilhaTelaFim':
      // O vídeo terminou (avisado por quem o exibia): sai da tela sozinho —
      // menos no loop, que recomeça na própria tela
      if (state.trilhaTela && state.trilhaTela.id === String(msg.id || '') && !state.trilhaTela.loop) setTrilhaTela(null);
      break;

    // ---------- 🎞️ v0.129: Mídia direta ----------
    case 'midiaDiretaUrl': {
      const r = classificarUrlMidiaDireta(msg.url, msg.tipo);
      if (r.erro) { try { ws.send(JSON.stringify({ type: 'midiaDiretaErro', texto: r.erro })); } catch {} break; }
      const md = state.midiaDireta;
      midiaDiretaArquivos.clear(); // o arquivo local anterior (se havia) sai do ar
      md.item = { id: newInstanceId('md'), ...r.item };
      md.player = midiaDiretaPlayerInicial(md.player); // mídia nova = player zerado e pausado
      // 🏷️ v0.136: o crédito nasce sugerido pelo endereço; o «mostrar» fica
      md.credito = { texto: creditoSugerido(r.item.url), mostrar: md.credito.mostrar !== false };
      if (msg.mostrar !== undefined) md.visible = msg.mostrar === true;
      broadcastMidiaDireta();
      // 🎬 v0.133: pergunta ao site o que aquele endereço é de verdade e, se
      // for uma página, procura o ARQUIVO do vídeo nas metatags — achando,
      // vira vídeo nosso, com todos os controles. O YouTube fica de fora: o
      // quadro dele já obedece a tudo pela API oficial.
      if (!(r.item.tipo === 'embed' && r.item.embed && r.item.embed.provedor === 'youtube')) {
        conferirMidiaDaUrl(md.item.id, r.item.url, r.item.tipo, r.item.embed && r.item.embed.provedor);
      }
      break;
    }
    case 'midiaDiretaArquivo': {
      // 📂 Só o computador do programa enxerga o próprio disco
      if (ws.role !== 'local') { try { ws.send(JSON.stringify({ type: 'midiaDiretaErro', texto: 'Arquivos do computador só pelo painel aberto no próprio computador do OBS Social — pela rede, use uma URL.' })); } catch {} break; }
      // 📁 v0.132: apontou uma PASTA em vez de um arquivo? abre a pasta ali
      // mesmo, em vez de reclamar — é o que a pessoa queria dizer
      try {
        const alvo = String(msg.caminho || '').trim();
        if (alvo && fs.statSync(path.resolve(alvo)).isDirectory()) {
          const lista = listarPastaMidiaDireta(alvo);
          try { ws.send(JSON.stringify(lista.erro ? { type: 'midiaDiretaErro', texto: lista.erro } : { type: 'midiaDiretaPastas', ...lista })); } catch {}
          break;
        }
      } catch {}
      const r = registrarArquivoMidiaDireta(msg.caminho);
      if (r.erro) { try { ws.send(JSON.stringify({ type: 'midiaDiretaErro', texto: r.erro })); } catch {} break; }
      const md = state.midiaDireta;
      md.item = r.item;
      md.player = midiaDiretaPlayerInicial(md.player);
      // 🏷️ v0.136: arquivo do computador não tem site nem perfil para sugerir
      md.credito = { texto: '', mostrar: md.credito.mostrar !== false };
      if (msg.mostrar !== undefined) md.visible = msg.mostrar === true;
      broadcastMidiaDireta();
      break;
    }
    case 'midiaDiretaCredito': {
      // 🏷️ v0.136: o crédito de fonte que acompanha a mídia na tela
      const md = state.midiaDireta;
      if (typeof msg.texto === 'string') md.credito.texto = msg.texto.replace(/\s+/g, ' ').trim().slice(0, 200);
      if (msg.mostrar !== undefined) md.credito.mostrar = msg.mostrar === true;
      broadcastMidiaDireta();
      break;
    }
    case 'midiaDiretaPastas': {
      if (ws.role !== 'local') { try { ws.send(JSON.stringify({ type: 'midiaDiretaErro', texto: 'Procurar no computador só pelo painel aberto no próprio computador do OBS Social.' })); } catch {} break; }
      const r = listarPastaMidiaDireta(msg.caminho);
      try { ws.send(JSON.stringify(r.erro ? { type: 'midiaDiretaErro', texto: r.erro } : { type: 'midiaDiretaPastas', ...r })); } catch {}
      break;
    }
    case 'midiaDiretaToggle': {
      const md = state.midiaDireta;
      if (!md.item) break;
      md.visible = typeof msg.visible === 'boolean' ? msg.visible : !md.visible;
      broadcastMidiaDireta();
      break;
    }
    case 'midiaDiretaFechar':
      midiaDiretaArquivos.clear();
      state.midiaDireta.item = null;
      state.midiaDireta.visible = false;
      state.midiaDireta.player = midiaDiretaPlayerInicial(state.midiaDireta.player);
      broadcastMidiaDireta();
      break;
    case 'midiaDiretaTela': {
      const md = state.midiaDireta;
      if (msg.escala !== undefined) md.escala = Math.round(numeroEntre(msg.escala, 20, 100, 45));
      if (msg.telaCheia !== undefined) md.telaCheia = msg.telaCheia === true;
      broadcastMidiaDireta();
      break;
    }
    case 'midiaDiretaPlayer': {
      // O mesmo player remoto da mídia do inscrito (+ 🔁 repetir)
      const p = state.midiaDireta.player;
      const acao = String(msg.acao || '');
      const posicao = Math.max(0, Math.min(7 * 24 * 3600, Number(msg.posicao) || 0));
      const agoraPos = () => Math.max(0, (Number(p.posicao) || 0) + (p.estado === 'tocando' ? ((Date.now() - (Number(p.em) || Date.now())) / 1000) * (Number(p.velocidade) || 1) : 0));
      if (acao === 'play') {
        p.estado = 'tocando';
        if (Number.isFinite(Number(msg.posicao))) p.posicao = posicao;
        p.em = Date.now();
      } else if (acao === 'pause') {
        p.posicao = Number.isFinite(Number(msg.posicao)) ? posicao : agoraPos();
        p.estado = 'pausado';
        p.em = Date.now();
      } else if (acao === 'seek') {
        p.posicao = posicao;
        p.em = Date.now();
      } else if (acao === 'reiniciar') {
        p.posicao = 0;
        p.em = Date.now();
      } else if (acao === 'volume') {
        p.volume = Math.round(numeroEntre(msg.volume, 0, 100, 100));
      } else if (acao === 'velocidade') {
        if (p.estado === 'tocando') { p.posicao = agoraPos(); p.em = Date.now(); }
        p.velocidade = Math.round(numeroEntre(msg.velocidade, 0.05, 32, 1) * 100) / 100;
      } else if (acao === 'distorcao') {
        p.semDistorcao = msg.semDistorcao !== false;
      } else if (acao === 'loop') {
        p.loop = msg.loop === true;
      } else break;
      broadcastMidiaDireta();
      break;
    }
    case 'midiaDiretaInfo': {
      // O painel mediu a duração no próprio reprodutor
      const md = state.midiaDireta;
      if (!md.item) break;
      const d = Number(msg.duracao);
      md.item.duracao = Number.isFinite(d) && d > 0 ? Math.min(7 * 24 * 3600, Math.round(d * 100) / 100) : null;
      broadcastMidiaDireta();
      break;
    }
    case 'midiaDiretaFim': {
      // Acabou (avisado por quem exibia): fica pausado no fim — no 🔁 quem
      // exibe recomeça sozinho e não avisa
      const md = state.midiaDireta;
      if (!md.item || md.player.loop || md.player.estado !== 'tocando') break;
      md.player.estado = 'pausado';
      md.player.posicao = md.item.duracao || Math.max(0, (Number(md.player.posicao) || 0) + ((Date.now() - (Number(md.player.em) || Date.now())) / 1000) * (Number(md.player.velocidade) || 1));
      md.player.em = Date.now();
      broadcastMidiaDireta();
      break;
    }
    case 'trilhasImportar': {
      // 📦 O backup de perfis do Stream Deck, em base64 (só do computador local)
      let buf;
      try { buf = Buffer.from(String(msg.arquivoBase64 || ''), 'base64'); } catch { buf = null; }
      importarBackupBuffer(buf).then((r) => {
        try { ws.send(JSON.stringify({ type: 'trilhasImportadas', ...r })); } catch {}
      }).catch((err) => {
        try { ws.send(JSON.stringify({ type: 'trilhasImportadas', ok: false, erro: String((err && err.message) || err).slice(0, 200) })); } catch {}
      });
      break;
    }
    case 'trilhasCasarPasta': {
      const r = casarTrilhasComPasta(msg.pasta);
      ws.send(JSON.stringify({ type: 'trilhasCasadas', ...r }));
      break;
    }
    // ---------- 🎬 OBS Studio (Labs) ----------
    // 💠 Configuração do Pix (Labs): credenciais + certificado + banco.
    // Segredos em branco na mensagem NÃO apagam os guardados (o formulário
    // nunca recebe os segredos de volta — mandar vazio = "não mexi")
    case 'pixConfig': {
      const novo = limparPixConfig({ ...pixConfig, ...msg.config });
      if (msg.config && typeof msg.config === 'object') {
        if (!String(msg.config.clientSecret || '').trim()) novo.clientSecret = pixConfig.clientSecret;
        if (!String(msg.config.certSenha || '').trim()) novo.certSenha = pixConfig.certSenha;
      }
      Object.assign(pixConfig, novo);
      savePixConfig();
      arrancarPix();
      break;
    }
    // 💠 Pix de exemplo: um apoio de teste no painel, para conferir a aba
    // Apoios e o visual na tela sem depender do banco
    // 🛡️ Timeout/ban de inscrito do Telegram/WhatsApp, direto do painel.
    // A lista local SEMPRE vale (mensagens da pessoa somem do painel na
    // hora); no Telegram o castigo também é aplicado no grupo, se der
    // (o bot precisa ser admin — sem isso, fica só o filtro local).
    case 'moderarInscrito': {
      const rede = msg.platform === 'whatsapp' ? 'whatsapp' : msg.platform === 'telegram' ? 'telegram' : null;
      const autorId = String(msg.autorId || '').slice(0, 40);
      if (!rede || !autorId || /^(__proto__|constructor|prototype)$/.test(autorId)) break;
      const nome = String(msg.nome || '').slice(0, 80);
      const modo = String(msg.modo || '');
      if (modo === 'timeout') {
        const prazoS = Math.max(5, Math.min(30 * 86400, Number(msg.prazoSegundos) || 300));
        moderacao[rede].timeouts[autorId] = { nome, em: Date.now(), ate: Date.now() + prazoS * 1000 };
        const con = state.connectors[rede];
        if (con?.silenciar) con.silenciar(autorId, Math.floor(Date.now() / 1000) + prazoS).catch((err) => {
          broadcast({ type: 'moderacaoAviso', texto: `⏳ Castigo salvo no OBS Social, mas o grupo não aplicou: ${String(err.message).slice(0, 120)}` });
        });
      } else if (modo === 'ban') {
        moderacao[rede].bans[autorId] = { nome, em: Date.now() };
        delete moderacao[rede].timeouts[autorId];
        const con = state.connectors[rede];
        if (con?.banir) con.banir(autorId).catch((err) => {
          broadcast({ type: 'moderacaoAviso', texto: `🚫 Banimento salvo no OBS Social, mas o grupo não aplicou: ${String(err.message).slice(0, 120)}` });
        });
      } else if (modo === 'liberar') {
        delete moderacao[rede].timeouts[autorId];
        delete moderacao[rede].bans[autorId];
        const con = state.connectors[rede];
        if (con?.liberar) con.liberar(autorId).catch(() => {});
      } else break;
      // Mensagens da pessoa saem das colunas na hora (menos ao liberar) —
      // o casamento é pelo authorId, que o conector sempre manda
      if (modo !== 'liberar') removerMensagens({ platform: rede, ids: [], autor: autorId });
      saveModeracao();
      broadcastModeracao();
      break;
    }
    // 💬 Resposta do apresentador a um inscrito — texto e/ou 📎 anexos
    // (v0.75: o apresentador manda de volta o mesmo que os inscritos
    // mandam — foto, áudio, vídeo e arquivo, nas duas redes)
    case 'responderInscrito': {
      const rede = String(msg.platform || '');
      const con = state.connectors[rede];
      const texto = String(msg.texto || '').trim();
      const anexos = [];
      if (Array.isArray(msg.arquivos)) {
        for (const a of msg.arquivos.slice(0, 5)) {
          const casou = /^\/midia-inscritos\/([A-Za-z0-9]+-[A-Za-z0-9]+\.[A-Za-z0-9]{1,8})$/.exec(String((a && a.url) || ''));
          if (!casou) continue;
          try {
            const buffer = fs.readFileSync(path.join(MIDIA_INSCRITOS_DIR, casou[1]));
            const extAnexo = path.extname(casou[1]).slice(1).toLowerCase();
            const nome = String((a && a.nome) || '').trim().slice(0, 80) || casou[1];
            anexos.push({ buffer, nome, mime: MIDIA_MIME[extAnexo] || 'application/octet-stream', tipo: tipoDeAnexoResposta(extAnexo) });
          } catch { /* sumiu da quarentena: segue sem ele */ }
        }
      }
      if (!con?.responder || (!texto && !anexos.length)) break;
      const assinatura = String(msg.assinatura || '').trim().slice(0, 60);
      // ✍️ v0.145: o nome do apresentador entra onde ele escolher — em cima,
      // anunciando quem fala, ou no fim, assinando. Nos dois casos com uma
      // linha em branco separando do recado, para não virar um bloco só.
      const noRodape = msg.assinaturaModo === 'rodape';
      const corpo = !assinatura ? texto
        : noRodape ? `${texto}\n\n— assinado: ${assinatura}`
        : `${assinatura} diz:\n\n${texto}`;
      (async () => {
        if (texto) await con.responder(msg.chatId, corpo, msg.replyTo);
        for (let i = 0; i < anexos.length; i++) {
          if (typeof con.responderMidia !== 'function') throw new Error('esta rede ainda não envia anexos');
          await con.responderMidia(msg.chatId, anexos[i], (!texto && i === 0) ? msg.replyTo : undefined);
        }
      })()
        .then(() => ws.send(JSON.stringify({ type: 'respostaEnviada', ok: true })))
        .catch((err) => ws.send(JSON.stringify({ type: 'respostaEnviada', ok: false, erro: String(err.message || err).slice(0, 160) })));
      break;
    }
    // 🔊 v0.77: o overlay avisa um momento de áudio (entrada/saída/fim de
    // um widget) — repassamos para o painel tocar a parte dele, segurando
    // repetições de telas gêmeas (horizontal + vertical abertas juntas)
    case 'audioOverlayMomento': {
      const chave = String(msg.chave || '');
      const momento = String(msg.momento || '');
      if (!AUDIO_OV_CHAVES.has(chave) || !AUDIO_OV_MOMENTOS.includes(momento)) break;
      const id = chave + ':' + momento;
      const agora = Date.now();
      if (agora - (audioOvUltimos.get(id) || 0) < 400) break;
      audioOvUltimos.set(id, agora);
      if (audioOvUltimos.size > 200) audioOvUltimos.clear();
      broadcast({ type: 'audioOverlayToca', chave, momento });
      break;
    }
    case 'pixTeste':
      if (state.settings.labs?.pix === true || state.settings.labs?.donations === true) {
        emitDonation({
          name: 'Apoiador Pix',
          amountText: 'R$ 20,00',
          message: 'Pix de teste — é assim que a mensagem do pagador aparece! 💠',
          rotulo: 'Pix',
        });
      }
      break;
    // 🎙️ Transcrição (Labs): baixar/cancelar/apagar modelo e motor, e o
    // "tentar de novo" de um rascunho que deu errado
    // 💬 WhatsApp modo local: instalar a biblioteca / apagar a sessão
    case 'whatsappLib': {
      if (msg.acao === 'instalar') waLibInstalar();
      else if (msg.acao === 'apagarSessao') {
        disconnect('whatsapp');
        try { fs.rmSync(WA_SESSAO_DIR, { recursive: true, force: true }); } catch {}
        broadcast({ type: 'waQr', matriz: null });
        broadcastWaLib();
      }
      break;
    }
    case 'transcricaoModelo': {
      const nome = String(msg.modelo || '');
      if (msg.acao === 'baixar') transcritor.baixarModelo(nome);
      else if (msg.acao === 'cancelar') transcritor.cancelarDownload('modelo:' + nome);
      else if (msg.acao === 'apagar') transcritor.apagarModelo(nome);
      break;
    }
    case 'transcricaoMotor': {
      const alvo = msg.alvo === 'ffmpeg' ? 'ffmpeg' : 'motor';
      if (msg.acao === 'baixar') transcritor.baixarMotor(alvo);
      else if (msg.acao === 'cancelar') transcritor.cancelarDownload(alvo);
      break;
    }
    case 'ytdlpMotor': {
      if (msg.acao === 'baixar') extratorYtDlp.baixar();
      else if (msg.acao === 'cancelar') extratorYtDlp.cancelar();
      else if (msg.acao === 'apagar') extratorYtDlp.apagar();
      break;
    }
    case 'transcrever': {
      const url = String(msg.url || '');
      if (url.startsWith('/midia-inscritos/')) {
        delete transcricoes[url];
        transcreverMidia({ url }, true);
      }
      break;
    }
    case 'obsConfig':
      if (typeof msg.host === 'string') obsConfig.host = hostDoObs(msg.host);
      if (msg.port !== undefined) obsConfig.port = Math.round(numeroEntre(msg.port, 1, 65535, 4455));
      if (typeof msg.password === 'string') obsConfig.password = msg.password.slice(0, 200);
      saveObsConfig();
      desligarObs(null);
      if (state.settings.labs?.obs === true) conectarObs();
      else broadcastObs();
      break;
    // 🎛️ v0.53: TODA ação do OBS passa por aqui — o painel e a Mesa de
    // Trilhas mandam a mesma mensagem, com a ação e o alvo dela
    case 'obsAcao': {
      const acao = String(msg.acao || '');
      const alvo = sanitizeObsAlvo(acao, msg.alvo);
      if (alvo) obsExecutarAcao(acao, alvo, quemPediu(ws));
      break;
    }
    // As mensagens antigas continuam valendo (painéis abertos, atalhos
    // salvos): cada uma é um atalho para a ação equivalente
    case 'obsCena': {
      const cena = String(msg.cena || '').slice(0, 200);
      if (cena) obsExecutarAcao('cena', { nome: cena, modo: 'auto' }, quemPediu(ws));
      break;
    }
    case 'obsTransicao':
      obsExecutarAcao('transicaoEstudio', {}, quemPediu(ws));
      break;
    case 'obsMudo': {
      const fonte = String(msg.fonte || '').slice(0, 200);
      if (fonte) obsExecutarAcao('audioMudo', { fonte, modo: 'alternar' }, quemPediu(ws));
      break;
    }
    case 'obsAoVivo':
      // O painel SEMPRE pergunta "tem certeza?" antes de mandar esta
      obsExecutarAcao('transmitir', { modo: msg.acao === 'parar' ? 'parar' : 'iniciar' }, quemPediu(ws));
      break;
    case 'obsGravacao':
      obsExecutarAcao('gravar', { modo: msg.acao === 'parar' ? 'parar' : 'iniciar' }, quemPediu(ws));
      break;
    case 'obsAtualizar':
      if (state.settings.labs?.obs === true) obsAtualizarTudo();
      break;
    // ---------- 🎛️ vMix (Labs, v0.122) — o espelho das mensagens do OBS ----------
    case 'vmixConfig':
      if (typeof msg.host === 'string') vmixConfig.host = hostDoObs(msg.host);
      if (msg.port !== undefined) vmixConfig.port = Math.round(numeroEntre(msg.port, 1, 65535, 8099));
      saveVmixConfig();
      desligarVmix(null);
      if (state.settings.labs?.vmix === true) conectarVmix();
      else broadcastVmix();
      break;
    case 'vmixAcao': {
      const acao = String(msg.acao || '');
      const alvo = sanitizeVmixAlvo(acao, msg.alvo);
      if (alvo) vmixExecutarAcao(acao, alvo, quemPediu(ws));
      break;
    }
    case 'vmixAtualizar':
      if (state.settings.labs?.vmix === true) vmixAtualizarTudo();
      break;
    // ---------- 🕹️ Controle externo (Labs, v0.126) ----------
    case 'controleConfig':
      // Token novo: o antigo para de valer na hora (só do computador local)
      if (msg.novoToken === true) { controleNovoToken(); broadcastControle(); }
      break;
    case 'clipboard': {
      // 📋 v0.90: mandar texto ADICIONA uma entrada ao histórico (sem
      // limite de tamanho — o texto inteiro fica no servidor e as telas
      // recebem a prévia). O formato antigo ({text}) continua entrando.
      const texto = String(msg.text ?? '');
      if (texto.trim()) {
        clipboardJuntar({ id: newInstanceId('clip'), tipo: 'texto', texto, nome: '', arquivo: '', tamanho: texto.length, em: Date.now() });
      }
      break;
    }
    case 'clipboardApagar': {
      const id = String(msg.id || '');
      const alvo = state.clipboard.find((e) => e.id === id);
      if (!alvo) break;
      clipApagarArquivoFisico(alvo);
      state.clipboard = state.clipboard.filter((e) => e.id !== id);
      persistClipboard();
      clipboardAvisar();
      break;
    }
    case 'clipboardLimpar':
      for (const e of state.clipboard) clipApagarArquivoFisico(e);
      state.clipboard = [];
      persistClipboard();
      clipboardAvisar();
      break;
    case 'deleteMedia': {
      // 📚 v0.88: 'trilhas/arquivo' apaga da biblioteca da Mesa
      const daMesa = String(msg.name || '').startsWith('trilhas/');
      const name = path.basename(String(msg.name || ''));
      if (!name) break;
      const filePath = path.join(daMesa ? TRILHAS_UP_DIR : UPLOADS_DIR, name);
      if (filePath.startsWith(UPLOADS_DIR)) {
        try { fs.unlinkSync(filePath); } catch {}
        const url = '/uploads/' + (daMesa ? 'trilhas/' : '') + encodeURIComponent(name);
        const urlCrua = '/uploads/' + (daMesa ? 'trilhas/' : '') + name; // trilhas antigas guardam sem codificar
        const eraEle = (u) => u === url || u === urlCrua;
        // Tira o arquivo excluido de todos os lugares em que estava em uso
        let changed = false;
        for (const key of ['mediaUrl', 'mediaCard', 'mediaFullscreen']) {
          if (eraEle(state.settings[key])) { state.settings[key] = ''; changed = true; }
        }
        for (const conf of Object.values(state.settings.widgets || {})) {
          if (eraEle(conf.mediaUrl)) { conf.mediaUrl = ''; changed = true; }
        }
        // Sons tambem: sorteio/timer voltam ao silencio e a trilha fica
        // pendente (como as importadas sem arquivo), em vez de apontar
        // para um endereco morto
        if (state.settings.raffle && eraEle(state.settings.raffle.somUrl)) { state.settings.raffle.somUrl = ''; changed = true; }
        if (state.settings.relogio && eraEle(state.settings.relogio.somUrl)) { state.settings.relogio.somUrl = ''; changed = true; }
        let trilhasMudou = false;
        for (const t of state.trilhas || []) {
          if (eraEle(t.url)) { t.url = ''; trilhasMudou = true; }
        }
        if (trilhasMudou) {
          persistTrilhas();
          broadcast({ type: 'trilhas', trilhas: state.trilhas });
        }
        if (changed) {
          saveSettings();
          broadcast({ type: 'settings', settings: state.settings });
        }
        broadcast({ type: 'media', media: listMedia() });
      }
      break;
    }
    case 'save':
      // 🔒 v0.127.1: do tamanho de um comentário, como no destaque — a fila
      // inteira vai para o disco e para todas as telas a cada mudança
      if (msg.message && typeof msg.message === 'object' && msg.message.id && JSON.stringify(msg.message).length <= 64 * 1024
          && !state.saved.some((m) => m.id === msg.message.id)) {
        state.saved.push(msg.message);
        if (state.saved.length > MAX_SAVED) state.saved.splice(0, state.saved.length - MAX_SAVED);
        persistSaved();
        broadcast({ type: 'saved', saved: state.saved });
      }
      break;
    case 'unsave':
      state.saved = state.saved.filter((m) => m.id !== msg.id);
      persistSaved();
      broadcast({ type: 'saved', saved: state.saved });
      break;
    case 'test': {
      // atrasMs (opcional, só para testes): simula uma mensagem antiga —
      // como as recuperadas do histórico — para validar a ordenação
      const atras = Math.max(0, Math.min(86400000, Number(msg.atrasMs) || 0));
      sendTestMessage(atras);
      break;
    }
    case 'testLimpar': {
      // 🧪 v0.137: tira da frente TUDO o que o 💬 do painel inventou — das
      // colunas, da fila, dos salvos e do destaque — e devolve o 🎁 sorteio ao
      // que ele era, sem as fichas de mentira. Nada de real é tocado.
      removerMensagens({ teste: true });
      let fichas = 0;
      // as desta sessão + as das amostras (cobre o que sobrou de antes, quando
      // o programa ainda não anotava quem era de mentira)
      const chaves = new Set(participantesDeTeste);
      for (const amostra of TEST_SAMPLES) {
        chaves.add(chaveParticipante({
          platform: amostra.platform,
          authorId: amostra.authorId || null,
          authorLogin: amostra.authorLogin || null,
          author: amostra.author,
        }));
      }
      for (const chave of chaves) {
        if (state.participants.delete(chave)) fichas++;
      }
      participantesDeTeste.clear();
      if (fichas) broadcastParticipantes();
      console.log(`  🧪 Comentários de teste apagados${fichas ? ` (e ${fichas} ficha(s) fora do sorteio)` : ''}.`);
      break;
    }
    case 'testApagar': {
      // Simula a moderação apagando: usado pelos testes e pelo botão de
      // teste, para ver como o painel e a live reagem sem precisar de um
      // moderador de verdade apagando algo no meio da live.
      const plataformas = ['youtube', 'twitch', 'kick', 'bilibili', 'doacao', 'telegram', 'whatsapp'];
      const plataforma = plataformas.includes(msg.platform) ? msg.platform : null;
      removerMensagens({
        platform: plataforma,
        ids: Array.isArray(msg.ids) ? msg.ids.slice(0, 500).map(String) : [],
        autor: msg.autor ? String(msg.autor).slice(0, 120) : null,
        tudo: msg.tudo === true,
      });
      break;
    }
    case 'qrShow': {
      const url = String(msg.url || '').trim();
      if (!url) break;
      const inst = findQr(msg.id);
      inst.name = String(msg.name || '').trim().slice(0, 60);
      inst.url = url.slice(0, 1000);
      try {
        inst.matrix = makeQrMatrix(inst.url);
        inst.visible = true;
        scheduleWidgetHide('qr', inst.id, () => {
          if (inst.visible) { inst.visible = false; broadcastQrs(); }
        });
      } catch {
        inst.matrix = null;
        inst.visible = false;
      }
      broadcastQrs();
      break;
    }
    case 'qrHide': {
      const inst = findQr(msg.id);
      if (inst) inst.visible = false;
      broadcastQrs();
      break;
    }
    case 'qrAdd':
      // "Adicionar mais..." — cada um fica salvo em disco, até o teto
      if (state.qrs.length >= MAX_INSTANCIAS) break;
      state.qrs.push(emptyQr());
      broadcastQrs();
      break;
    case 'qrRemove': {
      const idx = state.qrs.findIndex((q) => q.id === msg.id);
      if (idx > 0) { state.qrs.splice(idx, 1); broadcastQrs(); } // o principal nao sai
      break;
    }
    case 'qrStyle': {
      // Estilo proprio de um QR adicional: independente do principal
      const inst = state.qrs.find((q) => q.id === msg.id);
      if (inst) {
        inst.style = { ...(inst.style || {}), ...sanitizeStyle(msg.style) };
        broadcastQrs();
      }
      break;
    }
    case 'qrMove': {
      const inst = state.qrs.find((q) => q.id === msg.id);
      if (inst) {
        // tela 'v': posição do overlay vertical (independente da horizontal)
        if (msg.tela === 'v') { inst.vx = Number(msg.x) || 0; inst.vy = Number(msg.y) || 0; }
        else { inst.x = Number(msg.x) || 0; inst.y = Number(msg.y) || 0; }
        broadcastQrs();
      }
      break;
    }
    case 'raffleDraw': {
      pararRespostaTimer();
      const winners = drawWinners(3);
      state.raffle = {
        winners,
        visible: true,
        drawnAt: Date.now(),
        // 🪟 v0.78: qual navegador sorteou — nos outros a janela chega minimizada
        origem: String(msg.origem || '').slice(0, 40),
        // 💬 A primeira resposta de cada ganhador + o ⏱ tempo de resposta
        respostas: winners.map(() => null),  // { texto, em } quando o ganhador falar
        expirados: winners.map(() => false), // ⌛ perdeu o tempo de resposta
        vez: null,                           // de quem é o timer agora (0|1|2|null)
        prazoAte: null,                      // epoch ms do fim do timer da vez
      };
      // Fica registrado no log do dia quem ganhou cada sorteio.
      appendLog({ t: 'raffle', winners: state.raffle.winners, at: state.raffle.drawnAt });
      // O timer do 1º colocado só conta depois do dado 🎲 girar na tela
      if (state.settings.raffle?.respostaTimer === true && winners.length) {
        const dadoMs = numeroEntre(state.settings.raffle.dadoSegundos, 0, 15, 3) * 1000;
        raffleArmarVez(state.raffle, 0, dadoMs);
      }
      broadcast({ type: 'raffle', raffle: state.raffle });
      // Auto-esconder do widget: com o ⏱ tempo de resposta em andamento, o
      // sumiço automático espera a rodada acabar (senão matava o timer no
      // meio, sem aviso e sem como reexibir).
      const esconderSorteio = () => {
        if (!state.raffle?.visible) return;
        if (state.raffle.vez !== null) { scheduleWidgetHide('raffle', null, esconderSorteio); return; }
        state.raffle.visible = false;
        pararRespostaTimer();
        broadcast({ type: 'raffle', raffle: state.raffle });
      };
      scheduleWidgetHide('raffle', null, esconderSorteio);
      break;
    }
    case 'raffleHide':
      if (state.raffle) state.raffle.visible = false;
      pararRespostaTimer();
      broadcast({ type: 'raffle', raffle: state.raffle });
      break;
    case 'raffleReset':
      state.participants.clear();
      broadcast({ type: 'participants', count: 0, porRede: {}, fichas: 0 });
      break;
    case 'likemeter':
      setLikemeter(!!msg.enabled);
      if (msg.enabled) {
        scheduleWidgetHide('likemeter', null, () => {
          if (state.likemeter.enabled) setLikemeter(false);
        });
      }
      break;
    // ---------- 📢 Avisos ----------
    // v0.128: cada operação mira um aviso pelo id; sem id (ou id que não
    // existe) é o principal — o controle externo e clientes antigos seguem
    // funcionando sem mudar nada
    case 'avisoSet': {
      const inst = findAviso(msg.id);
      if (!inst) break;
      if (msg.texto !== undefined) inst.texto = String(msg.texto ?? '').slice(0, 1000);
      if (msg.label !== undefined) inst.label = String(msg.label || 'Aviso').slice(0, 30);
      // Escrever um aviso novo já o coloca na tela, se pedido
      if (typeof msg.visible === 'boolean') inst.visible = msg.visible;
      // ⏰ v0.80: «sumir sozinho» — data/hora do relógio e/ou tempo restante
      // do timer (campos em zero são o padrão e não fazem nada)
      if (msg.sumir !== undefined) inst.sumir = sanitizeSumir(msg.sumir);
      if (inst.visible && inst.texto) {
        scheduleWidgetHide('aviso', inst.id, () => { inst.visible = false; persistAvisos(); broadcastAvisos(); });
      }
      persistAvisos();
      broadcastAvisos();
      break;
    }
    case 'avisoToggle': {
      const inst = findAviso(msg.id);
      if (!inst) break;
      inst.visible = typeof msg.visible === 'boolean' ? msg.visible : !inst.visible;
      if (inst.visible && inst.texto) {
        scheduleWidgetHide('aviso', inst.id, () => { inst.visible = false; persistAvisos(); broadcastAvisos(); });
      }
      persistAvisos();
      broadcastAvisos();
      break;
    }
    case 'avisoNew': {
      if (state.avisos.length >= MAX_INSTANCIAS) break;
      state.avisos.push(defaultAviso());
      persistAvisos();
      broadcastAvisos();
      break;
    }
    case 'avisoRemove': {
      // O principal (o primeiro) nunca sai
      const idx = state.avisos.findIndex((a) => a.id === msg.id);
      if (idx > 0) {
        state.avisos.splice(idx, 1);
        persistAvisos();
        broadcastAvisos();
      }
      break;
    }
    case 'avisoLabel':
      updateAviso(msg.id, { label: String(msg.label || 'Aviso').slice(0, 30) });
      break;
    case 'avisoStyle': {
      const inst = findAviso(msg.id);
      if (!inst) break;
      inst.style = { ...(inst.style || {}), ...sanitizeStyle(msg.style) };
      persistAvisos();
      broadcastAvisos();
      break;
    }
    case 'avisoMove': {
      const inst = findAviso(msg.id);
      if (!inst) break;
      if (msg.tela === 'v') { inst.vx = Number(msg.x) || 0; inst.vy = Number(msg.y) || 0; }
      else { inst.x = Number(msg.x) || 0; inst.y = Number(msg.y) || 0; }
      persistAvisos();
      broadcastAvisos();
      break;
    }

    // ---------- 🕐 Relógio / cronômetro / timer (v0.80: independentes) ----------
    case 'relogioSet': {
      // v0.80: só ajusta a duração do timer — a aba escolhida no painel é
      // local de cada navegador e trocar de aba não para mais nada
      if (msg.duracao !== undefined) {
        state.relogio.timer.duracao = Math.max(1000, Math.min(100 * 86400000, Math.floor(Number(msg.duracao) || 0)));
      }
      broadcast({ type: 'relogio', relogio: relogioPublico() });
      break;
    }
    case 'relogioToggle': {
      // v0.80: cada instrumento tem o próprio «mostrar na tela»
      const alvo = ['relogio', 'cronometro', 'timer'].includes(msg.alvo) ? msg.alvo : 'relogio';
      const inst = state.relogio[alvo];
      inst.visible = typeof msg.visible === 'boolean' ? msg.visible : !inst.visible;
      broadcast({ type: 'relogio', relogio: relogioPublico() });
      break;
    }
    case 'cronometro': {
      // acao: iniciar | pausar | zerar — mexe SÓ no cronômetro
      const c = state.relogio.cronometro;
      if (msg.acao === 'iniciar' && !c.rodando) { c.rodando = true; c.inicio = Date.now(); }
      else if (msg.acao === 'pausar' && c.rodando) { c.acumulado += Date.now() - c.inicio; c.rodando = false; }
      else if (msg.acao === 'zerar') { c.rodando = false; c.inicio = 0; c.acumulado = 0; }
      broadcast({ type: 'relogio', relogio: relogioPublico() });
      break;
    }
    case 'timer': {
      // acao: iniciar | pausar | zerar (duracao em ms, opcional no iniciar)
      const t = state.relogio.timer;
      if (msg.duracao !== undefined) {
        // v0.80: o timer aceita dias e horas — teto de 100 dias
        t.duracao = Math.max(1000, Math.min(100 * 86400000, Math.floor(Number(msg.duracao) || 0)));
      }
      if (msg.acao === 'iniciar') {
        if (!t.rodando) {
          // recomeça do zero quando já tinha acabado
          if (t.acumulado >= t.duracao) t.acumulado = 0;
          t.rodando = true;
          t.inicio = Date.now();
          t.tocouFim = 0;
        }
      } else if (msg.acao === 'pausar' && t.rodando) {
        t.acumulado += Date.now() - t.inicio;
        t.rodando = false;
      } else if (msg.acao === 'zerar') {
        t.rodando = false; t.inicio = 0; t.acumulado = 0; t.tocouFim = 0;
      }
      broadcast({ type: 'relogio', relogio: relogioPublico() });
      break;
    }
    case 'winstreakToggle': {
      const inst = findWinstreak(msg.id);
      if (inst) {
        updateWinstreak(inst.id, { visible: !inst.visible });
        if (inst.visible) {
          scheduleWidgetHide('winstreak', inst.id, () => {
            if (inst.visible) updateWinstreak(inst.id, { visible: false });
          });
        }
      }
      break;
    }
    case 'winstreakAdd': {
      // passo: o botão segurado acelera (1, 2, 5, 10...) — vem do painel
      const inst = findWinstreak(msg.id);
      const passo = Math.max(1, Math.min(100, Number(msg.passo) || 1));
      if (inst) updateWinstreak(inst.id, { wins: inst.wins + passo });
      break;
    }
    case 'winstreakSub': {
      const inst = findWinstreak(msg.id);
      const passo = Math.max(1, Math.min(100, Number(msg.passo) || 1));
      if (inst) updateWinstreak(inst.id, { wins: Math.max(0, inst.wins - passo) });
      break;
    }
    case 'winstreakRecord': {
      // Corrige o recorde para mais ou para menos (ex.: adicionou sem querer).
      // Nunca fica abaixo das vitórias atuais — seria um recorde impossível.
      const inst = findWinstreak(msg.id);
      if (!inst) break;
      const passo = Math.max(1, Math.min(100, Number(msg.passo) || 1));
      const delta = msg.delta < 0 ? -passo : passo;
      updateWinstreak(inst.id, { record: Math.max(inst.wins, Math.max(0, (inst.record || 0) + delta)) });
      break;
    }
    case 'winstreakSet': {
      // Digitar os números direto no painel (vitórias e/ou recorde)
      const inst = findWinstreak(msg.id);
      if (!inst) break;
      const limpa = (v) => Math.max(0, Math.min(999999, Math.floor(Number(v) || 0)));
      const patch = {};
      if (msg.wins !== undefined) patch.wins = limpa(msg.wins);
      if (msg.record !== undefined) patch.record = limpa(msg.record);
      // recorde digitado abaixo das vitórias sobe junto (updateWinstreak cuida)
      updateWinstreak(inst.id, patch);
      break;
    }
    case 'winstreakLabel': {
      const inst = findWinstreak(msg.id);
      if (inst) updateWinstreak(inst.id, { label: String(msg.label || '').slice(0, 30) || 'Solo' });
      break;
    }
    case 'winstreakReset': {
      // Com id, zera so aquele; sem id, todos (compatibilidade)
      const targets = msg.id ? [findWinstreak(msg.id)].filter(Boolean) : state.winstreaks;
      for (const inst of targets) {
        inst.wins = 0;
        if (msg.all) inst.record = 0;
      }
      persistWinstreaks();
      broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
      break;
    }
    case 'winstreakNew':
      // "Adicionar mais..." — cada um fica salvo em disco, até o teto
      if (state.winstreaks.length >= MAX_INSTANCIAS) break;
      state.winstreaks.push(defaultWinstreak());
      persistWinstreaks();
      broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
      break;
    case 'winstreakRemove': {
      const idx = state.winstreaks.findIndex((w) => w.id === msg.id);
      if (idx > 0) { // o principal nao sai
        state.winstreaks.splice(idx, 1);
        persistWinstreaks();
        broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
      }
      break;
    }
    case 'winstreakStyle': {
      // Estilo proprio de um winstreak adicional: independente do principal
      const inst = state.winstreaks.find((w) => w.id === msg.id);
      if (inst) {
        inst.style = { ...(inst.style || {}), ...sanitizeStyle(msg.style) };
        persistWinstreaks();
        broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
      }
      break;
    }
    case 'winstreakMove': {
      const inst = state.winstreaks.find((w) => w.id === msg.id);
      if (inst) {
        if (msg.tela === 'v') { inst.vx = Number(msg.x) || 0; inst.vy = Number(msg.y) || 0; }
        else { inst.x = Number(msg.x) || 0; inst.y = Number(msg.y) || 0; }
        persistWinstreaks();
        broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
      }
      break;
    }
    case 'audienceToggle':
      state.audience.visible = !state.audience.visible;
      broadcast({ type: 'audience', audience: state.audience });
      if (state.audience.visible) {
        scheduleWidgetHide('audience', null, () => {
          if (state.audience.visible) {
            state.audience.visible = false;
            broadcast({ type: 'audience', audience: state.audience });
          }
        });
      }
      break;
    case 'audienceTest':
      // Usado pelos testes automatizados para simular contagens.
      if (msg.platforms && typeof msg.platforms === 'object') {
        for (const [platform, count] of Object.entries(msg.platforms)) {
          if (/^(__proto__|constructor|prototype)$/.test(platform)) continue;
          state.audience.platforms[platform] = { count: Number(count) || 0, updatedAt: Date.now() };
        }
        broadcast({ type: 'audience', audience: state.audience });
      }
      break;
    // ---------- 🧪 Exemplo de QUALQUER overlay (v0.99) ----------
    // O 🧪 do editor sempre foi só do comentário em destaque. Agora ele
    // enche o overlay ESCOLHIDO com um exemplo de mentira, para dar o que
    // ajustar na tela — e o "tirar da tela" devolve exatamente o que estava
    // no ar antes (o texto do seu aviso, o seu QR, a sua winstreak...).
    case 'exemploOverlay': {
      const alvo = String(msg.alvo || '');
      if (!EXEMPLO_ALVOS.has(alvo)) break;
      const ligar = msg.ligar !== false;
      if (!ligar) { exemploOverlayFora(alvo); avisarExemplo(); break; }
      exemploOverlayFora(); // um exemplo por vez
      exemploOverlayNoAr(alvo);
      avisarExemplo();
      break;
    }
    case 'clearOverlays':
      // Limpa tudo da tela, MENOS o QR code (que tem botao proprio).
      exemploAntes = null; // 🧪 limpou a tela: não há mais o que devolver
      broadcast({ type: 'exemplo', alvo: null });
      state.featured = null;
      if (state.raffle) state.raffle.visible = false;
      pararRespostaTimer();
      setLikemeter(false);
      for (const inst of state.winstreaks) inst.visible = false;
      persistWinstreaks();
      state.audience.visible = false;
      state.avatarZoom = { ...state.avatarZoom, visible: false };
      state.avatarZooms = []; // 🪟 v0.79: as instâncias extras saem juntas
      for (const a of state.avisos) a.visible = false; // 📢 v0.128: todos os avisos
      persistAvisos();
      // v0.80: os três instrumentos saem da tela (mas nada para de contar)
      state.relogio.relogio.visible = false;
      state.relogio.cronometro.visible = false;
      state.relogio.timer.visible = false;
      if (state.trilhaTela) setTrilhaTela(null); // 🖼️🎞️ v0.86
      // 🎞️ v0.129: a mídia direta sai da tela (o item fica carregado no painel)
      if (state.midiaDireta.visible) { state.midiaDireta.visible = false; state.midiaDireta.player = midiaDiretaPlayerInicial(state.midiaDireta.player); broadcastMidiaDireta(); }
      broadcast({ type: 'featured', featured: null });
      broadcast({ type: 'avatarZoom', avatarZoom: state.avatarZoom });
      broadcast({ type: 'avatarZooms', lista: state.avatarZooms });
      broadcast({ type: 'raffle', raffle: state.raffle });
      broadcast({ type: 'winstreak', winstreaks: state.winstreaks });
      broadcast({ type: 'audience', audience: state.audience });
      broadcastAvisos();
      broadcast({ type: 'relogio', relogio: relogioPublico() });
      break;
  }
}

// ===========================================================================
// 🕹️ v0.126: Controle externo (Labs) — Stream Deck, Loupedeck, Razer Stream
// Controller, Bitfocus Companion, Touch Portal, Macro Deck, atalhos do
// celular, Node-RED... Qualquer coisa que saiba abrir um endereço comanda o
// OBS Social por HTTP:
//     GET/POST http://<ip>:<porta>/api/controle/<ação>?token=...&param=...
// Cada endereço vira UMA operação do painel e passa pelo MESMO despachante
// (tratarMensagem), com um ws de mentira que só recolhe as respostas. Os
// portões continuam os mesmos: o token vale como a senha da rede (papel
// 'full'); o que é só do computador local (LOCAL_ONLY_OPS) fica de fora
// mesmo com token; de fora da rede local nada entra (o 'blocked' barra antes).
// Além das ações prontas, /api/controle/op aceita QUALQUER operação do
// painel pelo nome — é o "controle bem livre" pedido.
// ===========================================================================
function loadControleConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONTROLE_FILE, 'utf8'));
    // 🔒 v0.127.1: o token vale como a senha da rede — no disco fica
    // embaralhado como as outras senhas (os de antes, em claro, seguem
    // valendo e passam a ser gravados embaralhados na próxima gravação)
    const token = typeof raw.token === 'string' && raw.token.startsWith('enc-v1:') ? abrirSegredo(raw.token) : raw.token;
    if (typeof token === 'string' && /^[a-f0-9]{40}$/.test(token)) {
      return { token, criadoEm: Number(raw.criadoEm) || Date.now() };
    }
  } catch {}
  return null;
}
let controleConfig = loadControleConfig();
function saveControleConfig() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    gravarPrivado(CONTROLE_FILE, JSON.stringify({ ...controleConfig, token: guardarSegredo(controleConfig.token) }, null, 2));
  } catch (err) { console.error('Não consegui salvar o token do controle externo:', err.message); }
}
function controleNovoToken() {
  controleConfig = { token: crypto.randomBytes(20).toString('hex'), criadoEm: Date.now() };
  saveControleConfig();
  return controleConfig;
}
// O token nasce na primeira vez que alguém com controle precisa dele
function controleToken() {
  if (!controleConfig) controleNovoToken();
  return controleConfig.token;
}

// Estado vivo: quantas ações chegaram, a última, e as tentativas erradas por IP
const controleRt = { total: 0, ultimo: null, falhas: new Map() };

function controleResumo(ws) {
  const viewer = !!(ws && ws.role === 'viewer');
  const lan = lanAddress();
  return {
    ligado: state.settings.labs?.controle === true,
    // O token é a chave da casa: espectadores do modo restrito não o veem
    token: viewer ? null : controleToken(),
    criadoEm: viewer ? null : (controleConfig ? controleConfig.criadoEm : null),
    total: controleRt.total,
    ultimo: controleRt.ultimo,
    urlLocal: `http://127.0.0.1:${PORT}`,
    urlRede: lan ? `http://${lan}:${PORT}` : null,
  };
}
function broadcastControle() {
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(JSON.stringify({ type: 'controle', controle: controleResumo(client) }));
  }
}

// Token confere? Compara em tempo constante e conta as erradas por IP
// (20 em 10 minutos = bloqueado até a janela passar) — 40 hex não se
// adivinha, mas ninguém precisa poder tentar à vontade.
function controleTokenConfere(token, ip) {
  const agora = Date.now();
  const f = controleRt.falhas.get(ip) || { count: 0, resetAt: agora + 10 * 60 * 1000 };
  if (agora > f.resetAt) { f.count = 0; f.resetAt = agora + 10 * 60 * 1000; }
  // 🔒 v0.127.1: o token CERTO sempre passa — antes, 20 pedidos errados
  // (que uma página qualquer dispara com <img>) trancavam o IP e o Stream
  // Deck no mesmo computador parava por 10 minutos
  const certo = controleToken();
  // 🔒 v0.127.1: compara o tamanho em BYTES — um token com um caractere
  // acentuado tinha o mesmo número de letras mas mais bytes, e o
  // timingSafeEqual estourava (fechava o programa, sem precisar de senha)
  const a = Buffer.from(typeof token === 'string' ? token : ''), b = Buffer.from(certo);
  const ok = a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
  if (ok) { controleRt.falhas.delete(ip); return 'ok'; }
  if (f.count >= 20) return 'bloqueado';
  f.count += 1;
  controleRt.falhas.set(ip, f);
  if (controleRt.falhas.size > 1000) {
    for (const [k, v] of controleRt.falhas) if (agora > v.resetAt) controleRt.falhas.delete(k);
  }
  return 'errado';
}

// ---------- utilidades dos parâmetros ----------
// Duração: "90", "90s", "5m", "1h", "1:30", "0:05:00" — devolve ms
function controleDuracaoMs(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return undefined;
  let m;
  if ((m = /^(\d+):(\d{1,2})(?::(\d{1,2}))?$/.exec(s))) {
    return m[3] !== undefined
      ? ((+m[1]) * 3600 + (+m[2]) * 60 + (+m[3])) * 1000
      : ((+m[1]) * 60 + (+m[2])) * 1000;
  }
  if ((m = /^(\d+(?:[.,]\d+)?)\s*(ms|s|seg|m|min|h)?$/.exec(s))) {
    const n = parseFloat(m[1].replace(',', '.'));
    const u = m[2] || 's';
    return Math.round(n * (u === 'ms' ? 1 : u === 'h' ? 3600000 : (u === 'm' || u === 'min') ? 60000 : 1000));
  }
  return undefined;
}
function controleBool(v, padrao) {
  if (v === undefined || v === null || v === '') return padrao;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'sim', 'on', 'yes', 'ligar', 'mostrar'].includes(s)) return true;
  if (['0', 'false', 'nao', 'não', 'off', 'no', 'desligar', 'esconder'].includes(s)) return false;
  return padrao;
}
function controleUltimaMensagem(rede) {
  const r = String(rede || '').trim().toLowerCase();
  const lista = r ? (state.recentByPlatform[r] || []) : state.recent;
  return lista.length ? lista[lista.length - 1] : null;
}
// Tecla da Mesa pelo id OU pelo nome (sem diferença de maiúsculas)
function controleAcharTrilha(chave) {
  const k = String(chave || '').replace(/\s+/g, ' ').trim();
  if (!k) return null;
  const kl = k.toLowerCase();
  return state.trilhas.find((t) => t.id === k)
    || state.trilhas.find((t) => String(t.nome || '').replace(/\s+/g, ' ').trim().toLowerCase() === kl)
    || null;
}
function controleNomeTrilha(t) {
  const emoji = { pasta: '🎛️', pastaSimples: '📁', obs: '🎬', vmix: '🎛️', imagem: '🖼️', video: '🎞️' }[t.tipo] || '🎵';
  return emoji + ' ' + (String(t.nome || '').replace(/\s+/g, ' ').trim() || t.id);
}

// ---------- as ações prontas ----------
// Cada uma: o caminho (id), o grupo, o nome, o que faz, os parâmetros que
// aceita e a operação do painel que ela vira. Nomes e descrições em
// português: a página das configurações traduz pelo dicionário (i18n).
const CONTROLE_GRUPOS = {
  tela: '🖥️ Tela e destaque', sorteio: '🎁 Sorteio', widgets: '📊 Widgets', avisos: '📢 Avisos',
  relogio: '🕐 Relógio, cronômetro e timer', conexoes: '🔌 Conexões', mesa: '🎵 Mesa de trilhas',
  obs: '🎬 OBS Studio', vmix: '🎛️ vMix', outros: '🧰 Outros',
};
const CP = {
  rede: { nome: 'rede', desc: 'youtube, twitch, kick, bilibili, telegram, whatsapp ou doacao (vazio = qualquer rede)', ex: '' },
  texto: { nome: 'texto', desc: 'o texto', ex: 'Olá, chat!' },
  id: { nome: 'id', desc: 'qual instância (vazio = a principal)', ex: '' },
  passo: { nome: 'passo', desc: 'quanto somar (padrão 1)', ex: '1' },
  duracao: { nome: 'duracao', desc: 'tempo: 90, 90s, 5m, 1h ou 1:30 (vazio = mantém a duração)', ex: '5m' },
  canal: { nome: 'canal', desc: 'canal/usuário (vazio = o lembrado da última conexão)', ex: '' },
};
const CONTROLE_ACOES = [
  // 🖥️ Tela e destaque
  { id: 'tela/limpar', grupo: 'tela', nome: 'Limpar a tela', desc: 'Tira tudo da tela de uma vez (menos o QR code)', msg: () => ({ type: 'clearOverlays' }) },
  { id: 'destaque/ultimo', grupo: 'tela', nome: 'Destacar o último comentário', desc: 'Manda para a tela o comentário mais recente — de qualquer rede ou só da rede escolhida', params: [CP.rede],
    msg: (p) => { const m = controleUltimaMensagem(p.rede); return m ? { type: 'feature', message: m } : { erro: 'Nenhum comentário recebido ainda.' }; } },
  { id: 'destaque/salvo', grupo: 'tela', nome: 'Destacar um comentário salvo', desc: 'Manda para a tela o comentário da posição N da aba ⭐ Salvos (1 = o primeiro)', params: [{ nome: 'n', desc: 'posição na lista de salvos', ex: '1' }],
    msg: (p) => { const n = Math.max(1, Math.floor(Number(p.n) || 1)); const m = state.saved[n - 1]; return m ? { type: 'feature', message: m } : { erro: 'Não há comentário salvo nessa posição.' }; } },
  { id: 'destaque/tirar', grupo: 'tela', nome: 'Tirar o destaque da tela', desc: 'Some com o comentário em destaque', msg: () => ({ type: 'unfeature' }) },
  { id: 'fila/soltar', grupo: 'tela', nome: 'Soltar a fila de comentários', desc: 'O botão 🔃 do painel: libera agora o que está esperando na fila', msg: () => ({ type: 'feedFlush' }) },
  { id: 'fila/pular', grupo: 'tela', nome: 'Pular para os comentários mais novos', desc: 'Descarta a espera e vai direto para o que acabou de chegar', msg: () => ({ type: 'feedJump' }) },
  { id: 'player/tocar', grupo: 'tela', nome: 'Mídia do destaque: tocar', desc: 'Dá play no áudio/vídeo do comentário em destaque', msg: () => ({ type: 'midiaPlayer', acao: 'play' }) },
  { id: 'player/pausar', grupo: 'tela', nome: 'Mídia do destaque: pausar', desc: 'Pausa o áudio/vídeo do comentário em destaque', msg: () => ({ type: 'midiaPlayer', acao: 'pause' }) },
  { id: 'player/reiniciar', grupo: 'tela', nome: 'Mídia do destaque: recomeçar', desc: 'Volta o áudio/vídeo para o início', msg: () => ({ type: 'midiaPlayer', acao: 'reiniciar' }) },
  { id: 'player/volume', grupo: 'tela', nome: 'Mídia do destaque: volume', desc: 'Ajusta o volume da mídia em destaque (0 a 100)', params: [{ nome: 'valor', desc: '0 a 100', ex: '80' }], msg: (p) => ({ type: 'midiaPlayer', acao: 'volume', volume: Number(p.valor) }) },
  { id: 'avatar/esconder', grupo: 'tela', nome: 'Fechar o avatar ampliado', desc: 'Tira da tela a foto ampliada (🔍)', msg: () => ({ type: 'avatarHide' }) },
  // 🎁 Sorteio
  { id: 'sorteio/sortear', grupo: 'sorteio', nome: 'Sortear', desc: 'Sorteia entre quem participou e mostra o resultado na tela', msg: () => ({ type: 'raffleDraw', origem: 'controle' }) },
  { id: 'sorteio/esconder', grupo: 'sorteio', nome: 'Esconder o sorteio', desc: 'Tira o resultado da tela', msg: () => ({ type: 'raffleHide' }) },
  { id: 'sorteio/zerar', grupo: 'sorteio', nome: 'Zerar os participantes', desc: 'Começa um sorteio novo, sem ninguém', msg: () => ({ type: 'raffleReset' }) },
  // 📊 Widgets
  { id: 'likometro/ligar', grupo: 'widgets', nome: 'Likômetro: ligar', desc: 'Mostra o likômetro na tela', msg: () => ({ type: 'likemeter', enabled: true }) },
  { id: 'likometro/desligar', grupo: 'widgets', nome: 'Likômetro: desligar', desc: 'Tira o likômetro da tela', msg: () => ({ type: 'likemeter', enabled: false }) },
  { id: 'audiencia/alternar', grupo: 'widgets', nome: 'Audiência: mostrar/esconder', desc: 'Alterna o contador de audiência na tela', msg: () => ({ type: 'audienceToggle' }) },
  { id: 'winstreak/alternar', grupo: 'widgets', nome: 'Winstreak: mostrar/esconder', desc: 'Alterna o placar de vitórias na tela', params: [CP.id], msg: (p) => ({ type: 'winstreakToggle', id: p.id || (state.winstreaks[0] || {}).id }) },
  { id: 'winstreak/mais', grupo: 'widgets', nome: 'Winstreak: +1 vitória', desc: 'Soma vitórias ao placar', params: [CP.id, CP.passo], msg: (p) => ({ type: 'winstreakAdd', id: p.id || (state.winstreaks[0] || {}).id, passo: Number(p.passo) || 1 }) },
  { id: 'winstreak/menos', grupo: 'widgets', nome: 'Winstreak: −1 vitória', desc: 'Tira vitórias do placar', params: [CP.id, CP.passo], msg: (p) => ({ type: 'winstreakSub', id: p.id || (state.winstreaks[0] || {}).id, passo: Number(p.passo) || 1 }) },
  { id: 'winstreak/zerar', grupo: 'widgets', nome: 'Winstreak: zerar', desc: 'Zera as vitórias (recorde=1 zera o recorde também)', params: [CP.id, { nome: 'recorde', desc: '1 = zera o recorde junto', ex: '' }], msg: (p) => ({ type: 'winstreakReset', id: p.id || (state.winstreaks[0] || {}).id, all: controleBool(p.recorde, false) }) },
  { id: 'qr/mostrar', grupo: 'widgets', nome: 'QR code: mostrar', desc: 'Põe um QR code na tela com o endereço informado', params: [{ nome: 'url', desc: 'o endereço do QR', ex: 'https://' }, { nome: 'nome', desc: 'rótulo (opcional)', ex: '' }, CP.id], msg: (p) => (p.url ? { type: 'qrShow', url: p.url, name: p.nome || '', id: p.id || undefined } : { erro: 'Informe a url do QR code.' }) },
  { id: 'qr/esconder', grupo: 'widgets', nome: 'QR code: esconder', desc: 'Tira o QR code da tela', params: [CP.id], msg: (p) => ({ type: 'qrHide', id: p.id || undefined }) },
  // 📢 Avisos
  // (v0.128: «id» escolhe qual aviso — vazio = o principal)
  { id: 'aviso/texto', grupo: 'avisos', nome: 'Aviso: escrever e mostrar', desc: 'Escreve um aviso e o põe na tela na hora (mostrar=0 só guarda o texto)', params: [CP.texto, { nome: 'mostrar', desc: '1 = já mostra (padrão), 0 = só guarda', ex: '' }, CP.id], msg: (p) => ({ type: 'avisoSet', id: p.id || (state.avisos[0] || {}).id, texto: String(p.texto ?? ''), visible: controleBool(p.mostrar, true) }) },
  { id: 'aviso/mostrar', grupo: 'avisos', nome: 'Aviso: mostrar', desc: 'Mostra na tela o aviso escrito', params: [CP.id], msg: (p) => ({ type: 'avisoToggle', id: p.id || (state.avisos[0] || {}).id, visible: true }) },
  { id: 'aviso/esconder', grupo: 'avisos', nome: 'Aviso: esconder', desc: 'Tira o aviso da tela', params: [CP.id], msg: (p) => ({ type: 'avisoToggle', id: p.id || (state.avisos[0] || {}).id, visible: false }) },
  { id: 'aviso/alternar', grupo: 'avisos', nome: 'Aviso: mostrar/esconder', desc: 'Alterna o aviso na tela', params: [CP.id], msg: (p) => ({ type: 'avisoToggle', id: p.id || (state.avisos[0] || {}).id }) },
  // 🕐 Relógio, cronômetro e timer
  { id: 'relogio/mostrar', grupo: 'relogio', nome: 'Relógio: mostrar', desc: 'Põe o relógio na tela', msg: () => ({ type: 'relogioToggle', alvo: 'relogio', visible: true }) },
  { id: 'relogio/esconder', grupo: 'relogio', nome: 'Relógio: esconder', desc: 'Tira o relógio da tela', msg: () => ({ type: 'relogioToggle', alvo: 'relogio', visible: false }) },
  { id: 'relogio/alternar', grupo: 'relogio', nome: 'Relógio: mostrar/esconder', desc: 'Alterna o relógio na tela', msg: () => ({ type: 'relogioToggle', alvo: 'relogio' }) },
  { id: 'cronometro/iniciar', grupo: 'relogio', nome: 'Cronômetro: iniciar', desc: 'Começa (ou continua) a contar', msg: () => ({ type: 'cronometro', acao: 'iniciar' }) },
  { id: 'cronometro/pausar', grupo: 'relogio', nome: 'Cronômetro: pausar', desc: 'Pausa a contagem', msg: () => ({ type: 'cronometro', acao: 'pausar' }) },
  { id: 'cronometro/zerar', grupo: 'relogio', nome: 'Cronômetro: zerar', desc: 'Volta o cronômetro para zero', msg: () => ({ type: 'cronometro', acao: 'zerar' }) },
  { id: 'cronometro/mostrar', grupo: 'relogio', nome: 'Cronômetro: mostrar', desc: 'Põe o cronômetro na tela', msg: () => ({ type: 'relogioToggle', alvo: 'cronometro', visible: true }) },
  { id: 'cronometro/esconder', grupo: 'relogio', nome: 'Cronômetro: esconder', desc: 'Tira o cronômetro da tela', msg: () => ({ type: 'relogioToggle', alvo: 'cronometro', visible: false }) },
  { id: 'cronometro/alternar', grupo: 'relogio', nome: 'Cronômetro: mostrar/esconder', desc: 'Alterna o cronômetro na tela', msg: () => ({ type: 'relogioToggle', alvo: 'cronometro' }) },
  { id: 'timer/iniciar', grupo: 'relogio', nome: 'Timer: iniciar', desc: 'Começa a contagem regressiva (com a duração informada ou a que já estava)', params: [CP.duracao],
    msg: (p) => { const d = controleDuracaoMs(p.duracao); return { type: 'timer', acao: 'iniciar', ...(d !== undefined ? { duracao: d } : {}) }; } },
  { id: 'timer/pausar', grupo: 'relogio', nome: 'Timer: pausar', desc: 'Pausa a contagem regressiva', msg: () => ({ type: 'timer', acao: 'pausar' }) },
  { id: 'timer/zerar', grupo: 'relogio', nome: 'Timer: zerar', desc: 'Volta o timer para o começo', msg: () => ({ type: 'timer', acao: 'zerar' }) },
  { id: 'timer/duracao', grupo: 'relogio', nome: 'Timer: definir a duração', desc: 'Só ajusta a duração, sem iniciar', params: [CP.duracao],
    msg: (p) => { const d = controleDuracaoMs(p.duracao); return d === undefined ? { erro: 'Informe a duração (ex.: 5m, 90s, 1:30).' } : { type: 'relogioSet', duracao: d }; } },
  { id: 'timer/mostrar', grupo: 'relogio', nome: 'Timer: mostrar', desc: 'Põe o timer na tela', msg: () => ({ type: 'relogioToggle', alvo: 'timer', visible: true }) },
  { id: 'timer/esconder', grupo: 'relogio', nome: 'Timer: esconder', desc: 'Tira o timer da tela', msg: () => ({ type: 'relogioToggle', alvo: 'timer', visible: false }) },
  { id: 'timer/alternar', grupo: 'relogio', nome: 'Timer: mostrar/esconder', desc: 'Alterna o timer na tela', msg: () => ({ type: 'relogioToggle', alvo: 'timer' }) },
  // 🔌 Conexões
  { id: 'conexoes/reiniciar', grupo: 'conexoes', nome: 'Reiniciar todas as conexões', desc: 'Derruba e reconecta todas as redes que estavam ligadas', msg: () => ({ type: 'reconnectAll' }) },
  // 🎵 Mesa de trilhas
  { id: 'trilha/parar', grupo: 'mesa', nome: 'Parar a Mesa (⏹)', desc: 'Para a trilha e a fila de multi ação que estiver tocando', msg: () => ({ type: 'trilhaParar' }) },
  { id: 'midia/fechar', grupo: 'mesa', nome: 'Fechar a mídia da Mesa na tela', desc: 'Tira da tela a imagem/vídeo de uma tecla da Mesa', msg: () => ({ type: 'trilhaTela', off: true }) },
  // 🎞️ v0.129: Mídia direta
  { id: 'midiaDireta/url', grupo: 'tela', nome: 'Mídia direta: carregar URL', desc: 'Carrega uma imagem/vídeo/áudio de uma URL (YouTube, TikTok, Instagram, arquivo…) e mostra na tela', params: [{ nome: 'url', desc: 'o endereço', ex: 'https://' }, { nome: 'mostrar', desc: '1 = já mostra (padrão), 0 = só carrega', ex: '' }], msg: (p) => (p.url ? { type: 'midiaDiretaUrl', url: String(p.url), mostrar: controleBool(p.mostrar, true) } : { erro: 'Informe a url da mídia.' }) },
  { id: 'midiaDireta/mostrar', grupo: 'tela', nome: 'Mídia direta: mostrar', desc: 'Põe na tela a mídia direta carregada no painel', msg: () => ({ type: 'midiaDiretaToggle', visible: true }) },
  { id: 'midiaDireta/esconder', grupo: 'tela', nome: 'Mídia direta: esconder', desc: 'Tira a mídia direta da tela (continua carregada)', msg: () => ({ type: 'midiaDiretaToggle', visible: false }) },
  { id: 'midiaDireta/alternar', grupo: 'tela', nome: 'Mídia direta: mostrar/esconder', desc: 'Alterna a mídia direta na tela', msg: () => ({ type: 'midiaDiretaToggle' }) },
  { id: 'midiaDireta/fechar', grupo: 'tela', nome: 'Mídia direta: fechar', desc: 'Tira da tela e descarrega a mídia direta', msg: () => ({ type: 'midiaDiretaFechar' }) },
  { id: 'midiaDireta/tocar', grupo: 'tela', nome: 'Mídia direta: tocar', desc: 'Dá play no vídeo/áudio da mídia direta', msg: () => ({ type: 'midiaDiretaPlayer', acao: 'play' }) },
  { id: 'midiaDireta/pausar', grupo: 'tela', nome: 'Mídia direta: pausar', desc: 'Pausa o vídeo/áudio da mídia direta', msg: () => ({ type: 'midiaDiretaPlayer', acao: 'pause' }) },
  { id: 'midiaDireta/reiniciar', grupo: 'tela', nome: 'Mídia direta: recomeçar', desc: 'Volta a mídia direta para o início', msg: () => ({ type: 'midiaDiretaPlayer', acao: 'reiniciar' }) },
  { id: 'midiaDireta/volume', grupo: 'tela', nome: 'Mídia direta: volume', desc: 'Ajusta o volume da mídia direta (0 a 100)', params: [{ nome: 'valor', desc: '0 a 100', ex: '80' }], msg: (p) => ({ type: 'midiaDiretaPlayer', acao: 'volume', volume: Number(p.valor) }) },
  { id: 'midiaDireta/telaCheia', grupo: 'tela', nome: 'Mídia direta: tela cheia', desc: 'Liga/desliga a tela cheia da mídia direta para o público', params: [{ nome: 'ligar', desc: '1 = liga, 0 = desliga (vazio = alterna)', ex: '' }], msg: (p) => ({ type: 'midiaDiretaTela', telaCheia: p.ligar === undefined || p.ligar === '' ? !state.midiaDireta.telaCheia : controleBool(p.ligar, true) }) },
  { id: 'midiaDireta/credito', grupo: 'tela', nome: 'Mídia direta: crédito de fonte', desc: 'Escreve o crédito que vai com a mídia na tela (e/ou liga e desliga ele)', params: [{ nome: 'texto', desc: 'o crédito (vazio = só mexe no mostrar)', ex: 'Fonte: @perfil · site.com' }, { nome: 'mostrar', desc: '1 = mostra, 0 = esconde (vazio = alterna)', ex: '' }], msg: (p) => ({ type: 'midiaDiretaCredito', ...(p.texto === undefined ? {} : { texto: String(p.texto) }), mostrar: p.mostrar === undefined || p.mostrar === '' ? !state.midiaDireta.credito.mostrar : controleBool(p.mostrar, true) }) },
  // 🎬 OBS / 🎛️ vMix
  { id: 'obs/atualizar', grupo: 'obs', nome: 'OBS: atualizar as listas', desc: 'Pede ao OBS as cenas, fontes e estados de novo', msg: () => ({ type: 'obsAtualizar' }) },
  { id: 'vmix/atualizar', grupo: 'vmix', nome: 'vMix: atualizar as listas', desc: 'Pede ao vMix as entradas e estados de novo', msg: () => ({ type: 'vmixAtualizar' }) },
  // 🧰 Outros
  { id: 'teste/comentario', grupo: 'outros', nome: 'Comentário de teste', desc: 'Manda um comentário de mentira, como o 🧪 do painel', msg: () => ({ type: 'test' }) },
  { id: 'teste/limpar', grupo: 'outros', nome: 'Apagar os comentários de teste', desc: 'Tira do painel e da tela todos os comentários de mentira, e as fichas que eles criaram no sorteio', msg: () => ({ type: 'testLimpar' }) },
  { id: 'clipboard/texto', grupo: 'outros', nome: 'Área de transferência: guardar um texto', desc: 'Adiciona um texto ao histórico 📋 do painel', params: [CP.texto], msg: (p) => (String(p.texto || '').trim() ? { type: 'clipboard', text: String(p.texto) } : { erro: 'Informe o texto.' }) },
];
// Os parâmetros das ações do OBS e do vMix, explicados uma vez
const CONTROLE_PARAM_DESC = {
  modo: 'o modo (a lista de valores está ao lado)', nome: 'o nome (cena, transição, coleção, perfil, atalho, script...)',
  cena: 'o nome da cena', fonte: 'o nome da fonte', filtro: 'o nome do filtro', id: 'número do item na cena (opcional)',
  texto: 'o texto', db: 'volume em dB (−100 a +26)', duracao: 'duração da transição em ms (0 = a que já está)',
  entrada: 'número, chave ou título da entrada do vMix', canal: 'canal (overlay 1-4; transmissão 0-3)',
  volume: 'volume 0 a 100 (ajustar: −100 a +100)', segundos: 'segundos do replay', campo: 'nome do campo do título',
};
function controleParamsDoSpec(spec) {
  const lista = [];
  for (const k of Object.keys(spec)) {
    if (k === 'modos') lista.push({ nome: 'modo', desc: CONTROLE_PARAM_DESC.modo, ex: spec.modos[0], opcoes: spec.modos });
    else if (spec[k] === true) lista.push({ nome: k, desc: CONTROLE_PARAM_DESC[k] || k, ex: '' });
  }
  return lista;
}

// O caminho pedido vira { acao, msg } — ou um erro com status HTTP
function controleResolver(caminho, p) {
  const seg = caminho.split('/').filter(Boolean);
  const fixo = CONTROLE_ACOES.find((a) => a.id === caminho);
  if (fixo) return { acao: fixo, msg: fixo.msg(p) };
  const cabeca = seg[0] || '';
  // 🎵 trilha/<id ou nome> — toca, abre a fila do 🎛️ ou mostra a mídia,
  // conforme o tipo da tecla (pasta/ e midia/ são apelidos)
  if (['trilha', 'pasta', 'midia'].includes(cabeca)) {
    const chave = seg.slice(1).join('/') || p.id || p.nome || p.tecla;
    const t = controleAcharTrilha(chave);
    if (!t) return { erro: 'Tecla não encontrada na Mesa de trilhas: ' + String(chave || '').slice(0, 80), status: 404 };
    const acao = { id: 'trilha/' + t.id, grupo: 'mesa', nome: controleNomeTrilha(t) };
    if (t.tipo === 'pasta') return { acao, msg: { type: 'pastaTocar', id: t.id } };
    if (t.tipo === 'pastaSimples') return { erro: 'Uma pasta simples só guarda teclas — não tem o que tocar.' };
    if (t.tipo === 'imagem' || t.tipo === 'video') return { acao, msg: { type: 'trilhaTela', id: t.id, off: controleBool(p.fechar, false) } };
    return { acao, msg: { type: 'trilhaTocar', id: t.id } };
  }
  // 🎬 obs/<ação>[/<nome>]?modo=&cena=&fonte=... — as mesmas ações das teclas
  if (cabeca === 'obs' && seg[1]) {
    if (!Object.hasOwn(OBS_ACOES, seg[1])) return { erro: 'Ação do OBS desconhecida: ' + seg[1].slice(0, 40), status: 404 };
    const alvo = { ...p };
    if (seg[2] !== undefined) alvo.nome = seg.slice(2).join('/');
    return { acao: { id: 'obs/' + seg[1], grupo: 'obs', nome: '🎬 OBS: ' + seg[1] + (alvo.nome ? ' ' + alvo.nome : '') }, msg: { type: 'obsAcao', acao: seg[1], alvo } };
  }
  // 🎛️ vmix/<ação>[/<entrada ou nome>]?modo=&canal=...
  if (cabeca === 'vmix' && seg[1]) {
    if (!Object.hasOwn(VMIX_ACOES, seg[1])) return { erro: 'Ação do vMix desconhecida: ' + seg[1].slice(0, 40), status: 404 };
    const alvo = { ...p };
    if (seg[2] !== undefined) alvo[VMIX_ACOES[seg[1]].entrada ? 'entrada' : 'nome'] = seg.slice(2).join('/');
    return { acao: { id: 'vmix/' + seg[1], grupo: 'vmix', nome: '🎛️ vMix: ' + seg[1] + (alvo.entrada || alvo.nome ? ' ' + (alvo.entrada || alvo.nome) : '') }, msg: { type: 'vmixAcao', acao: seg[1], alvo } };
  }
  // 🔌 conexao/<rede>/ligar|desligar|reiniciar[?canal=]
  if (cabeca === 'conexao' && seg[1]) {
    const rede = String(seg[1]).toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(CONNECTORS, rede)) return { erro: 'Rede desconhecida: ' + rede.slice(0, 30), status: 404 };
    const verbo = seg[2] || 'ligar';
    const lembrada = state.connections[rede] || {};
    const canal = String(p.canal || '').trim() || lembrada.channel || '';
    const acao = { id: `conexao/${rede}/${verbo}`, grupo: 'conexoes', nome: `🔌 ${rede}: ${verbo}` };
    if (verbo === 'desligar') return { acao, msg: { type: 'disconnect', platform: rede } };
    if (verbo === 'reiniciar') return { acao, msg: { type: 'reconnect', platform: rede, channel: canal } };
    if (verbo === 'ligar') {
      if (!canal && rede !== 'telegram' && rede !== 'whatsapp') return { erro: 'Informe o canal (?canal=...) — essa rede nunca foi conectada.' };
      return { acao, msg: { type: 'connect', platform: rede, channel: canal, options: lembrada.token ? { token: lembrada.token } : {} } };
    }
    return { erro: 'Use ligar, desligar ou reiniciar.', status: 404 };
  }
  return { erro: 'Ação desconhecida: ' + caminho.slice(0, 80) + ' — veja a lista em /api/controle/catalogo', status: 404 };
}

// O catálogo completo, com o que existe AGORA (teclas da Mesa, cenas do OBS,
// entradas do vMix, redes lembradas) — é o que a página das configurações
// mostra e o que um programa (Companion etc.) pode ler para se montar
function controleCatalogo() {
  const acoes = CONTROLE_ACOES.map((a) => ({ id: a.id, grupo: a.grupo, nome: a.nome, desc: a.desc, params: a.params || [] }));
  for (const t of state.trilhas) {
    if (t.tipo === 'pastaSimples') continue;
    acoes.push({ id: 'trilha/' + t.id, grupo: 'mesa', nome: controleNomeTrilha(t), desc: t.tipo === 'pasta' ? 'Toca a fila do Botão de multi ação (de novo = para)' : (t.tipo === 'imagem' || t.tipo === 'video') ? 'Mostra/esconde a mídia na tela' : 'Dispara esta tecla da Mesa', params: [], tecla: { id: t.id, nome: t.nome, tipo: t.tipo } });
  }
  for (const rede of Object.keys(CONNECTORS)) {
    const c = state.connections[rede] || {};
    for (const [verbo, desc] of [['ligar', 'Conecta (com o canal lembrado ou o informado)'], ['desligar', 'Desconecta'], ['reiniciar', 'Derruba e conecta de novo']]) {
      acoes.push({ id: `conexao/${rede}/${verbo}`, grupo: 'conexoes', nome: `🔌 ${rede}: ${verbo}`, desc, params: verbo === 'desligar' ? [] : [CP.canal], rede, canalLembrado: c.channel || null });
    }
  }
  for (const [id, spec] of Object.entries(OBS_ACOES)) acoes.push({ id: 'obs/' + id, grupo: 'obs', nome: '🎬 ' + id, desc: '', params: controleParamsDoSpec(spec), obsAcao: id });
  for (const cena of (obsRt.cenas || [])) {
    const nome = typeof cena === 'string' ? cena : (cena && (cena.nome || cena.sceneName || cena.name)) || '';
    if (nome) acoes.push({ id: 'obs/cena/' + nome, grupo: 'obs', nome: '🎬 Cena: ' + nome, desc: 'Troca para esta cena do OBS', params: [], obsAcao: 'cena' });
  }
  for (const [id, spec] of Object.entries(VMIX_ACOES)) acoes.push({ id: 'vmix/' + id, grupo: 'vmix', nome: '🎛️ ' + id, desc: '', params: controleParamsDoSpec(spec), vmixAcao: id });
  for (const e of (vmixRt.entradas || [])) {
    if (e && e.numero) acoes.push({ id: 'vmix/entrada/' + e.numero, grupo: 'vmix', nome: `🎛️ Entrada ${e.numero}: ${e.titulo || ''}`.trim(), desc: 'Manda esta entrada do vMix ao vivo (modo=preview só no preview)', params: [controleParamsDoSpec(VMIX_ACOES.entrada)[1]], vmixAcao: 'entrada' });
  }
  return { ok: true, versao: APP_VERSION, base: '/api/controle/', grupos: CONTROLE_GRUPOS, acoes, livre: { caminho: 'op', desc: 'POST com JSON {"type": "<operação do painel>", ...} — qualquer operação, menos as que só o computador local faz' } };
}

// O retrato do momento, para aparelhos que mostram estado (Companion etc.)
function controleEstado() {
  const f = state.featured;
  const obs = state.settings.labs?.obs === true ? obsResumo() : null;
  const vmix = state.settings.labs?.vmix === true ? vmixResumo() : null;
  return {
    ok: true, versao: APP_VERSION,
    destaque: f ? { id: f.id, autor: f.author, rede: f.platform, texto: String(f.message ?? f.text ?? '').slice(0, 200) } : null,
    sorteio: { visivel: !!(state.raffle && state.raffle.visible), participantes: state.participants.size, ganhadores: state.raffle ? (state.raffle.winners || []).map((w) => (w && (w.author || w.name || w.nome)) || '') : [] },
    likometro: !!(state.likemeter && state.likemeter.enabled), audiencia: !!(state.audience && state.audience.visible),
    aviso: { visivel: !!state.avisos[0].visible, texto: state.avisos[0].texto },
    avisos: state.avisos.map((a) => ({ id: a.id, nome: a.label, visivel: !!a.visible, texto: a.texto })), // 📢 v0.128
    relogio: relogioPublico(),
    winstreaks: state.winstreaks.map((w) => ({ id: w.id, nome: w.label, vitorias: w.wins, recorde: w.record, visivel: !!w.visible })),
    qrs: state.qrs.map((q) => ({ id: q.id, nome: q.name, visivel: !!q.visible })),
    fila: feedQueue.length + feedReleasing.length,
    totais: { ...platformTotals }, categorias: { ...categoryTotals },
    conexoes: Object.fromEntries(Object.entries(state.connections || {}).map(([r, c]) => [r, { ativa: !!(c && c.active), canal: c ? c.channel || null : null, status: state.status[r] ? state.status[r].state : null }])),
    mesa: { tocando: state.trilhaTocando, pasta: pastaFila ? pastaFila.id : null, tela: state.trilhaTela ? { id: state.trilhaTela.id, tipo: state.trilhaTela.tipo } : null },
    // 🎞️ v0.129
    midiaDireta: state.midiaDireta.item ? { visivel: !!state.midiaDireta.visible, tipo: state.midiaDireta.item.tipo, nome: state.midiaDireta.item.nome, fonte: state.midiaDireta.item.fonte, provedor: state.midiaDireta.item.embed ? state.midiaDireta.item.embed.provedor : null, telaCheia: !!state.midiaDireta.telaCheia, tocando: state.midiaDireta.player.estado === 'tocando', credito: state.midiaDireta.credito.mostrar ? state.midiaDireta.credito.texto : '' } : null,
    obs: obs ? { conectado: obs.conectado, transmitindo: obs.transmitindo, gravando: obs.gravando, cenaPrograma: obs.cenaPrograma, cenaPreview: obs.cenaPreview, estudio: obs.estudio } : { ligado: false },
    vmix: vmix ? { conectado: vmix.conectado, transmitindo: vmix.transmitindo, gravando: vmix.gravando, programa: vmix.programa, preview: vmix.preview } : { ligado: false },
    controle: { total: controleRt.total, ultimo: controleRt.ultimo },
  };
}

// Executa UMA operação pelo despachante do painel, com um ws de mentira que
// só recolhe o que o servidor responderia (as respostas voltam no JSON)
function controleExecutar(msg, ip) {
  const respostas = [];
  const wsFalso = {
    role: 'full', clientIp: ip, addressClass: classifyAddress(ip), deviceInfo: 'Controle externo', deviceName: null,
    readyState: 1, controleExterno: true,
    send: (s) => { try { const d = JSON.parse(s); if (d && d.type && respostas.length < 20) respostas.push(d); } catch {} },
  };
  tratarMensagem(wsFalso, JSON.stringify(msg));
  return respostas;
}

function controleLerCorpo(req, cb) {
  let body = '';
  req.on('data', (chunk) => { if (body.length < 65536) body += chunk.toString().slice(0, 65536 - body.length); });
  req.on('end', () => {
    let params = {};
    if (body.trim()) {
      try { params = JSON.parse(body); } catch {
        for (const [k, v] of new URLSearchParams(body)) params[k] = v;
      }
    }
    cb(params && typeof params === 'object' && !Array.isArray(params) ? params : {});
  });
}

function tratarControleHttp(req, res, urlPath) {
  const json = (status, obj) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  };
  if (req.method !== 'GET' && req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  // Sites de fora abertos no navegador não comandam nada; aparelhos e
  // programas de automação (sem Origin) passam
  if (!originAllowed(req.headers.origin, req.headers.host) || !fetchSiteAllowed(req)) return json(403, { ok: false, erro: 'Origem não permitida.' });
  if (state.settings.labs?.controle !== true) return json(403, { ok: false, erro: 'O controle externo está desligado. Ligue em Configurações → 🧪 Labs → 🕹️ Controle externo.' });
  let ip = String(req.socket.remoteAddress || '');
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  const query = new URLSearchParams((req.url || '').split('?')[1] || '');
  controleLerCorpo(req, (corpo) => {
    // (qualquer erro aqui dentro vira uma resposta 500 — nunca derruba o programa)
    try { tratarControlePedido(corpo); } catch (err) {
      console.error('  ⚠️ Erro no controle externo:', err && err.message);
      try { json(500, { ok: false, erro: 'Erro interno tratando o pedido.' }); } catch { /* resposta já foi */ }
    }
  });
  function tratarControlePedido(corpo) {
    const p = { ...Object.fromEntries(query), ...corpo };
    const auth = String(req.headers.authorization || '');
    const token = String(p.token || req.headers['x-token'] || (auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '') || '');
    delete p.token;
    const confere = controleTokenConfere(token, ip);
    if (confere === 'bloqueado') return json(429, { ok: false, erro: 'Muitas tentativas com token errado. Espere alguns minutos.' });
    if (confere !== 'ok') return json(401, { ok: false, erro: 'Token inválido. Copie o token da página 🕹️ Controle Externo das configurações.' });
    const caminho = urlPath.slice('/api/controle'.length).replace(/^\/+|\/+$/g, '');
    if (!caminho || caminho === 'catalogo') return json(200, controleCatalogo());
    if (caminho === 'estado') return json(200, controleEstado());
    let acao, msg;
    if (caminho === 'op') {
      // A operação livre: o JSON inteiro vira a mensagem do painel
      const type = String(p.type || p.op || '').slice(0, 60);
      if (!type) return json(400, { ok: false, erro: 'Informe a operação: {"type": "..."}' });
      msg = { ...p, type };
      delete msg.op;
      acao = { id: 'op/' + type, grupo: 'outros', nome: '🧰 Operação livre: ' + type };
    } else {
      const r = controleResolver(caminho, p);
      if (r.erro) return json(r.status || 400, { ok: false, erro: r.erro });
      if (r.msg && r.msg.erro) return json(400, { ok: false, erro: r.msg.erro });
      acao = r.acao; msg = r.msg;
    }
    if (LOCAL_ONLY_OPS.has(msg.type)) return json(403, { ok: false, erro: 'Essa operação só pode ser feita no painel do próprio computador.' });
    let respostas;
    try { respostas = controleExecutar(msg, ip); } catch (err) {
      console.error('  ⚠️ Erro numa ação do controle externo:', err && err.message);
      return json(500, { ok: false, erro: 'Deu erro executando a ação: ' + (err && err.message) });
    }
    controleRt.total += 1;
    controleRt.ultimo = { acao: acao.id, nome: acao.nome, em: Date.now(), ip };
    console.log(`  🕹️ Controle externo (${ip}): ${acao.id}`);
    // O painel mostra um recado rápido (e a página do controle acompanha)
    broadcast({ type: 'controleAviso', texto: acao.nome, acao: acao.id });
    broadcastControle();
    json(200, { ok: true, acao: acao.id, op: msg.type, respostas });
  }
}

// ---------------------------------------------------------------------------
// 🔄 Recarregar os chats de tempos em tempos
//
// Reinicia cada rede conectada, uma de cada vez (com folga entre elas para não
// piscar tudo junto). Ao reiniciar, cada conector busca de novo o histórico que
// a plataforma disponibiliza — é assim que os comentários perdidos num engasgo
// da conexão voltam sozinhos.
let ultimaRecarga = Date.now();
function vigiarRecarga() {
  const minutos = Number(state.settings.panel?.recarregarMin) || 0;
  if (minutos <= 0) { ultimaRecarga = Date.now(); return; }
  if (Date.now() - ultimaRecarga < minutos * 60000) return;
  ultimaRecarga = Date.now();
  const ativas = Object.entries(state.connections)
    .filter(([platform, conn]) => conn?.active && conn.channel && Object.prototype.hasOwnProperty.call(CONNECTORS, platform));
  if (!ativas.length) return;
  console.log(`  🔄 Recarga automática dos chats (a cada ${minutos} min): ${ativas.map(([p]) => p).join(', ')}`);
  ativas.forEach(([platform, conn], i) => {
    setTimeout(() => {
      // A rede pode ter sido desligada no meio da espera
      if (state.connections[platform]?.active) connect(platform, conn.channel);
    }, i * 4000);
  });
}
const recargaTimer = setInterval(vigiarRecarga, 30000);
if (recargaTimer.unref) recargaTimer.unref();

currency.init(DATA_DIR);
restoreFromLog();
cleanOldLogs();
const logCleanTimer = setInterval(cleanOldLogs, 6 * 60 * 60 * 1000);
if (logCleanTimer.unref) logCleanTimer.unref();

// Depois de uma atualização, o programa novo nasce enquanto o antigo ainda
// está soltando a porta — tenta de novo por alguns segundos em vez de morrer.
let listenRetries = 0;
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE' && listenRetries < 12) {
    listenRetries += 1;
    setTimeout(() => server.listen(PORT), 500);
    return;
  }
  console.error('Não consegui abrir a porta ' + PORT + ':', err.message);
  process.exit(1);
});

server.listen(PORT, () => {
  // 💠 Pix ligado no Labs? A consulta ao banco arranca junto com o programa
  arrancarPix();
  // 🧹 Arquivos do histórico da área de transferência sem dono somem
  limparOrfaosDoClipboard();
  const rotulos = [tcons('Painel de controle:'), tcons('Overlay (destaque):'), tcons('Chat ao vivo (fixo):')];
  const larg = Math.max(...rotulos.map((r) => r.length)) + 5;
  console.log('');
  console.log('  ' + tcons('✅ OBS Social v$1 Beta está rodando!', APP_VERSION));
  console.log('');
  console.log('  ' + tcons('Abra no seu navegador (Chrome, Edge, Firefox...):'));
  console.log('');
  console.log('  ' + rotulos[0].padEnd(larg) + `http://localhost:${PORT}`);
  console.log('  ' + rotulos[1].padEnd(larg) + `http://localhost:${PORT}/overlay`);
  console.log('  ' + rotulos[2].padEnd(larg) + `http://localhost:${PORT}/chat`);
  const ipRede = lanAddress();
  if (ipRede) {
    console.log('');
    console.log('  ' + tcons('No celular ou em outro aparelho do mesmo WiFi (rede local):'));
    console.log('  ' + ''.padEnd(larg) + `http://${ipRede}:${PORT}`);
  }
  console.log('');
  console.log('  ' + tcons('Deixe esta janela aberta enquanto estiver fazendo live.'));
  console.log('  ' + tcons('Para parar, feche esta janela ou aperte Ctrl+C.'));
  console.log('');

  // Quem ja usava a Bilibili antes do seletor do Labs continua com ela ativa
  if (state.settings.labs?.bilibili !== true && state.connections?.bilibili?.channel) {
    state.settings.labs.bilibili = true;
    saveSettings();
  }
  // Memoria das conexoes: reconecta sozinho o que estava ligado da ultima vez
  setTimeout(() => {
    for (const [platform, conn] of Object.entries(state.connections)) {
      if (conn?.active && conn.channel && CONNECTORS[platform] && !state.connectors[platform]) {
        console.log(`  🔌 Reconectando ${platform} (${conn.channel}) da última vez...`);
        connect(platform, conn.channel);
      }
    }
  }, 1500);
});
