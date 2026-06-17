-- 0001_init.up.sql
-- Initial schema for the Extraction P&ID Co-Editor (PRD §7 data model).
--
-- Tables: account, diagram, diagram_version, element_metadata, proposal.
-- Connections are NOT a table — they live inside the Excalidraw scene JSON on
-- diagram_version.excalidraw_scene (PRD §7). Line-list export derives from
-- scene + metadata downstream.
--
-- Architecture invariants enforced here (CLAUDE.md):
--   * diagram_version is immutable / append-only (UPDATE + DELETE blocked by trigger).
--   * element_metadata is the parallel, element-id-keyed store
--     (convertToExcalidrawElements drops customData — metadata never lives on the element).
--
-- No data-access logic lives here (that is DEV-1135 / DEV-1136). This is schema only.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Account — the tenant boundary. Auth credentials / OAuth client registration
-- are handled by their own tasks; only the identity row is modeled here.
CREATE TABLE account (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email      text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Diagram — owned by an account, with at most one active diagram per account
-- (the one Claude is scoped to). Enforced by a partial unique index below.
CREATE TABLE diagram (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES account (id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (length(name) >= 1),
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX diagram_account_id_idx ON diagram (account_id);

-- At most one active diagram per account.
CREATE UNIQUE INDEX diagram_one_active_per_account_idx
  ON diagram (account_id)
  WHERE active;

-- DiagramVersion — immutable snapshot of the canonical Excalidraw scene.
-- Each save = a new row; prior versions are never mutated (CLAUDE.md invariant).
CREATE TABLE diagram_version (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id       uuid NOT NULL REFERENCES diagram (id) ON DELETE CASCADE,
  excalidraw_scene jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX diagram_version_diagram_id_created_at_idx
  ON diagram_version (diagram_id, created_at);

-- Append-only enforcement: a committed version may never be updated or deleted
-- in place. A WHOLE-DIAGRAM teardown is the one exception: the delete path sets
-- the transaction-local flag `pid.allow_version_cascade` before deleting the
-- parent diagram, letting the FK cascade remove its versions. Standalone version
-- DELETE (no flag) and ALL UPDATEs stay blocked — existing versions remain
-- immutable in place (CLAUDE.md invariant).
CREATE OR REPLACE FUNCTION diagram_version_block_mutation()
  RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE'
     AND current_setting('pid.allow_version_cascade', true) = 'on' THEN
    RETURN OLD; -- permitted: cascade from a parent-diagram delete
  END IF;
  RAISE EXCEPTION 'diagram_version is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER diagram_version_no_update
  BEFORE UPDATE ON diagram_version
  FOR EACH ROW EXECUTE FUNCTION diagram_version_block_mutation();

CREATE TRIGGER diagram_version_no_delete
  BEFORE DELETE ON diagram_version
  FOR EACH ROW EXECUTE FUNCTION diagram_version_block_mutation();

-- ElementMetadata — parallel store keyed by (diagram_version_id, element_id).
-- attributes is JSONB (per acceptance). equipment_type is an open string at the
-- DB layer; the symbol library + validator constrain the allowed set/required attrs.
CREATE TABLE element_metadata (
  diagram_version_id uuid NOT NULL REFERENCES diagram_version (id) ON DELETE CASCADE,
  element_id         text NOT NULL CHECK (length(element_id) >= 1),
  equipment_type     text NOT NULL CHECK (length(equipment_type) >= 1),
  attributes         jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (diagram_version_id, element_id)
);

-- Proposal — a staged, never-applied change from Claude (via MCP).
-- status pending/accepted/rejected. staged_change + validator_report are opaque
-- JSON here; their concrete shapes live behind the validator interface (DEV-1133).
CREATE TYPE proposal_status AS ENUM ('pending', 'accepted', 'rejected');

CREATE TABLE proposal (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id       uuid NOT NULL REFERENCES diagram (id) ON DELETE CASCADE,
  staged_change    jsonb NOT NULL,
  validator_report jsonb NOT NULL,
  status           proposal_status NOT NULL DEFAULT 'pending',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX proposal_diagram_id_status_idx ON proposal (diagram_id, status);
