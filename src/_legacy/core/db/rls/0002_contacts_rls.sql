ALTER TABLE client_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY contacts_tenant_isolation ON client_contacts
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);
