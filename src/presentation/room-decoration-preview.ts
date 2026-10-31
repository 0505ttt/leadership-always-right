import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { generateWorld } from '../world/generate';
import { VisualResourcePool, addBox } from './visual-utils';
import { createRoomDecorations, type RoomDecorationModelId, type RoomDecorationUpdateState } from './room-decorations';

type ViewMode = 'game' | 'sign' | 'material' | 'overview';
const previewParams = new URLSearchParams(location.search);
const requestedSeed = Number(previewParams.get('seed') ?? '42');
const world = generateWorld(Number.isFinite(requestedSeed) ? requestedSeed : 42);
document.querySelector<HTMLParagraphElement>('.masthead .eyebrow')!.textContent = `ROOM ART INSPECTION · ${world.seed}`;
const canvas = document.querySelector<HTMLCanvasElement>('#scene')!;
const loading = document.querySelector<HTMLDivElement>('#loading')!;
const loadingDetail = document.querySelector<HTMLParagraphElement>('#loading-detail')!;
const descriptions: Record<string, string> = {
  front: '深色公司主牌、访客登记与低接待台，入口保持开阔。',
  meeting: '议程白板与六座低会议组合，不在房间中央增加隔断。',
  print: '打印柜、纸架、待取与重印分区，纸张有了明确去处。',
  storage: '编号档案、旧流程索引与归还低柜，保留竖向节奏。',
  tea: '杯架、值日板、饮水器和旧木柜台，停顿但不堵路。',
  boss: '正式低柜、织物地毯与年度解释权奖牌。',
  admin: '一次告知事项板、编号表单与文件流转柜。',
  work: '职能看板、贴墙文件车与桌沿部门签，不复制更多桌子。',
};
const assetRoot = `${import.meta.env.BASE_URL}assets/`;
const modelPaths: Record<string, string> = {
  'printer-v1': `${assetRoot}office-props/printer-v1.glb`,
  'storage-shelf-v1': `${assetRoot}office-props/storage-shelf-v1.glb`,
  'mug-v1': `${assetRoot}office-props/mug-v1.glb`,
  'paper-stack-v1': `${assetRoot}office-props/paper-stack-v1.glb`,
  'stationery-v1': `${assetRoot}office-props/stationery-v1.glb`,
  'water-station-v1': `${assetRoot}office-props/water-station-v1.glb`,
  'box-v1': `${assetRoot}tripo/box-v1.glb`,
  'plant-v1': `${assetRoot}tripo/plant-v1.glb`,
  'computer-set-v1': `${assetRoot}tripo/computer-set-v1.glb`,
  'chair-v1': `${assetRoot}tripo/chair-v1.glb`,
};

