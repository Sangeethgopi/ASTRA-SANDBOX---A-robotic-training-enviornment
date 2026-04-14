import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const componentSpecs = {
    'Waist & Pelvis': { cost: '~$7.8k (14.2%)', desc: '6 rotatry actuators:\n- 6 frameless torque motors\n- 6 harmonic reducers\n- 12 angular contact bearings\nIncludes Battery Pack (2.3KWh, 52v)' },
    'Head': { cost: '~$2.1k (3.8%)', desc: 'FSD + Chips + Cameras + Sensors' },
    'Upper Arm': { cost: '~$1.1k (2.0%)', desc: '2 linear actuators:\n- 2 frameless torque motors\n- 2 ball screws\n- 2 4-point contact bearings' },
    'Forearm': { cost: '~$2.2k (3.9%)', desc: '4 linear actuators:\n- 4 frameless torque motors\n- 4 ball screws\n- 4 encoders' },
    'Hands': { cost: '~$9.5k (17.2%)', desc: '12 actuators:\n- 12 coreless motors\n- 12 planetary reducers\n- 2 6D force sensors' },
    'Thigh': { cost: '~$7.3k (13.2%)', desc: '4 linear actuators:\n- 4 planetary roller screws\n- 4 frameless torque motors' },
    'Calf': { cost: '~$7.3k (13.2%)', desc: '4 linear actuators:\n- 4 planetary roller screws\n- 4 4-point contact bearings' },
    'Feet': { cost: '~$6.7k (12.2%)', desc: '2 6D force sensors' }
};

export class InteractionManager {
    constructor(scene, camera, domElement, orbitControls) {
        this.scene = scene;
        this.camera = camera;
        this.domElement = domElement;
        this.orbitControls = orbitControls;
        
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        
        // Track physics mapping: mesh.uuid -> Rapier Handle (integer)
        // Storing handles instead of objects prevents recursive borrow panics
        this.physicsMap = new Map();
        
        this.setupTransformControls();
        this.setupEvents();
    }

