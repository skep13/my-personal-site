import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin } from "@pixiv/three-vrm";

const container = document.getElementById("marina-viewer");

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    30,
    container.clientWidth / container.clientHeight,
    0.1,
    100
);

camera.position.set(0, 1.3, 3);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
});

renderer.setSize(
    container.clientWidth,
    container.clientHeight
);

renderer.setPixelRatio(window.devicePixelRatio);

container.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 3);
light.position.set(1, 2, 3);
scene.add(light);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
scene.add(ambientLight);

const loader = new GLTFLoader();

loader.register((parser) => {
    return new VRMLoaderPlugin(parser);
});

loader.load(
    "models/mari.vrm",

    (gltf) => {
        const vrm = gltf.userData.vrm;

        scene.add(vrm.scene);

        // Find the size of Marina
        const box = new THREE.Box3().setFromObject(vrm.scene);
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());

        console.log("Marina loaded!");
        console.log("Marina size:", size);
        console.log("Marina center:", center);

        // Centre Marina
        vrm.scene.position.sub(center);

        // Position the camera based on Marina's size
        const maxSize = Math.max(size.x, size.y, size.z);

        camera.position.set(
            0,
            maxSize * 0.5,
            maxSize * 2.5
        );

        camera.lookAt(0, 0, 0);

        // Face Marina towards the camera
        vrm.scene.rotation.y = Math.PI;
    },

    undefined,

    (error) => {
        console.error("Could not load Marina:", error);
    }
);

function animate() {
    requestAnimationFrame(animate);

    renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
    camera.aspect =
        container.clientWidth / container.clientHeight;

    camera.updateProjectionMatrix();

    renderer.setSize(
        container.clientWidth,
        container.clientHeight
    );
});