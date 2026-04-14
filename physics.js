import RAPIER from '@dimforge/rapier3d';

export class PhysicsWorld {
    constructor() {
        this.world = null;
        this.eventQueue = null;
        this.gravity = { x: 0.0, y: -9.81, z: 0.0 };
        this.ready = false;
        this.envType = 'Earth';
        this.dynamicBodies = []; // Stores handles (integers), NOT live object refs
    }

    async init() {
        await RAPIER.init();
        this.world = new RAPIER.World(this.gravity);
        this.world.timestep = 1.0 / 60.0;
        this.eventQueue = new RAPIER.EventQueue(true);
        this.ready = true;
        console.log("🚀 Physics Engine Ready");
        return this.world;
    }

    step() {
        if (!this.world) return;

        // Buoyancy pre-step (Water mode only)
        if (this.envType === 'Water') {
            const waterLevel = 5.0;
            const waterDensity = 1.0;
            const gravityMag = Math.abs(this.gravity.y);

            for (const handle of this.dynamicBodies) {
                // Get a fresh reference each iteration — never hold across iterations
                const body = this.world.getRigidBody(handle);
                if (body && body.isDynamic()) {
                    const pos = body.translation();
                    if (pos.y < waterLevel) {
                        const buoyantForce = waterDensity * gravityMag * 1.5;
                        body.applyImpulse({ x: 0, y: buoyantForce * 0.016, z: 0 }, true);
                    }
                }
            }
        }

        this.world.step(this.eventQueue);
    }

    createGround(width, depth) {
        const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0);
        const body = this.world.createRigidBody(bodyDesc);
        this.world.createCollider(RAPIER.ColliderDesc.cuboid(width / 2, 0.1, depth / 2), body);
        return body.handle;
    }

    createBox(x, y, z, size = 1) {
        const bodyDesc = RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z);
        if (this.envType === 'Water') {
            bodyDesc.setLinearDamping(5.0).setAngularDamping(5.0);
        }
        const body = this.world.createRigidBody(bodyDesc);
        this.world.createCollider(
            RAPIER.ColliderDesc.cuboid(size/2, size/2, size/2).setMass(1.0).setRestitution(0.5),
            body
        );
        body.enableCcd(true);
        this.trackBody(body.handle);
        return body.handle;
    }

    // Accepts a handle (integer) — never store the live body object
    trackBody(handle) {
        if (handle !== undefined && handle !== null && !this.dynamicBodies.includes(handle)) {
            this.dynamicBodies.push(handle);
        }
    }

    setEnvironmentType(type) {
        this.envType = type;

        let damping = type === 'Water' ? 5.0 : 0.0;
        this.gravity.y = -9.81;
        if (this.world) this.world.gravity = this.gravity;

        // Apply damping via handles — get fresh reference each iteration
        for (const handle of this.dynamicBodies) {
            const body = this.world.getRigidBody(handle);
            if (body && body.isDynamic()) {
                body.setLinearDamping(damping);
                body.setAngularDamping(damping);
            }
        }
    }
}

/**
 * Helper to build a motorized revolute joint with limits.
 * Returns the joint HANDLE (stable integer) — never the live object.
 */
export function createMotorizedJoint(world, bodyA, bodyB, anchorA, anchorB, axis, limits = null) {
    let params = RAPIER.JointData.revolute(anchorA, anchorB, axis);
    if (limits) {
        params.limitsEnabled = true;
        params.limits = limits;
    }

    const joint = world.createImpulseJoint(params, bodyA, bodyB, true);
    const handle = joint.handle;
    joint.configureMotorPosition(0.0, 100.0, 10.0);
    return handle;
}

export const physics = new PhysicsWorld();
