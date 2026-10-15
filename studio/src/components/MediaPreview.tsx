import { AudioLines } from "lucide-react";
import { usePlayWhileVisible } from "../lib/playWhileVisible";

interface MediaPreviewProps {
  type?: string;
  url: string;
  /** Poster for a video, smaller source for an image. Falls back to `url`. */
  thumb?: string;
  alt?: string;
  className?: string;
  /** Audio only: the line it says, and how it was directed. */
  text?: string | null;
  detail?: string | null;
}

/**
 * The picture itself, wherever media is shown: a poster-backed video or an image.
 * Audio has no picture, so its card shows its words: the line, then how it was
 * directed. It plays in the lightbox.
 *
 * A video plays while it is on screen and pauses when it scrolls away — see
 * `usePlayWhileVisible`. It never preloads, so a page of them fetches only what
 * the viewer actually reaches.
 */
export function MediaPreview({ type, url, thumb, alt, className = "", text, detail }: MediaPreviewProps) {
  const isVideo = type === "video";
  const videoRef = usePlayWhileVisible(isVideo);

  if (type === "audio") {
    // Two fixed halves: the waveform mark at the foot of the top one, the line and its
    // direction from the top of the bottom one, clamped.
    return (
      <div className={`relative flex flex-col overflow-hidden bg-gray-900 px-6 text-center ${className}`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_40%,rgba(255,255,255,0.07),transparent_65%)]" />
        <div className="relative flex flex-1 basis-0 items-end justify-center pb-5">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
            <AudioLines className="h-7 w-7 text-gray-300" />
          </div>
        </div>
        <div className="relative flex flex-1 basis-0 flex-col items-center gap-3 overflow-hidden pb-6">
          {(text || alt) && (
            <p className="line-clamp-4 max-w-[30ch] text-[15px] font-medium leading-snug text-gray-100 [overflow-wrap:anywhere]">
              {text ? `\u201c${text}\u201d` : alt}
            </p>
          )}
          {detail && (
            <p className="line-clamp-2 max-w-[34ch] text-xs leading-relaxed text-gray-500">{detail}</p>
          )}
        </div>
      </div>
    );
  }

  if (isVideo) {
    return (
      <video
        ref={videoRef}
        src={url}
        poster={thumb}
        className={className}
        preload="none"
        muted
        loop
        playsInline
      />
    );
  }
  return <img src={thumb || url} alt={alt || ""} className={className} loading="lazy" />;
}
