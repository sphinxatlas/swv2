export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      alternative_sources: {
        Row: {
          channel_id: string
          char_count: number | null
          content: string
          created_at: string
          estimated_tokens: number | null
          id: string
          notes: string | null
          script_strength: string | null
          source_author: string | null
          source_type: string | null
          title: string
          updated_at: string
          url: string | null
        }
        Insert: {
          channel_id?: string
          char_count?: number | null
          content: string
          created_at?: string
          estimated_tokens?: number | null
          id?: string
          notes?: string | null
          script_strength?: string | null
          source_author?: string | null
          source_type?: string | null
          title: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          channel_id?: string
          char_count?: number | null
          content?: string
          created_at?: string
          estimated_tokens?: number | null
          id?: string
          notes?: string | null
          script_strength?: string | null
          source_author?: string | null
          source_type?: string | null
          title?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alternative_sources_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_alternative_source_links: {
        Row: {
          alternative_source_id: string
          brief_id: string
        }
        Insert: {
          alternative_source_id: string
          brief_id: string
        }
        Update: {
          alternative_source_id?: string
          brief_id?: string
        }
        Relationships: []
      }
      brief_format_reference_links: {
        Row: {
          brief_id: string
          transcript_id: string
        }
        Insert: {
          brief_id: string
          transcript_id: string
        }
        Update: {
          brief_id?: string
          transcript_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_format_reference_links_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "topic_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_format_reference_links_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "format_reference_transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_topic_transcript_links: {
        Row: {
          brief_id: string
          transcript_id: string
        }
        Insert: {
          brief_id: string
          transcript_id: string
        }
        Update: {
          brief_id?: string
          transcript_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_topic_transcript_links_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "topic_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brief_topic_transcript_links_transcript_id_fkey"
            columns: ["transcript_id"]
            isOneToOne: false
            referencedRelation: "brief_topic_transcripts"
            referencedColumns: ["id"]
          },
        ]
      }
      brief_topic_transcripts: {
        Row: {
          channel_id: string
          channel_name: string
          char_count: number | null
          created_at: string
          estimated_tokens: number | null
          id: string
          script_strength: string | null
          transcript: string
          video_title: string
        }
        Insert: {
          channel_id?: string
          channel_name: string
          char_count?: number | null
          created_at?: string
          estimated_tokens?: number | null
          id?: string
          script_strength?: string | null
          transcript: string
          video_title: string
        }
        Update: {
          channel_id?: string
          channel_name?: string
          char_count?: number | null
          created_at?: string
          estimated_tokens?: number | null
          id?: string
          script_strength?: string | null
          transcript?: string
          video_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "brief_topic_transcripts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      channels: {
        Row: {
          abbreviation_map: Json
          comparison_axis_labels: Json
          comparison_mode_available: boolean
          created_at: string
          description: string | null
          entity_roster: Json
          id: string
          is_active: boolean
          name: string
          query_expansion_map: Json
          slug: string
          sort_order: number
          source_catalog: Json
          source_hierarchy: Json
          subject_label: string
          updated_at: string
          worked_examples: Json
        }
        Insert: {
          abbreviation_map?: Json
          comparison_axis_labels?: Json
          comparison_mode_available?: boolean
          created_at?: string
          description?: string | null
          entity_roster?: Json
          id?: string
          is_active?: boolean
          name: string
          query_expansion_map?: Json
          slug: string
          sort_order?: number
          source_catalog?: Json
          source_hierarchy?: Json
          subject_label: string
          updated_at?: string
          worked_examples?: Json
        }
        Update: {
          abbreviation_map?: Json
          comparison_axis_labels?: Json
          comparison_mode_available?: boolean
          created_at?: string
          description?: string | null
          entity_roster?: Json
          id?: string
          is_active?: boolean
          name?: string
          query_expansion_map?: Json
          slug?: string
          sort_order?: number
          source_catalog?: Json
          source_hierarchy?: Json
          subject_label?: string
          updated_at?: string
          worked_examples?: Json
        }
        Relationships: []
      }
      evidence_points: {
        Row: {
          approval_note: string | null
          approval_status: string | null
          book_evidence: string | null
          brief_id: string
          claim: string
          commentary_angle: string | null
          confidence: string
          created_at: string
          difference_note: string | null
          evidence_type: string
          exact_quote: string | null
          id: string
          lexicon_support: string | null
          movie_evidence: string | null
          paraphrase: string | null
          secondary_source_support: string | null
          source_file: string | null
          source_type: string
          starred: boolean
          why_this_matters: string | null
        }
        Insert: {
          approval_note?: string | null
          approval_status?: string | null
          book_evidence?: string | null
          brief_id: string
          claim: string
          commentary_angle?: string | null
          confidence?: string
          created_at?: string
          difference_note?: string | null
          evidence_type?: string
          exact_quote?: string | null
          id?: string
          lexicon_support?: string | null
          movie_evidence?: string | null
          paraphrase?: string | null
          secondary_source_support?: string | null
          source_file?: string | null
          source_type: string
          starred?: boolean
          why_this_matters?: string | null
        }
        Update: {
          approval_note?: string | null
          approval_status?: string | null
          book_evidence?: string | null
          brief_id?: string
          claim?: string
          commentary_angle?: string | null
          confidence?: string
          created_at?: string
          difference_note?: string | null
          evidence_type?: string
          exact_quote?: string | null
          id?: string
          lexicon_support?: string | null
          movie_evidence?: string | null
          paraphrase?: string | null
          secondary_source_support?: string | null
          source_file?: string | null
          source_type?: string
          starred?: boolean
          why_this_matters?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "evidence_points_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "topic_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      file_chunks: {
        Row: {
          chunk_index: number
          content: string
          created_at: string
          embedding: string | null
          file_id: string
          id: string
          search_vector: unknown
        }
        Insert: {
          chunk_index: number
          content: string
          created_at?: string
          embedding?: string | null
          file_id: string
          id?: string
          search_vector?: unknown
        }
        Update: {
          chunk_index?: number
          content?: string
          created_at?: string
          embedding?: string | null
          file_id?: string
          id?: string
          search_vector?: unknown
        }
        Relationships: [
          {
            foreignKeyName: "file_chunks_file_id_fkey"
            columns: ["file_id"]
            isOneToOne: false
            referencedRelation: "source_files"
            referencedColumns: ["id"]
          },
        ]
      }
      format_reference_transcripts: {
        Row: {
          channel_id: string
          channel_name: string
          created_at: string
          id: string
          transcript: string
          video_title: string
        }
        Insert: {
          channel_id?: string
          channel_name: string
          created_at?: string
          id?: string
          transcript: string
          video_title: string
        }
        Update: {
          channel_id?: string
          channel_name?: string
          created_at?: string
          id?: string
          transcript?: string
          video_title?: string
        }
        Relationships: [
          {
            foreignKeyName: "format_reference_transcripts_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      pipeline_outputs: {
        Row: {
          brief_id: string
          content: string
          created_at: string
          id: string
          step_type: Database["public"]["Enums"]["pipeline_step_type"]
        }
        Insert: {
          brief_id: string
          content: string
          created_at?: string
          id?: string
          step_type: Database["public"]["Enums"]["pipeline_step_type"]
        }
        Update: {
          brief_id?: string
          content?: string
          created_at?: string
          id?: string
          step_type?: Database["public"]["Enums"]["pipeline_step_type"]
        }
        Relationships: [
          {
            foreignKeyName: "pipeline_outputs_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "topic_briefs"
            referencedColumns: ["id"]
          },
        ]
      }
      source_files: {
        Row: {
          brief_id: string | null
          channel_id: string
          char_count: number | null
          created_at: string
          estimated_tokens: number | null
          file_size: number | null
          file_type: Database["public"]["Enums"]["source_file_type"]
          id: string
          name: string
          processing_error: string | null
          script_strength: string | null
          status: string
          storage_path: string
        }
        Insert: {
          brief_id?: string | null
          channel_id?: string
          char_count?: number | null
          created_at?: string
          estimated_tokens?: number | null
          file_size?: number | null
          file_type: Database["public"]["Enums"]["source_file_type"]
          id?: string
          name: string
          processing_error?: string | null
          script_strength?: string | null
          status?: string
          storage_path: string
        }
        Update: {
          brief_id?: string | null
          channel_id?: string
          char_count?: number | null
          created_at?: string
          estimated_tokens?: number | null
          file_size?: number | null
          file_type?: Database["public"]["Enums"]["source_file_type"]
          id?: string
          name?: string
          processing_error?: string | null
          script_strength?: string | null
          status?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "source_files_brief_id_fkey"
            columns: ["brief_id"]
            isOneToOne: false
            referencedRelation: "topic_briefs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "source_files_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
      topic_briefs: {
        Row: {
          angle_note: string | null
          channel_id: string
          characters: string[] | null
          comparison_mode: boolean
          competitor_script_1: string | null
          competitor_script_2: string | null
          competitor_script_3: string | null
          competitor_script_4: string | null
          competitor_script_5: string | null
          created_at: string
          creative_brief_approved: boolean
          creative_brief_feedback: string | null
          description: string
          emotional_angle: string | null
          focus_areas: string[] | null
          id: string
          priority_sources: string[] | null
          proof_goal: string | null
          target_max_words: number
          target_min_words: number
          target_minutes: number
          thesis: string | null
          title: string
          tone: string | null
          updated_at: string
        }
        Insert: {
          angle_note?: string | null
          channel_id?: string
          characters?: string[] | null
          comparison_mode?: boolean
          competitor_script_1?: string | null
          competitor_script_2?: string | null
          competitor_script_3?: string | null
          competitor_script_4?: string | null
          competitor_script_5?: string | null
          created_at?: string
          creative_brief_approved?: boolean
          creative_brief_feedback?: string | null
          description: string
          emotional_angle?: string | null
          focus_areas?: string[] | null
          id?: string
          priority_sources?: string[] | null
          proof_goal?: string | null
          target_max_words?: number
          target_min_words?: number
          target_minutes?: number
          thesis?: string | null
          title: string
          tone?: string | null
          updated_at?: string
        }
        Update: {
          angle_note?: string | null
          channel_id?: string
          characters?: string[] | null
          comparison_mode?: boolean
          competitor_script_1?: string | null
          competitor_script_2?: string | null
          competitor_script_3?: string | null
          competitor_script_4?: string | null
          competitor_script_5?: string | null
          created_at?: string
          creative_brief_approved?: boolean
          creative_brief_feedback?: string | null
          description?: string
          emotional_angle?: string | null
          focus_areas?: string[] | null
          id?: string
          priority_sources?: string[] | null
          proof_goal?: string | null
          target_max_words?: number
          target_min_words?: number
          target_minutes?: number
          thesis?: string | null
          title?: string
          tone?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "topic_briefs_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "channels"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      match_chunks: {
        Args: {
          k?: number
          p_brief_id?: string
          p_channel_id: string
          query_embedding: string
          source_type: Database["public"]["Enums"]["source_file_type"]
        }
        Returns: {
          chunk_index: number
          content: string
          file_id: string
          file_name: string
          file_type: Database["public"]["Enums"]["source_file_type"]
          id: string
          similarity: number
        }[]
      }
      search_chunks_by_type: {
        Args: {
          max_results?: number
          p_brief_id?: string
          p_channel_id: string
          search_query: string
          source_type: Database["public"]["Enums"]["source_file_type"]
        }
        Returns: {
          chunk_index: number
          content: string
          file_id: string
          file_name: string
          file_type: Database["public"]["Enums"]["source_file_type"]
          id: string
          rank: number
        }[]
      }
    }
    Enums: {
      pipeline_step_type:
        | "evidence_table"
        | "analysis_memo"
        | "outline"
        | "full_script"
        | "verification"
        | "retrieval"
        | "competitor_format_analysis"
        | "creative_brief"
        | "six_category_extraction"
        | "selected_source_analysis"
        | "script_evidence_pack"
        | "melty_voice_pass"
        | "melty_voice_pass_log"
        | "anti_ai_output"
        | "angle_check"
      source_file_type:
        | "book"
        | "transcript"
        | "instructions"
        | "lexicon"
        | "script_strategy"
        | "competitor_analysis"
        | "host_persona"
        | "anti_ai_guide"
        | "melty_voice_pass"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      pipeline_step_type: [
        "evidence_table",
        "analysis_memo",
        "outline",
        "full_script",
        "verification",
        "retrieval",
        "competitor_format_analysis",
        "creative_brief",
        "six_category_extraction",
        "selected_source_analysis",
        "script_evidence_pack",
        "melty_voice_pass",
        "melty_voice_pass_log",
        "anti_ai_output",
        "angle_check",
      ],
      source_file_type: [
        "book",
        "transcript",
        "instructions",
        "lexicon",
        "script_strategy",
        "competitor_analysis",
        "host_persona",
        "anti_ai_guide",
        "melty_voice_pass",
      ],
    },
  },
} as const
