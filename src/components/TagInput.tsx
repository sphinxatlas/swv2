import { useState, type KeyboardEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { X } from "lucide-react";

interface TagInputProps {
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  className?: string;
}

/**
 * Free-text chip input. Each entry renders as a removable chip. Pressing Enter
 * or comma commits the typed text as a new chip. Order is preserved (the first
 * entry is treated as the focus entity downstream). Only exact duplicates and
 * blanks are dropped.
 */
export function TagInput({ values, onChange, placeholder, className }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const trimmed = draft.trim().replace(/,+$/g, "").trim();
    if (!trimmed) {
      setDraft("");
      return;
    }
    if (values.includes(trimmed)) {
      setDraft("");
      return;
    }
    onChange([...values, trimmed]);
    setDraft("");
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit();
    } else if (e.key === "Backspace" && draft === "" && values.length > 0) {
      e.preventDefault();
      onChange(values.slice(0, -1));
    }
  };

  const remove = (index: number) => {
    onChange(values.filter((_, i) => i !== index));
  };

  return (
    <div className={className}>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {values.map((value, index) => (
            <Badge key={`${value}-${index}`} variant="secondary" className="gap-1 pr-1 max-w-full">
              <span className="truncate text-[10px]">{value}</span>
              <button
                type="button"
                onClick={() => remove(index)}
                className="hover:bg-background/50 rounded-sm p-0.5"
                aria-label={`Remove ${value}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={commit}
        placeholder={placeholder}
        className="bg-secondary border-border mt-0"
      />
    </div>
  );
}
