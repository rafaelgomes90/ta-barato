const ML_HOSTS = new Set(['mercadolivre.com.br','www.mercadolivre.com.br','produto.mercadolivre.com.br','mercadolivre.com','www.mercadolivre.com']);
const SH_HOSTS = new Set(['shopee.com.br','www.shopee.com.br']);
const SHORT_HOSTS = new Set(['meli.la','shope.ee','s.shopee.com.br']);
const AFF_HOSTS = new Set([...ML_HOSTS,...SH_HOSTS,...SHORT_HOSTS]);

export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 2500) throw new Error('Cole uma URL válida de produto.');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('Cole uma URL completa, começando com https://.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) throw new Error('Somente links HTTPS públicos são aceitos.');
  return url;
}

export function parseProductLink(value) {
  const u = safeUrl(value);
  const host = u.hostname.toLowerCase();
  if (SHORT_HOSTS.has(host)) throw new Error('Este é um link curto. Abra-o e copie a URL completa do produto para analisar.');
  if (ML_HOSTS.has(host)) {
    const match = (u.pathname + u.search).match(/MLB-?(\d{7,})/i);
    if (!match) throw new Error('Não encontrei o código do anúncio Mercado Livre. Cole o link de um anúncio específico.');
    // /p/MLB... é página de catálogo: o preço vem do menor anúncio novo do produto.
    if (/\/p\/MLB/i.test(u.pathname)) return { marketplace:'mercadolivre', kind:'catalog', productId:'MLB'+match[1], externalId:'P-MLB'+match[1], canonicalUrl:`${u.origin}${u.pathname}` };
    const sm = u.pathname.match(/MLB-?\d{7,}-([a-z0-9-]+?)(?:-_JM)?(?:\/|$)/i);
    return { marketplace:'mercadolivre', externalId:'MLB'+match[1], slug:sm?sm[1]:'', canonicalUrl:`${u.origin}${u.pathname}` };
  }
  if (SH_HOSTS.has(host)) {
    const path = u.pathname;
    let m = path.match(/-i\.(\d+)\.(\d+)/i) || path.match(/\/(?:product|opaanlp)\/(\d+)\/(\d+)/i);
    if (!m && u.searchParams.get('shopid') && u.searchParams.get('itemid')) m = [null, u.searchParams.get('shopid'),u.searchParams.get('itemid')];
    if (!m || !/^\d+$/.test(m[1]) || !/^\d+$/.test(m[2])) throw new Error('Não encontrei os códigos da loja e do produto Shopee. Cole o link completo do item.');
    return { marketplace:'shopee', externalId:`${m[1]}:${m[2]}`, shopId:m[1], itemId:m[2], canonicalUrl:`https://shopee.com.br/product/${m[1]}/${m[2]}` };
  }
  throw new Error('Nesta versão, aceitamos links de produtos do Mercado Livre e da Shopee.');
}

export function validAffiliateUrl(raw, marketplace) {
  if (!raw) return null;
  let url;
  try { url = safeUrl(raw); } catch { return null; }
  if (!AFF_HOSTS.has(url.hostname.toLowerCase())) return null;
  if (marketplace === 'mercadolivre' && !ML_HOSTS.has(url.hostname.toLowerCase()) && url.hostname !== 'meli.la') return null;
  if (marketplace === 'shopee' && !SH_HOSTS.has(url.hostname.toLowerCase()) && !['shope.ee','s.shopee.com.br'].includes(url.hostname.toLowerCase())) return null;
  return raw;
}
