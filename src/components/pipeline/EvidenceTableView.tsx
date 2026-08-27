import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Flag,
  CheckCircle2,
  ThumbsUp,
  ThumbsDown,
} from "lucide-react";
import { toast } from "sonner";
import {
  classifyRisk,
  formatPointAsText,
  type EvidencePointDraft,
  type RiskLevel,
} from "@/lib/parseEvidenceTable";
import type { EvidencePoint } from "@/lib/api";

type SourceFilter = "all" | "book" | "movie" | "both";
type ConfidenceFilter = "all" | "high" | "medium" | "low";
type RiskFilter = "all" | "high" | "low";

interface Props {
  rows: EvidencePoint[];
  libraryFileNames: string[];
  onSetApproval: (
    id: string,
    status: "approved" | "rejected",
    note?: string | null,
  ) => void;
}

const FIELDS: { key: keyof EvidencePointDraft | "why_this_matters"; label: string }[] = [
  { key: "claim", label: "Claim" },
  { key: "source_file", label: "Source File" },
  { key: "source_type", label: "Source Type" },
  { key: "confidence", label: "Confidence" },
  { key: "evidence_type", label: "Evidence Type" },
  { key: "why_this_matters", label: "Why This Matters" },
  { key: "book_evidence", label: "Book Evidence" },
  { key: "movie_evidence", label: "Movie Evidence" },
  { key: "difference_note", label: "Contrast" },
  { key: "lexicon_support", label: "Lexicon Support" },
  { key: "secondary_source_support", label: "Secondary Source Support" },
  { key: "exact_quote", label: "Micro-Quote" },
  { key: "paraphrase", label: "Paraphrase" },
  { key: "commentary_angle", label: "Commentary Angle" },
];

const COLLAPSED_KEYS = new Set(["claim", "source_file", "confidence", "why_this_matters"]);

