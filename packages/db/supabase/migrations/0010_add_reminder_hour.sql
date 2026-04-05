-- Migration 0010: Add reminder_hour and push_token to user_profiles
-- reminder_hour: 0-23, the hour in the user's timezone to send the daily reminder
-- push_token: Expo push token (moved from being managed only in code)

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS reminder_hour SMALLINT NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS push_token    TEXT;

COMMENT ON COLUMN user_profiles.reminder_hour IS 'Hour (0-23) in user timezone to send the daily reminder. Default 20 = 8pm.';
COMMENT ON COLUMN user_profiles.push_token    IS 'Expo push notification token, registered on device login.';
