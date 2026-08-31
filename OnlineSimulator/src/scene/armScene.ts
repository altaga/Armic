import { MathUtils } from 'three';
import * as THREE from 'three';
import { Renderer } from 'expo-three';
import { JointsDeg } from '../sim/safety';

/** Match armic-webui arm-simulator.html scene scale (mm → Three.js units). */
export const SCENE_SCALE = 0.04;
const L0 = 30;
const L1 = 90;
const L2 = 70;
const L3 = 50;
const FLOOR_OFFSET_MM = 60;
const S = SCENE_SCALE;

export type ArmSceneParts = {
  worldGroup: THREE.Group;
  pedestalGroup: THREE.Group;
  baseGroup: THREE.Group;
  shoulderGroup: THREE.Group;
  elbowGroup: THREE.Group;
  wristGroup: THREE.Group;
  gripperGroup: THREE.Group;
  finger1: THREE.Mesh;
  finger2: THREE.Mesh;
  upperArm: THREE.Mesh;
  lowerArm: THREE.Mesh;
  wristSegment: THREE.Mesh;
  payloadDumbbellGroup: THREE.Group;
};

export type ArmScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  parts: ArmSceneParts;
  endFrame?: () => void;
};

type ExpoBuildOptions = {
  gl: WebGLRenderingContext;
  width: number;
  height: number;
};

type WebBuildOptions = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
};

function configureRenderer(renderer: THREE.WebGLRenderer, w: number, h: number) {
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
}

