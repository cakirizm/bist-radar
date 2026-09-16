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
function round(v, d=2){ if (!Number.isFinite(v)) return null; const p=10**d; return Math.round(v*p)/p; }
function minFinite(values){ const a=values.filter(Number.isFinite); return a.length ? Math.min(...a) : null; }
function maxFinite(values){ const a=values.filter(Number.isFinite); return a.length ? Math.max(...a) : null; }
function median(values){ const a=values.filter(Number.isFinite).sort((x,y)=>x-y); if(!a.length)return null; const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; }

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
    total: round(total,1),
    trend: Math.round(trend),
    momentum: Math.round(momScore),
    volume: Math.round(volumeScore),
    relative: Math.round(relative),
    risk: Math.round(risk),
    relative60: round(relative60,1)
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

function dateKey(seconds, timeZone='Europe/Istanbul') {
  if (!Number.isFinite(seconds)) return null;
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date(seconds * 1000));
  } catch (_) {
    return new Date(seconds * 1000).toISOString().slice(0,10);
  }
}

function getPrevClose(raw, q) {
  const meta = raw.meta || {};
  if (Number.isFinite(meta.regularMarketPreviousClose)) return meta.regularMarketPreviousClose;
  if (Number.isFinite(meta.previousClose)) return meta.previousClose;

  const timestamps = raw.timestamp || [];
  const closes = q.close || [];
  let last = -1;
  for (let i = Math.min(timestamps.length, closes.length) - 1; i >= 0; i--) {
    if (Number.isFinite(closes[i])) { last = i; break; }
  }
  if (last < 0) return null;

  const tz = meta.exchangeTimezoneName || 'Europe/Istanbul';
  const marketDay = dateKey(meta.regularMarketTime, tz);
  const lastBarDay = dateKey(timestamps[last], tz);
  if (marketDay && lastBarDay && marketDay === lastBarDay) {
    for (let i = last - 1; i >= 0; i--) if (Number.isFinite(closes[i])) return closes[i];
  }
  return closes[last];
}

function normalize(symbol, raw) {
  const q = raw.indicators?.quote?.[0] || {};
  const rawClose = raw.indicators?.adjclose?.[0]?.adjclose || q.close || [];
  const closes = rawClose.filter(v => Number.isFinite(v));
  const volumes = q.volume || [];
  if (closes.length < 210) throw new Error('Insufficient history');

  const meta = raw.meta || {};
  const price = Number.isFinite(meta.regularMarketPrice) ? meta.regularMarketPrice : closes[closes.length-1];
  const prev = getPrevClose(raw, q);
  const e20 = ema(closes,20), e50 = ema(closes,50), e200 = ema(closes,200);
  const rr = rsi(closes,14);
  const mm = macd(closes);

  const finiteVolumes = volumes.filter(v => Number.isFinite(v) && v >= 0);
  const lastv = finiteVolumes.length ? finiteVolumes[finiteVolumes.length-1] : null;
  const previousVolumes = finiteVolumes.slice(Math.max(0, finiteVolumes.length - 21), -1);
  const avg20v = previousVolumes.length ? previousVolumes.reduce((a,b)=>a+b,0)/previousVolumes.length : null;

  const oneYear = closes.slice(-252);
  const recent20 = closes.slice(-20);
  const high52 = maxFinite(oneYear), low52 = minFinite(oneYear);
  const support20 = minFinite(recent20), resistance20 = maxFinite(recent20);
  const range52Position = high52 != null && low52 != null && high52 !== low52 ? ((price-low52)/(high52-low52))*100 : null;
  const spark = closes.slice(-36).map(v=>round(v,3));

  return {
    symbol: symbol.replace('.IS',''),
    yahooSymbol: symbol,
    name: meta.longName || meta.shortName || symbol.replace('.IS',''),
    price: round(price,4),
    prevClose: round(prev,4),
    changePct: prev ? round(((price/prev)-1)*100,2) : null,
    dayHigh: round(meta.regularMarketDayHigh,4),
    dayLow: round(meta.regularMarketDayLow,4),
    ema20:round(e20,4), ema50:round(e50,4), ema200:round(e200,4),
    distEma20: e20 ? round((price/e20-1)*100,2) : null,
    distEma50: e50 ? round((price/e50-1)*100,2) : null,
    distEma200: e200 ? round((price/e200-1)*100,2) : null,
    rsi:round(rr,2), macdHist:round(mm.hist,4),
    mom20:round(pct(closes,20),2), mom60:round(pct(closes,60),2), mom120:round(pct(closes,120),2),
    volumeRatio: avg20v && lastv != null ? round(lastv/avg20v,2) : null,
    vol20: round(stddevReturns(closes,20),2),
    high52:round(high52,4), low52:round(low52,4), range52Position:round(range52Position,1),
    drawdown52: high52 ? round((price/high52-1)*100,2) : null,
    support20:round(support20,4), resistance20:round(resistance20,4),
    supportDistance: support20 ? round((price/support20-1)*100,2) : null,
    resistanceDistance: resistance20 ? round((resistance20/price-1)*100,2) : null,
    spark,
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

function marketStats(stocks, index) {
  const advancers = stocks.filter(x=>x.changePct > 0.05).length;
  const decliners = stocks.filter(x=>x.changePct < -0.05).length;
  const flat = stocks.length - advancers - decliners;
  const changes = stocks.map(x=>x.changePct).filter(Number.isFinite);
  const above50 = stocks.filter(x=>x.price > x.ema50).length;
  const above200 = stocks.filter(x=>x.price > x.ema200).length;
  const volumeSurge = stocks.filter(x=>x.volumeRatio >= 1.5).length;
  const breadth = (advancers + decliners) ? advancers/(advancers+decliners)*100 : 50;
  const above50Pct = stocks.length ? above50/stocks.length*100 : 50;
  const above200Pct = stocks.length ? above200/stocks.length*100 : 50;
  const indexTrend = (index.price > index.ema50 ? 55 : 20) + (index.price > index.ema200 ? 45 : 10);
  const health = clamp(breadth*0.35 + above50Pct*0.30 + above200Pct*0.20 + indexTrend*0.15);
  let regime = 'Dengeli';
  if (health >= 67) regime = 'Risk iştahı güçlü';
  else if (health >= 55) regime = 'Pozitif';
  else if (health < 38) regime = 'Riskten kaçış';
  else if (health < 48) regime = 'Zayıf';
  return {
    advancers, decliners, flat,
    breadth:round(breadth,1),
    averageChange:round(changes.reduce((a,b)=>a+b,0)/(changes.length||1),2),
    medianChange:round(median(changes),2),
    aboveEma50Pct:round(above50Pct,1),
    aboveEma200Pct:round(above200Pct,1),
    volumeSurge,
    health:round(health,0), regime
  };
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
    const market = marketStats(scored, index);

    res.setHeader('Cache-Control','s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      ok:true,
      version:'2.0',
      generatedAt:new Date().toISOString(),
      source:'Yahoo Finance chart endpoint (unofficial)',
      delayed:true,
      universeCount:universe.length,
      successCount:scored.length,
      failedCount:failed.length,
      market,
      index:{
        symbol:'XU100', price:index.price, prevClose:index.prevClose, changePct:index.changePct,
        mom20:index.mom20, mom60:index.mom60, rsi:index.rsi,
        ema20:index.ema20, ema50:index.ema50, ema200:index.ema200,
        distEma50:index.distEma50, exchangeTime:index.exchangeTime, spark:index.spark
      },
      stocks:scored,
      failed
    });
  } catch (e) {
    return res.status(500).json({ok:false,error:e.message || 'Scan failed'});
  }
};
