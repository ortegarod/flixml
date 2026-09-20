export interface CharacterSummary {
  id: string;
  name: string;
  trigger?: string | null;
}

export interface MediaItem {
  name: string;
  type: "image" | "video";
  width: number;
  height: number;
  mtime: number;
  url: string;
  filename?: string;
  thumb?: string;
  prompt?: string | null;
  negative_prompt?: string | null;
  prompt_id?: string | null;
  character_ids?: string[];
  tags?: string[];
  included_in_training_dataset?: boolean;
  metadata?: Record<string, any> | null;
  // When the producing job was submitted; for imports, when the file was added.
  submitted_at?: string | null;
  // When the producing job ran on its node; null for imports and jobs from before run times were recorded.
  started_at?: string | null;
  finished_at?: string | null;
  // Base model and LoRA files the producing job's ComfyUI graph loaded.
  models?: string[];
  loras?: string[];
  // What the node actually ran with, read back from the submitted graph. Params the
  // caller left at a default are missing from `metadata` but present here.
  settings?: GraphSettings | null;
}

// One sampling pass. Wan runs two over the same latent — high noise, then low — so a
// clip legitimately carries two sets of steps and CFG.
export interface SamplerPass {
  seed?: number;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  denoise?: number;
  shift?: number;
  start_step?: number;
  end_step?: number;
}

export interface GraphSettings {
  passes?: SamplerPass[];
  width?: number;
  height?: number;
  frames?: number;
  fps?: number;
  loras?: Array<{ name: string; strength?: number }>;
}

export interface LoraTrainingStatus {
  ok: boolean;
  status: string;
  running?: boolean;
  job_name?: string | null;
  current_step: number;
  total_steps: number;
  progress_percent?: number | null;
  loss?: number | null;
  lr?: number | null;
  elapsed?: string | null;
  eta?: string | null;
  seconds_per_step?: number | null;
  gpu_util?: number | null;
  vram_percent?: number | null;
  updated_at: string;
  error?: string | null;
  info?: string | null;
  speed_string?: string | null;
}

export interface LoraCheckpoint {
  name: string;
  filename?: string;
  step?: number | null;
  path: string;
  size_bytes: number;
  modified_at: string;
  created_at?: string;
}

export interface LoraCheckpointsResponse {
  ok: boolean;
  job_name: string;
  checkpoints: LoraCheckpoint[];
  count: number;
  updated_at: string;
}

export interface JobItem {
  prompt_id: string;
  status: "pending" | "running" | "completed" | "failed" | string;
  mode?: string;
  output_type?: string;
  job_type?: string;
  prompt?: string;
  created_at?: string;
  started_at?: string | null;
  finished_at?: string | null;
  models?: string[];
  loras?: string[];
  // Agent whose API key submitted the job.
  owner_id?: string | null;
  queue_position?: number | null;
  current_node?: string | null;
  step_value?: number;
  step_max?: number;
  nodes_finished?: number;
  nodes_running?: number;
  nodes_total?: number;
  progress_percent?: number | null;
  error?: string;
  // Job configuration (flattened from job metadata by the API) — what's being run.
  workflow?: string;
  provider?: string;
  seed?: number | null;
  width?: number;
  height?: number;
  length?: number | null;
  steps?: number | null;
  filename_prefix?: string;
  image?: string | null;
  video?: string | null;
  audio?: string | null;
}

export interface Project {
  id: string;
  title: string;
  description: string | null;
  aspect_ratio: string;
  duration_seconds: number | null;
  status: string;
  characters: string[];
  metadata: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface Scene {
  id: string;
  project_id: string;
  scene_number: number;
  title: string | null;
  setting: string;
  weather: string;
  summary: string | null;
  location: string | null;
  time_of_day: string | null;
  characters: string[];
  metadata: Record<string, unknown>;
}

export interface Shot {
  id: string;
  project_id: string;
  scene_id: string;
  shot_number: number;
  text: string | null;
  description: string | null;
  subtitle: string | null;
  voiceover: string | null;
  image_prompt: string | null;
  motion_prompt: string | null;
  characters: string[];
  duration_seconds: number;
  status: string;
  image_file: string | null;
  video_file: string | null;
  image_prompt_id: string | null;
  video_prompt_id: string | null;
  metadata: Record<string, unknown>;
}


export interface ShotVersion {
  id: string;
  project_id: string;
  scene_id: string;
  shot_id: string;
  version_number: number;
  kind: "image" | "video";
  status: string;
  prompt: string | null;
  file: string | null;
  prompt_id: string | null;
  metadata: Record<string, unknown>;
  created_at?: string;
}

export type ProjectPhase = "outline" | "generate" | "animate";

export interface ProjectModeData {
  project: Project;
  scenes: Scene[];
  shots: Shot[];
  selectedSceneId: string | null;
  selectedShotId: string | null;
  phase: ProjectPhase;
  onSelectScene: (sceneId: string) => void;
  onSelectShot: (shotId: string | null) => void;
  onBack: () => void;
  onRefresh: () => Promise<void> | void;
  onAddScene: () => Promise<void> | void;
  onDeleteScene: (sceneId: string) => Promise<void> | void;
  onDeleteShot: (shotId: string) => Promise<void> | void;
}
