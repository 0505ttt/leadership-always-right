import * as THREE from 'three';
import type { Pose } from '../contracts/game';
import { VisualResourcePool, addBox, makeLabel, measureVisualBounds } from './visual-utils';

export type CharacterKind = 'employee' | 'leader' | 'colleague';
export type CharacterAnchorKind = 'hand' | 'back' | 'crown';
export type PotPose = 'none' | 'hand' | 'back' | 'crown';

export interface CharacterPoseInput {
  pose: Pose;
  moving: boolean;
  sprint: boolean;
  /** Absolute presentation time in seconds, not a gameplay timer. */
  time: number;
  holding: boolean;
  pot: PotPose;
  /** Optional explicit speech/grip performance; never inferred from AI state. */
  gesturing?: boolean;
  /**
   * Optional local clear height in metres, bound from authoritative room state.
   * Only working+crown uses it to select a lower pose; collision stays unchanged.
   */
  clearance?: number;
}

export interface BoundsData {
  min: number[];
  max: number[];
  size: number[];
}

export interface CharacterMeasurement {
  body: BoundsData;
  chair: BoundsData | null;
  combined: BoundsData;
  height: number;
  anchors: Record<string, number[]>;
}

export interface ChairContact {
  seatY: number;
  seatProbeZ: number;
  backrestFrontZ: number;
  backrestProbeY: number;
}

export interface CharacterVisual {
  readonly kind: CharacterKind;
  readonly assetId: string;
  readonly root: THREE.Group;
  readonly poseRoot: THREE.Group;
  readonly chair: THREE.Object3D;
  readonly anchors: Record<CharacterAnchorKind | 'grip' | 'head' | 'pelvis' | 'seat' | 'leftHand' | 'rightHand' | 'leftFoot' | 'rightFoot', THREE.Object3D>;
  readonly bones: Record<string, THREE.Bone>;
  readonly animations: readonly string[];
  readonly chairContact: ChairContact;
  update(input: CharacterPoseInput): void;
  /** Uniform visual scale, e.g. leader 1.35 for about 2.5 m; no collision changes. */
  setScale(scale: number): void;
  /** Measures in character-root coordinates. Optionally include the independently placed pot. */
  measure(extra?: THREE.Object3D): CharacterMeasurement;
  getDiagnostics(): CharacterMeasurement & { assetId: string; kind: CharacterKind; animations: readonly string[]; chairContact: ChairContact };
  dispose(): void;
}

interface RestTransform {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
}

function boxData(box: THREE.Box3): BoundsData {
  return { min: box.min.toArray(), max: box.max.toArray(), size: box.getSize(new THREE.Vector3()).toArray() };
}

/** Current-pose skinned bounds in the semantic character's coordinate system. */
function localBounds(space: THREE.Object3D, content: THREE.Object3D): THREE.Box3 {
  space.updateWorldMatrix(true, true);
  const inverse = space.matrixWorld.clone().invert();
  const box = new THREE.Box3().makeEmpty();
  content.traverse(object => {
    const matrix = new THREE.Matrix4().multiplyMatrices(inverse, object.matrixWorld);
    if (object instanceof THREE.SkinnedMesh) {
      object.computeBoundingBox();
      box.union(object.boundingBox.clone().applyMatrix4(matrix));
    } else if (object instanceof THREE.Mesh) {
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      box.union(object.geometry.boundingBox!.clone().applyMatrix4(matrix));
    }
  });
  return box;
}

function toWorld(root: THREE.Object3D, point: THREE.Vector3): THREE.Vector3 {
  root.updateWorldMatrix(true, false);
  return root.localToWorld(point.clone());
}

function toLocal(root: THREE.Object3D, point: THREE.Vector3): THREE.Vector3 {
  root.updateWorldMatrix(true, false);
  return root.worldToLocal(point.clone());
}

