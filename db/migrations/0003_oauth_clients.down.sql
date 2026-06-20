-- DEV-1148 — OAuth DCR store (FR-21). Down migration: reverse of 0003_oauth_clients.up.sql.

DROP TABLE IF EXISTS oauth_clients;
