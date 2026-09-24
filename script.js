import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";

const container = document.getElementById("marina-viewer");

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    21,
    container.clientWidth / container.clientHeight,
    0.1,
    20
);

const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true
});

renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setSize(container.clientWidth, container.clientHeight);

container.appendChild(renderer.domElement);

const light = new THREE.DirectionalLight(0xffffff, 2.0);
light.position.set(1, 1.6, 2.2);
scene.add(light);

const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
scene.add(ambientLight);

// Marina's eyes follow this point, which moves with the camera
const lookTarget = new THREE.Object3D();
lookTarget.position.set(0, 0, -1);
camera.add(lookTarget);
scene.add(camera);

let vrm = null;
let bones = {};
let basePose = {};
let springs = [];
let mouthCloseTargets = [];
let browTargets = {};

// ---------- Noise helpers (smooth random movement) ----------

const TAU = Math.PI * 2;

const hash = (i) => {
    const s = Math.sin(i * 127.1) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
};

function noise1(x) {
    const i = Math.floor(x);
    const f = x - i;
    const u = f * f * f * (f * (f * 6 - 15) + 10);
    return hash(i) * (1 - u) + hash(i + 1) * u;
}

function fbm(x) {
    return noise1(x) * 0.72 + noise1(x * 2.7 + 13.7) * 0.28;
}

// ---------- Rest pose (arms down instead of T-pose) ----------

const IDLE_BONES = [
    "hips", "spine", "chest", "upperChest", "neck", "head",
    "leftShoulder", "rightShoulder",
    "leftUpperArm", "rightUpperArm",
    "leftLowerArm", "rightLowerArm",
    "leftHand", "rightHand"
];

const REST_POSE = {
    leftShoulder:  [0, 0, 0.05],
    rightShoulder: [0, 0, -0.06],
    leftUpperArm:  [0.06, 0, -1.24],
    rightUpperArm: [0.04, 0, 1.20],
    leftLowerArm:  [0, 0.24, -0.10],
    rightLowerArm: [0, -0.20, 0.09],
    leftHand:      [0, 0, -0.07],
    rightHand:     [0, 0, 0.05],
    spine:         [0.02, 0, 0],
    chest:         [0.01, 0, 0]
};

function buildRestPose(v) {
    const h = v.humanoid;
    bones = {};
    basePose = {};
    if (!h) return;

    for (const name of IDLE_BONES) {
        const node = h.getNormalizedBoneNode(name);
        if (!node) continue;
        const pose = REST_POSE[name];
        if (pose) node.rotation.set(pose[0], pose[1], pose[2]);
        bones[name] = node;
        basePose[name] = { x: node.rotation.x, y: node.rotation.y, z: node.rotation.z };
    }
}

function poseBone(name, dx, dy, dz) {
    const node = bones[name];
    const base = basePose[name];
    if (!node || !base) return;
    node.rotation.set(base.x + dx, base.y + (dy || 0), base.z + (dz || 0));
}

// ---------- Face details (VRoid morphs) ----------

const MOUTH_CLOSE_MORPH = "Fcl_MTH_Close";
const BROW_MORPHS = ["Fcl_BRW_Fun", "Fcl_BRW_Surprised", "Fcl_BRW_Sorrow"];

function collectMorphs(v) {
    mouthCloseTargets = [];
    browTargets = {};
    for (const name of BROW_MORPHS) browTargets[name] = [];

    v.scene.traverse((o) => {
        const dict = o.morphTargetDictionary;
        if (!o.isSkinnedMesh || !dict) return;
        if (MOUTH_CLOSE_MORPH in dict) {
            mouthCloseTargets.push({ mesh: o, index: dict[MOUTH_CLOSE_MORPH] });
        }
        for (const name of BROW_MORPHS) {
            if (name in dict) browTargets[name].push({ mesh: o, index: dict[name] });
        }
    });
}

function applyRestingMouth() {
    for (const t of mouthCloseTargets) {
        t.mesh.morphTargetInfluences[t.index] = 1;
    }
}

function applyIdleBrow(t) {
    const values = {
        Fcl_BRW_Fun: 0.06 + 0.05 * noise1(t * 0.19 + 7) + browFlash * 0.22,
        Fcl_BRW_Surprised: Math.max(0, 0.03 * noise1(t * 0.23 + 19)),
        Fcl_BRW_Sorrow: Math.max(0, 0.05 * noise1(t * 0.14 + 55))
    };

    for (const name of BROW_MORPHS) {
        const v = Math.max(0, Math.min(1, values[name]));
        for (const tgt of browTargets[name]) {
            tgt.mesh.morphTargetInfluences[tgt.index] = v;
        }
    }
}

