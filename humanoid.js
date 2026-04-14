import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { physics, createMotorizedJoint } from 'physics';

const MODEL_SPECS = {
    'Optimus': { body: '#1a2a3a', accent: '#00cfff', massMult: 1.0, label: 'Tesla Optimus Gen 2', scale: 1.0 },
    'Atlas':   { body: '#c8d8e8', accent: '#ffffff', massMult: 2.0, label: 'Boston Dynamics Atlas', scale: 1.15 },
    'Figure':  { body: '#2a2a2a', accent: '#ff6a00', massMult: 1.0, label: 'Figure 03', scale: 1.0 },
    'Digit':   { body: '#111', accent: '#00ff8c', massMult: 0.8, label: 'Agility Digit', scale: 0.9, noHead: true },
    'Neo':     { body: '#1a0a2a', accent: '#cc44ff', massMult: 0.75, label: '1X NEO', scale: 0.85 },
    'TazerBot': { body: '#002244', accent: '#ff8800', massMult: 1.2, label: 'Tazer AI Servo Bot', scale: 1.0 },
};

export class Humanoid {
    constructor(scene, x, y, z, model = 'Optimus') {
        this.scene = scene;
        this.model = model;
        this.isSelected = false;
        this.selectionRing = null;
        this.time = 0;
        this.gaitParams = { speed: 0, stepHeight: 0.35, stepLength: 0.45 };
        this.moveDir = { x: 0, z: 0 };
        this.joints = {}; // Stores joint handles (integers)
        this.physicsBodies = {}; // Stores body handles (integers) keyed by part name
        this.physicsBodyHandle = null; // Handle for the primary pelvis body
        this.parts = {}; // Visual mesh references for each body segment
        this.spatialMap = []; // Stores {x, z} of learned obstacles
        this.isJumping = false;
        this.jumpCooldown = 0;
        this.lastStepSide = null;

        this.init(x, z);
    }

    init(x, z) {
        const spec = MODEL_SPECS[this.model] || MODEL_SPECS['Optimus'];
        this.modelSpec = spec;
        this.s = spec.scale;
        const s = this.s;

        // ═══════════════════════════════════════════════
        // PHYSICS LAYER: Multi-Body Articulated System
        // ═══════════════════════════════════════════════
        if (!physics.world) {
            console.error("❌ Humanoid error: physics.world is null. Spawning aborted.");
            return;
        }
        
        this._buildPhysicsBodies(x, z, spec);
        this._buildPhysicsJoints();

        // Track the primary body for environment effects (passes handle, not live ref)
        physics.trackBody(this.physicsBodyHandle);

        // ═══════════════════════════════════════════════
        // VISUAL LAYER: Three.js group hierarchy
        // ═══════════════════════════════════════════════
        this.group = new THREE.Group();
        this.scene.add(this.group);

        // Store accent as integer for materials
        this.accentInt = parseInt(spec.accent.replace('#', ''), 16);

        this._buildVisual(spec);
        // this._buildLabel(spec.label, spec.accent); // Removed as per user request
        this._buildLiDAR();

        // Tag ALL group nodes so _findHumanoidParent() can walk up and find this robot
        this.group._humanoidRef = this;
        if (this.rootGroup)  this.rootGroup._humanoidRef  = this;
        if (this.torsoGroup) this.torsoGroup._humanoidRef = this;

        // ── Invisible hitbox for reliable click detection ──────────────────
        // A large cylinder that wraps the full robot body. It's the first thing
        // the raycast hits and carries _humanoidRef so selection works every time.
        const hitboxMat = new THREE.MeshBasicMaterial({
            transparent: true, opacity: 0, depthWrite: false, side: THREE.FrontSide
        });
        const hitbox = new THREE.Mesh(
            new THREE.CylinderGeometry(0.45 * this.s, 0.45 * this.s, 1.9 * this.s, 12),
            hitboxMat
        );
        hitbox.position.y = 0.95 * this.s;
        hitbox.name = '__hitbox__';
        hitbox._humanoidRef = this; // Direct tag — found instantly by _findHumanoidParent
        this.rootGroup.add(hitbox);
        this.hitbox = hitbox;

        // Sync position immediately so body is visible from frame 0
        const initBody = physics.world.getRigidBody(this.physicsBodyHandle);
        if (initBody) {
            const t = initBody.translation();
            this.group.position.set(t.x, t.y - (0.8 * this.s), t.z);
        }
    }

    // Helper: get a fresh RigidBody reference by part name (uses handle, not stored object)
    _getBody(key) {
        const h = this.physicsBodies[key];
        return (h !== undefined && h !== null && physics.world) ? physics.world.getRigidBody(h) : null;
    }

