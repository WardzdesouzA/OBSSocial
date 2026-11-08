// 🙋 Pedidos — o catálogo de cada jogo: nomes, apelidos, tipos e imagens.
//
// Um arquivo por jogo (data/pedidos/catalogos/<jogoId>.json) e as imagens em
// data/pedidos/imagens/<jogoId>/: tudo só no PC de quem usa, nunca no
// repositório nem no instalador. O leitor e o núcleo leem daqui; o servidor
// só chama as funções.
//
// O que manda no desenho:
// • o que o streamer escreveu vence as fontes automáticas: item editado à mão
//   fica «travado» (o site oficial só acrescenta idioma que faltar) e os
//   apelidos que ele ensinou («seus») nunca saem numa atualização;
// • arquivo que não abre (cortado, mexido à mão) ganha uma cópia
//   «.ilegivel-…» e NADA grava por cima até ele abrir de novo ou o streamer
//   recriar o jogo de propósito; arquivo mexido por fora com o programa aberto
//   é lido de novo antes de qualquer gravação, e item ou campo que não serve
//   (idioma desconhecido, imagem .jpeg…) também faz a cópia antes de sumir;
// • cada mudança monta um catálogo NOVO na memória (os itens que não mudaram
//   são os mesmos objetos, e objeto entregue nunca é mexido depois): quem
//   guardou o anterior continua com uma foto coerente, e quem quer saber se
//   mudou compara o objeto (ou o jogo.atualizadoEm, que sempre sobe);
// • chave vinda de fora nunca vira propriedade de objeto: só listas fechadas
//   (idiomas, campos conhecidos), Map e Set — __proto__ e companhia não entram;
// • imagem só png/jpeg/webp/gif conferida pela assinatura dos bytes (svg
//   nunca: pode carregar script), com nome gerado aqui; o servidor só serve o
//   arquivo que um item do catálogo aponta.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { gravarAtomico, lerJsonSeguro, limparTemporarios } = require('./pedidos-arquivos');

const VERSAO = 1;
const IDIOMAS = Object.freeze(['pt', 'en', 'es', 'fr', 'de', 'ru', 'tr', 'ja', 'ko', 'zh']);
const RARIDADES = Object.freeze(['comum', 'incomum', 'raro', 'muitoRaro', 'visceral', 'evento']);
const ORIGENS_IMAGEM = Object.freeze(['site-oficial', 'importada', 'sua', 'wiki', 'ia']);
// fonte automática não troca a imagem de item travado (só põe onde não há)
const ORIGENS_AUTOMATICAS = new Set(['site-oficial', 'wiki', 'ia']);
const MODELOS = Object.freeze(['dbd', 'generico']);
const PAPEIS = Object.freeze(['personagem', 'poder', 'perk', 'addon', 'item', 'oferenda', 'mapa', 'outro']);
const TETOS = Object.freeze({
  jogos: 200, itens: 20000, tipos: 50, apelidos: 50,
  imagemBytes: 5 * 1024 * 1024, importadoBytes: 8 * 1024 * 1024,
  arquivosPorEnvio: 2000, errosListados: 500, fonteBytes: 256 * 1024,
});
// Leitura: confere se o arquivo do catálogo mudou por fora no máximo uma vez por
// segundo (o núcleo pergunta a cada mensagem); antes de gravar, sempre.
const CONFERIR_MS = 1000;

// ── 🏷️ Tipos dos modelos ───────────────────────────────────────────────────
// «papel» diz o que o tipo é para o núcleo (personagem = quem aparece em
// «próximos» na tela); o id é o que vai no id do item (killer:the-trapper).
const nomes10 = (pt, en, es, fr, de, ru, tr, ja, ko, zh) => Object.freeze({ pt, en, es, fr, de, ru, tr, ja, ko, zh });
const defTipo = (id, icone, papel, nomes) => Object.freeze({ id, nomes, icone, papel });
const NOMES_ITEM = nomes10('Item', 'Item', 'Objeto', 'Objet', 'Gegenstand', 'Предмет', 'Eşya', 'アイテム', '아이템', '道具');
const TIPOS_DBD = Object.freeze([
  defTipo('killer', '🔪', 'personagem', nomes10('Killer', 'Killer', 'Asesino', 'Tueur', 'Killer', 'Убийца', 'Katil', 'キラー', '살인마', '杀手')),
  defTipo('sobrevivente', '🏃', 'personagem', nomes10('Sobrevivente', 'Survivor', 'Superviviente', 'Survivant', 'Überlebender', 'Выживший', 'Hayatta Kalan', 'サバイバー', '생존자', '逃生者')),
  defTipo('poder', '⚡', 'poder', nomes10('Poder', 'Power', 'Poder', 'Pouvoir', 'Kraft', 'Способность', 'Güç', 'パワー', '능력', '能力')),
  defTipo('perk', '🎴', 'perk', nomes10('Perk', 'Perk', 'Habilidad', 'Compétence', 'Fähigkeit', 'Навык', 'Yetenek', 'パーク', '퍽', '技能')),
  defTipo('addon', '🧩', 'addon', nomes10('Add-on', 'Add-on', 'Accesorio', 'Accessoire', 'Add-on', 'Улучшение', 'Eklenti', 'アドオン', '애드온', '配件')),
  defTipo('item', '🔦', 'item', NOMES_ITEM),
  defTipo('oferenda', '🕯️', 'oferenda', nomes10('Oferenda', 'Offering', 'Ofrenda', 'Offrande', 'Opfergabe', 'Подношение', 'Adak', 'オファリング', '공물', '祭品')),
  defTipo('mapa', '🗺️', 'mapa', nomes10('Mapa', 'Map', 'Mapa', 'Carte', 'Karte', 'Карта', 'Harita', 'マップ', '맵', '地图')),
]);
const TIPOS_GENERICO = Object.freeze([
  defTipo('personagem', '🙂', 'personagem', nomes10('Personagem', 'Character', 'Personaje', 'Personnage', 'Charakter', 'Персонаж', 'Karakter', 'キャラクター', '캐릭터', '角色')),
  defTipo('item', '🎒', 'item', NOMES_ITEM),
]);
const montarTipo = (id, nomes, icone, papel) => ({ id, nomes: { ...nomes }, icone, papel });
const tiposDoModelo = (modelo) => (modelo === 'dbd' ? TIPOS_DBD : TIPOS_GENERICO).map((t) => montarTipo(t.id, t.nomes, t.icone, t.papel));

// ── 🔤 Texto ───────────────────────────────────────────────────────────────
const RE_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RE_ITEM = /^([a-z0-9]+(?:-[a-z0-9]+)*):([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const RE_ARQUIVO = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:png|jpg|webp|gif)$/;
// C0/C1, separadores de linha e os marcadores de direção (viram truque na tela)
const RE_CONTROLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;
// o Windows não deixa criar con.json, nul.json… nem a pasta com esse nome
const RESERVADOS_WINDOWS = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const CHAVES_PERIGOSAS = new Set(['__proto__', 'constructor', 'prototype']);

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const temCampo = (o, k) => Object.hasOwn(o, k) && o[k] !== undefined;
const amostra = (v) => (typeof v === 'string' ? v.slice(0, 40) : typeof v);
// «con», «nul», «com1»… nunca viram caminho: no Windows abrir «con.json» é abrir o
// console (a leitura síncrona pode ficar esperando o teclado e travar o servidor)
const jogoIdValido = (id) => typeof id === 'string' && id.length <= 60 && RE_SLUG.test(id) &&
  !RESERVADOS_WINDOWS.test(id) && !CHAVES_PERIGOSAS.has(id);
const fonteValida = (v) => typeof v === 'string' && v.length <= 30 && RE_SLUG.test(v);
function idItemValido(v) {
  if (typeof v !== 'string' || v.length > 91) return false;
  const m = RE_ITEM.exec(v);
  return !!m && m[1].length <= 30 && m[2].length <= 60;
}

// Tira só os acentos latinos (a faixa das marcas combinantes): o ゛ do japonês
// fica fora dela, e o NFC no fim junta de novo o que o NFD separou (kana, hangul).
function semAcento(texto) {
  return String(texto).normalize('NFD').replace(/[\u0300-\u036f]/g, '').normalize('NFC');
}
const TROCAS_SLUG = { 'ß': 'ss', 'æ': 'ae', 'œ': 'oe', 'ø': 'o', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th', 'ı': 'i' };
// «Pokémon Édition» → «pokemon-edition»; nome só em japonês dá vazio (quem chama decide)
function slug(texto, max = 60) {
  let s = semAcento(texto).toLowerCase().replace(/[ßæœøłđðþı]/g, (c) => TROCAS_SLUG[c]);
  s = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (s.length > max) s = s.slice(0, max).replace(/-+$/, '');
  return s;
}
// Para comparar (apelido repetido, busca): minúsculas, sem acento, pontuação vira espaço
function normalizar(texto) {
  return semAcento(texto).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, ' ').trim();
}
// Para casar nome de arquivo: tudo grudado, sem separador nenhum (pega o camelCase dos ícones)
function chaveDeArquivo(texto) {
  return semAcento(texto).toLowerCase().replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}
const hash8 = (texto) => crypto.createHash('sha1').update(String(texto).normalize('NFC'), 'utf8').digest('hex').slice(0, 8);

// Nome para mostrar: o do idioma pedido, senão inglês, português, o primeiro que houver
function nomeParaMostrar(item, idioma) {
  const n = item && ehObjeto(item.nomes) ? item.nomes : {};
  if (typeof idioma === 'string' && IDIOMAS.includes(idioma) && n[idioma]) return n[idioma];
  if (n.en) return n.en;
  if (n.pt) return n.pt;
  for (const k of IDIOMAS) if (n[k]) return n[k];
  return (item && typeof item.id === 'string' && item.id) || '';
}
function primeiroNome(nomes) {
  if (nomes.en) return nomes.en;
  for (const k of IDIOMAS) if (nomes[k]) return nomes[k];
  return '';
}

// «nome», «nome-2», «nome-3»… sem passar do tamanho
function livre(base, ocupado, max) {
  if (!ocupado(base)) return base;
  for (let i = 2; i < 1e6; i++) {
    const suf = `-${i}`;
    const c = base.slice(0, max - suf.length).replace(/-+$/, '') + suf;
    if (!ocupado(c)) return c;
  }
  return null;
}

// ── ✅ Validação do que entra (painel, planilha, fonte automática) ──────────
class ErroEntrada extends Error {
  constructor(motivo, erro = 'item-invalido') { super(motivo); this.erro = erro; }
}
const falha = (erro, motivo, extra) => Object.assign({ ok: false, erro, motivo }, extra);

// Caracteres como a pessoa conta: emoji e ideograma fora do BMP valem 1 (no .length,
// que conta unidades UTF-16, valem 2 — um nome de 68 caracteres «passava de 120»).
function caracteres(s) {
  let n = s.length;
  for (let i = 0; i < s.length - 1; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; }
    }
  }
  return n;
}
const passaDe = (s, max) => s.length > max && caracteres(s) > max;

function textoCurto(valor, max, rotulo, erro = 'item-invalido') {
  if (typeof valor !== 'string') throw new ErroEntrada(`${rotulo}: precisa ser texto`, erro);
  const t = valor.trim();
  if (RE_CONTROLE.test(t)) throw new ErroEntrada(`${rotulo}: tem caractere de controle (quebra de linha, tab…)`, erro);
  const limpo = t.replace(/ {2,}/g, ' ');
  if (passaDe(limpo, max)) throw new ErroEntrada(`${rotulo}: passa de ${max} caracteres`, erro);
  return limpo;
}

// Leitura leniente (arquivo do disco): o que cai fora conta em `perdas.n`, para o
// arquivo ganhar uma cópia antes que a próxima gravação o perca de vez.
const contarPerda = (perdas) => { if (perdas) perdas.n++; };
const vazio = (v) => v === null || v === undefined || v === '';

// { en: 'The Trapper', pt: 'O Caçador' } → só códigos conhecidos, na ordem de IDIOMAS
function lerNomes(valor, { max = 120, rotulo = 'nome', erro = 'item-invalido', leniente = false, perdas = null } = {}) {
  if (!ehObjeto(valor)) {
    if (leniente) { if (!vazio(valor)) contarPerda(perdas); return {}; }
    throw new ErroEntrada(`${rotulo}: precisa ser um objeto { en: …, pt: … }`, erro);
  }
  for (const k of Object.keys(valor)) {
    if (IDIOMAS.includes(k)) continue;
    if (!leniente) throw new ErroEntrada(`${rotulo}: idioma desconhecido «${k.slice(0, 20)}» (vale ${IDIOMAS.join(', ')})`, erro);
    if (!vazio(valor[k])) contarPerda(perdas); // «pt-BR» escrito à mão
  }
  const saida = {};
  for (const k of IDIOMAS) {
    if (!Object.hasOwn(valor, k)) continue;
    const v = valor[k];
    if (vazio(v)) continue;
    try {
      const t = textoCurto(v, max, `${rotulo} (${k})`, erro);
      if (t) saida[k] = t;
    } catch (e) {
      if (!leniente) throw e;
      contarPerda(perdas);
    }
  }
  return saida;
}