// ---------- Hair (spring bones blown by a light breeze) ----------

function collectSprings(v) {
    springs = [];
    const mgr = v.springBoneManager;
    if (!mgr || !mgr.joints) return;
    for (const joint of mgr.joints) {
        springs.push({
            joint,
            dir: joint.settings.gravityDir.clone(),
            power: joint.settings.gravityPower
        });
    }
}

const WIND_STRENGTH = 0.15;
const wind = new THREE.Vector3();
const force = new THREE.Vector3();

function updateHair(t) {
    if (!springs.length) return;

    const gust = 0.55 + 0.45 * Math.sin(t * TAU * 0.037);
    const wx = (Math.sin(t * TAU * 0.13) * 0.6
              + Math.sin(t * TAU * 0.29 + 1.3) * 0.28
              + Math.sin(t * TAU * 0.61 + 2.4) * 0.10) * gust;
    const wz = (Math.sin(t * TAU * 0.11 + 2.1) * 0.5
              + Math.sin(t * TAU * 0.23 + 0.7) * 0.24
              + Math.sin(t * TAU * 0.53 + 1.1) * 0.09) * gust;

    wind.set(wx * WIND_STRENGTH, 0, wz * WIND_STRENGTH);

    for (const s of springs) {
        force.copy(s.dir).multiplyScalar(s.power).add(wind);
        const len = force.length();
        if (len < 1e-6) continue;
        s.joint.settings.gravityDir.copy(force).divideScalar(len);
        s.joint.settings.gravityPower = len;
    }
}

// ---------- Camera framing ----------

function frameUpperBody(v) {
    const head = v.humanoid?.getNormalizedBoneNode("head");
    const target = new THREE.Vector3();
    if (head) {
        v.scene.updateWorldMatrix(true, true);
        head.getWorldPosition(target);
    } else {
        new THREE.Box3().setFromObject(v.scene).getCenter(target);
    }

    const VIEW_HEIGHT = 0.67;
    const DROP = 0.06;
    const fovRad = (camera.fov * Math.PI) / 180;
    const dist = VIEW_HEIGHT / (2 * Math.tan(fovRad / 2));

    camera.position.set(target.x, target.y - DROP, target.z + dist);
    camera.lookAt(target.x, target.y - DROP, target.z);
    camera.updateMatrixWorld(true);
}

// ---------- Load Marina ----------

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser));

loader.load(
    "models/mari.vrm",

    (gltf) => {
        const next = gltf.userData.vrm;

        // VRM 0.x models face backwards; this turns them to face the camera.
        // VRM 1.0 models already face the camera, so it does nothing to them.
        VRMUtils.rotateVRM0(next);
        VRMUtils.removeUnnecessaryVertices?.(next.scene);
        VRMUtils.combineSkeletons?.(next.scene);

        next.scene.traverse((o) => { o.frustumCulled = false; });

        buildRestPose(next);
        collectSprings(next);
        collectMorphs(next);

        if (next.lookAt) {
            next.lookAt.target = lookTarget;
            next.lookAt.autoUpdate = true;
        }

        scene.add(next.scene);
        vrm = next;
        frameUpperBody(next);
    },

    undefined,

    (error) => {
        console.error("Could not load Marina:", error);
    }
);

// ---------- Mouse tracking ----------

const pointer = { x: 0, y: 0 };

window.addEventListener("mousemove", (e) => {
    const rect = container.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const clamp = (n) => Math.max(-1, Math.min(1, n));
    pointer.x = clamp((e.clientX - cx) / (window.innerWidth / 2));
    pointer.y = clamp((e.clientY - cy) / (window.innerHeight / 2));
});

// ---------- Gaze (eyes wander and glance away) ----------

const AVERSIONS = [
    { x: -0.38, y:  0.27, hold: [1.1, 2.4] },
    { x:  0.36, y:  0.25, hold: [1.1, 2.4] },
    { x: -0.27, y: -0.23, hold: [1.4, 3.0] },
    { x:  0.25, y: -0.21, hold: [1.4, 3.0] },
    { x: -0.48, y:  0.04, hold: [1.6, 3.4] },
    { x:  0.46, y: -0.02, hold: [1.6, 3.4] }
];

