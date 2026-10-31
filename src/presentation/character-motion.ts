import * as THREE from 'three';
import type { CharacterPoseInput, CharacterVisual } from './character-rig';

export type CharacterWorkStance = 'seated' | 'chair-standing';
export type LeaderMotionMode = 'patrol' | 'inspect' | 'search' | 'chase' | 'alert';
export type CharacterMotionActivity = 'inherited' | 'chair-mount' | 'chair-work' | 'chair-dismount' | 'chair-recover' | 'leader-patrol' | 'leader-inspect' | 'leader-search';

/** Optional presentation semantics. Nothing here changes authoritative movement, sight or rules. */
export interface CharacterMotionInput extends CharacterPoseInput {
  workStance?: CharacterWorkStance;
  /** Current desktop world Y in metres, supplied by the workstation binding. */
  deskHeight?: number;
  /** Desktop front edge in actor-root local +Z metres; used only for the hand approach path. */
  deskFrontZ?: number;
  /** Measured horizontal speed in m/s; used only to match the playback cadence. */
  speed?: number;
  /** Signed authoritative look direction relative to the actor root, in radians. */
  lookYawOffset?: number;
  leaderMode?: LeaderMotionMode;
}

export interface MotionContact {
  position: number[];
  target: number[];
  error: number;
}
export interface MotionFootContact extends MotionContact {
  verticalError: number;
}
export interface CharacterMotionDiagnostics {
  activity: CharacterMotionActivity;
  support: number;
  cadence: number;
  transitionProgress: number;
  requestedLookYaw: number;
  appliedLookYaw: number;
  chairVisible: boolean;
  feet: Record<'left' | 'right', MotionFootContact>;
  hands: Record<'left' | 'right', MotionContact>;
}
export interface CharacterMotionOptions {
  /** Keep the formal chair at floor level while the authoritative actor root is on the seat. */
  useInternalChair?: boolean;
  mountDuration?: number;
  dismountDuration?: number;
  recoverDuration?: number;
}
export interface CharacterMotion {
  update(input: CharacterMotionInput): void;
  getDiagnostics(): CharacterMotionDiagnostics;
  reset(): void;
}

export const CHARACTER_MOTION_DEFAULTS = Object.freeze({
  mountDuration: .78,
  dismountDuration: .56,
  recoverDuration: .56,
  handHeightAboveDesk: .085,
  handForward: .50,
  deskFrontZ: .365,
  handApproachFrontGap: .23,
  ankleAboveSupport: .105,
  playerRunReferenceSpeed: 4.8,
  leaderSearchSpeed: 7.2,
  maxLookYaw: Math.PI / 2,
});

const clamp01 = (value: number) => THREE.MathUtils.clamp(value, 0, 1);
const smooth = (value: number) => { const t = clamp01(value); return t * t * (3 - 2 * t); };
const smoothRange = (start: number, end: number, value: number) => smooth((value - start) / (end - start));
const worldPosition = (object: THREE.Object3D) => object.getWorldPosition(new THREE.Vector3());

