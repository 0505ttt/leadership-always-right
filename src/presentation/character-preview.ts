import './asset-gallery.css';
import './character-preview.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createCharacterLibrary, type CharacterPoseInput, type CharacterVisual } from './characters';
import { measureVisualBounds } from './visual-utils';

type PreviewPose = 'standing' | 'walking' | 'running' | 'back-pot' | 'hand-pot' | 'crown-pot' | 'working' | 'working-clearance' | 'rolling' | 'rolling-pot' | 'crouching' | 'dragged' | 'leader' | 'leader-large' | 'leader-low';
type View = 'front' | 'side' | 'back' | 'perspective';

const specs: Record<PreviewPose, { label: string; subtitle: string; note: string }> = {
  standing: { label: '站立', subtitle: '员工 · idle', note: '正式员工 GLB；米制、+Y向上、前方+Z。' },
  walking: { label: '行走', subtitle: '员工 · walk', note: '使用 GLB 自带 walk；移除视觉根位移，位移由 Codex 驱动。' },
  running: { label: '跑动', subtitle: '员工 · run', note: '使用 GLB 自带 run；检查步态与地面关系。' },
  'back-pot': { label: '站立背锅', subtitle: '员工 · back', note: '锅从 back 挂点读取世界坐标，采用道具模块的背锅方向。' },
  'hand-pot': { label: '手持锅', subtitle: '员工 · hand', note: '右手持锅，手臂保持弯曲；锅体保持独立。' },
  'crown-pot': { label: '站立顶锅', subtitle: '员工 · crown', note: '头顶挂点只读取头骨权重，不会把举高的手当成头顶。' },
  working: { label: '假装办公', subtitle: '同事 · 椅与工牌', note: '真实同事实例；检查座面、双手与胸前工牌。' },
  'working-clearance': { label: '低顶办公顶锅', subtitle: '同事 · clearance 1.6 m', note: '正式 working+crown 低伏分支；参考网格位于 1.6 m，不改人物比例、挂点测量或碰撞。' },
  rolling: { label: '滚椅低伏', subtitle: '员工 · rolling', note: '身体明显前倾、臀腿与椅面配合，不通过压扁模型降低高度。' },
  'rolling-pot': { label: '滚椅顶锅', subtitle: '人椅锅 · ≤ 1.42 m', note: '真实 pot-v1 放在 crown 挂点，双手扶两侧；检查总高与接触。' },
  crouching: { label: '蹲姿', subtitle: '员工 · crouching', note: '低姿骨架表演，与滚椅前倾区分。' },
  dragged: { label: '被抓扶', subtitle: '员工 · dragged', note: '弯曲膝盖、双手向前，供领导抓扶构图使用。' },
  leader: { label: '领导抓扶', subtitle: '领导 · 正常高度', note: '正常领导保持同一模型与身体比例，双手向前。' },
  'leader-large': { label: '领导变大', subtitle: '领导 · 等比 1.35×', note: '整人等比放大，不拉长头、四肢或单一身体部位。' },
  'leader-low': { label: '领导低伏', subtitle: '领导 · crouching', note: '同一领导模型的低伏姿态入口。' },
};

function inputFor(pose: PreviewPose, time: number): CharacterPoseInput {
  const base = { pose: 'standing' as const, moving: false, sprint: false, time, holding: false, pot: 'none' as const };
  if (pose === 'walking') return { ...base, moving: true };
  if (pose === 'running') return { ...base, moving: true, sprint: true };
  if (pose === 'back-pot') return { ...base, pot: 'back' };
  if (pose === 'hand-pot') return { ...base, pot: 'hand', holding: true };
  if (pose === 'crown-pot') return { ...base, pot: 'crown' };
  if (pose === 'working') return { ...base, pose: 'working' };
  if (pose === 'working-clearance') return { ...base, pose: 'working', pot: 'crown', clearance: 1.6 };
  if (pose === 'rolling') return { ...base, pose: 'rolling' };
  if (pose === 'rolling-pot') return { ...base, pose: 'rolling', pot: 'crown' };
  if (pose === 'crouching' || pose === 'leader-low') return { ...base, pose: 'crouching' };
  if (pose === 'dragged') return { ...base, pose: 'dragged' };
  if (pose === 'leader' || pose === 'leader-large') return { ...base, gesturing: true };
  return base;
}