function createArmSceneGraph(width: number, height: number): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  parts: ArmSceneParts;
} {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d0d);

  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 200);
  camera.position.set(0, 10, 15.75);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.45));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
  dirLight.position.set(10, 25, 10);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 60;
  dirLight.shadow.camera.left = -15;
  dirLight.shadow.camera.right = 15;
  dirLight.shadow.camera.top = 15;
  dirLight.shadow.camera.bottom = -15;
  dirLight.shadow.bias = -0.001;
  scene.add(dirLight);
  const rimLight = new THREE.DirectionalLight(0x00ffcc, 0.2);
  rimLight.position.set(-10, 5, -10);
  scene.add(rimLight);
  const fillLight = new THREE.DirectionalLight(0xffeedd, 0.15);
  fillLight.position.set(-5, 3, 8);
  scene.add(fillLight);

  const worldGroup = new THREE.Group();
  scene.add(worldGroup);

  const grid = new THREE.GridHelper(40, 40, 0x444444, 0x222222);
  worldGroup.add(grid);
  const axes = new THREE.AxesHelper(2);
  axes.position.y = 0.01;
  worldGroup.add(axes);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 40),
    new THREE.ShadowMaterial({ opacity: 0.35 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.005;
  floor.receiveShadow = true;
  worldGroup.add(floor);

  const envelope = new THREE.Mesh(
    new THREE.SphereGeometry((L1 + L2 + L3) * S, 32, 24),
    new THREE.MeshPhongMaterial({ color: 0x00ffcc, transparent: true, opacity: 0.04, wireframe: true, depthWrite: false }),
  );
  envelope.position.y = (FLOOR_OFFSET_MM + L0) * S;
  worldGroup.add(envelope);

  const sing = new THREE.Mesh(
    new THREE.CylinderGeometry(1.5 * S, 1.5 * S, 8, 32, 1, true),
    new THREE.MeshPhongMaterial({ color: 0xff3366, transparent: true, opacity: 0.06, depthWrite: false }),
  );
  sing.position.y = 4;
  worldGroup.add(sing);

  const jointMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, metalness: 0.7, roughness: 0.35 });
  const armMat = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 0.5, roughness: 0.25 });
  const linkMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.4, roughness: 0.4 });
  const accentMat = new THREE.MeshStandardMaterial({ color: 0x00ffcc, wireframe: true, opacity: 0.5, transparent: true, emissive: 0x003322 });
  const fingerMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, metalness: 0.3, roughness: 0.5 });

  const pedestalGroup = new THREE.Group();
  worldGroup.add(pedestalGroup);
  const pedestalH = FLOOR_OFFSET_MM * S;

  const floorPlate = new THREE.Mesh(
    new THREE.CylinderGeometry(2.1, 2.4, 0.12, 32),
    new THREE.MeshStandardMaterial({ color: 0x1f232a, metalness: 0.5, roughness: 0.3 }),
  );
  floorPlate.position.y = 0.06;
  floorPlate.castShadow = true;
  floorPlate.receiveShadow = true;
  pedestalGroup.add(floorPlate);

  const pedestalStand = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 2.0, pedestalH - 0.12, 32),
    new THREE.MeshStandardMaterial({ color: 0x2d323b, metalness: 0.5, roughness: 0.35 }),
  );
  pedestalStand.position.y = (pedestalH + 0.12) / 2;
  pedestalGroup.add(pedestalStand);

  const boltMat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.2 });
  const boltGeom = new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8);
  for (let b = 0; b < 4; b++) {
    const angle = (b * Math.PI) / 2 + Math.PI / 4;
    const bolt = new THREE.Mesh(boltGeom, boltMat);
    bolt.position.set(1.95 * Math.cos(angle), 0.12, 1.95 * Math.sin(angle));
    pedestalGroup.add(bolt);
  }

  const baseGroup = new THREE.Group();
  baseGroup.position.y = FLOOR_OFFSET_MM * S;
  worldGroup.add(baseGroup);

  const l0Column = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, L0 * S, 24), armMat);
  l0Column.position.y = (L0 * S) / 2;
  l0Column.castShadow = true;
  baseGroup.add(l0Column);

  const shoulderGroup = new THREE.Group();
  shoulderGroup.position.y = L0 * S;
  baseGroup.add(shoulderGroup);
  shoulderGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.55, 24, 24), jointMat));
  shoulderGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), accentMat.clone()));

  const upperArm = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, L1 * S, 24), armMat.clone());
  upperArm.position.y = (L1 * S) / 2;
  upperArm.castShadow = true;
  shoulderGroup.add(upperArm);

  const elbowGroup = new THREE.Group();
  elbowGroup.position.y = L1 * S;
  shoulderGroup.add(elbowGroup);
  elbowGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 24), jointMat));
  elbowGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.58, 16, 12), accentMat.clone()));

  const lowerArm = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, L2 * S, 24), armMat.clone());
  lowerArm.position.y = (L2 * S) / 2;
  lowerArm.castShadow = true;
  elbowGroup.add(lowerArm);

  const wristGroup = new THREE.Group();
  wristGroup.position.y = L2 * S;
  elbowGroup.add(wristGroup);
  wristGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 20), jointMat));
  wristGroup.add(new THREE.Mesh(new THREE.SphereGeometry(0.48, 16, 12), accentMat.clone()));

  const wristSegment = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, L3 * S, 20), armMat.clone());
  wristSegment.position.y = (L3 * S) / 2;
  wristSegment.castShadow = true;
  wristGroup.add(wristSegment);

  const gripperGroup = new THREE.Group();
  gripperGroup.position.y = L3 * S;
  wristGroup.add(gripperGroup);

  const gripperBase = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.25, 0.4), linkMat);
  gripperBase.position.y = 0.1;
  gripperGroup.add(gripperBase);

  const fingerGeom = new THREE.BoxGeometry(0.18, 0.5, 0.1);
  const finger1 = new THREE.Mesh(fingerGeom, fingerMat);
  finger1.position.set(0, 0.45, -0.3);
  gripperGroup.add(finger1);
  const finger2 = new THREE.Mesh(fingerGeom, fingerMat);
  finger2.position.set(0, 0.45, 0.3);
  gripperGroup.add(finger2);

  const payloadDumbbellGroup = new THREE.Group();
  payloadDumbbellGroup.position.set(0, 0.78, 0);
  payloadDumbbellGroup.rotation.y = Math.PI / 2;
  payloadDumbbellGroup.visible = false;
  const dumbbellMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, metalness: 0.75, roughness: 0.28 });
  const dumbbellBar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.72, 10), dumbbellMat);
  dumbbellBar.rotation.x = Math.PI / 2;
  payloadDumbbellGroup.add(dumbbellBar);
  const dumbbellPlateGeom = new THREE.CylinderGeometry(0.22, 0.22, 0.12, 14);
  const dumbbellPlateL = new THREE.Mesh(dumbbellPlateGeom, dumbbellMat);
  dumbbellPlateL.rotation.x = Math.PI / 2;
  dumbbellPlateL.position.z = -0.4;
  payloadDumbbellGroup.add(dumbbellPlateL);
  const dumbbellPlateR = dumbbellPlateL.clone();
  dumbbellPlateR.position.z = 0.4;
  payloadDumbbellGroup.add(dumbbellPlateR);
  gripperGroup.add(payloadDumbbellGroup);

  const tipMesh = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 12), new THREE.MeshBasicMaterial({ color: 0x00ff66 }));
  gripperGroup.add(tipMesh);

  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffaa00 });
  const arrowShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.6, 12), arrowMat);
  arrowShaft.position.y = 0.55;
  gripperGroup.add(arrowShaft);
  const arrowHead = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 16), arrowMat);
  arrowHead.position.y = 1.05;
  gripperGroup.add(arrowHead);

  const DEF: JointsDeg = { base: 90, shoulder: 90, elbow: 95, wrist: 90, gripper: 30 };
  applyJointsToGroup({
    baseGroup, shoulderGroup, elbowGroup, wristGroup, finger1, finger2,
  }, DEF);

  return {
    scene,
    camera,
    parts: {
      worldGroup,
      pedestalGroup,
      baseGroup,
      shoulderGroup,
      elbowGroup,
      wristGroup,
      gripperGroup,
      finger1,
      finger2,
      upperArm,
      lowerArm,
      wristSegment,
      payloadDumbbellGroup,
    },
  };
}

