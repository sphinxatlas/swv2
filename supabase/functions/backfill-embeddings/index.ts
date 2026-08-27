import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BATCH_SIZE = 100;
const TIME_BUDGET_MS = 100_000; // stay under edge-function timeout
// text-embedding-3-small caps inputs at 8192 tokens (~32k chars). We truncate
// at 30,000 chars to leave headroom and avoid 400 errors that crash a batch.
const MAX_INPUT_CHARS = 30_000;
const truncateForEmbedding = (s: string) =>
  s.length > MAX_INPUT_CHARS ? s.slice(0, MAX_INPUT_CHARS) : s;

async function embedTexts(texts: string[], apiKey: string): Promise<number[][]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
  });
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return (data.data as any[]).map((d) => d.embedding as number[]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const startedAt = Date.now();
    let processed = 0;
    let batches = 0;

    while (Date.now() - startedAt < TIME_BUDGET_MS) {
      const { data: rows, error } = await supabase
        .from("file_chunks")
        .select("id, content, file_id, chunk_index")
        .is("embedding", null)
        .limit(BATCH_SIZE);
      if (error) throw error;
      if (!rows || rows.length === 0) break;

      const vecs = await embedTexts(
        rows.map((r: any) => truncateForEmbedding(r.content)),
        apiKey,
      );

      // Batch update via upsert on PK — single round-trip per batch.
      // We include the NOT-NULL columns so the row passes PostgREST validation;
      // since the id already exists, the conflict path runs and only embedding
      // is effectively changed.
      const payload = rows.map((r: any, i: number) => ({
        id: r.id,
        file_id: r.file_id,
        content: r.content,
        chunk_index: r.chunk_index,
        embedding: `[${vecs[i].join(",")}]`,
      }));
      const { error: upErr } = await supabase
        .from("file_chunks")
        .upsert(payload, { onConflict: "id" });
      if (upErr) throw upErr;

      processed += rows.length;
      batches++;
      console.log(`[backfill] batch ${batches}: +${rows.length} (total ${processed}) elapsed ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    }

    // Count remaining for caller polling
    const { count: remaining } = await supabase
      .from("file_chunks")
      .select("id", { count: "exact", head: true })
      .is("embedding", null);

    return new Response(
      JSON.stringify({
        success: true,
        processed,
        batches,
        remaining: remaining ?? 0,
        elapsed_s: Number(((Date.now() - startedAt) / 1000).toFixed(1)),
        done: (remaining ?? 0) === 0,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("backfill-embeddings error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});