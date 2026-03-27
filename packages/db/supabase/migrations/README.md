# Supabase Migrations

Run migrations in order via the Supabase dashboard SQL editor or CLI:

```bash
supabase db push
```

## Migration order

| File | Description |
|------|-------------|
| `0001_create_enums.sql` | PostgreSQL enums (jlpt_level, srs_status, etc.) |
| `0002_create_kanji.sql` | Master kanji table + indexes |
| `0003_create_user_profiles.sql` | User profiles extending auth.users + trigger |
| `0004_create_user_kanji_progress.sql` | SM-2 SRS state per user per kanji |
| `0005_create_review_sessions_and_logs.sql` | Session tracking + per-item review logs |
| `0006_create_mnemonics.sql` | System + user mnemonic hooks |
| `0007_create_daily_stats.sql` | Daily aggregated stats + upsert function |
| `0008_create_interventions_and_attempts.sql` | Interventions, writing, voice attempts |
| `0009_rls_service_role_policies.sql` | RLS service-role bypass for API seeding |

## Notes

- All tables use Row Level Security (RLS)
- Users can only access their own data
- `service_role` key bypasses RLS for seeding and server-side writes
- `upsert_daily_stats()` is called by the API after each completed session
- The `on_auth_user_created` trigger auto-creates a profile on signup
