import os
from typing import Dict, Optional, Tuple

import numpy as np
import torch
import torchaudio
from pyannote.audio import Inference, Pipeline
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
    return _pipeline


def diarize(audio_path: str) -> Tuple[Annotation, Dict[str, np.ndarray]]:
    """Run speaker diarization and extract per-speaker embeddings.

    Returns:
        diarization: pyannote Annotation with speaker labels per time segment.
        embeddings: dict mapping speaker label -> mean embedding vector.
                    May be empty if embedding extraction fails.
    """
    pipeline = get_pipeline()
    diarization: Annotation = pipeline(audio_path)

    embeddings: Dict[str, np.ndarray] = {}
    try:
        embedding_model = pipeline.embedding
        inference = Inference(embedding_model, window="whole")

        waveform, sample_rate = torchaudio.load(audio_path)
        audio_file = {"waveform": waveform, "sample_rate": sample_rate}

        for speaker in diarization.labels():
            speaker_timeline = diarization.label_timeline(speaker)
            speaker_embs = []
            for seg in speaker_timeline:
                try:
                    emb = inference.crop(audio_file, seg)
                    if isinstance(emb, torch.Tensor):
                        emb = emb.detach().numpy()
                    if emb is not None and np.ndim(emb) >= 1:
                        speaker_embs.append(np.array(emb).flatten())
                except Exception:
                    pass
            if speaker_embs:
                embeddings[speaker] = np.mean(speaker_embs, axis=0)
    except Exception:
        # Embedding extraction is best-effort; constraint layer skips merging when empty.
        pass

    return diarization, embeddings
