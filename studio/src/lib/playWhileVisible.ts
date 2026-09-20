import { useEffect, useRef } from "react";

/**
 * Tile videos play while they are on screen and pause when they scroll away —
 * the browsing behaviour people know from Civitai, and the only one that works on
 * a phone, where there is no hover.
 *
 * Two things keep a long gallery cheap: the videos are `preload="none"`, so a clip's
 * bytes are requested when it first appears and never for tiles nobody scrolls to, and
 * a paused off-screen video decodes nothing. Every tile shares one IntersectionObserver
 * rather than creating its own.
 */

const VISIBLE_ENOUGH = 0.25;

type Registry = { observer: IntersectionObserver; onScreen: Set<HTMLVideoElement> };

let registry: Registry | null = null;

function play(video: HTMLVideoElement) {
  // play() rejects with AbortError when the element is paused before it resolves —
  // routine while scrolling fast, and not something the user needs to hear about.
  video.play().catch(() => {});
}

function getRegistry(): Registry {
  if (registry) return registry;

  const onScreen = new Set<HTMLVideoElement>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target as HTMLVideoElement;
        if (entry.isIntersecting) {
          onScreen.add(video);
          if (!document.hidden) play(video);
        } else {
          onScreen.delete(video);
          // Paused where it stands: scrolling back picks the clip up mid-loop
          // instead of snapping to the first frame.
          video.pause();
        }
      }
    },
    { threshold: VISIBLE_ENOUGH }
  );

  // A background tab keeps decoding otherwise. Resume only what is still on screen.
  document.addEventListener("visibilitychange", () => {
    for (const video of onScreen) {
      if (document.hidden) video.pause();
      else play(video);
    }
  });

  registry = { observer, onScreen };
  return registry;
}

/**
 * Attach to a `<video>` that should play while it is on screen. `enabled` is false for
 * images, so the same preview component can call the hook unconditionally.
 */
export function usePlayWhileVisible(enabled: boolean) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!enabled || !video || typeof IntersectionObserver === "undefined") return;

    const { observer, onScreen } = getRegistry();
    observer.observe(video);
    return () => {
      observer.unobserve(video);
      onScreen.delete(video);
    };
  }, [enabled]);

  return ref;
}
