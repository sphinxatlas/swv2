import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type SourceFile = Tables<"source_files">;
export type TopicBrief = Tables<"topic_briefs">;
export type PipelineOutput = Tables<"pipeline_outputs">;
export type EvidencePoint = Tables<"evidence_points">;
export type PipelineStepType =
  | "creative_brief"
  | "six_category_extraction"
  | "selected_source_analysis"
  | "angle_check"
  | "evidence_table"
  | "outline"
  | "script_evidence_pack"
  | "full_script"
  | "melty_voice_pass"
  | "melty_voice_pass_log"
  | "anti_ai_output";

export const PIPELINE_STEPS: {
  type: PipelineStepType;
  label: string;
  description: string;
  visible: boolean;
}[] = [
  {
    type: "creative_brief",
    label: "Creative Brief",
    description: "Generates thesis, argument structure, emotional arc, and tone from your inputs.",
    visible: true,
  },
  {
    type: "six_category_extraction",
    label: "Insights & Research",
    description: "Mines canon for evidence, patterns, contradictions, subtext, and original angles.",
    visible: true,
  },
  {
    type: "selected_source_analysis",
    label: "Selected Source Analysis",
    description: "Pressure-tests the angle against the secondary sources selected for this brief — surfaces fan signals, overused angles, objections, and original synthesis routes. Never canon proof.",
    visible: true,
  },
  {
    type: "angle_check",
    label: "Angle Check",
    description: "Stress-tests the working thesis against the research. Confirms it or replaces it with a sharper contention — binding for all later steps.",
    visible: true,
  },
  {
    type: "evidence_table",
    label: "Evidence Table",
    description: "Curated shortlist of the strongest argument points with source citations.",
    visible: true,
  },
  {
    type: "outline",
    label: "Beat Plan",
    description: "Internal beat plan: numbered prose beats for argument review before the Full Script.",
    visible: true,
  },
  {
    type: "script_evidence_pack",
    label: "Script Evidence Pack",
    description: "Writer-facing brief mapping each beat to its canon evidence in clean prose. The only research the Full Script reads.",
    visible: true,
  },
  {
    type: "full_script",
    label: "Full Script",
    description: "Complete voiceover script with editor tags.",
    visible: true,
  },
];

