import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { FileUploadCard } from "@/components/FileUploadCard";
import { ChannelConfigCard } from "@/components/ChannelConfigCard";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getAllChannelSourceFiles, type ChannelSourceFile, type SourceFile } from "@/lib/api";
import { ChevronDown, Database } from "lucide-react";
import { useChannel } from "@/contexts/ChannelContext";
import { cn } from "@/lib/utils";

export default function SourceLibrary() {
  const { channelId, loading: channelLoading } = useChannel();
  const [configOpen, setConfigOpen] = useState(true);
  const { data: files = [], refetch } = useQuery({
    queryKey: ["source-files-all", channelId],
    queryFn: () => getAllChannelSourceFiles(channelId!),
    enabled: !!channelId,
  });

  // Filter for the Primary Documents and Primary Recordings cards only.
  // Governing-document cards are channel-level by nature and stay unfiltered.
  const [scopeFilter, setScopeFilter] = useState<string>("all");

  const videosWithFiles = useMemo(() => {
    const map = new Map<string, string>();
    for (const f of files) {
      if (f.brief_id && !map.has(f.brief_id)) {
        map.set(f.brief_id, f.topic_briefs?.title?.trim() || "Untitled video");
      }
    }
    return Array.from(map, ([id, title]) => ({ id, title })).sort((a, b) =>
      a.title.localeCompare(b.title),
    );
  }, [files]);

  const scopeLabelFor = (file: SourceFile): string | undefined => {
    const f = file as ChannelSourceFile;
    if (!f.brief_id) return "Channel-wide";
    return f.topic_briefs?.title?.trim() || "Video";
  };

  const scopeMatches = (file: ChannelSourceFile): boolean => {
    if (scopeFilter === "all") return true;
    if (scopeFilter === "channel") return !file.brief_id;
    return file.brief_id === scopeFilter;
  };

  const books = files.filter((f) => f.file_type === "book" && scopeMatches(f));
  const transcripts = files.filter((f) => f.file_type === "transcript" && scopeMatches(f));

  const instructions = files.filter((f) => f.file_type === "instructions" || f.file_type === "script_strategy");
  const antiAiGuide = files.filter((f) => f.file_type === "anti_ai_guide");
  const competitorAnalysis = files.filter((f) => f.file_type === "competitor_analysis");
  const hostPersona = files.filter((f) => f.file_type === "host_persona");
  const meltyVoicePass = files.filter((f) => f.file_type === "melty_voice_pass");

  const indexedCount = files.filter((f) => f.status === "indexed").length;

  if (channelLoading || !channelId) {
    return <Layout><div className="p-8" /></Layout>;
  }

  return (
    <Layout>
      <div className="p-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-2xl font-mono font-bold text-foreground mb-2">Source Library</h1>
          <p className="text-sm text-muted-foreground">
            Primary evidence and the documents that govern how scripts are written. Anything that cannot back a claim belongs in the Secondary Source Library.
          </p>
          <p className="text-xs text-muted-foreground mt-2">
            Uploads here apply to every video. To add sources for one video, upload inside that video's workspace.
          </p>
          {files.length > 0 && (
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <Database className="w-3.5 h-3.5 text-primary" />
              <span>{indexedCount} of {files.length} files indexed for retrieval</span>
            </div>
          )}
        </div>

        <Collapsible open={configOpen} onOpenChange={setConfigOpen} className="mb-6">
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-semibold text-foreground hover:opacity-80 transition-opacity">
            <ChevronDown
              className={cn(
                "w-4 h-4 transition-transform",
                configOpen ? "rotate-0" : "-rotate-90",
              )}
            />
            Channel Configuration
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3">
            <ChannelConfigCard />
          </CollapsibleContent>
        </Collapsible>

        <div className="mb-6 flex items-center gap-3">
          <label className="text-xs font-medium text-muted-foreground whitespace-nowrap">
            Show files
          </label>
          <Select value={scopeFilter} onValueChange={setScopeFilter}>
            <SelectTrigger className="h-8 w-[260px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All files</SelectItem>
              <SelectItem value="channel">Channel-wide only</SelectItem>
              {videosWithFiles.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-6">
          <FileUploadCard
            fileType="book"
            title="📚 Primary Documents"
            description="Reports, filings, books, papers, datasets, court records, articles of record. Chunked and indexed for semantic search. This is claim-grade evidence and can be named in the script."
            files={books}
            onRefresh={refetch}
            scopeLabelFor={scopeLabelFor}
          />

          <FileUploadCard
            fileType="transcript"
            title="🎬 Primary Recordings & Transcripts"
            description="Transcripts of the primary material itself: films, hearings, earnings calls, interviews, speeches. Same evidentiary weight as Primary Documents. Separated because spoken material is retrieved differently."
            files={transcripts}
            onRefresh={refetch}
            scopeLabelFor={scopeLabelFor}
          />


          <FileUploadCard
            fileType="instructions"
            title="📝 Script Instructions & Strategy"
            description="Upload your master script writing document — covers tone, style, hooks, pacing, rehooks, argument structure, and retention. Used to shape writing quality, never as evidence."
            accept=".txt,.md"
            files={instructions}
            onRefresh={refetch}
            badge="Guidance Only"
          />

          <div className="ml-4 border-l-2 border-border pl-4">
            <FileUploadCard
              fileType="anti_ai_guide"
              title="🚫 Anti AI Language Guide"
              description="Upload TXT documents listing AI writing tells and phrases to avoid. Injected into Full Script (mandatory) and Beat Plan prompts to keep output sounding human and natural."
              accept=".txt"
              files={antiAiGuide}
              onRefresh={refetch}
              badge="Writing Guidance — Injected into Script Generation"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs text-muted-foreground leading-relaxed px-1">
              <strong>Quality tagging is set by you, not by the AI.</strong> Strong = trusted research the writer can absorb and use freely as informed background. Useful = good for framing and audience awareness; specific claims need STRONG or primary source backup. Limited = inspiration only; specific claims need STRONG or primary source backup. Sources are never named in the script regardless of tier — the writer absorbs and rephrases.
            </p>
            <FileUploadCard
              fileType="competitor_analysis"
              title="🎙️ Commentary & Interpretation (Secondary)"
              description="Other people's commentary on your topic. Used for angles, framing, and idea discovery only. Never claim-grade evidence and never a source of exact quotes from the primary material."
              accept=".txt,.md"
              files={competitorAnalysis}
              onRefresh={refetch}
              badge="Secondary Commentary — Not a Primary Source"
            />
          </div>

          <FileUploadCard
            fileType="host_persona"
            title="🧑‍🎤 Host Persona"
            description="Upload your host profile (.txt, .md) — name, style, delivery habits, recurring phrases, channel identity. This document is loaded into generation and is the only voice authority in the system. It shapes how the script sounds, never what it claims as fact."
            accept=".txt,.md"
            files={hostPersona}
            onRefresh={refetch}
            badge="Voice Authority — Injected into Script Generation"
          />

          <div className="ml-4 border-l-2 border-border pl-4">
            <FileUploadCard
              fileType={"melty_voice_pass" as any}
              title="🎤 Voice Pass Instructions"
              description="Upload the voice pass instruction document (.txt, .md). Used together with the Host Persona during the voice pass on the Full Script. Guidance for delivery only — never a source of evidence."
              accept=".txt,.md"
              files={meltyVoicePass}
              onRefresh={refetch}
              badge="Used by Voice Pass"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
