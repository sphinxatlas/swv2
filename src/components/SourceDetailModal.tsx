import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Copy, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export interface SourceDetailMeta {
  label: string;
  value: string | number | null | undefined;
}

interface SourceDetailModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  subtitle?: string;
  meta: SourceDetailMeta[];
  // Either provide content directly, or a loader to fetch it lazily
  content?: string;
  loadContent?: () => Promise<string>;
  // Download handler — if omitted, fallback is a .txt of the rendered content
  onDownload?: () => Promise<void> | void;
  fallbackDownloadName?: string; // used when generating .txt fallback
}

export function SourceDetailModal({
  open,
  onOpenChange,
  title,
  subtitle,
  meta,
  content,
  loadContent,
  onDownload,
  fallbackDownloadName,
}: SourceDetailModalProps) {
  const [text, setText] = useState<string>(content ?? "");
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (content !== undefined) {
      setText(content);
      return;
    }
    if (loadContent) {
      setLoading(true);
      loadContent()
        .then((t) => setText(t ?? ""))
        .catch((err: any) => toast.error(err.message || "Failed to load content"))
        .finally(() => setLoading(false));
    }
  }, [open, content, loadContent]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied to clipboard");
    } catch {
      toast.error("Copy failed");
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    try {
      if (onDownload) {
        await onDownload();
      } else {
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fallbackDownloadName || `${title || "source"}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      toast.error(err.message || "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  // Cap rendered text to keep the UI snappy on huge files
  const MAX_PREVIEW_CHARS = 500_000;
  const truncated = text.length > MAX_PREVIEW_CHARS;
  const previewText = truncated ? text.slice(0, MAX_PREVIEW_CHARS) : text;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="font-mono text-base truncate">{title}</DialogTitle>
          {subtitle && <DialogDescription className="text-xs">{subtitle}</DialogDescription>}
        </DialogHeader>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-xs border border-border rounded-md p-3 bg-secondary/40">
          {meta.map((m) => (
            <div key={m.label} className="min-w-0">
              <div className="text-muted-foreground uppercase tracking-wide text-[10px]">{m.label}</div>
              <div className="text-foreground truncate" title={String(m.value ?? "—")}>
                {m.value === null || m.value === undefined || m.value === "" ? "—" : String(m.value)}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {loading
              ? "Loading content…"
              : truncated
                ? `Showing first ${MAX_PREVIEW_CHARS.toLocaleString()} of ${text.length.toLocaleString()} characters. Download for full content.`
                : `${text.length.toLocaleString()} characters`}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy} disabled={loading || !text} className="gap-1.5">
              <Copy className="w-3.5 h-3.5" /> Copy
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={downloading || loading} className="gap-1.5">
              {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Download
            </Button>
          </div>
        </div>

        <div className="flex-1 min-h-[300px] max-h-[60vh] overflow-y-auto border border-border rounded-md bg-background">
          {loading ? (
            <div className="p-4 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-11/12" />
              <Skeleton className="h-3 w-10/12" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-9/12" />
            </div>
          ) : previewText ? (
            <pre className="p-4 text-xs font-mono whitespace-pre-wrap break-words text-foreground">{previewText}</pre>
          ) : (
            <div className="p-6 text-center text-sm text-muted-foreground">No content available.</div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
