import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import type { ScriptStrength } from "@/lib/api";

export const QUALITY_HELPER_TEXT =
  "Quality tagging is set by you, not by the AI. Strong = trusted research, absorbed and used freely. Useful = framing only; specific claims need STRONG or primary source backup. Limited = inspiration only; specific claims need STRONG or primary source backup. Sources are never named in the script.";

export function QualitySelect({
  value,
  onChange,
}: {
  value: ScriptStrength | undefined;
  onChange: (next: ScriptStrength) => Promise<void>;
}) {
  return (
    <Select
      value={value ?? "unset"}
      onValueChange={async (v) => {
        const next = v === "unset" ? null : (v as ScriptStrength);
        try {
          await onChange(next);
        } catch (err: any) {
          toast.error(err.message || "Failed to update quality");
        }
      }}
    >
      <SelectTrigger className="h-7 w-28 text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="strong">Strong</SelectItem>
        <SelectItem value="useful">Useful</SelectItem>
        <SelectItem value="limited">Limited</SelectItem>
        <SelectItem value="unset">Not set</SelectItem>
      </SelectContent>
    </Select>
  );
}

export interface SourceEntryFormProps {
  onSave: (input: { channel_name: string; video_title: string; transcript: string }) => Promise<void>;
  onCancel: () => void;
  busy: boolean;
}

export function SourceEntryForm({ onSave, onCancel, busy }: SourceEntryFormProps) {
  const [channel, setChannel] = useState("");
  const [title, setTitle] = useState("");
  const [transcript, setTranscript] = useState("");

  const handleSave = async () => {
    if (!channel.trim() || !title.trim() || !transcript.trim()) {
      toast.error("All three fields are required");
      return;
    }
    await onSave({
      channel_name: channel.trim(),
      video_title: title.trim(),
      transcript: transcript.trim(),
    });
    setChannel("");
    setTitle("");
    setTranscript("");
  };

  return (
    <div className="border border-primary/30 rounded-lg p-4 mb-4 bg-card space-y-3">
      <div>
        <Label className="text-xs text-muted-foreground">Source or Publisher</Label>
        <Input
          value={channel}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="e.g., Harvard JCHS, Nerdwriter1, r/REBubble"
          className="bg-secondary border-border mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Title</Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g., The State of the Nation's Housing 2025"
          className="bg-secondary border-border mt-1"
        />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground">Full text</Label>
        <Textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="Paste the full text here..."
          rows={10}
          className="bg-secondary border-border resize-none mt-1 text-xs font-mono"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSave} disabled={busy}>
          {busy ? "Saving..." : "Save Source"}
        </Button>
      </div>
    </div>
  );
}
