import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

class ARSoundApp {
    constructor() {
        if (!navigator.xr) {
            alert('WebXR not available in your browser');
            return;
        }
        this.cubesPlaced = false;
        this.redModel = null;
        this.blueModel = null;
        this.clock = new THREE.Clock();
        this.fpsCounter = document.createElement('div');
        this.fpsCounter.id = 'fps-counter';
        this.fpsCounter.textContent = 'FPS: --';
        this.fpsCounter.classList.add('hidden');
        document.getElementById('container').appendChild(this.fpsCounter);
        this.frames = 0;
        this.prevTime = performance.now();
        this.soundVisualizersVisible = false;
        this.redVisualizer = null;
        this.blueVisualizer = null;
        this.initialize();
    }

    initialize() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.01, 20);
        
        // Enhanced renderer setup for better quality
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: true,
            logarithmicDepthBuffer: true,
            powerPreference: "high-performance"
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Optimize for performance
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.xr.enabled = true;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace; // Modern color space handling
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.5; // Slightly increased exposure
        this.renderer.physicallyCorrectLights = true;
        document.body.appendChild(this.renderer.domElement);

        // Enhanced Audio setup with new defaults
        this.audioListener = new THREE.AudioListener();
        this.camera.add(this.audioListener);
        this.sounds = {
            red: new THREE.PositionalAudio(this.audioListener),
            blue: new THREE.PositionalAudio(this.audioListener)
        };

        // Load audio files with higher default volume
        const audioLoader = new THREE.AudioLoader();
        audioLoader.load('sounds/2.mp3', (buffer) => {
            this.sounds.red.setBuffer(buffer);
            this.sounds.red.setRefDistance(0.3);
            this.sounds.red.setRolloffFactor(1.9);
            this.sounds.red.setDistanceModel('exponential');
            this.sounds.red.setDirectionalCone(180, 230, 0.3);
            this.sounds.red.setVolume(15.0);
            this.sounds.red.setLoop(true);
        });

        audioLoader.load('sounds/1.mp3', (buffer) => {
            this.sounds.blue.setBuffer(buffer);
            this.sounds.blue.setRefDistance(0.3);
            this.sounds.blue.setRolloffFactor(1.9);
            this.sounds.blue.setDistanceModel('exponential');
            this.sounds.blue.setDirectionalCone(180, 230, 0.3);
            this.sounds.blue.setVolume(1.0);
            this.sounds.blue.setLoop(true);
        });

        // Improved shadow catcher ground plane
        const groundGeometry = new THREE.PlaneGeometry(30, 30);
        const groundMaterial = new THREE.ShadowMaterial({
            opacity: 0.4,
            color: 0x000000
        });
        this.ground = new THREE.Mesh(groundGeometry, groundMaterial);
        this.ground.rotation.x = -Math.PI / 2;
        this.ground.position.y = -0.001; // Slightly below zero to avoid z-fighting
        this.ground.receiveShadow = true;
        this.scene.add(this.ground);

        this.setupAR();
        this.setupLights();
        this.setupEventListeners();

        // Add reticle
        const geometry = new THREE.RingGeometry(0.15, 0.2, 32).rotateX(-Math.PI / 2);
        const material = new THREE.MeshBasicMaterial();
        this.reticle = new THREE.Mesh(geometry, material);
        this.reticle.matrixAutoUpdate = false;
        this.reticle.visible = false;
        this.scene.add(this.reticle);

        // Create volume control for model2
        this.createExternalControls();
    }

    async setupAR() {
        this.hitTestSourceRequested = false;
        this.hitTestSource = null;

        const sessionInit = {
            requiredFeatures: ['hit-test'],
            optionalFeatures: ['dom-overlay', 'local-floor'],
            domOverlay: { root: document.getElementById('container') }
        };

        try {
            const supported = await navigator.xr.isSessionSupported('immersive-ar');
            if (!supported) {
                throw new Error('AR not supported');
            }

            const startButton = document.getElementById('start-ar');
            startButton.addEventListener('click', async () => {
                try {
                    const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
                    await this.onSessionStarted(session);
                } catch (error) {
                    console.error('Failed to start AR session:', error);
                    document.getElementById('error-message').classList.remove('hidden');
                }
            });

        } catch (error) {
            console.error('Error setting up AR:', error);
            document.getElementById('error-message').classList.remove('hidden');
        }
    }

    setupLights() {
        // Main directional light with improved settings
        const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
        dirLight.position.set(5, 10, 7);
        dirLight.castShadow = true;
        dirLight.shadow.mapSize.width = 2048;
        dirLight.shadow.mapSize.height = 2048;
        dirLight.shadow.camera.near = 0.1;
        dirLight.shadow.camera.far = 20;
        dirLight.shadow.bias = -0.0001;
        dirLight.shadow.normalBias = 0.02;
        this.scene.add(dirLight);

        // Softer ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
        this.scene.add(ambientLight);

        // Enhanced hemisphere light
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.7);
        hemiLight.position.set(0, 20, 0);
        this.scene.add(hemiLight);
    }

    async onSessionStarted(session) {
        try {
            session.addEventListener('end', () => {
                this.hitTestSourceRequested = false;
                this.hitTestSource = null;
                document.getElementById('ar-prompt').classList.remove('hidden');
                document.getElementById('instructions').classList.add('hidden');
                this.renderer.setAnimationLoop(null);
            });

            await this.renderer.xr.setSession(session);
            
            const referenceSpace = await session.requestReferenceSpace('local-floor');
            const viewerSpace = await session.requestReferenceSpace('viewer');
            const hitTestSource = await session.requestHitTestSource({
                space: viewerSpace
            });

            this.hitTestSource = hitTestSource;
            this.renderer.xr.setReferenceSpace(referenceSpace);

            document.getElementById('ar-prompt').classList.add('hidden');
            document.getElementById('instructions').classList.remove('hidden');
            document.getElementById('sound-controls').classList.remove('hidden');
            document.getElementById('error-message').classList.add('hidden');

            // Set up sound controls
            this.setupSoundControls();

            // Set up select event
            session.addEventListener('select', (event) => {
                this.onSelect(event);
            });

            // Start the render loop
            this.renderer.setAnimationLoop((timestamp, frame) => this.render(timestamp, frame));

        } catch (error) {
            console.error('Failed to set up XR session:', error);
            session.end();
            document.getElementById('error-message').classList.remove('hidden');
        }
    }

    setupSoundControls() {
        // Volume Controls
        const redVolumeSlider = document.getElementById('red-volume');
        const redVolumeValue = document.getElementById('red-volume-value');
        redVolumeSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            redVolumeValue.textContent = value.toFixed(1);
            if (this.sounds.red) this.sounds.red.setVolume(value);
        });

        const blueVolumeSlider = document.getElementById('blue-volume');
        const blueVolumeValue = document.getElementById('blue-volume-value');
        blueVolumeSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            blueVolumeValue.textContent = value.toFixed(1);
            if (this.sounds.blue) this.sounds.blue.setVolume(value);
        });

        // Reference Distance Control
        const refDistanceSlider = document.getElementById('ref-distance');
        const refDistanceValue = document.getElementById('ref-distance-value');
        refDistanceSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            refDistanceValue.textContent = value;
            if (this.sounds.red) this.sounds.red.setRefDistance(value);
            if (this.sounds.blue) this.sounds.blue.setRefDistance(value);
        });

        // Rolloff Factor Control
        const rolloffSlider = document.getElementById('rolloff');
        const rolloffValue = document.getElementById('rolloff-value');
        rolloffSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            rolloffValue.textContent = value;
            if (this.sounds.red) this.sounds.red.setRolloffFactor(value);
            if (this.sounds.blue) this.sounds.blue.setRolloffFactor(value);
        });

        // Distance Model Control
        const distanceModelSelect = document.getElementById('distance-model');
        distanceModelSelect.addEventListener('change', (e) => {
            const model = e.target.value;
            if (this.sounds.red) this.sounds.red.setDistanceModel(model);
            if (this.sounds.blue) this.sounds.blue.setDistanceModel(model);
        });

        // Modified Model Scale Control
        const modelScaleSlider = document.getElementById('model-scale');
        const modelScaleValue = document.getElementById('model-scale-value');
        modelScaleSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            modelScaleValue.textContent = value.toFixed(1);
            
            // Update model scale if it exists
            if (this.redModel) {
                // Apply multiplied scale
                const scale = value;
                this.redModel.scale.set(scale, scale, scale);
            }
        });

        // Add Model2 Scale Control
        const model2ScaleSlider = document.getElementById('model2-scale');
        const model2ScaleValue = document.getElementById('model2-scale-value');
        model2ScaleSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            model2ScaleValue.textContent = value.toFixed(1);
            
            if (this.blueModel) {
                const scale = value;
                this.blueModel.scale.set(scale, scale, scale);
            }
        });

        // Add visualizer toggle
        const visualizerToggle = document.createElement('div');
        visualizerToggle.className = 'control-group';
        visualizerToggle.innerHTML = `
            <label>
                <input type="checkbox" id="visualizer-toggle">
                Show Sound Visualization
            </label>
        `;
        document.getElementById('sound-controls').appendChild(visualizerToggle);

        document.getElementById('visualizer-toggle').addEventListener('change', (e) => {
            this.soundVisualizersVisible = e.target.checked;
            if (this.redVisualizer) this.redVisualizer.visible = this.soundVisualizersVisible;
            if (this.blueVisualizer) this.blueVisualizer.visible = this.soundVisualizersVisible;
        });
    }

    async createRedCube() {
        const container = new THREE.Object3D();
        
        const audioContainer = new THREE.Object3D();
        audioContainer.add(this.sounds.red);
        
        // Add visualizer
        this.redVisualizer = this.createSoundVisualizer(0xff0000);
        audioContainer.add(this.redVisualizer);
        
        container.add(audioContainer);
        
        const loader = new GLTFLoader();
        try {
            const gltf = await loader.loadAsync('model/model1.glb');
            const model = gltf.scene;
            
            // Store the model reference
            this.redModel = model;
            
            // Change initial scale to 15
            const initialScale = 15;
            model.scale.set(initialScale, initialScale, initialScale);
            
            model.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            container.add(model);
            
            // Update default volume to 15.0
            const volume = 15.0;
            const refDistance = 0.3;
            this.sounds.red.setVolume(volume);
            this.sounds.red.setRefDistance(refDistance);
            this.sounds.red.setRolloffFactor(parseFloat(document.getElementById('rolloff').value));
            this.sounds.red.setDistanceModel(document.getElementById('distance-model').value);
            this.sounds.red.play();

            return container;
            
        } catch (error) {
            console.error('Error loading model:', error);
            return this.createFallbackCube();
        }
    }

    createFallbackCube() {
        const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const material = new THREE.MeshPhysicalMaterial({ 
            color: 0xff0000,
            metalness: 0.6,
            roughness: 0.2,
            clearcoat: 0.5,
            clearcoatRoughness: 0.3,
            reflectivity: 0.8,
            envMapIntensity: 0.8
        });
        const cube = new THREE.Mesh(geometry, material);
        cube.castShadow = true;
        cube.receiveShadow = true;
        
        const audioContainer = new THREE.Object3D();
        audioContainer.add(this.sounds.red);
        cube.add(audioContainer);
        
        return cube;
    }

    async createBlueModel() {
        const container = new THREE.Object3D();
        
        const loader = new GLTFLoader();
        try {
            const gltf = await loader.loadAsync('model/model2.glb');
            const model = gltf.scene;
            
            // Store model reference
            this.blueModel = model;
            
            // Calculate model center and dimensions
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            
            // Create audio container
            const audioContainer = new THREE.Object3D();
            
            // Center the model first
            model.position.sub(center);
            
            // Apply scale before recalculating center
            const initialScale = 0.3;
            model.scale.set(initialScale, initialScale, initialScale);
            
            // Recalculate center after scaling
            const scaledBox = new THREE.Box3().setFromObject(model);
            const scaledCenter = scaledBox.getCenter(new THREE.Vector3());
            
            // Position audio container at the scaled model's center
            audioContainer.position.copy(scaledCenter);
            audioContainer.add(this.sounds.blue);
            
            // Add visualizer at the same position
            this.blueVisualizer = this.createSoundVisualizer(0x0000ff);
            audioContainer.add(this.blueVisualizer);
            
            container.add(audioContainer);
            container.add(model);
            
            model.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });
            
            // Apply sound settings with 1m reference distance
            const volume = 1.0;
            this.sounds.blue.setVolume(volume);
            this.sounds.blue.setRefDistance(1.0); // Set to 1 meter
            this.sounds.blue.setRolloffFactor(parseFloat(document.getElementById('rolloff').value) * 0.8);
            this.sounds.blue.setDistanceModel(document.getElementById('distance-model').value);
            this.sounds.blue.play();
            
            return container;
            
        } catch (error) {
            console.error('Error loading model2:', error);
            return this.createFallbackBlueCube();
        }
    }

    createFallbackBlueCube() {
        const geometry = new THREE.BoxGeometry(0.8, 0.8, 0.8);
        const material = new THREE.MeshPhysicalMaterial({ 
            color: 0x0000ff,
            metalness: 0.6,
            roughness: 0.2,
            clearcoat: 0.5,
            clearcoatRoughness: 0.3,
            reflectivity: 0.8,
            envMapIntensity: 0.8
        });
        const cube = new THREE.Mesh(geometry, material);
        cube.castShadow = true;
        cube.receiveShadow = true;
        
        const audioContainer = new THREE.Object3D();
        audioContainer.add(this.sounds.blue);
        cube.add(audioContainer);
        
        return cube;
    }

    async onSelect(event) {
        if (this.cubesPlaced || !this.hitTestSource) {
            return;
        }

        const frame = event.frame;
        const hitTestResults = frame.getHitTestResults(this.hitTestSource);
        
        if (hitTestResults.length > 0) {
            const hit = hitTestResults[0];
            const pose = hit.getPose(this.renderer.xr.getReferenceSpace());

            try {
                // Place model1
                const redModel = await this.createRedCube();
                redModel.matrix.fromArray(pose.transform.matrix);
                redModel.matrix.decompose(redModel.position, redModel.quaternion, redModel.scale);
                redModel.position.y = 0;
                this.scene.add(redModel);

                // Place model2
                const blueModel = await this.createBlueModel();
                blueModel.matrix.fromArray(pose.transform.matrix);
                blueModel.matrix.decompose(blueModel.position, blueModel.quaternion, blueModel.scale);
                blueModel.position.y = 0;  // Place on ground
                blueModel.position.z -= 1.83;  // Changed to ~6 feet (from 3.0)
                this.scene.add(blueModel);

                // Set flag and update UI
                this.cubesPlaced = true;
                this.reticle.visible = false;
                
                // Show all controls after placement
                document.getElementById('instructions').classList.add('hidden');
                document.getElementById('toggle-controls').classList.remove('hidden');
                document.getElementById('sound-controls').classList.remove('hidden');
                document.getElementById('external-controls').classList.remove('hidden');
                this.fpsCounter.classList.remove('hidden');
                this.setupToggleControls();

            } catch (error) {
                console.error('Error placing objects:', error);
                const instructions = document.getElementById('instructions');
                instructions.textContent = "Error placing objects. Please try again.";
                instructions.classList.remove('hidden');
                setTimeout(() => {
                    instructions.classList.add('hidden');
                    instructions.textContent = "Tap on the ground to place objects";
                }, 2000);
            }
        }
    }

    setupEventListeners() {
        window.addEventListener('resize', () => {
            this.camera.aspect = window.innerWidth / window.innerHeight;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(window.innerWidth, window.innerHeight);
        });
    }

    render(timestamp, frame) {
        if (!frame) return;

        // Update FPS
        this.updateFPS();

        // Animate visualizers if visible
        if (this.soundVisualizersVisible) {
            const time = performance.now() * 0.001; // Convert to seconds
            
            // Animate red visualizer
            if (this.redVisualizer) {
                this.redVisualizer.rings.forEach((ring, i) => {
                    ring.scale.setScalar(1 + 0.2 * Math.sin(time * 2 + i));
                    ring.rotation.z = time * (i + 1) * 0.5;
                    ring.material.opacity = 0.2 + 0.1 * Math.sin(time * 3 + i);
                });
            }
            
            // Animate blue visualizer
            if (this.blueVisualizer) {
                this.blueVisualizer.rings.forEach((ring, i) => {
                    ring.scale.setScalar(1 + 0.2 * Math.sin(time * 2 + i + Math.PI));
                    ring.rotation.z = time * (i + 1) * 0.5;
                    ring.material.opacity = 0.2 + 0.1 * Math.sin(time * 3 + i + Math.PI);
                });
            }
        }

        if (!this.cubesPlaced && this.hitTestSource && this.reticle) {
            const hitTestResults = frame.getHitTestResults(this.hitTestSource);
            if (hitTestResults.length > 0) {
                const hit = hitTestResults[0];
                const pose = hit.getPose(this.renderer.xr.getReferenceSpace());
                this.reticle.visible = true;
                this.reticle.matrix.fromArray(pose.transform.matrix);
            } else {
                this.reticle.visible = false;
            }
        }

        this.renderer.render(this.scene, this.camera);
    }

    setupToggleControls() {
        const toggleButton = document.getElementById('toggle-settings');
        const soundControls = document.getElementById('sound-controls');
        
        toggleButton.addEventListener('click', () => {
            soundControls.classList.toggle('collapsed');
        });

        // Add touch event for mobile
        toggleButton.addEventListener('touchend', (e) => {
            e.preventDefault();
            soundControls.classList.toggle('collapsed');
        });
    }

    updateFPS() {
        this.frames++;
        const time = performance.now();
        
        if (time >= this.prevTime + 1000) {
            const fps = Math.round((this.frames * 1000) / (time - this.prevTime));
            this.fpsCounter.textContent = `FPS: ${fps}`;
            
            // Color coding based on FPS
            if (fps > 50) {
                this.fpsCounter.className = 'fps-good';
            } else if (fps > 30) {
                this.fpsCounter.className = 'fps-warning';
            } else {
                this.fpsCounter.className = 'fps-bad';
            }
            
            this.frames = 0;
            this.prevTime = time;
        }
    }

    createSoundVisualizer(color) {
        const segments = 32;
        const geometry = new THREE.SphereGeometry(0.1, segments, segments);
        const material = new THREE.MeshBasicMaterial({
            color: color,
            wireframe: true,
            transparent: true,
            opacity: 0.3
        });
        
        const visualizer = new THREE.Mesh(geometry, material);
        visualizer.visible = this.soundVisualizersVisible;
        
        // Add animated rings
        const rings = [];
        for (let i = 0; i < 3; i++) {
            const ringGeometry = new THREE.TorusGeometry(0.2 + i * 0.2, 0.02, 16, 32);
            const ringMaterial = new THREE.MeshBasicMaterial({
                color: color,
                transparent: true,
                opacity: 0.2
            });
            const ring = new THREE.Mesh(ringGeometry, ringMaterial);
            ring.rotation.x = Math.PI / 2;
            rings.push(ring);
            visualizer.add(ring);
        }
        
        // Store rings for animation
        visualizer.rings = rings;
        return visualizer;
    }

    createExternalControls() {
        // Create container for external controls
        const externalControls = document.createElement('div');
        externalControls.id = 'external-controls';
        externalControls.classList.add('hidden');
        
        // Create visualizer toggle button first
        const visualizerToggle = document.createElement('button');
        visualizerToggle.id = 'external-visualizer-toggle';
        visualizerToggle.innerHTML = `
            <svg class="visualizer-icon" viewBox="0 0 24 24">
                <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
        `;
        visualizerToggle.title = "Toggle Sound Visualization";
        
        // Create blue volume control
        const blueVolumeControl = document.createElement('div');
        blueVolumeControl.className = 'external-control';
        blueVolumeControl.innerHTML = `
            <svg class="volume-icon" viewBox="0 0 24 24">
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
            </svg>
            <input type="range" id="external-blue-volume" min="0.001" max="3" step="0.001" value="1.0">
        `;
        
        // Add elements in new order
        externalControls.appendChild(visualizerToggle);
        externalControls.appendChild(blueVolumeControl);
        document.getElementById('container').appendChild(externalControls);
        
        // Add event listeners
        document.getElementById('external-blue-volume').addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            if (this.sounds.blue) this.sounds.blue.setVolume(value * 1.5);
        });
        
        visualizerToggle.addEventListener('click', () => {
            this.soundVisualizersVisible = !this.soundVisualizersVisible;
            if (this.redVisualizer) this.redVisualizer.visible = this.soundVisualizersVisible;
            if (this.blueVisualizer) this.blueVisualizer.visible = this.soundVisualizersVisible;
            visualizerToggle.classList.toggle('active');
        });
    }
}

// Start the application
window.addEventListener('DOMContentLoaded', () => {
    new ARSoundApp();
}); 