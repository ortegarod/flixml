import { AudioLines } from "lucide-react";
import { usePlayWhileVisible } from "../lib/playWhileVisible";

interface MediaPreviewProps {
  type?: string;
  url: string;
  /** Poster for a video, smaller source for an image. Falls back to `url`. */
  thumb?: string;
  alt?: string;
  className?: string;
  /** Audio only: what it says (the line), and how it was directed. Audio has no
   *  picture, so the words are the face of its card. */
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
    // Composed like a poster: the waveform mark is the centrepiece, the line hangs under
    // it as the caption, the direction is a quiet footnote. Neutrals only — the card is
    // chrome, and the gallery's colour belongs to the media.
    return (
      <div className={`relative flex flex-col items-center justify-center gap-5 overflow-hidden bg-gray-900 px-6 py-8 text-center ${className}`}>
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_38%,rgba(255,255,255,0.07),transparent_65%)]" />
        <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-white/5 ring-1 ring-white/10">
          <AudioLines className="h-7 w-7 text-gray-300" />
        </div>
        {(text || alt) && (
          <p className="relative line-clamp-4 max-w-[30ch] text-[15px] font-medium leading-snug text-gray-100 [overflow-wrap:anywhere]">
            {text ? `“${text}”` : alt}
          </p>
        )}
        {detail && (
          <p className="relative line-clamp-2 max-w-[34ch] text-xs leading-relaxed text-gray-500">{detail}</p>
        )}
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