export function mountCharacterPreview(host: HTMLElement) {
  host.innerHTML = `<main class="asset-gallery character-preview"><header class="asset-gallery__header"><div><p>CHARACTER SYSTEM / 003</p><h1>人物，进入工作状态。</h1></div><span>正式组件独立预览 · 不启动玩法</span></header><nav class="asset-gallery__tabs" aria-label="人物姿态">${Object.entries(specs).map(([id, spec], index) => `<button type="button" data-pose="${id}" class="${index === 0 ? 'is-active' : ''}"><span>0${index + 1}</span><div>${spec.label}<small>${spec.subtitle}</small></div></button>`).join('')}</nav><section class="asset-gallery__stage" aria-label="正式人物组件三维预览"><div class="asset-gallery__loading" role="status">正在创建人物实例…</div></section><aside class="asset-gallery__info"><p class="asset-gallery__eyebrow">RUNTIME CHARACTER</p><span class="character-preview__id"></span><h2></h2><p class="asset-gallery__note"></p><dl><div><dt>人物 / 动画</dt><dd class="character-preview__animations">—</dd></div><div><dt>人椅锅实际包围盒</dt><dd class="character-preview__bounds">—</dd></div><div><dt>crown 挂点 / 锅底接触</dt><dd class="character-preview__contact">—</dd></div><div><dt>座面 / 椅背前缘</dt><dd class="character-preview__chair">—</dd></div></dl><p class="character-preview__status" data-tone="warning"></p><p class="asset-gallery__caveat">这里验证独立视觉组件的真实实例化与语义姿态，不代替整局操作、性能或游戏内组合验收。</p></aside><footer class="asset-gallery__footer"><div class="asset-gallery__views">${[['front', '正面'], ['side', '侧面'], ['back', '背面'], ['perspective', '三分之四']].map(([id, label]) => `<button type="button" data-view="${id}" class="${id === 'perspective' ? 'is-active' : ''}">${label}</button>`).join('')}</div><span>拖动旋转 · 滚轮缩放 · 右键平移</span></footer><div class="asset-gallery__error" role="alert" hidden></div></main>`;

  const stage = host.querySelector<HTMLElement>('.asset-gallery__stage')!;
  const loading = host.querySelector<HTMLElement>('.asset-gallery__loading')!;
  const errorBox = host.querySelector<HTMLElement>('.asset-gallery__error')!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#242820');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  stage.append(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = .6;
  controls.maxDistance = 8;
  controls.maxPolarAngle = Math.PI * .88;
  scene.add(new THREE.HemisphereLight('#e4ead7', '#494238', 1.3));
  const key = new THREE.DirectionalLight('#fff0d2', 3.1);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  key.shadow.bias = -.0003;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#c7d3ce', 1.25);
  fill.position.set(-3, 2, -2);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ color: '#060805', opacity: .25 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(6, 30, '#7d856a', '#454d3c');
  grid.position.y = .001;
  scene.add(grid);
  const clearanceGuide = new THREE.GridHelper(2.4, 12, '#f0cb73', '#8b7b51');
  clearanceGuide.name = 'preview-clearance:1.6m';
  clearanceGuide.position.set(0, 1.6, .16);
  clearanceGuide.visible = false;
  scene.add(clearanceGuide);

  let library: ReturnType<typeof createCharacterLibrary> | undefined;
  let employee: CharacterVisual;
  let colleague: CharacterVisual;
  let leader: CharacterVisual;
  let active: CharacterVisual;
  let pot: THREE.Object3D;
  let currentPose: PreviewPose = 'standing';
  let currentView: View = 'perspective';
  let ready = false;
  let disposed = false;
  let frame = 0;

  function activeFor(pose: PreviewPose) {
    return pose.startsWith('leader') ? leader : pose === 'working' || pose === 'working-clearance' ? colleague : employee;
  }

  function potAnchorFor(pose: PreviewPose) {
    if (pose === 'back-pot') return 'back';
    if (pose === 'hand-pot') return 'hand';
    if (pose === 'crown-pot' || pose === 'working-clearance' || pose === 'rolling-pot') return 'crown';
    return null;
  }

  function updatePerformance(time: number) {
    if (!ready) return;
    active.update(inputFor(currentPose, time));
    active.root.updateMatrixWorld(true);
    const potAnchor = potAnchorFor(currentPose);
    if (pot.visible && potAnchor) {
      pot.position.copy(active.anchors[potAnchor].getWorldPosition(new THREE.Vector3()));
      pot.rotation.set(potAnchor === 'back' ? Math.PI / 2 : 0, 0, 0);
      pot.updateMatrixWorld(true);
    }
  }

  function getState() {
    const diagnostics = active.getDiagnostics();
    const measured = active.measure(pot.visible ? pot : undefined);
    const potBounds = pot.visible ? measureVisualBounds(pot) : null;
    const crown = active.anchors.crown.getWorldPosition(new THREE.Vector3());
    const anchorsWorld = Object.fromEntries((['hand', 'back', 'crown'] as const).map(kind => [
      kind,
      active.anchors[kind].getWorldPosition(new THREE.Vector3()).toArray(),
    ]));
    const hands = (['Left', 'Right'] as const).map((side, index) => {
      const position = active.bones[`${side}Hand`].getWorldPosition(new THREE.Vector3());
      const target = currentPose === 'rolling-pot' || currentPose === 'working-clearance' ? new THREE.Vector3(index === 0 ? .265 : -.265, crown.y + .061, crown.z) : null;
      return { side, position: position.toArray(), target: target?.toArray() ?? null, targetError: target ? position.distanceTo(target) : null };
    });
    const materials = new Set<THREE.Material>();
    active.root.traverse(object => {
      if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    return {
      ready,
      pose: currentPose,
      view: currentView,
      assetId: active.assetId,
      kind: active.kind,
      scale: active.root.scale.toArray(),
      chairVisible: active.chair.visible,
      animations: active.animations,
      diagnostics,
      measured,
      worldHeight: measured.height * active.root.scale.y,
      anchorsWorld,
      hands,
      materials: [...materials].map(material => ({ name: material.name, type: material.type })),
      potTransform: {
        visible: pot.visible,
        position: pot.position.toArray(),
        rotation: [pot.rotation.x, pot.rotation.y, pot.rotation.z],
      },
      pot: potBounds ? { min: potBounds.min.toArray(), max: potBounds.max.toArray(), size: potBounds.getSize(new THREE.Vector3()).toArray() } : null,
      crown: crown.toArray(),
      crownGap: potBounds && (currentPose === 'rolling-pot' || currentPose === 'working-clearance' || currentPose === 'crown-pot') ? potBounds.min.y - crown.y : null,
      envelopePass: currentPose === 'working-clearance'
        ? measured.combined.max[1] <= 1.6 + 1e-5
        : currentPose !== 'rolling-pot' || measured.combined.max[1] <= 1.42 + 1e-5,
    };
  }

  function updatePanel() {
    const state = getState();
    const spec = specs[currentPose];
    host.querySelector('h2')!.textContent = spec.label;
    host.querySelector('.asset-gallery__note')!.textContent = spec.note;
    host.querySelector('.character-preview__id')!.textContent = `${state.assetId} · ${state.kind}`;
    host.querySelector('.character-preview__animations')!.textContent = state.animations.join(' / ') || '无动画片段';
    host.querySelector('.character-preview__bounds')!.textContent = `最高 Y ${(state.measured.combined.max[1] * active.root.scale.y).toFixed(3)} m · 高 ${state.worldHeight.toFixed(3)} m`;
    host.querySelector('.character-preview__contact')!.textContent = state.crownGap === null ? `Y ${state.crown[1].toFixed(3)} m · 本姿态无锅` : `Y ${state.crown[1].toFixed(3)} m · 间隙 ${(state.crownGap * 1000).toFixed(1)} mm`;
    host.querySelector('.character-preview__chair')!.textContent = `座面 Y ${active.chairContact.seatY.toFixed(3)} m · 椅背 Z ${active.chairContact.backrestFrontZ.toFixed(3)} m`;
    const status = host.querySelector<HTMLElement>('.character-preview__status')!;
    status.textContent = currentPose === 'working-clearance'
      ? state.envelopePass ? '当前实测人椅锅最高点不超过 1.6 m；黄色网格仅为独立净空参考。' : '当前实测最高点超过 1.6 m，低顶办公姿态仍需修正。'
      : currentPose === 'rolling-pot'
        ? state.envelopePass ? '当前实测最高点不超过 1.42 m；仍需结合正侧背截图检查接触和穿插。' : '当前实测最高点超过 1.42 m，不能接入为合格顶锅姿态。'
        : '本页只确认组件实际运行；姿态质量以截图实看为准。';
    status.dataset.tone = (currentPose === 'rolling-pot' || currentPose === 'working-clearance') && state.envelopePass ? 'pass' : 'warning';
    stage.dataset.ready = String(ready);
    stage.dataset.pose = currentPose;
    stage.dataset.combinedMaxY = (state.measured.combined.max[1] * active.root.scale.y).toFixed(6);
    stage.dataset.envelopePass = String(state.envelopePass);
  }

  function frameCamera() {
    if (!active) return;
    const height = active.measure(pot.visible ? pot : undefined).combined.max[1] * active.root.scale.y;
    const target = new THREE.Vector3(0, Math.max(.76, height * .54), .06);
    const distance = 3.2 + Math.max(0, height - 1.65) * .85;
    const positions: Record<View, THREE.Vector3> = {
      front: new THREE.Vector3(0, .14, distance),
      side: new THREE.Vector3(distance, .14, 0),
      back: new THREE.Vector3(0, .14, -distance),
      perspective: new THREE.Vector3(distance * .75, .45, distance),
    };
    camera.position.copy(target).add(positions[currentView]);
    controls.target.copy(target);
    controls.update();
  }

  function setPose(pose: PreviewPose) {
    if (!ready) return;
    currentPose = pose;
    for (const character of [employee, colleague, leader]) {
      character.setScale(1);
      character.root.visible = character === activeFor(pose);
    }
    active = activeFor(pose);
    if (pose === 'leader-large') leader.setScale(1.35);
    pot.visible = potAnchorFor(pose) !== null;
    clearanceGuide.visible = pose === 'working-clearance';
    updatePerformance(.65);
    host.querySelectorAll('[data-pose]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.pose === pose));
    updatePanel();
    frameCamera();
  }

  function setView(view: View) {
    currentView = view;
    host.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.view === view));
    frameCamera();
  }

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  async function prepare() {
    try {
      library = createCharacterLibrary();
      const [potGLTF] = await Promise.all([
        new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/tripo/pot-v1.glb`),
        library.prepare(renderer, camera, scene),
      ]);
      if (disposed) return;
      employee = library.createEmployee();
      colleague = library.createColleague('07');
      leader = library.createLeader();
      pot = potGLTF.scene;
      pot.name = 'preview-pot:pot-v1';
      pot.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
          object.frustumCulled = false;
        }
      });
      scene.add(employee.root, colleague.root, leader.root, pot);
      active = employee;
      ready = true;
      setPose('standing');
      setView('perspective');
      loading.hidden = true;
    } catch (error) {
      loading.hidden = true;
      errorBox.hidden = false;
      errorBox.textContent = `人物组件创建失败：${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  const click = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !ready) return;
    if (button.dataset.pose) setPose(button.dataset.pose as PreviewPose);
    if (button.dataset.view) setView(button.dataset.view as View);
  };
  host.addEventListener('click', click);
  const qa = {
    get ready() { return ready; },
    state: getState,
    setPose,
    setView,
  };
  Object.assign(window, { __characterQA: qa });

  function animate() {
    if (disposed) return;
    if (ready) {
      updatePerformance(performance.now() / 1000);
      updatePanel();
    }
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }
  resize();
  animate();
  void prepare();

  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener('click', click);
      controls.dispose();
      library?.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      textures.forEach(texture => texture.dispose());
      materials.forEach(material => material.dispose());
      geometries.forEach(geometry => geometry.dispose());
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      delete (window as Window & { __characterQA?: unknown }).__characterQA;
      host.innerHTML = '';
    },
  };
}

const preview = mountCharacterPreview(document.querySelector<HTMLElement>('#ui')!);
window.addEventListener('pagehide', () => preview.destroy(), { once: true });
