import test from 'node:test';
import assert from 'node:assert/strict';
import {parseProductLink,validAffiliateUrl} from '../src/links.mjs';
test('reconhece anúncio Mercado Livre',()=>{
 const x=parseProductLink('https://produto.mercadolivre.com.br/MLB-1234567890-tenis-teste-_JM?utm_source=xxx');
 assert.equal(x.externalId,'MLB1234567890');assert.equal(x.marketplace,'mercadolivre');
});
test('reconhece Shopee pelo slug',()=>{
 const x=parseProductLink('https://shopee.com.br/produto-exemplo-i.123.456');
 assert.equal(x.externalId,'123:456');assert.equal(x.marketplace,'shopee');
});
test('reconhece Shopee por /product',()=>{
 const x=parseProductLink('https://shopee.com.br/product/2323/5656');
 assert.equal(x.externalId,'2323:5656');
});
test('bloqueia URL externa',()=>assert.throws(()=>parseProductLink('https://evil.com/MLB1234567890')));
test('bloqueia URL com credenciais',()=>assert.throws(()=>parseProductLink('https://user:pass@shopee.com.br/product/1/2')));
test('bloqueia endereço curto',()=>assert.throws(()=>parseProductLink('https://s.shopee.com.br/abc123')));
test('afiliado deve apontar para a loja correta',()=>{
 assert.equal(validAffiliateUrl('https://shopee.com.br/product/1/2','mercadolivre'),null);
 assert.ok(validAffiliateUrl('https://meli.la/abc123','mercadolivre'));
});
test('extrai o título do link do anúncio ML',()=>{
 const x=parseProductLink('https://produto.mercadolivre.com.br/MLB-3328166367-termometro-digital-febre-_JM');
 assert.equal(x.slug,'termometro-digital-febre');
});
test('link de catálogo /p/ vira produto',()=>{
 const x=parseProductLink('https://www.mercadolivre.com.br/tenis-x/p/MLB19876543');
 assert.equal(x.kind,'catalog');assert.equal(x.productId,'MLB19876543');
});
