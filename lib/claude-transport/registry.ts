/**
 * Transport registry (DEV-1143, PRD §9).
 *
 * The selection seam: callers ask for "the active Claude transport" and get a
 * `ClaudeTransport` WITHOUT knowing or caring which mechanism backs it. This is
 * what makes the §9 fallback additive — when the MCP connector path is killed
 * (Anthropic restricts custom connectors on the client's plan tier), an
 * operator flips the configured kind to `api-key-chat` and registers that
 * implementation; every caller keeps working unchanged because it only ever
 * touched this registry and the `ClaudeTransport` interface.
 *
 * The registry holds at most one transport per `TransportKind` and resolves the
 * single ACTIVE one (v1: `mcp`). It owns no transport logic itself — concrete
 * transports (DEV-1145 MCP, future Path B chat) register into it.
 */
import type { ClaudeTransport, TransportKind } from "./types";
import { TransportError } from "./types";

/**
 * A registry of available Claude transports with one designated active kind.
 * Construct with the active kind; `register` concrete transports; callers use
 * `getActiveTransport()`.
 */
export class TransportRegistry {
  private readonly transports = new Map<TransportKind, ClaudeTransport>();

  /**
   * @param activeKind which registered transport `getActiveTransport()` returns.
   *   v1 is `"mcp"` (Path C). Switching this to `"api-key-chat"` activates the
   *   §9 fallback — no caller change.
   */
  constructor(private activeKind: TransportKind) {}

  /**
   * Register (or replace) the transport for its `kind`. Idempotent per kind:
   * the most recently registered transport of a kind wins.
   */
  register(transport: ClaudeTransport): this {
    this.transports.set(transport.kind, transport);
    return this;
  }

  /** Which mechanism is currently active (diagnostics, onboarding copy). */
  get active(): TransportKind {
    return this.activeKind;
  }

  /**
   * Switch the active mechanism (the §9 kill-criterion lever). The target kind
   * must already be registered, so a fallback can't be activated before its
   * implementation is wired in.
   *
   * @throws {TransportError} `transport-unavailable` if `kind` is not registered.
   */
  activate(kind: TransportKind): this {
    if (!this.transports.has(kind)) {
      throw new TransportError(
        "transport-unavailable",
        `Cannot activate the "${kind}" Claude transport: no implementation is ` +
          "registered for it. Register the transport before activating it.",
      );
    }
    this.activeKind = kind;
    return this;
  }

  /**
   * Resolve the active transport every caller drives Claude through.
   *
   * @throws {TransportError} `transport-unavailable` if the active kind has no
   *   registered implementation.
   */
  getActiveTransport(): ClaudeTransport {
    const transport = this.transports.get(this.activeKind);
    if (transport === undefined) {
      throw new TransportError(
        "transport-unavailable",
        `The active Claude transport ("${this.activeKind}") is not available: ` +
          "no implementation is registered. Register it, or activate a " +
          "registered transport.",
      );
    }
    return transport;
  }

  /** True iff a transport of `kind` is registered (capability checks). */
  has(kind: TransportKind): boolean {
    return this.transports.has(kind);
  }
}
