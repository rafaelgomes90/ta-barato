import { createHash } from 'node:crypto';

export async function fetchMeli(id) {
  if (!process.env.MERCADOLIVRE_ACCESS_TOKEN) return null;
  try {
    const r=await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(id)}`,{
      headers:{Authorization:`Bearer ${process.env.MERCADOLIVRE_ACCESS_TOKEN}`},signal:AbortSignal.timeout(6500)
    });
    if (!r.ok) return null;
    const x=await r.json();
    if (x.currency_id !== 'BRL' || !Number.isFinite(x.price) || x.price <= 0 || x.status !== 'active') return null;
    return { title:x.title, price:x.price, originalPrice:x.original_price || null,
      imageUrl:x.pictures?.[0]?.secure_url || x.thumbnail || null,
      url:x.permalink, source:'api_mercadolivre', variantUncertain:false };
  } catch { return null; }
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
