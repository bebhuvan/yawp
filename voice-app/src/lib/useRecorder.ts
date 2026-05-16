import { useCallback, useEffect, useRef, useState } from "react";
import { makeLogger } from "./log";

const log = makeLogger("Yawp.recorder");

// Uses Web Audio API + manual WAV encoding instead of MediaRecorder.
//
// WebKitGTK ships without MediaRecorder support; Web Audio + getUserMedia +
// ScriptProcessor is supported everywhere a webview exists. We capture float32
// PCM at the device's native rate, encode 16-bit mono WAV in-browser for the
// final blob, AND stream each chunk over a WebSocket to the sidecar so the
// recording HUD can show partial transcripts as you speak.

const STREAM_URL = "ws://127.0.0.1:17893/stream";

type RecorderState = "idle" | "recording" | "stopping";

export interface UseRecorder {
  state: RecorderState;
  error: string | null;
  partial: string;
  level: number;
  start: () => Promise<void>;
  stop: () => Promise<Blob | null>;
  cancel: () => void;
}

export function useRecorder({
  liveTranscription = true,
}: {
  liveTranscription?: boolean;
} = {}): UseRecorder {
  const [state, setState] = useState<RecorderState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const cleanup = useCallback(() => {
    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        /* noop */
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }
    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect();
      } catch {
        /* noop */
      }
      sourceRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {
        /* noop */
      }
      wsRef.current = null;
    }
    chunksRef.current = [];
    setLevel(0);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setPartial("");
    if (state !== "idle") return;
    log.info("start: requesting microphone");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      const audioCtx = new (window.AudioContext ||
        // @ts-expect-error vendor-prefixed fallback
        window.webkitAudioContext)();
      log.info(
        "audio context",
        "sampleRate=" + audioCtx.sampleRate,
        "tracks=" + stream.getAudioTracks().length,
      );
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(4096, 1, 1);
      chunksRef.current = [];

      // Open the streaming WebSocket. If it fails, we still record fine — the
      // user just won't see live partials.
      let ws: WebSocket | null = null;
      if (liveTranscription) {
        try {
          ws = new WebSocket(STREAM_URL);
          ws.binaryType = "arraybuffer";
          ws.onopen = () => {
            log.debug("stream ws open");
            try {
              ws?.send(
                JSON.stringify({
                  type: "config",
                  sample_rate: audioCtx.sampleRate,
                }),
              );
            } catch (e) {
              log.warn("stream config send failed", e);
            }
          };
          ws.onmessage = (e) => {
            try {
              const data = JSON.parse(e.data);
              if (data.type === "partial" && typeof data.text === "string") {
                setPartial(data.text);
              } else if (data.type === "final" && typeof data.text === "string") {
                setPartial(data.text);
              } else if (data.type === "error") {
                log.warn("stream error message", data.detail);
              }
            } catch (err) {
              log.debug("ws message parse failed", err);
            }
          };
          ws.onerror = (e) => {
            log.warn("stream ws error (live partials disabled)", e);
          };
          ws.onclose = (e) => {
            log.debug("stream ws closed", "code=" + e.code);
          };
          wsRef.current = ws;
        } catch (e) {
          log.warn("could not open stream ws", e);
          wsRef.current = null;
        }
      } else {
        log.info("live transcription disabled");
      }

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        const copy = new Float32Array(data);
        chunksRef.current.push(copy);
        setLevel(rms(copy));
        const sock = wsRef.current;
        if (sock && sock.readyState === WebSocket.OPEN) {
          try {
            sock.send(copy.buffer);
          } catch {
            /* noop */
          }
        }
      };
      source.connect(processor);
      const muteGain = audioCtx.createGain();
      muteGain.gain.value = 0;
      processor.connect(muteGain);
      muteGain.connect(audioCtx.destination);

      streamRef.current = stream;
      audioCtxRef.current = audioCtx;
      sourceRef.current = source;
      processorRef.current = processor;
      setState("recording");
    } catch (e: unknown) {
      const err = e as { name?: string; message?: string };
      log.error("getUserMedia failed", err?.name, err?.message);
      setError(
        err?.name === "NotAllowedError"
          ? "Microphone permission denied"
          : (err?.message ?? "Could not start recording"),
      );
      cleanup();
      setState("idle");
    }
  }, [state, cleanup, liveTranscription]);

  const stop = useCallback(async (): Promise<Blob | null> => {
    if (state !== "recording" || !audioCtxRef.current) return null;
    setState("stopping");
    const sampleRate = audioCtxRef.current.sampleRate;
    const chunks = chunksRef.current;
    log.info(
      "stop: encoding wav",
      "chunks=" + chunks.length,
      "sampleRate=" + sampleRate,
    );

    // Tell server we're stopping (so it can do its final pass and close).
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      try {
        sock.send(JSON.stringify({ type: "stop" }));
      } catch {
        /* noop */
      }
    }

    cleanup();
    setState("idle");

    const totalLen = chunks.reduce((acc, c) => acc + c.length, 0);
    if (totalLen === 0) return null;
    const merged = new Float32Array(totalLen);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.length;
    }
    const wav = encodeWav(merged, sampleRate);
    return new Blob([wav], { type: "audio/wav" });
  }, [state, cleanup]);

  const cancel = useCallback(() => {
    setPartial("");
    setLevel(0);
    cleanup();
    setState("idle");
  }, [cleanup]);

  useEffect(() => () => cleanup(), [cleanup]);

  return { state, error, partial, level, start, stop, cancel };
}

function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  return Math.min(1, Math.sqrt(sum / samples.length) * 8);
}

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const byteLength = 44 + samples.length * 2;
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);

  writeAscii(view, 36, "data");
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
