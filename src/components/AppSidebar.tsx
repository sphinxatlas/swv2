import { Library, ScrollText, Sparkles, Feather, BookOpen } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/", label: "Source Library", icon: Library },
  { to: "/briefs", label: "Topic Briefs", icon: Feather },
  { to: "/transcripts", label: "Secondary Sources", icon: ScrollText },
];

export function AppSidebar() {
  const location = useLocation();

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
          <BookOpen className="w-3.5 h-3.5 text-gold/70" />
          <span>Harry Potter Universe</span>
        </div>
      </div>
    </aside>
  );
}