export async function uploadSourceFile(file: File, fileType: "book" | "transcript" | "instructions" | "lexicon" | "competitor_analysis" | "host_persona" | "anti_ai_guide" | "melty_voice_pass") {
  const storagePath = `${fileType}/${Date.now()}-${file.name}`;

  const { error: uploadError } = await supabase.storage
    .from("source-files")
    .upload(storagePath, file);

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("source_files")
    .insert({
      name: file.name,
      file_type: fileType,
      storage_path: storagePath,
      file_size: file.size,
      status: "uploaded",
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function processFile(fileId: string) {
  const response = await supabase.functions.invoke("process-file", {
    body: { fileId },
  });

  if (response.error) throw response.error;
  return response.data;
}

export async function deleteSourceFile(fileId: string, storagePath: string) {
  await supabase.storage.from("source-files").remove([storagePath]);
  const { error } = await supabase.from("source_files").delete().eq("id", fileId);
  if (error) throw error;
}

// Rename a source file: moves the object in storage and updates the DB row.
// file_chunks reference the file by file_id (uuid), not filename, so renaming
// source_files.name automatically flows through to chunk lookups via the join
// in search_chunks. No file_chunks rows need to be rewritten.
// Only .txt and .md extensions are allowed; the existing extension is preserved.
export async function renameSourceFile(
  fileId: string,
  oldStoragePath: string,
  oldName: string,
  newName: string,
): Promise<{ name: string; storage_path: string }> {
  const trimmed = newName.trim();
  if (!trimmed) throw new Error("Filename cannot be empty");

  const oldExtMatch = oldName.match(/\.(txt|md)$/i);
  const oldExt = oldExtMatch ? oldExtMatch[0] : "";
  const newExtMatch = trimmed.match(/\.(txt|md)$/i);
  if (!newExtMatch) {
    throw new Error("Filename must end in .txt or .md");
  }
  if (oldExt && newExtMatch[0].toLowerCase() !== oldExt.toLowerCase()) {
    throw new Error(`File extension must remain ${oldExt}`);
  }
  if (trimmed === oldName) {
    return { name: oldName, storage_path: oldStoragePath };
  }

  // Build new storage path keeping the same folder + timestamp prefix.
  const lastSlash = oldStoragePath.lastIndexOf("/");
  const folder = lastSlash >= 0 ? oldStoragePath.slice(0, lastSlash + 1) : "";
  const oldBase = lastSlash >= 0 ? oldStoragePath.slice(lastSlash + 1) : oldStoragePath;
  const tsMatch = oldBase.match(/^(\d+-)/);
  const prefix = tsMatch ? tsMatch[1] : `${Date.now()}-`;
  const newStoragePath = `${folder}${prefix}${trimmed}`;

  // 1) Move storage object.
  const { error: moveErr } = await supabase.storage
    .from("source-files")
    .move(oldStoragePath, newStoragePath);
  if (moveErr) throw new Error(`Storage rename failed: ${moveErr.message}`);

  // 2) Update source_files row. If this fails, roll back the storage move.
  const { error: updateErr } = await supabase
    .from("source_files")
    .update({ name: trimmed, storage_path: newStoragePath })
    .eq("id", fileId);

  if (updateErr) {
    // Roll back storage rename.
    await supabase.storage
      .from("source-files")
      .move(newStoragePath, oldStoragePath)
      .catch(() => {});
    throw new Error(`Database update failed: ${updateErr.message}`);
  }

  return { name: trimmed, storage_path: newStoragePath };
}

export async function getSourceFiles() {
  const { data, error } = await supabase
    .from("source_files")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

// Reconstruct full text content of an uploaded source file from its indexed chunks.
export async function getSourceFileContent(fileId: string): Promise<string> {
  const { data, error } = await supabase
    .from("file_chunks")
    .select("content, chunk_index")
    .eq("file_id", fileId)
    .order("chunk_index", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => c.content).join("\n\n");
}

// Get a short-lived signed URL to download the original uploaded file from storage.
export async function getSourceFileDownloadUrl(storagePath: string, expiresInSeconds = 60): Promise<string> {
  const { data, error } = await supabase.storage
    .from("source-files")
    .createSignedUrl(storagePath, expiresInSeconds, { download: true });
  if (error) throw error;
  return data.signedUrl;
}

export async function getTopicBriefs() {
  const { data, error } = await supabase
    .from("topic_briefs")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export const TARGET_LENGTH_OPTIONS = [
  { minutes: 8, min: 1120, max: 1280, label: "8 min (1,120–1,280 words)" },
  { minutes: 10, min: 1400, max: 1600, label: "10 min (1,400–1,600 words)" },
  { minutes: 12, min: 1680, max: 1920, label: "12 min (1,680–1,920 words)" },
  { minutes: 15, min: 2100, max: 2400, label: "15 min (2,100–2,400 words)" },
  { minutes: 20, min: 2800, max: 3200, label: "20 min (2,800–3,200 words)" },
];

export interface CreateBriefInput {
  title: string;
  angle_note: string;
  target_minutes: number;
  target_min_words: number;
  target_max_words: number;
  comparison_mode: boolean;
  characters?: string[];
  focus_areas?: string[];
  priority_sources?: string[];
}

export async function createTopicBrief(input: CreateBriefInput) {
  const payload = {
    ...input,
    description: input.angle_note ?? "",
  };
  const { data, error } = await supabase
    .from("topic_briefs")
    .insert(payload as any)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateTopicBrief(id: string, input: Partial<CreateBriefInput>) {
  const payload: any = { ...input };
  if (Object.prototype.hasOwnProperty.call(input, "angle_note")) {
    payload.description = input.angle_note ?? "";
  }
  const { data, error } = await supabase
    .from("topic_briefs")
    .update(payload)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteTopicBrief(id: string) {
  const { error } = await supabase.from("topic_briefs").delete().eq("id", id);
  if (error) throw error;
}

// Duplicate an existing Topic Brief: copies all input fields and linked transcripts,
// but never copies pipeline outputs, evidence, creative_brief feedback/approval, or generated fields.
export async function duplicateTopicBrief(briefId: string) {
  const { data: original, error: fetchErr } = await supabase
    .from("topic_briefs")
    .select("*")
    .eq("id", briefId)
    .single();
  if (fetchErr) throw fetchErr;
  if (!original) throw new Error("Brief not found");

  const insertPayload: any = {
    title: `${original.title} (copy)`,
    description: original.description ?? "",
    angle_note: original.angle_note,
    target_minutes: original.target_minutes,
    target_min_words: original.target_min_words,
    target_max_words: original.target_max_words,
    comparison_mode: original.comparison_mode,
    characters: original.characters ?? [],
    focus_areas: original.focus_areas ?? [],
    priority_sources: original.priority_sources ?? [],
    // Explicitly do NOT copy: thesis, proof_goal, emotional_angle, tone,
    // creative_brief_feedback, creative_brief_approved (these are
    // pipeline-generated or review state).
  };

  const { data: created, error: insertErr } = await supabase
    .from("topic_briefs")
    .insert(insertPayload)
    .select()
    .single();
  if (insertErr) throw insertErr;

  // Copy linked transcripts
  const [{ data: formatLinks }, { data: topicLinks }, { data: altLinks }] = await Promise.all([
    supabase.from("brief_format_reference_links").select("transcript_id").eq("brief_id", briefId),
    supabase.from("brief_topic_transcript_links").select("transcript_id").eq("brief_id", briefId),
    supabase.from("brief_alternative_source_links" as any).select("alternative_source_id").eq("brief_id", briefId),
  ]);

  const formatIds = (formatLinks || []).map((r: any) => r.transcript_id);
  const topicIds = (topicLinks || []).map((r: any) => r.transcript_id);
  const altIds = ((altLinks as any[]) || []).map((r: any) => r.alternative_source_id);

  if (formatIds.length > 0) {
    await supabase.from("brief_format_reference_links").insert(
      formatIds.map((id) => ({ brief_id: created.id, transcript_id: id })),
    );
  }
  if (topicIds.length > 0) {
    await supabase.from("brief_topic_transcript_links").insert(
      topicIds.map((id) => ({ brief_id: created.id, transcript_id: id })),
    );
  }
  if (altIds.length > 0) {
    await supabase.from("brief_alternative_source_links" as any).insert(
      altIds.map((id) => ({ brief_id: created.id, alternative_source_id: id })),
    );
  }

  return {
    ...created,
    _linkedFormatIds: formatIds,
    _linkedTopicIds: topicIds,
    _linkedAltIds: altIds,
  };
}

export async function getPipelineOutputs(briefId: string) {
  const { data, error } = await supabase
    .from("pipeline_outputs")
    .select("*")
    .eq("brief_id", briefId)
    .order("created_at");
  if (error) throw error;
  return data;
}

export async function savePipelineOutput(briefId: string, stepType: PipelineStepType, content: string) {
  await supabase
    .from("pipeline_outputs")
    .delete()
    .eq("brief_id", briefId)
    .eq("step_type", stepType);

  const { data, error } = await supabase
    .from("pipeline_outputs")
    .insert({ brief_id: briefId, step_type: stepType, content })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export type PolishPassType = "script_writing" | "anti_ai" | "melty_voice";

// ── Hook Options (transient UI state — never persisted) ──
export type HookOption = {
  hook_label: string;
  hook_text: string;
  angle_route: string;
  why_it_works: string;
  open_loop: string;
  risk_or_weakness: string;
};

export async function generateHookOptions(
  briefId: string,
  hookFeedback?: string,
): Promise<{ hooks: HookOption[] }> {
  const { data, error } = await supabase.functions.invoke("generate-hook-options", {
    body: { briefId, hookFeedback: hookFeedback?.trim() || undefined },
  });
  if (error) {
    // Surface server-provided error message when available.
    const ctx: any = (error as any).context;
    let msg: string | undefined;
    try {
      const body = await ctx?.json?.();
      msg = body?.error;
    } catch { /* ignore */ }
    throw new Error(msg || error.message || "Failed to generate hook options");
  }
  if (!data?.hooks || !Array.isArray(data.hooks)) {
    throw new Error("Hook options response was malformed");
  }
  return { hooks: data.hooks as HookOption[] };
}

export async function refineHookOption(
  briefId: string,
  hook: HookOption,
  hookFeedback: string,
): Promise<{ hook: HookOption }> {
  const { data, error } = await supabase.functions.invoke("generate-hook-options", {
    body: {
      briefId,
      hookFeedback: hookFeedback?.trim() || undefined,
      refineFromHook: {
        hook_label: hook.hook_label,
        hook_text: hook.hook_text,
        angle_route: hook.angle_route,
      },
    },
  });
  if (error) {
    const ctx: any = (error as any).context;
    let msg: string | undefined;
    try {
      const body = await ctx?.json?.();
      msg = body?.error;
    } catch { /* ignore */ }
    throw new Error(msg || error.message || "Failed to refine hook");
  }
  if (!data?.hook) {
    throw new Error("Refined hook response was malformed");
  }
  return { hook: data.hook as HookOption };
}

export async function streamPolishPass(
  input: { passType: PolishPassType; scriptText: string; scope?: "full_script" | "passage"; userFeedback?: string },
  onDelta: (text: string) => void,
  onDone: () => void,
) {
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/polish-pass`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify(input),
    },
  );

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `Polish pass failed (${resp.status})`);
  }
  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });
    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      let line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":") || line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") { streamDone = true; break; }
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch {
        textBuffer = line + "\n" + textBuffer;
        break;
      }
    }
  }
  onDone();
}

export async function streamGenerateStep(
  briefId: string,
  stepType: PipelineStepType,
  onDelta: (text: string) => void,
  onDone: () => void,
  options?: {
    revisionFeedback?: string;
    previousFullScript?: string;
    hookDirection?: string;
  },
) {
  const resp = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-step`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({
        briefId,
        stepType,
        revisionFeedback: options?.revisionFeedback,
        previousFullScript: options?.previousFullScript,
        hookDirection: options?.hookDirection,
      }),
    }
  );

  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error || `Generation failed (${resp.status})`);
  }

  if (!resp.body) throw new Error("No response body");

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let textBuffer = "";
  let streamDone = false;

  while (!streamDone) {
    const { done, value } = await reader.read();
    if (done) break;
    textBuffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
      let line = textBuffer.slice(0, newlineIndex);
      textBuffer = textBuffer.slice(newlineIndex + 1);

      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.startsWith(":")) continue;
      if (line.trim() === "") continue;
      if (!line.startsWith("data: ")) continue;

      const jsonStr = line.slice(6).trim();
      if (jsonStr === "[DONE]") {
        streamDone = true;
        break;
      }

      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch {
        textBuffer = line + "\n" + textBuffer;
        break;
      }
    }
  }

  // Flush remaining
  if (textBuffer.trim()) {
    for (let raw of textBuffer.split("\n")) {
      if (!raw) continue;
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      if (raw.startsWith(":") || raw.trim() === "") continue;
      if (!raw.startsWith("data: ")) continue;
      const jsonStr = raw.slice(6).trim();
      if (jsonStr === "[DONE]") continue;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content as string | undefined;
        if (content) onDelta(content);
      } catch { /* ignore */ }
    }
  }

  onDone();
}

// ── Format Reference Transcripts ──
export async function getFormatReferenceTranscripts() {
  const { data, error } = await supabase
    .from('format_reference_transcripts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveFormatReferenceTranscript(input: {
  channel_name: string;
  video_title: string;
  transcript: string;
}) {
  const { data, error } = await supabase
    .from('format_reference_transcripts')
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteFormatReferenceTranscript(id: string) {
  const { error } = await supabase
    .from('format_reference_transcripts')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Brief Topic Transcripts ──
export async function getBriefTopicTranscripts() {
  const { data, error } = await supabase
    .from('brief_topic_transcripts')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function saveBriefTopicTranscript(input: {
  channel_name: string;
  video_title: string;
  transcript: string;
}) {
  const charCount = input.transcript.length;
  const estimatedTokens = Math.max(1, Math.round(charCount / 4));
  const { data, error } = await supabase
    .from('brief_topic_transcripts')
    .insert({
      ...input,
      char_count: charCount,
      estimated_tokens: estimatedTokens,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteBriefTopicTranscript(id: string) {
  const { error } = await supabase
    .from('brief_topic_transcripts')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Alternative Sources (secondary, non-canon) ──
export interface AlternativeSource {
  id: string;
  title: string;
  source_type: string | null;
  source_author: string | null;
  url: string | null;
  content: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  char_count?: number | null;
  estimated_tokens?: number | null;
  script_strength?: 'strong' | 'useful' | 'limited' | null;
}

export async function getAlternativeSources(): Promise<AlternativeSource[]> {
  const { data, error } = await supabase
    .from('alternative_sources')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []) as AlternativeSource[];
}

export async function saveAlternativeSource(input: {
  title: string;
  content: string;
  source_type?: string | null;
  source_author?: string | null;
  url?: string | null;
  notes?: string | null;
}): Promise<AlternativeSource> {
  const charCount = input.content.length;
  const estimatedTokens = Math.max(1, Math.round(charCount / 4));
  const { data, error } = await supabase
    .from('alternative_sources')
    .insert({
      title: input.title,
      content: input.content,
      source_type: input.source_type ?? null,
      source_author: input.source_author ?? null,
      url: input.url ?? null,
      notes: input.notes ?? null,
      char_count: charCount,
      estimated_tokens: estimatedTokens,
    })
    .select()
    .single();
  if (error) throw error;
  return data as AlternativeSource;
}

export async function deleteAlternativeSource(id: string): Promise<void> {
  const { error } = await supabase
    .from('alternative_sources')
    .delete()
    .eq('id', id);
  if (error) throw error;
}

// ── Script Strength (quality tagging, user-controlled) ──
export type ScriptStrength = 'strong' | 'useful' | 'limited' | null;

export async function updateAlternativeSourceStrength(id: string, strength: ScriptStrength): Promise<void> {
  const { error } = await supabase
    .from('alternative_sources')
    .update({ script_strength: strength })
    .eq('id', id);
  if (error) throw error;
}

export async function updateBriefTopicTranscriptStrength(id: string, strength: ScriptStrength): Promise<void> {
  const { error } = await supabase
    .from('brief_topic_transcripts')
    .update({ script_strength: strength })
    .eq('id', id);
  if (error) throw error;
}

export async function updateSourceFileStrength(id: string, strength: ScriptStrength): Promise<void> {
  const { error } = await supabase
    .from('source_files')
    .update({ script_strength: strength })
    .eq('id', id);
  if (error) throw error;
}

// ── Brief Links ──
export async function linkFormatReferencesToBrief(briefId: string, transcriptIds: string[]) {
  await supabase.from('brief_format_reference_links').delete().eq('brief_id', briefId);
  if (transcriptIds.length === 0) return;
  const { error } = await supabase.from('brief_format_reference_links').insert(
    transcriptIds.map(id => ({ brief_id: briefId, transcript_id: id }))
  );
  if (error) throw error;
}

export async function linkTopicTranscriptsToBrief(briefId: string, transcriptIds: string[]) {
  await supabase.from('brief_topic_transcript_links').delete().eq('brief_id', briefId);
  if (transcriptIds.length === 0) return;
  const { error } = await supabase.from('brief_topic_transcript_links').insert(
    transcriptIds.map(id => ({ brief_id: briefId, transcript_id: id }))
  );
  if (error) throw error;
}

export async function linkAlternativeSourcesToBrief(briefId: string, sourceIds: string[]) {
  await supabase.from('brief_alternative_source_links' as any).delete().eq('brief_id', briefId);
  if (sourceIds.length === 0) return;
  const { error } = await supabase.from('brief_alternative_source_links' as any).insert(
    sourceIds.map(id => ({ brief_id: briefId, alternative_source_id: id }))
  );
  if (error) throw error;
}

export async function getBriefAlternativeSourceLinks(briefId: string): Promise<AlternativeSource[]> {
  const { data, error } = await supabase
    .from('brief_alternative_source_links' as any)
    .select('alternative_source_id, alternative_sources(*)')
    .eq('brief_id', briefId);
  if (error) throw error;
  return (data || []).map((r: any) => r.alternative_sources).filter(Boolean) as AlternativeSource[];
}

export async function getBriefFormatReferences(briefId: string) {
  const { data, error } = await supabase
    .from('brief_format_reference_links')
    .select('transcript_id, format_reference_transcripts(*)')
    .eq('brief_id', briefId);
  if (error) throw error;
  return (data || []).map((r: any) => r.format_reference_transcripts).filter(Boolean);
}

export async function getBriefTopicTranscriptLinks(briefId: string) {
  const { data, error } = await supabase
    .from('brief_topic_transcript_links')
    .select('transcript_id, brief_topic_transcripts(*)')
    .eq('brief_id', briefId);
  if (error) throw error;
  return (data || []).map((r: any) => r.brief_topic_transcripts).filter(Boolean);
}

export async function updateBriefCreativeBriefFields(briefId: string, updates: {
  creative_brief_feedback?: string;
  creative_brief_approved?: boolean;
}) {
  const { error } = await supabase
    .from('topic_briefs')
    .update(updates)
    .eq('id', briefId);
  if (error) throw error;
}

export interface ReferenceHit {
  file_name: string;
  file_type: string;
  matched_query: string;
  excerpt: string;
}

// ── Evidence Points (structured rows per Evidence Table) ──
import type { EvidencePointDraft } from "./parseEvidenceTable";

export async function getEvidencePoints(briefId: string): Promise<EvidencePoint[]> {
  const { data, error } = await supabase
    .from("evidence_points")
    .select("*")
    .eq("brief_id", briefId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data || []) as EvidencePoint[];
}

export async function replaceEvidencePoints(
  briefId: string,
  drafts: EvidencePointDraft[],
): Promise<void> {
  await supabase.from("evidence_points").delete().eq("brief_id", briefId);
  if (drafts.length === 0) return;
  const rows = drafts.map((d) => ({
    brief_id: briefId,
    claim: d.claim,
    source_type: d.source_type,
    source_file: d.source_file,
    book_evidence: d.book_evidence,
    movie_evidence: d.movie_evidence,
    difference_note: d.difference_note,
    lexicon_support: d.lexicon_support,
    exact_quote: d.exact_quote,
    paraphrase: d.paraphrase,
    confidence: d.confidence,
    evidence_type: d.evidence_type,
    secondary_source_support: d.secondary_source_support,
    why_this_matters: d.why_this_matters,
    commentary_angle: d.commentary_angle,
  }));
  const { error } = await supabase.from("evidence_points").insert(rows);
  if (error) throw error;
}

export async function setEvidencePointApproval(
  id: string,
  status: "approved" | "rejected" | null,
  note?: string | null,
): Promise<void> {
  const payload: Record<string, any> = { approval_status: status };
  // Only persist the note when it's explicitly provided. Pass `null` to clear.
  if (typeof note !== "undefined") payload.approval_note = note;
  const { error } = await supabase
    .from("evidence_points")
    .update(payload)
    .eq("id", id);
  if (error) throw error;
}

