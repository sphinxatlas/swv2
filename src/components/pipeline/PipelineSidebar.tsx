import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PIPELINE_STEPS, type PipelineStepType } from "@/lib/api";
import { ArrowLeft, CheckCircle2, Circle, GitCompare, Info, Clock, Download, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { BriefDetailsSheet } from "./BriefDetailsSheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface PipelineSidebarProps {

  brief: any;
  activeStep: PipelineStepType;
  setActiveStep: (step: PipelineStepType) => void;
  generating: boolean;
  getStepOutput: (step: PipelineStepType) => any;
  onDownloadPipeline?: () => void;
}

export function PipelineSidebar({ brief, activeStep, setActiveStep, generating, getStepOutput, onDownloadPipeline }: PipelineSidebarProps) {
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);

  const visibleSteps = PIPELINE_STEPS.filter((s) => s.visible);

  return (
    <TooltipProvider delayDuration={200}>
      <div
        className={cn(
          "border-r border-border flex flex-col shrink-0 transition-[width] duration-200",
          collapsed ? "w-12 p-2" : "w-56 p-4"
        )}
      >
        <div className={cn("flex", collapsed ? "justify-center mb-3" : "justify-end mb-1")}>
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand pipeline sidebar" : "Collapse pipeline sidebar"}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {!collapsed && (
          <>
            <button
              onClick={() => navigate("/briefs")}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground mb-4 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to Videos
            </button>

            {brief && (
              <div className="mb-4 pb-4 border-b border-border">
                <div className="flex items-center gap-1.5">
                  <h2 className="font-mono text-xs font-bold text-foreground line-clamp-2">{brief.title}</h2>
                  {brief.comparison_mode && <GitCompare className="w-3 h-3 text-primary shrink-0" />}
                </div>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{brief.description}</p>
                <div className="flex items-center gap-3 mt-2">
                  <BriefDetailsSheet brief={brief}>
                    <button className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors">
                      <Info className="w-3 h-3" />
                      View all inputs
                    </button>
                  </BriefDetailsSheet>
                  {onDownloadPipeline && (
                    <button
                      onClick={onDownloadPipeline}
                      className="flex items-center gap-1 text-[10px] text-primary hover:text-primary/80 transition-colors"
                    >
                      <Download className="w-3 h-3" />
                      Download Pipeline
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div className="space-y-1 flex-1">
          {visibleSteps.map((step) => {
            const hasOutput = !!getStepOutput(step.type);
            const isActive = activeStep === step.type;
            const isCreativeBrief = step.type === "creative_brief";
            const cbApproved = !!(brief && (brief as any).creative_brief_approved);

            const icon = hasOutput ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-gold flex-shrink-0" />
            ) : (
              <Circle className="w-3.5 h-3.5 flex-shrink-0" />
            );

            if (collapsed) {
              return (
                <Tooltip key={step.type}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => !generating && setActiveStep(step.type)}
                      aria-label={step.label}
                      className={cn(
                        "w-full flex items-center justify-center py-2 rounded-md transition-all",
                        isActive
                          ? "bg-secondary text-foreground shadow-[inset_2px_0_0_0_hsl(var(--gold)/0.7)]"
                          : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                        generating && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {icon}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right">{step.label}</TooltipContent>
                </Tooltip>
              );
            }

            return (
              <button
                key={step.type}
                onClick={() => !generating && setActiveStep(step.type)}
                className={cn(
                  "w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left transition-all",
                  isActive
                    ? "bg-secondary text-foreground shadow-[inset_2px_0_0_0_hsl(var(--gold)/0.7)]"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/50",
                  generating && "opacity-50 cursor-not-allowed"
                )}
              >
                {icon}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono font-medium truncate">{step.label}</p>
                  {isCreativeBrief && hasOutput && (
                    cbApproved ? (
                      <p className="text-[10px] text-green-500 flex items-center gap-1 mt-0.5">
                        <CheckCircle2 className="w-2.5 h-2.5" />
                        Approved
                      </p>
                    ) : (
                      <p className="text-[10px] text-amber-500 flex items-center gap-1 mt-0.5">
                        <Clock className="w-2.5 h-2.5" />
                        Pending Review
                      </p>
                    )
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </TooltipProvider>
  );
}
