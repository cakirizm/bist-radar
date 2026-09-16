const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/152 Safari/537.36';

function decodeHtml(s='') {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1')
    .replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#x27;/g,"'")
    .replace(/\s+/g,' ').trim();
}

function toneFor(text='') {
  const t = text.toLocaleLowerCase('tr-TR');
  const positive = ['rekor','sözleşme','anlaşma','ihale','temettü','geri alım','büyüme','artış','yükseliş','yatırım','kapasite art','ihracat','sipariş','onay aldı','kâr artt','kar artt','güçlü sonuç','hedef yükselt'];
  const negative = ['ceza','soruşturma','dava','zarar','düşüş','azalış','iptal','üretim dur','yangın','grev','borç artt','hedef düşür','kâr düşt','kar düşt','risk uyar','not düşür'];
  const p = positive.filter(k=>t.includes(k)).length;
  const n = negative.filter(k=>t.includes(k)).length;
  if (p>n) return 'positive';
  if (n>p) return 'negative';
  return 'neutral';
}

function topicFor(text='') {
  const t=text.toLocaleLowerCase('tr-TR');
  if(/bilanço|finansal|ciro|favök|net kâr|net kar|gelir/.test(t)) return 'Finansal';
  if(/sözleşme|anlaşma|ihale|sipariş/.test(t)) return 'Sözleşme';
  if(/temettü|kar payı|kâr payı/.test(t)) return 'Temettü';
  if(/geri alım|pay geri/.test(t)) return 'Geri Alım';
  if(/yatırım|kapasite|fabrika|tesis/.test(t)) return 'Yatırım';
  if(/ceza|dava|soruşturma|rekabet kurumu/.test(t)) return 'Hukuk/Risk';
  if(/hedef fiyat|analist|aracı kurum|tavsiye/.test(t)) return 'Analist';
  return 'Haber';
}

async function getJson(url, timeout=7000){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/json,text/plain,*/*'},signal:ctl.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function getText(url, timeout=7000){
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(),timeout);
  try{
    const r=await fetch(url,{headers:{'user-agent':UA,'accept':'application/rss+xml,application/xml,text/xml,*/*'},signal:ctl.signal});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function yahooNews(query){
  const url=`https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=1&newsCount=10&listsCount=0&enableFuzzyQuery=false`;
  const j=await getJson(url);
  return (j.news||[]).map(n=>({
    title:n.title||'',
    publisher:n.publisher||'Yahoo Finance',
    url:n.link||'',
    publishedAt:Number.isFinite(n.providerPublishTime)?new Date(n.providerPublishTime*1000).toISOString():null,
    source:'Yahoo',
    thumbnail:n.thumbnail?.resolutions?.[0]?.url||null
  })).filter(x=>x.title&&x.url);
}

function tag(block,name){
  const m=block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'));
  return m?decodeHtml(m[1]):'';
}

async function googleNews(query){
  const url=`https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=tr&gl=TR&ceid=TR:tr`;
  const xml=await getText(url);
  const items=[];
  const re=/<item>([\s\S]*?)<\/item>/gi;
  let m;
  while((m=re.exec(xml)) && items.length<12){
    const b=m[1];
    const title=tag(b,'title');
    const link=tag(b,'link');
    const pub=tag(b,'pubDate');
    const publisher=tag(b,'source')||'Google News';
    if(title&&link) items.push({title,publisher,url:link,publishedAt:pub?new Date(pub).toISOString():null,source:'Google News',thumbnail:null});
  }
  return items;
}

function dedupe(items){
  const seen=new Set(); const out=[];
  for(const x of items){
    const key=x.title.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/g,' ').trim().slice(0,120);
    if(!key||seen.has(key)) continue;
    seen.add(key);
    const tone=toneFor(x.title);
    out.push({...x,tone,topic:topicFor(x.title)});
  }
  return out.sort((a,b)=>new Date(b.publishedAt||0)-new Date(a.publishedAt||0));
}

module.exports=async function handler(req,res){
  if(req.method!=='GET') return res.status(405).json({ok:false,error:'Method not allowed'});
  const market=String(req.query?.market||'')==='1';
  const symbol=String(req.query?.symbol||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
  const name=String(req.query?.name||'').replace(/[<>]/g,'').slice(0,120);
  if(!market&&!symbol) return res.status(400).json({ok:false,error:'symbol required'});

  const yahooQuery=market?'XU100.IS':`${symbol}.IS`;
  const googleQuery=market?'BIST 100 Borsa İstanbul':`${name||symbol} ${symbol} hisse Borsa İstanbul`;
  const results=await Promise.allSettled([yahooNews(yahooQuery),googleNews(googleQuery)]);
  const merged=[]; const errors=[];
  for(const r of results){ if(r.status==='fulfilled') merged.push(...r.value); else errors.push(r.reason?.message||'news source failed'); }
  const items=dedupe(merged).slice(0,12);
  const counts={positive:items.filter(x=>x.tone==='positive').length,negative:items.filter(x=>x.tone==='negative').length,neutral:items.filter(x=>x.tone==='neutral').length};
  res.setHeader('Cache-Control','s-maxage=600, stale-while-revalidate=300');
  return res.status(200).json({
    ok:true,
    symbol:market?'XU100':symbol,
    generatedAt:new Date().toISOString(),
    items,counts,
    kapSearchUrl: market?'https://www.kap.org.tr/tr':'https://www.kap.org.tr/tr/search/'+encodeURIComponent(symbol),
    sourceErrors:errors
  });
};
