import './asset-gallery.css';
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { UICommand, UIModel } from '../contracts/game';
import type { UIInstance } from '../ui/views';

type AssetSpec = {
  id: string;
  label: string;
  note: string;
  path: string;
  target: string;
  scale: (size: THREE.Vector3) => number;
  alreadyNormalized?: boolean;
};

const runtime = import.meta.env.PROD || new URLSearchParams(location.search).get('runtime') === '1';
const specs: AssetSpec[] = [
  { id: 'leader-v1', label: '领导', note: '深色西装 · 酒红领带 · 65关节 · 原地 idle / walk / run', path: `${import.meta.env.BASE_URL}assets/source/tripo/leader-v1/v1/animations-v1/model.glb`, target: '目标身高 1.85 m', scale: (size: THREE.Vector3) => 1.85 / size.y },
  { id: 'employee-base-v1', label: '员工候选', note: '既有候选 · idle / walk / run · 待美术采用', path: `${import.meta.env.BASE_URL}assets/tripo/employee-base-v1.glb`, target: '目标身高 1.75 m', scale: (size: THREE.Vector3) => 1.75 / size.y },
  { id: 'pot-v1', label: '实体锅', note: '黑色金属 · 双柄 · 无盖 · 独立道具', path: `${import.meta.env.BASE_URL}assets/source/tripo/pot-v1/v1/source.glb`, target: '最大宽度 0.45 m · 锅体待分件验收', scale: (size: THREE.Vector3) => .45 / Math.max(size.x, size.z) },
  { id: 'chair-v1', label: '滚椅', note: '深色织物 · 扶手 · 五星脚 · 独立道具', path: `${import.meta.env.BASE_URL}assets/source/tripo/chair-v1/v1/source.glb`, target: '目标总高 1.10 m · 座高待实测', scale: (size: THREE.Vector3) => 1.1 / size.y },
].map((spec): AssetSpec => runtime && spec.id !== 'employee-base-v1' ? { ...spec, path: `${import.meta.env.BASE_URL}assets/tripo/${spec.id}.glb`, target: '运行文件重载 · 不再次缩放或旋转', note: `运行版重载 · ${spec.note}`, scale: () => 1, alreadyNormalized: true } : spec);

type LoadedAsset = {
  spec: AssetSpec;
  root: THREE.Group;
  size: THREE.Vector3;
  minY: number;
  animations: THREE.AnimationClip[];
};

