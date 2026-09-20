import { usePlayWhileVisible } from "../lib/playWhileVisible";

interface MediaPreviewProps {
  type?: string;
  url: string;
  /** Poster for a video, smaller source for an image. Falls back to `url`. */
  thumb?: string;
  alt?: string;
  className?: string;
}

/**
 * The picture itself, wherever media is shown: a poster-backed video or an image.
 *
 * A video plays while it is on screen and pauses when it scrolls away — see
 * `usePlayWhileVisible`. It never preloads, so a page of them fetches only what
 * the viewer actually reaches.
 */
export function MediaPreview({ type, url, thumb, alt, className = "" }: MediaPreviewProps) {
  const isVideo = type === "video";
  const videoRef = usePlayWhileVisible(isVideo);

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