/** Expo GL / native path */
export function buildArmScene({ gl, width, height }: ExpoBuildOptions): ArmScene {
  const w = width > 0 ? width : gl.drawingBufferWidth || 800;
  const h = height > 0 ? height : gl.drawingBufferHeight || 600;
  const renderer = new Renderer({ gl, antialias: true, alpha: false, width: w, height: h });
  configureRenderer(renderer, w, h);
  const { scene, camera, parts } = createArmSceneGraph(w, h);
  return {
    renderer,
    scene,
    camera,
    parts,
    endFrame: () => { (gl as { endFrameEXP?: () => void }).endFrameEXP?.(); },
  };
}

/** Standard HTML canvas — reliable on Expo Web / EAS Hosting */
export function buildArmSceneWeb({ canvas, width, height }: WebBuildOptions): ArmScene {
  const w = width > 0 ? width : canvas.clientWidth || 800;
  const h = height > 0 ? height : canvas.clientHeight || 600;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  configureRenderer(renderer, w, h);
  const { scene, camera, parts } = createArmSceneGraph(w, h);
  return { renderer, scene, camera, parts };
}

export function resizeArmScene(scn: ArmScene, width: number, height: number) {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  scn.camera.aspect = w / h;
  scn.camera.updateProjectionMatrix();
  scn.renderer.setSize(w, h, false);
}

export function applyJointsToScene(scn: ArmScene, j: JointsDeg) {
  applyJointsToGroup({
    baseGroup: scn.parts.baseGroup,
    shoulderGroup: scn.parts.shoulderGroup,
    elbowGroup: scn.parts.elbowGroup,
    wristGroup: scn.parts.wristGroup,
    finger1: scn.parts.finger1,
    finger2: scn.parts.finger2,
  }, j);
}

