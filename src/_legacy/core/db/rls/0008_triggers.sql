-- Trigger: mantiene clients.last_interaction_at coerente quando si inseriscono activities
CREATE OR REPLACE FUNCTION bump_client_last_interaction()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE clients
     SET last_interaction_at = NEW.occurred_at,
         updated_at = now()
   WHERE id = NEW.client_id
     AND (last_interaction_at IS NULL OR last_interaction_at < NEW.occurred_at);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_activities_bump_client ON client_activities;
CREATE TRIGGER trg_activities_bump_client
AFTER INSERT ON client_activities
FOR EACH ROW EXECUTE FUNCTION bump_client_last_interaction();

-- Trigger updated_at generico
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clients_touch ON clients;
CREATE TRIGGER trg_clients_touch BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_contacts_touch ON client_contacts;
CREATE TRIGGER trg_contacts_touch BEFORE UPDATE ON client_contacts
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_opportunities_touch ON client_opportunities;
CREATE TRIGGER trg_opportunities_touch BEFORE UPDATE ON client_opportunities
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_custom_fields_touch ON custom_field_definitions;
CREATE TRIGGER trg_custom_fields_touch BEFORE UPDATE ON custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS trg_external_sources_touch ON client_external_sources;
CREATE TRIGGER trg_external_sources_touch BEFORE UPDATE ON client_external_sources
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
