# Podcast Transcriber Project

## Goal
Build a FastAPI backend that transcribes podcast audio and detects speakers.

## Input
User uploads:
- audio file
- number_of_speakers (constraint)

## Pipeline

Audio Upload
→ Whisper transcription (faster-whisper)
→ Speaker diarization (pyannote.audio)
→ Speaker constraint layer
→ Structured transcript response

## Speaker Constraint Layer

If diarization detects more speakers than requested:

1. Extract voice embeddings
2. Measure similarity between speakers
3. Merge closest speakers
4. Produce final transcript with requested number_of_speakers

## Output Format

Return structured JSON:

{
  "segments": [
    {
      "speaker": "Speaker 1",
      "start": 0.0,
      "end": 4.2,
      "text": "Hello welcome to the podcast"
    }
  ]
}

## Stack

FastAPI  
faster-whisper  
pyannote.audio  
numpy / sklearn

## Code Organization

app/
  main.py
  transcription.py
  diarization.py
  speaker_constraint.py

Keep logic modular and avoid placing all code in main.py.