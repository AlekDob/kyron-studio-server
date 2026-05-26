ALTER TABLE client_external_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY external_sources_tenant_isolation ON client_external_sources
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

-- Field mappings non hanno org_id, eredita da source
ALTER TABLE client_field_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY field_mappings_tenant_isolation ON client_field_mappings
  FOR ALL
  USING (
    source_id IN (
      SELECT id FROM client_external_sources
       WHERE org_id = current_setting('app.org_id', true)::uuid
    )
  );
