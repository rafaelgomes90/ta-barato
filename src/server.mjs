import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {timingSafeEqual} from 'node:crypto';
import {parseProductLink,safeUrl,validAffiliateUrl} from './links.mjs';
import {analyze} from './analyze.mjs';
import {saveOffer,countOffers,recordEvent} from './db.mjs';

const folder=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../public');
const host=process.env.HOST||'127.0.0.1';
const port=Number(process.env.PORT||3000);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.webmanifest':'application/manifest+json'};
const traffic=new Map();
function respond(res,status,body){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(body));}
function authorized(req){
 const expected=process.env.ADMIN_IMPORT_TOKEN||''; const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
 if (!expected || !token) return false;const a=Buffer.from(expected),b=Buffer.from(token);
 return a.length===b.length && timingSafeEqual(a,b);
}
function rateLimited(req){
  // Se publicar atrás de Nginx, só aceite X-Forwarded-For se o proxy for confiável;
  // por padrão usamos a conexão de origem para evitar spoofing.
  const remote=req.socket.remoteAddress||'unknown';
  const isLocalProxy=/^(::ffff:)?(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|^::1$/.test(remote); // proxy local ou rede interna do Docker
  const xreal=String(req.headers['x-real-ip']||'').trim();
  const ip=isLocalProxy && /^[0-9a-fA-F:.]{3,45}$/.test(xreal) ? xreal : remote;
  const now=Date.now();const r=traffic.get(ip)||{start:now,count:0};
  if(now-r.start>60000){r.start=now;r.count=0;}
  r.count++;traffic.set(ip,r);
  if (traffic.size>20000) for(const [k,v] of traffic) if(now-v.start>180000) traffic.delete(k);
  return r.count>45;
}
async function readJson(req){
  let body='',bytes=0;
  for await(const chunk of req){bytes+=chunk.length;if(bytes>128000)throw new Error('Requisição muito grande.');body+=chunk;}
  try {return JSON.parse(body);}catch{throw new Error('JSON inválido.');}
}
function isAdminItem(o){
 if(!o||typeof o!=='object') throw new Error('Oferta inválida.');
 const parsed=parseProductLink(o.url);
 if(o.marketplace && o.marketplace!==parsed.marketplace) throw new Error('Marketplace não corresponde ao link.');
 if(typeof o.title!=='string'||o.title.trim().length<5||o.title.length>250)throw new Error('Informe o título do item (mínimo 5 caracteres).');
 if(typeof o.productKey!=='string'||o.productKey.trim().length<3||o.productKey.length>120)throw new Error('Informe productKey, idêntico apenas para o mesmo SKU/variação.');
 const price=Number(o.price),ship=Number(o.shipping||0);
 if(!Number.isFinite(price)||price<=0||price>10000000||!Number.isFinite(ship)||ship<0||ship>100000)throw new Error('Preço ou frete inválido.');
 const affiliate=o.affiliateUrl?validAffiliateUrl(o.affiliateUrl,parsed.marketplace):null;
 if(o.affiliateUrl&&!affiliate)throw new Error('Link afiliado precisa ser HTTPS e apontar para o marketplace do produto.');
 const image=o.imageUrl?safeUrl(o.imageUrl).href:null;
 if(image && !/\.(png|jpe?g|webp)(\?|$)/i.test(image))throw new Error('Use uma imagem HTTPS direta PNG/JPEG/WebP.');
 const coupon=o.couponCode ? String(o.couponCode).trim() : null;
 if(coupon && !/^[A-Z0-9_-]{3,30}$/i.test(coupon))throw new Error('Código de cupom inválido.');
 return { marketplace:parsed.marketplace,externalId:parsed.externalId,
   productKey:o.productKey.trim().toLowerCase(),title:o.title.trim(),variant:String(o.variant||'').slice(0,120),
   price,shipping:ship,originalPrice:o.originalPrice?Number(o.originalPrice):null,url:parsed.canonicalUrl,
   affiliateUrl:affiliate,imageUrl:image,couponCode:coupon,
   couponDiscount:coupon?Number(o.couponDiscount||0):null,couponMin:coupon?Number(o.couponMin||0):null,source:'curadoria' };
}
const server=http.createServer(async(req,res)=>{
  try {
    if(req.method==='GET'&&req.url==='/api/health')return respond(res,200,{ok:true,curatedOffers:countOffers(),meliConfigured:!!process.env.MERCADOLIVRE_ACCESS_TOKEN,shopeeConfigured:!!(process.env.SHOPEE_APP_ID&&process.env.SHOPEE_SECRET)});
    if(req.url==='/api/analyze'&&req.method==='POST'){
      if(rateLimited(req))return respond(res,429,{error:'Muitas consultas. Tente novamente em instantes.'});
      const obj=await readJson(req);
      return respond(res,200,await analyze(obj));
    }
    if(req.url==='/api/admin/import'&&req.method==='POST'){
      if(!authorized(req))return respond(res,401,{error:'Não autorizado.'});
      const obj=await readJson(req);const items=Array.isArray(obj.offers)?obj.offers:[];
      if(!items.length||items.length>200)return respond(res,400,{error:'Envie 1 a 200 ofertas por lote.'});
      const data=items.map(isAdminItem);const saved=data.map(saveOffer);
      return respond(res,200,{ok:true,imported:saved.length});
    }
    if(req.url==='/api/affiliate-click'&&req.method==='POST'){
      const obj=await readJson(req);
      const parsed=parseProductLink(obj.productUrl);
      // Contagem agregada; o link já é mostrado ao consumidor e aberto no clique voluntário.
      recordEvent('affiliate_click',parsed.marketplace);
      return respond(res,200,{ok:true});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return respond(res,405,{error:'Método não permitido.'});
    const pathname=decodeURIComponent(new URL(req.url||'/',`http://${host}:${port}`).pathname);
    const relative=pathname==='/'?'/index.html':pathname;
    const target=path.resolve(folder,'.'+relative);
    if(!target.startsWith(folder+path.sep))return respond(res,403,{error:'Acesso negado.'});
    if(!existsSync(target))return respond(res,404,{error:'Não encontrado.'});
    const s=await stat(target);if(!s.isFile())return respond(res,404,{error:'Não encontrado.'});
    const b=await readFile(target);res.writeHead(200,{'Content-Type':mime[path.extname(target)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':'public, max-age=600','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY'});
    res.end(req.method==='HEAD'?null:b);
  }catch(e){respond(res,400,{error:e?.message||'Ocorreu um erro inesperado.'});}
});
server.listen(port,host,()=>console.log(`Tá Barato? => http://${host}:${port}`));
