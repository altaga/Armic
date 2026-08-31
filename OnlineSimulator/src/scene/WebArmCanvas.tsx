import React, { useEffect, useRef } from 'react';
import {
  applyJointsToScene,
  applyOrbitCamera,
  applyWorldOffset,
  ArmScene,
  attachOrbitControls,
  buildArmSceneWeb,
  createDefaultOrbitState,
  resizeArmScene,
  setPayloadVisible,
} from './armScene';
import { JointsDeg } from '../sim/safety';

type Props = {
  joints: JointsDeg;
  worldOffset: { x: number; y: number; z: number };
  payloadKg: number;
  dumbbellGrams: number;
  onReady: (scene: ArmScene | null) => void;
};

export default function WebArmCanvas({ joints, worldOffset, payloadKg, dumbbellGrams, onReady }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<ArmScene | null>(null);
  const orbitRef = useRef(createDefaultOrbitState());
  const detachOrbitRef = useRef<(() => void) | null>(null);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;

    let disposed = false;

    const mount = () => {
      if (disposed || sceneRef.current) return true;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 16 || h < 16) return false;

      try {
        const scene = buildArmSceneWeb({ canvas, width: w, height: h });
        applyWorldOffset(scene, worldOffset);
        applyJointsToScene(scene, joints);
        applyOrbitCamera(scene.camera, orbitRef.current);
        detachOrbitRef.current = attachOrbitControls(canvas, scene.camera, orbitRef.current);
        sceneRef.current = scene;
        onReady(scene);

        const tick = () => {
          if (disposed || !sceneRef.current) return;
          sceneRef.current.renderer.render(sceneRef.current.scene, sceneRef.current.camera);
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
        return true;
      } catch (err) {
        console.error('WebArmCanvas init failed:', err);
        onReady(null);
        return true;
      }
    };

    if (!mount()) {
      const ro = new ResizeObserver(() => { mount(); });
      ro.observe(host);
      return () => {
        disposed = true;
        ro.disconnect();
        detachOrbitRef.current?.();
        cancelAnimationFrame(rafRef.current);
        sceneRef.current?.renderer.dispose();
        sceneRef.current = null;
        onReady(null);
      };
    }

    const ro = new ResizeObserver(() => {
      if (!sceneRef.current || !host) return;
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (w < 16 || h < 16) return;
      resizeArmScene(sceneRef.current, w, h);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      detachOrbitRef.current?.();
      cancelAnimationFrame(rafRef.current);
      sceneRef.current?.renderer.dispose();
      sceneRef.current = null;
      onReady(null);
    };
  }, [onReady]);

  useEffect(() => {
    if (sceneRef.current) applyWorldOffset(sceneRef.current, worldOffset);
  }, [worldOffset.x, worldOffset.y, worldOffset.z]);

  useEffect(() => {
    if (sceneRef.current) applyJointsToScene(sceneRef.current, joints);
  }, [joints.base, joints.shoulder, joints.elbow, joints.wrist, joints.gripper]);

  useEffect(() => {
    if (sceneRef.current) setPayloadVisible(sceneRef.current, payloadKg, dumbbellGrams);
  }, [payloadKg, dumbbellGrams]);

  return (
    <div
      ref={hostRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', overflow: 'hidden', cursor: 'grab' }}
    >
      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
      />
    </div>
  );
}
