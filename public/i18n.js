// OBS Social — motor de idiomas.
// O português é o idioma nativo: todos os textos do código são a "chave".
// Cada idioma extra é um dicionário (i18n-<código>.js) carregado ANTES deste
// arquivo. O motor traduz a página inteira observando o DOM — nós de texto e
// atributos (title, placeholder...) — sem precisar reescrever as telas.
// O que não tiver tradução permanece em português (nada quebra); conteúdo
// escrito pelos espectadores (mensagens, nomes) nunca é traduzido.
(() => {
  'use strict';
  const REG = (window.OBS_I18N_DICTS = window.OBS_I18N_DICTS || {});
  REG.pt = REG.pt || {
    nome: 'Português (Brasil)',
    nomes: {
      pt: 'Português (Brasil)', en: 'Inglês', es: 'Espanhol', fr: 'Francês', de: 'Alemão',
      ru: 'Russo', tr: 'Turco', ja: 'Japonês', ko: 'Coreano', zh: 'Chinês (simplificado)',
    },
    textos: {}, padroes: [],
  };

  // Idiomas com dicionário próprio (i18n-<código>.js), carregado só quando usado
  const DISPONIVEIS = ['en', 'es', 'fr', 'de', 'ru', 'tr', 'ja', 'ko', 'zh'];
  const HTML_LANG = { pt: 'pt-BR', zh: 'zh-CN' };
  const carregando = {};
  function carregarDicionario(codigo, aoTerminar) {
    if (REG[codigo] || codigo === 'pt') { aoTerminar(); return; }
    if (carregando[codigo]) { carregando[codigo].push(aoTerminar); return; }
    carregando[codigo] = [aoTerminar];
    const s = document.createElement('script');
    s.src = '/i18n-' + codigo + '.js';
    s.onload = s.onerror = () => {
      const fila = carregando[codigo] || [];
      delete carregando[codigo];
      for (const fn of fila) { try { fn(); } catch {} }
    };
    (document.head || document.documentElement).appendChild(s);
  }

  // Zonas onde NUNCA se traduz: conteúdo dos espectadores e do streamer.
  const ZONAS_PROIBIDAS = '.msg-text, .author, .avatar, .sc-amount, [data-no-i18n]';
  // v0.53: 'label' entrou por causa dos <optgroup> (o nome do grupo de opções)
  const ATRIBUTOS = ['title', 'placeholder', 'aria-label', 'alt', 'data-tip', 'label'];

  const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

  let escolha = 'auto';       // o que o streamer escolheu ('auto' | código)
  let atual = 'pt';           // idioma efetivo desta página
  let dic = null;             // dicionário ativo (null = português puro)
  const aoMudarFns = [];

  function resolveAuto() {
    const nav = String(navigator.language || 'pt').toLowerCase();
    if (nav.startsWith('pt')) return 'pt';
    const base = nav.slice(0, 2);
    if (DISPONIVEIS.includes(base)) return base;
    return 'en';
  }

  // Traduz um texto (já normalizado ou não). Devolve null se não conhecer.
  function traduzir(texto, prof) {
    if (!dic) return null;
    const chave = norm(texto);
    if (!chave || !/[A-Za-zÀ-ÿ]/.test(chave)) return null;
    const direto = dic.textos[chave];
    if (direto !== undefined) return direto;
    if ((prof || 0) >= 3) return null;
    for (const par of dic.padroes) {
      const m = chave.match(par[0]);
      if (m) {
        // Grupos capturados também passam pelo tradutor (frases aninhadas,
        // como "1 aba aberta" dentro de "Este computador — 1 aba aberta").
        const grupos = m.slice(1).map((g) => (g === undefined ? '' : (traduzir(g, (prof || 0) + 1) ?? g)));
        return String(par[1]).replace(/\$(\d)/g, (tudo, i) => grupos[Number(i) - 1] ?? '');
      }
    }
    return null;
  }

  // ---------- aplicação no DOM ----------
  const origTexto = new WeakMap();   // Text -> original em português
  const escritoTexto = new WeakMap();// Text -> último valor que NÓS escrevemos
  const origAttr = new WeakMap();    // Element -> { attr: original }
  const escritoAttr = new WeakMap(); // Element -> { attr: último escrito }

  function zonaProibida(el) {
    return !el || !el.closest || el.closest('script, style, ' + ZONAS_PROIBIDAS) !== null;
  }

  function aplicaTexto(node) {
    const pai = node.parentElement;
    if (zonaProibida(pai)) return;
    let orig = origTexto.get(node);
    if (orig === undefined) { orig = node.data; origTexto.set(node, orig); }
    const t = traduzir(orig);
    // preserva os espaços das pontas do texto original
    const bordas = orig.match(/^(\s*)[\s\S]*?(\s*)$/);
    const alvo = t === null ? orig : (bordas ? bordas[1] + t + bordas[2] : t);
    if (node.data !== alvo) { escritoTexto.set(node, alvo); node.data = alvo; }
  }

  function aplicaAtributos(el) {
    if (el.nodeType !== 1 || zonaProibida(el)) return;
    for (const attr of ATRIBUTOS) {
      if (!el.hasAttribute(attr)) continue;
      let mapa = origAttr.get(el);
      if (!mapa) { mapa = {}; origAttr.set(el, mapa); }
      if (mapa[attr] === undefined) mapa[attr] = el.getAttribute(attr);
      const t = traduzir(mapa[attr]);
      const alvo = t === null ? mapa[attr] : t;
      if (el.getAttribute(attr) !== alvo) {
        let esc = escritoAttr.get(el);
        if (!esc) { esc = {}; escritoAttr.set(el, esc); }
        esc[attr] = alvo;
        el.setAttribute(attr, alvo);
      }
    }
  }

  function varrer(raiz) {
    if (raiz.nodeType === 3) { aplicaTexto(raiz); return; }
    if (raiz.nodeType !== 1 && raiz.nodeType !== 11) return;
    if (raiz.nodeType === 1) aplicaAtributos(raiz);
    const tw = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n;
    while ((n = tw.nextNode())) {
      if (n.nodeType === 3) aplicaTexto(n);
      else aplicaAtributos(n);
    }
  }

  let tituloOriginal = null;
  function aplicaTitulo() {
    if (tituloOriginal === null) tituloOriginal = document.title;
    const t = traduzir(tituloOriginal);
    document.title = t === null ? tituloOriginal : t;
  }

  function aplicaTudo() {
    document.documentElement.lang = HTML_LANG[atual] || atual;
    aplicaTitulo();
    if (document.body) varrer(document.body);
  }

  const observador = new MutationObserver((mutacoes) => {
    for (const m of mutacoes) {
      if (m.type === 'childList') {
        for (const node of m.addedNodes) varrer(node);
      } else if (m.type === 'characterData') {
        const node = m.target;
        if (node.data === escritoTexto.get(node)) continue; // foi a gente
        origTexto.set(node, node.data); // texto novo vindo do código da página
        aplicaTexto(node);
      } else if (m.type === 'attributes') {
        const el = m.target;
        const esc = escritoAttr.get(el);
        if (esc && el.getAttribute(m.attributeName) === esc[m.attributeName]) continue;
        const mapa = origAttr.get(el);
        if (mapa) mapa[m.attributeName] = el.getAttribute(m.attributeName);
        aplicaAtributos(el);
      }
    }
  });

  function setIdioma(novaEscolha) {
    const valida = novaEscolha === 'auto' || novaEscolha === 'pt' || DISPONIVEIS.includes(novaEscolha);
    escolha = valida ? novaEscolha : 'auto';
    const efetivo = escolha === 'auto' ? resolveAuto() : escolha;
    // Baixa o dicionário do idioma (só o dele) e aplica quando estiver pronto
    carregarDicionario(efetivo, () => {
      if (efetivo !== 'pt' && !REG[efetivo]) return; // dicionário não veio: fica como está
      const mudou = efetivo !== atual;
      atual = efetivo;
      dic = atual === 'pt' ? null : REG[atual];
      aplicaTudo();
      if (mudou) for (const fn of aoMudarFns) { try { fn(atual); } catch {} }
    });
  }

  window.OBS_I18N = {
    // tradução pontual para strings de código (confirm, prompt, toasts...)
    t: (texto) => { const t = traduzir(texto); return t === null ? String(texto) : t; },
    // aplica a escolha vinda das configurações ('auto' | 'pt' | 'en' | ...)
    aplicarEscolha(valor) {
      const v = typeof valor === 'string' && valor ? valor : 'auto';
      try { localStorage.setItem('obsSocialIdioma', v); } catch {}
      if (v !== escolha) setIdioma(v); // sem mudança, o observador já mantém tudo
    },
    // 📺 v0.50: as páginas do PÚBLICO (overlay/chat no OBS) seguem o idioma
    // das configurações sem gravar nada — a escolha pessoal deste navegador
    // (localStorage) fica intocada.
    seguir(valor) {
      const v = typeof valor === 'string' && valor ? valor : 'auto';
      if (v !== escolha) setIdioma(v);
    },
    // lista dos idiomas disponíveis, nomeados no idioma vigente e em ordem alfabética
    idiomas() {
      const nomes = (dic && dic.nomes) || REG.pt.nomes;
      return ['pt'].concat(DISPONIVEIS)
        .map((codigo) => ({ codigo, nome: nomes[codigo] || (REG[codigo] && REG[codigo].nome) || codigo }))
        .sort((a, b) => a.nome.localeCompare(b.nome, atual));
    },
    aoMudar(fn) { aoMudarFns.push(fn); },
    get atual() { return atual; },
    get escolha() { return escolha; },
  };

  // Arranque: usa a última escolha conhecida deste navegador (sem esperar o
  // servidor), e o observador cobre tudo que a página ainda vai desenhar.
  try { escolha = localStorage.getItem('obsSocialIdioma') || 'auto'; } catch {}
  setIdioma(escolha);
  observador.observe(document.documentElement, {
    subtree: true, childList: true, characterData: true,
    attributes: true, attributeFilter: ATRIBUTOS,
  });
  if (!document.body) document.addEventListener('DOMContentLoaded', aplicaTudo);

  // 🔒 v0.50: o idioma é pessoal (deste navegador) — se OUTRA aba desta mesma
  // máquina trocar a escolha, esta acompanha na hora (o evento storage só
  // dispara nas outras abas, então não há eco em quem trocou).
  window.addEventListener('storage', (e) => {
    if (e.key !== 'obsSocialIdioma') return;
    const v = e.newValue || 'auto';
    if (v !== escolha) setIdioma(v);
  });
})();
