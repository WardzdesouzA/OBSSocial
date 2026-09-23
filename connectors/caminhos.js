// 🛡️ v0.172: os caminhos de reserva para falar com o site de cada rede.
//
// Nasceu no Kick (v0.169.3): o Cloudflare barra pedidos pela «assinatura» do
// TLS/HTTP de quem pergunta, não pelo que se pergunta. O fetch do Node levava
// 403 — e a consulta passou a ter caminhos de reserva, tentados nesta ordem:
//   1. fetch do Node (como sempre);
//   2. https do Node com as cifras e os cabeçalhos do Chrome (outra assinatura);
//   3. o curl do próprio sistema (o Windows 10+ traz o curl.exe; Mac e Linux idem);
//   4. o PowerShell (Windows): o Invoke-WebRequest usa o TLS do próprio Windows;
//   5. um navegador aberto neste computador (só onde o site aceita o pedido
//      de uma página — o Kick aceita; os outros não).
// O caminho que funcionou fica lembrado para os próximos pedidos e, de meia
// em meia hora, o programa volta a testar o fetch — o bloqueio costuma ser
// passageiro. Agora cada rede (Kick, YouTube, Twitch, Bilibili) tem a SUA
// cadeia, com a própria memória, feita por criarCaminhos().
//
// Segurança: o endereço, os cabeçalhos e o corpo do pedido NUNCA vão na linha
// de comando do curl/PowerShell (a linha de comando é visível a qualquer
// programa da máquina): vão pela entrada padrão — o curl lê a configuração
// («--config -») e o PowerShell recebe um JSON em base64 para um script fixo.
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const VIAS = ['fetch', 'tls', 'curl', 'powershell', 'navegador'];
const VIA_NOME = {
  fetch: 'pelo Node', tls: 'pelo Node com a assinatura do Chrome', curl: 'pelo curl do sistema',
  powershell: 'pelo PowerShell', navegador: 'pelo navegador aberto neste computador',
};
// O site barrou (ou pediu verificação): vale tentar o próximo caminho
const BARRADO_PADRAO = [403, 429, 503];
const MARCA = '__OBS_SOCIAL_STATUS__';
const SONDA_MS = 30 * 60 * 1000;   // de quanto em quanto tempo volta a testar o fetch
const PAUSA_EXTRAS_MS = 60 * 1000; // tudo barrado: os extras (avatar, audiência) esperam
const CORPO_MAX = 4e6;

const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
// Cifras na ordem do Chrome (TLS 1.3 + 1.2), curvas e assinaturas idem
const CHROME_CIPHERS = 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:'
  + 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:'
  + 'ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:'
  + 'ECDHE-RSA-AES128-SHA:ECDHE-RSA-AES256-SHA:AES128-GCM-SHA256:AES256-GCM-SHA384:AES128-SHA:AES256-SHA';
const CHROME_EXTRA = {
  'sec-ch-ua': '"Not/A)Brand";v="8", "Chromium";v="126", "Google Chrome";v="126"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Connection': 'close',
};
let agenteChrome = null;
function agenteDoChrome() {
  if (!agenteChrome) {
    agenteChrome = new https.Agent({
      keepAlive: false, ciphers: CHROME_CIPHERS, ecdhCurve: 'X25519:prime256v1:secp384r1', minVersion: 'TLSv1.2',
      sigalgs: 'ECDSA+SHA256:RSA-PSS+SHA256:RSA+SHA256:ECDSA+SHA384:RSA-PSS+SHA384:RSA+SHA384:RSA-PSS+SHA512:RSA+SHA512',
    });
  }
  return agenteChrome;
}

