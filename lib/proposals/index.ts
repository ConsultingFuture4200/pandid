/**
 * Public surface of the proposal lifecycle module (DEV-1144, PRD §5.2 / §8).
 *
 * Proposals are staged by MCP propose-tools and decided by the human in the
 * browser — never applied autonomously (CLAUDE.md). Consumers:
 *   - MCP propose tools (DEV-1150)     → ProposalService.stage
 *   - pending-proposal canvas UI (DEV-1153) → listPending / accept / reject
 *
 * `getProposalRepository` serves an in-memory repository in dev/test and the
 * Postgres-backed repository (over the shared pool) in production — and refuses
 * to serve the in-memory one in production, so staged proposals are never
 * silently an in-process map (CLAUDE.md: real data only; server is the single
 * source of truth).
 */
import { getPool } from "@/lib/db/pool";
import { getCommitPipeline } from "@/lib/diagram/commit";
import { getDiagramRepository } from "@/lib/diagram";
import { createConnectivityValidator } from "@/lib/validator";
import { InMemoryProposalRepository } from "./in-memory-repository";
import { PostgresProposalRepository } from "./postgres-repository";
import type { ProposalRepository } from "./repository";
import { ProposalService, type MaterializeEdit } from "./service";

export { ProposalService } from "./service";
export type { AcceptResult, MaterializeEdit } from "./service";
export {
  ProposalError,
  stageProposalInputSchema,
  stagedChangeSchema,
  createProposalInputSchema,
  diagramEditSchema,
} from "./types";
export type {
  CommitElementLike,
  CreateProposalInput,
  DiagramEdit,
  ProposalErrorCode,
  StageProposalInput,
  StagedChange,
} from "./types";
export type { ProposalRepository } from "./repository";
export { InMemoryProposalRepository } from "./in-memory-repository";
export { PostgresProposalRepository } from "./postgres-repository";

let cachedRepository: ProposalRepository | null = null;

/**
 * Resolve the process-wide proposal repository.
 *
 * Production uses the Postgres-backed repository over the shared pool. Dev/test
 * use a singleton in-memory repository; production refuses it so staged
 * proposals are never lost to an in-process map.
 */
export function getProposalRepository(): ProposalRepository {
  if (process.env.NODE_ENV === "production") {
    cachedRepository ??= new PostgresProposalRepository(getPool());
    return cachedRepository;
  }
  cachedRepository ??= new InMemoryProposalRepository();
  return cachedRepository;
}

/**
 * Convenience: a `ProposalService` wired over the resolved proposal repository,
 * the process-wide commit pipeline (the single committer), the v1 connectivity
 * validator (the staging gate), and the diagram repository (ownership scope).
 *
 * Pass a {@link MaterializeEdit} to enable the no-clobber accept path (re-apply a
 * proposal's stored delta against current committed state). It is injected from
 * `lib/mcp-tools` (the composition root: `getMcpProposeTools`) so this module
 * never imports the op-application logic. Omitting it keeps the legacy behavior
 * (accept commits the stored full edit).
 */
export function getProposalService(
  materializeEdit?: MaterializeEdit,
): ProposalService {
  return new ProposalService(
    getProposalRepository(),
    getCommitPipeline(),
    createConnectivityValidator(),
    getDiagramRepository(),
    materializeEdit,
  );
}
