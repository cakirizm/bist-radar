const universe = require('./universe');

const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36';

function ema(values, period) {
  if (!values || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a,b) => a+b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1-k);
  return e;
}

function emaSeries(values, period) {
  if (!values || values.length < period) return [];
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a,b) => a+b, 0) / period;
  out[period-1] = e;
  for (let i = period; i < values.length; i++) {
    e = values[i] * k + e * (1-k);
    out[i] = e;
  }
  return out;
}

function rsi(values, period=14) {
  if (!values || values.length < period + 1) return null;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i-1];
    if (d >= 0) gain += d; else loss -= d;
  }
  gain /= period; loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i-1];
    gain = (gain * (period - 1) + Math.max(d, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (loss === 0) return 100;
  const rs = gain / loss;
  return 100 - (100 / (1 + rs));
}

function macd(values) {
  if (!values || values.length < 35) return {macd:null, signal:null, hist:null};
  const e12 = emaSeries(values, 12);
  const e26 = emaSeries(values, 26);
  const m = values.map((_, i) => e12[i] != null && e26[i] != null ? e12[i] - e26[i] : null);
  const mVals = m.filter(v => v != null);
  const sig = emaSeries(mVals, 9);
  const macdVal = mVals[mVals.length-1];
  const signal = sig[sig.length-1];
  return { macd: macdVal, signal, hist: macdVal != null && signal != null ? macdVal - signal : null };
}

function pct(values, days) {
  if (!values || values.length <= days) return null;
  const a = values[values.length-1-days], b = values[values.length-1];
  return a ? ((b/a)-1)*100 : null;
}

function stddevReturns(values, days=20) {
  if (!values || values.length < days+1) return null;
  const slice = values.slice(-(days+1));
  const rets = [];
  for (let i=1;i<slice.length;i++) rets.push((slice[i]/slice[i-1]-1)*100);
  const mean = rets.reduce((a,b)=>a+b,0)/rets.length;
  const v = rets.reduce((a,b)=>a+(b-mean)**2,0)/rets.length;
  return Math.sqrt(v);
}

function clamp(v, lo=0, hi=100){ return Math.max(lo, Math.min(hi, v)); }
function scale(v, min, max){ if (v == null || !Number.isFinite(v)) return 50; return clamp((v-min)/(max-min)*100); }

function scoreStock(x, index60) {
  const price = x.price;
  const trendParts = [
    price > x.ema20 ? 100 : 15,
    price > x.ema50 ? 100 : 20,
    price > x.ema200 ? 100 : 10,
    x.ema20 > x.ema50 ? 100 : 25,
    x.ema50 > x.ema200 ? 100 : 25,
  ];
  const trend = trendParts.reduce((a,b)=>a+b,0)/trendParts.length;

  const rsiScore = x.rsi == null ? 50 : (x.rsi < 35 ? 35 : x.rsi <= 68 ? scale(x.rsi,35,68) : x.rsi <= 78 ? 78 : 55);
  const macdScore = x.macdHist == null ? 50 : x.macdHist > 0 ? 82 : 28;
  const momScore = [scale(x.mom20,-12,18), scale(x.mom60,-20,35), scale(x.mom120,-30,60), rsiScore, macdScore].reduce((a,b)=>a+b,0)/5;

  const vr = x.volumeRatio;
  const volumeScore = vr == null ? 50 : clamp(vr * 50);

  const relative60 = x.mom60 != null && index60 != null ? x.mom60 - index60 : null;
  const relative = scale(relative60, -20, 25);

  const risk = x.vol20 == null ? 50 : clamp(100 - scale(x.vol20,1.0,5.0)*0.75);

  const total = clamp(
    trend * 0.33 +
    momScore * 0.27 +
    volumeScore * 0.14 +
    relative * 0.16 +
    risk * 0.10
  );

  return {
    total: Math.round(total*10)/10,
    trend: Math.round(trend),
    momentum: Math.round(momScore),
    volume: Math.round(volumeScore),
    relative: Math.round(relative),
    risk: Math.round(risk),
    relative60: relative60 == null ? null : Math.round(relative60*10)/10
  };
}

async function fetchYahoo(symbol, range='1y', interval='1d') {
  const url = `${YAHOO}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplits`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(url, {headers:{'user-agent':UA,'accept':'application/json'}, signal: ctl.signal});
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    const result = j?.chart?.result?.[0];
    if (!result) throw new Error('No chart data');
    return result;
  } finally { clearTimeout(t); }
}

function normalize(symbol, raw) {
  const q = raw.indicators?.quote?.[0] || {};
  const closes = (raw.indicators?.adjclose?.[0]?.adjclose || q.close || []).filter(v => Number.isFinite(v));
  const volumes = (q.volume || []).filter(v => Number.isFinite(v));
  if (closes.length < 210) throw new Error('Insufficient history');
  const meta = raw.meta || {};
  const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes[closes.length-1];
  const prev = Number.isFinite(meta.chartPreviousClose) ? meta.chartPreviousClose : closes[closes.length-2];
  const e20 = ema(closes,20), e50 = ema(closes,50), e200 = ema(closes,200);
  const rr = rsi(closes,14);
  const mm = macd(closes);
  const last20v = volumes.slice(-20);
  const avg20v = last20v.length ? last20v.reduce((a,b)=>a+b,0)/last20v.length : null;
  const lastv = volumes[volumes.length-1] || null;
  return {
    symbol: symbol.replace('.IS',''),
    yahooSymbol: symbol,
    price,
    changePct: prev ? ((price/prev)-1)*100 : null,
    ema20:e20, ema50:e50, ema200:e200,
    rsi:rr, macdHist:mm.hist,
    mom20:pct(closes,20), mom60:pct(closes,60), mom120:pct(closes,120),
    volumeRatio: avg20v && lastv ? lastv/avg20v : null,
    vol20: stddevReturns(closes,20),
    currency: meta.currency || 'TRY',
    exchangeTime: meta.regularMarketTime ? new Date(meta.regularMarketTime*1000).toISOString() : null
  };
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker(){
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (e) { out[i] = {error: e.message, item: items[i]}; }
    }
  }
  await Promise.all(Array.from({length:Math.min(limit,items.length)}, worker));
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  try {
    const indexRaw = await fetchYahoo('XU100.IS');
    const index = normalize('XU100.IS', indexRaw);
    const symbols = universe.map(s => `${s}.IS`);
    const fetched = await mapLimit(symbols, 12, async s => normalize(s, await fetchYahoo(s)));
    const ok = fetched.filter(x => !x.error);
    const failed = fetched.filter(x => x.error).map(x => ({symbol:x.item, error:x.error}));
    const scored = ok.map(x => ({...x, score: scoreStock(x, index.mom60)}));
    scored.sort((a,b)=>b.score.total-a.score.total);
    scored.forEach((x,i)=>x.rank=i+1);

    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      ok:true,
      generatedAt:new Date().toISOString(),
      source:'Yahoo Finance chart endpoint (unofficial)',
      delayed:true,
      universeCount:universe.length,
      successCount:scored.length,
      failedCount:failed.length,
      index:{symbol:'XU100', price:index.price, changePct:index.changePct, mom60:index.mom60, exchangeTime:index.exchangeTime},
      stocks:scored,
      failed
    });
  } catch (e) {
    return res.status(500).json({ok:false,error:e.message || 'Scan failed'});
  }
}
