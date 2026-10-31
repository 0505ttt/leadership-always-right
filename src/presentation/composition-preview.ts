import './asset-gallery.css';
import './composition-preview.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

type PoseId = 'standing-back' | 'seated' | 'seated-back' | 'seated-head';
type ViewId = 'front' | 'side' | 'back' | 'perspective';

type PoseSpec = {
  label: string;
  subtitle: string;
  note: string;
  chair: boolean;
  pot: boolean;
};

const poses: Record<PoseId, PoseSpec> = {
  'standing-back': { label: '站立 · 背锅', subtitle: '无椅 / 背部间隙', note: '员工候选取 idle 姿态；锅保持独立，检查背部与锅体的相对位置。', chair: false, pot: true },
  seated: { label: '坐上滚椅', subtitle: '无锅 / 座面与双脚', note: '按实测座面布置视觉坐姿；仅用于检查臀腿、座面、椅背与落地关系。', chair: true, pot: false },
  'seated-back': { label: '坐姿 · 背锅', subtitle: '略前移 / 锅体贴背', note: '候选人物略坐前缘，锅转为重点在后的侧向背负，检验能否避开椅背。', chair: true, pot: true },
  'seated-head': { label: '坐姿 · 头顶锅', subtitle: '独立顶锅 / 轮廓实测', note: '锅置于头顶，双手作扶持候选姿态；总高度与 1.42 m 目标仅作视觉对照。', chair: true, pot: true },
};

type QAState = {
  ready: boolean;
  pose: PoseId;
  view: ViewId;
  employeeCandidate: true;
  chairContact: { seatY: number; seatProbeZ: number; backrestFrontZ: number; backrestProbeY: number };
  bounds: Record<string, { min: number[]; max: number[]; size: number[] } | null>;
  joints: Record<string, number[]>;
  materials: string[];
  notes: string[];
};

const assetRoot = `${import.meta.env.BASE_URL}assets/tripo/`;

