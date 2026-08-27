## Overview

Four parts: rebuild Evidence Table as structured cards, auto-classify risk, gate Full Script generation on approval, and add a hard anti-hallucination instruction to the script generation prompt.

The Evidence Table step currently outputs raw markdown to `pipeline_outputs`. The DB already has an unused `evidence_points` table. We will start populating it on Evidence Table generation and drive the new UI from rows, while keeping the markdown copy intact for backward compatibility (Regenerate/Export still work).

---

## Part 1 — Evidence Table UI Redesign

**Data source:** parse the generated Evidence Table markdown into structured rows and persist them to `public.evidence_points` (one row per point) at the end of the Evidence Table generation. Existing markdown stays in `pipeline_outputs` so Export/Regenerate keep working.

**New component:** `src/components/pipeline/EvidenceTableView.tsx`

Per-card layout:
- Header: `#N` + one-line claim summary + risk badge (yellow flag / green check) + Approve/Reject (high risk) or status (low risk) + Copy button
- Two-column field table: Claim, Source File, Source Type, Confidence, Evidence Type, Why This Matters, Book Evidence, Movie Evidence, Lexicon Support, Exact Quote, Paraphrase, Contrast/Difference Note
- Collapsible: collapsed shows only Claim, Source File, Confidence, Why This Matters
- Copy button writes a formatted plain-text version of the full point

Top toolbar:
- Search input (filters across all fields)
- Source Type filter chips: Book / Movie / Both
- Confidence filter chips: High / Medium / Low
- Risk filter chips: High / Low / All
- Existing Regenerate and Export buttons stay in the page header

PipelineView swaps `MarkdownContent` for `<EvidenceTableView>` only when `activeStep === "evidence_table"` and rows exist. If parsing fails or rows are empty, fall back to the markdown view.

---

## Part 2 — Risk Classification

Computed client-side from each row, no extra DB column needed beyond what `evidence_points` already has (`confidence`, `evidence_type`, `source_type`, `source_file`, `book_evidence`, `movie_evidence`).

High risk if any of:
- `source_file` not present in the user's source library (compared against `source_files.name`)
- `confidence` is Medium or Low
- `evidence_type` is `theory` or `speculation`
- `source_type` central but corresponding evidence field empty (book central + `book_evidence` empty, movie central + `movie_evidence` empty)
- `source_type` is `secondary` or `commentary`

Low risk: high confidence + named library source, OR paraphrase/micro-quote backed by a named transcript, OR both `book_evidence` and a contrast/difference field populated.

UI:
- High risk cards sorted to the top, yellow flag, expanded by default, Approve/Reject buttons
- Low risk cards: green check, collapsed by default, no action needed

**Approval state:** add a nullable `approval_status` column to `evidence_points` (`'approved' | 'rejected' | null`). Approved/Rejected actions write to this column.

---

## Part 3 — Approval Gate

In `PipelineView`, add a sticky banner above the Generate Script button (Full Script step) that:
- Reads pending high-risk count for this brief
- Shows "X high risk evidence points need review" with countdown
- Disables the Generate / Regenerate Full Script button while count > 0
- Links back to the Evidence Table step

Script generation reads `evidence_points` for the brief and excludes rejected rows when assembling the evidence pack context. Approved + Low risk rows pass through normally. Falls back gracefully when `evidence_points` is empty (current behavior preserved).

---

## Part 4 — Script Generation Prompt Instruction

In `supabase/functions/generate-step/index.ts`, prepend the following to the `full_script` system prompt (before all existing instructions):

> "You must use only the evidence points provided in the approved evidence pack below. Do not introduce examples, references, named works, spin-offs, films, or claims from outside this set regardless of your training knowledge. If the argument requires a point that has no supporting evidence in the pack, insert [NEEDS EVIDENCE: one-line description of what is missing] as a placeholder and continue. Do not invent support. Do not silently include unsourced material."

Scope is `full_script` only — does not touch other steps, Anti-AI, Melty Voice Pass, or Passage Rewrite.

---

## Technical details

**Migration**
```sql
ALTER TABLE public.evidence_points
  ADD COLUMN approval_status text CHECK (approval_status IN ('approved','rejected'));
CREATE INDEX idx_evidence_points_brief ON public.evidence_points(brief_id);
```

**Markdown parser** (`src/lib/parseEvidenceTable.ts`): tolerant parser that handles both pipe-table and bullet/heading layouts. Returns `EvidencePointDraft[]`. Used at the end of Evidence Table generation in `PipelineView` (client-side, after stream completes) to insert rows. Re-parses + replaces existing rows on Regenerate.

**Files**
- new: `supabase/migrations/<ts>_evidence_points_approval.sql`
- new: `src/lib/parseEvidenceTable.ts`
- new: `src/components/pipeline/EvidenceTableView.tsx`
- edit: `src/lib/api.ts` — CRUD helpers for `evidence_points` (list by brief, upsertMany, setApproval)
- edit: `src/pages/PipelineView.tsx` — render new view for evidence_table step, populate rows after generation, add high-risk gate on Full Script
- edit: `supabase/functions/generate-step/index.ts` — prepend the new instruction to `full_script`; when assembling Full Script context, filter out rejected `evidence_points` rows for this brief

**Out of scope:** Anti-AI, Melty Voice Pass, Passage Rewrite, hook generation, other pipeline steps.
