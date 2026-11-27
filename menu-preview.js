const byId = id => document.getElementById(id);
const toggle = byId('menu-toggle');
const panel = byId('menu-panel');
const status = byId('menu-status');
const content = byId('menu-content');
const pages = byId('menu-pages');
let source = '', active = null, ownerHash = '';

function release() {
  if (!active) return;
  const previous = active;
  active = null;
  previous.controller.abort();
  previous.render?.cancel();
  previous.loading?.destroy().catch(()=>{});
  content.replaceChildren();
  if (previous.objectURL) URL.revokeObjectURL(previous.objectURL);
  status.textContent = '';
  pages.hidden = true;
}

function fail(view) {
  if (active !== view) return;
  status.textContent = '無法載入菜單，請收合後再試一次。';
  pages.hidden = true;
}

async function drawPage(view, number) {
  const revision = ++view.sequence;
  view.render?.cancel();
  view.page = number;
  byId('menu-prev').disabled = number <= 1;
  byId('menu-next').disabled = number >= view.pdf.numPages;
  byId('menu-page').textContent = number + ' / ' + view.pdf.numPages;
  pages.hidden = view.pdf.numPages === 1;
  try {
    const page = await view.pdf.getPage(number);
    if (active !== view || view.sequence !== revision) return;
    const unit = page.getViewport({scale:1});
    const width = content.clientWidth || Math.min(window.innerWidth, 900);
    const scale = Math.min(width * Math.min(devicePixelRatio || 1, 2) / unit.width, 4096 / Math.max(unit.width, unit.height));
    const viewport = page.getViewport({scale});
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1,Math.ceil(viewport.width));
    canvas.height = Math.max(1,Math.ceil(viewport.height));
    canvas.style.width = width + 'px';
    canvas.setAttribute('role','img');
    canvas.setAttribute('aria-label','菜單第 ' + number + ' 頁');
    const task = page.render({canvas,viewport});
    view.render = task;
    await task.promise;
    if (active !== view || view.sequence !== revision) return;
    content.replaceChildren(canvas);
    status.textContent = '';
  } catch {
    if (view.sequence === revision) fail(view);
  }
}

async function load() {
  const view = {controller:new AbortController(), sequence:0, page:1};
  active = view;
  status.textContent = '正在載入菜單…';
  try {
    const response = await fetch(source,{signal:view.controller.signal});
    if (!response.ok) throw Error();
    const blob = await response.blob();
    if (active !== view) return;
    if (blob.type.startsWith('image/')) {
      const img = new Image();
      view.objectURL = URL.createObjectURL(blob);
      img.alt = '團購菜單';
      img.src = view.objectURL;
      await img.decode();
      if (active !== view) return;
      content.replaceChildren(img);
      status.textContent = '';
      return;
    }
    if (blob.type !== 'application/pdf') throw Error();
    const [pdfjs, data] = await Promise.all([import('./pdfjs-5.4.624/pdf.min.mjs'),blob.arrayBuffer()]);
    if (active !== view) return;
    const base = new URL('./pdfjs-5.4.624/',import.meta.url).href;
    pdfjs.GlobalWorkerOptions.workerSrc = base+'pdf.worker.min.mjs';
    view.loading = pdfjs.getDocument({data,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/',iccUrl:base+'iccs/',isEvalSupported:false});
    view.pdf = await view.loading.promise;
    if (active === view) await drawPage(view,1);
  } catch { fail(view); }
}

function sync() {
  const open = !!source && ownerHash === location.hash && history.state?.menuFor === ownerHash;
  toggle.setAttribute('aria-expanded',String(open));
  toggle.textContent = open ? '收合菜單' : '展開菜單';
  panel.hidden = !open;
  if (!open) release();
  else if (!active) void load();
}

export function setMenu(url) {
  if (source !== url || ownerHash !== location.hash) release();
  source = url;
  ownerHash = location.hash;
  byId('menu').hidden = !url;
  sync();
}

toggle.onclick = () => {
  if (!panel.hidden) { history.back(); return; }
  history.pushState({...history.state,menuFor:location.hash},'',location.href);
  sync();
};
window.addEventListener('popstate',sync);
byId('menu-prev').onclick = () => { if (active?.page > 1) void drawPage(active,active.page-1); };
byId('menu-next').onclick = () => { if (active?.page < active?.pdf?.numPages) void drawPage(active,active.page+1); };
