export type LocalAsrModelId =
  | "base.en"
  | "small.en"
  | "medium.en"
  | "large-v3-turbo"
  | "distil-large-v3"
  | "parakeet-tdt-0.6b-v3-int8";

export interface LocalAsrModel {
  id: LocalAsrModelId;
  label: string;
  shortLabel: string;
  badge: string;
  backend: "Faster Whisper" | "Parakeet ONNX";
  languages: string;
  download: string;
  disk: string;
  speed: string;
  quality: string;
  memory: string;
  source: string;
  sourceUrl: string;
  recommendedFor: string;
  notes: string;
}

export const LOCAL_ASR_MODELS: LocalAsrModel[] = [
  {
    id: "base.en",
    label: "Whisper Base English",
    shortLabel: "Base",
    badge: "Default",
    backend: "Faster Whisper",
    languages: "English",
    download: "Automatic on first use",
    disk: "~150 MB",
    speed: "Very fast CPU",
    quality: "Good",
    memory: "Low",
    source: "Hugging Face via faster-whisper",
    sourceUrl: "https://github.com/SYSTRAN/faster-whisper",
    recommendedFor: "Daily dictation on laptops and older CPUs.",
    notes: "Best default for open-source installs because it is small, proven, and quick to warm.",
  },
  {
    id: "small.en",
    label: "Whisper Small English",
    shortLabel: "Small",
    badge: "Recommended",
    backend: "Faster Whisper",
    languages: "English",
    download: "Automatic on first use",
    disk: "~500 MB",
    speed: "Fast CPU",
    quality: "Better",
    memory: "Moderate",
    source: "Hugging Face via faster-whisper",
    sourceUrl: "https://github.com/SYSTRAN/faster-whisper",
    recommendedFor: "Most users who want a clear accuracy bump without a huge model.",
    notes: "Good public-release recommendation for people using dictation heavily.",
  },
  {
    id: "medium.en",
    label: "Whisper Medium English",
    shortLabel: "Medium",
    badge: "Accuracy",
    backend: "Faster Whisper",
    languages: "English",
    download: "Automatic on first use",
    disk: "~1.5 GB",
    speed: "Slower CPU",
    quality: "High",
    memory: "High",
    source: "Hugging Face via faster-whisper",
    sourceUrl: "https://github.com/SYSTRAN/faster-whisper",
    recommendedFor: "Long-form notes where accuracy matters more than latency.",
    notes: "A practical high-quality ceiling for CPU users who can tolerate slower runs.",
  },
  {
    id: "large-v3-turbo",
    label: "Whisper Large v3 Turbo",
    shortLabel: "Turbo",
    badge: "Best Whisper",
    backend: "Faster Whisper",
    languages: "Multilingual",
    download: "Automatic on first use",
    disk: "~1.6 GB",
    speed: "Heavy CPU",
    quality: "Very high",
    memory: "High",
    source: "Hugging Face via faster-whisper",
    sourceUrl: "https://github.com/SYSTRAN/faster-whisper",
    recommendedFor: "Highest-quality Whisper-style transcription on newer machines.",
    notes: "Good advanced option; users should expect a slower first run and higher RAM use.",
  },
  {
    id: "distil-large-v3",
    label: "Distil-Whisper Large v3",
    shortLabel: "Distil Large",
    badge: "Fast Large",
    backend: "Faster Whisper",
    languages: "English-focused",
    download: "Automatic on first use",
    disk: "~1.5 GB",
    speed: "GPU preferred",
    quality: "High",
    memory: "High",
    source: "Hugging Face via faster-whisper",
    sourceUrl: "https://github.com/SYSTRAN/faster-whisper",
    recommendedFor: "Users with a GPU who want large-model quality with better throughput.",
    notes: "Faster-whisper explicitly supports distil-large-v3; keep Base or Small as safer CPU defaults.",
  },
  {
    id: "parakeet-tdt-0.6b-v3-int8",
    label: "Parakeet TDT 0.6B v3 INT8",
    shortLabel: "Parakeet v3",
    badge: "Advanced",
    backend: "Parakeet ONNX",
    languages: "English / multilingual ASR",
    download: "Manual ONNX directory today",
    disk: "~670 MB",
    speed: "Fast local ONNX",
    quality: "High",
    memory: "Moderate",
    source: "ONNX Parakeet v3 files",
    sourceUrl: "https://huggingface.co/models?other=base_model%3Aquantized%3Anvidia%2Fparakeet-tdt-0.6b-v3",
    recommendedFor: "Advanced users who install the ONNX files into the expected local model directory.",
    notes: "Requires encoder-model.int8.onnx, decoder_joint-model.int8.onnx, and vocab.txt.",
  },
];

export const localAsrModelOptions = LOCAL_ASR_MODELS.map((model) => ({
  value: model.id,
  label: model.shortLabel,
}));