export function mountCompositionPreview(host: HTMLElement) {
  host.innerHTML = `<main class="asset-gallery composition-preview"><header class="asset-gallery__header"><div><p>COMPOSITION STUDY / 002</p><h1>人物、锅与滚椅。</h1></div><span>独立视觉研究 · 员工候选未正式采用</span></header><nav class="asset-gallery__tabs" aria-label="组合姿态">${Object.entries(poses).map(([id, spec], index) => `<button type="button" data-pose="${id}" class="${index === 0 ? 'is-active' : ''}"><span>0${index + 1}</span><div>${spec.label}<small>${spec.subtitle}</small></div></button>`).join('')}</nav><section class="asset-gallery__stage" aria-label="人物锅椅三维组合预览"><div class="asset-gallery__loading" role="status">正在读取真实 GLB…</div></section><aside class="asset-gallery__info"><p class="asset-gallery__eyebrow">VISUAL PROTOTYPE</p><h2></h2><p class="asset-gallery__note"></p><span class="composition-preview__candidate">EMPLOYEE-BASE-V1 · 候选</span><dl><div><dt>座面 / 椅背前缘实测</dt><dd class="composition-preview__contact">—</dd></div><div><dt>人物高度</dt><dd class="composition-preview__employee">—</dd></div><div><dt>组合外轮廓</dt><dd class="composition-preview__bounds">—</dd></div><div><dt>头顶锅对照</dt><dd class="composition-preview__envelope">—</dd></div></dl><p class="composition-preview__status" data-tone="warning"></p><p class="asset-gallery__caveat">这里只研究视觉比例、姿态和穿插，不定义程序挂点、碰撞或正式员工选型。</p></aside><footer class="asset-gallery__footer"><div class="asset-gallery__views">${[['front', '正面'], ['side', '侧面'], ['back', '背面'], ['perspective', '三分之四']].map(([id, label]) => `<button type="button" data-view="${id}" class="${id === 'perspective' ? 'is-active' : ''}">${label}</button>`).join('')}</div><span>拖动旋转 · 滚轮缩放 · 右键平移</span></footer><div class="asset-gallery__error" role="alert" hidden></div></main>`;

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
  renderer.domElement.setAttribute('aria-label', '可旋转的人物锅椅组合模型');
  stage.append(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  const camera = new THREE.PerspectiveCamera(35, 1, .01, 100);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = .08;
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
  const floorMaterial = new THREE.ShadowMaterial({ color: '#060805', opacity: .25 });
  floorMaterial.name = '组合检视 · 地面阴影';
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new THREE.GridHelper(6, 30, '#7d856a', '#454d3c');
  grid.position.y = .001;
  scene.add(grid);

  let employee: THREE.Group;
  let chair: THREE.Group;
  let pot: THREE.Group;
  let rest = new Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }>();
  let chairContact: QAState['chairContact'];
  let currentPose: PoseId = 'standing-back';
  let currentView: ViewId = 'perspective';
  let ready = false;
  let disposed = false;
  let frame = 0;

  const bone = (name: string) => {
    const result = employee.getObjectByName(`mixamorig${name}`);
    if (!result) throw new Error(`员工候选缺少骨骼 ${name}`);
    return result;
  };

  function prepareMeshes(root: THREE.Object3D) {
    root.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = false;
      }
    });
  }

  function normalizeEmployee(source: THREE.Group) {
    source.rotateY(-Math.PI / 2);
    const wrapper = new THREE.Group();
    wrapper.name = 'employee-base-v1-candidate-normalized';
    wrapper.add(source);
    wrapper.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(wrapper);
    const scale = 1.75 / box.getSize(new THREE.Vector3()).y;
    const center = box.getCenter(new THREE.Vector3());
    source.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
    wrapper.scale.setScalar(scale);
    wrapper.updateMatrixWorld(true);
    return wrapper;
  }

  function measureChair() {
    chair.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.set(new THREE.Vector3(0, 1.25, .16), new THREE.Vector3(0, -1, 0));
    const seat = ray.intersectObject(chair, true)[0];
    ray.set(new THREE.Vector3(0, .85, 1), new THREE.Vector3(0, 0, -1));
    const back = ray.intersectObject(chair, true)[0];
    if (!seat || !back) throw new Error('无法测量椅子的座面或椅背前缘');
    chairContact = { seatY: seat.point.y, seatProbeZ: .16, backrestFrontZ: back.point.z, backrestProbeY: .85 };
  }

  function restoreRestPose() {
    employee.traverse(object => {
      const saved = rest.get(object.uuid);
      if (!saved) return;
      object.position.copy(saved.position);
      object.quaternion.copy(saved.quaternion);
      object.scale.copy(saved.scale);
    });
    employee.updateMatrixWorld(true);
  }

  function aimBoneAt(current: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3) {
    current.updateWorldMatrix(true, false);
    child.updateWorldMatrix(true, false);
    const origin = current.getWorldPosition(new THREE.Vector3());
    const childPosition = child.getWorldPosition(new THREE.Vector3());
    const from = childPosition.sub(origin).normalize();
    const to = target.clone().sub(origin).normalize();
    if (from.lengthSq() < .1 || to.lengthSq() < .1) return;
    const parent = current.parent!;
    const inverseParent = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    from.applyQuaternion(inverseParent);
    to.applyQuaternion(inverseParent);
    current.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
    current.updateWorldMatrix(false, true);
  }

  function solveLimb(upper: THREE.Object3D, lower: THREE.Object3D, end: THREE.Object3D, target: THREE.Vector3, pole: THREE.Vector3) {
    employee.updateMatrixWorld(true);
    const start = upper.getWorldPosition(new THREE.Vector3());
    const firstLength = lower.getWorldPosition(new THREE.Vector3()).distanceTo(start);
    const secondLength = end.getWorldPosition(new THREE.Vector3()).distanceTo(lower.getWorldPosition(new THREE.Vector3()));
    const direction = target.clone().sub(start);
    const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(firstLength - secondLength) + .001, firstLength + secondLength - .001);
    direction.normalize();
    const reachableTarget = start.clone().addScaledVector(direction, distance);
    const along = (firstLength ** 2 + distance ** 2 - secondLength ** 2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, firstLength ** 2 - along ** 2));
    const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
    if (bend.lengthSq() < .0001) bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
    bend.normalize();
    const middleTarget = start.clone().addScaledVector(direction, along).addScaledVector(bend, height);
    aimBoneAt(upper, lower, middleTarget);
    aimBoneAt(lower, end, reachableTarget);
  }

  function placeEmployee(seated: boolean, forward = 0) {
    employee.position.set(0, 0, 0);
    restoreRestPose();
    if (!seated) {
      employee.position.z = forward;
      employee.updateMatrixWorld(true);
      return;
    }
    const hips = bone('Hips').getWorldPosition(new THREE.Vector3());
    employee.position.y = chairContact.seatY + .12 - hips.y;
    employee.position.z = forward;
    employee.updateMatrixWorld(true);
    for (const side of ['Left', 'Right'] as const) {
      const foot = bone(`${side}Foot`);
      const currentFoot = foot.getWorldPosition(new THREE.Vector3());
      const ankleTarget = new THREE.Vector3(currentFoot.x, .113, forward + .47);
      solveLimb(bone(`${side}UpLeg`), bone(`${side}Leg`), foot, ankleTarget, new THREE.Vector3(0, -.12, 1));
      const toe = bone(`${side}ToeBase`);
      const footPosition = foot.getWorldPosition(new THREE.Vector3());
      aimBoneAt(foot, toe, footPosition.clone().add(new THREE.Vector3(0, -.045, .16)));
      const shoulder = bone(`${side}Arm`).getWorldPosition(new THREE.Vector3());
      const handTarget = new THREE.Vector3(shoulder.x * .9, chairContact.seatY + .14, forward + .32);
      solveLimb(bone(`${side}Arm`), bone(`${side}ForeArm`), bone(`${side}Hand`), handTarget, new THREE.Vector3(side === 'Left' ? 1 : -1, -.15, -.25));
    }
    employee.updateMatrixWorld(true);
  }

  function raiseHandsToPot() {
    for (const side of ['Left', 'Right'] as const) {
      const head = bone('Head').getWorldPosition(new THREE.Vector3());
      const target = new THREE.Vector3(head.x + (side === 'Left' ? .23 : -.23), head.y + .12, head.z + .04);
      solveLimb(bone(`${side}Arm`), bone(`${side}ForeArm`), bone(`${side}Hand`), target, new THREE.Vector3(side === 'Left' ? 1 : -1, .1, -.3));
    }
  }

  function applyPose(id: PoseId) {
    currentPose = id;
    const spec = poses[id];
    chair.visible = spec.chair;
    pot.visible = spec.pot;
    pot.rotation.set(0, 0, 0);
    if (id === 'standing-back') {
      placeEmployee(false);
      const spine = bone('Spine2').getWorldPosition(new THREE.Vector3());
      pot.position.set(spine.x, spine.y - .12, spine.z - .32);
    } else if (id === 'seated') {
      placeEmployee(true, .17);
    } else if (id === 'seated-back') {
      placeEmployee(true, .37);
      const spine = bone('Spine2').getWorldPosition(new THREE.Vector3());
      pot.rotation.x = Math.PI / 2;
      pot.position.set(spine.x, spine.y - .09, spine.z - .16);
    } else {
      placeEmployee(true, .17);
      raiseHandsToPot();
      const employeeBox = measureBounds(employee);
      const head = bone('Head').getWorldPosition(new THREE.Vector3());
      pot.position.set(head.x, employeeBox.max.y + .006, head.z);
    }
    employee.updateMatrixWorld(true);
    chair.updateMatrixWorld(true);
    pot.updateMatrixWorld(true);
    stage.dataset.pose = id;
    host.querySelectorAll('[data-pose]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.pose === id));
    updatePanel();
    frameCamera();
  }

  function measureBounds(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3();
    root.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) {
        object.computeBoundingBox();
        box.union(object.boundingBox.clone().applyMatrix4(object.matrixWorld));
      } else if (object instanceof THREE.Mesh) {
        if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
        box.union(object.geometry.boundingBox!.clone().applyMatrix4(object.matrixWorld));
      }
    });
    return box;
  }

  function boxData(root: THREE.Object3D) {
    const box = measureBounds(root);
    return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
  }

  function getState(): QAState {
    const employeeBounds = boxData(employee);
    const potBounds = pot.visible ? boxData(pot) : null;
    const chairBounds = chair.visible ? boxData(chair) : null;
    const combined = measureBounds(employee);
    if (pot.visible) combined.union(measureBounds(pot));
    if (chair.visible) combined.union(measureBounds(chair));
    const materials = new Set<string>();
    scene.traverse(object => {
      if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material.name || '未命名材质');
    });
    return {
      ready,
      pose: currentPose,
      view: currentView,
      employeeCandidate: true,
      chairContact,
      bounds: {
        employee: employeeBounds,
        pot: potBounds,
        chair: chairBounds,
        combined: { min: combined.min.toArray(), max: combined.max.toArray(), size: combined.getSize(new THREE.Vector3()).toArray() },
      },
      joints: Object.fromEntries(['Hips', 'Spine2', 'Head', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot', 'LeftHand', 'RightHand'].map(name => [name, bone(name).getWorldPosition(new THREE.Vector3()).toArray()])),
      materials: [...materials],
      notes: ['员工仅为候选', '视觉姿态不是程序挂点或碰撞定稿', '组合总高不等于权威玩法轮廓'],
    };
  }

  function updatePanel() {
    const state = getState();
    const spec = poses[currentPose];
    const employee = state.bounds.employee!;
    const combined = state.bounds.combined!;
    host.querySelector('h2')!.textContent = spec.label;
    host.querySelector('.asset-gallery__note')!.textContent = spec.note;
    host.querySelector('.composition-preview__contact')!.textContent = `座面 Y ${state.chairContact.seatY.toFixed(3)} m · 椅背前缘 Z ${state.chairContact.backrestFrontZ.toFixed(3)} m`;
    host.querySelector('.composition-preview__employee')!.textContent = `${employee.size[1].toFixed(3)} m · 骨盆 Y ${state.joints.Hips![1]!.toFixed(3)} m`;
    host.querySelector('.composition-preview__bounds')!.textContent = `${combined.size[0].toFixed(3)} × ${combined.size[1].toFixed(3)} × ${combined.size[2].toFixed(3)} m`;
    host.querySelector('.composition-preview__envelope')!.textContent = currentPose === 'seated-head' ? `${combined.max[1].toFixed(3)} m / 目标 ≤ 1.420 m` : '本姿态不适用';
    const status = host.querySelector<HTMLElement>('.composition-preview__status')!;
    status.textContent = currentPose === 'seated-head'
      ? combined.max[1] > 1.42 ? '当前候选坐姿加顶锅超过 1.42 m 视觉对照线；不靠压扁模型掩盖，留待正式姿态与接入共同修正。' : '当前候选组合未超过 1.42 m 视觉对照线。'
      : currentPose === 'seated-back' ? '重点查看侧面与背面：锅是否仍穿入椅背，以及前移后臀部是否离开有效座面。' : '重点查看侧面、背面和脚部接地；本页不自动判定穿模通过。';
    stage.dataset.employeeHeight = employee.size[1].toFixed(6);
    stage.dataset.combinedHeight = combined.size[1].toFixed(6);
    stage.dataset.seatY = state.chairContact.seatY.toFixed(6);
    stage.dataset.backrestFrontZ = state.chairContact.backrestFrontZ.toFixed(6);
  }

  function frameCamera() {
    if (!employee) return;
    const headStudy = currentPose === 'seated-head';
    const target = new THREE.Vector3(0, headStudy ? .98 : currentPose === 'standing-back' ? .9 : .78, currentPose === 'seated-back' ? .18 : .08);
    const distance = headStudy ? 3.35 : 2.85;
    const positions: Record<ViewId, THREE.Vector3> = {
      front: new THREE.Vector3(0, .12, distance),
      side: new THREE.Vector3(distance, .12, 0),
      back: new THREE.Vector3(0, .12, -distance),
      perspective: new THREE.Vector3(distance * .75, .45, distance),
    };
    camera.position.copy(target).add(positions[currentView]);
    controls.target.copy(target);
    controls.update();
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
      const loader = new GLTFLoader();
      const [employeeGLTF, chairGLTF, potGLTF] = await Promise.all([
        loader.loadAsync(`${assetRoot}employee-base-v1.glb`),
        loader.loadAsync(`${assetRoot}chair-v1.glb`),
        loader.loadAsync(`${assetRoot}pot-v1.glb`),
      ]);
      if (disposed) return;
      employee = normalizeEmployee(employeeGLTF.scene);
      chair = chairGLTF.scene;
      pot = potGLTF.scene;
      prepareMeshes(employee);
      prepareMeshes(chair);
      prepareMeshes(pot);
      scene.add(employee, chair, pot);
      const idle = employeeGLTF.animations.find(clip => clip.name === 'idle');
      if (!idle) throw new Error('员工候选缺少 idle');
      const mixer = new THREE.AnimationMixer(employee);
      mixer.clipAction(idle).play();
      mixer.update(.35);
      mixer.stopAllAction();
      employee.updateMatrixWorld(true);
      rest = new Map();
      employee.traverse(object => rest.set(object.uuid, { position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone() }));
      measureChair();
      ready = true;
      applyPose('standing-back');
      loading.hidden = true;
      stage.dataset.ready = 'true';
    } catch (error) {
      loading.hidden = true;
      errorBox.hidden = false;
      errorBox.textContent = `组合资产读取失败：${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  const click = (event: MouseEvent) => {
    if (!ready) return;
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.pose) applyPose(button.dataset.pose as PoseId);
    if (button.dataset.view) {
      currentView = button.dataset.view as ViewId;
      host.querySelectorAll('[data-view]').forEach(item => item.classList.toggle('is-active', item === button));
      frameCamera();
    }
  };
  host.addEventListener('click', click);
  const qa = {
    get ready() { return ready; },
    state: () => getState(),
    setPose: (id: PoseId) => applyPose(id),
    setView: (id: ViewId) => { currentView = id; frameCamera(); },
  };
  Object.assign(window, { __compositionQA: qa });
  function animate() {
    if (disposed) return;
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
      delete (window as Window & { __compositionQA?: unknown }).__compositionQA;
      host.innerHTML = '';
    },
  };
}

// Independent visual entry: never boot gameplay, rules, input or another WebGL scene.
const preview = mountCompositionPreview(document.querySelector<HTMLElement>('#ui')!);
window.addEventListener('pagehide', () => preview.destroy(), { once: true });
