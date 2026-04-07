import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Pane } from 'tweakpane';
import { physics } from 'physics';
import { Environment } from 'environment';
import { Humanoid } from 'humanoid';
import { InteractionManager } from 'interaction';
import { TerrainGenerator } from 'terrain';
import { RobotBrain } from 'ai_brain';

class App {
    constructor() {
        this.canvas = document.getElementById('canvas-webgl');
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setClearColor(0x000000, 1);
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
        this.camera.position.set(12, 8, 12);

        this.orbitControls = new OrbitControls(this.camera, this.canvas);
        this.orbitControls.enableDamping = true;
        this.orbitControls.dampingFactor = 0.05;
        this.orbitControls.target.set(0, 1, 0);

        this.clock = new THREE.Clock();
        this.robots = [];
        this.selectedRobot = null;

        // GUI Parameters
        this.params = {
            worldType: 'Earth',
            theme: 'Light',
            spawnModel: 'Optimus'
        };

        this.init();
    }

    async init() {
        this.updateLoading(10);
        
        // Initialize Physics
        await physics.init();
        this.updateLoading(30);

        // Initialize Environment
        this.environment = new Environment(this.scene);
        this.updateLoading(50);

        // Initialize Terrain
        this.terrain = new TerrainGenerator(this.scene);
        this.terrain.buildTraversalCourse();
        this.updateLoading(70);

        // Initialize Interaction
        this.interaction = new InteractionManager(this.scene, this.camera, this.canvas, this.orbitControls);
        this.interaction.onSelect((robot) => {
            if (this.selectedRobot) this.selectedRobot.setSelected(false);
            this.selectedRobot = robot;
            if (robot) {
                robot.setSelected(true);
                document.getElementById('selected-robot-label').innerText = robot.modelSpec.label;
            } else {
                document.getElementById('selected-robot-label').innerText = 'No Robot Selected';
            }
        });
        this.updateLoading(85);

        // Initialize AI Brain
        this.brain = new RobotBrain((cmd) => {
            const targets = this.selectedRobot ? [this.selectedRobot] : this.robots;
            targets.forEach(robot => {
                if (cmd.speed !== null) robot.gaitParams.speed = cmd.speed;
                if (cmd.direction) {
                    let dx = 0, dz = 0;
                    if (cmd.direction === 'forward') dz = -1;
                    if (cmd.direction === 'backward') dz = 1;
                    if (cmd.direction === 'left') dx = -1;
                    if (cmd.direction === 'right') dx = 1;
                    if (cmd.direction === 'stop') { dx = 0; dz = 0; robot.gaitParams.speed = 0; }
                    robot.setMoveDirection(dx, dz);
                }
                if (cmd.pose === 'jump') robot.jump();
            });
        });

        // Initialize GUI
        this.initGUI();

        // UI Event Listeners
        document.getElementById('btn-spawn-humanoid').addEventListener('click', () => this.spawnRobot());
        document.getElementById('btn-toggle-theme').addEventListener('click', () => {
            const nextTheme = this.environment.currentTheme === 'Light' ? 'Dark' : 'Light';
            this.environment.setTheme(nextTheme);
            this.params.theme = nextTheme;
            this.gui.refresh();
        });

        // Handle Resize
        window.addEventListener('resize', () => this.onResize());

        this.updateLoading(100);

        // Start Loop
        this.animate();

        // Hide Loader
        setTimeout(() => {
            const loader = document.getElementById('loader-wrapper');
            if (loader) {
                loader.style.opacity = '0';
                setTimeout(() => loader.style.display = 'none', 800);
            }
        }, 500);

        document.getElementById('physics-status').innerText = 'Physics: Active';
        
        // Spawn initial robot
        this.spawnRobot();
    }

