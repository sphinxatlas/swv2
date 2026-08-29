import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GUIDANCE_CHUNK_LIMIT = 100;

type PassType = "script_writing" | "anti_ai" | "melty_voice";

const NO_META_COMMENTARY_RULE = `\n\nNO META-COMMENTARY RULE (BINDING — HARD):
The script is viewer-facing copy. The viewer must NEVER see any reference to the script's own research process, evidence pipeline, or source availability. Specifically, you must NOT:
- Mention the evidence pack, Script Evidence Pack, source library, retrieval, transcripts, books-vs-films coverage gaps, or what sources were or were not available.
- Say anything like "I can't prove this part", "the transcript doesn't show", "evidence is limited here", "the books don't confirm", "we don't have a scene for this", or any equivalent acknowledgement of a gap in the source material.
- Reference the pipeline, the model, the system, instructions, or limitations of any kind.

If a beat lacks the evidence to make the comparison or claim it was meant to make, you have exactly three permitted moves: (1) work around the gap silently using whatever evidence IS available, (2) narrow the claim to what can actually be supported, or (3) omit the beat entirely and continue.

[FLAG: ...] markers and any other bracketed flags are INTERNAL ONLY and must NEVER appear in the script output. If the input script contains any [FLAG: ...] markers, remove them and silently rewrite the surrounding sentence so the gap is handled using one of the three moves above.`;
type PassScope = "full_script" | "passage";

const SCRIPT_WRITING_SYSTEM = `You are running a SCRIPT WRITING POLISH PASS on an existing finished YouTube script.

Your ONLY rewriting lens is the SCRIPT WRITING INSTRUCTIONS document provided below. Use them to evaluate and improve the script's structure, retention, and argument craft.

Focus areas (use the Script Writing Instructions to drive each):
- Opening hook strength
- Viewer click promise alignment
- Argument spine
- Section escalation
- Rehooks between sections
- Transitions into new arguments
- Evidence integration
- Emotional movement
- Final payoff
- Retention logic
- Whether each section creates forward motion

HARD RULES:
- Preserve the script's core topic, thesis, evidence, and factual claims.
- Keep the script as close as possible to the existing version where it already works.
- Only rewrite where the Script Writing Instructions reveal a structural, retention, hook, rehook, transition, evidence, or payoff weakness.
- Do NOT add unsupported claims. Do NOT invent evidence. Do NOT change canon meaning.
- Do NOT restart the script from scratch unless the current version is structurally broken.
- Do NOT primarily focus on anti-AI wording, sentence-level AI residue, host persona jokes, or generic style polish — that is a different pass.
- Preserve all editor tags (e.g. [BOOK: ...], [FILM: ...]) wherever the underlying content remains.
- Output the COMPLETE revised script only. No critique. No preamble. No change log.`;

