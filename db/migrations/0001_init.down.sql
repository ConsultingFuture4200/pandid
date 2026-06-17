-- 0001_init.down.sql
-- Reverses 0001_init.up.sql. Drops in reverse dependency order so the DB
-- returns to an empty state (no app objects). The pgcrypto extension is left
-- in place — it is shared, not owned by this schema, and dropping it could
-- break other objects in the database.

DROP TABLE IF EXISTS proposal;
DROP TYPE IF EXISTS proposal_status;

DROP TABLE IF EXISTS element_metadata;

DROP TRIGGER IF EXISTS diagram_version_no_delete ON diagram_version;
DROP TRIGGER IF EXISTS diagram_version_no_update ON diagram_version;
DROP TABLE IF EXISTS diagram_version;
DROP FUNCTION IF EXISTS diagram_version_block_mutation();

DROP TABLE IF EXISTS diagram;
DROP TABLE IF EXISTS account;
