// 💜 v0.174: conector da LivePix — pela API OFICIAL (docs.livepix.gg/api).
//
// O streamer cria uma aplicação na conta dele e cola o ID e o segredo do
// cliente nas conexões. Daí em diante o programa:
//   • emite um token (client_credentials) e o reaproveita até expirar — a
//     LivePix monitora emissão desnecessária de tokens e pode encerrar a conta;
//   • lê as mensagens (doações com texto) e os pagamentos (sem texto) de
//     tempos em tempos e transforma cada um num comentário 💜 do painel,
//     com nome, valor, texto e ID (nunca repete: os ids vistos ficam no disco);
//   • lê, em cadências mais lentas, os controles dos alertas (autoPlay),
//     a carteira (saldo, a receber, transações), as assinaturas e os planos,
//     as recompensas e as concessões — tudo o que a API entrega em leitura;
//   • executa os controles dos alertas pedidos pelo painel: represar/soltar
//     (autoPlay), pular o atual e repetir o último.
// Consulta periódica, sem webhook: o programa roda no PC do streamer.
// Cada endpoint tem um limite por minuto (cabeçalho X-RateLimit-Limit);
// estourou (429), o programa espera mais entre as consultas até passar.
const { criarCaminhos } = require('./caminhos');

const LP_API = (process.env.OBS_TESTE_LIVEPIX_API || 'https://api.livepix.gg/').replace(/\/?$/, '/');
const LP_OAUTH = process.env.OBS_TESTE_LIVEPIX_OAUTH || 'https://oauth.livepix.gg/oauth2/token';
const ESCOPOS = 'account:read messages:read payments:read wallet:read currencies:read subscriptions:read subscription-plans:read rewards:read controls';
// Intervalo entre as consultas de mensagens/pagamentos: o limite da API é de
// 1000 chamadas por minuto por endpoint, então o mínimo permitido aqui (5 s)
// fica bem longe de incomodar; o padrão de 15 s é o meio-termo entre
// «chega rápido» e «não pesa».
const INTERVALO_MIN_MS = 5000;
const INTERVALO_MAX_MS = 300000;
const INTERVALO_PADRAO_MS = 15000;
// Gancho de teste: força o intervalo (a LivePix de mentira aguenta)
const INTERVALO_FORCADO_MS = Number(process.env.OBS_TESTE_LIVEPIX_INTERVALO_MS) || 0;
// Cadência dos extras (a carteira tem limite de 100/min e os planos de 50/min)
const CADENCIA = { controles: 30000, carteira: 60000, assinaturas: 300000, recompensas: 300000 };
const ESPERA_BASE_MS = Number(process.env.OBS_TESTE_ESPERA_MS) || 15000;
const ESPERA_MAX_MS = Math.max(ESPERA_BASE_MS * 4, 300000 * (ESPERA_BASE_MS / 15000));

// 429 aqui é o limite de chamadas (não um bloqueio): fica de fora da lista
// de «barrado», senão a cadeia tentaria curl/PowerShell à toa
const caminhos = criarCaminhos({ rede: 'livepix', rotulo: 'LivePix', headers: { Accept: 'application/json' }, referer: 'https://livepix.gg/', tempoMs: 15000, barrado: [403, 503] });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// Centavos → «R$ 10,00» (ou «USD 10.00» para outra moeda, que a LivePix não
// oferece hoje — só BRL — mas o campo existe)
function valorTexto(centavos, moeda) {
  const n = (Number(centavos) || 0) / 100;
  if (!moeda || moeda === 'BRL') return 'R$ ' + n.toFixed(2).replace('.', ',');
  return `${moeda} ${n.toFixed(2)}`;
}

class LivePixConnector {
  constructor(channel, handlers, options = {}) {
    this.clientId = String(channel || '').trim();
    this.clientSecret = String(options.token || '').trim();
    this.handlers = handlers;
    this.intervaloMs = INTERVALO_FORCADO_MS || clamp(Number(options.intervaloMs) || INTERVALO_PADRAO_MS, INTERVALO_MIN_MS, INTERVALO_MAX_MS);
    this.vistos = options.vistos instanceof Set ? options.vistos : new Set();
    this.salvarVistos = typeof options.salvarVistos === 'function' ? options.salvarVistos : () => {};
    // Sem memória de outra sessão, a 1ª consulta só marca o que já existia
    // (senão o painel inundava com doações antigas)
    this.primeira = this.vistos.size === 0;
    this.provas = new Set(); // comprovantes já vistos como mensagem (um pagamento com o mesmo comprovante não entra duas vezes)
    this.stopped = false;
    this.token = null;
    this.tokenExpira = 0;
    this.timer = null;
    this.connectTimer = null;
    this.conta = null;
    this.dados = {};
    this.ultima = {};      // quando cada extra foi lido
    this.espera = 0;       // 429: espera extra entre consultas
    this.errou = false;
  }