const ANTI_AI_SYSTEM = `You are running a STRICT FINAL ANTI AI CLEANUP PASS on an existing finished YouTube script.

This is NOT a gentle wording polish. This is a strict residue-removal pass. If you finish and the script still contains banned structures, repeated "That's..." punchlines, polished essay transitions, or restated theses, you have FAILED the pass.

Your ONLY rewriting lens is the ANTI AI WRITING INSTRUCTIONS document provided below.

================================================================
HIDDEN INTERNAL WORKFLOW (do all of this silently before output)
================================================================
1. Read the script end-to-end once.
2. Silently scan for and mark every instance of:
   a) Banned contrast formulas (see list below) AND their softened cousins.
   b) Repeated "That's <noun phrase>." / "That's <pronoun> ..." punchline sentences.
   c) Repeated thesis restatements that do not clearly escalate.
   d) Generic essay transitions ("Moreover", "Furthermore", "In essence", "Ultimately", "At its core", "What's more", "And yet", "And so", "Here's the thing", "The truth is", "Make no mistake").
   e) Filler frames ("It's worth noting", "It's important to remember", "Let's be clear", "Let's talk about", "When you really think about it").
   f) Polished-but-empty lines, fake profundity, empty superlatives.
   g) Over-explained sentences where the point already landed in the previous sentence.
3. Rewrite each marked spot AND the immediately surrounding sentences as needed so the rewrite reads naturally.
4. PRESERVE strong human lines (vivid, specific, funny, sharply in the host persona's voice) untouched unless they violate a hard rule.
5. Run a SILENT FINAL CHECK: re-scan the revised script for any remaining banned structure or softened cousin or repeated "That's..." cluster. If any remain, rewrite them again. Repeat until clean.
6. Output ONLY the complete revised script.

================================================================
BANNED CONTRAST STRUCTURES — must be removed AND structurally reconstructed
================================================================
Direct forms:
- "It's not X, it's Y"
- "That's not X. That's Y."
- "This isn't X. This is Y."
- "Not because X, but because Y"
- "The problem isn't X. The problem is Y."
- "The real issue/tragedy/point/story isn't X. It's Y."
- "X, but really Y"

Softened cousins (ALSO BANNED — do not use these as escape hatches):
- "goes beyond just X"
- "not simply X"
- "more than just X"
- "on the surface X, underneath Y"
- "the deeper issue is ..."
- "the real story is ..."
- "what's actually happening is ..."
- "X, then, goes beyond ..."

Rule: Preserve the MEANING of any banned construction, but change the SENTENCE SHAPE completely. Do NOT swap one banned formula for another, and do NOT swap a direct form for its softened cousin. Rebuild the sentence around a concrete image, action, or moment instead of a rhetorical flip.

Example rewrites (style only — do not copy verbatim):

BAD: "The problem with the sequel goes beyond being slow. The film freezes its lead..."
GOOD: "The film leaves its lead frozen in the doorway, still trying to get a word out while the story moves on without him."

BAD: "That's the company's entire strategy in three seconds."
GOOD: "In three seconds, the CEO does something the company almost never lets anyone do: he admits the old plan failed, on camera, without a press release."

BAD: "That's it. That's the seed."
GOOD: "The seed is already there: the underdog is good at the champion's favorite thing, and she's already moving before he notices."

Formula: "The frustration isn't about X. It's about Y." — this pattern survives when the Y clause contains a specific concrete detail rather than an abstraction. Test: does Y name something specific? "It's about what fills the minutes she gets" — specific, keep the rewrite direction but ensure Y lands on a concrete image not a category.

Also: do not replace fan-coded setup phrases like "for one simple reason" or "here's the thing" with analytical equivalents like "the reason is specific." These are persona signal. Rewrite the formula shape but preserve the register.

================================================================
REPEATED "THAT'S..." PUNCHLINE RULE
================================================================
Across the whole script, allow AT MOST 1–2 "That's ..." / "That scene is ..." / "That line is ..." / "That's why ..." punchline sentences total, and only when each one is genuinely the strongest possible landing for that beat. Rewrite all others into sentences that lead with a concrete image, action, character beat, or specific observation.

================================================================
REPEATED THESIS RESTATEMENTS
================================================================
If the same thesis is restated more than twice and each restatement does not clearly escalate (sharper stakes, new angle, new evidence pressure), cut or rewrite the redundant ones. The script should move forward, not loop.

================================================================
HARD PRESERVATION RULES
================================================================
- Preserve facts, thesis, evidence, source meaning, claim strength (only weaken unsupported claims), section order, argument structure, canon interpretation, and intended payoff.
- Do NOT add new evidence, invent quotes/details, add new canon claims, or add unsupported jokes.
- Preserve EDITOR REFERENCES / editor tags exactly (e.g. [BOOK: ...], [FILM: ...]).
- PRESERVE STRONG HUMAN LINES. If a line is vivid, funny, specific, or personally voiced in the host persona's register, leave it alone. Do NOT corporate-flatten it. Example of what NOT to do:
    Original: "And I'm not mad at the player for missing the shot. I'm mad at the coach for drawing up a play that needed him to miss it."
    Bad revision: "My frustration here is with the coaching decision..."
  The original is stronger. Keep it.
- Do NOT make the script more polished, more neutral, or more essay-like. The goal is LESS AI, not MORE smooth.

SOURCE MATERIAL REFERENCE RULE (BINDING — must be removed if present):
The voiceover must never reference source material as a document or research artifact. Do not write phrases like:

- 'the transcript tags him with'
- 'the transcript says / marks / describes / has'
- 'the script notes / marks / has'
- 'the stage directions indicate'
- 'the source material says'
- 'the text tags this as'
- 'according to the transcript / script'
- Any phrasing that reveals the writer is reading from a file or document

Natural references are fine and encouraged: 'in the book,' 'in this scene,' 'in the source material,' 'in the film,' 'in the chapter.' The distinction is: describe what happens in the story or on screen, not what a document says about it. The viewer should never feel like they are watching someone present research notes.

================================================================
OUTPUT
================================================================
Return ONLY the complete revised script. No critique. No preamble. No notes. No change log. No markdown headings beyond what already exists in the script.`;