    setupTransformControls() {
        this.transformControl = new TransformControls(this.camera, this.domElement);
        
        // Disable orbit while dragging
        this.transformControl.addEventListener('dragging-changed', (event) => {
            this.orbitControls.enabled = !event.value;
            if (!event.value) {
                // Drag ended: wake/reset the physics body via handle
                const attached = this.transformControl.object;
                if (!attached) return;

                const handle = attached._humanoid ? attached._humanoid.physicsBodyHandle : this.physicsMap.get(attached.uuid);
                
                if (handle !== null && handle !== undefined) {
                    physics.safe(() => {
                        const body = physics.world.getRigidBody(handle);
                        if (body && body.isDynamic()) {
                            body.wakeUp();
                            body.setLinvel({ x: 0, y: 0, z: 0 }, true);
                            body.setAngvel({ x: 0, y: 0, z: 0 }, true);
                        }
                    });
                }
            }
        });

        // While dragging, sync group position back to physics capsule
        this.transformControl.addEventListener('change', () => {
            const attached = this.transformControl.object;
            if (!attached) return;

            const handle = attached._humanoid ? attached._humanoid.physicsBodyHandle : this.physicsMap.get(attached.uuid);
            if (handle === null || handle === undefined) return;

            physics.safe(() => {
                const body = physics.world.getRigidBody(handle);
                if (body && body.isDynamic()) {
                    const pos = attached.position;
                    const rot = attached.quaternion;
                    
                    if (attached._humanoid) {
                        // Robot capsule: move it to match group drag
                        body.setTranslation({
                            x: pos.x,
                            y: pos.y + attached._humanoid.footOffset,
                            z: pos.z
                        }, true);
                    } else {
                        // Simple physics object
                        body.setTranslation({ x: pos.x, y: pos.y, z: pos.z }, true);
                        body.setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }, true);
                    }
                }
            });
        });

        this.scene.add(this.transformControl);
    }

    setupEvents() {
        this.domElement.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) return;
            // Don't handle clicks on UI overlays
            if (event.target !== this.domElement) return;
            
            const rect = this.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);

            // ── Recursive raycast across entire scene ───────────
            const intersects = this.raycaster.intersectObjects(this.scene.children, true);

            let hitHumanoid = null;
            let hitObj = null;
            let visualObj = null;

            // Iterate through hits to find the first interactive object (skip terrain/grid)
            for (let i = 0; i < intersects.length; i++) {
                const obj = intersects[i].object;
                
                if (!hitHumanoid) {
                    hitHumanoid = this._findHumanoidParent(obj);
                }
                
                // Track the actual visual part clicked (not the invisible giant hitbox)
                if (hitHumanoid && !visualObj && obj.name !== '__hitbox__') {
                    visualObj = obj;
                }
                
                if (!hitHumanoid && this.physicsMap.has(obj.uuid)) {
                    hitObj = obj;
                    break;
                }
            }

            if (hitHumanoid) {
                hitObj = visualObj || hitHumanoid.hitbox;
            }

            if (hitObj) {
                if (hitHumanoid) {
                    // Attach gizmo to robot group
                    hitHumanoid.group._humanoid = hitHumanoid;
                    this.transformControl.attach(hitHumanoid.group);
                    if (this.onSelectCallback) this.onSelectCallback(hitHumanoid);

                    // Show component inspector for the clicked part
                    const specsPanel = document.getElementById('specs-panel');
                    if (specsPanel && hitObj.name && componentSpecs[hitObj.name]) {
                        const specs = componentSpecs[hitObj.name];
                        document.getElementById('specs-title').innerText = hitObj.name;
                        document.getElementById('specs-cost').innerText = 'Cost: ' + specs.cost;
                        document.getElementById('specs-desc').innerText = specs.desc;
                        specsPanel.classList.remove('hidden');

                        // Bind Paint Modifier
                        const colorInput = document.getElementById('specs-color');
                        if (colorInput) {
                            colorInput.oninput = (e) => {
                                const hex = parseInt(e.target.value.replace('#', ''), 16);
                                if (hitObj.material) {
                                    if (!hitObj.material.isClonedForMod) {
                                        hitObj.material = hitObj.material.clone();
                                        hitObj.material.isClonedForMod = true;
                                    }
                                    hitObj.material.color.setHex(hex);
                                    if (hitObj.material.emissive) hitObj.material.emissive.setHex(hex);
                                }
                            };
                        }
                    } else if (specsPanel) {
                        specsPanel.classList.add('hidden');
                    }
                } else {
                    // Clicked physics object
                    this.transformControl.attach(hitObj);
                }
            } else {
                this.transformControl.detach();
                const specsPanel = document.getElementById('specs-panel');
                if (specsPanel) specsPanel.classList.add('hidden');
                if (this.onSelectCallback) this.onSelectCallback(null);
            }
        });
    }

    // Walk up parent chain to find a group tagged with _humanoidRef
    _findHumanoidParent(obj) {
        let current = obj;
        while (current) {
            if (current._humanoidRef) return current._humanoidRef;
            current = current.parent;
        }
        return null;
    }

    // Set callback: called with the humanoid instance (or null to deselect)
    onSelect(callback) {
        this.onSelectCallback = callback;
    }

    // Register all parts of a humanoid for interaction
    registerHumanoid(humanoid) {
        if (!humanoid || !humanoid.parts) return;
        if (!this.meshToHumanoidMap) this.meshToHumanoidMap = new Map();
        
        // Store handle, not the live body object
        const handle = humanoid.physicsBodyHandle;
        for (const part of Object.values(humanoid.parts)) {
            if (part.mesh) {
                this.physicsMap.set(part.mesh.uuid, handle);
                this.meshToHumanoidMap.set(part.mesh.uuid, humanoid);
            }
        }
    }

    // Register a Mesh and its Rapier Handle
    registerObject(mesh, handle) {
        if (!mesh || handle === undefined) return;
        this.physicsMap.set(mesh.uuid, handle);
    }

    // Unregister object (useful for object deletion later)
    unregisterObject(mesh) {
        if (!mesh) return;
        this.physicsMap.delete(mesh.uuid);
        if (this.meshToHumanoidMap) this.meshToHumanoidMap.delete(mesh.uuid);
        if (this.transformControl.object === mesh) {
            this.transformControl.detach();
        }
    }
}