export function applyWorldOffset(scn: ArmScene, offset: { x: number; y: number; z: number }) {
  scn.parts.worldGroup.position.set(offset.x, offset.y, offset.z);
}

export function setPayloadVisible(scn: ArmScene, kg: number, refGrams = 17) {
  const load = Math.max(0, kg);
  const g = scn.parts.payloadDumbbellGroup;
  if (load <= 0) {
    g.visible = false;
    return;
  }
  g.visible = true;
  const ratio = Math.max(0.12, (load * 1000) / Math.max(1, refGrams));
  const s = 1.45 * Math.pow(ratio, 0.28);
  g.scale.set(s, s, s);
}

export type OrbitCameraState = {
  target: THREE.Vector3;
  yaw: number;
  pitch: number;
  dist: number;
};

export function createDefaultOrbitState(): OrbitCameraState {
  return {
    target: new THREE.Vector3(0, 0, 0),
    yaw: Math.PI * 0.5,
    pitch: Math.PI / 6,
    dist: 22,
  };
}

export function applyOrbitCamera(camera: THREE.PerspectiveCamera, state: OrbitCameraState) {
  const { target, yaw, pitch, dist } = state;
  camera.position.x = target.x + dist * Math.cos(pitch) * Math.cos(yaw);
  camera.position.z = target.z + dist * Math.cos(pitch) * Math.sin(yaw);
  camera.position.y = target.y + dist * Math.sin(pitch);
  camera.lookAt(target);
}

export function attachOrbitControls(
  canvas: HTMLCanvasElement,
  camera: THREE.PerspectiveCamera,
  state: OrbitCameraState = createDefaultOrbitState(),
): () => void {
  let dragging = false;
  let lastX = 0;
  let lastY = 0;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
  };
  const onUp = () => { dragging = false; };
  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    state.yaw -= (e.clientX - lastX) * 0.01;
    state.pitch -= (e.clientY - lastY) * 0.01;
    state.pitch = Math.max(-1.4, Math.min(1.4, state.pitch));
    lastX = e.clientX;
    lastY = e.clientY;
    applyOrbitCamera(camera, state);
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    state.dist *= Math.exp(e.deltaY * 0.001);
    state.dist = Math.max(5, Math.min(80, state.dist));
    applyOrbitCamera(camera, state);
  };

  applyOrbitCamera(camera, state);
  canvas.addEventListener('mousedown', onDown);
  window.addEventListener('mouseup', onUp);
  window.addEventListener('mousemove', onMove);
  canvas.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    canvas.removeEventListener('mousedown', onDown);
    window.removeEventListener('mouseup', onUp);
    window.removeEventListener('mousemove', onMove);
    canvas.removeEventListener('wheel', onWheel);
  };
}

type JointGroups = {
  baseGroup: THREE.Group;
  shoulderGroup: THREE.Group;
  elbowGroup: THREE.Group;
  wristGroup: THREE.Group;
  finger1: THREE.Mesh;
  finger2: THREE.Mesh;
};

/** Same joint mapping as armic-webui arm-simulator.html updateArm() */
function applyJointsToGroup(g: JointGroups, j: JointsDeg) {
  const DEG = MathUtils.degToRad(1);
  g.baseGroup.rotation.y = (j.base - 90) * DEG;
  g.shoulderGroup.rotation.z = (90 - j.shoulder) * DEG;
  g.elbowGroup.rotation.z = -(j.elbow - 90) * DEG;
  g.wristGroup.rotation.z = (90 - j.wrist) * DEG;

  const clawPct = Math.max(0, Math.min(100, j.gripper > 100 ? j.gripper : (j.gripper / 90) * 100));
  const spread = 0.10 + 0.22 * (clawPct / 100);
  g.finger1.position.z = -spread;
  g.finger2.position.z = spread;
}
