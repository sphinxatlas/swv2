import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ─── HYBRID VECTOR SEARCH (standard retrieval path) ──────────────────────
// Embeds query strings via OpenAI text-embedding-3-small (1536d) for use with
// the match_chunks(vector, source_type, k) RPC. Returns null entries when the
// API key is missing or the call fails — callers must fall back gracefully.
async function embedQueriesBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey || texts.length === 0) {
    return texts.map(() => null);
  }
  try {
    const resp = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "text-embedding-3-small", input: texts }),
    });
    if (!resp.ok) {
      console.error("[generate-step] OpenAI embeddings error:", resp.status, await resp.text());
      return texts.map(() => null);
    }
    const data = await resp.json();
    return (data.data as any[]).map((d) => d.embedding as number[]);
  } catch (e) {
    console.error("[generate-step] embedding fetch failed:", e);
    return texts.map(() => null);
  }
}

const RRF_K = 60;

const applyChannelPlaceholders = (text: string, channel: any): string => {
  const workedExamples = (channel.worked_examples && typeof channel.worked_examples === "object") ? channel.worked_examples : {};
  const hierarchyProse = (channel.source_hierarchy && typeof channel.source_hierarchy.prose === "string") ? channel.source_hierarchy.prose : "";
  let out = text.split("{{SUBJECT_LABEL}}").join(channel.subject_label || "the channel subject");
  out = out.split("{{SOURCE_HIERARCHY_PROSE}}").join(hierarchyProse);
  out = out.replace(/\{\{WORKED_EXAMPLE:([a-z_]+)\}\}/g, (_m, key) => {
    const entry = workedExamples[key];
    return entry && typeof entry.body === "string" ? entry.body : "";
  });
  return out.replace(/\n{3,}/g, "\n\n");
};

function getModelForStep(stepType: string) {
  if (
    [
      "creative_brief",
      "six_category_extraction",
      "selected_source_analysis",
      "angle_check",
      "evidence_table",
      "outline",
      "script_evidence_pack",
      "full_script",
    ].includes(stepType)
  ) {
    return "openai/gpt-5.2";
  }
  return "google/gemini-2.5-flash";
}

const SOURCE_HIERARCHY_INSTRUCTION = `
IMPORTANT SOURCE HIERARCHY RULES:

TIER 1 — PRIMARY CANON EVIDENCE:
- Books = PRIMARY source (highest priority)
- Movie Transcripts = PRIMARY source (highest priority)
- Used for factual claims about story events, characterization, and exact quotes
- Used for book vs film comparisons
- ONLY these can be treated as primary evidence

TIER 2 — SECONDARY CANON SUPPORT:
- Lexicon = SECONDARY reference only (lower priority)
- Never overrides books or movie transcripts

TIER 2 — UNIVERSAL RULE FOR ALL SECONDARY SOURCES (applies to every tier below):
No secondary source — at any tier — is ever named, quoted verbatim, or paraphrased closely in the final script output. The writer absorbs the information and writes in their own voice. Source names like "MediaRetrospective", "Bretts Thoughts", a specific blogger, or a Reddit thread MUST NEVER appear in the script body. The tier governs RELIABILITY of claims (how confidently the writer can make a claim), not VISIBILITY of sources (which is always zero).

Universal anti-copy rules:
- Never reproduce a secondary source's sentence structure or distinctive phrasings
- Never copy a recurring metaphor, image, or framing verbatim — rephrase entirely
- A claim drawn from secondary material should read as the writer's own informed observation

TIER 2.5 — USER-VETTED HIGH-QUALITY SECONDARY SOURCES (tagged [STRONG]):
The user has manually marked these sources as trustworthy. Treat their content as high-grade research the writer has already done.

CAN do:
- Inform factual claims, interpretive framings, audience-signal awareness, and recurring fandom observations
- Be used as supporting evidence for claims when Tier 1 canon does not cover the specific detail
- Provide the confirmation needed to promote a [USEFUL] or [LIMITED] observation into a usable claim
- Shape the writer's confident voice on a topic, even where canon is thin

CANNOT do:
- Override Tier 1 canon when Tier 1 evidence exists
- Supply Micro-Quotes attributed to primary Source Files (books or film transcripts) — that rule remains absolute
- Be named, quoted, or paraphrased closely in the script

TIER 2.6 — USEFUL SECONDARY SOURCES (tagged [USEFUL] or [UNSET]):
Default tier. The user has either marked them as Useful or hasn't tagged them yet. Treat [UNSET] identically to [USEFUL].

CAN do:
- Inform interpretation, framing, and audience-signal awareness
- Shape the angle, identify overused framings to avoid, identify objections worth handling
- Be used as supporting context when reinforced by a [STRONG] source OR by Tier 1 canon
- Contribute to the writer's general understanding of the topic

CANNOT do:
- Be cited as standalone factual evidence for claims not also backed by [STRONG] sources or canon
- Be named, quoted, or paraphrased closely

TIER 2.7 — LIMITED SECONDARY SOURCES (tagged [LIMITED]):
The user has flagged these as low-quality but still wants them read for inspiration. Common examples: Reddit comments, YouTube comments, low-effort blog posts.

CAN do:
- Inform direction, mood, what the fandom is reacting to, recurring grievances
- Identify common reactions and complaints that shape angle choices
- Be promoted into supportable claims IF a [STRONG] source OR Tier 1 canon supports the same claim

CANNOT do:
- Be cited as standalone evidence
- Be named, quoted, or paraphrased closely
- Influence factual claims that are NOT also supported by [STRONG] sources or Tier 1 canon

If you find a great point in a [LIMITED] source, you have three options:
1. Find Tier 1 canon to back it up — then it becomes a canon-supported claim
2. Find a [STRONG] source to back it up — then it becomes a [STRONG]-backed claim usable in the writer's voice
3. Drop it

Promotion path: a [LIMITED] observation backed by a [STRONG] source carries [STRONG]-tier confidence in the final output, and is written in the writer's voice without naming either source.

TIER 3 — TIER ROUTING FOR ALL SECONDARY SOURCES:
Every secondary source (Commentary Transcripts, Brief Topic Transcripts, Alternative Sources) appears in the prompt context with a quality tag in square brackets. The tag determines which subtier (2.5 / 2.6 / 2.7) applies.

Reliability hierarchy for backing a claim:
- Tier 1 canon (books + film transcripts) — strongest backing
- [STRONG] secondary — can supplement canon, can stand in where canon is missing
- [USEFUL] / [UNSET] — can support framing; needs [STRONG] or canon to back specific claims
- [LIMITED] — inspiration only; needs [STRONG] or canon to back any specific claim

Failure mode: a [STRONG] source treated identically to a [LIMITED] source means the tagging system is being ignored. Differentiate.

TIER 4 — WRITING GUIDANCE ONLY (never evidence, never canon):
- Script Instructions & Strategy = output behavior, writing constraints, hook quality, pacing, rehooks, argument structure, retention
- Used only for tone, structure, hook, pacing, writing behavior
- Never used as canon evidence

CRITICAL RULES:
- Commentary Transcripts must NEVER be cited as canon evidence or used to prove {{SUBJECT_LABEL}} facts
- No competitor wording reuse — do NOT copy commentary transcript wording, structure, or phrasing
- Script Instructions must NEVER be cited as canon evidence
- They are layers that improve HOW the script is written, not WHAT it claims

{{SOURCE_HIERARCHY_PROSE}}

QUOTE DISCIPLINE (CRITICAL):
- "exact quote" = verbatim text from the source, in quotation marks, with source cited
- "paraphrase" = reworded version of what the source says, labeled as paraphrase
- "summary" = condensed account of a passage or scene
- "interpretation" = analytical statement based on evidence
- NEVER present a paraphrase as an exact quote
- ALWAYS label which type each piece of evidence is

When citing evidence:
- Clearly label whether evidence comes from a book, movie transcript, or Lexicon
- If Lexicon is used, label it as "secondary support"
- Never present Lexicon text as primary canon
- Never use Lexicon as a substitute for direct quotes from books or films
- If a major claim relies mainly on Lexicon, flag it as needing primary confirmation
`;

const COMPARISON_MODE_INSTRUCTION = `
COMPARISON MODE ACTIVE:
This script compares book and film versions. Do not force a paired book/movie structure sentence by sentence. Lead with the strongest argument. However: every major book claim must have a corresponding film observation somewhere in the same section — what the film does instead, what it omits, or what it changes. A section that builds a book case for 400+ words without any film contrast has failed. The contrast does not need to be immediate, but it must land before the section closes. Where film evidence is missing, narrow the claim or use available film evidence from other moments. Never tell the viewer that film evidence is missing.
`;

// ── BINDING WRITING / VOICE / THEORY INSTRUCTION BLOCKS ──
// These wrap guidance documents (Host Persona, Script Instructions, Anti AI Guide)
// and re-frame commentary + topic transcripts as theory/angle inputs rather than canon.

const TOPIC_TRANSCRIPTS_FRAMING_INSTRUCTION = `
BRIEF SPECIFIC TOPIC TRANSCRIPTS — THEORY, ANGLE, AND RESEARCH LEADS:
These are topic relevant commentary, theory, or transcript materials about {{SUBJECT_LABEL}} selected for this brief.
Use them to identify possible theories, conspiracy style arguments, interpretive angles, fandom questions, contradictions worth exploring, unusual readings of characters/scenes/adaptation choices, and argument structures that could make the video more compelling.
They are NOT Tier 1 canon and must NOT be treated as direct proof of canon events.
However, they do not need to be strictly confirmed by primary canon in every case, because some are theories, speculative arguments, or interpretive claims.

Rules:
- If a point is presented as a canon fact, it MUST be supported by Tier 1 book or movie transcript evidence.
- If a point is a theory, interpretation, conspiracy, or speculative reading, it may be used if it makes logical sense and does not ignore obvious canon.
- The script must clearly frame theories as theories, interpretations, possibilities, or readings.
- Do not present topic transcript ideas as proven canon unless Tier 1 evidence supports them.
- Do not let topic transcripts override clear book or movie evidence.
- If a theory conflicts with canon, acknowledge the tension instead of hiding it.
- Use these transcripts to make the script sharper, more interesting, and more fan aware — not to replace original analysis.
`;

const COMMENTARY_TRANSCRIPTS_FRAMING_INSTRUCTION = `
COMMENTARY TRANSCRIPTS — INTERPRETIVE AND THEORY INPUT:
These materials may contain analysis, theories, speculation, fandom interpretation, or competitor framing. They are NOT canon evidence.
Use them to discover interesting angles, framings, and argument patterns.

- For factual canon claims, verify with Tier 1 books or movie transcripts.
- For theories and interpretive angles, do NOT require direct canon confirmation. Instead, check that the idea is plausible, logically coherent, interesting, and not obviously contradicted by primary canon.
- Never present commentary material as proven canon unless Tier 1 evidence supports it.
- Never copy commentary wording, structure, or phrasing into the script.
`;

const VIDEO_RETENTION_STRUCTURE_INSTRUCTION = `
VIDEO RETENTION & ESCALATION LAYER (BINDING — applies to Creative Brief, Outline, and Full Script):

This script must feel like a strong YouTube video, not a research essay. Build it around viewer retention, escalation, and payoff. The following structure is mandatory:

A. VIEWER CLICK QUESTION
- Identify the exact question, curiosity, or emotional promise that made the viewer click the title.
- Every major section must move the viewer closer to the answer of that question.
- Never drift into general explanation that does not serve the click question.

B. TITLE PROMISE
- Keep the title promise alive throughout the video.
- The hook must surface the promise. The body must build on it. The conclusion must deliver on it.
- Do not let the script wander into adjacent topics that dilute the title.

C. CASUAL VIEWER CONTEXT
- Before building any argument that depends on a specific {{SUBJECT_LABEL}} concept, person, object, or rule, briefly explain it in 1–2 clear sentences for casual viewers.
- Example: if the argument depends on the Marauder's Map, explain what the Map is and what it does before analyzing it.
- Do not assume only hardcore fans are watching. Hardcore fans will tolerate a brief refresher; casual viewers will not tolerate confusion.

D. ESCALATION LADDER (NO CIRCULAR ARGUMENTATION)
Each section must add a NEW layer. The script must not loop back to the same point in different words. Use this ladder:
- Hook: state the tension or bold claim that frames the click question.
- Context: explain the casual-viewer pieces clearly.
- Section 1: establish the surface-level problem.
- Section 2: reveal why the problem is deeper than fans think.
- Section 3: test the strongest counterarguments or fan theories.
- Final section: deliver the real climax — the verdict, twist, or unexpected conclusion.
If a planned section only restates an earlier section, it must be cut or replaced.

E. SECTION RE-HOOKS
- Every section must end with a SPECIFIC reason to keep watching.
- Do NOT use lazy placeholders like "By the end, you'll understand why" or "Stick around to find out".
- Re-hooks must tease the next concrete reveal.
- Example: "But that excuse collapses the second Snape gets involved."
- Example: "And this is where the Map stops being a cute magical object and starts becoming a threat to the entire plot."

F. EMOTIONAL ARC
- The video must move through a progression of feeling. It cannot stay flat.
- Typical progression: curiosity → amusement → suspicion → tension → realization → payoff.
- Each section should sit at a different emotional temperature than the one before it.

G. CLIMAX AND PAYOFF
- The final third of the script must contain the STRONGEST argument, not a recap of earlier points.
- The climax must make the viewer feel that the video has finally answered the title.
- The conclusion must land a clear verdict, not a polite summary.

H. ANTI-REPETITION RULE
- Do not restate the same argument in different words across sections.
- Every section must EITHER reveal new information, complicate the previous point, or move the viewer closer to the final answer.
- "We already said this" is a structural failure.

I. SOURCE INTEGRATION RULE
- Sources support the story and argument. They do not interrupt the pacing.
- Citations live in editor tags. Voiceover lives in human, escalating spoken sentences.
`;