// Listas de nomes antigos e apelidos: sem repetir (comparando normalizado), até 50
function lerLista(valor, { rotulo, max, semBarra = false, leniente = false, perdas = null }) {
  if (valor === null || valor === undefined) return [];
  if (!Array.isArray(valor)) {
    if (leniente) { contarPerda(perdas); return []; }
    throw new ErroEntrada(`${rotulo}: precisa ser uma lista`);
  }
  const saida = [];
  const vistos = new Set();
  for (const v of valor) {
    if (vazio(v)) continue;
    let t;
    try {
      t = textoCurto(v, max, rotulo);
      // o «|» separa os apelidos na coluna da planilha
      if (semBarra && t.includes('|')) throw new ErroEntrada(`${rotulo}: «|» separa os apelidos na planilha e não pode fazer parte de um`);
    } catch (e) {
      if (leniente) { contarPerda(perdas); continue; }
      throw e;
    }
    const n = normalizar(t);
    if (!n) { if (leniente) contarPerda(perdas); continue; }
    if (vistos.has(n)) continue; // repetido (igual depois de normalizar): nada se perde
    if (saida.length >= TETOS.apelidos) {
      if (leniente) { contarPerda(perdas); break; }
      throw new ErroEntrada(`${rotulo}: no máximo ${TETOS.apelidos} por item`);
    }
    vistos.add(n);
    saida.push(t);
  }
  return saida;
}

function lerIdItem(v, rotulo = 'id') {
  if (!idItemValido(v)) throw new ErroEntrada(`${rotulo} inválido «${amostra(v)}» (formato tipo:nome, só a-z, 0-9 e -)`);
  return v;
}

// aceita o nome da lista e os jeitos comuns de escrever (planilha feita à mão)
const SINONIMOS_RARIDADE = new Map([
  ['comum', 'comum'], ['common', 'comum'],
  ['incomum', 'incomum'], ['uncommon', 'incomum'],
  ['raro', 'raro'], ['rare', 'raro'],
  ['muitoraro', 'muitoRaro'], ['veryrare', 'muitoRaro'],
  ['visceral', 'visceral'], ['ultrarare', 'visceral'], ['iridescente', 'visceral'], ['iridescent', 'visceral'],
  ['evento', 'evento'], ['event', 'evento'],
]);
function lerRaridade(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new ErroEntrada('raridade: precisa ser texto');
  if (RARIDADES.includes(v)) return v;
  const r = SINONIMOS_RARIDADE.get(chaveDeArquivo(v));
  if (!r) throw new ErroEntrada(`raridade desconhecida «${v.slice(0, 30)}» (vale ${RARIDADES.join(', ')} ou vazio)`);
  return r;
}
function lerChave(v) {
  if (v === null || v === '') return null;
  return textoCurto(v, 200, 'chave') || null;
}
function lerDesc(v) {
  if (v === null || v === '') return '';
  if (typeof v !== 'string') throw new ErroEntrada('descrição: precisa ser texto');
  const t = v.replace(/\r\n?/g, '\n').trim();
  if (/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(t)) throw new ErroEntrada('descrição: tem caractere de controle');
  if (passaDe(t, 500)) throw new ErroEntrada('descrição: passa de 500 caracteres');
  return t;
}

// Lado de uma perk geral (sem dono) no DBD: só por ele o validarBuild do leitor sabe
// que «Spine Chill» é de sobrevivente. Aceita o id e o nome do tipo em qualquer idioma.
const LADOS = Object.freeze(['killer', 'sobrevivente']);
const SINONIMOS_LADO = new Map();
for (const t of TIPOS_DBD) {
  if (!LADOS.includes(t.id)) continue;
  for (const nome of [t.id, ...Object.values(t.nomes)]) SINONIMOS_LADO.set(chaveDeArquivo(nome), t.id);
}
function lerLado(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') throw new ErroEntrada('lado: precisa ser texto');
  const l = SINONIMOS_LADO.get(chaveDeArquivo(v));
  if (!l) throw new ErroEntrada(`lado desconhecido «${v.slice(0, 30)}» (vale ${LADOS.join(', ')} ou vazio)`);
  return l;
}
function lerSimNao(v, rotulo) {
  if (typeof v !== 'boolean') throw new ErroEntrada(`${rotulo}: precisa ser true ou false`);
  return v;
}

// Lê um item que veio de fora e devolve só os campos que vieram, já limpos.
// Campo errado → ErroEntrada com o motivo (nada é gravado).
function lerItemEntrada(bruto, tiposIds) {
  if (!ehObjeto(bruto)) throw new ErroEntrada('cada item precisa ser um objeto');
  const d = {};
  if (temCampo(bruto, 'tipo')) {
    if (typeof bruto.tipo !== 'string' || !tiposIds.has(bruto.tipo)) throw new ErroEntrada(`tipo desconhecido «${amostra(bruto.tipo)}» neste jogo`, 'tipo-inexistente');
    d.tipo = bruto.tipo;
  }
  if (temCampo(bruto, 'id') && bruto.id !== null && bruto.id !== '') d.id = lerIdItem(bruto.id);
  if (temCampo(bruto, 'nomes')) d.nomes = lerNomes(bruto.nomes);
  if (temCampo(bruto, 'antigos')) d.antigos = lerLista(bruto.antigos, { rotulo: 'nomes antigos', max: 120 });
  if (temCampo(bruto, 'apelidos')) d.apelidos = lerLista(bruto.apelidos, { rotulo: 'apelidos', max: 60, semBarra: true });
  if (temCampo(bruto, 'seus')) d.seus = lerLista(bruto.seus, { rotulo: 'seus apelidos', max: 60, semBarra: true });
  if (temCampo(bruto, 'dono')) d.dono = bruto.dono === null || bruto.dono === '' ? null : lerIdItem(bruto.dono, 'dono');
  if (temCampo(bruto, 'lado')) d.lado = lerLado(bruto.lado);
  if (temCampo(bruto, 'raridade')) d.raridade = lerRaridade(bruto.raridade);
  if (temCampo(bruto, 'chave')) d.chave = lerChave(bruto.chave);
  if (temCampo(bruto, 'naoTenho')) d.naoTenho = lerSimNao(bruto.naoTenho, '«não tenho»');
  if (temCampo(bruto, 'travado')) d.travado = lerSimNao(bruto.travado, 'travado');
  if (temCampo(bruto, 'desc')) d.desc = lerDesc(bruto.desc);
  if (temCampo(bruto, 'fonte') && fonteValida(bruto.fonte)) d.fonte = bruto.fonte;
  return d;
}

function lerIcone(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || v.length > 16 || RE_CONTROLE.test(v)) throw new ErroEntrada('ícone: um emoji curto', 'tipo-invalido');
  return v.trim() || null;
}
function lerTipoEntrada(bruto) {
  if (!ehObjeto(bruto)) throw new ErroEntrada('o tipo precisa ser um objeto', 'tipo-invalido');
  let id = null;
  if (temCampo(bruto, 'id') && bruto.id !== null && bruto.id !== '') {
    // «constructor»/«prototype» passam no formato, mas quebram quem indexa por id num objeto
    if (typeof bruto.id !== 'string' || bruto.id.length > 30 || !RE_SLUG.test(bruto.id) || CHAVES_PERIGOSAS.has(bruto.id)) {
      throw new ErroEntrada(`id de tipo inválido «${amostra(bruto.id)}» (a-z, 0-9 e -, até 30)`, 'tipo-invalido');
    }
    id = bruto.id;
  }
  const nomes = temCampo(bruto, 'nomes') ? lerNomes(bruto.nomes, { max: 60, rotulo: 'nome do tipo', erro: 'tipo-invalido' }) : {};
  const icone = temCampo(bruto, 'icone') ? lerIcone(bruto.icone) : null;
  let papel = null;
  if (temCampo(bruto, 'papel') && bruto.papel !== null && bruto.papel !== '') {
    if (!PAPEIS.includes(bruto.papel)) throw new ErroEntrada(`papel desconhecido (vale ${PAPEIS.join(', ')})`, 'tipo-invalido');
    papel = bruto.papel;
  }
  return { id, nomes, icone, papel };
}

function lerNomeDeJogo(v) {
  const t = textoCurto(v, 120, 'nome do jogo', 'nome-invalido');
  if (!t) throw new ErroEntrada('o jogo precisa de um nome', 'nome-invalido');
  return t;
}

// Dados livres de uma fonte (ETag, data da leitura…): só JSON simples, sem chave perigosa
// (`perdas` conta a chave que fica de fora, na leitura do arquivo)
function dadoSimples(v, nivel, perdas = null) {
  if (v === null || typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    if (v.length > 2000) throw new ErroEntrada('texto longo demais nos dados da fonte');
    return v;
  }
  if (nivel >= 6) throw new ErroEntrada('dados fundos demais');
  if (Array.isArray(v)) {
    if (v.length > 2000) throw new ErroEntrada('lista longa demais nos dados da fonte');
    return v.map((x) => { const y = dadoSimples(x, nivel + 1, perdas); return y === undefined ? null : y; });
  }
  if (ehObjeto(v)) {
    const chaves = Object.keys(v);
    if (chaves.length > 2000) throw new ErroEntrada('objeto grande demais nos dados da fonte');
    const saida = {};
    for (const k of chaves) {
      if (CHAVES_PERIGOSAS.has(k) || k.length > 300) { contarPerda(perdas); continue; }
      const x = dadoSimples(v[k], nivel + 1, perdas);
      if (x !== undefined) saida[k] = x;
    }
    return saida;
  }
  return undefined; // função, símbolo: fica de fora
}
// 'site-oficial' → 'siteOficial' (a chave em jogo.fontes)
function chaveDaFonte(f) {
  if (!fonteValida(f)) return null;
  const c = f.replace(/-([a-z0-9])/g, (_, l) => l.toUpperCase());
  return CHAVES_PERIGOSAS.has(c) ? null : c;
}

// ── 🧱 Itens ──────────────────────────────────────────────────────────────
// Sempre a mesma ordem de campos: a comparação «mudou?» é pelo texto JSON. O «lado»
// só aparece quando há (perk geral de um lado só): o resto do arquivo não muda por ele.
function montarItem(c) {
  const it = {
    id: c.id, tipo: c.tipo, nomes: c.nomes, antigos: c.antigos, apelidos: c.apelidos, seus: c.seus,
    dono: c.dono, raridade: c.raridade, imagem: c.imagem, chave: c.chave, fonte: c.fonte,
    travado: c.travado, naoTenho: c.naoTenho, desc: c.desc,
  };
  if (c.lado) it.lado = c.lado;
  return it;
}
// O JSON de cada item, guardado: item nunca é mexido depois de pronto, então o texto vale
// para sempre — gravar 20 000 itens refaz só o texto dos que mudaram.
const serieDe = new WeakMap();
function serie(obj) {
  let s = serieDe.get(obj);
  if (s === undefined) { s = JSON.stringify(obj); serieDe.set(obj, s); }
  return s;
}
const idBase = (tipo, nomes) => {
  const n = primeiroNome(nomes);
  return `${tipo}:${slug(n) || hash8(n)}`;
};

// Junta sem repetir (comparando normalizado). Passou do teto: com rótulo é erro, sem
// rótulo para quieto (fonte automática não derruba o item por apelido a mais).
function unirListas(base, extra, { excluir = null, rotulo = null, max = TETOS.apelidos } = {}) {
  if (!extra || !extra.length) return base;
  const vistos = new Set(base.map(normalizar));
  if (excluir) for (const e of excluir) vistos.add(e);
  let saida = base;
  for (const t of extra) {
    const n = normalizar(t);
    if (!n || vistos.has(n)) continue;
    if (saida.length >= max) {
      if (rotulo) throw new ErroEntrada(`${rotulo}: passaria de ${max} neste item`);
      break;
    }
    if (saida === base) saida = base.slice();
    vistos.add(n);
    saida.push(t);
  }
  return saida;
}

// soFaltando (item travado): a fonte automática só preenche idioma vazio
function juntarNomes(velhos, novos, soFaltando) {
  const nomes = {};
  const trocados = [];
  for (const k of IDIOMAS) {
    const v = Object.hasOwn(velhos, k) ? velhos[k] : undefined;
    const n = Object.hasOwn(novos, k) ? novos[k] : undefined;
    if (n && (!v || !soFaltando)) {
      nomes[k] = n;
      if (v && v !== n) trocados.push(v);
    } else if (v) nomes[k] = v;
  }
  return { nomes, trocados };
}

// Edição à mão (painel): o campo que veio substitui o anterior; manual = travado
function juntarManual(velho, d, manual) {
  const pega = (campo) => (d[campo] !== undefined ? d[campo] : velho[campo]);
  return montarItem({
    ...velho,
    nomes: pega('nomes'), antigos: pega('antigos'), apelidos: pega('apelidos'), seus: pega('seus'),
    dono: pega('dono'), lado: pega('lado'), raridade: pega('raridade'), chave: pega('chave'), naoTenho: pega('naoTenho'), desc: pega('desc'),
    travado: manual ? true : velho.travado,
  });
}

