const $ = s => document.querySelector(s);
const form=$('#searchForm'), urlInput=$('#productUrl'), btn=$('#submitBtn'), area=$('#resultArea'), content=$('#resultContent'), searchError=$('#searchError');
const money=n=>typeof n==='number'&&Number.isFinite(n)?n.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}):'Não confirmado';
const clean=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const icon=(name)=>`<svg aria-hidden="true"><use href="#ic-${name}"></use></svg>`;
const when=(s)=>{if(!s)return 'Data não disponível'; const d=new Date(s);return Number.isNaN(d.getTime())?'Data não disponível':`Atualizado em ${d.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}`};
const showResult=()=>{area.hidden=false;requestAnimationFrame(()=>area.scrollIntoView({behavior:'smooth',block:'start'}))};

function renderChart(history) {
  if (!history || history.length<2) return '';
  const ys=history.map(p=>p.price),min=Math.min(...ys),max=Math.max(...ys),delta=Math.max(1,max-min);
  const points=history.map((p,i)=>`${(i/(history.length-1))*620},${85-((p.price-min)/delta)*60}`).join(' ');
  return `<div class="result-history"><h4>Histórico de até 30 dias • valores registrados</h4><svg viewBox="0 0 620 102" class="history-svg" role="img" aria-label="Gráfico do histórico de preços"><line x1="0" x2="620" y1="85" y2="85" stroke="#e3ebe1" stroke-width="1"/><polyline points="${points}" fill="none" stroke="#4c995e" stroke-linecap="round" stroke-linejoin="round" stroke-width="3"/></svg><div class="source">Menor registro: ${money(min)} · Maior registro: ${money(max)} · As medições não representam necessariamente todos os preços do mercado.</div></div>`;
}
function productHTML(p, fallback){
 const shop=p?.marketplace||fallback||'mercadolivre';
 const label=shop==='mercadolivre'?'Mercado Livre':'Shopee';
 const picture=p?.imageUrl?`<img class="result-thumb" src="${clean(p.imageUrl)}" alt="Produto analisado" loading="lazy" referrerpolicy="no-referrer">`:`<div class="result-thumb">${icon('tag')}</div>`;
 return `<div class="result-product">${picture}<div><div class="result-id">${clean(label)} • ${p?'Preço encontrado':'Link reconhecido'}</div><div class="result-name">${clean(p?.title||'Produto ainda não identificado')}</div>${p?.variant?`<div class="result-variant">Variação: ${clean(p.variant)}</div>`:''}</div></div>`;
}
function actionLink(url,text,extraClass='',isAffiliate=false,productUrl=''){
 if(!url || !/^https:\/\//.test(url))return '';
 return `<a class="buy-link ${extraClass}" href="${clean(url)}" target="_blank" rel="sponsored noopener noreferrer" data-affiliate="${isAffiliate?'1':'0'}" data-product-url="${clean(productUrl)}">${clean(text)} ${icon('arrow')}</a>`;
}
function renderResponse(data, demo=false){
 const p=data.product,other=data.comparison;
 const verdicts={good:'Preço promissor',better:'Oferta alternativa',high:'Preço acima do habitual',fair:'Preço comum',unknown:'Análise inconclusiva'};
 const code=verdicts[data.verdict]||'Análise inconclusiva';
 const button = p ? actionLink(p.affiliateUrl||p.url,p.affiliateUrl?'Ver anúncio pelo link parceiro':'Ver anúncio original',p.affiliateUrl?'':'secondary',!!p.affiliateUrl,data.url) : actionLink(data.url,'Ver anúncio original','secondary',false,data.url);
 const compareAction=other?actionLink(other.affiliateUrl||other.url,other.affiliateUrl?'Ver oferta mais barata • parceiro':'Ver oferta mais barata',other.affiliateUrl?'':'secondary',!!other.affiliateUrl,other.url):'';
 const shipping = p?.shipping?` · Frete considerado: ${money(p.shipping)}`:' · Frete não validado para o seu CEP';
 const productPrice = p?`<div class="price-label">Preço registrado</div><div class="price-value">${money(p.finalPrice)}</div><div class="source">${when(p.verifiedAt)}${shipping}</div>`:`<div class="price-label">Preço verificado</div><div class="price-value">—</div><div class="source">${data.userDeclaredPrice?`Você informou ${money(data.userDeclaredPrice)}, mas esse valor não foi confirmado na loja.`:'Não foi possível consultar o preço com as integrações e a base disponíveis.'}</div>`;
 content.innerHTML=`${demo?'<div class="demo-notice">Demonstração fictícia: estes valores não são preços reais nem ofertas disponíveis.</div>':''}<article class="analysis-result">${productHTML(p,data.marketplace)}<div class="result-content"><div class="verdict-block ${clean(data.verdict)}"><div class="pill">${clean(code)}</div><h3>${clean(data.headline)}</h3><p>${clean(data.detail)}</p></div><div class="result-prices">${productPrice}${p?.coupon?`<div class="coupon-tag">Cupom cadastrado: ${clean(p.coupon.code)} • verifique as regras no checkout</div>`:''}<div class="result-actions">${demo?'':button}</div></div></div>${other?`<div class="compare-box"><div><strong>Outra oferta do mesmo produto</strong><p>${clean(other.title)} · ${clean(other.marketplace==='mercadolivre'?'Mercado Livre':'Shopee')} · ${when(other.verifiedAt)}</p></div><div><div class="saving">${money(other.finalPrice)}</div>${demo?'':compareAction}</div></div>`:''}${renderChart(data.history)}<div class="result-foot">${clean(data.disclosure||'Alguns links são afiliados e só são usados após clique voluntário.')} ${demo?'Demonstração sem links comerciais.':'Confira preço final, frete, estoque, cupons e versão do produto antes de comprar.'}</div></article>`;
 showResult();
}
function makeDemo(){
 const today=new Date().toISOString();
 return {marketplace:'mercadolivre',verdict:'better',headline:'Encontramos uma opção mais barata',detail:'Exemplo: o mesmo modelo, com as mesmas características, apareceu em um anúncio mais econômico.',url:'',product:{marketplace:'mercadolivre',title:'Fone Bluetooth Modelo X (fictício)',variant:'Cor preta • Exemplo',price:249.9,shipping:0,finalPrice:249.9,source:'demonstracao',verifiedAt:today,url:''},comparison:{marketplace:'shopee',title:'Fone Bluetooth Modelo X (fictício)',finalPrice:219.9,verifiedAt:today,url:''},disclosure:'Esta é apenas uma simulação da experiência.',history:Array.from({length:12},(_,i)=>({day:`2026-11-${String(i+1).padStart(2,'0')}`,price:282-i*2.9+Math.sin(i)*6}))};
}
form.addEventListener('submit',async e=>{
 e.preventDefault();searchError.hidden=true;
 if(!urlInput.value.trim()){searchError.textContent='Cole o link do produto.';searchError.hidden=false;urlInput.focus();return}
 btn.disabled=true;btn.textContent='Analisando…';
 area.hidden=false;content.innerHTML='<div class="loading"><span class="spinner" aria-hidden="true"></span> Consultando fontes disponíveis e histórico…</div>';showResult();
 try{
   const r=await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:urlInput.value.trim()})});
   const data=await r.json();if(!r.ok||!data.ok)throw new Error(data.error||'Não foi possível fazer a análise.');
   renderResponse(data);
 }catch(err){area.hidden=true;searchError.textContent=err.message||'Erro desconhecido. Tente novamente.';searchError.hidden=false;urlInput.focus();window.scrollTo({top:0,behavior:'smooth'});}
 finally{btn.disabled=false;btn.innerHTML=`Analisar preço ${icon('arrow')}`;}
});
$('#demoBtn').addEventListener('click',()=>renderResponse(makeDemo(),true));
$('#closeResult').addEventListener('click',()=>{area.hidden=true;urlInput.focus();});
document.addEventListener('click',e=>{
 const a=e.target.closest?.('a[data-affiliate="1"]');
 if(a&&a.dataset.productUrl)fetch('/api/affiliate-click',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({productUrl:a.dataset.productUrl}),keepalive:true}).catch(()=>{});
});