function previewShell(scene: THREE.Scene): { updateDesks(heights: Record<string, number>): void; getDeskSurfaceHeight(id: string): number | undefined; dispose(): void } {
  const pool = new VisualResourcePool();
  const root = new THREE.Group(); root.name = 'room-decoration-preview-shell';
  const deskTops = new Map<string, THREE.Mesh>();
  const deskLegs = new Map<string, THREE.Mesh[]>();
  const floor = pool.material({ color: 0x75827a, roughness: .97 }); floor.name = 'preview.floor';
  const wall = pool.material({ color: 0xc4c9b8, roughness: .94 }); wall.name = 'preview.wall';
  const trim = pool.material({ color: 0x303b37, roughness: .76 }); trim.name = 'preview.trim';
  const wood = pool.material({ color: 0xa78962, roughness: .73 }); wood.name = 'preview.desk';
  const metal = pool.material({ color: 0x66736c, roughness: .48, metalness: .5 }); metal.name = 'preview.desk-metal';
  for (const room of world.rooms) {
    const floorMesh = addBox(root, pool, floor, [room.w, .1, room.d], [room.x, -.055, room.z]);
    floorMesh.castShadow = false;
  }
  for (const item of world.walls) {
    const height = item.crawl ? item.height - .95 : item.height;
    addBox(root, pool, wall, [item.w, height, item.d], [item.x, item.crawl ? (item.height + .95) / 2 : height / 2, item.z]).name = `preview-wall:${item.id}`;
    if (!item.crawl) addBox(root, pool, trim, [item.w + .01, .11, item.d + .01], [item.x, .055, item.z]);
    addBox(root, pool, metal, [item.w + .012, .025, item.d + .012], [item.x, item.partition ? height - .0125 : 2.64, item.z]);
  }
  for (const desk of world.desks) {
    const frame = new THREE.Group(); frame.position.set(desk.x, 0, desk.z); frame.rotation.y = desk.yaw; frame.name = `preview-desk:${desk.id}`;
    const top = addBox(frame, pool, wood, [1.6, .085, .85], [0, .707, 0]);
    top.name = `preview-desktop:${desk.id}`;
    deskTops.set(desk.id, top);
    const legs: THREE.Mesh[] = [];
    for (const side of [-1, 1]) legs.push(addBox(frame, pool, metal, [.075, .68, .65], [side * .69, .34, 0]));
    deskLegs.set(desk.id, legs);
    root.add(frame);
  }
  scene.add(root);
  return {
    updateDesks(heights) {
      for (const desk of world.desks) {
        const height = heights[desk.id] ?? .75;
        const top = deskTops.get(desk.id);
        if (top) top.position.y = height - .043;
        const legHeight = Math.max(.1, height - .07);
        for (const leg of deskLegs.get(desk.id) ?? []) { leg.scale.y = legHeight / .68; leg.position.y = legHeight / 2; }
      }
    },
    getDeskSurfaceHeight(id) { const top = deskTops.get(id); return top ? top.position.y + .043 : undefined; },
    dispose() { root.removeFromParent(); pool.dispose(); },
  };
}