// Fonte automática (site oficial, IA, wiki): nome trocado vira «antigo» (quem tem o
// personagem continua vendo o nome velho); «seus» nunca mexe; travado só ganha o que falta.
function juntarAutomatico(velho, d) {
  const trav = velho.travado;
  const { nomes, trocados } = juntarNomes(velho.nomes, d.nomes || {}, trav);
  let antigos = velho.antigos;
  let apelidos = velho.apelidos;
  if (!trav) {
    const atuais = Object.values(nomes).map(normalizar);
    antigos = unirListas(antigos, (d.antigos || []).concat(trocados), { excluir: atuais });
    apelidos = unirListas(apelidos, d.apelidos || []);
  }
  const preenche = (campo) => (d[campo] != null && (!trav || velho[campo] == null) ? d[campo] : velho[campo]);
  return montarItem({
    ...velho, nomes, antigos, apelidos,
    dono: preenche('dono'), lado: preenche('lado'), raridade: preenche('raridade'), chave: preenche('chave'),
    desc: velho.desc || d.desc || '',
  });
}

// Planilha/JSON do streamer: o que veio preenchido vence, listas somam e nada é
// apagado (célula vazia = «não mexe»). O que mudou fica travado: é texto dele.
function juntarImportado(velho, d, modo) {
  const { nomes } = juntarNomes(velho.nomes, d.nomes || {}, false);
  const antigos = d.antigos ? unirListas(velho.antigos, d.antigos, { rotulo: 'nomes antigos' }) : velho.antigos;
  let apelidos = velho.apelidos;
  let seus = velho.seus;
  if (modo === 'csv') {
    // a planilha tem uma coluna só: o que não é apelido automático conhecido vira «seus»
    if (d.apelidos) {
      const conhecidos = new Set(velho.apelidos.concat(velho.seus).map(normalizar));
      seus = unirListas(velho.seus, d.apelidos.filter((a) => !conhecidos.has(normalizar(a))), { rotulo: 'apelidos' });
    }
  } else {
    if (d.apelidos) apelidos = unirListas(velho.apelidos, d.apelidos, { rotulo: 'apelidos' });
    if (d.seus) seus = unirListas(velho.seus, d.seus, { rotulo: 'seus apelidos' });
  }
  const vale = (campo) => (d[campo] != null && d[campo] !== '' ? d[campo] : velho[campo]);
  const base = montarItem({
    ...velho, nomes, antigos, apelidos, seus,
    dono: vale('dono'), lado: vale('lado'), raridade: vale('raridade'), chave: vale('chave'),
    naoTenho: typeof d.naoTenho === 'boolean' ? d.naoTenho : velho.naoTenho,
    desc: d.desc || velho.desc,
  });
  const travado = typeof d.travado === 'boolean' ? d.travado : (serie(base) !== serie(velho) ? true : velho.travado);
  return travado === base.travado ? base : montarItem({ ...base, travado });
}

function itemNovoDoLote(id, tipo, d, modo, fonte) {
  const csv = modo === 'csv';
  const automatico = modo === 'mesclar';
  return montarItem({
    id, tipo, nomes: d.nomes,
    antigos: d.antigos || [],
    apelidos: csv ? [] : (d.apelidos || []),
    seus: csv ? (d.apelidos || []) : (modo === 'json' ? (d.seus || []) : []),
    dono: d.dono || null, lado: d.lado || null, raridade: d.raridade || null, imagem: null, chave: d.chave || null,
    fonte: automatico ? fonte : ((modo === 'json' && d.fonte) || 'importada'),
    travado: automatico ? false : (typeof d.travado === 'boolean' ? d.travado : true),
    naoTenho: automatico ? false : !!d.naoTenho,
    desc: d.desc || '',
  });
}

// Qual item uma entrada de lote quer: pelo id, pela chave da fonte (o nome do arquivo
// do retrato não muda quando o nome muda) ou pelo id que o nome daria.
function acharAlvo(d, itens, porChave, tiposIds) {
  let id;
  let velho = null;
  // O id é «<tipo>:<nome>» e o arquivo descarta item cujo tipo não é o começo do id:
  // aceitar aqui faria o item «entrar» e sumir ao reabrir o programa.
  if (d.id && d.tipo && d.id.slice(0, d.id.indexOf(':')) !== d.tipo) {
    const outro = itens.get(d.id);
    throw new ErroEntrada(outro ? `${d.id} é do tipo «${outro.tipo}», não «${d.tipo}»` : `o id ${d.id} não começa pelo tipo «${d.tipo}»`, 'tipo-diferente');
  }
  if (d.id) {
    id = d.id;
    velho = itens.get(id) || null;
    if (!velho && d.chave) {
      const c = porChave.get(`${d.tipo || id.slice(0, id.indexOf(':'))}\u0000${d.chave}`);
      if (c) { id = c; velho = itens.get(c); }
    }
  } else {
    if (!d.tipo) throw new ErroEntrada('falta o tipo (ou o id de um item que já existe)');
    if (d.chave) {
      const c = porChave.get(`${d.tipo}\u0000${d.chave}`);
      if (c) { id = c; velho = itens.get(c); }
    }
    if (!velho) {
      if (!d.nomes || !Object.keys(d.nomes).length) throw new ErroEntrada('sem id e sem nome: não dá para saber que item é');
      id = idBase(d.tipo, d.nomes);
      velho = itens.get(id) || null;
    }
  }
  // item novo: o tipo é o começo do id (o mesmo que o arquivo confere ao abrir)
  const tipo = velho ? velho.tipo : id.slice(0, id.indexOf(':'));
  if (d.tipo && d.tipo !== tipo) {
    throw new ErroEntrada(velho ? `${id} é do tipo «${velho.tipo}», não «${d.tipo}»` : `o id ${id} não começa pelo tipo «${d.tipo}»`, 'tipo-diferente');
  }
  if (!velho && !tiposIds.has(tipo)) throw new ErroEntrada(`tipo desconhecido «${tipo}» neste jogo`, 'tipo-inexistente');
  return { id, velho, tipo };
}

// Uma passada do lote sobre uma cópia (Map) dos itens; o que falha não deixa rastro.
// soDonoAnterior (última volta): o dono tem de existir quando a linha é lida — no
// catálogo ou numa linha anterior —, então nenhum dono some no fim.
function simularLote(originais, entradas, { modo, fonte, tiposIds, soDonoAnterior }) {
  const itens = new Map(originais);
  const porChave = new Map();
  for (const it of originais.values()) if (it.chave) porChave.set(`${it.tipo}\u0000${it.chave}`, it.id);
  const criados = new Set();
  const tocados = new Set();
  const aplicadas = [];
  const alvos = new Map(); // entrada aplicada → id do item que ela criou ou mexeu
  const falhas = [];
  for (const e of entradas) {
    const d = e.d;
    try {
      const { id, velho, tipo } = acharAlvo(d, itens, porChave, tiposIds);
      if (d.dono && d.dono === id) throw new ErroEntrada('um item não pode ser dono de si mesmo');
      if (d.dono && soDonoAnterior && !itens.has(d.dono)) throw new ErroEntrada(`dono «${d.dono}» precisa vir antes no lote (ou já estar no catálogo)`);
      let novo;
      if (velho) novo = modo === 'mesclar' ? juntarAutomatico(velho, d) : juntarImportado(velho, d, modo);
      else {
        if (!d.nomes || !Object.keys(d.nomes).length) throw new ErroEntrada('item novo precisa de pelo menos um nome');
        if (itens.size >= TETOS.itens) throw new ErroEntrada(`o catálogo chegou ao teto de ${TETOS.itens} itens`, 'teto-itens');
        novo = itemNovoDoLote(id, tipo, d, modo, fonte);
      }
      itens.set(id, novo);
      if (novo.chave) porChave.set(`${novo.tipo}\u0000${novo.chave}`, id);
      if (!velho) criados.add(id);
      else if (!criados.has(id)) tocados.add(id);
      aplicadas.push(e);
      alvos.set(e, id);
    } catch (err) {
      if (!(err instanceof ErroEntrada)) throw err;
      falhas.push({ linha: e.linha, motivo: err.message });
    }
  }
  return { itens, criados, tocados, aplicadas, alvos, falhas };
}

// Entradas cujo dono não existe no fim do lote: nem no catálogo nem feito por uma
// entrada que fica. Sai a corrente inteira de uma vez (quem dependia de quem saiu
// também sai), em vez de um elo por volta — uma corrente longa não esgota as voltas.
function entradasSemDono(r, originais) {
  const feitos = new Map();   // id → quantas entradas que ficam o criam ou mexem nele
  const esperam = new Map();  // dono (novo neste lote) → entradas que apontam para ele
  for (const e of r.aplicadas) {
    const id = r.alvos.get(e);
    feitos.set(id, (feitos.get(id) || 0) + 1);
    const dono = e.d.dono;
    if (!dono || originais.has(dono)) continue;
    const l = esperam.get(dono);
    if (l) l.push(e); else esperam.set(dono, [e]);
  }
  const ruins = new Set();
  const fila = [];
  for (const [dono, l] of esperam) if (!feitos.has(dono)) for (const e of l) { ruins.add(e); fila.push(e); }
  while (fila.length) {
    const id = r.alvos.get(fila.pop());
    const resta = feitos.get(id) - 1;
    feitos.set(id, resta);
    if (resta > 0 || originais.has(id)) continue; // o item continua existindo
    for (const e of esperam.get(id) || []) if (!ruins.has(e)) { ruins.add(e); fila.push(e); }
  }
  return r.aplicadas.filter((e) => ruins.has(e));
}

function cortarErros(erros) {
  if (erros.length <= TETOS.errosListados) return erros;
  const resto = erros.length - TETOS.errosListados;
  return erros.slice(0, TETOS.errosListados).concat({ linha: 0, motivo: `e mais ${resto} erro(s) que não cabem na lista` });
}

// ── 📄 CSV (RFC 4180) ──────────────────────────────────────────────────────
const COLUNAS_CSV = Object.freeze(['tipo', 'id', 'en', 'pt', 'es', 'fr', 'de', 'ru', 'tr', 'ja', 'ko', 'zh', 'apelidos', 'dono', 'raridade']);
const IDIOMAS_CSV = COLUNAS_CSV.slice(2, 12);
// Fórmula escondida numa célula (=, +, -, @, tab, CR) roda quando a planilha abre:
// na saída ganha um «'» na frente, que a entrada tira de volta.
const RE_FORMULA = /^'*[=+\-@\t\r]/;
const protegerCelula = (s) => (RE_FORMULA.test(s) ? `'${s}` : s);
const desprotegerCelula = (s) => (s.startsWith("'") && RE_FORMULA.test(s.slice(1)) ? s.slice(1) : s);

// separador pelo cabeçalho: o Excel em português grava com «;»
function detectarSeparador(s, inicio) {
  let virgulas = 0;
  let pontoEVirgulas = 0;
  let aspas = false;
  for (let i = inicio; i < s.length; i++) {
    const c = s[i];
    if (c === '"') aspas = !aspas;
    else if (!aspas && (c === '\n' || c === '\r')) break;
    else if (!aspas && c === ',') virgulas++;
    else if (!aspas && c === ';') pontoEVirgulas++;
  }
  return pontoEVirgulas > virgulas ? ';' : ',';
}

