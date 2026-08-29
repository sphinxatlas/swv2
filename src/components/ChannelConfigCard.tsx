import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { useChannel } from "@/contexts/ChannelContext";
import {
  getChannelConfig,
  updateChannelDescription,
  updateChannelSourceHierarchyProse,
} from "@/lib/api";

interface AxisEntry {
  key: string;
  label: string;
}

function axisEntries(raw: unknown): AxisEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const entries: AxisEntry[] = [];
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      entries.push({ key, label: value.trim() });
    }
  }
  return entries;
}

export function ChannelConfigCard() {
  const { channel, channelId, refreshChannels } = useChannel();
  const queryClient = useQueryClient();
  const queryKey = ["channel-config", channelId];

  const { data: config } = useQuery({
    queryKey,
    queryFn: () => getChannelConfig(channelId!),
    enabled: !!channelId,
  });

  const [description, setDescription] = useState("");
  const [hierarchyProse, setHierarchyProse] = useState("");
  const [savingDescription, setSavingDescription] = useState(false);
  const [savingHierarchy, setSavingHierarchy] = useState(false);

  // Sync the local form state whenever the fetched config changes (initial load
  // and after an invalidation re-fetch).
  useEffect(() => {
    setDescription(config?.description ?? "");
  }, [config?.description]);

  useEffect(() => {
    setHierarchyProse(config?.source_hierarchy_prose ?? "");
  }, [config?.source_hierarchy_prose]);

  if (!channel || !channelId) return null;

  const axes = axisEntries(channel.comparison_axis_labels);
  const hasAxis = channel.comparison_mode_available && axes.length > 0;

  const handleSaveDescription = async () => {
    setSavingDescription(true);
    try {
      await updateChannelDescription(channelId, description);
      await queryClient.invalidateQueries({ queryKey });
      refreshChannels();
      toast.success("Channel context saved.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save channel context.");
    } finally {
      setSavingDescription(false);
    }
  };

  const handleSaveHierarchy = async () => {
    setSavingHierarchy(true);
    try {
      await updateChannelSourceHierarchyProse(channelId, hierarchyProse);
      await queryClient.invalidateQueries({ queryKey });
      refreshChannels();
      toast.success("Source hierarchy rules saved.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to save source hierarchy rules.");
    } finally {
      setSavingHierarchy(false);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-col gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-mono font-bold text-foreground">{channel.name}</h2>
          <Badge variant="secondary" className="text-[10px]">
            {channel.subject_label}
          </Badge>
          {hasAxis ? (
            axes.map((a) => (
              <Badge key={a.key} variant="outline" className="text-[10px]">
                {a.label}
              </Badge>
            ))
          ) : (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              No comparison axis
            </Badge>
          )}
        </div>
      </div>

      <div className="space-y-6">
        {/* Channel context */}
        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Channel context</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Injected at the top of every pipeline step as the binding frame.
            </p>
          </div>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={8}
            className="min-h-[8rem] resize-y"
            placeholder="Describe the binding context for this channel…"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveDescription}
              disabled={savingDescription}
              className="gap-1.5"
            >
              {savingDescription ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>

        {/* Source hierarchy rules */}
        <div className="space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Source hierarchy rules</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Injected into every step's source hierarchy instructions. Governs what may back a claim.
            </p>
          </div>
          <Textarea
            value={hierarchyProse}
            onChange={(e) => setHierarchyProse(e.target.value)}
            rows={8}
            className="min-h-[8rem] resize-y"
            placeholder="Describe the source hierarchy rules for this channel…"
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveHierarchy}
              disabled={savingHierarchy}
              className="gap-1.5"
            >
              {savingHierarchy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