let gazeTimer = 0;
let gazeAway = false;
const gaze = { x: 0, y: 0 };
const gazeTarget = { x: 0, y: 0 };
const gazeHead = { x: 0, y: 0 };
const gazeHeadV = { x: 0, y: 0 };
let browFlash = 0;

function updateGaze(dt, t) {
    gazeTimer -= dt;
    if (gazeTimer <= 0) {
        const from = { x: gazeTarget.x, y: gazeTarget.y };

        if (gazeAway) {
            gazeAway = false;
            gazeTarget.x = (Math.random() - 0.5) * 0.10;
            gazeTarget.y = (Math.random() - 0.5) * 0.07;
            gazeTimer = 1.6 + Math.random() * 3.4;
            browFlash = 1;
        } else if (Math.random() < 0.45) {
            gazeAway = true;
            const a = AVERSIONS[(Math.random() * AVERSIONS.length) | 0];
            gazeTarget.x = a.x + (Math.random() - 0.5) * 0.10;
            gazeTarget.y = a.y + (Math.random() - 0.5) * 0.08;
            gazeTimer = a.hold[0] + Math.random() * (a.hold[1] - a.hold[0]);
        } else {
            gazeTarget.x = (Math.random() - 0.5) * 0.14;
            gazeTarget.y = (Math.random() - 0.5) * 0.10;
            gazeTimer = 1.3 + Math.random() * 2.2;
        }

        // Big eye movements often come with a blink
        const jump = Math.hypot(gazeTarget.x - from.x, gazeTarget.y - from.y);
        if (jump > 0.28 && blinkTimer > 0.9 && Math.random() < 0.4) blinkTimer = 0.02;
    }

    const dist = Math.hypot(gazeTarget.x - gaze.x, gazeTarget.y - gaze.y);
    const k = Math.min(1, dt * (13 - Math.min(7, dist * 9)));
    gaze.x += (gazeTarget.x - gaze.x) * k;
    gaze.y += (gazeTarget.y - gaze.y) * k;

    const driftX = noise1(t * 1.7) * 0.012;
    const driftY = noise1(t * 1.4 + 31) * 0.009;

    const K = 6, C = 4.4;
    gazeHeadV.x += (K * (gazeTarget.x - gazeHead.x) - C * gazeHeadV.x) * dt;
    gazeHeadV.y += (K * (gazeTarget.y - gazeHead.y) - C * gazeHeadV.y) * dt;
    gazeHead.x += gazeHeadV.x * dt;
    gazeHead.y += gazeHeadV.y * dt;

    browFlash = Math.max(0, browFlash - dt * 2.6);

    lookTarget.position.set(
        pointer.x * 0.45 + gaze.x + driftX,
        -pointer.y * 0.30 + gaze.y + driftY,
        -1
    );
}

// ---------- Body (breathing, swaying, head follow) ----------

const headS = { x: 0, y: 0, z: 0 };
const headV = { x: 0, y: 0, z: 0 };
const torsoS = { x: 0, y: 0 };
const torsoV = { x: 0, y: 0 };

