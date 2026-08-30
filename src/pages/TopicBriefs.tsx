import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  getTopicBriefs,
  createTopicBrief,
  deleteTopicBrief,
  duplicateTopicBrief,
  TARGET_LENGTH_OPTIONS,
  PIPELINE_STEPS,
  getPipelineStepsForBriefs,
} from "@/lib/api";
import { Plus, Trash2, FileText, GitCompare, Clock, Copy } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useChannel } from "@/contexts/ChannelContext";

export default function TopicBriefs() {
  const navigate = useNavigate();
  const { channelId } = useChannel();

  const [newVideoOpen, setNewVideoOpen] = useState(false);
  const [newVideoTitle, setNewVideoTitle] = useState("");
  const [prefillAngle, setPrefillAngle] = useState("");
  const [creatingVideo, setCreatingVideo] = useState(false);

  // Prefill from Angle Lab handoff (sessionStorage), if present.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("angleLabPrefill");
      if (!raw) return;
      sessionStorage.removeItem("angleLabPrefill");
      const parsed = JSON.parse(raw);
      setNewVideoTitle(parsed.title || "");
      setPrefillAngle(parsed.angle_note || "");
      setNewVideoOpen(true);
      toast.success("Angle Lab handoff loaded into new video");
    } catch {
      /* ignore */
    }
  }, []);

  const { data: briefs = [], refetch } = useQuery({
    queryKey: ["topic-briefs", channelId],
    queryFn: () => getTopicBriefs(channelId!),
    enabled: !!channelId,
  });

  const briefIds = useMemo(() => (briefs as any[]).map((b) => b.id), [briefs]);
  const { data: stepRows = [] } = useQuery({
    queryKey: ["pipeline-steps-for-briefs", channelId, briefIds],
    queryFn: () => getPipelineStepsForBriefs(briefIds),
    enabled: !!channelId && briefIds.length > 0,
  });
  const furthestStepByBrief = useMemo(() => {
    const order = new Map(PIPELINE_STEPS.map((s, i) => [s.type as string, i]));
    const labels = new Map(PIPELINE_STEPS.map((s) => [s.type as string, s.label]));
    const best = new Map<string, number>();
    for (const row of stepRows as { brief_id: string; step_type: string }[]) {
      const idx = order.get(row.step_type);
      if (idx === undefined) continue;
      if (idx > (best.get(row.brief_id) ?? -1)) best.set(row.brief_id, idx);
    }
    const result = new Map<string, string>();
    for (const [briefId, idx] of best) {
      const type = PIPELINE_STEPS[idx].type;
      result.set(briefId, labels.get(type) ?? type);
    }
    return result;
  }, [stepRows]);

  const handleNewVideo = async () => {
    if (!newVideoTitle.trim()) {
      toast.error("Video title is required");
      return;
    }
    setCreatingVideo(true);
    try {
      const created = await createTopicBrief(
        {
          title: newVideoTitle.trim(),
          angle_note: prefillAngle,
          target_minutes: 10,
          target_min_words: 1400,
          target_max_words: 1600,
          comparison_mode: false,
          characters: [],
          focus_areas: [],
          priority_sources: [],
        },
        channelId!,
      );
      toast.success("Video created");
      setNewVideoOpen(false);
      setNewVideoTitle("");
      setPrefillAngle("");
      refetch();
      navigate(`/briefs/${created.id}`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setCreatingVideo(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this video and all its pipeline data? This cannot be undone.")) return;
    try {
      await deleteTopicBrief(id, channelId!);
      toast.success("Brief deleted");
      refetch();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      const created: any = await duplicateTopicBrief(id, channelId!);
      toast.success("Brief duplicated — review and edit before running");
      refetch();
      navigate(`/briefs/${created.id}`);
    } catch (err: any) {
      toast.error(err.message || "Failed to duplicate brief");
    }
  };

  return (
    <Layout>
      <div className="p-8 max-w-6xl">
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-2xl font-mono font-bold text-foreground mb-2">Videos</h1>
            <p className="text-sm text-muted-foreground">
              One workspace per video. Sources, brief, and pipeline live inside each video.
            </p>
          </div>
          <Button onClick={() => setNewVideoOpen(true)} className="gap-1.5">
            <Plus className="w-4 h-4" />
            New Video
          </Button>
        </div>

        <Dialog open={newVideoOpen} onOpenChange={setNewVideoOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>New Video</DialogTitle>
            </DialogHeader>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Video Title</Label>
              <Input
                autoFocus
                placeholder="Video title"
                value={newVideoTitle}
                onChange={(e) => setNewVideoTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleNewVideo(); }}
                className="bg-secondary border-border"
              />
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setNewVideoOpen(false)} disabled={creatingVideo}>Cancel</Button>
              <Button onClick={handleNewVideo} disabled={creatingVideo}>
                {creatingVideo ? "Creating..." : "Create Video"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {briefs.length === 0 ? (
          <div className="border border-dashed border-border rounded-lg p-12 text-center">
            <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground mb-4">No videos yet. Create one to start generating scripts.</p>
            <Button onClick={() => setNewVideoOpen(true)} variant="outline" className="gap-1.5">
              <Plus className="w-4 h-4" />
              Create Your First Video
            </Button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {briefs.map((brief: any) => {
              const furthest = furthestStepByBrief.get(brief.id) ?? "Not started";
              const lengthLabel = TARGET_LENGTH_OPTIONS.find((o) => o.minutes === brief.target_minutes)?.label
                ?? (brief.target_minutes ? `${brief.target_minutes} min` : null);
              return (
                <div
                  key={brief.id}
                  className={cn(
                    "group flex flex-col p-4 rounded-lg border border-border bg-card",
                    "hover:border-primary/30 transition-colors cursor-pointer"
                  )}
                  onClick={() => navigate(`/briefs/${brief.id}`)}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      {brief.comparison_mode ? (
                        <GitCompare className="w-4 h-4 text-primary" />
                      ) : (
                        <FileText className="w-4 h-4 text-primary" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-mono text-sm font-semibold text-foreground truncate">{brief.title}</h3>
                        {brief.comparison_mode && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
                            Comparison
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <p className="text-xs text-muted-foreground/60">
                          {new Date(brief.created_at).toLocaleDateString()}
                        </p>
                        {lengthLabel && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                            <Clock className="w-3 h-3" />
                            {lengthLabel}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground mt-3">
                    Furthest step: <span className="text-foreground/80">{furthest}</span>
                  </p>
                  <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border">
                    <div className="flex-1" />
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="Duplicate brief inputs"
                      onClick={(e) => { e.stopPropagation(); handleDuplicate(brief.id); }}
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 text-destructive"
                      onClick={(e) => { e.stopPropagation(); handleDelete(brief.id); }}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Layout>
  );
}
