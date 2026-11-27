import {parseOrder,formatOrder} from './paste-order.js';
const $ = id => document.getElementById(id);
const api = location.hostname === 'graceyiyo-cloud.github.io'
  ? 'https://yi-qi-dian-can.graceyiyo.chatgpt.site/api/groups' : '/api/groups';
let current, entryId, generation = 0, refreshTimer;
const node = (tag, text) => Object.assign(document.createElement(tag), {textContent:text});
function notice(text='') {
  $('message').textContent=text;
  $('message').hidden=!text;
}
async function request(url, options) {
  const response=await fetch(url,{cache:'no-store',...options});
  if (!response.ok) throw Error((await response.json().catch(()=>({}))).error || '連線失敗，請重試');
  return response.json();
}
function field(label, attributes) {
  const wrapper=node('label',label);
  const input=Object.assign(document.createElement('input'),attributes);
  wrapper.append(input);
  return wrapper;
}
function addProduct() {
  const row=node('div','');
  row.className='product';
  const remove=node('button','移除');
  remove.type='button';
  remove.onclick=()=>{if($('products').children.length>1)row.remove();};
  row.append(field('品名',{name:'product',maxLength:80}),field('單價（元）',{name:'price',type:'number',min:'0',max:'99999',step:'1'}),remove);
  $('products').append(row);
}
$('add').onclick=()=>{if($('products').children.length<60)addProduct();};
function formatChain(group) {
  const blocks=group.entries.map(e=>{
    if(e.pasted)return formatOrder(e.pasted);
    const total=e.quantities.reduce((sum,q,i)=>sum+q*group.items[i].price,0);
    return [e.name+' '+total+'元',...group.items.flatMap((item,i)=>e.quantities[i]?[item.name+' +'+e.quantities[i]]:[])].join('\n');
  });
  return [[group.title,group.notes,...group.items.map(p=>p.name+' $'+p.price),'=================='].filter(Boolean).join('\n'),...blocks].join('\n\n');
}
function totals() {
  const quantities=[...$('choices').querySelectorAll('input')].map(i=>Number(i.value));
  $('subtotal').textContent=quantities.reduce((sum,q,i)=>sum+q*current.items[i].price,0)+' 元';
  return quantities;
}
function showGroup(group,first) {
  current=group;
  $('title').textContent=group.title;
  $('notes').textContent=group.notes;
  $('menu').hidden=!group.menu;
  $('menu').href=api+'?id='+group.id+'&menu=1';
  if(first) {
    pasteId=crypto.randomUUID();
    $('paste-form').reset(); previewPaste();
    $('join').hidden=!group.items.length;
    entryId=crypto.randomUUID();
    $('join').reset();
    $('join').elements.name.value=localStorage.getItem('group-buy-name')||'';
    $('choices').replaceChildren(...group.items.map(p=>{
      const row=field(p.name+' · '+p.price+' 元',{type:'number',min:'0',max:'999',step:'1',placeholder:'0',inputMode:'numeric'});
      row.className='choice';
      return row;
    }));
    totals();
  }
  const count=group.entries.reduce((s,e)=>s+(e.pasted ? e.pasted.items.length : e.quantities.reduce((a,b)=>a+b,0)),0);
  const amount=group.entries.reduce((s,e)=>s+(e.pasted ? e.pasted.total : e.quantities.reduce((a,q,i)=>a+q*group.items[i].price,0)),0);
  $('stats').textContent=group.entries.length+' 筆接龍 · '+count+' 件 · 共 '+amount+' 元';
  $('chain').textContent=formatChain(group);
}
$('choices').oninput=totals;
async function refresh(first=false) {
  const token=generation, hash=location.hash.slice(1);
  if(hash==='new')return;
  try {
    const data=await request(api+(hash?'?id='+encodeURIComponent(hash):''));
    if(token!==generation)return;
    if(hash) {showGroup(data,first || !current); $('detail').hidden=false;}
    else {
      $('cards').replaceChildren(...data.map(g=>{
        const card=node('a',''); card.href='#'+g.id; card.className='card';
        card.append(node('strong',g.title),node('span',g.notes.split('\n')[0])); return card;
      }));
      if(!data.length)$('cards').textContent='還沒有團購，從「開新團」開始。';
    }
  } catch(e){if(token===generation)notice(e.message);}
}
function route() {
  clearInterval(refreshTimer); generation++; current=null; notice();
  const hash=location.hash.slice(1);
  $('list').hidden=!!hash; $('create').hidden=hash!=='new'; $('detail').hidden=true; $('new').hidden=hash==='new';
  window.scrollTo(0,0);
  if(hash && hash!=='new' && !/^[a-f0-9-]{36}$/.test(hash)){location.replace('#');return;}
  if(hash!=='new') {
    void refresh(true);
    refreshTimer=setInterval(()=>{if(!document.hidden)void refresh();},5000);
  }
}
$('create-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget, button=event.submitter, token=generation;
  const data=new FormData(form);
  if(data.get('menu')?.size>8*1024*1024){notice('菜單上限為 8 MB');return;}
  const rows=[...$('products').children].filter(row=>row.querySelector('[name=product]').value.trim() || row.querySelector('[name=price]').value);
  if(rows.some(row=>!row.querySelector('[name=product]').value.trim() || row.querySelector('[name=price]').value==='')){notice('預設品項請同時填入品名和單價');return;}
  const items=rows.map(row=>({name:row.querySelector('[name=product]').value.trim(),price:Number(row.querySelector('[name=price]').value)}));
  data.delete('product'); data.delete('price'); data.set('items',JSON.stringify(items));
  button.disabled=true;
  try {
    const group=await request(api,{method:'POST',body:data});
    form.reset(); $('products').replaceChildren(); addProduct();
    if(token===generation)location.replace('#'+group.id);
  } catch(e){notice(e.message);} finally{button.disabled=false;}
};
$('join').onsubmit=async event=>{
  event.preventDefault();
  const button=event.submitter, token=generation, name=$('join').elements.name.value.trim(), quantities=totals();
  if(!name || !quantities.some(q=>q>0)){notice('請填姓名及至少一項數量');return;}
  button.disabled=true;
  try {
    await request(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:entryId,group:current.id,name,quantities})});
    if(token!==generation)return;
    entryId=crypto.randomUUID(); localStorage.setItem('group-buy-name',name);
    $('choices').querySelectorAll('input').forEach(i=>i.value=''); totals(); notice('已加入接龍'); await refresh();
  } catch(e){notice(e.message);} finally{button.disabled=false;}
};
let pasteId;
function previewPaste() {
  const text=$('paste').value.trim();
  $('send-paste').disabled=true;
  $('preview').textContent='';
  if(!text)return;
  try {
    const order=parseOrder(text);
    $('preview').textContent=order.name+' · '+order.items.length+' 項 · NT$ '+order.total.toLocaleString('zh-TW');
    $('send-paste').disabled=false;
  } catch(e){$('preview').textContent=e.message;}
}
$('paste').oninput=previewPaste;
$('paste-form').onsubmit=async event=>{
  event.preventDefault();
  const token=generation, input=$('paste');
  if($('send-paste').disabled)return;
  input.readOnly=true; $('send-paste').disabled=true;
  try {
    await request(api,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:pasteId,group:current.id,text:input.value})});
    if(token!==generation)return;
    pasteId=crypto.randomUUID(); input.value=''; notice('已加入接龍'); await refresh();
  } catch(e){notice(e.message);} finally{input.readOnly=false;previewPaste();}
};
$('copy').onclick=async()=>{
  try {await navigator.clipboard.writeText($('chain').textContent);notice('已複製接龍，可以貼到 LINE');}
  catch {const range=document.createRange();range.selectNodeContents($('chain'));getSelection().removeAllRanges();getSelection().addRange(range);notice('已選取接龍文字，請按複製');}
};
window.addEventListener('hashchange',route);
addProduct();route();
