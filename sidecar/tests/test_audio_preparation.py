from pathlib import Path

import numpy as np
import pytest
import soundfile as sf


def test_prepare_audio_trims_and_normalizes(tmp_path):
    from app.transcription_service import _prepare_audio_for_asr

    sample_rate = 16_000
    silence = np.zeros(int(sample_rate * 0.5), dtype=np.float32)
    tone = np.sin(np.linspace(0, np.pi * 8, int(sample_rate * 0.5))).astype(np.float32) * 0.05
    audio = np.concatenate([silence, tone, silence])
    src = tmp_path / "clip.wav"
    sf.write(src, audio, sample_rate)

    prepared = _prepare_audio_for_asr(str(src))

    assert prepared is not None
    try:
      out, sr = sf.read(prepared, dtype="float32")
      assert sr == sample_rate
      assert len(out) < len(audio)
      assert np.max(np.abs(out)) > 0.4
    finally:
      Path(prepared).unlink(missing_ok=True)


def test_prepare_audio_rejects_near_silence(tmp_path):
    from app.transcription_service import AudioInputError, _prepare_audio_for_asr

    src = tmp_path / "silent.wav"
    sf.write(src, np.zeros(16_000, dtype=np.float32), 16_000)

    with pytest.raises(AudioInputError, match="too quiet"):
        _prepare_audio_for_asr(str(src))
