-- 013: Assign manager role to akash@skarion.com
-- Idempotent. Runs in the neon_fixes pipeline on every deploy.

DO $$
BEGIN
  UPDATE profiles SET role = 'manager', updated_at = NOW()
  WHERE email = 'akash@skarion.com'
    AND is_active = true
    AND role IS DISTINCT FROM 'manager';
END $$;
