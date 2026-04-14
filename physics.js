import RAPIER from '@dimforge/rapier3d';

export class PhysicsWorld {
    constructor() {
        this.world = null;
        this.eventQueue = null;
        this.gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.ready = false;
        this.envType = 'Earth'; // Earth, Water
        this.dynamicBodies = []; // Track dynamic bodies for buoyancy/damping
    }

    async init() {
        // Rapier compat mode requires initialization
        await RAPIER.init();
        this.world = new RAPIER.World(this.gravity);
        this.world.timestep = 1.0 / 60.0; // Fixed 60Hz for physics
        this.eventQueue = new RAPIER.EventQueue(true);
        this.ready = true;
        console.log("🚀 Physics Engine Ready");
        return this.world;
    }

    step() {
        if (!this.world) return;
        
        // Special Pre-Step Physics (Buoyancy)
        if (this.envType === 'Water') {
            const waterLevel = 5.0; // Simulate water surface at Y=5
            const waterDensity = 1.0; 
            const gravityMag = Math.abs(this.gravity.y);
            
            for(let body of this.dynamicBodies) {
                if (body && body.isDynamic()) {
                    const pos = body.translation();
                    if (pos.y < waterLevel) {
                        // Simple Buoyancy: Upward force proportional to depth (approximate)
                        // F_b = density * volume * g
                        // Assuming volume 1 for simplicity of tracked dynamic bodies
                        const buoyantForce = waterDensity * gravityMag * 1.5; 
                        
                        // Apply upward impulse every frame
                        body.applyImpulse({ x: 0, y: buoyantForce * 0.016, z: 0 }, true);
                    }
                }
            }
        }

        this.world.step(this.eventQueue);
    }

    createGround(width, depth) {
        const bodyDesc = RAPIER.RigidBodyDesc.fixed()
            .setTranslation(0, -0.1, 0);
        const body = this.world.createRigidBody(bodyDesc);
        
        const colliderDesc = RAPIER.ColliderDesc.cuboid(width / 2, 0.1, depth / 2);
        this.world.createCollider(colliderDesc, body);
        
        return body;
    }

    createBox(x, y, z, size = 1) {
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
            .setTranslation(x, y, z);
        
        if (this.envType === 'Water') {
            bodyDesc.setLinearDamping(5.0).setAngularDamping(5.0);
        }

        const body = this.world.createRigidBody(bodyDesc);
        
        const colliderDesc = RAPIER.ColliderDesc.cuboid(size/2, size/2, size/2)
            .setMass(1.0)
            .setRestitution(0.5);
        this.world.createCollider(colliderDesc, body);
        
        // Enable CCD for fast-moving objects
        body.enableCcd(true);
        
        // Track for environment effects
        this.trackBody(body);
        
        return body;
    }

    trackBody(body) {
        if (body && !this.dynamicBodies.includes(body)) {
            this.dynamicBodies.push(body);
        }
    }

    setEnvironmentType(type) {
        this.envType = type;
        
        let targetGravity = -9.81;
        let damping = 0.0;

        if (type === 'Water') {
            targetGravity = -9.81;
            damping = 5.0; // High drag in water
        } else {
            // Earth
            targetGravity = -9.81;
            damping = 0.0;
        }

        this.gravity.y = targetGravity;
        if (this.world) {
            this.world.gravity = this.gravity;
        }

        // Apply damping dynamically to all tracked bodies
        for(let body of this.dynamicBodies) {
            if (body && body.isDynamic()) {
                body.setLinearDamping(damping);
                body.setAngularDamping(damping);
            }
        }
    }
}

/**
 * Helper to build a motorized revolute joint with limits
 */
export function createMotorizedJoint(world, bodyA, bodyB, anchorA, anchorB, axis, limits = null) {
    let params = RAPIER.JointData.revolute(anchorA, anchorB, axis);
    if (limits) {
        params.limitsEnabled = true;
        params.limits = limits;
    }
    
    const joint = world.createJoint(params, bodyA, bodyB);
    
    // Joint motors are configured on actual joint instance (revolute specific)
    joint.configureMotorPosition(0.0, 100.0, 10.0); // (targetPos, stiffness, damping)
    
    return joint;
}

export const physics = new PhysicsWorld();
