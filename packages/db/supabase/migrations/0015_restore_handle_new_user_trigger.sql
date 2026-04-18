-- 0015_restore_handle_new_user_trigger.sql
--
-- The function + trigger defined in 0003 were dropped from prod at some
-- point (Supabase regional migration, manual cleanup, or project reset).
-- Recreate them idempotently so the schema matches the repo again.
--
-- The API also self-heals missing user_profiles rows on first fetch, so
-- this trigger is now an optimization rather than a hard requirement.

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO user_profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
