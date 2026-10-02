import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

export type DatasetItem = { name: string; caption: string; image: string };
type DatasetResponse = { dataset: string; count: number; runs: string[]; items: DatasetItem[] };

// A caption as a footnote: what the picture shows, minus the trigger word every caption starts with.
export function captionBody(text: string): string {
  return text.replace(/^[^,]+,\s*/, "");
}

export function useDataset(dataset: string | null | undefined) {
  const [data, setData] = useState<DatasetResponse | null>(null);
  useEffect(() => {
    if (!dataset) return;
    let cancelled = false;
    fetch(`/api/lora-training/datasets/${encodeURIComponent(dataset)}/items`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => { if (!cancelled) setData(body); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [dataset]);
  return data;
}

// A character's training dataset as the trainer holds it: one sideways strip of
// images, each with the caption it is trained on as a footnote. Read-only.
export function TrainingDatasetSection({ dataset }: { dataset: string }) {
  const data = useDataset(dataset);

  useEffect(() => {
    if (data && window.location.hash === "#training-dataset") {
      document.getElementById("training-dataset")?.scrollIntoView({ block: "start" });
    }
  }, [data]);

  if (!data || data.count === 0) return null;

  return (
    <section id="training-dataset" className="scroll-mt-4 space-y-2">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="text-sm font-medium text-white">
          Training dataset <span className="ml-1 tabular-nums text-gray-500">{data.count}</span>
        </h2>
        {data.runs.length > 0 && (
          <Link to={`/studio/lora-training?job=${encodeURIComponent(data.runs[0])}`} className="text-xs text-gray-400 hover:text-white">
            Training runs {data.runs.length} →
          </Link>
        )}
      </div>
      <ul className="flex gap-2 overflow-x-auto snap-x pb-2">
        {data.items.map((item) => (
          <li key={item.name} className="w-32 shrink-0 snap-start">
            <a href={`${item.image}&full=true`} target="_blank" rel="noreferrer" title={item.caption}>
              <img src={item.image} alt={item.caption} loading="lazy" className="aspect-[2/3] w-full rounded-md object-cover bg-gray-900" />
            </a>
            <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-500" title={item.caption}>{captionBody(item.caption)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
