import { Film, Terminal, Sparkles, ChevronDown } from "lucide-react";

export function ProjectsGuide({ compact = false }: { compact?: boolean }) {
  return (
    <div className={compact ? "h-full overflow-y-auto p-4 space-y-5" : "max-w-2xl mx-auto p-8 space-y-8"}>
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center shadow-lg shadow-violet-500/20 ring-1 ring-white/10">
          <Film className="w-6 h-6 text-white" />
        </div>
        <div>
          <h2 className={compact ? "text-lg font-bold tracking-tight" : "text-xl font-bold tracking-tight"}>Projects</h2>
          <p className="text-sm text-gray-500">Tell your AI agent what to make. It handles the rest.</p>
        </div>
      </div>

      {/* Core instruction */}
      <div className={compact ? "rounded-2xl border border-violet-600/20 bg-gradient-to-b from-violet-950/10 to-gray-900/20 p-4" : "rounded-2xl border border-violet-600/20 bg-gradient-to-b from-violet-950/10 to-gray-900/20 p-6"}>
        <div className="flex items-center gap-2 mb-4">
          <Terminal className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-semibold text-violet-200">How it works</span>
        </div>
        <p className="text-sm text-gray-300 leading-relaxed mb-4">
          You talk to your AI agent like you'd talk to a person. Tell it what you want — the agent plans the scenes, picks the shots, generates the images, animates them, and stitches everything together. You just review and say yes or no.
        </p>
        <p className="text-xs text-gray-500">That's it. No settings. No config. Just talk.</p>
      </div>

      {/* Example prompts — simple natural language */}
      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-400" />
          What to say to your agent
        </h3>

        {[
          {
            type: "Story video",
            say: "Make me a short cyberpunk teaser. Dark city, rain, neon lights. My character is walking through it, and at the end he gets a phone call that changes everything. About a minute long, cinematic style.",
          },
          {
            type: "Character image",
            say: "Create a 30-second montage of my character. Show different angles and expressions — serious, smiling, looking away. Studio lighting, clean background. I want to use these as profile pictures.",
          },
          {
            type: "Product demo",
            say: "I need a 45-second product walkthrough. Show my character using the app on their phone, then switching to a laptop, then reacting to the results on screen. Modern office setting, natural light.",
          },
          {
            type: "Social media reel",
            say: "Make me an Instagram reel — vertical format, quick cuts, high energy. My character doing everyday things in a cinematic way. Coffee, walking, looking at the skyline. 15 seconds.",
          },
          {
            type: "Anime short",
            say: "An anime-style short about a lone wanderer entering a haunted forest. Studio Ghibli vibes. About 45 seconds. Slow, atmospheric, beautiful.",
          },
          {
            type: "Kids' storybook",
            say: "A children's storybook style video. My character as the hero of a fairy tale — castle, forest, friendly dragon. Gentle narration vibe. One minute.",
          },
        ].map((ex, i) => (
          <div key={i} className="rounded-xl border border-gray-800/40 bg-gray-900/20 p-4 hover:border-gray-600 transition">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] uppercase tracking-wider text-gray-500 bg-gray-800/60 rounded-md px-2 py-0.5">{ex.type}</span>
            </div>
            <p className="text-sm text-gray-300 leading-relaxed italic">"{ex.say}"</p>
          </div>
        ))}
      </div>

      {/* Iterate */}
      <div className="rounded-2xl border border-gray-800/40 bg-gray-900/20 p-5">
        <h3 className="text-sm font-semibold text-gray-300 mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4 text-rose-400" />
          After you see it, change anything
        </h3>
        <div className="space-y-1.5 text-sm text-gray-400">
          <p>"I don't like shot 3 — try a wider angle"</p>
          <p>"Make scene 2 darker, more moody"</p>
          <p>"Swap my outfit to a hoodie in all shots"</p>
          <p>"Add a slow-motion moment at the end"</p>
          <p>"Cut the whole thing down to 30 seconds"</p>
        </div>
      </div>

      {/* API peek — collapsed */}
      <details className="rounded-2xl border border-gray-800/30 bg-gray-900/10 overflow-hidden">
        <summary className="px-4 py-2.5 cursor-pointer hover:bg-gray-800/20 transition flex items-center gap-2 list-none">
          <ChevronDown className="w-3 h-3 text-gray-600" />
          <span className="text-[11px] text-gray-600">API endpoints (for developers)</span>
        </summary>
        <div className="px-4 pb-4">
          <pre className="text-[10px] text-gray-600 font-mono leading-relaxed">
{`POST   /api/projects                          create a project
POST   /api/projects/:id/scenes                add a scene
POST   /api/projects/:id/scenes/:sid/shots     add a shot
POST   .../shots/:sid/generate-image           generate image
POST   .../shots/:sid/animate                  animate shot
GET    /api/projects/:id                       view full project
POST   /api/projects/:id/export                export MP4`}
          </pre>
        </div>
      </details>
    </div>
  );
}
