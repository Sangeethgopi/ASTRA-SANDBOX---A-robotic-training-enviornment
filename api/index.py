from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import os
import json
import urllib.request
import urllib.error

app = FastAPI()

# ── Health check ─────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {"status": "ok", "message": "Astra Sandbox Backend is healthy"}


# ── Robot Brain Chat endpoint ─────────────────────────────────────────────────
# The API key NEVER leaves this server. The browser sends a plain instruction
# string, this function calls the LLM, and returns only the parsed command.
@app.post("/api/chat")
async def chat(request: Request):
    try:
        body = await request.json()
        instruction = body.get("instruction", "").strip()
        if not instruction:
            return JSONResponse({"error": "No instruction provided"}, status_code=400)
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    # Try Groq first, fall back to Gemini
    groq_key = os.environ.get("GROQ_API_KEY", "")
    gemini_key = os.environ.get("GEMINI_API_KEY", "")

    prompt = build_prompt(instruction)

    if groq_key:
        result = call_groq(groq_key, prompt)
    elif gemini_key:
        result = call_gemini(gemini_key, prompt)
    else:
        return JSONResponse({"error": "No LLM API key configured on server"}, status_code=503)

    if result:
        return JSONResponse(result)
    return JSONResponse({"error": "LLM parsing failed"}, status_code=500)


def build_prompt(instruction: str) -> str:
    return f"""You are the AI brain of a humanoid robot in a simulation sandbox.
Parse the user's instruction into a JSON command object. Respond ONLY with valid JSON, no explanation.

Available fields:
- speed: number 0-10 (0=stop, 3=walk, 6=run, 10=sprint)
- direction: "forward" | "backward" | "left" | "right" | "stop" | null
- gait: "walk" | "run" | "sneak" | "idle" | null
- pose: "t-pose" | "wave" | "crouch" | "jump" | "attention" | null
- message: string (short acknowledgment narrated as the robot)

User instruction: "{instruction}"

Example valid response: {{"speed":3,"direction":"forward","gait":"walk","pose":null,"message":"Walking forward."}}"""


def call_groq(api_key: str, prompt: str):
    """Call Groq's OpenAI-compatible endpoint."""
    payload = json.dumps({
        "model": "llama3-8b-8192",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 200
    }).encode("utf-8")

    req = urllib.request.Request(
        "https://api.groq.com/openai/v1/chat/completions",
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        },
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            text = data["choices"][0]["message"]["content"]
            return extract_json(text)
    except Exception:
        return None


def call_gemini(api_key: str, prompt: str):
    """Call Google Gemini API."""
    payload = json.dumps({
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 200}
    }).encode("utf-8")

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={api_key}"
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
            text = data["candidates"][0]["content"]["parts"][0]["text"]
            return extract_json(text)
    except Exception:
        return None


def extract_json(text: str):
    """Extract the first JSON object from a string."""
    import re
    match = re.search(r'\{[\s\S]*\}', text)
    if match:
        try:
            return json.loads(match.group())
        except Exception:
            return None
    return None
