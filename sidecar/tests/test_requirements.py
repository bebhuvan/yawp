from pathlib import Path


def test_runtime_dependencies_include_optional_app_paths():
    root = Path(__file__).resolve().parents[1]
    requirements = (root / "requirements.txt").read_text()

    for package in (
        "language-tool-python",
        "onnx-asr",
        "pynput",
        "requests",
        "sounddevice",
        "webrtcvad",
    ):
        assert package in requirements
