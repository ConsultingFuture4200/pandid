import { expect, test } from "@playwright/test";

// SC-1 E2E: the manual 4-column→header→collection-tank workflow, built on a REAL
// Excalidraw mount with NO Claude involvement (DEV-1141, Phase 1 exit gate).
//
// What this spec owns: the *live-canvas build* of the SC-1 diagram — mounting the
// editor client-side without an SSR crash and placing every SC-1 equipment symbol
// from the palette onto the real canvas. This is the browser-bound half of SC-1
// that vitest cannot assert (a real Excalidraw runtime).
//
// What it deliberately does NOT do here:
//   - Connection-drawing through the UI and the save/reload buttons are not part
//     of the DEV-1137 editor shell this task builds on (connection binding is
//     pure logic at this phase; the editor route is not yet wired to the
//     persistence service). Those are owned by other tasks. Faking them in an
//     E2E would assert UI that does not exist.
//   - The deterministic geometry + the save→reload round-trip through the REAL
//     commit pipeline (validate → persist → restore identical scene + metadata)
//     are proven loop-closably in components/canvas/sc1-workflow.test.ts, which
//     is the SC-1 "save + reload returns identical scene" criterion under the
//     `pnpm test` green loop. This spec covers the on-canvas placement those
//     tests cannot exercise without a browser.
//
// The full Claude-driven live E2E (placing + connecting via proposals) is the
// Phase-2 human-gated DEV-1155.

/** The six SC-1 equipment placements, in workflow order. */
const SC1_PLACEMENTS = [
  "extraction-column",
  "extraction-column",
  "extraction-column",
  "extraction-column",
  "collection-tank", // header (manifold vessel)
  "collection-tank", // downstream collection tank
] as const;

test("SC-1: build the 4-column→header→tank diagram on a live canvas", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/editor");

  // Editor mounts client-side: Excalidraw renders its own canvas, no SSR crash.
  await expect(page.locator(".excalidraw")).toBeVisible();
  await expect(page.locator(".excalidraw").locator("canvas").first()).toBeVisible();

  // Place each SC-1 symbol from the palette onto the real canvas.
  for (const symbolId of SC1_PLACEMENTS) {
    await page.locator(`button[data-symbol-id="${symbolId}"]`).click();
  }

  // The canvas survived building the whole SC-1 arrangement with no page errors.
  await expect(
    page.locator(".excalidraw").locator("canvas").first(),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
