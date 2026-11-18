import { createHash } from 'node:crypto';

let meliTok={v:null,exp:0};
// Token do app (client_credentials) renovado sozinho; ou um token fixo em MERCADOLIVRE_ACCESS_TOKEN.
async function meliToken() {
  if (process.env.MERCADOLIVRE_ACCESS_TOKEN) return process.env.MERCADOLIVRE_ACCESS_TOKEN;
  const id=process.env.MERCADOLIVRE_APP_ID, secret=process.env.MERCADOLIVRE_SECRET;
  if (!id || !secret) return null;
  if (meliTok.v && Date.now() < meliTok.exp) return meliTok.v;
  try {
    const r=await fetch('https://api.mercadolibre.com/oauth/token',{method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'},
      body:new URLSearchParams({grant_type:'client_credentials',client_id:id,client_secret:secret}),signal:AbortSignal.timeout(6500)});
    if (!r.ok) return null;
    const x=await r.json();
    if (!x.access_token) return null;
    meliTok={v:x.access_token,exp:Date.now()+Math.max(60,(x.expires_in||3600)-120)*1000};
    return meliTok.v;
  } catch { return null; }
}

const ML='https://api.mercadolibre.com';
async function mget(path){
  const token=await meliToken();
  if (!token) return null;
  try {
    const r=await fetch(ML+path,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(6500)});
    if (r.status===401) meliTok={v:null,exp:0};
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// Ofertas de um produto de catálogo (até 300 anúncios), só BRL e novos.
async function catalogOffers(productId){
  const out=[];
  for (let off=0; off<300; off+=100){
    const x=await mget(`/products/${encodeURIComponent(productId)}/items?offset=${off}`);
    const rs=x?.results||[];
    for (const o of rs) if ((o.currency_id||'BRL')==='BRL' && Number(o.price)>0 && (!o.condition||o.condition==='new')) out.push(o);
    if (rs.length<100 || off+100>=(x?.paging?.total||0)) break;
  }
  return out;
}

// Compara o preço com os demais anúncios novos do mesmo produto (agora, não histórico).
function marketStats(offers,price){
  const v=offers.map(o=>Number(o.price)).filter(n=>n>0).sort((a,b)=>a-b);
  if (v.length<2) return null;
  return { count:v.length, min:v[0], median:v[Math.floor(v.length/2)], cheaper:v.filter(n=>n<price-0.005).length };
}

async function productInfo(productId){
  const p=await mget(`/products/${encodeURIComponent(productId)}`);
  return { title:p?.name||null, imageUrl:p?.pictures?.[0]?.url||null };
}

// Link de catálogo (/p/MLB...): menor preço entre os anúncios novos.
async function viaCatalogLink(p){
  const offers=await catalogOffers(p.productId);
  if (!offers.length) return null;
  const best=offers.reduce((m,o)=>Number(o.price)<Number(m.price)?o:m);
  const info=await productInfo(p.productId);
  return { title:info.title||p.productId, price:Number(best.price), originalPrice:best.original_price||null,
    imageUrl:info.imageUrl, url:p.canonicalUrl, source:'api_mercadolivre_catalogo', variantUncertain:false,
    market:marketStats(offers,Number(best.price)) };
}

// Link de anúncio (/MLB-123...): o ML não deixa ler /items com token de app, então achamos o
// produto de catálogo pelo título do link e só aceitamos se o MESMO anúncio estiver na lista.
async function viaSlug(p){
  const words=String(p.slug||'').split('-').filter(w=>w&&w!=='jm').slice(0,10);
  if (words.length<2) return null;
  const s=await mget(`/products/search?site_id=MLB&status=active&limit=5&q=${encodeURIComponent(words.join(' '))}`);
  const ids=(s?.results||[]).map(r=>r.id).filter(Boolean);
  const found=await Promise.all(ids.map(async id=>{
    const offers=await catalogOffers(id);
    const hit=offers.find(o=>o.item_id===p.externalId);
    return hit?{id,hit,offers}:null;
  }));
  const m=found.find(Boolean);
  if (!m) return null;
  const info=await productInfo(m.id);
  return { title:info.title||words.join(' '), price:Number(m.hit.price), originalPrice:m.hit.original_price||null,
    imageUrl:info.imageUrl, url:p.canonicalUrl, source:'api_mercadolivre_catalogo', variantUncertain:false,
    market:marketStats(m.offers,Number(m.hit.price)) };
}

export async function fetchMeli(p){
  if (typeof p==='string') p={externalId:p};
  if (p.kind==='catalog') return viaCatalogLink(p);
  if (process.env.MERCADOLIVRE_ACCESS_TOKEN){ // token de usuário: lê o anúncio direto
    const x=await mget(`/items/${encodeURIComponent(p.externalId)}`);
    if (x && x.currency_id==='BRL' && Number.isFinite(x.price) && x.price>0 && x.status==='active')
      return { title:x.title, price:x.price, originalPrice:x.original_price||null,
        imageUrl:x.pictures?.[0]?.secure_url||x.thumbnail||null, url:x.permalink, source:'api_mercadolivre', variantUncertain:false };
  }
  return viaSlug(p);
}

export async function fetchShopee(shopId,itemId) {
  if (!process.env.SHOPEE_APP_ID || !process.env.SHOPEE_SECRET) return null;
  try {
    // Consulta documentada pelo Explorer da API de Afiliados; permissões variam por conta.
    const q=`query { productOfferV2(shopId: ${Number(shopId)}, itemId: ${Number(itemId)}, page: 1, limit: 5) { nodes { shopId itemId productName productLink offerLink imageUrl priceMin priceMax } } }`;
    const payload=JSON.stringify({query:q});
    const ts=Math.floor(Date.now()/1000).toString();
    const signature=createHash('sha256').update(process.env.SHOPEE_APP_ID+ts+payload+process.env.SHOPEE_SECRET).digest('hex');
    const r=await fetch('https://open-api.affiliate.shopee.com.br/graphql',{
      method:'POST',headers:{'Content-Type':'application/json',Authorization:`SHA256 Credential=${process.env.SHOPEE_APP_ID}, Timestamp=${ts}, Signature=${signature}`},body:payload,signal:AbortSignal.timeout(6500)
    });
    if (!r.ok) return null;
    const x=await r.json();
    const hit=x?.data?.productOfferV2?.nodes?.find(z=>String(z.shopId)===String(shopId)&&String(z.itemId)===String(itemId));
    if (!hit) return null;
    const min=Number(hit.priceMin),max=Number(hit.priceMax);
    if (!Number.isFinite(min)||min<=0) return null;
    return {title:hit.productName,price:min,originalPrice:null,imageUrl:hit.imageUrl,
      url:hit.productLink,affiliateUrl:hit.offerLink,source:'api_shopee',variantUncertain:!Number.isFinite(max)||Math.abs(max-min)>0.01};
  } catch { return null; }
}
