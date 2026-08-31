import { ColorRepresentation, MathUtils } from 'three';
import * as THREE from 'three';
import { Renderer } from 'expo-three';
import { JointsDeg } from '../sim/safety';
import { LINK_1_MM, LINK_2_MM, BASE_OFFSET_MM, TOOL_XYZ_MM } from '../sim/kinematics';

export type ArmScene = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  parts: {
    baseMesh: THREE.Group;
    shoulderPivot: THREE.Group;
    upperArm: THREE.Mesh;
    elbowPivot: THREE.Group;
    forearm: THREE.Mesh;
    wristPivot: THREE.Group;
    gripperBase: THREE.Group;
    gripperLeft: THREE.Mesh;
    gripperRight: THREE.Mesh;
    table: THREE.Mesh;
    puck: THREE.Mesh;
  };
};

type BuildOptions = {
  gl: WebGLRenderingContext;
  width: number;
  height: number;
};

function box(
  w: number, h: number, d: number,
  color: ColorRepresentation,
): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.6 });
  return new THREE.Mesh(geo, mat);
}

function cyl(
  radiusTop: number, radiusBottom: number, height: number, color: ColorRepresentation, radialSeg = 24,
): THREE.Mesh {
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radialSeg);
  const mat = new THREE.MeshStandardMaterial({ color, metalness: 0.5, roughness: 0.4 });
  return new THREE.Mesh(geo, mat);
}

export function buildArmScene({ gl, width, height }: BuildOptions): ArmScene {
  const w = width > 0 ? width : gl.drawingBufferWidth || 800;
  const h = height > 0 ? height : gl.drawingBufferHeight || 600;
  const renderer = new Renderer({ gl, antialias: true, alpha: false, width: w, height: h });
  renderer.setPixelRatio(Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1));
  renderer.setClearColor(0x07090a, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07090a);
  scene.fog = new THREE.Fog(0x07090a, 500, 1200);

  const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 5000);
  camera.position.set(280, 240, 360);
  camera.lookAt(0, 60, 0);

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(amb);
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(260, 360, 260);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -260; key.shadow.camera.right = 260;
  key.shadow.camera.top = 260; key.shadow.camera.bottom = -260;
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 1200;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x00d4b8, 0.25);
  rim.position.set(-320, 180, -220);
  scene.add(rim);

  // Floor / bench top
  const tableGeo = new THREE.BoxGeometry(900, 12, 600);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x141715, roughness: 0.85, metalness: 0.1 });
  const table = new THREE.Mesh(tableGeo, tableMat);
  table.position.set(0, -6, 0);
  table.receiveShadow = true;
  scene.add(table);

  // Grid
  const grid = new THREE.GridHelper(600, 24, 0x252a28, 0x1a1e1c);
  grid.position.y = 0.02;
  scene.add(grid);

  // Base plate
  const baseMesh = new THREE.Group();
  const basePlate = cyl(56, 60, 18, 0x202623);
  basePlate.position.y = 9;
  basePlate.castShadow = true; basePlate.receiveShadow = true;
  baseMesh.add(basePlate);
  const baseCap = cyl(38, 42, 10, 0x00d4b8);
  baseCap.position.y = 18 + 5;
  baseMesh.add(baseCap);
  scene.add(baseMesh);

  // Shoulder pivot group (rotates around Y axis = base rotation)
  const shoulderPivot = new THREE.Group();
  shoulderPivot.position.y = 22;
  baseMesh.add(shoulderPivot);

  // Shoulder housing (pivots with base)
  const shHousing = box(70, 46, 36, 0x2a2f2c);
  shHousing.castShadow = true; shHousing.receiveShadow = true;
  shHousing.position.y = 18;
  shoulderPivot.add(shHousing);

  // Upper arm group: pivots around X (shoulder tilt)
  const upperPivot = new THREE.Group();
  upperPivot.position.set(0, 30, 0);
  shoulderPivot.add(upperPivot);

  const L1 = LINK_1_MM; // 90mm
  const upperArm = box(28, L1, 24, 0xe2e8e6);
  upperArm.geometry.translate(0, L1 / 2, 0);
  upperArm.castShadow = true; upperArm.receiveShadow = true;
  upperPivot.add(upperArm);

  // Elbow group at top of upper arm
  const elbowPivot = new THREE.Group();
  elbowPivot.position.set(0, L1, 0);
  upperPivot.add(elbowPivot);

  const L2 = LINK_2_MM; // 110mm
  const forearm = box(24, L2, 22, 0xd5ddd9);
  forearm.geometry.translate(0, L2 / 2, 0);
  forearm.castShadow = true; forearm.receiveShadow = true;
  elbowPivot.add(forearm);

  // Wrist at top of forearm
  const wristPivot = new THREE.Group();
  wristPivot.position.set(0, L2, 0);
  elbowPivot.add(wristPivot);

  const wristHousing = box(26, 18, 26, 0x2a2f2c);
  wristHousing.position.y = 9;
  wristHousing.castShadow = true;
  wristPivot.add(wristHousing);

  // Gripper group
  const gripperBase = new THREE.Group();
  gripperBase.position.set(0, 20, 0);
  wristPivot.add(gripperBase);

  const gripperRail = box(36, 8, 18, 0x202623);
  gripperRail.castShadow = true;
  gripperBase.add(gripperRail);

  const gripperLeft = box(6, 30, 6, 0x00d4b8);
  gripperLeft.position.set(-14, 18, 0);
  gripperLeft.castShadow = true;
  gripperBase.add(gripperLeft);

  const gripperRight = box(6, 30, 6, 0x00d4b8);
  gripperRight.position.set(14, 18, 0);
  gripperRight.castShadow = true;
  gripperBase.add(gripperRight);

  // Calibration puck
  const puckGeo = new THREE.CylinderGeometry(18, 20, 10, 24);
  const puckMat = new THREE.MeshStandardMaterial({ color: 0xe67e22, emissive: 0x2a1206, roughness: 0.5 });
  const puck = new THREE.Mesh(puckGeo, puckMat);
  puck.position.set(BASE_OFFSET_MM + L1 - 10, 5, 0);
  puck.castShadow = true; puck.receiveShadow = true;
  scene.add(puck);

  // Bench reference corner lights
  const c1 = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 14), new THREE.MeshBasicMaterial({ color: 0x00d4b8 }));
  c1.position.set(-440, 4, -280); scene.add(c1);
  const c2 = new THREE.Mesh(new THREE.SphereGeometry(2.4, 14, 14), new THREE.MeshBasicMaterial({ color: 0xe8456a }));
  c2.position.set(440, 4, -280); scene.add(c2);

  // Init home pose (90 90 95 90)
  const DEF: JointsDeg = { base: 90, shoulder: 90, elbow: 95, wrist: 90, gripper: 30 };
  applyJointsToGroup({
    baseMesh, shoulderPivot, upperArm, elbowPivot, forearm, wristPivot,
    gripperBase, gripperLeft, gripperRight,
  }, DEF);

  return {
    renderer, scene, camera,
    parts: {
      baseMesh, shoulderPivot, upperArm, elbowPivot, forearm, wristPivot,
      gripperBase, gripperLeft, gripperRight, table, puck,
    },
  };
}

