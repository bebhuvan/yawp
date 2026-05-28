import { useCallback, useMemo, useState } from "react";
import { api, userMessage } from "./api";
import { makeLogger } from "./log";
import type { Note, RecordingMode } from "./types";


const log = makeLogger("Yawp.capture");

export type FlowState = "idle" | "recording" | "transcribing";

export function useNativeCapture({
  sidecarUp,
  setSidecarUp,
  showToast,
}: {
  sidecarUp: boolean | null;
  setSidecarUp: (up: boolean) => void;
  showToast: (text: string) => void;
}) {
  const [nativeRecording, setNativeRecording] = useState(false);
  const [capturePending, setCapturePending] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const flow: FlowState = useMemo(
    () =>
      transcribing
        ? "transcribing"
        : nativeRecording || capturePending
          ? "recording"
          : "idle",
    [capturePending, nativeRecording, transcribing],
  );

  const start = useCallback(async () => {
    if (capturePending || nativeRecording || transcribing) return false;
    setCapturePending(true);
    if (sidecarUp === false) {
      try {
        await api.health();
        setSidecarUp(true);
      } catch {
        showToast(
          "Sidecar isn't responding. Start it: " +
            "sidecar/.venv/bin/python sidecar/run.py",
        );
        setCapturePending(false);
        return false;
      }
    }
    try {
      const status = await api.captureStart();
      setNativeRecording(status.recording);
      return status.recording;
    } catch (e) {
      showToast(userMessage(e, "Could not start recording."));
      return false;
    } finally {
      setCapturePending(false);
    }
  }, [capturePending, nativeRecording, setSidecarUp, showToast, sidecarUp, transcribing]);

  const stopAndSave = useCallback(async (mode: RecordingMode): Promise<Note | null> => {
    if (transcribing) return null;
    setTranscribing(true);
    setNativeRecording(false);
    log.info("stopping native capture and saving note");
    try {
      return await api.captureStopAndSave(mode);
    } catch (e) {
      log.error("transcribe failed", e);
      showToast(userMessage(e, "Transcription failed."));
      return null;
    } finally {
      setTranscribing(false);
    }
  }, [showToast, transcribing]);

  const cancel = useCallback(async () => {
    try {
      await api.captureCancel();
    } catch (e) {
      log.warn("capture cancel failed", e);
    } finally {
      setNativeRecording(false);
    }
  }, []);

  return {
    flow,
    capturePending,
    nativeRecording,
    transcribing,
    setNativeRecording,
    start,
    stopAndSave,
    cancel,
  };
}