    _buildPhysicsBodies(x, z, spec) {
        const s = this.s;
        const world = physics.world;

        // --- 1. PELVIS (Root) ---
        const pelvisBody = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x, 1.0 * s, z)
                .setLinearDamping(0.5)
                .setAngularDamping(2.0)
        );
        this.physicsBodyHandle = pelvisBody.handle; // Store handle, not the live object
        this.physicsBodies.pelvis = pelvisBody.handle;
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.15*s, 0.1*s, 0.1*s).setMass(20 * spec.massMult),
            pelvisBody
        );

        // --- 2. TORSO ---
        const torsoBody = world.createRigidBody(
            RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 1.3 * s, z)
        );
        this.physicsBodies.torso = torsoBody.handle;
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.18*s, 0.2*s, 0.12*s).setMass(30 * spec.massMult),
            torsoBody
        );

        // --- 3. LEGS ---
        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.12 * s : -0.12 * s;

            const thigh = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x + sx, 0.7 * s, z));
            world.createCollider(RAPIER.ColliderDesc.capsule(0.18 * s, 0.06 * s).setMass(8), thigh);
            this.physicsBodies[`thigh${side}`] = thigh.handle;

            const calf = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x + sx, 0.3 * s, z));
            world.createCollider(RAPIER.ColliderDesc.capsule(0.18 * s, 0.05 * s).setMass(5), calf);
            this.physicsBodies[`calf${side}`] = calf.handle;

            const foot = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x + sx, 0.05 * s, z + 0.05 * s));
            world.createCollider(RAPIER.ColliderDesc.cuboid(0.06*s, 0.03*s, 0.12*s).setMass(2).setFriction(2.0).setRestitution(0.1), foot);
            foot.enableCcd(true);
            this.physicsBodies[`foot${side}`] = foot.handle;
        }

        // --- 4. ARMS ---
        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.25 * s : -0.25 * s;

            const uArm = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x + sx, 1.3 * s, z));
            world.createCollider(RAPIER.ColliderDesc.capsule(0.1 * s, 0.04 * s).setMass(3), uArm);
            this.physicsBodies[`upperArm${side}`] = uArm.handle;

            const fArm = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x + sx, 1.1 * s, z));
            world.createCollider(RAPIER.ColliderDesc.capsule(0.1 * s, 0.03 * s).setMass(2), fArm);
            this.physicsBodies[`foreArm${side}`] = fArm.handle;
        }

        // --- 5. HEAD ---
        if (!spec.noHead) {
            const head = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, 1.6 * s, z));
            world.createCollider(RAPIER.ColliderDesc.cuboid(0.1*s, 0.1*s, 0.1*s).setMass(4), head);
            this.physicsBodies.head = head.handle;
        }
    }

    _buildPhysicsJoints() {
        const s = this.s;
        const world = physics.world;

        // Get fresh body references for joint creation — safe since this is init-time not render-time
        const pelvis   = this._getBody('pelvis');
        const torso    = this._getBody('torso');
        const head     = this._getBody('head');

        if (pelvis && torso) {
            this.joints.waist = createMotorizedJoint(world, pelvis, torso,
                {x:0, y:0.1*s, z:0}, {x:0, y:-0.2*s, z:0}, {x:0, y:1, z:0});
        }

        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.12 * s : -0.12 * s;
            const thigh = this._getBody(`thigh${side}`);
            const calf  = this._getBody(`calf${side}`);
            const foot  = this._getBody(`foot${side}`);

            if (pelvis && thigh)
                this.joints[`hip${side}`] = createMotorizedJoint(world, pelvis, thigh,
                    {x:sx, y:-0.05*s, z:0}, {x:0, y:0.2*s, z:0}, {x:1, y:0, z:0});
            if (thigh && calf)
                this.joints[`knee${side}`] = createMotorizedJoint(world, thigh, calf,
                    {x:0, y:-0.2*s, z:0}, {x:0, y:0.2*s, z:0}, {x:1, y:0, z:0});
            if (calf && foot)
                this.joints[`ankle${side}`] = createMotorizedJoint(world, calf, foot,
                    {x:0, y:-0.2*s, z:0}, {x:0, y:0.03*s, z:-0.05*s}, {x:1, y:0, z:0});
        }

        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.25 * s : -0.25 * s;
            const uArm  = this._getBody(`upperArm${side}`);
            const fArm  = this._getBody(`foreArm${side}`);

            if (torso && uArm)
                this.joints[`shoulder${side}`] = createMotorizedJoint(world, torso, uArm,
                    {x:sx, y:0.1*s, z:0}, {x:0, y:0.1*s, z:0}, {x:1, y:0, z:0});
            if (uArm && fArm)
                this.joints[`elbow${side}`] = createMotorizedJoint(world, uArm, fArm,
                    {x:0, y:-0.1*s, z:0}, {x:0, y:0.1*s, z:0}, {x:1, y:0, z:0});
        }

        if (torso && head)
            this.joints.neck = createMotorizedJoint(world, torso, head,
                {x:0, y:0.25*s, z:0}, {x:0, y:-0.1*s, z:0}, {x:1, y:0, z:0});
    }

    // ─── Material helpers ───────────────────────────────
    _mat() {
        return new THREE.MeshStandardMaterial({
            color: this.modelSpec.body,
            emissive: this.modelSpec.accent,
            emissiveIntensity: 0.25,
            metalness: 0.75, roughness: 0.3
        });
    }
    _accentMat() {
        return new THREE.MeshStandardMaterial({
            color: this.modelSpec.accent, emissive: this.modelSpec.accent,
            emissiveIntensity: 1.2, metalness: 0.4, roughness: 0.3
        });
    }
    _box(w, h, d, name) {
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this._mat());
        m.name = name || ''; m.castShadow = true; m.receiveShadow = true;
        return m;
    }
    _servo(w, h, d, name) {
        const mat = new THREE.MeshStandardMaterial({ color: '#222222', roughness: 0.8, metalness: 0.4 });
        const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
        m.name = name || ''; m.castShadow = true; m.receiveShadow = true;
        return m;
    }

    // ─── Build complete visual body ──────────────────────
    _buildVisual(spec) {
        const s = this.s;
        // Hip joint height above feet: thigh(0.46) + calf(0.44) + foot-to-ankle clearance
        const hipY = 0.96 * s;
        this.rootGroup = new THREE.Group();
        this.group.add(this.rootGroup);

        // torsoGroup: origin = hip joint height
        this.torsoGroup = new THREE.Group();
        this.torsoGroup.position.y = hipY;
        this.rootGroup.add(this.torsoGroup);

        // ── Torso body ────────────────────────────────────
        const isTazer = this.model === 'TazerBot';
        
        const pelW = isTazer ? 0.2*s : 0.34*s;
        const pelH = isTazer ? 0.1*s : 0.22*s;
        const pelvis = this._box(pelW, pelH, 0.2*s, 'Waist & Pelvis');
        this.torsoGroup.add(pelvis);
        this.parts['Waist & Pelvis'] = { mesh: pelvis };

        const chest = this._box(isTazer ? 0.16*s : 0.38*s, isTazer ? 0.2*s : 0.32*s, 0.22*s, 'Waist & Pelvis');
        chest.position.y = 0.26*s;
        this.torsoGroup.add(chest);
        if (isTazer) {
            const battery = this._servo(0.2*s, 0.16*s, 0.15*s, 'Core PCB');
            battery.position.set(0, 0.26*s, 0);
            this.torsoGroup.add(battery);
        }

        // Shoulder width plates
        for (const sx of [-1, 1]) {
            const plate = new THREE.Mesh(
                new THREE.BoxGeometry(0.08*s, 0.06*s, 0.2*s), this._accentMat());
            plate.position.set(sx * 0.23*s, 0.28*s, 0);
            this.torsoGroup.add(plate);
        }

        const neck = this._box(0.1*s, 0.1*s, 0.1*s, 'Waist & Pelvis');
        neck.position.y = 0.49*s;
        this.torsoGroup.add(neck);

        // ── Head ──────────────────────────────────────────
        if (!spec.noHead) {
            this.headGroup = new THREE.Group();
            this.headGroup.position.y = 0.63*s;
            this.torsoGroup.add(this.headGroup);

            const hw = isTazer ? 0.15*s : 0.26*s;
            const hh = isTazer ? 0.12*s : 0.26*s;
            const head = this._box(hw, hh, 0.24*s, 'Head');
            this.headGroup.add(head);
            this.parts['Head'] = { mesh: head };

            // Visor accent strip
            const visor = new THREE.Mesh(
                new THREE.BoxGeometry(0.24*s, 0.04*s, 0.25*s), this._accentMat());
            visor.position.y = 0.04*s;
            this.headGroup.add(visor);
        }

        // ── Arms ──────────────────────────────────────────
        this._buildArm('Left',  s);
        this._buildArm('Right', s);

        // ── Legs ──────────────────────────────────────────
        this._buildLeg('Left',  s);
        this._buildLeg('Right', s);
    }

    _buildArm(side, s) {
        const isTazer = this.model === 'TazerBot';
        const sign = side === 'Left' ? 1 : -1;
        const uLen = 0.26*s, fLen = 0.23*s, hLen = 0.09*s;

        const sg = new THREE.Group();
        sg.position.set(sign * 0.25*s, 0.34*s, 0);
        this.torsoGroup.add(sg);
        this[`shoulder${side}Group`] = sg;
        
        if (isTazer) sg.add(this._servo(0.1*s, 0.1*s, 0.1*s, `Servo`));

        const uArm = this._box(isTazer ? 0.04*s : 0.1*s, uLen, isTazer ? 0.04*s : 0.1*s, 'Upper Arm');
        uArm.position.y = -uLen/2;
        sg.add(uArm);
        this.parts[`upperArm${side}`] = { mesh: uArm };

        const eg = new THREE.Group();
        eg.position.y = -uLen;
        sg.add(eg);
        this[`elbow${side}Group`] = eg;
        
        if (isTazer) eg.add(this._servo(0.08*s, 0.08*s, 0.1*s, `Servo`));

        const fArm = this._box(isTazer ? 0.04*s : 0.09*s, fLen, isTazer ? 0.04*s : 0.09*s, 'Forearm');
        fArm.position.y = -fLen/2;
        eg.add(fArm);
        this.parts[`foreArm${side}`] = { mesh: fArm };

        const hand = this._box(isTazer ? 0.04*s : 0.09*s, hLen, isTazer ? 0.04*s : 0.08*s, 'Hands');
        hand.position.y = -fLen - hLen/2;
        eg.add(hand);
        this.parts[`hand${side}`] = { mesh: hand };
    }

    _buildLeg(side, s) {
        const isTazer = this.model === 'TazerBot';
        const sign = side === 'Left' ? 1 : -1;
        const tLen = 0.46*s, cLen = 0.44*s;

        // Hip pivot — at torsoGroup origin (y=0 = hipY in worldspace)
        const hg = new THREE.Group();
        hg.position.set(sign * 0.12*s, -0.05*s, 0);
        this.torsoGroup.add(hg);
        this[`hip${side}Group`] = hg;
        
        if (isTazer) hg.add(this._servo(0.12*s, 0.1*s, 0.1*s, `Servo`));

        const thigh = this._box(isTazer ? 0.05*s : 0.14*s, tLen, isTazer ? 0.05*s : 0.14*s, 'Thigh');
        thigh.position.y = -tLen/2;
        hg.add(thigh);
        this.parts[`thigh${side}`] = { mesh: thigh };

        // Knee pivot
        const kg = new THREE.Group();
        kg.position.y = -tLen;
        hg.add(kg);
        this[`knee${side}Group`] = kg;
        
        if (isTazer) kg.add(this._servo(0.1*s, 0.1*s, 0.1*s, `Servo`));

        const calf = this._box(isTazer ? 0.05*s : 0.1*s, cLen, isTazer ? 0.05*s : 0.1*s, 'Calf');
        calf.position.y = -cLen/2;
        kg.add(calf);
        this.parts[`calf${side}`] = { mesh: calf };

        // Ankle pivot
        const ag = new THREE.Group();
        ag.position.y = -cLen;
        kg.add(ag);
        this[`ankle${side}Group`] = ag;
        
        if (isTazer) ag.add(this._servo(0.1*s, 0.1*s, 0.1*s, `Servo`));

        const fw = isTazer ? 0.06*s : 0.13*s;
        const foot = this._box(fw, 0.06*s, 0.24*s, 'Feet');
        foot.position.set(0, -0.03*s, 0.05*s);
        ag.add(foot);
        this.parts[`foot${side}`] = { mesh: foot };

        // Knee cap accent
        const kap = new THREE.Mesh(
            new THREE.BoxGeometry(0.12*s, 0.06*s, 0.12*s), this._accentMat());
        kap.position.y = -0.03*s;
        kg.add(kap);
    }

    _buildLabel(text, accentHex) {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 96;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.beginPath(); ctx.roundRect(6, 6, 500, 84, 16); ctx.fill();
        ctx.strokeStyle = accentHex; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.roundRect(6, 6, 500, 84, 16); ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Inter, Arial';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 48);
        const tex = new THREE.CanvasTexture(canvas);
        this.label = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        this.label.scale.set(3.0, 0.6, 1);
        const anchor = this.headGroup || this.torsoGroup;
        this.label.position.y = 0.32*this.s;
        anchor.add(this.label);
    }

    _buildLiDAR() {
        const anchor = this.headGroup || this.torsoGroup;
        const base = new THREE.Mesh(
            new THREE.CylinderGeometry(0.06, 0.06, 0.04, 16),
            new THREE.MeshStandardMaterial({
                color: this.accentInt, emissive: this.accentInt, emissiveIntensity: 2.5 }));
        base.position.y = 0.16*this.s;
        anchor.add(base);
        this.lidarBase = base;

        const laserGeo = new THREE.PlaneGeometry(7, 0.04);
        laserGeo.translate(3.5, 0, 0);
        const laser = new THREE.Mesh(laserGeo, new THREE.MeshBasicMaterial({
            color: this.accentInt, transparent: true, opacity: 0.28,
            side: THREE.DoubleSide, blending: THREE.AdditiveBlending
        }));
        laser.rotation.x = Math.PI / 2;
        base.add(laser);
    }

    // ─── Public API ──────────────────────────────────────
    setMoveDirection(dx, dz) { this.moveDir.x = dx; this.moveDir.z = dz; }

    jump() {
        if (!this.physicsBodyHandle || this.isJumping) return;
        const body = physics.world.getRigidBody(this.physicsBodyHandle);
        if (!body) return;
        body.applyImpulse({ x: 0, y: body.mass() * 7.5, z: 0 }, true);
        this.isJumping = true;
        this.jumpCooldown = 1.0;
    }

    addExperience(x, z) {
        // Prevent duplicate memories in the same area (1.5m radius)
        const duplicate = this.spatialMap.find(exp => Math.hypot(exp.x - x, exp.z - z) < 1.5);
        if (!duplicate) {
            this.spatialMap.push({ x, z });
            this.broadcastExperience(`New obstacle memory acquired at [${x.toFixed(1)}, ${z.toFixed(1)}]`);
        }
    }

    broadcastExperience(msg) {
        const log = document.getElementById('ai-log');
        if (log) {
            const div = document.createElement('div');
            div.style.color = '#cc44ff';
            div.style.fontWeight = 'bold';
            div.textContent = `🧠 Experience Log: ${msg}`;
            log.appendChild(div);
            log.scrollTop = log.scrollHeight;
        }
    }

    setSelected(isSelected) {
        this.isSelected = isSelected;
        const intensity = isSelected ? 1.0 : 0.25;
        this.group.traverse(obj => {
            if (obj.isMesh && obj.material && obj.name !== 'accentOnly') {
                if (obj.material.emissiveIntensity < 1.5) { // don't kill LiDAR/accent
                    obj.material.emissiveIntensity = intensity;
                }
            }
        });

        if (isSelected && !this.selectionRing) {
            const rMat = new THREE.MeshBasicMaterial({
                color: this.accentInt, side: THREE.DoubleSide,
                transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending
            });
            this.selectionRing = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.65, 40), rMat);
            this.selectionRing.rotation.x = -Math.PI / 2;
            this.selectionRing.position.y = 0.02;
            this.rootGroup.add(this.selectionRing);
        } else if (!isSelected && this.selectionRing) {
            this.rootGroup.remove(this.selectionRing);
            this.selectionRing.geometry.dispose();
            this.selectionRing.material.dispose();
            this.selectionRing = null;
        }
    }

    update(delta, _gaitParams, pose, expertise = 1.0) {
        // LiDAR spin
        if (this.lidarBase) this.lidarBase.rotation.y += delta * 20;

        // --- ADAPTIVE "TRAINED" GAIT ADJUSTMENT ---
        let adaptiveStepH = this.gaitParams.stepHeight;
        let adaptiveStepL = this.gaitParams.stepLength;

        // Prepared for obstacles in spatial memory
        const currentPos = this.physicsBody ? this.physicsBody.translation() : { x: 0, y: 0, z: 0 };
        const obstacleAhead = this.spatialMap.find(exp => {
            const dx = exp.x - currentPos.x;
            const dz = exp.z - currentPos.z;
            const dist = Math.hypot(dx, dz);
            const dot = dx * this.moveDir.x + dz * this.moveDir.z;
            return dist < 3.0 && dot > 0.6; // Approaching a known obstacle
        });

        if (obstacleAhead) {
            // "Trained" behavior: lift feet higher to clear potential stairs/rocks
            adaptiveStepH *= 1.8; 
            adaptiveStepL *= 0.8; // Shorter, higher steps for better climbing stability
        }

        const speed  = this.gaitParams.speed;
        const stepH  = adaptiveStepH;
        const stepL  = adaptiveStepL;

        // ─ Capsule physics & locomotion ─────────────────────────────
        if (this.physicsBodyHandle !== null && physics.world) {
            // Get ONE fresh reference — extract plain JS data immediately, don't hold across world calls
            const _pb = physics.world.getRigidBody(this.physicsBodyHandle);
            if (!_pb) return;
            const tp  = _pb.translation(); // plain {x,y,z} copy
            const vel = _pb.linvel();      // plain {x,y,z} copy
            const moving = this.moveDir.x !== 0 || this.moveDir.z !== 0 || this.moveDir.y !== 0;

            // Abyss Recovery
            if (tp.y < -2.0) {
                _pb.setTranslation({ x: 0, y: 3, z: -2 }, true);
                _pb.setLinvel({ x: 0, y: 0, z: 0 }, true);
                this.broadcastExperience("Critical Recovery: Ground breach prevented.");
                return;
            }

            // Sync visual group
            this.group.position.set(tp.x, tp.y - this.footOffset, tp.z);

            const gaitSync = speed > 0 ? 0.8 + Math.abs(Math.sin(this.time)) * 0.4 : 1.0;
            const targetSpd = speed > 0 ? speed * 1.1 * gaitSync : 3.0;

            if (moving) {
                const allowY = Math.abs(physics.world.gravity.y) < 1.0;
                _pb.setLinvel({
                    x: this.moveDir.x * targetSpd,
                    y: (allowY && this.moveDir.y !== 0) ? this.moveDir.y * targetSpd : vel.y,
                    z: this.moveDir.z * targetSpd
                }, true);

                // --- OBSTACLE DETECTION & LEARNING ---
                // castRay is called AFTER all _pb method calls to avoid borrow overlap
                if (speed > 0 && !this.isJumping && this.jumpCooldown <= 0) {
                    const ray = new RAPIER.Ray(
                        { x: tp.x, y: tp.y + 0.5 * this.s, z: tp.z },
                        { x: this.moveDir.x, y: 0, z: this.moveDir.z }
                    );
                    const hit = physics.world.castRay(ray, 2.0, true);
                    if (hit && hit.toi < 1.8) {
                        this.addExperience(tp.x + this.moveDir.x, tp.z + this.moveDir.z);
                        this.jump();
                    }

                    const memory = this.spatialMap.find(exp => {
                        const dx = exp.x - tp.x;
                        const dz = exp.z - tp.z;
                        return Math.hypot(dx, dz) < 2.0 && (dx * this.moveDir.x + dz * this.moveDir.z) > 0.5;
                    });
                    if (memory) {
                        this.broadcastExperience(`Anticipatory jump triggered by spatial memory!`);
                        this.jump();
                    }

                    if (Math.hypot(vel.x, vel.z) < speed * 0.2) {
                        this.broadcastExperience(`Progress blocked. Real-time learning triggered.`);
                        this.addExperience(tp.x + this.moveDir.x * 0.5, tp.z + this.moveDir.z * 0.5);
                        this.jump();
                    }
                }
            } else {
                const drag = speed > 0 ? 0.8 : 0.6;
                const allowY = Math.abs(physics.world.gravity.y) < 1.0;
                _pb.setLinvel({
                    x: vel.x * drag,
                    y: allowY ? vel.y * 0.9 : vel.y,
                    z: vel.z * drag
                }, true);
            }

            // Face direction of movement
            if (speed > 0 && (this.moveDir.x !== 0 || this.moveDir.z !== 0)) {
                const targetAngle = Math.atan2(this.moveDir.x, this.moveDir.z);
                this.group.rotation.y = THREE.MathUtils.lerp(
                    this.group.rotation.y, targetAngle, Math.min(1, delta * 8));
            }

            if (this.jumpCooldown > 0) this.jumpCooldown -= delta;

            // Apply horizontal force (pelvis drive) — get a fresh reference for write
            if (moving) {
                const force = 10.0 * this.modelSpec.massMult;
                this._getBody('pelvis')?.applyImpulse({
                    x: this.moveDir.x * force, y: 0, z: this.moveDir.z * force
                }, true);
            }
        }

        // ─ Biomimetic Procedural Gait (Isaac Sim Style) ────────
        // Adjust cycle speed slightly based on step length to match kinematics
        const cycleSpeed = speed * (stepL > 0.4 ? 2.2 : 3.2);
        this.time += delta * cycleSpeed;
        const t = this.time;

        // Phase calculations (Offset by PI)
        const pL = t;
        const pR = t + Math.PI;

        // Cycloid trajectory approximating IK: Negative Cosine for forward ground sweep, sine for upward lift
        // (This prevents the 'moonwalking' effect by ensuring the footprint moves forward while lifted)
        const sweepL = -Math.cos(pL) * stepL;
        const liftL  = Math.max(0, Math.sin(pL)) * stepH * 1.8;

        const sweepR = -Math.cos(pR) * stepL;
        const liftR  = Math.max(0, Math.sin(pR)) * stepH * 1.8;

        // ── IK Foot Placement with Terrain Raycasting ──
        let hipL, kneeL, ankL, hipR, kneeR, ankR;

        if (physics.world && speed > 0) {
            const tp = this.physicsBody.translation();
            const L1 = 0.4 * this.s; // Thigh
            const L2 = 0.4 * this.s; // Calf

            // Helper to get Ground Y at a specific local offset
            const getGroundY = (offsetX, offsetZ) => {
                const angle = this.group.rotation.y;
                const rx = tp.x + Math.cos(angle) * offsetX + Math.sin(angle) * offsetZ;
                const rz = tp.z + -Math.sin(angle) * offsetX + Math.cos(angle) * offsetZ;
                // Cast from inside the bottom of the capsule downward
                const rayY = tp.y - 0.2 * this.s; 
                const ray = new RAPIER.Ray({ x: rx, y: rayY, z: rz }, { x: 0, y: -1, z: 0 });
                const hit = physics.world.castRay(ray, 1.5 * this.s, false);
                return hit ? (rayY - hit.toi) : (tp.y - this.footOffset);
            };

            // IK Solver
            const solveIK = (sweepZ, liftY, baseHipY, targetGroundY) => {
                let dy = (targetGroundY + liftY) - baseHipY; 
                let dz = sweepZ;
                let dist = Math.sqrt(dy*dy + dz*dz);
                
                // Anti-hyperextension limits
                const maxD = L1 + L2 - 0.001;
                if (dist > maxD) {
                    dy *= maxD / dist;
                    dz *= maxD / dist;
                    dist = maxD;
                }
                
                const interiorKnee = Math.acos((L1*L1 + L2*L2 - dist*dist) / (2 * L1 * L2));
                const angleKnee = Math.PI - interiorKnee;
                const theta = Math.atan2(dz, -dy);
                const alpha = Math.acos((L1*L1 + dist*dist - L2*L2) / (2 * L1 * dist));
                const angleHip = theta + alpha;
                
                // Base IK ankle (Keeps flat to ground)
                const angleAnk = angleKnee - angleHip; 
                
                return { h: angleHip, k: angleKnee, a: angleAnk };
            };

            const hipBaseY = tp.y - this.footOffset + 0.8 * this.s; 
            
            // Apply Biomechanical Ankle Rolling (Heel-Strike / Toe-Off)
            // Cosine of phase: +1 at 0 (Toe-Off, toe points down), -1 at PI (Heel-Strike, toe points up)
            const ankleRollL = Math.cos(pL) * 0.4;
            const ankleRollR = Math.cos(pR) * 0.4;

            const groundL = getGroundY(0.15 * this.s, sweepL);
            const ikL = solveIK(sweepL, liftL, hipBaseY, groundL);
            hipL = ikL.h; kneeL = ikL.k; ankL = ikL.a + ankleRollL;

            const groundR = getGroundY(-0.15 * this.s, sweepR);
            const ikR = solveIK(sweepR, liftR, hipBaseY, groundR);
            hipR = ikR.h; kneeR = ikR.k; ankR = ikR.a + ankleRollR;
            
            // ── AI REINFORCEMENT LEARNING SIMULATION NOISE ──
            // Scrambles the perfect IK math to physically model a struggling neural network in early epochs
            if (expertise < 1.0) {
                const chaos = (1.0 - expertise);
                const nL = (Math.sin(t * 15) * Math.cos(t * 22) + Math.sin(t * 8)) * chaos;
                const nR = (Math.cos(t * 14) * Math.sin(t * 23) + Math.cos(t * 7)) * chaos;

                hipL += nL * 0.7;   hipR += nR * 0.7;
                kneeL -= Math.abs(nL) * 1.5; kneeR -= Math.abs(nR) * 1.5; // Knees buckle unpredictably
                ankL += nL * 0.5;   ankR += nR * 0.5;
            }
            
        } else {
            // Fallback to basic biomimetic FK
            hipL = sweepL + liftL * 0.2; hipR = sweepR + liftR * 0.2;
            kneeL = liftL * 2.0 + Math.abs(sweepL * 0.2); kneeR = liftR * 2.0 + Math.abs(sweepR * 0.2);
            ankL = -sweepL * 0.5 + liftL * 0.3; ankR = -sweepR * 0.5 + liftR * 0.3;
        }

        // Arms swing anti-phase to legs (Yaw/Pitch)
        const armL = -sweepL * 1.2;
        const armR = -sweepR * 1.2;
        // Elbows bend more when arm swings forward
        const ebowL = 0.2 + Math.abs(sweepL) * 0.5 + (sweepL < 0 ? 0.3 : 0);
        const ebowR = 0.2 + Math.abs(sweepR) * 0.5 + (sweepR < 0 ? 0.3 : 0);

        // Advanced Body Dynamics (Bob, Sway, Twist)
        if (this.torsoGroup && this.rootGroup) {
            // Inverted Pendulum CoM Bob:
            // Pelvis drops lowest during double support (t = 0, PI)
            // Pelvis rises highest to vault over the stance leg during mid-stance (t = PI/2, 3PI/2)
            const bob = speed > 0 ? Math.abs(Math.sin(t)) * 0.08 * this.s : 0;
            this.torsoGroup.position.y = (0.90 * this.s) + bob;
            
            // Lateral Sway (ZMP Compensation - shifting weight over planted foot)
            const sway = speed > 0 ? Math.sin(t) * 0.05 * this.s : 0;
            this.torsoGroup.position.x = sway;

            // Spine twist (Upper body compensates for leg forward momentum)
            this.torsoGroup.rotation.y = speed > 0 ? -Math.cos(t) * 0.15 : 0;
            
            // Hip yaw (Pelvis twists with forward swing leg)
            this.rootGroup.rotation.y = speed > 0 ? Math.cos(t) * 0.25 : 0;
            
            // Struggle tilt for AI Training mode
            if (expertise < 1.0) {
                const chaos = (1.0 - expertise);
                this.torsoGroup.position.x += Math.sin(t * 11.4) * chaos * 0.3 * this.s;
                this.torsoGroup.rotation.z = Math.cos(t * 9.2) * chaos * 0.6; // Wobbly spine
                this.torsoGroup.rotation.x = Math.sin(t * 13.1) * chaos * 0.4;
            } else {
                this.torsoGroup.rotation.z = 0;
                this.torsoGroup.rotation.x = 0;
            }
        }

        // ── Physics Multi-Body Synchronization ──
        this._syncVisualsToPhysics();
        this._applyActiveBalance();
        this._applyJointMotors(hipL, kneeL, ankL, hipR, kneeR, ankR, armL, armR, ebowL, ebowR);
    }

    _syncVisualsToPhysics() {
        const pelvis = this._getBody('pelvis');
        if (pelvis) {
            const t = pelvis.translation();
            this.group.position.set(t.x, t.y - (0.1 * this.s), t.z);
        }
    }

    _applyActiveBalance() {
        // Get a fresh reference — never store it between frames
        const pelvis = this._getBody('pelvis');
        if (!pelvis) return;

        const rot = pelvis.rotation();
        const upright = new THREE.Vector3(0, 1, 0);
        const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
        const error = new THREE.Vector3().crossVectors(currentUp, upright);
        const angVel = pelvis.angvel();

        pelvis.applyTorqueImpulse({
            x: error.x * 400.0 - angVel.x * 40.0,
            y: error.y * 400.0 - angVel.y * 40.0,
            z: error.z * 400.0 - angVel.z * 40.0
        }, true);

        const tp = pelvis.translation();
        const vel = pelvis.linvel();
        const hError = (0.9 * this.s) - tp.y;
        const upwardForce = Math.max(0, hError * 1500.0 - vel.y * 150.0);
        pelvis.applyImpulse({ x: 0, y: upwardForce * 0.016, z: 0 }, true);
    }

    _applyJointMotors(hL, kL, aL, hR, kR, aR, arL, arR, ebL, ebR) {
        const world = physics.world;
        if (!world) return;
        const j = this.joints;
        // Use optional chaining on a one-liner — avoids storing any joint reference as a variable
        // Each expression completes (and the WASM handle is NOT stored) before the next line runs
        const motors = [
            [j.hipLeft,      hL,   120, 12], [j.hipRight,      hR,   120, 12],
            [j.kneeLeft,    -kL,   100, 10], [j.kneeRight,    -kR,   100, 10],
            [j.ankleLeft,    aL,    80,  8], [j.ankleRight,    aR,    80,  8],
            [j.shoulderLeft, arL,   60,  6], [j.shoulderRight, arR,   60,  6],
            [j.elbowLeft,    ebL,   40,  4], [j.elbowRight,    ebR,   40,  4],
        ];
        for (const [handle, pos, stiff, damp] of motors) {
            if (handle == null) continue;
            world.getImpulseJoint(handle)?.configureMotorPosition(pos, stiff, damp);
        }
    }
}
