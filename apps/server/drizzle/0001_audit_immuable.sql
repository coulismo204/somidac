-- Journal d'audit non modifiable (cahier des charges §10.5) :
-- toute tentative de modification ou de suppression, même directement en SQL, est refusée.
CREATE OR REPLACE FUNCTION journal_audit_immuable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit ne peut être ni modifié ni supprimé';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER journal_audit_pas_de_modification
  BEFORE UPDATE OR DELETE ON journal_audit
  FOR EACH ROW EXECUTE FUNCTION journal_audit_immuable();
--> statement-breakpoint
CREATE TRIGGER journal_audit_pas_de_vidage
  BEFORE TRUNCATE ON journal_audit
  FOR EACH STATEMENT EXECUTE FUNCTION journal_audit_immuable();
