// ===========================================================================
// 🛟 v0.189: a conferência de integridade (SHA-256) do que o programa baixa
// e depois USA ou EXECUTA — o yt-dlp, o motor do whisper.cpp, o ffmpeg e os
// modelos da transcrição.
//
// Até a v0.188 o arquivo chegava por https e ia direto para o disco e para o
// spawn: um download corrompido no meio do caminho, um antivírus/proxy que
// abre o https ou um arquivo trocado no servidor passavam sem ninguém ver.
// Agora cada arquivo é comparado com a soma SHA-256 OFICIAL antes de ser usado:
//   • versão fixada no programa (whisper.cpp v1.8.2, os modelos num commit
//     fixo do Hugging Face) → a soma fica fixa no código;
//   • «latest» (yt-dlp, ffmpeg do BtbN) → a soma vem do arquivo de somas do
//     MESMO release, lido ANTES do download;
//   • uma tag escolhida no inventário (whisper.cpp mais novo) → o «digest»
//     que o GitHub publica para o arquivo do release.
// A conta é feita pelo crypto do Node, em fluxo, enquanto o arquivo chega —
// nada de programa externo (certutil, PowerShell, curl). Não conferiu → o
// arquivo é apagado, não é usado e o painel avisa.
// ===========================================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');

const HEX64 = /^[0-9a-f]{64}$/;

// Um arquivo de somas no formato do sha256sum (o «SHA2-256SUMS» do yt-dlp, o
// «checksums.sha256» do BtbN): «<64 hex> <espaço ou *><nome>» por linha.
// Devolve Map nome → soma (minúsculas).
function lerSomas(texto) {
  const mapa = new Map();
  for (const linha of String(texto || '').split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(linha.trim());
    if (m) mapa.set(m[2].replace(/^\.\//, ''), m[1].toLowerCase());
  }
  return mapa;
}

// O «digest» de um arquivo de release na API do GitHub: «sha256:<64 hex>»
function somaDoDigest(digest) {
  const m = /^sha256:([0-9a-f]{64})$/i.exec(String(digest || '').trim());
  return m ? m[1].toLowerCase() : null;
}

const somaValida = (s) => HEX64.test(String(s || ''));

// A soma de um arquivo que já está no disco, em fluxo (um modelo tem 1,5 GB)
function somaDoArquivo(caminho) {
  return new Promise((resolve, reject) => {
    const conta = crypto.createHash('sha256');
    const leitura = fs.createReadStream(caminho);
    leitura.on('data', (pedaco) => conta.update(pedaco));
    leitura.on('end', () => resolve(conta.digest('hex')));
    leitura.on('error', reject);
  });
}

const somaDoBuffer = (dados) => crypto.createHash('sha256').update(dados).digest('hex');

// GET pequeno (arquivo de somas, JSON da API do GitHub), com tempo limite e
// teto de tamanho. Segue até 5 redirecionamentos, sem cair de https para
// http; com `seguir: 0` devolve o próprio 3xx e o destino (é assim que se
// descobre para qual release o «latest» aponta).
function buscarTexto(url, opcoes = {}, saltos = 0) {
  const { teto = 2 * 1024 * 1024, tempoMs = 15000, cabecalhos = {}, seguir = 5 } = opcoes;
  return new Promise((resolve, reject) => {
    let alvo;
    try { alvo = new URL(url); } catch { reject(new Error('endereço inválido')); return; }
    const mod = alvo.protocol === 'https:' ? https : alvo.protocol === 'http:' ? http : null;
    if (!mod) { reject(new Error('endereço não permitido')); return; }
    const req = mod.get(alvo, { headers: { 'User-Agent': 'OBS-Social', ...cabecalhos } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        let prox;
        try { prox = new URL(res.headers.location, alvo); } catch { reject(new Error('redirecionamento inválido')); return; }
        if (seguir <= 0) { resolve({ status, texto: '', url: alvo.toString(), destino: prox.toString() }); return; }
        if (prox.protocol !== 'https:' && prox.protocol !== 'http:') { reject(new Error('redirecionamento para um endereço não permitido')); return; }
        if (alvo.protocol === 'https:' && prox.protocol === 'http:') { reject(new Error('redirecionamento de https para http recusado')); return; }
        if (saltos >= 5) { reject(new Error('redirecionamento demais')); return; }
        resolve(buscarTexto(prox.toString(), { ...opcoes, seguir: seguir - 1 }, saltos + 1));
        return;
      }
      const pedacos = [];
      let total = 0;
      res.on('data', (c) => {
        total += c.length;
        if (total > teto) { req.destroy(new Error('resposta maior que o esperado')); return; }
        pedacos.push(c);
      });
      res.on('end', () => resolve({ status, texto: Buffer.concat(pedacos).toString('utf8'), url: alvo.toString() }));
      res.on('error', reject);
    });
    req.setTimeout(tempoMs, () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

// ---------- a anotação do que já foi conferido ----------
// conferidos.json na pasta do componente: { "<arquivo>": { sha256, bytes, … } }.
// Só entra o que passou pela conferência; o executável sem anotação (baixado
// antes da v0.189) não é usado — o painel oferece baixar de novo.
function lerConferidos(dir) {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'conferidos.json'), 'utf8'));
    return j && typeof j === 'object' && !Array.isArray(j) ? j : {};
  } catch { return {}; }
}
function anotarConferido(dir, arquivo, dados) {
  try {
    const atual = lerConferidos(dir);
    if (dados) atual[arquivo] = { ...dados, em: new Date().toISOString() };
    else delete atual[arquivo];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'conferidos.json'), JSON.stringify(atual, null, 2) + '\n');
  } catch { /* sem anotação: o arquivo fica «sem conferência» e o painel pede para baixar de novo */ }
}
// Anotado E do mesmo tamanho (um arquivo trocado à mão perde a anotação)
function estaConferido(dir, arquivo) {
  const a = lerConferidos(dir)[arquivo];
  if (!a || !somaValida(a.sha256)) return false;
  try { return fs.statSync(path.join(dir, arquivo)).size === a.bytes; } catch { return false; }
}

// ---------- os recados (o painel traduz pelos dicionários) ----------
// As duas somas vão só para a janela preta (para quem for investigar); o painel
// recebe o recado, com e.integridade = true (fica na tela até um clique)
function erroNaoConfere(arquivo, esperada, veio) {
  console.warn(`  🛟 Integridade: ${arquivo} não confere com a soma SHA-256 oficial (esperada ${esperada || '?'}, veio ${veio || '?'}) — apagado, não será usado.`);
  const e = new Error(`o arquivo baixado (${arquivo}) não confere com a soma SHA-256 oficial — foi apagado e não será usado. Pode ter sido corrompido ou trocado no caminho; tente de novo mais tarde.`);
  e.integridade = true;
  return e;
}
function erroSemSoma(arquivo, motivo) {
  return new Error(`não consegui a soma SHA-256 oficial de ${arquivo} (${String(motivo || 'sem resposta').slice(0, 120)}) — por segurança, nada foi baixado. Tente de novo mais tarde.`);
}

module.exports = {
  lerSomas, somaDoDigest, somaValida, somaDoArquivo, somaDoBuffer, buscarTexto,
  lerConferidos, anotarConferido, estaConferido, erroNaoConfere, erroSemSoma,
};
