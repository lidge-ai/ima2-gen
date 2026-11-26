/** Classic media lane selection. A null selection keeps the existing core lane. */
export interface MediaSelection {
  kind: "image" | "video";
  model: string;
  adapter: string;
  task: string;
  durationSec?: number;
  resolution?: string;
  aspectRatio?: string;
  audio?: boolean;
  negativePrompt?: string;
  seed?: number;
}

export interface MediaSelectionState {
  mediaSelection: MediaSelection | null;
  setMediaSelection: (selection: MediaSelection | null) => void;
}
