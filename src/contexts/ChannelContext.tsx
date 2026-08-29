import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

const STORAGE_KEY = "scriptlab.channelId";

export interface Channel {
  id: string;
  name: string;
  slug: string;
  subject_label: string;
  source_catalog: any;
  comparison_axis_labels: any;
  comparison_mode_available: boolean;
  sort_order: number;
}

interface ChannelContextValue {
  channels: Channel[];
  channelId: string | null;
  channel: Channel | null;
  setChannelId: (id: string) => void;
  refreshChannels: () => void;
  loading: boolean;
}

const ChannelContext = createContext<ChannelContextValue | undefined>(undefined);

export function ChannelProvider({ children }: { children: ReactNode }) {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelId, setChannelIdState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadChannels = useCallback(async () => {
    const { data, error } = await supabase
      .from("channels")
      .select(
        "id, name, slug, subject_label, source_catalog, comparison_axis_labels, comparison_mode_available, sort_order",
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) {
      console.error("Failed to load channels", error);
      setChannels([]);
      setLoading(false);
      return;
    }
    const list = (data || []) as Channel[];
    setChannels(list);
    setChannelIdState((prev) => {
      if (prev && list.some((c) => c.id === prev)) return prev;
      const stored = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
      return list.find((c) => c.id === stored)?.id ?? list[0]?.id ?? null;
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadChannels();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [loadChannels]);

  const refreshChannels = useCallback(() => {
    void loadChannels();
  }, [loadChannels]);

  const setChannelId = (id: string) => {
    setChannelIdState(id);
    try {
      window.localStorage.setItem(STORAGE_KEY, id);
    } catch {
      /* ignore */
    }
  };

  const value = useMemo<ChannelContextValue>(
    () => ({
      channels,
      channelId,
      channel: channels.find((c) => c.id === channelId) ?? null,
      setChannelId,
      loading,
    }),
    [channels, channelId, loading],
  );

  return <ChannelContext.Provider value={value}>{children}</ChannelContext.Provider>;
}

export function useChannel() {
  const ctx = useContext(ChannelContext);
  if (!ctx) throw new Error("useChannel must be used within a ChannelProvider");
  return ctx;
}
