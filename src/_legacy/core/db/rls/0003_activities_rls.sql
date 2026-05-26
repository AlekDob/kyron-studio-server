ALTER TABLE client_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY activities_tenant_isolation ON client_activities
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
