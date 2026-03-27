-- Migration 0001: Create enums
-- Run order: 1

CREATE TYPE jlpt_level AS ENUM ('N5', 'N4', 'N3', 'N2', 'N1');

CREATE TYPE srs_status AS ENUM (
  'unseen',
  'learning',
  'reviewing',
  'remembered',
  'burned'
);

CREATE TYPE mnemonic_type AS ENUM ('system', 'user');

CREATE TYPE review_type AS ENUM ('meaning', 'reading', 'writing', 'compound');

CREATE TYPE intervention_type AS ENUM ('absence', 'velocity_drop', 'plateau');
