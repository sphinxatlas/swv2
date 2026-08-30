import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf";


const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 1500;
const CHUNK_OVERLAP = 200;
// Hard ceiling per chunk. Even an unparagraphed wall of text must be split
// to stay below this length (prevents the 34k-char HPB6 anomaly recurring).
const MAX_CHUNK_CHARS = 2000;
// text-embedding-3-small caps inputs at 8192 tokens (~32k chars). Chunks are
// normally ~1500 chars so this rarely triggers, but we truncate defensively
// to prevent a single oversized chunk from failing an entire upload batch.
const MAX_EMBED_INPUT_CHARS = 30_000;

// OpenAI embeddings — keep optional so file processing still succeeds if the
// key is missing. The Pipeline Test vector toggle simply won't see embeddings
// for files processed without a key.
async function embedTexts(texts: string[]): Promise<(string | null)[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) {
    console.warn("[process-file] OPENAI_API_KEY missing — skipping embeddings");
    return texts.map(() => null);
  }
  const safeTexts = texts.map((t) =>
    t.length > MAX_EMBED_INPUT_CHARS ? t.slice(0, MAX_EMBED_INPUT_CHARS) : t,
  );
  try {
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: safeTexts }),
    });
    if (!resp.ok) {
      console.error("[process-file] OpenAI embedding error:", resp.status, await resp.text());
      return texts.map(() => null);
    }
    const data = await resp.json();
    return (data.data as any[]).map((d) => `[${(d.embedding as number[]).join(",")}]`);
  } catch (e) {
    console.error("[process-file] embedding fetch failed:", e);
    return texts.map(() => null);
  }
}

function chunkText(text: string): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = "";

  // Pre-split any oversized paragraphs on sentence/word boundaries so a
  // single mega-paragraph can never produce a chunk above MAX_CHUNK_CHARS.
  const splitOversized = (para: string): string[] => {
    if (para.length <= MAX_CHUNK_CHARS) return [para];
    const out: string[] = [];
    // Try sentence boundaries first.
    const sentences = para.split(/(?<=[.!?])\s+/);
    let buf = "";
    for (const s of sentences) {
      if (s.length > MAX_CHUNK_CHARS) {
        // Sentence itself too long — hard slice on word boundaries.
        if (buf) { out.push(buf); buf = ""; }
        for (let i = 0; i < s.length; i += MAX_CHUNK_CHARS) {
          out.push(s.slice(i, i + MAX_CHUNK_CHARS));
        }
        continue;
      }
      if (buf.length + s.length + 1 > MAX_CHUNK_CHARS) {
        out.push(buf);
        buf = s;
      } else {
        buf = buf ? buf + " " + s : s;
      }
    }
    if (buf) out.push(buf);
    return out;
  };

  const expandedParas: string[] = [];
  for (const para of paragraphs) {
    expandedParas.push(...splitOversized(para));
  }

  for (const para of expandedParas) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    if (currentChunk.length + trimmed.length > CHUNK_SIZE && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      // Keep overlap from end of previous chunk
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(CHUNK_OVERLAP / 5));
      currentChunk = overlapWords.join(" ") + "\n\n" + trimmed;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  // Final defensive pass: hard-slice any chunk that still exceeds the ceiling.
  const final: string[] = [];
  for (const c of chunks) {
    if (c.length <= MAX_CHUNK_CHARS) { final.push(c); continue; }
    for (let i = 0; i < c.length; i += MAX_CHUNK_CHARS) {
      final.push(c.slice(i, i + MAX_CHUNK_CHARS));
    }
  }
  return final;
}

// PDF extractor output has no reliable paragraph structure — rebuild it so
// chunkText's blank-line splitting works. Only applied to PDFs.
function normalizePdfText(raw: string): string {
  return raw
    .replace(/\f/g, "")
    // de-hyphenate across line breaks
    .replace(/-\n(?=[a-z])/g, "")
    // protect real paragraph breaks
    .replace(/\n{2,}/g, "\u0000")
    // single newlines inside a paragraph become spaces
    .replace(/\n/g, " ")
    .replace(/\u0000/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { fileId } = await req.json();
    if (!fileId) throw new Error("fileId is required");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get file info
    const { data: file, error: fileError } = await supabase
      .from("source_files")
      .select("*")
      .eq("id", fileId)
      .single();

    if (fileError || !file) throw new Error("File not found");

    // Update status
    await supabase.from("source_files").update({ status: "processing" }).eq("id", fileId);

    // Download file from storage
    const { data: fileData, error: downloadError } = await supabase.storage
      .from("source-files")
      .download(file.storage_path);

    if (downloadError || !fileData) throw new Error("Failed to download file");

    const buffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const isPdf =
      bytes.length >= 5 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
      bytes[3] === 0x46 && bytes[4] === 0x2d; // "%PDF-"

    let text: string;
    let pageCount = 0;

    if (isPdf) {
      try {
        const pdf = await getDocumentProxy(bytes);
        const result = await extractText(pdf, { mergePages: true });
        pageCount = result.totalPages ?? 0;
        text = normalizePdfText(
          Array.isArray(result.text) ? result.text.join("\n\n") : String(result.text ?? ""),
        );
      } catch (e) {
        const message = `PDF extraction failed: ${e instanceof Error ? e.message : String(e)}`;
        console.error("[process-file]", message);
        await supabase
          .from("source_files")
          .update({ status: "failed", processing_error: message })
          .eq("id", fileId);
        return new Response(
          JSON.stringify({ success: false, error: message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const avgPerPage = pageCount > 0 ? text.length / pageCount : text.length;
      if (text.length < 500 || avgPerPage < 100) {
        const message =
          `This PDF produced almost no extractable text (${text.length} characters across ${pageCount} page(s)). ` +
          `It is most likely a scanned or image-only document and requires OCR before it can be indexed.`;
        await supabase
          .from("source_files")
          .update({ status: "failed", processing_error: message })
          .eq("id", fileId);
        return new Response(
          JSON.stringify({ success: false, error: message }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    } else {
      text = new TextDecoder("utf-8").decode(bytes);
    }

    const chunks = chunkText(text);


    // Delete old chunks
    await supabase.from("file_chunks").delete().eq("file_id", fileId);

    // Insert new chunks in batches
    const batchSize = 50;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const slice = chunks.slice(i, i + batchSize);
      const embeddings = await embedTexts(slice);
      const batch = slice.map((content, idx) => ({
        file_id: fileId,
        content,
        chunk_index: i + idx,
        embedding: embeddings[idx],
      }));

      const { error: insertError } = await supabase.from("file_chunks").insert(batch);
      if (insertError) throw new Error(`Failed to insert chunks: ${insertError.message}`);
    }

    // Update status
    const charCount = text.length;
    const estimatedTokens = Math.max(1, Math.round(charCount / 4));
    await supabase
      .from("source_files")
      .update({
        status: "indexed",
        char_count: charCount,
        estimated_tokens: estimatedTokens,
        processing_error: null,
        extraction_method: isPdf ? "pdf" : "text",
        page_count: isPdf ? pageCount : null,

      })
      .eq("id", fileId);

    return new Response(
      JSON.stringify({ success: true, chunksCreated: chunks.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("process-file error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