    initGUI() {
        this.gui = new Pane({
            container: document.getElementById('gui-container'),
            title: 'ASTRA SIMULATOR CONTROLS',
            expanded: true
        });

        const worldFolder = this.gui.addFolder({ title: 'Environment & Physics' });
        
        worldFolder.addBinding(this.params, 'worldType', {
            label: 'World Type',
            options: { Earth: 'Earth', Water: 'Water' }
        }).on('change', (ev) => {
            this.environment.setWorldType(ev.value);
            physics.setEnvironmentType(ev.value);
            
            // In space/water, we might want to adjust fog/ambient if theme allows
            if (ev.value !== 'Earth') {
                this.environment.setWorldType(ev.value);
            } else {
                this.environment.setTheme(this.params.theme);
            }
        });

        worldFolder.addBinding(this.params, 'theme', {
            label: 'Visual Theme',
            options: { Light: 'Light', Dark: 'Dark' }
        }).on('change', (ev) => {
            this.environment.setTheme(ev.value);
            if (ev.value === 'Dark') {
                document.body.classList.add('dark-theme');
            } else {
                document.body.classList.remove('dark-theme');
            }
        });

        const spawnFolder = this.gui.addFolder({ title: 'Robot Management' });
        
        spawnFolder.addBinding(this.params, 'spawnModel', {
            label: 'Model to Spawn',
            options: { 
                Optimus: 'Optimus', 
                Atlas: 'Atlas', 
                Figure: 'Figure', 
                Digit: 'Digit', 
                Neo: 'Neo', 
                TazerBot: 'TazerBot' 
            }
        });

        spawnFolder.addButton({
            title: 'Spawn Selected Robot',
            label: 'Action'
        }).on('click', () => {
            this.spawnRobot(this.params.spawnModel);
        });

        spawnFolder.addButton({
            title: 'Reset All Robots',
        }).on('click', () => {
            for (const r of this.robots) {
                this.scene.remove(r.group);
                if (r.physicsBody) physics.world.removeRigidBody(r.physicsBody);
            }
            this.robots = [];
            this.selectedRobot = null;
            document.getElementById('selected-robot-label').innerText = 'Simulation Active';
        });
    }

    updateLoading(percent) {
        const bar = document.getElementById('loader-progress-bar');
        const text = document.getElementById('loader-percent');
        if (bar) bar.style.width = `${percent}%`;
        if (text) text.innerText = `${Math.round(percent)}%`;
    }

    spawnRobot(model) {
        if (!model) {
            const models = ['Optimus', 'Atlas', 'Figure', 'Digit', 'Neo', 'TazerBot'];
            model = models[Math.floor(Math.random() * models.length)];
        }
        
        // Spawn at start zone or random near center
        const x = (Math.random() - 0.5) * 4;
        const z = -2 + (Math.random() - 0.5) * 4;
        
        const robot = new Humanoid(this.scene, x, 2, z, model);
        this.robots.push(robot);
        this.interaction.registerHumanoid(robot);
        
        // Auto-select newly spawned robot
        if (this.selectedRobot) this.selectedRobot.setSelected(false);
        this.selectedRobot = robot;
        robot.setSelected(true);
        document.getElementById('selected-robot-label').innerText = 'Neural Link Active';
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    animate() {
        requestAnimationFrame(() => this.animate());
        const delta = Math.min(this.clock.getDelta(), 0.1);

        physics.step();

        for (const robot of this.robots) {
            robot.update(delta);
        }

        // Update HUD IMU
        if (this.selectedRobot && this.selectedRobot.physicsBody) {
             const rot = this.selectedRobot.group.rotation;
             document.getElementById('imu-pitch').innerText = (rot.x * 180 / Math.PI).toFixed(2);
             document.getElementById('imu-roll').innerText = (rot.z * 180 / Math.PI).toFixed(2);
             document.getElementById('imu-yaw').innerText = (rot.y * 180 / Math.PI).toFixed(2);
        }

        this.orbitControls.update();
        this.renderer.render(this.scene, this.camera);
    }
}

window.addEventListener('DOMContentLoaded', () => {
    new App();
});
