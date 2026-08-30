import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  getFormatReferenceTranscripts,
  saveFormatReferenceTranscript,
  deleteFormatReferenceTranscript,
  getBriefTopicTranscripts,
  saveBriefTopicTranscript,
  deleteBriefTopicTranscript,
  getAlternativeSources,
  saveAlternativeSource,
  deleteAlternativeSource,
  updateBriefTopicTranscriptStrength,
  updateAlternativeSourceStrength,
  updateFormatReferenceTranscript,
  updateBriefTopicTranscript,
  updateAlternativeSource,
  type ScriptStrength,
} from "@/lib/api";
import { Plus, Trash2, Eye, Download, Pencil } from "lucide-react";
import { toast } from "sonner";
import { SourceDetailModal } from "@/components/SourceDetailModal";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SourceEntryForm, QualitySelect, QUALITY_HELPER_TEXT } from "@/components/SourceEntryForm";
import { useChannel } from "@/contexts/ChannelContext";

type Section = "format" | "topic";

function TranscriptSection({ section }: { section: Section }) {
  const { channelId } = useChannel();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [editing, setEditing] = useState<any | null>(null);

  const queryKey = section === "format" ? "format-references" : "topic-transcripts";
  const fetchFn = section === "format" ? getFormatReferenceTranscripts : getBriefTopicTranscripts;
  const saveFn = section === "format" ? saveFormatReferenceTranscript : saveBriefTopicTranscript;
  const deleteFn = section === "format" ? deleteFormatReferenceTranscript : deleteBriefTopicTranscript;
  const updateFn = section === "format" ? updateFormatReferenceTranscript : updateBriefTopicTranscript;

  const { data: items = [], refetch } = useQuery({
    queryKey: [queryKey, channelId],
    queryFn: () => fetchFn(channelId!),
    enabled: !!channelId,
  });

  const label =
    section === "format"
      ? "Material from a different subject, used for argument structure, pacing, and angle positioning only. Never a source of content for your videos."
      : "Secondary material attached to one brief: research packs, articles, reports, transcripts, thread summaries. Research leads and supplementary knowledge only. Never cited directly in scripts.";

  const addLabel = section === "format" ? "Add Format Reference" : "Add Brief Research";

  const handleSave = async (input: { channel_name: string; video_title: string; transcript: string }) => {
    setBusy(true);
    try {
      await saveFn(input, channelId!);
      toast.success("Transcript saved");
      setShowForm(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const handleEditSave = async (input: { channel_name: string; video_title: string; transcript: string }) => {
    setBusy(true);
    try {
      await updateFn(editing.id, input, channelId!);
      toast.success("Changes saved");
      setEditing(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteFn(id, channelId!);
      toast.success("Deleted");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    }
  };

  const downloadText = (filename: string, text: string) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const sectionLabel = section === "format" ? "Format Reference" : "Brief Research";

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">{label}</p>
      {section === "topic" && (
        <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
          <strong>{QUALITY_HELPER_TEXT}</strong>
        </p>
      )}

      {!showForm && (
        <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5 mb-4">
          <Plus className="w-3.5 h-3.5" />
          {addLabel}
        </Button>
      )}

      {showForm && (
        <SourceEntryForm onSave={handleSave} onCancel={() => setShowForm(false)} busy={busy} />
      )}

      {editing && (
        <SourceEntryForm
          mode="edit"
          initial={{
            channel_name: editing.channel_name,
            video_title: editing.video_title,
            transcript: editing.transcript,
          }}
          onSave={handleEditSave}
          onCancel={() => setEditing(null)}
          busy={busy}
        />
      )}

      {items.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No transcripts saved yet.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Source</TableHead>
                <TableHead>Title</TableHead>
                {section === "topic" && <TableHead className="w-32">Quality</TableHead>}
                <TableHead>Date Added</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item: any) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium align-top">{item.channel_name}</TableCell>
                  <TableCell className="align-top">
                    <div>{item.video_title}</div>
                  </TableCell>
                  {section === "topic" && (
                    <TableCell>
                      <QualitySelect
                        value={item.script_strength}
                        onChange={async (next) => {
                          await updateBriefTopicTranscriptStrength(item.id, next, channelId!);
                          refetch();
                        }}
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="View" onClick={() => setViewing(item)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => { setShowForm(false); setEditing(item); }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Download"
                        onClick={() =>
                          downloadText(`${item.channel_name} - ${item.video_title}.txt`, item.transcript || "")
                        }
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {viewing && (
        <SourceDetailModal
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          title={viewing.video_title}
          subtitle={sectionLabel}
          meta={[
            { label: "Source", value: viewing.channel_name },
            { label: "Title", value: viewing.video_title },
            { label: "Category", value: sectionLabel },
            { label: "Date added", value: new Date(viewing.created_at).toLocaleString() },
            { label: "Length", value: `${(viewing.transcript || "").length.toLocaleString()} chars` },
            { label: "Status", value: "Stored" },
          ]}
          content={viewing.transcript || ""}
          fallbackDownloadName={`${viewing.channel_name} - ${viewing.video_title}.txt`}
        />
      )}
    </div>
  );
}

function AlternativeSourcesSection() {
  const { channelId } = useChannel();
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<any | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [sourceAuthor, setSourceAuthor] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [notes, setNotes] = useState("");

  const { data: items = [], refetch } = useQuery({
    queryKey: ["alternative-sources", channelId],
    queryFn: () => getAlternativeSources(channelId!),
    enabled: !!channelId,
  });

  const startEdit = (item: any) => {
    setShowForm(false);
    setEditingId(item.id);
    setTitle(item.title || "");
    setSourceType(item.source_type || "");
    setSourceAuthor(item.source_author || "");
    setUrl(item.url || "");
    setContent(item.content || "");
    setNotes(item.notes || "");
  };

  const handleUpdate = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Title and pasted text are required");
      return;
    }
    setBusy(true);
    try {
      await updateAlternativeSource(editingId!, {
        title: title.trim(),
        content: content.trim(),
        source_type: sourceType.trim() || null,
        source_author: sourceAuthor.trim() || null,
        url: url.trim() || null,
        notes: notes.trim() || null,
      }, channelId!);
      toast.success("Changes saved");
      reset();
      setEditingId(null);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTitle("");
    setSourceType("");
    setSourceAuthor("");
    setUrl("");
    setContent("");
    setNotes("");
  };

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      toast.error("Title and pasted text are required");
      return;
    }
    setBusy(true);
    try {
      await saveAlternativeSource({
        title: title.trim(),
        content: content.trim(),
        source_type: sourceType.trim() || null,
        source_author: sourceAuthor.trim() || null,
        url: url.trim() || null,
        notes: notes.trim() || null,
      }, channelId!);
      toast.success("Alternative source saved");
      reset();
      setShowForm(false);
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAlternativeSource(id, channelId!);
      toast.success("Deleted");
      refetch();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete");
    }
  };

  const downloadText = (filename: string, text: string) => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-4">
        Reusable secondary material for this channel across briefs: research packs, articles, threads, forums, blogs, comment summaries. Helps with audience insight, framing, and angle inspiration. Never treated as a primary source.
      </p>
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        <strong>{QUALITY_HELPER_TEXT}</strong>
      </p>

      {!showForm && (
        <Button onClick={() => setShowForm(true)} size="sm" className="gap-1.5 mb-4">
          <Plus className="w-3.5 h-3.5" />
          Add Alternative Source
        </Button>
      )}

      {(showForm || editingId) && (
        <div className="border border-primary/30 rounded-lg p-4 mb-4 bg-card space-y-3">
          <div>
            <Label className="text-xs text-muted-foreground">
              Source title <span className="text-destructive">*</span>
            </Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder='e.g., "Reddit megathread on this topic"'
              className="bg-secondary border-border mt-1"
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Source type (optional)</Label>
              <Input
                value={sourceType}
                onChange={(e) => setSourceType(e.target.value)}
                placeholder="Reddit thread, YouTube comments, Blog post, Forum, Fan notes…"
                className="bg-secondary border-border mt-1"
                list="alt-source-types"
              />
              <datalist id="alt-source-types">
                <option value="Reddit thread" />
                <option value="YouTube comments" />
                <option value="Blog post" />
                <option value="Website" />
                <option value="Forum" />
                <option value="Fan notes" />
                <option value="Meme research" />
                <option value="Other" />
              </datalist>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">
                Source / author / platform (optional)
              </Label>
              <Input
                value={sourceAuthor}
                onChange={(e) => setSourceAuthor(e.target.value)}
                placeholder="Reddit, MuggleNet, Tumblr, personal notes…"
                className="bg-secondary border-border mt-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">URL (optional)</Label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              className="bg-secondary border-border mt-1"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">
              Pasted text content <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste the thread, comments, post, or notes here…"
              rows={10}
              className="bg-secondary border-border resize-none mt-1 text-xs font-mono"
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Notes / use case (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder='e.g., "Use for audience humor and inside jokes, not as evidence."'
              rows={2}
              className="bg-secondary border-border resize-none mt-1 text-xs"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                reset();
                setShowForm(false);
                setEditingId(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={editingId ? handleUpdate : handleSave} disabled={busy}>
              {busy ? "Saving..." : editingId ? "Save changes" : "Save Alternative Source"}
            </Button>
          </div>
        </div>
      )}

      {items.length === 0 ? (
        <div className="border border-dashed border-border rounded-lg p-8 text-center text-sm text-muted-foreground">
          No alternative sources saved yet.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-32">Quality</TableHead>
                <TableHead>Date Added</TableHead>
                <TableHead className="w-16"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium align-top">
                    <div>{item.title}</div>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.source_type || "—"}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {item.source_author || "—"}
                  </TableCell>
                  <TableCell>
                    <QualitySelect
                      value={item.script_strength as ScriptStrength | undefined}
                      onChange={async (next) => {
                        await updateAlternativeSourceStrength(item.id, next, channelId!);
                        refetch();
                      }}
                    />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(item.created_at).toLocaleDateString()}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="View" onClick={() => setViewing(item)}>
                        <Eye className="w-3.5 h-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => startEdit(item)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Download"
                        onClick={() => downloadText(`${item.title}.txt`, item.content || "")}
                      >
                        <Download className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7 text-destructive"
                        onClick={() => handleDelete(item.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {viewing && (
        <SourceDetailModal
          open={!!viewing}
          onOpenChange={(o) => !o && setViewing(null)}
          title={viewing.title}
          subtitle="Alternative Source"
          meta={[
            { label: "Title", value: viewing.title },
            { label: "Type", value: viewing.source_type || "—" },
            { label: "Source / author", value: viewing.source_author || "—" },
            { label: "URL", value: viewing.url || "—" },
            { label: "Date added", value: new Date(viewing.created_at).toLocaleString() },
            { label: "Length", value: `${(viewing.content || "").length.toLocaleString()} chars` },
            { label: "Notes", value: viewing.notes || "—" },
            { label: "Category", value: "Alternative Source (not a primary source)" },
          ]}
          content={viewing.content || ""}
          fallbackDownloadName={`${viewing.title}.txt`}
        />
      )}
    </div>
  );
}

export default function TranscriptLibrary() {
  return (
    <Layout>
      <div className="p-8 max-w-5xl">
        <div className="mb-6">
          <h1 className="text-2xl font-mono font-bold text-foreground mb-2">Secondary Source Library</h1>
          <p className="text-sm text-muted-foreground">
            Non-citable material: research, commentary, and format study. Tiered by quality.
            Shapes framing and never backs a claim alone. Primary evidence lives in the Source Library.
          </p>
        </div>

        <Tabs defaultValue="format">
          <TabsList>
            <TabsTrigger value="format">Format References</TabsTrigger>
            <TabsTrigger value="topic">Brief Research</TabsTrigger>
            <TabsTrigger value="alternative">Channel Research</TabsTrigger>
          </TabsList>
          <TabsContent value="format" className="mt-6">
            <TranscriptSection section="format" />
          </TabsContent>
          <TabsContent value="topic" className="mt-6">
            <TranscriptSection section="topic" />
          </TabsContent>
          <TabsContent value="alternative" className="mt-6">
            <AlternativeSourcesSection />
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}