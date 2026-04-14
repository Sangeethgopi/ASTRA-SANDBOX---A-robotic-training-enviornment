from fastapi import FastAPI
import os

app = FastAPI()

@app.get("/get_weights")
async def get_weights():
    # In a real Vercel environment, we server weights stored in the repo or an external S3 bucket
    return {
        "status": "Astra Cloud Inference Active",
        "region": os.environ.get("VERCEL_REGION", "global"),
        "node": "Vercel Serverless Function (Python)"
    }

@app.get("/health")
async def health():
    return {"status": "ok", "message": "Astra Sandbox Backend is healthy"}
