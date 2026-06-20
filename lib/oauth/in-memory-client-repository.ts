/**
 * In-memory OAuthClientRepository (DEV-1148 / 15b, FR-21).
 *
 * Test double for the DCR service and a stand-in for local development before
 * the Postgres-backed repository is wired by persistence. It is NOT the
 * production store — `getOAuthClientRepository` (see `index.ts`) refuses to hand
 * this out in production so registered clients are never an in-memory map that
 * silently forgets every registration on restart.
 */
import type { OAuthClientRepository } from "./client-repository";
import type { OAuthClientRecord } from "./types";

export class InMemoryOAuthClientRepository implements OAuthClientRepository {
  private readonly clients = new Map<string, OAuthClientRecord>(); // clientId -> record

  async createClient(record: OAuthClientRecord): Promise<void> {
    this.clients.set(record.clientId, record);
  }

  async findByClientId(clientId: string): Promise<OAuthClientRecord | null> {
    return this.clients.get(clientId) ?? null;
  }

  async deleteByClientId(clientId: string): Promise<void> {
    this.clients.delete(clientId);
  }
}
