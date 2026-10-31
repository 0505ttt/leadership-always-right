import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createCharacterLibrary } from '../../../src/presentation/characters';

declare global {
  interface Window {
    __ENTRY_RENDER__?: { dataUrl: string; diagnostics: unknown };
    __ENTRY_RENDER_ERROR__?: string;
  }
}

async function render(): Promise<void> {
  const width = 1500;
  const height = 1200;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.18;
  document.body.append(renderer.domElement);
  renderer.domElement.style.cssText = 'position:fixed;left:-10000px;top:0';

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2.25, 2.25, 1.8, -1.8, .1, 40);
  camera.position.set(4.6, 3.0, 6.4);
  camera.lookAt(0, .88, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x9a9a94, 2.7));
  const key = new THREE.DirectionalLight(0xffffff, 4.1);
  key.position.set(2.5, 6, 4.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -5;
  key.shadow.camera.right = 5;
  key.shadow.camera.top = 5;
  key.shadow.camera.bottom = -5;
  key.shadow.bias = -.00015;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xdde5ff, 2.1);
  rim.position.set(-4, 3, -3);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: 0x1a1c1a, opacity: .16 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const assets = createCharacterLibrary({ assetBaseUrl: '/leadership-always-right/assets/tripo/' });
  await assets.prepare(renderer, camera, scene);
  const employee = assets.createEmployee();
  employee.update({ pose: 'rolling', moving: true, sprint: false, time: 1.4, holding: false, pot: 'none' });
  employee.root.position.set(.72, 0, .42);
  employee.root.rotation.y = -.42;
  scene.add(employee.root);

  const leader = assets.createLeader();
  leader.update({ pose: 'standing', moving: false, sprint: false, time: .6, holding: false, pot: 'none', gesturing: true });
  leader.root.position.set(-1.12, 0, -.42);
  leader.root.rotation.y = .28;
  scene.add(leader.root);

  scene.traverse(object => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });

  const pot = await new GLTFLoader().loadAsync('/leadership-always-right/assets/tripo/pot-v1.glb');
  pot.scene.position.set(.05, 1.5, .95);
  pot.scene.rotation.set(.12, -.5, -.28);
  pot.scene.scale.setScalar(1.35);
  scene.add(pot.scene);

  const deskMaterial = new THREE.MeshStandardMaterial({ color: 0xd7d5ce, roughness: .88, metalness: .02 });
  const deskEdge = new THREE.MeshStandardMaterial({ color: 0x252724, roughness: .72 });
  const desktop = new THREE.Mesh(new THREE.BoxGeometry(1.45, .075, .68), deskMaterial);
  desktop.position.set(-1.32, 1.02, -.78);
  desktop.castShadow = true;
  scene.add(desktop);
  for (const x of [-1.9, -.74]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.055, .96, .055), deskEdge);
    leg.position.set(x, .51, -.78);
    leg.castShadow = true;
    scene.add(leg);
  }

  renderer.render(scene, camera);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  window.__ENTRY_RENDER__ = {
    dataUrl,
    diagnostics: {
      employee: employee.getDiagnostics(),
      leader: leader.getDiagnostics(),
      renderer: renderer.info.render,
      assets: ['employee-base-v1', 'leader-v1', 'chair-v1', 'pot-v1'],
    },
  };
}

render().catch(error => {
  window.__ENTRY_RENDER_ERROR__ = error instanceof Error ? error.stack ?? error.message : String(error);
});
