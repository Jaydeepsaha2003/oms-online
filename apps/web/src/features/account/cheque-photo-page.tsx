import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Camera, CheckCircle2, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { getApiErrorMessage, http, uploadFile } from '@/lib/api';
import { Button } from '@/components/ui/button';

interface PhotoRequest {
  id: string;
  partyName: string;
  chequeAmt: number | null;
  requestedBy: string | null;
  photoUrl: string | null;
}

/**
 * Opened from the "Cheque photo needed" push on the admin's phone: take the
 * photo, crop it to the cheque, it goes straight to the Add Cheque form waiting
 * on the desktop, then "Thanks" and back to the dashboard.
 */
export function ChequePhotoPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { data: req, error, isLoading } = useQuery({
    queryKey: ['cheque-photo-request', id],
    queryFn: () => http.get<PhotoRequest>(`/cheques/photo-requests/${id}`),
    retry: false,
  });
  const [shot, setShot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  useEffect(() => () => void (shot && URL.revokeObjectURL(shot)), [shot]);

  const send = async (file: File) => {
    setBusy(true);
    try {
      const { url } = await uploadFile(file, undefined, 'cheques');
      await http.post(`/cheques/photo-requests/${id}`, { photoUrl: url });
      setDone(true);
      setTimeout(() => navigate('/', { replace: true }), 2000);
    } catch (e) {
      toast.error(getApiErrorMessage(e, 'Photo upload failed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-5 p-4 text-center">
      {done ? (
        <>
          <CheckCircle2 className="size-16 text-emerald-600" />
          <p className="text-xl font-bold">Thanks for uploading!</p>
          <p className="text-muted-foreground text-sm">The photo is on the cheque form now. Taking you to the dashboard…</p>
        </>
      ) : isLoading ? (
        <Loader2 className="size-8 animate-spin" />
      ) : error || !req ? (
        <p className="text-rose-600">{getApiErrorMessage(error, 'This photo request was not found.')}</p>
      ) : req.photoUrl ? (
        <p className="text-muted-foreground">A photo was already sent for this cheque.</p>
      ) : shot ? (
        <Cropper src={shot} busy={busy} onRetake={() => setShot(null)} onUse={(f) => void send(f)} />
      ) : (
        <>
          <p className="text-xl font-bold">Cheque photo</p>
          <p className="text-muted-foreground">
            {[req.partyName, req.chequeAmt ? `₹${req.chequeAmt.toLocaleString('en-IN')}` : null].filter(Boolean).join(' · ')}
            {req.requestedBy ? ` — asked by ${req.requestedBy}` : ''}
          </p>
          <label className="bg-primary text-primary-foreground inline-flex h-14 w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-lg font-bold shadow">
            <Camera className="size-6" /> Take photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) setShot(URL.createObjectURL(f));
              }}
            />
          </label>
        </>
      )}
    </div>
  );
}

type Box = { x: number; y: number; w: number; h: number }; // percent of the shown image
type Grip = 'move' | 'nw' | 'ne' | 'sw' | 'se';
const MIN = 10;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Drag the box (or its corners) onto the cheque; "Use photo" cuts it out. */
function Cropper({ src, busy, onRetake, onUse }: { src: string; busy: boolean; onRetake: () => void; onUse: (f: File) => void }) {
  const [box, setBox] = useState<Box>({ x: 4, y: 4, w: 92, h: 92 });
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ grip: Grip; sx: number; sy: number; b: Box } | null>(null);

  const start = (grip: Grip) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { grip, sx: e.clientX, sy: e.clientY, b: box };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    const r = wrap.current?.getBoundingClientRect();
    if (!d || !r) return;
    const dx = ((e.clientX - d.sx) / r.width) * 100;
    const dy = ((e.clientY - d.sy) / r.height) * 100;
    const b = d.b;
    if (d.grip === 'move') return setBox({ ...b, x: clamp(b.x + dx, 0, 100 - b.w), y: clamp(b.y + dy, 0, 100 - b.h) });
    let { x, y, w, h } = b;
    if (d.grip.includes('w')) { const nx = clamp(b.x + dx, 0, b.x + b.w - MIN); w = b.w + (b.x - nx); x = nx; }
    if (d.grip.includes('e')) w = clamp(b.w + dx, MIN, 100 - b.x);
    if (d.grip.includes('n')) { const ny = clamp(b.y + dy, 0, b.y + b.h - MIN); h = b.h + (b.y - ny); y = ny; }
    if (d.grip.includes('s')) h = clamp(b.h + dy, MIN, 100 - b.y);
    setBox({ x, y, w, h });
  };

  const use = () => {
    const i = img.current;
    if (!i) return;
    const sx = (box.x / 100) * i.naturalWidth;
    const sy = (box.y / 100) * i.naturalHeight;
    const sw = (box.w / 100) * i.naturalWidth;
    const sh = (box.h / 100) * i.naturalHeight;
    const scale = Math.min(1, 2000 / sw); // a 12 MP phone shot is far more than a cheque needs
    const c = document.createElement('canvas');
    c.width = Math.round(sw * scale);
    c.height = Math.round(sh * scale);
    c.getContext('2d')!.drawImage(i, sx, sy, sw, sh, 0, 0, c.width, c.height);
    c.toBlob((blob) => blob && onUse(new File([blob], 'cheque.jpg', { type: 'image/jpeg' })), 'image/jpeg', 0.85);
  };

  const corner = 'absolute size-6 rounded-full border-2 border-white bg-indigo-600 touch-none';
  return (
    <div className="flex w-full flex-col gap-3">
      <p className="text-sm font-semibold">Drag the box onto the cheque</p>
      <div ref={wrap} className="relative w-full touch-none select-none" onPointerMove={move} onPointerUp={() => (drag.current = null)}>
        <img ref={img} src={src} alt="Cheque" className="block w-full rounded-md" draggable={false} />
        <div
          className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]"
          style={{ left: `${box.x}%`, top: `${box.y}%`, width: `${box.w}%`, height: `${box.h}%` }}
          onPointerDown={start('move')}
        >
          <span className={`${corner} -top-3 -left-3`} onPointerDown={start('nw')} />
          <span className={`${corner} -top-3 -right-3`} onPointerDown={start('ne')} />
          <span className={`${corner} -bottom-3 -left-3`} onPointerDown={start('sw')} />
          <span className={`${corner} -right-3 -bottom-3`} onPointerDown={start('se')} />
        </div>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" className="h-12 flex-1" onClick={onRetake} disabled={busy}>
          <RotateCcw className="size-4" /> Retake
        </Button>
        <Button className="h-12 flex-1 text-base font-bold" onClick={use} disabled={busy}>
          {busy ? <Loader2 className="size-5 animate-spin" /> : <CheckCircle2 className="size-5" />} {busy ? 'Uploading…' : 'Use photo'}
        </Button>
      </div>
    </div>
  );
}
