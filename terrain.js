import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d';
import { physics } from 'physics';

export class TerrainGenerator {
    constructor(scene) {
        this.scene = scene;
        
        this.materials = {
            concrete: new THREE.MeshStandardMaterial({ color: '#78909c', roughness: 0.9, metalness: 0.1 }),
            rough:    new THREE.MeshStandardMaterial({ color: '#8d6e63', roughness: 1.0, metalness: 0.0 }),
            sand:     new THREE.MeshStandardMaterial({ color: '#c8b560', roughness: 1.0, metalness: 0.0 }),
            metal:    new THREE.MeshStandardMaterial({ color: '#455a64', roughness: 0.4, metalness: 0.8 }),
            ice:      new THREE.MeshStandardMaterial({ color: '#b3e5fc', roughness: 0.05, metalness: 0.1 }),
        };
    }

    // Helper: add a fixed physics box + visual mesh
    addStaticBlock(x, y, z, w, h, d, material, friction = 0.8) {
        const geo = new THREE.BoxGeometry(w, h, d);
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.set(x, y, z);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z);
        const body = physics.world.createRigidBody(bodyDesc);
        const col = RAPIER.ColliderDesc.cuboid(w/2, h/2, d/2).setFriction(friction);
        physics.world.createCollider(col, body);
    }

    // Add a floating zone label
    addZoneLabel(text, x, y, z, color = '#00f2ff') {
        const canvas = document.createElement('canvas');
        canvas.width = 512; canvas.height = 80;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(0, 0, 512, 80);
        ctx.fillStyle = color;
        ctx.font = 'bold 36px Inter, Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 40);

        const tex = new THREE.CanvasTexture(canvas);
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
        sprite.position.set(x, y, z);
        sprite.scale.set(5, 0.8, 1);
        this.scene.add(sprite);
    }

    // Zone 1: Flat concrete starting platform
    createFlatZone(x, z) {
        this.addStaticBlock(x, -0.85, z, 14, 1.0, 14, this.materials.concrete, 1.0);
        this.addZoneLabel('ZONE 1 — START', x, 1.5, z - 5, '#00f2ff');
    }

    // Zone 2: Rough rocky terrain
    createRoughZone(sx, z) {
        for (let i = 0; i < 16; i++) {
            for (let j = 0; j < 6; j++) {
                const bh = 0.15 + Math.random() * 0.5;
                const px = sx + i * 0.85 - 0.5;
                const pz = z + j * 0.85 - 2.5;
                this.addStaticBlock(px, bh / 2, pz, 0.8, bh, 0.8, this.materials.rough, 1.2);
            }
        }
        this.addZoneLabel('ZONE 2 — ROUGH TERRAIN', sx + 6, 2.5, z - 2.5, '#ff9800');
    }

    // Zone 3: Staircase ascent
    createStairZone(x, z) {
        const steps = 8, sw = 6, sh = 0.25, sd = 0.7;
        for (let i = 0; i < steps; i++) {
            this.addStaticBlock(x, (i + 0.5) * sh, z + i * sd, sw, sh * (i + 1), sd, this.materials.concrete, 0.9);
        }
        // Flat landing at top
        this.addStaticBlock(x, steps * sh + 0.15, z + steps * sd + 0.5, sw, 0.3, 2, this.materials.concrete, 0.9);
        // Descend
        for (let i = 0; i < steps; i++) {
            const ri = steps - 1 - i;
            this.addStaticBlock(x, (ri + 0.5) * sh, z + steps * sd + 2.5 + i * sd, sw, sh * (ri + 1), sd, this.materials.concrete, 0.9);
        }
        this.addZoneLabel('ZONE 3 — STAIRS', x, steps * sh + 2.0, z + steps * sd + 0.5, '#8bc34a');
    }

    // Zone 4: Low-friction ice / slippery floor
    createIceZone(x, z) {
        this.addStaticBlock(x, -0.95, z, 14, 1.0, 14, this.materials.ice, 0.05); // Near-zero friction!
        this.addZoneLabel('ZONE 4 — ICE (Low Friction)', x, 1.5, z - 5, '#b3e5fc');
    }

    // Zone 5: Metal grate stepping stones (gaps between them)
    createGapZone(x, z) {
        const stones = 10;
        for (let i = 0; i < stones; i++) {
            const gap = 0.55 + Math.random() * 0.3;
            const pz = z + i * (1.0 + gap);
            this.addStaticBlock(x, -0.7, pz, 6, 1.0, 1.0, this.materials.metal, 0.8);
        }
        this.addZoneLabel('ZONE 5 — GAPS', x, 1.8, z + stones / 2, '#e91e63');
    }

    // Build the full traversal course along the -Z axis
    buildTraversalCourse() {
        // Flat start
        this.createFlatZone(0, 7);

        // Rough terrain
        this.createRoughZone(-6.5, -10);

        // Stairs up and down
        this.createStairZone(0, -25);

        // Ice zone
        this.createIceZone(0, -52);

        // Stepping stone gaps
        this.createGapZone(0, -72);

        // Finish platform
        this.addStaticBlock(0, -0.15, -98, 14, 0.3, 10, this.materials.concrete, 1.0);
        this.addZoneLabel('🏁 FINISH', 0, 1.5, -100, '#ffeb3b');
    }

    // Legacy methods kept for compatibility
    createStairs(x, y, z, params = {}) {
        const { steps = 10, stepWidth = 4, stepHeight = 0.2, stepDepth = 0.5, direction = 1 } = params;
        for (let i = 0; i < steps; i++) {
            const currentY = y + i * stepHeight + stepHeight / 2;
            const currentZ = z + i * stepDepth * direction;
            this.addStaticBlock(x, currentY, currentZ, stepWidth, stepHeight, stepDepth, this.materials.concrete, 1.0);
        }
    }

    createRoughTerrainField(x, y, z, params = {}) {
        const { gridSizeX = 10, gridSizeZ = 10, blockSize = 0.5, heightVariance = 0.2 } = params;
        for (let i = 0; i < gridSizeX; i++) {
            for (let j = 0; j < gridSizeZ; j++) {
                const heightOffset = (Math.random() - 0.5) * heightVariance;
                const blockHeight = blockSize + Math.abs(heightOffset);
                const px = x + (i - gridSizeX/2) * blockSize + blockSize/2;
                const pz = z + (j - gridSizeZ/2) * blockSize + blockSize/2;
                const py = y + blockHeight / 2 + heightOffset;
                this.addStaticBlock(px, py, pz, blockSize, blockHeight, blockSize, this.materials.rough, 0.8);
            }
        }
    }
}
