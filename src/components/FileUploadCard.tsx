import { useCallback, useState } from "react";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, Trash2, Eye, Download, Pencil, Check, X, ClipboardPaste } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  uploadSourceFile,
  createSourceFileFromText,
  processFile,
  deleteSourceFile,
  getSourceFileContent,
  getSourceFileDownloadUrl,
  renameSourceFile,
  updateSourceFileStrength,
  type ScriptStrength,
  type SourceFile,
} from "@/lib/api";
import { toast } from "sonner";
import { SourceDetailModal } from "@/components/SourceDetailModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useChannel } from "@/contexts/ChannelContext";

interface FileUploadCardProps {
  fileType: "book" | "transcript" | "instructions" | "competitor_analysis" | "host_persona" | "anti_ai_guide" | "melty_voice_pass";
  title: string;
  description: string;
  accept?: string;
  files: SourceFile[];
  onRefresh: () => void;
  badge?: string;
  briefId?: string;
}

export function FileUploadCard({ fileType, title, description, accept = ".txt,.md,.pdf", files, onRefresh, badge, briefId }: FileUploadCardProps) {
  const { channelId } = useChannel();
  const [uploading, setUploading] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SourceFile | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState<string>("");
  const [renameSaving, setRenameSaving] = useState(false);

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList?.length) return;

    setUploading(true);
    try {
      for (const file of Array.from(fileList)) {
        const uploaded = await uploadSourceFile(file, fileType, channelId!, briefId ?? null);
        toast.success(`Uploaded ${file.name}`);
        
        // Auto-process
        setProcessing(uploaded.id);
        await processFile(uploaded.id);
        toast.success(`Indexed ${file.name} (chunked for search)`);
      }
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Upload failed");
    } finally {
      setUploading(false);
      setProcessing(null);
    }
  }, [fileType, onRefresh, channelId, briefId]);

  const handleDelete = async (file: SourceFile) => {
    try {
      await deleteSourceFile(file.id, file.storage_path, channelId!);
      toast.success(`Deleted ${file.name}`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    }
  };

  const handleReprocess = async (file: SourceFile) => {
    setProcessing(file.id);
    try {
      await processFile(file.id);
      toast.success(`Re-indexed ${file.name}`);
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Processing failed");
    } finally {
      setProcessing(null);
    }
  };

  const handleDownload = async (file: SourceFile) => {
    setDownloadingId(file.id);
    try {
      if (file.storage_path) {
        const url = await getSourceFileDownloadUrl(file.storage_path);
        const a = document.createElement("a");
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
      } else {
        const text = await getSourceFileContent(file.id);
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${file.name || "source"}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      toast.error(err.message || "Download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  const startRename = (file: SourceFile) => {
    setRenamingId(file.id);
    setRenameValue(file.name);
  };

  const cancelRename = () => {
    setRenamingId(null);
    setRenameValue("");
  };

  const confirmRename = async (file: SourceFile) => {
    setRenameSaving(true);
    try {
      await renameSourceFile(file.id, file.storage_path, file.name, renameValue, channelId!);
      toast.success(`Renamed to ${renameValue.trim()}`);
      setRenamingId(null);
      setRenameValue("");
      onRefresh();
    } catch (err: any) {
      toast.error(err.message || "Rename failed");
    } finally {
      setRenameSaving(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "indexed": return <CheckCircle2 className="w-3.5 h-3.5 text-success" />;
      case "processing": return <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />;
      default: return <AlertCircle className="w-3.5 h-3.5 text-warning" />;
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-mono text-sm font-semibold text-foreground">{title}</h3>
            {badge && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        </div>
        <div className="relative">
          <input
            type="file"
            accept={accept}
            multiple={fileType !== "instructions"}
            onChange={handleUpload}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            disabled={uploading}
          />
          <Button size="sm" variant="outline" disabled={uploading} className="gap-1.5">
            {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
            Upload
          </Button>
        </div>
      </div>

      {files.length === 0 ? (
        <div className="border border-dashed border-border rounded-md p-6 text-center">
          <FileText className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No files uploaded yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {files.map((file) => (
            <div
              key={file.id}
              className={cn(
                "flex items-start gap-3 px-3 py-2 rounded-md text-sm",
                "bg-secondary/50 border border-border"
              )}
            >
              <div className="mt-0.5">
                {processing === file.id ? (
                  <Loader2 className="w-3.5 h-3.5 text-primary animate-spin" />
                ) : (
                  statusIcon(file.status)
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {renamingId === file.id ? (
                    <Input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); confirmRename(file); }
                        else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
                      }}
                      disabled={renameSaving}
                      className="h-7 text-xs font-mono"
                    />
                  ) : (
                    <>
                      <span className="flex-1 truncate text-foreground text-xs font-mono">{file.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {file.file_size ? `${(file.file_size / 1024).toFixed(0)}KB` : ""}
                      </span>
                    </>
                  )}
                </div>
              </div>
              {renamingId === file.id ? (
                <>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={() => confirmRename(file)}
                    disabled={renameSaving}
                    title="Confirm rename"
                  >
                    {renameSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6"
                    onClick={cancelRename}
                    disabled={renameSaving}
                    title="Cancel"
                  >
                    <X className="w-3 h-3" />
                  </Button>
                </>
              ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-6 w-6"
                  onClick={() => startRename(file)}
                  title="Rename"
                >
                  <Pencil className="w-3 h-3" />
                </Button>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => handleReprocess(file)}
                disabled={processing === file.id}
                title="Re-index"
              >
                <Sparkles className="w-3 h-3" />
              </Button>
              {fileType === "competitor_analysis" && (
                <Select
                  value={(file as any).script_strength ?? "unset"}
                  onValueChange={async (v) => {
                    const next = v === "unset" ? null : (v as ScriptStrength);
                    try {
                      await updateSourceFileStrength(file.id, next, channelId!);
                      onRefresh();
                    } catch (err: any) {
                      toast.error(err.message || "Failed to update quality");
                    }
                  }}
                >
                  <SelectTrigger className="h-7 w-[110px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="strong">Strong</SelectItem>
                    <SelectItem value="useful">Useful</SelectItem>
                    <SelectItem value="limited">Limited</SelectItem>
                    <SelectItem value="unset">Not set</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setViewing(file)}
                title="View content"
              >
                <Eye className="w-3 h-3" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => handleDownload(file)}
                disabled={downloadingId === file.id}
                title="Download"
              >
                {downloadingId === file.id ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Download className="w-3 h-3" />
                )}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 text-destructive"
                onClick={() => handleDelete(file)}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <SourceDetailModal
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          title={viewing.name}
          subtitle={title}
          meta={[
            { label: "Filename", value: viewing.name },
            { label: "Category", value: title },
            { label: "File type", value: viewing.file_type },
            { label: "Status", value: viewing.status },
            { label: "Size", value: viewing.file_size ? `${(viewing.file_size / 1024).toFixed(1)} KB` : "—" },
            { label: "Uploaded", value: new Date(viewing.created_at).toLocaleString() },
          ]}
          loadContent={() => getSourceFileContent(viewing.id)}
          onDownload={() => handleDownload(viewing)}
          fallbackDownloadName={`${viewing.name}.txt`}
        />
      )}
    </div>
  );
}

function Sparkles({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
    </svg>
  );
}
