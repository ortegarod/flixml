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
    return (
      <div className={`flex flex-col gap-3 overflow-hidden bg-gray-900 p-5 ${className}`}>
        <AudioLines className="h-5 w-5 shrink-0 text-gray-500" />
        <p className="line-clamp-[9] text-lg leading-snug text-gray-100 [overflow-wrap:anywhere]">{text || alt}</p>
        {detail && <p className="line-clamp-5 text-sm italic leading-snug text-gray-500">{detail}</p>}
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
