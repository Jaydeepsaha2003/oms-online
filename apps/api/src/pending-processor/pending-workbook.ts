import JSZip from 'jszip';

/**
 * The workbook the "Pending Order Processor V6.0" macro produced, written
 * directly as Office Open XML so its four sheets are REAL pivot tables — the
 * filters (DUE TYPE, CATEGORY, VendorName …) still work in Excel, exactly as
 * they did on the macro's file. Neither installed Excel library writes pivots,
 * hence the hand-built parts.
 *
 * Layout, captions, filters and formatting mirror the macro's output
 * (pen_order_process_02_10_26_13_09.xlsx) part for part. The pivots also carry
 * their rendered cells, so a viewer that cannot refresh a pivot (a phone, a
 * browser preview) still shows the right figures; Excel re-renders them from
 * the cache on open (`refreshOnLoad`).
 */

export type Cell = string | number | Date | null;

/** PenOrderData's columns, in the macro's order (A … AB). */
export const PEN_ORDER_HEADERS = [
  'ID', 'ORDER ID', 'ORDER DATE', 'DUE TYPE', 'DUE DATE', 'AGENT NAME', 'CUSTOMER NAME', 'PRODUCT NAME', 'DESIGN TYPE',
  'PRIORITY', 'BAGS', 'PCS', 'KGS', 'BOX', 'COMMENT', 'CAL FIELD', 'ORDTYPE', 'STATUS', 'SUB CATEGORY', 'CATEGORY', 'Size',
  'PRODUCT', 'DESIGN', 'OrderSheet', 'Short Customer Name', 'CombProduct Name', 'SUB-CATEGORY', 'VendorName',
] as const;

const F = Object.fromEntries(PEN_ORDER_HEADERS.map((h, i) => [h, i])) as Record<(typeof PEN_ORDER_HEADERS)[number], number>;

interface PivotSpec {
  sheet: string;
  name: string;
  rows: { fld: number; caption?: string }[];
  data: { fld: number; caption: string }[];
  /** Filters top to bottom; `pick` pre-selects an item, as `.CurrentPage` did. */
  pages: { fld: number; pick?: string }[];
  /** The order pivots: the DUE ORDERS banner above the table, ORDER ID hidden. */
  banner?: boolean;
}

const orderPivot = (sheet: string, orderSheet: string): PivotSpec => ({
  sheet,
  name: `Pivot_${orderSheet}`,
  rows: [{ fld: F['Short Customer Name'], caption: 'CUSTOMER' }, { fld: F['PRODUCT NAME'] }, { fld: F.COMMENT }, { fld: F['DESIGN TYPE'] }, { fld: F['ORDER ID'] }],
  data: [{ fld: F.BAGS, caption: 'BAG' }, { fld: F.PCS, caption: 'PC' }, { fld: F.KGS, caption: 'KG' }, { fld: F.BOX, caption: 'BOXES' }],
  pages: [{ fld: F.PRIORITY }, { fld: F.STATUS, pick: 'Confirmed' }, { fld: F.OrderSheet, pick: orderSheet }, { fld: F.CATEGORY }, { fld: F['SUB-CATEGORY'] }, { fld: F['DUE TYPE'] }],
  banner: true,
});

const vendorPivot = (sheet: string, orderSheet: string): PivotSpec => ({
  sheet,
  name: `Pivot_${sheet}`,
  rows: [{ fld: F.CATEGORY }, { fld: F['SUB-CATEGORY'] }, { fld: F['CombProduct Name'] }],
  data: [{ fld: F.BAGS, caption: 'BAG' }, { fld: F.KGS, caption: 'KG' }, { fld: F.PCS, caption: 'PC' }],
  pages: [{ fld: F.PRIORITY }, { fld: F.STATUS, pick: 'Confirmed' }, { fld: F.VendorName }, { fld: F.OrderSheet, pick: orderSheet }],
});

