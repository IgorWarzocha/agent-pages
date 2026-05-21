import { useEffect, useMemo, useRef, useState } from 'react';
import { PerspectiveCamera } from 'three/src/cameras/PerspectiveCamera.js';
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js';
import { IcosahedronGeometry } from 'three/src/geometries/IcosahedronGeometry.js';
import { PlaneGeometry } from 'three/src/geometries/PlaneGeometry.js';
import { DirectionalLight } from 'three/src/lights/DirectionalLight.js';
import { HemisphereLight } from 'three/src/lights/HemisphereLight.js';
import { Color } from 'three/src/math/Color.js';
import { MeshStandardMaterial } from 'three/src/materials/MeshStandardMaterial.js';
import type { Material } from 'three/src/materials/Material.js';
import { Mesh } from 'three/src/objects/Mesh.js';
import { WebGLRenderer } from 'three/src/renderers/WebGLRenderer.js';
import { Fog } from 'three/src/scenes/Fog.js';
import { Scene } from 'three/src/scenes/Scene.js';

type Pose = { x: number; z: number; yaw: number };

const artifactStyles = `
.walk3d{min-height:100vh;display:grid;grid-template-columns:minmax(220px,300px) minmax(0,1fr);gap:clamp(18px,3vw,38px);align-items:center;overflow:hidden}.walk3d-copy h1{max-width:8ch;margin:0;font-size:clamp(42px,5vw,78px);line-height:.86;letter-spacing:-.075em;text-wrap:balance}.walk3d-copy p:not(.eyebrow){max-width:34ch;color:var(--muted);font-size:15px;line-height:1.4;text-wrap:pretty}.walk3d-hud{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:18px}.walk3d-hud b{display:block;border-radius:18px;background:var(--panel);padding:14px;box-shadow:inset 0 0 0 1px var(--line);font-size:24px;line-height:1;letter-spacing:-.05em;font-variant-numeric:tabular-nums}.walk3d-hud span{display:block;margin-top:5px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.08em}.walk3d-copy button{min-height:40px;margin-top:18px;border:0;border-radius:999px;background:var(--accent);color:var(--accent-ink);padding:0 16px;font-weight:850;cursor:pointer}.walk3d-stage{position:relative;min-width:0;height:min(620px,76vh);border-radius:38px;background:#10121a;box-shadow:var(--shadow),inset 0 0 0 1px var(--line);overflow:hidden;touch-action:none}.walk3d-stage:focus{outline:2px solid var(--accent);outline-offset:4px}.walk3d-canvas{position:absolute;inset:0}.walk3d-canvas canvas{display:block;width:100%;height:100%}.walk3d-minimap{position:absolute;right:16px;top:16px;display:grid;grid-template-columns:repeat(9,12px);gap:3px;padding:12px;border-radius:18px;background:#10121acc;backdrop-filter:blur(12px);box-shadow:inset 0 0 0 1px #ffffff18}.walk3d-minimap i{width:12px;height:12px;border-radius:3px;background:#ffffff12}.walk3d-minimap i.wall{background:#969db744}.walk3d-minimap i.gem{background:#f0c674}.walk3d-minimap i.exit{background:#86d9a0}.walk3d-minimap i.you{background:#b9bff3;border-radius:999px;box-shadow:0 0 0 2px #b9bff344}.walk3d-banner{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;gap:8px;align-items:center;border-radius:999px;background:#10121acc;color:#eef0ff;padding:10px 14px;backdrop-filter:blur(12px);font-size:13px;font-weight:800}.walk3d-banner kbd{border-radius:8px;background:#ffffff18;padding:4px 7px;font:inherit}.walk3d-win{position:absolute;inset:0;display:grid;place-items:center;background:#10121aaa;backdrop-filter:blur(8px);z-index:4}.walk3d-win div{width:min(360px,80%);border-radius:30px;background:var(--panel);padding:26px;text-align:center;box-shadow:var(--shadow)}.walk3d-win b{display:block;font-size:44px;line-height:.88;letter-spacing:-.07em}.walk3d-win p{color:var(--muted)}@media(max-width:1000px){.walk3d{grid-template-columns:1fr;align-content:start;overflow:visible}.walk3d-stage{height:560px}.walk3d-copy h1{max-width:12ch}.walk3d-copy p:not(.eyebrow){max-width:58ch}}@media(max-width:560px){.walk3d-stage{height:520px;border-radius:28px}.walk3d-minimap{grid-template-columns:repeat(9,9px)}.walk3d-minimap i{width:9px;height:9px}.walk3d-banner{display:none}}
`;

