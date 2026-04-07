/**
 * ai_brain.js — Robot Command Brain
 * Parses natural language instructions and maps them to robot actions.
 * Falls back to a smart keyword parser if no API key is provided.
 */

export class RobotBrain {
    constructor(onCommand) {
        this.onCommand = onCommand; // callback(commandObj)
        this.apiKey = localStorage.getItem('astra_gemini_key') || '';
        this.log = document.getElementById('ai-log');
        this.input = document.getElementById('ai-input');
        this.sendBtn = document.getElementById('ai-send');
        this._setupListeners();
        this._addLog('🧠 Brain initialised. Type a command!', '#cc44ff');
        if (!this.apiKey) {
            this._addLog('💡 Tip: Paste your Gemini API key using /key YOUR_KEY for smarter AI.', '#888');
        }
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

        // Special command: set API key
        if (raw.startsWith('/key ')) {
            this.apiKey = raw.slice(5).trim();
            localStorage.setItem('astra_gemini_key', this.apiKey);
            this._addLog('✅ API key saved!', '#00f2ff');
            return;
        }

        let cmd;
        if (this.apiKey) {
            cmd = await this._parseWithGemini(raw);
        } else {
            cmd = this._parseKeywords(raw);
        }

        if (cmd) {
            this._executeCommand(cmd);
        } else {
            this._addLog('❓ I didn\'t understand that. Try: walk, stop, run, turn left/right, pose, jump', '#ff9800');
        }
    }

    // ── Gemini API parse ─────────────────────────────────────────────────────
    async _parseWithGemini(instruction) {
        const prompt = `You are the AI brain of a humanoid robot in a simulation sandbox.
Parse the user's instruction into a JSON command object. Respond ONLY with valid JSON, no explanation.

Available fields:
- speed: number 0-10 (0=stop, 3=walk, 6=run, 10=sprint)
- direction: "forward" | "backward" | "left" | "right" | "stop" | null
- gait: "walk" | "run" | "sneak" | "idle" | null
- pose: "t-pose" | "wave" | "crouch" | "jump" | "attention" | null
- message: string (short acknowledgment narrated as the robot)

User instruction: "${instruction}"

Example valid response: {"speed":3,"direction":"forward","gait":"walk","pose":null,"message":"Walking forward."}`;

        try {
            const res = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.1, maxOutputTokens: 200 }
                    })
                }
            );
            const data = await res.json();
            const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const json = text.match(/\{[\s\S]*\}/)?.[0];
            if (json) return JSON.parse(json);
        } catch (e) {
            this._addLog('⚠️ Gemini error, using keyword fallback.', '#ff9800');
        }
        return this._parseKeywords(instruction);
    }

    // ── Keyword parser (no API needed) ───────────────────────────────────────
    _parseKeywords(text) {
        const t = text.toLowerCase();
        const cmd = { speed: null, direction: null, pose: null, gait: null, message: '' };

        // Speed / gait
        if (/stop|halt|freeze|stand/.test(t))   { cmd.speed = 0; cmd.gait = 'idle'; }
        else if (/sprint|fast|maximum/.test(t)) { cmd.speed = 6; cmd.gait = 'run'; }
        else if (/run|jog/.test(t))             { cmd.speed = 4; cmd.gait = 'run'; }
        else if (/sneak|slow|careful/.test(t))  { cmd.speed = 1.5; cmd.gait = 'sneak'; }
        else if (/walk/.test(t))                { cmd.speed = 2; cmd.gait = 'walk'; }

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
