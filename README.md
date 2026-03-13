# Podcast Transcriber

A FastAPI application that transcribes podcast audio with automatic speaker diarization. Upload an audio file, specify the number of speakers, and get back a structured transcript with speaker labels and timestamps.

## Features

- Audio transcription using [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- Speaker diarization using [pyannote.audio](https://github.com/pyannote/pyannote-audio)
- Speaker count constraint — merges extra speakers by voice similarity
- User authentication with JWT tokens
- Transcript history saved per user (SQLite)
- Web UI served at `/`

## Requirements

- Python 3.10+
- [ffmpeg](https://ffmpeg.org/download.html) installed and on your PATH
- A [HuggingFace](https://huggingface.co) account with access to:
  - [`pyannote/speaker-diarization-3.1`](https://huggingface.co/pyannote/speaker-diarization-3.1)
  - [`pyannote/segmentation-3.0`](https://huggingface.co/pyannote/segmentation-3.0)

## Setup

```bash
# Clone the repo
git clone https://github.com/DHRU-KHAKHARIYA/podcast-transcriber.git
cd podcast-transcriber

# Create and activate a virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Copy and fill in environment variables
cp .env.example .env
```

Edit `.env` with your values (see [Environment Variables](#environment-variables)).

## Running

```bash
uvicorn app.main:app --reload
```

Open http://localhost:8000 in your browser.

Interactive API docs are available at http://localhost:8000/docs.

## Environment Variables

| Variable | Description |
|---|---|
| `HF_TOKEN` | HuggingFace access token (required for pyannote models) |
| `WHISPER_MODEL` | Whisper model size: `tiny`, `base`, `small`, `medium`, `large` |
| `WHISPER_DEVICE` | `cpu` or `cuda` |
| `WHISPER_COMPUTE_TYPE` | `int8`, `float16`, `float32` (depends on device) |
| `SECRET_KEY` | Random secret for JWT signing |
| `ALGORITHM` | JWT algorithm (default: `HS256`) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT expiry in minutes |
| `DATABASE_URL` | SQLAlchemy database URL |

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create a new account |
| `POST` | `/auth/login` | Get a JWT token |
| `POST` | `/transcribe` | Upload audio and transcribe |
| `GET` | `/transcriptions` | List your transcriptions |
| `GET` | `/transcriptions/{id}` | Get a transcription with segments |
| `PATCH` | `/transcriptions/{id}` | Update transcript segments |
| `DELETE` | `/transcriptions/{id}` | Delete a transcription |

### Transcribe request

```
POST /transcribe
Authorization: Bearer <token>
Content-Type: multipart/form-data

file: <audio file>
number_of_speakers: 2
```

### Response format

```json
{
  "number_of_speakers": 2,
  "segments": [
    {
      "speaker": "Speaker 1",
      "start": 0.0,
      "end": 4.2,
      "text": "Hello welcome to the podcast"
    }
  ]
}
```

## Project Structure

```
app/
  main.py               # FastAPI app, routes
  transcription.py      # faster-whisper transcription
  diarization.py        # pyannote speaker diarization
  speaker_constraint.py # merge speakers to match requested count
  align.py              # assign speakers to transcript segments
  auth.py               # JWT auth helpers
  database.py           # SQLAlchemy models
  static/               # Frontend (HTML/JS/CSS)
```