const STEP_PROMPTS: Record<string, string> = {
  evidence_table: `You are a research assistant curating the strongest evidence for a YouTube script about {{SUBJECT_LABEL}}.
Given the topic brief, retrieval results, and source material excerpts, create a CURATED EVIDENCE TABLE.

${SOURCE_HIERARCHY_INSTRUCTION}

${TOPIC_TRANSCRIPTS_FRAMING_INSTRUCTION}

${COMMENTARY_TRANSCRIPTS_FRAMING_INSTRUCTION}

EVIDENCE CATEGORIZATION (CRITICAL — DO NOT FLATTEN):
The Evidence Table must clearly separate four kinds of points. Group them under labeled subsections in this order:

1. CANON SUPPORTED CLAIMS — require Tier 1 book or movie transcript support. Confidence: High/Medium based on source clarity.
2. ADAPTATION CONTRASTS — book vs movie differences. Use book and movie transcript evidence where possible.
3. INTERPRETIVE / THEORY ANGLES — do NOT require direct canon confirmation. Check that the theory is plausible, interesting, logically coherent, and not obviously contradicted by canon. Clearly label as theory / interpretation / speculative angle. Note what canon detail, scene, omission, contradiction, or pattern makes the theory worth considering.
4. SPECULATION / CONSPIRACY STYLE IDEAS — fan-aware, speculative readings. Label clearly as speculation. Must still be grounded in some canon detail or pattern, even if interpretive.

Do not remove interesting theory based material just because it cannot be fully proven.
Do not present theories as facts.
The goal is compelling, defensible {{SUBJECT_LABEL}} video argumentation, not only academic confirmation.

EVIDENCE QUALITY RULES (CRITICAL):
1. QUALITY OVER QUANTITY: Select the 10-15 STRONGEST evidence points. Do NOT pad with weak or tangential evidence.
2. PREFER COMPARISON POINTS: Where possible, each evidence point should include BOTH book evidence AND movie evidence with a clear contrast. Do not make the table mostly book-only unless no movie counterpart exists.
3. STRONGEST FIRST: Rank evidence points by: (a) relevance to the thesis, (b) clarity of the quote, (c) usefulness for a YouTube argument, (d) strength of contrast between book and movie.
4. DEPRIORITIZE WEAK EVIDENCE: Exclude points that are only loosely related to the target trait. If the brief is about anger, do not include mild discomfort or general stress unless it is highly revealing. Match the claim intensity to what the source actually says.
5. CLAIM DISCIPLINE: The claim must precisely match the evidence. Do not overstate grief as anger, discomfort as volatility, or tension as defiance unless the source strongly supports that wording.
6. LEXICON STRICTNESS: Only include Lexicon support if it adds genuinely useful context. Do not include weak Lexicon entries just to fill a field.
7. The table should feel like a curated shortlist of the best arguments for the video, not a broad evidence dump.

PARAPHRASE-FIRST DISCIPLINE (CRITICAL):
- Default to PARAPHRASED evidence in every row. Paraphrase is the standard output.
- Exact quotes are OPTIONAL and must be under 12 words each. Only include a micro-quote when the exact wording is essential to the argument.
- Do NOT paste long excerpts or multi-sentence quotes. If the source passage is longer than 12 words, paraphrase it.
- Every evidence point MUST cite its source file name.
- No long excerpts anywhere in the table.

MICRO-QUOTE PROVENANCE RULE (CRITICAL):
A Micro-Quote is a verbatim string. It must appear word-for-word in the retrieved chunks of the Source File listed for that evidence point. If the phrase appears only in upstream pipeline steps (Brief, SSA), in secondary sources, or in your own paraphrase, it is NOT a valid Micro-Quote — leave the field empty and set Evidence Type to "paraphrase" or "interpretation."

A book Micro-Quote must come from a book chunk; a movie Micro-Quote must come from a movie transcript chunk.

FACT VALIDATION VS QUOTATION — these are different operations:
- Secondary sources (Lexicon, commentary transcripts, fan wikis) CAN validate that a scene, event, or visual fact exists in canon. Use them freely in Book Evidence, Movie Evidence, Contrast, and Paraphrase fields when they support the underlying claim.
- Secondary sources CANNOT supply a Micro-Quote attributed to a primary Source File. The Micro-Quote field is reserved for verbatim strings from the primary source's retrieved chunks only.

Example — death scene:
- VALID: "Voldemort's body dissolves into ash" as paraphrase in Movie Evidence, supported by Lexicon entry on the final duel. Micro-Quote field empty. Evidence Type: paraphrase.
- INVALID: "slowly crumbles into ash" in the Micro-Quote field tagged to the DH2 transcript file, when that exact string is not in the retrieved DH2 chunks.

SECONDARY SOURCE ESCALATION RULE (CRITICAL):
When an evidence point is assigned Confidence: Medium or Low because primary canon retrieval does not fully support the claim, do NOT leave the secondary fields empty. Run the following escalation before finalising the evidence point:
1. Check topic transcripts (commentary creators, fan analysis) for any reference to the same scene, moment, or claim.
2. Check the Lexicon for a canonical entry covering the same claim.
3. Check secondary source blocks in the retrieved material for corroborating references.

If secondary sources contain supporting evidence, populate the **Secondary Source Support** field for that evidence point with the source name(s) + what they confirm, in plain prose. Example: "MediaRetrospective confirms Voldemort prowls and rips Death Eater masks in the GOF graveyard film scene. Bretts Thoughts corroborates. Neither provides transcript timecode."

Then update the Commentary Angle field to state explicitly:
- What the secondary sources confirm
- What still requires primary canon verification before the claim can be scripted as fact
- Whether the secondary evidence is strong enough to use the claim as a qualified assertion ("according to commentary" / "widely noted by fans" / "per the Lexicon") rather than dropping it

If no secondary source supports the claim either, write in Secondary Source Support: "No secondary source corroboration found. Recommend dropping or heavily qualifying this claim in the Beat Plan."

WHAT SECONDARY SOURCES CAN AND CANNOT DO:
Secondary sources CAN:
- Confirm that a scene, moment, or visual beat exists in canon
- Provide audience-level description of what happens on screen
- Validate that a claim is widely accepted in fandom
- Supply a qualified assertion ("the scene is widely described as…")
- Unlock a Medium-confidence claim for scripting as a fan-verified observation rather than a primary-quoted fact

Secondary sources CANNOT:
- Supply a Micro-Quote attributed to a primary Source File
- Upgrade a claim to High confidence
- Replace primary retrieval for claims that will be quoted verbatim
- Confirm exact wording, blocking details, or timecodes

The **Confidence** field reflects PRIMARY source status only and does not change based on secondary corroboration. The **Secondary Source Support** field is additive — it tells the user what they have to work with beyond the primary retrieval gap.

Create the evidence table in this EXACT markdown format for each evidence point:

### Evidence Point [number]
| Field | Value |
|-------|-------|
| **Claim** | [The precise claim — must match what the evidence actually shows] |
| **Source Type** | Book / Movie Transcript / Both |
| **Source File** | [Exact filename(s)] |
| **Book Evidence** | [Paraphrased evidence from book, if any — leave blank if none] |
| **Movie Evidence** | [Paraphrased evidence from movie transcript, if any — leave blank if none] |
| **Contrast** | [What differs between book and movie, if both present] |
| **Lexicon Support** | [Only if genuinely useful — mark as SECONDARY] |
| **Secondary Source Support** | [REQUIRED when Confidence is Medium or Low — name the secondary source(s) + what they confirm in plain prose. If none corroborates, write: "No secondary source corroboration found. Recommend dropping or heavily qualifying this claim in the Beat Plan." Leave blank only when Confidence is High.] |
| **Micro-Quote** | [Optional: verbatim quote UNDER 12 words, in quotation marks — leave blank if not essential] |
| **Paraphrase** | [Paraphrased version of the evidence — REQUIRED for every point] |
| **Why This Matters** | [Why this is a strong argument point for the video] |
| **Confidence** | High / Medium / Low |
| **Evidence Type** | paraphrase / exact quote (under 12 words) / summary / interpretation |
| **Commentary Angle** | [If inspired by commentary transcript — needs canon confirmation] |

Rules:
- Aim for 10-15 evidence points, curated for strength and relevance
- Majority should include both book AND movie evidence where possible
- Every evidence point must have a source trace (which file it came from)
- Never invent quotes
- Never blur exact quote vs paraphrase
- Paraphrase is the DEFAULT — exact quotes are the exception, not the rule
- If Lexicon is the only source, set Confidence to Low and note it needs primary confirmation
- If a point is only weakly related to the thesis, exclude it entirely
- Commentary Transcripts CANNOT be used as primary evidence — only as angle inspiration
- If an angle was inspired by a commentary transcript, it must be confirmed against books or movie transcripts before inclusion`,

  // NOTE: The Beat Plan step uses the internal key 'outline' to avoid schema
  // changes. User-facing label is "Beat Plan" (see src/lib/api.ts).
  outline: `WRITING CONSTITUTION FOR BEAT PLAN

Two documents govern this output:
1. Script Writing Instructions (loaded under SCRIPT_WRAPPER below)
2. Anti-AI Writing Instructions (loaded under ANTI_AI_WRAPPER below)

These are not background reference material. They are the planning constitution for every beat you produce. Read both in full before writing.

The Script Writing Instructions govern argument structure, escalation, evidence discipline, and the Hook to Event to Payoff logic. Every beat must follow that structure.

The Anti-AI Writing Instructions govern phrasing. Even planning prose must not contain banned constructions. If banned patterns appear in the Beat Plan, they will bleed into the Full Script.

The inline rules and format instructions below are summaries of those documents. If anything below conflicts with the documents, the documents win.

Note: Host Persona does not govern this step. The Beat Plan is neutral functional prose. Voice is added at the Full Script step.

ANGLE CHECK PRECEDENCE (BINDING): If an Angle Check output appears in the previous pipeline context, its Binding Contention REPLACES the Creative Brief's Working Thesis and Hypothesized Surprising Answer as the contention this video argues. The Contention line at the top of the Beat Plan must state the Binding Contention. The Angle Check's "Consequences For The Beat Plan" are structural requirements. The Creative Brief remains directional for tone, title promise, and emotional arc only.

BEAT PLAN

Produce an internal beat plan for this video. The beat plan is a planning document, not a script. The Full Script step reads it and writes spoken prose from it. The beat plan is shown to the user for argument review before any script is written.

Start with two labeled lines before any beats:

Contention: [one sentence stating what this video argues, reveals, or reframes]
Surface expectation: [one sentence stating what the viewer probably assumes when they click]

Then write 8 to 14 numbered beats.

FORMAT RULES

Each beat is one paragraph of plain prose. No bullet points inside a beat. Each beat covers exactly one unit of viewer understanding: by the end of reading it, the viewer's understanding should have moved one step.

Each beat paragraph must cover, in natural prose order:
1. What argument move happens in this beat
2. The canon point or evidence that anchors it (book chapter, film scene, specific moment)
3. What the viewer understands or feels at the end of the beat
4. How this beat sets up the next beat

{{WORKED_EXAMPLE:outline}}

ABSOLUTELY FORBIDDEN in the beat plan output
- Markdown headings of any level (#, ##, ###)
- Section labels (Hook, Introduction, Section 1, Outro, Conclusion)
- The labels 'Section purpose:', 'New information revealed:', 'Word budget:', 'Emotional beat:', 'Visual opportunity:'
- Editor or source tags ([BOOK:], [FILM:], [LEXICON:])
- Time codes
- Bullet points inside a beat paragraph
- Numbered sub-points inside a beat paragraph

ARGUMENT REQUIREMENTS
- Each beat must escalate from the previous one. No two beats may make the same argument move in different words. If two beats make the same point, merge them.
- The final beat must reframe the opening tension and give the viewer a new lens on the Contention stated at the top.
- The hook beat (Beat 1) must confirm the title promise and open a curiosity loop without giving away the full answer.
- Every beat must change the viewer's understanding. A beat that only adds information without shifting understanding is weak and must be strengthened or cut.
- When Selected Source Analysis appears in previous context, use its Audience Objections, Recurring Fan Signals, and Underdeveloped Opportunities to shape rehooks, escalation rungs, and at least one beat that pre-empts a likely fan objection. Do not treat secondary-source claims as canon proof.

BEAT PLAN PRE-WRITE PROTOCOL

This protocol is mandatory. You must produce the audit as visible output before the beat plan, then remove the audit block from your final output. The audit is not optional and not internal. Producing the beat plan without producing the audit first is a failure of this step.

OUTPUT ORDER:

1. First, output a \`<beat_plan_audit>\` block containing all six audit sections below.

2. Then output the beat plan.

3. Then re-read your \`<beat_plan_audit>\` block. If any section reveals a structural problem (duplicated function, contrast monoculture, topic-assigned beat, weak rehook, missing escalation), restructure the beat plan and rewrite the audit.

4. Finally, remove the \`<beat_plan_audit>\` block from your output. Submit only the beat plan.

AUDIT SECTIONS (all required):

SECTION 1 — FUNCTION DIFF

For each beat, write its function in this exact sentence form:

"Beat N reveals that [X]."

Then for each consecutive pair (1→2, 2→3, 3→4, ... N-1→N), check if the two sentences could be swapped without changing the meaning of the script. If yes, the beats are functionally duplicate. Merge or cut. Two beats sharing a topic is allowed; two beats sharing a function is not.

Example of failure: "Beat 2 reveals that book Voldemort uses stillness as power" and "Beat 4 reveals that book Voldemort treats power as effortless." These are paraphrases. Merge.

Example of pass: "Beat 5 reveals that book Voldemort dominates by controlling other people's bodies" and "Beat 6 reveals that book Voldemort runs entire rooms through ideology and micro-control." Different function (one-on-one vs. group), different mechanism.

SECTION 2 — ESCALATION CHAIN

For each beat 2..N, write one sentence answering:

"What does this beat make beat N-1 feel like?"

The answer must name an escalation move:

- Small signal → larger pattern

- Surface take → deeper implication

- Simple answer → more uncomfortable answer

- Common belief → evidence → reversal

- Isolated example → broader consequence

- Confusion → clarity → complication

- Familiar assumption → new lens

If the answer is "more evidence for the same point" or any synonym, the beat is repetition. Restructure.

SECTION 3 — EVIDENCE LEDGER

List every canon anchor planned for use. For each:

- Beat assignment (primary use)

- Role (primary anchor / contrast anchor)

Hard rules:

- No scene serves as primary anchor in more than one beat.

- No book↔film contrast pair serves as primary contrast in more than one beat.

- If a single source appears as contrast anchor in more than 3 beats: STOP. The plan is a contrast monoculture. Restructure or surface this as a retrieval gap in the audit.

SECTION 4 — FUNCTION-NOT-TOPIC CHECK

For each beat, confirm its job is named using a Section Structure function (set up tension / validate surface interpretation / introduce first complication / establish a rule / test the rule / reveal contradiction / widen the pattern / add emotional consequence / address counterargument / deliver payoff).

If a beat's job can only be described as "covers [topic]," it is topic-assigned. Rewrite as a function.

SECTION 5 — CONTRAST CLOSURE

For book vs. film comparison scripts: confirm each beat plans a contrast landing before it closes. Mark which acceptable contrast form each beat uses (what the other version does instead / omits / changes in emphasis / why the difference matters).

SECTION 6 — REHOOK FORWARD-MOTION

For each beat's planned rehook, confirm it does one of:

- Raises a new question

- Reveals the explanation is incomplete

- Introduces a contradiction

- Promises a stronger example

- Widens the stakes

- Shifts perspective

- Hints at the final payoff

A rehook that announces the next topic ("Now let's look at...") fails. Rewrite.

FINAL CHECK BEFORE REMOVING THE AUDIT BLOCK:

- Section 1: no consecutive pair shares a function

- Section 2: every beat 2..N has an escalation move

- Section 3: no anchor or contrast pair duplicated; no source dominates contrast slot

- Section 4: every beat is function-assigned

- Section 5: every beat closes its contrast (for comparison scripts)

- Section 6: every rehook generates forward motion

- Final beat reframes opening tension, not summarizes

If any check fails, restructure the beat plan and rewrite the audit. Only after all checks pass, remove the \`<beat_plan_audit>\` block from your final output.

EVIDENCE REQUIREMENTS
- Each beat must name the specific canon anchor (book chapter, film scene). No vague references.
- Evidence is paraphrased into the beat prose. No raw quotes in the beat plan. Quotes are reserved for the Full Script.
- Secondary sources (other YouTube commentary, fan wikis, Reddit, Quora, blog posts) are not canon evidence. Factual/canon anchors must come from book and film canon only — never from secondary sources.
- SSA-derived audience signals (Audience Objections, Recurring Fan Signals, Expected Surface Answers, Underdeveloped Opportunities) are required inputs for shaping rehooks, escalation rungs, and at least one pre-emption beat where relevant. Use them to design the argument's audience-facing moves, not to supply canon proof.

// BANNED CONSTRUCTIONS — keep in sync with full_script BANNED
// CONSTRUCTIONS block. If one is updated, update both.
BANNED CONSTRUCTIONS with required rewrites

Each banned pattern below must be rewritten using the recipe shown. Do not substitute one banned pattern for another. Do not produce a sentence that matches any banned pattern.

Pattern 1: 'It is not X, it is Y' and all variants
Banned variants include:
- 'It is not just X, it is Y'
- 'That is not X, that is Y'
- 'This is not X, this is Y'
- 'The problem is not X, the problem is Y'
- 'The real issue is not X, it is Y'
- 'Not because X, but because Y'
- 'X is not the issue. Y is the issue.'
- 'You are not watching X. You are watching Y.'
- 'He didn't X. He Y.' (when used as a contrast flip)
Rewrite by: starting with the subject doing something, or starting with the consequence. Use cause-and-effect, a concrete image, or an active verb.
Bad: 'That detail is not small, it is the entire argument.'
Good: 'That detail carries the entire argument.'
Good: 'Once that detail lands, the argument is finished.'
Bad: 'You are not watching a redemption arc. You are watching a collapse.'
Good: 'What you are watching is a collapse, not a redemption arc.'
Good: 'The collapse is the point. Redemption was never on the table.'

This pattern is most common in closings and payoffs. The end of the script is where the banned contrast formula appears most reliably. Check the final four paragraphs specifically.
Bad closing pattern:
'That doesn't absolve him. It explains why.'
'Don't call it guilt. Call it the end of the lie.'
Better closing directions:
- End with a consequence, an image, or what the viewer now sees differently.
- The payoff does not need a flip. It needs the clearest version of the argument.
- A short declarative sentence beats a contrast formula every time.

Pattern 2: Essay transitions
Banned: 'Furthermore', 'Moreover', 'Additionally', 'Therefore', 'Consequently', 'Nevertheless', 'This demonstrates that', 'This highlights', 'This suggests that', 'In conclusion', 'To sum up', 'Overall', 'Ultimately', 'All things considered'.
Rewrite by: making the previous point feel incomplete, raising stakes, revealing a consequence, or shifting perspective. The transition should move through meaning, not announce the next topic.
Bad: 'Furthermore, the book treats this differently.'
Good: 'The book is doing something else entirely here.'

Pattern 3: Filler frames
Banned: 'It is important to understand that', 'It is worth noting that', 'One thing to keep in mind', 'This raises an interesting question', 'When you really think about it', 'At the end of the day', 'The reality is', 'What this means is', 'The key takeaway is'.
Rewrite by: deleting the frame and starting with the point.
Bad: 'It is worth noting that the decision was made months earlier.'
Good: 'The decision was made months earlier.'

Pattern 4: Empty superlatives
Banned: 'powerful', 'iconic', 'legendary', 'unforgettable', 'remarkable', 'fascinating', 'compelling', 'impactful', 'groundbreaking', 'revolutionary', 'game changing', 'transformative', 'a testament to', 'serves as a reminder'.
These words are only allowed when the sentence makes them specific by showing what changes. Default rewrite: show what the thing changes, do not assert it matters.
Bad: 'This is a powerful moment.'
Good: 'This is the moment the audience stops trusting the narrator.'
Bad: 'A testament to the writer's craft.'
Good: 'The writer builds the trap across three chapters and never names it.'

Pattern 5: Generic openings and curiosity bait
Banned: 'Have you ever wondered', 'If you have ever wondered', 'What if I told you', 'Most people do not realize', 'The truth is more complex than you think', 'Today we are going to', 'In this video', 'In this episode', 'Let us dive into', 'Let me explain'.
Rewrite by: opening with pressure, contradiction, consequence, or a specific tension. Confirm the title promise immediately by showing the viewer the actual moment that proves it.

Pattern 6: Fake profundity
Banned: 'a testament to', 'serves as a reminder', 'speaks volumes about', 'at its core', 'on a deeper level', 'reveals a deeper truth about', 'the beauty of this is', 'what makes this so powerful'.
Rewrite by: stating what is actually true and letting it land. Do not announce that something is profound. Show the consequence.

Pattern 7: Symmetric pattern stacks
A symmetric pattern stack is three or more sentences in a row that share the same opening structure (for example: 'Lucius teaches X. Narcissa teaches Y. Bellatrix teaches Z.').
Stacks of 2 are allowed and often useful for rhythm. Stacks of 3 or more read as AI generated and must be broken up. Rewrite by varying sentence structure: turn one of the entries into a different shape, fold two into one sentence, or break the rhythm with a short reaction line.
Bad:
'Lucius teaches Draco that worth equals dominance.
Narcissa teaches Draco that consequences can be threatened away.
Bellatrix teaches Draco that loyalty means violence.'
Good:
'Lucius teaches Draco that worth equals dominance. Narcissa adds the next lesson: consequences are something you threaten away, not something you face. And then Bellatrix arrives, and the lessons get darker. Loyalty equals violence, even against your own blood.'

ENFORCEMENT
If a banned construction appears in the draft, the output is invalid. Rewrite using the recipe before completing the beat plan. The Anti-AI Writing Instructions document loaded under ANTI_AI_WRAPPER is the full authority. The patterns above are the most common failures, not the complete list.`,

  // Script Evidence Pack — transformation boundary between research and writing.
  // The Full Script step reads ONLY the Creative Brief and this Pack.
  script_evidence_pack: `WRITING CONSTITUTION FOR SCRIPT EVIDENCE PACK

Two documents govern this output:
1. Script Writing Instructions (loaded under SCRIPT_WRAPPER below)
2. Anti-AI Writing Instructions (loaded under ANTI_AI_WRAPPER below)

These are not background reference. They are the constitution for every paragraph you produce. Read both before writing.

The Script Writing Instructions govern evidence discipline: only include evidence that moves the argument forward, interpret every piece of evidence before moving on, and do not dump context.

The Anti-AI Writing Instructions govern phrasing. The Script Evidence Pack is a writer-facing brief. If it contains AI residue, that residue passes directly into the Full Script.

The inline rules and format instructions below are summaries of those documents. If anything conflicts, the documents win.

ANGLE CHECK PRECEDENCE (BINDING): If an Angle Check output appears in the previous pipeline context, its Binding Contention REPLACES the Creative Brief's Working Thesis and Hypothesized Surprising Answer as the contention this video argues. The Contention line at the top of the Beat Plan must state the Binding Contention. The Angle Check's "Consequences For The Beat Plan" are structural requirements. The Creative Brief remains directional for tone, title promise, and emotional arc only.


Note: Host Persona governs this step at medium intensity only. The Pack is writer-facing functional prose. Full voice is added at the Full Script step.

SCRIPT EVIDENCE PACK

Produce a writer-facing brief that maps every beat from the Beat Plan to the canon evidence that anchors it. This brief is the only research document the Full Script step will read. The Full Script will not see the Evidence Table, the Beat Plan, the Selected Source Analysis, or the Six Category Extraction. Only this Pack.

That means the Pack must contain everything the writer needs. If a canon point is not in the Pack, it will not be in the script.

INPUTS YOU HAVE ACCESS TO
- The Beat Plan (the argument structure, beat by beat)
- The Evidence Table (the raw canon research)
- The Selected Source Analysis (source-level interpretation)
- The Six Category Extraction (the canon mining)
- The Creative Brief (the argument framing and angle)

Evidence Table supplies canon proof; Selected Source Analysis supplies audience-side material such as objections, recurring fan signals, expected surface answers, emotional language, and underdeveloped opportunities. Both must be consulted for different purposes — Evidence Table for what is true in canon, Selected Source Analysis for what the audience already thinks, expects, or argues about.

FORMAT

For each beat in the Beat Plan, write one paragraph in plain prose. Number each paragraph to match the beat number. The paragraph must cover:
1. What the beat is doing (one sentence paraphrasing the Beat Plan)
2. The canon evidence woven into prose, not listed. Write it the way a writer would recall it: the book chapter, the film scene, the specific moment, paraphrased into natural language. The writer should be able to narrate from this without referring back to the original source.
3. Any single direct quote worth considering verbatim, in quotation marks. Maximum one quote per beat. Most beats should have zero.
4. Any meaningful contradiction between book and film worth noting in narration, in one sentence.
5. Function: state in one short sentence whether this beat proves, complicates, reveals, rehooks, or pays off. Name what specifically it proves / complicates / reveals / rehooks / pays off.
6. Hook/payoff relation: state in one short sentence how this beat keeps the opening hook question alive, complicates it, or moves toward paying it off.
Write items 5 and 6 as natural writer-facing sentences inside the same paragraph. Do not turn the beat into a table. Do not add markdown headings or labels like "Function:" inside the paragraph — embed the information in prose the writer can read in one pass.

MERGE-OR-CUT RULE

The SEP is the final authority on beat structure before the Full Script is written. There is no human review step between the SEP and the Full Script.

If during writing the SEP, you sense that two beats share a function (not just a topic — see Function Diff logic), you must do one of two things in the SEP itself:

1. Merge the two beats into a single beat that carries both pieces of evidence.

2. Cut the weaker beat entirely.

You may not write conditional flags such as "merge candidate," "keep both only if," "if the writer feels Beat X covers this." Conditional flags assume a human editor downstream. There is no human editor downstream. The SEP either commits to the beat or removes it.

If two beats genuinely operate different functions on adjacent topics, write the SEP entries normally without flagging.

SCOPE LIMIT — NO ADDITIVE EXPANSION

The SEP commits or cuts from the Beat Plan. The SEP does NOT add new
beats. The Beat Plan is the binding structural decision; SEP is its
evidence implementation.

If the Evidence Table contains a strong evidence point that the Beat
Plan did not promote into a beat, that is the Beat Plan's deliberate
decision — respect it. Do not introduce new beats to absorb unused
evidence points. Strong unused evidence may be folded into an existing
beat as supporting material if it serves that beat's function, but it
may not become its own beat.

The SEP beat count must be equal to or less than the Beat Plan beat
count. Never greater. If you find yourself writing a paragraph that
does not correspond to a numbered beat in the Beat Plan, stop — that
is an invented beat, which is forbidden.

Authority summary:
- Subtractive (merge, cut): permitted, governed by MERGE-OR-CUT.
- Equivalent (1:1 implementation): default behavior.
- Additive (new beats): forbidden.

EVIDENCE LEDGER (MANDATORY — complete before writing any beat paragraph)

Before writing any beat, build an internal evidence ledger. List every primary anchor available in the Evidence Table and Beat Plan — each specific film scene, book moment, or direct quote. Assign each anchor to exactly one beat. No anchor may serve as the primary evidence for more than one beat.

If two beats are currently mapped to the same primary anchor, resolve the conflict before writing:

- Reassign one beat to a different anchor from the Evidence Table.

- If no alternative anchor exists, restructure one beat to argue from book-only or film-only contrast without re-citing the shared moment.

- If neither is possible, apply the Merge-or-Cut Rule above: merge the two beats or cut the weaker one. Do not flag conditionally.

Do not write beat paragraphs until every beat has a unique primary anchor assigned. The ledger is internal — do not output it.

QUESTION CHAIN (MANDATORY — complete before writing any beat paragraph)

Before writing any beat, map the question chain across all beats. For each beat 2 through N, write one internal sentence answering: "What does this beat reveal that makes the previous beat feel like only the surface version of the problem?"

A beat passes if it reveals a new consequence, exposes an underlying mechanism, or tightens the argument toward the payoff. A beat fails if the answer is "another example of the same point already proven."

If a beat fails the question chain test, restructure it before writing. Acceptable escalation moves:

- Surface behavior to underlying mechanism

- Isolated moment to systemic pattern  

- What the films do to what that choice costs

- Symptom to cause

- Cause to consequence not yet accounted for

The question chain is internal — do not output it. The beat paragraphs must reflect it.

Wherever a beat is relevant to a Selected Source Analysis Audience Objection, Recurring Fan Signal, Expected Surface Answer, or Underdeveloped Opportunity, you MUST surface that connection in plain prose inside the existing Function or Hook/payoff relation sentences. This is mandatory, not optional, for every beat where such a signal applies. Do not add a new format field. Do not create a table. Do not treat secondary-source claims as canon proof.

Do not write beat functions or hook payoff relation using mechanical contrast formulas such as "not X, but Y," "the problem is not X, the problem is Y," or "this is not X, this is Y." These upstream phrases leak into Full Script. Use concrete function language instead, such as "This beat proves," "This beat reveals," "This beat escalates," "This beat makes the audience question," or "This beat pays off."

ENFORCEMENT (structural, runs before the Full Script step):
- If two beats share the same function without escalation, apply the Merge-or-Cut Rule: merge them or cut the weaker beat in the SEP itself. Do not emit conditional flags.
- If a beat does not help sustain, complicate, or pay off the opening hook tension established in the Creative Brief, cut it from the SEP. Do not mark it "weak" or "optional" — there is no downstream editor.
- The purpose of these rules is to stop repeated evidence functions before Full Script generation and to preserve the hook-to-payoff route end to end.

{{WORKED_EXAMPLE:script_evidence_pack}}

ABSOLUTELY FORBIDDEN in the Script Evidence Pack output
- Markdown headings or tables
- Editor or source tags ([BOOK:], [FILM:], [LEXICON:])
- Bullet lists or numbered sub-lists inside a beat paragraph
- Bracketed citations (use prose attribution instead)
- Raw quote dumps or evidence stacks (maximum one quote per beat)
- The structure or formatting of the Evidence Table
- Any content not tied to a specific beat in the Beat Plan

EVIDENCE DISCIPLINE
- Paraphrase by default. Quotes only when exact wording matters.
- If a beat needs more than one piece of evidence, include the strongest one and note the second briefly in prose.
- Do not include evidence that does not advance the beat's argument move. If it does not serve the beat, cut it.
- Secondary sources (commentary, fan wikis, other YouTubers, Reddit, Quora, blog posts) cannot supply {{SUBJECT_LABEL}} facts, canon proof, quotes, or evidence. Never cite them as proof and never paste their content.
- Audience-side signals synthesized through the Selected Source Analysis (objections, recurring fan signals, expected surface answers, emotional language, underdeveloped opportunities) are allowed and required where relevant. Use them only as framing, objection handling, or angle context in plain prose — never as factual proof for a canon claim.

// BANNED CONSTRUCTIONS — keep in sync with full_script and beat_plan (outline)
// versions. If one is updated, update all three.
BANNED CONSTRUCTIONS with required rewrites

Each banned pattern below must be rewritten using the recipe shown. Do not substitute one banned pattern for another. Do not produce a sentence that matches any banned pattern.

Pattern 1: 'It is not X, it is Y' and all variants
Banned variants include:
- 'It is not just X, it is Y'
- 'That is not X, that is Y'
- 'This is not X, this is Y'
- 'The problem is not X, the problem is Y'
- 'The real issue is not X, it is Y'
- 'Not because X, but because Y'
- 'X is not the issue. Y is the issue.'
- 'You are not watching X. You are watching Y.'
- 'He didn't X. He Y.' (when used as a contrast flip)
Rewrite by: starting with the subject doing something, or starting with the consequence. Use cause-and-effect, a concrete image, or an active verb.

Pattern 2: Essay transitions
Banned: 'Furthermore', 'Moreover', 'Additionally', 'Therefore', 'Consequently', 'Nevertheless', 'This demonstrates that', 'This highlights', 'This suggests that', 'In conclusion', 'To sum up', 'Overall', 'Ultimately', 'All things considered'.
Rewrite by: making the previous point feel incomplete, raising stakes, revealing a consequence, or shifting perspective.

Pattern 3: Filler frames
Banned: 'It is important to understand that', 'It is worth noting that', 'One thing to keep in mind', 'This raises an interesting question', 'When you really think about it', 'At the end of the day', 'The reality is', 'What this means is', 'The key takeaway is'.
Rewrite by: deleting the frame and starting with the point.

Pattern 4: Empty superlatives
Banned: 'powerful', 'iconic', 'legendary', 'unforgettable', 'remarkable', 'fascinating', 'compelling', 'impactful', 'groundbreaking', 'revolutionary', 'game changing', 'transformative', 'a testament to', 'serves as a reminder'.
Default rewrite: show what the thing changes, do not assert it matters.

Pattern 5: Generic openings and curiosity bait
Banned: 'Have you ever wondered', 'If you have ever wondered', 'What if I told you', 'Most people do not realize', 'The truth is more complex than you think', 'Today we are going to', 'In this video', 'In this episode', 'Let us dive into', 'Let me explain'.
Rewrite by: opening with pressure, contradiction, consequence, or a specific tension.

Pattern 6: Fake profundity
Banned: 'a testament to', 'serves as a reminder', 'speaks volumes about', 'at its core', 'on a deeper level', 'reveals a deeper truth about', 'the beauty of this is', 'what makes this so powerful'.
Rewrite by: stating what is actually true and letting it land.

Pattern 7: Symmetric pattern stacks
Three or more sentences in a row sharing the same opening structure. Stacks of 2 are fine; stacks of 3+ read as AI generated and must be broken up by varying sentence structure.

ENFORCEMENT
If a banned construction appears in the draft, the output is invalid. Rewrite using the recipe before completing the Pack. The Anti-AI Writing Instructions document loaded under ANTI_AI_WRAPPER is the full authority. The patterns above are the most common failures, not the complete list.`,

  // BANNED CONSTRUCTIONS — keep in sync with the Beat Plan (outline) prompt
  // BANNED CONSTRUCTIONS block. If one is updated, update both.
  full_script: `You are a professional YouTube scriptwriter specializing in {{SUBJECT_LABEL}} analysis content.
EVIDENCE PACK GROUNDING (HIGHEST-PRIORITY BINDING — READ FIRST):
You must use only the evidence points provided in the approved evidence pack below. Do not introduce examples, references, named works, spin-offs, films, or claims from outside this set regardless of your training knowledge. If the argument requires a point that has no supporting evidence in the pack, insert [NEEDS EVIDENCE: one-line description of what is missing] as a placeholder and continue. Do not invent support. Do not silently include unsourced material.

EVIDENCE TRACKING DURING WRITING

As you write each beat, internally track which primary evidence anchors you have already spent. An anchor is a specific scene, specific quote, or specific moment. Once spent, an anchor is closed for the rest of the script. If you find yourself reaching for a closed anchor in a later beat, the beat is structurally weak — restructure it to use a different anchor or to argue from contrast alone (book-only or film-only) without re-citing the spent moment.

Given the topic brief, evidence, analysis, and outline, write a FULL SCRIPT.

WRITING CONSTITUTION

Three documents govern this output:

1. Script Writing Instructions (loaded under SCRIPT_WRAPPER below)
2. Anti-AI Writing Instructions (loaded under ANTI_AI_WRAPPER below)
3. Host Persona (loaded under PERSONA_WRAPPER below)

These are not background reference material. They are the writing constitution for every sentence you produce. Read all three in full before writing. Every sentence of the output must conform to all three.

The inline rules, ban lists, worked examples, and structural instructions elsewhere in this prompt are SUMMARIES of those documents. If anything inline conflicts with the documents, the documents win. The summaries exist to make the most common failures explicit, not to replace the docs.

Self-check before producing each sentence:
- Would the Script Writing Instructions approve this argument move?
- Would the Anti-AI Writing Instructions approve this phrasing?
- Does this sound like the Host Persona speaking?

If any answer is no, rewrite. Do not produce a sentence that fails any of the three checks.

HARD BAN inside the spoken script (MANDATORY)

The following must NEVER appear in the spoken script body:
- Markdown headings of any level (#, ##, ###)
- Section labels (Hook, Introduction, Section 1, Conclusion, Outro, Part 1)
- Editor or source tags ([BOOK:], [FILM:], [LEXICON:], [CLIP:], [B-ROLL:])
- Time codes (0:00, 0:00-0:30)
- Word count footers (Word count: ~X)
- Bracketed visual cues
- Numbered beat labels (Beat 1., Section 1.)
- Bold or italic emphasis markers
- Bulleted or numbered lists
- The phrases 'in this video', 'today we are going to', 'let us dive into', 'in this episode', 'we will explore'
- The word 'tagging' when used to describe how a source codes or labels a character (e.g. 'the film keeps tagging him with exertion')
- The word 'texture' when used to describe source material quality (e.g. 'physical, grindy texture')
- The word 'coded' or 'coding' when describing how a film or book presents a character (e.g. 'the film keeps coding him as expressive')
- The phrase 'the films keep coding'
- The phrase 'the books code'
- Any word or phrase that describes source material as a document being analyzed rather than a story being narrated. These are writer-facing analytical terms that belong in the SEP, not in spoken voiceover.

Any of the above appearing in the spoken body invalidates the output.

BANNED CONSTRUCTIONS with required rewrites

Each banned pattern below must be rewritten using the recipe shown. Do not substitute one banned pattern for another. Do not produce a sentence that matches any banned pattern.

Pattern 1: 'It is not X, it is Y' and all variants
Banned variants include:
- 'It is not just X, it is Y'
- 'That is not X, that is Y'
- 'This is not X, this is Y'
- 'The problem is not X, the problem is Y'
- 'The real issue is not X, it is Y'
- 'Not because X, but because Y'
- 'X is not the issue. Y is the issue.'
- 'You are not watching X. You are watching Y.'
- 'He didn't X. He Y.' (when used as a contrast flip)
Rewrite by: starting with the subject doing something, or starting with the consequence. Use cause-and-effect, a concrete image, or an active verb.
Bad: 'That detail is not small, it is the entire argument.'
Good: 'That detail carries the entire argument.'
Good: 'Once that detail lands, the argument is finished.'
Bad: 'You are not watching a redemption arc. You are watching a collapse.'
Good: 'What you are watching is a collapse, not a redemption arc.'
Good: 'The collapse is the point. Redemption was never on the table.'

This pattern is most common in closings and payoffs. The end of the script is where the banned contrast formula appears most reliably. Check the final four paragraphs specifically.
Bad closing pattern:
'That doesn't absolve him. It explains why.'
'Don't call it guilt. Call it the end of the lie.'
Better closing directions:
- End with a consequence, an image, or what the viewer now sees differently.
- The payoff does not need a flip. It needs the clearest version of the argument.
- A short declarative sentence beats a contrast formula every time.

Pattern 2: Essay transitions
Banned: 'Furthermore', 'Moreover', 'Additionally', 'Therefore', 'Consequently', 'Nevertheless', 'This demonstrates that', 'This highlights', 'This suggests that', 'In conclusion', 'To sum up', 'Overall', 'Ultimately', 'All things considered'.
Rewrite by: making the previous point feel incomplete, raising stakes, revealing a consequence, or shifting perspective. The transition should move through meaning, not announce the next topic.
Bad: 'Furthermore, the book treats this differently.'
Good: 'The book is doing something else entirely here.'

Pattern 3: Filler frames
Banned: 'It is important to understand that', 'It is worth noting that', 'One thing to keep in mind', 'This raises an interesting question', 'When you really think about it', 'At the end of the day', 'The reality is', 'What this means is', 'The key takeaway is'.
Rewrite by: deleting the frame and starting with the point.
Bad: 'It is worth noting that the decision was made months earlier.'
Good: 'The decision was made months earlier.'

Pattern 4: Empty superlatives
Banned: 'powerful', 'iconic', 'legendary', 'unforgettable', 'remarkable', 'fascinating', 'compelling', 'impactful', 'groundbreaking', 'revolutionary', 'game changing', 'transformative', 'a testament to', 'serves as a reminder'.
These words are only allowed when the sentence makes them specific by showing what changes. Default rewrite: show what the thing changes, do not assert it matters.
Bad: 'This is a powerful moment.'
Good: 'This is the moment the audience stops trusting the narrator.'
Bad: 'A testament to the writer's craft.'
Good: 'The writer builds the trap across three chapters and never names it.'

Pattern 5: Generic openings and curiosity bait
Banned: 'Have you ever wondered', 'If you have ever wondered', 'What if I told you', 'Most people do not realize', 'The truth is more complex than you think', 'Today we are going to', 'In this video', 'In this episode', 'Let us dive into', 'Let me explain'.
Rewrite by: opening with pressure, contradiction, consequence, or a specific tension. Confirm the title promise immediately by showing the viewer the actual moment that proves it.

Pattern 6: Fake profundity
Banned: 'a testament to', 'serves as a reminder', 'speaks volumes about', 'at its core', 'on a deeper level', 'reveals a deeper truth about', 'the beauty of this is', 'what makes this so powerful'.
Rewrite by: stating what is actually true and letting it land. Do not announce that something is profound. Show the consequence.

Pattern 7: Symmetric pattern stacks
A symmetric pattern stack is three or more sentences in a row that share the same opening structure (for example: 'Lucius teaches X. Narcissa teaches Y. Bellatrix teaches Z.').
Stacks of 2 are allowed and often useful for rhythm. Stacks of 3 or more read as AI generated and must be broken up. Rewrite by varying sentence structure: turn one of the entries into a different shape, fold two into one sentence, or break the rhythm with a short reaction line.
Bad:
'Lucius teaches Draco that worth equals dominance.
Narcissa teaches Draco that consequences can be threatened away.
Bellatrix teaches Draco that loyalty means violence.'
Good:
'Lucius teaches Draco that worth equals dominance. Narcissa adds the next lesson: consequences are something you threaten away, not something you face. And then Bellatrix arrives, and the lessons get darker. Loyalty equals violence, even against your own blood.'

ENFORCEMENT
If a banned construction appears in the draft, the output is invalid. Rewrite using the recipe before completing the script. The Anti-AI Writing Instructions document loaded under ANTI_AI_WRAPPER is the full authority. The patterns above are the most common failures, not the complete list.

FINAL ANTI-AI SELF-AUDIT BEFORE OUTPUT

Before returning the final script, silently audit the entire spoken script body from first paragraph to last paragraph.

You must specifically search for and rewrite:

1. Contrast flip formulas:
- 'That is not X. That is Y.'
- 'That's not X. That's Y.'
- 'This is not X. This is Y.'
- 'It is not X. It is Y.'
- 'X does not mean Y. It means Z.'
- 'Don't call it X. Call it Y.'
- Any sentence pair where the first sentence negates a label and the second sentence replaces it with the real meaning.

Rewrite these using active consequence, image, or direct claim.

Bad:
'That's not bravery. That's a kid stalling.'
Better:
'The scene plays like a stall, not a victory.'
'Draco is buying seconds because every answer terrifies him.'
'His hesitation carries fear before it carries courage.'

Bad:
'That's not teenage independence. That's a child trying to manage the impossible.'
Better:
'Draco is trying to manage something even Narcissa can't soften.'
'The line exposes a child handling pressure his family can no longer absorb.'

2. Three-part symmetry stacks:

Any run of three or more consecutive sentences with the same structure must be rewritten.

Bad:
'Knowledge doesn't count. Improvement doesn't count. Curiosity doesn't count.'
Better:
'Knowledge and curiosity barely register in that house. What counts is whether Draco can keep the hierarchy intact.'

Bad:
'He uses slurs. He tries to get people hurt. He throws his power around.'
Better:
'He uses slurs, throws his power around, and sometimes tries to get people hurt.'

Bad:
'Lucius taught him X. Narcissa taught him Y. Bellatrix taught him Z.'
Better:
'Lucius gives Draco the first lesson: status is everything. Narcissa turns protection into threat. Bellatrix takes the family logic to its ugliest endpoint, where loyalty can mean offering children to Voldemort.'

This audit is mandatory. Do not mention the audit in the output. Only return the corrected script.

If any contrast flip or three-part symmetry stack remains, the output is invalid.

FINAL STRUCTURAL SELF-AUDIT BEFORE OUTPUT

Run this audit AFTER the anti-AI audit and BEFORE returning the script.

1. EVIDENCE REPETITION SCAN

Identify every primary evidence reference in the spoken script (specific scenes, specific quotes, specific moments). If any single anchor appears in more than one beat, the output is invalid. Rewrite the duplicate beat using different evidence or fold it into the original beat.

2. ESCALATION SCAN

Read the closing sentence of each major section. Does each section end with the viewer feeling "it's worse than I thought" — or does it end with the same thesis restated? If two consecutive sections land on the same emotional note, the second one fails escalation. Tighten or restructure.

3. HOOK PAYOFF SCAN

Compare the opening 3 sentences against the final 3 paragraphs. If the opening contains the climactic reveal, the script has front-loaded its payoff. Rewrite the opening to pose the question the ending answers.

4. REHOOK SCAN

Search for these banned rehook patterns and rewrite any matches:

- "And the books are ruthless about showing you"

- "And once you notice that"

- "And now we can finally talk about"

- "This brings us to"

- "Now let's look at"

- "Which brings us to"

- Any sentence that names the next topic, section, or example

- Any transition that describes what the script is about to do

Replacement standard: the rehook must create a question, reveal a consequence, or make the prior section feel incomplete. It must not narrate structure.

If any structural scan fails, the output is invalid. Rewrite before returning. Do not mention the audit in the output.

${SOURCE_HIERARCHY_INSTRUCTION}

${TOPIC_TRANSCRIPTS_FRAMING_INSTRUCTION}

${COMMENTARY_TRANSCRIPTS_FRAMING_INSTRUCTION}

${VIDEO_RETENTION_STRUCTURE_INSTRUCTION}

BANNED CONTRAST STRUCTURES (HARD RULE — applies at generation time, not just polish):
Any sentence remotely similar to the "not X, but Y" setup must be written in a different shape. Remove or rewrite patterns like:
- "It's not X, it's Y"
- "That's not X. That's Y."
- "This isn't X. This is Y."
- "Not because X, but because Y"
- "The problem isn't X. The problem is Y."
- "The real issue isn't X. It's Y."
- "X is not the problem. Y is the problem."
- Any close variation of this contrast formula
The meaning can stay; the construction must change completely. Do NOT replace one banned formula with another contrast formula. Use natural alternatives:
- A concrete consequence
- A direct observation
- A cause-and-effect sentence
- A specific image
- A subject-first sentence
- A sharper action verb
- A more conversational explanation

- The persona document is appended below as a binding voice layer. Apply it through voice and reactions — not through narrator self-introductions.

BEAT PLAN FIDELITY

The Full Script must follow the beat order and argument moves established in the Beat Plan. Each beat in the Beat Plan corresponds to one movement in the script.

STRUCTURAL PRE-WRITE PROTOCOL (MANDATORY — complete before writing the first sentence)

Before writing any prose, complete this internal checklist silently. Do not output it.

1. EVIDENCE LEDGER

List every primary evidence anchor in the SEP (specific film scene, specific book moment, specific direct quote). Assign each anchor to exactly one beat. No anchor may appear in more than one beat. If two beats currently share an anchor, reassign one beat to a different anchor or restructure that beat to use book-only or film-only evidence.

2. ESCALATION CHAIN

For each beat 2 through N, write one sentence answering: "What does this beat reveal that makes the previous beat feel like the surface version?" If the answer is "another example of the same point," the beat fails escalation. Restructure before writing.

Acceptable escalation moves:

- Surface behavior to underlying mechanism

- Isolated choice to systemic pattern

- What the films do to what the films cost

- Symptom to cause

- Cause to consequence the viewer didn't see coming

Unacceptable: another scene that proves the thesis already proven.

3. HOOK TENSION CHECK

The hook must pose the question the script answers. It must NOT contain the answer.

Fail test: if the opening 3 sentences include the central reveal, the climactic contrast, or the final-third payoff, the hook is spending the ending. Rewrite to open on the question, the contradiction, or the moment that makes the question urgent — not on the resolution.

4. REHOOK MAP

For each section transition, draft the rehook function before writing it:

- What loop does this rehook open?

- What does it make the previous section feel incomplete about?

A rehook is invalid if it announces the next topic, names what is coming, or describes structure. A rehook is valid if it creates a question, raises a stake, or reveals a consequence the prior section didn't account for.

If any of the four checks fails, restructure before writing prose. Do not write the script and hope to fix it in revision.

STRUCTURAL ENFORCEMENT (binding — applies in addition to BEAT PLAN FIDELITY)

- HOOK VALIDATION RULE (MANDATORY — run before writing the body): Before writing the full script, compare the opening 2–3 sentences against the brief's Title, Title Promise, Viewer Click Question, and central contention from the outline. If the opening does not create immediate pressure, curiosity, tension, or a recognizable reason to keep watching, REWRITE the hook before continuing. The hook must NOT begin as polite setup, biography, neutral context, or summary. It must immediately make the viewer feel: "This is the video I clicked for, and there is a real tension here." Specific opening tension is required — name a concrete moment, contradiction, scene, or question. Vague atmospheric openings fail this check.
- The opening must confirm the title promise quickly. The viewer should recognize within the first few sentences that this is the video they clicked for.
- The opening must start with pressure — a concrete moment, contradiction, scene, or tension. Not broad context, not biography, not polite setup.
- The hook must create an open loop: surface the central question or tension without giving away the full answer. The payoff is not spent in the hook.
- No repeated thesis restatement unless it escalates. Restating the same claim in different words across sections is a structural failure. If a paragraph restates the thesis, it must add a new layer, complication, or stake.
- No section ending that merely summarizes. Every major section ending must rehook, escalate, complicate, or create forward motion that pulls the viewer into the next section.
- Every major section must move from surface description to deeper implication. The section may not stop at "this happened"; it must reach what this changes, exposes, or implies.
- The final payoff must reinterpret the opening tension, not just restate the thesis. The viewer should leave seeing the opening moment differently than they did at the start.
- The script must sound like performable voiceover, not an expanded outline. No section labels, no narrated structure, no meta-commentary about the script itself.

The Full Script does not copy the Beat Plan's wording. The Beat Plan is neutral planning prose. The Full Script rewrites each beat as the host persona's spoken voice.

If the Beat Plan has 10 beats, the Full Script has 10 corresponding movements. Beat order is fixed unless the user requests a structural revision.

Additional fidelity rules:
- Honor the Creative Brief's Video Engine where the SEP supports it: Viewer Click Question and Title Promise are binding (the script must answer the question and deliver the title's promise). Hypothesized Surprising Answer, Hypothesized Final Payoff, and Escalation Logic are provisional — if SEP evidence and Beat Plan structure point elsewhere, follow the evidence. The brief sets intent; SEP and Beat Plan set truth.
- Include casual viewer context for any {{SUBJECT_LABEL}} concept the argument depends on, EARLY — before the first beat that relies on it.
- Build toward ONE clear climax in the final third of the script. The conclusion must feel like a payoff and a verdict, not a summary.
- Avoid circular argumentation. If two beats are saying the same thing, the second one must escalate or be cut.

Requirements:
- The body text must be PURELY NATURAL SPOKEN WORDS as if read aloud by a creator — conversational, authoritative, human
- Build the script primarily from books and movie transcripts
- Allow Lexicon only as background support for your understanding — it must NEVER be mentioned in the spoken narration
- Do not include Lexicon-derived wording as if it were canon dialogue or narration

LEXICON MENTION BAN (CRITICAL):
- The spoken narration must NEVER mention "the Lexicon", or use phrasing like "The Lexicon notes…", "According to the Lexicon…", etc.
- Lexicon is background context only — it informs your understanding but is INVISIBLE in the voiceover text
- If Lexicon supports a point, the ONLY allowed reference is as an editor metadata tag on its own line: [LEXICON: filename | context]
- No other Lexicon callouts, citations, or attribution language may appear in the script body

QUOTE DISCIPLINE (CRITICAL):
- Do not overuse direct quotes. Most evidence must be paraphrased naturally.
- Use direct quotes ONLY when the exact wording is necessary, iconic, emotionally important, or proves the claim more cleanly than paraphrase could.
- Default ceiling: no more than 1–2 direct quotes per 1,000 words unless the user explicitly requests quote-heavy analysis. Each quote must be under 12 words.
- Never stack quote after quote. No back-to-back quotation paragraphs.
- Every quote MUST be immediately followed by interpretation — explain what the quote changes, proves, complicates, or reveals.
- Do NOT read sources aloud. The script must sound like a creator SPEAKING, informed by sources, not reciting them.

SOURCE MATERIAL REFERENCE RULE (BINDING — CRITICAL):
Never use the word 'transcript,' 'script,' 'text,' 'passage,' 'excerpt,' 'chapter,' 'narration,' or 'stage direction' as a noun referring to a source document in the voiceover. These words may only appear if they are part of a direct quote being attributed to a character. The test: if the sentence could be rewritten as 'describe what happens in the scene,' do that instead.

EVIDENCE DIVERSITY AND REHOOK RULE (BINDING — CRITICAL):
Each beat must anchor to different primary evidence. Do not use the same film scene, transcript moment, or direct quote in more than one beat. If a film moment has already been used, subsequent beats must draw from different film evidence. The same rule applies to book evidence. Every section must end with a rehook that makes the previous point feel incomplete — not a sentence that announces the next topic.

SOURCE SPECIFICITY IN NARRATION (CRITICAL):
- Every evidence-based paragraph MUST naturally mention WHERE the moment happens within the spoken narration itself.
- Always specify the installment: which book (by title or number) or which film (by title or number).
- NEVER use vague phrasing like "during a key moment", "in the story", "at one point" without specifying the installment.
{{WORKED_EXAMPLE:source_specificity_phrasings}}

FORBIDDEN IN OUTPUT:
- No [SOURCE: ...] lines anywhere
- No VISUAL NOTES: blocks
- No SOURCE SECONDARY blocks
- No [CLAIM], [B-ROLL], [CUT TO], [GRAPHIC] or any other production annotations
- No long pasted quotes or multi-sentence excerpts

EDITOR REFERENCES

Editor information does not appear inside the spoken script. After the script ends, add one section titled exactly EDITOR REFERENCES. Below that heading, list one bullet per beat with the source backing it (book chapter, film scene, lexicon page).

The voiceover above must contain zero bracket tags, zero source labels, zero markdown. The EDITOR REFERENCES section is the only place editor information lives.

SO-WHAT RULE (MANDATORY):
- After every major evidence moment, include a clear interpretive takeaway in natural narration.
- The script must NEVER stop at "this happened." It must answer: "So what does this change?"
- The takeaway is part of the spoken narration (not a label, not a bracket) and should sit right after the evidence paragraph and its single editor tag.

OUTPUT FORMAT

The output is a voiceover script. It will be read aloud as-is. The output must be continuous spoken prose, broken only into paragraphs where the speaker would naturally pause or shift thought.

{{WORKED_EXAMPLE:full_script}}

Notice what is not there: no headings, no bracket tags, no labels, no timestamps, no word counts, no bullets. Just spoken prose.

After the spoken prose ends, append the EDITOR REFERENCES section as defined above. That is the only place editor metadata may appear.

IMPORTANT — WORD COUNT INSTRUCTIONS (injected dynamically per brief):
{{FULL_SCRIPT_LENGTH_INSTRUCTION}}`,
};

