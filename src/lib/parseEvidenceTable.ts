// Tolerant parser for the Evidence Table markdown format produced by the
// `evidence_table` generation step. Returns one record per evidence point,
// shaped for insertion into public.evidence_points.

export interface EvidencePointDraft {
  claim: string;
  source_type: string;
  source_file: string | null;
  book_evidence: string | null;
  movie_evidence: string | null;
  difference_note: string | null;
  exact_quote: string | null;
  paraphrase: string | null;
  why_this_matters: string | null;
  confidence: string;
  evidence_type: string;
  commentary_angle: string | null;
  secondary_source_support: string | null;
}

const FIELD_MAP: Record<string, keyof EvidencePointDraft | "why_this_matters"> = {
  "claim": "claim",
  "source type": "source_type",
  "source file": "source_file",
  "book evidence": "book_evidence",
  "evidence": "book_evidence",
  "movie evidence": "movie_evidence",
  "contrast": "difference_note",
  "difference": "difference_note",
  "difference note": "difference_note",
  "secondary source support": "secondary_source_support",
  "micro-quote": "exact_quote",
  "micro quote": "exact_quote",
  "exact quote": "exact_quote",
  "quote": "exact_quote",
  "paraphrase": "paraphrase",
  "why this matters": "why_this_matters",
  "why it matters": "why_this_matters",
  "confidence": "confidence",
  "evidence type": "evidence_type",
  "commentary angle": "commentary_angle",
};

