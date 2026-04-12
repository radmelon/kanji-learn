-- Create a separate database for integration tests so they can freely
-- truncate and re-seed without touching dev data.
CREATE DATABASE kanji_buddy_test OWNER kanji;