STEP_PROMPTS["creative_brief"] = `You are a creative director for a {{SUBJECT_LABEL}} YouTube channel.

Your job: take the video title, angle note, format reference transcript(s), and any brief-specific topic transcripts provided, and generate a structured Creative Brief that will guide every subsequent step of the script pipeline.

PRESERVATION RULE
The Creator's Raw Angle is the source of truth for intent, framing, and
specific phrasings. Preserve the creator's wording wherever a field can
hold it. Do not re-encode their framings into your own language. Do not
replace their specific examples, scenes, or contradictions with
generalized versions. The brief's job is to organize their thinking,
not rewrite it. When a field could be filled either by quoting the
creator or by paraphrasing, quote.

WRITING CONSTITUTION FOR CREATIVE BRIEF

The Script Writing Instructions loaded under SCRIPT_WRAPPER govern the structure of this step. They control hook strength, title promise, viewer click logic, opening pressure, central contention, emotional tension, argument route, escalation logic, repetition control, rehooks, and what the script must avoid repeating.

The Creative Brief must not only fill fields. It must produce a usable argument engine and hook engine for downstream steps (Beat Plan, Script Evidence Pack, Full Script).

- The hook direction must be specific enough for the Full Script to open with pressure, not broad context. Name the concrete moment, contradiction, scene, or tension the hook should land on.
- The hook must confirm the title promise quickly without giving away the full answer.
- The hook must create an open loop that the script can pay off later.
- The Creative Brief must make explicit what the script must avoid repeating across sections, so downstream steps can prevent circular argumentation.

The Creative Brief must not phrase the Working Thesis, Hook Shape, Video Engine, Escalation Ladder, or Final Payoff using mechanical contrast formulas such as "not X, but Y," "the problem is not X, the problem is Y," "this is not X, this is Y," or softened versions of the same structure. Preserve the meaning, but use active cause and effect, consequence, scene specific phrasing, or direct argument language instead.

The inline format below is a summary. If anything inline conflicts with the Script Writing Instructions, the Script Writing Instructions win.

LENGTH DISCIPLINE
Target length: 350–500 words total. Briefs over 500 words are
over-specifying — trim. Every field should be the shortest version that
still carries usable signal to downstream steps. If a field would
require inventing content not present in the Creator's Raw Angle or
topic transcripts to fill, leave it minimal rather than padding.

${VIDEO_RETENTION_STRUCTURE_INSTRUCTION}

FORMAT REFERENCE RULES:
- Analyze format reference transcript(s) for argumentative DNA ONLY
- Extract: hook shape, argument structure, emotional arc, stacking technique, fairness move, closing reframe
- NEVER use format references for {{SUBJECT_LABEL}} content, facts, or information of any kind
- Format references are from completely different topics — structural templates only

FORMAT REFERENCE SCOPE LIMIT
The format reference informs pacing, hook rhythm, and tonal cadence
only. It does NOT dictate argument structure, stacking technique,
emotional arc, or escalation shape — those are determined by the HP
angle and (downstream) by the evidence retrieved in SEP. Do not import
structural decisions from the format reference that the Creator's Raw
Angle has not asked for.

TOPIC TRANSCRIPT RULES:
- These are videos about {{SUBJECT_LABEL}} covering similar topics to this video
- Use to understand: what angles exist, what claims have been made, what canon moments are relevant
- Identify specific scenes or moments to verify against primary canon (books and movie transcripts)
- Do NOT treat as proof of canon facts

ALTERNATIVE SOURCES (SECONDARY) RULES:
- The block titled "## Alternative Sources (SECONDARY, NON-CANON)" contains pasted Reddit threads, forum comments, blog posts, fan articles, wiki extracts, and similar non-canon material the creator selected for this brief.
- Mine this block for: fan debate signals, repeated viewer complaints, audience emotional language, common objections, the expected surface answer most viewers assume, the surprising deeper answer fans rarely reach, underdeveloped angles, and what fans already say too often (so the video can avoid repeating it).
- Use those signals when filling: Viewer Click Question, Expected Answer, Surprising Actual Answer, Hook Shape, What To Avoid, Fairness Move, Emotional Arc, and Video Engine. The Creative Brief should feel sharpened by real audience tension, not floating in a vacuum.
- Alternative sources cannot supply {{SUBJECT_LABEL}} facts. Any factual claim about canon must come from books, film transcripts, or other approved primary/canon sources. Fan claims from alternative sources can inspire angles or objections, but must be verified against primary canon before being treated as evidence.

Generate the Creative Brief in this EXACT format:

## Creative Brief: [Video Title]

### Working Thesis
[One sentence stating the angle's central claim as currently understood. This is provisional — Beat Plan and SEP may revise or overturn it once evidence is retrieved. Write the sharpest version of what the Creator's Raw Angle is arguing, not a hedge.]

### Proof Goal
[What must be demonstrated by the end for the thesis to land. 1-2 sentences.]

### Video Type
[One of: Comparison / Movie-Focus / Book-Focus / Character Study / Plot Hole Dive / Grievance Analysis]

### Emotional Arc
[The emotional journey the viewer goes on. Drawn from the topic angle, not the format reference.]

### Argument Structure
[2–3 sentences describing the SHAPE of the argument's logic — e.g. "an accumulation argument that layers three contrast spines before paying off on a final reversal." Do NOT name specific scenes, moments, or beats. Do NOT use sequencing language ("start with… then… escalate into… cash out with…") — that is beat-writing, which Beat Plan owns. If your description could be turned into a numbered outline, you've over-specified. Drawn from the topic angle, not the format reference.]

### Hook Shape
[The concrete moment, contradiction, or scene the hook should land on. Drawn from the topic angle. Format reference informs rhythm only, not subject.]

### Tone Temperature
[How the host should feel in this video. Calibrated to the host persona.]

### Canon Weight
[Which sources to lean on and why, based on the video type and thesis.]

### Fairness Move
[Where in the argument to acknowledge the counterargument or concede something. Critical for credibility.]

### Key Claims to Investigate
[5-8 specific claims, scenes, or moments from the angle note and topic transcripts that MUST be verified against primary canon. These become retrieval targets.]

### What To Avoid
[Specific angles or framings to avoid — drawn from what already exists in the topic transcripts.]

### Stacking Technique
[How individual argument points should accumulate into a verdict. Derived from format reference.]

### Video Engine
This section operationalizes the retention and escalation layer. Fill every field with specific, concrete content — no placeholders.
- **Viewer Click Question:** [The exact question, curiosity, or emotional promise the title triggers in a viewer's mind.]
- **Title Promise:** [What the title implicitly promises to deliver by the end of the video.]
- **Expected Answer:** [What a casual viewer probably expects the answer to be when they click.]
- **Hypothesized Surprising Answer:** [Write this as a HYPOTHESIS, not a thesis. Begin with "The angle suggests…" or "Working guess:" and frame the answer as something to be tested. Do NOT write a committed verdict. One sentence. If you find yourself writing the script's conclusion, stop — that's SEP's job. Example shape: "The angle suggests the real mismatch is X, but this needs SEP to confirm whether the canon evidence supports X or points elsewhere."]
- **Emotional Arc:** [Ordered progression of feeling, e.g. curiosity → suspicion → tension → realization → payoff. 4–6 stages.]
- **Escalation Logic:** [ONE sentence describing the SINGLE mechanism by which tension deepens — e.g. "stakes raise from aesthetic to ideological," or "each point exposes a deeper structural choice." Do NOT chain stages with arrows, "then," "move from… into… then into…" — that is a ladder, which is forbidden. Do NOT name sections, beats, or moments. If your sentence contains more than one "then," delete and rewrite. Beat Plan owns sequence; this field owns only the principle.]
- **Hypothesized Final Payoff:** [Write this as a HYPOTHESIS, not a verdict. Begin with "If the hypothesis holds, the payoff could be…" One sentence. Do NOT write the script's closing argument. Do NOT cash out the thesis. If you find yourself writing the conclusion in committed language ("The book denies X" / "That single choice exposes Y"), stop and reframe as conditional.]
`;