// ── XML helpers ──────────────────────────────────────────────────────────────
const esc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colName = (i: number) => (i < 26 ? '' : String.fromCharCode(64 + Math.floor(i / 26))) + String.fromCharCode(65 + (i % 26));
/** Excel serial for the local calendar day (the day the screens show). */
const serial = (d: Date) => (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000;
const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T00:00:00`;
const blank = (v: Cell) => v === null || v === '';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const FILL_DOWN =
  '<extLst><ext uri="{2946ED86-A175-432a-8AC1-64E0C546D7DE}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:pivotField fillDownLabels="1"/></ext></extLst>';

/** Cell styles (cellXfs). The pivot sheets keep the macro's 14pt text and
 *  banner; on top: a navy header bar with borders on PenOrderData, blue
 *  header rows on the pivots, bold filter values. */
const S = {
  header: 1, date: 2, button: 3, big: 4, banner: 5, bannerDate: 6,
  dataHeader: 7, dataDate: 8, dataCell: 9, headButton: 10, head: 11, pick: 12,
} as const;
/** dxfs: 14pt for the whole pivot, then the banner's red / yellow / green. */
const DXF = { big: 0, red: 1, yellow: 2, green: 3 } as const;

const font = (sz: number, bold: boolean, rgb = 'FF000000') => `<font>${bold ? '<b/>' : ''}<sz val="${sz}"/><color rgb="${rgb}"/><name val="Aptos Narrow"/><family val="2"/></font>`;
const solid = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
const thin = '<left style="thin"><color rgb="FFD0D7E5"/></left><right style="thin"><color rgb="FFD0D7E5"/></right><top style="thin"><color rgb="FFD0D7E5"/></top><bottom style="thin"><color rgb="FFD0D7E5"/></bottom><diagonal/>';
const xf = (numFmt: number, fontId: number, fillId: number, borderId: number, extra = '', align = '') =>
  `<xf numFmtId="${numFmt}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"${extra} applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1">' + align + '</xf>' : '/>'}`;
const CENTER = '<alignment horizontal="center" vertical="center"/>';
const VCENTER = '<alignment vertical="center"/>';
const XFS = [
  xf(0, 0, 0, 0),
  xf(0, 1, 0, 0),
  xf(14, 0, 0, 0),
  xf(0, 2, 0, 0, ' pivotButton="1"'),
  xf(0, 2, 0, 0),
  xf(0, 5, 0, 0, '', CENTER),
  xf(15, 5, 0, 0, '', CENTER),
  xf(0, 4, 2, 1, '', '<alignment horizontal="center" vertical="center" wrapText="1"/>'),
  xf(164, 0, 0, 1, '', VCENTER),
  xf(0, 0, 0, 1, '', VCENTER),
  xf(0, 6, 3, 0, ' pivotButton="1"', VCENTER),
  xf(0, 6, 3, 0, '', CENTER),
  xf(0, 3, 0, 0),
];

const STYLES =
  `${HEAD}<styleSheet ${NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="dd-mm-yyyy"/></numFmts>` +
  `<fonts count="7">${[font(11, false), font(11, true), font(14, false), font(14, true), font(11, true, 'FFFFFFFF'), font(16, true), font(14, true, 'FFFFFFFF')].join('')}</fonts>` +
  `<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>${solid('FF1F3864')}${solid('FF4472C4')}</fills>` +
  `<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border>${thin}</border></borders>` +
  `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${XFS.length}">${XFS.join('')}</cellXfs>` +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '<dxfs count="4"><dxf><font><sz val="14"/></font></dxf>' +
  ['FFFF6666', 'FFFFFA99', 'FF90EE90'].map((c) => `<dxf><fill><patternFill><bgColor rgb="${c}"/></patternFill></fill></dxf>`).join('') +
  '</dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleMedium2"/></styleSheet>';

/** Landscape, one page wide — the pivots are printed for the floor. */
const PRINT =
  '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>' +
  '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>';
/** Freeze everything above `row` (1-based, the first scrolling row). */
const frozenView = (row: number, selected = false) =>
  `<sheetViews><sheetView${selected ? ' tabSelected="1"' : ''} workbookViewId="0"><pane ySplit="${row - 1}" topLeftCell="A${row}" activePane="bottomLeft" state="frozen"/>` +
  `<selection pane="bottomLeft" activeCell="A${row}" sqref="A${row}"/></sheetView></sheetViews>`;

/** Builds the shared-strings table as cells are written. */
class Strings {
  private map = new Map<string, number>();
  list: string[] = [];
  id(s: string) {
    let i = this.map.get(s);
    if (i === undefined) this.map.set(s, (i = this.list.push(s) - 1));
    return i;
  }
  xml() {
    const items = this.list.map((s) => `<si><t${/^\s|\s$/.test(s) ? ' xml:space="preserve"' : ''}>${esc(s)}</t></si>`).join('');
    return `${HEAD}<sst ${NS} count="${this.list.length}" uniqueCount="${this.list.length}">${items}</sst>`;
  }
}

/** One row of cells as sheet XML. `style` may be per column. */
function rowXml(strings: Strings, r: number, cells: Cell[], style: (c: number, v: Cell) => number | undefined, extra = '') {
  const cs = cells
    .map((v, c) => {
      const s = style(c, v);
      const sa = s ? ` s="${s}"` : '';
      const ref = `${colName(c)}${r}`;
      if (blank(v)) return s ? `<c r="${ref}"${sa}/>` : '';
      if (v instanceof Date) return `<c r="${ref}"${sa}><v>${serial(v)}</v></c>`;
      if (typeof v === 'number') return `<c r="${ref}"${sa}><v>${v}</v></c>`;
      return `<c r="${ref}"${sa} t="s"><v>${strings.id(v as string)}</v></c>`;
    })
    .join('');
  return `<row r="${r}"${extra}>${cs}</row>`;
}

// ── Pivot cache ──────────────────────────────────────────────────────────────
type Key = string | number | null;
const keyOf = (v: Cell): Key => (blank(v) ? null : v instanceof Date ? serial(v) : v);
/** Excel's item order: numbers, then text in Windows "word sort" — case and
 *  hyphens ignored, so "60ML…" comes before "6-PCS…" and "SOUTH-5.5-…" before
 *  "SOUTH-5-…" — blanks last. */
function compareKeys(a: Key, b: Key) {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  if (typeof a === 'number') return -1;
  if (typeof b === 'number') return 1;
  const word = (s: string) => s.toUpperCase().replace(/[-']/g, '');
  const x = word(a), y = word(b);
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}
const label = (k: Key) => (k === null ? '(blank)' : k);

interface CacheField {
  /** Distinct values in first-seen order (the cache's shared items) — axis fields only. */
  shared?: Key[];
  index?: Map<Key, number>;
  /** Shared-item indexes in display (sorted) order. */
  order?: number[];
}

function cacheFieldXml(name: string, values: Cell[], f: CacheField) {
  const nonBlank = values.filter((v) => !blank(v));
  const hasBlank = nonBlank.length < values.length;
  const dates = nonBlank.length > 0 && nonBlank.every((v) => v instanceof Date);
  const nums = nonBlank.length > 0 && nonBlank.every((v) => typeof v === 'number');
  const attrs: string[] = [];
  if (dates) {
    const ds = (nonBlank as Date[]).map((d) => d.getTime());
    attrs.push(hasBlank ? '' : 'containsSemiMixedTypes="0"', 'containsNonDate="0"', 'containsDate="1"', 'containsString="0"');
    if (hasBlank) attrs.push('containsBlank="1"');
    attrs.push(`minDate="${isoDay(new Date(Math.min(...ds)))}"`, `maxDate="${isoDay(new Date(Math.max(...ds)))}"`);
  } else if (nums) {
    const ns = nonBlank as number[];
    attrs.push(hasBlank ? '' : 'containsSemiMixedTypes="0"', 'containsString="0"');
    if (hasBlank) attrs.push('containsBlank="1"');
    attrs.push('containsNumber="1"');
    if (ns.every(Number.isInteger)) attrs.push('containsInteger="1"');
    attrs.push(`minValue="${Math.min(...ns)}"`, `maxValue="${Math.max(...ns)}"`);
  } else if (!nonBlank.length && hasBlank) {
    attrs.push('containsNonDate="0"', 'containsString="0"', 'containsBlank="1"');
  } else if (hasBlank) {
    attrs.push('containsBlank="1"');
  }
  const a = attrs.filter(Boolean).join(' ');
  const items = f.shared
    ? `<sharedItems${a ? ` ${a}` : ''} count="${f.shared.length}">${f.shared
        .map((k) => (k === null ? '<m/>' : typeof k === 'number' ? `<n v="${k}"/>` : `<s v="${esc(k)}"/>`))
        .join('')}</sharedItems>`
    : `<sharedItems${a ? ` ${a}` : ''}/>`;
  return `<cacheField name="${esc(name)}" numFmtId="${dates ? 14 : 0}">${items}</cacheField>`;
}

function recordValue(v: Cell, f: CacheField) {
  if (f.index) return `<x v="${f.index.get(keyOf(v))}"/>`;
  if (blank(v)) return '<m/>';
  if (v instanceof Date) return `<d v="${isoDay(v)}"/>`;
  if (typeof v === 'number') return `<n v="${v}"/>`;
  return `<s v="${esc(v as string)}"/>`;
}

// ── Pivot table ──────────────────────────────────────────────────────────────
interface RenderedPivot {
  sheetXml: string;
  tableXml: string;
  /** The column-header row, repeated on every printed page. */
  headerRow: number;
}

function renderPivot(spec: PivotSpec, rows: Cell[][], fields: CacheField[], strings: Strings, today: Date, cacheId: number): RenderedPivot {
  const axis = new Map<number, 'axisRow' | 'axisPage'>();
  spec.rows.forEach((r) => axis.set(r.fld, 'axisRow'));
  spec.pages.forEach((p) => axis.set(p.fld, 'axisPage'));
  /** Position of a shared item within its field's sorted item list. */
  const pos = (fld: number, k: Key) => fields[fld].order!.indexOf(fields[fld].index!.get(k)!);

  // Page selections that exist; one that does not leaves the filter on (All),
  // as the macro's `On Error Resume Next` around .CurrentPage did.
  const picks = spec.pages.map((p) => (p.pick !== undefined && fields[p.fld].index!.has(p.pick) ? p.pick : undefined));
  const kept = rows.filter((r) => spec.pages.every((p, i) => picks[i] === undefined || keyOf(r[p.fld]) === picks[i]));

  // Tabular layout, no subtotals or grand totals: one line per distinct row tuple.
  const groups = new Map<string, { keys: Key[]; sums: number[] }>();
  for (const r of kept) {
    const keys = spec.rows.map((f) => keyOf(r[f.fld]));
    const id = JSON.stringify(keys);
    const g = groups.get(id) ?? { keys, sums: spec.data.map(() => 0) };
    spec.data.forEach((d, i) => (g.sums[i] += typeof r[d.fld] === 'number' ? (r[d.fld] as number) : 0));
    groups.set(id, g);
  }
  const lines = [...groups.values()].sort((a, b) => {
    for (let i = 0; i < spec.rows.length; i++) {
      const c = pos(spec.rows[i].fld, a.keys[i]) - pos(spec.rows[i].fld, b.keys[i]);
      if (c) return c;
    }
    return 0;
  });

  const nRow = spec.rows.length;
  const nCol = nRow + spec.data.length;
  const pageRows = spec.pages.length;
  const top = pageRows + 2; // the "Values" row; one blank row sits under the filters
  const xml: string[] = [];
  const st = (s: number) => () => s;

  spec.pages.forEach((p, i) => {
    const caption = PEN_ORDER_HEADERS[p.fld];
    xml.push(rowXml(strings, i + 1, [caption, picks[i] ?? '(All)'], (c) => (c === 0 ? S.button : S.pick)));
  });
  if (spec.banner) {
    // The macro's DUE ORDERS banner: follows the DUE TYPE filter (B6), coloured below.
    const dueRow = spec.pages.findIndex((p) => p.fld === F['DUE TYPE']) + 1;
    const formula = `IF(B${dueRow}="Due","DUE ORDERS",IF(B${dueRow}="Over Due","OVERDUE ORDERS",IF(B${dueRow}="Past Due","PAST DUE ORDERS","ALL ORDERS")))`;
    const r = pageRows + 1;
    const cells = Array.from({ length: nCol }, (_, c) =>
      c === 0 ? `<c r="A${r}" s="${S.banner}" t="str"><f>${esc(formula)}</f><v>ALL ORDERS</v></c>`
      : c === nCol - 3 ? `<c r="${colName(c)}${r}" s="${S.bannerDate}"><v>${serial(today)}</v></c>`
      : `<c r="${colName(c)}${r}" s="${S.banner}"/>`,
    );
    xml.push(`<row r="${r}" ht="30" customHeight="1">${cells.join('')}</row>`);
  }
  xml.push(rowXml(strings, top, Array.from({ length: nCol }, (_, c) => (c === nRow ? 'Values' : null)), (c) => (c === nRow ? S.button : undefined), spec.banner ? ' hidden="1"' : ''));
  const headers = [...spec.rows.map((r) => r.caption ?? PEN_ORDER_HEADERS[r.fld]), ...spec.data.map((d) => d.caption)];
  xml.push(rowXml(strings, top + 1, headers, (c) => (c < nRow ? S.headButton : S.head), ' ht="24" customHeight="1"'));
  lines.forEach((g, i) => xml.push(rowXml(strings, top + 2 + i, [...g.keys.map(label), ...g.sums.map((n) => Math.round(n * 1000) / 1000)], st(S.big))));
  const last = top + 1 + Math.max(lines.length, 1);

  // Column widths ≈ Excel's AutoFit at 14pt.
  const widths = Array.from({ length: nCol }, (_, c) => {
    const texts = [...(c < 2 ? spec.pages.map((p, i) => (c === 0 ? PEN_ORDER_HEADERS[p.fld] : picks[i] ?? '(All)')) : []), headers[c], ...lines.map((g) => String(c < nRow ? label(g.keys[c]) : g.sums[c - nRow]))];
    return Math.min(90, Math.max(7, ...texts.map((t) => t.length)) * 1.25 + 2);
  });
  const hiddenCol = spec.banner ? spec.rows.findIndex((r) => r.fld === F['ORDER ID']) : -1;
  const cols = widths.map((w, c) => `<col min="${c + 1}" max="${c + 1}" width="${w.toFixed(2)}" style="${S.big}"${c === hiddenCol ? ' hidden="1"' : ''} customWidth="1"/>`).join('');
  const bannerParts = spec.banner
    ? `<mergeCells count="2"><mergeCell ref="A${pageRows + 1}:${colName(nCol - 4)}${pageRows + 1}"/><mergeCell ref="${colName(nCol - 3)}${pageRows + 1}:${colName(nCol - 1)}${pageRows + 1}"/></mergeCells>` +
      `<conditionalFormatting sqref="A${pageRows + 1}">` +
      [['DUE ORDERS', DXF.green], ['PAST DUE ORDERS', DXF.yellow], ['OVERDUE ORDERS', DXF.red]]
        .map(([t, d], i) => `<cfRule type="cellIs" dxfId="${d}" priority="${i + 1}" stopIfTrue="1" operator="equal"><formula>"${t}"</formula></cfRule>`)
        .join('') +
      `</conditionalFormatting><conditionalFormatting sqref="${colName(nCol - 3)}${pageRows + 1}">` +
      [['DUE ORDERS', DXF.green], ['PAST DUE ORDERS', DXF.yellow], ['OVERDUE ORDERS', DXF.red]]
        .map(([t, d], i) => `<cfRule type="expression" dxfId="${d}" priority="${i + 4}" stopIfTrue="1"><formula>$A$${pageRows + 1}="${t}"</formula></cfRule>`)
        .join('') +
      '</conditionalFormatting>'
    : '';
  const sheetXml =
    `${HEAD}<worksheet ${NS}><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${colName(nCol - 1)}${last}"/>${frozenView(top + 2)}` +
    `<sheetFormatPr defaultRowHeight="18.75"/><cols>${cols}<col min="${nCol + 1}" max="16384" width="9.140625" style="${S.big}"/></cols>` +
    `<sheetData>${xml.join('')}</sheetData>${bannerParts}${PRINT}</worksheet>`;

  // The definition: which fields sit where, plus the rendered row items.
  const pivotFields = PEN_ORDER_HEADERS.map((_, fld) => {
    const ax = axis.get(fld);
    const isData = spec.data.some((d) => d.fld === fld);
    const name = spec.rows.find((r) => r.fld === fld)?.caption;
    const attrs = `${name ? ` name="${esc(name)}"` : ''}${ax ? ` axis="${ax}"` : ''}${isData ? ' dataField="1"' : ''} compact="0"${
      fld === F['ORDER DATE'] || fld === F['DUE DATE'] ? ' numFmtId="14"' : ''
    } outline="0" showAll="0"${ax === 'axisRow' ? ' defaultSubtotal="0"' : ''}`;
    if (!ax) return `<pivotField${attrs}>${FILL_DOWN}</pivotField>`;
    const order = fields[fld].order!;
    const items = order.map((x) => `<item x="${x}"/>`).join('') + (ax === 'axisPage' ? '<item t="default"/>' : '');
    return `<pivotField${attrs}><items count="${order.length + (ax === 'axisPage' ? 1 : 0)}">${items}</items>${FILL_DOWN}</pivotField>`;
  }).join('');
  let prev: Key[] | null = null;
  const rowItems = lines.length
    ? lines
        .map((g) => {
          let same = 0;
          while (prev && same < nRow - 1 && JSON.stringify(prev[same]) === JSON.stringify(g.keys[same])) same++;
          prev = g.keys;
          const xs = g.keys.slice(same).map((k, i) => {
            const v = pos(spec.rows[same + i].fld, k);
            return v ? `<x v="${v}"/>` : '<x/>';
          });
          return `<i${same ? ` r="${same}"` : ''}>${xs.join('')}</i>`;
        })
        .join('')
    : '<i/>';
  const colItems = spec.data.map((_, i) => (i ? `<i i="${i}"><x v="${i}"/></i>` : '<i><x/></i>')).join('');
  const pageFields = spec.pages
    .map((p, i) => `<pageField fld="${p.fld}"${picks[i] !== undefined ? ` item="${pos(p.fld, picks[i]!)}"` : ''} hier="-1"/>`)
    .join('');
  const dataFields = spec.data.map((d) => `<dataField name="${esc(d.caption)}" fld="${d.fld}" baseField="0" baseItem="0"/>`).join('');
  const tableXml =
    `${HEAD}<pivotTableDefinition xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" name="${esc(spec.name)}" cacheId="${cacheId}" ` +
    'applyNumberFormats="0" applyBorderFormats="0" applyFontFormats="0" applyPatternFormats="0" applyAlignmentFormats="0" applyWidthHeightFormats="1" ' +
    'dataCaption="Values" updatedVersion="8" minRefreshableVersion="3" showCalcMbrs="0" showDrill="0" useAutoFormatting="1" rowGrandTotals="0" ' +
    'colGrandTotals="0" itemPrintTitles="1" createdVersion="3" indent="0" compact="0" compactData="0" multipleFieldFilters="0">' +
    `<location ref="A${top}:${colName(nCol - 1)}${last}" firstHeaderRow="1" firstDataRow="2" firstDataCol="${nRow}" rowPageCount="${pageRows}" colPageCount="1"/>` +
    `<pivotFields count="${PEN_ORDER_HEADERS.length}">${pivotFields}</pivotFields>` +
    `<rowFields count="${nRow}">${spec.rows.map((r) => `<field x="${r.fld}"/>`).join('')}</rowFields>` +
    `<rowItems count="${Math.max(lines.length, 1)}">${rowItems}</rowItems>` +
    `<colFields count="1"><field x="-2"/></colFields><colItems count="${spec.data.length}">${colItems}</colItems>` +
    `<pageFields count="${pageRows}">${pageFields}</pageFields><dataFields count="${spec.data.length}">${dataFields}</dataFields>` +
    `<formats count="1"><format dxfId="${DXF.big}"><pivotArea type="all" dataOnly="0" outline="0" fieldPosition="0"/></format></formats>` +
    '<pivotTableStyleInfo name="PivotStyleMedium2" showRowHeaders="0" showColHeaders="1" showRowStripes="1" showColStripes="0" showLastColumn="1"/>' +
    '<extLst><ext uri="{962EF5D1-5CA2-4c93-8EF4-DBF5C05439D2}" xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:pivotTableDefinition fillDownLabelsDefault="1"/></ext></extLst>' +
    '</pivotTableDefinition>';
  return { sheetXml, tableXml, headerRow: top + 1 };
}

/** The macro's workbook for these PenOrderData rows (already processed). */
export async function buildPendingWorkbook(rows: Cell[][], today = new Date()): Promise<Buffer> {
  const strings = new Strings();
  const cols = PEN_ORDER_HEADERS.map((_, c) => rows.map((r) => r[c]));

  // Every pivot uses one cache over PenOrderData; fields on any pivot's axis
  // get shared items (and so filter drop-downs).
  const specs: PivotSpec[] = [];
  const has = (sheet: string) => rows.some((r) => r[F.OrderSheet] === sheet);
  if (has('VirarPenOrder')) specs.push(orderPivot('ExceptShopPenOrder', 'VirarPenOrder'));
  if (has('ShopPenOrder')) specs.push(orderPivot('ShopPenOrder', 'ShopPenOrder'));
  specs.push(vendorPivot('VirarOrderToVendor', 'VirarPenOrder'), vendorPivot('ShopOrderToVendor', 'ShopPenOrder'));
  const axisFields = new Set(specs.flatMap((s) => [...s.rows, ...s.pages].map((x) => x.fld)));
  const fields: CacheField[] = PEN_ORDER_HEADERS.map((_, c) => {
    if (!axisFields.has(c)) return {};
    const shared = [...new Set(cols[c].map(keyOf))];
    const index = new Map(shared.map((k, i) => [k, i] as const));
    const order = shared.map((_, i) => i).sort((a, b) => compareKeys(shared[a], shared[b]));
    return { shared, index, order };
  });

  // PenOrderData: the processed rows under a navy header bar, with filter
  // buttons, a frozen header and dd-mm-yyyy dates.
  const lastRef = `AB${rows.length + 1}`;
  const dataRows = [
    rowXml(strings, 1, [...PEN_ORDER_HEADERS], () => S.dataHeader, ' ht="32" customHeight="1"'),
    ...rows.map((r, i) => rowXml(strings, i + 2, r, (_, v) => (v instanceof Date ? S.dataDate : S.dataCell))),
  ];
  const dataCols = PEN_ORDER_HEADERS.map((h, c) => {
    const longest = Math.max(h.length * 0.85, ...cols[c].map((v) => (v instanceof Date ? 10 : blank(v) ? 0 : String(v).length)));
    return `<col min="${c + 1}" max="${c + 1}" width="${Math.min(42, Math.max(8, longest + 2.5)).toFixed(2)}" customWidth="1"/>`;
  }).join('');
  const dataSheet =
    `${HEAD}<worksheet ${NS}><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastRef}"/>${frozenView(2, true)}` +
    `<sheetFormatPr defaultRowHeight="15"/><cols>${dataCols}</cols><sheetData>${dataRows.join('')}</sheetData>` +
    `<autoFilter ref="A1:${lastRef}"/>${PRINT}</worksheet>`;

  const cacheId = 1;
  const pivots = specs.map((s) => renderPivot(s, rows, fields, strings, today, cacheId));
  const cacheDef =
    `${HEAD}<pivotCacheDefinition ${NS} r:id="rId1" refreshOnLoad="1" refreshedBy="OMS" createdVersion="3" refreshedVersion="8" ` +
    `minRefreshableVersion="3" recordCount="${rows.length}"><cacheSource type="worksheet"><worksheetSource ref="A1:AB${rows.length + 1}" sheet="PenOrderData"/></cacheSource>` +
    `<cacheFields count="${PEN_ORDER_HEADERS.length}">${PEN_ORDER_HEADERS.map((h, c) => cacheFieldXml(h, cols[c], fields[c])).join('')}</cacheFields></pivotCacheDefinition>`;
  const cacheRecords =
    `${HEAD}<pivotCacheRecords ${NS} count="${rows.length}">` +
    rows.map((r) => `<r>${r.map((v, c) => recordValue(v, fields[c])).join('')}</r>`).join('') +
    '</pivotCacheRecords>';

  const sheets = ['PenOrderData', ...specs.map((s) => s.sheet)];
  const zip = new JSZip();
  const ct = (part: string, type: string) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.${type}+xml"/>`;
  zip.file(
    '[Content_Types].xml',
    `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      ct('xl/workbook.xml', 'sheet.main') +
      sheets.map((_, i) => ct(`xl/worksheets/sheet${i + 1}.xml`, 'worksheet')).join('') +
      pivots.map((_, i) => ct(`xl/pivotTables/pivotTable${i + 1}.xml`, 'pivotTable')).join('') +
      ct('xl/pivotCache/pivotCacheDefinition1.xml', 'pivotCacheDefinition') +
      ct('xl/pivotCache/pivotCacheRecords1.xml', 'pivotCacheRecords') +
      ct('xl/styles.xml', 'styles') +
      ct('xl/sharedStrings.xml', 'sharedStrings') +
      '</Types>',
  );
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const rels = (body: string) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${body}</Relationships>`;
  zip.file('_rels/.rels', rels(rel('rId1', 'officeDocument', 'xl/workbook.xml')));
  zip.file(
    'xl/workbook.xml',
    `${HEAD}<workbook ${NS}><bookViews><workbookView/></bookViews><sheets>` +
      sheets.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
      // The data sheet's filter, and the header row each sheet repeats when printed.
      `</sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'PenOrderData'!$A$1:$AB$${rows.length + 1}</definedName>` +
      `<definedName name="_xlnm.Print_Titles" localSheetId="0">'PenOrderData'!$1:$1</definedName>` +
      pivots.map((p, i) => `<definedName name="_xlnm.Print_Titles" localSheetId="${i + 1}">'${specs[i].sheet}'!$${p.headerRow}:$${p.headerRow}</definedName>`).join('') +
      `</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/><pivotCaches><pivotCache cacheId="${cacheId}" r:id="rId${sheets.length + 3}"/></pivotCaches></workbook>`,
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    rels(
      sheets.map((_, i) => rel(`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`)).join('') +
        rel(`rId${sheets.length + 1}`, 'styles', 'styles.xml') +
        rel(`rId${sheets.length + 2}`, 'sharedStrings', 'sharedStrings.xml') +
        rel(`rId${sheets.length + 3}`, 'pivotCacheDefinition', 'pivotCache/pivotCacheDefinition1.xml'),
    ),
  );
  zip.file('xl/worksheets/sheet1.xml', dataSheet);
  pivots.forEach((p, i) => {
    zip.file(`xl/worksheets/sheet${i + 2}.xml`, p.sheetXml);
    zip.file(`xl/worksheets/_rels/sheet${i + 2}.xml.rels`, rels(rel('rId1', 'pivotTable', `../pivotTables/pivotTable${i + 1}.xml`)));
    zip.file(`xl/pivotTables/pivotTable${i + 1}.xml`, p.tableXml);
    zip.file(`xl/pivotTables/_rels/pivotTable${i + 1}.xml.rels`, rels(rel('rId1', 'pivotCacheDefinition', '../pivotCache/pivotCacheDefinition1.xml')));
  });
  zip.file('xl/pivotCache/pivotCacheDefinition1.xml', cacheDef);
  zip.file('xl/pivotCache/_rels/pivotCacheDefinition1.xml.rels', rels(rel('rId1', 'pivotCacheRecords', 'pivotCacheRecords1.xml')));
  zip.file('xl/pivotCache/pivotCacheRecords1.xml', cacheRecords);
  zip.file('xl/styles.xml', STYLES);
  zip.file('xl/sharedStrings.xml', strings.xml());
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}
