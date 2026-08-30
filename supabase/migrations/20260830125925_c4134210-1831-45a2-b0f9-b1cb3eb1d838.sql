ALTER TABLE public.source_files
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS extraction_method text;