"""Align Whisper transcript segments with pyannote diarization speaker labels."""

from typing import List

from pyannote.core import Annotation, Segment

from app.transcription import TranscriptSegment

# Diarization overlaps shorter than this are ignored to avoid micro-splits
# caused by noisy boundaries in pyannote output.
_MIN_OVERLAP = 0.1  # seconds


def _split_segment(
    seg: TranscriptSegment,
    diarization: Annotation,
    fallback_label: str,
) -> List[dict]:
    """Return one or more dicts for a single TranscriptSegment.

    If the diarization timeline contains a speaker change inside the segment
    *and* word timestamps are available, the segment is split at the nearest
    word boundary so each part gets its own speaker label.  Otherwise the
    dominant-overlap speaker is used for the whole segment.
    """
    seg_interval = Segment(seg.start, seg.end)

    # Collect all diarization windows that overlap this transcript segment.
    overlapping = []
    for diar_seg, _, speaker in diarization.itertracks(yield_label=True):
        overlap = seg_interval & diar_seg
        if overlap and overlap.duration >= _MIN_OVERLAP:
            overlapping.append((diar_seg, speaker, overlap.duration))

    if not overlapping:
        return [{"speaker": fallback_label, "start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text}]

    unique_speakers = {s for _, s, _ in overlapping}

    # Single speaker, or no word timestamps to split on → max-overlap assignment.
    if len(unique_speakers) == 1 or not seg.words:
        best_speaker = max(overlapping, key=lambda x: x[2])[1]
        return [{"speaker": best_speaker, "start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text}]

    # Multiple speakers detected within this segment — split by word midpoints.
    # Build contiguous sub-windows clipped to [seg.start, seg.end].
    sub_windows = sorted(
        [(max(d.start, seg.start), min(d.end, seg.end), spk)
         for d, spk, _ in overlapping],
        key=lambda x: x[0],
    )
    sub_windows = [(s, e, spk) for s, e, spk in sub_windows if e > s]

    # Assign each word to the sub-window that contains its midpoint.
    buckets: List[List[dict]] = [[] for _ in sub_windows]
    for word in seg.words:
        mid = (word["start"] + word["end"]) / 2
        placed = False
        for i, (w_start, w_end, _) in enumerate(sub_windows):
            if w_start <= mid <= w_end:
                buckets[i].append(word)
                placed = True
                break
        if not placed:
            # Word falls in a gap between diarization segments; attach to nearest.
            best_i = min(
                range(len(sub_windows)),
                key=lambda i: min(abs(mid - sub_windows[i][0]), abs(mid - sub_windows[i][1])),
            )
            buckets[best_i].append(word)

    results = []
    for i, (w_start, w_end, speaker) in enumerate(sub_windows):
        words_in = buckets[i]
        if not words_in:
            continue
        text = "".join(w["word"] for w in words_in).strip()
        if not text:
            continue
        results.append({
            "speaker": speaker,
            "start": round(words_in[0]["start"], 3),
            "end": round(words_in[-1]["end"], 3),
            "text": text,
        })

    # Safety fallback: if splitting produced nothing, keep the whole segment.
    if not results:
        best_speaker = max(overlapping, key=lambda x: x[2])[1]
        return [{"speaker": best_speaker, "start": round(seg.start, 3), "end": round(seg.end, 3), "text": seg.text}]

    return results


def assign_speakers(
    transcript_segments: List[TranscriptSegment],
    diarization: Annotation,
    fallback_label: str = "SPEAKER_00",
) -> List[dict]:
    """Map each transcript segment to a speaker label, splitting segments where
    a speaker change is detected mid-segment using word-level timestamps.

    Returns a list of dicts with keys: speaker, start, end, text.
    """
    results = []
    for seg in transcript_segments:
        results.extend(_split_segment(seg, diarization, fallback_label))
    return results