function updateBody(t, dt) {
    const bphase = t * 0.21 + 0.07 * noise1(t * 0.05);
    const bw = bphase - Math.floor(bphase);
    const breath = (bw < 0.4
        ? Math.sin((bw / 0.4) * Math.PI * 0.5)
        : Math.cos(((bw - 0.4) / 0.6) * Math.PI * 0.5)) * 2 - 1;

    const energy = 0.68 + 0.42 * noise1(t * 0.035 + 3);
    const shift = fbm(t * 0.031 + 61) * energy;

    const TK = 2.6, TC = 2.9;
    torsoV.y += (TK * (gazeHead.x - torsoS.y) - TC * torsoV.y) * dt;
    torsoV.x += (TK * (-gazeHead.y - torsoS.x) - TC * torsoV.x) * dt;
    torsoS.y += torsoV.y * dt;
    torsoS.x += torsoV.x * dt;

    const twist = torsoS.y * 0.30;
    const lean = torsoS.x * 0.10;

    poseBone("hips", lean * 0.4, twist * 0.30 + shift * 0.020, shift * -0.016);
    poseBone("spine", -0.004 * breath + lean * 0.5, twist * 0.34 + shift * 0.014, shift * 0.010);
    poseBone("chest", -0.013 * breath + lean * 0.7, twist * 0.22, shift * 0.008);
    poseBone("upperChest", -0.008 * breath, twist * 0.14, shift * 0.005);

    poseBone("leftShoulder", -0.010 * breath, 0, 0.006 * breath);
    poseBone("rightShoulder", -0.010 * breath, 0, -0.006 * breath);

    const armL = fbm(t * 0.077 + 11) * energy;
    const armR = fbm(t * 0.071 + 29) * energy;
    const swing = twist * 0.55;

    poseBone("leftUpperArm", 0.012 * armL - 0.010 * breath, swing * 0.5, -0.030 * armL - swing * 0.35);
    poseBone("rightUpperArm", 0.012 * armR - 0.010 * breath, swing * 0.5, 0.028 * armR - swing * 0.35);
    poseBone("leftLowerArm", 0, 0.030 * armL + swing * 0.25, -0.014 * armL);
    poseBone("rightLowerArm", 0, -0.028 * armR + swing * 0.25, 0.013 * armR);
    poseBone("leftHand", 0.018 * armR, 0, -0.014 * armL);
    poseBone("rightHand", 0.017 * armL, 0, 0.013 * armR);

    const nx = fbm(t * 0.13);
    const ny = fbm(t * 0.11 + 40);
    const nz = fbm(t * 0.09 + 80);

    const followX = -gazeHead.y * 0.19;
    const followY = gazeHead.x * 0.40;

    const idleX = pointer.y * 0.09 + 0.016 * nx * energy;
    const idleY = pointer.x * 0.17 + 0.034 * ny * energy;
    const idleZ = 0.018 * nz * energy;

    const HK = 5.0, HC = 4.2;
    headV.x += (HK * (idleX - headS.x) - HC * headV.x) * dt;
    headV.y += (HK * (idleY - headS.y) - HC * headV.y) * dt;
    headV.z += (HK * (idleZ - headS.z) - HC * headV.z) * dt;
    headS.x += headV.x * dt;
    headS.y += headV.y * dt;
    headS.z += headV.z * dt;

    const x = headS.x + followX;
    const y = headS.y + followY;
    const z = headS.z - followY * 0.13;

    poseBone("neck", x * 0.40, y * 0.40, z * 0.5);
    poseBone("head", x * 0.60, y * 0.60, z * 0.5);
}

// ---------- Blinking and mood ----------

let blinkTimer = 1 + Math.random() * 3;
let blinkPending = 0;
let blinkT = 999;
let blinkDur = 0.14;

function updateBlink(dt) {
    blinkTimer -= dt;
    if (blinkTimer <= 0) {
        blinkT = 0;
        blinkDur = 0.11 + Math.random() * 0.07;
        if (blinkPending > 0) {
            blinkPending -= 1;
            blinkTimer = 2.4 + Math.random() * 4.6;
        } else if (Math.random() < 0.25) {
            // Sometimes blink twice
            blinkPending = 1;
            blinkTimer = 0.24;
        } else {
            blinkTimer = 2.4 + Math.random() * 4.6;
        }
    }

    blinkT += dt;
    const bp = blinkT / blinkDur;
    const blink = bp >= 1 ? 0
        : bp < 0.32
            ? Math.pow(bp / 0.32, 0.62)
            : Math.pow(1 - (bp - 0.32) / 0.68, 1.7);

    vrm.expressionManager?.setValue("blink", blink);
}

let moodTimer = 0;
let mood = 0;
let moodTarget = 0;

function updateMood(dt) {
    moodTimer -= dt;
    if (moodTimer <= 0) {
        moodTimer = 4 + Math.random() * 9;
        moodTarget = Math.random() < 0.5 ? 0 : 0.05 + Math.random() * 0.10;
    }
    mood += (moodTarget - mood) * Math.min(1, dt * 1.3);

    vrm.expressionManager?.setValue("happy", mood);
}

// ---------- Main loop ----------

let last = performance.now();
let elapsed = 0;

function animate() {
    requestAnimationFrame(animate);

    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    elapsed += dt;

    if (vrm) {
        updateGaze(dt, elapsed);
        updateBody(elapsed, dt);
        updateBlink(dt);
        updateMood(dt);
        updateHair(elapsed);

        vrm.update(dt);

        applyRestingMouth();
        applyIdleBrow(elapsed);
    }

    renderer.render(scene, camera);
}

animate();

window.addEventListener("resize", () => {
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
});
