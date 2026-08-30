import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MultiSelectChips, type MultiSelectOption } from "@/components/MultiSelectChips";
import { TagInput } from "@/components/TagInput";
import {
  TARGET_LENGTH_OPTIONS,
  getFormatReferenceTranscripts,
  saveFormatReferenceTranscript,
  getBriefTopicTranscripts,
  saveBriefTopicTranscript,
  getAlternativeSources,
  getBriefLinks,
  type CreateBriefInput,
} from "@/lib/api";
import { Clock, GitCompare } from "lucide-react";
import { toast } from "sonner";
import { useChannel } from "@/contexts/ChannelContext";

const UNGROUPED_LABEL = "Priority Sources";

interface SourceCatalogEntry {
  label: string;
  token?: string;
  group?: string | null;
}

export const blankBriefForm = (): CreateBriefInput => ({
  title: "",
  angle_note: "",
  target_minutes: 10,
  target_min_words: 1400,
  target_max_words: 1600,
  comparison_mode: false,
  characters: [],
  focus_areas: [],
  priority_sources: [],
});

export interface BriefFormLinks {
  formatIds: string[];
  topicIds: string[];
  altIds: string[];
}

interface InlineTranscriptFormProps {
  label: string;
  onSave: (input: { channel_name: string; video_title: string; transcript: string }) => Promise<void>;
  onCancel: () => void;
}

