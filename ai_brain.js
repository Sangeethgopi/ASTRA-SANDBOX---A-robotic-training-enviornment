/**
 * ai_brain.js — Robot Command Brain
 * Sends natural language instructions to /api/chat (our secure backend proxy).
 * The LLM API key (Groq/Gemini) is stored server-side ONLY — never in the browser.
 * Falls back to a smart keyword parser if the server is unavailable.
 */

export class RobotBrain {
    constructor(onCommand) {
        this.onCommand = onCommand; // callback(commandObj)
        this.log = document.getElementById('ai-log');
        this.input = document.getElementById('ai-input');
        this.sendBtn = document.getElementById('ai-send');
        this._setupListeners();
        this._addLog('🧠 Brain initialised. Type a command!', '#cc44ff');
        this._addLog('💡 AI powered by server-side LLM — no key needed!', '#888');
    }

    _setupListeners() {
        if (!this.sendBtn || !this.input) return;
        this.sendBtn.addEventListener('click', () => this._send());
        this.input.addEventListener('keydown', e => { if (e.key === 'Enter') this._send(); });
    }

    _addLog(text, color = '#ddd') {
        if (!this.log) return;
        const div = document.createElement('div');
        div.style.color = color;
        div.textContent = text;
        this.log.appendChild(div);
        this.log.scrollTop = this.log.scrollHeight;
    }

    async _send() {
        const raw = (this.input.value || '').trim();
        if (!raw) return;
        this.input.value = '';
        this._addLog(`> ${raw}`, '#fff');

        // Try the secure backend proxy first
        let cmd = await this._parseWithServer(raw);

        // If the server is unavailable (e.g. local dev without backend), use keywords
        if (!cmd) {
            cmd = this._parseKeywords(raw);
        }

        if (cmd) {
            this._executeCommand(cmd);
        } else {
            this._addLog('❓ I didn\'t understand that. Try: walk, stop, run, turn left/right, wave, crouch', '#ff9800');
        }
    }

    // ── Secure server-side LLM proxy ─────────────────────────────────────────
    // The browser ONLY sends the plain instruction text.
    // The API key lives in Vercel environment variables — never exposed here.
    async _parseWithServer(instruction) {
        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ instruction })
            });

            if (!res.ok) {
                // Server returned an error (e.g. no key configured) — fall back silently
                const err = await res.json().catch(() => ({}));
                if (err.error) this._addLog(`⚠️ Server: ${err.error}. Using keyword fallback.`, '#ff9800');
                return null;
            }

            return await res.json();
        } catch {
            // Network error or running locally without backend — fall back silently
            return null;
        }
    }

    // ── Keyword parser (no API needed) ───────────────────────────────────────
    _parseKeywords(text) {
        const t = text.toLowerCase();
        const cmd = { speed: null, direction: null, pose: null, gait: null, message: '' };

        // Speed / gait
        if (/stop|halt|freeze|stand/.test(t))   { cmd.speed = 0; cmd.gait = 'idle'; }
        else if (/sprint|fast|maximum/.test(t)) { cmd.speed = 12; cmd.gait = 'run'; }
        else if (/run|jog/.test(t))             { cmd.speed = 8; cmd.gait = 'run'; }
        else if (/sneak|slow|careful/.test(t))  { cmd.speed = 2; cmd.gait = 'sneak'; }
        else if (/walk/.test(t))                { cmd.speed = 3.5; cmd.gait = 'walk'; }

        // Direction
        if (/forward|ahead|north/.test(t))      cmd.direction = 'forward';
        else if (/back(ward)?|south/.test(t))   cmd.direction = 'backward';
        else if (/left|west/.test(t))           cmd.direction = 'left';
        else if (/right|east/.test(t))          cmd.direction = 'right';

        // Pose
        if (/t.?pose/.test(t))                  cmd.pose = 't-pose';
        else if (/wave/.test(t))                cmd.pose = 'wave';
        else if (/crouch|duck/.test(t))         cmd.pose = 'crouch';
        else if (/attention|salute/.test(t))    cmd.pose = 'attention';

        if (cmd.speed === null && !cmd.pose && !cmd.direction) return null;

        // Generate message
        const parts = [];
        if (cmd.gait) parts.push(cmd.gait);
        if (cmd.direction) parts.push(cmd.direction);
        cmd.message = parts.length ? `Executing: ${parts.join(' ')}` : 'Understood.';
        return cmd;
    }

    // ── Execute parsed command ─────────────────────────────────────────────
    _executeCommand(cmd) {
        this._addLog(`🤖 ${cmd.message || 'Executing...'}`, '#00f2ff');
        this.onCommand(cmd);
    }
}
