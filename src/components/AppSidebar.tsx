import { Library, ScrollText, Sparkles, Video, BookOpen, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useChannel } from "@/contexts/ChannelContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

const navItems = [
  { to: "/briefs", label: "Videos", icon: Video },
  { to: "/", label: "Source Library", icon: Library },
  { to: "/transcripts", label: "Secondary Sources", icon: ScrollText },
];

interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function AppSidebar({ collapsed, onToggle }: AppSidebarProps) {
  const location = useLocation();
  const { channels, channelId, setChannelId, loading } = useChannel();

  const channelSelect = (
    <Select value={channelId ?? undefined} onValueChange={setChannelId} disabled={loading || channels.length === 0}>
      <SelectTrigger
        className={cn(
          "h-7 text-xs border-0 bg-transparent px-1 focus:ring-0",
          collapsed ? "w-7 justify-center [&>svg]:hidden" : "flex-1"
        )}
        aria-label="Select channel"
      >
        {collapsed ? <BookOpen className="w-3.5 h-3.5 text-gold/70 shrink-0" /> : <SelectValue />}
      </SelectTrigger>
      <SelectContent>
        {channels.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "border-r border-border bg-sidebar flex flex-col h-screen sticky top-0 transition-[width] duration-200",
          collapsed ? "w-14" : "w-64"
        )}
      >
        <div className={cn("border-b border-border", collapsed ? "p-3" : "p-6")}>
          <div className={cn("flex items-center", collapsed ? "flex-col gap-2" : "gap-3")}>
            <div className="w-8 h-8 rounded-md bg-primary/15 flex items-center justify-center ring-1 ring-gold/30 shrink-0">
              <Sparkles className="w-4 h-4 text-gold" />
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <h1 className="font-mono text-sm font-bold text-foreground tracking-tight">ScriptLab</h1>
                <p className="text-xs text-muted-foreground">Source-Grounded Scripts</p>
              </div>
            )}
            <button
              onClick={onToggle}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <nav className={cn("flex-1 space-y-1", collapsed ? "p-2" : "p-3")}>
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname === to ||
              (to === "/briefs" && location.pathname.startsWith("/briefs"));
            const link = (
              <NavLink
                key={to}
                to={to}
                className={cn(
                  "group relative flex items-center gap-3 rounded-md text-sm transition-all",
                  collapsed ? "justify-center px-0 py-2.5" : "px-3 py-2.5",
                  isActive
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[inset_2px_0_0_0_hsl(var(--gold)/0.7)]"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                )}
              >
                <Icon className={cn("w-4 h-4 shrink-0 transition-colors", isActive ? "text-gold" : "group-hover:text-foreground")} />
                {!collapsed && label}
              </NavLink>
            );
            return collapsed ? (
              <Tooltip key={to}>
                <TooltipTrigger asChild>{link}</TooltipTrigger>
                <TooltipContent side="right">{label}</TooltipContent>
              </Tooltip>
            ) : (
              link
            );
          })}
        </nav>

        <div className={cn("border-t border-border", collapsed ? "p-2" : "p-4")}>
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="flex justify-center">{channelSelect}</div>
              </TooltipTrigger>
              <TooltipContent side="right">
                {channels.find((c) => c.id === channelId)?.name ?? "Select channel"}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <BookOpen className="w-3.5 h-3.5 text-gold/70 shrink-0" />
              {channelSelect}
            </div>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
