const amountFormat = new Intl.NumberFormat('zh-TW');
export function parseOrder(text) {
  const lines = text.split(/\r?\n/).map(line => line.trim().replace(/\\+$/, '').trim()).filter(Boolean);
  const name = lines.shift() || '';
  if (!name || name.length > 40 || /NT\s*[$＄]/i.test(name)) throw Error('第一行請填姓名');
  let stated, total = 0;
  const items = [];
  for (const [index,line] of lines.entries()) {
    const match = line.match(/^(.*?)\s*(?:NT\s*)?[$＄]\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(?:元)?$/i);
    if (!match || !match[1].trim()) throw Error('第 '+(index+2)+' 行無法辨識，請確認品名與金額，例如「411 XO小卷醬 NT$ 320」');
    const label = match[1].trim(), price = Number(match[2].replaceAll(',', ''));
    if (/^(總金額|合計|總計)\s*[:：]?$/.test(label)) {
      if (stated !== undefined || index !== lines.length-1) throw Error('總金額請放在最後一行');
      stated = price;
    } else {
      if (label.length>160 || price>999999 || items.length>=120) throw Error('品名、金額或筆數超過上限');
      items.push({name:label,price});
      total += price;
    }
  }
  if (!items.length) throw Error('請在姓名下方貼上商品與金額');
  if (stated !== undefined && stated !== total) throw Error('品項合計 NT$ '+amountFormat.format(total)+'，與貼上的總金額 NT$ '+amountFormat.format(stated)+' 不符');
  return {name,items,total};
}
export function formatOrder(order) {
  return [order.name,...order.items.map(i=>i.name+' NT$ '+amountFormat.format(i.price)),'總金額 NT$ '+amountFormat.format(order.total)].join('\n');
}