const PASSAGE_REWRITE_SYSTEM = `You are running a TARGETED PASSAGE REWRITE on a SHORT passage from a YouTube script (e.g. a hook, transition, paragraph, or section).

You have three binding guidance documents loaded below, but they are NOT equal. Use them in this STRICT HIERARCHY:

ORDER OF AUTHORITY (do not collapse these into one blended pass):

1. USER FEEDBACK — binding. If the user asks for a specific tone, length, edit, or fix, that overrides everything else short of inventing facts.

2. SCRIPT WRITING INSTRUCTIONS — the PRIMARY creative lens. Rewrite the passage first to improve:
   - argument clarity and the passage's purpose in the script
   - structure, transition into/out of the passage
   - evidence meaning and the "so what"
   - hook / payoff function of the passage
   - whether the passage actually moves the script forward

3. HOST PERSONA — the SECONDARY voice lens, applied on top of the Script Writing rewrite. The voice should be: sharp, book-aware, specific, opinionated, human, funny when it genuinely lands, and natural as spoken YouTube commentary. Do NOT over-personify. Do NOT inflate.

4. ANTI AI WRITING INSTRUCTIONS — applied LAST as a harsh, silent FINAL CLEANUP pass over the wording produced by steps 2 and 3. Anti AI is NOT the creative driver. It does NOT get to flatten the passage into bland neutral writing. Its only job is to scrub residue from the already-rewritten passage.

================================================================
FINAL ANTI AI CLEANUP PASS (silent, mandatory, last step before output)
================================================================
After producing the rewritten passage from steps 1–3, silently re-read it and remove any of the following before returning:
- Mechanical contrast formulas ("not X, but Y", "the problem is not X, it is Y", "it isn't X, it's Y", "that's not X. that's Y.", and softened cousins like "more than just X", "goes beyond X", "the real issue is...", "what's actually happening is...").
- Overwritten or poetic phrasing (e.g. "visible effect of", "eating her from the inside", metaphors that sound literary rather than spoken).
- Fake profundity / lines that sound like a model trying to sound clever.
- Dramatic inflation and performative heightening (e.g. "straight-up terror", "absolute nightmare", "completely shattered") when the user asked for a calmer or more grounded tone.
- Repetitive sentence shapes, triads, or overly neat rhythm.
- Generic YouTube phrasing ("here's the thing", "let's be real", "the truth is", "make no mistake").
- Restated points the previous sentence already made.

Rule: If any phrase in the rewritten passage sounds more dramatic, more polished, more generic, more formulaic, or more try-hard than the user's requested tone, simplify it. Rebuild the sentence around a concrete image, action, or specific observation instead of a rhetorical flourish.

================================================================
PRESERVE
================================================================
- The factual meaning of the pasted passage and the user's intended point.
- Existing canon claims and existing evidence (unless the user asks otherwise).
- Paragraph breaks where useful.
- Level of certainty (unless the user asks to strengthen or soften it).
- EDITOR REFERENCES / editor tags if present.

================================================================
DO NOT
================================================================
- Invent new canon evidence, new quotes, or unsupported facts.
- Expand into a whole new section unless the user asks.
- Reference unseen parts of the script.
- Add labels like "Revised Hook" or "Option 1".
- Add commentary, notes, diagnosis, markdown headings, preamble, or change log.
- Return multiple options unless the user asks.
- Swap one banned contrast formula for another — rewrite the structure entirely.
- Let the Anti AI pass strip out genuine host persona voice or specificity. It removes residue, not character.

OUTPUT RULES (STRICT):
- Return ONLY the revised passage text.
- No commentary, no notes, no labels, no markdown headings, no explanation, no preamble, no change log, no quotation wrappers.`;