// Registros com a linha (física) em que cada um começa, para o erro apontar a linha certa
function lerRegistrosCsv(texto, separador) {
  const s = String(texto);
  let i = s.charCodeAt(0) === 0xfeff ? 1 : 0;
  const sep = separador === ',' || separador === ';' ? separador : detectarSeparador(s, i);
  const registros = [];
  let celulas = [];
  let cel = '';
  let aspas = false;
  let fechou = false;
  let linha = 1;
  let inicio = 1;
  const fimCelula = () => { celulas.push(cel); cel = ''; fechou = false; };
  const fimRegistro = () => { fimCelula(); registros.push({ linha: inicio, celulas }); celulas = []; };
  while (i < s.length) {
    const c = s[i];
    if (aspas) {
      if (c === '"') {
        if (s[i + 1] === '"') { cel += '"'; i += 2; continue; }
        aspas = false; fechou = true; i++; continue;
      }
      if (c === '\r' || c === '\n') { // quebra dentro das aspas faz parte da célula
        if (c === '\r' && s[i + 1] === '\n') { cel += '\r\n'; i += 2; } else { cel += c; i++; }
        linha++;
        continue;
      }
      cel += c; i++;
      continue;
    }
    if (c === '"' && cel === '' && !fechou) { aspas = true; i++; continue; } // aspas só abrem no começo da célula
    if (c === sep) { fimCelula(); i++; continue; }
    if (c === '\r' || c === '\n') {
      fimRegistro();
      i += c === '\r' && s[i + 1] === '\n' ? 2 : 1;
      linha++;
      inicio = linha;
      continue;
    }
    cel += c; i++;
  }
  if (cel !== '' || celulas.length || aspas || fechou) {
    const aberto = aspas;
    fimRegistro();
    if (aberto) registros[registros.length - 1].aspasAbertas = true;
  }
  return { registros, separador: sep };
}
// CSV → lista de linhas (cada uma, lista de células)
function lerCsv(texto, separador) {
  return lerRegistrosCsv(texto, separador).registros.map((r) => r.celulas);
}
// lista de linhas → CSV com BOM (o Excel reconhece o UTF-8) e CRLF
function escreverCsv(linhas, opcoes) {
  const sep = opcoes && opcoes.separador === ';' ? ';' : ',';
  if (!linhas.length) return '\ufeff';
  const precisaAspas = /[",;\r\n]|^\s|\s$/;
  const cel = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return precisaAspas.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `\ufeff${linhas.map((l) => l.map(cel).join(sep)).join('\r\n')}\r\n`;
}

function csvDoCatalogo(cat) {
  const linhas = [COLUNAS_CSV.slice()];
  for (const it of cat.itens) {
    // uma coluna só de apelidos: os automáticos e os seus (a volta separa de novo)
    const apelidos = unirListas(it.apelidos, it.seus, { max: Infinity });
    linhas.push([it.tipo, it.id, ...IDIOMAS_CSV.map((k) => it.nomes[k] || ''), apelidos.join('|'), it.dono || '', it.raridade || ''].map(protegerCelula));
  }
  return escreverCsv(linhas);
}

// tipo da planilha pelo id ou pelo nome em qualquer idioma («Add-on», «Survivor»…)
function resolvedorDeTipo(tipos) {
  const mapa = new Map();
  for (const t of tipos) mapa.set(t.id, t.id);
  for (const t of tipos) {
    for (const nome of [t.id, ...IDIOMAS.map((k) => t.nomes[k]).filter(Boolean)]) {
      const c = chaveDeArquivo(nome);
      if (c && !mapa.has(c)) mapa.set(c, t.id);
    }
  }
  return (texto) => mapa.get(texto) || mapa.get(chaveDeArquivo(texto)) || texto;
}
// célula de planilha: tira a proteção de fórmula; quebra de linha (Alt+Enter) vira espaço
const limparCelula = (c) => desprotegerCelula(c).replace(/\r\n|[\r\n\t]/g, ' ').trim();

function entradasDoCsv(texto, tipos) {
  const { registros } = lerRegistrosCsv(texto);
  if (!registros.length) return { erro: falha('csv-vazio', 'a planilha está vazia') };
  const col = new Map();
  registros[0].celulas.forEach((c, i) => {
    const nome = limparCelula(c).replace(/^\ufeff/, '').toLowerCase();
    if (COLUNAS_CSV.includes(nome) && !col.has(nome)) col.set(nome, i);
  });
  if (!col.has('tipo') && !col.has('id')) {
    return { erro: falha('csv-cabecalho', `a primeira linha precisa ser o cabeçalho: ${COLUNAS_CSV.join(',')}`) };
  }
  const resolver = resolvedorDeTipo(tipos);
  const entradas = [];
  const erros = [];
  for (let r = 1; r < registros.length; r++) {
    const reg = registros[r];
    if (reg.celulas.every((c) => !c.trim())) continue; // linha em branco
    if (reg.aspasAbertas) { erros.push({ linha: reg.linha, motivo: 'aspas abertas que não fecham até o fim do arquivo' }); continue; }
    const pega = (nome) => {
      const i = col.get(nome);
      return i === undefined || i >= reg.celulas.length ? '' : limparCelula(reg.celulas[i]);
    };
    const bruto = {};
    const tipo = pega('tipo');
    if (tipo) bruto.tipo = resolver(tipo);
    const id = pega('id');
    if (id) bruto.id = id;
    const nomes = {};
    for (const k of IDIOMAS) { const v = pega(k); if (v) nomes[k] = v; }
    if (Object.keys(nomes).length) bruto.nomes = nomes;
    const apelidos = pega('apelidos');
    if (apelidos) bruto.apelidos = apelidos.split('|');
    const dono = pega('dono');
    if (dono) bruto.dono = dono;
    const raridade = pega('raridade');
    if (raridade) bruto.raridade = raridade;
    entradas.push({ linha: reg.linha, bruto });
  }
  return { entradas, erros };
}

// JSON: o catálogo exportado ({ jogo, tipos, itens }) ou só a lista de itens
function entradasDoJson(texto) {
  let dados;
  try { dados = JSON.parse(texto.replace(/^\ufeff/, '')); } catch (e) {
    return { erro: falha('json-invalido', `o arquivo não é um JSON válido (${String(e.message).slice(0, 120)})`) };
  }
  let itens;
  let tipos = null;
  if (Array.isArray(dados)) itens = dados;
  else if (ehObjeto(dados) && Object.hasOwn(dados, 'itens') && Array.isArray(dados.itens)) {
    itens = dados.itens;
    if (Object.hasOwn(dados, 'tipos') && Array.isArray(dados.tipos)) tipos = dados.tipos;
  } else return { erro: falha('json-formato', 'esperava uma lista de itens ou um catálogo exportado ({ jogo, tipos, itens })') };
  return { entradas: itens.map((bruto, i) => ({ linha: i + 1, bruto })), tipos };
}

// ── 🖼️ Imagens ─────────────────────────────────────────────────────────────
// A assinatura dos primeiros bytes manda; a extensão do arquivo pode mentir.
function tipoDaImagem(dados) {
  const b = comoBuffer(dados);
  if (!b || b.length < 3) return null;
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png';
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length >= 6) {
    const s = b.toString('latin1', 0, 6);
    if (s === 'GIF87a' || s === 'GIF89a') return 'gif';
  }
  if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}
function comoBuffer(v) {
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
  if (v instanceof ArrayBuffer) return Buffer.from(v);
  return null;
}
const EXTENSOES = new Map([['png', 'png'], ['jpg', 'jpg'], ['jpeg', 'jpg'], ['webp', 'webp'], ['gif', 'gif']]);
// a extensão que veio (do nome do arquivo enviado): null = não veio; false = proibida
function lerExtensao(ext) {
  if (ext === undefined || ext === null || ext === '') return null;
  if (typeof ext !== 'string') return false;
  const e = ext.trim().toLowerCase();
  return EXTENSOES.get(e.slice(e.lastIndexOf('.') + 1)) || false;
}
function conferirImagem(bruto, ext) {
  const buf = comoBuffer(bruto);
  if (!buf || !buf.length) throw new ErroEntrada('mande os bytes da imagem', 'imagem-invalida');
  if (buf.length > TETOS.imagemBytes) throw new ErroEntrada('a imagem passa de 5 MB', 'imagem-grande');
  if (lerExtensao(ext) === false) throw new ErroEntrada('só imagens png, jpg, jpeg, webp ou gif (svg nunca: pode carregar script)', 'tipo-invalido');
  const real = tipoDaImagem(buf);
  if (!real) throw new ErroEntrada('o conteúdo não é png, jpeg, webp nem gif de verdade (a extensão não basta)', 'assinatura-invalida');
  return { buf, ext: real };
}

// O gravarAtomico grava texto (String(buffer) estragaria os bytes): para a imagem, o
// mesmo cuidado em binário — temporário ao lado, para o disco, troca de nome.
function gravarBinario(arquivo, buf) {
  fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const tmp = `${arquivo}.tmp-${process.pid}-${Date.now().toString(36)}`;
  const fd = fs.openSync(tmp, 'w', 0o644);
  try {
    fs.writeFileSync(fd, buf);
    try { fs.fsyncSync(fd); } catch { /* alguns sistemas de arquivos não deixam: segue */ }
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, arquivo);
  } catch {
    // Windows: antivírus/Dropbox segurando o arquivo velho → copia por cima
    try { fs.copyFileSync(tmp, arquivo); } finally { try { fs.unlinkSync(tmp); } catch { /* a próxima limpeza leva */ } }
  }
}
// Restos na pasta de imagens: o temporário da gravação e a reserva «-antes» da troca
const RE_RESTO_IMAGEM = /\.tmp-\d+-[a-z0-9]+(?:-antes)?$/;

// Troca com o mesmo nome (png → png): os bytes de antes ficam numa cópia ao lado até
// o catálogo gravar — se a gravação falha, voltam (o catálogo continua apontando esse
// nome). Cópia e não link: a gravação de reserva do Windows escreve por cima do mesmo
// arquivo e estragaria um link. Sem a cópia não troca: melhor recusar do que deixar
// bytes de outra origem.
function reservarImagem(arquivo) {
  if (!fs.existsSync(arquivo)) return null;
  const reserva = `${arquivo}.tmp-${process.pid}-${Date.now().toString(36)}-antes`;
  fs.copyFileSync(arquivo, reserva);
  return reserva;
}
function devolverImagem(reserva, arquivo) {
  try { fs.renameSync(reserva, arquivo); } catch {
    fs.copyFileSync(reserva, arquivo); // Windows: o arquivo novo preso → copia por cima
    try { fs.unlinkSync(reserva); } catch { /* a próxima limpeza leva */ }
  }
}

// Prefixos dos ícones do jogo (iconAddon_trapperSack, T_UI_iconPerks_…) e o tipo que
// cada um sugere quando o mesmo nome serve a mais de um item.
const PREFIXOS_ARQUIVO = [
  ['t_ui_', null], ['iconaddon_', 'addon'], ['iconaddons_', 'addon'], ['iconperks_', 'perk'], ['iconperk_', 'perk'],
  ['iconitems_', 'item'], ['iconitem_', 'item'], ['iconfavors_', 'oferenda'], ['iconfavor_', 'oferenda'],
  ['iconpowers_', 'poder'], ['iconpower_', 'poder'], ['iconhelp_', null], ['iconstatuseffects_', null],
];
function lerNomeDeArquivo(nome) {
  const base = nome.split(/[\\/]/).pop().replace(/\.[a-z0-9]{1,5}$/i, '');
  let s = semAcento(base).toLowerCase().replace(/[\s\-_.]+/g, '_'); // _ - espaço: tudo igual
  let tipo = null;
  for (let mudou = true; mudou;) {
    mudou = false;
    for (const [pre, t] of PREFIXOS_ARQUIVO) {
      if (s.startsWith(pre) && s.length > pre.length) {
        s = s.slice(pre.length);
        if (t && !tipo) tipo = t;
        mudou = true;
      }
    }
  }
  return { chave: chaveDeArquivo(s), tipo };
}
// chave grudada → ids, por todos os nomes, nomes antigos, apelidos, seus e a chave da fonte
function indiceDeNomesDeArquivo(itens) {
  const mapa = new Map();
  const poe = (texto, id) => {
    const c = chaveDeArquivo(texto);
    if (!c) return;
    const lista = mapa.get(c);
    if (!lista) mapa.set(c, [id]);
    else if (!lista.includes(id)) lista.push(id);
  };
  for (const it of itens) {
    for (const k of IDIOMAS) if (it.nomes[k]) poe(it.nomes[k], it.id);
    for (const t of it.antigos) poe(t, it.id);
    for (const t of it.apelidos) poe(t, it.id);
    for (const t of it.seus) poe(t, it.id);
    if (it.chave) poe(it.chave, it.id);
    poe(it.id, it.id); // killer-the-trapper.png (uma pasta de imagens deste programa)
  }
  return mapa;
}
function mapaDeArquivos(itens) {
  const m = new Map();
  for (const it of itens) if (it.imagem) m.set(it.imagem.arquivo, it.id);
  return m;
}
// slug do id + extensão da assinatura; se outro item já usa o nome, -2, -3…
function nomeDaImagem(itemId, ext, ocupados) {
  const base = itemId.replace(':', '-');
  const b = livre(base, (c) => { const dono = ocupados.get(`${c}.${ext}`); return dono !== undefined && dono !== itemId; }, 100);
  return `${b}.${ext}`;
}
const CAMPOS_IMAGEM = new Set(['arquivo', 'origem', 'ocultar']);
function imagemDoArquivo(v, perdas) {
  if (vazio(v)) return null;
  if (!ehObjeto(v) || typeof v.arquivo !== 'string' || v.arquivo.length > 120 || !RE_ARQUIVO.test(v.arquivo)) {
    contarPerda(perdas); // «killer-the-trapper.jpeg» escrito à mão
    return null;
  }
  if (!ORIGENS_IMAGEM.includes(v.origem) || (!vazio(v.ocultar) && typeof v.ocultar !== 'boolean')) contarPerda(perdas);
  for (const k of Object.keys(v)) if (!CAMPOS_IMAGEM.has(k) && !vazio(v[k])) contarPerda(perdas);
  return { arquivo: v.arquivo, origem: ORIGENS_IMAGEM.includes(v.origem) ? v.origem : 'importada', ocultar: v.ocultar === true };
}

// ── 💾 Arquivo do catálogo ─────────────────────────────────────────────────
// Um item por linha: dá para ler à mão, e um corte no fim estraga só o fim.
function serializar(cat) {
  const linhas = (lista, f) => (lista.length ? `\n${lista.map(f).join(',\n')}\n` : '');
  return `{"versao":${cat.versao},"jogo":${JSON.stringify(cat.jogo)},\n"tipos": [${linhas(cat.tipos, (t) => JSON.stringify(t))}],\n"itens": [${linhas(cat.itens, serie)}]}\n`;
}

// Item lido do disco: o que estiver estragado num campo cai para o padrão; sem id,
// tipo ou nome válido o item fica de fora. As duas coisas fazem o arquivo inteiro
// ganhar uma cópia antes (o campo largado aqui sumiria na próxima gravação): o item
// conta em «descartados», o campo em `perdas.n`. Arquivo gravado pelo programa não
// perde nada — senão cada abertura faria uma cópia.
const CAMPOS_ITEM = new Set(['id', 'tipo', 'nomes', 'antigos', 'apelidos', 'seus', 'dono', 'lado', 'raridade', 'imagem',
  'chave', 'fonte', 'travado', 'naoTenho', 'desc']);
