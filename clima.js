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
const MAX_CIDADES = 27; // cabem as 27 capitais de uma vez
const MIN_ATUALIZAR_MIN = 10;
const MAX_ATUALIZAR_MIN = 60;
const REPETE_FALHA_MS = 2 * 60 * 1000; // uma busca que falhou tenta de novo em 2 min

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
    let loc = memoria && memoria.accuLocal;
    if (!loc) {
      const r1 = await buscarJson(`https://dataservice.accuweather.com/locations/v1/cities/geoposition/search?apikey=${k}&q=${cidade.lat},${cidade.lon}&language=pt-br`);
      if (r1.status === 401) throw new Error('AccuWeather: chave recusada');
      if (r1.status === 503 || r1.status === 429) throw new Error('AccuWeather: cota do dia esgotada');
      if (r1.status !== 200 || !r1.json || !r1.json.Key) throw new Error('AccuWeather: localidade não achada (HTTP ' + r1.status + ')');
      loc = String(r1.json.Key);
      if (memoria) memoria.accuLocal = loc;
    }
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
    let id = memoria && memoria.climatempoId;
    if (!id) {
      const r1 = await buscarJson(`${base}/api/v1/locale/city?name=${encodeURIComponent(cidade.nome)}${cidade.uf ? '&state=' + encodeURIComponent(cidade.uf) : ''}&token=${k}`);
      if (r1.status === 401 || r1.status === 403) throw new Error('Climatempo: token recusado');
      const lista = Array.isArray(r1.json) ? r1.json : [];
      if (!lista.length || !lista[0].id) throw new Error('Climatempo: cidade não achada');
      id = String(lista[0].id);
      await buscarJson(`${base}/api-manager/user-token/${k}/locales`, { metodo: 'PUT', cabecalhos: { 'Content-Type': 'application/x-www-form-urlencoded' }, corpo: 'localeId[]=' + encodeURIComponent(id) });
      if (memoria) memoria.climatempoId = id;
    }
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
  return {
    id: /^[a-z0-9_-]{1,40}$/i.test(String(c.id || '')) ? String(c.id) : 'c' + Math.abs(Math.round(lat * 1000) * 100003 + Math.round(lon * 1000)).toString(36),
    nome,
    uf: String(c.uf || '').trim().slice(0, 30),
    pais: String(c.pais || 'BR').trim().toUpperCase().slice(0, 2),
    lat: Math.round(lat * 10000) / 10000,
    lon: Math.round(lon * 10000) / 10000,
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
  return {
    fontes: fontes.length ? fontes : FONTES_PADRAO.slice(),
    cidades,
    mostrarCidade: s.mostrarCidade !== false,
    mostrarSensacao: s.mostrarSensacao !== false,
    mostrarUmidade: s.mostrarUmidade !== false,
    mostrarVento: s.mostrarVento !== false,
    mostrarDescricao: s.mostrarDescricao !== false,
    mostrarFonte: s.mostrarFonte === true,
    unidade: s.unidade === 'F' ? 'F' : 'C',
    rodizio: s.rodizio === true,
    rodizioSegundos: inteiro(s.rodizioSegundos, 5, 600, 15),
    atualizarMin: inteiro(s.atualizarMin, MIN_ATUALIZAR_MIN, MAX_ATUALIZAR_MIN, 15),
    estilo: ['cartao', 'compacto', 'grande'].includes(s.estilo) ? s.estilo : 'cartao',
  };
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
  }

  configurar(conf) {
    const nova = sanitizeClima(conf, this.conf);
    const trocouFontes = JSON.stringify(nova.fontes) !== JSON.stringify(this.conf.fontes);
    this.conf = nova;
    // cidade que saiu, sai do cache; fonte trocada, o que estava vale até vencer
    for (const id of [...this.dados.keys()]) if (!nova.cidades.some((c) => c.id === id)) this.dados.delete(id);
    if (trocouFontes) for (const d of this.dados.values()) d.em = 0;
    if (this.ativo) this.agendar(true);
  }

  ligar() { if (!this.ativo) { this.ativo = true; this.agendar(true); } }
  desligar() { this.ativo = false; clearTimeout(this.relogio); this.relogio = null; }

  agendar(jaAgora) {
    clearTimeout(this.relogio);
    this.relogio = setTimeout(() => { this.atualizar().catch(() => {}); }, jaAgora ? 50 : 60 * 1000);
    if (this.relogio.unref) this.relogio.unref();
  }

  vencido(id) {
    const d = this.dados.get(id);
    return !d || (this.agora() - (d.em || 0)) >= this.conf.atualizarMin * 60 * 1000;
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
      for (const cidade of this.conf.cidades.slice()) {
        if (!this.conf.cidades.some((c) => c.id === cidade.id)) continue; // tirada no meio da volta
        if (!forcar && !this.vencido(cidade.id)) continue;
        const r = await this.buscarCidade(cidade);
        if (!this.conf.cidades.some((c) => c.id === cidade.id)) continue;
        const atual = this.dados.get(cidade.id) || { memoria: {} };
        // v0.168.3: quando nenhuma fonte respondeu (ou a que valia caiu), a
        // cidade vence de novo em 2 min — sem isso uma falha passageira (rede
        // ainda subindo no boot, fonte fora do ar) ficava presa o intervalo inteiro
        const falhou = !r.retrato || !!r.erro;
        this.dados.set(cidade.id, { ...atual, ...r, em: falhou ? this.agora() - this.conf.atualizarMin * 60 * 1000 + REPETE_FALHA_MS : this.agora() });
        mudou = true;
      }
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
  retratoGeral() {
    return {
      cidades: this.conf.cidades.map((c) => {
        const d = this.dados.get(c.id) || {};
        return { id: c.id, nome: c.nome, uf: c.uf, pais: c.pais, retrato: d.retrato || null, erro: d.erro || null, em: d.em || 0 };
      }),
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
  Clima, FONTES, FONTES_PADRAO, CONDICOES, CAPITAIS_BR, DESCRICAO, FETCHERS, MAX_CIDADES, MIN_ATUALIZAR_MIN, MAX_ATUALIZAR_MIN,
  sanitizeClima, sanitizeCidade, procurarCidade, buscarJsonPadrao, retrato, paraF,
  condicaoWmo, condicaoMetNo, condicaoOwm, condicaoWeatherApi, condicaoAccu, condicaoClimatempo, siglaUf,
};
