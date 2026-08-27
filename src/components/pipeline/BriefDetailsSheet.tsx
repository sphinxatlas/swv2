import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Info, Clock, GitCompare } from "lucide-react";
import { TARGET_LENGTH_OPTIONS } from "@/lib/api";

interface BriefDetailsSheetProps {
  brief: any;
  children: React.ReactNode;
}

export function BriefDetailsSheet({ brief, children }: BriefDetailsSheetProps) {
  if (!brief) return null;

  const lengthOption = TARGET_LENGTH_OPTIONS.find((o) => o.minutes === brief.target_minutes);

  return (
    <Sheet>
      <SheetTrigger asChild>{children}</SheetTrigger>
      <SheetContent side="left" className="w-[400px] sm:max-w-[400px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">Brief Details</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          {brief.id && (
            <Section label="Brief ID">
              <p className="text-xs font-mono text-foreground/85 break-all select-all">{brief.id}</p>
            </Section>
          )}
          {/* Title & Description */}
          <Section label="Title">
            <p className="text-sm text-foreground">{brief.title}</p>
          </Section>
          <Section label="Description">
            <p className="text-sm text-foreground/85">{brief.description}</p>
          </Section>

          {/* Core fields */}
          {brief.thesis && (
            <Section label="Thesis">
              <p className="text-sm text-foreground/85">{brief.thesis}</p>
            </Section>
          )}
          {brief.proof_goal && (
            <Section label="Proof Goal">
              <p className="text-sm text-foreground/85">{brief.proof_goal}</p>
            </Section>
          )}

          {/* Arrays */}
          {brief.focus_areas?.length > 0 && (
            <Section label="Focus Areas">
              <div className="flex flex-wrap gap-1.5">
                {brief.focus_areas.map((a: string) => (
                  <Badge key={a} variant="secondary" className="text-xs">{a}</Badge>
                ))}
              </div>
            </Section>
          )}
          {brief.characters?.length > 0 && (
            <Section label="Characters">
              <div className="flex flex-wrap gap-1.5">
                {brief.characters.map((c: string) => (
                  <Badge key={c} variant="secondary" className="text-xs">{c}</Badge>
                ))}
              </div>
            </Section>
          )}

          {/* Tone & emotional */}
          {brief.emotional_angle && (
            <Section label="Emotional Angle">
              <p className="text-sm text-foreground/85">{brief.emotional_angle}</p>
            </Section>
          )}
          {brief.tone && (
            <Section label="Tone">
              <p className="text-sm text-foreground/85">{brief.tone}</p>
            </Section>
          )}

          {/* Sources */}
          {brief.priority_sources?.length > 0 && (
            <Section label="Priority Sources">
              <div className="flex flex-wrap gap-1.5">
                {brief.priority_sources.map((s: string) => (
                  <Badge key={s} variant="outline" className="text-xs">{s}</Badge>
                ))}
              </div>
            </Section>
          )}

          {/* Target length */}
          <Section label="Target Length">
            <div className="flex items-center gap-1.5 text-sm text-foreground/85">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              {lengthOption?.label || `${brief.target_minutes} min`}
            </div>
          </Section>

          {/* Comparison mode */}
          {brief.comparison_mode && (
            <Section label="Mode">
              <div className="flex items-center gap-1.5 text-sm text-primary">
                <GitCompare className="w-3.5 h-3.5" />
                Book vs Movie Comparison
              </div>
            </Section>
          )}

        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-1.5">{label}</p>
      {children}
    </div>
  );
}
