"use client";

/**
 * In-app connector onboarding (DEV-1154, FR-22). Step-by-step for adding the
 * remote MCP server as a custom connector in Claude (Settings → Connectors),
 * with the account's own MCP URL and a hard warning AGAINST the
 * claude_desktop_config.json path — Desktop silently strips remote URLs there
 * (CLAUDE.md "What this is NOT"). Designed so a non-developer can complete it in
 * a few minutes without support (SC-5).
 */
import { useState } from "react";

const STEPS: ReadonlyArray<{ title: string; detail: string }> = [
  {
    title: "Open or create a diagram first",
    detail:
      "The connector is scoped to your ACTIVE diagram, so open one in the editor before connecting — that's the diagram Claude will see.",
  },
  {
    title: "In Claude, open Settings → Connectors",
    detail:
      "Claude Desktop or claude.ai → Settings → Connectors. (Not the config file — see the note below.)",
  },
  {
    title: 'Click "Add custom connector"',
    detail:
      'The button may read "Add connector" or "Add custom connector" depending on your build.',
  },
  {
    title: "Paste the MCP URL (below) and continue",
    detail:
      "It must be the HTTPS URL — Claude calls it from Anthropic's cloud, not your machine.",
  },
  {
    title: "Complete the sign-in (OAuth)",
    detail:
      "Approve and sign in with THIS account (the one that owns your active diagram). Registration is automatic.",
  },
  {
    title: 'Confirm it shows "Connected"',
    detail:
      'Then ask Claude "What\'s on my active diagram?" — it should read your equipment back. Now ask it to propose a change; the proposal appears here for you to Accept or Reject. Claude never commits — you do.',
  },
];

interface ConnectorOnboardingProps {
  /** The account's public MCP endpoint URL, resolved server-side from the request
   * host (so there's no client window read / hydration mismatch). */
  readonly mcpUrl: string;
}

export function ConnectorOnboarding({ mcpUrl }: ConnectorOnboardingProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the URL is shown for manual copy */
    }
  };

  return (
    <section
      aria-label="Connect Claude"
      data-testid="connector-onboarding"
      className="w-full max-w-2xl rounded-lg border border-gray-200 p-5 text-left"
    >
      <h2 className="text-lg font-semibold">Connect Claude (custom connector)</h2>
      <p className="mt-1 text-sm text-gray-600">
        Add this app as a connector so Claude can propose changes to your diagram —
        which you review and accept here.
      </p>

      <div className="mt-4 flex items-center gap-2">
        <code
          data-testid="connector-url"
          className="flex-1 truncate rounded bg-gray-100 px-3 py-2 font-mono text-sm"
        >
          {mcpUrl}
        </code>
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded bg-blue-600 px-3 py-2 text-sm font-medium text-white"
        >
          {copied ? "Copied" : "Copy URL"}
        </button>
      </div>

      <ol className="mt-4 flex flex-col gap-3">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
              {i + 1}
            </span>
            <div>
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-sm text-gray-600">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <div
        role="note"
        data-testid="connector-config-warning"
        className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800"
      >
        <strong>Don&apos;t</strong> add this URL in{" "}
        <code className="font-mono">claude_desktop_config.json</code> — Claude
        Desktop silently strips remote connector URLs from the config file. Use{" "}
        <strong>Settings → Connectors</strong> only.
      </div>
    </section>
  );
}
