"use client";

/**
 * Subscribe to a diagram's realtime channel (DEV-1192) and invoke `onChange`
 * when the server broadcasts a "changed" ping. Returns whether realtime is
 * active so the caller can slow its safety poll accordingly. A no-op (returns
 * false) when realtime isn't configured — the caller keeps polling.
 *
 * The handler is kept in a ref so re-subscribing isn't tied to the callback's
 * identity; the channel is torn down on unmount / diagram change.
 */
import { useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

import {
  DIAGRAM_CHANGED_EVENT,
  diagramTopic,
  isRealtimeConfigured,
  realtimeConfig,
} from "./config";

export function useDiagramChannel(
  diagramId: string,
  onChange: () => void,
): { readonly active: boolean } {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const config = realtimeConfig();
    if (config === null || diagramId.length === 0) {
      return;
    }
    const client = createClient(config.url, config.anonKey, {
      realtime: { params: { eventsPerSecond: 5 } },
    });
    const channel = client
      .channel(diagramTopic(diagramId))
      .on("broadcast", { event: DIAGRAM_CHANGED_EVENT }, () => {
        onChangeRef.current();
      })
      .subscribe();
    return () => {
      void client.removeChannel(channel);
    };
  }, [diagramId]);

  return { active: isRealtimeConfigured() };
}