function clean(value: string): string {
  return value
    .replace(/^\*+|\*+$/g, "")
    .replace(/^_+|_+$/g, "")
    .replace(/`/g, "")
    .trim();
}

function blankIfPlaceholder(v: string): string {
  const t = v.trim().toLowerCase();
  if (!t) return "";
  if (
    t === "n/a" ||
    t === "na" ||
    t === "none" ||
    t === "—" ||
    t === "-" ||
    t === "blank" ||
    t === "(none)" ||
    t.startsWith("[") && t.endsWith("]") // square-bracket template like [leave blank]
  ) {
    return "";
  }
  return v.trim();
}

export function parseEvidenceTable(markdown: string): EvidencePointDraft[] {
  if (!markdown || !markdown.trim()) return [];

  // Split on "### Evidence Point" headings (case-insensitive, tolerate variants).
  const sections = markdown.split(/\n(?=#{2,4}\s*Evidence\s*Point)/i);
  const points: EvidencePointDraft[] = [];

  for (const section of sections) {
    if (!/Evidence\s*Point/i.test(section)) continue;

    const fields: Record<string, string> = {};
    // Match pipe-table rows: | **Field** | Value |
    const rowRe = /^\|\s*\*?\*?([^|*]+?)\*?\*?\s*\|\s*([\s\S]*?)\s*\|\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(section)) !== null) {
      const rawKey = clean(m[1]).toLowerCase();
      const rawVal = blankIfPlaceholder(clean(m[2]));
      if (!rawKey || rawKey === "field" || rawKey.startsWith("---")) continue;
      const mapped = FIELD_MAP[rawKey];
      if (mapped) fields[mapped] = rawVal;
    }

    if (!fields.claim) continue;

    const sourceTypeRaw = (fields.source_type || "").toLowerCase();
    let source_type = "book";
    if (/both/.test(sourceTypeRaw)) source_type = "both";
    else if (/movie|film/.test(sourceTypeRaw)) source_type = "movie";
    else if (/commentary|secondary|transcript/.test(sourceTypeRaw)) source_type = "commentary";
    else if (/book/.test(sourceTypeRaw)) source_type = "book";

    const confRaw = (fields.confidence || "").toLowerCase();
    let confidence = "medium";
    if (/high/.test(confRaw)) confidence = "high";
    else if (/low/.test(confRaw)) confidence = "low";

    const evTypeRaw = (fields.evidence_type || "").toLowerCase();
    let evidence_type = "summary";
    if (/exact|quote/.test(evTypeRaw)) evidence_type = "exact_quote";
    else if (/paraphrase/.test(evTypeRaw)) evidence_type = "paraphrase";
    else if (/interpret/.test(evTypeRaw)) evidence_type = "interpretation";
    else if (/theory/.test(evTypeRaw)) evidence_type = "theory";
    else if (/specul/.test(evTypeRaw)) evidence_type = "speculation";

    points.push({
      claim: fields.claim,
      source_type,
      source_file: fields.source_file || null,
      book_evidence: fields.book_evidence || null,
      movie_evidence: fields.movie_evidence || null,
      difference_note: fields.difference_note || null,
      exact_quote: fields.exact_quote || null,
      paraphrase: fields.paraphrase || null,
      why_this_matters: (fields as any).why_this_matters || null,
      confidence,
      evidence_type,
      commentary_angle: fields.commentary_angle || null,
      secondary_source_support: (fields as any).secondary_source_support || null,
    });
  }

  return points;
}

// ── Risk classification ──
export type RiskLevel = "high" | "low";

export interface RiskInput {
  claim: string;
  source_type: string;
  source_file: string | null;
  book_evidence: string | null;
  movie_evidence: string | null;
  difference_note: string | null;
  confidence: string;
  evidence_type: string;
}

export function classifyRisk(p: RiskInput, libraryFileNames: string[]): {
  level: RiskLevel;
  reasons: string[];
} {
  const reasons: string[] = [];
  const norm = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]+$/i, "").trim();
  const lib = new Set(libraryFileNames.map(norm));
  const fileMissing =
    !p.source_file ||
    !p.source_file
      .split(/[,;\/]+/)
      .map((s) => norm(s))
      .filter(Boolean)
      .some((name) => lib.has(name) || [...lib].some((l) => l.includes(name) || name.includes(l)));

  const conf = (p.confidence || "").toLowerCase();
  const et = (p.evidence_type || "").toLowerCase();
  const st = (p.source_type || "").toLowerCase();

  if (fileMissing && p.source_file) reasons.push("Source file not in library");
  if (!p.source_file) reasons.push("No source file named");
  if (conf === "medium" || conf === "low") reasons.push(`Confidence: ${conf}`);
  if (et === "theory" || et === "speculation" || et === "interpretation") reasons.push(`Evidence type: ${et}`);
  if (st === "book" && !p.book_evidence) reasons.push("Book central but no book evidence");
  if (st === "movie" && !p.movie_evidence) reasons.push("Movie central but no movie evidence");
  if (st === "both" && (!p.book_evidence || !p.movie_evidence)) reasons.push("Comparison missing one side");
  if (st === "commentary" || st === "secondary") reasons.push("Secondary / commentary source only");

  if (reasons.length === 0) {
    // Reinforce low-risk auto-approval criteria
    const namedTranscript =
      !!p.source_file &&
      !fileMissing &&
      (et === "paraphrase" || et === "exact_quote");
    const bothBookAndContrast = !!p.book_evidence && !!p.difference_note;
    if (conf === "high" && !fileMissing) return { level: "low", reasons: [] };
    if (namedTranscript) return { level: "low", reasons: [] };
    if (bothBookAndContrast) return { level: "low", reasons: [] };
    // Default conservative: low if nothing flagged.
    return { level: "low", reasons: [] };
  }

  return { level: "high", reasons };
}

export function formatPointAsText(p: EvidencePointDraft, index: number): string {
  const lines = [
    `Evidence Point #${index + 1}`,
    `Claim: ${p.claim}`,
    `Source Type: ${p.source_type}`,
    `Source File: ${p.source_file || "—"}`,
    `Confidence: ${p.confidence}`,
    `Evidence Type: ${p.evidence_type}`,
  ];
  if (p.book_evidence) lines.push(`Book Evidence: ${p.book_evidence}`);
  if (p.movie_evidence) lines.push(`Movie Evidence: ${p.movie_evidence}`);
  if (p.difference_note) lines.push(`Contrast: ${p.difference_note}`);
  if (p.exact_quote) lines.push(`Micro-Quote: ${p.exact_quote}`);
  if (p.paraphrase) lines.push(`Paraphrase: ${p.paraphrase}`);
  if (p.why_this_matters) lines.push(`Why This Matters: ${p.why_this_matters}`);
  if (p.commentary_angle) lines.push(`Commentary Angle: ${p.commentary_angle}`);
  return lines.join("\n");
}