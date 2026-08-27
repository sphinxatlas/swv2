import { useQuery } from "@tanstack/react-query";
import { Layout } from "@/components/Layout";
import { FileUploadCard } from "@/components/FileUploadCard";
import { getSourceFiles } from "@/lib/api";
import { Database } from "lucide-react";
import { useChannel } from "@/contexts/ChannelContext";

export default function SourceLibrary() {
  const { channelId, loading: channelLoading } = useChannel();
  const { data: files = [], refetch } = useQuery({
    queryKey: ["source-files", channelId],
    queryFn: () => getSourceFiles(channelId!),
    enabled: !!channelId,
  });

  const books = files.filter((f) => f.file_type === "book");
  const transcripts = files.filter((f) => f.file_type === "transcript");
  const lexicon = files.filter((f) => f.file_type === "lexicon");
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
            Upload your source files to build the knowledge base for script generation.
          </p>
          {files.length > 0 && (
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <Database className="w-3.5 h-3.5 text-primary" />
              <span>{indexedCount} of {files.length} files indexed for retrieval</span>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <FileUploadCard
            fileType="book"
            title="📚 Harry Potter Books"
            description="Upload book text files (.txt, .md). Each book will be chunked and indexed for semantic search."
            files={books}
            onRefresh={refetch}
          />

          <FileUploadCard
            fileType="transcript"
            title="🎬 Movie Transcripts"
            description="Upload movie transcript files. These provide dialogue and scene descriptions for reference."
            files={transcripts}
            onRefresh={refetch}
          />

          <FileUploadCard
            fileType="lexicon"
            title="📖 Lexicon"
            description="Upload Lexicon reference files (.txt). These serve as secondary reference only — used for context, chronology, and discovery, never as primary canon."
            accept=".txt"
            files={lexicon}
            onRefresh={refetch}
            badge="Secondary Reference"
          />

          <FileUploadCard
            fileType="instructions"
            title="📝 Script Instructions & Strategy"
            description="Upload your master script writing document — covers tone, style, hooks, pacing, rehooks, argument structure, and retention. Used to shape writing quality, never as canon evidence."
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
              <strong>Quality tagging is set by you, not by the AI.</strong> Strong = trusted research the writer can absorb and use freely as informed background. Useful = good for framing and audience awareness; specific claims need STRONG or canon backup. Limited = inspiration only; specific claims need STRONG or canon backup. Sources are never named in the script regardless of tier — the writer absorbs and rephrases.
            </p>
            <FileUploadCard
              fileType="competitor_analysis"
              title="🎙️ Commentary Transcripts (Secondary)"
              description="Upload raw YouTube commentary transcripts for additional angles and context. Used for interpretation, framing, and idea discovery only. Never used as primary canon evidence or as a source for exact quotes from the books or films."
              accept=".txt,.md"
              files={competitorAnalysis}
              onRefresh={refetch}
              badge="Secondary Commentary — Not Canon"
            />
          </div>

          <FileUploadCard
            fileType="host_persona"
            title="🧑‍🎤 Host Persona"
            description="Store your host profile — name, style, catchphrases, channel identity. This is for reference only and is NOT used in any generation step."
            accept=".txt,.md"
            files={hostPersona}
            onRefresh={refetch}
            badge="Reference Only — Not Used in Generation"
          />

          <div className="ml-4 border-l-2 border-border pl-4">
            <FileUploadCard
              fileType={"melty_voice_pass" as any}
              title="🎤 Melty Voice Pass Instructions"
              description="Upload the MELTY_VOICE_PASS_V1.txt document. Used together with the Host Persona during the Melty Voice Pass on the Full Script."
              accept=".txt,.md"
              files={meltyVoicePass}
              onRefresh={refetch}
              badge="Used by Melty Voice Pass"
            />
          </div>
        </div>
      </div>
    </Layout>
  );
}