export function applyJointsToScene(scn: ArmScene, j: JointsDeg) {
  applyJointsToGroup({
    baseMesh: scn.parts.baseMesh,
    shoulderPivot: scn.parts.shoulderPivot,
    upperArm: scn.parts.upperArm,
    elbowPivot: scn.parts.elbowPivot,
    forearm: scn.parts.forearm,
    wristPivot: scn.parts.wristPivot,
    gripperBase: scn.parts.gripperBase,
    gripperLeft: scn.parts.gripperLeft,
    gripperRight: scn.parts.gripperRight,
  }, j);
}

const SCENE_PER_UNIT = 25;
export function applyWorldOffset(scn: ArmScene, offset: { x: number; y: number; z: number }) {
  const ox = offset.x * SCENE_PER_UNIT;
  const oy = offset.y * SCENE_PER_UNIT;
  const oz = offset.z * SCENE_PER_UNIT;
  scn.camera.position.set(280 + ox, 240 + oy, 360 + oz);
  scn.camera.lookAt(ox, 60 + oy, oz);
}

type G = {
  baseMesh: THREE.Group;
  shoulderPivot: THREE.Group;
  upperArm: THREE.Mesh;
  elbowPivot: THREE.Group;
  forearm: THREE.Mesh;
  wristPivot: THREE.Group;
  gripperBase: THREE.Group;
  gripperLeft: THREE.Mesh;
  gripperRight: THREE.Mesh;
};

function applyJointsToGroup(g: G, j: JointsDeg) {
  // Base (j.base degrees 0..180) — Y rotation around bench
  g.baseMesh.rotation.y = MathUtils.degToRad(-(j.base - 90));

  // Shoulder: 90 electrical = vertical up; 0 electrical = arm horizontal forward
  // shoulderTiltDeg: 90 → upright; 0 → 90° forward tilt
  const shoulderTiltDeg = j.shoulder - 90; // positive tilts forward
  g.shoulderPivot.children.forEach((c) => {
    if (c.type === 'Group') (c as THREE.Group).rotation.z = MathUtils.degToRad(shoulderTiltDeg);
  });
  // Apply tilt directly to upperPivot if present
  const upperPivot = g.upperArm.parent;
  if (upperPivot) upperPivot.rotation.z = MathUtils.degToRad(shoulderTiltDeg);

  // Elbow interior: 90 electrical = folded up, 180 = straight
  // Joint angle delta between upper→forearm (0 folded → 90° straight electrical difference)
  const elbowFold = (180 - j.elbow);
  g.elbowPivot.rotation.z = MathUtils.degToRad(elbowFold);

  // Wrist rotation around forearm axis (yaw around local Y of wristPivot)
  const wristDelta = j.wrist - 90;
  g.wristPivot.rotation.y = MathUtils.degToRad(wristDelta);
  g.gripperBase.rotation.x = 0;

  // Gripper open/close (0 closed, 90 open) → translates finger z-offset ±half-open width
  const gripperOpen = MathUtils.degToRad(j.gripper) * 20 / Math.PI * 2;
  g.gripperLeft.position.x = -14 - 10 + (gripperOpen / 2);
  g.gripperRight.position.x = 14 + 10 - (gripperOpen / 2);
}
