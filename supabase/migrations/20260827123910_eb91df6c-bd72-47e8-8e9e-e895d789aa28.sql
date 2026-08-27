CREATE TABLE public.channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  entity_roster jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_catalog jsonb NOT NULL DEFAULT '[]'::jsonb,
  abbreviation_map jsonb NOT NULL DEFAULT '[]'::jsonb,
  query_expansion_map jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hierarchy jsonb NOT NULL DEFAULT '{}'::jsonb,
  comparison_mode_available boolean NOT NULL DEFAULT false,
  comparison_axis_labels jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.channels TO anon, authenticated;
GRANT ALL ON public.channels TO service_role;

ALTER TABLE public.channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read channels" ON public.channels FOR SELECT USING (true);
CREATE POLICY "Public insert channels" ON public.channels FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update channels" ON public.channels FOR UPDATE USING (true);
CREATE POLICY "Public delete channels" ON public.channels FOR DELETE USING (true);

CREATE TRIGGER update_channels_updated_at
BEFORE UPDATE ON public.channels
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.channels (name, slug, description, sort_order, comparison_mode_available, comparison_axis_labels)
VALUES
  ('Harry Potter Universe', 'harry-potter', 'Book aware Harry Potter commentary and adaptation analysis.', 1, true, '{"side_a": "Book", "side_b": "Movie"}'::jsonb),
  ('Culture and Economics', 'culture-economics', 'Faceless commentary on modern life, economics, culture, and internet platforms.', 2, false, '{}'::jsonb);

ALTER TABLE public.source_files ADD COLUMN channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE RESTRICT;
ALTER TABLE public.topic_briefs ADD COLUMN channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE RESTRICT;
ALTER TABLE public.format_reference_transcripts ADD COLUMN channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE RESTRICT;
ALTER TABLE public.brief_topic_transcripts ADD COLUMN channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE RESTRICT;
ALTER TABLE public.alternative_sources ADD COLUMN channel_id uuid NOT NULL REFERENCES public.channels(id) ON DELETE RESTRICT;

CREATE INDEX idx_source_files_channel_id ON public.source_files USING btree (channel_id);
CREATE INDEX idx_topic_briefs_channel_id ON public.topic_briefs USING btree (channel_id);
CREATE INDEX idx_format_reference_transcripts_channel_id ON public.format_reference_transcripts USING btree (channel_id);
CREATE INDEX idx_brief_topic_transcripts_channel_id ON public.brief_topic_transcripts USING btree (channel_id);
CREATE INDEX idx_alternative_sources_channel_id ON public.alternative_sources USING btree (channel_id);

DROP TABLE IF EXISTS public.question_bank_evidence CASCADE;
DROP TABLE IF EXISTS public.question_bank_entries CASCADE;
DROP TABLE IF EXISTS public.angle_lab_runs CASCADE;
DROP TABLE IF EXISTS public.clip_quote_finder_runs CASCADE;
DROP TABLE IF EXISTS public.improved_scripts CASCADE;