import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, RoundedBox, ContactShadows } from "@react-three/drei";
import type { Group } from "three";
import { MathUtils } from "three";

export type LandingPointerState = { x: number; y: number };

const MAX_CURSOR_TILT = MathUtils.degToRad(8);
const BASE_X_ROTATION = -0.45;
const BASE_Z_ROTATION = 0.12;
const CUBE_SIZE = 0.52;
const CUBE_SPACING = 0.58;

const coreCubes = [
  { color: "#eee8e3", position: [-CUBE_SPACING, 0, 0] },
  { color: "#2c2e32", position: [CUBE_SPACING, 0, 0] },
  { color: "#f1b184", position: [0, CUBE_SPACING, 0] },
  { color: "#c3c7ce", position: [0, -CUBE_SPACING, 0] },
  { color: "#b8bdc5", position: [0, 0, CUBE_SPACING] },
  { color: "#eee8e3", position: [0, 0, -CUBE_SPACING] },
] as const;

function EngineCube({
  color,
  position,
}: {
  color: string;
  position: readonly [number, number, number];
}) {
  return (
    <group position={position}>
      <RoundedBox
        args={[CUBE_SIZE, CUBE_SIZE, CUBE_SIZE]}
        radius={0.018}
        smoothness={2}
        castShadow
        receiveShadow
      >
        <meshPhysicalMaterial
          color={color}
          roughness={0.48}
          metalness={0.08}
          clearcoat={0.18}
          clearcoatRoughness={0.55}
        />
      </RoundedBox>
    </group>
  );
}

function EngineCore({ pointer, reduced }: { pointer: LandingPointerState; reduced: boolean }) {
  const group = useRef<Group>(null);
  const pointerRef = useRef(pointer);
  const lastPointerMove = useRef(performance.now());

  useEffect(() => {
    const moved =
      Math.abs(pointer.x - pointerRef.current.x) > 0.0005 ||
      Math.abs(pointer.y - pointerRef.current.y) > 0.0005;

    pointerRef.current = pointer;
    if (moved) lastPointerMove.current = performance.now();
  }, [pointer]);

  useFrame(({ clock }) => {
    if (!group.current || reduced || document.hidden) return;

    const t = clock.elapsedTime;
    const cursorIsFresh = performance.now() - lastPointerMove.current < 260;
    const cursorTiltX = cursorIsFresh ? -pointerRef.current.y * MAX_CURSOR_TILT : 0;
    const cursorTiltZ = cursorIsFresh ? -pointerRef.current.x * MAX_CURSOR_TILT * 0.45 : 0;
    const softFloat = Math.sin(t * 0.82) * 0.032;
    const softTilt = Math.sin(t * 0.4) * 0.05;

    group.current.position.y = MathUtils.lerp(group.current.position.y, softFloat, 0.04);
    group.current.rotation.y = t * 0.25;
    group.current.rotation.x = MathUtils.lerp(
      group.current.rotation.x,
      BASE_X_ROTATION + softTilt + cursorTiltX,
      0.055,
    );
    group.current.rotation.z = MathUtils.lerp(
      group.current.rotation.z,
      BASE_Z_ROTATION + cursorTiltZ,
      0.055,
    );
  });

  return (
    <group
      ref={group}
      position={[0.42, -0.02, 0]}
      rotation={[BASE_X_ROTATION, -0.74, BASE_Z_ROTATION]}
      scale={1.72}
    >
      {coreCubes.map((cube, index) => (
        <EngineCube key={index} {...cube} />
      ))}
    </group>
  );
}

function HeroScene({ pointer, reduced }: { pointer: LandingPointerState; reduced: boolean }) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[3.8, 4.2, 4.5]} intensity={2.15} color="#f0a06a" castShadow />
      <directionalLight position={[-4, 2.2, 3]} intensity={0.92} color="#eee8e3" />
      <pointLight position={[0.8, 1.4, 2.8]} intensity={0.94} color="#df8755" />
      <EngineCore pointer={pointer} reduced={reduced} />
      <ContactShadows position={[0, -1.42, 0]} opacity={0.24} scale={4.8} blur={2.3} far={3.0} />
      <Environment preset="studio" environmentIntensity={0.34} />
    </>
  );
}

export function LandingHeroCanvas({
  pointer,
  reduced,
}: {
  pointer: LandingPointerState;
  reduced: boolean;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="h-full w-full" />;

  return (
    <Canvas
      shadows
      dpr={[1, 1.5]}
      camera={{ position: [0, 0, 6.8], fov: 34 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <HeroScene pointer={pointer} reduced={reduced} />
    </Canvas>
  );
}
