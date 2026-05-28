// Curated free OpenRouter models. Verified against
// https://openrouter.ai/api/v1/models (filtered to ids ending `:free`).
//
// Ordered by usefulness for short-text rewriting (polish, auto-tag, and
// action-item extraction workflows). General-purpose models first, then reasoning,
// then compact/edge, then code-focused, then multimodal/specialty.

export interface FreeModel {
  id: string;
  name: string;
  description: string;
}

export const FREE_MODELS: FreeModel[] = [
  // ── General-purpose (best defaults for rewriting) ────────────────────────
  {
    id: "openai/gpt-oss-20b:free",
    name: "OpenAI · gpt-oss 20B",
    description:
      "21B MoE, 131K context. Fast, low-latency. Good default for short rewrites.",
  },
  {
    id: "openai/gpt-oss-120b:free",
    name: "OpenAI · gpt-oss 120B",
    description:
      "117B MoE with configurable reasoning + tool use. Heavier; higher quality.",
  },
  {
    id: "google/gemma-4-31b-it:free",
    name: "Google · Gemma 4 31B",
    description:
      "30.7B dense multimodal, 262K context. Configurable thinking mode.",
  },
  {
    id: "google/gemma-4-26b-a4b-it:free",
    name: "Google · Gemma 4 26B A4B",
    description:
      "MoE with 3.8B active. Near-31B quality at a fraction of the compute.",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    name: "Meta · Llama 3.3 70B",
    description:
      "70B multilingual instruct. Strong general-purpose rewriting, 65K context.",
  },
  {
    id: "qwen/qwen3-next-80b-a3b-instruct:free",
    name: "Qwen · Qwen3 Next 80B A3B",
    description:
      "Instruction-tuned MoE, 262K context. Fast stable responses, no thinking traces.",
  },
  {
    id: "nvidia/nemotron-3-nano-30b-a3b:free",
    name: "NVIDIA · Nemotron 3 Nano 30B",
    description:
      "Small agentic MoE, 256K context. Compute-efficient; works well for text.",
  },
  {
    id: "nvidia/nemotron-nano-9b-v2:free",
    name: "NVIDIA · Nemotron Nano 9B v2",
    description:
      "9B unified reasoning + non-reasoning, 128K context. Tiny and quick.",
  },
  {
    id: "z-ai/glm-4.5-air:free",
    name: "Z.ai · GLM 4.5 Air",
    description:
      "Lightweight MoE with thinking + non-thinking modes. Agent-tuned.",
  },
  {
    id: "minimax/minimax-m2.5:free",
    name: "MiniMax · M2.5",
    description:
      "SOTA for productivity / office work. Strong on structured rewriting.",
  },
  {
    id: "deepseek/deepseek-v4-flash:free",
    name: "DeepSeek · V4 Flash",
    description:
      "284B MoE, 13B active, 1M context. Fast inference for long inputs.",
  },

  // ── Reasoning-focused (slower, deliberate) ──────────────────────────────
  {
    id: "nvidia/nemotron-3-super-120b-a12b:free",
    name: "NVIDIA · Nemotron 3 Super",
    description:
      "120B hybrid MoE, 12B active, 262K context. Multi-agent applications.",
  },
  {
    id: "inclusionai/ring-2.6-1t:free",
    name: "inclusionAI · Ring 2.6 1T",
    description:
      "1T parameters, 63B active. Thinking model tuned for agent workflows.",
  },
  {
    id: "arcee-ai/trinity-large-thinking:free",
    name: "Arcee · Trinity Large Thinking",
    description:
      "Open-source reasoning model. Strong on agentic + reasoning benchmarks.",
  },
  {
    id: "nousresearch/hermes-3-llama-3.1-405b:free",
    name: "Nous · Hermes 3 405B",
    description:
      "405B generalist. Strong roleplay, reasoning, long-context coherence.",
  },

  // ── Compact / edge ──────────────────────────────────────────────────────
  {
    id: "meta-llama/llama-3.2-3b-instruct:free",
    name: "Meta · Llama 3.2 3B",
    description:
      "3B multilingual. Dialogue + summarisation; fastest of the bunch.",
  },
  {
    id: "liquid/lfm-2.5-1.2b-instruct:free",
    name: "LiquidAI · LFM2.5 1.2B Instruct",
    description:
      "1.2B edge model. Strong chat quality at a tiny footprint.",
  },
  {
    id: "liquid/lfm-2.5-1.2b-thinking:free",
    name: "LiquidAI · LFM2.5 1.2B Thinking",
    description:
      "1.2B reasoning model for RAG and data extraction.",
  },

  // ── Code-focused (still useful for technical notes) ─────────────────────
  {
    id: "qwen/qwen3-coder:free",
    name: "Qwen · Qwen3 Coder 480B A35B",
    description:
      "480B MoE built for agentic coding. Great for code-heavy dictation.",
  },
  {
    id: "baidu/cobuddy:free",
    name: "Baidu · CoBuddy",
    description:
      "Code generation, 131K context, native tool support.",
  },
  {
    id: "poolside/laguna-m.1:free",
    name: "Poolside · Laguna M.1",
    description:
      "Flagship coding agent for complex software engineering tasks.",
  },
  {
    id: "poolside/laguna-xs.2:free",
    name: "Poolside · Laguna XS.2",
    description:
      "Second-gen efficient coding agent. 128K context.",
  },

  // ── Multimodal (rarely the right pick for dictation polish) ─────────────
  {
    id: "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    name: "NVIDIA · Nemotron 3 Nano Omni",
    description:
      "30B multimodal — text, image, video, audio. Niche for text-only work.",
  },
  {
    id: "nvidia/nemotron-nano-12b-v2-vl:free",
    name: "NVIDIA · Nemotron Nano 12B 2 VL",
    description:
      "12B multimodal for video + document intelligence.",
  },

  // ── Uncensored ──────────────────────────────────────────────────────────
  {
    id: "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
    name: "Venice · Dolphin Mistral 24B",
    description:
      "Uncensored Mistral fine-tune. Use when default model declines content.",
  },
];