// Um pedido de verdade não pode virar outra coisa quando passa pelo curl ou
// pelo PowerShell: só endereços http(s) com caracteres comuns, cabeçalhos com
// nome simples e valor sem quebra de linha.
const ENDERECO_SEGURO = /^https?:\/\/[A-Za-z0-9._\-\/?=&%:~+@,;!*'()]+$/;
const CABECALHO_NOME = /^[A-Za-z0-9-]{1,64}$/;
const CABECALHO_VALOR = /^[^\r\n\0]{0,4096}$/;

function cabecalhosSeguros(headers) {
  const fora = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (!CABECALHO_NOME.test(k)) throw new Error(`cabeçalho fora do padrão (${String(k).slice(0, 20)})`);
    const valor = String(v == null ? '' : v);
    if (!CABECALHO_VALOR.test(valor)) throw new Error(`valor de cabeçalho fora do padrão (${k})`);
    fora[k] = valor;
  }
  return fora;
}

// Falha de rede pura (sem resposta HTTP nenhuma) num caminho do Node: os
// outros caminhos usam a mesma internet e vão cair igual — não vale a espera.
// Só as falhas claras (DNS, conexão recusada, sem rota): tempo esgotado e
// conexão derrubada podem ser o próprio bloqueio segurando o Node — aí os
// outros caminhos ainda valem a pena.
function redeFora(err) {
  const causa = err && (err.cause || err);
  const code = String((causa && causa.code) || '');
  return /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH/.test(code);
}

// Roda um programa mandando `entrada` pela entrada padrão; devolve stdout/stderr
function rodarPrograma(exe, args, entrada, tempoMs) {
  return new Promise((resolve, reject) => {
    let filho;
    try {
      filho = spawn(exe, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (err) { return reject(err); }
    const saida = []; const erro = [];
    let tamanho = 0; let acabou = false;
    const timer = setTimeout(() => { if (!acabou) { try { filho.kill(); } catch {} } }, tempoMs + 5000);
    filho.on('error', (err) => {
      acabou = true; clearTimeout(timer);
      if (err && err.code === 'ENOENT') { const e = new Error(`${exe} não encontrado`); e.code = 'ENOENT'; return reject(e); }
      reject(err);
    });
    filho.stdout.on('data', (c) => { tamanho += c.length; if (tamanho <= CORPO_MAX + 1024) saida.push(c); });
    filho.stderr.on('data', (c) => { if (erro.length < 64) erro.push(c); });
    filho.on('close', (code) => {
      acabou = true; clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(saida).toString('utf8'), stderr: Buffer.concat(erro).toString('utf8') });
    });
    filho.stdin.on('error', () => { /* o programa fechou a entrada antes: o resto conta a história */ });
    filho.stdin.end(entrada || '');
  });
}

// Texto para um valor entre aspas na configuração do curl («\» e «"» escapados)
const valorCurl = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';

// Script fixo do PowerShell: lê um JSON (base64) da entrada padrão e faz o
// pedido descrito nele. A 1ª linha da saída é o status; o resto, o corpo —
// decodificado dos bytes crus como UTF-8 (sem «charset», o PowerShell antigo
// leria Latin-1: João → JoÃ£o).
const SCRIPT_PS = "$ProgressPreference='SilentlyContinue';[Console]::OutputEncoding=[Text.Encoding]::UTF8;"
  + '$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))|ConvertFrom-Json;'
  + '$h=@{};foreach($k in $p.headers.PSObject.Properties){if($k.Name -ne "Content-Type"){$h[$k.Name]=$k.Value}};'
  + '$a=@{UseBasicParsing=$true;Uri=$p.url;Method=$p.method;Headers=$h;TimeoutSec=[int]$p.seg};'
  + 'if($p.body -ne $null){$a.Body=[Text.Encoding]::UTF8.GetBytes([string]$p.body);if($p.headers."Content-Type"){$a.ContentType=$p.headers."Content-Type"}};'
  + 'try{$r=Invoke-WebRequest @a;'
  + '$t=$r.Content;try{$t=[Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray())}catch{};'
  + '[Console]::Out.Write([string]$r.StatusCode+[char]10+$t)}'
  + 'catch{$c=0;try{$c=[int]$_.Exception.Response.StatusCode}catch{};[Console]::Out.Write([string]$c+[char]10+$_.Exception.Message)}';

