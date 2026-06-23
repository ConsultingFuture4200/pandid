"use client";

/**
 * Version-history panel (DEV-1159 / SC-6). Lists the diagram's immutable versions
 * newest-first and restores a prior one (re-saves it as a new current version via
 * `restoreVersionAction`). Re-fetches whenever `refreshSignal` changes (the shell
 * bumps it after a save / accept / restore); `onRestored` lets the shell reload
 * the canvas from the new current version.
 */
import { useEffect, useState } from "react";
import {
  listVersionsAction,
  restoreVersionAction,
  type VersionRow,
} from "@/app/(canvas)/versions-actions";

interface VersionsPanelProps {
  readonly refreshSignal: number;
  readonly onRestored: () => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

export function VersionsPanel({ refreshSignal, onRestored }: VersionsPanelProps) {
  const [versions, setVersions] = useState<readonly VersionRow[]>([]);
  const [restoringId, setRestoringId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listVersionsAction().then((r) => {
      if (!cancelled) setVersions(r.versions);
    });
    return () => {
      cancelled = true;
    };
  }, [refreshSignal]);

  const restore = async (id: string) => {
    setRestoringId(id);
    try {
      const result = await restoreVersionAction(id);
      if (result.status === "ok") {
        onRestored();
      }
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <section
      aria-label="Versions"
      data-testid="versions-panel"
      className="flex flex-col gap-2 border-t p-3"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
        Versions
      </h2>
      {versions.length === 0 ? (
        <p className="text-sm text-gray-500">
          No saved versions yet. Saving or accepting a proposal creates one.
        </p>
      ) : (
        <ul className="flex flex-col gap-1" data-testid="versions-list">
          {versions.map((v, i) => (
            <li
              key={v.id}
              data-testid="version-row"
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span className="truncate text-gray-700">
                {formatTime(v.createdAt)}
                {i === 0 ? (
                  <span className="ml-1 text-xs font-medium text-green-600">
                    current
                  </span>
                ) : null}
              </span>
              {i === 0 ? null : (
                <button
                  type="button"
                  data-testid="version-restore"
                  onClick={() => void restore(v.id)}
                  disabled={restoringId !== null}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-100 disabled:opacity-50"
                >
                  {restoringId === v.id ? "Restoring…" : "Restore"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