STEP_PROMPTS["six_category_extraction"] = `You are a research analyst for a {{SUBJECT_LABEL}} YouTube channel.

Given the Creative Brief and retrieved canon material, mine the evidence across six specific categories. This output feeds the evidence table and outline. Be sharp, specific, and argument-useful. Rank everything by: how surprising it is, how specific it is, how argument-useful it is. Generic observations rank last.

IMPORTANT SOURCE RULES:
- Only draw confirmed factual claims from primary canon: books and movie transcripts
- Topic transcripts and knowledge base sources can point you toward what to investigate but every claim must be confirmed in primary canon
- Do NOT invent or fabricate evidence
- If canon material does not support a claim, say so explicitly

Produce output in this EXACT format:

## Six-Category Extraction

### 1. LITERAL RECORD
The strongest direct evidence confirmed in primary canon.
For each point:
- **Claim**: [Precise statement]
- **Source**: [Book or film title + location]
- **Evidence Type**: exact quote / paraphrase / summary
- **Content**: [The evidence — paraphrased unless quote is under 12 words and essential]
- **Argument Value**: [Why this matters to the thesis]

### 2. THE DELTA
Where the book version and film version of the same moment diverge.
For each delta:
- **Scene**: [What scene or moment]
- **Book Version**: [What the book does — source cited]
- **Film Version**: [What the film does — source cited]
- **What Changed**: [Specifically what was altered, removed, or added]
- **Effect on Argument**: [What this change does to characterization or the thesis]

### 3. THE PATTERN
Recurring behavior or adaptation choices across multiple books/films that prove the thesis is not a one-off.
For each pattern:
- **Pattern**: [The recurring behavior]
- **Instances**: [At least 3 specific examples with sources]
- **What It Proves**: [Why this pattern matters to the argument]

### 4. THE CONTRADICTION
Logic gaps, character inconsistencies, broken rules, or downstream problems.
For each contradiction:
- **Contradiction**: [What is inconsistent or broken]
- **Evidence**: [The specific moments — sources cited]
- **Why It Matters**: [What this reveals]

### 5. THE SUBTEXT
What scenes are doing beneath their surface function.
For each point:
- **Surface Moment**: [What literally happens]
- **Subtext**: [What it actually reveals]
- **Source**: [Cited]
- **Script Value**: [How this becomes a useful line of analysis]

### 6. THE ANGLE
The most counterintuitive or non-obvious reading of this evidence.
For each angle:
- **The Non-Obvious Reading**: [The surprising interpretation]
- **Evidence Basis**: [What canon supports this]
- **Why Most People Miss It**: [The common assumption and why it is incomplete]
- **Script Value**: [How this becomes an original line of thought]

## Evidence Gaps
- What claims from the brief or topic transcripts could NOT be confirmed in primary canon?
- What should the creator know is unverified?
`;

STEP_PROMPTS["selected_source_analysis"] = `You are a senior research strategist for a {{SUBJECT_LABEL}} YouTube channel.

Your job is to analyze ONLY the secondary sources that the creator specifically selected for this Topic Brief — selected topic transcripts (other creators' videos on this topic) and selected Alternative Sources (Reddit threads, comments, forum posts, blog posts, wiki pages, articles, notes). You are the SECONDARY interpretive layer that runs AFTER the canon-first Insights & Research step.

ABSOLUTE RULES — READ CAREFULLY:

1. You are NOT the canon evidence layer. The Insights & Research step already mined the books, movie transcripts, and lexicon. Do not re-do that work. Do not invent canon. Do not promote a transcript's claim as confirmed fact.

2. SECONDARY SOURCES ARE NOT PROOF. Selected topic transcripts and Alternative Sources are AUDIENCE INTELLIGENCE and INTERPRETIVE INPUT only. They reveal what the fandom is debating, what's been overdone, what objections exist, and what framings are unexplored. They do NOT confirm canon facts. Any factual claim sourced from them must be flagged "needs canon validation".

3. ORIGINALITY IS THE POINT. Do not summarize the selected transcripts. Do not paraphrase their arguments closely. Do not copy creator phrasings, jokes, transitions, examples, structures, or conclusions. Your job is to help the host AVOID sounding like a remix of these creators.

4. FORMAT REFERENCE VIDEOS (if any appear in context) are STRUCTURE-ONLY references. Never treat their {{SUBJECT_LABEL}} content as factual evidence and never extract {{SUBJECT_LABEL}} claims from them.

5. If NO selected topic transcripts and NO selected Alternative Sources are attached, complete gracefully: state plainly that no selected secondary sources were provided, and produce a minimal analysis based on the Creative Brief and Insights & Research only. Do not block the pipeline. Do not invent fan signals.

OUTPUT FORMAT — produce this exact structure in markdown:

# Selected Source Analysis

## 1. Recurring Signals
The strongest recurring ideas, framings, or claims that show up across multiple selected sources. Bullet list. For each signal, briefly note which sources surfaced it (by title/channel/source name).

## 2. Overused Angles to Avoid
Specific claims, jokes, framings, or conclusions that feel too common, too obvious, or already done by these creators. Bullet list. Be specific — name the angle, do not just say "it's been done".

## 3. Underdeveloped Opportunities
Ideas the selected sources touch on but never fully exploit, escalate, or land. Bullet list with a one-sentence note on what the opportunity actually is.

## 4. Audience Objections
Objections, counterarguments, "well actually" pushback, or fan disagreements the final script should anticipate. Bullet list. Pull from comment-style alternative sources where available.

## 5. Canon Validation Needed
Claims surfaced by selected sources that sound interesting but MUST be checked against books or movie transcripts before use. Bullet list. Tag each as: [book check] / [movie transcript check] / [either].

## 6. Original Synthesis Opportunities
New conclusions or angles that emerge ONLY when the selected source signals are pressure-tested against the Insights & Research output (canon extraction). Bullet list. Each item must combine a fan/audience signal with a specific canon detail from Insights & Research and produce a non-obvious reading.

## 7. Recommended Use in Evidence Table
Candidate claims or evidence routes for the Evidence Table to consider. Bullet list. Each item MUST be labeled with one of:
- [Canon-supported] — already confirmed by Insights & Research / canon
- [Needs validation] — interesting but unverified against primary canon
- [Theory / interpretation] — defensible reading, not provable
- [Audience signal only] — useful framing or objection, not a factual claim

## 8. Recommended Use in Outline and Full Script
Concrete guidance on how this should shape: structure, pacing, re-hooks, escalation, emotional arc, audience objection handling, and final payoff. Bullet list. Be specific to this brief, not generic.

## 9. Do-Not-Copy Notes
Specific phrases, jokes, transitions, structures, conclusions, or examples from the selected sources that the script should NOT imitate. Bullet list. Quote the imitable element briefly so downstream steps can recognize and avoid it.

SOURCE HIERARCHY REMINDER:
Books and movie transcripts are Tier 1 canon. Lexicon is secondary reference. Permanent commentary transcripts and the selected secondary sources are interpretive only. Your output flows into the Evidence Table, Outline, and Full Script — those steps will treat your candidate claims as leads to validate, NOT as final proof.
`;

STEP_PROMPTS["angle_check"] = `You are a story editor stress-testing the argument for a YouTube video before any evidence is curated or structured.

You receive the Creative Brief (with its Working Thesis), the Insights & Research extraction (especially THE ANGLE, THE CONTRADICTION, and THE SUBTEXT sections), and the Selected Source Analysis (especially Underdeveloped Opportunities, Original Synthesis Opportunities, and Audience Objections).

Your single question: is the Working Thesis the strongest contention this material supports, or is there a sharper one hiding in the extraction that the brief could not have known about?

A sharper contention is one that: reframes the expected argument rather than just confirming it, explains MORE of the evidence with ONE idea, survives the strongest audience objection instead of ignoring it, or reveals a structural cause where the current thesis only describes symptoms. A contention about WHY something happened or WHY it was inevitable beats a contention that only catalogs THAT it happened.

Test honestly. Most theses should SURVIVE. Replacing a good thesis with a clever-sounding one is a failure. Only replace when the sharper contention is clearly supported by the extraction already in front of you — never invent facts about the source material, never rely on claims flagged as needing validation, never require evidence the extraction does not contain.

OUTPUT FORMAT (exactly this structure):

## Angle Check

### Verdict

One of: THESIS STANDS / THESIS SHARPENED / THESIS REPLACED

### Binding Contention

The contention every downstream step must now build toward. If the verdict is THESIS STANDS, restate the Working Thesis verbatim. If SHARPENED or REPLACED, state the new contention in one sentence.

### Reasoning

3-6 sentences. If the thesis stands, name the strongest challenger you considered and why it lost. If sharpened or replaced, name exactly which extraction findings support the new contention and what the old thesis failed to explain.

### Strongest Objection And Answer

The single strongest audience objection to the binding contention, and the one-sentence answer the script must be able to deliver.

### Consequences For The Beat Plan

2-4 bullet points: what the binding contention demands structurally — what must now be proven, what the payoff must land on, what the old framing would have wasted beats on.

Hard rules: never introduce factual claims about the source material that are not present in the upstream extraction. Never use secondary-source claims as proof. If the extraction is too thin to judge, output THESIS STANDS and say so in the reasoning.`;

const STEP_ORDER = [
  "creative_brief",
  "six_category_extraction",
  "selected_source_analysis",
  "angle_check",
  "evidence_table",
  "outline",
  "script_evidence_pack",
  "full_script",
];

type SearchSourceType = "book" | "transcript" | "lexicon" | "competitor_analysis";

type QueryPack = {
  primaryQuery: string;
  subqueries: string[];
  characterQueries: string[];
  themeQueries: string[];
  comparisonQueries: string[];
  transcriptQueries: string[];
  allQueries: string[];
  targetCharacter: string | null;
};

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "but", "of", "to", "for", "in", "on", "at", "with", "by", "from", "that", "this", "these", "those", "is", "are", "was", "were", "be", "been", "being", "as", "it", "its", "into", "about", "across", "would", "should", "could", "can", "will", "video", "argues", "show", "shows",
]);

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const dedupeStrings = (values: string[], limit?: number) => {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const raw of values) {
    const v = normalizeWhitespace(raw);
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (limit && out.length >= limit) break;
  }

  return out;
};

const compressPhrase = (value: string, maxTerms = 8) => {
  const normalized = normalizeWhitespace(value)
    .replace(/[^a-zA-Z0-9\s-]/g, " ")
    .toLowerCase();

  const terms = normalized
    .split(/\s+/)
    .filter((t) => t && t.length > 2 && !STOP_WORDS.has(t));

  return dedupeStrings(terms, maxTerms).join(" ");
};

// Strip honorifics / titles from a character name so AND-token FTS does not
// require the prefix to appear next to the name in canon text. Example:
// "Lord Voldemort" → "Voldemort", "Professor McGonagall" → "McGonagall".
// Most book/film chunks reference characters by surname or first name only,
// so multi-word "Title Name" queries return zero hits via plainto_tsquery.
const TITLE_PREFIX_RE = /^(?:lord|lady|professor|prof\.?|mr\.?|mrs\.?|ms\.?|miss|master|madam|madame|sir|dame|aunt|uncle|the)\s+/i;
const stripCharacterTitle = (name: string): string => {
  let out = normalizeWhitespace(name || "");
  // Strip repeatedly in case of stacked titles (e.g. "Professor Sir ...")
  for (let i = 0; i < 3; i++) {
    const next = out.replace(TITLE_PREFIX_RE, "");
    if (next === out) break;
    out = next;
  }
  return normalizeWhitespace(out);
};

const resolveFocusEntity = (brief: any, channel: any): string | null => {
  const characters = (brief.characters || []).map((v: string) => normalizeWhitespace(v)).filter(Boolean);
  if (characters.length > 0) {
    const first = normalizeWhitespace(characters[0].split(",")[0]);
    const stripped = stripCharacterTitle(first) || first;
    if (stripped) return stripped;
  }
  const roster: string[] = Array.isArray(channel.entity_roster) ? channel.entity_roster : [];
  const title = (brief.title || "").toLowerCase();
  for (const name of roster) {
    if (name && title.includes(name.toLowerCase())) return name;
  }
  const thesis = (brief.thesis || "").toLowerCase();
  for (const name of roster) {
    if (name && thesis.includes(name.toLowerCase())) return name;
  }
  return null;
};

