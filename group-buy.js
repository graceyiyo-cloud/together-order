import {summarizeGroup,splitOrderedItem} from './order-summary.js';
import {setMenu} from './menu-preview.js';
import {parseOrder,formatOrder} from './paste-order.js';
const $ = id => document.getElementById(id);
const api = location.hostname === 'graceyiyo-cloud.github.io'
  ? 'https://yi-qi-dian-can.graceyiyo.chatgpt.site/api/groups' : '/api/groups';
let current, entryId, generation = 0, refreshTimer;
const node = (tag, text) => Object.assign(document.createElement(tag), {textContent:text});
let summaryMode=false, listSnapshot='', resultSnapshot='';
const dateFormat=new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
const dateLabel=seconds=>dateFormat.format(new Date(seconds*1000));
function roundInfo(group) {
  const status=node('span',{open:'收單中',closed:'已截單',history:'已歸檔'}[group.state]);
  status.className='state '+group.state;
  const end=group.deadline ?? group.closedAt;
  const due=node('span',end ? (group.deadline?'截止 ':'截單 ')+dateLabel(end) : '未設截止時間');
  due.className='due';
  return [status,due];
}
function initPicker(box) {
  const row=node('div','');row.className='date-row';
  const date=document.createElement('input');date.type='date';date.name='endDate';date.setAttribute('aria-label','截止日期');
  date.addEventListener('click',()=>{try{date.showPicker?.();}catch{}});
  row.append(date);
  for (const [name,count,label] of [['endHour',24,'時'],['endMinute',60,'分']]) {
    const select=document.createElement('select');select.name=name;select.setAttribute('aria-label','截止'+label);
    for(let i=0;i<count;i++){const value=String(i).padStart(2,'0');select.add(new Option(value,value));}
    row.append(select,node('span',label));
  }
  const clear=node('button','清除');
  clear.type='button';clear.className='clear-date';clear.hidden=true;clear.setAttribute('aria-label','清除截止時間');
  clear.onclick=()=>{date.value='';date.oninput();};
  row.append(clear);
  date.oninput=()=>{
    row.querySelectorAll('select').forEach(el=>el.disabled=!date.value);
    clear.hidden=!date.value;
  };
  box.append(row);
}
document.querySelectorAll('.deadline-picker').forEach(initPicker);
function setDeadline(form,seconds) {
  const iso=seconds?new Date((seconds+28800)*1000).toISOString():'';
  form.elements.endDate.value=iso.slice(0,10);
  form.elements.endHour.value=iso.slice(11,13)||'17';
  form.elements.endMinute.value=iso.slice(14,16)||'00';
  form.elements.endDate.oninput();
}
function getDeadline(form) {
  const f=form.elements;
  return f.endDate.value ? Date.parse(f.endDate.value+'T'+f.endHour.value+':'+f.endMinute.value+':00+08:00')/1000 : null;
}
function summaryLines(group) {
  return summarizeGroup(group).rows.map(row=>
    row.name+' × '+row.count+'　'+formatMoney.format(row.amount)+' 元');
}
const formatMoney = new Intl.NumberFormat('zh-TW');
function showReceipt(group,summary) {
  $('receipt-title').textContent=group.title;
  const rows=summary.rows.map(item=>{
    const tr=document.createElement('tr');
    const name=node('th',item.name);
    name.scope='row';
    tr.append(name,node('td','$'+formatMoney.format(item.amount)),
      node('td',String(item.count)));
    return tr;
  });
  if(!rows.length){
    const tr=document.createElement('tr'),cell=node('td','目前沒有接龍。');
    cell.colSpan=3;cell.className='empty';tr.append(cell);rows.push(tr);
  }
  $('receipt-lines').replaceChildren(...rows);
  $('receipt-total').textContent='NT$ '+formatMoney.format(summary.amount);
}
function setResults(summary) {
  summaryMode=summary;
  $('summary').hidden=!summary;$('chain').hidden=summary;
  $('chain-tab').setAttribute('aria-pressed',String(!summary));
  $('summary-tab').setAttribute('aria-pressed',String(summary));
  $('copy').textContent=summary?'複製整理':'複製接龍';
}
$('summary-tab').onclick=()=>setResults(true);
$('chain-tab').onclick=()=>setResults(false);
$('quick-summary').onclick=()=>{
  setResults(true);
  $('summary-tab').focus({preventScroll:true});
  $('results').scrollIntoView({block:'start'});
};
function notice(text='') {
  $('message').textContent=text;
  $('message').hidden=!text;
}
async function request(url, options) {
  const response=await fetch(url,{cache:'no-store',...options});
  if (!response.ok) {
    const error = new Error((await response.json().catch(()=>({}))).error || '連線失敗，請重試');
    throw Object.assign(error,{status:response.status});
  }
  return response.json();
}
function linkedNote(text) {
  const fragment = document.createDocumentFragment();
  const urls = /(?:https?:\/\/|www\.)[^\s<>"‘’“”「」『』《》【】，。！？；、（）]+/giu;
  let offset = 0;
  for (const match of text.matchAll(urls)) {
    let label = match[0].replace(/[.,;:!?]+$/u,'');
    // Keep balanced parentheses in a URL, e.g. a Wikipedia article title.
    for (const [open,close] of [['(',')'],['[',']']]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length) {
        label = label.slice(0,-1);
      }
    }
    let url;
    try { url = new URL(/^www\./i.test(label) ? 'https://'+label : label); }
    catch { continue; }
    fragment.append(text.slice(offset,match.index));
    const link = node('a',label);
    link.href = url.href;
    link.className = 'note-link';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    fragment.append(link);
    offset = match.index + label.length;
  }
  fragment.append(text.slice(offset));
  return fragment;
}