function aimBoneAtWorld(current: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  current.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const origin = current.getWorldPosition(new THREE.Vector3());
  const from = child.getWorldPosition(new THREE.Vector3()).sub(origin);
  const to = target.clone().sub(origin);
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  from.normalize();
  to.normalize();
  const inverseParent = current.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  from.applyQuaternion(inverseParent);
  to.applyQuaternion(inverseParent);
  current.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
  current.updateWorldMatrix(false, true);
}

function solveLimb(
  root: THREE.Object3D,
  upper: THREE.Object3D,
  lower: THREE.Object3D,
  end: THREE.Object3D,
  target: THREE.Vector3,
  pole: THREE.Vector3,
): void {
  root.updateWorldMatrix(true, true);
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
  if (bend.lengthSq() < 1e-6) bend.set(0, 0, 1).addScaledVector(direction, -direction.z);
  bend.normalize();
  const middleTarget = start.clone().addScaledVector(direction, along).addScaledVector(bend, height);
  aimBoneAtWorld(upper, lower, middleTarget);
  aimBoneAtWorld(lower, end, reachableTarget);
}

function rotateInRoot(root: THREE.Object3D, bone: THREE.Object3D, axis: THREE.Vector3, angle: number): void {
  root.updateWorldMatrix(true, true);
  const worldAxis = axis.clone().applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
  const localAxis = worldAxis.applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).normalize();
  bone.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(localAxis, angle));
  bone.updateWorldMatrix(false, true);
}

function translateHips(root: THREE.Object3D, hips: THREE.Bone, target: THREE.Vector3): void {
  root.updateWorldMatrix(true, true);
  // Set the absolute parent-local position: a quaternion-only delta loses the
  // armature's scale and translation and makes the hips miss the seat.
  hips.position.copy(hips.parent!.worldToLocal(toWorld(root, target)));
  hips.updateWorldMatrix(false, true);
}

function measureChairContact(chair: THREE.Object3D): ChairContact {
  chair.updateWorldMatrix(true, true);
  const inverse = chair.matrixWorld.clone().invert();
  const toChair = (point: THREE.Vector3) => point.applyMatrix4(inverse);
  const seatRay = new THREE.Raycaster(new THREE.Vector3(0, 1.25, .16), new THREE.Vector3(0, -1, 0));
  const seat = seatRay.intersectObject(chair, true)[0];
  const backRay = new THREE.Raycaster(new THREE.Vector3(0, .85, 1), new THREE.Vector3(0, 0, -1));
  const back = backRay.intersectObject(chair, true)[0];
  if (!seat || !back) throw new Error('chair-v1 cannot provide seat and backrest contact points');
  return {
    seatY: toChair(seat.point.clone()).y,
    seatProbeZ: .16,
    backrestFrontZ: toChair(back.point.clone()).z,
    backrestProbeY: .85,
  };
}

function requireBone(source: THREE.Object3D, name: string): THREE.Bone {
  const bone = source.getObjectByName(`mixamorig${name}`);
  if (!(bone instanceof THREE.Bone)) throw new Error(`Character rig is missing mixamorig${name}`);
  return bone;
}