async function start(): Promise<void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x28352f);
  scene.fog = new THREE.Fog(0x28352f, 34, 74);
  const camera = new THREE.PerspectiveCamera(53, window.innerWidth / window.innerHeight, .045, 110);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = .12; controls.minDistance = .45; controls.maxDistance = 24; controls.maxPolarAngle = Math.PI * .51;
  scene.add(new THREE.HemisphereLight(0xd8e0dc, 0x42493d, 1.2));
  const daylight = new THREE.DirectionalLight(0xffe9c9, 1.9); daylight.position.set(-16, 29, 12); daylight.castShadow = true;
  daylight.shadow.mapSize.set(2048, 2048); daylight.shadow.camera.left = -29; daylight.shadow.camera.right = 29; daylight.shadow.camera.top = 25; daylight.shadow.camera.bottom = -25; daylight.shadow.camera.far = 70; daylight.shadow.bias = -.0004;
  scene.add(daylight);
  for (const room of world.rooms) {
    const light = new THREE.PointLight(room.kind === 'boss' ? 0xffdca8 : 0xffe9cf, 13, 14, 2);
    light.position.set(room.x, 2.5, room.z); scene.add(light);
  }
  const shell = previewShell(scene);
  const loader = new GLTFLoader();
  const models = new Map<string, THREE.Group>();
  const loadErrors: { id: string; error: string }[] = [];
  await Promise.all(Object.entries(modelPaths).map(async ([id, path]) => {
    try { models.set(id, (await loader.loadAsync(path)).scene); }
    catch (error) { loadErrors.push({ id, error: error instanceof Error ? error.message : String(error) }); }
  }));
  loadingDetail.textContent = '按最终房间边界布置装饰与标牌…';
  const modelProvider = (id: RoomDecorationModelId) => models.get(id);
  const decorations = createRoomDecorations(world, { models: modelProvider });
  scene.add(decorations.root);
  const previewProps = new THREE.Group(); previewProps.name = 'room-decoration-preview-props'; scene.add(previewProps);
  const computers = new Map<string, THREE.Object3D>();
  for (const desk of world.desks) {
    const computer = models.get('computer-set-v1')?.clone(true);
    if (computer) {
      computer.position.set(desk.x, .75, desk.z); computer.rotation.y = desk.yaw + Math.PI; computer.name = `preview-computer:${desk.id}`;
      computers.set(desk.id, computer); previewProps.add(computer);
    }
    const chair = models.get('chair-v1')?.clone(true);
    if (chair) { chair.position.set(desk.seat.x, 0, desk.seat.z); chair.rotation.y = desk.yaw; chair.name = `preview-chair:${desk.id}`; previewProps.add(chair); }
  }
  const state: RoomDecorationUpdateState = { deskHeights: Object.fromEntries(world.desks.map(desk => [desk.id, .75])), transparentWalls: [], pressureRooms: [], pressureHeights: {} };
  let activeRoom = world.rooms.find(room => room.kind === 'front') ?? world.rooms[0];
  let viewMode: ViewMode = 'game';
  let materialFocus: 'solid' | 'surface' = 'solid';
  let viewFallback = false;
  let tourTimer: number | undefined;
  let transparent = false, raised = false;

  function clearPartitionView(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const solids = [...world.walls.filter(wall => wall.partition), ...world.desks.map(desk => ({ x: desk.x, z: desk.z, w: 1.6, d: .85 }))];
    return !solids.some(wall => {
      let lo = 0, hi = 1;
      const dx = b.x - a.x, dz = b.z - a.z;
      for (const [origin, delta, min, max] of [[a.x, dx, wall.x - wall.w / 2, wall.x + wall.w / 2], [a.z, dz, wall.z - wall.d / 2, wall.z + wall.d / 2]] as const) {
        if (Math.abs(delta) < 1e-8) { if (origin < min || origin > max) return false; continue; }
        const first = (min - origin) / delta, second = (max - origin) / delta;
        lo = Math.max(lo, Math.min(first, second)); hi = Math.min(hi, Math.max(first, second));
        if (lo > hi) return false;
      }
      return true;
    });
  }

  function gameView(room: typeof activeRoom): { position: THREE.Vector3; target: THREE.Vector3 } {
    const colliders = decorations.getDiagnostics().colliders;
    const primary = colliders.find(item => item.id === `boss-talk:${room.id}:table`) ?? colliders.find(item => item.roomId === room.id);
    const centerTarget = new THREE.Vector3(room.x, 1.03, room.z);
    if (primary && room.kind !== 'front') {
      const target = new THREE.Vector3(primary.x, 1.03, primary.z);
      for (const yaw of [primary.yaw, primary.yaw + Math.PI / 2, primary.yaw + Math.PI, primary.yaw - Math.PI / 2]) {
        const normal = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
        const position = target.clone().addScaledVector(normal, room.kind === 'meeting' ? 5.2 : 4.4); position.y = 1.62;
        const nearPartition = room.kind !== 'meeting' && world.walls.some(wall => wall.partition && Math.abs(position.x - wall.x) < wall.w / 2 + .75 && Math.abs(position.z - wall.z) < wall.d / 2 + .75);
        if (!nearPartition && Math.abs(position.x - room.x) < room.w / 2 - .9 && Math.abs(position.z - room.z) < room.d / 2 - .9 && clearPartitionView(position, target)) return { position, target };
      }
    }
    const door = world.doors.find(item => item.a === room.id || item.b === room.id);
    if (!door) return { position: new THREE.Vector3(room.x - 2.6, 1.62, room.z + 5.5), target: centerTarget };
    const inward = door.axis === 'z' ? new THREE.Vector3(Math.sign(room.x - door.x), 0, 0) : new THREE.Vector3(0, 0, Math.sign(room.z - door.z));
    const position = new THREE.Vector3(door.x, 1.62, door.z).addScaledVector(inward, 1.05);
    return { position, target: centerTarget };
  }

  function setView(mode: ViewMode, material: 'solid' | 'surface' = materialFocus, instant = true): void {
    viewMode = mode;
    if (mode === 'material') materialFocus = material;
    viewFallback = false;
    const diagnostics = decorations.getDiagnostics();
    let position: THREE.Vector3, target: THREE.Vector3;
    if (mode === 'game') ({ position, target } = gameView(activeRoom));
    else if (mode === 'overview') {
      const focus = diagnostics.focusPoints.find(item => item.roomId === activeRoom.id && item.kind === 'overview')!;
      position = new THREE.Vector3(...focus.position); target = new THREE.Vector3(...focus.target);
    } else if (mode === 'sign') {
      const signs = diagnostics.focusPoints.filter(item => item.roomId === activeRoom.id && item.kind === 'sign');
      const focus = signs[1] ?? signs[0];
      if (focus) { position = new THREE.Vector3(...focus.position); target = new THREE.Vector3(...focus.target); }
      else { ({ position, target } = gameView(activeRoom)); viewFallback = true; }
    } else {
      const collider = materialFocus === 'solid' ? diagnostics.colliders.find(item => item.roomId === activeRoom.id) : undefined;
      if (collider) {
        const normal = new THREE.Vector3(Math.sin(collider.yaw), 0, Math.cos(collider.yaw));
        target = new THREE.Vector3(collider.x, Math.min(collider.height * .64, 1.05), collider.z);
        position = target.clone().addScaledVector(normal, 1.8); position.y += .35;
      } else {
        const signs = diagnostics.focusPoints.filter(item => item.roomId === activeRoom.id && item.kind === 'sign');
        const focus = diagnostics.focusPoints.find(item => item.roomId === activeRoom.id && item.kind === 'material') ?? signs[1] ?? signs[0];
        if (focus) { position = new THREE.Vector3(...focus.position); target = new THREE.Vector3(...focus.target); }
        else { ({ position, target } = gameView(activeRoom)); viewFallback = true; }
      }
    }
    camera.position.copy(position); controls.target.copy(target); camera.lookAt(target); controls.update();
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.classList.toggle('active', button.dataset.view === mode && (mode !== 'material' || (button.dataset.material ?? 'solid') === materialFocus)));
    if (instant) renderer.render(scene, camera);
  }

  function setRoom(id: number): void {
    activeRoom = world.rooms.find(room => room.id === id) ?? world.rooms[0];
    document.querySelectorAll<HTMLButtonElement>('[data-room]').forEach(button => button.classList.toggle('active', Number(button.dataset.room) === activeRoom.id));
    const stats = decorations.getDiagnostics().rooms.find(room => room.roomId === activeRoom.id)!;
    document.querySelector('#room-index')!.textContent = `ROOM ${String(activeRoom.id + 1).padStart(2, '0')} / ${activeRoom.kind.toUpperCase()} / ${activeRoom.w} × ${activeRoom.d} m`;
    document.querySelector('#room-name')!.textContent = activeRoom.name;
    document.querySelector('#room-description')!.textContent = descriptions[activeRoom.kind] ?? descriptions.work;
    document.querySelector('#room-stats')!.innerHTML = `<span>装饰 ${stats.placed} 组</span><span>墙饰 ${stats.signs} 面</span><span>实体候选 ${stats.colliders} 组</span>`;
    setView(viewMode);
  }

  function applyState(): void {
    decorations.update(state);
    renderer.shadowMap.needsUpdate = true;
    shell.updateDesks(state.deskHeights);
    for (const [deskId, computer] of computers) computer.position.y = state.deskHeights[deskId] ?? .75;
    document.querySelector('#transparency')!.classList.toggle('active', transparent);
    document.querySelector('#raise')!.classList.toggle('active', raised);
  }

  function setTestState(next: Partial<RoomDecorationUpdateState>): void {
    if (next.deskHeights) state.deskHeights = { ...next.deskHeights };
    if (next.transparentWalls) state.transparentWalls = [...next.transparentWalls];
    if (next.pressureRooms) state.pressureRooms = [...next.pressureRooms];
    if (next.pressureHeights) state.pressureHeights = { ...next.pressureHeights };
    transparent = state.transparentWalls.length > 0;
    raised = Object.values(state.deskHeights).some(height => height > .7501);
    applyState();
  }

  function stopTour(): void { if (tourTimer !== undefined) window.clearInterval(tourTimer); tourTimer = undefined; document.querySelector('#tour')!.classList.remove('running'); document.querySelector('#tour')!.innerHTML = '开始连续巡房 <span>SPACE</span>'; }
  function toggleTour(): void {
    if (tourTimer !== undefined) { stopTour(); return; }
    document.querySelector('#tour')!.classList.add('running'); document.querySelector('#tour')!.innerHTML = '暂停连续巡房 <span>SPACE</span>';
    tourTimer = window.setInterval(() => setRoom((activeRoom.id + 1) % world.rooms.length), 4200);
  }

  const roomList = document.querySelector('#room-list')!;
  for (const room of world.rooms) {
    const button = document.createElement('button'); button.dataset.room = String(room.id); button.innerHTML = `<span>${String(room.id + 1).padStart(2, '0')}</span>${room.name}`; button.addEventListener('click', () => { stopTour(); setRoom(room.id); }); roomList.append(button);
  }
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view as ViewMode, (button.dataset.material as 'solid' | 'surface' | undefined) ?? 'solid')));
  document.querySelector('#tour')!.addEventListener('click', toggleTour);
  document.querySelector('#transparency')!.addEventListener('click', () => {
    setTestState({ transparentWalls: transparent ? [] : decorations.getDiagnostics().wallAttachments.map(item => item.wallId) });
  });
  document.querySelector('#raise')!.addEventListener('click', () => {
    setTestState({ deskHeights: Object.fromEntries(world.desks.map(desk => [desk.id, raised ? .75 : 1.22])) });
  });
  window.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight') setRoom((activeRoom.id + 1) % world.rooms.length);
    if (event.key === 'ArrowLeft') setRoom((activeRoom.id + world.rooms.length - 1) % world.rooms.length);
    if (['1', '2', '3', '4'].includes(event.key)) setView((['game', 'sign', 'material', 'overview'] as const)[Number(event.key) - 1]);
    if (event.code === 'Space') { event.preventDefault(); toggleTour(); }
  });
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
  controls.addEventListener('start', stopTour);

  setRoom(activeRoom.id);
  loadingDetail.textContent = '预热纹理与正式组件…';
  await decorations.prepare(renderer, camera, scene);
  renderer.render(scene, camera);
  renderer.shadowMap.autoUpdate = false;
  loading.classList.add('done');
  let last = performance.now();
  const frameTimes: number[] = [];
  const animate = () => { controls.update(); renderer.render(scene, camera); const now = performance.now(); frameTimes.push(now - last); if (frameTimes.length > 240) frameTimes.shift(); last = now; };
  renderer.setAnimationLoop(animate);

  const api = {
    ready: true,
    seed: world.seed,
    getWorld: () => world,
    setCaptureMode: (paused: boolean) => { document.body.classList.toggle('capture-clean', paused); renderer.setAnimationLoop(paused ? null : animate); renderer.render(scene, camera); },
    rooms: world.rooms.map(room => ({ id: room.id, name: room.name, kind: room.kind, x: room.x, z: room.z, w: room.w, d: room.d, pressure: room.pressure })),
    loadedModels: [...models.keys()], loadErrors,
    setRoom, setView, setTestState,
    startTour: toggleTour,
    stopTour,
    getDiagnostics: () => decorations.getDiagnostics(),
    getViewState: () => ({ roomId: activeRoom.id, viewMode, materialFocus, fallback: viewFallback, position: camera.position.toArray(), target: controls.target.toArray() }),
    getTestState: () => ({ deskHeights: { ...state.deskHeights }, transparentWalls: [...state.transparentWalls], pressureRooms: [...state.pressureRooms ?? []], pressureHeights: { ...state.pressureHeights } }),
    measureDeskBindings: () => world.desks.map(desk => ({
      deskId: desk.id,
      expectedY: state.deskHeights[desk.id] ?? .75,
      tagY: decorations.root.getObjectByName(`desk-department:${desk.id}`)?.position.y ?? null,
      computerY: computers.get(desk.id)?.position.y ?? null,
      desktopY: shell.getDeskSurfaceHeight(desk.id) ?? null,
      hasTag: Boolean(decorations.root.getObjectByName(`desk-department:${desk.id}`)),
    })),
    measureColliders: () => {
      decorations.root.updateMatrixWorld(true);
      return decorations.decorationColliders.map(collider => {
        const object = decorations.root.getObjectByName(collider.id);
        if (!object) return { id: collider.id, missing: true };
        const box = new THREE.Box3();
        const includedNodes: string[] = [], excludedNodes: string[] = [];
        object.traverse(node => {
          let excluded = false;
          for (let current: THREE.Object3D | null = node; current; current = current.parent) {
            if (current.userData.measureExclude) excluded = true;
            if (current === object) break;
          }
          if (excluded) { excludedNodes.push(node.name || node.type); return; }
          if (!(node instanceof THREE.Mesh)) return;
          node.geometry.computeBoundingBox();
          if (!node.geometry.boundingBox) return;
          box.union(node.geometry.boundingBox.clone().applyMatrix4(node.matrixWorld));
          includedNodes.push(node.name || node.type);
        });
        if (box.isEmpty()) return { id: collider.id, roomId: collider.roomId, missing: true, includedNodes, excludedNodes };
        const size = box.getSize(new THREE.Vector3());
        return { id: collider.id, roomId: collider.roomId, missing: false, candidate: { w: collider.w, d: collider.d, height: collider.height }, actual: { w: size.x, d: size.z, height: box.max.y }, ground: box.min.y, delta: { w: size.x - collider.w, d: size.z - collider.d, height: box.max.y - collider.height }, includedNodes, excludedNodes };
      });
    },
    getDecorationResourceInfo: () => {
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      let meshes = 0, triangles = 0;
      decorations.root.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !object.visible) return;
        const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
        meshes += instances; geometries.add(object.geometry);
        triangles += (object.geometry.index?.count ?? object.geometry.attributes.position?.count ?? 0) / 3 * instances;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      let textureBytesEstimate = 0;
      for (const texture of textures) { const image = texture.image as { width?: number; height?: number } | undefined; textureBytesEstimate += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 1.333; }
      return { meshes, triangles: Math.round(triangles), geometries: geometries.size, materials: materials.size, textures: textures.size, textureBytesEstimate: Math.round(textureBytesEstimate), note: '装饰根节点资源；几何与纹理解析共享去重，三角形按场景网格实例累计。' };
    },
    getRendererInfo: () => {
      const textures = new Set<THREE.Texture>(); let meshes = 0;
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh) || !object.visible) return;
        meshes += object instanceof THREE.InstancedMesh ? object.count : 1;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      });
      let textureBytes = 0;
      for (const texture of textures) { const image = texture.image as { width?: number; height?: number } | undefined; textureBytes += (image?.width ?? 0) * (image?.height ?? 0) * 4 * 1.333; }
      const sorted = [...frameTimes].sort((a, b) => a - b);
      return { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, textureBytesEstimate: Math.round(textureBytes), meshes, softwareFrameSample: { medianMs: sorted[Math.floor(sorted.length * .5)] ?? 0, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, note: '仅为本预览渲染线程样本，不是主游戏或硬件帧率验收。' } };
    },
    verifyStates: () => {
      const before = { deskHeights: { ...state.deskHeights }, transparentWalls: [...state.transparentWalls], pressureRooms: [...state.pressureRooms ?? []], pressureHeights: { ...state.pressureHeights } };
      const diagnostics = decorations.getDiagnostics();
      const attachmentIds = new Set(diagnostics.wallAttachments.map(item => item.id));
      const floorObjects = decorations.root.children.filter(object => !attachmentIds.has(object.name) && !object.name.startsWith('desk-department:'));
      const floorBefore = floorObjects.map(object => ({ object, visible: object.visible, position: object.position.clone() }));
      setTestState({ transparentWalls: diagnostics.wallAttachments.map(item => item.wallId) });
      const wallHidden = diagnostics.wallAttachments.every(item => decorations.root.getObjectByName(item.id)?.visible === false);
      const floorPreserved = floorBefore.every(item => item.object.visible === item.visible && item.object.position.distanceTo(item.position) < .0001);
      setTestState({ transparentWalls: [] });
      const wallRestored = diagnostics.wallAttachments.every(item => decorations.root.getObjectByName(item.id)?.visible === true);
      const taggedDesk = world.desks.find(desk => decorations.root.getObjectByName(`desk-department:${desk.id}`));
      if (taggedDesk) setTestState({ deskHeights: { ...state.deskHeights, [taggedDesk.id]: 1.33 }, transparentWalls: [] });
      const tag = taggedDesk ? decorations.root.getObjectByName(`desk-department:${taggedDesk.id}`) : undefined;
      const deskFollows = taggedDesk ? Math.abs((tag?.position.y ?? 0) - 1.33) < .0001 : false;
      const computerFollows = taggedDesk ? Math.abs((computers.get(taggedDesk.id)?.position.y ?? 0) - 1.33) < .0001 : false;
      const desktopFollows = taggedDesk ? Math.abs((shell.getDeskSurfaceHeight(taggedDesk.id) ?? 0) - 1.33) < .0001 : false;
      const pressureTarget = diagnostics.wallAttachments.find(item => item.position[1] + item.height / 2 > 1.55) ?? diagnostics.wallAttachments[0];
      const pressureObject = decorations.root.getObjectByName(pressureTarget.id);
      const other = diagnostics.wallAttachments.find(item => item.roomId !== pressureTarget.roomId);
      const otherObject = other ? decorations.root.getObjectByName(other.id) : undefined;
      const originalY = pressureObject?.position.y ?? 0, otherY = otherObject?.position.y ?? 0;
      setTestState({ pressureRooms: [pressureTarget.roomId], pressureHeights: { [pressureTarget.roomId]: 1.6 }, transparentWalls: [] });
      const pressureTop = (pressureObject?.position.y ?? 0) + pressureTarget.height / 2;
      const pressureSafe = pressureTop <= 1.5001;
      const pressureUnaffected = otherObject ? Math.abs(otherObject.position.y - otherY) < .0001 : true;
      const currentAttachment = decorations.getDiagnostics().wallAttachments.find(item => item.id === pressureTarget.id);
      const pressureDiagnosticsSync = currentAttachment ? Math.abs(currentAttachment.position[1] - (pressureObject?.position.y ?? 0)) < .0001 : false;
      const pressureViolations = decorations.getDiagnostics().violations;
      setTestState(before);
      const pressureRestored = pressureObject ? Math.abs(pressureObject.position.y - originalY) < .0001 : false;
      return { wallHidden, wallRestored, floorPreserved, deskFollows, computerFollows, desktopFollows, tagFound: Boolean(tag), pressureSafe, pressureTop, pressureUnaffected, pressureDiagnosticsSync, pressureViolations, pressureRestored };
    },
    dispose: () => {
      stopTour(); renderer.setAnimationLoop(null);
      decorations.dispose(); shell.dispose(); previewProps.removeFromParent(); controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      for (const root of [...models.values(), ...previewProps.children]) root.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
      renderer.dispose();
    },
  };
  (window as unknown as Record<string, unknown>).__ROOM_DECORATIONS__ = api;
}

start().catch(error => {
  console.error(error);
  loading.classList.add('done');
  const panel = document.querySelector<HTMLDivElement>('#error')!;
  panel.hidden = false; panel.textContent = `预览启动失败\n${error instanceof Error ? error.stack : String(error)}`;
});
