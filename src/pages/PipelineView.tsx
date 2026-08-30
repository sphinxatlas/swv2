import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { PipelineSidebar } from "@/components/pipeline/PipelineSidebar";
import {
  PIPELINE_STEPS,
  getPipelineOutputs,
  savePipelineOutput,
  streamGenerateStep,
  streamPolishPass,
  updateBriefCreativeBriefFields,
  generateHookOptions,
  refineHookOption,
  type HookOption,
  type PipelineStepType,
  type ScriptStrength,
  getEvidencePoints,
  replaceEvidencePoints,
  setEvidencePointApproval,
  getSourceFilesForBrief,
  getBriefLinks,
  getBriefTopicTranscriptLinks,
  getFormatReferenceTranscripts,
  getBriefTopicTranscripts,
  getAlternativeSources,
  saveBriefTopicTranscript,
  updateBriefTopicTranscriptStrength,
  linkFormatReferencesToBrief,
  linkTopicTranscriptsToBrief,
  linkAlternativeSourcesToBrief,
} from "@/lib/api";
import { MultiSelectChips, type MultiSelectOption } from "@/components/MultiSelectChips";
import { SourceEntryForm, QualitySelect } from "@/components/SourceEntryForm";
import { parseEvidenceTable } from "@/lib/parseEvidenceTable";
import { EvidenceTableView } from "@/components/pipeline/EvidenceTableView";
import { supabase } from "@/integrations/supabase/client";
import {
  CheckCircle2,
  Loader2,
  Play,
  RotateCcw,
  Copy,
  Download,
  ThumbsUp,
  Sparkles,
  Wand2,
  Lightbulb,
  AlertTriangle,
  Plus,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useChannel } from "@/contexts/ChannelContext";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FileUploadCard } from "@/components/FileUploadCard";
import { ChevronDown } from "lucide-react";

type ActiveStep = PipelineStepType;

// Strip a chatty preamble ("Here is the revised script after...") and any
// leading "## REVISED SCRIPT" / "### FINAL SCRIPT" header from the script side.
function stripMeltyScriptHeaders(text: string): string {
  let t = text.trim();
  t = t.replace(/^(here is|below is|this is)[^\n]*\n+/i, "").trim();
  t = t.replace(/^#{2,4}\s*(REVISED|FINAL)\s*SCRIPT[^\n]*\n+/i, "").trim();
  t = t.replace(/^#{2,4}\s*MELTY VOICE PASS APPLIED[^\n]*\n+/i, "").trim();
  return t;
}

// Recognized log markers anywhere in a line (used to detect log content).
const MELTY_LOG_LINE_RE = /\b(BEAT LOG|HOOK AUDIT LOG|PERSONALITY BEAT LOG|MELTY VOICE PASS LOG|BEAT COUNT|EARNED.?USE|PARENTHETICAL ASIDE LOG|MOCK FORMAL REGISTER LOG|I VS WE AUDIT LOG|ANALYTICAL RUN LOG|BURST RHYTHM LOG|SIGNATURE TECHNIQUE LOG|NARRATOR VOICE AUDIT LOG|RESISTED SECTIONS|REQUIRED LOGS)\b/i;

// Script-start header line.
const MELTY_SCRIPT_HEADER_LINE_RE = /^#{2,4}\s*(REVISED|FINAL)\s*SCRIPT|^#{2,4}\s*MELTY VOICE PASS APPLIED/i;

// Standalone "---" separator line.
const MELTY_DASH_LINE_RE = /^\s*-{3,}\s*$/;

function splitMeltyVoicePassOutput(text: string): { scriptBody: string; changeLog: string | null } {
  const lines = text.split(/\r?\n/);

  // Locate the FIRST script-start header and the LAST line containing a log marker.
  let firstHeaderIdx = -1;
  let lastLogIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (firstHeaderIdx === -1 && MELTY_SCRIPT_HEADER_LINE_RE.test(lines[i])) firstHeaderIdx = i;
    if (MELTY_LOG_LINE_RE.test(lines[i])) lastLogIdx = i;
  }

  // CASE 1: a script header appears AFTER the last log marker. The output is
  // logs-then-script (possibly with multiple "---" lines inside the log block).
  // Split at the header. Everything before is the log block; strip any
  // trailing "---" separator at the end of the log block.
  if (firstHeaderIdx > -1 && lastLogIdx > -1 && firstHeaderIdx > lastLogIdx) {
    const before = lines.slice(0, firstHeaderIdx).join("\n").trim()
      .replace(/\n?\s*-{3,}\s*$/, "").trim();
    const after = lines.slice(firstHeaderIdx + 1).join("\n").trim();
    if (after.length >= 500) {
      return { scriptBody: after, changeLog: before || null };
    }
  }

  // CASE 2: fall back to "---" separator heuristic. Iterate in REVERSE so the
  // LAST separator wins — this avoids splitting on a "---" that sits inside
  // the log block when multiple separators exist.
  const dashIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (MELTY_DASH_LINE_RE.test(lines[i])) dashIndices.push(i);
  }
  for (let k = dashIndices.length - 1; k >= 0; k--) {
    const idx = dashIndices[k];
    const top = lines.slice(0, idx).join("\n").trim();
    const bot = lines.slice(idx + 1).join("\n").trim();
    if (top.length < 200 || bot.length < 200) continue;
    const topIsLonger = top.length > bot.length;
    const longer = topIsLonger ? top : bot;
    const shorter = topIsLonger ? bot : top;
    if (longer.length < shorter.length * 2) continue;
    return {
      scriptBody: stripMeltyScriptHeaders(longer),
      changeLog: shorter || null,
    };
  }

  // No reliable split — treat as one piece, strip leading preamble/header.
  return { scriptBody: stripMeltyScriptHeaders(text), changeLog: null };
}