function itemDoArquivo(b, tiposIds, perdas) {
  if (!ehObjeto(b) || !idItemValido(b.id)) return null;
  const tipo = b.id.slice(0, b.id.indexOf(':'));
  if (b.tipo !== tipo || !tiposIds.has(tipo)) return null;
  const p = { n: 0 }; // só conta se o item fica
  const nomes = lerNomes(b.nomes, { leniente: true, perdas: p });
  if (!Object.keys(nomes).length) return null;
  const lista = (v, rotulo, max, semBarra) => lerLista(v, { rotulo, max, semBarra, leniente: true, perdas: p });
  const tenta = (fn, padrao) => { try { return fn(); } catch { contarPerda(p); return padrao; } };
  const campo = (v, valido, padrao) => { if (vazio(v)) return padrao; if (valido(v)) return v; contarPerda(p); return padrao; };
  const simNao = (v) => campo(v, (x) => typeof x === 'boolean', false);
  for (const k of Object.keys(b)) if (!CAMPOS_ITEM.has(k) && !vazio(b[k])) contarPerda(p);
  const it = montarItem({
    id: b.id, tipo, nomes,
    antigos: lista(b.antigos, 'nomes antigos', 120, false),
    apelidos: lista(b.apelidos, 'apelidos', 60, true),
    seus: lista(b.seus, 'seus apelidos', 60, true),
    dono: campo(b.dono, idItemValido, null),
    lado: campo(b.lado, (x) => LADOS.includes(x), null),
    raridade: campo(b.raridade, (x) => RARIDADES.includes(x), null),
    imagem: imagemDoArquivo(b.imagem, p),
    chave: vazio(b.chave) ? null : tenta(() => lerChave(b.chave), null),
    fonte: campo(b.fonte, fonteValida, 'manual'),
    travado: simNao(b.travado),
    naoTenho: simNao(b.naoTenho),
    desc: vazio(b.desc) ? '' : tenta(() => lerDesc(b.desc), ''),
  });
  if (perdas) perdas.n += p.n;
  return it;
}

const CAMPOS_CATALOGO = new Set(['versao', 'jogo', 'tipos', 'itens']);
const CAMPOS_JOGO = new Set(['id', 'nome', 'modelo', 'criadoEm', 'atualizadoEm', 'fontes']);
const CAMPOS_TIPO = new Set(['id', 'nomes', 'icone', 'papel']);
// → { cat, descartados, perdas } ou null (não é um catálogo que este programa abre)
function normalizarCatalogo(dados, jogoId) {
  if (!ehObjeto(dados) || !ehObjeto(dados.jogo) || !Array.isArray(dados.itens)) return null;
  if (typeof dados.versao === 'number' && dados.versao > VERSAO) return null; // de uma versão mais nova: não mexe
  const perdas = { n: 0 };
  const sobrando = (o, campos) => { for (const k of Object.keys(o)) if (!campos.has(k) && !vazio(o[k])) contarPerda(perdas); };
  sobrando(dados, CAMPOS_CATALOGO);
  const j = dados.jogo;
  sobrando(j, CAMPOS_JOGO);
  const modelo = MODELOS.includes(j.modelo) ? j.modelo : 'generico';
  if (!vazio(j.modelo) && modelo !== j.modelo) contarPerda(perdas);
  let nome = jogoId;
  try { nome = lerNomeDeJogo(j.nome); } catch { if (!vazio(j.nome)) contarPerda(perdas); /* fica o id */ }
  const num = (v) => {
    if (Number.isFinite(v) && v >= 0) return v;
    if (!vazio(v)) contarPerda(perdas);
    return 0;
  };
  let tipos;
  let descartados = 0;
  if (modelo === 'dbd') tipos = tiposDoModelo('dbd'); // fixos: valem os do programa
  else if (!Array.isArray(dados.tipos)) {
    if (!vazio(dados.tipos)) contarPerda(perdas);
    tipos = tiposDoModelo('generico');
  } else {
    tipos = [];
    const vistos = new Set();
    for (const t of dados.tipos) {
      try {
        const l = lerTipoEntrada(t);
        if (!l.id || vistos.has(l.id) || !Object.keys(l.nomes).length) { descartados++; continue; }
        vistos.add(l.id);
        sobrando(t, CAMPOS_TIPO);
        tipos.push(montarTipo(l.id, l.nomes, l.icone || '🏷️', l.papel || 'outro'));
      } catch { descartados++; }
    }
  }
  const tiposIds = new Set(tipos.map((t) => t.id));
  const itens = [];
  const ids = new Set();
  for (const bruto of dados.itens) {
    const it = itemDoArquivo(bruto, tiposIds, perdas);
    if (!it || ids.has(it.id)) { descartados++; continue; }
    ids.add(it.id);
    itens.push(it);
  }
  for (let i = 0; i < itens.length; i++) { // dono que sumiu vira geral
    const it = itens[i];
    if (it.dono && (!ids.has(it.dono) || it.dono === it.id)) { itens[i] = montarItem({ ...it, dono: null }); contarPerda(perdas); }
  }
  let fontes = {};
  try {
    const f = dadoSimples(j.fontes, 0, perdas);
    if (ehObjeto(f)) fontes = f;
    else if (!vazio(f)) contarPerda(perdas);
  } catch { contarPerda(perdas); /* fica vazio */ }
  const jogo = { id: jogoId, nome, modelo, criadoEm: num(j.criadoEm), atualizadoEm: num(j.atualizadoEm), fontes };
  return { cat: { versao: VERSAO, jogo, tipos, itens }, descartados, perdas: perdas.n };
}

const novoCatalogo = (id, nome, modelo, agora) => ({
  versao: VERSAO,
  jogo: { id, nome, modelo, criadoEm: agora, atualizadoEm: agora, fontes: {} },
  tipos: tiposDoModelo(modelo),
  itens: [],
});
// atualizadoEm sempre sobe, mesmo com duas mudanças no mesmo milissegundo
const carimbo = (antes) => Math.max(Date.now(), (Number(antes) || 0) + 1);

// O que cada catálogo (já gravado, nunca mais mexido) indexa: guardado à parte
const indicesPorId = new WeakMap();
function porId(cat) {
  let m = indicesPorId.get(cat);
  if (!m) { m = new Map(cat.itens.map((it) => [it.id, it])); indicesPorId.set(cat, m); }
  return m;
}
const arquivosUsados = new WeakMap();
function arquivosDe(cat) {
  let s = arquivosUsados.get(cat);
  if (!s) { s = new Set(cat.itens.filter((it) => it.imagem).map((it) => it.imagem.arquivo)); arquivosUsados.set(cat, s); }
  return s;
}
const textosDeBusca = new WeakMap();
function textoDeBusca(it) {
  let t = textosDeBusca.get(it);
  if (t === undefined) {
    const partes = [it.id, ...IDIOMAS.map((k) => it.nomes[k]).filter(Boolean), ...it.antigos, ...it.apelidos, ...it.seus];
    t = ` ${partes.map(normalizar).join(' ')} `;
    textosDeBusca.set(it, t);
  }
  return t;
}
const posicao = (cat, itemId) => (typeof itemId === 'string' ? cat.itens.findIndex((it) => it.id === itemId) : -1);