// -----------------------------------------------------------------------------
// criarCaminhos({ rede, rotulo, headers, referer, barrado, tempoMs, navegador })
//   rede      = 'kick' | 'youtube' | ... (também nomeia os ganchos de teste:
//               OBS_TESTE_<REDE>_CURL / _PS / _VIAS / _TEMPO_MS, com os genéricos
//               OBS_TESTE_CURL / _PS / _VIAS / _TEMPO_MS como reserva)
//   rotulo    = como a rede aparece no console («Kick», «YouTube»...)
//   headers   = cabeçalhos de sempre (User-Agent, Accept...)
//   referer   = o Referer que a assinatura do Chrome manda
//   navegador = true quando o caminho 5 existe para esta rede
// Devolve { pedir, configurar, estado, nomeDaVia, explicacaoBarrado }.
// -----------------------------------------------------------------------------
function criarCaminhos(op) {
  const rede = String(op.rede || 'rede');
  const R = rede.toUpperCase();
  const rotulo = op.rotulo || rede;
  const artigo = op.artigo || 'O'; // «O YouTube», «A Bilibili»
  const env = (sufixo) => process.env[`OBS_TESTE_${R}_${sufixo}`] || process.env[`OBS_TESTE_${sufixo}`];
  const tempoMs = Number(env('TEMPO_MS')) || op.tempoMs || 12000;
  const barrado = new Set(op.barrado || BARRADO_PADRAO);
  const basicos = { 'User-Agent': UA_CHROME, 'Accept-Language': 'en-US,en;q=0.9', ...(op.headers || {}) };
  const viasDaRede = VIAS.filter((v) => v !== 'navegador' || op.navegador === true);
  const permitidasEnv = env('VIAS')
    ? String(env('VIAS')).split(',').map((v) => v.trim()).filter((v) => VIAS.includes(v))
    : null;

  const mem = {
    boa: 'fetch',            // o último caminho que funcionou
    sondaEm: 0,              // quando voltar a testar o fetch (se a boa não for ele)
    tudoBarradoEm: 0,        // a última vez em que NENHUM caminho passou
    indisponiveis: new Set(), // curl/PowerShell que não existem nesta máquina
  };
  // Gancho do servidor para o caminho 5: { disponivel(): bool, pedir(url): Promise<{status, texto}> }
  let navegador = null;
  function configurar(o) {
    navegador = o && o.navegador && typeof o.navegador.pedir === 'function' ? o.navegador : null;
  }
  function estado() { return { via: mem.boa, tudoBarradoEm: mem.tudoBarradoEm, sondaEm: mem.sondaEm }; }

  function viaDisponivel(via) {
    if (permitidasEnv && !permitidasEnv.includes(via)) return false;
    if (mem.indisponiveis.has(via)) return false;
    if (via === 'powershell') return process.platform === 'win32' || !!env('PS');
    if (via === 'navegador') return !!(navegador && navegador.disponivel());
    return true;
  }

  // Cada caminho recebe o pedido já conferido: { url, method, headers, body }
  // Tempo esgotado OU cancelado por quem pediu (um conector trocado não pode
  // continuar consultando o site)
  const sinalDe = (p) => (p.sinal && typeof AbortSignal.any === 'function'
    ? AbortSignal.any([AbortSignal.timeout(tempoMs), p.sinal]) : AbortSignal.timeout(tempoMs));

  async function viaFetch(p) {
    const res = await fetch(p.url, {
      method: p.method, headers: p.headers, body: p.body, redirect: 'follow',
      signal: sinalDe(p),
    });
    return { status: res.status, texto: await res.text() };
  }

  function viaTls(p) {
    return new Promise((resolve, reject) => {
      const alvo = new URL(p.url);
      const mod = alvo.protocol === 'http:' ? http : https;
      const headers = { ...p.headers, ...CHROME_EXTRA };
      if (op.referer && !headers.Referer) headers.Referer = op.referer;
      if (p.body != null) headers['Content-Length'] = Buffer.byteLength(p.body);
      const opcoes = { method: p.method, headers, timeout: tempoMs };
      if (mod === https) opcoes.agent = agenteDoChrome();
      const req = mod.request(alvo, opcoes, (res) => {
        let corpo = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (corpo.length < CORPO_MAX) corpo += c; });
        res.on('end', () => resolve({ status: res.statusCode || 0, texto: corpo }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
      req.on('error', reject);
      if (p.sinal) p.sinal.addEventListener('abort', () => req.destroy(new Error('pedido cancelado')), { once: true });
      req.end(p.body != null ? p.body : undefined);
    });
  }

  async function viaCurl(p) {
    const exe = env('CURL') || (process.platform === 'win32' ? 'curl.exe' : 'curl');
    // Tudo pela configuração na entrada padrão: nada de endereço, cabeçalho ou
    // corpo na linha de comando
    const linhas = [`url = ${valorCurl(p.url)}`];
    for (const [k, v] of Object.entries(p.headers)) linhas.push(`header = ${valorCurl(`${k}: ${v}`)}`);
    if (p.method !== 'GET') linhas.push(`request = ${valorCurl(p.method)}`);
    if (p.body != null) linhas.push(`data-binary = ${valorCurl(p.body)}`);
    const { code, stdout, stderr } = await rodarPrograma(exe, [
      '-sS', '-L', '--max-time', String(Math.ceil(tempoMs / 1000)),
      // «\n» aqui é o escape do próprio curl (vira quebra de linha na saída)
      '-o', '-', '-w', '\\n' + MARCA + '%{http_code}', '--config', '-',
    ], linhas.join('\n') + '\n', tempoMs);
    const i = stdout.lastIndexOf('\n' + MARCA);
    const status = i >= 0 ? Number(stdout.slice(i + MARCA.length + 1).trim()) : 0;
    if (!status) throw new Error(stderr.trim() || (code ? `o curl saiu com código ${code}` : 'o curl não conseguiu conectar'));
    return { status, texto: stdout.slice(0, i) };
  }

  async function viaPowerShell(p) {
    const exe = env('PS') || 'powershell.exe';
    const pedido = Buffer.from(JSON.stringify({
      url: p.url, method: p.method, headers: p.headers, body: p.body == null ? null : p.body, seg: Math.ceil(tempoMs / 1000),
    }), 'utf8').toString('base64');
    const { code, stdout, stderr } = await rodarPrograma(exe,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', SCRIPT_PS], pedido, tempoMs);
    const quebra = stdout.indexOf('\n');
    const status = Number((quebra >= 0 ? stdout.slice(0, quebra) : stdout).trim());
    if (!status) throw new Error((quebra >= 0 ? stdout.slice(quebra + 1) : stderr).trim() || (code ? `o PowerShell saiu com código ${code}` : 'o PowerShell não conseguiu conectar'));
    return { status, texto: quebra >= 0 ? stdout.slice(quebra + 1) : '' };
  }

  async function viaNavegador(p) {
    if (!navegador) { const e = new Error('nenhum navegador aberto neste computador'); e.semNavegador = true; throw e; }
    if (p.method !== 'GET') { const e = new Error('o navegador só faz consultas simples'); e.code = 'ENOENT'; throw e; }
    return navegador.pedir(p.url);
  }

  const PEDIDORES = { fetch: viaFetch, tls: viaTls, curl: viaCurl, powershell: viaPowerShell, navegador: viaNavegador };

  // Quem barra («o Cloudflare» no Kick; «o site» nas outras) — só para o console
  const bloqueador = op.bloqueador || 'o site';
  function lembrarVia(via) {
    if (via === mem.boa) return;
    if (via === 'fetch') console.log(`  🟢 ${rotulo}: o caminho normal (fetch do Node) voltou a passar${op.bloqueador ? ' pel' + bloqueador : ''}.`);
    else console.log(`  🟢 ${rotulo}: ${bloqueador} barrou o caminho ${VIA_NOME[mem.boa]}; a consulta passou a ser feita ${VIA_NOME[via]}.`);
    mem.boa = via;
  }

  // Tenta os caminhos na ordem; devolve a resposta do primeiro que passou ou
  // null. `est` acumula o que aconteceu (para a mensagem final).
  async function tentarVias(p, vias, est) {
    for (const via of vias) {
      if (est.parou || !viaDisponivel(via)) continue;
      if (est.sinal && est.sinal.aborted) { est.parou = true; break; }
      est.tentadas.push(via);
      let r;
      try {
        r = await PEDIDORES[via](p);
      } catch (err) {
        est.ultimoErro = err;
        // O navegador só faz GET: para um POST ele «não existe» nesta rodada —
        // mas continua valendo para as consultas simples
        if (err && err.code === 'ENOENT' && !(via === 'navegador' && p.method !== 'GET')) mem.indisponiveis.add(via);
        // O navegador está com a fila cheia: não é um caminho barrado — o
        // pedido extra desiste sem aprender nada disso
        if (err && err.ocupado && est.extra) { est.parou = true; est.ocupado = true; }
        // A página tentou e o pedido «falhou» sem status: é a cara do desafio
        // do Cloudflare (a resposta 403 vem sem os cabeçalhos CORS, e o
        // navegador esconde o status). Se algum caminho levou 403 nesta rodada,
        // conta como o navegador barrado — a dica certa é passar pela verificação
        if (via === 'navegador' && err && err.corsBarrado) est.navegadorCors = true;
        // Rede fora num caminho do Node, sem NENHUMA resposta HTTP até agora:
        // os outros caminhos vão cair igual
        if ((via === 'fetch' || via === 'tls') && !est.barrado && redeFora(err)) est.parou = true;
        continue;
      }
      if (barrado.has(r.status)) {
        est.barrado = { status: r.status, via };
        if (via === 'navegador') est.navegadorBarrado = true;
        continue;
      }
      lembrarVia(via);
      mem.tudoBarradoEm = 0; // passou por algum caminho: os extras voltam na hora
      let json = null;
      try { json = JSON.parse(r.texto); } catch { /* não era JSON: quem pediu confere */ }
      return { status: r.status, ok: r.status >= 200 && r.status < 300, texto: r.texto, json, via };
    }
    return null;
  }

  // Os pedidos extras (avatar, audiência, histórico) não podem virar uma
  // enxurrada de curl/PowerShell quando chegam 50 comentários de uma vez:
  // eles usam só o caminho lembrado e, se ele falhar, UM de cada vez percorre
  // a cadeia inteira — os outros desistem na hora (a foto volta na varredura).
  let extraNaCadeia = false;

  // pedir(url, { method, headers, body, extra, sinal })
  // Devolve { status, ok, texto, json, via }. Lança erro quando nenhum caminho
  // respondeu — com .barrado (todos levaram 403/429/503), .status, .vias
  // (os caminhos tentados), .semNavegador (não havia página aberta para o 5)
  // e .navegadorBarrado (a página foi consultada e também levou 403).
  // `extra: true` = pedido que não é essencial (avatar, audiência): quando
  // tudo acabou de ser barrado, desiste na hora em vez de insistir.
  async function pedir(url, opcoes = {}) {
    if (!ENDERECO_SEGURO.test(String(url))) throw new Error('endereço fora do padrão');
    const extra = opcoes.extra === true;
    const method = String(opcoes.method || 'GET').toUpperCase();
    const p = {
      url: String(url), method,
      headers: cabecalhosSeguros({ ...basicos, ...(opcoes.headers || {}) }),
      body: opcoes.body == null ? null : String(opcoes.body),
      sinal: opcoes.sinal || null,
    };
    const erroRapido = (msg) => { const e = new Error(msg); e.barrado = true; e.status = 403; e.vias = []; e.rapido = true; return e; };
    if (extra && mem.tudoBarradoEm && Date.now() - mem.tudoBarradoEm < PAUSA_EXTRAS_MS) {
      throw erroRapido(`${rotulo} barrado agora há pouco; este pedido pode esperar.`);
    }
    const ordem = [mem.boa, ...viasDaRede.filter((v) => v !== mem.boa)];
    if (mem.boa !== 'fetch' && !extra && Date.now() >= mem.sondaEm) {
      mem.sondaEm = Date.now() + SONDA_MS;
      ordem.splice(ordem.indexOf('fetch'), 1);
      ordem.unshift('fetch');
    }
    const est = { extra, sinal: opcoes.sinal || null, tentadas: [], barrado: null, navegadorBarrado: false, navegadorCors: false, ultimoErro: null, parou: false, ocupado: false };
    let r;
    if (!extra) {
      r = await tentarVias(p, ordem, est);
    } else {
      r = await tentarVias(p, ordem.slice(0, 1), est); // só o caminho lembrado
      if (!r && !est.parou) {
        if (extraNaCadeia) throw erroRapido(`Outro pedido já está procurando um caminho para ${artigo.toLowerCase()} ${rotulo}; este pode esperar.`);
        extraNaCadeia = true;
        try { r = await tentarVias(p, ordem.slice(1), est); } finally { extraNaCadeia = false; }
      }
    }
    if (r) return r;
    if (est.ocupado) throw erroRapido('O navegador já tem consultas demais na fila; este pedido pode esperar.');
    if (est.sinal && est.sinal.aborted) { const e = new Error('pedido cancelado'); e.cancelado = true; e.vias = est.tentadas; throw e; }
    if (est.barrado && est.navegadorCors) est.navegadorBarrado = true;
    const e = new Error(est.barrado
      ? `${rotulo} respondeu com erro ${est.barrado.status}.`
      : (est.ultimoErro && est.ultimoErro.message) || `${artigo} ${rotulo} não respondeu.`);
    e.barrado = !!est.barrado;
    e.status = est.barrado ? est.barrado.status : 0;
    e.vias = est.tentadas;
    e.semNavegador = !est.tentadas.includes('navegador');
    e.navegadorBarrado = est.navegadorBarrado;
    e.redeFora = !est.barrado && !!est.ultimoErro && redeFora(est.ultimoErro);
    if (est.barrado) mem.tudoBarradoEm = Date.now();
    throw e;
  }

  // A frase para o apresentador quando o site barrou todos os caminhos
  function explicacaoBarrado(err) {
    if (op.navegador === true) {
      if (err && err.navegadorBarrado) {
        return `${artigo} ${rotulo} barrou até o navegador deste computador. Abra o site do ${rotulo} neste mesmo navegador, passe pela verificação «sou humano» e clique em 🔄 aqui.`;
      }
      return `${artigo} ${rotulo} barrou o programa. Abra o painel ou as configurações num navegador deste computador e deixe aberto: a consulta passa a ser feita por ele.`;
    }
    return `${artigo} ${rotulo} barrou as consultas automáticas deste computador (todos os caminhos: Node, curl e PowerShell). Costuma passar sozinho em alguns minutos — o programa continua tentando.`;
  }

  return { pedir, configurar, estado, explicacaoBarrado, nomeDaVia: (v) => VIA_NOME[v] || v, rede, rotulo };
}

module.exports = { criarCaminhos, VIAS, VIA_NOME, UA_CHROME, redeFora };
