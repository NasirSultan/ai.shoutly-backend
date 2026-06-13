DROP INDEX IF EXISTS rag_documents_embedding_idx;
ALTER TABLE rag_documents ALTER COLUMN embedding TYPE vector(768) USING NULL;
CREATE INDEX rag_documents_embedding_idx ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