export default function PipelineView() {
  const { briefId } = useParams<{ briefId: string }>();
  const [briefSourcesOpen, setBriefSourcesOpen] = useState<boolean | null>(null);
  const [showAddResearch, setShowAddResearch] = useState(false);
  const [savingResearch, setSavingResearch] = useState(false);
  const { channelId, setChannelId } = useChannel();
  const [activeStep, setActiveStep] = useState<ActiveStep>("creative_brief");
  const [generating, setGenerating] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [feedbackText, setFeedbackText] = useState("");
  const [approving, setApproving] = useState(false);
  const [antiAiRunning, setAntiAiRunning] = useState(false);
  const [antiAiStream, setAntiAiStream] = useState("");
  const [confirmAntiAiOpen, setConfirmAntiAiOpen] = useState(false);
  const [antiAiCompletedAt, setAntiAiCompletedAt] = useState<Date | null>(null);
  const [meltyRunning, setMeltyRunning] = useState(false);
  const [meltyStream, setMeltyStream] = useState("");
  const [passageInput, setPassageInput] = useState("");
  const [passageFeedback, setPassageFeedback] = useState("");
  const [passageRunning, setPassageRunning] = useState(false);
  const [passageOutput, setPassageOutput] = useState("");
  // ── Hook Options (transient UI state only — never persisted) ──
  const [hookOptions, setHookOptions] = useState<HookOption[]>([]);
  const [hookOptionsLoading, setHookOptionsLoading] = useState(false);
  // Index of the currently selected generated hook (-1 = none, -2 = custom)
  const [selectedHookIdx, setSelectedHookIdx] = useState<number>(-1);
  const [refineFeedback, setRefineFeedback] = useState("");
  const [refining, setRefining] = useState(false);
  const [customHookOpen, setCustomHookOpen] = useState(false);
  const [customHookText, setCustomHookText] = useState("");

  // Resolve the hook text passed to Full Script generation.
  const selectedHookDirection = (() => {
    if (selectedHookIdx === -2) return customHookText.trim();
    if (selectedHookIdx >= 0 && hookOptions[selectedHookIdx]) {
      const h = hookOptions[selectedHookIdx];
      return `${h.hook_label}\n\n${h.hook_text}`.trim();
    }
    return "";
  })();
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: brief, refetch: refetchBrief } = useQuery({
    queryKey: ["brief", briefId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("topic_briefs")
        .select("*")
        .eq("id", briefId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!briefId,
  });

  // Opening a brief by URL moves the app to that brief's channel.
  useEffect(() => {
    if (brief?.channel_id && channelId && brief.channel_id !== channelId) {
      setChannelId(brief.channel_id);
    }
  }, [brief?.channel_id, channelId, setChannelId]);

  const { data: outputs = [], refetch: refetchOutputs } = useQuery({
    queryKey: ["pipeline-outputs", briefId],
    queryFn: () => getPipelineOutputs(briefId!),
    enabled: !!briefId,
  });

  const { data: evidencePoints = [], refetch: refetchEvidence } = useQuery({
    queryKey: ["evidence-points", briefId],
    queryFn: () => getEvidencePoints(briefId!),
    enabled: !!briefId,
  });

  const { data: sourceFiles = [], refetch: refetchAllSourceFiles } = useQuery({
    queryKey: ["source-files-all", channelId, briefId],
    queryFn: () => getSourceFilesForBrief(channelId!, briefId!),
    enabled: !!channelId && !!briefId,
  });
  const refetchSourceFiles = () => refetchAllSourceFiles();
  const libraryFileNames = sourceFiles.map((f: any) => f.name);
  const briefBooks = sourceFiles.filter((f: any) => f.brief_id === briefId && f.file_type === "book");
  const briefTranscripts = sourceFiles.filter((f: any) => f.brief_id === briefId && f.file_type === "transcript");

  // ── Sources section: linked + channel-level material ──
  const { data: linkedResearch = [], refetch: refetchLinkedResearch } = useQuery({
    queryKey: ["brief-topic-transcript-links", briefId],
    queryFn: () => getBriefTopicTranscriptLinks(briefId!),
    enabled: !!briefId,
  });
  const { data: briefLinks, refetch: refetchBriefLinks } = useQuery({
    queryKey: ["brief-links", briefId],
    queryFn: () => getBriefLinks(briefId!),
    enabled: !!briefId,
  });
  const { data: channelFormatRefs = [] } = useQuery({
    queryKey: ["format-references", channelId],
    queryFn: () => getFormatReferenceTranscripts(channelId!),
    enabled: !!channelId,
  });
  const { data: channelResearch = [], refetch: refetchChannelResearch } = useQuery({
    queryKey: ["topic-transcripts", channelId],
    queryFn: () => getBriefTopicTranscripts(channelId!),
    enabled: !!channelId,
  });
  const { data: channelAltSources = [] } = useQuery({
    queryKey: ["alternative-sources", channelId],
    queryFn: () => getAlternativeSources(channelId!),
    enabled: !!channelId,
  });

  const linkedFormatIds: string[] = briefLinks?.formatIds ?? [];
  const linkedAltIds: string[] = briefLinks?.altIds ?? [];
  const linkedResearchIds: string[] = (linkedResearch as any[]).map((r) => r.id);

  const formatOptions: MultiSelectOption[] = (channelFormatRefs as any[]).map((r) => ({
    value: r.id,
    label: r.video_title,
    sublabel: r.channel_name,
  }));
  const altOptions: MultiSelectOption[] = (channelAltSources as any[]).map((r) => ({
    value: r.id,
    label: r.title,
    sublabel: [r.source_type || r.source_author, r.script_strength ? `Quality: ${r.script_strength}` : null]
      .filter(Boolean)
      .join(" · ") || undefined,
  }));

  const channelBooksCount = sourceFiles.filter((f: any) => !f.brief_id && f.file_type === "book").length;
  const channelRecordingsCount = sourceFiles.filter((f: any) => !f.brief_id && f.file_type === "transcript").length;
  const governingDocs = [
    { label: "Script Instructions", present: sourceFiles.some((f: any) => !f.brief_id && (f.file_type === "instructions" || f.file_type === "script_strategy")) },
    { label: "Anti-AI Guide", present: sourceFiles.some((f: any) => !f.brief_id && f.file_type === "anti_ai_guide") },
    { label: "Host Persona", present: sourceFiles.some((f: any) => !f.brief_id && f.file_type === "host_persona") },
    { label: "Voice Pass", present: sourceFiles.some((f: any) => !f.brief_id && f.file_type === "melty_voice_pass") },
  ];

  const handleUnlinkResearch = async (id: string) => {
    try {
      await linkTopicTranscriptsToBrief(briefId!, linkedResearchIds.filter((x) => x !== id));
      await Promise.all([refetchLinkedResearch(), refetchBriefLinks()]);
      toast.success("Unlinked from this video");
    } catch (err: any) {
      toast.error(err.message || "Failed to unlink");
    }
  };

  const handleAddResearch = async (input: { channel_name: string; video_title: string; transcript: string }) => {
    setSavingResearch(true);
    try {
      const created = await saveBriefTopicTranscript(input, channelId!);
      await linkTopicTranscriptsToBrief(briefId!, [...linkedResearchIds, created.id]);
      await Promise.all([refetchLinkedResearch(), refetchBriefLinks(), refetchChannelResearch()]);
      setShowAddResearch(false);
      toast.success("Brief research added and linked");
    } catch (err: any) {
      toast.error(err.message || "Failed to save");
    } finally {
      setSavingResearch(false);
    }
  };

  const handleFormatLinkChange = async (vals: string[]) => {
    if (vals.length > 2) {
      toast.error("Maximum 2 format references");
      return;
    }
    try {
      await linkFormatReferencesToBrief(briefId!, vals);
      await refetchBriefLinks();
    } catch (err: any) {
      toast.error(err.message || "Failed to update links");
    }
  };

  const handleAltLinkChange = async (vals: string[]) => {
    try {
      await linkAlternativeSourcesToBrief(briefId!, vals);
      await refetchBriefLinks();
    } catch (err: any) {
      toast.error(err.message || "Failed to update links");
    }
  };

  const sourcesOpen = briefSourcesOpen ?? outputs.length === 0;


  const getStepOutput = (step: PipelineStepType) =>
    outputs.find((o) => o.step_type === step);

  const currentOutput = getStepOutput(activeStep as PipelineStepType);
  const displayContent = generating ? streamContent : currentOutput?.content || "";

  const handleGenerate = async (
    overrideStep?: PipelineStepType,
    overrideRevisionFeedback?: string,
  ) => {
    if (!briefId) return;
    const step: PipelineStepType = overrideStep || (activeStep as PipelineStepType);
    setGenerating(true);
    setStreamContent("");

    let accumulated = "";

    try {
      const extraOptions: Record<string, any> = {};
      if (step === "full_script" && selectedHookDirection.trim()) {
        extraOptions.hookDirection = selectedHookDirection.trim();
      }
      if (overrideRevisionFeedback && overrideRevisionFeedback.trim()) {
        extraOptions.revisionFeedback = overrideRevisionFeedback.trim();
      }
      await streamGenerateStep(
        briefId,
        step,
        (delta) => {
          accumulated += delta;
          setStreamContent(accumulated);
        },
        async () => {
          await savePipelineOutput(briefId, step, accumulated);
          if (step === "evidence_table") {
            try {
              const drafts = parseEvidenceTable(accumulated);
              if (drafts.length > 0) {
                await replaceEvidencePoints(briefId, drafts);
                await refetchEvidence();
              }
            } catch (err) {
              console.warn("Failed to parse Evidence Table into rows:", err);
            }
          }
          refetchOutputs();
          setGenerating(false);
          toast.success(`${PIPELINE_STEPS.find((s) => s.type === step)?.label} generated`);
        },
        Object.keys(extraOptions).length ? extraOptions : undefined,
      );
    } catch (err: any) {
      setGenerating(false);
      toast.error(err.message || "Generation failed");
    }
  };

  const handleGenerateHookOptions = async () => {
    if (!briefId) return;
    setHookOptionsLoading(true);
    try {
      const { hooks } = await generateHookOptions(briefId);
      setHookOptions(hooks);
      setSelectedHookIdx(-1);
      setRefineFeedback("");
    } catch (err: any) {
      toast.error(err.message || "Failed to generate hook options");
    } finally {
      setHookOptionsLoading(false);
    }
  };

  const handleRefineSelectedHook = async () => {
    if (!briefId) return;
    if (selectedHookIdx < 0) return;
    const current = hookOptions[selectedHookIdx];
    if (!current) return;
    if (!refineFeedback.trim()) {
      toast.error("Add feedback to refine this hook.");
      return;
    }
    setRefining(true);
    try {
      const { hook } = await refineHookOption(briefId, current, refineFeedback);
      setHookOptions((prev) => {
        const next = [...prev];
        next[selectedHookIdx] = hook;
        return next;
      });
      setRefineFeedback("");
      toast.success("Hook refined");
    } catch (err: any) {
      toast.error(err.message || "Failed to refine hook");
    } finally {
      setRefining(false);
    }
  };

  const handleApproveCreativeBrief = async () => {
    if (!briefId) return;
    setApproving(true);
    try {
      await updateBriefCreativeBriefFields(briefId, channelId!, {
        creative_brief_feedback: feedbackText,
        creative_brief_approved: true,
      });
      await refetchBrief();
      toast.success("Creative Brief approved — generating Insights & Research");
      setActiveStep("six_category_extraction");
      setFeedbackText("");
      // Trigger generation of next step immediately
      setTimeout(() => handleGenerate("six_category_extraction"), 0);
    } catch (err: any) {
      toast.error(err.message || "Failed to approve");
    } finally {
      setApproving(false);
    }
  };

  const handleRegenerate = async () => {
    if (!briefId) return;
    // If feedback was typed (currently only the Creative Brief step exposes a
    // feedback field), persist it to the brief BEFORE regenerating so the
    // edge function picks it up on read, then clear the field locally.
    if (activeStep === "creative_brief" && feedbackText.trim()) {
      try {
        await updateBriefCreativeBriefFields(briefId, channelId!, {
          creative_brief_feedback: feedbackText.trim(),
        });
        await refetchBrief();
        setFeedbackText("");
        toast.success("Feedback applied — regenerating");
      } catch (err: any) {
        toast.error(err.message || "Failed to save feedback");
        return;
      }
      await handleGenerate();
      return;
    }
    // For all other steps, pass typed feedback through as revisionFeedback so
    // the edge function appends it to that step's user message. Clear after.
    const fb = feedbackText.trim();
    if (fb) {
      toast.success("Feedback applied — regenerating");
    }
    await handleGenerate(undefined, fb || undefined);
    if (fb) setFeedbackText("");
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(displayContent);
    toast.success("Copied to clipboard");
  };

  const handleDownload = () => {
    const step = PIPELINE_STEPS.find((s) => s.type === activeStep);
    const blob = new Blob([displayContent], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${brief?.title || "output"} - ${step?.label || activeStep}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadPipeline = () => {
    if (!brief) return;

    const slug = (brief.title as string)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const exportOrder: PipelineStepType[] = [
      "creative_brief",
      "six_category_extraction",
      "selected_source_analysis",
      "angle_check",
      "evidence_table",
      "outline",
      "script_evidence_pack",
      "full_script",
      "melty_voice_pass",
      "melty_voice_pass_log",
      "anti_ai_output",
    ];

    const present = exportOrder.filter((step) => {
      const output = outputs.find((o) => o.step_type === step);
      return output && typeof output.content === "string" && output.content.trim().length > 0;
    });

    const lines: string[] = [];
    lines.push(`PIPELINE EXPORT | ${brief.title} | exported ${new Date().toISOString()}`);

    const targetMin = brief.target_min_words ?? "";
    const targetMax = brief.target_max_words ?? "";
    const comparison = brief.comparison_mode ? "on" : "off";
    const characters = (brief.characters || []).join(", ") || "none";
    const focus = (brief.focus_areas || []).join(", ") || "none";
    const prioritySources = (brief.priority_sources || []).join(", ") || "none";
    lines.push(
      `brief: target=${targetMin}-${targetMax}w | comparison=${comparison} | characters=${characters} | focus=${focus} | priority_sources=${prioritySources}`,
    );

    const angleNote = ((brief.angle_note as string) || "").replace(/\r?\n/g, " / ");
    lines.push(`angle_note: ${angleNote}`);

    lines.push(`steps included: ${present.join(", ")}`);

    for (const step of present) {
      const output = outputs.find((o) => o.step_type === step)!;
      const content = (output.content as string).trim();
      const charCount = content.length;
      const wordCount = content.split(/\s+/).filter(Boolean).length;
      lines.push("");
      lines.push(
        `## ${step} | ${new Date((output as any).created_at).toISOString()} | ${charCount} chars | ${wordCount} words`,
      );
      lines.push("");
      lines.push(content);
    }

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug || "pipeline"}-pipeline.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Pipeline downloaded (${present.length} steps)`);
  };

  useEffect(() => {

    if (generating && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [streamContent, generating]);

  // Clear the per-step feedback draft when the user switches steps so
  // feedback typed for one step never leaks into another step's regenerate.
  useEffect(() => {
    setFeedbackText("");
  }, [activeStep]);

  if (!briefId) return null;

  const isCreativeBrief = activeStep === "creative_brief";
  const creativeBriefApproved = !!(brief && (brief as any).creative_brief_approved);
  const creativeBriefFeedback = brief && (brief as any).creative_brief_feedback;
  const showCreativeBriefReview = isCreativeBrief && currentOutput && !generating && !creativeBriefApproved;
  const showCreativeBriefApproved = isCreativeBrief && currentOutput && !generating && creativeBriefApproved;

  const fullScriptContent =
    (outputs.find((o) => o.step_type === "full_script")?.content as string | undefined) || "";

  const latestOutputFor = (type: string) => {
    const matches = outputs.filter((o) => (o.step_type as string) === type);
    if (matches.length === 0) return undefined;
    return matches.reduce((a, b) =>
      new Date((a as any).created_at).getTime() > new Date((b as any).created_at).getTime() ? a : b,
    );
  };

  const meltyVoicePassOutput = latestOutputFor("melty_voice_pass");
  const antiAiOutputRow = latestOutputFor("anti_ai_output");

  const meltyVoicePassContent = (meltyVoicePassOutput?.content as string | undefined) || "";
  const antiAiOutputContent = (antiAiOutputRow?.content as string | undefined) || "";

  const formatLastRun = (row: any) => {
    if (!row?.created_at) return "Not yet run";
    const d = new Date(row.created_at);
    const date = d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    return `Last run: ${date} at ${time}`;
  };

  // Anti-AI prefers the Melty Voice Pass output when it exists, otherwise falls back to the raw Full Script.
  const antiAiInput = meltyVoicePassContent || fullScriptContent;

  const isFullScriptStep = activeStep === "full_script";
  const isEvidenceTableStep = activeStep === "evidence_table";

  const pendingHighRiskCount = (() => {
    if (evidencePoints.length === 0) return 0;
    // Need to import classifier inline; we'll compute via the same logic.
    let count = 0;
    // Lazy import not possible here; re-derive minimal logic
    for (const r of evidencePoints) {
      const reasons: string[] = [];
      const lib = libraryFileNames.map((n) => n.toLowerCase());
      const sf = (r.source_file || "").toLowerCase();
      const fileMissing =
        !!r.source_file && !lib.some((l) => l.includes(sf) || sf.includes(l));
      const conf = (r.confidence || "").toLowerCase();
      const et = (r.evidence_type || "").toLowerCase();
      const st = (r.source_type || "").toLowerCase();
      if (fileMissing && r.source_file) reasons.push("x");
      if (!r.source_file) reasons.push("x");
      if (conf === "medium" || conf === "low") reasons.push("x");
      if (et === "theory" || et === "speculation" || et === "interpretation") reasons.push("x");
      if (st === "book" && !r.book_evidence) reasons.push("x");
      if (st === "movie" && !r.movie_evidence) reasons.push("x");
      if (st === "both" && (!r.book_evidence || !r.movie_evidence)) reasons.push("x");
      if (st === "commentary" || st === "secondary") reasons.push("x");
      const isHigh = reasons.length > 0;
      if (isHigh && !r.approval_status) count++;
    }
    return count;
  })();

  const handleSetApproval = async (
    id: string,
    status: "approved" | "rejected",
    note?: string | null,
  ) => {
    try {
      await setEvidencePointApproval(id, status, note);
      await refetchEvidence();
    } catch (err: any) {
      toast.error(err.message || "Failed to update approval");
    }
  };

  const runFullScriptAntiAi = async () => {
    if (!briefId) return;
    if (!antiAiInput || antiAiInput.trim().length < 50) {
      toast.error("Generate a Full Script first.");
      return;
    }
    setConfirmAntiAiOpen(false);
    setAntiAiRunning(true);
    setAntiAiStream("");
    let acc = "";
    try {
      await streamPolishPass(
        { passType: "anti_ai", scope: "full_script", scriptText: antiAiInput, briefId: briefId! },
        (delta) => {
          acc += delta;
          setAntiAiStream(acc);
        },
        async () => {
          if (!acc.trim()) {
            setAntiAiRunning(false);
            toast.error("Anti AI cleanup returned no content. Nothing was overwritten.");
            return;
          }
          await savePipelineOutput(briefId, "anti_ai_output", acc);
          await refetchOutputs();
          setAntiAiRunning(false);
          setAntiAiStream("");
          setAntiAiCompletedAt(new Date());
          toast.success("Full Script Anti AI cleanup saved.");
        },
      );
    } catch (err: any) {
      setAntiAiRunning(false);
      toast.error(err.message || "Anti AI cleanup failed");
    }
  };

  const runFullScriptMelty = async () => {
    if (!briefId) return;
    if (!fullScriptContent || fullScriptContent.trim().length < 50) {
      toast.error("Generate a Full Script first.");
      return;
    }
    setMeltyRunning(true);
    setMeltyStream("");
    let acc = "";
    try {
      await streamPolishPass(
        { passType: "melty_voice", scope: "full_script", scriptText: fullScriptContent, briefId: briefId! },
        (delta) => {
          acc += delta;
          setMeltyStream(acc);
        },
        async () => {
          if (!acc.trim()) {
            setMeltyRunning(false);
            toast.error("Voice Pass returned no content.");
            return;
          }
          const { scriptBody, changeLog } = splitMeltyVoicePassOutput(acc);

          await savePipelineOutput(briefId, "melty_voice_pass", scriptBody);
          if (changeLog && changeLog.trim()) {
            await savePipelineOutput(briefId, "melty_voice_pass_log", changeLog);
          }

          await refetchOutputs();
          setMeltyRunning(false);
          setMeltyStream("");
          toast.success("Voice Pass saved. It will now feed the Anti AI Cleanup.");
        },
      );
    } catch (err: any) {
      setMeltyRunning(false);
      toast.error(err.message || "Voice Pass failed");
    }
  };

  const runPassageRevision = async () => {
    if (!passageInput.trim()) {
      toast.error("Paste a passage to revise.");
      return;
    }
    setPassageRunning(true);
    setPassageOutput("");
    let acc = "";
    try {
      await streamPolishPass(
        {
          passType: "anti_ai",
          scope: "passage",
          scriptText: passageInput,
          userFeedback: passageFeedback,
          briefId: briefId!,
        },
        (delta) => {
          acc += delta;
          setPassageOutput(acc);
        },
        () => {
          setPassageRunning(false);
          if (!acc.trim()) toast.error("No revised passage returned.");
        },
      );
    } catch (err: any) {
      setPassageRunning(false);
      toast.error(err.message || "Passage revision failed");
    }
  };

  const copyPassageOutput = () => {
    if (!passageOutput) return;
    navigator.clipboard.writeText(passageOutput);
    toast.success("Revised passage copied");
  };

  return (
    <Layout>
      <div className="flex h-screen">
        <PipelineSidebar
          brief={brief || null}
          activeStep={activeStep}
          setActiveStep={setActiveStep}
          generating={generating}
          getStepOutput={getStepOutput}
          onDownloadPipeline={handleDownloadPipeline}
        />


        <div className="flex-1 flex flex-col">
          <>
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div>
              <h2 className="font-mono text-sm font-bold text-foreground">
                {PIPELINE_STEPS.find((s) => s.type === (activeStep as PipelineStepType))?.label}
              </h2>
              <p className="text-xs text-muted-foreground">
                {PIPELINE_STEPS.find((s) => s.type === (activeStep as PipelineStepType))?.description}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {displayContent && !generating && (
                <>
                  <Button size="sm" variant="ghost" onClick={handleCopy} className="gap-1.5 text-xs">
                    <Copy className="w-3.5 h-3.5" />
                    Copy
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleDownload} className="gap-1.5 text-xs">
                    <Download className="w-3.5 h-3.5" />
                    Export
                  </Button>
                </>
              )}
              {/* Final Voice Pass moved into Advanced options below */}
              <Button
                size="sm"
                onClick={() => (currentOutput ? handleRegenerate() : handleGenerate())}
                disabled={
                  generating || (isFullScriptStep && pendingHighRiskCount > 0)
                }
                className="gap-1.5"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Generating...
                  </>
                ) : currentOutput ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    Regenerate
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5" />
                    Generate
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Brief Sources */}
          <Collapsible open={briefSourcesOpen} onOpenChange={setBriefSourcesOpen}>
            <CollapsibleTrigger className="flex w-full items-center gap-2 border-b border-border px-6 py-2 text-xs font-medium text-muted-foreground hover:text-foreground">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${briefSourcesOpen ? "" : "-rotate-90"}`} />
              Brief Sources
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="border-b border-border px-6 py-4 space-y-4">
                <p className="text-xs text-muted-foreground">
                  Files here are used only by this brief. Channel-wide sources live in the Source Library.
                </p>
                <div className="grid gap-4 md:grid-cols-2">
                  <FileUploadCard
                    fileType="book"
                    title="Primary documents (this brief)"
                    description="Documents attached to this brief only."
                    files={briefBooks}
                    onRefresh={refetchSourceFiles}
                    briefId={briefId!}
                  />
                  <FileUploadCard
                    fileType="transcript"
                    title="Primary transcripts (this brief)"
                    description="Transcripts attached to this brief only."
                    files={briefTranscripts}
                    onRefresh={refetchSourceFiles}
                    briefId={briefId!}
                  />
                </div>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Content area */}
          <div className="flex-1 overflow-hidden">
            {showCreativeBriefReview ? (
              <div ref={contentRef} className="h-full overflow-auto p-6">
                <MarkdownContent content={displayContent} />
                <div className="border-t border-border my-6" />
                <div className="space-y-3 max-w-3xl">
                  <Label className="text-sm font-medium">Feedback (optional)</Label>
                  <Textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Add any changes or direction before the pipeline continues. Leave blank to approve as-is."
                    rows={4}
                    className="bg-secondary border-border resize-none"
                  />
                  <Button onClick={handleApproveCreativeBrief} disabled={approving} className="gap-1.5">
                    {approving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Approving...
                      </>
                    ) : (
                      <>
                        <ThumbsUp className="w-3.5 h-3.5" />
                        Approve & Continue
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : showCreativeBriefApproved ? (
              <div ref={contentRef} className="h-full overflow-auto p-6">
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded bg-green-500/10 text-green-600 dark:text-green-400 border border-green-500/30">
                    <CheckCircle2 className="w-3 h-3" />
                    Approved
                  </span>
                </div>
                <MarkdownContent content={displayContent} />
                {creativeBriefFeedback && (
                  <div className="mt-6 p-4 rounded-md bg-secondary/50 border border-border">
                    <p className="text-xs font-medium text-muted-foreground mb-1">Your feedback:</p>
                    <p className="text-sm text-foreground/85 whitespace-pre-wrap">{creativeBriefFeedback}</p>
                  </div>
                )}
              </div>
            ) : (
              <div ref={contentRef} className="h-full overflow-auto p-6">
                {isFullScriptStep && pendingHighRiskCount > 0 && (
                  <div className="mb-4 flex items-center justify-between gap-3 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-yellow-800 dark:text-yellow-300">
                      <AlertTriangle className="w-4 h-4" />
                      <span>
                        <strong>{pendingHighRiskCount}</strong> high risk evidence point
                        {pendingHighRiskCount === 1 ? "" : "s"} need review before generating the
                        Full Script.
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setActiveStep("evidence_table")}
                      className="h-7 text-xs"
                    >
                      Review Evidence Table
                    </Button>
                  </div>
                )}
                {isEvidenceTableStep && evidencePoints.length > 0 && !generating ? (
                  <EvidenceTableView
                    rows={evidencePoints}
                    libraryFileNames={libraryFileNames}
                    onSetApproval={handleSetApproval}
                  />
                ) : displayContent ? (
                  <MarkdownContent content={displayContent} />
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center mb-4">
                      <Play className="w-5 h-5 text-primary" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-1">No content generated yet</p>
                    <p className="text-xs text-muted-foreground/60">
                      Click "Generate" to create the{" "}
                      {PIPELINE_STEPS.find((s) => s.type === activeStep)?.label?.toLowerCase()}
                    </p>
                  </div>
                )}

                {generating && (
                  <div className="flex items-center gap-2 mt-4 text-xs text-primary">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    Generating from source material...
                  </div>
                )}

                {currentOutput && !generating && activeStep !== "creative_brief" && (
                  <div className="mt-8 border-t border-border pt-6 max-w-3xl space-y-3">
                    <Label className="text-sm font-medium">Feedback (optional)</Label>
                    <p className="text-xs text-muted-foreground">
                      Add direction before regenerating this step. The feedback is
                      passed into the prompt and cleared after the run completes.
                    </p>
                    <Textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder='e.g. "tighten the middle beats", "lean harder on book evidence", "drop the speculative paragraph"'
                      rows={3}
                      className="bg-secondary border-border resize-none"
                    />
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        onClick={handleRegenerate}
                        disabled={generating}
                        className="gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Regenerate{feedbackText.trim() ? " with feedback" : ""}
                      </Button>
                    </div>
                  </div>
                )}

                {isFullScriptStep && !generating && (
                  <div className="mt-10 border-t border-border pt-6 max-w-3xl space-y-8">
                    {/* Hook Options (optional) — transient UI state only, never persisted */}
                    <div className="space-y-4 p-4 rounded-md border border-border bg-secondary/30">
                      <div>
                        <h3 className="font-mono text-sm font-bold text-foreground flex items-center gap-2">
                          <Lightbulb className="w-4 h-4 text-primary" />
                          Hook Options (optional)
                        </h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          Generates three distinct opening hooks from the saved Creative Brief and Script Evidence Pack.
                          Pick one — the Full Script will open with it verbatim. Not saved — refresh discards.
                        </p>
                      </div>

                      <Button
                        size="sm"
                        onClick={handleGenerateHookOptions}
                        disabled={hookOptionsLoading}
                        className="gap-1.5"
                      >
                        {hookOptionsLoading ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Generating hooks...
                          </>
                        ) : (
                          <>
                            <Lightbulb className="w-3.5 h-3.5" />
                            {hookOptions.length ? "Regenerate hooks" : "Generate Hook Options"}
                          </>
                        )}
                      </Button>

                      {hookOptions.length > 0 && (
                        <div className="grid grid-cols-1 gap-3 mt-2">
                          {hookOptions.map((h, i) => {
                            const isActive = selectedHookIdx === i;
                            return (
                              <div
                                key={i}
                                className={`rounded-md border p-3 bg-background space-y-2 ${
                                  isActive ? "border-primary" : "border-border"
                                }`}
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-semibold text-foreground">
                                      {h.hook_label}
                                    </span>
                                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-secondary text-foreground/70 border border-border">
                                      {h.angle_route}
                                    </span>
                                    {isActive && (
                                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                                        Selected
                                      </span>
                                    )}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant={isActive ? "secondary" : "default"}
                                    onClick={() => {
                                      setSelectedHookIdx(i);
                                      setRefineFeedback("");
                                    }}
                                    className="h-7 text-xs"
                                  >
                                    {isActive ? "Selected" : "Use this hook"}
                                  </Button>
                                </div>
                                <p className="text-sm text-foreground/85 whitespace-pre-wrap">
                                  {h.hook_text}
                                </p>

                                {isActive && (
                                  <div className="space-y-2 pt-2 border-t border-border">
                                    <Label className="text-xs">Refine this hook</Label>
                                    <Textarea
                                      value={refineFeedback}
                                      onChange={(e) => setRefineFeedback(e.target.value)}
                                      rows={2}
                                      placeholder='e.g. "tighten the second sentence", "open with the scene instead of the question", "drop the joke"'
                                      className="bg-background border-border resize-none text-sm"
                                      disabled={refining}
                                    />
                                    <div className="flex justify-end">
                                      <Button
                                        size="sm"
                                        onClick={handleRefineSelectedHook}
                                        disabled={refining || !refineFeedback.trim()}
                                        className="h-7 text-xs gap-1.5"
                                      >
                                        {refining ? (
                                          <>
                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                            Refining...
                                          </>
                                        ) : (
                                          <>
                                            <Wand2 className="w-3.5 h-3.5" />
                                            Regenerate from feedback
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Custom paste — collapsed text-link entry point */}
                      <div className="pt-2 border-t border-border">
                        {!customHookOpen ? (
                          <button
                            type="button"
                            onClick={() => setCustomHookOpen(true)}
                            className="text-xs text-primary hover:underline"
                          >
                            Write my own opening
                          </button>
                        ) : (
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Your own opening</Label>
                              <button
                                type="button"
                                onClick={() => {
                                  setCustomHookOpen(false);
                                  if (selectedHookIdx === -2) setSelectedHookIdx(-1);
                                  setCustomHookText("");
                                }}
                                className="text-[11px] text-muted-foreground hover:text-foreground"
                              >
                                Cancel
                              </button>
                            </div>
                            <Textarea
                              value={customHookText}
                              onChange={(e) => setCustomHookText(e.target.value)}
                              rows={6}
                              placeholder="Paste or write your own hook. The Full Script will open with it verbatim."
                              className="bg-background border-border resize-none text-sm"
                            />
                            <div className="flex justify-end">
                              <Button
                                size="sm"
                                variant={selectedHookIdx === -2 ? "secondary" : "default"}
                                disabled={!customHookText.trim()}
                                onClick={() => setSelectedHookIdx(-2)}
                                className="h-7 text-xs"
                              >
                                {selectedHookIdx === -2 ? "Selected" : "Use this hook"}
                              </Button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <h3 className="font-mono text-sm font-bold text-foreground flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-primary" />
                        Script Cleanup & Passage Rewrite
                      </h3>
                      <p className="text-xs text-muted-foreground mt-1">
                        Focused post-generation tools. Neither tool uses the Creative Brief,
                        Evidence Pack, Beat Plan, or any pipeline context.
                      </p>
                    </div>

                    {/* Tool 1a — Melty Voice Pass (runs before Anti AI Cleanup) */}
                    <div className="space-y-3 p-4 rounded-md border border-border bg-secondary/30">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          Voice Pass
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Step 1 of 2
                          </span>
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          Applies the host persona's personality, reactive beats, and voice into the
                          full script draft. Saved separately; the Anti AI Cleanup below will use this
                          output as its input once it exists.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={runFullScriptMelty}
                        disabled={meltyRunning || !fullScriptContent}
                        className="gap-1.5"
                      >
                        {meltyRunning ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Running Voice Pass...
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3.5 h-3.5" />
                            {meltyVoicePassContent ? "Re-run Voice Pass" : "Run Voice Pass"}
                          </>
                        )}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        {formatLastRun(meltyVoicePassOutput)}
                      </p>
                      {meltyRunning && meltyStream && (
                        <div className="mt-2 max-h-64 overflow-auto rounded border border-border bg-background p-3 text-xs whitespace-pre-wrap text-foreground/80">
                          {meltyStream}
                          <div className="flex items-center gap-2 mt-2 text-primary">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            Streaming Voice Pass... will save when complete.
                          </div>
                        </div>
                      )}
                      {!meltyRunning && meltyVoicePassContent && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-muted-foreground">
                              Voice Pass output (saved). Will feed the Anti AI Cleanup below.
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                navigator.clipboard.writeText(meltyVoicePassContent);
                                toast.success("Copied Voice Pass output");
                              }}
                              className="gap-1.5 text-xs h-7"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              Copy
                            </Button>
                          </div>
                          <div className="max-h-96 overflow-auto rounded border border-border bg-background p-3 text-xs whitespace-pre-wrap text-foreground">
                            {meltyVoicePassContent}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Tool 1b — Full Script Anti AI Cleanup */}
                    <div className="space-y-3 p-4 rounded-md border border-border bg-secondary/30">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">
                          Full Script Anti AI Cleanup
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">
                            Step 2 of 2
                          </span>
                        </h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          Runs the {meltyVoicePassContent ? "saved Voice Pass" : "saved Full Script"}{" "}
                          through the Anti AI document. Saves the result as a separate Anti-AI Output —
                          the original Full Script is never modified.
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => setConfirmAntiAiOpen(true)}
                        disabled={antiAiRunning || !antiAiInput}
                        className="gap-1.5"
                      >
                        {antiAiRunning ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Cleaning...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            Run Full Script Anti AI Cleanup
                          </>
                        )}
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        {formatLastRun(antiAiOutputRow)}
                      </p>
                      {antiAiRunning && antiAiStream && (
                        <div className="mt-2 max-h-64 overflow-auto rounded border border-border bg-background p-3 text-xs whitespace-pre-wrap text-foreground/80">
                          {antiAiStream}
                          <div className="flex items-center gap-2 mt-2 text-primary">
                            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                            Streaming Anti AI cleanup... will save when complete.
                          </div>
                        </div>
                      )}
                      {!antiAiRunning && antiAiCompletedAt && (
                        <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2 text-xs text-green-600 dark:text-green-400">
                          <CheckCircle2 className="w-4 h-4 shrink-0" />
                          <span className="font-medium">Anti-AI Polish Complete</span>
                          <span className="text-green-600/70 dark:text-green-400/70">
                            — Saved as Anti-AI Output at{" "}
                            {antiAiCompletedAt.toLocaleTimeString()}
                          </span>
                        </div>
                      )}
                      {!antiAiRunning && antiAiOutputContent && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-[11px] text-muted-foreground">
                              Anti-AI Output (saved)
                            </p>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                navigator.clipboard.writeText(antiAiOutputContent);
                                toast.success("Copied Anti-AI Output");
                              }}
                              className="gap-1.5 text-xs h-7"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              Copy
                            </Button>
                          </div>
                          <div className="max-h-96 overflow-auto rounded border border-border bg-background p-3 text-xs whitespace-pre-wrap text-foreground">
                            {antiAiOutputContent}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Tool 2 — Passage Rewrite */}
                    <div className="space-y-3 p-4 rounded-md border border-border bg-secondary/30">
                      <div>
                        <h4 className="text-sm font-semibold text-foreground">Passage Rewrite</h4>
                        <p className="text-xs text-muted-foreground mt-1">
                          Paste a hook, transition, paragraph, or section. Uses Script Writing,
                          Anti AI, and voice guidance together. Returns the revised passage only and
                          never saves automatically.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Pasted passage</Label>
                        <Textarea
                          value={passageInput}
                          onChange={(e) => setPassageInput(e.target.value)}
                          rows={6}
                          placeholder="Paste the passage to revise..."
                          className="bg-background border-border resize-none text-sm"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs">Feedback (optional)</Label>
                        <Textarea
                          value={passageFeedback}
                          onChange={(e) => setPassageFeedback(e.target.value)}
                          rows={3}
                          placeholder='e.g. "this hook is not strong enough", "make this less academic", "remove the contrast formula"'
                          className="bg-background border-border resize-none text-sm"
                        />
                      </div>
                      <Button
                        size="sm"
                        onClick={runPassageRevision}
                        disabled={passageRunning || !passageInput.trim()}
                        className="gap-1.5"
                      >
                        {passageRunning ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Revising...
                          </>
                        ) : (
                          <>
                            <Wand2 className="w-3.5 h-3.5" />
                            Revise Passage
                          </>
                        )}
                      </Button>
                      {passageOutput && (
                        <div className="mt-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs">Revised passage</Label>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={copyPassageOutput}
                              className="gap-1.5 text-xs h-7"
                            >
                              <Copy className="w-3.5 h-3.5" />
                              Copy
                            </Button>
                          </div>
                          <div className="rounded border border-border bg-background p-3 text-sm whitespace-pre-wrap text-foreground/85">
                            {passageOutput}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
          </>
        </div>
      </div>

      <AlertDialog open={confirmAntiAiOpen} onOpenChange={setConfirmAntiAiOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run Anti-AI Cleanup?</AlertDialogTitle>
            <AlertDialogDescription>
              This runs the entire saved script through the Anti AI Writing Instructions document.
              When the stream finishes successfully, the revised version will be saved as a separate
              Anti-AI Output. The original Full Script will not be modified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={runFullScriptAntiAi}>Run Anti-AI Cleanup</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Layout>
  );
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="prose prose-sm max-w-none dark:prose-invert prose-headings:font-mono prose-headings:text-foreground prose-p:text-foreground/85 prose-strong:text-foreground prose-a:text-primary prose-code:text-primary prose-code:bg-secondary prose-code:px-1 prose-code:rounded prose-pre:bg-secondary prose-pre:border prose-pre:border-border prose-th:text-foreground prose-td:text-foreground/80 prose-table:border-border">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}
