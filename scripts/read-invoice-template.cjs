const path = require('path');
const XLSX = require(path.join(process.cwd(), 'node_modules/xlsx'));

const FILE = 'C:/Users/saham/Documents/OMS_TT/OMS/Vba Fun App/bin/x64/Debug/Order Bill_Sales_Challan.xlsx';
const wb = XLSX.readFile(FILE, { cellStyles: true });
console.log('SHEETS:', wb.SheetNames.join(' | '));

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'];
  console.log(`\n===== SHEET: ${name}  (range ${ref}) =====`);
  if (!ref) continue;
  const range = XLSX.utils.decode_range(ref);

  // merged cells
  if (ws['!merges'] && ws['!merges'].length) {
    console.log('MERGES:', ws['!merges'].map((m) => XLSX.utils.encode_range(m)).join(', '));
  }
  // column widths
  if (ws['!cols']) {
    console.log('COL WIDTHS:', ws['!cols'].map((c, i) => `${XLSX.utils.encode_col(i)}=${c && (c.wch || c.width) ? Math.round(c.wch || c.width) : '-'}`).join(' '));
  }

  // non-empty cells with address + value
  console.log('--- CELLS (addr = value) ---');
  for (let r = range.s.r; r <= range.e.r; r++) {
    const line = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = ws[addr];
      if (cell && cell.v !== undefined && cell.v !== '') {
        line.push(`${addr}="${String(cell.v).replace(/\n/g, '\\n')}"`);
      }
    }
    if (line.length) console.log(`R${r + 1}: ` + line.join('  '));
  }
}