const maze = [
  '#########',
  '#...#...#',
  '#.#.#.#G#',
  '#.#...#.#',
  '#.###.#.#',
  '#G....#.#',
  '###.###.#',
  '#S....GE#',
  '#########',
];

const start: Pose = { x: 1.5, z: 7.5, yaw: -Math.PI / 2 };
const gems = maze.flatMap((row, z) => [...row].map((cell, x) => cell === 'G' ? `${x},${z}` : '').filter(Boolean));

function cellAt(x: number, z: number) {
  return maze[Math.floor(z)]?.[Math.floor(x)] ?? '#';
}

function canStandAt(x: number, z: number) {
  const radius = .22;
  return cellAt(x - radius, z - radius) !== '#' && cellAt(x + radius, z - radius) !== '#' && cellAt(x - radius, z + radius) !== '#' && cellAt(x + radius, z + radius) !== '#';
}

export default function MazeWalkerDemo() {
  const mountRef = useRef<HTMLDivElement>(null);
  const poseRef = useRef<Pose>(start);
  const keysRef = useRef(new Set<string>());
  const [pose, setPose] = useState(start);
  const [collected, setCollected] = useState<Set<string>>(() => new Set());
  const collectedRef = useRef(collected);
  const won = Math.floor(pose.x) === 7 && Math.floor(pose.z) === 7 && collected.size === gems.length;

  const gemCells = useMemo(() => new Set(gems), []);

  function reset() {
    poseRef.current = start;
    setPose(start);
    collectedRef.current = new Set();
    setCollected(new Set());
    mountRef.current?.parentElement?.focus();
  }

  useEffect(() => { collectedRef.current = collected; }, [collected]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const scene = new Scene();
    scene.background = new Color(0x11131a);
    scene.fog = new Fog(0x11131a, 4, 13);

    const camera = new PerspectiveCamera(72, 1, .1, 70);
    camera.position.set(start.x, .78, start.z);

    const renderer = new WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    scene.add(new HemisphereLight(0xb9bff3, 0x141722, 1.8));
    const keyLight = new DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(4, 8, 5);
    keyLight.castShadow = true;
    scene.add(keyLight);

    const floor = new Mesh(new PlaneGeometry(9, 9), new MeshStandardMaterial({ color: 0x252939, roughness: .9, metalness: .05 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(4.5, 0, 4.5);
    floor.receiveShadow = true;
    scene.add(floor);

    const wallGeometry = new BoxGeometry(1, 1.55, 1);
    const wallMaterial = new MeshStandardMaterial({ color: 0x343848, roughness: .68, metalness: .05 });
    const exitMaterial = new MeshStandardMaterial({ color: 0x86d9a0, emissive: 0x244d32, roughness: .45 });
    const gemGeometry = new IcosahedronGeometry(.22, 1);
    const gemMaterial = new MeshStandardMaterial({ color: 0xf0c674, emissive: 0x8a651a, roughness: .2, metalness: .35 });
    const gemMeshes = new Map<string, Mesh>();

    maze.forEach((row, z) => [...row].forEach((cell, x) => {
      if (cell === '#') {
        const wall = new Mesh(wallGeometry, wallMaterial);
        wall.position.set(x + .5, .775, z + .5);
        wall.castShadow = true;
        wall.receiveShadow = true;
        scene.add(wall);
      }
      if (cell === 'E') {
        const exit = new Mesh(new BoxGeometry(.82, 1.8, .18), exitMaterial);
        exit.position.set(x + .5, .9, z + .88);
        scene.add(exit);
      }
      if (cell === 'G') {
        const gem = new Mesh(gemGeometry, gemMaterial);
        gem.position.set(x + .5, .55, z + .5);
        gem.castShadow = true;
        gemMeshes.set(`${x},${z}`, gem);
        scene.add(gem);
      }
    }));

    const resize = () => {
      const rect = mount.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    let frame = 0;
    let last = performance.now();
    const tick = (time: number) => {
      const dt = Math.min(.04, (time - last) / 1000);
      last = time;
      const keys = keysRef.current;
      const current = poseRef.current;
      let next: Pose = { ...current };
      const turn = 2.15 * dt;
      const speed = 2.35 * dt;
      if (keys.has('arrowleft')) next.yaw += turn;
      if (keys.has('arrowright')) next.yaw -= turn;
      const forward = Number(keys.has('w') || keys.has('arrowup')) - Number(keys.has('s') || keys.has('arrowdown'));
      const side = Number(keys.has('d')) - Number(keys.has('a'));
      const dx = -Math.sin(next.yaw) * forward * speed + Math.cos(next.yaw) * side * speed;
      const dz = -Math.cos(next.yaw) * forward * speed - Math.sin(next.yaw) * side * speed;
      if (dx || dz) {
        if (canStandAt(next.x + dx, next.z)) next.x += dx;
        if (canStandAt(next.x, next.z + dz)) next.z += dz;
      }
      poseRef.current = next;
      camera.position.set(next.x, .78, next.z);
      camera.rotation.set(0, next.yaw, 0);

      const cell = `${Math.floor(next.x)},${Math.floor(next.z)}`;
      if (gemCells.has(cell) && !collectedRef.current.has(cell)) {
        const updated = new Set(collectedRef.current).add(cell);
        collectedRef.current = updated;
        setCollected(updated);
      }
      gemMeshes.forEach((mesh, key) => {
        mesh.visible = !collectedRef.current.has(key);
        mesh.rotation.y += dt * 1.8;
        mesh.position.y = .55 + Math.sin(time / 260 + mesh.position.x) * .06;
      });
      renderer.render(scene, camera);
      setPose(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      renderer.dispose();
      wallGeometry.dispose();
      wallMaterial.dispose();
      floor.geometry.dispose();
      (floor.material as Material).dispose();
      gemGeometry.dispose();
      gemMaterial.dispose();
      exitMaterial.dispose();
      mount.replaceChildren();
    };
  }, [gemCells]);

  useEffect(() => {
    mountRef.current?.parentElement?.focus();
    const down = (event: KeyboardEvent) => keysRef.current.add(event.key.toLowerCase());
    const up = (event: KeyboardEvent) => keysRef.current.delete(event.key.toLowerCase());
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  return <><style>{artifactStyles}</style><main className="sheet walk3d"><section className="walk3d-copy"><p className="eyebrow">real 3d artifact</p><h1>Maze walker</h1><p>A small Three.js maze running inside a single artifact file. Walk the corridors, collect the three gold orbs, then find the green exit.</p><div className="walk3d-hud"><b>{collected.size}/{gems.length}<span>orbs</span></b><b>{Math.floor(pose.x)},{Math.floor(pose.z)}<span>grid</span></b></div><button onClick={reset}>Restart run</button></section><section className="walk3d-stage" tabIndex={0} aria-label="Maze walker game area"><div className="walk3d-canvas" ref={mountRef} /><div className="walk3d-minimap">{maze.flatMap((row, z) => [...row].map((cell, x) => { const key = `${x},${z}`; const className = Math.floor(pose.x) === x && Math.floor(pose.z) === z ? 'you' : cell === '#' ? 'wall' : cell === 'E' ? 'exit' : cell === 'G' && !collected.has(key) ? 'gem' : ''; return <i key={key} className={className} />; }))}</div><div className="walk3d-banner"><kbd>W/S</kbd><span>walk</span><kbd>A/D</kbd><span>strafe</span><kbd>←/→</kbd><span>turn</span></div>{won && <div className="walk3d-win"><div><b>Exit reached</b><p>You collected every orb and found the door.</p><button onClick={reset}>Play again</button></div></div>}</section></main></>;
}