const HOST_VOICE_PASS_PROCEDURE = `You are running a HOST VOICE PASS on a finished YouTube script. The host persona document loaded below is the ONLY source of voice, tone, humor style, signature lines, and register. You supply no voice of your own. The procedure below defines HOW the pass runs; the persona document defines WHAT the voice is.

================================================================
HARD PRESERVATION RULES (BINDING)
================================================================
- Do not change the script's arguments, evidence, claim strength, structure, factual claims, section order, or canon meaning.
- Preserve all editor tags (e.g. [BOOK: ...], [FILM: ...]) exactly.
- Do not invent new evidence.

================================================================
MANDATORY PROCEDURE — run every step, in this order
================================================================

1. HOOK AUDIT (mandatory, runs first): the opening must land with pressure, a specific tension, or a sharp claim in the persona's voice. If the hook is weak, rewrite it in the persona's voice. Log the original and the revised hook under "HOOK AUDIT LOG".

2. PERSONALITY BEAT QUOTA: take the total word count of the script, divide by 300, round down — that is the MINIMUM number of personality beats in the output. A beat is one of: a reactive interjection, a signature line from the persona document, a persona-coded aside specific to this script's argument, or a burst rhythm fragment used for impact. A beat only counts if it meets ALL of the following:
   (a) it is specific to this script's argument,
   (b) it adds information, sharpens a point, exposes a contradiction, or releases tension — emphasis filler does not count,
   (c) it sounds like the persona, not a host performing energy,
   (d) it does not instruct the viewer,
   (e) it does not undercut a serious emotional beat.
   Log every beat under "PERSONALITY BEAT LOG" with its location, type, and exact text. Do not output the script until the beat count meets the minimum.

3. PARENTHETICAL ASIDES (mandatory): embed reactive one-liners between dashes inside analytical or evidence sentences. Each aside must be shorter than the sentence containing it, and must add a reaction, not information. MINIMUM 3 per script. After the pass, count the asides logged under "PARENTHETICAL ASIDE LOG". If fewer than 3, add more before outputting.

4. ANALYTICAL RUN CHECK (mandatory): scan the full script for any run of four or more consecutive analytical sentences with no reaction, aside, or rhythm break. Every such run gets one beat inserted. Log each fix under "ANALYTICAL RUN LOG" with the first few words of the run.

5. BURST RHYTHM AUDIT (mandatory): in any 200-word stretch containing fewer than three sentences under eight words, add at least one short sentence for impact. Log each fix under "BURST RHYTHM LOG".

6. SIGNATURE TECHNIQUES (mandatory): the persona document may define named techniques (specific humor moves, register shifts, recurring devices). Apply EVERY technique the persona document defines at least once where the script's content gives a natural opening, following that document's own rules for when each technique is and is not allowed. Log each use under "SIGNATURE TECHNIQUE LOG", naming the technique and quoting the line. If a technique has no natural opening in this script, log it as skipped with a one-line reason.

7. NARRATOR VOICE AUDIT (mandatory): enforce the narrator voice rules defined in the persona document (e.g. first person rules, banned narrator constructions). Log every correction under "NARRATOR VOICE AUDIT LOG".

8. EDITING PHILOSOPHY: this is targeted insertion, not rewriting. Do not rewrite sections that already carry the persona's voice. Do not solve structural problems with personality. Do not make the script louder — make it sharper. If a beat cannot be added honestly, log the section under "RESISTED SECTIONS" with a one-line reason.

9. HANDOFF FLAGGING: if any wording was added that a later anti-AI cleanup might strip as generic (earned superlatives, deliberate caps emphasis, reactive fragments), list them under "EARNED USE LOG" so the cleanup pass preserves them.

================================================================
OUTPUT ORDER (STRICT)
================================================================
Output ALL logs first, in the order given above (HOOK AUDIT LOG, PERSONALITY BEAT LOG, PARENTHETICAL ASIDE LOG, ANALYTICAL RUN LOG, BURST RHYTHM LOG, SIGNATURE TECHNIQUE LOG, NARRATOR VOICE AUDIT LOG, RESISTED SECTIONS, EARNED USE LOG), then a line containing only ---, then the COMPLETE revised script.`;



