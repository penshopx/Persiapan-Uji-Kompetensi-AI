import { AlertTriangle, RotateCw } from 'lucide-react';

export function Disclaimer({ compact }: { compact?: boolean }) {
  return (
    <div data-testid="text-disclaimer" className="flex gap-3 border border-primary/50 bg-primary/10 p-3 text-sm">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p>
        <b>Persiapan, bukan sertifikasi.</b>{' '}
        {compact ? 'Unit adalah unit rujukan dari standar yang disediakan, bukan paket sertifikasi tingkat jenjang yang terverifikasi.'
          : 'Unit yang tampil adalah unit rujukan dari standar yang disediakan, bukan paket sertifikasi tingkat jenjang yang telah terverifikasi. Kelulusan hanya ditetapkan oleh LSP dan asesor berwenang.'}
      </p>
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" data-testid="state-loading">
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="skel h-16" style={{ animationDelay: `${i * 120}ms` }} />)}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message?: string; onRetry: () => void }) {
  return (
    <div data-testid="state-error" className="border border-destructive/60 bg-destructive/10 p-5">
      <p className="font-bold">Data gagal dimuat</p>
      <p className="mt-1 text-sm text-muted-foreground">{message || 'Layanan tidak merespons. Periksa koneksi lalu coba lagi.'}</p>
      <button data-testid="button-retry" onClick={onRetry} className="mt-3 inline-flex items-center gap-2 bg-primary px-4 py-2 text-sm font-bold text-primary-foreground">
        <RotateCw className="h-4 w-4" /> Coba lagi
      </button>
    </div>
  );
}

export function Empty({ title, hint, children }: { title: string; hint: string; children?: React.ReactNode }) {
  return (
    <div data-testid="state-empty" className="border border-dashed border-border p-8 text-center">
      <p className="text-lg font-bold">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{hint}</p>
      {children && <div className="mt-4">{children}</div>}
    </div>
  );
}

export function SourceBadge({ text }: { text: string }) {
  return <span className="mono inline-block border border-primary/60 px-2 py-0.5 text-[11px] uppercase tracking-wide text-primary">{text}</span>;
}
