-- Migration 0009: Service-role bypass policies for API server operations
-- The API server uses the service role key and needs unrestricted access
-- for seeding, analytics aggregation, and intervention writes.
-- Run order: 9

-- kanji table: public read, service-role write
CREATE POLICY "Public can read kanji"
  ON kanji FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role to insert/update kanji (seed script)
CREATE POLICY "Service role can manage kanji"
  ON kanji FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE kanji ENABLE ROW LEVEL SECURITY;

-- interventions: service role can insert triggers
CREATE POLICY "Service role can manage interventions"
  ON interventions FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- mnemonics: service role can seed system mnemonics
CREATE POLICY "Service role can manage system mnemonics"
  ON mnemonics FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- daily_stats: service role can write aggregated stats
CREATE POLICY "Service role can manage daily stats"
  ON daily_stats FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
