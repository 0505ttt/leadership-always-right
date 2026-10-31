import './asset-gallery.css';
import './character-motion-preview.css';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { createCharacterLibrary, type CharacterVisual } from './characters';
import { createCharacterMotion, type CharacterMotion, type CharacterMotionInput } from './character-motion';

type PreviewPose = 'seated-low' | 'chair-mount' | 'chair-work' | 'chair-pot' | 'chair-dismount' | 'chair-recover' | 'leader-patrol' | 'leader-inspect' | 'leader-search-left' | 'leader-search-right';
type View = 'front' | 'side' | 'back' | 'perspective';
type EmployeePose = Extract<PreviewPose, 'seated-low' | 'chair-mount' | 'chair-work' | 'chair-pot' | 'chair-dismount' | 'chair-recover'>;
interface ActorEntry { visual: CharacterVisual; motion: CharacterMotion; x: number }

const specs: Record<PreviewPose, { label: string; subtitle: string; note: string; preset: number; duration: number }> = {
  'seated-low': { label: '低顶坐姿继承', subtitle: '员工 + 同事 · 1.60 m', note: '沿用既有 working＋crown＋clearance 路径。两把椅子都在地面，未重新生成模型。', preset: .6, duration: .6 },
  'chair-mount': { label: '分步上椅', subtitle: '左脚先支撑 · 右脚跟进', note: '冻结在过渡中段。0.78 秒上椅，左右脚错峰抬起；髋部、双手随后接入桌面高度。', preset: .32, duration: 1.8 },
  'chair-work': { label: '升高工位办公', subtitle: '双人 · 桌面 1.90 m', note: '主角和同事使用同一表现接口。脚踝目标为座面以上 105 毫米；手腕目标为桌面以上 85 毫米、前伸 500 毫米，另测真实掌面接触。', preset: 1, duration: 3 },
  'chair-pot': { label: '椅上背锅', subtitle: '生产 back 挂点 · 净高参考', note: '真实 pot-v1 按生产 standing 分支放在 back 挂点。半透明参考面为地面以上 2.35 米，不是主场景顶板。', preset: 1, duration: 3 },
  'chair-dismount': { label: '离椅落地', subtitle: '0.56 秒 · 恢复站立', note: '从椅上站立恢复到地面 idle。支撑权重下降，最终回到原始 standing 路径。', preset: .31, duration: 1.57 },
  'chair-recover': { label: '下椅恢复坐姿', subtitle: '0.56 秒 · 挂点同步复位', note: '从椅上办公恢复原坐姿，并恢复椅子和 seat 挂点的地面局部坐标。', preset: .39, duration: 1.57 },
  'leader-patrol': { label: '领导巡视', subtitle: '2.0 m/s · walk 片段', note: '正式领导 walk 骨骼片段。移动速度只用于步频匹配，权威位置和路线仍由 Codex 驱动。', preset: .65, duration: 3 },
  'leader-inspect': { label: '停步检查', subtitle: '0.18 秒过渡 · 手势', note: '从巡视切入停步检查，冻结在混合中段；停止 walking 语义，保留手势观察。', preset: .08, duration: 1.2 },
  'leader-search-left': { label: '快速搜查 · 左', subtitle: '7.2 m/s · 左侧 90°', note: '搜索目标速度为玩家奔跑参考 4.8 m/s 的 1.5 倍。Spine2／Neck／Head 分担扫视，不旋转权威根节点。', preset: .2, duration: 3 },
  'leader-search-right': { label: '快速搜查 · 右', subtitle: '7.2 m/s · 右侧 90°', note: '右扫与左扫共用同一接口，输入超过 ±90° 时钳制。地面弧线只表示动作范围，不是视野或追踪判定。', preset: .2, duration: 3 },
};
const input = (overrides: Partial<CharacterMotionInput> = {}): CharacterMotionInput => ({
  pose: 'standing', moving: false, sprint: false, time: 0, holding: false, pot: 'none', ...overrides,
});

