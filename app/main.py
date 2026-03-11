import json
import os
import subprocess
import tempfile
from contextlib import asynccontextmanager
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.responses import RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.align import assign_speakers
from app.auth import create_access_token, get_current_user, hash_password, verify_password
from app.database import Transcription, User, create_tables, get_db
from app.diarization import diarize
from app.speaker_constraint import constrain_speakers
from app.transcription import transcribe


# --------------------------------------------------------------------------- #
# Lifespan
# --------------------------------------------------------------------------- #

@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    yield


# --------------------------------------------------------------------------- #
# App
# --------------------------------------------------------------------------- #

app = FastAPI(title="Podcast Transcriber API", lifespan=lifespan)

static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)
app.mount("/static", StaticFiles(directory=static_dir), name="static")


# --------------------------------------------------------------------------- #
# Schemas
# --------------------------------------------------------------------------- #

class RegisterRequest(BaseModel):
    username: str
    email: str  # plain str, no email-validator dependency
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class SegmentResponse(BaseModel):
    speaker: str
    start: float
    end: float
    text: str


class TranscribeResponse(BaseModel):
    number_of_speakers: int
    segments: List[SegmentResponse]


class TranscriptionSummary(BaseModel):
    id: int
    filename: str
    number_of_speakers: int
    duration_seconds: Optional[float]
    created_at: str


class TranscriptionDetail(BaseModel):
    id: int
    filename: str
    number_of_speakers: int
    duration_seconds: Optional[float]
    created_at: str
    segments: List[SegmentResponse]


# --------------------------------------------------------------------------- #
# Root
# --------------------------------------------------------------------------- #

@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------- #
# Auth routes
# --------------------------------------------------------------------------- #

@app.post("/auth/register", status_code=status.HTTP_201_CREATED)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if db.query(User).filter(User.username == req.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")
    if db.query(User).filter(User.email == req.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")
    user = User(
        username=req.username,
        email=req.email,
        hashed_password=hash_password(req.password),
    )
    db.add(user)
    db.commit()
    return {"message": "Account created"}


@app.post("/auth/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    token = create_access_token({"sub": user.username})
    return TokenResponse(access_token=token)


# --------------------------------------------------------------------------- #
# Transcription CRUD
# --------------------------------------------------------------------------- #

@app.get("/transcriptions", response_model=List[TranscriptionSummary])
def list_transcriptions(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Transcription)
        .filter(Transcription.user_id == current_user.id)
        .order_by(Transcription.created_at.desc())
        .all()
    )
    return [
        TranscriptionSummary(
            id=r.id,
            filename=r.filename,
            number_of_speakers=r.number_of_speakers,
            duration_seconds=r.duration_seconds,
            created_at=r.created_at.isoformat(),
        )
        for r in rows
    ]


@app.get("/transcriptions/{tid}", response_model=TranscriptionDetail)
def get_transcription(
    tid: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(Transcription).filter(
        Transcription.id == tid, Transcription.user_id == current_user.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    segments = json.loads(row.segments_json)
    return TranscriptionDetail(
        id=row.id,
        filename=row.filename,
        number_of_speakers=row.number_of_speakers,
        duration_seconds=row.duration_seconds,
        created_at=row.created_at.isoformat(),
        segments=[SegmentResponse(**s) for s in segments],
    )


class UpdateSegmentsRequest(BaseModel):
    segments: List[SegmentResponse]


@app.patch("/transcriptions/{tid}", status_code=status.HTTP_204_NO_CONTENT)
def update_transcription(
    tid: int,
    req: UpdateSegmentsRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(Transcription).filter(
        Transcription.id == tid, Transcription.user_id == current_user.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    row.segments_json = json.dumps([s.model_dump() for s in req.segments])
    db.commit()


@app.delete("/transcriptions/{tid}", status_code=status.HTTP_204_NO_CONTENT)
def delete_transcription(
    tid: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = db.query(Transcription).filter(
        Transcription.id == tid, Transcription.user_id == current_user.id
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(row)
    db.commit()


# --------------------------------------------------------------------------- #
# Transcribe endpoint
# --------------------------------------------------------------------------- #

@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe_audio(
    file: UploadFile = File(..., description="Audio file to transcribe"),
    number_of_speakers: int = Form(ge=1, le=10, description="Number of speakers"),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    ext = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(await file.read())
        tmp_path = tmp.name

    # Convert to 16kHz mono WAV so both torchaudio and faster-whisper
    # receive a format that works without torchcodec.
    wav_path = tmp_path + ".wav"
    try:
        subprocess.run(
            ["ffmpeg", "-y", "-i", tmp_path, "-ar", "16000", "-ac", "1", wav_path],
            check=True,
            capture_output=True,
        )
    except subprocess.CalledProcessError as exc:
        os.unlink(tmp_path)
        raise HTTPException(status_code=500, detail=f"Audio conversion failed: {exc.stderr.decode()}")

    try:
        # Step 1: diarize — identify who spoke when
        diarization, embeddings = diarize(wav_path)

        # Step 2: constrain to the requested speaker count
        diarization = constrain_speakers(diarization, embeddings, number_of_speakers)

        # Step 3: transcribe — get text + timestamps
        transcript_segments = transcribe(wav_path)

        # Step 4: assign each text segment to its speaker by max time-overlap
        aligned = assign_speakers(transcript_segments, diarization)
        segments = [SegmentResponse(**s) for s in aligned]

        duration = max((s["end"] for s in aligned), default=None)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    finally:
        os.unlink(tmp_path)
        if os.path.exists(wav_path):
            os.unlink(wav_path)

    record = Transcription(
        user_id=current_user.id,
        filename=file.filename or "audio",
        number_of_speakers=number_of_speakers,
        segments_json=json.dumps([s.model_dump() for s in segments]),
        duration_seconds=round(duration, 1) if duration else None,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return TranscribeResponse(number_of_speakers=number_of_speakers, segments=segments)


# --------------------------------------------------------------------------- #
# Debug
# --------------------------------------------------------------------------- #

@app.get("/debug/token")
def debug_token():
    import requests
    token = os.environ.get("HF_TOKEN")
    if not token:
        return {"token_loaded": False, "error": "HF_TOKEN is not set"}
    masked = token[:6] + "..." + token[-4:] if len(token) > 10 else "too_short"
    resp = requests.get(
        "https://huggingface.co/api/whoami",
        headers={"Authorization": f"Bearer {token}"},
    )
    if resp.status_code == 200:
        user = resp.json().get("name", "unknown")
        return {"token_loaded": True, "token_preview": masked, "hf_user": user, "auth": "ok"}
    return {"token_loaded": True, "token_preview": masked, "auth": "failed", "status_code": resp.status_code}
