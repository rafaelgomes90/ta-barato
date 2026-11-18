import {parseProductLink,validAffiliateUrl} from './links.mjs';
import {getOffer,saveOffer,relatedOffers,recentHistory,recordEvent} from './db.mjs';
import {fetchMeli,fetchShopee} from './providers.mjs';

const FRESH_MS=48*3600*1000;
const fresh=(iso)=>Date.now()-new Date(iso).getTime()<FRESH_MS;
const round=(n)=>Math.round(n*100)/100;
const money=(o)=>round(Number(o.price||0)+Number(o.shipping||0));
const productOut=(o)=>({title:o.title,variant:o.variant||null,marketplace:o.marketplace,price:o.price,
  shipping:o.shipping,finalPrice:money(o),originalPrice:o.original_price??null,imageUrl:o.image_url||null,
  verifiedAt:o.verified_at,source:o.source,affiliateUrl:validAffiliateUrl(o.affiliate_url,o.marketplace),url:o.url,
  coupon:o.coupon_code?{code:o.coupon_code,discount:o.coupon_discount,min:o.coupon_min}:null});

export async function analyze(input){
  const parsed=parseProductLink(input.url);
  recordEvent('analysis',parsed.marketplace);
  const stored=getOffer(parsed.marketplace,parsed.externalId);
  const live=parsed.marketplace==='mercadolivre'?await fetchMeli(parsed):await fetchShopee(parsed.shopId,parsed.itemId);
  let offer=stored;
  if (live && !live.variantUncertain) {
    offer=saveOffer({ marketplace:parsed.marketplace,externalId:parsed.externalId,
      productKey:stored?.product_key||`${parsed.marketplace}:${parsed.externalId}`,
      title:live.title,variant:stored?.variant||'',price:live.price,shipping:stored?.shipping||0,
      originalPrice:live.originalPrice,url:live.url || parsed.canonicalUrl,
      affiliateUrl:validAffiliateUrl(live.affiliateUrl,parsed.marketplace)||stored?.affiliate_url||null,
      imageUrl:live.imageUrl||stored?.image_url||null,source:live.source,
      couponCode:stored?.coupon_code,couponDiscount:stored?.coupon_discount,couponMin:stored?.coupon_min });
  }
  const typed=Number(input.declaredPrice);
  const hasTyped=input.declaredPrice!==undefined&&input.declaredPrice!==''&&Number.isFinite(typed)&&typed>0&&typed<10000000;
  const hasFreshOffer=Boolean(offer && fresh(offer.verified_at));
  const known=hasFreshOffer?productOut(offer):null;
  const productKey=offer?.product_key||`${parsed.marketplace}:${parsed.externalId}`;
  const others=relatedOffers(productKey).filter(o=>fresh(o.verified_at) && !(o.marketplace===parsed.marketplace && o.external_id===parsed.externalId));
  const lower=known?others.filter(o=>money(o)<=known.finalPrice*0.98&&known.finalPrice-money(o)>=10):[];
  const best=lower.length?productOut(lower[0]):null;
  const hist=recentHistory(productKey);
  const span=hist.length>1?(new Date(hist.at(-1).observed_at)-new Date(hist[0].observed_at))/86400000:0;
  // Não há avaliação robusta sem >= 7 medições espalhadas por ao menos 7 dias.
  const reliableHistory=hist.length>=7&&span>=7;
  const vals=hist.map(h=>h.total).sort((a,b)=>a-b);
  const median=vals.length?vals[Math.floor(vals.length/2)]:null;
  let verdict='unknown';let headline='Ainda não temos dados suficientes';let detail='Não seria correto afirmar que está barato ou que é Black Fraude sem um histórico confiável.';
  if (known){
    if (best) {verdict='better';headline='Encontramos uma oferta mais barata';detail='Outro anúncio do mesmo produto cadastrado na nossa base tem preço total menor. Confira disponibilidade, frete e variação antes de comprar.';}
    else if (reliableHistory&&known.finalPrice<=median*0.92) {verdict='good';headline='Preço abaixo do histórico observado';detail='O preço consultado está pelo menos 8% abaixo da mediana das observações dos últimos 30 dias.';}
    else if (reliableHistory&&known.finalPrice>=median*1.12) {verdict='high';headline='Preço acima do histórico observado';detail='O preço consultado está pelo menos 12% acima da mediana. Isso não prova fraude, mas merece atenção.';}
    else if (reliableHistory){verdict='fair';headline='Preço dentro da faixa habitual';detail='Pelo histórico observado, não encontramos evidência de desconto excepcional.';}
    else if (live?.market && live.market.count>=5 && Math.abs(live.price-known.price)<0.005) {
      const mk=live.market,br=(n)=>'R$ '+n.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      const pct=Math.round(Math.abs(1-known.price/mk.median)*100);
      const base=`Comparação com os ${mk.count} anúncios novos deste produto no Mercado Livre agora (mediana ${br(mk.median)}), não com o histórico de preços.`;
      const cheap=mk.min<known.price*0.98&&known.price-mk.min>=10?` Há anúncio por ${br(mk.min)}.`:'';
      if (known.price<=mk.median*0.90) {verdict='good';headline='Abaixo do preço dos outros vendedores';detail=`${base} Este está ${pct}% abaixo da mediana.${cheap}`;}
      else if (known.price>=mk.median*1.12) {verdict='high';headline='Acima do preço dos outros vendedores';detail=`${base} Este está ${pct}% acima da mediana.${cheap}`;}
      else {verdict='fair';headline='Na faixa de preço dos outros vendedores';detail=`${base}${cheap||' Sem diferença relevante.'}`;}
    }
    else {verdict='unknown';headline='Preço localizado, histórico insuficiente';detail='Temos uma cotação recente, mas ainda não há medições suficientes para julgar se é uma promoção verdadeira.';}
  } else if (live?.variantUncertain) {
    headline='Este anúncio tem várias faixas de preço';
    detail='O preço mínimo da Shopee pode corresponder a outra variação. Sem confirmar o SKU, não podemos dar um veredito.';
  } else if (hasTyped) {
    headline='Preço informado — ainda não verificado';
    detail='Você informou o valor, mas não conseguimos confirmar o anúncio. Não calcularemos um veredito usando esse preço como se fosse uma cotação da loja.';
  }
  const history=reliableHistory?hist.filter((h,i)=>i%Math.max(1,Math.floor(hist.length/50))===0).map(h=>({day:h.observed_at.slice(0,10),price:round(h.total)})):[];
  return {ok:true,marketplace:parsed.marketplace,externalId:parsed.externalId,verdict,headline,detail,
    product:known, comparison:best, estimatedSaving:best&&known?round(known.finalPrice-best.finalPrice):null,
    history, median30d:reliableHistory?round(median):null, sampleCount:hist.length,
    userDeclaredPrice:hasTyped?typed:null, observedVariantRange:!!live?.variantUncertain,
    url:parsed.canonicalUrl, disclosure:'Links de parceiros são identificados. Podemos receber comissão após um clique voluntário, sem custo extra.'};
}
