import os
from typing import Dict, Optional, Tuple

import numpy as np
import soundfile as sf
import torch
from pyannote.audio import Pipeline
from pyannote.core import Annotation

_pipeline: Optional[Pipeline] = None


def get_pipeline() -> Pipeline:
    global _pipeline
    if _pipeline is None:
        token = os.environ.get("HF_TOKEN")
        _pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1",
            token=token,
        )
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        _pipeline.to(device)
    return _pipeline


def diarize(audio_path: str) -> Tuple[Annotation, Dict[str, np.ndarray]]:
    """Run speaker diarization and extract per-speaker embeddings.

    Returns:
        diarization: pyannote Annotation with speaker labels per time segment.
        embeddings: dict mapping speaker label -> mean embedding vector.
                    May be empty if embedding extraction fails.
    """
    pipeline = get_pipeline()

    # Use soundfile to load audio — avoids torchaudio's torchcodec dependency
    # entirely. Input is always a 16kHz mono WAV at this point.
    data, sample_rate = sf.read(audio_path, dtype="float32", always_2d=True)
    # soundfile returns (samples, channels); pyannote expects (channels, samples)
    waveform = torch.from_numpy(data.T)
    audio_input = {"waveform": waveform, "sample_rate": sample_rate}

    result = pipeline(audio_input)

    # pyannote.audio 4.x returns DiarizeOutput; 3.x returned Annotation directly.
    if hasattr(result, "speaker_diarization"):
        diarization: Annotation = result.speaker_diarization
        raw_embeddings = result.speaker_embeddings  # shape (num_speakers, dim) or None
    else:
        diarization = result
        raw_embeddings = None

    # Build speaker label -> embedding dict.
    # DiarizeOutput.speaker_embeddings rows align with sorted speaker labels.
    embeddings: Dict[str, np.ndarray] = {}
    try:
        if raw_embeddings is not None and len(raw_embeddings) > 0:
            speakers = sorted(diarization.labels())
            for i, speaker in enumerate(speakers):
                if i < len(raw_embeddings):
                    embeddings[speaker] = np.array(raw_embeddings[i]).flatten()
    except Exception:
        pass

    return diarization, embeddings
