ALTER TABLE custom_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_fields_tenant_isolation ON custom_field_definitions
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
