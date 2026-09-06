// ===========================================================================
// 🌤️ Clima (v0.167) — o tempo agora, de uma ou mais fontes, para o overlay
//
// O servidor busca as condições atuais de cada cidade cadastrada, de tempos
// em tempos (10 a 60 min), e manda para a tela um retrato ÚNICO, do mesmo
// jeito seja qual for a fonte: temperatura, sensação, umidade, vento, dia ou
// noite e uma «condição» de um vocabulário curto (sol, lua, parcial, nublado,
// nevoa, chuvisco, chuva, chuvaForte, trovoada, neve, granizo). É essa
// condição que vira o ícone animado.
//
// Fontes:
//   • open-meteo   — sem chave, sem cadastro (a de fábrica)
//   • met.no       — sem chave (o instituto norueguês; pede um User-Agent)
//   • openweathermap, weatherapi, accuweather, climatempo, wunderground —
//     com a chave que a pessoa cadastra em 🔌 Conexões
// A pessoa escolhe QUAIS fontes e em que ORDEM: a primeira que responder
// vale; se falhar, a próxima. As chaves nunca saem do servidor.
//
// Mora num arquivo à parte para ser testável sozinho: quem usa injeta o
// «buscarJson» (http com timeout) e, nos testes, respostas prontas.
// ===========================================================================
const https = require('https');
const http = require('http');

const UA = 'OBSSocial/clima (+https://github.com/WardzdesouzA/OBSSocial)';
const TEMPO_MS = 12000;
const MAX_CIDADES = 27; // cabem as 27 capitais de uma vez (cidades soltas)
const MIN_ATUALIZAR_MIN = 10;
const MAX_ATUALIZAR_MIN = 60;
const REPETE_FALHA_MS = 2 * 60 * 1000; // uma busca que falhou tenta de novo em 2 min
// 🗺️ v0.169: listas grandes (o Brasil inteiro, um estado) — o rodízio passa
// por milhares de municípios; buscar o tempo de todos a cada 10 min estouraria
// qualquer cota. Então só a cidade da vez e as próximas ficam buscadas (a
// «janela»), cada uma pouco antes de entrar na tela; o cache tem teto.
const JANELA_RODIZIO = 3;
const TETO_CACHE = 120;
const PREVISAO_MS = 30 * 60 * 1000; // a previsão dos próximos dias (cartão completo) vale meia hora
const PAUSA_FONTE_MS = 10 * 60 * 1000; // fonte com cota esgotada / chave recusada: 10 min sem insistir
const MAX_DIAS = 7;
const LISTA_MODOS = ['cidades', 'brasil', 'uf'];
const UFS_SIGLAS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

const FONTES = {
  'open-meteo':     { nome: 'Open-Meteo', chave: false, site: 'https://open-meteo.com' },
  'met.no':         { nome: 'MET Norway (yr.no)', chave: false, site: 'https://api.met.no' },
  'openweathermap': { nome: 'OpenWeatherMap', chave: true, site: 'https://openweathermap.org/api' },
  'weatherapi':     { nome: 'WeatherAPI', chave: true, site: 'https://www.weatherapi.com' },
  'accuweather':    { nome: 'AccuWeather', chave: true, site: 'https://developer.accuweather.com' },
  'climatempo':     { nome: 'Climatempo', chave: true, site: 'https://advisor.climatempo.com.br' },
  'wunderground':   { nome: 'Weather Underground (PWS)', chave: true, site: 'https://www.wunderground.com/member/api-keys' },
};
const FONTES_PADRAO = ['open-meteo', 'met.no'];
const CONDICOES = ['sol', 'lua', 'parcial', 'nublado', 'nevoa', 'chuvisco', 'chuva', 'chuvaForte', 'trovoada', 'neve', 'granizo'];

// As 27 capitais, para o «rodízio pelo Brasil» com um clique
const CAPITAIS_BR = [
  { nome: 'Rio Branco', uf: 'AC', lat: -9.9747, lon: -67.8100 },
  { nome: 'Maceió', uf: 'AL', lat: -9.6658, lon: -35.7353 },
  { nome: 'Macapá', uf: 'AP', lat: 0.0349, lon: -51.0694 },
  { nome: 'Manaus', uf: 'AM', lat: -3.1190, lon: -60.0217 },
  { nome: 'Salvador', uf: 'BA', lat: -12.9714, lon: -38.5124 },
  { nome: 'Fortaleza', uf: 'CE', lat: -3.7319, lon: -38.5267 },
  { nome: 'Brasília', uf: 'DF', lat: -15.7939, lon: -47.8828 },
  { nome: 'Vitória', uf: 'ES', lat: -20.3155, lon: -40.3128 },
  { nome: 'Goiânia', uf: 'GO', lat: -16.6869, lon: -49.2648 },
  { nome: 'São Luís', uf: 'MA', lat: -2.5297, lon: -44.3028 },
  { nome: 'Cuiabá', uf: 'MT', lat: -15.6014, lon: -56.0979 },
  { nome: 'Campo Grande', uf: 'MS', lat: -20.4697, lon: -54.6201 },
  { nome: 'Belo Horizonte', uf: 'MG', lat: -19.9167, lon: -43.9345 },
  { nome: 'Belém', uf: 'PA', lat: -1.4558, lon: -48.4902 },
  { nome: 'João Pessoa', uf: 'PB', lat: -7.1195, lon: -34.8450 },
  { nome: 'Curitiba', uf: 'PR', lat: -25.4284, lon: -49.2733 },
  { nome: 'Recife', uf: 'PE', lat: -8.0476, lon: -34.8770 },
  { nome: 'Teresina', uf: 'PI', lat: -5.0892, lon: -42.8019 },
  { nome: 'Rio de Janeiro', uf: 'RJ', lat: -22.9068, lon: -43.1729 },
  { nome: 'Natal', uf: 'RN', lat: -5.7945, lon: -35.2110 },
  { nome: 'Porto Alegre', uf: 'RS', lat: -30.0346, lon: -51.2177 },
  { nome: 'Porto Velho', uf: 'RO', lat: -8.7612, lon: -63.9004 },
  { nome: 'Boa Vista', uf: 'RR', lat: 2.8235, lon: -60.6758 },
  { nome: 'Florianópolis', uf: 'SC', lat: -27.5954, lon: -48.5480 },
  { nome: 'São Paulo', uf: 'SP', lat: -23.5505, lon: -46.6333 },
  { nome: 'Aracaju', uf: 'SE', lat: -10.9472, lon: -37.0731 },
  { nome: 'Palmas', uf: 'TO', lat: -10.2491, lon: -48.3243 },
];

// Descrição curta em português para cada condição (a fonte pode trazer a
// dela; quando não traz, vale esta)
const DESCRICAO = {
  sol: 'Céu limpo', lua: 'Céu limpo', parcial: 'Parcialmente nublado', nublado: 'Nublado',
  nevoa: 'Névoa', chuvisco: 'Chuvisco', chuva: 'Chuva', chuvaForte: 'Chuva forte',
  trovoada: 'Trovoada', neve: 'Neve', granizo: 'Granizo',
};

