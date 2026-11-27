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
  date.oninput=()=>{row.querySelectorAll('select').forEach(el=>el.disabled=!date.value);};
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
  $('quick-summary').hidden=!open || !group.entries.length || location.hash.includes('/entry/');
  $('entry-forms').hidden=!open;
  $('detail').classList.toggle('readonly',!open);
  $('edit-group').hidden=archived;
  $('detail-back').href=archived?'#history':'#';
  $('detail-back').textContent=archived?'歷史清單':'全部團購';
  $('close-round').hidden=!open;$('archive-round').hidden=group.state!=='closed';
  $('restart-round').hidden=open;
  $('restart-round').textContent=group.nextId?'前往下一輪':'重新開團';
  $('restart-round').href=group.nextId?'#'+group.nextId:'#'+group.id+'/restart';
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

  const snapshot=JSON.stringify([group.id,group.revision,group.state,group.entries]);
  if(snapshot===resultSnapshot)return;
  resultSnapshot=snapshot;
  const summary=summarizeGroup(group);
  $('stats').textContent=group.entries.length+' 筆接龍 · '+summary.count+' 件 · 共 '+formatMoney.format(summary.amount)+' 元';
  showReceipt(group,summary);
  $('chain').replaceChildren(node('pre',headingText(group)),...group.entries.map(e=>{
    const row=node('div',''),link=node('a','修改');
    row.className='entry';link.dataset.edit='';link.href='#'+group.id+'/entry/'+e.id;
    link.setAttribute('aria-label','修改 '+e.name+' 的接龍');
    row.append(node('pre',entryText(group,e)));if(open)row.append(link);return row;
  }));
}
$('choices').oninput=totals;
async function refresh(first=false) {
  const token=generation, hash=location.hash.slice(1);
  if(hash==='new')return;
  try {
    const detail=hash && hash!=='history';
    const data=await request(api+(detail?'?id='+encodeURIComponent(hash):''));
    if(token!==generation)return;
    if(detail) {showGroup(data,!current); $('detail').hidden=false;}
    else {
      const history=hash==='history';
      const groups=data.filter(g=>(g.state==='history')===history);
      if(history)groups.sort((a,b)=>b.archivedAt-a.archivedAt);
      else groups.sort((a,b)=>Number(b.state==='open')-Number(a.state==='open') || (a.deadline??Infinity)-(b.deadline??Infinity));
      const snapshot=JSON.stringify([hash,groups]);
      if(snapshot===listSnapshot)return;
      listSnapshot=snapshot;
      $('cards').replaceChildren(...groups.map(g=>{
        const card=node('a','');card.href='#'+g.id;card.className='card';
        const info=node('div','');info.className='round-info';info.append(...roundInfo(g));
        card.append(node('strong',g.title),info);
        if(history)card.append(node('small','歸檔 '+dateLabel(g.archivedAt)));
        if(g.notes)card.append(node('p',g.notes.split('\n')[0]));
        return card;
      }));
      if(!groups.length)$('cards').textContent=history?'目前沒有已歸檔的團購。':'還沒有團購，從「開新團」開始。';
    }
  } catch(e){if(token===generation)notice(e.message);}
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
  const historyList=hash==='history';
  listSnapshot='';resultSnapshot='';setResults(false);
  $('manage').hidden=false;$('restart-page').hidden=true;
  $('list-title').textContent=historyList?'歷史清單':'目前的團購';
  $('active-tab').setAttribute('aria-current',historyList?'false':'page');
  $('history-tab').setAttribute('aria-current',historyList?'page':'false');
  $('list').hidden=!!hash && !historyList;$('detail').hidden=true;$('create').hidden=true;
  $('new').hidden=hash==='new';$('edit-group').hidden=false;$('results').hidden=false;
  $('entry-back').hidden=true;$('paste-form').hidden=false;$('detail').classList.remove('editing');
  $('join').querySelector('h2').textContent='依品項填數量';
  $('paste-form').querySelector('h2').textContent='整段貼上訂單';
  $('send-paste').textContent='送出接龍';$('submit-quantity').textContent='送出接龍';
  window.scrollTo(0,0);
  if(hash==='new'){groupForm(null);return;}
  const match=hash.match(/^([a-f0-9-]{36})\/(edit|restart|entry\/([a-f0-9-]{36}))$/);
  if(match){
    try {
      const group=await request(api+'?id='+match[1]);
      if(token!==generation)return;
      current=group;
      $('manage').hidden=true;
      if(match[2]==='restart'){
        if(group.state==='open' || group.nextId){location.replace('#'+(group.nextId || group.id));return;}
        $('restart-title').textContent=group.title;
        $('restart-back').href='#'+group.id;setDeadline($('restart-form'),null);
        $('restart-page').hidden=false;return;
      }
      if(group.state==='history' || (match[3] && group.state!=='open')){location.replace('#'+group.id);return;}
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
        showCatalog(group,entry.quantities);$('submit-quantity').textContent='儲存修改';
      }
    }catch(e){if(token===generation)notice(e.message);}
    return;
  }
  if(hash && !historyList && !/^[a-f0-9-]{36}$/.test(hash)){location.replace('#');return;}
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
async function changeRound(action,button,deadline=null) {
  const group=current, token=generation;
  button.disabled=true;
  try {
    const result=await request(api,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({group:group.id,revision:group.revision,action,deadline})});
    if(token!==generation)return;
    if(action==='restart')location.replace('#'+result.id);
    else if(action==='archive')location.hash='history';
    else {await refresh();notice('本團已截單');}
  } catch(e){notice(e.message);} finally {button.disabled=false;}
}
$('close-round').onclick=e=>{if(confirm('立即截單？截單後將停止接受接龍。'))void changeRound('close',e.currentTarget);};
$('archive-round').onclick=e=>void changeRound('archive',e.currentTarget);
$('restart-form').onsubmit=e=>{e.preventDefault();void changeRound('restart',e.submitter,getDeadline(e.currentTarget));};
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
