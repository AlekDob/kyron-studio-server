ALTER TABLE client_opportunities ENABLE ROW LEVEL SECURITY;

CREATE POLICY opportunities_tenant_isolation ON client_opportunities
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
