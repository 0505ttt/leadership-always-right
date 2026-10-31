import './asset-gallery.css';
import './office-preview.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createOfficeEnvironment } from './environment';
import { measureVisualBounds } from './visual-utils';
import { generateWorld } from '../world/generate';
import { createGame } from '../rules/game';

type View = 'room' | 'ceiling' | 'desk' | 'partition';
type Scenario = 'default' | 'low' | 'raised' | 'transparent';
const world = generateWorld(618);
const state = createGame(world);
const pressureRoom = world.rooms.find(room => room.pressure)!;
const partition = world.walls.find(wall => wall.id === `partition-${pressureRoom.id}`)!;
const desk = world.desks.find(item => item.id === 'desk-3')!;
let currentView: View = 'room';
let currentScenario: Scenario = 'default';

function bounds(root: THREE.Object3D) {
  const box = measureVisualBounds(root);
  return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
}

export function mountOfficePreview(host: HTMLElement) {
  host.innerHTML = `<main class="asset-gallery office-preview"><header class="asset-gallery__header"><div><p>OFFICE SYSTEM / 004</p><h1>规则，落在真实表面。</h1></div><span>正式办公室组件 · 不启动玩法</span></header><nav class="asset-gallery__tabs" aria-label="办公室状态">${([
    ['default', '默认办公室', '顶板 2.80 m / 桌高 0.75 m'],
    ['low', '承压顶板', '下表面 1.60 m'],
    ['raised', '升高的项目桌', '桌面 1.90 m / 套管支撑'],
    ['transparent', '透明隔断', '真实高度 2.20 m'],
  ] as const).map(([id, title, subtitle], index) => `<button type="button" data-scenario="${id}" class="${index === 0 ? 'is-active' : ''}"><span>0${index + 1}</span><div>${title}<small>${subtitle}</small></div></button>`).join('')}</nav><section class="asset-gallery__stage" aria-label="真实办公室规则组件预览"></section><aside class="asset-gallery__info"><p class="asset-gallery__eyebrow">REAL MESH INSPECTION</p><h2>几何与状态一致</h2><p class="asset-gallery__note">显示的是 createOfficeEnvironment 的真实网格，不是替代示意图。读数取自当前世界坐标包围盒。</p><dl><div class="office-preview__reading"><dt>顶板整体最低表面</dt><dd data-reading="ceiling">—</dd></div><div class="office-preview__reading"><dt>桌脚 / 桌底接触</dt><dd data-reading="desk">—</dd></div><div class="office-preview__reading"><dt>隔断实际上下沿</dt><dd data-reading="partition">—</dd></div></dl><p class="office-preview__notice">使用种子 618 的正式 WorldDef 与 GameState，仅驱动表现更新。这里不验证通行、碰撞、帧率或整局试玩。</p></aside><footer class="asset-gallery__footer"><div class="asset-gallery__views">${([['room', '房间'], ['ceiling', '顶板'], ['desk', '桌腿'], ['partition', '隔断']] as const).map(([id, label]) => `<button type="button" data-view="${id}">${label}</button>`).join('')}</div><span>拖动旋转 · 滚轮缩放 · 右键平移</span></footer></main>`;
  const stage = host.querySelector<HTMLElement>('.asset-gallery__stage')!;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#293027');
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  stage.append(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(48, 1, .03, 150);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * .92;
  const environment = createOfficeEnvironment(world);
  scene.add(environment.root);
  // Preview-only fill makes recessed underside details readable in inspection captures.
  scene.add(new THREE.HemisphereLight(0xdde5d6, 0x9aa18e, .65));
  let disposed = false;
  let frame = 0;

  function applyScenario(scenario: Scenario) {
    currentScenario = scenario;
    state.pressureRooms = scenario === 'low' ? [pressureRoom.id] : [];
    state.pressureHeights = scenario === 'low' ? { [pressureRoom.id]: 1.6 } : {};
    state.deskHeights[desk.id] = scenario === 'raised' ? 1.9 : .75;
    state.transparentWalls = scenario === 'transparent' ? [partition.id] : [];
    environment.update(state);
    host.querySelectorAll('[data-scenario]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.scenario === scenario));
    setView(scenario === 'low' ? 'ceiling' : scenario === 'raised' ? 'desk' : scenario === 'transparent' ? 'partition' : 'room');
    updateReadings();
  }

  function setView(view: View) {
    currentView = view;
    const center = new THREE.Vector3(pressureRoom.x, 1.25, pressureRoom.z);
    const deskCenter = new THREE.Vector3(desk.x, state.deskHeights[desk.id] ?? .75, desk.z);
    if (view === 'room') {
      camera.position.set(pressureRoom.x + 3.6, 1.9, pressureRoom.z + 6.2);
      controls.target.copy(center);
    } else if (view === 'ceiling') {
      // Inspect the clear half of the room with the partition behind the camera.
      // This is a preview camera only; it does not change the production scene.
      camera.position.set(pressureRoom.x + 1.8, .62, pressureRoom.z - 1.2);
      controls.target.set(pressureRoom.x + 1.6, (state.pressureRooms.length ? state.pressureHeights[pressureRoom.id] ?? 1.6 : 2.8) - .12, pressureRoom.z - 5.8);
    } else if (view === 'desk') {
      camera.position.set(desk.x + 2.6, Math.max(.55, deskCenter.y * .53), desk.z + 2.7);
      controls.target.set(desk.x, deskCenter.y * .55, desk.z);
    } else {
      camera.position.set(partition.x + 3.8, 1.35, partition.z + 4.2);
      controls.target.set(partition.x, 1.1, partition.z);
    }
    controls.update();
    host.querySelectorAll('[data-view]').forEach(button => button.classList.toggle('is-active', (button as HTMLElement).dataset.view === view));
  }

  function measurements() {
    environment.root.updateMatrixWorld(true);
    const ceiling = environment.effects.ceilings.get(pressureRoom.id)!;
    const deskTop = environment.desks.get(desk.id)!;
    const underframe = deskTop.getObjectByName(`desk-underframe:${desk.id}`)!;
    const supportFrame = environment.root.getObjectByName(`desk-frame:${desk.id}`)!;
    const partitionMesh = environment.walls.get(partition.id)!;
    const partitionMaterial = partitionMesh.material as THREE.MeshStandardMaterial;
    const legs = supportFrame.children.filter(child => child.userData.deskLegRole).map(child => ({ role: child.userData.deskLegRole as string, ...bounds(child) }));
    return {
      scenario: currentScenario,
      view: currentView,
      ceiling: bounds(ceiling),
      expectedClearance: state.pressureRooms.includes(pressureRoom.id) ? state.pressureHeights[pressureRoom.id] : 2.8,
      deskHeight: state.deskHeights[desk.id],
      deskUnderframe: bounds(underframe),
      legs,
      partition: { id: partition.id, expected: { minY: 0, maxY: partition.height }, ...bounds(partitionMesh) },
      partitionMaterial: { transparent: partitionMaterial.transparent, opacity: partitionMaterial.opacity, depthWrite: partitionMaterial.depthWrite },
      partitionDiagnostics: environment.getDiagnostics().partitions.filter(item => item.id === partition.id),
      transparent: state.transparentWalls.includes(partition.id),
    };
  }

  function updateReadings() {
    const data = measurements();
    host.querySelector('[data-reading="ceiling"]')!.textContent = `Y ${data.ceiling.min[1].toFixed(3)} m / 目标 ${data.expectedClearance!.toFixed(3)} m`;
    host.querySelector('[data-reading="desk"]')!.textContent = `脚底 Y ${Math.min(...data.legs.map(leg => leg.min[1])).toFixed(3)} m · 桌底 Y ${data.deskUnderframe.min[1].toFixed(3)} m`;
    host.querySelector('[data-reading="partition"]')!.textContent = `Y ${data.partition.min[1].toFixed(3)}–${data.partition.max[1].toFixed(3)} m · ${data.transparent ? '透明' : '不透明'}`;
  }

  function resize() {
    const width = stage.clientWidth, height = stage.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  host.addEventListener('click', event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.dataset.scenario) applyScenario(button.dataset.scenario as Scenario);
    if (button.dataset.view) setView(button.dataset.view as View);
  });
  Object.assign(window, { __officeQA: {
    ready: true,
    state: measurements,
    setScenario: applyScenario,
    setView,
    measure(configuration: { clearance: number; deskHeight: number; transparent?: boolean }) {
      state.pressureRooms = [pressureRoom.id];
      state.pressureHeights = { [pressureRoom.id]: configuration.clearance };
      state.deskHeights[desk.id] = configuration.deskHeight;
      state.transparentWalls = configuration.transparent ? [partition.id] : [];
      environment.update(state);
      return measurements();
    },
  } });
  function animate() {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    frame = requestAnimationFrame(animate);
  }
  applyScenario('default');
  resize();
  animate();
  stage.dataset.ready = 'true';
  return {
    destroy() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      environment.dispose();
      renderer.dispose();
      delete (window as Window & { __officeQA?: unknown }).__officeQA;
      host.innerHTML = '';
    },
  };
}

const preview = mountOfficePreview(document.querySelector<HTMLElement>('#ui')!);
window.addEventListener('pagehide', () => preview.destroy(), { once: true });
