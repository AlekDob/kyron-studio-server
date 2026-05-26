ALTER TABLE brain_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_chunks ENABLE ROW LEVEL SECURITY;

CREATE POLICY brain_docs_tenant_isolation ON brain_documents
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY brain_chunks_tenant_isolation ON brain_chunks
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

-- Scope client: se il documento ha scope='client', l'utente deve avere anche visibilita' del cliente
CREATE POLICY brain_docs_client_scope_restrictive ON brain_documents
  AS RESTRICTIVE
  FOR SELECT
  USING (
    scope = 'org'
    OR (
      scope = 'client'
      AND EXISTS (
        SELECT 1 FROM clients c
         WHERE c.id = brain_documents.client_id
           AND c.org_id = current_setting('app.org_id', true)::uuid
           AND c.deleted_at IS NULL
      )
    )
  );
