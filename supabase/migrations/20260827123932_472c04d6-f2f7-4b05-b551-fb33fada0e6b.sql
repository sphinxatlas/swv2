DO $$
DECLARE hp uuid;
BEGIN
  SELECT id INTO hp FROM public.channels WHERE slug = 'harry-potter';
  EXECUTE format('ALTER TABLE public.source_files ALTER COLUMN channel_id SET DEFAULT %L::uuid', hp);
  EXECUTE format('ALTER TABLE public.topic_briefs ALTER COLUMN channel_id SET DEFAULT %L::uuid', hp);
  EXECUTE format('ALTER TABLE public.format_reference_transcripts ALTER COLUMN channel_id SET DEFAULT %L::uuid', hp);
  EXECUTE format('ALTER TABLE public.brief_topic_transcripts ALTER COLUMN channel_id SET DEFAULT %L::uuid', hp);
  EXECUTE format('ALTER TABLE public.alternative_sources ALTER COLUMN channel_id SET DEFAULT %L::uuid', hp);
END $$;