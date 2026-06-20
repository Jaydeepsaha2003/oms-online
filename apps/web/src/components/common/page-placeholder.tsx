import { Download, FileText, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

/**
 * Stand-in for a screen that hasn't been built yet. The cross-cutting features
 * (Excel, PDF, RBAC, audit) are already wired — this page just shows where they
 * plug in. Replace it with a real feature module when you build the screen.
 */
export function PagePlaceholder({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-xl">{title}</CardTitle>
              <CardDescription>
                This screen is part of the scaffold and isn’t built yet.
              </CardDescription>
            </div>
            <Badge variant="secondary">Scaffold</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Build it by adding a feature folder under <code>src/features</code> and a matching
            NestJS module under <code>apps/api/src</code>. The plumbing below is already available
            everywhere.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info('Wire to lib/excel.ts → exportToExcel or the API export endpoint')}
            >
              <Download /> Export to Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info('Wire to lib/excel.ts → parseExcelFile, then POST the rows')}
            >
              <Upload /> Import from Excel
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info('Wire to PdfService on the API, download via lib/pdf.ts')}
            >
              <FileText /> Generate PDF
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
