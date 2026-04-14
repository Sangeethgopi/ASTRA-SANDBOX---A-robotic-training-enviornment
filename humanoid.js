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
        this.joints = {}; // Kept for joint motor references
        this.physicsBodies = {}; // Multi-body tracking
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
        
        physics.trackBody(this.physicsBody);

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
        const t = this.physicsBody.translation();
        this.group.position.set(t.x, t.y - (0.8 * this.s), t.z);
    }

    _buildPhysicsBodies(x, z, spec) {
        const s = this.s;
        const world = physics.world;

        // --- 1. PELVIS (Root) ---
        const pelvisDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, 1.0 * s, z)
            .setLinearDamping(0.5)
            .setAngularDamping(2.0); // Slightly resisted to help stability
        this.physicsBody = world.createRigidBody(pelvisDesc); // Principal body
        this.physicsBodies.pelvis = this.physicsBody;
        
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.15*s, 0.1*s, 0.1*s).setMass(20 * spec.massMult),
            this.physicsBodies.pelvis
        );

        // --- 2. TORSO ---
        const torsoDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, 1.3 * s, z);
        this.physicsBodies.torso = world.createRigidBody(torsoDesc);
        world.createCollider(
            RAPIER.ColliderDesc.cuboid(0.18*s, 0.2*s, 0.12*s).setMass(30 * spec.massMult),
            this.physicsBodies.torso
        );

        // --- 3. LEGS ---
        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.12 * s : -0.12 * s;
            
            // Thigh
            const thighDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x + sx, 0.7 * s, z);
            const thigh = world.createRigidBody(thighDesc);
            world.createCollider(RAPIER.ColliderDesc.capsule(0.18 * s, 0.06 * s).setMass(8), thigh);
            this.physicsBodies[`thigh${side}`] = thigh;

            // Calf
            const calfDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x + sx, 0.3 * s, z);
            const calf = world.createRigidBody(calfDesc);
            world.createCollider(RAPIER.ColliderDesc.capsule(0.18 * s, 0.05 * s).setMass(5), calf);
            this.physicsBodies[`calf${side}`] = calf;

            // Foot
            const footDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x + sx, 0.05 * s, z + 0.05 * s);
            const foot = world.createRigidBody(footDesc);
            world.createCollider(RAPIER.ColliderDesc.cuboid(0.06*s, 0.03*s, 0.12*s).setMass(2).setFriction(2.0).setRestitution(0.1), foot);
            this.physicsBodies[`foot${side}`] = foot;
            foot.enableCcd(true); // Feet need CCD to prevent clipping
        }
        
        // --- 4. ARMS ---
        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.25 * s : -0.25 * s;
            
            // Upper Arm
            const uArmDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x + sx, 1.3 * s, z);
            const uArm = world.createRigidBody(uArmDesc);
            world.createCollider(RAPIER.ColliderDesc.capsule(0.1 * s, 0.04 * s).setMass(3), uArm);
            this.physicsBodies[`upperArm${side}`] = uArm;

            // Forearm
            const fArmDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x + sx, 1.1 * s, z);
            const fArm = world.createRigidBody(fArmDesc);
            world.createCollider(RAPIER.ColliderDesc.capsule(0.1 * s, 0.03 * s).setMass(2), fArm);
            this.physicsBodies[`foreArm${side}`] = fArm;
        }

        // --- 5. HEAD ---
        if (!spec.noHead) {
            const headDesc = RAPIER.RigidBodyDesc.dynamic()
                .setTranslation(x, 1.6 * s, z);
            const head = world.createRigidBody(headDesc);
            world.createCollider(RAPIER.ColliderDesc.cuboid(0.1*s, 0.1*s, 0.1*s).setMass(4), head);
            this.physicsBodies.head = head;
        }
    }

    _buildPhysicsJoints() {
        const s = this.s;
        const world = physics.world;
        const b = this.physicsBodies;

        // 1. Pelvis <-> Torso (Waist Joint)
        this.joints.waist = createMotorizedJoint(world, b.pelvis, b.torso, 
            {x:0, y:0.1*s, z:0}, {x:0, y:-0.2*s, z:0}, {x:0, y:1, z:0});

        // 2. Legs
        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.12 * s : -0.12 * s;
            
            // Pelvis <-> Thigh (Hip)
            this.joints[`hip${side}`] = createMotorizedJoint(world, b.pelvis, b[`thigh${side}`], 
                {x:sx, y:-0.05*s, z:0}, {x:0, y:0.2*s, z:0}, {x:1, y:0, z:0}); // Pitch axis

            // Thigh <-> Calf (Knee)
            this.joints[`knee${side}`] = createMotorizedJoint(world, b[`thigh${side}`], b[`calf${side}`], 
                {x:0, y:-0.2*s, z:0}, {x:0, y:0.2*s, z:0}, {x:1, y:0, z:0});

            // Calf <-> Foot (Ankle)
            this.joints[`ankle${side}`] = createMotorizedJoint(world, b[`calf${side}`], b[`foot${side}`], 
                {x:0, y:-0.2*s, z:0}, {x:0, y:0.03*s, z:-0.05*s}, {x:1, y:0, z:0});
        }

        // 3. Arms
        for (const side of ['Left', 'Right']) {
            const sx = side === 'Left' ? 0.25 * s : -0.25 * s;
            
            // Torso <-> Upper Arm (Shoulder)
            this.joints[`shoulder${side}`] = createMotorizedJoint(world, b.torso, b[`upperArm${side}`], 
                {x:sx, y:0.1*s, z:0}, {x:0, y:0.1*s, z:0}, {x:1, y:0, z:0});

            // Upper Arm <-> Forearm (Elbow)
            this.joints[`elbow${side}`] = createMotorizedJoint(world, b[`upperArm${side}`], b[`foreArm${side}`], 
                {x:0, y:-0.1*s, z:0}, {x:0, y:0.1*s, z:0}, {x:1, y:0, z:0});
        }

        // 4. Torso <-> Head (Neck)
        if (b.head) {
            this.joints.neck = createMotorizedJoint(world, b.torso, b.head, 
                {x:0, y:0.25*s, z:0}, {x:0, y:-0.1*s, z:0}, {x:1, y:0, z:0});
        }
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
        if (!this.physicsBody || this.isJumping) return;
        const mass = this.physicsBody.mass();
        this.physicsBody.applyImpulse({ x: 0, y: mass * 7.5, z: 0 }, true);
        this.isJumping = true;
        this.jumpCooldown = 1.0; // Seconds until next jump allowed
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
        if (this.physicsBody) {
            const tp = this.physicsBody.translation();
            const vel = this.physicsBody.linvel();
            const moving = this.moveDir.x !== 0 || this.moveDir.z !== 0 || this.moveDir.y !== 0;

            // Abyss Recovery: Teleport back if fallen into the void
            if (tp.y < -2.0) {
                this.physicsBody.setTranslation({ x: 0, y: 3, z: -2 }, true);
                this.physicsBody.setLinvel({ x: 0, y: 0, z: 0 }, true);
                this.broadcastExperience("Critical Recovery: Ground breach prevented.");
                return; 
            }

            // Sync visual group — offset = where capsule rests above ground
            this.group.position.set(tp.x, tp.y - this.footOffset, tp.z);

            // --- GAIT-SYNCED LOCOMOTION (TAKINE EACH STEP) ---
            const gaitSync = speed > 0 ? 0.8 + Math.abs(Math.sin(this.time)) * 0.4 : 1.0;
            const targetSpd = speed > 0 ? speed * 1.1 * gaitSync : 3.0; 

            if (moving) {
                // ... rest of moving logic ...
                const allowY = physics.world && Math.abs(physics.world.gravity.y) < 1.0;
                
                this.physicsBody.setLinvel({
                    x: this.moveDir.x * targetSpd,
                    y: (allowY && this.moveDir.y !== 0) ? this.moveDir.y * targetSpd : vel.y,
                    z: this.moveDir.z * targetSpd
                }, true);

                // --- OBSTACLE DETECTION & LEARNING ---
                if (speed > 0 && !this.isJumping && this.jumpCooldown <= 0) {
                    // 1. Proactive Raycast Detection (Immediate response)
                    const ray = new RAPIER.Ray(
                        { x: tp.x, y: tp.y + 0.5 * this.s, z: tp.z },
                        { x: this.moveDir.x, y: 0, z: this.moveDir.z }
                    );
                    const hit = physics.world.castRay(ray, 2.0, true);
                    if (hit && hit.toi < 1.8) {
                        this.addExperience(tp.x + this.moveDir.x, tp.z + this.moveDir.z);
                        this.jump();
                    }

                    // 2. Spatial Memory detection (Proactive learning)
                    const memory = this.spatialMap.find(exp => {
                        const dx = exp.x - tp.x;
                        const dz = exp.z - tp.z;
                        const dist = Math.hypot(dx, dz);
                        const dot = dx * this.moveDir.x + dz * this.moveDir.z;
                        return dist < 2.0 && dot > 0.5; // Nearby and ahead
                    });
                    if (memory) {
                        this.broadcastExperience(`Anticipatory jump triggered by spatial memory!`);
                        this.jump();
                    }

                    // 3. Blocked Progress Detection (Failure learning)
                    const horizVel = Math.hypot(vel.x, vel.z);
                    if (horizVel < speed * 0.2) { // Moving too slowly despite intent
                        this.broadcastExperience(`Progress blocked. Real-time learning triggered.`);
                        this.addExperience(tp.x + this.moveDir.x * 0.5, tp.z + this.moveDir.z * 0.5);
                        this.jump();
                    }
                }
            } else {
                // Decelerate (apply drag to X/Z, and to Y if in Space mode)
                const drag = speed > 0 ? 0.8 : 0.6;
                const allowY = physics.world && Math.abs(physics.world.gravity.y) < 1.0;
                this.physicsBody.setLinvel({ 
                    x: vel.x * drag, 
                    y: allowY ? vel.y * 0.9 : vel.y, 
                    z: vel.z * drag 
                }, true);
            }

        // (Removed previous misplaced recovery check)

            // Face direction of horizontal movement
            if (speed > 0 && (this.moveDir.x !== 0 || this.moveDir.z !== 0)) {
                const targetAngle = Math.atan2(this.moveDir.x, this.moveDir.z);
                this.group.rotation.y = THREE.MathUtils.lerp(
                    this.group.rotation.y, targetAngle, Math.min(1, delta * 8));
            }
            
            // Jump state management
            if (this.jumpCooldown > 0) this.jumpCooldown -= delta;
            
            // Apply Horizontal Force for movement (Drive the hip)
            if (moving) {
                const force = 10.0 * this.modelSpec.massMult;
                this.physicsBodies.pelvis.applyImpulse({
                    x: this.moveDir.x * force,
                    y: 0,
                    z: this.moveDir.z * force
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
        const b = this.physicsBodies;
        if (b.pelvis) {
            const t = b.pelvis.translation();
            this.group.position.set(t.x, t.y - (0.1 * this.s), t.z);
        }
    }

    _applyActiveBalance() {
        if (!this.physicsBodies.pelvis) return;
        const pelvis = this.physicsBodies.pelvis;
        const rot = pelvis.rotation();
        
        const upright = new THREE.Vector3(0, 1, 0);
        const currentUp = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w));
        
        const error = new THREE.Vector3().crossVectors(currentUp, upright);
        const angVel = pelvis.angvel();
        
        const torqueP = 400.0;
        const torqueD = 40.0;
        
        pelvis.applyTorqueImpulse({
            x: error.x * torqueP - angVel.x * torqueD,
            y: error.y * torqueP - angVel.y * torqueD,
            z: error.z * torqueP - angVel.z * torqueD
        }, true);

        const targetH = 0.9 * this.s;
        const currentH = pelvis.translation().y;
        const hError = targetH - currentH;
        const vel = pelvis.linvel();
        
        const forceP = 1500.0;
        const forceD = 150.0;
        const upwardForce = Math.max(0, hError * forceP - vel.y * forceD);
        pelvis.applyImpulse({ x: 0, y: upwardForce * 0.016, z: 0 }, true);
    }

    _applyJointMotors(hL, kL, aL, hR, kR, aR, arL, arR, ebL, ebR) {
        const j = this.joints;
        if (j.hipLeft)   j.hipLeft.configureMotorPosition(hL, 120.0, 12.0);
        if (j.hipRight)  j.hipRight.configureMotorPosition(hR, 120.0, 12.0);
        if (j.kneeLeft)  j.kneeLeft.configureMotorPosition(-kL, 100.0, 10.0);
        if (j.kneeRight) j.kneeRight.configureMotorPosition(-kR, 100.0, 10.0);
        if (j.ankleLeft)  j.ankleLeft.configureMotorPosition(aL, 80.0, 8.0);
        if (j.ankleRight) j.ankleRight.configureMotorPosition(aR, 80.0, 8.0);
        if (j.shoulderLeft)  j.shoulderLeft.configureMotorPosition(arL, 60.0, 6.0);
        if (j.shoulderRight) j.shoulderRight.configureMotorPosition(arR, 60.0, 6.0);
        if (j.elbowLeft)     j.elbowLeft.configureMotorPosition(ebL, 40.0, 4.0);
        if (j.elbowRight)    j.elbowRight.configureMotorPosition(ebR, 40.0, 4.0);
    }
}
