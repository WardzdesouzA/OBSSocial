// 🙋 Pedidos — gravação e leitura seguras dos arquivos em data/.
//
// gravarAtomico: escreve num arquivo temporário ao lado, força para o disco e
// troca pelo nome certo (renomear é atômico no mesmo disco): um programa que
// fecha no meio nunca deixa o arquivo pela metade. No Windows a troca por cima
// pode falhar por um instante (EPERM, EBUSY, EACCES) quando o antivírus, o
// OneDrive ou o Dropbox seguram o arquivo: tenta de novo algumas vezes e, no
// fim, grava direto (melhor que perder a mudança).
//
// lerJsonSeguro: lê um JSON; se o arquivo existe mas não abre (cortado, travado,
// sem permissão), guarda uma cópia «.ilegivel-<hora>» ANTES de qualquer coisa
// gravar por cima e avisa quem chamou — quem chamou decide se pode gravar.
'use strict';
const fs = require('fs');
const path = require('path');

const ESPERAS_MS = [15, 40, 120, 300];

function dormirSincrono(ms) {
  try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* sem espera: tenta de novo na hora */ }
}

function gravarAtomico(arquivo, conteudo, { privado = false } = {}) {
  const dir = path.dirname(arquivo);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${arquivo}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const modo = privado ? 0o600 : 0o644;
  const fd = fs.openSync(tmp, 'w', modo);
  try {
    fs.writeSync(fd, typeof conteudo === 'string' ? conteudo : String(conteudo));
    try { fs.fsyncSync(fd); } catch { /* alguns sistemas de arquivos não deixam: segue */ }
  } finally {
    fs.closeSync(fd);
  }
  let ultimo = null;
  for (let i = 0; i <= ESPERAS_MS.length; i++) {
    try {
      fs.renameSync(tmp, arquivo);
      if (privado) { try { fs.chmodSync(arquivo, 0o600); } catch { /* Windows: sem chmod */ } }
      return true;
    } catch (err) {
      ultimo = err;
      if (!['EPERM', 'EBUSY', 'EACCES', 'EEXIST'].includes(err && err.code) || i === ESPERAS_MS.length) break;
      dormirSincrono(ESPERAS_MS[i]);
    }
  }
  // reserva: grava direto no destino e apaga o temporário
  try {
    fs.writeFileSync(arquivo, typeof conteudo === 'string' ? conteudo : String(conteudo), { mode: modo });
    try { fs.unlinkSync(tmp); } catch { /* fica para a próxima limpeza */ }
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* idem */ }
    throw ultimo || new Error('não consegui gravar ' + path.basename(arquivo));
  }
}

// { ok: true, dados } · { ok: false, faltando: true } · { ok: false, ilegivel: true, copia, erro }
function lerJsonSeguro(arquivo) {
  let texto;
  try {
    texto = fs.readFileSync(arquivo, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { ok: false, faltando: true };
    return { ok: false, ilegivel: true, copia: guardarCopia(arquivo), erro: (err && err.code) || String(err) };
  }
  try {
    return { ok: true, dados: JSON.parse(texto) };
  } catch (err) {
    return { ok: false, ilegivel: true, copia: guardarCopia(arquivo), erro: 'JSON inválido' };
  }
}

function guardarCopia(arquivo) {
  const ext = path.extname(arquivo);
  const base = arquivo.slice(0, arquivo.length - ext.length);
  const copia = `${base}.ilegivel-${new Date().toISOString().replace(/[:.]/g, '-')}${ext || '.json'}`;
  try { fs.copyFileSync(arquivo, copia); return copia; } catch { return null; }
}

// Restos de gravações interrompidas (o .tmp-<pid>-… ficou porque o programa caiu)
function limparTemporarios(arquivo) {
  const dir = path.dirname(arquivo);
  const nome = path.basename(arquivo) + '.tmp-';
  let n = 0;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.startsWith(nome)) continue;
      try { fs.unlinkSync(path.join(dir, f)); n++; } catch { /* segue */ }
    }
  } catch { /* pasta ainda não existe */ }
  return n;
}

module.exports = { gravarAtomico, lerJsonSeguro, limparTemporarios };
