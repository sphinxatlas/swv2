ALTER TABLE public.source_files
  ADD COLUMN brief_id uuid NULL REFERENCES public.topic_briefs(id) ON DELETE CASCADE;

CREATE INDEX idx_source_files_brief_id ON public.source_files(brief_id);

DROP FUNCTION IF EXISTS public.search_chunks_by_type(text, source_file_type, uuid, integer);
DROP FUNCTION IF EXISTS public.match_chunks(vector, source_file_type, uuid, integer);

CREATE FUNCTION public.search_chunks_by_type(search_query text, source_type source_file_type, p_channel_id uuid, max_results integer DEFAULT 20, p_brief_id uuid DEFAULT NULL)
 RETURNS TABLE(id uuid, file_id uuid, content text, chunk_index integer, file_name text, file_type source_file_type, rank real)
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    fc.id,
    fc.file_id,
    fc.content,
    fc.chunk_index,
    sf.name AS file_name,
    sf.file_type,
    ts_rank(fc.search_vector, plainto_tsquery('english', search_query)) AS rank
  FROM public.file_chunks fc
  JOIN public.source_files sf ON sf.id = fc.file_id
  WHERE fc.search_vector @@ plainto_tsquery('english', search_query)
    AND sf.file_type = source_type
    AND sf.channel_id = p_channel_id
    AND (sf.brief_id IS NULL OR sf.brief_id = p_brief_id)
  ORDER BY rank DESC
  LIMIT max_results;
END;
$function$;

CREATE FUNCTION public.match_chunks(query_embedding vector, source_type source_file_type, p_channel_id uuid, k integer DEFAULT 20, p_brief_id uuid DEFAULT NULL)
 RETURNS TABLE(id uuid, file_id uuid, content text, chunk_index integer, file_name text, file_type source_file_type, similarity real)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    fc.id,
    fc.file_id,
    fc.content,
    fc.chunk_index,
    sf.name AS file_name,
    sf.file_type,
    (1 - (fc.embedding <=> query_embedding))::real AS similarity
  FROM public.file_chunks fc
  JOIN public.source_files sf ON sf.id = fc.file_id
  WHERE fc.embedding IS NOT NULL
    AND sf.file_type = source_type
    AND sf.channel_id = p_channel_id
    AND (sf.brief_id IS NULL OR sf.brief_id = p_brief_id)
  ORDER BY fc.embedding <=> query_embedding
  LIMIT k;
END;
$function$;