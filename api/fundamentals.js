const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36';

function num(v){
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'object') {
    if (Number.isFinite(v.raw)) return v.raw;
    if (Number.isFinite(Number(v.fmt))) return Number(v.fmt);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function pct(v){ const n=num(v); return n==null?null:n*100; }
function pick(q){
  return {
    symbol:q.symbol || null,
    name:q.longName || q.shortName || q.symbol || null,
    currency:q.currency || q.financialCurrency || 'TRY',
    marketCap:num(q.marketCap),
    trailingPE:num(q.trailingPE),
    forwardPE:num(q.forwardPE),
    priceToBook:num(q.priceToBook),
    epsTTM:num(q.epsTrailingTwelveMonths),
    epsForward:num(q.epsForward),
    bookValue:num(q.bookValue),
    dividendYield:pct(q.dividendYield ?? q.trailingAnnualDividendYield),
    beta:num(q.beta),
    sharesOutstanding:num(q.sharesOutstanding),
    avgVolume3m:num(q.averageDailyVolume3Month),
    fiftyTwoWeekHigh:num(q.fiftyTwoWeekHigh),
    fiftyTwoWeekLow:num(q.fiftyTwoWeekLow),
    price:num(q.regularMarketPrice),
    source:'Yahoo Finance quote endpoint (unofficial)'
  };
}
async function fetchQuotes(symbols){
  const u='https://query1.finance.yahoo.com/v7/finance/quote?symbols='+encodeURIComponent(symbols.join(','));
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),8000);
  try{
    const r=await fetch(u,{headers:{'user-agent':UA,'accept':'application/json'},signal:ctl.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    return (j?.quoteResponse?.result||[]).map(pick);
  } finally { clearTimeout(t); }
}
module.exports=async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  const raw=String(req.query?.symbols || req.query?.symbol || '');
  const syms=[...new Set(raw.split(',').map(s=>s.trim().toUpperCase().replace(/[^A-Z0-9.]/g,'')).filter(Boolean).slice(0,20))]
    .map(s=>s.endsWith('.IS')?s:`${s}.IS`);
  if(!syms.length) return res.status(400).json({ok:false,error:'symbol required'});
  try{
    const items=await fetchQuotes(syms);
    res.setHeader('Cache-Control','s-maxage=1800, stale-while-revalidate=900');
    return res.status(200).json({ok:true,generatedAt:new Date().toISOString(),items});
  }catch(e){
    return res.status(200).json({ok:false,error:e.message||'Fundamental data unavailable',items:[]});
  }
};