export function createCharacterRig(options: {
  kind: CharacterKind;
  assetId: string;
  source: THREE.Object3D;
  chair: THREE.Object3D;
  badge?: string;
  release: () => void;
}): CharacterVisual {
  const { source, chair, kind, assetId } = options;
  const root = new THREE.Group();
  root.name = `character:${kind}`;
  const poseRoot = new THREE.Group();
  poseRoot.name = `character-pose:${kind}`;
  poseRoot.add(source);
  root.add(poseRoot, chair);
  chair.name = `character-chair:${kind}`;
  chair.position.set(0, 0, 0);
  chair.visible = false;
  for (const object of [source, chair]) object.traverse(child => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
    }
  });

  const bones: Record<string, THREE.Bone> = {};
  for (const name of ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase']) {
    bones[name] = requireBone(source, name);
  }
  const animations = (source.animations ?? []).map(clip => clip.name);
  const mixer = new THREE.AnimationMixer(source);
  const idle = source.animations.find(clip => clip.name === 'idle');
  if (idle) {
    mixer.clipAction(idle).play();
    mixer.update(.35);
    mixer.stopAllAction();
    mixer.uncacheRoot(source);
  }
  root.updateMatrixWorld(true);
  const rest = new Map<string, RestTransform>();
  source.traverse(object => rest.set(object.uuid, {
    position: object.position.clone(), quaternion: object.quaternion.clone(), scale: object.scale.clone(),
  }));
  const restore = () => {
    source.traverse(object => {
      const saved = rest.get(object.uuid);
      if (!saved) return;
      object.position.copy(saved.position);
      object.quaternion.copy(saved.quaternion);
      object.scale.copy(saved.scale);
    });
    poseRoot.position.set(0, 0, 0);
    root.updateMatrixWorld(true);
  };

  const pool = new VisualResourcePool();
  if (options.badge) {
    const badge = new THREE.Group();
    badge.name = `colleague-badge:${options.badge}`;
    addBox(badge, pool, pool.material({ color: 0x415c53, roughness: .72 }), [.006, .19, .006], [-.025, .09, 0]).rotation.z = -.22;
    addBox(badge, pool, pool.material({ color: 0x415c53, roughness: .72 }), [.006, .19, .006], [.025, .09, 0]).rotation.z = .22;
    addBox(badge, pool, pool.material({ color: 0xdcd5bd, roughness: .9 }), [.092, .115, .009], [0, -.045, .003]);
    const label = makeLabel(pool, options.badge, { width: .079, height: .085, foreground: '#293f35', background: '#ded8c1', fontSize: 47, lines: ['同事', options.badge] });
    label.position.set(0, -.045, .009);
    badge.add(label);
    root.updateMatrixWorld(true);
    const chest = bones.Spine2.getWorldPosition(new THREE.Vector3());
    const forward = new THREE.Vector3(0, -.12, .17).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
    badge.position.copy(chest).add(forward);
    root.add(badge);
    bones.Spine2.attach(badge);
  }

  const anchors = {
    hand: bones.RightHand,
    grip: bones.RightHand,
    head: bones.Head,
    leftHand: bones.LeftHand,
    rightHand: bones.RightHand,
    leftFoot: bones.LeftFoot,
    rightFoot: bones.RightFoot,
    back: new THREE.Group(),
    crown: new THREE.Group(),
    pelvis: new THREE.Group(),
    seat: new THREE.Group(),
  };
  anchors.back.name = 'anchor:back';
  anchors.crown.name = 'anchor:crown';
  anchors.pelvis.name = 'anchor:pelvis';
  anchors.seat.name = 'anchor:seat';
  root.add(anchors.back, anchors.crown, anchors.pelvis, anchors.seat);
  const chairContact = measureChairContact(chair);
  anchors.seat.position.set(0, chairContact.seatY, chairContact.seatProbeZ);

  const skullSamples: { mesh: THREE.SkinnedMesh; index: number }[] = [];
  source.traverse(object => {
    if (!(object instanceof THREE.SkinnedMesh)) return;
    const headIndex = object.skeleton.bones.indexOf(bones.Head);
    if (headIndex < 0) return;
    const indices = object.geometry.getAttribute('skinIndex');
    const weights = object.geometry.getAttribute('skinWeight');
    for (let index = 0; index < indices.count; index++) {
      for (let influence = 0; influence < 4; influence++) {
        if (indices.getComponent(index, influence) === headIndex && weights.getComponent(index, influence) >= .35) {
          skullSamples.push({ mesh: object, index });
          break;
        }
      }
    }
  });
  function skullTop() {
    root.updateMatrixWorld(true);
    let top = -Infinity;
    const vertex = new THREE.Vector3();
    for (const sample of skullSamples) {
      sample.mesh.getVertexPosition(sample.index, vertex);
      sample.mesh.localToWorld(vertex);
      root.worldToLocal(vertex);
      top = Math.max(top, vertex.y);
    }
    return Number.isFinite(top) ? top : localBounds(root, poseRoot).max.y;
  }

  let disposed = false;
  let activeClip = '';
  function locomotion(moving: boolean, sprint: boolean, time: number) {
    const name = moving ? (sprint && source.animations.some(clip => clip.name === 'run') ? 'run' : 'walk') : 'idle';
    const clip = source.animations.find(item => item.name === name);
    if (!clip) {
      restore();
      return;
    }
    if (activeClip !== name) {
      mixer.stopAllAction();
      mixer.clipAction(clip).play();
      activeClip = name;
    }
    mixer.setTime(.35 + time * (name === 'run' ? 1.1 : 1));
    root.updateMatrixWorld(true);
    // Remove root motion and sideways drift in the visual layer only. Codex
    // owns the authoritative position and velocity of the actor.
    const hips = toLocal(root, bones.Hips.getWorldPosition(new THREE.Vector3()));
    poseRoot.position.x -= hips.x;
    poseRoot.position.z -= hips.z;
    poseRoot.position.y -= localBounds(root, poseRoot).min.y;
    root.updateMatrixWorld(true);
  }

  function manualPose(input: CharacterPoseInput) {
    restore();
    activeClip = '';
    const seated = input.pose === 'working' || input.pose === 'rolling';
    // The regular working+crown silhouette needs about 1.701 m. Only a lower
    // authoritative clearance selects the tucked pose; unbound/high rooms keep it.
    const tuckedWorking = input.pose === 'working' && input.pot === 'crown' && input.clearance !== undefined && input.clearance < 1.71;
    const lean = input.pose === 'rolling' || tuckedWorking ? 1.16 : input.pose === 'crouching' ? .84 : input.pose === 'working' ? .12 : -.12;
    const hipY = input.pose === 'working' ? chairContact.seatY + (tuckedWorking ? .105 : .12) : input.pose === 'rolling' ? chairContact.seatY + .105 : input.pose === 'crouching' ? .275 : .61;
    const hipZ = seated ? chairContact.seatProbeZ - .08 : input.pose === 'crouching' ? .02 : -.02;
    translateHips(root, bones.Hips, new THREE.Vector3(0, hipY, hipZ));
    rotateInRoot(root, bones.Spine, new THREE.Vector3(1, 0, 0), lean * .44);
    rotateInRoot(root, bones.Spine1, new THREE.Vector3(1, 0, 0), lean * .56);
    rotateInRoot(root, bones.Head, new THREE.Vector3(1, 0, 0), -lean * .64);

    for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
      const footZ = hipZ + (seated ? .44 : input.pose === 'crouching' ? .25 : .27);
      solveLimb(root, bones[`${side}UpLeg`], bones[`${side}Leg`], bones[`${side}Foot`], toWorld(root, new THREE.Vector3(sign * .13, .105, footZ)), new THREE.Vector3(sign * .1, -.13, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
      const footPosition = bones[`${side}Foot`].getWorldPosition(new THREE.Vector3());
      aimBoneAtWorld(bones[`${side}Foot`], bones[`${side}ToeBase`], footPosition.clone().add(new THREE.Vector3(0, -.045, .16).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()))));
    }
    root.updateMatrixWorld(true);
    const head = toLocal(root, bones.Head.getWorldPosition(new THREE.Vector3()));
    const crownY = skullTop();
    for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
      let target: THREE.Vector3;
      let pole: THREE.Vector3;
      if ((input.pose === 'rolling' || tuckedWorking) && input.pot === 'crown') {
        target = new THREE.Vector3(sign * .265, crownY + .065, head.z + .025);
        pole = new THREE.Vector3(sign, .1, -.3);
      } else if (input.pose === 'working') {
        target = new THREE.Vector3(sign * .2, hipY + .25, hipZ + .34);
        pole = new THREE.Vector3(sign * .5, -.4, -.2);
      } else if (input.pose === 'rolling') {
        target = new THREE.Vector3(sign * .25, hipY + .16, hipZ + .3);
        pole = new THREE.Vector3(sign, -.2, -.3);
      } else {
        target = new THREE.Vector3(sign * .25, hipY + .38, hipZ + .38);
        pole = new THREE.Vector3(sign * .5, -.25, -.35);
      }
      solveLimb(root, bones[`${side}Arm`], bones[`${side}ForeArm`], bones[`${side}Hand`], toWorld(root, target), pole.applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
    }
    root.updateMatrixWorld(true);
    // Ground only the visual pose. The chair and the gameplay control root never move with it.
    const minimum = localBounds(root, poseRoot).min.y;
    if (Number.isFinite(minimum)) poseRoot.position.y -= minimum;
    root.updateMatrixWorld(true);
  }

  function updateAnchors() {
    root.updateMatrixWorld(true);
    anchors.pelvis.position.copy(toLocal(root, bones.Hips.getWorldPosition(new THREE.Vector3())));
    const spine = toLocal(root, bones.Spine2.getWorldPosition(new THREE.Vector3()));
    const head = toLocal(root, bones.Head.getWorldPosition(new THREE.Vector3()));
    anchors.back.position.set(spine.x, spine.y - .09, spine.z - .27);
    // Only skull-weighted skin determines the crown, never raised hands.
    anchors.crown.position.set(head.x, skullTop() + .004, head.z + .025);
    root.updateMatrixWorld(true);
  }

  function measure(extra?: THREE.Object3D): CharacterMeasurement {
    const body = localBounds(root, poseRoot);
    const chairBox = chair.visible ? localBounds(root, chair) : null;
    const combined = body.clone();
    if (chairBox) combined.union(chairBox);
    if (extra?.visible) combined.union(localBounds(root, extra));
    return {
      body: boxData(body),
      chair: chairBox ? boxData(chairBox) : null,
      combined: boxData(combined),
      height: combined.max.y - Math.min(0, combined.min.y),
      anchors: Object.fromEntries(Object.entries(anchors).map(([name, anchor]) => [name, toLocal(root, anchor.getWorldPosition(new THREE.Vector3())).toArray()])),
    };
  }

  updateAnchors();
  return {
    kind,
    assetId,
    root,
    poseRoot,
    chair,
    anchors,
    bones,
    animations,
    chairContact,
    update(input) {
      if (disposed) return;
      chair.visible = input.pose === 'working' || input.pose === 'rolling';
      if (input.pose === 'standing' && !input.gesturing && !(input.holding || input.pot === 'hand')) {
        locomotion(input.moving, input.sprint, input.time);
      } else if (input.pose === 'standing') {
        locomotion(false, false, input.time);
        if (input.gesturing) {
          for (const [side, sign] of [['Left', 1], ['Right', -1]] as const) {
            solveLimb(root, bones[`${side}Arm`], bones[`${side}ForeArm`], bones[`${side}Hand`], toWorld(root, new THREE.Vector3(sign * .3, 1.28, .36)), new THREE.Vector3(sign, -.25, -.3).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
          }
        } else {
          solveLimb(root, bones.RightArm, bones.RightForeArm, bones.RightHand, toWorld(root, new THREE.Vector3(-.22, .98, .27)), new THREE.Vector3(-1, -.3, -.2).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
        }
      } else {
        mixer.stopAllAction();
        manualPose(input);
      }
      updateAnchors();
    },
    setScale(scale) {
      if (!Number.isFinite(scale) || scale <= 0) throw new Error('Character visual scale must be positive');
      root.scale.setScalar(scale);
      root.updateMatrixWorld(true);
    },
    measure,
    getDiagnostics() {
      return { ...measure(), assetId, kind, animations, chairContact };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      mixer.stopAllAction();
      mixer.uncacheRoot(source);
      root.removeFromParent();
      pool.dispose();
      options.release();
    },
  };
}

/** Used only by asset normalization before the rig is constructed. */
export function normalizedSourceBounds(source: THREE.Object3D): THREE.Box3 {
  return measureVisualBounds(source);
}