function deformedBounds(actor: CharacterVisual, partRoot?: THREE.Bone, accept?: (world: THREE.Vector3) => boolean) {
  actor.root.updateMatrixWorld(true);
  const box = new THREE.Box3().makeEmpty() as THREE.Box3 & { samples: number };
  box.samples = 0;
  const vertex = new THREE.Vector3();
  const partBones: THREE.Bone[] = [];
  partRoot?.traverse(object => { if (object instanceof THREE.Bone) partBones.push(object); });
  actor.poseRoot.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    for (let index = 0; index < indices.count; index++) {
      if (partRoot) {
        let weight = 0;
        for (let influence = 0; influence < 4; influence++) {
          if (partBones.includes(object.skeleton.bones[indices.getComponent(index, influence)])) weight += weights.getComponent(index, influence);
        }
        if (weight < .5) continue;
      }
      object.getVertexPosition(index, vertex);
      vertex.applyMatrix4(object.matrixWorld);
      if (accept && !accept(vertex)) continue;
      box.expandByPoint(vertex);
      box.samples++;
    }
  });
  return box;
}

export function mountCharacterMotionPreview(host: HTMLElement) {
  host.innerHTML = `<main class="asset-gallery character-motion-preview">
    <header class="asset-gallery__header"><div><p>MOTION HANDOFF / 004</p><h1>升高之后，动作仍然落地。</h1></div><span>独立表现补丁 · 正式 GLB · 不启动玩法</span></header>
    <nav class="asset-gallery__tabs" aria-label="角色动作">
      <p class="character-motion-preview__group">员工 / 主角</p>
      ${(['seated-low', 'chair-mount', 'chair-work', 'chair-pot', 'chair-dismount', 'chair-recover'] as const).map((id, index) => `<button type="button" data-pose="${id}"><span>0${index + 1}</span><div>${specs[id].label}<small>${specs[id].subtitle}</small></div></button>`).join('')}
      <p class="character-motion-preview__group">领导</p>
      ${(['leader-patrol', 'leader-inspect', 'leader-search-left', 'leader-search-right'] as const).map((id, index) => `<button type="button" data-pose="${id}"><span>0${index + 7}</span><div>${specs[id].label}<small>${specs[id].subtitle}</small></div></button>`).join('')}
    </nav>
    <section class="asset-gallery__stage" aria-label="正式角色动作三维预览"><div class="asset-gallery__loading" role="status">正在加载正式角色与骨骼动作…</div></section>
    <aside class="asset-gallery__info"><p class="asset-gallery__eyebrow">SKELETON / CONTACT / CLEARANCE</p><span class="character-motion-preview__badge">PRESENTATION ONLY</span><h2></h2><p class="asset-gallery__note"></p><dl>
      <div><dt>动作状态 / 支撑 / 过渡</dt><dd data-diagnostic="activity">—</dd></div>
      <div><dt>脚踝 / 手腕目标 · 掌面实测</dt><dd data-diagnostic="contacts">—</dd></div>
      <div><dt>实际蒙皮与道具最高点</dt><dd data-diagnostic="height">—</dd></div>
      <div><dt>领导步频 / 扫视</dt><dd data-diagnostic="leader">—</dd></div>
    </dl><p class="character-motion-preview__status"></p><p class="asset-gallery__caveat">真实模型、骨架、接触与独立浏览器检查。速度、视野、触发、追踪和整局性能仍由 Codex 验收。</p></aside>
    <footer class="asset-gallery__footer"><div class="asset-gallery__views">${[['front', '正面'], ['side', '侧面'], ['back', '背面'], ['perspective', '三分之四']].map(([id, label]) => `<button type="button" data-view="${id}" class="${id === 'perspective' ? 'is-active' : ''}">${label}</button>`).join('')}</div><button type="button" class="character-motion-preview__play" data-playing="false">播放衔接</button><span>拖动旋转 · 滚轮缩放 · 点击动作可冻结关键帧</span></footer>
    <div class="asset-gallery__error character-motion-preview__error" role="alert" hidden></div>
  </main>`;

  const stage = host.querySelector<HTMLElement>('.asset-gallery__stage')!;
  const loading = host.querySelector<HTMLElement>('.asset-gallery__loading')!;
  const errorBox = host.querySelector<HTMLElement>('.asset-gallery__error')!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#202720');
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  stage.append(renderer.domElement);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const environment = pmrem.fromScene(room, .04);
  scene.environment = environment.texture;
  room.dispose();
  const camera = new THREE.PerspectiveCamera(36, 1, .01, 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = .7;
  controls.maxDistance = 10;
  controls.maxPolarAngle = Math.PI * .86;
  scene.add(new THREE.HemisphereLight('#e8ecd8', '#454237', 1.5));
  const key = new THREE.DirectionalLight('#ffedcd', 3.2);
  key.position.set(3, 5, 4); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = key.shadow.camera.bottom = -4;
  key.shadow.camera.right = key.shadow.camera.top = 4;
  key.shadow.bias = -.00025;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#c4d5cf', 1.3); fill.position.set(-3, 3, -2); scene.add(fill);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.MeshStandardMaterial({ name: '预览 · 哑光地面', color: '#3e493b', roughness: .96 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const grid = new THREE.GridHelper(10, 40, '#82917b', '#4b5847'); grid.position.y = .002; scene.add(grid);
  const guide = new THREE.Group(); guide.name = '预览 · 净空参考'; scene.add(guide);
  const guidePlane = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.1), new THREE.MeshBasicMaterial({ name: '预览 · 透明净空面', color: '#e4b96f', transparent: true, opacity: .055, side: THREE.DoubleSide, depthWrite: false }));
  guidePlane.rotation.x = -Math.PI / 2; guide.add(guidePlane);
  const guideEdges = new THREE.LineSegments(new THREE.EdgesGeometry(guidePlane.geometry), new THREE.LineBasicMaterial({ color: '#e4b96f', transparent: true, opacity: .65 }));
  guideEdges.rotation.x = -Math.PI / 2; guide.add(guideEdges);

  const desks: THREE.Group[] = [];
  const deskMaterial = new THREE.MeshStandardMaterial({ name: '预览 · 升高桌面', color: '#8a8067', roughness: .75 });
  const frameMaterial = new THREE.MeshStandardMaterial({ name: '预览 · 桌腿支撑', color: '#39443d', roughness: .65, metalness: .25 });
  for (const x of [-.68, .68]) {
    const desk = new THREE.Group(); desk.position.set(x, 0, .69); desk.name = `预览 · 升高工位 ${x}`;
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.16, .06, .65), deskMaterial); top.name = 'desktop'; top.castShadow = top.receiveShadow = true; desk.add(top);
    for (const legX of [-.48, .48]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(.045, 1, .045), frameMaterial); leg.name = 'leg'; leg.position.set(legX, .5, .18); leg.castShadow = true; desk.add(leg);
    }
    desks.push(desk); scene.add(desk);
  }
  function setDeskHeight(height: number) {
    for (const desk of desks) {
      desk.getObjectByName('desktop')!.position.y = height - .03;
      for (const leg of desk.children.filter(child => child.name === 'leg')) leg.scale.y = height - .06, leg.position.y = (height - .06) / 2;
    }
  }
  const scanPoints: THREE.Vector3[] = [];
  for (let index = 0; index <= 60; index++) {
    const angle = -Math.PI / 2 + index / 60 * Math.PI;
    scanPoints.push(new THREE.Vector3(Math.sin(angle) * 1.35, .015, Math.cos(angle) * 1.35));
  }
  const scanArc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(scanPoints), new THREE.LineBasicMaterial({ color: '#e4b96f', transparent: true, opacity: .8 }));
  scanArc.name = '预览 · 180度扫视参考'; scene.add(scanArc);

  let library: ReturnType<typeof createCharacterLibrary> | undefined;
  let employee: ActorEntry, colleague: ActorEntry, leader: ActorEntry;
  let pot: THREE.Object3D;
  let currentPose: PreviewPose = 'chair-work';
  let currentView: View = 'perspective';
  let ready = false, disposed = false, playing = false;
  let playStarted = 0, frame = 0;
  const activeEntries = () => currentPose.startsWith('leader') ? [leader] : [employee, colleague];
  const isEmployeePose = (pose: PreviewPose): pose is EmployeePose => !pose.startsWith('leader');

  function resetActors() {
    for (const entry of [employee, colleague, leader]) {
      entry.motion.reset();
      entry.visual.root.position.set(entry.x, 0, 0);
      entry.visual.root.rotation.set(0, 0, 0);
      entry.visual.root.visible = entry === leader ? currentPose.startsWith('leader') : !currentPose.startsWith('leader');
    }
  }
  function employeeInput(pose: EmployeePose, phase: number): CharacterMotionInput {
    if (pose === 'seated-low') return input({ pose: 'working', pot: 'crown', clearance: 1.6, time: phase });
    return input({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, pot: pose === 'chair-pot' ? 'back' : 'none', time: phase });
  }
  function sample(pose: PreviewPose, phase: number) {
    currentPose = pose;
    resetActors();
    if (isEmployeePose(pose)) {
      const seat = employee.visual.chairContact.seatY;
      for (const entry of [employee, colleague]) {
        if (pose === 'seated-low') {
          entry.motion.update(employeeInput(pose, phase));
          continue;
        }
        entry.motion.update(input({ pose: 'working', time: 0 }));
        entry.visual.root.position.y = seat;
        entry.motion.update(employeeInput(pose, .01));
        if (pose === 'chair-mount') entry.motion.update(employeeInput(pose, Math.max(.01, phase)));
        else if (pose === 'chair-work' || pose === 'chair-pot') entry.motion.update(employeeInput(pose, Math.max(1, phase)));
        else {
          entry.motion.update(employeeInput(pose, 1));
          entry.visual.root.position.y = 0;
          const recovering = pose === 'chair-recover';
          entry.motion.update(input({ pose: recovering ? 'working' : 'standing', workStance: 'seated', deskHeight: recovering ? .75 : 1.9, time: 1.01 }));
          entry.motion.update(input({ pose: recovering ? 'working' : 'standing', workStance: 'seated', deskHeight: recovering ? .75 : 1.9, time: Math.max(1.01, phase + 1.01) }));
        }
      }
      setDeskHeight(pose === 'seated-low' ? .75 : 1.9);
    } else {
      const mode = pose === 'leader-patrol' ? 'patrol' : pose === 'leader-inspect' ? 'inspect' : 'search';
      const speed = mode === 'search' ? 7.2 : mode === 'patrol' ? 2 : 0;
      const look = pose === 'leader-search-left' ? Math.PI / 2 : pose === 'leader-search-right' ? -Math.PI / 2 : 0;
      if (mode === 'inspect') {
        leader.motion.update(input({ leaderMode: 'patrol', moving: true, speed: 2, time: 0 }));
        leader.motion.update(input({ leaderMode: 'inspect', speed: 0, time: .01 }));
        leader.motion.update(input({ leaderMode: 'inspect', speed: 0, time: Math.max(.01, phase) }));
      } else if (mode === 'search') {
        leader.motion.update(input({ leaderMode: 'inspect', speed: 0, time: 0 }));
        leader.motion.update(input({ leaderMode: 'search', moving: true, speed, lookYawOffset: look, time: .01 }));
        leader.motion.update(input({ leaderMode: 'search', moving: true, speed, lookYawOffset: look, time: Math.max(.01, phase) }));
      } else leader.motion.update(input({ leaderMode: 'patrol', moving: true, speed, time: phase }));
    }
    for (const desk of desks) desk.visible = !pose.startsWith('leader');
    pot.visible = pose === 'chair-pot';
    guide.visible = pose === 'chair-pot' || pose === 'seated-low';
    guide.position.set(0, pose === 'seated-low' ? 1.6 : 2.35, .16);
    scanArc.visible = pose === 'leader-search-left' || pose === 'leader-search-right';
    if (pot.visible) {
      pot.position.copy(employee.visual.anchors.back.getWorldPosition(new THREE.Vector3()));
      pot.rotation.set(Math.PI / 2, 0, 0);
      pot.updateMatrixWorld(true);
    }
    scene.updateMatrixWorld(true);
    updatePanel();
  }

  function getState() {
    const actors = activeEntries().map(entry => {
      const diagnostics = entry.motion.getDiagnostics();
      const measured = entry.visual.measure(pot.visible && entry === employee ? pot : undefined);
      const skin = deformedBounds(entry.visual);
      const potBox = pot.visible && entry === employee ? new THREE.Box3().setFromObject(pot) : null;
      const soles = Object.fromEntries((['Left', 'Right'] as const).map(side => {
        const bounds = deformedBounds(entry.visual, entry.visual.bones[`${side}Foot`]);
        const seat = entry.visual.chair.localToWorld(new THREE.Vector3(0, entry.visual.chairContact.seatY, entry.visual.chairContact.seatProbeZ));
        return [side, { minY: bounds.min.y, seatY: seat.y, error: bounds.min.y - seat.y }];
      }));
      const handSurfaces = Object.fromEntries((['Left', 'Right'] as const).map(side => {
        const bounds = deformedBounds(entry.visual, entry.visual.bones[`${side}Hand`], world => {
          const local = entry.visual.root.worldToLocal(world.clone());
          return local.z >= .365 && local.z <= 1.015 && Math.abs(local.x) <= .58;
        });
        const desktopY = currentPose.startsWith('leader') ? null : currentPose === 'seated-low' || currentPose === 'chair-recover' ? .75 : 1.9;
        return [side, { minY: bounds.min.y, maxY: bounds.max.y, desktopY, clearance: desktopY === null || !bounds.samples ? null : bounds.min.y - desktopY, samples: bounds.samples, bounds: { min: bounds.min.toArray(), max: bounds.max.toArray() }, footprint: { frontZ: .365, backZ: 1.015, halfWidth: .58 } }];
      }));
      const materials = new Set<THREE.Material>();
      let matrixFinite = true, chairCount = 0;
      entry.visual.root.traverse(object => {
        if (object.name.startsWith('character-chair:')) chairCount++;
        matrixFinite = matrixFinite && object.matrixWorld.elements.every(Number.isFinite);
        if (object instanceof THREE.Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
      });
      return {
        kind: entry.visual.kind, assetId: entry.visual.assetId, rootPosition: entry.visual.root.position.toArray(), chairPosition: entry.visual.chair.position.toArray(), chairWorldPosition: entry.visual.chair.getWorldPosition(new THREE.Vector3()).toArray(), chairVisible: entry.visual.chair.visible, chairCount,
        diagnostics, measured, actualBodyMaxY: skin.max.y, actualCombinedMaxY: Math.max(skin.max.y, potBox?.max.y ?? -Infinity), potBounds: potBox ? { min: potBox.min.toArray(), max: potBox.max.toArray() } : null,
        soles, handSurfaces, matrixFinite, materials: [...materials].map(material => ({ name: material.name, type: material.type })),
        joints: Object.fromEntries(['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'Head', 'Neck', 'Spine2'].map(name => [name, entry.visual.bones[name].getWorldPosition(new THREE.Vector3()).toArray()])),
      };
    });
    return { ready, pose: currentPose, view: currentView, playing, actors, renderer: { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } };
  }

  function updatePanel() {
    if (!ready) return;
    const spec = specs[currentPose];
    host.querySelector('h2')!.textContent = spec.label;
    host.querySelector('.asset-gallery__note')!.textContent = spec.note;
    const primary = activeEntries()[0].motion.getDiagnostics();
    host.querySelector('[data-diagnostic="activity"]')!.textContent = `${primary.activity} · support ${primary.support.toFixed(3)} · blend ${(primary.transitionProgress * 100).toFixed(0)}%`;
    const feet = Object.values(primary.feet).map(value => value.verticalError * 1000);
    const hands = Object.values(primary.hands).map(value => value.error * 1000);
    const state = getState();
    const skinHands = Object.values(state.actors[0].handSurfaces).map(value => value.clearance === null ? null : value.clearance * 1000);
    const elevatedWork = currentPose === 'chair-work' || currentPose === 'chair-pot';
    host.querySelector('[data-diagnostic="contacts"]')!.textContent = currentPose.startsWith('leader')
      ? '移动姿态沿用正式骨骼片段；本页无手部接触目标'
      : `脚踝目标 ${feet.map(value => value.toFixed(1)).join(' / ')} mm · 手腕目标 ${hands.map(value => value.toFixed(1)).join(' / ')} mm${elevatedWork ? ` · 掌面距桌 ${skinHands.map(value => value === null ? '—' : value.toFixed(1)).join(' / ')} mm` : ''}`;
    host.querySelector('[data-diagnostic="height"]')!.textContent = state.actors.map(actor => `${actor.kind}: ${actor.actualCombinedMaxY.toFixed(4)} m`).join(' · ');
    host.querySelector('[data-diagnostic="leader"]')!.textContent = currentPose.startsWith('leader') ? `cadence ${primary.cadence.toFixed(3)}× · yaw ${(primary.appliedLookYaw * 180 / Math.PI).toFixed(1)}°` : '领导接口独立于员工上椅状态';
    const status = host.querySelector<HTMLElement>('.character-motion-preview__status')!;
    if (currentPose === 'chair-pot') {
      const maximum = Math.max(...state.actors.map(actor => actor.actualCombinedMaxY));
      status.textContent = `实际蒙皮＋背锅最高点 ${maximum.toFixed(4)} m；参考线 2.35 m，${maximum <= 2.35 ? '未越界' : '越界，需修正'}。`;
    } else if (currentPose === 'chair-work' || currentPose === 'chair-mount') status.textContent = `两名角色 chairVisible=${state.actors.every(actor => actor.chairVisible)}；各保留一把内部正式椅，外部根高度由 Codex 决定。`;
    else if (currentPose.startsWith('leader')) status.textContent = '扫视只改变表现骨骼；不擅自移动角色根节点、设置追踪或扩大视野。';
    else status.textContent = '恢复完成需回到原路径；当前截图只代表所冻结的过渡时刻。';
    stage.dataset.ready = String(ready);
    stage.dataset.pose = currentPose;
    stage.dataset.activity = primary.activity;
    stage.dataset.support = primary.support.toFixed(6);
  }

  function frameCamera() {
    const leaderView = currentPose.startsWith('leader');
    const target = new THREE.Vector3(0, leaderView ? 1.02 : 1.13, leaderView ? .05 : .16);
    const distance = leaderView ? 3.4 : 4.65;
    const offsets: Record<View, THREE.Vector3> = {
      front: new THREE.Vector3(0, .2, distance),
      side: new THREE.Vector3(distance, .12, 0),
      back: new THREE.Vector3(0, .16, -distance),
      perspective: new THREE.Vector3(distance * .68, .48, distance),
    };
    camera.position.copy(target).add(offsets[currentView]);
    controls.target.copy(target); controls.update();
  }
  function setPose(pose: PreviewPose, phase?: number) {
    if (!ready) return;
    playing = false;
    sample(pose, phase ?? specs[pose].preset);
    host.querySelectorAll('[data-pose]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.pose === pose));
    host.querySelector<HTMLElement>('.character-motion-preview__play')!.dataset.playing = 'false';
    host.querySelector<HTMLElement>('.character-motion-preview__play')!.textContent = '播放衔接';
    frameCamera();
  }
  function setView(view: View) {
    currentView = view;
    host.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.view === view));
    frameCamera();
  }
  function togglePlayback() {
    if (!ready) return;
    playing = !playing;
    if (playing) playStarted = performance.now();
    else sample(currentPose, specs[currentPose].preset);
    host.querySelector<HTMLElement>('.character-motion-preview__play')!.dataset.playing = String(playing);
    host.querySelector<HTMLElement>('.character-motion-preview__play')!.textContent = playing ? '暂停并回关键帧' : '播放衔接';
  }
  function benchmark(iterations = 120) {
    const results: Record<string, { iterations: number; totalMs: number; averageMs: number }> = {};
    for (const entry of [employee, leader]) {
      const isLeader = entry === leader;
      const start = performance.now();
      for (let index = 0; index < iterations; index++) {
        const time = 2 + index / 60;
        entry.motion.update(isLeader
          ? input({ leaderMode: 'search', moving: true, speed: 7.2, lookYawOffset: Math.sin(index) * Math.PI / 2, time })
          : input({ pose: 'working', workStance: 'chair-standing', deskHeight: 1.9, time }));
      }
      const totalMs = performance.now() - start;
      results[entry.visual.kind] = { iterations, totalMs, averageMs: totalMs / iterations };
    }
    sample(currentPose, specs[currentPose].preset);
    return { scope: '单次 motion.update 的浏览器 CPU 耗时；不含渲染、FPS、GPU 或整局性能结论', results };
  }
  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height; camera.updateProjectionMatrix();
  }
  async function prepare() {
    try {
      library = createCharacterLibrary();
      const [potGLTF] = await Promise.all([
        new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/tripo/pot-v1.glb`),
        library.prepare(renderer, camera, scene),
      ]);
      if (disposed) return;
      employee = { visual: library.createEmployee(), motion: undefined as unknown as CharacterMotion, x: -.68 };
      employee.motion = createCharacterMotion(employee.visual);
      const colleagueVisual = library.createColleague('07');
      colleague = { visual: colleagueVisual, motion: createCharacterMotion(colleagueVisual), x: .68 };
      const leaderVisual = library.createLeader();
      leader = { visual: leaderVisual, motion: createCharacterMotion(leaderVisual), x: 0 };
      pot = potGLTF.scene; pot.name = '预览 · 生产 pot-v1';
      pot.traverse(object => { if (object instanceof THREE.Mesh) object.castShadow = object.receiveShadow = true; });
      scene.add(employee.visual.root, colleague.visual.root, leader.visual.root, pot);
      ready = true;
      setPose('chair-work');
      loading.hidden = true;
    } catch (error) {
      loading.hidden = true; errorBox.hidden = false;
      errorBox.textContent = `角色动作预览加载失败：${error instanceof Error ? error.message : String(error)}`;
      throw error;
    }
  }

  const observer = new ResizeObserver(resize); observer.observe(stage);
  const click = (event: MouseEvent) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !ready) return;
    if (button.dataset.pose) setPose(button.dataset.pose as PreviewPose);
    else if (button.dataset.view) setView(button.dataset.view as View);
    else if (button.classList.contains('character-motion-preview__play')) togglePlayback();
  };
  host.addEventListener('click', click);
  const qa = { get ready() { return ready; }, state: getState, setPose, pose: setPose, setView, play: togglePlayback, benchmark };
  Object.assign(window, { __characterMotionQA: qa });
  function animate(now: number) {
    if (disposed) return;
    if (ready && playing) {
      const phase = Math.min((now - playStarted) / 1000, specs[currentPose].duration);
      sample(currentPose, phase);
      if (phase >= specs[currentPose].duration) {
        playing = false;
        host.querySelector<HTMLElement>('.character-motion-preview__play')!.dataset.playing = 'false';
        host.querySelector<HTMLElement>('.character-motion-preview__play')!.textContent = '播放衔接';
      }
    }
    controls.update(); renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }
  resize(); animate(performance.now()); void prepare();
  return {
    destroy() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect(); host.removeEventListener('click', click);
      controls.dispose(); library?.dispose();
      const geometries = new Set<THREE.BufferGeometry>(), materials = new Set<THREE.Material>(), textures = new Set<THREE.Texture>();
      scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
      });
      textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose()); geometries.forEach(geometry => geometry.dispose());
      scanArc.geometry.dispose(); (scanArc.material as THREE.Material).dispose();
      (guideEdges.material as THREE.Material).dispose(); guideEdges.geometry.dispose();
      environment.dispose(); pmrem.dispose(); renderer.dispose();
      delete (window as Window & { __characterMotionQA?: unknown }).__characterMotionQA;
      host.innerHTML = '';
    },
  };
}

const preview = mountCharacterMotionPreview(document.querySelector<HTMLElement>('#ui')!);
window.addEventListener('pagehide', () => preview.destroy(), { once: true });
