const path = require('path');
const XLSX = require(path.join(process.cwd(), 'node_modules/xlsx'));

const FILE = 'C:/Users/saham/Documents/OMS_TT/OMS/Vba Fun App/bin/x64/Debug/Order Bill.xlsx';
const wb = XLSX.readFile(FILE, { cellStyles: true });
console.log('SHEETS:', wb.SheetNames.join(' | '));

const colorOf = (c) => {
  if (!c) return '';
  const parts = [];
  const fill = c.s && c.s.fgColor && (c.s.fgColor.rgb || c.s.fgColor.theme !== undefined ? `theme${c.s.fgColor.theme}` : '');
  if (c.s && c.s.fgColor && c.s.fgColor.rgb) parts.push('fill#' + c.s.fgColor.rgb);
  if (c.s && c.s.patternType) parts.push('pat:' + c.s.patternType);
  if (c.s && c.s.color && c.s.color.rgb) parts.push('font#' + c.s.color.rgb);
  if (c.s && c.s.font && c.s.font.color && c.s.font.color.rgb) parts.push('font#' + c.s.font.color.rgb);
  if (c.s && c.s.font && c.s.font.bold) parts.push('bold');
  return parts.join(' ');
};

for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name];
  const ref = ws['!ref'];
  console.log(`\n===== SHEET: ${name}  (range ${ref}) =====`);
  if (!ref) continue;
  const range = XLSX.utils.decode_range(ref);
  if (ws['!merges'] && ws['!merges'].length) console.log('MERGES:', ws['!merges'].map((m) => XLSX.utils.encode_range(m)).join(', '));
  if (ws['!cols']) console.log('COLS:', ws['!cols'].slice(0, 14).map((c, i) => `${XLSX.utils.encode_col(i)}=${c && (c.wch || c.width) ? Math.round(c.wch || c.width) : '-'}`).join(' '));
  for (let r = range.s.r; r <= range.e.r; r++) {
    const line = [];
    for (let col = range.s.c; col <= range.e.c; col++) {
      const addr = XLSX.utils.encode_cell({ r, c: col });
      const cell = ws[addr];
      if (cell && (cell.v !== undefined && cell.v !== '')) {
        const sty = colorOf(cell);
        line.push(`${addr}="${String(cell.v).replace(/\n/g, '\\n')}"${sty ? ' {' + sty + '}' : ''}`);
      }
    }
    if (line.length) console.log(`R${r + 1}: ` + line.join('  '));
  }
}