function InlineTranscriptForm({ label, onSave, onCancel }: InlineTranscriptFormProps) {
  const [channel, setChannel] = useState("");
  const [videoTitle, setVideoTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [busy, setBusy] = useState(false);

  const handle = async () => {
    if (!channel.trim() || !videoTitle.trim() || !transcript.trim()) {
      toast.error("All three fields are required");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        channel_name: channel.trim(),
        video_title: videoTitle.trim(),
        transcript: transcript.trim(),
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-primary/30 rounded-md p-3 mt-2 bg-card space-y-2">
      <p className="text-xs font-medium text-foreground">{label}</p>
      <Input
        placeholder="Channel name"
        value={channel}
        onChange={(e) => setChannel(e.target.value)}
        className="bg-secondary border-border"
      />
      <Input
        placeholder="Video title"
        value={videoTitle}
        onChange={(e) => setVideoTitle(e.target.value)}
        className="bg-secondary border-border"
      />
      <Textarea
        placeholder="Paste the full transcript here..."
        value={transcript}
        onChange={(e) => setTranscript(e.target.value)}
        rows={6}
        className="bg-secondary border-border resize-none text-xs font-mono"
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button size="sm" onClick={handle} disabled={busy}>{busy ? "Saving..." : "Save"}</Button>
      </div>
    </div>
  );
}

export interface BriefFormProps {
  /** The brief being edited, or null for a new brief. */
  brief: any | null;
  onSave: (payload: CreateBriefInput, links: BriefFormLinks) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
  submitLabel?: string;
}

export function BriefForm({ brief, onSave, onCancel, busy, submitLabel }: BriefFormProps) {
  const { channelId, channel } = useChannel();
  const comparisonAvailable = !!channel?.comparison_mode_available;
  const axis = (channel?.comparison_axis_labels ?? {}) as { side_a?: string; side_b?: string };
  const comparisonLabel =
    axis.side_a && axis.side_b
      ? `${axis.side_a} vs ${axis.side_b} Comparison Mode`
      : "Comparison Mode";

  // Priority source dropdowns are built from the channel's source_catalog,
  // grouped by `group` in first-appearance order. Ungrouped entries fall into a
  // single trailing group.
  const sourceGroups = useMemo(() => {
    const raw: SourceCatalogEntry[] = Array.isArray(channel?.source_catalog)
      ? (channel!.source_catalog as SourceCatalogEntry[])
      : [];
    const order: string[] = [];
    const map = new Map<string, string[]>();
    const ungrouped: string[] = [];
    for (const entry of raw) {
      const label = typeof entry?.label === "string" ? entry.label.trim() : "";
      if (!label) continue;
      const group = typeof entry?.group === "string" ? entry.group.trim() : "";
      if (!group) {
        ungrouped.push(label);
        continue;
      }
      if (!map.has(group)) {
        map.set(group, []);
        order.push(group);
      }
      map.get(group)!.push(label);
    }
    const groups = order.map((name) => ({ name, labels: map.get(name)! }));
    if (ungrouped.length > 0) groups.push({ name: UNGROUPED_LABEL, labels: ungrouped });
    return groups;
  }, [channel]);

  const [form, setForm] = useState<CreateBriefInput>(() =>
    brief
      ? {
          title: brief.title ?? "",
          angle_note: brief.angle_note ?? "",
          target_minutes: brief.target_minutes ?? 10,
          target_min_words: brief.target_min_words ?? 1400,
          target_max_words: brief.target_max_words ?? 1600,
          comparison_mode: !!brief.comparison_mode,
          characters: brief.characters ?? [],
          focus_areas: brief.focus_areas ?? [],
          priority_sources: brief.priority_sources ?? [],
        }
      : blankBriefForm(),
  );

  const [selectedFormatIds, setSelectedFormatIds] = useState<string[]>([]);
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [selectedAltIds, setSelectedAltIds] = useState<string[]>([]);
  const [showFormatAdd, setShowFormatAdd] = useState(false);
  const [showTopicAdd, setShowTopicAdd] = useState(false);

  const { data: existingLinks } = useQuery({
    queryKey: ["brief-links", brief?.id],
    queryFn: () => getBriefLinks(brief.id),
    enabled: !!brief?.id,
  });

  useEffect(() => {
    if (!existingLinks) return;
    setSelectedFormatIds(existingLinks.formatIds);
    setSelectedTopicIds(existingLinks.topicIds);
    setSelectedAltIds(existingLinks.altIds);
  }, [existingLinks]);

  const { data: formatRefs = [], refetch: refetchFormatRefs } = useQuery({
    queryKey: ["format-references", channelId],
    queryFn: () => getFormatReferenceTranscripts(channelId!),
    enabled: !!channelId,
  });
  const { data: topicTranscripts = [], refetch: refetchTopicTranscripts } = useQuery({
    queryKey: ["topic-transcripts", channelId],
    queryFn: () => getBriefTopicTranscripts(channelId!),
    enabled: !!channelId,
  });
  const { data: alternativeSources = [] } = useQuery({
    queryKey: ["alternative-sources", channelId],
    queryFn: () => getAlternativeSources(channelId!),
    enabled: !!channelId,
  });

  const updateForm = (key: keyof CreateBriefInput, value: any) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const formatOptions: MultiSelectOption[] = (formatRefs as any[]).map((r) => ({
    value: r.id,
    label: r.video_title,
    sublabel: r.channel_name,
  }));
  const topicOptions: MultiSelectOption[] = (topicTranscripts as any[]).map((r) => ({
    value: r.id,
    label: r.video_title,
    sublabel: r.channel_name,
  }));
  const altOptions: MultiSelectOption[] = (alternativeSources as any[]).map((r) => ({
    value: r.id,
    label: r.title,
    sublabel: r.source_type || r.source_author || undefined,
  }));

  const handleSubmit = async () => {
    if (!form.title.trim()) {
      toast.error("Video title is required");
      return;
    }
    if (!form.angle_note.trim()) {
      toast.error("Angle note is required");
      return;
    }
    if (selectedFormatIds.length > 2) {
      toast.error("Maximum 2 format reference videos");
      return;
    }
    await onSave(
      {
        ...form,
        title: form.title.trim(),
        angle_note: form.angle_note.trim(),
        comparison_mode: comparisonAvailable ? form.comparison_mode : false,
      },
      { formatIds: selectedFormatIds, topicIds: selectedTopicIds, altIds: selectedAltIds },
    );
  };

  return (
    <div className="space-y-4">
      {/* Video Title */}
      <div>
        <Label className="text-xs text-muted-foreground">Video Title</Label>
        <Input
          placeholder="Video title"
          value={form.title}
          onChange={(e) => updateForm("title", e.target.value)}
          className="bg-secondary border-border mt-1"
        />
      </div>

      {/* Angle Note */}
      <div>
        <Label className="text-xs text-muted-foreground">Angle Note</Label>
        <p className="text-[11px] text-muted-foreground/70 mb-1">
          Your angle or direction for this video. A few sentences. The system will develop this into a full thesis.
        </p>
        <Textarea
          placeholder="Two paragraphs on the angle. State the tension, not the finished thesis."
          value={form.angle_note}
          onChange={(e) => updateForm("angle_note", e.target.value)}
          rows={4}
          className="bg-secondary border-border resize-none"
        />
      </div>

      {/* Key People or Entities */}
      <div>
        <Label className="text-xs text-muted-foreground">Key People or Entities</Label>
        <p className="text-[11px] text-muted-foreground/70 mb-1">
          People or entities central to this video. Used to build retrieval queries.
        </p>
        <Input
          placeholder=""
          value={(form.characters || []).join(", ")}
          onChange={(e) =>
            updateForm(
              "characters",
              e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            )
          }
          className="bg-secondary border-border mt-1"
        />
      </div>

      {/* Focus Areas */}
      <div>
        <Label className="text-xs text-muted-foreground">Focus Areas</Label>
        <p className="text-[11px] text-muted-foreground/70 mb-1">
          Key themes, moments, or topics this video covers.
        </p>
        <Input
          placeholder=""
          value={(form.focus_areas || []).join(", ")}
          onChange={(e) =>
            updateForm(
              "focus_areas",
              e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
            )
          }
          className="bg-secondary border-border mt-1"
        />
      </div>

      {/* Priority Sources (built from the channel's source catalog) */}
      {sourceGroups.length === 0 ? (
        <div>
          <Label className="text-xs text-muted-foreground">Priority Sources</Label>
          <p className="text-[11px] text-muted-foreground/70 mb-1">
            Which sources are most relevant. Retrieval will weight these.
          </p>
          <MultiSelectChips
            options={[]}
            selected={[]}
            onChange={() => {}}
            disabled
            placeholder="No priority sources configured for this channel"
            emptyText="No priority sources configured for this channel"
          />
        </div>
      ) : (
        sourceGroups.map((group) => {
          const inGroup = (s: string) => group.labels.includes(s);
          return (
            <div key={group.name}>
              <Label className="text-xs text-muted-foreground">{group.name}</Label>
              <p className="text-[11px] text-muted-foreground/70 mb-1">
                Which sources are most relevant. Retrieval will weight these.
              </p>
              <MultiSelectChips
                options={group.labels.map((l) => ({ value: l, label: l }))}
                selected={(form.priority_sources || []).filter(inGroup)}
                onChange={(vals) => {
                  const others = (form.priority_sources || []).filter((s) => !inGroup(s));
                  updateForm("priority_sources", [...others, ...vals]);
                }}
                placeholder={`Select ${group.name.toLowerCase()}…`}
              />
            </div>
          );
        })
      )}

      {/* Target Length */}
      <div>
        <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          Target Length (Voiceover)
        </Label>
        <Select
          value={String(form.target_minutes)}
          onValueChange={(v) => {
            const opt = TARGET_LENGTH_OPTIONS.find((o) => o.minutes === Number(v));
            if (opt) {
              setForm((prev) => ({
                ...prev,
                target_minutes: opt.minutes,
                target_min_words: opt.min,
                target_max_words: opt.max,
              }));
            }
          }}
        >
          <SelectTrigger className="bg-secondary border-border mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TARGET_LENGTH_OPTIONS.map((opt) => (
              <SelectItem key={opt.minutes} value={String(opt.minutes)}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Comparison Mode — only when the channel supports it */}
      {comparisonAvailable && (
        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <Switch
            checked={form.comparison_mode}
            onCheckedChange={(v) => updateForm("comparison_mode", v)}
          />
          <div>
            <Label className="text-xs font-medium flex items-center gap-1.5">
              <GitCompare className="w-3.5 h-3.5 text-primary" />
              {comparisonLabel}
            </Label>
            <p className="text-xs text-muted-foreground">Forces paired retrieval and contrast-based analysis</p>
          </div>
        </div>
      )}

      {/* Format Reference Videos */}
      <div className="pt-2 border-t border-border">
        <Label className="text-xs text-muted-foreground">
          Format Reference Videos
        </Label>
        <p className="text-[11px] text-muted-foreground/70 mb-2">
          Format reference videos from a different subject. Used for argument structure and positioning only — never as a source of content for this video. Optional but recommended; max 2.
        </p>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <MultiSelectChips
              options={formatOptions}
              selected={selectedFormatIds}
              onChange={(vals) => {
                if (vals.length > 2) {
                  toast.error("Maximum 2 format references");
                  return;
                }
                setSelectedFormatIds(vals);
              }}
              placeholder={formatOptions.length === 0 ? "No format references available" : "Select format references…"}
              emptyText="No format references available."
              searchable
              searchPlaceholder="Search format references..."
              emptySearchMessage="No matching sources found."
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowFormatAdd((v) => !v)}
          >
            Add New
          </Button>
        </div>
        {selectedFormatIds.length >= 2 && (
          <p className="text-xs text-muted-foreground mt-1">Maximum 2 format references selected.</p>
        )}
        {showFormatAdd && (
          <InlineTranscriptForm
            label="New Format Reference"
            onCancel={() => setShowFormatAdd(false)}
            onSave={async (input) => {
              const created = await saveFormatReferenceTranscript(input, channelId!);
              await refetchFormatRefs();
              setSelectedFormatIds((prev) => prev.length < 2 ? [...prev, created.id] : prev);
              setShowFormatAdd(false);
              toast.success("Format reference added");
            }}
          />
        )}
      </div>

      {/* Topic Transcripts */}
      <div className="pt-2 border-t border-border">
        <Label className="text-xs text-muted-foreground">Topic Transcripts (optional)</Label>
        <p className="text-[11px] text-muted-foreground/70 mb-2">
          Videos covering a similar topic to this video. Used as research leads. Optional, no maximum.
        </p>
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <MultiSelectChips
              options={topicOptions}
              selected={selectedTopicIds}
              onChange={setSelectedTopicIds}
              placeholder={topicOptions.length === 0 ? "No topic transcripts available" : "Select topic transcripts…"}
              emptyText="No topic transcripts available."
              searchable
              searchPlaceholder="Search topic transcripts..."
              emptySearchMessage="No matching sources found."
            />
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setShowTopicAdd((v) => !v)}
          >
            Add New
          </Button>
        </div>
        {showTopicAdd && (
          <InlineTranscriptForm
            label="New Topic Transcript"
            onCancel={() => setShowTopicAdd(false)}
            onSave={async (input) => {
              const created = await saveBriefTopicTranscript(input, channelId!);
              await refetchTopicTranscripts();
              setSelectedTopicIds((prev) => [...prev, created.id]);
              setShowTopicAdd(false);
              toast.success("Topic transcript added");
            }}
          />
        )}
      </div>

      {/* Alternative Sources */}
      <div className="pt-2 border-t border-border">
        <Label className="text-xs text-muted-foreground">Alternative Sources (optional)</Label>
        <p className="text-[11px] text-muted-foreground/70 mb-2">
          Optional pasted sources such as Reddit threads, fan comments, wiki extracts, blog posts, websites, or research notes. Used as secondary context and angle support. Not primary sources unless the material is explicitly primary source text.
        </p>
        <MultiSelectChips
          options={altOptions}
          selected={selectedAltIds}
          onChange={setSelectedAltIds}
          placeholder={altOptions.length === 0 ? "No alternative sources available" : "Select alternative sources…"}
          emptyText="No alternative sources yet. Add some in the Secondary Source Library."
          searchable
          searchPlaceholder="Search alternative sources..."
          emptySearchMessage="No matching sources found."
        />
      </div>

      <div className="flex gap-2 justify-end pt-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button onClick={handleSubmit} disabled={busy}>
          {busy ? "Saving..." : (submitLabel ?? (brief ? "Save Brief" : "Create Brief"))}
        </Button>
      </div>
    </div>
  );
}