function cardNotes(notes) {
  const [firstLine,...rest] = notes.trim().split(/\r?\n/);
  const block = node('dl','');
  block.className = 'group-note';
  const preview = node('dd','');
  block.append(node('dt','團購備註'),preview);
  preview.append(linkedNote(firstLine));
  const seen = new Set([...preview.querySelectorAll('a')].map(link=>link.href));
  for (const link of linkedNote(rest.join('\n')).querySelectorAll('a')) {
    if (seen.has(link.href)) continue;
    seen.add(link.href);
    if (preview.textContent) preview.append('\n');
    preview.append(link);
  }
  return block;
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
// Both kinds of entry share the pasted format, so a copied chain can be pasted back in.
function entryOrder(group,e) {
  if(e.pasted)return e.pasted;
  const items=group.items.flatMap((item,i)=>{
    const q=e.quantities[i];
    return q?[{name:item.name+(q>1?'+'+q:''),price:q*item.price}]:[];
  });
  return {name:e.name,items,total:items.reduce((sum,item)=>sum+item.price,0)};
}
const entryText=(group,e)=>formatOrder(entryOrder(group,e));
const myName=()=>localStorage.getItem('group-buy-name')?.trim() || '';
function markButton(group,e,field,label) {
  const button=node('button',label);
  button.type='button';button.className='mark';
  button.setAttribute('aria-pressed',String(!!e[field]));
  button.setAttribute('aria-label',label+'：'+e.name);
  button.onclick=async()=>{
    const token=generation,value=!e[field];
    button.disabled=true;
    try {
      await request(api,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'mark',group:group.id,id:e.id,field,value})});
      if(token!==generation)return;
      e[field]=value;button.setAttribute('aria-pressed',String(value));
      await refresh();
    } catch(error){if(token===generation)notice(error.message);} finally{button.disabled=false;}
  };
  return button;
}
function csvCell(value) {
  const text=String(value ?? '');
  return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
function download(name,type,content) {
  const url=URL.createObjectURL(new Blob([content],{type}));
  const link=Object.assign(document.createElement('a'),{href:url,download:name});
  document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Taipei'}).format(new Date()).replaceAll('-','');
const safeName=text=>text.replace(/[\\/:*?"<>|\r\n]+/g,' ').trim().slice(0,60) || '團購';
function exportCsv(group) {
  const rows=[['姓名','品項','數量','小計','已付款','已取貨']];
  for(const e of group.entries){
    for(const item of entryOrder(group,e).items){
      const {name,quantity}=splitOrderedItem(item.name);
      rows.push([e.name,name,quantity,item.price,e.paid?'是':'',e.picked?'是':'']);
    }
  }
  const summary=summarizeGroup(group);
  rows.push([],['品項整理','','數量','小計'],...summary.rows.map(r=>['',r.name,r.count,r.amount]),['合計','',summary.count,summary.amount]);
  download(safeName(group.title)+'_'+today()+'.csv','text/csv;charset=utf-8','﻿'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n'));
}
// The notes already sit at the top of the page, so the chain leaves them out.
function headingText(group){
  return [group.title,...group.items.filter(i=>!i.inactive).map(p=>p.name+' $'+p.price),'=================='].filter(Boolean).join('\n');
}
function formatChain(group) {
  return [headingText(group),...group.entries.map(e=>entryText(group,e))].join('\n\n');
}
let editingEntry=null,editingGroup=false;
function showCatalog(group,values=[]) {
  $('choices').replaceChildren(...group.items.map((p,i)=>{
    const original=values[i] || 0;
    const limit=p.inactive ? original : 999;
    const row=node('div','');
    row.className='choice';
    row.hidden=!!p.inactive && !original;
    const label=node('label',p.name);
    label.htmlFor='quantity-'+i;
    label.append(node('small',p.price+' 元'+(p.inactive?' · 已移除':'')));
    const stepper=node('div','');
    stepper.className='stepper';
    const input=Object.assign(document.createElement('input'),{
      id:label.htmlFor,type:'text',pattern:'[0-9]{1,3}',maxLength:3,placeholder:'0',
      inputMode:'numeric',autocomplete:'off',value:original ? String(original) : ''
    });
    input.dataset.limit=String(limit);
    input.setAttribute('aria-label',p.name+' · '+p.price+' 元');
    const stepButton=(delta,mark,action)=>{
      const button=node('button',mark);
      button.type='button';
      button.setAttribute('aria-label',action+'「'+p.name+'」數量');
      button.onclick=()=>{
        const next=Math.max(0,Math.min(limit,(Number(input.value)||0)+delta));
        input.value=String(next);
        totals();
      };
      return button;
    };
    stepper.append(stepButton(-1,'−','減少'),input,stepButton(1,'＋','增加'));
    row.append(label,stepper);
    return row;
  }));
  totals();
}
function totals() {
  const quantities=[...$('choices').querySelectorAll('input')].map(input=>{
    const value=/^\d{1,3}$/.test(input.value)?Number(input.value):0;
    const limit=Number(input.dataset.limit);
    input.previousElementSibling.disabled=value<=0;
    input.nextElementSibling.disabled=value>=limit;
    input.setCustomValidity(value>limit?'此品項最多可填 '+limit+' 份':'');
    return value;
  });
  $('subtotal').textContent=quantities.reduce((sum,q,i)=>sum+q*current.items[i].price,0)+' 元';
  return quantities;
}
function showGroup(group,first) {
  const catalogChanged=current && JSON.stringify(current.items)!==JSON.stringify(group.items);
  current=group;
  const open=group.state==='open',archived=group.state==='history';
  $('round-status').replaceChildren(...roundInfo(group));
  $('quick-summary').hidden=!group.entries.length || location.hash.includes('/entry/');
  $('entry-forms').hidden=!open;
  $('detail').classList.toggle('readonly',!open);
  $('edit-group').hidden=archived;
  $('detail-back').href=archived?'#history':'#';
  $('detail-back').textContent=archived?'歷史清單':'全部團購';
  $('close-round').hidden=!open;$('archive-round').hidden=group.state!=='closed';
  $('reopen-round').hidden=group.state!=='closed';$('reopen-round').href='#'+group.id+'/reopen';
  $('restart-round').hidden=open;
  $('restart-round').textContent=group.nextDeleted?'下一輪在回收清單':group.nextId?'前往下一輪':'重新開團';
  $('restart-round').href=group.nextDeleted?'#trash':group.nextId?'#'+group.nextId:'#'+group.id+'/restart';
  $('title').textContent=group.title;
  $('detail-note').hidden=!group.notes?.trim();
  if ($('notes').textContent!==group.notes) $('notes').replaceChildren(linkedNote(group.notes));
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

  const me=myName();
  const snapshot=JSON.stringify([group.id,group.revision,group.state,group.entries,me]);
  if(snapshot===resultSnapshot)return;
  resultSnapshot=snapshot;
  const summary=summarizeGroup(group);
  const paid=group.entries.filter(e=>e.paid).length,picked=group.entries.filter(e=>e.picked).length;
  $('stats').textContent=group.entries.length+' 筆接龍 · '+summary.count+' 件 · 共 '+formatMoney.format(summary.amount)+' 元'
    +(group.entries.length?' · 已付款 '+paid+'/'+group.entries.length+' · 已取貨 '+picked+'/'+group.entries.length:'');
  showReceipt(group,summary);
  $('chain').replaceChildren(node('pre',headingText(group)),...group.entries.map(e=>{
    const row=node('div',''),link=node('a','修改');
    row.className='entry';link.dataset.edit='';link.href='#'+group.id+'/entry/'+e.id;
    link.setAttribute('aria-label','修改 '+e.name+' 的接龍');
    const text=node('pre',entryText(group,e));
    if(me && e.name===me){
      row.classList.add('mine');
      const tag=node('span','我的');tag.className='mine-tag';
      text.prepend(tag);
    }
    const marks=node('div','');marks.className='marks';
    marks.append(markButton(group,e,'paid','已付款'),markButton(group,e,'picked','已取貨'));
    row.append(text);if(open)row.append(link);row.append(marks);return row;
  }));
}
$('choices').oninput=totals;
function showLoadError(error) {
  if (error.status!==410 && error.status!==404) {notice(error.message);return;}
  current=null;
  setMenu('');
  $('detail').hidden=true;
  $('missing-title').textContent=error.message;
  $('missing-trash').hidden=error.status!==410;
  $('unavailable').hidden=false;
}
function trashCard(group) {
  const card=node('div','');
  card.className='trash-card';
  const restore=node('button','還原團購');
  restore.type='button';
  restore.className='restore-group';
  restore.setAttribute('aria-label','還原團購「'+group.title+'」');
  restore.onclick=()=>void changeRound('restore',restore,null,group);
  card.append(node('strong',group.title),node('small','刪除於 '+dateLabel(group.deletedAt)),restore);
  return card;
}
async function refresh(first=false) {
  const token=generation, hash=location.hash.slice(1);
  if(hash==='new')return;
  try {
    const trash=hash==='trash',detail=hash && hash!=='history' && !trash;
    const data=await request(api+(detail?'?id='+encodeURIComponent(hash):trash?'?trash=1':''));
    if(token!==generation)return;
    if(detail) {showGroup(data,!current); $('unavailable').hidden=true; $('detail').hidden=false;}
    else {
      const history=hash==='history';
      const groups=trash?data:data.filter(g=>(g.state==='history')===history);
      if(history)groups.sort((a,b)=>b.archivedAt-a.archivedAt);
      else if(!trash)groups.sort((a,b)=>Number(b.state==='open')-Number(a.state==='open') || (a.deadline??Infinity)-(b.deadline??Infinity));
      const snapshot=JSON.stringify([hash,groups]);
      if(snapshot===listSnapshot)return;
      listSnapshot=snapshot;
      $('cards').replaceChildren(...groups.map(g=>{
        if(trash)return trashCard(g);
        const card=node('div','');card.className='card';
        const titleLink=node('a','');titleLink.className='card-title';titleLink.href='#'+g.id;
        titleLink.append(node('strong',g.title));
        const info=node('div','');info.className='round-info';info.append(...roundInfo(g));
        card.append(titleLink,info);
        if(history)card.append(node('small','歸檔 '+dateLabel(g.archivedAt)));
        if(g.notes?.trim())card.append(cardNotes(g.notes));
        return card;
      }));
      if(!groups.length)$('cards').textContent=trash?'回收清單是空的。':history?'目前沒有已歸檔的團購。':'還沒有團購，從「開新團」開始。';
    }
  } catch(e){if(token===generation)showLoadError(e);}
}
function groupForm(group) {
  const form=$('create-form');
  editingGroup=!!group;
  form.reset();setDeadline(form,group?.deadline);
  $('products').replaceChildren();
  group?.items.forEach((item,i)=>{if(!item.inactive)addProduct(item,i);});
  if(!$('products').children.length)addProduct();
  form.elements.title.value=group?.title ?? '';
  form.elements.notes.value=group?.notes ?? '';
  $('group-heading').textContent=group?'編輯團購':'開新團';
  $('save-group').textContent=group?'儲存團購':'開始收單';
  $('form-back').href=group?'#'+group.id:'#';
  $('form-back').textContent=group?'取消修改':'全部團購';
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
  const historyList=hash==='history',trashList=hash==='trash';
  $('unavailable').hidden=true;$('share-fallback').hidden=true;
  listSnapshot='';resultSnapshot='';setResults(false);
  $('manage').hidden=false;$('restart-page').hidden=true;
  $('list-title').textContent=trashList?'回收清單':historyList?'歷史清單':'目前的團購';
  $('active-tab').setAttribute('aria-current',hash?'false':'page');
  $('history-tab').setAttribute('aria-current',historyList?'page':'false');
  $('trash-tab').setAttribute('aria-current',trashList?'page':'false');
  $('list').hidden=!!hash && !historyList && !trashList;$('detail').hidden=true;$('create').hidden=true;
  $('new').hidden=hash==='new';$('edit-group').hidden=false;$('results').hidden=false;
  $('entry-back').hidden=true;$('entry-manage').hidden=true;$('paste-form').hidden=false;$('detail').classList.remove('editing');
  $('join').querySelector('h2').textContent='依品項填數量';
  $('paste-form').querySelector('h2').textContent='整段貼上訂單';
  $('send-paste').textContent='送出接龍';$('submit-quantity').textContent='送出接龍';
  window.scrollTo(0,0);
  if(hash==='new'){groupForm(null);return;}
  const match=hash.match(/^([a-f0-9-]{36})\/(edit|restart|reopen|entry\/([a-f0-9-]{36}))$/);
  if(match){
    try {
      const group=await request(api+'?id='+match[1]);
      if(token!==generation)return;
      current=group;
      $('manage').hidden=true;
      if(match[2]==='restart'){
        if(group.nextDeleted){location.replace('#trash');return;}
        if(group.state==='open' || group.nextId){location.replace('#'+(group.nextId || group.id));return;}
        showRoundForm(group,'restart');return;
      }
      if(match[2]==='reopen'){
        if(group.state!=='closed'){location.replace('#'+group.id);return;}
        showRoundForm(group,'reopen');return;
      }
      if(group.state==='history' || (match[3] && group.state!=='open')){location.replace('#'+group.id);return;}
      if(match[2]==='edit'){groupForm(group);return;}
      const entry=group.entries.find(e=>e.id===match[3]);
      if(!entry){location.replace('#'+group.id);return;}
      showGroup(group,true); editingEntry=entry;
      $('detail').hidden=false;$('detail').classList.add('editing');
      $('entry-back').href='#'+group.id;$('entry-back').hidden=false;$('entry-manage').hidden=false;
      $('results').hidden=true;$('edit-group').hidden=true;
      $('paste-form').hidden=!entry.pasted;$('join').hidden=!!entry.pasted;
      if(entry.pasted){
        $('paste-form').querySelector('h2').textContent='修改接龍';
        $('paste').value=formatOrder(entry.pasted);previewPaste();$('send-paste').textContent='儲存修改';
      }else{
        $('join').querySelector('h2').textContent='修改接龍';$('join').elements.name.value=entry.name;
        showCatalog(group,entry.quantities);$('submit-quantity').textContent='儲存修改';
      }
    }catch(e){if(token===generation)showLoadError(e);}
    return;
  }
  if(/^[a-f0-9]{8}$/.test(hash)){
    try {
      const found=(await request(api)).filter(g=>g.id.startsWith(hash));
      if(token!==generation)return;
      if(found.length===1){location.replace('#'+found[0].id);return;}
      showLoadError({status:404,message:'找不到這一團'});
    } catch(e){if(token===generation)showLoadError(e);}
    return;
  }
  if(hash && !historyList && !trashList && !/^[a-f0-9-]{36}$/.test(hash)){location.replace('#');return;}
  void refresh(true);
  refreshTimer=setInterval(()=>{if(!document.hidden)void refresh();},5000);
}
$('create-form').onsubmit=async event=>{
  event.preventDefault();
  const form=event.currentTarget, button=event.submitter, token=generation;
  const data=new FormData(form);data.set('deadline',getDeadline(form) ?? '');
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
    const count=order.items.reduce((sum,item)=>sum+splitOrderedItem(item.name).quantity,0);
    $('preview').textContent=order.name+' · '+count+' 件 · NT$ '+order.total.toLocaleString('zh-TW');
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
let roundMode='restart';
const roundForms={
  restart:{heading:'重新開團',text:'沿用團名、備註、品項和菜單。上一輪接龍會保存在歷史清單，新一輪從空白開始。',legend:'新一輪截止日期與時間（台灣）',submit:'開始新一輪'},
  reopen:{heading:'重新開放收單',text:'保留目前的接龍，繼續收單。截止時間可留空。',legend:'新的截止日期與時間（台灣）',submit:'重新開放'},
};
function showRoundForm(group,mode) {
  roundMode=mode;
  const copy=roundForms[mode];
  $('restart-heading').textContent=copy.heading;$('restart-text').textContent=copy.text;
  $('restart-legend').textContent=copy.legend;$('restart-submit').textContent=copy.submit;
  $('restart-title').textContent=group.title;
  $('restart-back').href='#'+group.id;setDeadline($('restart-form'),null);
  $('restart-page').hidden=false;
}
async function changeRound(action,button,deadline=null,group=current) {
  const token=generation;
  button.disabled=true;
  try {
    const result=await request(api,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({group:group.id,revision:group.revision,action,deadline})});
    if(token!==generation)return;
    if(action==='restart' || action==='reopen')location.replace('#'+result.id);
    else if(action==='trash')location.replace('#trash');
    else if(action==='restore')location.hash=result.id;
    else if(action==='archive')location.hash='history';
    else {await refresh();notice('本團已截單');}
  } catch(e){if(token===generation)notice(e.message);} finally {button.disabled=false;}
}
$('delete-group').onclick=e=>{
  if(current && confirm('刪除「'+current.title+'」？這團會移至回收清單，可連同接龍和菜單一起還原。')) {
    void changeRound('trash',e.currentTarget);
  }
};
$('share-group').onclick=async()=>{
  if(!current)return;
  const token=generation;
  const url=new URL(location.pathname,location.origin);
  if(location.hostname==='yi-qi-dian-can.graceyiyo.chatgpt.site')url.href='https://graceyiyo-cloud.github.io/together-order/';
  // The first 8 characters of the id are enough to find the group; route() expands them.
  url.hash=current.id.slice(0,8);
  const heading=current.title.includes('團購')?current.title:current.title+'團購';
  const text=heading+'\n'+url.href;
  // Copy straight away instead of opening the system share sheet.
  try {
    await navigator.clipboard.writeText(text);
    if(token===generation)notice('已複製團名和連結，可以貼到 LINE');
  } catch {
    if(token!==generation)return;
    const field=$('share-fallback');
    const input=field.querySelector('input');
    field.hidden=false;input.value=url.href;input.focus();input.select();
  }
};
$('close-round').onclick=e=>{if(confirm('立即截單？截單後將停止接受接龍。'))void changeRound('close',e.currentTarget);};
$('archive-round').onclick=e=>void changeRound('archive',e.currentTarget);
$('restart-form').onsubmit=e=>{e.preventDefault();void changeRound(roundMode,e.submitter,getDeadline(e.currentTarget));};
$('delete-entry').onclick=async e=>{
  const entry=editingEntry,button=e.currentTarget,token=generation;
  if(!entry || !confirm('刪除「'+entry.name+'」的接龍？刪除後不會列入統計。'))return;
  button.disabled=true;
  try {
    await request(api,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'removeEntry',group:current.id,id:entry.id,revision:entry.revision})});
    if(token!==generation)return;
    leaveEditor();
  } catch(error){if(token===generation)notice(error.message);} finally{button.disabled=false;}
};
$('export-csv').onclick=()=>{if(current)exportCsv(current);};
$('backup').onclick=async e=>{
  const button=e.currentTarget;
  button.disabled=true;
  try {
    const data=await request(api+'?backup=1');
    download('團購接龍備份_'+today()+'.json','application/json',JSON.stringify(data,null,1));
  } catch(error){notice(error.message);} finally{button.disabled=false;}
};
$('copy').onclick=async()=>{
  const text=summaryMode?[current.title,...summaryLines(current),$('stats').textContent].join('\n'):formatChain(current);
  try {
    await navigator.clipboard.writeText(text);
    const button=$('copy');button.textContent='已複製';
    setTimeout(()=>{if(button.textContent==='已複製')button.textContent=summaryMode?'複製整理':'複製接龍';},1500);
    notice(summaryMode?'已複製品項整理':'已複製接龍，可以貼到 LINE');
  }
  catch {
    const copy=document.createElement('textarea');
    copy.readOnly=true;copy.value=text;
    copy.setAttribute('aria-label','接龍文字');$('results').append(copy);
    copy.focus();copy.select();notice('已選取接龍文字，請按複製');
    copy.addEventListener('blur',()=>copy.remove(),{once:true});
  }
};
window.addEventListener('hashchange',route);
route();
