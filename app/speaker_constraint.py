from typing import Dict

import numpy as np
from pyannote.core import Annotation
from sklearn.cluster import AgglomerativeClustering


def constrain_speakers(
    diarization: Annotation,
    embeddings: Dict[str, np.ndarray],
    num_speakers: int,
) -> Annotation:
    """Merge speakers down to num_speakers using embedding similarity.

    If the diarization already has <= num_speakers, it is returned unchanged.
    Speakers without embeddings are left with their original labels.
    """
    detected = list(diarization.labels())
    if len(detected) <= num_speakers:
        return diarization

    valid = [s for s in detected if s in embeddings]
    if len(valid) < 2:
        return diarization

    emb_matrix = np.stack([embeddings[s] for s in valid])
    norms = np.linalg.norm(emb_matrix, axis=1, keepdims=True)
    emb_matrix = emb_matrix / np.maximum(norms, 1e-8)

    n_clusters = min(num_speakers, len(valid))
    clustering = AgglomerativeClustering(
        n_clusters=n_clusters,
        metric="cosine",
        linkage="average",
    )
    labels = clustering.fit_predict(emb_matrix)

    mapping = {valid[i]: f"SPEAKER_{labels[i]:02d}" for i in range(len(valid))}
    # Speakers with no embedding keep their original label
    for s in detected:
        if s not in mapping:
            mapping[s] = s

    new_annotation = Annotation()
    for segment, track, speaker in diarization.itertracks(yield_label=True):
        new_annotation[segment, track] = mapping.get(speaker, speaker)

    return new_annotation
