import os
from dataclasses import dataclass, field
from typing import List, Optional

import torch
from faster_whisper import WhisperModel


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str
    words: List[dict] = field(default_factory=list)  # [{"word", "start", "end"}]


_model: Optional[WhisperModel] = None


def get_model() -> WhisperModel:
    global _model
    if _model is None:
        model_size = os.environ.get("WHISPER_MODEL", "base")
        device = os.environ.get("WHISPER_DEVICE", "cuda" if torch.cuda.is_available() else "cpu")
        compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "float16" if device == "cuda" else "int8")
        _model = WhisperModel(model_size, device=device, compute_type=compute_type)
    return _model


def transcribe(audio_path: str) -> List[TranscriptSegment]:
    model = get_model()
    segments, _ = model.transcribe(audio_path, beam_size=5, word_timestamps=True)
    result = []
    for seg in segments:
        words = []
        if seg.words:
            words = [{"word": w.word, "start": w.start, "end": w.end} for w in seg.words]
        result.append(TranscriptSegment(start=seg.start, end=seg.end, text=seg.text.strip(), words=words))
    return result
