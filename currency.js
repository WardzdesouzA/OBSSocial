// Conversor de moedas para Super Chats que nao sao em reais.
// Usa cotacoes publicas (open.er-api.com, sem chave) com TODAS as moedas ISO
// (~160), atualizadas 2x por dia e guardadas em cache para funcionar offline.
const fs = require('fs');
const path = require('path');

const RATES_URL = 'https://open.er-api.com/v6/latest/BRL';
const REFRESH_MS = 12 * 60 * 60 * 1000;
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Simbolos com maiusculas/minusculas relevantes (checados primeiro, caso exato).
const SYMBOLS_EXACT = {
  'R$': 'BRL',
  'US$': 'USD', 'U$': 'USD', '$': 'USD',
  'CA$': 'CAD', 'C$': 'CAD',
  'A$': 'AUD', 'AU$': 'AUD',
  'NZ$': 'NZD',
  'MX$': 'MXN', 'Mex$': 'MXN',
  'HK$': 'HKD', 'NT$': 'TWD', 'S$': 'SGD', 'SG$': 'SGD',
  'RD$': 'DOP', 'B$': 'BND', 'FJ$': 'FJD', 'J$': 'JMD', 'TT$': 'TTD',
  'CN¥': 'CNY', 'JP¥': 'JPY',
  'E£': 'EGP', 'L£': 'LBP',
  'R': 'ZAR',
};

// Simbolos sem ambiguidade de caixa (comparados em minusculas).
const SYMBOLS_CI = {
  '£': 'GBP', '€': 'EUR', '¥': 'JPY', '￥': 'JPY', '円': 'JPY', '元': 'CNY',
  '₩': 'KRW', '￦': 'KRW',
  '₹': 'INR', '₽': 'RUB', '₪': 'ILS', '₱': 'PHP', '₫': 'VND', '₴': 'UAH',
  '₺': 'TRY', '₼': 'AZN', '₾': 'GEL', '₸': 'KZT', '₮': 'MNT', '₦': 'NGN',
  '₲': 'PYG', '₡': 'CRC', '₵': 'GHS', '฿': 'THB', '៛': 'KHR', '₭': 'LAK',
  '؋': 'AFN', '₥': 'MRU', '₣': 'CHF', '₤': 'GBP',
  'rp': 'IDR', 'rm': 'MYR',
  'zł': 'PLN', 'zl': 'PLN',
  'kč': 'CZK', 'kc': 'CZK',
  'ft': 'HUF', 'lei': 'RON', 'leu': 'RON',
  'лв': 'BGN', 'kn': 'HRK', 'дин': 'RSD', 'din': 'RSD',
  'chf': 'CHF', 'fr.': 'CHF',
  's/': 'PEN', 's/.': 'PEN',
  'bs': 'BOB', 'bs.': 'BOB',
  'gs': 'PYG', 'q': 'GTQ', 'l': 'HNL', 'c$': 'NIO',
  '₨': 'PKR', 'rs': 'PKR', 'rs.': 'PKR',
  '৳': 'BDT',
  'tl': 'TRY', '£e': 'EGP',
  'дин.': 'RSD', 'kr.': null, 'kr': null, // "kr" e ambiguo (SEK/NOK/DKK/ISK); o YouTube usa o codigo nesses casos
};

let rates = null;      // 1 BRL = rates[MOEDA]
let fetchedAt = 0;
let cachePath = null;

function loadCache() {
  try {
    const cached = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    if (cached.rates && Date.now() - (cached.fetchedAt || 0) < CACHE_MAX_AGE_MS) {
      rates = cached.rates;
      fetchedAt = cached.fetchedAt;
    }
  } catch {}
}

async function refresh() {
  try {
    const res = await fetch(RATES_URL, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`erro ${res.status}`);
    const data = await res.json();
    if (data && data.rates && data.rates.USD) {
      rates = data.rates;
      fetchedAt = Date.now();
      try {
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify({ fetchedAt, rates }));
      } catch {}
    }
  } catch { /* mantem o cache atual; sem cotacao, simplesmente nao converte */ }
}

function init(dataDir) {
  cachePath = path.join(dataDir, 'rates.json');
  loadCache();
  refresh();
  const timer = setInterval(refresh, REFRESH_MS);
  if (timer.unref) timer.unref();
}

// Aceita "1,234.56" (en), "1.234,56" (europeu), "1,00,000.00" (indiano),
// "1'234.50" (suico), "1 000,50" (frances) e valores simples.
function parseNumber(raw) {
  let s = String(raw).trim().replace(/[\s  ']/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(/,/g, '.'); // 1.234,56
    else s = s.replace(/,/g, '');                                        // 1,234.56 / 1,00,000.00
  } else if (lastComma > -1) {
    const digitsAfter = s.length - lastComma - 1;
    if (digitsAfter <= 2 && s.indexOf(',') === lastComma) s = s.replace(',', '.'); // 2,5 -> decimal
    else s = s.replace(/,/g, '');                                                  // 1,000 / 1,00,000
  } else if (lastDot > -1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.000 (milhar europeu)
  }
  const value = parseFloat(s);
  return Number.isFinite(value) ? value : NaN;
}

function resolveToken(rawToken) {
  let token = String(rawToken).trim().replace(/[\s ]+/g, '');
  if (!token) return null;
  // 🔒 v0.127.1: hasOwn — "constructor"/"__proto__" não são moedas
  if (Object.hasOwn(SYMBOLS_EXACT, token) && SYMBOLS_EXACT[token]) return SYMBOLS_EXACT[token];
  const lower = token.toLowerCase();
  if (Object.hasOwn(SYMBOLS_CI, lower)) return SYMBOLS_CI[lower];
  const noDot = lower.replace(/\.+$/, '');
  if (Object.hasOwn(SYMBOLS_CI, noDot)) return SYMBOLS_CI[noDot];
  // Qualquer codigo ISO de 3 letras (USD, PEN, SEK, NOK, AED, IDR, XAF...)
  if (/^[A-Za-z]{3}$/.test(token)) return token.toUpperCase();
  return null;
}

// "US$ 5.00" / "$5.00" / "5,00 €" / "PEN 10.00" / "10.00 SEK" -> { currency, value }
function parseAmount(text) {
  const cleaned = String(text).trim().replace(/ /g, ' ');
  const match = cleaned.match(/^(.*?)(\d[\d., ' ]*)(.*)$/);
  if (!match) return null;
  const value = parseNumber(match[2]);
  if (!Number.isFinite(value)) return null;
  const currency = resolveToken(match[1]) || resolveToken(match[3]);
  return currency ? { currency, value } : null;
}

// Converte o texto de valor para reais; retorna null quando ja e BRL,
// quando a moeda nao foi reconhecida ou quando nao ha cotacao disponivel.
function toBRL(amountText) {
  const parsed = parseAmount(amountText);
  if (!parsed || parsed.currency === 'BRL') return null;
  if (!rates || !Object.hasOwn(rates, parsed.currency) || !rates[parsed.currency]) return null;
  const brl = parsed.value / rates[parsed.currency];
  if (!Number.isFinite(brl) || brl <= 0) return null;
  if (brl >= 1000) {
    return 'R$ ' + brl.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');
  }
  return 'R$ ' + brl.toFixed(2).replace('.', ',');
}

module.exports = { init, toBRL, parseAmount };
