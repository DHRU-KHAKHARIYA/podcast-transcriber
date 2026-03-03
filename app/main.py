from fastapi import FastAPI

app = FastAPI(title="Podcast Transcriber API")

@app.get("/")
def root():
    return {"message": "Server is running"}