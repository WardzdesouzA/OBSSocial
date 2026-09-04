// ✍️ v0.145 — a formatação do texto das mensagens, num lugar só.
//
// O WhatsApp escreve formatação com marcadores dentro do próprio texto
// (*negrito*, _itálico_, ~tachado~, `mono`), e o Telegram manda uma lista de
// trechos formatados ao lado do texto. Os dois chegam aqui e saem no mesmo
// formato: os «runs» que o painel e as telas já sabem desenhar, agora com
// marcas de estilo (b, i, s, mono, u).
//
// Nada aqui gera HTML: o desenho é feito com textContent nas telas, como
// sempre. O que viaja é só a marca de estilo.
'use strict';

// Os marcadores do WhatsApp e o estilo de cada um. A ordem importa: o
// ``` de três crases é procurado antes da crase solta.
const MARCADORES = [
  { abre: '```', fecha: '```', estilo: 'mono' },
  { abre: '`', fecha: '`', estilo: 'mono' },
  { abre: '*', fecha: '*', estilo: 'b' },
  { abre: '_', fecha: '_', estilo: 'i' },
  { abre: '~', fecha: '~', estilo: 's' },
];

// A regra do WhatsApp, que evita estragar texto comum (2*3=6, snake_case,
// 12/07): o marcador que ABRE não pode ser seguido de espaço, e o que FECHA
// não pode ser precedido de espaço. Além disso, o de abrir precisa vir no
// começo ou depois de um espaço/pontuação — senão `nome_do_arquivo_aqui`
// viraria itálico.
function podeAbrir(texto, i, marca) {
  if (texto.slice(i, i + marca.abre.length) !== marca.abre) return false;
  const antes = i === 0 ? '' : texto[i - 1];
  const depois = texto[i + marca.abre.length];
  if (depois === undefined || /\s/.test(depois)) return false;
  return antes === '' || /[\s(["'‘“]/.test(antes);
}

function acharFecho(texto, inicio, marca) {
  for (let j = inicio; j <= texto.length - marca.fecha.length; j++) {
    if (texto.slice(j, j + marca.fecha.length) !== marca.fecha) continue;
    const antes = texto[j - 1];
    if (antes === undefined || /\s/.test(antes)) continue;
    const depois = texto[j + marca.fecha.length];
    // fechar no fim, ou antes de espaço/pontuação — nunca no meio de palavra
    if (depois === undefined || /[\s)\].,;:!?"'’”]/.test(depois)) return j;
  }
  return -1;
}

// Quebra o texto em pedaços com estilo. `estilos` é o que já vale por fora
// (permite *negrito com _itálico_ dentro*).
function pedacos(texto, estilos, profundidade) {
  const saida = [];
  let solto = '';
  const despejar = () => { if (solto) { saida.push({ texto: solto, estilos }); solto = ''; } };
  for (let i = 0; i < texto.length;) {
    let casou = null;
    if (profundidade < 4) {
      for (const marca of MARCADORES) {
        if (estilos.includes(marca.estilo)) continue; // já está nesse estilo
        if (!podeAbrir(texto, i, marca)) continue;
        const fim = acharFecho(texto, i + marca.abre.length, marca);
        if (fim > i) { casou = { marca, fim }; break; }
      }
    }
    if (!casou) { solto += texto[i]; i += 1; continue; }
    despejar();
    const dentro = texto.slice(i + casou.marca.abre.length, casou.fim);
    // o monoespaçado é literal: nada de formatação dentro dele
    const proximos = estilos.concat(casou.marca.estilo);
    if (casou.marca.estilo === 'mono') saida.push({ texto: dentro, estilos: proximos });
    else saida.push(...pedacos(dentro, proximos, profundidade + 1));
    i = casou.fim + casou.marca.fecha.length;
  }
  despejar();
  return saida;
}

// 💬 O texto do WhatsApp (com os marcadores dele) vira runs com estilo.
// Texto sem marcador nenhum devolve um run só, igualzinho ao de antes.
function runsDoTexto(texto) {
  const inteiro = String(texto || '');
  if (!inteiro) return [{ type: 'text', text: '' }];
  const partes = pedacos(inteiro, [], 0);
  if (partes.length === 1 && !partes[0].estilos.length) return [{ type: 'text', text: inteiro }];
  return partes.map((p) => {
    const run = { type: 'text', text: p.texto };
    for (const e of p.estilos) run[e] = true;
    return run;
  });
}

// 📨 O Telegram manda o texto puro e uma lista de trechos formatados, por
// posição. Aqui os dois viram os mesmos runs — contando em pontos de código
// (o Telegram conta em UTF-16, que é como o JavaScript também conta).
const ESTILO_TELEGRAM = {
  bold: 'b', italic: 'i', underline: 'u', strikethrough: 's',
  code: 'mono', pre: 'mono',
};
function runsDeEntidades(texto, entidades) {
  const inteiro = String(texto || '');
  const lista = (Array.isArray(entidades) ? entidades : [])
    .filter((e) => ESTILO_TELEGRAM[e && e.type] && Number.isFinite(Number(e.offset)) && Number(e.length) > 0)
    .map((e) => ({ de: Number(e.offset), ate: Number(e.offset) + Number(e.length), estilo: ESTILO_TELEGRAM[e.type] }))
    .filter((e) => e.de >= 0 && e.ate <= inteiro.length);
  if (!lista.length) return [{ type: 'text', text: inteiro }];
  // Cada corte vira uma fronteira; entre duas fronteiras o estilo é constante
  const cortes = new Set([0, inteiro.length]);
  for (const e of lista) { cortes.add(e.de); cortes.add(e.ate); }
  const pontos = [...cortes].sort((a, b) => a - b);
  const runs = [];
  for (let k = 0; k < pontos.length - 1; k++) {
    const de = pontos[k];
    const ate = pontos[k + 1];
    if (ate <= de) continue;
    const run = { type: 'text', text: inteiro.slice(de, ate) };
    for (const e of lista) if (e.de <= de && e.ate >= ate) run[e.estilo] = true;
    runs.push(run);
  }
  return runs.length ? runs : [{ type: 'text', text: inteiro }];
}

// ✍️ v0.145: a resposta do apresentador vai escrita com os marcadores do
// WhatsApp (é o que a barra de formatação do painel insere). O WhatsApp
// entende esses marcadores sozinho; o Telegram não — lá é preciso mandar
// HTML e avisar. Esta função faz essa tradução, escapando tudo antes para
// que nada do que a pessoa escreveu vire marcação por acidente.
const TAG_TELEGRAM = { b: 'b', i: 'i', s: 's', u: 'u', mono: 'code' };
function paraHtmlTelegram(texto) {
  const escapar = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return runsDoTexto(texto).map((run) => {
    const tags = Object.keys(TAG_TELEGRAM).filter((k) => run[k] === true);
    let saida = escapar(run.text || '');
    for (const k of tags.reverse()) saida = `<${TAG_TELEGRAM[k]}>${saida}</${TAG_TELEGRAM[k]}>`;
    return saida;
  }).join('');
}

// Tem alguma marca de estilo? (o Telegram só ganha o parse_mode quando tem)
function temFormatacao(texto) {
  return runsDoTexto(texto).some((r) => r.b || r.i || r.s || r.u || r.mono);
}

module.exports = { runsDoTexto, runsDeEntidades, paraHtmlTelegram, temFormatacao };
