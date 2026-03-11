"""Align Whisper transcript segments with pyannote diarization speaker labels."""

from typing import List

from pyannote.core import Annotation, Segment

from app.transcription import TranscriptSegment


def assign_speakers(
    transcript_segments: List[TranscriptSegment],
    diarization: Annotation,
    fallback_label: str = "SPEAKER_00",
) -> List[dict]:
    """Map each transcript segment to a speaker label via max-overlap matching.

    For each Whisper segment we look at the diarization timeline and pick the
    speaker whose active time overlaps most with that segment's time window.
    If there is no overlap at all we assign `fallback_label`.

    Returns a list of dicts with keys: speaker, start, end, text.
    """
    results = []
    for seg in transcript_segments:
        seg_interval = Segment(seg.start, seg.end)
        best_speaker = fallback_label
        best_overlap = 0.0

        for diar_seg, _, speaker in diarization.itertracks(yield_label=True):
            overlap = seg_interval & diar_seg  # pyannote Segment intersection
            if overlap and overlap.duration > best_overlap:
                best_overlap = overlap.duration
                best_speaker = speaker

        results.append(
            {
                "speaker": best_speaker,
                "start": round(seg.start, 3),
                "end": round(seg.end, 3),
                "text": seg.text,
            }
        )
    return results