// ── FOCUS-AREA EXPANSION (channel-configured) ────────────────────────────
// User-entered focus areas are typically editorial labels that do not appear
// verbatim in source text. channel.query_expansion_map translates lowercased
// focus-area substrings into token strings that DO appear in indexed chunks.
const expandFocusAreas = (focusAreas: string[], channel: any): string[] => {
  const map = (channel.query_expansion_map && typeof channel.query_expansion_map === "object" && !Array.isArray(channel.query_expansion_map))
    ? channel.query_expansion_map as Record<string, string[]>
    : {};
  const out: string[] = [];
  for (const raw of focusAreas) {
    const lower = raw.toLowerCase();
    for (const key of Object.keys(map)) {
      if (lower.includes(key)) {
        const vals = map[key];
        if (Array.isArray(vals)) out.push(...vals.filter((v) => typeof v === "string"));
      }
    }
  }
  // Cap the expansion bucket so it cannot dominate the query pack.
  return dedupeStrings(out, 12);
};

// Score how relevant a chunk is to the target character
const getCharacterRelevanceScore = (content: string, targetCharacter: string): { score: number; mentions: number; likelySpeaker: boolean } => {
  const lower = content.toLowerCase();
  const charLower = targetCharacter.toLowerCase();
  
  // Count character mentions
  const regex = new RegExp(`\\b${charLower}\\b`, 'gi');
  const mentions = (content.match(regex) || []).length;
  
  // Check if character is likely the speaker (screenplay patterns)
  const speakerPatterns = [
    new RegExp(`^${charLower}[:\\s]`, 'im'),           // "NAME: ..."
    new RegExp(`\\n${charLower}[:\\s]`, 'im'),          // newline "NAME: ..."  
    new RegExp(`^${charLower}$`, 'im'),                 // "NAME" on its own line
    new RegExp(`\\b${charLower}\\s+(says?|said|shouts?|shouted|whispers?|whispered|yells?|yelled|screams?|screamed|mutters?|muttered|snaps?|snapped|cries?|cried|asks?|asked|replies?|replied|growls?|growled)\\b`, 'i'),
  ];
  const likelySpeaker = speakerPatterns.some(p => p.test(content));
  
  // Character relevance score
  let score = 0;
  if (mentions >= 3) score += 0.3;
  else if (mentions >= 1) score += 0.15;
  if (likelySpeaker) score += 0.25;
  
  // Penalty if content is dominated by another character and target is absent
  if (mentions === 0) score -= 0.1;
  
  return { score, mentions, likelySpeaker };
};

// ─────────────────────────────────────────────────────────────────────────
// ABBREVIATION EXPANSION (channel-configured)
//
// Source text and user-authored queries often use abbreviations that do not
// match the full titles used in indexed chunk text. channel.abbreviation_map
// supplies the pairs. We expand ADDITIVELY — the original text/query is
// preserved and the expansion is appended — so existing matches are never
// lost. Pure text-augmentation; retrieval filtering and priority boosting
// are untouched.
// ─────────────────────────────────────────────────────────────────────────
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildAbbreviationPatterns = (channel: any): Array<{ pattern: RegExp; expansions: string[] }> => {
  const entries = Array.isArray(channel.abbreviation_map) ? channel.abbreviation_map : [];
  const out: Array<{ pattern: RegExp; expansions: string[] }> = [];
  for (const e of entries) {
    if (!e || typeof e.abbr !== "string" || !Array.isArray(e.expansions)) continue;
    out.push({
      pattern: new RegExp(`\\b${escapeRegExp(e.abbr)}\\b`, e.case_sensitive === false ? "gi" : "g"),
      expansions: e.expansions.filter((x: any) => typeof x === "string"),
    });
  }
  return out;
};

const expandAbbreviations = (text: string, patterns: Array<{ pattern: RegExp; expansions: string[] }>): string => {
  if (!text) return text;
  const found = new Set<string>();
  for (const { pattern, expansions } of patterns) {
    if (pattern.test(text)) {
      for (const e of expansions) found.add(e);
    }
    pattern.lastIndex = 0;
  }
  if (found.size === 0) return text;
  // Append once at the end so original text is preserved verbatim.
  return `${text}\n\n[Abbreviation expansions: ${Array.from(found).join("; ")}]`;
};

const expandAbbreviationsInQueries = (queries: string[], patterns: Array<{ pattern: RegExp; expansions: string[] }>): string[] => {
  const out: string[] = [];
  for (const q of queries) {
    if (!q) continue;
    let expanded = q;
    let touched = false;
    for (const { pattern, expansions } of patterns) {
      if (pattern.test(expanded)) {
        touched = true;
        expanded = expanded.replace(pattern, (m) => `${m} ${expansions.join(" ")}`);
      }
      pattern.lastIndex = 0;
    }
    if (touched) out.push(expanded);
  }
  return out;
};

const deriveRetrievalQueryPack = (
  brief: any,
  channel: any,
  abbrPatterns: Array<{ pattern: RegExp; expansions: string[] }>,
): QueryPack => {
  const title = normalizeWhitespace(brief.title || "");
  const thesis = normalizeWhitespace(brief.thesis || "");
  const proofGoal = normalizeWhitespace(brief.proof_goal || "");
  const focusAreas = (brief.focus_areas || []).map((v: string) => normalizeWhitespace(v)).filter(Boolean);
  const characters = (brief.characters || []).map((v: string) => normalizeWhitespace(v)).filter(Boolean);

  const targetCharacter = resolveFocusEntity(brief, channel);

  // Primary query from title + optional thesis/proofGoal
  const coreFields = [title, thesis, proofGoal].filter(Boolean);
  const primaryQuery =
    compressPhrase(coreFields.join(" "), 10) ||
    compressPhrase(title, 8) ||
    (channel.subject_label || "").toLowerCase();

  // Theme queries from focus areas (only if present)
  const themeQueries = focusAreas.length > 0
    ? dedupeStrings(focusAreas.map((area: string) => compressPhrase(area, 6)).filter(Boolean), 8)
    : [];

  // Channel-configured expansion of focus areas. Editorial focus-area phrases
  // rarely appear verbatim in source text; channel.query_expansion_map
  // translates them into token strings that DO appear in indexed chunks.
  const focusAreaCanonQueries = expandFocusAreas(focusAreas, channel);

  // Character queries (only if characters provided)
  const characterQueries = characters.length > 0
    ? dedupeStrings(characters.map((c: string) => `${compressPhrase(c, 3)} characterization`).filter((q: string) => q.trim().length > 0), 8)
    : [];

  // Build seeded subqueries from available optional fields
  const seededParts: string[] = [];
  if (targetCharacter && themeQueries.length > 0) {
    seededParts.push(...themeQueries.map((theme) => `${targetCharacter} ${theme}`));
  }
  if (focusAreaCanonQueries.length > 0) {
    seededParts.push(...focusAreaCanonQueries);
  }
  if (themeQueries.length > 0) {
    seededParts.push(...themeQueries);
  }
  if (characterQueries.length > 0) seededParts.push(...characterQueries);
  const compressedTitle = compressPhrase(title, 8);
  if (compressedTitle) seededParts.push(compressedTitle);
  if (thesis) { const ct = compressPhrase(thesis, 8); if (ct) seededParts.push(ct); }
  if (proofGoal) { const cp = compressPhrase(proofGoal, 8); if (cp) seededParts.push(cp); }

  const seededSubqueries = dedupeStrings(seededParts.filter(Boolean));

  // Transcript-specific queries — use SCREENPLAY LANGUAGE that actually appears in transcripts
  // Don't use meta-terms like "dialogue" or "confrontation scene" — use action words from scripts
  const transcriptQueries = dedupeStrings([
    ...(targetCharacter ? [
      // Focus entity name alone — matches any chunk mentioning them
      targetCharacter,
      // Action/speech verbs that appear in screenplays
      `${targetCharacter} said`,
      `${targetCharacter} shouted`,
      `${targetCharacter} yelled`,
      `${targetCharacter} snapped`,
      `${targetCharacter} whispered`,
      `${targetCharacter} angry`,
      `${targetCharacter} furious`,
      `${targetCharacter} frustrated`,
      `${targetCharacter} screamed`,
      `${targetCharacter} replied`,
      `${targetCharacter} stared`,
      `${targetCharacter} laughed`,
      `${targetCharacter} sarcastically`,
    ] : []),
    // Strip honorifics from secondary characters so AND-token FTS does not
    // require the title to co-occur with the name in chunk text.
    ...characters.slice(0, 3).map((c: string) => compressPhrase(stripCharacterTitle(c), 3)),
  ].filter(Boolean), 15);

  // Fallbacks
  const fallbackSubqueries = targetCharacter
    ? dedupeStrings([
        `${targetCharacter} characterization`,
        `${targetCharacter} sarcasm`,
        `${targetCharacter} anger`,
        `${targetCharacter} humor`,
        `${targetCharacter} agency`,
      ])
    : [];

  const subqueries = [...seededSubqueries];
  for (const fallback of fallbackSubqueries) {
    if (subqueries.length >= 5) break;
    if (!subqueries.some((q) => q.toLowerCase() === fallback.toLowerCase())) {
      subqueries.push(fallback);
    }
  }
  const trimmedSubqueries = subqueries.slice(0, 12);

  // Comparison queries
  let comparisonQueries: string[] = [];
  if (brief.comparison_mode) {
    comparisonQueries = dedupeStrings([
      ...themeQueries.slice(0, 6).map((theme) => `${theme} book vs movie`),
      ...characters.slice(0, 4).map((character: string) => `${compressPhrase(stripCharacterTitle(character), 3)} book vs movie characterization`),
      ...(targetCharacter ? [
        `${targetCharacter} personality adaptation changes`,
        `${targetCharacter} emotional intensity books and films`,
        `${targetCharacter} agency books and films`,
        `${targetCharacter} lines given to other characters`,
        `${targetCharacter} internal monologue lost in film`,
      ] : []),
    ].filter(Boolean), 12);
  }

  const allQueries = dedupeStrings([primaryQuery, ...trimmedSubqueries, ...transcriptQueries, ...comparisonQueries], 30);

  // Additive abbreviation expansion. If a query string contains a
  // channel-configured abbreviation, append a companion query with the
  // abbreviation expanded to its full form so FTS can match filenames and
  // chunk text. Originals are kept so we never lose existing matches.
  const expandedAll = expandAbbreviationsInQueries(allQueries, abbrPatterns);
  const finalAll = dedupeStrings([...allQueries, ...expandedAll], 60);

  return {
    primaryQuery,
    subqueries: trimmedSubqueries,
    characterQueries,
    themeQueries,
    comparisonQueries,
    transcriptQueries,
    allQueries: finalAll,
    targetCharacter,
  };
};

const getChunkCountByType = async (supabase: any, sourceType: SearchSourceType, channelId: string) => {
  const { data: files } = await supabase
    .from("source_files")
    .select("id")
    .eq("file_type", sourceType)
    .eq("channel_id", channelId);

  const fileIds = files?.map((f: any) => f.id) || [];
  if (fileIds.length === 0) return 0;

  const { count } = await supabase
    .from("file_chunks")
    .select("id", { count: "exact", head: true })
    .in("file_id", fileIds);

  return count ?? 0;
};

// Maps UI option labels (from the brief forms) to filename tokens used in
// source_files.file_name. The mapping comes from channel.source_catalog and is
// built per request as `priorityLabelToToken`.
const getPriorityBoost = (fileName: string, prioritySources: string[], priorityLabelToToken: Record<string, string>) => {
  if (!prioritySources.length) return 0;
  const lower = fileName.toLowerCase();
  const matched = prioritySources.some((source) => {
    const token = priorityLabelToToken[source];
    if (!token) return false;
    return lower.includes(token.toLowerCase());
  });
  return matched ? 0.15 : 0;
};

// Per-file ceiling: no single source file can contribute more than this many
// chunks to the final retrieval set, even if it dominates similarity ranking.
const PER_FILE_CEILING_PRIORITY = 10;
const PER_FILE_CEILING_DEFAULT = 6;