function aimBoneAtWorld(current: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
  current.updateWorldMatrix(true, false);
  child.updateWorldMatrix(true, false);
  const origin = current.getWorldPosition(new THREE.Vector3());
  const from = child.getWorldPosition(new THREE.Vector3()).sub(origin);
  const to = target.clone().sub(origin);
  if (from.lengthSq() < 1e-8 || to.lengthSq() < 1e-8) return;
  from.normalize(); to.normalize();
  const inverseParent = current.parent!.getWorldQuaternion(new THREE.Quaternion()).invert();
  from.applyQuaternion(inverseParent); to.applyQuaternion(inverseParent);
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

function moveHipsToWorld(visual: CharacterVisual, target: THREE.Vector3): void {
  visual.root.updateWorldMatrix(true, true);
  visual.bones.Hips.position.copy(visual.bones.Hips.parent!.worldToLocal(target.clone()));
  visual.bones.Hips.updateWorldMatrix(false, true);
}

function contact(position: THREE.Vector3, target: THREE.Vector3): MotionContact {
  return { position: position.toArray(), target: target.toArray(), error: position.distanceTo(target) };
}

export function createCharacterMotion(visual: CharacterVisual, options: CharacterMotionOptions = {}): CharacterMotion {
  const useInternalChair = options.useInternalChair !== false;
  const mountDuration = options.mountDuration ?? CHARACTER_MOTION_DEFAULTS.mountDuration;
  const dismountDuration = options.dismountDuration ?? CHARACTER_MOTION_DEFAULTS.dismountDuration;
  const recoverDuration = options.recoverDuration ?? CHARACTER_MOTION_DEFAULTS.recoverDuration;
  let support = 0;
  let lastTime: number | null = null;
  let lastDeskHeight = 1.9;
  let lastDeskFrontZ: number = CHARACTER_MOTION_DEFAULTS.deskFrontZ;
  let standingHipOffset = .9119307255;
  let activity: CharacterMotionActivity = 'inherited';
  let cadence = 1;
  let requestedLookYaw = 0;
  let appliedLookYaw = 0;
  let footTargets: Record<'left' | 'right', THREE.Vector3> | null = null;
  let handTargets: Record<'left' | 'right', THREE.Vector3> | null = null;
  let transitionProgress = 1;
  let leaderMode: LeaderMotionMode | null = null;
  let leaderPhase: number | null = null;
  let leaderLastTime: number | null = null;
  let leaderBlendStarted = 0;
  let leaderBlendDuration = .14;
  let leaderBlendFrom: Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }> | null = null;

  function captureBones(): Map<string, { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 }> {
    return new Map(Object.entries(visual.bones).map(([name, bone]) => [name, {
      position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
    }]));
  }

  /** Align the real palm, not just the wrist joint, with the desktop plane. */
  function layHandOnDesktop(side: 'Left' | 'Right', sign: number, weight: number): void {
    const hand = visual.bones[`${side}Hand`];
    const middle = visual.poseRoot.getObjectByName(`mixamorig${side}HandMiddle1`);
    const index = visual.poseRoot.getObjectByName(`mixamorig${side}HandIndex1`);
    const pinky = visual.poseRoot.getObjectByName(`mixamorig${side}HandPinky1`);
    if (!middle || !index || !pinky || weight <= 0) return;
    const wrist = worldPosition(hand);
    const original = hand.quaternion.clone();
    const rootRotation = visual.root.getWorldQuaternion(new THREE.Quaternion());
    const fingerDirection = new THREE.Vector3(0, -.035, 1).normalize();
    aimBoneAtWorld(hand, middle, wrist.clone().add(fingerDirection.clone().applyQuaternion(rootRotation)));
    const inverseRoot = rootRotation.clone().invert();
    const across = worldPosition(index).sub(worldPosition(pinky)).applyQuaternion(inverseRoot);
    across.addScaledVector(fingerDirection, -across.dot(fingerDirection));
    const targetAcross = new THREE.Vector3(-sign, 0, 0);
    targetAcross.addScaledVector(fingerDirection, -targetAcross.dot(fingerDirection));
    if (across.lengthSq() > 1e-8 && targetAcross.lengthSq() > 1e-8) {
      across.normalize(); targetAcross.normalize();
      const angle = Math.atan2(fingerDirection.dot(across.clone().cross(targetAcross)), across.dot(targetAcross));
      rotateInRoot(visual.root, hand, fingerDirection, angle);
    }
    const laid = hand.quaternion.clone();
    hand.quaternion.copy(original).slerp(laid, smooth(weight));
    hand.updateWorldMatrix(false, true);
  }

  function updateLeader(input: CharacterMotionInput): void {
    const mode = input.leaderMode ?? 'patrol';
    const searching = mode === 'search' || mode === 'chase';
    const speed = input.speed ?? (searching ? CHARACTER_MOTION_DEFAULTS.leaderSearchSpeed : mode === 'patrol' ? 2 : 0);
    const moving = mode === 'inspect' || mode === 'alert' ? false : input.moving || (searching && speed > .05);
    cadence = moving ? speed / (searching || input.sprint ? CHARACTER_MOTION_DEFAULTS.playerRunReferenceSpeed : 3.1) : 1;
    if (!Number.isFinite(cadence) || cadence <= 0) cadence = 1;
    const dt = leaderLastTime === null ? 0 : THREE.MathUtils.clamp(input.time - leaderLastTime, 0, 1);
    leaderLastTime = input.time;
    if (leaderPhase === null) leaderPhase = input.time;
    else leaderPhase += dt * cadence;
    if (leaderMode !== mode) {
      leaderBlendFrom = leaderMode === null ? null : captureBones();
      leaderBlendStarted = input.time;
      leaderBlendDuration = mode === 'inspect' || mode === 'alert' ? .18 : .14;
      transitionProgress = leaderMode === null ? 1 : 0;
      leaderMode = mode;
    }
    activity = searching ? 'leader-search' : mode === 'inspect' || mode === 'alert' ? 'leader-inspect' : 'leader-patrol';
    visual.update({
      ...input,
      moving,
      sprint: searching || input.sprint,
      time: leaderPhase,
      gesturing: input.gesturing || mode === 'inspect' || mode === 'alert',
    });
    if (leaderBlendFrom) {
      transitionProgress = clamp01((input.time - leaderBlendStarted) / leaderBlendDuration);
      const alpha = smooth(transitionProgress);
      for (const [name, previous] of leaderBlendFrom) {
        const bone = visual.bones[name];
        const position = bone.position.clone(), quaternion = bone.quaternion.clone(), scale = bone.scale.clone();
        bone.position.lerpVectors(previous.position, position, alpha);
        bone.quaternion.slerpQuaternions(previous.quaternion, quaternion, alpha);
        bone.scale.lerpVectors(previous.scale, scale, alpha);
      }
      if (transitionProgress >= 1) leaderBlendFrom = null;
      visual.root.updateMatrixWorld(true);
    }
    requestedLookYaw = input.lookYawOffset ?? 0;
    appliedLookYaw = THREE.MathUtils.clamp(requestedLookYaw, -CHARACTER_MOTION_DEFAULTS.maxLookYaw, CHARACTER_MOTION_DEFAULTS.maxLookYaw);
    const anchorOffsets = {
      back: visual.bones.Spine2.worldToLocal(worldPosition(visual.anchors.back)),
      crown: visual.bones.Head.worldToLocal(worldPosition(visual.anchors.crown)),
      pelvis: visual.bones.Hips.worldToLocal(worldPosition(visual.anchors.pelvis)),
    };
    rotateInRoot(visual.root, visual.bones.Spine2, new THREE.Vector3(0, 1, 0), appliedLookYaw * .35);
    rotateInRoot(visual.root, visual.bones.Neck, new THREE.Vector3(0, 1, 0), appliedLookYaw * .30);
    rotateInRoot(visual.root, visual.bones.Head, new THREE.Vector3(0, 1, 0), appliedLookYaw * .35);
    visual.root.updateMatrixWorld(true);
    visual.anchors.back.position.copy(visual.root.worldToLocal(visual.bones.Spine2.localToWorld(anchorOffsets.back)));
    visual.anchors.crown.position.copy(visual.root.worldToLocal(visual.bones.Head.localToWorld(anchorOffsets.crown)));
    visual.anchors.pelvis.position.copy(visual.root.worldToLocal(visual.bones.Hips.localToWorld(anchorOffsets.pelvis)));
    footTargets = handTargets = null;
    visual.root.updateMatrixWorld(true);
  }

  function reset(): void {
    support = 0;
    lastTime = null;
    lastDeskHeight = 1.9;
    lastDeskFrontZ = CHARACTER_MOTION_DEFAULTS.deskFrontZ;
    activity = 'inherited';
    cadence = 1;
    transitionProgress = 1;
    requestedLookYaw = appliedLookYaw = 0;
    footTargets = handTargets = null;
    leaderMode = null;
    leaderPhase = leaderLastTime = null;
    leaderBlendFrom = null;
  }

  function update(input: CharacterMotionInput): void {
    if (visual.kind === 'leader' && (input.leaderMode !== undefined || input.lookYawOffset !== undefined || input.speed !== undefined)) {
      updateLeader(input);
      return;
    }
    if (visual.kind === 'leader') {
      leaderMode = null;
      leaderPhase = leaderLastTime = null;
      leaderBlendFrom = null;
      transitionProgress = 1;
    }
    const elevated = input.workStance === 'chair-standing' && input.pose === 'working';
    const dt = lastTime === null ? 0 : THREE.MathUtils.clamp(input.time - lastTime, 0, 1);
    lastTime = input.time;
    if (Number.isFinite(input.deskHeight)) lastDeskHeight = input.deskHeight!;
    if (Number.isFinite(input.deskFrontZ)) lastDeskFrontZ = input.deskFrontZ!;
    if (!elevated && support === 0) {
      activity = 'inherited';
      footTargets = handTargets = null;
      visual.chair.position.y = 0;
      visual.anchors.seat.position.set(0, visual.chairContact.seatY, visual.chairContact.seatProbeZ);
      visual.update(input);
      return;
    }
    if (elevated) support = Math.min(1, support + dt / mountDuration);
    else support = Math.max(0, support - dt / (input.pose === 'working' ? recoverDuration : dismountDuration));
    if (!elevated && support === 0) {
      activity = 'inherited';
      footTargets = handTargets = null;
      visual.chair.position.y = 0;
      visual.anchors.seat.position.set(0, visual.chairContact.seatY, visual.chairContact.seatProbeZ);
      visual.update(input);
      return;
    }

    activity = elevated ? support < 1 ? 'chair-mount' : 'chair-work' : input.pose === 'working' ? 'chair-recover' : 'chair-dismount';
    const baseInput: CharacterMotionInput = elevated ? { ...input, pose: 'standing', moving: false, sprint: false } : input;
    visual.update(baseInput);
    visual.root.updateMatrixWorld(true);
    const root = visual.root;
    const rootWorld = worldPosition(root);
    const groundY = rootWorld.y - root.position.y;
    const seatY = groundY + visual.chairContact.seatY;
    const baseHips = worldPosition(visual.bones.Hips);
    const baseHands = {
      left: worldPosition(visual.bones.LeftHand),
      right: worldPosition(visual.bones.RightHand),
    };
    const baseFeet = {
      left: worldPosition(visual.bones.LeftFoot),
      right: worldPosition(visual.bones.RightFoot),
    };
    const anchorOffsets = {
      back: visual.bones.Spine2.worldToLocal(worldPosition(visual.anchors.back)),
      crown: visual.bones.Head.worldToLocal(worldPosition(visual.anchors.crown)),
      pelvis: visual.bones.Hips.worldToLocal(worldPosition(visual.anchors.pelvis)),
    };
    if (elevated) standingHipOffset = baseHips.y - rootWorld.y;
    const elevatedHips = new THREE.Vector3(rootWorld.x, seatY + standingHipOffset, rootWorld.z);
    const bodyBlend = elevated ? smoothRange(.42, 1, support) : smooth(support);
    const hipTarget = elevated
      ? baseHips.clone().add(new THREE.Vector3(0, -(seatY - groundY) * (1 - bodyBlend) - .012 * bodyBlend, 0))
      : baseHips.clone().lerp(elevatedHips, bodyBlend);
    moveHipsToWorld(visual, hipTarget);
    const lean = .09 * smooth(support);
    rotateInRoot(root, visual.bones.Spine, new THREE.Vector3(1, 0, 0), lean * .44);
    rotateInRoot(root, visual.bones.Spine1, new THREE.Vector3(1, 0, 0), lean * .56);
    rotateInRoot(root, visual.bones.Head, new THREE.Vector3(1, 0, 0), -lean * .64);

    const elevatedFeet: Record<'left' | 'right', THREE.Vector3> = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    const elevatedHands: Record<'left' | 'right', THREE.Vector3> = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    footTargets = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    handTargets = { left: new THREE.Vector3(), right: new THREE.Vector3() };
    for (const [side, sign] of [['left', 1], ['right', -1]] as const) {
      const boneSide = side === 'left' ? 'Left' : 'Right';
      const elevatedFoot = root.localToWorld(new THREE.Vector3(sign * .13, 0, side === 'left' ? .10 : -.02));
      elevatedFoot.y = seatY + CHARACTER_MOTION_DEFAULTS.ankleAboveSupport * root.getWorldScale(new THREE.Vector3()).y;
      elevatedFeet[side] = elevatedFoot;
      const step = side === 'left' ? smoothRange(0, .62, support) : smoothRange(.38, 1, support);
      const footTarget = elevated
        ? baseFeet[side].clone().add(new THREE.Vector3(0, -visual.chairContact.seatY, 0)).lerp(elevatedFoot, step)
        : baseFeet[side].clone().lerp(elevatedFoot, step);
      footTarget.y += Math.sin(step * Math.PI) * .085;
      footTargets[side].copy(footTarget);
      solveLimb(root, visual.bones[`${boneSide}UpLeg`], visual.bones[`${boneSide}Leg`], visual.bones[`${boneSide}Foot`], footTarget,
        new THREE.Vector3(sign * .1, -.13, 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
      const ankle = worldPosition(visual.bones[`${boneSide}Foot`]);
      aimBoneAtWorld(visual.bones[`${boneSide}Foot`], visual.bones[`${boneSide}ToeBase`], ankle.clone().add(new THREE.Vector3(0, -.045, .16).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()))));

      const handTarget = root.localToWorld(new THREE.Vector3(sign * .20, 0, CHARACTER_MOTION_DEFAULTS.handForward));
      handTarget.y = lastDeskHeight + CHARACTER_MOTION_DEFAULTS.handHeightAboveDesk;
      if (activity === 'chair-work') handTarget.z += Math.sin(input.time * (side === 'left' ? 7.4 : 5.1) + (side === 'left' ? 0 : 1)) * .003;
      elevatedHands[side] = handTarget.clone();
      const raisedDesktop = lastDeskHeight > 1.2;
      const handBlend = elevated ? smoothRange(.30, raisedDesktop ? .88 : 1, support) : raisedDesktop ? smoothRange(0, .82, support) : smooth(support);
      const target = elevated
        ? baseHands[side].clone().add(new THREE.Vector3(0, -visual.chairContact.seatY, 0)).lerp(handTarget, handBlend)
        : baseHands[side].clone().lerp(handTarget, handBlend);
      if (raisedDesktop) {
        const approach = root.localToWorld(new THREE.Vector3(sign * .20, 0, lastDeskFrontZ - CHARACTER_MOTION_DEFAULTS.handApproachFrontGap));
        if (elevated) {
          // Raise close to the body first; only move above the front edge after clearing the desktop.
          const startZ = THREE.MathUtils.lerp(baseHands[side].z, approach.z, smoothRange(0, .30, support));
          target.z = THREE.MathUtils.lerp(startZ, handTarget.z, smoothRange(.88, 1, support));
        } else {
          // Retract above the desk, then lower. Near the seated pose, restore the inherited hand Z smoothly.
          const returnZ = THREE.MathUtils.lerp(approach.z, baseHands[side].z, 1 - smoothRange(0, .25, support));
          target.z = THREE.MathUtils.lerp(returnZ, handTarget.z, smoothRange(.82, 1, support));
        }
      }
      handTargets[side].copy(target);
      solveLimb(root, visual.bones[`${boneSide}Arm`], visual.bones[`${boneSide}ForeArm`], visual.bones[`${boneSide}Hand`], target,
        new THREE.Vector3(sign * .12, -.8, .55).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion())));
      layHandOnDesktop(boneSide, sign, handBlend);
    }
    root.updateMatrixWorld(true);
    visual.anchors.back.position.copy(root.worldToLocal(visual.bones.Spine2.localToWorld(anchorOffsets.back)));
    visual.anchors.crown.position.copy(root.worldToLocal(visual.bones.Head.localToWorld(anchorOffsets.crown)));
    visual.anchors.pelvis.position.copy(root.worldToLocal(visual.bones.Hips.localToWorld(anchorOffsets.pelvis)));
    const seatAnchor = root.localToWorld(new THREE.Vector3(0, 0, visual.chairContact.seatProbeZ));
    seatAnchor.y = seatY;
    visual.anchors.seat.position.copy(root.worldToLocal(seatAnchor));
    visual.chair.position.y = -root.position.y;
    visual.chair.visible = useInternalChair;
    root.updateMatrixWorld(true);
  }

  function getDiagnostics(): CharacterMotionDiagnostics {
    visual.root.updateMatrixWorld(true);
    const scaleY = visual.root.getWorldScale(new THREE.Vector3()).y;
    const feet = {} as Record<'left' | 'right', MotionFootContact>;
    const hands = {} as Record<'left' | 'right', MotionContact>;
    for (const [side, boneSide] of [['left', 'Left'], ['right', 'Right']] as const) {
      const ankle = worldPosition(visual.bones[`${boneSide}Foot`]);
      const sole = ankle.clone(); sole.y -= CHARACTER_MOTION_DEFAULTS.ankleAboveSupport * scaleY;
      const targetAnkle = footTargets?.[side] ?? ankle;
      const targetSole = targetAnkle.clone(); targetSole.y -= CHARACTER_MOTION_DEFAULTS.ankleAboveSupport * scaleY;
      feet[side] = { ...contact(sole, targetSole), verticalError: Math.abs(sole.y - targetSole.y) };
      const hand = worldPosition(visual.bones[`${boneSide}Hand`]);
      hands[side] = contact(hand, handTargets?.[side] ?? hand);
    }
    return {
      activity, support, cadence, transitionProgress, requestedLookYaw, appliedLookYaw,
      chairVisible: visual.chair.visible, feet, hands,
    };
  }

  return { update, getDiagnostics, reset };
}

/** Drop-in update function for Codex to use instead of the stationary-working cache. */
export function createCharacterMotionUpdater(visual: CharacterVisual, options: CharacterMotionOptions = {}): (input: CharacterMotionInput) => void {
  const motion = createCharacterMotion(visual, options);
  return input => motion.update(input);
}
