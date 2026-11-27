import {setMenu} from './menu-preview.js';
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
function addProduct(item,slot) {
  const row=node('div','');
  row.className='product';
  if(slot!==undefined)row.dataset.slot=String(slot);
  const remove=node('button','移除');
  remove.type='button';
  remove.onclick=()=>{row.remove(); if(!$('products').children.length)addProduct();};
  row.append(field('品名',{name:'product',maxLength:80}),field('單價（元）',{name:'price',type:'number',min:'0',max:'99999',step:'1'}),remove);
  if(item){row.querySelector('[name=product]').value=item.name;row.querySelector('[name=price]').value=item.price;}
  $('products').append(row);
}
$('add').onclick=()=>{if($('products').children.length<60)addProduct();};
function entryText(group,e) {
  if(e.pasted)return formatOrder(e.pasted);
  const total=e.quantities.reduce((sum,q,i)=>sum+q*group.items[i].price,0);
  return [e.name+' '+total+'元',...group.items.flatMap((item,i)=>e.quantities[i]?[item.name+' +'+e.quantities[i]]:[])].join('\n');
}
function headingText(group){
  return [group.title,group.notes,...group.items.filter(i=>!i.inactive).map(p=>p.name+' $'+p.price),'=================='].filter(Boolean).join('\n');
}
function formatChain(group) {
  return [headingText(group),...group.entries.map(e=>entryText(group,e))].join('\n\n');
}
let editingEntry=null,editingGroup=false;
function showCatalog(group,values=[]) {
  $('choices').replaceChildren(...group.items.map((p,i)=>{
    const row=field(p.name+' · '+p.price+' 元'+(p.inactive?'（已移除）':''),{type:'number',min:'0',max:String(p.inactive?(values[i]||0):999),step:'1',placeholder:'0',inputMode:'numeric',value:values[i]||''});
    row.className='choice';
    row.hidden=!!p.inactive && !values[i];
    return row;
  }));
  totals();
}
function totals() {
  const quantities=[...$('choices').querySelectorAll('input')].map(i=>Number(i.value));
  $('subtotal').textContent=quantities.reduce((sum,q,i)=>sum+q*current.items[i].price,0)+' 元';
  return quantities;
}
function showGroup(group,first) {
  const catalogChanged=current && JSON.stringify(current.items)!==JSON.stringify(group.items);
  current=group;
  $('title').textContent=group.title;
  $('notes').textContent=group.notes;
  setMenu(group.menu ? api+'?id='+group.id+'&menu=1&v='+group.revision : '');
  $('edit-group').href='#'+group.id+'/edit';
  if(first) {
    pasteId=crypto.randomUUID();
    $('paste-form').reset(); previewPaste();
    $('join').hidden=!group.items.length;
    entryId=crypto.randomUUID();
    $('join').reset();
    $('join').elements.name.value=localStorage.getItem('group-buy-name')||'';
    showCatalog(group);
  } else if(catalogChanged) {
    const values=[...$('choices').querySelectorAll('input')].map((el,i)=>group.items[i]?.inactive?0:Number(el.value));
    showCatalog(group,values);
    notice('團購品項已更新，請確認數量與金額');
  }
  $('join').hidden=!group.items.some(p=>!p.inactive);

  const count=group.entries.reduce((s,e)=>s+(e.pasted ? e.pasted.items.length : e.quantities.reduce((a,b)=>a+b,0)),0);
  const amount=group.entries.reduce((s,e)=>s+(e.pasted ? e.pasted.total : e.quantities.reduce((a,q,i)=>a+q*group.items[i].price,0)),0);
  $('stats').textContent=group.entries.length+' 筆接龍 · '+count+' 件 · 共 '+amount+' 元';
  $('chain').replaceChildren(node('pre',headingText(group)),...group.entries.map(e=>{
    const row=node('div',''),link=node('a','修改');
    row.className='entry';link.dataset.edit='';link.href='#'+group.id+'/entry/'+e.id;
    link.setAttribute('aria-label','修改 '+e.name+' 的接龍');
    row.append(node('pre',entryText(group,e)),link);return row;
  }));
}
$('choices').oninput=totals;
async function refresh(first=false) {
  const token=generation, hash=location.hash.slice(1);
  if(hash==='new')return;
  try {
    const data=await request(api+(hash?'?id='+encodeURIComponent(hash):''));
    if(token!==generation)return;
    if(hash) {showGroup(data,!current); $('detail').hidden=false;}
    else {
      $('cards').replaceChildren(...data.map(g=>{
        const card=node('a',''); card.href='#'+g.id; card.className='card';
        card.append(node('strong',g.title),node('span',g.notes.split('\n')[0])); return card;
      }));
      if(!data.length)$('cards').textContent='還沒有團購，從「開新團」開始。';
    }
  } catch(e){if(token===generation)notice(e.message);}
}
function groupForm(group) {
  const form=$('create-form');
  editingGroup=!!group;
  form.reset();
  $('products').replaceChildren();
  group?.items.forEach((item,i)=>{if(!item.inactive)addProduct(item,i);});
  if(!$('products').children.length)addProduct();
  form.elements.title.value=group?.title ?? '';
  form.elements.notes.value=group?.notes ?? '';
  $('group-heading').textContent=group?'編輯團購':'開新團';
  $('save-group').textContent=group?'儲存團購':'開始收單';
  $('form-back').href=group?'#'+group.id:'#';
  $('form-back').textContent=group?'取消修改':'‹ 全部團購';
  $('remove-menu-label').hidden=!group?.menu;
  $('price-note').hidden=!group?.items.some(p=>!p.inactive);
  $('create').hidden=false;
}
function leaveEditor() {
  if(history.state?.fromGroup===current.id)history.back();
  else location.replace('#'+current.id);
}
document.addEventListener('click',e=>{
  const link=e.target.closest?.('a');
  if(!link || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button!==0)return;
  if(link.hasAttribute('data-edit') && current) {
    e.preventDefault();history.pushState({fromGroup:current.id},'',link.href);route();
  } else if((editingGroup || editingEntry) && (link.id==='entry-back' || link.id==='form-back')){
    e.preventDefault();leaveEditor();
  }
});
async function route() {
  setMenu('');
  clearInterval(refreshTimer); const token=++generation;
  current=null;editingEntry=null;editingGroup=false;notice();
  const hash=location.hash.slice(1);
  $('list').hidden=!!hash;$('detail').hidden=true;$('create').hidden=true;
  $('new').hidden=hash==='new';$('edit-group').hidden=false;$('results').hidden=false;
  $('entry-back').hidden=true;$('paste-form').hidden=false;$('detail').classList.remove('editing');
  $('join').querySelector('h2').textContent='依品項填數量';
  $('paste-form').querySelector('h2').textContent='整段貼上訂單';
  $('send-paste').textContent='確認加入接龍';$('join').querySelector('button').textContent='加入接龍';
  window.scrollTo(0,0);
  if(hash==='new'){groupForm(null);return;}
  const match=hash.match(/^([a-f0-9-]{36})\/(edit|entry\/([a-f0-9-]{36}))$/);
  if(match){
    try {
      const group=await request(api+'?id='+match[1]);
      if(token!==generation)return;
      current=group;
      if(match[2]==='edit'){groupForm(group);return;}
      const entry=group.entries.find(e=>e.id===match[3]);
      if(!entry){location.replace('#'+group.id);return;}
      showGroup(group,true); editingEntry=entry;
      $('detail').hidden=false;$('detail').classList.add('editing');
      $('entry-back').href='#'+group.id;$('entry-back').hidden=false;
      $('results').hidden=true;$('edit-group').hidden=true;
      $('paste-form').hidden=!entry.pasted;$('join').hidden=!!entry.pasted;
      if(entry.pasted){
        $('paste-form').querySelector('h2').textContent='修改接龍';
        $('paste').value=formatOrder(entry.pasted);previewPaste();$('send-paste').textContent='儲存修改';
      }else{
        $('join').querySelector('h2').textContent='修改接龍';$('join').elements.name.value=entry.name;
        showCatalog(group,entry.quantities);$('join').querySelector('button').textContent='儲存修改';
      }
    }catch(e){if(token===generation)notice(e.message);}
    return;
  }
  if(hash && !/^[a-f0-9-]{36}$/.test(hash)){location.replace('#');return;}
  void refresh(true);
  refreshTimer=setInterval(()=>{if(!document.hidden)void refresh();},5000);
}
$('create-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget, button=event.submitter, token=generation;
  const data=new FormData(form);
  if(data.get('menu')?.size>8*1024*1024){notice('菜單上限為 8 MB');return;}
  const rows=[...$('products').children].filter(row=>row.querySelector('[name=product]').value.trim() || row.querySelector('[name=price]').value);
  if(rows.some(row=>!row.querySelector('[name=product]').value.trim() || row.querySelector('[name=price]').value==='')){notice('預設品項請同時填入品名和單價');return;}
  const items=rows.map(row=>({name:row.querySelector('[name=product]').value.trim(),price:Number(row.querySelector('[name=price]').value)}));
  if(editingGroup) {
    data.set('id',current.id); data.set('revision',current.revision);
    data.set('slots',JSON.stringify(rows.map(row=>row.dataset.slot===undefined?null:Number(row.dataset.slot))));
  }
  data.delete('product'); data.delete('price'); data.set('items',JSON.stringify(items));
  button.disabled=true;
  try {
    const group=await request(api,{method:editingGroup?'PATCH':'POST',body:data});
    if(token!==generation)return;
    if(editingGroup){leaveEditor();return;}
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
    await request(api,{method:editingEntry?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editingEntry?.id ?? entryId,revision:editingEntry?.revision,groupRevision:current.revision,group:current.id,name,quantities})});
    if(token!==generation)return;
    if(editingEntry){leaveEditor();return;}
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
    await request(api,{method:editingEntry?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editingEntry?.id ?? pasteId,revision:editingEntry?.revision,group:current.id,text:input.value})});
    if(token!==generation)return;
    if(editingEntry){leaveEditor();return;}
    pasteId=crypto.randomUUID(); input.value=''; notice('已加入接龍'); await refresh();
  } catch(e){notice(e.message);} finally{input.readOnly=false;previewPaste();}
};
$('copy').onclick=async()=>{
  try {await navigator.clipboard.writeText(formatChain(current));notice('已複製接龍，可以貼到 LINE');}
  catch {
    const copy=document.createElement('textarea');
    copy.readOnly=true;copy.value=formatChain(current);
    copy.setAttribute('aria-label','接龍文字');$('chain').replaceChildren(copy);
    copy.focus();copy.select();notice('已選取接龍文字，請按複製');
    clearInterval(refreshTimer);
    copy.addEventListener('blur',()=>{if(copy.isConnected)route();},{once:true});
  }
};
window.addEventListener('hashchange',route);
route();
