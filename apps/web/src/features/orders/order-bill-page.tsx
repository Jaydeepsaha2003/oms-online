import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Download, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas-pro';
import { jsPDF } from 'jspdf';
import { Button } from '@/components/ui/button';
import { useOrder } from './use-orders';

// Exact brand colours for the Sales Order bill.
const BLUE = '#156082';
const ORANGE = '#F99A0F';
const AMBER = '#F59E0B';
const BLACK = '#111111';

const numf = (v: number | null) => (v == null || v === 0 ? '' : v.toLocaleString('en-IN'));
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 10mm; }
  body * { visibility: hidden !important; }
  #print-image { display: block !important; visibility: visible !important; position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
}`;

export function OrderBillPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const orderId = id ? Number(id) : undefined;
  const { data: order, isLoading } = useOrder(orderId);
  const [busy, setBusy] = useState(false);
  const [printImg, setPrintImg] = useState<string | null>(null);

  // Clear the print image once the print dialog closes.
  useEffect(() => {
    const clear = () => setPrintImg(null);
    window.addEventListener('afterprint', clear);
    return () => window.removeEventListener('afterprint', clear);
  }, []);

  // Capture the exact rendered Sales Order as a crisp A4-proportioned JPEG — both
  // Download and Print use this, so they look identical to the preview.
  const captureImage = async (): Promise<{ dataURL: string; ratio: number } | null> => {
    const src = document.getElementById('sales-order');
    if (!src) return null;
    const A4_W = 794; // px ≈ 210mm @ 96dpi
    const clone = src.cloneNode(true) as HTMLElement;
    clone.style.width = `${A4_W}px`;
    clone.style.borderRadius = '0';
    const holder = document.createElement('div');
    holder.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_W}px;background:#ffffff`;
    holder.appendChild(clone);
    document.body.appendChild(holder);
    const canvas = await html2canvas(clone, { scale: 3, backgroundColor: '#ffffff' });
    holder.remove();
    return { dataURL: canvas.toDataURL('image/jpeg', 0.95), ratio: canvas.height / canvas.width };
  };

  const download = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) return;
      const pdf = new jsPDF({ unit: 'pt', format: 'a4', orientation: 'portrait' });
      const margin = 24;
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgW = pageW - margin * 2;
      const imgH = cap.ratio * imgW;
      if (imgH <= pageH - margin * 2) {
        pdf.addImage(cap.dataURL, 'JPEG', margin, margin, imgW, imgH);
      } else {
        let heightLeft = imgH;
        pdf.addImage(cap.dataURL, 'JPEG', margin, margin, imgW, imgH);
        heightLeft -= pageH - margin * 2;
        while (heightLeft > 0) {
          pdf.addPage();
          pdf.addImage(cap.dataURL, 'JPEG', margin, margin - (imgH - heightLeft), imgW, imgH);
          heightLeft -= pageH - margin * 2;
        }
      }
      pdf.save(`${order.code ?? `order-${orderId}`}-sales-order.pdf`);
    } catch {
      toast.error('Could not generate the PDF');
    } finally {
      setBusy(false);
    }
  };

  // Print the captured image only — guarantees no app/menu text and an exact match.
  const print = async () => {
    setBusy(true);
    try {
      const cap = await captureImage();
      if (!cap) return;
      setPrintImg(cap.dataURL);
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      window.print();
    } catch {
      toast.error('Could not prepare the print');
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => {
    const items = order?.items ?? [];
    return {
      bags: items.reduce((s, it) => s + (it.bags ?? 0), 0),
      pcs: items.reduce((s, it) => s + (it.pcs ?? 0), 0),
      kgs: items.reduce((s, it) => s + (it.gram ?? 0), 0),
      box: items.reduce((s, it) => s + (it.box ?? 0), 0),
    };
  }, [order]);

  if (isLoading || !order) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="size-6 animate-spin" />
      </div>
    );
  }

  const BORDER = '#C9D2DC';
  const th: CSSProperties = { background: ORANGE, color: BLACK, border: `1px solid ${BORDER}`, padding: '7px 9px', fontWeight: 700 };
  const td: CSSProperties = { border: `1px solid ${BORDER}`, padding: '6px 9px' };

  return (
    <div className="flex w-full flex-col gap-4">
      <style>{PRINT_CSS}</style>
      {/* Hidden on screen; the only thing visible when printing. */}
      {printImg && <img id="print-image" src={printImg} alt="Sales Order" style={{ display: 'none' }} />}

      <div className="no-print flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft />
        </Button>
        <h2 className="text-xl font-bold tracking-tight">Sales Order</h2>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={print} disabled={busy}>
            <Printer /> Print
          </Button>
          <Button onClick={download} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
          </Button>
        </div>
      </div>

      {/* ── Printable Sales Order ───────────────────────────────────────── */}
      <div
        id="sales-order"
        style={{
          background: '#fff',
          color: BLACK,
          border: 'none',
          overflow: 'hidden',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {/* Title bar — blue with amber accent */}
        <div style={{ background: BLUE, color: '#fff', borderBottom: `4px solid ${AMBER}`, padding: '10px 16px', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: 1 }}>SALES ORDER</h1>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 16 }}>{order.code ?? `#${order.id}`}</span>
        </div>

        {/* Bill-to + order meta */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '12px 16px' }}>
          <div>
            <div style={{ color: BLUE, fontWeight: 700, textTransform: 'uppercase', fontSize: 11, letterSpacing: 0.5 }}>Bill To,</div>
            <div style={{ fontSize: 16, fontWeight: 800 }}>{order.customerName}</div>
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {([
                ['Order No', order.code ?? `#${order.id}`],
                ['Order Date', fmtDate(order.orderDate)],
                ['Due Date', fmtDate(order.completionDate)],
              ] as const).map(([label, value]) => (
                <tr key={label}>
                  <td style={{ color: BLUE, fontWeight: 700, padding: '1px 12px 1px 0', whiteSpace: 'nowrap' }}>{label} :</td>
                  <td style={{ color: BLACK, fontWeight: 600, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Items */}
        <div style={{ padding: '0 16px 16px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 34, textAlign: 'center' }}>#</th>
                <th style={{ ...th, textAlign: 'left' }}>Item Name</th>
                <th style={{ ...th, textAlign: 'right' }}>Bags</th>
                <th style={{ ...th, textAlign: 'right' }}>PCs</th>
                <th style={{ ...th, textAlign: 'right' }}>KGs</th>
                <th style={{ ...th, textAlign: 'right' }}>Box</th>
                <th style={{ ...th, textAlign: 'right' }}>Rate</th>
                <th style={{ ...th, textAlign: 'left' }}>Comment</th>
              </tr>
            </thead>
            <tbody>
              {order.items.map((it, idx) => (
                <tr key={it.id} style={{ background: idx % 2 === 1 ? '#F5F7FA' : '#fff' }}>
                  <td style={{ ...td, textAlign: 'center' }}>{idx + 1}</td>
                  <td style={{ ...td, fontWeight: 600 }}>{it.productName || it.product || '—'}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.bags)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.pcs)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.gram)}</td>
                  <td style={{ ...td, textAlign: 'right' }}>{numf(it.box)}</td>
                  <td style={{ ...td, textAlign: 'right', color: BLACK, fontWeight: 700 }}>{numf(it.rate)}</td>
                  <td style={td}>{it.comment || ''}</td>
                </tr>
              ))}
              {/* Total row — orange, quantity sums */}
              <tr>
                <td style={{ ...th, textAlign: 'right' }} colSpan={2}>Total</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.bags)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.pcs)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.kgs)}</td>
                <td style={{ ...th, textAlign: 'right' }}>{numf(totals.box)}</td>
                <td style={th} colSpan={2} />
              </tr>
            </tbody>
          </table>
        </div>

        <div style={{ borderTop: `1px solid ${AMBER}`, padding: '6px 16px', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#666' }}>
          <span>{new Date().toLocaleString('en-GB')}</span>
          <span>**This is a computer-generated sales order**</span>
        </div>
      </div>
    </div>
  );
}

export default OrderBillPage;
