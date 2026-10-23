import { Canvas, useFrame } from "@react-three/fiber";
import { ContactShadows, Html, OrbitControls } from "@react-three/drei";
import { Component, Suspense, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitImpl } from "three-stdlib";
import { LAYOUTS, type Agent, type World } from "./engine";
const sand = "#b7b6a0",
  dark = "#3c5145",
  wall = "#d5d6b7";
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
function Habitat({
  x,
  z,
  w,
  d,
  index,
}: {
  x: number;
  z: number;
  w: number;
  d: number;
  index: number;
}) {
  return (
    <group position={[x, 0, z]}>
      <Box
        position={[0, 0.16, 0]}
        scale={[w + 0.35, 0.32, d + 0.35]}
        color="#667064"
      />
      <Box position={[0, 1.15, 0]} scale={[w, 2, d]} color={wall} />
      <Box
        position={[0, 2.2, 0]}
        scale={[w + 0.22, 0.22, d + 0.22]}
        color={dark}
      />
      <Box
        position={[0, 2.36, 0]}
        scale={[w - 0.6, 0.12, d - 0.6]}
        color="#7f9078"
      />
      <Box
        position={[0, 0.9, d / 2 + 0.02]}
        scale={[0.95, 1.65, 0.1]}
        color="#33473f"
      />
      <Box
        position={[-w / 2 + 0.9, 1.25, d / 2 + 0.07]}
        scale={[1.05, 0.65, 0.08]}
        color="#8cbaad"
      />
      <Box
        position={[w / 2 - 0.75, 1.3, d / 2 + 0.07]}
        scale={[0.65, 0.65, 0.08]}
        color="#8cbaad"
      />
      <Box
        position={[0, 1.8, d / 2 + 0.4]}
        scale={[1.7, 0.12, 1]}
        color="#9b9d7c"
      />
      <Html position={[0, 2.8, 0]} center distanceFactor={28}>
        <span className="world-label">
          {index === 0 ? "HABITAT / 01" : "RESEARCH / 02"}
        </span>
      </Html>
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          position={[-w / 2 + 0.5 + i * 0.8, 2.49, -0.2]}
          rotation={[-0.12, 0, 0]}
          scale={[0.65, 0.08, 1.6]}
          color="#344e56"
        />
      ))}
    </group>
  );
}
function Antenna({
  repair,
  position,
}: {
  repair: number;
  position: [number, number];
}) {
  const dish = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (dish.current && repair >= 100)
      dish.current.rotation.y = Math.sin(clock.elapsedTime * 0.3) * 0.3;
  });
  return (
    <group position={[position[0], 0, position[1]]}>
      <mesh receiveShadow position={[0, 0.15, 0]}>
        <cylinderGeometry args={[1.65, 1.85, 0.3, 8]} />
        <meshStandardMaterial color="#777f6e" />
      </mesh>
      {[-1, 1].map((x) => (
        <group key={x}>
          <Box
            position={[x * 0.6, 2, 0]}
            rotation={[0, 0, -x * 0.17]}
            scale={[0.13, 4, 0.13]}
            color="#536459"
          />
          <Box
            position={[0, 1.4, x * 0.45]}
            rotation={[0, 0, x * 0.65]}
            scale={[0.09, 2.1, 0.09]}
            color="#7c8a78"
          />
        </group>
      ))}
      <group ref={dish} position={[0, 4.1, 0]} rotation={[0, 0.4, 0]}>
        <mesh rotation={[Math.PI * 0.3, 0, 0]}>
          <sphereGeometry args={[1.45, 24, 12, 0, Math.PI * 2, 0, 0.85]} />
          <meshStandardMaterial
            color="#dbe0c3"
            side={THREE.DoubleSide}
            roughness={0.55}
          />
        </mesh>
        <Box
          position={[0, 0.8, 0.35]}
          rotation={[0.5, 0, 0]}
          scale={[0.1, 1.6, 0.1]}
          color="#4c6356"
        />
        <mesh position={[0, 1.55, 0.8]}>
          <sphereGeometry args={[0.14, 8, 8]} />
          <meshStandardMaterial
            color={repair >= 100 ? "#b4f486" : "#e6a263"}
            emissive={repair >= 100 ? "#8be668" : "#d77537"}
            emissiveIntensity={0.7}
          />
        </mesh>
      </group>
      <Html position={[0, 6.3, 0]} center distanceFactor={30}>
        <span className="world-label signal-label">
          UPLINK · {Math.floor(repair)}%
        </span>
      </Html>
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
  const group = useRef<THREE.Group>(null),
    body = useRef<THREE.Group>(null);
  const last = useRef(
    new THREE.Vector3(
      ...([agent.position[0], 0, agent.position[1]] as [
        number,
        number,
        number,
      ]),
    ),
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
    body.current.scale.setScalar(agent.health <= 0 ? 0.92 : 1);
    last.current.copy(target);
  });
  return (
    <group
      ref={group}
      position={[agent.position[0], 0, agent.position[1]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry
          args={[selected ? 0.48 : 0.28, selected ? 0.56 : 0.32, 40]}
        />
        <meshBasicMaterial
          color={selected ? "#d8f49e" : agent.color}
          transparent
          opacity={selected ? 0.9 : 0.55}
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
        <Box
          position={[0, 0.73, -0.23]}
          scale={[0.33, 0.38, 0.16]}
          color="#67745b"
        />
      </group>
      <Html
        position={[0, 1.85, 0]}
        center
        distanceFactor={22}
        style={{ pointerEvents: "none" }}
      >
        <div className={"agent-tag " + (selected ? "selected" : "")}>
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
function Environment({ world }: { world: World }) {
  const layout = LAYOUTS[world.instance.layout];
  const palette = {
    woodland: { outer: "#9da58b", island: sand, path: "#c6c7ae" },
    desert: { outer: "#c4aa7c", island: "#d5bd91", path: "#e4cfaa" },
    tundra: { outer: "#b8c7c5", island: "#d9ded5", path: "#ecede4" },
  }[world.instance.biome];
  const supplies = layout.places.supplies;
  const shelter = layout.places.shelter;
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color={palette.outer} />
      </mesh>
      <mesh position={[0, -0.34, 0]} receiveShadow>
        <cylinderGeometry args={[16, 17, 0.7, 64]} />
        <meshStandardMaterial color={palette.island} />
      </mesh>
      <mesh position={[0, 0.025, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[13.4, 13.46, 100]} />
        <meshBasicMaterial color="#d9dbc3" transparent opacity={0.65} />
      </mesh>
      <Box
        position={[0, 0.045, -2.3]}
        scale={[2.6, 0.07, 8.5]}
        color={palette.path}
      />
      <Box
        position={[0, 0.04, 3.2]}
        scale={[12, 0.07, 2]}
        color={palette.path}
      />
      {layout.obstacles.map((o, i) => (
        <Habitat key={i} {...o} index={i} />
      ))}
      <group position={[supplies[0], 0, supplies[1]]}>
        {[0, 1, 2].map((i) => (
          <Box
            key={i}
            position={[(i % 2) * 0.9, 0.4 + Math.floor(i / 2) * 0.75, 0]}
            scale={[0.8, 0.75, 0.8]}
            color={i === 2 ? "#c39f68" : "#7b9277"}
          />
        ))}
        <Html position={[0, 1.9, 0]} center distanceFactor={25}>
          <span className="world-label">SUPPLIES</span>
        </Html>
      </group>
      <group position={[shelter[0], 0, shelter[1]]}>
        <Box position={[0, 0.15, 0]} scale={[3, 0.3, 2.6]} color="#8d957b" />
        {[-1, 1].map((i) => (
          <Box
            key={i}
            position={[i * 1.25, 1.1, 0]}
            scale={[0.09, 2.2, 0.09]}
            color={dark}
          />
        ))}
        <Box
          position={[0, 2.2, 0]}
          rotation={[0, 0, 0.06]}
          scale={[3.5, 0.12, 3]}
          color="#a1ab7c"
        />
        <Box position={[0, 0.5, 0.5]} scale={[2, 0.2, 0.6]} color="#5c735e" />
        <Html position={[0, 2.9, 0]} center distanceFactor={25}>
          <span className="world-label">REST SHELTER</span>
        </Html>
      </group>
      <mesh position={[0, 0.25, 2]}>
        <cylinderGeometry args={[0.65, 0.8, 0.5, 8]} />
        <meshStandardMaterial color="#6d7665" />
      </mesh>
      {[0, 1, 2].map((i) => (
        <group
          key={i}
          position={[Math.cos(i * 2.09) * 1.3, 0, 2 + Math.sin(i * 2.09) * 1.3]}
        >
          <Box
            position={[0, 0.22, 0]}
            scale={[0.85, 0.4, 0.45]}
            color="#819076"
          />
        </group>
      ))}
      {Array.from({ length: 30 }, (_, i) => {
        const angle = i * 2.399,
          r = 17 + (i % 4) * 3;
        return (
          <group
            key={i}
            position={[Math.cos(angle) * r, -0.05, Math.sin(angle) * r]}
          >
            <mesh position={[0, 0.5, 0]} castShadow>
              <cylinderGeometry args={[0.12, 0.2, 1.4, 5]} />
              <meshStandardMaterial color="#69755a" />
            </mesh>
            <mesh position={[0, 1.5, 0]} castShadow>
              <icosahedronGeometry args={[1 + (i % 3) * 0.25, 0]} />
              <meshStandardMaterial color={i % 2 ? "#72836b" : "#829174"} />
            </mesh>
          </group>
        );
      })}
      {Array.from({ length: 16 }, (_, i) => (
        <mesh
          key={i}
          position={[
            Math.cos(i * 2.4) * (12 + (i % 2)),
            0.16,
            Math.sin(i * 2.4) * (11 + (i % 3)),
          ]}
          rotation={[i, 0, i]}
          castShadow
        >
          <dodecahedronGeometry args={[0.2 + (i % 3) * 0.08, 0]} />
          <meshStandardMaterial color="#8d9480" />
        </mesh>
      ))}
      <group position={[-8, 0, 5]}>
        {[0, 1].map((i) => (
          <group key={i} position={[i * 1.7, 0, 0]}>
            <Box
              position={[0, 0.2, 0]}
              scale={[1.25, 0.4, 3]}
              color="#7b8469"
            />
            <Box
              position={[0, 0.43, 0]}
              scale={[1.05, 0.1, 2.8]}
              color="#555f43"
            />
            {[0, 1, 2, 3].map((j) => (
              <mesh key={j} position={[0, 0.62, -1 + j * 0.65]}>
                <icosahedronGeometry args={[0.3, 0]} />
                <meshStandardMaterial color="#8d9f65" />
              </mesh>
            ))}
          </group>
        ))}
      </group>
      <group position={[9, 0, 7]} rotation={[0, -0.3, 0]}>
        {[0, 1].map((i) => (
          <group key={i} position={[i * 1.6, 0, 0]}>
            <Box
              position={[0, 0.7, 0]}
              scale={[0.1, 1.4, 0.1]}
              color="#5b6f60"
            />
            <Box
              position={[0, 1.25, 0]}
              rotation={[-0.35, 0, 0]}
              scale={[1.4, 0.1, 2.2]}
              color="#3e6266"
            />
            {[-0.45, 0, 0.45].map((z) => (
              <Box
                key={z}
                position={[z, 1.31, 0]}
                rotation={[-0.35, 0, 0]}
                scale={[0.025, 0.015, 2.2]}
                color="#72958f"
              />
            ))}
          </group>
        ))}
      </group>
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
        enabled. The observer controls and simulation remain available.
      </div>
    ) : (
      this.props.children
    );
  }
}
export default function WorldView({
  world,
  selected,
  onSelect,
  cameraReset,
}: {
  world: World;
  selected: string | null;
  onSelect: (id: string) => void;
  cameraReset: number;
}) {
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
        fallback={
          <div className="render-fallback">
            This browser does not support WebGL. Try enabling hardware
            acceleration.
          </div>
        }
      >
        <color
          attach="background"
          args={[world.storm ? "#899b94" : "#c4ccb6"]}
        />
        <fog
          attach="fog"
          args={[world.storm ? "#899b94" : "#c4ccb6", 35, 85]}
        />
        <ambientLight intensity={world.storm ? 1.4 : 1.8} />
        <hemisphereLight args={["#e6edda", "#a7a989", 1.4]} />
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
          <Environment world={world} />
          <Antenna
            repair={world.repair}
            position={LAYOUTS[world.instance.layout].places.antenna}
          />
          {world.agents.map((a) => (
            <Character
              key={a.id}
              agent={a}
              selected={selected === a.id}
              onSelect={() => onSelect(a.id)}
              time={world.time}
            />
          ))}
          <ContactShadows
            position={[0, 0.02, 0]}
            opacity={0.2}
            scale={38}
            blur={2}
            far={5}
            resolution={256}
            frames={1}
          />
        </Suspense>
        <Camera reset={cameraReset} />
      </Canvas>
    </RenderBoundary>
  );
}
