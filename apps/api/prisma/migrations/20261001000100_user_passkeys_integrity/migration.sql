-- AddForeignKey
ALTER TABLE "user_passkeys" ADD CONSTRAINT "user_passkeys_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A passkey is part of the security record: revoke it, never delete it.
CREATE TRIGGER user_passkeys_no_delete
  BEFORE DELETE ON user_passkeys FOR EACH ROW EXECUTE FUNCTION osooli_reject_change();