async function loadGuidanceText(supabase: any, fileTypes: string[], channelId: string): Promise<{ text: string; chunks: number; truncated: boolean }> {
  const { data: files } = await supabase
    .from("source_files")
    .select("id")
    .in("file_type", fileTypes)
    .eq("channel_id", channelId)
    .is("brief_id", null);
  if (!files || files.length === 0) return { text: "", chunks: 0, truncated: false };

  const { data: chunkRows, count } = await supabase
    .from("file_chunks")
    .select("content", { count: "exact" })
    .in("file_id", files.map((f: any) => f.id))
    .order("chunk_index")
    .limit(GUIDANCE_CHUNK_LIMIT);

  const text = (chunkRows || []).map((c: any) => c.content).join("\n\n");
  const truncated = typeof count === "number" ? count > GUIDANCE_CHUNK_LIMIT : false;
  return { text, chunks: (chunkRows || []).length, truncated };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "LOVABLE_API_KEY not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const passType: PassType =
      body.passType === "anti_ai" ? "anti_ai" :
      body.passType === "melty_voice" ? "melty_voice" :
      "script_writing";
    const rawScriptText: string = (body.scriptText || "").toString();
    // Anti-AI Cleanup must operate on the script body only. If a pass appends an
    // internal log after a `---` separator, strip it only when the trailing block
    // contains an unambiguous log-table header.
    const stripTrailingLog = (text: string): string => {
      const lines = text.split(/\r?\n/);
      const sepRe = /^\s*-{3,}\s*$/;
      for (let i = 0; i < lines.length; i++) {
        if (sepRe.test(lines[i])) {
          const trailingLines = lines.slice(i + 1);
          const hasUnambiguousLogTable = trailingLines.some((line) => {
            const normalized = line.trim().toLowerCase().replace(/\s+/g, " ");
            return normalized.includes("| location | beat type |") || normalized.includes("| beat # |") || normalized.includes("| location | original | revised |");
          });

          if (hasUnambiguousLogTable) {
            return lines.slice(0, i).join("\n").replace(/\s+$/, "");
          }
        }
      }
      return text;
    };
    const scriptText: string =
      body.passType === "anti_ai" ? stripTrailingLog(rawScriptText) : rawScriptText;
    const scope: PassScope = body.scope === "passage" ? "passage" : "full_script";
    const userFeedback: string = (body.userFeedback || "").toString().trim();

    const briefId: string = (body.briefId || "").toString();
    if (!briefId) {
      return new Response(JSON.stringify({ error: "briefId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const minLen = scope === "passage" ? 10 : 50;
    if (!scriptText || scriptText.trim().length < minLen) {
      const minMsg = scope === "passage"
        ? "Passage is too short. Paste at least a sentence or two."
        : "Script text is too short. Generate or paste a full script first.";
      return new Response(JSON.stringify({ error: minMsg }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: briefRow } = await supabase
      .from("topic_briefs")
      .select("channel_id")
      .eq("id", briefId)
      .single();
    if (!briefRow?.channel_id) {
      return new Response(JSON.stringify({ error: "Brief not found" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const channelId: string = briefRow.channel_id;

    let systemPrompt: string;
    let userPrompt: string;

    if (scope === "passage") {
      // Passage Rewrite: load ALL THREE guidance documents.
      const [scriptWriting, antiAi, hostPersona] = await Promise.all([
        loadGuidanceText(supabase, ["instructions", "script_strategy"], channelId),
        loadGuidanceText(supabase, ["anti_ai_guide"], channelId),
        loadGuidanceText(supabase, ["host_persona"], channelId),
      ]);

      const missing: string[] = [];
      if (!scriptWriting.text || scriptWriting.text.trim().length < 20) missing.push("Script Writing Instructions");
      if (!antiAi.text || antiAi.text.trim().length < 20) missing.push("Anti AI Writing Instructions");
      if (!hostPersona.text || hostPersona.text.trim().length < 20) missing.push("Host Persona");
      if (missing.length > 0) {
        return new Response(
          JSON.stringify({
            error: `Passage Rewrite requires these documents in your Source Library: ${missing.join(", ")}.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      for (const [label, g] of [
        ["Script Writing Instructions", scriptWriting],
        ["Anti AI Writing Instructions", antiAi],
        ["Host Persona", hostPersona],
      ] as const) {
        if (g.truncated) {
          console.warn(`WARNING: Guidance document '${label}' truncated at ${GUIDANCE_CHUNK_LIMIT} chunks.`);
        }
      }

      console.log("[polish-pass]", JSON.stringify({
        scope: "passage",
        scriptWritingChunks: scriptWriting.chunks,
        antiAiChunks: antiAi.chunks,
        hostPersonaChunks: hostPersona.chunks,
        passageChars: scriptText.length,
        hasFeedback: userFeedback.length > 0,
      }));

      systemPrompt =
        PASSAGE_REWRITE_SYSTEM +
        `\n\n## SCRIPT WRITING INSTRUCTIONS (PRIMARY — drives the rewrite)\n\n${scriptWriting.text}` +
        `\n\n## HOST PERSONA (SECONDARY — voice on top of the rewrite)\n\n${hostPersona.text}` +
        `\n\n## ANTI AI WRITING INSTRUCTIONS (FINAL CLEANUP — applied last to scrub residue, NOT the creative driver)\n\n${antiAi.text}`;

      userPrompt = `Rewrite the following passage using the strict hierarchy above: user feedback first, then Script Writing Instructions, then host persona voice, then a final silent Anti AI cleanup pass over the result. Return ONLY the revised passage text — no commentary, labels, headings, or explanations.

${userFeedback ? `## USER FEEDBACK\n${userFeedback}\n\n` : ""}## PASSAGE
${scriptText}`;
    } else if (passType === "melty_voice") {
      // Host Voice Pass (API passType "melty_voice" for compatibility).
      // The persona document is the ONLY voice authority; the procedure
      // above (HOST_VOICE_PASS_PROCEDURE) defines the mechanics in code.
      const hostPersona = await loadGuidanceText(supabase, ["host_persona"], channelId);

      if (!hostPersona.text || hostPersona.text.trim().length < 20) {
        return new Response(
          JSON.stringify({
            error: "Host Voice Pass requires a Host Persona document in your Source Library.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (hostPersona.truncated) {
        console.warn(`WARNING: Guidance document 'Host Persona' truncated at ${GUIDANCE_CHUNK_LIMIT} chunks.`);
      }

      console.log("[polish-pass]", JSON.stringify({
        passType: "melty_voice",
        scope: "full_script",
        hostPersonaChunks: hostPersona.chunks,
        hostPersonaTruncated: hostPersona.truncated,
        scriptChars: scriptText.length,
      }));

      systemPrompt =
        HOST_VOICE_PASS_PROCEDURE +
        `\n\n## HOST PERSONA DOCUMENT (voice authority for this pass)\n\n${hostPersona.text}` +
        (hostPersona.truncated ? `\n\n[Note: Host Persona document was truncated to the first ${GUIDANCE_CHUNK_LIMIT} chunks.]` : "") +
        NO_META_COMMENTARY_RULE;

      userPrompt = `Run the HOST VOICE PASS on the following script, following the procedure above literally (including every mandatory audit, quota, and required log, in the output order specified).

## CURRENT SCRIPT
${scriptText}`;
    } else {
      // Full-script polish pass for anti_ai or script_writing — single-doc lens.
      const docFileTypes =
        passType === "anti_ai" ? ["anti_ai_guide"] :
        ["instructions", "script_strategy"];
      const docLabel =
        passType === "anti_ai" ? "Anti AI Writing Instructions" :
        "Script Writing Instructions";

      const guidance = await loadGuidanceText(supabase, docFileTypes, channelId);

      if (!guidance.text || guidance.text.trim().length < 20) {
        return new Response(
          JSON.stringify({
            error: `${docLabel} document not found in your Source Library. Upload it before running this pass.`,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (guidance.truncated) {
        console.warn(`WARNING: Guidance document '${docLabel}' truncated at ${GUIDANCE_CHUNK_LIMIT} chunks.`);
      }

      console.log("[polish-pass]", JSON.stringify({
        passType,
        scope: "full_script",
        docLabel,
        docFileTypes,
        guidanceChunks: guidance.chunks,
        guidanceTruncated: guidance.truncated,
        scriptChars: scriptText.length,
      }));

      const baseSystem =
        passType === "anti_ai" ? ANTI_AI_SYSTEM :
        SCRIPT_WRITING_SYSTEM;

      systemPrompt =
        baseSystem +
        `\n\n## ${docLabel.toUpperCase()} (BINDING — primary lens for this pass)\n\n${guidance.text}` +
        (guidance.truncated ? `\n\n[Note: ${docLabel} document was truncated to the first ${GUIDANCE_CHUNK_LIMIT} chunks.]` : "") +
        (passType === "anti_ai" ? NO_META_COMMENTARY_RULE : "");

      userPrompt = `Run a ${docLabel} polish pass on the following script.

Return the COMPLETE revised script only. Do not include any commentary, summary, or change log. Preserve everything that already works; only rewrite what the ${docLabel} require.

## CURRENT SCRIPT
${scriptText}`;
    }

    const callGateway = () =>
      fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          stream: true,
        }),
      });

    // Retry transient 5xx (e.g. upstream 502) up to 3 times with backoff.
    let aiResponse = await callGateway();
    for (let attempt = 1; attempt <= 3 && aiResponse.status >= 500 && aiResponse.status !== 501; attempt++) {
      try { await aiResponse.body?.cancel(); } catch (_) {}
      const delayMs = 1500 * attempt;
      console.warn(`[polish-pass] AI gateway ${aiResponse.status}, retry ${attempt} in ${delayMs}ms`);
      await new Promise((r) => setTimeout(r, delayMs));
      aiResponse = await callGateway();
    }

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limits exceeded, please try again later." }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "Payment required — please add credits to your Lovable AI workspace." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const t = await aiResponse.text();
      console.error("AI gateway error:", aiResponse.status, t);
      // Return 200 with fallback signal so the UI can show a friendly retry
      // message instead of a blank screen on transient upstream failures.
      return new Response(
        JSON.stringify({
          error: "AI gateway temporarily unavailable. Please try again in ~30 seconds.",
          fallback: true,
          upstream_status: aiResponse.status,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(aiResponse.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("polish-pass error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
