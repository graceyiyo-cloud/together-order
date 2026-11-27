const amountFormat = new Intl.NumberFormat('zh-TW');
const amount = String.raw`(\d{1,3}(?:,\d{3})+|\d+)`;
// Accepts "NT$ 320", "$320", "＄320", "320元", "320 元", with an optional "*2" / "x2" / "×2" / "+2" unit multiplier.
const priced = new RegExp(String.raw`^(.*?)\s*(?:(?:NT\s*)?[$＄]\s*${amount}\s*(?:元)?|${amount}\s*元)\s*(?:[*＊xX×+＋]\s*(\d{1,3}))?$`, 'i');
// Total line: "總金額 NT$ 1,400", "合計 1400", "=1,400", "總金額＝1400元".
const totalLine = new RegExp(String.raw`^(?:(?:總金額|合計|總計|共)\s*[=＝:：]?|[=＝])\s*(?:NT\s*)?[$＄]?\s*${amount}\s*(?:元)?$`, 'i');
const quantitySuffix = /[+＋]\s*[0-9０-９]+\s*$/u;
export function parseOrder(text) {
  let lines = text.split(/\r?\n/).map(line => line.trim().replace(/\\+$/, '').trim()).filter(Boolean);
  // Closing remarks such as "謝謝" after the last priced line carry no order data.
  const lastNumbered = lines.findLastIndex(line => /[0-9]/.test(line));
  if (lastNumbered > 0) lines = lines.slice(0, lastNumbered + 1);
  const name = (lines.shift() || '').replace(/^姓名\s*[:：]\s*/, '').trim();
  if (!name || name.length > 40 || /NT\s*[$＄]/i.test(name)) throw Error('第一行請填姓名');
  let stated, total = 0;
  const items = [];
  for (const [index,line] of lines.entries()) {
    const totalMatch = line.match(totalLine);
    if (totalMatch) {
      if (stated !== undefined || index !== lines.length-1) throw Error('總金額請放在最後一行');
      stated = Number(totalMatch[1].replaceAll(',', ''));
      continue;
    }
    const match = line.match(priced);
    const label = match?.[1].trim().replace(/\s*[:：=＝-]$/u, '').trim();
    if (!match || !label) throw Error('第 '+(index+2)+' 行無法辨識，請確認品名與金額，例如「411 XO小卷醬 NT$ 320」或「蜜汁魷魚片 540元*2」');
    const unit = Number((match[2] ?? match[3]).replaceAll(',', ''));
    const times = match[4] === undefined ? 1 : Number(match[4]);
    if (!times) throw Error('第 '+(index+2)+' 行的數量不可為 0');
    const price = unit * times;
    if (/^(總金額|合計|總計|共)$/.test(label)) {
      if (stated !== undefined || index !== lines.length-1) throw Error('總金額請放在最後一行');
      stated = price;
    } else {
      if (label.length>160 || price>999999 || items.length>=120) throw Error('品名、金額或筆數超過上限');
      // "品名 300元*2" becomes a line subtotal with the quantity kept in the name, like "品名+2".
      items.push({name: times > 1 && !quantitySuffix.test(label) ? label+'+'+times : label, price});
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