// ── 📚 Os catálogos de uma pasta ──────────────────────────────────────────
function criarCatalogos(baseDir) {
  if (typeof baseDir !== 'string' || !baseDir.trim()) throw new TypeError('criarCatalogos: falta a pasta base (data/pedidos)');
  const pastaCatalogos = path.join(baseDir, 'catalogos');
  const pastaImagens = path.join(baseDir, 'imagens');
  const cache = new Map();     // jogoId → catálogo valendo
  const marcas = new Map();    // jogoId → { marca, quando }: o arquivo como ficou na nossa última leitura ou gravação
  const ilegiveis = new Map(); // jogoId → { copia, marca, resgate }: trava de gravação

  const arquivoDoJogo = (id) => path.join(pastaCatalogos, `${id}.json`);
  const pastaDoJogo = (id) => path.join(pastaImagens, id);
  const marcaDoArquivo = (arq) => { try { const st = fs.statSync(arq); return `${st.size}:${st.mtimeMs}`; } catch { return null; } };
  const naoAchado = () => falha('jogo-inexistente', 'jogo não encontrado');
  const erroIlegivel = (t) => falha('catalogo-ilegivel', t.preso
    ? 'o arquivo deste catálogo está preso por outro programa (antivírus, OneDrive…): nada é gravado até ele abrir de novo'
    : 'o arquivo deste catálogo não abre: nada é gravado por cima até ele abrir de novo ou você recriar o jogo', { copia: t.copia || null });

  // Restos de gravação interrompida (o programa caiu no meio): saem ao abrir
  function limparRestos() {
    try {
      const alvos = new Set();
      for (const f of fs.readdirSync(pastaCatalogos)) {
        const m = /^([a-z0-9-]{1,60})\.json\.tmp-/.exec(f);
        if (m && jogoIdValido(m[1])) alvos.add(`${m[1]}.json`);
      }
      for (const a of alvos) limparTemporarios(path.join(pastaCatalogos, a));
    } catch { /* pasta ainda não existe */ }
  }
  // (também a reserva «-antes» de uma troca de imagem que o programa não terminou)
  function limparRestosDeImagem(jogoId) {
    const dir = pastaDoJogo(jogoId);
    try {
      for (const f of fs.readdirSync(dir)) if (RE_RESTO_IMAGEM.test(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch { /* segue */ } }
    } catch { /* sem pasta de imagens */ }
  }

  // Cópia de um arquivo que não abre — a mesma cópia serve se o conteúdo é igual (abrir o
  // programa de novo com o mesmo arquivo quebrado não empilha cópias).
  function copiaIgual(arq, exceto) {
    let conteudo;
    try { conteudo = fs.readFileSync(arq); } catch { return null; }
    const dir = path.dirname(arq);
    const prefixo = `${path.basename(arq, '.json')}.ilegivel-`;
    try {
      for (const f of fs.readdirSync(dir).sort()) {
        if (!f.startsWith(prefixo) || !f.endsWith('.json')) continue;
        const p = path.join(dir, f);
        if (p === exceto) continue;
        try { if (fs.statSync(p).size === conteudo.length && fs.readFileSync(p).equals(conteudo)) return p; } catch { /* segue */ }
      }
    } catch { /* sem pasta */ }
    return null;
  }
  function guardarCopia(arq) {
    const igual = copiaIgual(arq, null);
    if (igual) return igual;
    const copia = path.join(path.dirname(arq), `${path.basename(arq, '.json')}.ilegivel-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    try { fs.copyFileSync(arq, copia); return copia; } catch { return null; }
  }
  function semCopiaRepetida(arq, nova) {
    if (!nova) return guardarCopia(arq);
    const antiga = copiaIgual(arq, nova);
    if (!antiga) return nova;
    try { fs.unlinkSync(nova); } catch { return nova; }
    return antiga;
  }
  // O começo do arquivo cortado quase sempre ainda tem o nome e o modelo do jogo:
  // o «recriar» começa do zero sem perder isso.
  function resgatarNomeEModelo(arq) {
    try {
      const fd = fs.openSync(arq, 'r');
      const buf = Buffer.alloc(8192);
      let n = 0;
      try { n = fs.readSync(fd, buf, 0, buf.length, 0); } finally { fs.closeSync(fd); }
      const txt = buf.toString('utf8', 0, n);
      const m1 = /"modelo"\s*:\s*"(dbd|generico)"/.exec(txt);
      const m2 = /"jogo"\s*:\s*\{[^{}]*?"nome"\s*:\s*("(?:[^"\\\u0000-\u001f]|\\.){1,400}")/.exec(txt);
      let nome = null;
      if (m2) { try { nome = lerNomeDeJogo(JSON.parse(m2[1])); } catch { nome = null; } }
      return { nome, modelo: m1 ? m1[1] : null };
    } catch {
      return { nome: null, modelo: null };
    }
  }

  // O Bloco de Notas e o PowerShell salvam «UTF-8 com BOM», e o JSON.parse não aceita o
  // BOM na frente: o conteúdo está bom, então abre sem ele (a próxima gravação já sai sem).
  // Estragado de verdade, o lerJsonSeguro guarda a cópia como sempre.
  function comecaComBom(arq) {
    let fd = null;
    try {
      fd = fs.openSync(arq, 'r');
      const b = Buffer.alloc(3);
      return fs.readSync(fd, b, 0, 3, 0) === 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
    } catch {
      return false; // o lerJsonSeguro vê o erro (preso, sem permissão) e responde por ele
    } finally {
      if (fd !== null) { try { fs.closeSync(fd); } catch { /* segue */ } }
    }
  }
  function lerCatalogo(arq) {
    if (comecaComBom(arq)) {
      try { return { ok: true, dados: JSON.parse(fs.readFileSync(arq, 'utf8').slice(1)) }; } catch { /* segue */ }
    }
    return lerJsonSeguro(arq);
  }

  // Memória + a marca do arquivo (tamanho:data) que ela representa
  function guardar(jogoId, cat, marca) {
    cache.set(jogoId, cat);
    marcas.set(jogoId, { marca: marca === undefined ? marcaDoArquivo(arquivoDoJogo(jogoId)) : marca, quando: Date.now() });
  }
  function esquecer(jogoId) {
    cache.delete(jogoId);
    marcas.delete(jogoId);
  }

  // O catálogo valendo, ou o erro. O da memória vale enquanto o arquivo for o que lemos
  // ou gravamos: mexido por fora com o programa aberto (à mão, outro programa) é lido de
  // novo — sempre antes de gravar (`conferir`), e na leitura no máximo uma vez por
  // segundo —, então nunca gravamos por cima do que o streamer escreveu, nem sem cópia.
  // Conteúdo estragado só é lido de novo se o arquivo mudou (o streamer consertou ou
  // trocou): ler o mesmo arquivo faria outra cópia. Arquivo preso (o antivírus ou o
  // OneDrive segurando no Windows: erro de leitura, não de conteúdo) tenta de novo a
  // cada segundo — não pode travar a live inteira.
  function obter(jogoId, { forcar = false, conferir = false } = {}) {
    if (!jogoIdValido(jogoId)) return { erro: naoAchado() };
    const arq = arquivoDoJogo(jogoId);
    const emCache = cache.get(jogoId);
    if (emCache) {
      const m = marcas.get(jogoId);
      const agora = Date.now();
      if (m && !conferir && agora - m.quando < CONFERIR_MS) return { cat: emCache };
      if (m && m.marca !== null && marcaDoArquivo(arq) === m.marca) { m.quando = agora; return { cat: emCache }; }
      esquecer(jogoId); // mudou (ou sumiu) por fora: lê de novo
    }
    const marca = marcaDoArquivo(arq);
    const trava = ilegiveis.get(jogoId);
    if (trava) {
      if (marca === null) { ilegiveis.delete(jogoId); return { erro: naoAchado() }; }
      const deNovo = forcar || marca !== trava.marca || (trava.preso && Date.now() - trava.quando >= 1000);
      if (!deNovo) return { erro: erroIlegivel(trava) };
    }
    const lido = lerCatalogo(arq);
    let motivo = lido.erro || 'sem cara de catálogo';
    if (lido.ok) {
      const n = normalizarCatalogo(lido.dados, jogoId);
      if (n) {
        // item ou campo fora do formato fica de fora na memória e sumiria na próxima
        // gravação: o arquivo como estava ganha uma cópia antes
        if (n.descartados || n.perdas) {
          const copia = guardarCopia(arq);
          if (n.descartados) console.error(`  ⚠️ 🙋 Catálogo «${jogoId}»: ${n.descartados} entrada(s) estragada(s) ficaram de fora.`);
          if (n.perdas) console.error(`  ⚠️ 🙋 Catálogo «${jogoId}»: ${n.perdas} campo(s) fora do formato ficaram de fora.`);
          console.error(copia ? `    O arquivo como estava ficou guardado em ${path.basename(copia)}.` : '    E não consegui guardar uma cópia do arquivo como estava.');
        }
        ilegiveis.delete(jogoId);
        guardar(jogoId, n.cat, marca);
        limparRestosDeImagem(jogoId);
        return { cat: n.cat };
      }
      if (typeof lido.dados?.versao === 'number' && lido.dados.versao > VERSAO) motivo = `gravado por uma versão mais nova (v${lido.dados.versao})`;
    } else if (lido.faltando) {
      ilegiveis.delete(jogoId);
      return { erro: naoAchado() };
    }
    // erro de leitura vem com o código do sistema (EBUSY, EPERM…); conteúdo ruim, não
    const preso = !lido.ok && typeof lido.erro === 'string' && /^E[A-Z]+$/.test(lido.erro);
    const copia = (lido.ok ? guardarCopia(arq) : semCopiaRepetida(arq, lido.copia)) || (trava && trava.copia) || null;
    const resgate = resgatarNomeEModelo(arq);
    const nova = { copia, marca, preso, quando: Date.now(), resgate: resgate.nome || !trava ? resgate : trava.resgate };
    ilegiveis.set(jogoId, nova);
    if (!trava || trava.marca !== marca || trava.preso !== preso) { // avisa uma vez por estado, não a cada tentativa
      console.error(`  ⚠️ 🙋 Catálogo «${jogoId}» não abre (${motivo}).`);
      console.error(preso ? '    Parece preso por outro programa: tento de novo sozinho; nada grava por cima até ele abrir.'
        : copia ? `    O arquivo como estava ficou guardado em ${path.basename(copia)}; nada grava por cima até ele abrir ou o jogo ser recriado.`
          : '    E não consegui guardar uma cópia: nada grava por cima até ele abrir ou o jogo ser recriado.');
    }
    return { erro: erroIlegivel(nova) };
  }

  function gravarCatalogo(jogoId, cat) {
    gravarAtomico(arquivoDoJogo(jogoId), serializar(cat));
  }
  function falhaGravacao(jogoId, err) {
    const motivo = (err && (err.code || err.message)) || String(err);
    console.error(`  ⚠️ 🙋 Não consegui gravar o catálogo «${jogoId}»:`, motivo);
    return falha('gravacao', `não consegui gravar o catálogo (${motivo})`);
  }

  // Toda mudança passa por aqui: rascunho (cópia rasa) → fn → uma gravação → troca na
  // memória. Erro de validação ou de disco: nada muda, e o que fn escreveu é desfeito.
  function alterar(jogoId, fn) {
    const r0 = obter(jogoId, { conferir: true });
    if (r0.erro) return r0.erro;
    const atual = r0.cat;
    const rascunho = { versao: atual.versao, jogo: { ...atual.jogo }, tipos: atual.tipos.slice(), itens: atual.itens.slice() };
    const ctx = { mudou: false, depois: [], desfazer: [] };
    const desfazer = () => { for (const f of ctx.desfazer) { try { f(); } catch { /* segue */ } } };
    let r;
    try {
      r = fn(rascunho, ctx);
    } catch (err) {
      desfazer();
      if (err instanceof ErroEntrada) return falha(err.erro, err.message);
      if (err && typeof err.code === 'string') return falhaGravacao(jogoId, err); // erro do disco (imagem)
      throw err;
    }
    if (r && r.ok === false) { desfazer(); return r; }
    if (ctx.mudou) {
      rascunho.jogo.atualizadoEm = carimbo(atual.jogo.atualizadoEm);
      try { gravarCatalogo(jogoId, rascunho); } catch (err) { desfazer(); return falhaGravacao(jogoId, err); }
      guardar(jogoId, rascunho);
    }
    for (const f of ctx.depois) { try { f(); } catch { /* arquivo velho fica para a próxima limpeza */ } }
    return r;
  }

  // Apaga uma imagem só se nenhum item do catálogo valendo aponta para ela
  function apagarSeSolta(jogoId, arquivo) {
    if (typeof arquivo !== 'string' || !RE_ARQUIVO.test(arquivo)) return;
    const cat = cache.get(jogoId);
    if (cat && arquivosDe(cat).has(arquivo)) return;
    const p = path.join(pastaDoJogo(jogoId), arquivo);
    try { const st = fs.lstatSync(p); if (st.isFile() || st.isSymbolicLink()) fs.unlinkSync(p); } catch { /* já não existe */ }
  }
  function contarJogos() {
    try { return fs.readdirSync(pastaCatalogos).filter((f) => f.endsWith('.json') && jogoIdValido(f.slice(0, -5))).length; } catch { return 0; }
  }
  const resumo = (cat) => ({
    id: cat.jogo.id, nome: cat.jogo.nome, modelo: cat.jogo.modelo,
    itens: cat.itens.length, imagens: cat.itens.reduce((n, it) => n + (it.imagem ? 1 : 0), 0),
    atualizadoEm: cat.jogo.atualizadoEm,
  });

  // ── 🎮 Jogos ──
  function listar() {
    let arquivos = [];
    try { arquivos = fs.readdirSync(pastaCatalogos); } catch { /* ainda não há catálogo */ }
    const lista = [];
    for (const f of arquivos) {
      if (!f.endsWith('.json')) continue;
      const id = f.slice(0, -5);
      if (!jogoIdValido(id)) continue; // cópias .ilegivel-… e temporários ficam de fora
      const r = obter(id);
      if (r.cat) lista.push(resumo(r.cat));
      else if (r.erro.erro === 'catalogo-ilegivel') {
        const res = (ilegiveis.get(id) || {}).resgate || {};
        lista.push({ id, nome: res.nome || id, modelo: res.modelo || null, itens: 0, imagens: 0, atualizadoEm: 0, erro: 'ilegivel', copia: r.erro.copia });
      }
    }
    return lista.sort((a, b) => a.nome.localeCompare(b.nome, 'pt', { sensitivity: 'base' }) || a.id.localeCompare(b.id));
  }

  // O objeto devolvido é o da memória: leia, não mude (mudança só pelas funções daqui)
  function carregar(jogoId) {
    const r = obter(jogoId);
    if (r.cat) return r.cat;
    if (r.erro.erro === 'catalogo-ilegivel') return { ok: false, erro: 'ilegivel', copia: r.erro.copia, motivo: r.erro.motivo };
    return null;
  }

  function criarJogo(nome, modelo) {
    let n;
    try { n = lerNomeDeJogo(nome); } catch (e) { return falha(e.erro, e.message); }
    const mod = modelo === undefined || modelo === null || modelo === '' ? 'generico' : modelo;
    if (!MODELOS.includes(mod)) return falha('modelo-invalido', `modelo desconhecido (vale ${MODELOS.join(' ou ')})`);
    if (contarJogos() >= TETOS.jogos) return falha('teto-jogos', `no máximo ${TETOS.jogos} jogos`);
    let base = slug(n) || `jogo-${hash8(n)}`;
    if (RESERVADOS_WINDOWS.test(base) || CHAVES_PERIGOSAS.has(base)) base += '-jogo';
    const id = livre(base, (c) => cache.has(c) || ilegiveis.has(c) || fs.existsSync(arquivoDoJogo(c)), 60);
    if (!id) return falha('nome-invalido', 'não achei um nome de arquivo livre para esse jogo');
    const cat = novoCatalogo(id, n, mod, Date.now());
    try { gravarCatalogo(id, cat); } catch (e) { return falhaGravacao(id, e); }
    guardar(id, cat);
    return cat;
  }

  // O id não muda (arquivo, imagens e pedidos apontam para ele): só o nome
  function renomearJogo(jogoId, nome) {
    return alterar(jogoId, (cat, ctx) => {
      const n = lerNomeDeJogo(nome);
      if (n !== cat.jogo.nome) { cat.jogo = { ...cat.jogo, nome: n }; ctx.mudou = true; }
      return { ok: true, nome: n };
    });
  }

  // Apaga o catálogo e as imagens; as cópias .ilegivel-… ficam (são do streamer)
  function apagarJogo(jogoId) {
    if (!jogoIdValido(jogoId)) return naoAchado();
    const arq = arquivoDoJogo(jogoId);
    if (!cache.has(jogoId) && !ilegiveis.has(jogoId) && !fs.existsSync(arq)) return naoAchado();
    try { fs.rmSync(arq, { force: true }); } catch (e) { return falhaGravacao(jogoId, e); }
    limparTemporarios(arq);
    try { fs.rmSync(pastaDoJogo(jogoId), { recursive: true, force: true }); } catch { /* imagem presa: sobra na pasta */ }
    esquecer(jogoId);
    ilegiveis.delete(jogoId);
    return { ok: true };
  }

  // «Começar do zero» de propósito, só para catálogo que não abre (ou sumiu): grava um
  // vazio com o nome e o modelo resgatados do começo do arquivo (ou os que vierem).
  function recriarJogo(jogoId, opcoes) {
    const o = typeof opcoes === 'string' ? { nome: opcoes } : ehObjeto(opcoes) ? opcoes : {};
    if (!jogoIdValido(jogoId)) return naoAchado();
    const r = obter(jogoId, { forcar: true }); // lê de novo agora: pode ter sido consertado ou solto
    if (r.cat) return falha('catalogo-ok', 'este catálogo abre normalmente: para começar do zero, apague o jogo e crie de novo');
    const trava = ilegiveis.get(jogoId);
    // preso não é estragado: recriar agora jogaria fora um arquivo bom
    if (trava && trava.preso) return falha('arquivo-preso', 'o arquivo do catálogo está preso por outro programa: espere ele soltar (nada foi apagado)');
    const resgate = (trava && trava.resgate) || {};
    let nome = resgate.nome || jogoId;
    if (o.nome !== undefined && o.nome !== null && o.nome !== '') {
      try { nome = lerNomeDeJogo(o.nome); } catch (e) { return falha(e.erro, e.message); }
    }
    let modelo = resgate.modelo || 'generico';
    if (o.modelo !== undefined && o.modelo !== null && o.modelo !== '') {
      if (!MODELOS.includes(o.modelo)) return falha('modelo-invalido', `modelo desconhecido (vale ${MODELOS.join(' ou ')})`);
      modelo = o.modelo;
    }
    const arq = arquivoDoJogo(jogoId);
    if (!trava && contarJogos() >= TETOS.jogos) return falha('teto-jogos', `no máximo ${TETOS.jogos} jogos`);
    if (trava && !trava.copia && fs.existsSync(arq)) trava.copia = guardarCopia(arq); // a cópia antes de tudo
    const cat = novoCatalogo(jogoId, nome, modelo, Date.now());
    try { gravarCatalogo(jogoId, cat); } catch (e) { return falhaGravacao(jogoId, e); }
    ilegiveis.delete(jogoId);
    guardar(jogoId, cat);
    return cat;
  }

  // ── 🏷️ Tipos (só no modelo genérico; os do DBD são fixos) ──
  function salvarTipo(jogoId, tipo) {
    return alterar(jogoId, (cat, ctx) => {
      if (cat.jogo.modelo === 'dbd') return falha('tipos-fixos', 'os tipos do modelo Dead by Daylight são fixos');
      const l = lerTipoEntrada(tipo);
      const pos = l.id ? cat.tipos.findIndex((t) => t.id === l.id) : -1;
      if (pos >= 0) {
        const velho = cat.tipos[pos];
        const novo = montarTipo(velho.id, Object.keys(l.nomes).length ? l.nomes : velho.nomes, l.icone || velho.icone, l.papel || velho.papel);
        if (JSON.stringify(novo) === JSON.stringify(velho)) return { ok: true, tipo: velho, novo: false };
        cat.tipos[pos] = novo;
        ctx.mudou = true;
        return { ok: true, tipo: novo, novo: false };
      }
      if (!Object.keys(l.nomes).length) throw new ErroEntrada('o tipo precisa de pelo menos um nome', 'tipo-invalido');
      if (cat.tipos.length >= TETOS.tipos) return falha('teto-tipos', `no máximo ${TETOS.tipos} tipos por jogo`);
      let id = l.id;
      if (!id) {
        const n = primeiroNome(l.nomes);
        id = slug(n, 30) || `tipo-${hash8(n)}`;
        if (CHAVES_PERIGOSAS.has(id)) id += '-tipo';
        if (cat.tipos.some((t) => t.id === id)) return falha('tipo-existe', `já existe o tipo «${id}»`);
      }
      const novo = montarTipo(id, l.nomes, l.icone || '🏷️', l.papel || 'outro');
      cat.tipos.push(novo);
      ctx.mudou = true;
      return { ok: true, tipo: novo, novo: true };
    });
  }
  function apagarTipo(jogoId, tipoId) {
    return alterar(jogoId, (cat, ctx) => {
      if (cat.jogo.modelo === 'dbd') return falha('tipos-fixos', 'os tipos do modelo Dead by Daylight são fixos');
      const pos = typeof tipoId === 'string' ? cat.tipos.findIndex((t) => t.id === tipoId) : -1;
      if (pos < 0) return falha('tipo-inexistente', 'esse tipo não existe neste jogo');
      const usam = cat.itens.reduce((n, it) => n + (it.tipo === tipoId ? 1 : 0), 0);
      if (usam) return falha('tipo-em-uso', `${usam} item(ns) usam esse tipo: mude ou apague esses itens antes`, { itens: usam });
      cat.tipos.splice(pos, 1);
      ctx.mudou = true;
      return { ok: true };
    });
  }

  // ── 🧱 Itens ──
  function conferirDono(cat, dono, proprioId) {
    if (!dono) return;
    if (dono === proprioId) throw new ErroEntrada('um item não pode ser dono de si mesmo', 'dono-inexistente');
    if (posicao(cat, dono) < 0) throw new ErroEntrada(`dono «${dono}» não existe no catálogo`, 'dono-inexistente');
  }

  // Cria (sem id, ou id novo) ou atualiza (id existente). manual: true = travado.
  function salvarItem(jogoId, item, opcoes) {
    const manual = !!(opcoes && opcoes.manual);
    return alterar(jogoId, (cat, ctx) => {
      const d = lerItemEntrada(item, new Set(cat.tipos.map((t) => t.id)));
      const pos = d.id ? posicao(cat, d.id) : -1;
      if (pos >= 0) {
        const velho = cat.itens[pos];
        if (d.tipo && d.tipo !== velho.tipo) throw new ErroEntrada(`o tipo de um item não muda (é «${velho.tipo}»): apague e crie de novo`, 'tipo-diferente');
        const novo = juntarManual(velho, d, manual);
        if (!Object.keys(novo.nomes).length) throw new ErroEntrada('o item precisa de pelo menos um nome');
        conferirDono(cat, novo.dono, novo.id);
        if (serie(novo) === serie(velho)) return { ok: true, item: velho, novo: false };
        cat.itens[pos] = novo;
        ctx.mudou = true;
        return { ok: true, item: novo, novo: false };
      }
      if (!d.tipo) throw new ErroEntrada('falta o tipo do item');
      if (!d.nomes || !Object.keys(d.nomes).length) throw new ErroEntrada('o item precisa de pelo menos um nome');
      if (cat.itens.length >= TETOS.itens) return falha('teto-itens', `o catálogo chegou ao teto de ${TETOS.itens} itens`);
      let id;
      if (d.id) {
        if (d.id.slice(0, d.id.indexOf(':')) !== d.tipo) throw new ErroEntrada(`o id ${d.id} não começa pelo tipo «${d.tipo}»`, 'tipo-diferente');
        id = d.id;
      } else {
        const ids = new Set(cat.itens.map((it) => it.id));
        const base = idBase(d.tipo, d.nomes);
        const s = livre(base.slice(d.tipo.length + 1), (c) => ids.has(`${d.tipo}:${c}`), 60);
        id = `${d.tipo}:${s}`;
      }
      conferirDono(cat, d.dono, id);
      const novo = montarItem({
        id, tipo: d.tipo, nomes: d.nomes, antigos: d.antigos || [], apelidos: d.apelidos || [], seus: d.seus || [],
        dono: d.dono || null, lado: d.lado || null, raridade: d.raridade || null, imagem: null, chave: d.chave || null,
        fonte: manual ? 'manual' : (d.fonte || 'manual'), travado: manual, naoTenho: !!d.naoTenho, desc: d.desc || '',
      });
      cat.itens.push(novo);
      ctx.mudou = true;
      return { ok: true, item: novo, novo: true };
    });
  }

  // Quem tinha este item como dono vira geral; a imagem dele sai do disco
  function apagarItem(jogoId, itemId) {
    return alterar(jogoId, (cat, ctx) => {
      const pos = posicao(cat, itemId);
      if (pos < 0) return falha('item-inexistente', 'esse item não existe no catálogo');
      const [velho] = cat.itens.splice(pos, 1);
      let soltos = 0;
      cat.itens = cat.itens.map((it) => {
        if (it.dono !== velho.id) return it;
        soltos++;
        return montarItem({ ...it, dono: null });
      });
      ctx.mudou = true;
      if (velho.imagem) ctx.depois.push(() => apagarSeSolta(jogoId, velho.imagem.arquivo));
      return { ok: true, soltos };
    });
  }

  // Confirmação na ⚠ Revisar vira apelido «seu»: sem repetir (normalizado), até 50.
  // Já é o nome do item: nada a fazer. Está só nos automáticos: entra nos seus (aí fica).
  function ensinarApelido(jogoId, itemId, apelido) {
    return alterar(jogoId, (cat, ctx) => {
      const t = textoCurto(apelido, 60, 'apelido', 'apelido-invalido');
      if (!t) throw new ErroEntrada('apelido vazio', 'apelido-invalido');
      if (t.includes('|')) throw new ErroEntrada('apelido: «|» separa os apelidos na planilha e não pode fazer parte de um', 'apelido-invalido');
      const n = normalizar(t);
      if (!n) throw new ErroEntrada('o apelido precisa ter letra ou número', 'apelido-invalido');
      const pos = posicao(cat, itemId);
      if (pos < 0) return falha('item-inexistente', 'esse item não existe no catálogo');
      const it = cat.itens[pos];
      if (it.seus.some((s) => normalizar(s) === n)) return { ok: true, novo: false };
      if (IDIOMAS.some((k) => it.nomes[k] && normalizar(it.nomes[k]) === n)) return { ok: true, novo: false };
      if (it.seus.length >= TETOS.apelidos) return falha('teto-apelidos', `esse item já tem ${TETOS.apelidos} apelidos seus`);
      cat.itens[pos] = montarItem({ ...it, seus: it.seus.concat(t) });
      ctx.mudou = true;
      return { ok: true, novo: true };
    });
  }

  // Lote (mesclar, importar): cada entrada sozinha primeiro; depois o lote inteiro
  // numa cópia. Entradas cujo dono não existe no fim saem (a corrente inteira de uma
  // vez) e o lote é refeito sem elas (o dono pode vir mais adiante no mesmo lote).
  // Uma gravação só, no fim.
  function aplicarLote(cat, ctx, entradas, modo, fonte) {
    const tiposIds = new Set(cat.tipos.map((t) => t.id));
    const erros = [];
    const validas = [];
    for (const e of entradas) {
      try { validas.push({ linha: e.linha, d: lerItemEntrada(e.bruto, tiposIds) }); } catch (err) {
        if (!(err instanceof ErroEntrada)) throw err;
        erros.push({ linha: e.linha, motivo: err.message });
      }
    }
    const originais = new Map(cat.itens.map((it) => [it.id, it]));
    const fora = new Set();
    let r;
    // Quase sempre fecha na 1ª ou 2ª volta (tirar uma entrada pode mudar o item que
    // outra acha pela chave). Se não fechar em 8, a última vale com dono só de antes
    // da linha — e nunca cai uma linha boa por causa de outra corrente quebrada.
    for (let volta = 0; ; volta++) {
      r = simularLote(originais, validas.filter((e) => !fora.has(e)), { modo, fonte, tiposIds, soDonoAnterior: volta >= 8 });
      const semDono = entradasSemDono(r, originais);
      if (!semDono.length) break;
      const noLote = new Set(r.alvos.values());
      for (const e of semDono) {
        fora.add(e);
        erros.push({ linha: e.linha, motivo: noLote.has(e.d.dono) ? `dono «${e.d.dono}» ficou de fora deste lote` : `dono «${e.d.dono}» não existe no catálogo` });
      }
    }
    for (const f of r.falhas) erros.push(f);
    let atualizados = 0;
    for (const id of r.tocados) if (serie(r.itens.get(id)) !== serie(originais.get(id))) atualizados++;
    const novos = r.criados.size;
    if (novos || atualizados) { cat.itens = Array.from(r.itens.values()); ctx.mudou = true; }
    erros.sort((a, b) => a.linha - b.linha);
    return { ok: true, novos, atualizados, iguais: r.tocados.size - atualizados, erros };
  }

  // O que veio de uma fonte automática, respeitando travado e «seus»
  function mesclar(jogoId, itensNovos, opcoes) {
    const zero = { novos: 0, atualizados: 0, iguais: 0, erros: [] };
    if (!Array.isArray(itensNovos)) return falha('lista-invalida', 'mande uma lista de itens', zero);
    const fonte = opcoes && fonteValida(opcoes.fonte) ? opcoes.fonte : 'automatica';
    const entradas = itensNovos.map((bruto, i) => ({ linha: i + 1, bruto }));
    const r = alterar(jogoId, (cat, ctx) => {
      const res = aplicarLote(cat, ctx, entradas, 'mesclar', fonte);
      res.erros = cortarErros(res.erros);
      return res;
    });
    return r.ok === false ? Object.assign({}, zero, r) : r;
  }

  // ── 📤 Exportar / 📥 Importar ──
  function exportar(jogoId, formato) {
    if (formato !== 'json' && formato !== 'csv') return falha('formato-invalido', 'formato: json ou csv');
    const r = obter(jogoId);
    if (r.erro) return r.erro;
    return formato === 'json' ? serializar(r.cat) : csvDoCatalogo(r.cat);
  }

  // tipos novos do JSON exportado de um jogo genérico (os que já existem ficam como estão)
  function importarTipos(cat, ctx, tipos, erros) {
    if (cat.jogo.modelo === 'dbd' || !Array.isArray(tipos)) return;
    tipos.forEach((t, i) => {
      try {
        const l = lerTipoEntrada(t);
        if (!l.id || cat.tipos.some((x) => x.id === l.id)) return;
        if (!Object.keys(l.nomes).length) throw new ErroEntrada('sem nome', 'tipo-invalido');
        if (cat.tipos.length >= TETOS.tipos) throw new ErroEntrada(`no máximo ${TETOS.tipos} tipos por jogo`, 'teto-tipos');
        cat.tipos.push(montarTipo(l.id, l.nomes, l.icone || '🏷️', l.papel || 'outro'));
        ctx.mudou = true;
      } catch (err) {
        if (!(err instanceof ErroEntrada)) throw err;
        erros.push({ linha: 0, motivo: `tipo ${i + 1}: ${err.message}` });
      }
    });
  }

  function importar(jogoId, texto, formato) {
    const zero = { novos: 0, atualizados: 0, iguais: 0, erros: [] };
    if (formato !== 'json' && formato !== 'csv') return falha('formato-invalido', 'formato: json ou csv', zero);
    const txt = Buffer.isBuffer(texto) ? texto.toString('utf8') : texto;
    if (typeof txt !== 'string') return falha('arquivo-invalido', 'mande o conteúdo do arquivo como texto', zero);
    if (Buffer.byteLength(txt, 'utf8') > TETOS.importadoBytes) return falha('arquivo-grande', 'o arquivo passa de 8 MB', zero);
    const r = alterar(jogoId, (cat, ctx) => {
      let erros = [];
      let entradas;
      if (formato === 'csv') {
        const c = entradasDoCsv(txt, cat.tipos);
        if (c.erro) return c.erro;
        entradas = c.entradas;
        erros = c.erros;
      } else {
        const j = entradasDoJson(txt);
        if (j.erro) return j.erro;
        entradas = j.entradas;
        importarTipos(cat, ctx, j.tipos, erros);
      }
      const res = aplicarLote(cat, ctx, entradas, formato);
      res.erros = cortarErros(erros.concat(res.erros).sort((a, b) => a.linha - b.linha));
      return res;
    });
    return r.ok === false ? Object.assign({}, zero, r) : r;
  }

  // ── 🖼️ Imagens ──
  function trocarImagem(jogoId, cat, pos, img, origem, ctx, ocupados) {
    const it = cat.itens[pos];
    const antigo = it.imagem ? it.imagem.arquivo : null;
    const arquivo = nomeDaImagem(it.id, img.ext, ocupados);
    const destino = path.join(pastaDoJogo(jogoId), arquivo);
    if (arquivo === antigo) {
      // por cima da imagem que o catálogo valendo aponta: a de antes volta se algo
      // falhar (e, se ela já não estava no disco, a nova sai)
      const reserva = reservarImagem(destino);
      if (reserva) {
        ctx.desfazer.push(() => devolverImagem(reserva, destino));
        ctx.depois.push(() => fs.unlinkSync(reserva));
      } else ctx.desfazer.push(() => fs.unlinkSync(destino));
    } else ctx.desfazer.push(() => apagarSeSolta(jogoId, arquivo));
    gravarBinario(destino, img.buf);
    // «esconder» é escolha do streamer para o item: sobrevive à troca da imagem
    cat.itens[pos] = montarItem({ ...it, imagem: { arquivo, origem, ocultar: it.imagem ? it.imagem.ocultar : false } });
    if (antigo) ocupados.delete(antigo);
    ocupados.set(arquivo, it.id);
    if (antigo && antigo !== arquivo) ctx.depois.push(() => apagarSeSolta(jogoId, antigo)); // trocar apaga a anterior
    ctx.mudou = true;
    return arquivo;
  }

  function guardarImagem(jogoId, itemId, buffer, ext, origem) {
    let img;
    try { img = conferirImagem(buffer, ext); } catch (e) {
      if (!(e instanceof ErroEntrada)) throw e;
      return falha(e.erro, e.message);
    }
    if (!ORIGENS_IMAGEM.includes(origem)) return falha('origem-invalida', `origem da imagem desconhecida (vale ${ORIGENS_IMAGEM.join(', ')})`);
    return alterar(jogoId, (cat, ctx) => {
      const pos = posicao(cat, itemId);
      if (pos < 0) return falha('item-inexistente', 'esse item não existe no catálogo');
      const it = cat.itens[pos];
      if (it.travado && it.imagem && ORIGENS_AUTOMATICAS.has(origem)) return { ok: true, ignorada: true, arquivo: it.imagem.arquivo };
      const arquivo = trocarImagem(jogoId, cat, pos, img, origem, ctx, mapaDeArquivos(cat.itens));
      return { ok: true, arquivo };
    });
  }

  function ocultarImagem(jogoId, itemId, sim) {
    return alterar(jogoId, (cat, ctx) => {
      const pos = posicao(cat, itemId);
      if (pos < 0) return falha('item-inexistente', 'esse item não existe no catálogo');
      const it = cat.itens[pos];
      if (!it.imagem) return falha('sem-imagem', 'esse item não tem imagem');
      const ocultar = !!sim;
      if (it.imagem.ocultar !== ocultar) {
        cat.itens[pos] = montarItem({ ...it, imagem: { ...it.imagem, ocultar } });
        ctx.mudou = true;
      }
      return { ok: true, ocultar };
    });
  }

  function apagarImagem(jogoId, itemId) {
    return alterar(jogoId, (cat, ctx) => {
      const pos = posicao(cat, itemId);
      if (pos < 0) return falha('item-inexistente', 'esse item não existe no catálogo');
      const it = cat.itens[pos];
      if (!it.imagem) return { ok: true, apagada: false };
      const arquivo = it.imagem.arquivo;
      cat.itens[pos] = montarItem({ ...it, imagem: null });
      ctx.mudou = true;
      ctx.depois.push(() => apagarSeSolta(jogoId, arquivo));
      return { ok: true, apagada: true };
    });
  }

  // Todas (sem origem: a pasta inteira, sobras inclusive) ou só as de uma origem
  function apagarImagens(jogoId, opcoes) {
    const origem = opcoes && opcoes.origem;
    const todas = origem === undefined || origem === null || origem === '';
    if (!todas && !ORIGENS_IMAGEM.includes(origem)) return falha('origem-invalida', `origem da imagem desconhecida (vale ${ORIGENS_IMAGEM.join(', ')})`);
    return alterar(jogoId, (cat, ctx) => {
      const arquivos = [];
      cat.itens = cat.itens.map((it) => {
        if (!it.imagem || (!todas && it.imagem.origem !== origem)) return it;
        arquivos.push(it.imagem.arquivo);
        return montarItem({ ...it, imagem: null });
      });
      if (arquivos.length) ctx.mudou = true;
      ctx.depois.push(() => {
        for (const a of arquivos) apagarSeSolta(jogoId, a);
        if (!todas) return;
        const dir = pastaDoJogo(jogoId);
        let sobras = [];
        try { sobras = fs.readdirSync(dir); } catch { return; }
        for (const f of sobras) {
          const p = path.join(dir, f);
          try { const st = fs.lstatSync(p); if (st.isFile() || st.isSymbolicLink()) fs.unlinkSync(p); } catch { /* segue */ }
        }
        try { fs.rmdirSync(dir); } catch { /* sobrou alguma pasta: fica */ }
      });
      return { ok: true, apagadas: arquivos.length };
    });
  }

  // A pasta que o navegador mandou (em lotes): cada arquivo casa com um item pelo nome,
  // em qualquer idioma ou apelido. Imagem estragada/proibida vai para «erros».
  function importarPastaDeImagens(jogoId, arquivos) {
    if (!Array.isArray(arquivos)) return falha('lista-invalida', 'mande a lista de arquivos [{ nome, buffer }]', { casados: [], semPar: [], erros: [] });
    return alterar(jogoId, (cat, ctx) => {
      const indice = indiceDeNomesDeArquivo(cat.itens);
      const posPorId = new Map(cat.itens.map((it, i) => [it.id, i]));
      const ocupados = mapaDeArquivos(cat.itens);
      const recebidos = new Set();
      const casados = [];
      const semPar = [];
      const erros = [];
      const lista = arquivos.slice(0, TETOS.arquivosPorEnvio);
      if (arquivos.length > lista.length) erros.push({ arquivo: '', motivo: `só os primeiros ${TETOS.arquivosPorEnvio} arquivos de cada envio` });
      for (const a of lista) {
        const nome = ehObjeto(a) && typeof a.nome === 'string' ? a.nome.slice(0, 300) : '';
        if (!nome) { erros.push({ arquivo: '', motivo: 'arquivo sem nome' }); continue; }
        const { chave, tipo } = lerNomeDeArquivo(nome);
        let ids = (chave && indice.get(chave)) || [];
        if (ids.length > 1 && tipo) ids = ids.filter((id) => id.slice(0, id.indexOf(':')) === tipo);
        if (ids.length !== 1) { semPar.push(nome); continue; } // nenhum, ou mais de um (não chuta)
        const itemId = ids[0];
        if (recebidos.has(itemId)) { erros.push({ arquivo: nome, motivo: `outro arquivo deste envio já é a imagem de ${itemId}` }); continue; }
        let img;
        const ext = /\.([^.\\/]{1,10})$/.exec(nome);
        try { img = conferirImagem(a.buffer, ext ? ext[1] : null); } catch (e) {
          if (!(e instanceof ErroEntrada)) throw e;
          erros.push({ arquivo: nome, motivo: e.message });
          continue;
        }
        trocarImagem(jogoId, cat, posPorId.get(itemId), img, 'importada', ctx, ocupados);
        recebidos.add(itemId);
        casados.push({ arquivo: nome, itemId });
      }
      return { ok: true, casados, semPar, erros };
    });
  }

  // Para o servidor servir /pedidos-img/<jogo>/<arquivo>: só nome gerado aqui, dentro da
  // pasta do jogo, apontado por um item, arquivo comum (link simbólico não). Senão null.
  // O caminho REAL também precisa ficar na pasta do jogo dentro da pasta real das
  // imagens: a pasta do jogo trocada por um link (ou junção) para fora não serve
  // nada de fora; a pasta imagens/ inteira num outro disco, de propósito, continua valendo.
  function caminhoImagem(jogoId, arquivo) {
    if (!jogoIdValido(jogoId) || typeof arquivo !== 'string' || arquivo.length > 120 || !RE_ARQUIVO.test(arquivo)) return null;
    const r = obter(jogoId);
    if (!r.cat || !arquivosDe(r.cat).has(arquivo)) return null;
    const dir = path.resolve(pastaDoJogo(jogoId));
    const p = path.resolve(dir, arquivo);
    if (path.dirname(p) !== dir) return null;
    try {
      if (!fs.lstatSync(p).isFile()) return null;
      const real = fs.realpathSync(p);
      if (path.dirname(real) !== path.join(fs.realpathSync(pastaImagens), jogoId)) return null;
    } catch { return null; }
    return p;
  }

  // ── 🔎 Consultas ──
  function acharItem(jogoId, itemId) {
    const r = obter(jogoId);
    return (r.cat && porId(r.cat).get(itemId)) || null;
  }
  // Tabela do painel (50 por página): filtro por tipo e busca em nomes e apelidos
  function pagina(jogoId, opcoes) {
    const o = ehObjeto(opcoes) ? opcoes : {};
    const r = obter(jogoId);
    if (r.erro) return r.erro;
    let lista = r.cat.itens;
    if (typeof o.tipo === 'string' && o.tipo) lista = lista.filter((it) => it.tipo === o.tipo);
    const q = typeof o.busca === 'string' ? normalizar(o.busca.slice(0, 100)) : '';
    if (q) lista = lista.filter((it) => textoDeBusca(it).includes(q));
    const por = Math.min(200, Math.max(1, Math.floor(Number(o.porPagina)) || 50));
    const total = lista.length;
    const paginas = Math.max(1, Math.ceil(total / por));
    const atual = Math.min(paginas, Math.max(1, Math.floor(Number(o.pagina)) || 1));
    return { ok: true, jogo: jogoId, itens: lista.slice((atual - 1) * por, atual * por), total, pagina: atual, paginas, tipos: r.cat.tipos };
  }

  // Dados de uma fonte em jogo.fontes (ex.: 'site-oficial' → siteOficial: { lidoEm, paginas, idiomas, etags })
  function registrarFonte(jogoId, fonte, dados) {
    const chave = chaveDaFonte(fonte);
    if (!chave) return falha('fonte-invalida', 'nome de fonte inválido (a-z, 0-9 e -)');
    let limpo;
    try { limpo = dadoSimples(dados, 0); } catch (e) { return falha('dados-invalidos', e.message); }
    if (limpo === undefined) limpo = null;
    if (Buffer.byteLength(JSON.stringify(limpo)) > TETOS.fonteBytes) return falha('dados-grandes', 'os dados da fonte passam de 256 KB');
    return alterar(jogoId, (cat, ctx) => {
      const fontes = {};
      for (const [k, v] of Object.entries(cat.jogo.fontes || {})) if (!CHAVES_PERIGOSAS.has(k)) fontes[k] = v;
      fontes[chave] = limpo;
      cat.jogo = { ...cat.jogo, fontes };
      ctx.mudou = true;
      return { ok: true };
    });
  }

  limparRestos();

  // Nenhuma função derruba o servidor: erro inesperado vira { ok:false, erro:'erro-interno' }
  const api = {
    listar, carregar, criarJogo, renomearJogo, apagarJogo, recriarJogo,
    salvarTipo, apagarTipo, salvarItem, apagarItem, ensinarApelido, mesclar,
    exportar, importar, guardarImagem, ocultarImagem, apagarImagem, apagarImagens,
    importarPastaDeImagens, caminhoImagem, acharItem, pagina, registrarFonte,
  };
  const reservas = { listar: () => [], carregar: () => null, caminhoImagem: () => null, acharItem: () => null };
  for (const nome of Object.keys(api)) {
    const fn = api[nome];
    const reserva = reservas[nome];
    api[nome] = (...args) => {
      try {
        return fn(...args);
      } catch (err) {
        console.error(`  ⚠️ 🙋 Catálogo: erro inesperado em ${nome}:`, (err && err.stack) || err);
        return reserva ? reserva() : falha('erro-interno', `erro inesperado no catálogo (${(err && err.message) || err})`);
      }
    };
  }
  return api;
}

module.exports = {
  criarCatalogos,
  // auxiliares puros (o núcleo, o leitor e o servidor podem usar)
  slug, normalizar, nomeParaMostrar, tipoDaImagem, lerCsv, escreverCsv,
  IDIOMAS, RARIDADES, ORIGENS_IMAGEM, MODELOS, PAPEIS, TETOS, TIPOS_DBD, TIPOS_GENERICO, COLUNAS_CSV,
};
