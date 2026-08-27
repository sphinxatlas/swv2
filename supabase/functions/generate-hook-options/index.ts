import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BodySchema = z.object({
  briefId: z.string().min(1),
  hookFeedback: z.string().max(4000).optional(),
  // Refine mode: when provided, return ONE refined hook based on the existing
  // hook + per-hook feedback, instead of three fresh hook options.
  refineFromHook: z
    .object({
      hook_label: z.string().max(500),
      hook_text: z.string().max(8000),
      angle_route: z.string().max(100).optional(),
    })
    .optional(),
});

// TODO: extract shared guidance loader (currently duplicated from generate-step/index.ts)
const GUIDANCE_CHUNK_LIMIT = 100;
type LayerMeta = {
  text: string;
  sourceUsed: string;
  chunksRead: number;
  totalChunks: number;
  truncated: boolean;
};

async function loadLayer(
  supabase: any,
  fileTypes: string[],
  label: string,
): Promise<LayerMeta> {
  const { data: files } = await supabase
    .from("source_files")
    .select("id, file_type")
    .in("file_type", fileTypes);
  const empty: LayerMeta = { text: "", sourceUsed: "none", chunksRead: 0, totalChunks: 0, truncated: false };
  if (!files || files.length === 0) return empty;
  const ids = files.map((f: any) => f.id);
  const { count: totalChunks } = await supabase
    .from("file_chunks")
    .select("id", { count: "exact", head: true })
    .in("file_id", ids);
  const { data: chunks } = await supabase
    .from("file_chunks")
    .select("content")
    .in("file_id", ids)
    .order("chunk_index")
    .limit(GUIDANCE_CHUNK_LIMIT);
  const read = chunks?.length ?? 0;
  const total = totalChunks ?? read;
  let sourceUsed = label;
  if (fileTypes.includes("instructions") || fileTypes.includes("script_strategy")) {
    const hasNew = files.some((f: any) => f.file_type === "instructions");
    const hasLegacy = files.some((f: any) => f.file_type === "script_strategy");
    sourceUsed = hasNew ? "instructions" : hasLegacy ? "script_strategy" : "none";
  }
  return {
    text: (chunks || []).map((c: any) => c.content).join("\n\n"),
    sourceUsed,
    chunksRead: read,
    totalChunks: total,
    truncated: total > read,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const parsed = BodySchema.safeParse(await req.json());
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid request body", details: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { briefId, hookFeedback, refineFromHook } = parsed.data;
    const isRefine = !!refineFromHook;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch Creative Brief and Script Evidence Pack from pipeline_outputs.
    let cb: { content: string } | undefined;
    let sep: { content: string } | undefined;
    {
      const { data: outputs, error: outErr } = await supabase
        .from("pipeline_outputs")
        .select("step_type, content")
        .eq("brief_id", briefId)
        .in("step_type", ["creative_brief", "script_evidence_pack"]);
      if (outErr) throw outErr;
      cb = (outputs || []).find((o: any) => o.step_type === "creative_brief");
      sep = (outputs || []).find((o: any) => o.step_type === "script_evidence_pack");
    }

    if (!sep || !sep.content) {
      return new Response(
        JSON.stringify({
          error:
            "Script Evidence Pack required. Please generate the Script Evidence Pack before generating Hook Options.",
        }),
        { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!cb || !cb.content) {
      return new Response(
        JSON.stringify({
          error:
            "Creative Brief required. Please generate and approve the Creative Brief before generating Hook Options.",
        }),
        { status: 412, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Load guidance docs
    const [scriptInstructions, antiAi, hostPersona] = await Promise.all([
      loadLayer(supabase, ["instructions", "script_strategy"], "instructions"),
      loadLayer(supabase, ["anti_ai_guide"], "anti_ai_guide"),
      loadLayer(supabase, ["host_persona"], "host_persona"),
    ]);

    const guidanceBlock = [
      hostPersona.text ? `## HOST PERSONA (binding — voice, humor, rhythm, attitude)\n${hostPersona.text}` : "",
      antiAi.text ? `## ANTI AI WRITING INSTRUCTIONS (binding, harsh)\n${antiAi.text}` : "",
      scriptInstructions.text
        ? `## SCRIPT WRITING INSTRUCTIONS (binding — includes hook rules)\n${scriptInstructions.text}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const HOOK_VOICE_INSTRUCTION = `The hooks you generate must sound like they were written by the specific host described in the Host Persona document. Apply all voice, humor, rhythm, and anti-AI rules from the Anti-AI document and all hook rules from the Script Writing Instructions.

Specifically:

Do not open with a warm-up, a rhetorical question, a generic scene-setting sentence, or any of the banned opening patterns from the Anti-AI document.

Do not use banned vocabulary from the Anti-AI document.

Do not use contrast formulas from the Anti-AI document.

Open with pressure, contradiction, consequence, or a specific tension the viewer already recognizes.

Confirm the title promise immediately.

Create an open loop — the viewer should understand the tension without being given the full answer.

Sound like the specific host persona described in the Host Persona document: sharp, fan-coded, emotionally present, occasionally petty, never a neutral explainer.

Each hook must feel like it could only have been written for this specific video about this specific topic, not reused for any other Harry Potter video.`;

    const AUDIENCE_REACH_RULE = `AUDIENCE REACH RULE — mandatory for every hook:

TITLE PROMISE OVERRIDE: The universal tension MUST be the same tension the title promises. The first two sentences of every hook must make the viewer feel the title claim is being confirmed and tested. A hook that opens on a tension unrelated to the title, or that delays the title promise past the second sentence, is invalid. If the universal-tension framing conflicts with immediate title confirmation, title confirmation wins.

The hook must work for two audiences simultaneously:

Harry Potter fans who know the books and canon

Casual viewers or non-fans who have seen the films or have general awareness of Harry Potter

This means the hook cannot open on HP-specific context that requires prior investment. It must open on a universal tension first, then make it specific with HP evidence.

HOW TO FIND THE UNIVERSAL TENSION FOR ANY SCRIPT:

Before writing the hook, identify what kind of video this is and what universal human experience it connects to. Then open on that experience.

If the script is about a character being misrepresented or diminished: Universal tension: someone who fought to become a specific kind of person, and a version of that story that erases the fight Entry point: the gap between who they are and how they get shown

If the script is about an adaptation failing a source: Universal tension: something you loved that turned out to be doing something wrong without you noticing Entry point: the specific moment where the failure is most visible and most felt

If the script is about worldbuilding or lore: Universal tension: something that felt endless and real, and the specific thing that made it start feeling smaller Entry point: the feeling of the world shrinking, not the lore mechanics themselves

If the script is about fandom psychology or nostalgia: Universal tension: loving something that belongs to a specific moment in time that can't be recreated Entry point: what that moment felt like and why it can't be manufactured

If the script is about a character debate or moral argument: Universal tension: someone who is easy to dismiss and genuinely difficult to defend, and why that difficulty is the whole point Entry point: the specific thing that makes them impossible to resolve cleanly

If the script is about a casting, remake, or franchise decision: Universal tension: something built for a specific audience at a specific moment being handed to a studio that needs to monetize it Entry point: what the original had that the replacement structurally cannot replicate

For any other script type, ask: what would someone feel in the first ten seconds of this video if they had never heard of Harry Potter? Build the hook from that feeling, then bring in the HP specifics to prove it.

WRONG ORDER — HP-specific first: "In Chamber of Secrets, Ginny Weasley gets possessed by Voldemort through Tom Riddle's diary..."

RIGHT ORDER — universal tension first, HP proof second: "There's a version of Ginny Weasley in the Harry Potter films who exists mainly to be available when Harry's ready for her. Quiet. Convenient. Orbiting the main character like that's her job. The books spent six years building someone completely different."

Test every hook: would someone who has only seen the films and doesn't deeply care about HP still feel a tension worth resolving in the first two sentences? If not, rewrite the opening until they would.`;

    const HOOK_STRUCTURE_AND_EXAMPLES = `HOOK STRUCTURE — what makes a hook work:

A strong hook does three things in order:

Stakes a specific claim or reveals a specific contradiction in the first one to two sentences. The viewer should immediately want to either agree or push back. Not a question — a statement with a point of view.

Provides the specific proof or detail that makes the claim credible. One concrete piece of evidence, a scene, a quote, a moment. Enough to show the claim is real, not enough to resolve it.

Opens a loop that makes the resolution feel necessary. The viewer understands what is at stake and needs to know how it lands.

WORKED EXAMPLES — voice and structure calibration:

Example 1 — plot hole hook: 'There's a plot hole in Harry Potter so huge it should have broken the entire series. In Prisoner of Azkaban, Fred and George Weasley use a map that tracks every single person inside Hogwarts. For years, they never notice that their little brother Ron is sharing a dorm room with a man named Peter Pettigrew. It sounds unbelievable. And before you rush to the comments with "well, they just weren't looking at Ron" — that excuse falls apart the second you look at what the Marauder's Map is actually capable of.'

Example 2 — character reframe hook: 'If Book Ginny Weasley sat down to watch the Harry Potter movies, she wouldn't just roll her eyes at the shoelace scene. She'd be furious. Because what the films do is trap her inside the version of herself she spent years clawing her way out of. The books make her arc about finding her voice. The movies make her quieter, more convenient, always orbiting Harry. They give her the silent treatment and call it a love story.'

What both examples share:

First sentence makes a strong specific claim. Not 'there is something interesting about X.' A real stake.

Second sentence provides the specific proof immediately. No setup, no context dump.

The hook ends on a tension, not a summary. The viewer knows something is wrong and needs to know how wrong.

Short sentences hit hard. Rhythm varies. No filler.

The claim is controversial enough that someone could disagree — that's what makes people watch.

CLAIM STRENGTH TEST: Read the first sentence of your hook. Ask: would a casual viewer either nod and think 'yes exactly' or shake their head and think 'wait that's not right'? If the answer is neither — if they would just think 'okay, interesting' — the claim is not strong enough. Make it stronger or find a different entry point.

Do not open with context. Do not open with a question. Do not open with 'there is something about X worth discussing.' Open with the claim.`;

    const HARD_STOP_CONTRAST_CHECK = `HARD STOP — CONTRAST FORMULA CHECK:

Before outputting any hook, scan every sentence for the following patterns and rewrite any that match:

'That's not just X. It's Y.'

'This isn't just X. It's Y.'

'Not X, but Y.'

'Not with X, but with Y.'

'They didn't just X. They Y.'

'It's not X. It's Y.'

'That's not X. That's Y.'

'X, not Y.'

These are banned. If a sentence uses any of these constructions, rewrite it before outputting. Start the rewrite from the concrete consequence or the active verb — not from the negation.

Example: Banned: 'She earns his trust, not with a crush, but with a scar.' Rewrite: 'She earns his trust by being the one person who knows what possession actually feels like.'

Banned: 'That cut isn't just a time-saver. It's the key that unlocks why Movie Ginny feels wrong.' Rewrite: 'That cut removes the only scene that explains why Harry would ever see Ginny as an equal.'

Do not output a hook that contains any banned pattern. Check every sentence. Rewrite before outputting.`;

    // Guidance documents + voice instruction must precede the taxonomy and
    // output format instructions in the system prompt.
    const guidanceHeader = [
      guidanceBlock,
      `## HOOK VOICE & STYLE (binding)\n${HOOK_VOICE_INSTRUCTION}`,
      `## AUDIENCE REACH (binding)\n${AUDIENCE_REACH_RULE}`,
      `## HOOK STRUCTURE & WORKED EXAMPLES (binding)\n${HOOK_STRUCTURE_AND_EXAMPLES}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const systemPrompt = isRefine
      ? `${guidanceHeader}

You are REFINING ONE existing opening HOOK for a long-form YouTube Harry Potter commentary script written in the Melty voice.

SOURCE PRIORITY (BINDING):
- The Script Evidence Pack is the CONTROLLING input. The refined hook must be grounded in what the Pack actually contains.
- The Creative Brief is DIRECTIONAL ONLY: title promise, high-level thesis direction, tone, and intended emotional payoff.
- If the Creative Brief and the Script Evidence Pack conflict, FOLLOW THE SCRIPT EVIDENCE PACK.
- Do NOT treat the Creative Brief as evidence.

REFINE MODE (BINDING):
- You are returning EXACTLY ONE refined version of the provided hook via the structured tool call.
- Preserve the hook's existing ROUTE (scene contradiction, character wound, fan debate, or canon irony) unless the user feedback explicitly asks to change route.
- Preserve the strongest specific images, names, and concrete moments from the original hook unless the feedback asks to swap them.
- Apply the user's feedback precisely. Do not rewrite parts the feedback does not address.
- This is a focused edit, not a fresh generation. The output should still feel recognizably like the same hook, only sharper.

The hook should READ like the first 20–40 seconds of a spoken YouTube script — not a summary, not a description, not a teaser blurb. Spoken voiceover only. The hook MUST create a clear OPEN LOOP into the rest of the argument.

SCRIPT WRITING INSTRUCTIONS (binding) govern: hook strength, title promise, opening pressure, open loop, curiosity, and retention. Apply them.

ANTI AI RULES (binding, harsh — do NOT weaken):
- No generic YouTube intros.
- No "have you ever wondered."
- No "in this video / today we're talking about / let's dive in."
- No "not X but Y" / "it's not X, it's Y" / mechanical contrast formulas.
- No three-sentence symmetry stacks (no triads).
- No fake profundity, no greeting-card philosophy.
- No templated signposting.
- No citations, no editor tags, no source references inside hook text.

MELTY PERSONA: voice, rhythm, judgment, specificity. The hook should sound like Melty already mid-thought, not like a host introducing himself.

Return exactly one hook record with: hook_label, hook_text, angle_route, why_it_works, open_loop, risk_or_weakness.

============================================================
${HARD_STOP_CONTRAST_CHECK}
============================================================`
      : `${guidanceHeader}

You are generating three opening HOOK OPTIONS for a long-form YouTube Harry Potter commentary script written in the Melty voice.

SOURCE PRIORITY (BINDING):
- The Script Evidence Pack is the CONTROLLING input. Hooks must be grounded in what the Pack actually contains.
- The Creative Brief is DIRECTIONAL ONLY: title promise, high-level thesis direction, tone, and intended emotional payoff.
- If the Creative Brief and the Script Evidence Pack conflict, FOLLOW THE SCRIPT EVIDENCE PACK.
- Do NOT treat the Creative Brief as evidence.
- Do NOT use raw Evidence Table, raw Beat Plan, Selected Source Analysis, Six Category Extraction, or raw source formatting. They are not provided here, and you must not invent them.

GENERATION INSTRUCTION (BINDING):
Read the Creative Brief and Script Evidence Pack carefully. Identify the three sharpest, most specific tensions, contradictions, or revelations available in this exact material. For each one, write a hook that opens on that specific tension — not on a category of tension, but on the actual detail, scene, quote, or gap that makes this video worth watching.

Each hook must:

Open with a specific detail, moment, character action, or canon fact from the evidence — not a general statement about the topic

Create an open loop in the first two sentences — the viewer understands something is wrong or unresolved before you explain what

Sound like it was written by the specific host persona in the Host Persona document

Apply all Anti-AI rules — no banned opening patterns, no contrast formulas, no generic scene-setting

Feel like it could only exist for this specific script, not any other Harry Potter video

After generating each hook, tag it with the closest matching route label from the taxonomy below as METADATA ONLY. The route label describes what you made; it does not prescribe what to make. Do NOT start from a route and reverse-engineer a hook to fit it.

Route taxonomy (metadata tags only):
- scene contradiction (a moment in canon that breaks the surface reading)
- character wound (the unhealed emotional pressure driving a character)
- fan debate (a known disagreement among fans, framed honestly)
- canon irony (a setup/payoff irony hidden in the text)


Generate three hooks that are genuinely different from each other — different evidence entry points, different emotional registers, different open loops. Do not generate three versions of the same approach. Route labels MAY repeat across the three hooks if the underlying tensions are genuinely distinct, but the hooks themselves must not be variations of one idea.

Each hook should READ like the first 20–40 seconds of a spoken YouTube script — not a summary, not a description, not a teaser blurb. Spoken voiceover only. Each hook MUST create a clear OPEN LOOP into the rest of the argument.

SCRIPT WRITING INSTRUCTIONS (binding) govern: hook strength, title promise, opening pressure, open loop, curiosity, and retention. Apply them.

ANTI AI RULES (binding, harsh — do NOT weaken):
- No generic YouTube intros.
- No "have you ever wondered."
- No "in this video / today we're talking about / let's dive in."
- No "not X but Y" / "it's not X, it's Y" / mechanical contrast formulas.
- No three-sentence symmetry stacks (no triads).
- No fake profundity, no greeting-card philosophy.
- No templated signposting.
- No citations, no editor tags, no source references inside hook text.

MELTY PERSONA: voice, rhythm, judgment, specificity. The hook should sound like Melty already mid-thought, not like a host introducing himself.

If user feedback is provided, honor it (e.g. "darker", "more canon-led", "less jokey", "more fan-debate driven") without breaking any of the binding rules above.

Each hook record must include:
- hook_label: short human label (e.g. "Snape's last look")
- hook_text: the spoken hook itself (~20–40 seconds of voiceover, paragraph form)
- angle_route: one of [scene contradiction, character wound, fan debate, canon irony]
- why_it_works: one or two sentences on why this route opens the argument cleanly
- open_loop: the explicit unresolved question or tension this hook leaves dangling
- risk_or_weakness: one honest sentence on where this route could fail or feel weak

============================================================
${HARD_STOP_CONTRAST_CHECK}
============================================================`;

    const userMessage = isRefine
      ? `## Creative Brief (DIRECTIONAL ONLY — title promise, thesis direction, tone, intended emotional payoff)
${cb.content}

## Script Evidence Pack (CONTROLLING SOURCE — refined hook must be grounded here)
${sep.content}

## Existing Hook to Refine
**Label:** ${refineFromHook!.hook_label}
${refineFromHook!.angle_route ? `**Route:** ${refineFromHook!.angle_route}\n` : ""}**Hook text:**
${refineFromHook!.hook_text}

## User Refinement Feedback (binding — apply precisely)
${(hookFeedback || "").trim() || "(no specific feedback — tighten the hook, sharpen specificity, remove any AI residue, preserve the route and core image)"}

Return exactly ONE refined hook via the tool call. Preserve the route. Preserve the strongest specific images. Apply the feedback. Spoken voiceover only.`
      : `## Creative Brief (DIRECTIONAL ONLY — title promise, thesis direction, tone, intended emotional payoff)
${cb.content}

## Script Evidence Pack (CONTROLLING SOURCE — hooks must be grounded here)
${sep.content}

${hookFeedback && hookFeedback.trim() ? `## User Hook Feedback (honor this)\n${hookFeedback.trim()}\n\n` : ""}Now produce exactly three hook options via the tool call. Start from the sharpest tensions in this specific Pack — not from the route taxonomy. Each hook must open on a specific detail/scene/quote/gap from the evidence. Three genuinely different entry points, emotional registers, and open loops. Tag each with the closest route label as metadata only. No generic YouTube intro tropes. No triads. No "have you ever wondered." No "in this video." No "not X but Y." Spoken voiceover only.`;

    const hookItemSchema = {
      type: "object",
      properties: {
        hook_label: { type: "string" },
        hook_text: { type: "string" },
        angle_route: {
          type: "string",
          enum: [
            "scene contradiction",
            "character wound",
            "fan debate",
            "canon irony",
          ],
        },
        why_it_works: { type: "string" },
        open_loop: { type: "string" },
        risk_or_weakness: { type: "string" },
      },
      required: [
        "hook_label",
        "hook_text",
        "angle_route",
        "why_it_works",
        "open_loop",
        "risk_or_weakness",
      ],
      additionalProperties: false,
    };

    const tool = isRefine
      ? {
          type: "function",
          function: {
            name: "return_refined_hook",
            description: "Return exactly one refined hook.",
            parameters: {
              type: "object",
              properties: { hook: hookItemSchema },
              required: ["hook"],
              additionalProperties: false,
            },
          },
        }
      : {
      type: "function",
      function: {
        name: "return_hook_options",
        description: "Return exactly three distinct hook options.",
        parameters: {
          type: "object",
          properties: {
            hooks: {
              type: "array",
              minItems: 3,
              maxItems: 3,
              items: hookItemSchema,
            },
          },
          required: ["hooks"],
          additionalProperties: false,
        },
      },
    };

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        tools: [tool],
        tool_choice: {
          type: "function",
          function: { name: isRefine ? "return_refined_hook" : "return_hook_options" },
        },
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (response.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const toolCall = data?.choices?.[0]?.message?.tool_calls?.[0];
    const argsStr = toolCall?.function?.arguments;
    if (!argsStr) {
      console.error("No tool call in response:", JSON.stringify(data).slice(0, 500));
      return new Response(
        JSON.stringify({ error: "Hook options model returned no structured output. Please regenerate." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let parsed2: any;
    try {
      parsed2 = JSON.parse(argsStr);
    } catch (e) {
      console.error("Tool args JSON parse failed:", e, argsStr.slice(0, 500));
      return new Response(
        JSON.stringify({ error: "Hook options JSON parse failed. Please regenerate." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (isRefine) {
      const hook = parsed2?.hook;
      if (!hook || typeof hook !== "object") {
        return new Response(
          JSON.stringify({ error: "Refined hook model returned no hook. Please retry." }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ hook }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const hooks = Array.isArray(parsed2?.hooks) ? parsed2.hooks.slice(0, 3) : [];
    if (hooks.length !== 3) {
      return new Response(
        JSON.stringify({ error: "Hook options model did not return three options. Please regenerate." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ hooks }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("generate-hook-options error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});