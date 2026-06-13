-- Run this in your Supabase SQL Editor
-- Requires pgvector extension (already enabled)

CREATE TABLE IF NOT EXISTS rag_documents (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT        NOT NULL,
  content     TEXT        NOT NULL,
  source      TEXT        NOT NULL DEFAULT '',
  metadata    JSONB       NOT NULL DEFAULT '{}',
  embedding   vector(768),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- IVFFlat index for fast approximate nearest-neighbour search
-- Increase lists value as your document count grows (lists ≈ sqrt(row_count))
CREATE INDEX IF NOT EXISTS rag_documents_embedding_idx
  ON rag_documents
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_rag_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS rag_documents_updated_at ON rag_documents;
CREATE TRIGGER rag_documents_updated_at
  BEFORE UPDATE ON rag_documents
  FOR EACH ROW EXECUTE FUNCTION update_rag_updated_at();
