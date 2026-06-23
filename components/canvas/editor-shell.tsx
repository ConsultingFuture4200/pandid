"use client";

/**
 * Editor shell — the client orchestrator that binds the live canvas to the
 * account's real ACTIVE diagram (this task).
 *
 * Responsibilities (all reading/writing canonical state through server actions —
 * the browser is a client of Postgres, never a second source of truth):
 *   - hold the committed {@link PlacementModel} loaded from the server and the
 *     canvas's in-progress edits,
 *   - SAVE manual edits through the single commit pipeline (`commitDiagramEdit`),
 *     surfacing validation failures (what failed + how to fix),
 *   - POLL pending proposals (no WebSocket on Vercel serverless) and render them
 *     "visually distinct" via the proposal overlay with Accept/Reject,
 *   - after a save or an accept/reject, REFRESH the canvas from canonical state
 *     (re-load the latest committed model) so the rendered scene always derives
 *     from the server, not a local guess (architecture invariant).
 *
 * Excalidraw is mounted via `dynamic(..., { ssr:false })` (CLAUDE.md fact #2).
 */
import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";

import {
  commitDiagramEdit,
  loadActiveDiagram,
  type CommitEditResult,
} from "@/app/(canvas)/editor-actions";
import {
  acceptProposalAction,
  rejectProposalAction,
  listPendingProposals,
} from "@/app/(canvas)/proposal-actions";
import { PendingProposalPanel } from "@/components/proposal-review/pending-proposal-panel";
import { getSymbol } from "@/lib/symbols";
import { AttributePanel } from "./attribute-panel";
import {
  edgeAttributeFields,
  findEdge,
  findNode,
  nodeAttributeFields,
  setEdgeAttribute,
  setNodeAttribute,
} from "./attribute-fields";
import type { PlacementModel } from "./placement-model";
import type { SheetMetadata } from "@/lib/sheet/types";
import { SheetPanel } from "./sheet-panel";
import { buildDiagramExport } from "./diagram-export";
import {
  lineListToCsv,
  lineListToJson,
  toExcalidrawFile,
} from "@/lib/export/serializers";
import { usePendingProposals } from "./use-pending-proposals";

const PidCanvas = dynamic(
  () => import("./pid-canvas").then((m) => m.PidCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center text-sm text-gray-500">
        Loading canvas…
      </div>
    ),
  },
);

interface EditorShellProps {
  readonly diagramId: string;
  readonly diagramName: string;
  /** The committed model loaded by the server on first render. */
  readonly initialModel: PlacementModel;
}

/** Trigger a browser download of text content (DEV-1156 / DEV-1157 exports). */
function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Filesystem-safe slug for the diagram name used in export filenames. */
function exportSlug(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "diagram"
  );
}