/** Visual-only asset inspection. Runtime rules, hit tests and collisions never enter this module. */
export function mountAssetGallery(host: HTMLElement): UIInstance {
  host.innerHTML = `<main class="asset-gallery"><header class="asset-gallery__header"><div><p>ASSET STUDY / 001</p><h1>办公室里的日常物件。</h1></div><span>独立预览 · 不代表已接入玩法</span></header><nav class="asset-gallery__tabs" aria-label="资产选择">${specs.map((spec, index) => `<button type="button" data-asset="${spec.id}" class="${index === 0 ? 'is-active' : ''}"><span>0${index + 1}</span>${spec.label}</button>`).join('')}</nav><section class="asset-gallery__stage" aria-label="三维资产预览"><div class="asset-gallery__loading" role="status">正在读取真实 GLB…</div></section><aside class="asset-gallery__info"><p class="asset-gallery__eyebrow">CURRENT ASSET</p><h2></h2><p class="asset-gallery__note"></p><dl><div><dt>归一化尺寸</dt><dd class="asset-gallery__size">—</dd></div><div><dt>目标</dt><dd class="asset-gallery__target">—</dd></div><div><dt>三角面</dt><dd class="asset-gallery__triangles">—</dd></div><div><dt>原点 / 向上</dt><dd>底部中心 / +Y</dd></div><div><dt>运行朝向</dt><dd>+Z</dd></div></dl><p class="asset-gallery__caveat">尺寸为归一化场景的包围盒实测。人物、锅、椅子保持分件；此预览不改变任何玩法事实。</p><button type="button" class="asset-gallery__download" disabled>导出归一化 GLB</button></aside><footer class="asset-gallery__footer"><div class="asset-gallery__views"><button type="button" data-view="front">正面</button><button type="button" data-view="side">侧面</button><button type="button" data-view="back">背面</button><button type="button" data-view="perspective" class="is-active">三分之四</button></div><div class="asset-gallery__animation"><label>动作<select disabled><option>无动画</option></select></label><button type="button" class="asset-gallery__pause" disabled>暂停</button></div><span>拖动旋转 · 滚轮缩放 · 右键平移</span></footer><div class="asset-gallery__error" role="alert" hidden></div></main>`;
  const stage = host.querySelector<HTMLElement>('.asset-gallery__stage')!;
  const loading = host.querySelector<HTMLElement>('.asset-gallery__loading')!;
  const errorBox = host.querySelector<HTMLElement>('.asset-gallery__error')!;
  const select = host.querySelector<HTMLSelectElement>('select')!;
  const pauseButton = host.querySelector<HTMLButtonElement>('.asset-gallery__pause')!;
  const downloadButton = host.querySelector<HTMLButtonElement>('.asset-gallery__download')!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#242820');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.domElement.setAttribute('aria-label', '可旋转的真实三维模型');
  stage.append(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  const camera = new THREE.PerspectiveCamera(36, 1, .01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
  controls.minDistance = .3;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI * .87;
  scene.add(new THREE.HemisphereLight('#e4ead7', '#494238', 1.35));
  const key = new THREE.DirectionalLight('#fff0d2', 3.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -3;
  key.shadow.camera.right = key.shadow.camera.top = 3;
  key.shadow.bias = -.0003;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#c7d3ce', 1.3);
  fill.position.set(-3, 2, -2);
  scene.add(fill);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ color: '#060805', opacity: .25 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(6, 30, '#7d856a', '#454d3c');
  grid.position.y = .001;
  scene.add(grid);
  const loader = new GLTFLoader();
  const cache = new Map<string, Promise<LoadedAsset>>();
  const clock = new THREE.Clock();
  let mixer: THREE.AnimationMixer | undefined;
  let activeAction: THREE.AnimationAction | undefined;
  let current: LoadedAsset | undefined;
  let paused = false;
  let disposed = false;
  let frame = 0;
  let loadVersion = 0;
  let currentView = 'perspective';

  function prepare(gltf: GLTF, spec: AssetSpec): LoadedAsset {
    const source = gltf.scene;
    const rotationY = spec.alreadyNormalized ? 0 : -Math.PI / 2;
    source.rotateY(rotationY);
    source.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
    const root = new THREE.Group();
    root.name = `${spec.id}-normalized`;
    root.add(source);
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    if (box.isEmpty()) throw new Error(`${spec.id} 没有可显示的网格`);
    const size = box.getSize(new THREE.Vector3());
    const scale = spec.scale(size);
    if (![...size.toArray(), scale].every(value => Number.isFinite(value) && value > 0)) throw new Error(`${spec.id} 的尺寸无效`);
    const center = box.getCenter(new THREE.Vector3());
    source.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const normalizedBounds = new THREE.Box3().setFromObject(root);
    const normalizedSize = normalizedBounds.getSize(new THREE.Vector3());
    root.userData = { assetId: spec.id, up: '+Y', forward: '+Z', origin: 'floor-center', rotationYRadians: rotationY, normalizedFrom: spec.path };
    return { spec, root, size: normalizedSize, minY: normalizedBounds.min.y, animations: gltf.animations };
  }

  function load(spec: AssetSpec): Promise<LoadedAsset> {
    let pending = cache.get(spec.id);
    if (!pending) {
      pending = loader.loadAsync(spec.path).then(gltf => prepare(gltf, spec));
      cache.set(spec.id, pending);
      pending.catch(() => cache.delete(spec.id));
    }
    return pending;
  }

  function frameCamera(view = currentView) {
    if (!current) return;
    const size = current.size;
    const target = new THREE.Vector3(0, size.y * .48, 0);
    const distance = Math.max(size.y, size.x / Math.max(camera.aspect, .6), size.z) * 1.68 + .2;
    const positions: Record<string, THREE.Vector3> = {
      front: new THREE.Vector3(0, size.y * .08, distance),
      side: new THREE.Vector3(distance, size.y * .08, 0),
      back: new THREE.Vector3(0, size.y * .08, -distance),
      perspective: new THREE.Vector3(distance * .72, size.y * .28, distance),
    };
    camera.position.copy(target).add(positions[view] ?? positions.perspective!);
    controls.target.copy(target);
    controls.update();
  }

  function play(name: string) {
    if (!current || !mixer) return;
    activeAction?.stop();
    const clip = current.animations.find(animation => animation.name === name);
    if (!clip) return;
    activeAction = mixer.clipAction(clip);
    activeAction.reset().play();
  }

  async function show(id: string) {
    const spec = specs.find(item => item.id === id);
    if (!spec) return;
    const version = ++loadVersion;
    loading.hidden = false;
    loading.textContent = '正在读取真实 GLB…';
    errorBox.hidden = true;
    downloadButton.disabled = true;
    host.querySelectorAll('[data-asset]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.asset === id));
    try {
      const asset = await load(spec);
      if (disposed || version !== loadVersion) return;
      if (current) scene.remove(current.root);
      mixer?.stopAllAction();
      mixer = undefined;
      activeAction = undefined;
      current = asset;
      scene.add(current.root);
      stage.dataset.loadedAsset = asset.spec.id;
      stage.dataset.minY = asset.minY.toFixed(8);
      host.querySelector('h2')!.textContent = asset.spec.label;
      host.querySelector('.asset-gallery__note')!.textContent = asset.spec.note;
      host.querySelector('.asset-gallery__size')!.textContent = `${asset.size.x.toFixed(3)} × ${asset.size.y.toFixed(3)} × ${asset.size.z.toFixed(3)} m`;
      host.querySelector('.asset-gallery__target')!.textContent = asset.spec.target;
      let triangles = 0;
      asset.root.traverse(object => {
        if (object instanceof THREE.Mesh) triangles += (object.geometry.index?.count ?? object.geometry.attributes.position!.count) / 3;
      });
      host.querySelector('.asset-gallery__triangles')!.textContent = triangles.toLocaleString('en-US');
      select.innerHTML = asset.animations.length ? asset.animations.map(clip => `<option value="${clip.name}">${clip.name} · ${clip.duration.toFixed(2)}s</option>`).join('') : '<option>尚未绑定动作</option>';
      select.disabled = !asset.animations.length;
      pauseButton.disabled = !asset.animations.length;
      downloadButton.disabled = false;
      if (asset.animations.length) {
        mixer = new THREE.AnimationMixer(current.root);
        play(select.value);
      }
      frameCamera();
      loading.hidden = true;
    } catch (error) {
      if (disposed || version !== loadVersion) return;
      loading.hidden = true;
      errorBox.hidden = false;
      errorBox.textContent = `资产读取失败：${error instanceof Error ? error.message : String(error)}`;
    }
  }

  async function download() {
    const asset = current;
    if (!asset) return;
    downloadButton.disabled = true;
    downloadButton.textContent = '正在导出…';
    const transforms: { object: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }[] = [];
    asset.root.traverse(object => transforms.push({ object, position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() }));
    mixer?.stopAllAction();
    mixer?.update(0);
    try {
      const result = await new GLTFExporter().parseAsync(asset.root, { binary: true, animations: asset.animations });
      const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${asset.spec.id}.glb`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      errorBox.hidden = false;
      errorBox.textContent = `导出失败：${error instanceof Error ? error.message : String(error)}`;
    } finally {
      transforms.forEach(({ object, position, quaternion, scale }) => {
        object.position.copy(position);
        object.quaternion.copy(quaternion);
        object.scale.copy(scale);
      });
      if (current === asset && select.value) play(select.value);
      if (current) downloadButton.disabled = false;
      downloadButton.textContent = '导出归一化 GLB';
    }
  }

  function resize() {
    const width = stage.clientWidth;
    const height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    frameCamera();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  const click = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.asset) void show(button.dataset.asset);
    if (button.dataset.view) {
      currentView = button.dataset.view;
      host.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('is-active', item === button));
      frameCamera();
    }
  };
  host.addEventListener('click', click);
  const change = () => play(select.value);
  select.addEventListener('change', change);
  const togglePause = () => {
    paused = !paused;
    pauseButton.textContent = paused ? '继续' : '暂停';
  };
  pauseButton.addEventListener('click', togglePause);
  downloadButton.addEventListener('click', download);
  function animate() {
    if (disposed) return;
    if (!paused) mixer?.update(clock.getDelta());
    else clock.getDelta();
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }
  resize();
  animate();
  void show(specs[0]!.id);
  return {
    render(_model: UIModel) {},
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      host.removeEventListener('click', click);
      select.removeEventListener('change', change);
      pauseButton.removeEventListener('click', togglePause);
      downloadButton.removeEventListener('click', download);
      controls.dispose();
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      const textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            materials.add(material);
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          }
        }
      });
      textures.forEach(texture => texture.dispose());
      materials.forEach(material => material.dispose());
      geometries.forEach(geometry => geometry.dispose());
      environment.dispose();
      pmrem.dispose();
      renderer.dispose();
      host.innerHTML = '';
    },
  };
}

export type { UICommand };
