import { useEffect, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Environment, RoundedBox, ContactShadows } from "@react-three/drei";
import type { Group } from "three";
import { MathUtils } from "three";

export type LandingPointerState = { x: number; y: number };

const cubeSpecs = [
  {
    color: "#df8755",
    scale: 2.45,
    position: [0.35, 0.4, 0],
    rotation: [0.5, -0.55, 0.12],
    speed: 0.55,
    phase: 0,
  },
  {
    color: "#c3c7ce",
    scale: 1.55,
    position: [-1.45, -1.05, -0.1],
    rotation: [0.3, 0.45, -0.35],
    speed: 0.42,
    phase: 1.1,
  },
  {
    color: "#eee8e3",
    scale: 1.58,
    position: [1.55, -1.05, 0.15],
    rotation: [-0.25, 0.35, 0.28],
    speed: 0.38,
    phase: 2.4,
  },
  {
    color: "#2c2e32",
    scale: 1.02,
    position: [2.35, 0.2, -0.2],
    rotation: [0.45, 0.2, 0.18],
    speed: 0.46,
    phase: 3.4,
  },
  {
    color: "#df8755",
    scale: 0.34,
    position: [-0.85, 1.1, 0.25],
    rotation: [0, 0, 0],
    speed: 0.7,
    phase: 1.8,
  },
  {
    color: "#2c2e32",
    scale: 0.32,
    position: [-1.65, 0.0, 0.25],
    rotation: [0, 0, 0],
    speed: 0.62,
    phase: 2.8,
  },
  {
    color: "#eee8e3",
    scale: 0.3,
    position: [2.62, -1.35, 0.3],
    rotation: [0, 0, 0],
    speed: 0.58,
    phase: 0.7,
  },
] as const;

function FloatingCube({
  color,
  scale,
  position,
  rotation,
  speed,
  phase,
  reduced,
}: {
  color: string;
  scale: number;
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  speed: number;
  phase: number;
  reduced: boolean;
}) {
  const ref = useRef<Group>(null);
  const isSmall = scale < 0.3;

  useFrame(({ clock }) => {
    if (!ref.current || reduced || document.hidden) return;
    const t = clock.elapsedTime;
    const drift = Math.sin(t * speed + phase) * 0.09;
    ref.current.position.y = position[1] + Math.sin(t * (speed + 0.12) + phase) * 0.16;
    ref.current.position.x = position[0] + drift;
    ref.current.rotation.x = rotation[0] + t * speed * 0.12;
    ref.current.rotation.y = rotation[1] + t * speed * 0.16;
    ref.current.rotation.z = rotation[2] + Math.sin(t * speed + phase) * 0.08;
  });

  return (
    <group ref={ref} position={position} rotation={rotation} scale={scale}>
      <RoundedBox
        args={[1, 1, 1]}
        radius={isSmall ? 0.5 : 0.12}
        smoothness={5}
        castShadow
        receiveShadow
      >
        <meshStandardMaterial color={color} roughness={0.58} metalness={0.06} />
      </RoundedBox>
    </group>
  );
}

function HeroScene({ pointer, reduced }: { pointer: LandingPointerState; reduced: boolean }) {
  const group = useRef<Group>(null);

  useFrame(() => {
    if (!group.current || reduced || document.hidden) return;
    group.current.rotation.y = MathUtils.lerp(group.current.rotation.y, pointer.x * 0.16, 0.035);
    group.current.rotation.x = MathUtils.lerp(group.current.rotation.x, -pointer.y * 0.1, 0.035);
  });

  return (
    <>
      <ambientLight intensity={0.46} />
      <directionalLight position={[3.8, 4.2, 4.5]} intensity={2.2} color="#f0a06a" castShadow />
      <directionalLight position={[-4, 2.2, 3]} intensity={0.86} color="#eee8e3" />
      <pointLight position={[0.8, 1.4, 2.8]} intensity={1.1} color="#df8755" />
      <group ref={group} position={[0.08, 0.02, 0]}>
        {cubeSpecs.map((spec, index) => (
          <FloatingCube key={index} {...spec} reduced={reduced} />
        ))}
      </group>
      <ContactShadows position={[0, -2.08, 0]} opacity={0.3} scale={8.5} blur={2.8} far={3.5} />
      <Environment preset="studio" environmentIntensity={0.36} />
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
      camera={{ position: [0, 0, 4.45], fov: 39 }}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
    >
      <HeroScene pointer={pointer} reduced={reduced} />
    </Canvas>
  );
}
