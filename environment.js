import * as THREE from 'three';

export class Environment {
    constructor(scene) {
        this.scene = scene;
        this.grid = null;
        this.ground = null;
        this.ambientLight = null;
        this.sunLight = null;
        this.currentTheme = 'Light';
        this.init();
    }

    init() {
        // Industrial Dark Sky
        this.scene.background = new THREE.Color('#050505');
        this.scene.fog = new THREE.FogExp2('#050505', 0.02);

        // Infinite Grid
        this.grid = new THREE.GridHelper(200, 100, '#1a1a20', '#121217');
        this.grid.position.y = 0.001;
        this.scene.add(this.grid);

        // Ground Plane (Visual Only)
        const groundGeo = new THREE.PlaneGeometry(1000, 1000);
        const groundMat = new THREE.MeshStandardMaterial({
            color: '#080808',
            roughness: 0.8,
            metalness: 0.2
        });
        this.ground = new THREE.Mesh(groundGeo, groundMat);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);

        // Premium Lighting
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
        this.scene.add(this.ambientLight);

        // Main Sun/Directional Light
        this.sunLight = new THREE.DirectionalLight(0xffffff, 1.5);
        this.sunLight.position.set(20, 50, 20);
        this.sunLight.castShadow = true;

        this.sunLight.shadow.mapSize.width = 2048;
        this.sunLight.shadow.mapSize.height = 2048;
        this.sunLight.shadow.camera.left = -50;
        this.sunLight.shadow.camera.right = 50;
        this.sunLight.shadow.camera.top = 50;
        this.sunLight.shadow.camera.bottom = -50;
        this.scene.add(this.sunLight);

        // Secondary Accent Light (Robotic Teal)
        const accentLight = new THREE.PointLight('#00f2ff', 2, 50);
        accentLight.position.set(-10, 5, -10);
        this.scene.add(accentLight);
        
        // Default to Light Mode visuals
        this.setTheme('Light');
    }

    setWorldType(type) {
        if (type === 'Water') {
            this.scene.background = new THREE.Color('#001e36');
            this.scene.fog = new THREE.FogExp2('#001e36', 0.05); // Thick under-water fog
        } else {
            // Earth (Default)
            if (!this.scene.fog) {
                const fogColor = this.currentTheme === 'Dark' ? '#050505' : '#f0f0f5';
                this.scene.fog = new THREE.FogExp2(fogColor, 0.02);
            }
            this.setTheme(this.currentTheme);
        }
    }

    setTheme(theme) {
        this.currentTheme = theme;
        if (theme === 'Dark') {
            this.scene.background.set('#050505');
            if (this.scene.fog) this.scene.fog.color.set('#050505');
            this.ground.material.color.set('#080808');
            this.ambientLight.intensity = 0.1;
            this.sunLight.intensity = 1.5;
            
            // Recreate grid for dark theme
            this.scene.remove(this.grid);
            this.grid = new THREE.GridHelper(200, 100, '#1a1a20', '#121217');
            this.grid.position.y = 0.001;
            this.scene.add(this.grid);
            
        } else if (theme === 'Light') {
            this.scene.background.set('#f0f0f5');
            if (this.scene.fog) this.scene.fog.color.set('#f0f0f5');
            this.ground.material.color.set('#e0e0e0');
            this.ambientLight.intensity = 0.6;
            this.sunLight.intensity = 1.0;
            
            // Recreate grid for light theme
            this.scene.remove(this.grid);
            this.grid = new THREE.GridHelper(200, 100, '#cccccc', '#dddddd');
            this.grid.position.y = 0.001;
            this.scene.add(this.grid);
        }
    }

    // ── NFS Garage Mode ─────────────────────────────────────────────
    enterGarageMode() {
        // Dim the world to focus on the robot, but stay "Light" if in Light Mode
        if (this.currentTheme === 'Light') {
            this.sunLight.intensity = 0.4;
            this.ambientLight.intensity = 0.3;
        } else {
            this.sunLight.intensity = 0.1;
            this.ambientLight.intensity = 0.02;
        }
    }

    exitGarageMode() {
        // Restore standard lighting
        this.setTheme(this.currentTheme);
    }
}