export function EditorShell({
  diagramId,
  diagramName,
  initialModel,
}: EditorShellProps) {
  // `committedModel` is what the canvas is initialized/refreshed from (canonical);
  // `pendingModel` is the canvas's current in-progress edit awaiting save. It is
  // held both in a ref (for stale-closure-free reads on Save) and in state (so
  // the attribute panel re-renders with the latest attributes as they are typed).
  const [committedModel, setCommittedModel] =
    useState<PlacementModel>(initialModel);
  const pendingModelRef = useRef<PlacementModel>(initialModel);
  const [pendingModel, setPendingModelState] =
    useState<PlacementModel>(initialModel);
  // The selected element id may be a node OR a connection edge; the panel below
  // resolves which and shows the matching attribute editor.
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<CommitEditResult | null>(null);

  // Set the in-progress model in both the ref (Save reads it) and state (panel
  // re-renders from it) so the two never drift.
  const setPendingModel = useCallback((model: PlacementModel) => {
    pendingModelRef.current = model;
    setPendingModelState(model);
  }, []);

  const { proposals, refresh: refreshProposals } =
    usePendingProposals(listPendingProposals);

  // Re-load the latest committed model from canonical state and re-seed the
  // canvas + the pending edit from it. Called after a save or a decision.
  const refreshFromCanonical = useCallback(async () => {
    const result = await loadActiveDiagram();
    if (result.status === "ok") {
      setCommittedModel(result.diagram.model);
      setPendingModel(result.diagram.model);
      setSelectedNodeId(null);
      setDirty(false);
    }
  }, [setPendingModel]);

  const handleModelChange = useCallback(
    (model: PlacementModel) => {
      setPendingModel(model);
      setDirty(true);
    },
    [setPendingModel],
  );

  // The canvas reports which node (if any) is currently selected; the shell shows
  // the attribute editor for it.
  const handleSelectionChange = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  }, []);

  // Edit one attribute of the selected node OR edge in the in-progress model and
  // mark it dirty, so the existing Save (single commit pipeline + validator)
  // includes it. This only touches the pending edit — the human is still the sole
  // committer. Routes by whether the selected id is a node or an edge.
  const handleAttributeChange = useCallback(
    (key: string, value: string) => {
      if (selectedNodeId === null) {
        return;
      }
      const current = pendingModelRef.current;
      const next =
        findNode(current, selectedNodeId) !== null
          ? setNodeAttribute(current, selectedNodeId, key, value)
          : setEdgeAttribute(current, selectedNodeId, key, value);
      setPendingModel(next);
      setDirty(true);
    },
    [selectedNodeId, setPendingModel],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setSaveResult(null);
    try {
      const result = await commitDiagramEdit(pendingModelRef.current);
      setSaveResult(result);
      if (result.status === "ok") {
        await refreshFromCanonical();
      }
    } finally {
      setSaving(false);
    }
  }, [refreshFromCanonical]);

  // After a proposal decision the canonical state changed (accept) or the pending
  // list changed (reject); refresh both the canvas and the poll immediately.
  const afterDecision = useCallback(async () => {
    await Promise.all([refreshFromCanonical(), refreshProposals()]);
  }, [refreshFromCanonical, refreshProposals]);

  // Export the current (in-progress) diagram. Line list + SVG derive from the same
  // canonical projection as the read tools (DEV-1156/1157); the .excalidraw export
  // needs the Excalidraw runtime, dynamically imported on click to avoid SSR.
  const handleExportLineList = useCallback(
    (format: "csv" | "json") => {
      const { lineRows } = buildDiagramExport(pendingModelRef.current);
      const base = exportSlug(diagramName);
      if (format === "csv") {
        downloadText(
          `${base}-line-list.csv`,
          lineListToCsv(lineRows),
          "text/csv;charset=utf-8",
        );
      } else {
        downloadText(
          `${base}-line-list.json`,
          lineListToJson(lineRows),
          "application/json",
        );
      }
    },
    [diagramName],
  );

  const handleExportSvg = useCallback(() => {
    const { svg } = buildDiagramExport(pendingModelRef.current);
    downloadText(`${exportSlug(diagramName)}.svg`, svg, "image/svg+xml");
  }, [diagramName]);

  const handleExportSheet = useCallback(() => {
    const { sheetSvg } = buildDiagramExport(pendingModelRef.current);
    downloadText(`${exportSlug(diagramName)}-sheet.svg`, sheetSvg, "image/svg+xml");
  }, [diagramName]);

  // Edit the drawing-sheet metadata (DEV-1201): fold it into the pending model so
  // Save persists it with the version.
  const handleSheetChange = useCallback(
    (sheet: SheetMetadata) => {
      setPendingModel({ ...pendingModelRef.current, sheet });
      setDirty(true);
    },
    [setPendingModel],
  );

  const handleExportExcalidraw = useCallback(async () => {
    const [{ convertToExcalidrawElements }, { modelToSceneSkeletons }] =
      await Promise.all([
        import("@excalidraw/excalidraw"),
        import("./model-to-scene"),
      ]);
    const { skeletons } = modelToSceneSkeletons(pendingModelRef.current);
    const elements = convertToExcalidrawElements([...skeletons], {
      regenerateIds: false,
    });
    downloadText(
      `${exportSlug(diagramName)}.excalidraw`,
      toExcalidrawFile(elements),
      "application/json",
    );
  }, [diagramName]);

  // Resolve the selection against the in-progress model as a node OR an edge, so
  // the attribute panel always edits the latest pending attributes (and hides on
  // empty space). A node takes precedence (ids are distinct, but be explicit).
  const selectedNode = findNode(pendingModel, selectedNodeId);
  const selectedEdge =
    selectedNode === null ? findEdge(pendingModel, selectedNodeId) : null;
  const attributePanel =
    selectedNode !== null
      ? {
          key: selectedNode.elementId,
          label: getSymbol(selectedNode.symbolId).label,
          fields: nodeAttributeFields(selectedNode),
        }
      : selectedEdge !== null
        ? {
            key: selectedEdge.elementId,
            label: getSymbol(selectedEdge.symbolId).label,
            fields: edgeAttributeFields(selectedEdge),
          }
        : null;

  return (
    <div className="flex h-screen w-screen flex-col">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="truncate text-sm font-semibold" data-testid="editor-diagram-name">
          {diagramName}
        </h1>
        <div className="flex items-center gap-3">
          {dirty ? (
            <span className="text-xs text-amber-600">Unsaved changes</span>
          ) : null}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !dirty}
            data-testid="editor-save"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>

      {saveResult !== null && saveResult.status === "error" ? (
        <div
          role="alert"
          data-testid="editor-save-error"
          className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
        >
          <p>{saveResult.message}</p>
          {saveResult.validationErrors !== undefined &&
          saveResult.validationErrors.length > 0 ? (
            <ul className="mt-1 list-inside list-disc">
              {saveResult.validationErrors.map((message, i) => (
                <li key={i}>{message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {saveResult !== null && saveResult.status === "ok" ? (
        <div
          data-testid="editor-save-ok"
          className="border-b border-green-200 bg-green-50 px-4 py-2 text-sm text-green-700"
        >
          Saved a new version.
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1" data-diagram-id={diagramId}>
          <PidCanvas
            initialModel={committedModel}
            onModelChange={handleModelChange}
            onSelectionChange={handleSelectionChange}
          />
        </div>
        <aside className="flex w-80 shrink-0 flex-col overflow-y-auto border-l">
          {attributePanel !== null ? (
            <AttributePanel
              key={attributePanel.key}
              label={attributePanel.label}
              fields={attributePanel.fields}
              onAttributeChange={handleAttributeChange}
            />
          ) : null}
          <DecisionRefreshPanel
            proposals={proposals}
            onDecided={afterDecision}
          />
          <section
            aria-label="Export"
            className="flex flex-col gap-2 border-t p-3"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Export
            </h2>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <button
                type="button"
                data-testid="export-line-csv"
                onClick={() => handleExportLineList("csv")}
                className="rounded border border-gray-300 px-2 py-1.5 hover:bg-gray-100"
              >
                Line list (CSV)
              </button>
              <button
                type="button"
                data-testid="export-line-json"
                onClick={() => handleExportLineList("json")}
                className="rounded border border-gray-300 px-2 py-1.5 hover:bg-gray-100"
              >
                Line list (JSON)
              </button>
              <button
                type="button"
                data-testid="export-svg"
                onClick={handleExportSvg}
                className="rounded border border-gray-300 px-2 py-1.5 hover:bg-gray-100"
              >
                Diagram (SVG)
              </button>
              <button
                type="button"
                data-testid="export-excalidraw"
                onClick={() => void handleExportExcalidraw()}
                className="rounded border border-gray-300 px-2 py-1.5 hover:bg-gray-100"
              >
                .excalidraw
              </button>
              <button
                type="button"
                data-testid="export-sheet"
                onClick={handleExportSheet}
                className="col-span-2 rounded border border-gray-300 px-2 py-1.5 hover:bg-gray-100"
              >
                Drawing sheet (SVG)
              </button>
            </div>
          </section>
          <SheetPanel sheet={pendingModel.sheet} onChange={handleSheetChange} />
        </aside>
      </div>
    </div>
  );
}

/**
 * Wraps the pure {@link PendingProposalPanel} so that after a server-action
 * decision settles, the shell re-pulls canonical state. The panel's actions are
 * the canonical `acceptProposalAction` / `rejectProposalAction`; we layer a
 * post-decision refresh on top without changing their re-validate→commit path.
 */
function DecisionRefreshPanel({
  proposals,
  onDecided,
}: {
  readonly proposals: readonly {
    readonly proposalId: string;
    readonly createdAt: string;
    readonly diff: import("@/components/proposal-review/proposal-diff").ProposalDiff;
  }[];
  readonly onDecided: () => Promise<void>;
}) {
  // Wrap each action so a successful decision triggers a canonical refresh. The
  // wrapped action preserves the action signature the panel expects.
  const wrap = useCallback(
    (
      action: typeof acceptProposalAction | typeof rejectProposalAction,
    ) =>
      async (
        prev: Awaited<ReturnType<typeof action>>,
        formData: FormData,
      ): Promise<Awaited<ReturnType<typeof action>>> => {
        const result = await action(prev, formData);
        if (result.accepted === true || result.rejected === true) {
          await onDecided();
        }
        return result;
      },
    [onDecided],
  );

  return (
    <PendingProposalPanel
      proposals={proposals}
      acceptAction={wrap(acceptProposalAction)}
      rejectAction={wrap(rejectProposalAction)}
    />
  );
}
