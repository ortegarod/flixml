import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";

// How soon a stream the browser gave up on is opened again.
const RECONNECT_MS = 3000;

const TOPICS = ["jobs", "media", "nodes", "projects", "training"] as const;
export type ServerTopic = (typeof TOPICS)[number];

// One stream per tab, fanned out here to every component that listens.
const bus = new EventTarget();

/**
 * Refetch only when the server says something changed.
 *
 * `GET /api/events` is a Server-Sent Events stream that names a topic each time its data
 * changes. The React Query reads of jobs and the gallery are invalidated here; other
 * components listen with `useServerEvent`. Nothing runs on a timer.
 *
 * `open` fires on the first connect and after every reconnect, and is passed on as every
 * topic, so the tab catches up on whatever changed while it had no stream. The browser
 * reconnects on its own after a dropped stream, but not after an error response — which
 * is what a dev proxy returns while the API restarts — so a stream it has closed is
 * opened again here.
 */
export function useServerEvents(queryClient: QueryClient) {
  useEffect(() => {
    let source: EventSource | null = null;
    let retry: number | undefined;

    const onJobs = () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["job"] });
    };
    const onMedia = () => {
      queryClient.invalidateQueries({ queryKey: ["listing"] });
      queryClient.invalidateQueries({ queryKey: ["listing-counts"] });
    };
    bus.addEventListener("jobs", onJobs);
    bus.addEventListener("media", onMedia);

    const connect = () => {
      source = new EventSource("/api/events");
      for (const topic of TOPICS) {
        source.addEventListener(topic, () => bus.dispatchEvent(new Event(topic)));
      }
      source.addEventListener("open", () => {
        for (const topic of TOPICS) bus.dispatchEvent(new Event(topic));
      });
      source.addEventListener("error", () => {
        if (source?.readyState !== EventSource.CLOSED) return;
        source.close();
        retry = window.setTimeout(connect, RECONNECT_MS);
      });
    };
    connect();

    return () => {
      window.clearTimeout(retry);
      source?.close();
      bus.removeEventListener("jobs", onJobs);
      bus.removeEventListener("media", onMedia);
    };
  }, [queryClient]);
}

/** Call `listener` each time the server says `topic` changed; returns the unsubscribe. */
export function onServerEvent(topic: ServerTopic, listener: () => void): () => void {
  bus.addEventListener(topic, listener);
  return () => bus.removeEventListener(topic, listener);
}

/** `onServerEvent` for a component's lifetime. Needs useServerEvents mounted. */
export function useServerEvent(topic: ServerTopic, handler: () => void) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => onServerEvent(topic, () => ref.current()), [topic]);
}
