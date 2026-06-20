/**
 * In-progress-edit guard (DEV-1152, PRD §4).
 *
 * Whole-scene broadcast (DEV-1151) keeps every client in sync with the
 * server-authoritative scene, but has one painful failure mode: a broadcast that
 * lands while the human is mid-manipulation (dragging an element, typing a label)
 * would stomp their in-progress edit the instant it is applied. This guard sits
 * between the WebSocket layer and the canvas and enforces:
 *
 *   - idle  → incoming broadcasts apply immediately.
 *   - busy  → incoming broadcasts are BUFFERED (deferred), never applied; the
 *             human's in-progress edit is preserved.
 *   - release → the newest deferred broadcast reconciles (server is the single
 *               source of truth, so the authoritative scene wins on release).
 *
 * The guard is a pure, framework-agnostic state machine over `SyncScene`. It does
 * no I/O and holds no browser state, so it is unit-testable and golden-renderable
 * without an Excalidraw mount. The canvas binding (DEV-1153 and the editor route)
 * wires Excalidraw's pointer/edit lifecycle to `beginManipulation` /
 * `applyLocalEdit` / `endManipulation`, and the WS client to `receiveBroadcast`.
 *
 * Architecture invariants upheld: the guard NEVER mutates canonical server state
 * and NEVER commits — it only orders how authoritative broadcasts reach the local
 * canvas. The server remains the single source of truth; on release its latest
 * broadcast always wins over the discarded in-progress local view.
 */
import { syncSceneSchema, type SyncOutcome, type SyncScene } from "./types";

/**
 * Stateful guard for one client's view of one diagram. Construct with the scene
 * the client currently shows (its last-known authoritative scene).
 */
export class InProgressEditGuard {
  /** The scene the canvas currently shows (authoritative when idle). */
  private scene: SyncScene;
  /** True between beginManipulation() and endManipulation(). */
  private manipulating = false;
  /** Newest broadcast received while manipulating; applied on release. */
  private deferred: SyncScene | null = null;

  constructor(initial: SyncScene) {
    this.scene = syncSceneSchema.parse(initial);
  }

  /** The scene the canvas should currently display. */
  currentScene(): SyncScene {
    return this.scene;
  }

  /** Whether a manipulation is currently in progress. */
  isManipulating(): boolean {
    return this.manipulating;
  }

  /** Whether a broadcast is buffered awaiting reconciliation on release. */
  hasDeferred(): boolean {
    return this.deferred !== null;
  }

  /**
   * Mark the start of a local manipulation (drag begin / label-edit focus).
   * While manipulating, incoming broadcasts are deferred instead of applied.
   */
  beginManipulation(): void {
    if (this.manipulating) {
      throw new Error(
        "Cannot begin a manipulation: one is already in progress. End it before starting another.",
      );
    }
    this.manipulating = true;
  }

  /**
   * Record the human's in-progress local scene (the live drag/typing state).
   * This is what the canvas shows while busy; it is intentionally NOT promoted to
   * authoritative — it is replaced by the server's deferred broadcast on release.
   * Throws if called while idle, since an out-of-band local mutation that skipped
   * beginManipulation would bypass the guard.
   */
  applyLocalEdit(local: SyncScene): void {
    if (!this.manipulating) {
      throw new Error(
        "Cannot apply a local edit: no manipulation in progress. Call beginManipulation() first.",
      );
    }
    this.scene = syncSceneSchema.parse(local);
  }

  /**
   * Feed an incoming whole-scene broadcast from the WebSocket layer.
   *
   * - idle: applied immediately (unless stale).
   * - busy: deferred (unless stale relative to what is already deferred/shown).
   *
   * Staleness: a broadcast whose `rev` is not newer than the most recent state
   * the guard already holds (the deferred one if present, else the current scene)
   * is dropped as `superseded`. This makes out-of-order delivery safe — only the
   * newest authoritative revision is ever applied.
   */
  receiveBroadcast(incoming: SyncScene): SyncOutcome {
    const broadcast = syncSceneSchema.parse(incoming);
    const newestHeldRev = (this.deferred ?? this.scene).rev;

    if (broadcast.rev <= newestHeldRev) {
      return { kind: "superseded", scene: null };
    }

    if (this.manipulating) {
      this.deferred = broadcast;
      return { kind: "deferred", scene: null };
    }

    this.scene = broadcast;
    return { kind: "applied", scene: broadcast };
  }

  /**
   * Mark the end of a local manipulation (drag end / label-edit blur) and
   * reconcile. If a broadcast was deferred during the manipulation, it is applied
   * now (server is the single source of truth) and returned; otherwise the local
   * scene is kept and `scene` is null (nothing to reconcile).
   */
  endManipulation(): SyncOutcome {
    if (!this.manipulating) {
      throw new Error(
        "Cannot end a manipulation: none is in progress.",
      );
    }
    this.manipulating = false;

    const deferred = this.deferred;
    this.deferred = null;
    if (deferred === null) {
      return { kind: "applied", scene: null };
    }
    this.scene = deferred;
    return { kind: "applied", scene: deferred };
  }
}
