import { Library, ScrollText, Sparkles, Video, BookOpen } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useChannel } from "@/contexts/ChannelContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const navItems = [
  { to: "/briefs", label: "Videos", icon: Video },
  { to: "/", label: "Source Library", icon: Library },
  { to: "/transcripts", label: "Secondary Sources", icon: ScrollText },
];

export function AppSidebar() {
  const location = useLocation();
  const { channels, channelId, setChannelId, loading } = useChannel();

  return (
    <aside className="w-64 border-r border-border bg-sidebar flex flex-col h-screen sticky top-0">
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary/15 flex items-center justify-center ring-1 ring-gold/30">
            <Sparkles className="w-4 h-4 text-gold" />
          </div>
          <div>
            <h1 className="font-mono text-sm font-bold text-foreground tracking-tight">ScriptLab</h1>
            <p className="text-xs text-muted-foreground">Source-Grounded Scripts</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon: Icon }) => {
          const isActive = location.pathname === to || 
            (to === "/briefs" && location.pathname.startsWith("/briefs"));
          return (
            <NavLink
              key={to}
              to={to}
              className={cn(
                "group relative flex items-center gap-3 px-3 py-2.5 rounded-md text-sm transition-all",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-[inset_2px_0_0_0_hsl(var(--gold)/0.7)]"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              <Icon className={cn("w-4 h-4 transition-colors", isActive ? "text-gold" : "group-hover:text-foreground")} />
              {label}
            </NavLink>
          );
        })}
      </nav>

      <div className="p-4 border-t border-border">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <BookOpen className="w-3.5 h-3.5 text-gold/70 shrink-0" />
          <Select value={channelId ?? undefined} onValueChange={setChannelId} disabled={loading || channels.length === 0}>
            <SelectTrigger className="h-7 flex-1 text-xs border-0 bg-transparent px-1 focus:ring-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </aside>
  );
}
