import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ChevronsUpDown, X, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MultiSelectOption {
  value: string;
  label: string;
  sublabel?: string;
  keywords?: string[];
}

interface MultiSelectChipsProps {
  options: MultiSelectOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  emptyText?: string;
  triggerClassName?: string;
  searchable?: boolean;
  searchPlaceholder?: string;
  emptySearchMessage?: string;
  disabled?: boolean;
}

export function MultiSelectChips({
  options,
  selected,
  onChange,
  placeholder = "Select…",
  emptyText = "No items available.",
  triggerClassName,
  searchable = false,
  searchPlaceholder = "Search…",
  emptySearchMessage = "No matching sources found.",
  disabled = false,
}: MultiSelectChipsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const toggle = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const selectedOptions = options.filter((o) => selected.includes(o.value));

  const normalizedQuery = query.toLowerCase().trim();
  const filteredOptions = searchable && normalizedQuery
    ? options.filter((opt) => {
        const haystack = [opt.label, opt.sublabel, ...(opt.keywords ?? [])]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(normalizedQuery);
      })
    : options;

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(""); }}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            disabled={disabled}
            className={cn(
              "w-full justify-between bg-secondary border-border font-normal",
              triggerClassName,
            )}
          >
            <span className="truncate text-xs">
              {selected.length === 0
                ? placeholder
                : `${selected.length} selected`}
            </span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0 max-h-72 overflow-auto"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          {options.length === 0 ? (
            <div className="p-3 text-xs text-muted-foreground">{emptyText}</div>
          ) : (
            <>
              {searchable && (
                <div className="sticky top-0 z-10 bg-popover border-b border-border p-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                      autoFocus
                      placeholder={searchPlaceholder}
                      className="w-full h-8 pl-7 pr-7 text-xs rounded-md border border-border bg-secondary outline-none focus:ring-1 focus:ring-ring"
                    />
                    {query && (
                      <button
                        type="button"
                        onClick={() => setQuery("")}
                        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-accent"
                        aria-label="Clear search"
                      >
                        <X className="h-3 w-3 text-muted-foreground" />
                      </button>
                    )}
                  </div>
                </div>
              )}
              {filteredOptions.length === 0 ? (
                <div className="p-3 text-xs text-muted-foreground">{emptySearchMessage}</div>
              ) : (
                <ul className="py-1">
                  {filteredOptions.map((opt) => {
                const checked = selected.includes(opt.value);
                return (
                  <li key={opt.value}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        toggle(opt.value);
                      }}
                      className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-accent transition-colors"
                    >
                      <Checkbox
                        checked={checked}
                        className="mt-0.5 pointer-events-none"
                      />
                      <span className="flex-1 min-w-0">
                        <span className="block text-xs font-medium text-foreground truncate">
                          {opt.label}
                        </span>
                        {opt.sublabel && (
                          <span className="block text-[10px] text-muted-foreground truncate">
                            {opt.sublabel}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
                  })}
                </ul>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>

      {selectedOptions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedOptions.map((opt) => (
            <Badge
              key={opt.value}
              variant="secondary"
              className="gap-1 pr-1 max-w-full"
            >
              <span className="truncate text-[10px]">{opt.label}</span>
              <button
                type="button"
                onClick={() => toggle(opt.value)}
                className="hover:bg-background/50 rounded-sm p-0.5"
                aria-label={`Remove ${opt.label}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}