import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import { Component, Suspense, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import type { Agent, World, WorldObject } from "./engine";

function Box({
  position,
  scale,
  color,
  rotation = [0, 0, 0],
}: {
  position: [number, number, number];
  scale: [number, number, number];
  color: string;
  rotation?: [number, number, number];
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={scale} />
      <meshStandardMaterial color={color} roughness={0.85} />
    </mesh>
  );
}

function ObjectShape({ object }: { object: WorldObject }) {
  const scale = object.scale;
  if (object.type === "tree")
    return (
      <group scale={scale}>
        <mesh position={[0, 1.25, 0]} castShadow>
          <cylinderGeometry args={[0.22, 0.35, 2.5, 8]} />
          <meshStandardMaterial color="#725039" roughness={1} />
        </mesh>
        <mesh position={[0, 2.75, 0]} castShadow>
          <icosahedronGeometry args={[1.25, 1]} />
          <meshStandardMaterial color={object.color} roughness={0.9} />
        </mesh>
      </group>
    );
  if (object.type === "bench")
    return (
      <group scale={scale}>
        <Box
          position={[0, 0.62, 0]}
          scale={[2.4, 0.18, 0.65]}
          color={object.color}
        />
        <Box
          position={[0, 1.2, 0.28]}
          scale={[2.4, 0.8, 0.15]}
          color={object.color}
        />
        {[-0.85, 0.85].map((x) => (
          <Box
            key={x}
            position={[x, 0.3, 0]}
            scale={[0.16, 0.6, 0.5]}
            color="#4f5945"
          />
        ))}
      </group>
    );
  if (object.type === "ball")
    return (
      <mesh position={[0, 0.38 * scale, 0]} scale={scale} castShadow>
        <sphereGeometry args={[0.42, 20, 16]} />
        <meshStandardMaterial color={object.color} roughness={0.55} />
      </mesh>
    );
  if (object.type === "crate")
    return (
      <group scale={scale}>
        <Box
          position={[0, 0.55, 0]}
          scale={[1.25, 1.1, 1.15]}
          color={object.color}
        />
        <Box
          position={[0, 1.15, 0]}
          scale={[1.35, 0.12, 1.25]}
          color="#6c543c"
        />
        <Box
          position={[0, 0.55, 0.59]}
          scale={[0.12, 0.9, 0.06]}
          color="#6c543c"
        />
      </group>
    );
  if (object.type === "table")
    return (
      <group scale={scale}>
        <Box
          position={[0, 1, 0]}
          scale={[2.5, 0.2, 1.45]}
          color={object.color}
        />
        {[-0.85, 0.85].flatMap((x) =>
          [-0.42, 0.42].map((z) => (
            <Box
              key={`${x}-${z}`}
              position={[x, 0.48, z]}
              scale={[0.16, 0.95, 0.16]}
              color="#514b3c"
            />
          )),
        )}
      </group>
    );
  if (object.type === "lamp")
    return (
      <group scale={scale}>
        <mesh position={[0, 1.4, 0]} castShadow>
          <cylinderGeometry args={[0.08, 0.12, 2.8, 8]} />
          <meshStandardMaterial color="#46594f" />
        </mesh>
        <mesh position={[0, 2.65, 0]} castShadow>
          <sphereGeometry args={[0.34, 12, 12]} />
          <meshStandardMaterial
            color={object.color}
            emissive={object.color}
            emissiveIntensity={0.5}
          />
        </mesh>
      </group>
    );
  if (object.type === "rock")
    return (
      <mesh
        position={[0, 0.55 * scale, 0]}
        scale={[1.2 * scale, 0.8 * scale, scale]}
        castShadow
        receiveShadow
      >
        <dodecahedronGeometry args={[0.7, 0]} />
        <meshStandardMaterial color={object.color} roughness={1} />
      </mesh>
    );
  return (
    <group scale={scale}>
      {Array.from({ length: 9 }, (_, index) => {
        const angle = index * 2.4;
        const radius = 0.18 + (index % 3) * 0.2;
        return (
          <group
            key={index}
            position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
          >
            <mesh position={[0, 0.25, 0]}>
              <cylinderGeometry args={[0.018, 0.025, 0.5, 5]} />
              <meshStandardMaterial color="#3e7a43" />
            </mesh>
            <mesh position={[0, 0.53, 0]}>
              <sphereGeometry args={[0.1, 8, 6]} />
              <meshStandardMaterial
                color={index % 2 ? object.color : "#f2dfd1"}
              />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

function WorldObjectView({
  object,
  selected,
  onSelect,
}: {
  object: WorldObject;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <group
      position={[object.position[0], 0, object.position[1]]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 0]}>
          <ringGeometry args={[0.8 * object.scale, 0.92 * object.scale, 40]} />
          <meshBasicMaterial color="#efffa9" transparent opacity={0.95} />
        </mesh>
      )}
      <ObjectShape object={object} />
      {selected && (
        <Html position={[0, 3 * object.scale, 0]} center distanceFactor={24}>
          <span className="world-label selected-object-label">
            {object.name}
          </span>
        </Html>
      )}
    </group>
  );
}

function Character({
  agent,
  selected,
  onSelect,
  time,
}: {
  agent: Agent;
  selected: boolean;
  onSelect: () => void;
  time: number;
}) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const last = useRef(
    new THREE.Vector3(agent.position[0], 0, agent.position[1]),
  );
  useFrame(({ clock }, dt) => {
    if (!group.current || !body.current) return;
    const target = new THREE.Vector3(agent.position[0], 0, agent.position[1]);
    group.current.position.lerp(target, Math.min(1, dt * 12));
    const moving = last.current.distanceTo(target) > 0.003;
    if (moving) {
      const angle = Math.atan2(
        target.x - last.current.x,
        target.z - last.current.z,
      );
      body.current.rotation.y = THREE.MathUtils.lerp(
        body.current.rotation.y,
        angle,
        0.2,
      );
    }
    body.current.position.y = moving
      ? Math.abs(Math.sin(clock.elapsedTime * 8)) * 0.055
      : Math.sin(clock.elapsedTime * 2) * 0.015;
    const hit = time - agent.lastHitAt < 0.8;
    body.current.rotation.z = hit
      ? Math.sin(clock.elapsedTime * 28) * 0.12
      : THREE.MathUtils.lerp(body.current.rotation.z, 0, 0.18);
    last.current.copy(target);
  });
  return (
    <group
      ref={group}
      position={[agent.position[0], 0, agent.position[1]]}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry
          args={[selected ? 0.48 : 0.28, selected ? 0.56 : 0.32, 40]}
        />
        <meshBasicMaterial
          color={selected ? "#efffa9" : agent.color}
          transparent
          opacity={0.8}
        />
      </mesh>
      <group ref={body}>
        <mesh castShadow position={[0, 0.69, 0]}>
          <capsuleGeometry args={[0.22, 0.4, 4, 8]} />
          <meshStandardMaterial
            color={time - agent.lastHitAt < 0.8 ? "#d65d4c" : agent.color}
          />
        </mesh>
        <mesh castShadow position={[0, 1.17, 0]}>
          <sphereGeometry args={[0.2, 12, 12]} />
          <meshStandardMaterial color="#d9b49a" />
        </mesh>
        <mesh castShadow position={[0, 1.28, -0.02]}>
          <sphereGeometry
            args={[0.205, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55]}
          />
          <meshStandardMaterial
            color={agent.id === "oren" ? "#bbbdac" : "#3d4539"}
          />
        </mesh>
        {[-1, 1].map((x) => (
          <group key={x}>
            <Box
              position={[x * 0.12, 0.2, 0]}
              scale={[0.15, 0.4, 0.17]}
              color="#394c45"
            />
            <Box
              position={[x * 0.32, 0.65, 0]}
              scale={[0.12, 0.4, 0.13]}
              color={agent.color}
            />
          </group>
        ))}
      </group>
      <Html
        position={[0, 1.85, 0]}
        center
        distanceFactor={22}
        style={{ pointerEvents: "none" }}
      >
        <div className={`agent-tag ${selected ? "selected" : ""}`}>
          <i style={{ background: agent.color }} />
          {agent.name}
        </div>
      </Html>
      {agent.messageUntil > time && (
        <Html position={[0, 2.7, 0]} center distanceFactor={22}>
          <div className="speech-bubble">{agent.message}</div>
        </Html>
      )}
    </group>
  );
}

function Meadow({ world }: { world: World }) {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial
          color={world.instance.groundColor}
          roughness={1}
        />
      </mesh>
      <mesh position={[0, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[13.5, 13.62, 96]} />
        <meshBasicMaterial color="#dce7b9" transparent opacity={0.6} />
      </mesh>
      {Array.from({ length: 34 }, (_, index) => {
        const angle = index * 2.399;
        const radius = 16 + (index % 5) * 2.8;
        return (
          <group
            key={index}
            position={[Math.cos(angle) * radius, 0, Math.sin(angle) * radius]}
          >
            <mesh position={[0, 0.55, 0]} castShadow>
              <cylinderGeometry args={[0.11, 0.18, 1.3, 6]} />
              <meshStandardMaterial color="#5e6b43" />
            </mesh>
            <mesh position={[0, 1.55, 0]} castShadow>
              <icosahedronGeometry args={[0.9 + (index % 3) * 0.2, 0]} />
              <meshStandardMaterial color={index % 2 ? "#4d7545" : "#638653"} />
            </mesh>
          </group>
        );
      })}
    </>
  );
}

function Camera({ reset }: { reset: number }) {
  const controls = useRef<OrbitImpl>(null);
  const previous = useRef(reset);
  useFrame(() => {
    if (previous.current !== reset && controls.current) {
      controls.current.object.position.set(22, 22, 28);
      controls.current.target.set(0, 0, 0);
      controls.current.update();
      previous.current = reset;
    }
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={[0, 0, 0]}
      minDistance={12}
      maxDistance={55}
      maxPolarAngle={Math.PI * 0.45}
      minPolarAngle={0.2}
      enableDamping
    />
  );
}

class RenderBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="render-fallback">
        3D rendering needs WebGL. Try a browser with hardware acceleration
        enabled.
      </div>
    ) : (
      this.props.children
    );
  }
}

export default function WorldView({
  world,
  selected,
  selectedObject,
  onSelect,
  onSelectObject,
  cameraReset,
}: {
  world: World;
  selected: string | null;
  selectedObject: string | null;
  onSelect: (id: string) => void;
  onSelectObject: (id: string) => void;
  cameraReset: number;
}) {
  const sky = world.storm ? "#82918a" : world.instance.skyColor;
  return (
    <RenderBoundary>
      <Canvas
        shadows
        dpr={[1, 1.25]}
        camera={{ position: [22, 22, 28], fov: 42 }}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.15;
        }}
      >
        <color attach="background" args={[sky]} />
        <fog attach="fog" args={[sky, 35, 85]} />
        <ambientLight intensity={world.storm ? 1.2 : 1.8} />
        <hemisphereLight args={["#eef6dd", world.instance.groundColor, 1.4]} />
        <directionalLight
          position={[-12, 22, 10]}
          intensity={world.storm ? 1 : 3}
          castShadow
          shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-25}
          shadow-camera-right={25}
          shadow-camera-top={25}
          shadow-camera-bottom={-25}
          shadow-bias={-0.001}
        />
        <Suspense fallback={null}>
          <Meadow world={world} />
          {world.objects.map((object) => (
            <WorldObjectView
              key={object.id}
              object={object}
              selected={selectedObject === object.id}
              onSelect={() => onSelectObject(object.id)}
            />
          ))}
          {world.agents.map((agent) => (
            <Character
              key={agent.id}
              agent={agent}
              selected={selected === agent.id}
              onSelect={() => onSelect(agent.id)}
              time={world.time}
            />
          ))}
          <ContactShadows
            position={[0, 0.02, 0]}
            opacity={0.22}
            scale={38}
            blur={2}
            far={6}
            resolution={256}
          />
        </Suspense>
        <Camera reset={cameraReset} />
      </Canvas>
    </RenderBoundary>
  );
}