// ---------- http ----------
// GET que devolve JSON (ou texto), com timeout; segue até 3 redirecionamentos
function buscarJsonPadrao(url, { cabecalhos = {}, metodo = 'GET', corpo = null, saltos = 0 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch (e) { return reject(new Error('url inválida')); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return reject(new Error('url inválida'));
    const lib = u.protocol === 'https:' ? https : http;
    // prazo total, além do de inatividade: uma fonte que pinga um byte por
    // vez não segura a fila de atualização para sempre
    const prazo = setTimeout(() => req.destroy(new Error('a fonte demorou demais')), TEMPO_MS * 2);
    const req = lib.request(u, { method: metodo, timeout: TEMPO_MS, headers: { 'User-Agent': UA, Accept: 'application/json', ...cabecalhos } }, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location && saltos < 3) {
        res.resume();
        clearTimeout(prazo);
        let prox;
        try { prox = new URL(res.headers.location, u); } catch { return reject(new Error('redirecionamento inválido')); }
        // só http(s), nunca de https para http (a chave iria em claro) e nunca
        // para a própria máquina ou a rede local
        if ((prox.protocol !== 'https:' && prox.protocol !== 'http:') || (u.protocol === 'https:' && prox.protocol !== 'https:') || hostLocal(prox.hostname)) return reject(new Error('redirecionamento recusado'));
        return buscarJsonPadrao(prox.toString(), { cabecalhos, metodo, corpo, saltos: saltos + 1 }).then(resolve, reject);
      }
      res.on('close', () => clearTimeout(prazo));
      const partes = [];
      let tam = 0;
      res.on('data', (c) => { tam += c.length; if (tam <= 2 * 1024 * 1024) partes.push(c); else res.destroy(new Error('resposta grande demais')); });
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let json = null;
        try { json = JSON.parse(texto); } catch { /* não é json */ }
        resolve({ status, json, texto });
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('a fonte demorou demais')));
    req.on('error', (e) => { clearTimeout(prazo); reject(e); });
    if (corpo) req.write(corpo);
    req.end();
  });
}
// localhost, IP de loopback, rede privada, link-local ou CGNAT (só o
// literal: a fonte legítima nunca redireciona para um IP desses)
function hostLocal(h) {
  const host = String(h || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^(::1|::|0:0:0:0:0:0:0:1)$/.test(host) || /^(fe80|fc|fd)[0-9a-f]*:/i.test(host) || /^::ffff:/i.test(host)) return true;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// ---------- normalização ----------
// vazio, null e undefined são «não sei» — nunca 0° (Number(null) daria 0)
const num = (v) => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const arred = (v) => (v === null ? null : Math.round(v * 10) / 10);

function retrato({ temp, sensacao, umidade, vento, condicao, descricao, dia, fonte, atualizadoEm, extra }) {
  const c = CONDICOES.includes(condicao) ? condicao : null;
  // sol de noite é lua; lua de dia é sol
  const cond = c === 'sol' && dia === false ? 'lua' : c === 'lua' && dia === true ? 'sol' : c;
  return {
    temp: arred(num(temp)),
    sensacao: arred(num(sensacao)),
    umidade: num(umidade) === null ? null : Math.round(num(umidade)),
    vento: arred(num(vento)),
    condicao: cond,
    descricao: String(descricao || (cond ? DESCRICAO[cond] : '') || '').slice(0, 60),
    dia: dia === null || dia === undefined ? null : !!dia,
    fonte,
    atualizadoEm: atualizadoEm || new Date().toISOString(),
    ...(extra || {}),
  };
}

// WMO (Open-Meteo)
function condicaoWmo(codigo, dia) {
  const c = Number(codigo);
  if (c === 0 || c === 1) return dia === false ? 'lua' : 'sol';
  if (c === 2) return 'parcial';
  if (c === 3) return 'nublado';
  if (c === 45 || c === 48) return 'nevoa';
  if (c >= 51 && c <= 57) return 'chuvisco';
  if (c === 61 || c === 63 || c === 66 || c === 80 || c === 81) return 'chuva';
  if (c === 65 || c === 67 || c === 82) return 'chuvaForte';
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return 'neve';
  if (c === 95) return 'trovoada';
  if (c === 96 || c === 99) return 'granizo';
  return null;
}
// met.no symbol_code
function condicaoMetNo(simbolo) {
  const s = String(simbolo || '').toLowerCase();
  const noite = /_night|_polartwilight/.test(s);
  if (/thunder/.test(s)) return 'trovoada';
  if (/sleet|hail/.test(s)) return 'granizo';
  if (/snow/.test(s)) return 'neve';
  if (/heavyrain/.test(s)) return 'chuvaForte';
  if (/lightrain/.test(s)) return 'chuvisco';
  if (/rain/.test(s)) return 'chuva';
  if (/fog/.test(s)) return 'nevoa';
  if (/^cloudy/.test(s)) return 'nublado';
  if (/partlycloudy|fair/.test(s)) return 'parcial';
  if (/clearsky/.test(s)) return noite ? 'lua' : 'sol';
  return null;
}
// OpenWeatherMap (weather[0].id)
function condicaoOwm(id, dia) {
  const c = Number(id);
  if (c >= 200 && c < 300) return c === 202 || c === 212 || c === 221 ? 'granizo' : 'trovoada';
  if (c >= 300 && c < 400) return 'chuvisco';
  if (c >= 500 && c < 600) return c === 500 || c === 520 ? 'chuvisco' : c >= 502 && c !== 511 && c !== 520 && c !== 521 ? 'chuvaForte' : 'chuva';
  if (c >= 600 && c < 700) return c === 611 || c === 612 || c === 613 ? 'granizo' : 'neve';
  if (c >= 700 && c < 800) return 'nevoa';
  if (c === 800) return dia === false ? 'lua' : 'sol';
  if (c === 801 || c === 802) return 'parcial';
  if (c === 803 || c === 804) return 'nublado';
  return null;
}
// WeatherAPI (condition.code)
function condicaoWeatherApi(codigo, dia) {
  const c = Number(codigo);
  if (c === 1000) return dia === false ? 'lua' : 'sol';
  if (c === 1003) return 'parcial';
  if (c === 1006 || c === 1009) return 'nublado';
  if (c === 1030 || c === 1135 || c === 1147) return 'nevoa';
  if (c === 1087 || (c >= 1273 && c <= 1282)) return c >= 1279 ? 'granizo' : 'trovoada';
  if ([1150, 1153, 1168, 1171, 1063, 1180, 1183, 1240].includes(c)) return 'chuvisco';
  if ([1186, 1189, 1198, 1243].includes(c)) return 'chuva';
  if ([1192, 1195, 1201, 1246].includes(c)) return 'chuvaForte';
  if ([1069, 1072, 1204, 1207, 1237, 1249, 1252, 1261, 1264].includes(c)) return 'granizo';
  if ([1066, 1114, 1117, 1210, 1213, 1216, 1219, 1222, 1225, 1255, 1258].includes(c)) return 'neve';
  return null;
}
// AccuWeather (WeatherIcon 1–44)
function condicaoAccu(icone, dia) {
  const c = Number(icone);
  if ([1, 2, 30].includes(c)) return 'sol';
  if ([33, 34].includes(c)) return 'lua';
  if ([3, 4, 5, 35, 36, 37].includes(c)) return 'parcial';
  if ([6, 7, 8, 38].includes(c)) return 'nublado';
  if (c === 11) return 'nevoa';
  if ([12, 13, 14, 39, 40].includes(c)) return 'chuva';
  if ([15, 16, 17, 41, 42].includes(c)) return 'trovoada';
  if (c === 18) return 'chuvaForte';
  if ([19, 20, 21, 22, 23, 43, 44].includes(c)) return 'neve';
  if ([24, 25, 26, 29].includes(c)) return 'granizo';
  if (c === 31 || c === 32) return dia === false ? 'lua' : 'parcial';
  return null;
}
// Climatempo (icon «1» … «9», com «n» à noite, e o texto)
function condicaoClimatempo(icone, texto, dia) {
  const t = String(texto || '').toLowerCase();
  if (/trovoad|tempestade|raio/.test(t)) return 'trovoada';
  if (/granizo/.test(t)) return 'granizo';
  if (/neve/.test(t)) return 'neve';
  if (/chuva forte|pancadas fortes|chuvas intensas/.test(t)) return 'chuvaForte';
  if (/chuvisco|garoa/.test(t)) return 'chuvisco';
  if (/chuva|pancada/.test(t)) return 'chuva';
  if (/nevoeiro|neblina|névoa|nevoa/.test(t)) return 'nevoa';
  if (/encoberto|nublado/.test(t)) return /parcial|poucas nuvens|sol/.test(t) ? 'parcial' : 'nublado';
  if (/sol|limpo|claro/.test(t)) return /nuvens|parcial/.test(t) ? 'parcial' : (dia === false ? 'lua' : 'sol');
  const n = parseInt(String(icone || ''), 10);
  if (n === 1) return dia === false ? 'lua' : 'sol';
  if (n === 2 || n === 3) return 'parcial';
  if (n === 4) return 'chuva';
  if (n === 5 || n === 8) return 'trovoada';
  if (n === 6) return 'chuvaForte';
  if (n === 7) return 'nevoa';
  if (n === 9) return 'nublado';
  return null;
}

// ---------- as fontes ----------
// Cada uma recebe { cidade: { nome, uf, lat, lon }, chave, buscarJson } e
// devolve um retrato (ou lança). Quem chama já garantiu lat/lon.
const FETCHERS = {
  async 'open-meteo'({ cidade, buscarJson }) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${cidade.lat}&longitude=${cidade.lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,weather_code,wind_speed_10m&timezone=auto`;
    const r = await buscarJson(url);
    const c = r.json && r.json.current;
    if (r.status !== 200 || !c) throw new Error('Open-Meteo: HTTP ' + r.status);
    const dia = c.is_day === 1;
    return retrato({ temp: c.temperature_2m, sensacao: c.apparent_temperature, umidade: c.relative_humidity_2m, vento: c.wind_speed_10m, condicao: condicaoWmo(c.weather_code, dia), dia, fonte: 'open-meteo' });
  },
  async 'met.no'({ cidade, buscarJson }) {
    const url = `https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${Number(cidade.lat).toFixed(4)}&lon=${Number(cidade.lon).toFixed(4)}`;
    const r = await buscarJson(url);
    const serie = r.json && r.json.properties && Array.isArray(r.json.properties.timeseries) ? r.json.properties.timeseries[0] : null;
    if (r.status !== 200 || !serie) throw new Error('met.no: HTTP ' + r.status);
    const inst = (serie.data && serie.data.instant && serie.data.instant.details) || {};
    const prox = (serie.data && serie.data.next_1_hours && serie.data.next_1_hours.summary && serie.data.next_1_hours.summary.symbol_code)
      || (serie.data && serie.data.next_6_hours && serie.data.next_6_hours.summary && serie.data.next_6_hours.summary.symbol_code) || '';
    const dia = /_night/.test(prox) ? false : /_day/.test(prox) ? true : null;
    return retrato({ temp: inst.air_temperature, sensacao: null, umidade: inst.relative_humidity, vento: num(inst.wind_speed) === null ? null : inst.wind_speed * 3.6, condicao: condicaoMetNo(prox), dia, fonte: 'met.no' });
  },
  async openweathermap({ cidade, chave, buscarJson }) {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${cidade.lat}&lon=${cidade.lon}&appid=${encodeURIComponent(chave)}&units=metric&lang=pt_br`;
    const r = await buscarJson(url);
    const j = r.json;
    if (r.status === 401) throw new Error('OpenWeatherMap: chave recusada');
    if (r.status !== 200 || !j || !j.main) throw new Error('OpenWeatherMap: HTTP ' + r.status);
    const w = Array.isArray(j.weather) && j.weather[0] ? j.weather[0] : {};
    const dia = String(w.icon || '').endsWith('n') ? false : String(w.icon || '').endsWith('d') ? true : null;
    return retrato({ temp: j.main.temp, sensacao: j.main.feels_like, umidade: j.main.humidity, vento: j.wind && num(j.wind.speed) !== null ? j.wind.speed * 3.6 : null, condicao: condicaoOwm(w.id, dia), descricao: w.description, dia, fonte: 'openweathermap' });
  },
  async weatherapi({ cidade, chave, buscarJson }) {
    const url = `https://api.weatherapi.com/v1/current.json?key=${encodeURIComponent(chave)}&q=${cidade.lat},${cidade.lon}&lang=pt`;
    const r = await buscarJson(url);
    const c = r.json && r.json.current;
    if (r.status === 401 || r.status === 403) throw new Error('WeatherAPI: chave recusada');
    if (r.status !== 200 || !c) throw new Error('WeatherAPI: HTTP ' + r.status);
    const dia = c.is_day === 1;
    return retrato({ temp: c.temp_c, sensacao: c.feelslike_c, umidade: c.humidity, vento: c.wind_kph, condicao: condicaoWeatherApi(c.condition && c.condition.code, dia), descricao: c.condition && c.condition.text, dia, fonte: 'weatherapi' });
  },
  async accuweather({ cidade, chave, buscarJson, memoria }) {
    // duas chamadas: a chave da localidade (guardada por cidade) e as condições
    const k = encodeURIComponent(chave);
    const loc = await accuLocalidade({ cidade, chave, buscarJson, memoria });
    const r = await buscarJson(`https://dataservice.accuweather.com/currentconditions/v1/${encodeURIComponent(loc)}?apikey=${k}&language=pt-br&details=true`);
    const c = Array.isArray(r.json) ? r.json[0] : null;
    if (r.status === 401) throw new Error('AccuWeather: chave recusada');
    if (r.status === 503 || r.status === 429) throw new Error('AccuWeather: cota do dia esgotada');
    if (r.status !== 200 || !c) throw new Error('AccuWeather: HTTP ' + r.status);
    const m = (o) => (o && o.Metric ? o.Metric.Value : null);
    const dia = c.IsDayTime === true ? true : c.IsDayTime === false ? false : null;
    return retrato({ temp: m(c.Temperature), sensacao: m(c.RealFeelTemperature), umidade: c.RelativeHumidity, vento: c.Wind && m(c.Wind.Speed), condicao: condicaoAccu(c.WeatherIcon, dia), descricao: c.WeatherText, dia, fonte: 'accuweather' });
  },
  async climatempo({ cidade, chave, buscarJson, memoria }) {
    // três passos na primeira vez: id da cidade, registrar o id no token, e
    // então o tempo atual (o Advisor só responde para cidades registradas)
    const k = encodeURIComponent(chave);
    const base = 'https://apiadvisor.climatempo.com.br'; // o token vai na URL: só por TLS
    const id = await climatempoCidadeId({ cidade, chave, buscarJson, memoria });
    const r = await buscarJson(`${base}/api/v1/weather/locale/${encodeURIComponent(id)}/current?token=${k}`);
    const d = r.json && r.json.data;
    if (r.status === 401 || r.status === 403) throw new Error('Climatempo: token recusado');
    if (r.status !== 200 || !d) throw new Error('Climatempo: HTTP ' + r.status);
    const dia = /n$/i.test(String(d.icon || '')) ? false : d.icon ? true : null;
    return retrato({ temp: d.temperature, sensacao: d.sensation, umidade: d.humidity, vento: d.wind_velocity, condicao: condicaoClimatempo(d.icon, d.condition, dia), descricao: d.condition, dia, fonte: 'climatempo' });
  },
  async wunderground({ cidade, chave, buscarJson }) {
    // a API pública acabou; sobrou a das estações pessoais (PWS) — a chave
    // vem com um id de estação: «CHAVE@IDDAESTACAO». Ela não diz a condição
    // do céu: deduzimos chuva pela taxa de precipitação e o resto fica «sol/lua»
    const [apiKey, estacao] = String(chave).split('@');
    if (!estacao) throw new Error('Weather Underground: informe CHAVE@ESTACAO (ex.: abc123@IRIODEJA12)');
    const r = await buscarJson(`https://api.weather.com/v2/pws/observations/current?stationId=${encodeURIComponent(estacao)}&format=json&units=m&apiKey=${encodeURIComponent(apiKey)}`);
    const o = r.json && Array.isArray(r.json.observations) ? r.json.observations[0] : null;
    if (r.status === 401 || r.status === 403) throw new Error('Weather Underground: chave recusada');
    if (r.status !== 200 || !o) throw new Error('Weather Underground: HTTP ' + r.status);
    const m = o.metric || {};
    const chovendo = num(m.precipRate) > 0;
    const dia = num(o.solarRadiation) !== null ? o.solarRadiation > 5 : null;
    return retrato({ temp: m.temp, sensacao: m.heatIndex !== undefined && num(m.heatIndex) !== null && m.temp >= 24 ? m.heatIndex : m.windChill, umidade: o.humidity, vento: m.windSpeed, condicao: chovendo ? 'chuva' : dia === false ? 'lua' : 'sol', dia, fonte: 'wunderground' });
  },
};

// ---------- 🗂️ v0.169: a previsão (cartão completo) ----------
// Os próximos dias (até 7), as próximas horas (até 24) e uns extras do
// momento (pressão, UV, nuvens, visibilidade, orvalho, nascer e pôr do sol),
// num formato único seja qual for a fonte. O que a fonte não dá fica null.
const hhmm = (v) => { const m = /(\d{1,2}):(\d{2})/.exec(String(v || '')); return m ? m[1].padStart(2, '0') + ':' + m[2] : null; };
// «06:12 AM» / «05:48 PM» (WeatherAPI) → 06:12 / 17:48
function hora12para24(v) {
  const m = /(\d{1,2}):(\d{2})\s*([AaPp][Mm])/.exec(String(v || ''));
  if (!m) return hhmm(v);
  let h = Number(m[1]) % 12;
  if (/p/i.test(m[3])) h += 12;
  return String(h).padStart(2, '0') + ':' + m[2];
}
// O fuso de uma cidade brasileira pela UF (a longitude erraria 1 h no litoral
// do Nordeste: Recife a −34,9° cairia em UTC−2). Fora do Brasil, só o tz.
const FUSO_UF = { AC: 'America/Rio_Branco', AM: 'America/Manaus', RR: 'America/Boa_Vista', RO: 'America/Porto_Velho', MT: 'America/Cuiaba', MS: 'America/Campo_Grande' };
function fusoDaCidade(cidade) {
  if (!cidade) return '';
  if (cidade.tz) return cidade.tz;
  if (!cidade.pais || cidade.pais === 'BR') return FUSO_UF[String(cidade.uf || '').toUpperCase()] || 'America/Sao_Paulo';
  return '';
}
// hora local de um instante numa cidade: pelo fuso quando há; senão pela longitude
function horaLocal(epochMs, cidade) {
  const d = new Date(epochMs);
  const tz = fusoDaCidade(cidade);
  if (tz) {
    try {
      const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
      const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
      return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
    } catch { /* fuso desconhecido: cai na longitude */ }
  }
  const off = Math.round((Number(cidade && cidade.lon) || 0) / 15);
  return new Date(epochMs + off * 3600 * 1000).toISOString().slice(0, 16);
}
const PIOR_CONDICAO = ['trovoada', 'granizo', 'chuvaForte', 'chuva', 'neve', 'chuvisco', 'nevoa', 'nublado', 'parcial', 'sol', 'lua'];
// Fontes que só dão hora a hora (MET Norway, OpenWeatherMap): os dias saem
// das horas — máxima, mínima, a pior condição do dia, a maior chance de chuva
// e a soma da precipitação
function diasDeHoras(itens) {
  const porDia = new Map();
  for (const h of itens) { const k = String(h.hora).slice(0, 10); if (!porDia.has(k)) porDia.set(k, []); porDia.get(k).push(h); }
  const dias = [];
  for (const [data, lista] of porDia) {
    const temps = lista.map((h) => num(h.temp)).filter((v) => v !== null);
    let cond = null;
    for (const h of lista) { const c = h.condicao === 'lua' ? 'sol' : h.condicao; if (c && (cond === null || PIOR_CONDICAO.indexOf(c) < PIOR_CONDICAO.indexOf(cond))) cond = c; }
    const pcts = lista.map((h) => num(h.chuvaPct)).filter((v) => v !== null);
    const mms = lista.map((h) => num(h.chuvaMm)).filter((v) => v !== null);
    const ventos = lista.map((h) => num(h.vento)).filter((v) => v !== null);
    dias.push({
      data, condicao: cond,
      tmax: temps.length ? Math.max(...temps) : null, tmin: temps.length ? Math.min(...temps) : null,
      chuvaPct: pcts.length ? Math.max(...pcts) : null, chuvaMm: mms.length ? mms.reduce((a, b) => a + b, 0) : null,
      ventoMax: ventos.length ? Math.max(...ventos) : null,
    });
  }
  return dias;
}
function previsao({ dias, horas, extras, fonte, atualizadoEm }) {
  const pct = (v) => { const n = num(v); return n === null ? null : Math.max(0, Math.min(100, Math.round(n))); };
  const cond = (c) => (CONDICOES.includes(c) ? c : null);
  const ds = (Array.isArray(dias) ? dias : []).filter((d) => d && /^\d{4}-\d{2}-\d{2}/.test(String(d.data || ''))).slice(0, MAX_DIAS).map((d) => {
    const c = cond(d.condicao) === 'lua' ? 'sol' : cond(d.condicao); // um dia inteiro não é «lua»
    return {
      data: String(d.data).slice(0, 10), condicao: c, descricao: String(d.descricao || (c ? DESCRICAO[c] : '') || '').slice(0, 60),
      tmax: arred(num(d.tmax)), tmin: arred(num(d.tmin)), chuvaPct: pct(d.chuvaPct), chuvaMm: arred(num(d.chuvaMm)),
      ventoMax: arred(num(d.ventoMax)), uv: arred(num(d.uv)), nascer: hhmm(d.nascer), por: hhmm(d.por),
    };
  });
  const hs = (Array.isArray(horas) ? horas : []).filter((h) => h && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(h.hora || ''))).slice(0, 24)
    .map((h) => ({ hora: String(h.hora).slice(0, 16), temp: arred(num(h.temp)), condicao: cond(h.condicao), chuvaPct: pct(h.chuvaPct) }));
  const e = extras || {};
  return {
    fonte, atualizadoEm: atualizadoEm || new Date().toISOString(), dias: ds, horas: hs,
    extras: {
      pressao: arred(num(e.pressao)), uv: arred(num(e.uv)), nuvens: pct(e.nuvens), visibilidade: arred(num(e.visibilidade)),
      orvalho: arred(num(e.orvalho)), precipitacao: arred(num(e.precipitacao)), nascer: hhmm(e.nascer), por: hhmm(e.por),
    },
  };
}
// a chave da localidade da AccuWeather e o id de cidade do Climatempo ficam
// guardados por cidade (memoria) — as duas buscas (tempo agora e previsão) partilham
async function accuLocalidade({ cidade, chave, buscarJson, memoria }) {
  const k = encodeURIComponent(chave);
  let loc = memoria && memoria.accuLocal;
  if (loc) return loc;
  const r1 = await buscarJson(`https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${k}&q=${cidade.lat},${cidade.lon}&language=pt-br`);
  if (r1.status === 401) throw new Error('AccuWeather: chave recusada');
  if (r1.status === 503 || r1.status === 429) throw new Error('AccuWeather: cota do dia esgotada');
  if (r1.status !== 200 || !r1.json || !r1.json.Key) throw new Error('AccuWeather: localidade não achada (HTTP ' + r1.status + ')');
  loc = String(r1.json.Key);
  if (memoria) memoria.accuLocal = loc;
  return loc;
}
async function climatempoCidadeId({ cidade, chave, buscarJson, memoria }) {
  const k = encodeURIComponent(chave);
  const base = 'https://apiadvisor.climatempo.com.br';
  let id = memoria && memoria.climatempoId;
  if (id) return id;
  const r1 = await buscarJson(`${base}/api/v1/locale/city?name=${encodeURIComponent(cidade.nome)}${cidade.uf ? '&state=' + encodeURIComponent(cidade.uf) : ''}&token=${k}`);
  if (r1.status === 401 || r1.status === 403) throw new Error('Climatempo: token recusado');
  const lista = Array.isArray(r1.json) ? r1.json : [];
  if (!lista.length || !lista[0].id) throw new Error('Climatempo: cidade não achada');
  id = String(lista[0].id);
  await buscarJson(`${base}/api-manager/user-token/${k}/locales`, { metodo: 'PUT', cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' }, corpo: 'localeId[]=' + encodeURIComponent(id) });
  if (memoria) memoria.climatempoId = id;
  return id;
}
const PREVISORES = {
  async 'open-meteo'({ cidade, buscarJson }) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${cidade.lat}&longitude=${cidade.lon}`
      + '&current=temperature_2m,is_day,weather_code,surface_pressure,cloud_cover,precipitation,uv_index'
      + '&hourly=temperature_2m,weather_code,precipitation_probability,is_day'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,sunrise,sunset,uv_index_max'
      + `&timezone=auto&forecast_days=${MAX_DIAS}`;
    const r = await buscarJson(url);
    const j = r.json;
    if (r.status !== 200 || !j || !j.daily || !Array.isArray(j.daily.time)) throw new Error('Open-Meteo: HTTP ' + r.status);
    const D = j.daily, H = j.hourly || {}, c = j.current || {};
    const col = (o, k, i) => (Array.isArray(o[k]) ? o[k][i] : null);
    const dias = D.time.map((t, i) => ({
      data: t, condicao: condicaoWmo(col(D, 'weather_code', i), true), tmax: col(D, 'temperature_2m_max', i), tmin: col(D, 'temperature_2m_min', i),
      chuvaPct: col(D, 'precipitation_probability_max', i), chuvaMm: col(D, 'precipitation_sum', i), ventoMax: col(D, 'wind_speed_10m_max', i),
      uv: col(D, 'uv_index_max', i), nascer: String(col(D, 'sunrise', i) || '').slice(11, 16), por: String(col(D, 'sunset', i) || '').slice(11, 16),
    }));
    const agora = String(c.time || '').slice(0, 13);
    const horas = (Array.isArray(H.time) ? H.time : []).map((t, i) => ({ hora: t, temp: col(H, 'temperature_2m', i), condicao: condicaoWmo(col(H, 'weather_code', i), col(H, 'is_day', i) !== 0), chuvaPct: col(H, 'precipitation_probability', i) }))
      .filter((h) => !agora || String(h.hora).slice(0, 13) >= agora);
    return previsao({ dias, horas, fonte: 'open-meteo', extras: { pressao: c.surface_pressure, uv: c.uv_index, nuvens: c.cloud_cover, precipitacao: c.precipitation, nascer: dias[0] && dias[0].nascer, por: dias[0] && dias[0].por } });
  },
  async 'met.no'({ cidade, buscarJson }) {
    const r = await buscarJson(`https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${Number(cidade.lat).toFixed(4)}&lon=${Number(cidade.lon).toFixed(4)}`);
    const serie = r.json && r.json.properties && Array.isArray(r.json.properties.timeseries) ? r.json.properties.timeseries : null;
    if (r.status !== 200 || !serie || !serie.length) throw new Error('met.no: HTTP ' + r.status);
    const itens = [];
    for (const s of serie) {
      const em = Date.parse(s.time);
      if (!Number.isFinite(em) || !s.data) continue;
      const inst = (s.data.instant && s.data.instant.details) || {};
      const n1 = s.data.next_1_hours, n6 = s.data.next_6_hours;
      const sim = (n1 && n1.summary && n1.summary.symbol_code) || (n6 && n6.summary && n6.summary.symbol_code) || '';
      const det = (n1 && n1.details) || (n6 && n6.details) || {};
      itens.push({
        hora: horaLocal(em, cidade), temp: inst.air_temperature, condicao: condicaoMetNo(sim), horaCheia: !!n1,
        chuvaPct: det.probability_of_precipitation, chuvaMm: det.precipitation_amount, vento: num(inst.wind_speed) === null ? null : inst.wind_speed * 3.6,
        pressao: inst.air_pressure_at_sea_level, nuvens: inst.cloud_area_fraction, orvalho: inst.dew_point_temperature, uv: inst.ultraviolet_index_clear_sky,
      });
    }
    const p = itens[0] || {};
    return previsao({ dias: diasDeHoras(itens), horas: itens.filter((h) => h.horaCheia), fonte: 'met.no', extras: { pressao: p.pressao, nuvens: p.nuvens, orvalho: p.orvalho, uv: p.uv } });
  },
  async openweathermap({ cidade, chave, buscarJson }) {
    const r = await buscarJson(`https://api.openweathermap.org/data/2.5/forecast?lat=${cidade.lat}&lon=${cidade.lon}&appid=${encodeURIComponent(chave)}&units=metric&lang=pt_br`);
    const j = r.json;
    if (r.status === 401) throw new Error('OpenWeatherMap: chave recusada');
    if (r.status !== 200 || !j || !Array.isArray(j.list)) throw new Error('OpenWeatherMap: HTTP ' + r.status);
    const tz = num(j.city && j.city.timezone) || 0;
    const local = (dt) => new Date((Number(dt) + tz) * 1000).toISOString().slice(0, 16);
    const itens = j.list.filter((x) => x && x.main).map((x) => {
      const w = Array.isArray(x.weather) && x.weather[0] ? x.weather[0] : {};
      const dia = String(w.icon || '').endsWith('n') ? false : String(w.icon || '').endsWith('d') ? true : null;
      return { hora: local(x.dt), temp: x.main.temp, condicao: condicaoOwm(w.id, dia), chuvaPct: num(x.pop) === null ? null : x.pop * 100, chuvaMm: x.rain && num(x.rain['3h']) !== null ? x.rain['3h'] : (x.snow && num(x.snow['3h']) !== null ? x.snow['3h'] : 0), vento: x.wind && num(x.wind.speed) !== null ? x.wind.speed * 3.6 : null, pressao: x.main.pressure, nuvens: x.clouds && x.clouds.all, visibilidade: num(x.visibility) === null ? null : x.visibility / 1000 };
    });
    const p = itens[0] || {};
    const c = j.city || {};
    return previsao({ dias: diasDeHoras(itens), horas: itens.slice(0, 8), fonte: 'openweathermap', extras: { pressao: p.pressao, nuvens: p.nuvens, visibilidade: p.visibilidade, nascer: num(c.sunrise) === null ? null : local(c.sunrise).slice(11, 16), por: num(c.sunset) === null ? null : local(c.sunset).slice(11, 16) } });
  },
  async weatherapi({ cidade, chave, buscarJson }) {
    const r = await buscarJson(`https://api.weatherapi.com/v1/forecast.json?key=${encodeURIComponent(chave)}&q=${cidade.lat},${cidade.lon}&days=${MAX_DIAS}&lang=pt&aqi=no&alerts=no`);
    const j = r.json;
    if (r.status === 401 || r.status === 403) throw new Error('WeatherAPI: chave recusada');
    const fd = j && j.forecast && Array.isArray(j.forecast.forecastday) ? j.forecast.forecastday : null;
    if (r.status !== 200 || !fd) throw new Error('WeatherAPI: HTTP ' + r.status);
    const agora = num(j.location && j.location.localtime_epoch) || 0;
    const dias = fd.map((d) => { const dd = d.day || {}, a = d.astro || {}; return { data: d.date, condicao: condicaoWeatherApi(dd.condition && dd.condition.code, true), descricao: dd.condition && dd.condition.text, tmax: dd.maxtemp_c, tmin: dd.mintemp_c, chuvaPct: dd.daily_chance_of_rain, chuvaMm: dd.totalprecip_mm, ventoMax: dd.maxwind_kph, uv: dd.uv, nascer: hora12para24(a.sunrise), por: hora12para24(a.sunset) }; });
    const horas = [];
    for (const d of fd) for (const h of Array.isArray(d.hour) ? d.hour : []) {
      if (agora && num(h.time_epoch) !== null && h.time_epoch < agora - 3600) continue;
      horas.push({ hora: String(h.time || '').replace(' ', 'T'), temp: h.temp_c, condicao: condicaoWeatherApi(h.condition && h.condition.code, h.is_day !== 0), chuvaPct: h.chance_of_rain });
    }
    const c = j.current || {};
    return previsao({ dias, horas, fonte: 'weatherapi', extras: { pressao: c.pressure_mb, uv: c.uv, nuvens: c.cloud, visibilidade: c.vis_km, orvalho: c.dewpoint_c, precipitacao: c.precip_mm, nascer: dias[0] && dias[0].nascer, por: dias[0] && dias[0].por } });
  },
  async accuweather({ cidade, chave, buscarJson, memoria }) {
    const k = encodeURIComponent(chave);
    const loc = encodeURIComponent(await accuLocalidade({ cidade, chave, buscarJson, memoria }));
    const r = await buscarJson(`https://dataservice.accuweather.com/forecasts/v1/daily/5day/${loc}?apikey=${k}&language=pt-br&details=true&metric=true`);
    if (r.status === 401) throw new Error('AccuWeather: chave recusada');
    if (r.status === 503 || r.status === 429) throw new Error('AccuWeather: cota do dia esgotada');
    const df = r.json && Array.isArray(r.json.DailyForecasts) ? r.json.DailyForecasts : null;
    if (r.status !== 200 || !df) throw new Error('AccuWeather: HTTP ' + r.status);
    const m = (o) => (o && o.Value !== undefined ? o.Value : (o && o.Metric ? o.Metric.Value : null));
    const dias = df.map((d) => {
      const dd = d.Day || {}, uv = Array.isArray(d.AirAndPollen) ? d.AirAndPollen.find((x) => x && x.Name === 'UVIndex') : null;
      return { data: String(d.Date || '').slice(0, 10), condicao: condicaoAccu(dd.Icon, true), descricao: dd.IconPhrase, tmax: d.Temperature && m(d.Temperature.Maximum), tmin: d.Temperature && m(d.Temperature.Minimum), chuvaPct: dd.PrecipitationProbability, chuvaMm: m(dd.TotalLiquid), ventoMax: dd.Wind && m(dd.Wind.Speed), uv: uv ? uv.Value : null, nascer: String(d.Sun && d.Sun.Rise || '').slice(11, 16), por: String(d.Sun && d.Sun.Set || '').slice(11, 16) };
    });
    let horas = [];
    try {
      const r2 = await buscarJson(`https://dataservice.accuweather.com/forecasts/v1/hourly/12hour/${loc}?apikey=${k}&language=pt-br&metric=true`);
      if (r2.status === 200 && Array.isArray(r2.json)) horas = r2.json.map((h) => ({ hora: String(h.DateTime || '').slice(0, 16), temp: m(h.Temperature), condicao: condicaoAccu(h.WeatherIcon, h.IsDaylight !== false), chuvaPct: h.PrecipitationProbability }));
    } catch { /* as horas são um extra: sem elas o cartão segue com os dias */ }
    return previsao({ dias, horas, fonte: 'accuweather', extras: { uv: dias[0] && dias[0].uv, nascer: dias[0] && dias[0].nascer, por: dias[0] && dias[0].por } });
  },
  async climatempo({ cidade, chave, buscarJson, memoria }) {
    const k = encodeURIComponent(chave);
    const base = 'https://apiadvisor.climatempo.com.br';
    const id = encodeURIComponent(await climatempoCidadeId({ cidade, chave, buscarJson, memoria }));
    const r = await buscarJson(`${base}/api/v1/forecast/locale/${id}/days/15?token=${k}`);
    if (r.status === 401 || r.status === 403) throw new Error('Climatempo: token recusado');
    const dd = r.json && Array.isArray(r.json.data) ? r.json.data : null;
    if (r.status !== 200 || !dd) throw new Error('Climatempo: HTTP ' + r.status);
    const dias = dd.map((d) => {
      const ti = d.text_icon || {}, ic = ti.icon || {}, tx = ti.text || {};
      const texto = (tx.phrase && tx.phrase.reduced) || tx.pt || '';
      return { data: String(d.date || '').slice(0, 10), condicao: condicaoClimatempo(ic.day, texto, true), descricao: texto, tmax: d.temperature && d.temperature.max, tmin: d.temperature && d.temperature.min, chuvaPct: d.rain && d.rain.probability, chuvaMm: d.rain && d.rain.precipitation, ventoMax: d.wind && (d.wind.velocity_max !== undefined ? d.wind.velocity_max : d.wind.velocity_avg), uv: d.uv && d.uv.max, nascer: d.sun && d.sun.sunrise, por: d.sun && d.sun.sunset };
    });
    let horas = [];
    try {
      const r2 = await buscarJson(`${base}/api/v1/forecast/locale/${id}/hours/72?token=${k}`);
      const hh = r2.status === 200 && r2.json && Array.isArray(r2.json.data) ? r2.json.data : [];
      horas = hh.map((h) => { const ti = h.text_icon || {}; const chuva = h.rain && num(h.rain.precipitation); return { hora: String(h.date || '').replace(' ', 'T').slice(0, 16), temp: h.temperature && (h.temperature.temperature !== undefined ? h.temperature.temperature : h.temperature), condicao: ti.icon ? condicaoClimatempo(ti.icon.day || ti.icon, (ti.text && (ti.text.pt || (ti.text.phrase && ti.text.phrase.reduced))) || '', true) : (chuva > 0 ? 'chuva' : null), chuvaPct: h.rain && h.rain.probability }; });
    } catch { /* idem: as horas são um extra */ }
    return previsao({ dias, horas, fonte: 'climatempo', extras: { uv: dias[0] && dias[0].uv, nascer: dias[0] && dias[0].nascer, por: dias[0] && dias[0].por } });
  },
  // Weather Underground (PWS) só dá a observação da estação: sem previsão
};

// ---------- geocodificação (Open-Meteo, sem chave) ----------
async function procurarCidade(nome, buscarJson = buscarJsonPadrao, pais = 'BR') {
  const q = String(nome || '').trim().slice(0, 80);
  if (!q) return [];
  const r = await buscarJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=pt${pais ? '&countryCode=' + encodeURIComponent(pais) : ''}`);
  const lista = r.json && Array.isArray(r.json.results) ? r.json.results : [];
  return lista.filter((c) => num(c.latitude) !== null && num(c.longitude) !== null).map((c) => ({
    nome: String(c.name || '').slice(0, 60),
    uf: siglaUf(c.admin1) || String(c.admin1 || '').slice(0, 30),
    pais: String(c.country_code || '').toUpperCase(),
    lat: Math.round(c.latitude * 10000) / 10000,
    lon: Math.round(c.longitude * 10000) / 10000,
    tz: String(c.timezone || ''),
  }));
}
const UFS = { Acre: 'AC', Alagoas: 'AL', Amapá: 'AP', Amazonas: 'AM', Bahia: 'BA', Ceará: 'CE', 'Distrito Federal': 'DF', 'Espírito Santo': 'ES', Goiás: 'GO', Maranhão: 'MA', 'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', Pará: 'PA', Paraíba: 'PB', Paraná: 'PR', Pernambuco: 'PE', Piauí: 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN', 'Rio Grande do Sul': 'RS', Rondônia: 'RO', Roraima: 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP', Sergipe: 'SE', Tocantins: 'TO' };
function siglaUf(nome) { return UFS[String(nome || '')] || null; }

// ---------- validação do que vem das configurações ----------
function sanitizeCidade(c) {
  if (!c || typeof c !== 'object') return null;
  const lat = num(c.lat), lon = num(c.lon);
  if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const nome = String(c.nome || '').trim().slice(0, 60);
  if (!nome) return null;
  // o id é estável pelas coordenadas; um id vindo de fora só vale se tiver a
  // cara certa (e nunca um nome de propriedade do Object, como __proto__)
  const idBruto = String(c.id || '');
  return {
    id: /^[a-z0-9_-]{1,40}$/i.test(idBruto) && !/^(__proto__|constructor|prototype)$/i.test(idBruto) ? idBruto : 'c' + Math.abs(Math.round(lat * 1000) * 100003 + Math.round(lon * 1000)).toString(36),
    nome,
    uf: String(c.uf || '').trim().slice(0, 30),
    pais: String(c.pais || 'BR').trim().toUpperCase().slice(0, 2),
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
    // v0.169: o fuso (vem da geocodificação) — para as fontes que só dão a
    // hora em UTC; sem ele, vale a longitude (≈ 1 h a cada 15°)
    tz: /^[A-Za-z_]+\/[A-Za-z0-9_+\-]+(\/[A-Za-z0-9_+\-]+)?$/.test(String(c.tz || '')) ? String(c.tz).slice(0, 40) : '',
  };
}
function sanitizeClima(c, padrao) {
  const s = { ...padrao, ...((c && typeof c === 'object') ? c : {}) };
  const fontes = Array.isArray(s.fontes) ? s.fontes.map(String).filter((f, i, a) => FONTES[f] && a.indexOf(f) === i) : [];
  const cidades = [];
  for (const raw of Array.isArray(s.cidades) ? s.cidades : []) {
    const c2 = sanitizeCidade(raw);
    if (c2 && !cidades.some((x) => x.id === c2.id)) cidades.push(c2);
    if (cidades.length >= MAX_CIDADES) break;
  }
  // null, vazio e não-número caem no padrão (não no mínimo)
  const inteiro = (v, min, max, d) => { const n = (typeof v === 'number' || typeof v === 'string') ? num(v) : null; return n === null ? d : Math.max(min, Math.min(max, Math.round(n))); };
  // 🗺️ v0.169: o que passa na tela — as cidades soltas, o Brasil inteiro ou
  // um estado (sem UF válida, volta para as cidades soltas)
  const lb = (s.lista && typeof s.lista === 'object') ? s.lista : {};
  const uf = UFS_SIGLAS.includes(String(lb.uf || '').toUpperCase()) ? String(lb.uf).toUpperCase() : '';
  let modo = LISTA_MODOS.includes(lb.modo) ? lb.modo : 'cidades';
  if (modo === 'uf' && !uf) modo = 'cidades';
  // o mostrador do painel: a cidade de quem apresenta (uma das soltas) ou,
  // se a pessoa quiser, o que está passando na tela
  const pb = (s.painel && typeof s.painel === 'object') ? s.painel : {};
  return {
    fontes: fontes.length ? fontes : FONTES_PADRAO.slice(),
    cidades,
    lista: { modo, uf },
    painel: { seguirTela: pb.seguirTela === true, cidadeId: /^[a-z0-9_-]{1,40}$/i.test(String(pb.cidadeId || '')) ? String(pb.cidadeId) : '' },
    completoDias: inteiro(s.completoDias, 3, MAX_DIAS, MAX_DIAS),
    mostrarCidade: s.mostrarCidade !== false,
    mostrarSensacao: s.mostrarSensacao !== false,
    mostrarUmidade: s.mostrarUmidade !== false,
    mostrarVento: s.mostrarVento !== false,
    mostrarDescricao: s.mostrarDescricao !== false,
    mostrarFonte: s.mostrarFonte === true,
    unidade: s.unidade === 'F' ? 'F' : 'C',
    // a preferência da pessoa fica guardada como está; com o Brasil inteiro /
    // um estado o rodízio VALE ligado e com no mínimo 15 s — mas só na leitura
    // (rodizioEfetivo), para voltar às cidades soltas sem perder o que ela tinha
    rodizio: s.rodizio === true,
    rodizioSegundos: inteiro(s.rodizioSegundos, 5, 600, 15),
    atualizarMin: inteiro(s.atualizarMin, MIN_ATUALIZAR_MIN, MAX_ATUALIZAR_MIN, 15),
    estilo: ['cartao', 'compacto', 'grande'].includes(s.estilo) ? s.estilo : 'cartao',
  };
}

// 🗺️ v0.169: os municípios do IBGE (public/municipios-br.json) viram cidades
// do rodízio: [codigo, nome, uf, lat, lon, capital] → { id: 'm' + codigo, … }.
// A ORDEM é a do arquivo (estado por estado, em ordem alfabética) e vale
// igual no servidor e nas telas — é ela que dá a cidade da vez.
function municipiosParaCidades(municipios, uf) {
  const out = [];
  for (const m of Array.isArray(municipios) ? municipios : []) {
    if (!Array.isArray(m) || m.length < 5) continue;
    if (uf && m[2] !== uf) continue;
    const lat = num(m[3]), lon = num(m[4]);
    if (lat === null || lon === null) continue;
    out.push({ id: 'm' + m[0], nome: String(m[1]), uf: String(m[2]), pais: 'BR', lat, lon, tz: '', capital: m[5] === 1 });
  }
  return out;
}
// O rodízio que VALE: com o Brasil inteiro / um estado ele está sempre ligado
// e cada cidade fica no mínimo MIN_SEG_LISTA s (uma consulta por troca — as
// fontes gratuitas têm cota por dia). A mesma regra mora em render.js.
const MIN_SEG_LISTA = 15;
function rodizioEfetivo(conf) {
  const c = conf || {};
  const modo = c.lista && c.lista.modo;
  const lista = modo === 'brasil' || modo === 'uf';
  const seg = Math.max(5, Number(c.rodizioSegundos) || 15);
  return { rodizio: lista || c.rodizio === true, rodizioSegundos: lista ? Math.max(MIN_SEG_LISTA, seg) : seg };
}
// Em que cidade o rodízio está: a mesma conta das telas (overlay e painel),
// a partir do «desde» do servidor — ninguém manda mensagem por troca
function indiceRodizio(pos, conf, n, agora = Date.now()) {
  if (!n) return 0;
  const base = ((Math.round(num((pos && pos.indice)) || 0) % n) + n) % n;
  const ef = rodizioEfetivo(conf);
  if (!ef.rodizio || n < 2) return base;
  const per = ef.rodizioSegundos * 1000;
  const decorrido = Math.max(0, Math.floor((agora - (Number(pos && pos.desde) || 0)) / per));
  return ((base + decorrido) % n + n) % n;
}

// ---------- o serviço: cache por cidade + atualização periódica ----------
class Clima {
  // opcoes: { buscarJson?, chaves: () => ({ fonte: chave }), aoMudar(retratoGeral), agora? }
  constructor(opcoes = {}) {
    this.buscarJson = opcoes.buscarJson || buscarJsonPadrao;
    this.chaves = typeof opcoes.chaves === 'function' ? opcoes.chaves : () => ({});
    this.aoMudar = typeof opcoes.aoMudar === 'function' ? opcoes.aoMudar : () => {};
    this.agora = typeof opcoes.agora === 'function' ? opcoes.agora : () => Date.now();
    this.dados = new Map();     // id da cidade → { retrato, erro, em, memoria }
    this.conf = sanitizeClima({}, {});
    this.ativo = false;
    this.relogio = null;
    this.buscando = false;
    this.ultimoErroFonte = {};  // fonte → texto (para o card de 🔌 Conexões)
    // 🗺️ v0.169: os municípios do IBGE ([codigo, nome, uf, lat, lon, capital])
    // e onde o rodízio está (o servidor sabe: { indice, desde })
    this.municipios = Array.isArray(opcoes.municipios) ? opcoes.municipios : [];
    this.posicaoRodizio = typeof opcoes.posicaoRodizio === 'function' ? opcoes.posicaoRodizio : () => ({ indice: 0, desde: 0 });
    this.previsoes = new Map();  // id da cidade → { previsao, erro, em, memoria } (cartão completo)
    this.completo = null;        // a cidade do cartão completo enquanto ele está na tela
    this.geracao = 0;            // sobe a cada configurar(): uma volta antiga para
    this._lista = null;          // cache da lista efetiva (o Brasil inteiro são 5.570 objetos)
  }

  configurar(conf) {
    const nova = sanitizeClima(conf, this.conf);
    const trocouFontes = JSON.stringify(nova.fontes) !== JSON.stringify(this.conf.fontes);
    const assinaturaLista = (c) => JSON.stringify([c.lista, c.cidades.map((x) => x.id)]);
    const trocouLista = assinaturaLista(nova) !== assinaturaLista(this.conf);
    this.conf = nova;
    this._lista = null;
    this.geracao++;
    // cidade que saiu (da lista, do mostrador, do cartão), sai do cache — só
    // quando a lista mudou de verdade: um ajuste qualquer (unidade, estilo…)
    // não joga fora a janela já buscada do rodízio. Fonte trocada, o que
    // estava vale até vencer
    if (trocouLista) {
      const fica = new Set(this.alvos().map((c) => c.id));
      for (const id of [...this.dados.keys()]) if (!fica.has(id)) this.dados.delete(id);
    }
    if (trocouFontes) { for (const d of this.dados.values()) d.em = 0; for (const p of this.previsoes.values()) p.em = 0; }
    if (this.ativo) this.agendar(true);
  }

  ligar() { if (!this.ativo) { this.ativo = true; this.agendar(true); } }
  desligar() { this.ativo = false; clearTimeout(this.relogio); this.relogio = null; }

  // 🗺️ v0.169: o que passa na tela — as cidades soltas, ou os municípios do
  // Brasil / de um estado (na ordem do arquivo, igual nas telas)
  listaEfetiva() {
    const { modo, uf } = this.conf.lista || {};
    if (modo !== 'brasil' && modo !== 'uf') return this.conf.cidades;
    if (!this._lista) this._lista = municipiosParaCidades(this.municipios, modo === 'uf' ? uf : '');
    return this._lista;
  }
  // a cidade do mostrador do painel: a escolhida entre as soltas, ou a primeira
  cidadePainel() {
    const c = this.conf.cidades;
    if (!c.length) return null;
    return c.find((x) => x.id === this.conf.painel.cidadeId) || c[0];
  }
  // uma cidade por id — solta, do rodízio, do mostrador ou do cartão
  cidadePorId(id) {
    const k = String(id || '');
    if (!k) return null;
    return this.conf.cidades.find((c) => c.id === k) || this.listaEfetiva().find((c) => c.id === k) || (this.completo && this.completo.id === k ? this.completo : null) || null;
  }
  indiceAtual(agora) { return indiceRodizio(this.posicaoRodizio(), this.conf, this.listaEfetiva().length, agora || this.agora()); }
  // As cidades que precisam estar buscadas: a do mostrador, a do cartão
  // completo e — lista pequena — todas; lista grande, só a da vez e as próximas
  alvos() {
    const lista = this.listaEfetiva();
    const alvos = new Map();
    const painel = this.cidadePainel();
    if (painel) alvos.set(painel.id, painel);
    // o cartão completo nunca substitui uma cidade já conhecida com o mesmo id
    if (this.completo && !alvos.has(this.completo.id)) alvos.set(this.completo.id, this.completo);
    if (lista.length <= MAX_CIDADES) for (const c of lista) alvos.set(c.id, c);
    else {
      const n = lista.length, i = this.indiceAtual();
      for (let k = 0; k <= JANELA_RODIZIO; k++) { const c = lista[(i + k) % n]; alvos.set(c.id, c); }
    }
    return [...alvos.values()];
  }

  agendar(jaAgora) {
    clearTimeout(this.relogio);
    // lista grande com rodízio: confere mais vezes, para a próxima cidade já
    // chegar buscada (a janela anda com o rodízio)
    let ms = 60 * 1000;
    const ef = rodizioEfetivo(this.conf);
    if (this.listaEfetiva().length > MAX_CIDADES && ef.rodizio) ms = Math.min(ms, Math.max(2000, Math.floor(ef.rodizioSegundos * 1000 / 2)));
    this.relogio = setTimeout(() => { this.atualizar().catch(() => {}); }, jaAgora ? 50 : ms);
    if (this.relogio.unref) this.relogio.unref();
  }

  vencido(id) {
    const d = this.dados.get(id);
    return !d || (this.agora() - (d.em || 0)) >= this.conf.atualizarMin * 60 * 1000;
  }
  previsaoVencida(id) {
    const p = this.previsoes.get(id);
    return !p || (this.agora() - (p.em || 0)) >= (p.erro ? REPETE_FALHA_MS : PREVISAO_MS);
  }

  // Passa pelas cidades vencidas, uma de cada vez (as fontes gratuitas
  // pedem calma); avisa a tela quando algo mudou
  async atualizar(forcar = false) {
    // já numa volta: guarda o pedido e refaz quando ela acabar (o 🔄 do
    // painel e uma cidade recém-adicionada não se perdem)
    if (this.buscando) { if (forcar) this.pendenteForcar = true; else this.pendente = true; return false; }
    this.buscando = true;
    let mudou = false;
    try {
      const ger = this.geracao;
      for (const cidade of this.alvos()) {
        if (this.geracao !== ger) { this.pendente = true; break; } // a configuração mudou no meio da volta: recomeça
        if (!forcar && !this.vencido(cidade.id)) continue;
        const r = await this.buscarCidade(cidade);
        if (this.geracao !== ger) { this.pendente = true; break; }
        const atual = this.dados.get(cidade.id) || { memoria: {} };
        // v0.168.3: quando nenhuma fonte respondeu (ou a que valia caiu), a
        // cidade vence de novo em 2 min — sem isso uma falha passageira (rede
        // ainda subindo no boot, fonte fora do ar) ficava presa o intervalo inteiro
        const falhou = !r.retrato || !!r.erro;
        this.dados.set(cidade.id, { ...atual, ...r, em: falhou ? this.agora() - this.conf.atualizarMin * 60 * 1000 + REPETE_FALHA_MS : this.agora() });
        mudou = true;
      }
      // 🗂️ o cartão completo na tela: a previsão dos próximos dias também fica em dia
      if (this.geracao === ger && this.completo && (forcar || this.previsaoVencida(this.completo.id))) {
        await this.buscarPrevisao(this.completo);
        mudou = true;
      }
      this.enxugar();
    } finally {
      this.buscando = false;
      if (this.ativo) this.agendar(false);
    }
    if (mudou) this.aoMudar(this.retratoGeral());
    const denovo = this.pendenteForcar ? 'forcar' : this.pendente ? 'normal' : '';
    this.pendenteForcar = false; this.pendente = false;
    if (denovo && (this.ativo || denovo === 'forcar')) setTimeout(() => this.atualizar(denovo === 'forcar').catch(() => {}), 50);
    return mudou;
  }

  // o cache tem teto: fora das cidades-alvo, sai o que está mais velho
  enxugar() {
    if (this.dados.size > TETO_CACHE) {
      const fica = new Set(this.alvos().map((c) => c.id));
      const sobra = [...this.dados.entries()].filter(([id]) => !fica.has(id)).sort((a, b) => (a[1].em || 0) - (b[1].em || 0));
      for (const [id] of sobra) { if (this.dados.size <= TETO_CACHE) break; this.dados.delete(id); }
    }
    if (this.previsoes.size > 8) {
      const sobra = [...this.previsoes.entries()].filter(([id]) => !this.completo || this.completo.id !== id).sort((a, b) => (a[1].em || 0) - (b[1].em || 0));
      for (const [id] of sobra) { if (this.previsoes.size <= 8) break; this.previsoes.delete(id); }
    }
  }

  // 🗂️ v0.169: o cartão completo entrou na tela (cidade) ou saiu (null) — a
  // cidade dele entra nos alvos e a previsão é buscada já
  acompanharCompleto(cidade) {
    this.completo = cidade ? sanitizeCidade(cidade) : null;
    if (this.completo && this.ativo) this.agendar(true);
  }

  // A previsão dos próximos dias de uma cidade, pela primeira fonte que
  // responder (o Weather Underground não faz previsão: é pulado)
  async buscarPrevisao(cidade) {
    const chaves = this.chaves() || {};
    const atual = this.previsoes.get(cidade.id) || {};
    const memoria = (this.dados.get(cidade.id) || {}).memoria || atual.memoria || {};
    const erros = [];
    for (const fonte of this.conf.fontes) {
      const f = PREVISORES[fonte];
      if (!f) continue;
      const chave = FONTES[fonte].chave ? String(chaves[fonte] || '') : '';
      if (FONTES[fonte].chave && !chave) { erros.push(FONTES[fonte].nome + ': sem chave'); continue; }
      if (this.fonteEmPausa(fonte)) { erros.push(FONTES[fonte].nome + ': ' + this.ultimoErroFonte[fonte].texto); continue; }
      try {
        const previsao = await f({ cidade, chave, buscarJson: this.buscarJson, memoria });
        delete this.ultimoErroFonte[fonte];
        const r = { previsao, erro: null, em: this.agora(), memoria };
        this.previsoes.set(cidade.id, r);
        return r;
      } catch (e) {
        const msg = String(e && e.message || e).slice(0, 160);
        this.ultimoErroFonte[fonte] = { texto: msg, em: this.agora() };
        erros.push(msg);
      }
    }
    const r = { previsao: atual.previsao || null, erro: erros.join(' · ').slice(0, 300) || 'nenhuma fonte marcada faz previsão', em: this.agora(), memoria };
    this.previsoes.set(cidade.id, r);
    return r;
  }
  previsaoPublica(id) {
    const p = this.previsoes.get(String(id || ''));
    return p ? { previsao: p.previsao || null, erro: p.erro || null, em: p.em || 0 } : { previsao: null, erro: null, em: 0 };
  }

  // Fonte que respondeu «cota esgotada» / chave recusada há pouco: fica de
  // molho uns minutos em vez de pagar uma tentativa perdida a cada cidade
  // nova do rodízio (o Brasil inteiro são milhares delas)
  fonteEmPausa(fonte) {
    const e = this.ultimoErroFonte[fonte];
    if (!e || !/cota|quota|limit|429|503|chave recusada|token recusado/i.test(e.texto || '')) return false;
    return this.agora() - (e.em || 0) < PAUSA_FONTE_MS;
  }

  async buscarCidade(cidade) {
    const chaves = this.chaves() || {};
    const atual = this.dados.get(cidade.id) || {};
    const memoria = atual.memoria || {};
    const erros = [];
    for (const fonte of this.conf.fontes) {
      const f = FETCHERS[fonte];
      if (!f) continue;
      const chave = FONTES[fonte].chave ? String(chaves[fonte] || '') : '';
      if (FONTES[fonte].chave && !chave) { erros.push(FONTES[fonte].nome + ': sem chave'); continue; }
      if (this.fonteEmPausa(fonte)) { erros.push(FONTES[fonte].nome + ': ' + this.ultimoErroFonte[fonte].texto); continue; }
      try {
        const retrato = await f({ cidade, chave, buscarJson: this.buscarJson, memoria });
        delete this.ultimoErroFonte[fonte];
        return { retrato, erro: null, memoria };
      } catch (e) {
        const msg = String(e && e.message || e).slice(0, 160);
        this.ultimoErroFonte[fonte] = { texto: msg, em: this.agora() };
        erros.push(msg);
      }
    }
    // nenhuma respondeu: o retrato antigo continua valendo (marcado como velho)
    return { retrato: atual.retrato || null, erro: erros.join(' · ').slice(0, 300) || 'nenhuma fonte configurada', memoria };
  }

  // O que vai para a tela e para o painel
  // 🗺️ v0.169: «cidades» é a lista do rodízio com o tempo de cada uma — só
  // quando cabe (≤ 27); o Brasil inteiro / um estado grande as telas montam
  // sozinhas a partir de municipios-br.json e pegam o tempo em «retratos»
  // (por id: o que está no cache). «painel» é a cidade do mostrador.
  retratoGeral() {
    const lista = this.listaEfetiva();
    const comRetrato = (c) => {
      const d = this.dados.get(c.id) || {};
      return { id: c.id, nome: c.nome, uf: c.uf, pais: c.pais, retrato: d.retrato || null, erro: d.erro || null, em: d.em || 0 };
    };
    const retratos = Object.create(null); // ids são chaves de dados, nunca propriedades do Object
    for (const [id, d] of this.dados) retratos[id] = { retrato: d.retrato || null, erro: d.erro || null, em: d.em || 0 };
    const painel = this.cidadePainel();
    return {
      lista: { modo: this.conf.lista.modo, uf: this.conf.lista.uf, total: lista.length },
      cidades: lista.length <= MAX_CIDADES ? lista.map(comRetrato) : [],
      retratos,
      painel: painel ? { ...comRetrato(painel), seguirTela: this.conf.painel.seguirTela } : null,
      // só o nome de cada fonte: a ordem, as chaves e os erros ficam no
      // resumo de Conexões (climaChaves), que o público (viewer) não recebe
      fontes: Object.fromEntries(Object.keys(FONTES).map((f) => [f, { nome: FONTES[f].nome }])),
    };
  }

  parar() { this.desligar(); }
}

// °C → °F, para o overlay (a fonte sempre entrega em °C)
const paraF = (c) => (c === null || c === undefined ? null : Math.round((c * 9) / 5 + 32));

module.exports = {
  Clima, FONTES, FONTES_PADRAO, CONDICOES, CAPITAIS_BR, DESCRICAO, FETCHERS, PREVISORES, MAX_CIDADES, MIN_ATUALIZAR_MIN, MAX_ATUALIZAR_MIN,
  JANELA_RODIZIO, TETO_CACHE, PREVISAO_MS, PAUSA_FONTE_MS, MAX_DIAS, MIN_SEG_LISTA, LISTA_MODOS, UFS_SIGLAS,
  sanitizeClima, sanitizeCidade, procurarCidade, buscarJsonPadrao, retrato, previsao, paraF,
  municipiosParaCidades, indiceRodizio, rodizioEfetivo, fusoDaCidade, diasDeHoras, horaLocal, hora12para24,
  condicaoWmo, condicaoMetNo, condicaoOwm, condicaoWeatherApi, condicaoAccu, condicaoClimatempo, siglaUf,
};
