/**
 * In-memory ProposalRepository (DEV-1144).
 *
 * Test double for the proposal lifecycle service and a stand-in for local
 * development before Postgres is reachable. NOT the production store —
 * `getProposalRepository` (see `index.ts`) refuses to hand this out in
 * production so staged proposals are never an in-process map.
 *
 * Account scope is modeled by a `diagramId -> accountId` ownership map the
 * service seeds via {@link InMemoryProposalRepository.registerDiagram}; the
 * Postgres repository enforces the same scope with a join to `diagram`. Rows are
 * deep-cloned on write and read so a returned proposal can't reach back into the
 * store.
 */
import type { Proposal } from "@/lib/types";
import type { ProposalRepository } from "./repository";
import type { CreateProposalInput } from "./types";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryProposalRepository implements ProposalRepository {
  private readonly proposals = new Map<string, Proposal>();
  private readonly seqByDiagram = new Map<string, number>(); // diagramId -> insert counter
  private readonly insertSeq = new Map<string, number>(); // proposalId -> order
  private readonly owners = new Map<string, string>(); // diagramId -> accountId
  private seq = 0;

  /**
   * Declare which account owns a diagram so reads can be account-scoped, the
   * way the Postgres repository's diagram join is. The lifecycle service calls
   * this when it has confirmed ownership; tests call it directly.
   */
  registerDiagram(diagramId: string, accountId: string): void {
    this.owners.set(diagramId, accountId);
  }

  private owns(accountId: string, diagramId: string): boolean {
    return this.owners.get(diagramId) === accountId;
  }

  async create(input: CreateProposalInput): Promise<Proposal> {
    const proposal: Proposal = {
      id: crypto.randomUUID(),
      diagramId: input.diagramId,
      stagedChange: clone(input.stagedChange),
      validatorReport: clone(input.validatorReport),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    this.proposals.set(proposal.id, proposal);
    this.insertSeq.set(proposal.id, this.seq++);
    this.seqByDiagram.set(input.diagramId, (this.seqByDiagram.get(input.diagramId) ?? 0) + 1);
    return clone(proposal);
  }

  async get(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
  }): Promise<Proposal | null> {
    const proposal = this.proposals.get(input.proposalId);
    if (
      proposal === undefined ||
      proposal.diagramId !== input.diagramId ||
      !this.owns(input.accountId, input.diagramId)
    ) {
      return null;
    }
    return clone(proposal);
  }

  async markDecided(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
    status: "accepted" | "rejected";
  }): Promise<Proposal | null> {
    const proposal = this.proposals.get(input.proposalId);
    if (
      proposal === undefined ||
      proposal.diagramId !== input.diagramId ||
      !this.owns(input.accountId, input.diagramId) ||
      proposal.status !== "pending"
    ) {
      // Absent, not owned, or already decided — the guard keeps it terminal.
      return null;
    }
    const updated: Proposal = { ...proposal, status: input.status };
    this.proposals.set(updated.id, updated);
    return clone(updated);
  }

  async revertToPending(input: {
    accountId: string;
    diagramId: string;
    proposalId: string;
  }): Promise<Proposal | null> {
    const proposal = this.proposals.get(input.proposalId);
    if (
      proposal === undefined ||
      proposal.diagramId !== input.diagramId ||
      !this.owns(input.accountId, input.diagramId) ||
      proposal.status !== "accepted"
    ) {
      // Absent, not owned, or not in the claimed `accepted` state.
      return null;
    }
    const updated: Proposal = { ...proposal, status: "pending" };
    this.proposals.set(updated.id, updated);
    return clone(updated);
  }

  async listPending(input: {
    accountId: string;
    diagramId: string;
  }): Promise<Proposal[]> {
    if (!this.owns(input.accountId, input.diagramId)) {
      return [];
    }
    return [...this.proposals.values()]
      .filter((p) => p.diagramId === input.diagramId && p.status === "pending")
      .sort((a, b) => (this.insertSeq.get(b.id) ?? 0) - (this.insertSeq.get(a.id) ?? 0))
      .map(clone);
  }
}
