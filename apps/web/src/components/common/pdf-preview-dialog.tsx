import { Download, ExternalLink, Eye } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { savePdfBlob } from '@/lib/pdf';

/**
 * Hides the browser viewer's own chrome so the document sits on an app surface
 * rather than the grey PDF shell. Hiding the toolbar takes its print/download
 * buttons with it, which is why this dialog supplies its own.
 */
export const PDF_VIEWER_PARAMS = '#toolbar=0&navpanes=0&scrollbar=0&view=FitH';

/**
 * A generated PDF, previewed WITHOUT leaving the app.
 *
 * `window.open` threw the document into a separate browser tab, which loses the
 * app around it: the user has to find their way back, and on a blob URL the tab
 * shows a bare UUID rather than anything identifying the document. Everything
 * here is the real generated file — an <iframe> hands the blob to the browser's
 * own PDF renderer, so this is the same bytes Download writes, not a re-render
 * that could differ from it.
 *
 * "Open in tab" is kept as a deliberate choice rather than the only behaviour,
 * for when a second window genuinely is wanted (comparing two documents, or
 * printing from the browser's own viewer).
 */
export function PdfPreviewDialog({
  title,
  url,
  blob,
  filename,
  onClose,
}: {
  /** Shown in the dialog header — name the document, not just "Preview". */
  title: string;
  /** Object URL for the iframe. */
  url: string;
  /** The bytes behind `url`, so Download saves without re-fetching. */
  blob?: Blob | null;
  filename: string;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[92dvh] w-[min(1100px,96vw)] max-w-[96vw] flex-col gap-3 overflow-hidden p-4 sm:!max-w-[1100px]">
        <DialogHeader className="space-y-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Eye className="size-4.5 text-violet-600" /> {title}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 w-full flex-1 overflow-hidden rounded-[6px] border bg-slate-200/60 shadow-inner dark:bg-slate-800/60">
          <iframe src={`${url}${PDF_VIEWER_PARAMS}`} title={title} className="size-full border-0" />
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="outline" onClick={() => window.open(url, '_blank')} title="Open this PDF in a browser tab">
            <ExternalLink /> Open in tab
          </Button>
          <Button
            onClick={() => {
              if (blob) void savePdfBlob(blob, filename);
              else window.open(url, '_blank');
            }}
            title="Save this PDF"
          >
            <Download /> Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
