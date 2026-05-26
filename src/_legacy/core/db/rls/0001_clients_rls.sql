ALTER TABLE clients ENABLE ROW LEVEL SECURITY;

CREATE POLICY clients_tenant_isolation ON clients
  FOR ALL
  USING (org_id = current_setting('app.org_id', true)::uuid)
  WITH CHECK (org_id = current_setting('app.org_id', true)::uuid);

CREATE POLICY clients_owner_restrictive ON clients
  AS RESTRICTIVE
  FOR SELECT
  USING (
    owner_id IS NULL
    OR owner_id = current_setting('app.user_id', true)::uuid
    OR 'admin' = ANY(string_to_array(current_setting('app.roles', true), ','))
  );
