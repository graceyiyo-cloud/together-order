// Pasted orders store the amount for the whole line, including any +N quantity.
export function splitOrderedItem(label) {
  const suffix = label.match(/^(.*?)\s*[+＋]\s*([0-9０-９]+)\s*$/u);
  const quantity = suffix ? Number(suffix[2].normalize('NFKC')) : 1;
  if (suffix && suffix[1].trim() && Number.isSafeInteger(quantity) && quantity > 0) {
    return {name: suffix[1].trim(), quantity};
  }
  return {name: label.trim(), quantity: 1};
}

function productName(label) {
  // Keep size, flavour and pack descriptions as part of the product identity.
  return label.trim().replace(/^([0-9０-９]{3,})(?=[^\d０-９\s])/u,'$1 ').replace(/\s+/gu,' ');
}

export function summarizeGroup(group) {
  const products = new Map();
  let count = 0, amount = 0;

  function add(label, quantity, lineAmount) {
    const name = productName(label);
    const key = productName(name.normalize('NFKC')).replace(/\s*\(\s*/g,'(').replace(/\s*\)/g,')');
    let row = products.get(key);
    if (!row) {
      row = {name, count: 0, amount: 0};
      products.set(key, row);
    }
    row.count += quantity;
    row.amount += lineAmount;
    count += quantity;
    amount += lineAmount;
  }

  for (const entry of group.entries) {
    if (entry.pasted) {
      for (const item of entry.pasted.items) {
        const {name, quantity} = splitOrderedItem(item.name);
        add(name, quantity, item.price);
      }
    } else {
      entry.quantities.forEach((quantity, index) => {
        if (!quantity) return;
        const item = group.items[index];
        add(item.name, quantity, quantity * item.price);
      });
    }
  }
  const rows = [...products.values()];
  if (rows.every(row => /^\d{3,} /.test(row.name))) {
    rows.sort((a, b) => a.name.split(' ',1)[0].localeCompare(b.name.split(' ',1)[0],'en',{numeric:true}));
  }
  return {rows, count, amount};
}