// Floor + ceiling quota:
//  • Caps each file at PER_FILE_CEILING (Fix 2).
//  • Reserves a minimum number of chunks per file (Fix 1 + Fix 3):
//      - Priority files:  6 (book) / 4 (transcript)
//      - Non-priority:    2 (additive — applied to every file in the pool;
//                            in comparison mode this means every file in the
//                            corpus that returned at least one chunk).
//  • If sum(floors) > totalLimit, scales floors proportionally rather than
//    dropping any file to zero.
const applyFloorAndCeilingQuota = (
  sortedChunks: any[],
  prioritySources: string[],
  totalLimit: number,
  sourceType: "book" | "transcript",
  priorityLabelToToken: Record<string, string>,
): any[] => {
  if (!sortedChunks.length || totalLimit <= 0) {
    return sortedChunks.slice(0, totalLimit);
  }

  // ── Step 1: per-file ceiling ──
  const ceilingByFile = new Map<string, any[]>();
  for (const c of sortedChunks) {
    const isPriority = prioritySources.some(p => c.file_name?.includes(p));
    const ceiling = isPriority ? PER_FILE_CEILING_PRIORITY : PER_FILE_CEILING_DEFAULT;
    const arr = ceilingByFile.get(c.file_id) || [];
    if (arr.length < ceiling) arr.push(c);
    ceilingByFile.set(c.file_id, arr);
  }
  const cappedPool = Array.from(ceilingByFile.values()).flat()
    .sort((a, b) => b._score - a._score);

  // ── Step 2: identify priority tokens (capped at 8 entries) ──
  const priorityTokens = prioritySources
    .map((s) => priorityLabelToToken[s])
    .filter(Boolean)
    .slice(0, 8)
    .map((t) => t.toLowerCase());
  const isPriorityFile = (fileName: string) => {
    const lower = (fileName || "").toLowerCase();
    return priorityTokens.some((t) => lower.includes(t));
  };

  const priorityFloor = sourceType === "book" ? 6 : 4;
  const nonPriorityFloor = 2;

  // ── Step 3: build per-file floor map (over files present in the pool) ──
  const perFileChunks = new Map<string, any[]>();
  for (const c of cappedPool) {
    const arr = perFileChunks.get(c.file_id) || [];
    arr.push(c);
    perFileChunks.set(c.file_id, arr);
  }
  const fileFloors = new Map<string, number>();
  for (const [fileId, chunks] of perFileChunks) {
    const fname = chunks[0].file_name || "";
    const wantedFloor = isPriorityFile(fname) ? priorityFloor : nonPriorityFloor;
    // Can't reserve more than we actually have for this file.
    fileFloors.set(fileId, Math.min(wantedFloor, chunks.length));
  }

  // ── Step 4: scale proportionally if total floor > limit ──
  let totalFloor = Array.from(fileFloors.values()).reduce((a, b) => a + b, 0);
  if (totalFloor > totalLimit) {
    const scale = totalLimit / totalFloor;
    let assigned = 0;
    for (const [fileId, f] of fileFloors) {
      const scaled = Math.max(1, Math.floor(f * scale));
      fileFloors.set(fileId, scaled);
      assigned += scaled;
    }
    // If rounding overshot, trim the largest floors first.
    while (assigned > totalLimit) {
      let maxFile: string | null = null;
      let maxVal = -1;
      for (const [fid, v] of fileFloors) {
        if (v > maxVal) { maxVal = v; maxFile = fid; }
      }
      if (!maxFile || maxVal <= 1) break;
      fileFloors.set(maxFile, maxVal - 1);
      assigned -= 1;
    }
    totalFloor = assigned;
  }

  // ── Step 5: reserve top-N per file from cappedPool ──
  const reserved: any[] = [];
  const reservedIds = new Set<string>();
  const perFileTaken: Record<string, number> = {};
  for (const c of cappedPool) {
    const target = fileFloors.get(c.file_id) || 0;
    const taken = perFileTaken[c.file_id] || 0;
    if (taken >= target) continue;
    reserved.push(c);
    reservedIds.add(c.id);
    perFileTaken[c.file_id] = taken + 1;
  }

  // ── Step 6: fill remaining slots with highest-scoring unreserved chunks ──
  const remainingSlots = totalLimit - reserved.length;
  const filler = remainingSlots > 0
    ? cappedPool.filter((c) => !reservedIds.has(c.id)).slice(0, remainingSlots)
    : [];

  const merged = [...reserved, ...filler];
  merged.sort((a, b) => b._score - a._score);
  return merged.slice(0, totalLimit);
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Render a quality tag for a secondary source. Null/undefined → [UNSET].
  const qualityTag = (strength: string | null | undefined): string => {
    const v = (strength || "").toLowerCase();
    if (v === "strong") return "[STRONG]";
    if (v === "useful") return "[USEFUL]";
    if (v === "limited") return "[LIMITED]";
    return "[UNSET]";
  };

  try {
    const {
      briefId,
      stepType,
      revisionFeedback,
      previousFullScript,
      hookDirection,
    } = await req.json();
    if (!stepType) throw new Error("stepType is required");
    if (!briefId) throw new Error("briefId is required");


    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY not configured");

    const supabase = createClient(supabaseUrl, supabaseKey);

    // ────────────────────────────────────────────────────────────────────────
    // SHARED GUIDANCE-LAYER LOADER
    //
    // Loads the three writing-guidance documents:
    //   1. Script Writing Instructions (file_type: 'instructions',
    //      legacy fallback 'script_strategy')
    //   2. Anti AI Writing Instructions  (file_type: 'anti_ai_guide')
    //   3. Host Persona                  (file_type: 'host_persona')
    //
    // None of these are evidence. They never override canon, source hierarchy,
    // or factual claims. Returns text + provenance metadata so we can log
    // chunks read vs total and surface truncation warnings.
    // ────────────────────────────────────────────────────────────────────────
    const GUIDANCE_CHUNK_LIMIT = 100;

    type LayerMeta = {
      text: string;
      sourceUsed: "instructions" | "script_strategy" | "anti_ai_guide" | "host_persona" | "none";
      chunksRead: number;
      totalChunks: number;
      truncated: boolean;
    };
    type GuidanceLayers = {
      scriptInstructions: LayerMeta;
      antiAiInstructions: LayerMeta;
      hostPersona: LayerMeta;
    };

    async function loadLayer(
      fileTypes: string[],
      label: LayerMeta["sourceUsed"],
    ): Promise<LayerMeta> {
      const { data: files } = await supabase
        .from("source_files")
        .select("id, file_type")
        .in("file_type", fileTypes)
        .eq("channel_id", brief.channel_id);
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
      // Determine effective source: prefer 'instructions' over legacy 'script_strategy'
      let sourceUsed: LayerMeta["sourceUsed"] = label;
      if (fileTypes.includes("instructions") || fileTypes.includes("script_strategy")) {
        const hasNew = files.some((f: any) => f.file_type === "instructions");
        const hasLegacy = files.some((f: any) => f.file_type === "script_strategy");
        sourceUsed = hasNew ? "instructions" : hasLegacy ? "script_strategy" : "none";
        if (sourceUsed === "script_strategy") {
          console.warn("DEPRECATION: 'script_strategy' file_type used for Script Writing Instructions; please re-upload as 'instructions'.");
        }
      }
      return {
        text: (chunks || []).map((c: any) => c.content).join("\n\n"),
        sourceUsed,
        chunksRead: read,
        totalChunks: total,
        truncated: total > read,
      };
    }

    async function loadGuidanceLayers(): Promise<GuidanceLayers> {
      const [scriptInstructions, antiAiInstructions, hostPersona] = await Promise.all([
        loadLayer(["instructions", "script_strategy"], "instructions"),
        loadLayer(["anti_ai_guide"], "anti_ai_guide"),
        loadLayer(["host_persona"], "host_persona"),
      ]);
      return { scriptInstructions, antiAiInstructions, hostPersona };
    }

    // ── Step-level guidance intensity configuration ────────────────────────
    type Intensity = "none" | "light" | "medium" | "strong" | "highest";
    type StepGuidanceConfig = { script: Intensity; antiAi: Intensity; persona: Intensity };
    const STEP_GUIDANCE: Record<string, StepGuidanceConfig> = {
      creative_brief:              { script: "strong",  antiAi: "light",   persona: "light"   },
      six_category_extraction:     { script: "medium",  antiAi: "light",   persona: "light"   },
      selected_source_analysis:    { script: "medium",  antiAi: "light",   persona: "light"   },
      angle_check:                 { script: "medium",  antiAi: "light",   persona: "none"   },
      evidence_table:              { script: "medium",  antiAi: "light",   persona: "light"   },
      outline:                     { script: "highest", antiAi: "strong",  persona: "none"  },
      script_evidence_pack:        { script: "strong",  antiAi: "strong",  persona: "medium"  },
      full_script:                 { script: "highest", antiAi: "highest", persona: "highest" },
      full_script_revision:        { script: "highest", antiAi: "highest", persona: "highest" },
    };

    const SCRIPT_WRAPPER = (text: string, intensity: Intensity) =>
      intensity === "none" || !text ? "" :
      `\n\n## SCRIPT WRITING INSTRUCTIONS (${intensity.toUpperCase()} BINDING)\n` +
      `Governs structure, argument, retention, escalation, evidence movement, emotional arc, and final payoff.\n` +
      `Does NOT override source evidence or canon facts.\n\n${text}`;

    const ANTI_AI_WRAPPER = (text: string, intensity: Intensity) =>
      intensity === "none" || !text ? "" :
      `\n\n## ANTI AI WRITING INSTRUCTIONS (${intensity.toUpperCase()} BINDING)\n` +
      `Governs wording, rhythm, transitions, filler removal, sentence shape, and spoken polish.\n` +
      `Does NOT change facts, thesis, section order, evidence, source meaning, or claim strength.\n\n${text}`;

    const PERSONA_WRAPPER = (text: string, intensity: Intensity) =>
      intensity === "none" || !text ? "" :
      `\n\n## PERSONA_WRAPPER (operating voice, mandatory)\n` +
      `The host persona below is the voice speaking the entire script. Every sentence must sound like this person. Their reactions, rhythm, judgment, humor, and emotional register are the medium of the script, not decoration. The viewer should know who is talking by the second sentence without being told.\n\n` +
      `The persona does not introduce themselves unless the script genuinely needs it. They do not say 'hey guys' or 'what is up'. Their presence is felt through word choice, sentence rhythm, what they react to, when they get blunt, when they get quiet.\n\n` +
      `Use 2 to 4 recognizable persona-specific lines per script maximum. Do not overload. Do not invent new catchphrases. Pull from the persona document only.\n\n` +
      `The persona does not override canon. If canon and the persona's instinct disagree, canon wins and the persona narrates the disagreement.\n\n` +
      `PERSONA DOCUMENT FOLLOWS:\n\n${text}`;

    function buildGuidanceBlock(stepType: string, layers: GuidanceLayers): string {
      const cfg = STEP_GUIDANCE[stepType] || { script: "none", antiAi: "none", persona: "none" };
      const parts = [
        SCRIPT_WRAPPER(layers.scriptInstructions.text, cfg.script),
        ANTI_AI_WRAPPER(layers.antiAiInstructions.text, cfg.antiAi),
        PERSONA_WRAPPER(layers.hostPersona.text, cfg.persona),
      ].filter(Boolean);
      const block = parts.join("");
      const order =
        `\n\n## GUIDANCE PRECEDENCE LADDER (BINDING)\n` +
        `1. Source hierarchy / canon evidence (highest)\n` +
        `2. Script Writing Instructions\n` +
        `3. Anti AI Writing Instructions\n` +
        `4. Host Persona\n` +
        `5. Step-specific prompt\n` +
        `6. User-pasted input / supporting context\n`;
      return block ? block + order : "";
    }

    function logGuidance(
      stepType: string,
      layers: GuidanceLayers,
      warnings: string[],
    ) {
      const cfg = STEP_GUIDANCE[stepType] || { script: "none", antiAi: "none", persona: "none" };
      const trunc: string[] = [];
      if (layers.scriptInstructions.truncated) trunc.push("script_instructions");
      if (layers.antiAiInstructions.truncated) trunc.push("anti_ai");
      if (layers.hostPersona.truncated)        trunc.push("host_persona");
      const docNames: Record<string, string> = {
        script_instructions: "Script Writing Instructions",
        anti_ai: "Anti-AI Writing Instructions",
        host_persona: "Host Persona",
      };
      const totals: Record<string, number> = {
        script_instructions: layers.scriptInstructions.totalChunks,
        anti_ai: layers.antiAiInstructions.totalChunks,
        host_persona: layers.hostPersona.totalChunks,
      };
      for (const t of trunc) {
        const w = `guidance_truncated:${t}`;
        warnings.push(w);
        console.warn(`WARNING: Guidance document '${docNames[t] || t}' truncated at ${GUIDANCE_CHUNK_LIMIT} chunks. Full document has ${totals[t] ?? "?"} chunks. Raise GUIDANCE_CHUNK_LIMIT to avoid partial guidance.`);
      }
      console.log("[guidance]", JSON.stringify({
        stepType,
        intensity: cfg,
        scriptInstructions: { source: layers.scriptInstructions.sourceUsed, chunksRead: layers.scriptInstructions.chunksRead, totalChunks: layers.scriptInstructions.totalChunks, truncated: layers.scriptInstructions.truncated },
        antiAi: { source: layers.antiAiInstructions.sourceUsed, chunksRead: layers.antiAiInstructions.chunksRead, totalChunks: layers.antiAiInstructions.totalChunks, truncated: layers.antiAiInstructions.truncated },
        hostPersona: { source: layers.hostPersona.sourceUsed, chunksRead: layers.hostPersona.chunksRead, totalChunks: layers.hostPersona.totalChunks, truncated: layers.hostPersona.truncated },
      }));
    }

    // Get the topic brief.
    let brief: any;
    {
      const { data: b, error: briefError } = await supabase
        .from("topic_briefs")
        .select("*")
        .eq("id", briefId)
        .single();
      if (briefError || !b) throw new Error("Brief not found");
      brief = b;
      if (!brief.channel_id) throw new Error("Brief has no channel_id");
    }

    // Load the channel config row for this brief.
    let channel: any;
    {
      const { data: c, error: channelError } = await supabase
        .from("channels")
        .select("*")
        .eq("id", brief.channel_id)
        .single();
      if (channelError || !c) throw new Error("Channel not found for brief");
      channel = c;
    }

    // Per-request channel-derived config.
    const abbrPatterns = buildAbbreviationPatterns(channel);
    const priorityLabelToToken: Record<string, string> = {};
    for (const e of (Array.isArray(channel.source_catalog) ? channel.source_catalog : [])) {
      if (e && typeof e.label === "string" && typeof e.token === "string") priorityLabelToToken[e.label] = e.token;
    }

    // Load shared guidance layers (Script Instructions, Anti-AI, Host Persona)
    // once per request. These are appended additively to every step's system
    // prompt in addition to any legacy inline injection, with intensity per
    // STEP_GUIDANCE config.
    const EMPTY_LAYER = { text: "", sourceUsed: "none" as const, chunksRead: 0, totalChunks: 0, truncated: false };
    let guidanceLayers: GuidanceLayers = {
      scriptInstructions: EMPTY_LAYER,
      antiAiInstructions: EMPTY_LAYER,
      hostPersona: EMPTY_LAYER,
    };
    try {
      guidanceLayers = await loadGuidanceLayers();
    } catch (e) {
      console.error("[guidance] loader failed — proceeding with empty guidance layers:", e);
    }
    let layeredGuidanceBlock = "";
    try {
      layeredGuidanceBlock = buildGuidanceBlock(stepType, guidanceLayers);
    } catch (e) {
      console.error("[guidance] buildGuidanceBlock failed — proceeding with no guidance block:", e);
    }
    const guidanceWarnings: string[] = [];
    try {
      logGuidance(stepType, guidanceLayers, guidanceWarnings);
    } catch (e) {
      console.error("[guidance] logGuidance failed:", e);
    }

    // Build a small SSE comment payload (ignored by EventSource clients but
    // visible in raw stream) that surfaces guidance truncation status. Also
    // appended to truncationWarnings further below for unified observability.
    const guidanceSseHeader = guidanceWarnings.length > 0
      ? `: guidance_warnings ${JSON.stringify(guidanceWarnings)}\n\n`
      : "";
    const wrapStreamWithWarnings = (upstream: ReadableStream<Uint8Array>) => {
      const header = guidanceSseHeader;
      if (!header) return upstream;
      const encoder = new TextEncoder();
      return new ReadableStream<Uint8Array>({
        async start(controller) {
          controller.enqueue(encoder.encode(header));
          const reader = upstream.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              controller.enqueue(value);
            }
          } finally {
            controller.close();
          }
        },
      });
    };

    // Fetch host persona
    const { data: personaFiles } = await supabase
      .from("source_files")
      .select("id")
      .eq("file_type", "host_persona")
      .eq("channel_id", brief.channel_id);
    let hostPersonaContext = "";
    if (personaFiles && personaFiles.length > 0) {
      const { data: personaChunks } = await supabase
        .from("file_chunks")
        .select("content")
        .in("file_id", personaFiles.map((f: any) => f.id))
        .order("chunk_index");
      hostPersonaContext = (personaChunks || []).map((c: any) => c.content).join("\n\n");
    }

    // Fetch format/topic/alt links for this brief.
    let formatRefs: any[] = [];
    let topicTranscripts: any[] = [];
    let alternativeSources: any[] = [];
    {
      const { data: formatRefLinks } = await supabase
        .from("brief_format_reference_links")
        .select("transcript_id, format_reference_transcripts(channel_name, video_title, transcript)")
        .eq("brief_id", briefId);
      formatRefs = (formatRefLinks || [])
        .map((r: any) => r.format_reference_transcripts)
        .filter(Boolean);

      const { data: topicTranscriptLinks } = await supabase
        .from("brief_topic_transcript_links")
        .select("transcript_id, brief_topic_transcripts(channel_name, video_title, transcript, script_strength)")
        .eq("brief_id", briefId);
      topicTranscripts = (topicTranscriptLinks || [])
        .map((r: any) => r.brief_topic_transcripts)
        .filter(Boolean);

      const { data: altSourceLinks } = await supabase
        .from("brief_alternative_source_links")
        .select("alternative_source_id, alternative_sources(title, source_type, source_author, url, content, script_strength)")
        .eq("brief_id", briefId);
      alternativeSources = (altSourceLinks || [])
        .map((r: any) => r.alternative_sources)
        .filter(Boolean);
    }


    // ─────────────────────────────────────────────────────────────────────
    // SECONDARY SOURCE TOKEN BUDGETS
    //
    // We have TWO budget profiles:
    //   1. SSA_PROFILE — used ONLY by selected_source_analysis. This is the
    //      "deep interpretation gateway" step. We allow much more raw text
    //      through here so the model can read selected topic transcripts
    //      and Alternative Sources thoroughly. If material is still too
    //      large, we add a visible truncation marker rather than silently
    //      dropping content.
    //   2. CREATIVE_BRIEF_PROFILE — used ONLY by creative_brief. Selected
    //      secondaries are still useful here for early angle setup, but we
    //      keep the budget moderate to avoid prompt overload.
    //
    // No other step (evidence_table, outline, full_script, revision,
    // final pass) receives raw selected topic transcripts or raw
    // Alternative Sources. They consume the Selected Source Analysis
    // OUTPUT instead, via previousContext.
    // ─────────────────────────────────────────────────────────────────────
    type BudgetProfile = "ssa" | "creative_brief";
    const TRANSCRIPT_BUDGETS: Record<BudgetProfile, { perItem: number; total: number }> =
      { ssa: { perItem: 60000, total: 280000 }, creative_brief: { perItem: 12000, total: 80000 } };
    const ALT_BUDGETS: Record<BudgetProfile, { perItem: number; total: number }> =
      { ssa: { perItem: 40000, total: 160000 }, creative_brief: { perItem: 8000, total: 40000 } };


    // Visible warnings collected per request for log/observability.
    const truncationWarnings: string[] = [];

    const formatAlternativeSourcesBlock = (label: string, profile: BudgetProfile): string => {
      if (alternativeSources.length === 0) return "";
      const { perItem, total: maxTotal } = ALT_BUDGETS[profile];
      let total = 0;
      const parts: string[] = [];
      let skipped = 0;
      for (const s of alternativeSources) {
        // Expand channel-configured abbreviations in
        // the source body before the per-item cap. The original text is
        // preserved verbatim; expansions are appended in a trailing note.
        const raw = expandAbbreviations((s.content || "").toString(), abbrPatterns);
        let capped = raw;
        if (raw.length > perItem) {
          capped = raw.slice(0, perItem) +
            `\n\n[!! ALT SOURCE TRUNCATED — read ${perItem} of ${raw.length} chars (profile=${profile}). Important material after this point was not included.]`;
          truncationWarnings.push(`alt_source_per_item_truncated:${s.title}:${raw.length}->${perItem}`);
        }
        if (total + capped.length > maxTotal) {
          skipped += 1;
          continue;
        }
        const meta = [s.source_type, s.source_author, s.url].filter(Boolean).join(" • ");
        parts.push(`### "${s.title}" ${qualityTag(s.script_strength)}${meta ? ` (${meta})` : ""}\n${capped}`);
        total += capped.length;
      }
      if (parts.length === 0) return "";
      let footer = "";
      if (skipped > 0) {
        const msg = `[!! ${skipped} alternative source(s) were NOT included because the bundle exceeded the ${maxTotal}-char budget for profile=${profile}.]`;
        footer = `\n\n${msg}`;
        truncationWarnings.push(`alt_sources_dropped:${skipped}:profile=${profile}`);
      }
      return `\n\n## ${label} (SECONDARY, NON-CANON)\nThese are pasted secondary sources such as Reddit threads, fan comments, wiki extracts, blog posts, or research notes. Use ONLY for fan debate signals, audience language, jokes, cultural references, angle inspiration, and supporting interpretation. NEVER treat as Tier 1 canon. Do NOT cite as primary evidence. All factual canon claims must still be supported by book/movie sources.\n\n${parts.join("\n\n---\n\n")}${footer}`;
    };

    const truncateTopicTranscripts = (items: any[], profile: BudgetProfile): any[] => {
      const { perItem, total: maxTotal } = TRANSCRIPT_BUDGETS[profile];
      let total = 0;
      const out: any[] = [];
      let skipped = 0;
      for (const r of items) {
        const raw = (r.transcript || "").toString();
        let perCap = raw;
        if (raw.length > perItem) {
          perCap = raw.slice(0, perItem) +
            `\n\n[!! TOPIC TRANSCRIPT TRUNCATED — read ${perItem} of ${raw.length} chars (profile=${profile}). Material beyond this point was not included.]`;
          truncationWarnings.push(`topic_transcript_per_item_truncated:${r.video_title}:${raw.length}->${perItem}`);
        }
        if (total + perCap.length > maxTotal) {
          const remaining = Math.max(0, maxTotal - total);
          if (remaining > 1000) {
            const tail = perCap.slice(0, remaining) +
              `\n\n[!! TOPIC TRANSCRIPT TRUNCATED at total budget — added ${remaining} of ${perCap.length} chars from this item (profile=${profile}).]`;
            out.push({ ...r, transcript: tail });
            total += remaining;
            truncationWarnings.push(`topic_transcript_total_budget_clip:${r.video_title}:profile=${profile}`);
          } else {
            skipped += 1;
          }
          // Mark anything left as skipped
          const idx = items.indexOf(r);
          skipped += Math.max(0, items.length - idx - 1);
          break;
        }
        out.push({ ...r, transcript: perCap });
        total += perCap.length;
      }
      if (skipped > 0) {
        truncationWarnings.push(`topic_transcripts_dropped:${skipped}:profile=${profile}`);
      }
      return out;
    };

    const buildSecondarySkippedNotice = (): string => {
      if (truncationWarnings.length === 0) return "";
      return `\n\n[CONTEXT TRUNCATION NOTICE]\n${truncationWarnings.map((w) => `- ${w}`).join("\n")}\n`;
    };

    // ── CREATIVE BRIEF STEP ──
    if (stepType === "creative_brief") {
      if (formatRefs.length === 0) {
        throw new Error("No format reference transcripts linked to this brief. Please add at least one format reference in the Transcript Library before generating the Creative Brief.");
      }

      const formatRefBlock = formatRefs
        .map((r: any) => `### Format Reference: "${r.video_title}" by ${r.channel_name}\nIMPORTANT: This is from a different subject. Use for structure and positioning only — never for {{SUBJECT_LABEL}} content.\n\n${r.transcript}`)
        .join("\n\n---\n\n");

      const topicTranscriptBlock = topicTranscripts.length > 0
        ? truncateTopicTranscripts(topicTranscripts, "creative_brief")
            .map((r: any) => `### Topic Transcript: "${r.video_title}" by ${r.channel_name} ${qualityTag(r.script_strength)}\nUse for research leads and angle awareness. Tier behavior governed by quality tag — see Source Hierarchy.\n\n${r.transcript}`)
            .join("\n\n---\n\n")
        : "No brief-specific topic transcripts provided for this brief.";

      // Guidance (Script Writing, Anti-AI, Host Persona) is injected solely via
      // the unified buildGuidanceBlock() output (`layeredGuidanceBlock`).
      // Legacy double-injection of the Master Guide here was removed to keep
      // a single source of guidance.
      let systemPrompt = STEP_PROMPTS["creative_brief"];
      systemPrompt += layeredGuidanceBlock;

      const userMessage = `## Video Title
${brief.title}

## Creator's Raw Angle (preserve framings and wording where fields allow)
${brief.angle_note || brief.description || "(No angle note provided)"}
${brief.creative_brief_feedback ? `\n## Creator Feedback on Previous Creative Brief (BINDING — address these revisions in this regeneration)\n${brief.creative_brief_feedback}\n` : ""}
## Format Reference Transcripts (different subject — structure and positioning only)
${formatRefBlock}

## Brief-Specific Topic Transcripts (research leads — confirm all claims in primary canon)
${topicTranscriptBlock}${formatAlternativeSourcesBlock("Alternative Sources", "creative_brief")}${buildSecondarySkippedNotice()}

Generate the Creative Brief now.`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: getModelForStep(stepType),
          messages: [
            { role: "system", content: applyChannelPlaceholders(systemPrompt, channel) },
            { role: "user", content: applyChannelPlaceholders(userMessage, channel) },
          ],
          stream: true,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (response.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted." }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        const t = await response.text();
        throw new Error(`AI gateway error: ${response.status} ${t}`);
      }

      return new Response(wrapStreamWithWarnings(response.body!), {
        headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
      });
    }

    // Build compact retrieval query pack from brief fields (brief stays rich for generation)
    // TODO: Add hybrid semantic/vector retrieval later using embeddings and pgvector. Current retrieval is keyword/full text search only.
    const queryPack = deriveRetrievalQueryPack(brief, channel, abbrPatterns);
    const prioritySources = (brief.priority_sources || [])
      .map((s: string) => normalizeWhitespace(s))
      .filter(Boolean);

    // In comparison mode, use higher per-query limits for books & transcripts to ensure balance
    const isComparison = brief.comparison_mode || false;
    const bookPerQuery = isComparison ? 10 : 8;
    const transcriptPerQuery = isComparison ? 10 : 8;
    const lexiconPerQuery = isComparison ? 3 : 4;

    // For transcript retrieval, use transcript-specific queries IN ADDITION to main queries
    const bookQueries = queryPack.allQueries;
    const transcriptSearchQueries = dedupeStrings([...queryPack.allQueries, ...queryPack.transcriptQueries], 35);
    const lexiconQueries = queryPack.allQueries;

    const retrievalPlan: { query: string; sourceType: SearchSourceType; maxResults: number }[] = [
      ...bookQueries.map((query) => ({ query, sourceType: "book" as const, maxResults: bookPerQuery })),
      ...transcriptSearchQueries.map((query) => ({ query, sourceType: "transcript" as const, maxResults: transcriptPerQuery })),
      ...lexiconQueries.map((query) => ({ query, sourceType: "lexicon" as const, maxResults: lexiconPerQuery })),
      // Commentary Transcripts — searched for idea discovery only, limited results
      ...queryPack.allQueries.slice(0, 5).map((query) => ({ query, sourceType: "competitor_analysis" as const, maxResults: 5 })),
    ];

    // ── Hybrid vector search (always on) ──
    // Runs FTS + pgvector match_chunks per (query, source) and fuses with
    // Reciprocal Rank Fusion. All downstream scoring (priority boost,
    // primary-query boost, character boost, floor quota) is unchanged.
    const useVectorSearch = true;
    const hybridArmDiagnostics: any[] = [];

    const perQueryCounts: Record<string, { book: number; transcript: number; lexicon: number }> = {};
    const mergedByType: Record<SearchSourceType, Map<string, any>> = {
      book: new Map(),
      transcript: new Map(),
      lexicon: new Map(),
      competitor_analysis: new Map(),
    };

    const targetCharacter = queryPack.targetCharacter;
    const targetCharacterLabel = targetCharacter ?? "none";

    if (stepType === "full_script" || stepType === "angle_check") {
      // Retrieval skipped: the Full Script user message omits Source Material
      // Excerpts and the Retrieval Query Pack, so nothing from retrieval is used.
      // Angle Check reads previous outputs only and runs no retrieval of its own.
      console.log(`[generate-step] ${stepType} — skipping retrieval query pack search calls`);
    } else if (!useVectorSearch) {
      // ── Original FTS-only path (UNCHANGED for real pipeline) ──
      const retrievalResponses = await Promise.all(
        retrievalPlan.map((plan) =>
          supabase.rpc("search_chunks_by_type", {
            search_query: plan.query,
            source_type: plan.sourceType,
            p_channel_id: brief.channel_id,
            max_results: plan.maxResults,
          }),
        ),
      );

      retrievalPlan.forEach((plan, idx) => {
        const rows = retrievalResponses[idx].data || [];

        if (!perQueryCounts[plan.query]) {
          perQueryCounts[plan.query] = { book: 0, transcript: 0, lexicon: 0 };
        }
        perQueryCounts[plan.query][plan.sourceType] = rows.length;

        rows.forEach((row: any) => {
          const priorityBoost = getPriorityBoost(row.file_name || "", prioritySources, priorityLabelToToken);
          const primaryQueryBoost = plan.query === queryPack.primaryQuery ? 0.05 : 0;

          // Character relevance boost — especially important for transcripts
          const charRelevance = targetCharacter
            ? getCharacterRelevanceScore(row.content || "", targetCharacter)
            : { score: 0, mentions: 0, likelySpeaker: false };
          const charBoost = plan.sourceType === "transcript" ? charRelevance.score * 1.5 : charRelevance.score * 0.5;

          const score = (row.rank ?? 0) + priorityBoost + primaryQueryBoost + charBoost;

          const existing = mergedByType[plan.sourceType].get(row.id);
          if (!existing || score > existing._score) {
            mergedByType[plan.sourceType].set(row.id, {
              ...row,
              _score: score,
              _matched_query: plan.query,
              _char_mentions: charRelevance.mentions,
              _char_likely_speaker: charRelevance.likelySpeaker,
            });
          }
        });
      });
    } else {
      // ── Hybrid FTS + Vector with Reciprocal Rank Fusion (standard path) ──
      console.log("[generate-step] HYBRID VECTOR SEARCH ENABLED (standard retrieval path)");

      // 1. Embed every unique query string ONCE.
      const uniqueQueries = Array.from(new Set(retrievalPlan.map((p) => p.query)));
      const embeddings = await embedQueriesBatch(uniqueQueries);
      const queryToEmbedding = new Map<string, number[] | null>();
      uniqueQueries.forEach((q, i) => queryToEmbedding.set(q, embeddings[i]));
      const embeddingFailures = embeddings.filter((e) => e === null).length;
      if (embeddingFailures === uniqueQueries.length) {
        console.warn("[generate-step] All embeddings failed — vector arm will be empty, FTS arm still runs.");
      }

      // 2. For each (query, sourceType) plan item, run FTS + vector in parallel.
      const armResults = await Promise.all(
        retrievalPlan.map(async (plan) => {
          const emb = queryToEmbedding.get(plan.query);
          const [ftsRes, vecRes] = await Promise.all([
            supabase.rpc("search_chunks_by_type", {
              search_query: plan.query,
              source_type: plan.sourceType,
              p_channel_id: brief.channel_id,
              max_results: plan.maxResults,
            }),
            emb
              ? supabase.rpc("match_chunks", {
                  query_embedding: `[${emb.join(",")}]`,
                  source_type: plan.sourceType,
                  p_channel_id: brief.channel_id,
                  k: plan.maxResults,
                })
              : Promise.resolve({ data: [] as any[], error: null }),
          ]);
          return {
            plan,
            ftsRows: (ftsRes.data || []) as any[],
            vecRows: (vecRes.data || []) as any[],
          };
        }),
      );

      // 3. Per plan item: RRF-fuse FTS + vector, then apply existing boosts.
      armResults.forEach(({ plan, ftsRows, vecRows }) => {
        if (!perQueryCounts[plan.query]) {
          perQueryCounts[plan.query] = { book: 0, transcript: 0, lexicon: 0 };
        }

        // Build per-chunk RRF state for THIS plan item.
        const fused = new Map<string, { row: any; rrf: number; ftsRank: number | null; vecRank: number | null }>();
        ftsRows.forEach((row: any, i: number) => {
          fused.set(row.id, {
            row,
            rrf: 1 / (RRF_K + i + 1),
            ftsRank: i + 1,
            vecRank: null,
          });
        });
        vecRows.forEach((row: any, i: number) => {
          const cur = fused.get(row.id);
          if (cur) {
            cur.rrf += 1 / (RRF_K + i + 1);
            cur.vecRank = i + 1;
          } else {
            fused.set(row.id, {
              // match_chunks returns `similarity` instead of `rank`; normalise so
              // downstream logging that reads `row.rank` doesn't blow up.
              row: { ...row, rank: row.similarity ?? 0 },
              rrf: 1 / (RRF_K + i + 1),
              ftsRank: null,
              vecRank: i + 1,
            });
          }
        });

        perQueryCounts[plan.query][plan.sourceType] = fused.size;

        fused.forEach(({ row, rrf, ftsRank, vecRank }) => {
          const priorityBoost = getPriorityBoost(row.file_name || "", prioritySources, priorityLabelToToken);
          const primaryQueryBoost = plan.query === queryPack.primaryQuery ? 0.05 : 0;
          const charRelevance = targetCharacter
            ? getCharacterRelevanceScore(row.content || "", targetCharacter)
            : { score: 0, mentions: 0, likelySpeaker: false };
          const charBoost = plan.sourceType === "transcript" ? charRelevance.score * 1.5 : charRelevance.score * 0.5;

          // Scale RRF by 10 so its magnitude (~0.0–0.33) sits in the same range
          // as ts_rank-based scores (~0.05–0.5), letting the existing boosts
          // (+0.15 priority, +0.05 primary) keep their intended weight.
          const score = rrf * 10 + priorityBoost + primaryQueryBoost + charBoost;

          const existing = mergedByType[plan.sourceType].get(row.id);
          if (!existing || score > existing._score) {
            mergedByType[plan.sourceType].set(row.id, {
              ...row,
              _score: score,
              _matched_query: plan.query,
              _char_mentions: charRelevance.mentions,
              _char_likely_speaker: charRelevance.likelySpeaker,
              _fts_rank: ftsRank,
              _vec_rank: vecRank,
              _rrf: rrf,
            });
          }
        });

        // Per-arm top-5 for retrieval logging.
        hybridArmDiagnostics.push({
          query: plan.query,
          source_type: plan.sourceType,
          fts_top: ftsRows.slice(0, 5).map((r: any, i: number) => ({
            rank: i + 1,
            file: r.file_name,
            score: Number((r.rank ?? 0).toFixed(4)),
            id: r.id,
          })),
          vec_top: vecRows.slice(0, 5).map((r: any, i: number) => ({
            rank: i + 1,
            file: r.file_name,
            similarity: Number((r.similarity ?? 0).toFixed(4)),
            id: r.id,
          })),
          fused_count: fused.size,
        });
      });
    }

    // In comparison mode, enforce balanced limits; otherwise use standard limits.
    // Test mode caps every source type at 10 chunks (per spec).
    const bookLimit = isComparison ? 20 : 20;
    const transcriptLimit = isComparison ? 20 : 20;
    const lexiconLimit = isComparison ? 5 : 10;

    const bookChunksSorted = Array.from(mergedByType.book.values())
      .sort((a, b) => b._score - a._score);
    const bookChunks = applyFloorAndCeilingQuota(bookChunksSorted, prioritySources, bookLimit, "book", priorityLabelToToken);

    // For transcripts: filter out chunks where target character has zero mentions (unless very few results)
    const allTranscriptChunks = Array.from(mergedByType.transcript.values())
      .sort((a, b) => b._score - a._score);
    const relevantTranscripts = allTranscriptChunks.filter((c) => c._char_mentions > 0);
    const droppedTranscripts = allTranscriptChunks.length - relevantTranscripts.length;
    // Use relevant ones if we have enough, otherwise fall back to all
    const transcriptPool = relevantTranscripts.length >= 3 ? relevantTranscripts : allTranscriptChunks;
    const transcriptChunks = applyFloorAndCeilingQuota(transcriptPool, prioritySources, transcriptLimit, "transcript", priorityLabelToToken);

    const lexiconChunks = Array.from(mergedByType.lexicon.values())
      .sort((a, b) => b._score - a._score)
      .slice(0, lexiconLimit);

    // Commentary Transcripts — for idea discovery only, limited
    const commentaryChunks = Array.from(mergedByType.competitor_analysis.values())
      .sort((a, b) => b._score - a._score)
      .slice(0, 8);

    // Get total indexed chunk counts for debug
    const [bookChunkCount, transcriptChunkCount, lexiconChunkCount] = await Promise.all([
      getChunkCountByType(supabase, "book", brief.channel_id),
      getChunkCountByType(supabase, "transcript", brief.channel_id),
      getChunkCountByType(supabase, "lexicon", brief.channel_id),
    ]);

    const matchesPerQuery = queryPack.allQueries.map((query) => ({
      query,
      ...(perQueryCounts[query] || { book: 0, transcript: 0, lexicon: 0 }),
    }));

    // Debug block for retrieval diagnostics
    const transcriptMatchesPerQuery = [...new Set([...queryPack.allQueries, ...queryPack.transcriptQueries])].map((q) => ({
      query: q,
      transcript_matches: perQueryCounts[q]?.transcript ?? 0,
    })).filter((m) => m.transcript_matches > 0);

    const transcriptCharMentions = transcriptChunks.filter((c) => c._char_mentions > 0).length;
    const transcriptLikelySpeaker = transcriptChunks.filter((c) => c._char_likely_speaker).length;

    const debugInfo = {
      target_character: targetCharacterLabel,
      derived_query_pack: {
        primary_query: queryPack.primaryQuery,
        subqueries: queryPack.subqueries,
        character_queries: queryPack.characterQueries,
        theme_queries: queryPack.themeQueries,
        transcript_queries: queryPack.transcriptQueries,
        comparison_queries: queryPack.comparisonQueries,
        comparison_expanded: queryPack.comparisonQueries.length > 0,
      },
      comparison_mode: isComparison,
      filters_applied: {
        source_types_searched: ["book", "transcript", "lexicon"],
        instructions_excluded_from_evidence: true,
        priority_sources_mode: "soft_boost_plus_floor_quota",
        priority_sources_value: prioritySources,
        strict_source_filter: false,
      },
      indexed_chunks: {
        book: bookChunkCount,
        transcript: transcriptChunkCount,
        lexicon: lexiconChunkCount,
      },
      matches_returned: {
        book: bookChunks.length,
        transcript: transcriptChunks.length,
        lexicon: lexiconChunks.length,
      },
      transcript_debug: {
        transcript_specific_queries_used: queryPack.transcriptQueries,
        transcript_chunks_actually_searched: transcriptChunkCount > 0,
        transcript_matches_per_query: transcriptMatchesPerQuery,
        transcript_overwhelmed_by_books: transcriptChunks.length === 0 && bookChunks.length > 5,
        transcript_character_relevance: {
          target_character: targetCharacterLabel,
          chunks_mentioning_character: transcriptCharMentions,
          chunks_character_likely_speaker: transcriptLikelySpeaker,
          chunks_dropped_for_low_relevance: droppedTranscripts,
          total_raw_transcript_matches: allTranscriptChunks.length,
        },
      },
      matches_per_query_and_source: matchesPerQuery,
    };
    console.log("RETRIEVAL DEBUG:", JSON.stringify(debugInfo, null, 2));

    // Get previous pipeline outputs for this brief.
    const stepIndex = STEP_ORDER.indexOf(stepType);
    const previousSteps = STEP_ORDER.slice(0, stepIndex);
    let previousOutputs: { step_type: string; content: string }[] | null = null;
    {
      const { data } = await supabase
        .from("pipeline_outputs")
        .select("step_type, content")
        .eq("brief_id", briefId)
        .in("step_type", previousSteps)
        .order("created_at");
      previousOutputs = data as any;
    }

    // Build context grouped by source type — NEVER include instructions as evidence
    const totalMatches = bookChunks.length + transcriptChunks.length + lexiconChunks.length;
    let sourceContext: string;

    if (totalMatches === 0) {
      // STRICT: No fallback to general knowledge
      sourceContext = `## RETRIEVAL FAILURE — NO INDEXED MATCHES FOUND FOR DERIVED QUERY PACK
- **Status**: No indexed matches found for the derived query pack
- **Source types searched**: book, transcript, lexicon
- **Filters applied**: file_type scoped search; priority_sources soft boost in ranking only (never a hard filter)
- **Primary query**: ${queryPack.primaryQuery}
- **Compact queries used**:
${queryPack.allQueries.map((q, i) => `  ${i + 1}. ${q}`).join("\n")}
- **Likely reason**: ${debugInfo.indexed_chunks.book === 0 && debugInfo.indexed_chunks.transcript === 0 ? "No primary source files have been uploaded and processed yet." : "Derived queries did not match indexed chunk text. Try clearer trait/action keywords in title, thesis, focus areas, characters, or proof goal."}

DO NOT use general ${channel.subject_label} knowledge. DO NOT generate placeholder evidence. Return a retrieval failure report ONLY.`;
    } else {
      const sections: string[] = [];
      // Add debug summary at top
      sections.push(`## Retrieval Debug Summary
- Primary query: ${queryPack.primaryQuery}
- Subqueries (${queryPack.subqueries.length}): ${queryPack.subqueries.length ? queryPack.subqueries.join(" | ") : "none"}
- Character queries (${queryPack.characterQueries.length}): ${queryPack.characterQueries.length ? queryPack.characterQueries.join(" | ") : "none"}
- Theme queries (${queryPack.themeQueries.length}): ${queryPack.themeQueries.length ? queryPack.themeQueries.join(" | ") : "none"}
- Transcript-specific queries (${queryPack.transcriptQueries.length}): ${queryPack.transcriptQueries.length ? queryPack.transcriptQueries.join(" | ") : "none"}
- Comparison query expansion: ${queryPack.comparisonQueries.length > 0 ? "ON" : "OFF"}
- Comparison mode: ${isComparison ? "ON" : "OFF"}
- Book matches: ${bookChunks.length}
- Transcript matches: ${transcriptChunks.length}
- Lexicon matches: ${lexiconChunks.length}
- Priority sources mode: soft boost + floor quota (min 3 per priority file)
- Transcript chunks indexed: ${transcriptChunkCount}
- Transcript overwhelmed by books: ${transcriptChunks.length === 0 && bookChunks.length > 5 ? "YES — WARNING" : "No"}`);

      sections.push("### Query-Level Match Counts\n" + matchesPerQuery.map((m) => `- ${m.query} → book=${m.book}, transcript=${m.transcript}, lexicon=${m.lexicon}`).join("\n"));

      // Transcript-specific debug
      sections.push(`### Transcript Retrieval Debug
- Target character: ${targetCharacterLabel}
- Transcript-specific queries used: ${queryPack.transcriptQueries.length}
- Transcript chunks in index: ${transcriptChunkCount}
- Transcript matches returned: ${transcriptChunks.length}
- Transcript chunks mentioning ${targetCharacterLabel}: ${transcriptCharMentions}
- Transcript chunks where ${targetCharacterLabel} is likely speaker: ${transcriptLikelySpeaker}
- Transcript chunks dropped for low relevance: ${droppedTranscripts}
- Total raw transcript matches before filtering: ${allTranscriptChunks.length}
- Transcript query hit rate: ${queryPack.transcriptQueries.filter((q) => (perQueryCounts[q]?.transcript ?? 0) > 0).length}/${queryPack.transcriptQueries.length}`);

      if (bookChunks.length > 0) {
        sections.push("### PRIMARY SOURCES — Books (Book Evidence)\n" +
          bookChunks.map((c: any) => `[${c.file_name} — BOOK — PRIMARY | matched: "${c._matched_query}" | ${targetCharacterLabel} mentions: ${c._char_mentions ?? 0}]\n${c.content}`).join("\n\n---\n\n"));
      }
      if (transcriptChunks.length > 0) {
        sections.push("### PRIMARY SOURCES — Movie Transcripts (Movie Evidence)\n" +
          transcriptChunks.map((c: any) => `[${c.file_name} — TRANSCRIPT — PRIMARY | matched: "${c._matched_query}" | ${targetCharacterLabel} mentions: ${c._char_mentions ?? 0} | likely speaker: ${c._char_likely_speaker ? "YES" : "no"}]\n${c.content}`).join("\n\n---\n\n"));
      }

      // Possible Contrast Pairs (comparison mode or when both families have results)
      if (bookChunks.length > 0 && transcriptChunks.length > 0) {
        const contrastPairs: string[] = [];
        const usedTranscripts = new Set<string>();
        for (const book of bookChunks.slice(0, 8)) {
          // Find a transcript chunk matched on a similar query
          const candidate = transcriptChunks.find((t: any) =>
            !usedTranscripts.has(t.id) && (
              t._matched_query === book._matched_query ||
              t.file_name?.toLowerCase().includes(book.file_name?.toLowerCase().split(" ")[0]) ||
              false
            )
          );
          if (candidate) {
            usedTranscripts.add(candidate.id);
            contrastPairs.push(`**Book**: [${book.file_name}] ${book.content.slice(0, 200)}...\n**Movie**: [${candidate.file_name}] ${candidate.content.slice(0, 200)}...`);
          }
        }
        if (contrastPairs.length > 0) {
          sections.push("### Possible Contrast Pairs\n" + contrastPairs.join("\n\n---\n\n"));
        }
      }

      if (lexiconChunks.length > 0) {
        sections.push("### SECONDARY REFERENCE — Lexicon Support (use for context only, NOT as primary canon)\n" +
          lexiconChunks.map((c: any) => `[${c.file_name} — LEXICON — SECONDARY]\n${c.content}`).join("\n\n---\n\n"));
      }

      // Commentary Angles — secondary commentary context, NOT evidence
      if (commentaryChunks.length > 0) {
        const commentaryFileIds = Array.from(new Set(commentaryChunks.map((c: any) => c.file_id))).filter(Boolean);
        const fileStrengthMap = new Map<string, string | null>();
        if (commentaryFileIds.length > 0) {
          const { data: strengthRows } = await supabase
            .from("source_files")
            .select("id, script_strength")
            .in("id", commentaryFileIds as string[]);
          for (const row of (strengthRows || []) as any[]) {
            fileStrengthMap.set(row.id, row.script_strength);
          }
        }
        sections.push("### COMMENTARY ANGLES (Secondary — Quality-tagged)\nThese are from YouTube commentary transcripts. Each excerpt carries a quality tag. The tag governs reliability per the Source Hierarchy (Tier 2.5–2.7). Source names never appear in the final script — the writer absorbs and rephrases regardless of tier.\n" +
          commentaryChunks.map((c: any) => {
            const tag = qualityTag(fileStrengthMap.get(c.file_id));
            return `[${c.file_name} — COMMENTARY ${tag}]\n${c.content}`;
          }).join("\n\n---\n\n"));
      }

      // Retrieval gaps
      const gaps: string[] = [];
      if (bookChunks.length === 0) gaps.push("- No book evidence found");
      if (transcriptChunks.length === 0) gaps.push("- No movie transcript evidence found");
      if (isComparison && (bookChunks.length === 0 || transcriptChunks.length === 0)) {
        gaps.push("- Comparison mode is ON but one source family returned zero results");
      }
      if (gaps.length > 0) {
        sections.push("### Retrieval Gaps\n" + gaps.join("\n"));
      }

      sourceContext = sections.join("\n\n========\n\n");
    }

    // Per-entry cap on previous pipeline outputs to prevent cumulative bloat
    // in late steps (Outline, Full Script, Revision). The SSA output is the
    // distilled gateway for selected secondary sources, so we let it through
    // at full size. Other earlier outputs are capped with a visible marker.
    const PREV_OUTPUT_CAP_DEFAULT = 8000;
    const PREV_OUTPUT_CAP_LARGE = 20000; // SSA & Evidence Table can be longer
    const capPreviousOutput = (stepName: string, content: string): string => {
      const cap =
        stepName === "selected_source_analysis" || stepName === "evidence_table" || stepName === "script_evidence_pack"
          ? PREV_OUTPUT_CAP_LARGE
          : PREV_OUTPUT_CAP_DEFAULT;
      if (content.length <= cap) return content;
      truncationWarnings.push(`previous_output_capped:${stepName}:${content.length}->${cap}`);
      return content.slice(0, cap) +
        `\n\n[!! PREVIOUS OUTPUT TRUNCATED — kept ${cap} of ${content.length} chars from ${stepName} to control prompt size. Earlier sections preserved; tail dropped.]`;
    };
    // Default previousContext: all upstream steps. Full Script overrides this
    // below so it sees ONLY the Creative Brief and the Script Evidence Pack.
    let previousContext = previousOutputs && previousOutputs.length > 0
      ? previousOutputs
          .map((o: any) => `### ${o.step_type.replace(/_/g, " ").toUpperCase()}\n${capPreviousOutput(o.step_type, o.content || "")}`)
          .join("\n\n")
      : "";

    // ── APPROVED EVIDENCE INJECTION (Beat Plan / SEP) ──────────────────────
    // The Beat Plan (outline) and Script Evidence Pack are built before the
    // Full Script, so we surface approved high-risk evidence + their author
    // notes here as well, so the model can honour the user's per-point
    // guidance ("use carefully", "frame as interpretation only", etc.) while
    // structuring the script.
    if (stepType === "outline" || stepType === "script_evidence_pack") {
      try {
        const { data: evRows } = await supabase
          .from("evidence_points")
          .select("*")
          .eq("brief_id", briefId)
          .order("created_at", { ascending: true });
        const approved = (evRows || []).filter(
          (r: any) => r.approval_status !== "rejected",
        );
        if (approved.length > 0) {
          const lines: string[] = [
            "### APPROVED EVIDENCE POINTS (BINDING WHITELIST — only these claims may be used; any AUTHOR NOTE attached to a point must be honoured when planning beats / building the SEP)",
            "Approval notes attached to evidence points are binding constraints, not optional guidance. If a note specifies a condition (e.g. 'only use after pairing with X evidence,' 'frame as interpretation only,' 'avoid treating as a universal rule'), that condition must be met. If the condition cannot be met with the available evidence, narrow the claim, omit the contrast, or use different evidence entirely. Do not use the evidence as if the condition does not exist.",
          ];
          approved.forEach((r: any, i: number) => {
            const block: string[] = [`#${i + 1} Claim: ${r.claim}`];
            if (r.source_file) block.push(`Source File: ${r.source_file}`);
            block.push(`Source Type: ${r.source_type}`);
            block.push(`Confidence: ${r.confidence} | Evidence Type: ${r.evidence_type}`);
            if (r.book_evidence) block.push(`Book Evidence: ${r.book_evidence}`);
            if (r.movie_evidence) block.push(`Movie Evidence: ${r.movie_evidence}`);
            if (r.difference_note) block.push(`Contrast: ${r.difference_note}`);
            if (r.exact_quote) block.push(`Micro-Quote: ${r.exact_quote}`);
            if (r.paraphrase) block.push(`Paraphrase: ${r.paraphrase}`);
            if (r.lexicon_support) block.push(`Lexicon Support: ${r.lexicon_support}`);
            if (r.secondary_source_support) block.push(`Secondary Source Support: ${r.secondary_source_support}`);
            if (r.why_this_matters) block.push(`Why This Matters: ${r.why_this_matters}`);
            if (r.commentary_angle) block.push(`Commentary Angle: ${r.commentary_angle}`);
            if (r.approval_note) block.push(`AUTHOR NOTE (binding): ${r.approval_note}`);
            lines.push(block.join("\n"));
          });
          previousContext = previousContext
            ? `${previousContext}\n\n${lines.join("\n\n")}`
            : lines.join("\n\n");
        }
      } catch (err) {
        console.warn("Failed to load approved evidence_points for", stepType, err);
      }
    }

    // ── FULL SCRIPT TRANSFORMATION BOUNDARY ────────────────────────────────
    // The Full Script reads ONLY the Creative Brief (argument framing) and
    // the Script Evidence Pack (canon, beat-mapped). It must NOT see the
    // Evidence Table, Beat Plan (outline), Selected Source Analysis, or
    // Six Category Extraction directly. If the Pack is missing, fail loudly.
    if (stepType === "full_script") {
      const cbEntry = (previousOutputs || []).find((o: any) => o.step_type === "creative_brief");
      const packEntry = (previousOutputs || []).find((o: any) => o.step_type === "script_evidence_pack");
      if (!packEntry || !packEntry.content) {
        return new Response(
          JSON.stringify({
            error:
              "Script Evidence Pack required. Please generate the Script Evidence Pack before generating the Full Script.",
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const parts: string[] = [];
      // Order matters: SEP is the controlling source; Creative Brief is directional only.
      parts.push(`### SCRIPT EVIDENCE PACK (CONTROLLING SOURCE — argument route, evidence, beat sequence, source-grounded claims, fan objections, repetition control, hook/payoff execution)\n${capPreviousOutput("script_evidence_pack", packEntry.content)}`);
      if (cbEntry?.content) {
        parts.push(`### CREATIVE BRIEF (DIRECTIONAL ONLY — title promise, thesis direction, tone, emotional arc, intended payoff)\n${capPreviousOutput("creative_brief", cbEntry.content)}`);
      }

      // ── APPROVED EVIDENCE POINTS (structured, post-review) ──
      // Pull rows from public.evidence_points for this brief, excluding any
      // user-rejected rows.
      try {
        const { data: evRows } = await supabase
          .from("evidence_points")
          .select("*")
          .eq("brief_id", briefId)
          .order("created_at", { ascending: true });
        const approved = (evRows || []).filter(
          (r: any) => r.approval_status !== "rejected",
        );
        if (approved.length > 0) {
          const lines: string[] = [
            "### APPROVED EVIDENCE POINTS (BINDING WHITELIST — only these claims may be used; rejected points have been removed)",
            "Approval notes attached to evidence points are binding constraints, not optional guidance. If a note specifies a condition (e.g. 'only use after pairing with X evidence,' 'frame as interpretation only,' 'avoid treating as a universal rule'), that condition must be met. If the condition cannot be met with the available evidence, narrow the claim, omit the contrast, or use different evidence entirely. Do not use the evidence as if the condition does not exist.",
          ];
          approved.forEach((r: any, i: number) => {
            const block: string[] = [`#${i + 1} Claim: ${r.claim}`];
            if (r.source_file) block.push(`Source File: ${r.source_file}`);
            block.push(`Source Type: ${r.source_type}`);
            block.push(`Confidence: ${r.confidence} | Evidence Type: ${r.evidence_type}`);
            if (r.book_evidence) block.push(`Book Evidence: ${r.book_evidence}`);
            if (r.movie_evidence) block.push(`Movie Evidence: ${r.movie_evidence}`);
            if (r.difference_note) block.push(`Contrast: ${r.difference_note}`);
            if (r.exact_quote) block.push(`Micro-Quote: ${r.exact_quote}`);
            if (r.paraphrase) block.push(`Paraphrase: ${r.paraphrase}`);
            if (r.lexicon_support) block.push(`Lexicon Support: ${r.lexicon_support}`);
            if (r.secondary_source_support) block.push(`Secondary Source Support: ${r.secondary_source_support}`);
            if (r.why_this_matters) block.push(`Why This Matters: ${r.why_this_matters}`);
            if (r.commentary_angle) block.push(`Commentary Angle: ${r.commentary_angle}`);
            if (r.approval_note) block.push(`AUTHOR NOTE (binding — honour this guidance when using this point): ${r.approval_note}`);
            lines.push(block.join("\n"));
          });
          parts.push(lines.join("\n\n"));
        }
      } catch (err) {
        console.warn("Failed to load approved evidence_points:", err);
      }

      // Hook is injected separately below as a top-level user-message section,
      // BEFORE "## Previous Pipeline Steps", so it gets architectural priority
      // over Pack Beat 1.
      previousContext = parts.join("\n\n");
    }

    // Compute the selected hook direction once, for use in both the system
    // prompt binding block and the user message section. Only active for full_script.
    const selectedHook =
      stepType === "full_script" && typeof hookDirection === "string"
        ? hookDirection.trim()
        : "";

    let systemPrompt = STEP_PROMPTS[stepType] || "You are a helpful writing assistant.";

    // Inject dynamic target length instructions for outline and full_script.
    const targetMin = brief.target_min_words ?? 1400;
    const targetMax = brief.target_max_words ?? 1600;

    if (stepType === "full_script") {
      systemPrompt = systemPrompt.replace(
        "{{FULL_SCRIPT_LENGTH_INSTRUCTION}}",
        `Enforce total word count within ${targetMin} to ${targetMax} words silently. If the draft falls outside this range, self-revise until it lands inside. Do NOT include a "Word count" line or any numeric footer in the output.`
      );
    }

    // NOTE: Legacy Script Writing + Anti-AI prompt appends removed.
    // Guidance for normal generation now flows exclusively through
    // buildGuidanceBlock() (appended below as `layeredGuidanceBlock` /
    // via systemPromptFinal at the end of this handler).

    // Originality safeguard — when the Selected Source Analysis output is in the
    // upstream context for outline / full_script / evidence_table, the model must
    // treat secondary-source signals as audience intelligence, NOT as canon proof,
    // and must silently self-check for over-reliance on selected transcripts.
    if (["evidence_table", "outline", "full_script"].includes(stepType)) {
      systemPrompt += `\n\nORIGINALITY SAFEGUARD (MANDATORY):
If a Selected Source Analysis output appears in the previous pipeline context, treat it as AUDIENCE INTELLIGENCE only — recurring fan signals, overused angles to avoid, audience objections to address, candidate claims to validate, and original synthesis opportunities.

Rules:
- Do NOT copy or closely paraphrase claims, jokes, transitions, structures, or conclusions from the selected topic transcripts or Alternative Sources.
- Do NOT promote any "candidate claim" or "needs validation" item from the Selected Source Analysis to a confirmed factual claim unless it is independently supported by Tier 1 canon (books / movie transcripts) in the retrieved Source Material Excerpts.
- DO use the Selected Source Analysis to: avoid overdone angles, address likely audience objections, sharpen escalation, strengthen re-hooks, and produce a more original final argument in the host persona's voice.
- Honour the "Do-Not-Copy Notes" section of the Selected Source Analysis if present.

Before finalizing your output, silently self-check:
1. Am I repeating a secondary source's exact argument too closely?
2. Am I reusing their joke, phrase, structure, or conclusion?
3. Is my conclusion an original synthesis grounded in the canon extraction (Insights & Research / Evidence Table)?
4. Does this feel like the host persona's original take, not a remix of other creators?
5. Are selected sources being used as audience intelligence rather than as substituted substance?
If any answer reveals overreliance, revise toward a more original, canon-grounded argument before producing the final output. Do not mention this self-check in the output.`;
    }

    // Full Script source precedence: SEP controls; Creative Brief is directional only.
    if (stepType === "full_script") {
      systemPrompt += `\n\nSOURCE PRECEDENCE (BINDING): The Script Evidence Pack is the CONTROLLING source for argument route, beat sequence, evidence, source-grounded claims, fan objections, repetition control, and hook/payoff execution. The Creative Brief is DIRECTIONAL ONLY: title promise, thesis direction, tone, emotional arc, intended payoff. If they conflict, follow the Script Evidence Pack. Do not import Creative Brief sentences verbatim. Do not restate the thesis using Creative Brief phrasing more than once. Treat the Creative Brief as a compass, not as script copy. If an Angle Check appears in context via the Script Evidence Pack's framing, the SEP already encodes its contention — do not revert to Creative Brief thesis phrasing.`;
      systemPrompt += `\n\nANTI-INVENTION RULE (BINDING):\nThe Script Evidence Pack contains every canon claim, scene, quote, and evidence point that the Full Script is permitted to use. You may not introduce any of the following if they are not present in the Script Evidence Pack:\n- Specific scenes from books or films\n- Direct or paraphrased quotes\n- Canon facts about characters, events, or settings\n- Specific moments framed as evidence\n- References to deleted scenes, behind-the-scenes material, or interviews\n\nIf a beat in the Script Evidence Pack is thin or has weak evidence, write the beat with the evidence available. Do not fill the gap by adding scenes, quotes, or details that are not in the Pack. If a beat genuinely cannot be written from the Pack alone, generate the beat as written and add a single bracketed flag at that point in the script: [FLAG: insufficient evidence in Pack].\n\nThe Source Material Excerpts section provided in the user message exists only as context. You may not introduce any claim from those excerpts that is not also present in the Script Evidence Pack. The Script Evidence Pack is the only source of permitted content.\n\nThis rule applies regardless of how natural, plausible, or argumentatively useful an additional claim might seem.`;
      systemPrompt += `\n\nNO META-COMMENTARY RULE (BINDING — HARD):\nThe script is viewer-facing copy. The viewer must NEVER see any reference to the script's own research process, evidence pipeline, or source availability. Specifically, you must NOT:\n- Mention the evidence pack, Script Evidence Pack, source library, retrieval, transcripts, books-vs-films coverage gaps, or what sources were or were not available.\n- Say anything like "I can't prove this part", "the transcript doesn't show", "evidence is limited here", "the books don't confirm", "we don't have a scene for this", or any equivalent acknowledgement of a gap in the source material.\n- Reference the pipeline, the model, the system, instructions, or limitations of any kind.\n\nIf a beat lacks the evidence to make the comparison or claim it was meant to make, you have exactly three permitted moves: (1) work around the gap silently using whatever evidence IS available, (2) narrow the claim to what can actually be supported, or (3) omit the beat entirely and continue.\n\n[FLAG: ...] markers and any other bracketed flags are INTERNAL ONLY and must NEVER appear in the script output. This OVERRIDES the earlier instruction to insert [FLAG: insufficient evidence in Pack] — do not insert that marker or any equivalent. Handle gaps silently using the three moves above.`;
    }

    // Selected Hook binding — only when a hook direction is present for full_script.
    if (selectedHook) {
      systemPrompt += `\n\nSELECTED HOOK DIRECTION (BINDING — VERBATIM, OVERRIDES PACK BEAT 1):\nA specific hook has been selected for this script. It is provided in the user message under "## Selected Hook / Opening Direction" and may include a short label line followed by the hook body.\n\nVERBATIM RULE (HARD):\n- The Full Script MUST open with the selected hook text reproduced verbatim, or as near to verbatim as possible.\n- Do NOT rewrite the hook for style, rhythm, voice, smoothness, anti-AI compliance, or persona fit. The hook has already been approved by the user as-is.\n- Do NOT paraphrase, condense, expand, reorder sentences, or "improve" the wording.\n- Do NOT prepend a setup sentence, greeting, throat-clear, or framing line before the hook. The script begins on the first word of the hook body.\n- Drop the label line if one is present at the top of the selected hook block. The label is internal metadata, not script copy. Only the hook body is spoken.\n- The ONLY edits permitted are: (a) trivial mechanical fixes (typos, obvious punctuation errors), and (b) correcting a factual claim in the hook that directly contradicts canon evidence in the Script Evidence Pack — in which case fix the minimum number of words required and leave everything else untouched.\n- After the hook lands verbatim, transition into the Script Evidence Pack beat sequence as written. Pack Beat 1 is overridden by the hook for the opening; subsequent beats run as the Pack specifies.\n\nThis rule activates only when a selected hook is provided. Without a selected hook, the Script Evidence Pack Beat 1 controls the opening as written.`;
    }

    // Add comparison mode instruction if enabled
    if (brief.comparison_mode) {
      systemPrompt = COMPARISON_MODE_INSTRUCTION + "\n\n" + systemPrompt;
    }

    // Build expanded brief context
    let briefContext = `**Title:** ${brief.title}`;
    if (brief.angle_note) briefContext += `\n**Angle:** ${brief.angle_note}`;
    else if (brief.description) briefContext += `\n**Description:** ${brief.description}`;
    if (brief.thesis) briefContext += `\n**Thesis:** ${brief.thesis}`;
    if (brief.focus_areas?.length) briefContext += `\n**Focus Areas:** ${brief.focus_areas.join(", ")}`;
    if (brief.characters?.length) briefContext += `\n**Key Characters:** ${brief.characters.join(", ")}`;
    if (brief.proof_goal) briefContext += `\n**Proof Goal:** ${brief.proof_goal}`;
    if (brief.priority_sources?.length) briefContext += `\n**Priority Sources (soft boost only, not a filter):** ${brief.priority_sources.join(", ")}`;
    if (brief.emotional_angle) briefContext += `\n**Emotional Angle:** ${brief.emotional_angle}`;
    if (brief.tone) briefContext += `\n**Tone:** ${brief.tone}`;
    if (brief.comparison_mode) briefContext += `\n**Mode:** Book vs Movie Comparison`;
    if (brief.creative_brief_feedback) briefContext += `\n**Creator Feedback:** ${brief.creative_brief_feedback}`;

    const queryPackContext = `**Primary Query:** ${queryPack.primaryQuery}
**Subqueries:** ${queryPack.subqueries.length ? queryPack.subqueries.join(" | ") : "none"}
**Character Queries:** ${queryPack.characterQueries.length ? queryPack.characterQueries.join(" | ") : "none"}
**Theme Queries:** ${queryPack.themeQueries.length ? queryPack.themeQueries.join(" | ") : "none"}
**Transcript-Specific Queries:** ${queryPack.transcriptQueries.length ? queryPack.transcriptQueries.join(" | ") : "none"}
**Comparison Query Expansion:** ${queryPack.comparisonQueries.length > 0 ? "enabled" : "disabled"}
**Comparison Queries:** ${queryPack.comparisonQueries.length ? queryPack.comparisonQueries.join(" | ") : "none"}`;

    // Build user-message guidance block.
    // NOTE: The Master Guide (Script Instructions & Strategy) is intentionally
    // NOT duplicated here — it is now injected into the system prompt for every
    // step that needs it (Creative Brief, Insights & Research, Selected Source
    // Analysis, Evidence Table, Outline, Full Script, Final Pass, Revision).
    // Duplicating it in the user message wasted tokens and diluted its
    // "writing constitution" framing. The Anti AI Guide is also already in
    // the system prompt for script steps. Commentary transcripts remain here
    // because they are dynamic interpretive context, not stable guidance.
    const guidanceSections: string[] = [];
    const guidanceBlock = guidanceSections.length > 0 ? guidanceSections.join("\n\n") + "\n\n" : "";

    let systemPromptFinal = systemPrompt;
    let userMessage: string;

    // ── FULL SCRIPT REVISION MODE ──
    // When the Full Script step is regenerated with user revision feedback,
    // we reuse the entire pipeline context (same as a normal full_script run)
    // and append: the previous Full Script + the user's typed feedback +
    // a binding revision task. We do NOT replace the source/guidance context.
    const isFullScriptRevision =
      stepType === "full_script" &&
      typeof revisionFeedback === "string" &&
      revisionFeedback.trim().length > 0;

    if (isFullScriptRevision) {
      systemPromptFinal +=
        `\n\nFULL SCRIPT REVISION MODE (BINDING):\n` +
        `- You are revising a previously generated Full Script for this same brief.\n` +
        `- The previous Full Script and the user's revision feedback are included in the user message.\n` +
        `- Preserve the strongest material from the previous script. Rebuild weak or repetitive sections.\n` +
        `- Directly apply the user's feedback. Do not patch a few sentences cosmetically.\n` +
        `- Reuse the full pipeline context (Topic Brief, Creative Brief, Insights & Research, Evidence Table, Outline, source excerpts, Script Writing Instructions, Anti AI Guide, Host Persona, topic transcripts, commentary transcripts).\n` +
        `- Maintain target word count, editor tags after evidence paragraphs, source specificity, quote discipline, and the Lexicon mention ban.\n` +
        `- Output ONLY the revised Full Script. Do not include an explanation of changes, a diff, a changelog, or commentary about the revision.\n`;
    }

    // ─────────────────────────────────────────────────────────────────────
    // RAW SELECTED SECONDARY SOURCES — GATED TO SSA ONLY
    //
    // Raw selected topic transcripts and raw Alternative Sources are
    // ONLY injected into selected_source_analysis (the deep-interpretation
    // gateway). Downstream steps (evidence_table, outline, full_script,
    // revision, final pass, six_category_extraction) consume the SSA OUTPUT
    // via previousContext instead of the raw text.
    // ─────────────────────────────────────────────────────────────────────
    const topicTranscriptUserBlock =
      stepType === "selected_source_analysis" && topicTranscripts.length > 0
        ? `\n\n## Brief-Specific Topic Transcripts (THEORY, ANGLE, AND RESEARCH LEADS — not Tier 1 canon)\nTreat these as theory/angle/interpretation input. Factual canon claims still require Tier 1 book or movie transcript support. Theories may be used if plausible, coherent, and not obviously contradicted by canon. Frame theories honestly as theories.\n\n` +
          truncateTopicTranscripts(topicTranscripts, "ssa")
            .map((r: any) => `### "${r.video_title}" by ${r.channel_name} ${qualityTag(r.script_strength)}\n${r.transcript}`)
            .join("\n\n---\n\n")
        : "";

    const altSourceUserBlock =
      stepType === "selected_source_analysis"
        ? formatAlternativeSourcesBlock("Alternative Sources", "ssa")
        : "";

    if (stepType === "selected_source_analysis") {
      // Pull Creative Brief and Insights & Research.
      let creativeBriefContent = "";
      let insightsContent = "";
      {
        const { data: cbOut } = await supabase
          .from("pipeline_outputs")
          .select("content")
          .eq("brief_id", briefId)
          .eq("step_type", "creative_brief")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const { data: insightsOut } = await supabase
          .from("pipeline_outputs")
          .select("content")
          .eq("brief_id", briefId)
          .eq("step_type", "six_category_extraction")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        creativeBriefContent = cbOut?.content || "";
        insightsContent = insightsOut?.content || "";
      }
      const hasSelectedSecondary = topicTranscripts.length > 0 || alternativeSources.length > 0;

      systemPromptFinal = STEP_PROMPTS["selected_source_analysis"];
      // Guidance injected via buildGuidanceBlock() below — no legacy append.

      userMessage = `## Topic Brief
Title: ${brief.title}
Description: ${brief.description || ""}
Angle: ${brief.angle_note || ""}
Tone: ${brief.tone || ""}
Thesis: ${brief.thesis || ""}

## Creative Brief Output
${creativeBriefContent || "(Creative Brief not yet generated — proceed using Topic Brief only.)"}

## Insights & Research Output (canon-first extraction — your primary upstream context)
${insightsContent || "(Insights & Research not yet generated — proceed cautiously and flag canon gaps.)"}

${hasSelectedSecondary ? "## Selected Secondary Sources (analyze ONLY these)" : "## Selected Secondary Sources\n(None attached. Produce a minimal graceful analysis based on the Creative Brief and Insights & Research only — do not invent fan signals.)"}
${topicTranscriptUserBlock}${altSourceUserBlock}${buildSecondarySkippedNotice()}

Now produce the Selected Source Analysis in the exact format specified. Be honest about source weight — never promote a secondary-source claim to canon. Surface what's overused, what's underdeveloped, what objections exist, and where original synthesis is possible against the canon extraction above.`;
    } else if (stepType === "six_category_extraction") {
      // Get creative brief output.
      let creativeBriefContent = "";
      {
        const { data: creativeBriefOutput } = await supabase
          .from("pipeline_outputs")
          .select("content")
          .eq("brief_id", briefId)
          .eq("step_type", "creative_brief")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        creativeBriefContent = creativeBriefOutput?.content || "";
      }

      systemPromptFinal = STEP_PROMPTS["six_category_extraction"];
      // Guidance injected via buildGuidanceBlock() below — no legacy append.

      userMessage = `## Creative Brief
${creativeBriefContent || `Title: ${brief.title}\nAngle: ${brief.angle_note || brief.description || ""}`}

(Note: Raw selected topic transcripts and Alternative Sources are NOT included here. They are deeply interpreted in the Selected Source Analysis step. This step focuses on canon-first extraction from the indexed primary corpus.)

## Creator Feedback on Brief
${brief.creative_brief_feedback || "None provided."}

## Retrieved Canon Material (books and movie transcripts — primary evidence only)
${sourceContext}

Mine all six categories now. Rank everything by surprise value, specificity, and argument usefulness. Be precise about sources.`;
    } else {
      // Generic generation step (e.g. evidence_table, outline, full_script).
      // Guidance is injected via buildGuidanceBlock() below;
      // legacy Master-Guide framing append removed to avoid double injection.

      const selectedHookBlock = selectedHook
        ? `## Selected Hook / Opening Direction (BINDING — OVERRIDES PACK BEAT 1)\n\n${selectedHook}\n\nThis hook direction controls the opening of the Full Script. The opening must reflect this hook before the script transitions into the Script Evidence Pack beat sequence.\n\n`
        : "";
      userMessage = `## Topic Brief
${briefContext}

${stepType === "full_script" || stepType === "angle_check" ? "" : `## Retrieval Query Pack (Derived)
${queryPackContext}

`}${guidanceBlock}${selectedHookBlock}${previousContext ? `## Previous Pipeline Steps\n${previousContext}\n\n` : ""}${stepType === "full_script" || stepType === "angle_check" ? "" : `## Source Material Excerpts
${sourceContext}
`}${topicTranscriptUserBlock}${altSourceUserBlock}${buildSecondarySkippedNotice()}

Please generate the ${stepType.replace(/_/g, " ")} based on the above information.`;
    }

    if (isFullScriptRevision) {
      // Use the previous Full Script the client supplied, falling back to the latest
      // saved full_script output for this brief if the client didn't pass one.
      let prevScript = (previousFullScript || "").toString();
      if (!prevScript) {
        const { data: prevOut } = await supabase
          .from("pipeline_outputs")
          .select("content")
          .eq("brief_id", briefId)
          .eq("step_type", "full_script")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        prevScript = prevOut?.content || "";
      }

      userMessage += `\n\n## Previous Full Script\n${prevScript || "(No previous Full Script available.)"}\n\n## User Revision Feedback\n${revisionFeedback.trim()}\n\n## Revision Task\nRevise the previous Full Script using the user feedback. Do not simply patch a few sentences. Rebuild the script where necessary while preserving the strongest material. Use the full pipeline context again, including the Topic Brief, Creative Brief, Insights & Research, Evidence Table, Outline, source excerpts, Script Writing Instructions, Anti AI Guide, Host Persona, topic transcripts, and commentary transcripts where relevant.\n\nThe revised script must directly address the feedback and produce a cleaner, stronger, less repetitive, more source-grounded, more host-voiced final script.\n\nOutput only the revised Full Script.`;
    }

    // ── GENERIC PER-STEP REVISION FEEDBACK ──
    // Every pipeline step (other than full_script, which has its own dedicated
    // revision mode above, and creative_brief, which reads creator feedback
    // from the persisted topic_briefs.creative_brief_feedback field) accepts
    // free-form feedback typed in the UI before the user clicks Regenerate.
    // When provided, append it to the user message so the model treats it as
    // a binding revision directive on top of the normal step context.
    const hasGenericRevisionFeedback =
      stepType !== "full_script" &&
      stepType !== "creative_brief" &&
      typeof revisionFeedback === "string" &&
      revisionFeedback.trim().length > 0;
    if (hasGenericRevisionFeedback) {
      userMessage += `\n\n## Creator Revision Feedback (BINDING)\nThe creator reviewed the previous output of the ${stepType.replace(/_/g, " ")} step and provided the following feedback before regenerating. Treat it as a binding directive: directly apply it, rebuild affected sections rather than cosmetically patching them, and keep all other guardrails (source hierarchy, quote discipline, anti-AI rules, lexicon discipline) intact.\n\n${revisionFeedback.trim()}`;
    }

    // Call Lovable AI
    // Append unified guidance block (intensity per STEP_GUIDANCE). For
    // full_script revisions, use the revision-specific intensity entry.
    const effectiveStepKey = isFullScriptRevision ? "full_script_revision" : stepType;
    systemPromptFinal += buildGuidanceBlock(effectiveStepKey, guidanceLayers);

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getModelForStep(stepType),
        messages: [
          { role: "system", content: applyChannelPlaceholders(systemPromptFinal, channel) },
          { role: "user", content: applyChannelPlaceholders(userMessage, channel) },
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted. Please add credits in Settings." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", response.status, t);
      throw new Error("AI gateway error");
    }

    return new Response(wrapStreamWithWarnings(response.body!), {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("generate-step error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