  definirIntervalo(ms) { this.intervaloMs = INTERVALO_FORCADO_MS || clamp(Number(ms) || INTERVALO_PADRAO_MS, INTERVALO_MIN_MS, INTERVALO_MAX_MS); }

  async obterToken() {
    if (this.token && Date.now() < this.tokenExpira - 60000) return this.token;
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret, scope: ESCOPOS });
    const r = await caminhos.pedir(LP_OAUTH, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() });
    if (r.status === 400 || r.status === 401) {
      const e = new Error('A LivePix recusou as credenciais — confira o ID e o segredo do cliente da aplicação.');
      e.definitivo = true; throw e;
    }
    if (!r.ok || !r.json || !r.json.access_token) throw new Error(`A LivePix não entregou o token (HTTP ${r.status}).`);
    this.token = r.json.access_token;
    this.tokenExpira = Date.now() + Math.max(60, Number(r.json.expires_in) || 3600) * 1000;
    return this.token;
  }

  // Um pedido à API, com o token; 401 = token vencido: emite outro e repete uma vez
  async pedir(caminho, opcoes = {}, repetindo = false) {
    const token = await this.obterToken();
    const headers = { Authorization: 'Bearer ' + token, ...(opcoes.body != null ? { 'Content-Type': 'application/json' } : {}) };
    const r = await caminhos.pedir(LP_API + caminho.replace(/^\//, ''), { method: opcoes.method || 'GET', headers, body: opcoes.body == null ? null : JSON.stringify(opcoes.body), extra: opcoes.extra === true });
    if (r.status === 401 && !repetindo) { this.token = null; return this.pedir(caminho, opcoes, true); }
    if (r.status === 429) { const e = new Error('A LivePix pediu calma (limite de chamadas por minuto).'); e.limite = true; throw e; }
    return r;
  }

  async start() {
    this.handlers.onStatus('connecting', 'Conectando à LivePix...');
    try {
      const r = await this.pedir('v2/account');
      if (!r.ok || !r.json || !r.json.data) throw new Error(`A LivePix respondeu com erro ${r.status} ao ler a conta.`);
      this.conta = r.json.data;
      this.emitirDados('conta', { id: this.conta.id, username: this.conta.username, displayName: this.conta.displayName, avatar: this.conta.avatar || null });
      this.connectRetryMs = 0;
    } catch (err) {
      if (this.stopped) return;
      if (err.definitivo) { this.handlers.onStatus('error', err.message); return; }
      this.connectRetryMs = Math.min((this.connectRetryMs || ESPERA_BASE_MS) * 2, ESPERA_MAX_MS);
      const s = Math.round(this.connectRetryMs / 1000);
      const explicacao = err.barrado ? ' ' + caminhos.explicacaoBarrado(err) : '';
      this.handlers.onStatus('error', `${err.message}${explicacao} Nova tentativa sozinha em ${s}s.`, { insiste: true });
      this.connectTimer = setTimeout(() => { this.connectTimer = null; if (!this.stopped) this.start(); }, this.connectRetryMs);
      return;
    }
    if (this.stopped) return;
    this.handlers.onStatus('connected', `Conectado como ${this.conta.displayName || this.conta.username} (@${this.conta.username})`);
    this.tick();
  }

  agendar() {
    if (this.stopped) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), this.intervaloMs + this.espera);
  }

  async tick() {
    if (this.stopped) return;
    try {
      await this.lerMensagens();
      await this.lerPagamentos();
      if (this.primeira) { this.primeira = false; this.salvarVistos(this.vistos); }
      const agora = Date.now();
      for (const [chave, ms] of Object.entries(CADENCIA)) {
        if (this.stopped) return;
        if (agora - (this.ultima[chave] || 0) < ms) continue;
        this.ultima[chave] = agora;
        try { await this['ler' + chave[0].toUpperCase() + chave.slice(1)](); }
        catch (err) { if (err.limite) this.ultima[chave] = agora - ms + 60000; /* um extra que falhou volta na próxima cadência */ }
      }
      if (this.espera) this.espera = 0;
      if (this.errou) { this.errou = false; this.handlers.onStatus('connected', `Conectado como ${this.conta.displayName || this.conta.username} (@${this.conta.username})`); }
    } catch (err) {
      if (this.stopped) return;
      this.errou = true;
      if (err.definitivo) { this.handlers.onStatus('error', err.message); return; }
      if (err.limite) {
        // 429: dobra a espera até 5 minutos e conta para o apresentador
        this.espera = Math.min(Math.max(this.espera * 2, 15000), 300000);
        this.handlers.onStatus('connecting', `A LivePix pediu calma (limite de chamadas) — próxima consulta em ${Math.round((this.intervaloMs + this.espera) / 1000)}s.`);
      } else {
        const explicacao = err.barrado ? ' ' + caminhos.explicacaoBarrado(err) : '';
        this.handlers.onStatus('connecting', `Sem resposta da LivePix — tentando de novo... (${String(err.message || err).slice(0, 80)})${explicacao}`);
      }
    }
    this.agendar();
  }

  // As mensagens (doações com texto), da mais antiga para a mais nova
  async lerMensagens() {
    const r = await this.pedir('v2/messages?limit=100');
    if (!r.ok || !r.json) throw new Error(`A LivePix respondeu com erro ${r.status} ao ler as mensagens.`);
    const lista = Array.isArray(r.json.data) ? r.json.data.slice() : [];
    lista.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    let novas = 0;
    for (const m of lista) {
      if (!m || !m.id) continue;
      if (m.proof) this.provas.add(String(m.proof));
      const chave = 'm:' + m.id;
      if (this.vistos.has(chave)) continue;
      this.vistos.add(chave);
      if (this.primeira) continue;
      novas += 1;
      this.emitir(m, true);
    }
    if (novas) this.salvarVistos(this.vistos);
  }

  // Os pagamentos sem texto (um pagamento cujo comprovante já veio numa
  // mensagem não entra de novo)
  async lerPagamentos() {
    const r = await this.pedir('v2/payments?limit=100');
    if (!r.ok || !r.json) throw new Error(`A LivePix respondeu com erro ${r.status} ao ler os pagamentos.`);
    const lista = Array.isArray(r.json.data) ? r.json.data.slice() : [];
    lista.sort((a, b) => (Date.parse(a.createdAt) || 0) - (Date.parse(b.createdAt) || 0));
    let novos = 0;
    for (const p of lista) {
      if (!p || !p.id) continue;
      const chave = 'p:' + p.id;
      if (this.vistos.has(chave)) continue;
      this.vistos.add(chave);
      if (this.primeira) continue;
      if (p.proof && this.provas.has(String(p.proof))) continue;
      novos += 1;
      this.emitir(p, false);
    }
    if (novos) this.salvarVistos(this.vistos);
  }

  emitir(item, comMensagem) {
    const valor = valorTexto(item.amount, item.currency);
    const nome = String(item.username || '').trim().slice(0, 60) || 'Anônimo';
    const texto = comMensagem ? String(item.message || '').slice(0, 500) : '';
    const badges = ['livepix ' + valor];
    if (item.flagged === true) badges.push('sinalizada'); // a LivePix marcou a mensagem
    this.handlers.onMessage({
      platform: 'livepix',
      channel: this.conta ? this.conta.username : 'livepix',
      id: 'lp-' + String(item.id),
      author: nome,
      authorLogin: nome.toLowerCase(),
      authorColor: null,
      avatar: null,
      badges,
      superchat: { amount: valor, color: '#7c3aed', headerColor: '#5b21b6', textColor: '#ffffff' },
      runs: [{ type: 'text', text: texto }],
      timestamp: Date.parse(item.createdAt) || Date.now(),
      livepix: { comprovante: item.proof || null, referencia: item.reference || null, pagamento: !comMensagem, moeda: item.currency || 'BRL', centavos: Number(item.amount) || 0 },
    });
  }

  emitirDados(chave, valor) {
    this.dados[chave] = valor;
    this.dados.atualizadoEm = Date.now();
    if (this.handlers.onDados) this.handlers.onDados('livepix', { ...this.dados });
  }

  async lerControles() {
    const r = await this.pedir('v2/controls', { extra: true });
    if (r.ok && r.json && r.json.data) this.emitirDados('controles', { autoPlay: r.json.data.autoPlay === true });
  }
  async lerCarteira() {
    const r = await this.pedir('v2/wallet', { extra: true });
    if (!r.ok || !r.json) return;
    const carteiras = Array.isArray(r.json.data) ? r.json.data : [];
    const detalhes = [];
    for (const c of carteiras.slice(0, 3)) {
      const moeda = String(c.currency || 'BRL');
      let recebiveis = []; let transacoes = [];
      try { const rr = await this.pedir(`v2/wallet/${encodeURIComponent(moeda)}/receivables?limit=50`, { extra: true }); if (rr.ok && rr.json) recebiveis = Array.isArray(rr.json.data) ? rr.json.data : []; } catch { /* extra */ }
      try { const rt = await this.pedir(`v2/wallet/${encodeURIComponent(moeda)}/transactions?limit=20`, { extra: true }); if (rt.ok && rt.json) transacoes = Array.isArray(rt.json.data) ? rt.json.data : []; } catch { /* extra */ }
      detalhes.push({
        moeda, saldo: Number(c.balance) || 0, emTransito: Number(c.balanceHeld) || 0, pendente: Number(c.balancePending) || 0,
        aReceber: recebiveis.reduce((s, x) => s + (Number(x.amount) || 0), 0),
        recebiveis: recebiveis.slice(0, 20).map((x) => ({ valor: Number(x.amount) || 0, liberaEm: Number(x.releaseAt) ? Number(x.releaseAt) * 1000 : null, comprovante: x.proof || null })),
        transacoes: transacoes.slice(0, 20).map((x) => ({ valor: Number(x.amount) || 0, saldo: Number(x.balance) || 0, em: Number(x.timestamp) ? (Number(x.timestamp) > 1e12 ? Number(x.timestamp) : Number(x.timestamp) * 1000) : null, comprovante: x.proof || null })),
      });
    }
    this.emitirDados('carteira', detalhes);
  }
  async lerAssinaturas() {
    let planos = []; let assinaturas = [];
    try { const rp = await this.pedir('v2/subscriptions/plans', { extra: true }); if (rp.ok && rp.json) planos = (Array.isArray(rp.json.data) ? rp.json.data : []).map((p) => ({ id: p.id, slug: p.slug, nome: p.name, descricao: String(p.description || '').slice(0, 200), valor: Number(p.amount) || 0, moeda: p.currency || 'BRL' })); } catch { /* extra */ }
    const r = await this.pedir('v2/subscriptions?limit=100', { extra: true });
    if (r.ok && r.json) assinaturas = (Array.isArray(r.json.data) ? r.json.data : []).map((s) => ({ id: s.id, assinante: s.subscriber, meses: Number(s.months) || 0, valor: Number(s.amount) || 0, moeda: s.currency || 'BRL', recorrencia: s.recurrence || null, status: s.status || null, renovaEm: s.renewAt ? (Date.parse(s.renewAt) || null) : null, desde: s.createdAt ? (Date.parse(s.createdAt) || null) : null }));
    this.emitirDados('assinaturas', { planos, assinaturas });
  }
  async lerRecompensas() {
    const r = await this.pedir('v2/rewards', { extra: true });
    if (!r.ok || !r.json) return;
    const lista = Array.isArray(r.json.data) ? r.json.data : [];
    const recompensas = [];
    for (const rec of lista.slice(0, 20)) {
      let concessoes = [];
      try { const rg = await this.pedir(`v2/rewards/${encodeURIComponent(rec.id)}/grants?limit=50`, { extra: true }); if (rg.ok && rg.json) concessoes = (Array.isArray(rg.json.data) ? rg.json.data : []).map((g) => ({ id: g.id, usuario: g.user && g.user.username ? g.user.username : null, status: g.status || null, em: g.createdAt ? (Date.parse(g.createdAt) || null) : null })); } catch { /* extra */ }
      recompensas.push({ id: rec.id, tipo: rec.type || null, titulo: rec.title || '', descricao: String(rec.description || '').slice(0, 200), valor: Number(rec.amount) || 0, status: rec.status || null, concessoes });
    }
    this.emitirDados('recompensas', recompensas);
  }

  // 🎛️ Os controles dos alertas: {autoPlay: bool} represa/solta a fila da
  // LivePix; {skip: true} pula o alerta atual; {replay: true} repete o último
  async controlar(pedido) {
    const p = pedido || {};
    if (typeof p.autoPlay === 'boolean') {
      const r = await this.pedir('v2/controls', { method: 'PATCH', body: { autoPlay: p.autoPlay } });
      if (!r.ok) throw new Error(`A LivePix respondeu com erro ${r.status} ao mudar os controles.`);
    }
    if (p.skip === true) { const r = await this.pedir('v2/controls/skip', { method: 'POST', body: {} }); if (!r.ok) throw new Error(`A LivePix respondeu com erro ${r.status} ao pular o alerta.`); }
    if (p.replay === true) { const r = await this.pedir('v2/controls/replay', { method: 'POST', body: {} }); if (!r.ok) throw new Error(`A LivePix respondeu com erro ${r.status} ao repetir o alerta.`); }
    await this.lerControles();
    return this.dados.controles || null;
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    if (this.connectTimer) clearTimeout(this.connectTimer);
  }
}

module.exports = { LivePixConnector, livepixCaminhos: caminhos, valorTexto, INTERVALO_MIN_MS, INTERVALO_MAX_MS, INTERVALO_PADRAO_MS };
