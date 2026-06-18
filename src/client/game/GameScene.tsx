import { Html, OrbitControls, Sparkles, Text } from "@react-three/drei";
import { Canvas, ThreeEvent, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { CatalogItem, HomeState, PublicUser, RemotePlayer } from "../types";

type GameSceneProps = {
  user: PublicUser;
  home: HomeState;
  catalog: CatalogItem[];
  remotePlayers: RemotePlayer[];
  onMove: (position: { x: number; y: number; z: number; rotation?: number }) => void;
  onInteract: (itemId: string, action: string) => void;
};

const floorSize = 9;

function getItem(catalog: CatalogItem[], itemId: string) {
  return catalog.find((item) => item.id === itemId);
}

function Player({
  username,
  color,
  position,
  isSelf = false,
  petColor
}: {
  username: string;
  color: string;
  position: THREE.Vector3;
  isSelf?: boolean;
  petColor?: string;
}) {
  const group = useRef<THREE.Group>(null);
  const bob = useRef(0);

  useFrame((_, delta) => {
    bob.current += delta * 4;
    if (group.current) {
      group.current.position.lerp(position, Math.min(1, delta * 7));
      group.current.children[0].position.y = Math.sin(bob.current) * 0.035;
    }
  });

  return (
    <group ref={group} position={position}>
      <group>
        <mesh castShadow position={[0, 0.74, 0]}>
          <capsuleGeometry args={[0.28, 0.72, 8, 16]} />
          <meshStandardMaterial color={color} roughness={0.55} metalness={0.08} />
        </mesh>
        <mesh castShadow position={[0, 1.34, 0]}>
          <sphereGeometry args={[0.26, 24, 24]} />
          <meshStandardMaterial color="#ffe1c7" roughness={0.7} />
        </mesh>
        <mesh castShadow position={[0, 1.57, -0.03]}>
          <sphereGeometry args={[0.3, 24, 14]} />
          <meshStandardMaterial color={isSelf ? "#ff8ab3" : "#8b5cf6"} roughness={0.5} />
        </mesh>
        <mesh castShadow position={[-0.2, 1.58, 0.03]} rotation={[0.3, 0, -0.2]}>
          <coneGeometry args={[0.09, 0.25, 12]} />
          <meshStandardMaterial color={isSelf ? "#ff8ab3" : "#8b5cf6"} />
        </mesh>
        <mesh castShadow position={[0.2, 1.58, 0.03]} rotation={[0.3, 0, 0.2]}>
          <coneGeometry args={[0.09, 0.25, 12]} />
          <meshStandardMaterial color={isSelf ? "#ff8ab3" : "#8b5cf6"} />
        </mesh>
      </group>
      {petColor ? (
        <group position={[0.55, 0, 0.45]}>
          <mesh castShadow position={[0, 0.23, 0]}>
            <sphereGeometry args={[0.2, 18, 18]} />
            <meshStandardMaterial color={petColor} roughness={0.6} />
          </mesh>
          <mesh castShadow position={[0.12, 0.38, 0]}>
            <sphereGeometry args={[0.12, 16, 16]} />
            <meshStandardMaterial color={petColor} roughness={0.6} />
          </mesh>
        </group>
      ) : null}
      <Text position={[0, 1.95, 0]} fontSize={0.18} color="#ffffff" anchorX="center">
        {username}
      </Text>
    </group>
  );
}

function PlacedObject({
  item,
  x,
  z,
  rotation,
  onInteract
}: {
  item: CatalogItem;
  x: number;
  z: number;
  rotation: number;
  onInteract: (itemId: string, action: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const size = item.size ?? [0.9, 0.9, 0.9];
  const isRug = item.id.includes("rug") || item.id.includes("floor");
  const isLamp = item.id.includes("lamp") || item.id.includes("neon");
  const isPlant = item.id.includes("plant") || item.id.includes("bonsai");

  return (
    <group
      position={[x, size[1] / 2, z]}
      rotation={[0, rotation, 0]}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onClick={(event) => {
        event.stopPropagation();
        onInteract(item.id, item.type === "furniture" ? "use" : "look");
      }}
    >
      {isRug ? (
        <mesh receiveShadow position={[0, -size[1] / 2 + 0.04, 0]}>
          <boxGeometry args={size} />
          <meshStandardMaterial color={item.color} roughness={0.9} />
        </mesh>
      ) : isLamp ? (
        <>
          <mesh castShadow position={[0, -0.2, 0]}>
            <cylinderGeometry args={[0.12, 0.18, size[1] * 0.8, 16]} />
            <meshStandardMaterial color="#27272a" roughness={0.45} />
          </mesh>
          <mesh castShadow position={[0, size[1] * 0.32, 0]}>
            <sphereGeometry args={[Math.max(size[0], size[2]) * 0.34, 24, 24]} />
            <meshStandardMaterial color={item.color} emissive={item.color} emissiveIntensity={0.6} />
          </mesh>
          <pointLight color={item.color} intensity={1.5} distance={3.2} position={[0, size[1] * 0.45, 0]} />
        </>
      ) : isPlant ? (
        <>
          <mesh castShadow position={[0, -0.25, 0]}>
            <cylinderGeometry args={[0.25, 0.32, 0.45, 16]} />
            <meshStandardMaterial color="#7c2d12" roughness={0.8} />
          </mesh>
          <mesh castShadow position={[0, 0.2, 0]}>
            <coneGeometry args={[0.45, 1.05, 18]} />
            <meshStandardMaterial color={item.color} roughness={0.7} />
          </mesh>
        </>
      ) : (
        <mesh castShadow receiveShadow>
          <boxGeometry args={size} />
          <meshStandardMaterial color={item.color} roughness={0.5} metalness={item.rarity === "legendary" ? 0.25 : 0.05} />
        </mesh>
      )}
      {hovered ? (
        <Html center position={[0, size[1] + 0.28, 0]}>
          <div className="object-tip">{item.emoji} {item.name}</div>
        </Html>
      ) : null}
    </group>
  );
}

function World({
  user,
  home,
  catalog,
  remotePlayers,
  onMove,
  onInteract
}: GameSceneProps) {
  const target = useRef(new THREE.Vector3(0, 0, 1.2));
  const selfPosition = useRef(new THREE.Vector3(0, 0, 1.2));
  const [renderPosition, setRenderPosition] = useState(new THREE.Vector3(0, 0, 1.2));
  const outfit = getItem(catalog, user.avatar.outfit);
  const pet = user.avatar.pet ? getItem(catalog, user.avatar.pet) : undefined;

  const remoteVectors = useMemo(
    () =>
      remotePlayers.map((player) => ({
        ...player,
        vector: new THREE.Vector3(player.position.x, player.position.y, player.position.z)
      })),
    [remotePlayers]
  );

  useFrame((_, delta) => {
    selfPosition.current.lerp(target.current, Math.min(1, delta * 4));
    setRenderPosition(selfPosition.current.clone());
  });

  function handleFloorClick(event: ThreeEvent<MouseEvent>) {
    const next = event.point.clone();
    next.x = THREE.MathUtils.clamp(next.x, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    next.z = THREE.MathUtils.clamp(next.z, -floorSize / 2 + 0.4, floorSize / 2 - 0.4);
    next.y = 0;
    target.current = next;
    onMove({ x: next.x, y: next.y, z: next.z });
  }

  return (
    <>
      <color attach="background" args={["#14151c"]} />
      <fog attach="fog" args={["#14151c", 10, 22]} />
      <ambientLight intensity={0.72} />
      <directionalLight castShadow intensity={2.7} position={[3, 7, 5]} shadow-mapSize={[2048, 2048]} />
      <pointLight color="#f8b4d9" intensity={1.2} position={[-3.5, 3.5, -2.8]} />
      <Sparkles count={42} scale={[8, 2, 8]} size={1.7} speed={0.25} color="#ffd1e8" />
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} onClick={handleFloorClick}>
        <planeGeometry args={[floorSize, floorSize]} />
        <meshStandardMaterial color="#252633" roughness={0.82} />
      </mesh>
      <gridHelper args={[floorSize, 9, "#3b82f6", "#3a3a48"]} position={[0, 0.015, 0]} />
      <mesh receiveShadow position={[0, 1.25, -floorSize / 2]}>
        <boxGeometry args={[floorSize, 2.5, 0.18]} />
        <meshStandardMaterial color="#303346" roughness={0.75} />
      </mesh>
      <mesh receiveShadow position={[-floorSize / 2, 1.25, 0]}>
        <boxGeometry args={[0.18, 2.5, floorSize]} />
        <meshStandardMaterial color="#353449" roughness={0.75} />
      </mesh>
      {home.placedItems.map((placed) => {
        const item = getItem(catalog, placed.itemId);
        if (!item) {
          return null;
        }
        return (
          <PlacedObject
            key={placed.instanceId}
            item={item}
            x={placed.x}
            z={placed.z}
            rotation={placed.rotation}
            onInteract={onInteract}
          />
        );
      })}
      <Player username={user.username} color={outfit?.color ?? "#ff8ab3"} position={renderPosition} isSelf petColor={pet?.color} />
      {remoteVectors.map((player) => (
        <Player key={player.username} username={player.username} color="#8b5cf6" position={player.vector} />
      ))}
      <OrbitControls makeDefault enablePan={false} maxPolarAngle={Math.PI / 2.25} minDistance={5.2} maxDistance={11} />
    </>
  );
}

export function GameScene(props: GameSceneProps) {
  return (
    <Canvas shadows camera={{ position: [5.2, 5.1, 6.8], fov: 42 }}>
      <World {...props} />
    </Canvas>
  );
}