export function EvidenceTableView({ rows, libraryFileNames, onSetApproval }: Props) {
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [confFilter, setConfFilter] = useState<ConfidenceFilter>("all");
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // Local draft notes per row, keyed by evidence id. Falls back to the saved
  // approval_note when the user hasn't started editing.
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNote, setSavingNote] = useState<Record<string, boolean>>({});

  const enriched = useMemo(() => {
    return rows.map((r) => {
      const risk = classifyRisk(
        {
          claim: r.claim,
          source_type: r.source_type,
          source_file: r.source_file,
          book_evidence: r.book_evidence,
          movie_evidence: r.movie_evidence,
          difference_note: r.difference_note,
          confidence: r.confidence,
          evidence_type: r.evidence_type,
        },
        libraryFileNames,
      );
      return { row: r, risk: risk.level as RiskLevel, reasons: risk.reasons };
    });
  }, [rows, libraryFileNames]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return enriched
      .filter((e) => {
        const r = e.row;
        if (sourceFilter !== "all" && r.source_type.toLowerCase() !== sourceFilter) return false;
        if (confFilter !== "all" && r.confidence.toLowerCase() !== confFilter) return false;
        if (riskFilter !== "all" && e.risk !== riskFilter) return false;
        if (!s) return true;
        const blob = [
          r.claim,
          r.source_file,
          r.source_type,
          r.confidence,
          r.evidence_type,
          r.book_evidence,
          r.movie_evidence,
          r.difference_note,
          r.lexicon_support,
          r.exact_quote,
          r.paraphrase,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return blob.includes(s);
      })
      .sort((a, b) => {
        if (a.risk === b.risk) return 0;
        return a.risk === "high" ? -1 : 1;
      });
  }, [enriched, search, sourceFilter, confFilter, riskFilter]);

  const isExpanded = (id: string, risk: RiskLevel) =>
    expanded[id] !== undefined ? expanded[id] : risk === "high";

  const toggle = (id: string) => setExpanded((p) => ({ ...p, [id]: !p[id] }));

  const FilterChip = ({
    active,
    onClick,
    children,
  }: {
    active: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <Button
      size="sm"
      variant={active ? "default" : "outline"}
      onClick={onClick}
      className="h-7 text-xs"
    >
      {children}
    </Button>
  );

  const copyPoint = (row: EvidencePoint, idx: number) => {
    const draft: EvidencePointDraft = {
      claim: row.claim,
      source_type: row.source_type,
      source_file: row.source_file,
      book_evidence: row.book_evidence,
      movie_evidence: row.movie_evidence,
      difference_note: row.difference_note,
      lexicon_support: row.lexicon_support,
      exact_quote: row.exact_quote,
      paraphrase: row.paraphrase,
      why_this_matters: null,
      confidence: row.confidence,
      evidence_type: row.evidence_type,
      commentary_angle: null,
      secondary_source_support: null,
    };
    navigator.clipboard.writeText(formatPointAsText(draft, idx));
    toast.success(`Copied Evidence Point #${idx + 1}`);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3 sticky top-0 bg-background pb-3 z-10">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search across all fields..."
          className="h-8 text-sm"
        />
        <div className="flex flex-wrap gap-3 items-center">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Source</span>
            {(["all", "book", "movie", "both"] as SourceFilter[]).map((f) => (
              <FilterChip key={f} active={sourceFilter === f} onClick={() => setSourceFilter(f)}>
                {f}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Confidence</span>
            {(["all", "high", "medium", "low"] as ConfidenceFilter[]).map((f) => (
              <FilterChip key={f} active={confFilter === f} onClick={() => setConfFilter(f)}>
                {f}
              </FilterChip>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-1">Risk</span>
            {(["all", "high", "low"] as RiskFilter[]).map((f) => (
              <FilterChip key={f} active={riskFilter === f} onClick={() => setRiskFilter(f)}>
                {f}
              </FilterChip>
            ))}
          </div>
          <div className="ml-auto text-xs text-muted-foreground">
            {filtered.length} of {rows.length} points
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((e) => {
          const r = e.row;
          const idx = rows.indexOf(r);
          const open = isExpanded(r.id, e.risk);
          const status = r.approval_status as "approved" | "rejected" | null;
          return (
            <div
              key={r.id}
              className={`rounded-md border bg-card ${
                e.risk === "high"
                  ? "border-yellow-500/60"
                  : "border-border"
              }`}
            >
              <div className="flex items-start gap-2 p-3">
                <button
                  onClick={() => toggle(r.id)}
                  className="mt-0.5 text-muted-foreground hover:text-foreground"
                  aria-label={open ? "Collapse" : "Expand"}
                >
                  {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-mono text-muted-foreground">#{idx + 1}</span>
                    {e.risk === "high" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border border-yellow-500/40">
                        <Flag className="w-3 h-3" /> High risk
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/10 text-green-700 dark:text-green-400 border border-green-500/40">
                        <CheckCircle2 className="w-3 h-3" /> Auto-approved
                      </span>
                    )}
                    {status === "approved" && (
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/30">
                        Approved
                      </span>
                    )}
                    {status === "rejected" && (
                      <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-destructive/10 text-destructive border border-destructive/30">
                        Rejected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-foreground/90 mt-1 line-clamp-2">{r.claim}</p>
                </div>
                <div className="flex items-center gap-1">
                  {e.risk === "high" && (
                    <>
                      <Button
                        size="sm"
                        variant={status === "approved" ? "default" : "outline"}
                        onClick={() =>
                          onSetApproval(
                            r.id,
                            "approved",
                            (noteDrafts[r.id] ?? (r as any).approval_note ?? "") || null,
                          )
                        }
                        className="h-7 text-xs gap-1"
                      >
                        <ThumbsUp className="w-3 h-3" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant={status === "rejected" ? "destructive" : "outline"}
                        onClick={() => onSetApproval(r.id, "rejected")}
                        className="h-7 text-xs gap-1"
                      >
                        <ThumbsDown className="w-3 h-3" />
                        Reject
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyPoint(r, idx)}
                    className="h-7 text-xs gap-1"
                  >
                    <Copy className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {e.risk === "high" && e.reasons.length > 0 && (
                <div className="px-3 pb-2 -mt-1">
                  <p className="text-[11px] text-yellow-700 dark:text-yellow-400">
                    Flags: {e.reasons.join(" · ")}
                  </p>
                </div>
              )}

              {e.risk === "high" && status === "approved" && (() => {
                const savedNote = ((r as any).approval_note as string | null) ?? "";
                const draft = noteDrafts[r.id] ?? savedNote;
                const dirty = draft !== savedNote;
                const saving = !!savingNote[r.id];
                return (
                  <div className="px-3 pb-3 -mt-1 space-y-1.5">
                    <label className="text-[11px] font-medium text-muted-foreground">
                      Approval note (optional) — passed to Beat Plan, SEP, and Full Script
                    </label>
                    <Textarea
                      value={draft}
                      onChange={(ev) =>
                        setNoteDrafts((prev) => ({ ...prev, [r.id]: ev.target.value }))
                      }
                      rows={2}
                      placeholder='e.g. "use carefully," "frame as interpretation only," "only if book evidence supports it"'
                      className="text-xs bg-background border-border resize-none"
                    />
                    <div className="flex justify-end gap-2">
                      {dirty && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 text-[11px] px-2"
                          onClick={() =>
                            setNoteDrafts((prev) => {
                              const next = { ...prev };
                              delete next[r.id];
                              return next;
                            })
                          }
                          disabled={saving}
                        >
                          Cancel
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-[11px] px-2"
                        disabled={saving || !dirty}
                        onClick={async () => {
                          setSavingNote((p) => ({ ...p, [r.id]: true }));
                          try {
                            await onSetApproval(r.id, "approved", draft.trim() || null);
                            setNoteDrafts((prev) => {
                              const next = { ...prev };
                              delete next[r.id];
                              return next;
                            });
                            toast.success("Approval note saved");
                          } finally {
                            setSavingNote((p) => ({ ...p, [r.id]: false }));
                          }
                        }}
                      >
                        {saving ? "Saving..." : "Save note"}
                      </Button>
                    </div>
                  </div>
                );
              })()}

              <div className="border-t border-border">
                <table className="w-full text-xs">
                  <tbody>
                    {FIELDS.filter((f) => open || COLLAPSED_KEYS.has(f.key as string)).map((f) => {
                      const value = (r as any)[f.key];
                      if (!value && !COLLAPSED_KEYS.has(f.key as string)) return null;
                      return (
                        <tr key={f.key as string} className="border-b border-border/40 last:border-b-0">
                          <td className="px-3 py-1.5 text-muted-foreground font-medium align-top w-40">
                            {f.label}
                          </td>
                          <td className="px-3 py-1.5 text-foreground/85 whitespace-pre-wrap">
                            {value || <span className="text-muted-foreground italic">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-muted-foreground">
            No evidence points match your filters.
          </div>
        )}
      </div>
    </div>
  );
}