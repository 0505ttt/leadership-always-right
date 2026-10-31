import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createCharacterRig, normalizedSourceBounds, type CharacterVisual } from './character-rig';

export type CharacterAssetId = 'employee-base-v1' | 'leader-v1' | 'chair-v1';

/** Structurally matches the existing RuntimeAssets cache; no duplicate downloads in the game. */
export interface CharacterAssetAdapter {
  instantiate(id: CharacterAssetId): THREE.Object3D;
  releaseInstance(instance: THREE.Object3D): void;
}

export interface CharacterLibraryOptions {
  assets?: CharacterAssetAdapter;
  /** Used only by the self-contained visual preview when no RuntimeAssets adapter is supplied. */
  assetBaseUrl?: string;
}

export interface CharacterLibrary {
  prepare(renderer?: THREE.WebGLRenderer, camera?: THREE.Camera, scene?: THREE.Scene): Promise<void>;
  createEmployee(): CharacterVisual;
  createLeader(): CharacterVisual;
  createColleague(badge?: string): CharacterVisual;
  /** Dispose live instances first; the library then releases only resources it owns. */
  dispose(): void;
}

interface LocalAssetEntry {
  promise: Promise<GLTF>;
  asset?: GLTF;
}

class LocalCharacterAssets implements CharacterAssetAdapter {
  private entries = new Map<CharacterAssetId, LocalAssetEntry>();
  private instances = new Set<THREE.Object3D>();
  private disposed = false;

  constructor(private readonly baseUrl: string) {}

  async load(id: CharacterAssetId): Promise<void> {
    if (this.disposed) throw new Error('Character library is disposed');
    let entry = this.entries.get(id);
    if (!entry) {
      const promise = new GLTFLoader().loadAsync(`${this.baseUrl}${id}.glb`).then(asset => {
        entry!.asset = asset;
        return asset;
      });
      entry = { promise };
      this.entries.set(id, entry);
      promise.catch(() => {
        if (this.entries.get(id) === entry) this.entries.delete(id);
      });
    }
    await entry.promise;
  }

  instantiate(id: CharacterAssetId): THREE.Object3D {
    if (this.disposed) throw new Error('Character library is disposed');
    const asset = this.entries.get(id)?.asset;
    if (!asset) throw new Error(`Character asset ${id} is not ready; await prepare() first`);
    const result = clone(asset.scene);
    result.animations = asset.animations.map(clip => clip.clone());
    this.instances.add(result);
    return result;
  }

  releaseInstance(instance: THREE.Object3D): void {
    if (!this.instances.delete(instance)) return;
    const skeletons = new Set<THREE.Skeleton>();
    instance.traverse(object => {
      if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    for (const skeleton of skeletons) skeleton.dispose();
    instance.removeFromParent();
  }

  async prepare(): Promise<void> {
    await Promise.all((['employee-base-v1', 'leader-v1', 'chair-v1'] as const).map(id => this.load(id)));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const instance of [...this.instances]) this.releaseInstance(instance);
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    const textures = new Set<THREE.Texture>();
    for (const entry of this.entries.values()) void entry.promise.then(asset => {
      for (const scene of new Set([asset.scene, ...asset.scenes])) scene.traverse(object => {
        if (!(object instanceof THREE.Mesh)) return;
        geometries.add(object.geometry);
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          materials.add(material);
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
        }
        if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      });
      for (const texture of textures) texture.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
    });
    this.entries.clear();
  }
}

function normalizeEmployee(model: THREE.Object3D): THREE.Object3D {
  // Keep the GLTF root intact for AnimationMixer track binding; normalize a parent wrapper.
  model.rotateY(-Math.PI / 2);
  const source = new THREE.Group();
  source.name = 'employee-base-v1-normalized';
  source.add(model);
  source.updateMatrixWorld(true);
  const before = normalizedSourceBounds(source);
  const scale = 1.75 / before.getSize(new THREE.Vector3()).y;
  const center = before.getCenter(new THREE.Vector3());
  model.position.sub(new THREE.Vector3(center.x, before.min.y, center.z));
  source.scale.setScalar(scale);
  source.animations = model.animations;
  source.updateMatrixWorld(true);
  return source;
}

/**
 * A round-scoped character factory. GLTFs stay in the supplied cache across rounds;
 * each character owns only its skeleton, mixer, anchors and optional badge resources.
 */
export function createCharacterLibrary(options: CharacterLibraryOptions = {}): CharacterLibrary {
  const ownedAssets = options.assets ? null : new LocalCharacterAssets(options.assetBaseUrl ?? `${import.meta.env.BASE_URL}assets/tripo/`);
  const assets = options.assets ?? ownedAssets!;
  const instances = new Set<CharacterVisual>();
  let prepared = false;
  let disposed = false;

  function create(kind: 'employee' | 'leader' | 'colleague', badge?: string): CharacterVisual {
    if (disposed) throw new Error('Character library is disposed');
    if (!prepared) throw new Error('Await characterLibrary.prepare() before creating characters');
    const assetId = kind === 'leader' ? 'leader-v1' : 'employee-base-v1';
    const model = assets.instantiate(assetId);
    const chair = assets.instantiate('chair-v1');
    const source = normalizeEmployee(model);
    if (kind === 'leader') {
      source.name = 'leader-v1-normalized';
      // This rigged leader faces +Z; cancel only the employee's quarter-turn.
      source.rotateY(Math.PI / 2);
      source.scale.multiplyScalar(1.85 / 1.75);
    }
    const character = createCharacterRig({
      kind, assetId, source, chair, badge,
      release: () => {
        assets.releaseInstance(model);
        assets.releaseInstance(chair);
        instances.delete(character);
      },
    });
    instances.add(character);
    return character;
  }

  return {
    async prepare(renderer, camera, scene) {
      if (disposed) throw new Error('Character library is disposed');
      if (ownedAssets) await ownedAssets.prepare();
      if (renderer && camera) {
        const warmup = new THREE.Group();
        warmup.name = 'character-shader-warmup';
        const clones = (['employee-base-v1', 'leader-v1', 'chair-v1'] as const).map(id => assets.instantiate(id));
        clones.forEach(clone => warmup.add(clone));
        const textures = new Set<THREE.Texture>();
        warmup.traverse(object => {
          if (!(object instanceof THREE.Mesh)) return;
          for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
            for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
          }
        });
        try {
          for (const texture of textures) renderer.initTexture(texture);
          await renderer.compileAsync(warmup, camera, scene);
        } finally {
          for (const clone of clones) assets.releaseInstance(clone);
        }
      }
      prepared = true;
    },
    createEmployee: () => create('employee'),
    createLeader: () => create('leader'),
    createColleague: (badge = '') => create('colleague', badge || undefined),
    dispose() {
      if (disposed) return;
      for (const character of [...instances]) character.dispose();
      ownedAssets?.dispose();
      disposed = true;
    },
  };
}

export type { CharacterVisual, CharacterPoseInput, CharacterMeasurement, PotPose } from './character-rig';
